from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from string import Formatter
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse


DEFAULT_TEXT_TEMPLATE = """案例编号：{code}

历史定制需求：
{customRequest}

历史产品部方案：
{invSolutions}"""

DEFAULT_DICTIONARY_RULES = {
    "copy_fields": ["code"],
    "keyword_tags": {
        "custom_types": {
            "source": ["customRequest", "invSolutions"],
            "dictionary": {
                "中性": ["中性", "neutral"],
                "英文": ["英文", "英语", "English"],
                "去logo": ["去logo", "去 logo", "不带logo", "不含 logo", "无logo"],
                "不体现型号": ["不体现型号", "不显示型号", "不带型号"],
                "刷程序": ["刷程序", "程序", "软件"],
                "改标签": ["标签", "铭牌", "贴纸"],
            },
        },
        "constraints": {
            "source": ["customRequest", "invSolutions"],
            "dictionary": {
                "不能有中文": ["不要中文", "不能有中文", "无中文", "全英文"],
                "需要附件": ["附件", "图纸", "效果图"],
                "包装相关": ["包装", "纸箱", "外箱"],
            },
        },
    },
    "boolean_flags": {
        "has_solution": {"source": "invSolutions", "mode": "not_empty"},
        "requires_attachment": {"source": ["customRequest", "invSolutions"], "keywords": ["附件", "图纸"]},
    },
}


@dataclass
class DBSyncConfig:
    id: str
    name: str
    db_url: str
    table_name: str
    primary_key: str
    updated_at_column: str
    select_columns: list[str]
    text_template: str = DEFAULT_TEXT_TEMPLATE
    dictionary_rules: dict[str, Any] = field(default_factory=lambda: json.loads(json.dumps(DEFAULT_DICTIONARY_RULES, ensure_ascii=False)))
    where_clause: str = ""
    interval_minutes: int = 5
    batch_size: int = 100
    active: bool = False
    last_watermark: str = ""
    last_run_at: str = ""
    last_success_at: str = ""
    last_error: str = ""
    total_synced: int = 0
    total_skipped: int = 0
    created_at: str = ""
    updated_at: str = ""


@dataclass
class DBSyncResult:
    job_id: str
    fetched: int = 0
    upserted: int = 0
    skipped: int = 0
    failed: int = 0
    last_watermark: str = ""
    error_message: str = ""


class DBSyncService:
    def __init__(self, root_dir: str) -> None:
        self.root = Path(root_dir)
        self.root.mkdir(parents=True, exist_ok=True)
        self.config_path = self.root / "jobs.json"
        self.state_path = self.root / "sync_state.sqlite3"
        self._ensure_state_db()

    def list_configs(self) -> list[DBSyncConfig]:
        payload = self._read_config_payload()
        jobs = [DBSyncConfig(**item) for item in payload.get("jobs", [])]
        return sorted(jobs, key=lambda item: item.updated_at or item.created_at, reverse=True)

    def get_config(self, job_id: str) -> DBSyncConfig | None:
        return next((item for item in self.list_configs() if item.id == job_id), None)

    def save_config(self, config: DBSyncConfig) -> DBSyncConfig:
        now = _now()
        if not config.id:
            config.id = _make_job_id(config.name or config.table_name)
        if not config.created_at:
            config.created_at = now
        config.updated_at = now

        jobs = [item for item in self.list_configs() if item.id != config.id]
        jobs.append(config)
        self._write_config_payload({"jobs": [asdict(item) for item in jobs]})
        return config

    def delete_config(self, job_id: str) -> None:
        jobs = [item for item in self.list_configs() if item.id != job_id]
        self._write_config_payload({"jobs": [asdict(item) for item in jobs]})
        with sqlite3.connect(self.state_path) as conn:
            conn.execute("DELETE FROM ai_kb_sync_state WHERE job_id = ?", (job_id,))
            conn.commit()

    def reset_watermark(self, job_id: str) -> None:
        config = self.get_config(job_id)
        if not config:
            return
        config.last_watermark = ""
        config.last_error = ""
        self.save_config(config)

    def due_configs(self) -> list[DBSyncConfig]:
        now_ts = time.time()
        due: list[DBSyncConfig] = []
        for config in self.list_configs():
            if not config.active:
                continue
            if not config.last_run_at:
                due.append(config)
                continue
            try:
                last_ts = datetime.fromisoformat(config.last_run_at).timestamp()
            except ValueError:
                due.append(config)
                continue
            if now_ts - last_ts >= max(1, int(config.interval_minutes)) * 60:
                due.append(config)
        return due

    def inspect_columns(self, config: DBSyncConfig) -> list[dict[str, str]]:
        return _inspect_table_columns(config)

    def run_config(self, config: DBSyncConfig, vector_store: Any) -> DBSyncResult:
        result = DBSyncResult(job_id=config.id, last_watermark=config.last_watermark)
        started_at = _now()
        config.last_run_at = started_at
        try:
            rows = _fetch_incremental_rows(config)
            result.fetched = len(rows)
            vector_records: list[dict[str, Any]] = []
            latest_watermark = config.last_watermark

            for row in rows:
                try:
                    source_id = str(row.get(config.primary_key, "")).strip()
                    if not source_id:
                        result.failed += 1
                        continue

                    vector_id = f"db:{config.id}:{source_id}"
                    vector_text = render_template(config.text_template, row).strip()
                    if not vector_text:
                        result.failed += 1
                        self._record_sync_state(
                            config=config,
                            source_id=source_id,
                            vector_id=vector_id,
                            content_hash="",
                            sync_status="failed",
                            error_message="Rendered vector text is empty.",
                            updated_at_value=_stringify(row.get(config.updated_at_column, "")),
                        )
                        continue

                    metadata = apply_dictionary_rules(row, config.dictionary_rules)
                    metadata.update(
                        {
                            "sync_source": "database",
                            "sync_job_id": config.id,
                            "sync_job_name": config.name,
                            "source_table": config.table_name,
                            "source_id": source_id,
                            "source_updated_at": _stringify(row.get(config.updated_at_column, "")),
                        }
                    )
                    content_hash = _content_hash(vector_text, metadata)
                    previous_hash = self._get_content_hash(config.id, source_id)
                    watermark_value = _stringify(row.get(config.updated_at_column, ""))
                    if previous_hash == content_hash:
                        result.skipped += 1
                        self._record_sync_state(
                            config=config,
                            source_id=source_id,
                            vector_id=vector_id,
                            content_hash=content_hash,
                            sync_status="skipped",
                            error_message="",
                            updated_at_value=watermark_value,
                        )
                    else:
                        vector_records.append(
                            {
                                "id": vector_id,
                                "text": vector_text,
                                "metadata": {
                                    **metadata,
                                    "content_hash": content_hash,
                                    "file_name": f"{config.name}:{source_id}",
                                },
                            }
                        )
                        self._record_sync_state(
                            config=config,
                            source_id=source_id,
                            vector_id=vector_id,
                            content_hash=content_hash,
                            sync_status="pending",
                            error_message="",
                            updated_at_value=watermark_value,
                        )

                    if watermark_value:
                        # Rows are ordered by the watermark column ascending in the query.
                        # Advancing to the last processed row avoids lexicographic string
                        # comparison issues such as "999" being greater than "1000".
                        latest_watermark = watermark_value
                except Exception as error:
                    result.failed += 1
                    self._record_sync_state(
                        config=config,
                        source_id=str(row.get(config.primary_key, "")),
                        vector_id="",
                        content_hash="",
                        sync_status="failed",
                        error_message=str(error),
                        updated_at_value=_stringify(row.get(config.updated_at_column, "")),
                    )

            if vector_records:
                vector_store.upsert_text_records(vector_records)
                for record in vector_records:
                    self._mark_vector_synced(config.id, str(record["metadata"]["source_id"]))
                result.upserted = len(vector_records)

            config.last_watermark = latest_watermark
            config.last_success_at = _now()
            config.last_error = ""
            config.total_synced += result.upserted
            config.total_skipped += result.skipped
            result.last_watermark = latest_watermark
        except Exception as error:
            result.error_message = _format_db_error(error, config)
            config.last_error = result.error_message
        finally:
            self.save_config(config)

        return result

    def state_rows(self, job_id: str, limit: int = 20) -> list[dict[str, Any]]:
        with sqlite3.connect(self.state_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT source_id, vector_id, sync_status, synced_at, updated_at_value, error_message
                FROM ai_kb_sync_state
                WHERE job_id = ?
                ORDER BY synced_at DESC
                LIMIT ?
                """,
                (job_id, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def recent_state_rows(self, job_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        with sqlite3.connect(self.state_path) as conn:
            conn.row_factory = sqlite3.Row
            if job_id:
                rows = conn.execute(
                    """
                    SELECT job_id, source_table, source_id, vector_id, sync_status, synced_at, updated_at_value, error_message
                    FROM ai_kb_sync_state
                    WHERE job_id = ?
                    ORDER BY synced_at DESC
                    LIMIT ?
                    """,
                    (job_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT job_id, source_table, source_id, vector_id, sync_status, synced_at, updated_at_value, error_message
                    FROM ai_kb_sync_state
                    ORDER BY synced_at DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
        return [dict(row) for row in rows]

    def config_from_payload(
        self,
        payload: dict[str, Any],
        existing: DBSyncConfig | None = None,
    ) -> DBSyncConfig:
        values = asdict(existing) if existing else {}

        def read(*names: str, default: Any = None) -> Any:
            for name in names:
                if name in payload:
                    return payload[name]
            return default

        db_url = _stringify(read("dbUrl", "db_url", default=values.get("db_url", ""))).strip()
        _validate_db_url_for_storage(db_url)

        raw_select_columns = read("selectColumns", "select_columns", default=values.get("select_columns", []))
        if isinstance(raw_select_columns, str):
            select_columns = parse_column_list(raw_select_columns)
        elif isinstance(raw_select_columns, list):
            select_columns = [str(item).strip() for item in raw_select_columns if str(item).strip()]
            if not select_columns:
                raise ValueError("selectColumns must contain at least one column.")
        else:
            raise ValueError("selectColumns must be an array or comma-separated string.")

        raw_rules = read("dictionaryRules", "dictionary_rules", default=values.get("dictionary_rules", DEFAULT_DICTIONARY_RULES))
        if isinstance(raw_rules, str):
            dictionary_rules = validate_dictionary_rules(raw_rules)
        elif isinstance(raw_rules, dict):
            dictionary_rules = raw_rules
        else:
            raise ValueError("dictionaryRules must be a JSON object.")

        config = DBSyncConfig(
            id=_stringify(read("id", "syncJobId", "sync_job_id", default=values.get("id", ""))).strip(),
            name=_required_text(read("name", default=values.get("name", "")), "name"),
            db_url=db_url,
            table_name=_required_text(read("tableName", "table_name", default=values.get("table_name", "")), "tableName"),
            primary_key=_required_text(read("primaryKey", "primary_key", default=values.get("primary_key", "")), "primaryKey"),
            updated_at_column=_required_text(
                read("updatedAtColumn", "updated_at_column", default=values.get("updated_at_column", "")),
                "updatedAtColumn",
            ),
            select_columns=select_columns,
            text_template=_stringify(read("textTemplate", "text_template", default=values.get("text_template", DEFAULT_TEXT_TEMPLATE))),
            dictionary_rules=dictionary_rules,
            where_clause=_stringify(read("whereClause", "where_clause", default=values.get("where_clause", ""))),
            interval_minutes=_bounded_int(
                read("intervalMinutes", "interval_minutes", default=values.get("interval_minutes", 5)),
                default=5,
                minimum=1,
                maximum=1440,
                field_name="intervalMinutes",
            ),
            batch_size=_bounded_int(
                read("batchSize", "batch_size", default=values.get("batch_size", 100)),
                default=100,
                minimum=1,
                maximum=10000,
                field_name="batchSize",
            ),
            active=bool(read("active", default=values.get("active", False))),
            last_watermark=_stringify(read("lastWatermark", "last_watermark", default=values.get("last_watermark", ""))),
            last_run_at=_stringify(values.get("last_run_at", "")),
            last_success_at=_stringify(values.get("last_success_at", "")),
            last_error=_stringify(values.get("last_error", "")),
            total_synced=int(values.get("total_synced", 0) or 0),
            total_skipped=int(values.get("total_skipped", 0) or 0),
            created_at=_stringify(values.get("created_at", "")),
            updated_at=_stringify(values.get("updated_at", "")),
        )
        _validate_identifier_fields(config)
        return config

    def to_api_dict(self, config: DBSyncConfig) -> dict[str, Any]:
        return {
            "id": config.id,
            "syncJobId": config.id,
            "name": config.name,
            "dbUrl": _redact_db_url(config.db_url),
            "db_url": _redact_db_url(config.db_url),
            "tableName": config.table_name,
            "table_name": config.table_name,
            "primaryKey": config.primary_key,
            "primary_key": config.primary_key,
            "updatedAtColumn": config.updated_at_column,
            "updated_at_column": config.updated_at_column,
            "selectColumns": config.select_columns,
            "select_columns": config.select_columns,
            "textTemplate": config.text_template,
            "text_template": config.text_template,
            "dictionaryRules": config.dictionary_rules,
            "dictionary_rules": config.dictionary_rules,
            "whereClause": config.where_clause,
            "where_clause": config.where_clause,
            "intervalMinutes": config.interval_minutes,
            "interval_minutes": config.interval_minutes,
            "batchSize": config.batch_size,
            "batch_size": config.batch_size,
            "active": config.active,
            "lastWatermark": config.last_watermark,
            "last_watermark": config.last_watermark,
            "lastRunAt": config.last_run_at,
            "last_run_at": config.last_run_at,
            "lastSuccessAt": config.last_success_at,
            "last_success_at": config.last_success_at,
            "lastError": config.last_error,
            "last_error": config.last_error,
            "totalSynced": config.total_synced,
            "total_synced": config.total_synced,
            "totalSkipped": config.total_skipped,
            "total_skipped": config.total_skipped,
            "createdAt": config.created_at,
            "created_at": config.created_at,
            "updatedAt": config.updated_at,
            "updated_at": config.updated_at,
        }

    def _read_config_payload(self) -> dict[str, Any]:
        if not self.config_path.exists():
            return {"jobs": []}
        return json.loads(self.config_path.read_text(encoding="utf-8"))

    def _write_config_payload(self, payload: dict[str, Any]) -> None:
        self.config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _ensure_state_db(self) -> None:
        with sqlite3.connect(self.state_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ai_kb_sync_state (
                    job_id TEXT NOT NULL,
                    source_table TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    vector_id TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    sync_status TEXT NOT NULL,
                    synced_at TEXT,
                    updated_at_value TEXT,
                    error_message TEXT,
                    PRIMARY KEY (job_id, source_id)
                )
                """
            )
            conn.commit()

    def _get_content_hash(self, job_id: str, source_id: str) -> str:
        with sqlite3.connect(self.state_path) as conn:
            row = conn.execute(
                "SELECT content_hash FROM ai_kb_sync_state WHERE job_id = ? AND source_id = ?",
                (job_id, source_id),
            ).fetchone()
        return str(row[0]) if row else ""

    def _record_sync_state(
        self,
        config: DBSyncConfig,
        source_id: str,
        vector_id: str,
        content_hash: str,
        sync_status: str,
        error_message: str,
        updated_at_value: str,
    ) -> None:
        with sqlite3.connect(self.state_path) as conn:
            conn.execute(
                """
                INSERT INTO ai_kb_sync_state (
                    job_id, source_table, source_id, vector_id, content_hash,
                    sync_status, synced_at, updated_at_value, error_message
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id, source_id) DO UPDATE SET
                    source_table = excluded.source_table,
                    vector_id = excluded.vector_id,
                    content_hash = excluded.content_hash,
                    sync_status = excluded.sync_status,
                    synced_at = excluded.synced_at,
                    updated_at_value = excluded.updated_at_value,
                    error_message = excluded.error_message
                """,
                (
                    config.id,
                    config.table_name,
                    source_id,
                    vector_id,
                    content_hash,
                    sync_status,
                    _now(),
                    updated_at_value,
                    error_message,
                ),
            )
            conn.commit()

    def _mark_vector_synced(self, job_id: str, source_id: str) -> None:
        with sqlite3.connect(self.state_path) as conn:
            conn.execute(
                """
                UPDATE ai_kb_sync_state
                SET sync_status = 'synced', synced_at = ?, error_message = ''
                WHERE job_id = ? AND source_id = ?
                """,
                (_now(), job_id, source_id),
            )
            conn.commit()


def render_template(template: str, row: dict[str, Any]) -> str:
    values = {key: _stringify(value) for key, value in row.items()}
    for _, field_name, _, _ in Formatter().parse(template):
        if field_name and field_name not in values:
            values[field_name] = ""
    try:
        return template.format_map(_SafeDict(values))
    except Exception:
        return template


def apply_dictionary_rules(row: dict[str, Any], rules: dict[str, Any]) -> dict[str, str | int | float | bool]:
    metadata: dict[str, Any] = {}

    for field_name in rules.get("copy_fields", []):
        if field_name in row:
            metadata[str(field_name)] = row[field_name]

    for output_name, rule in rules.get("value_maps", {}).items():
        if not isinstance(rule, dict):
            continue
        source_value = _stringify(row.get(str(rule.get("source", "")), ""))
        mapped = rule.get("map", {}).get(source_value, rule.get("default", source_value))
        metadata[str(output_name)] = mapped

    for output_name, rule in rules.get("keyword_tags", {}).items():
        if not isinstance(rule, dict):
            continue
        haystack = _collect_source_text(row, rule.get("source", []))
        dictionary = rule.get("dictionary", {})
        tags = []
        if isinstance(dictionary, dict):
            for tag, keywords in dictionary.items():
                if isinstance(keywords, str):
                    keywords = [keywords]
                if any(str(keyword).lower() in haystack.lower() for keyword in keywords):
                    tags.append(str(tag))
        metadata[str(output_name)] = ",".join(tags)

    for output_name, rule in rules.get("boolean_flags", {}).items():
        if not isinstance(rule, dict):
            continue
        mode = str(rule.get("mode", "keywords"))
        source_text = _collect_source_text(row, rule.get("source", []))
        if mode == "not_empty":
            metadata[str(output_name)] = bool(source_text.strip())
        else:
            keywords = rule.get("keywords", [])
            if isinstance(keywords, str):
                keywords = [keywords]
            metadata[str(output_name)] = any(str(keyword).lower() in source_text.lower() for keyword in keywords)

    return _normalize_metadata(metadata)


def validate_dictionary_rules(raw_json: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw_json.strip() or "{}")
    except json.JSONDecodeError as error:
        raise ValueError(f"字典规则不是合法 JSON：{error}") from error
    if not isinstance(payload, dict):
        raise ValueError("字典规则根节点必须是 JSON Object。")
    return payload


def parse_column_list(raw_value: str) -> list[str]:
    columns = [item.strip() for item in re.split(r"[,\n]", raw_value) if item.strip()]
    if not columns:
        raise ValueError("至少需要配置一个取数字段。")
    return columns


def db_sync_result_to_dict(result: DBSyncResult) -> dict[str, Any]:
    return {
        "syncJobId": result.job_id,
        "sync_job_id": result.job_id,
        "fetched": result.fetched,
        "upserted": result.upserted,
        "skipped": result.skipped,
        "failed": result.failed,
        "lastWatermark": result.last_watermark,
        "last_watermark": result.last_watermark,
        "errorMessage": result.error_message,
        "error_message": result.error_message,
    }


def _required_text(value: Any, field_name: str) -> str:
    text = _stringify(value).strip()
    if not text:
        raise ValueError(f"{field_name} is required.")
    return text


def _bounded_int(value: Any, *, default: int, minimum: int, maximum: int, field_name: str) -> int:
    if value is None or value == "":
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field_name} must be an integer.") from error
    if parsed < minimum or parsed > maximum:
        raise ValueError(f"{field_name} must be between {minimum} and {maximum}.")
    return parsed


def _validate_db_url_for_storage(db_url: str) -> None:
    if not db_url:
        raise ValueError("dbUrl is required.")
    if db_url.startswith("env:"):
        env_name = db_url.replace("env:", "", 1).strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", env_name):
            raise ValueError("dbUrl env: value must be an environment variable name.")
        return
    if db_url.startswith("sqlite:///"):
        return
    if _db_url_contains_secret(db_url):
        raise ValueError("dbUrl must not contain plaintext credentials. Use env:VARIABLE_NAME instead.")


def _db_url_contains_secret(db_url: str) -> bool:
    lowered = db_url.lower()
    if re.search(r"([?;&]|^)(password|pwd)=", lowered):
        return True
    try:
        parsed = urlparse(db_url)
    except Exception:
        return False
    return bool(parsed.password)


def _redact_db_url(db_url: str) -> str:
    if db_url.startswith("env:") or db_url.startswith("sqlite:///"):
        return db_url
    try:
        parsed = urlparse(db_url)
    except Exception:
        return db_url
    if not parsed.password and not re.search(r"([?;&]|^)(password|pwd)=", db_url, flags=re.IGNORECASE):
        return db_url
    redacted = db_url
    if parsed.password:
        redacted = redacted.replace(f":{parsed.password}@", ":<redacted>@")
    redacted = re.sub(r"([?;&](?:password|pwd)=)[^;&]+", r"\1<redacted>", redacted, flags=re.IGNORECASE)
    return redacted


def _validate_identifier_fields(config: DBSyncConfig) -> None:
    _quote_identifier(config.table_name, _detect_sql_dialect(_resolve_db_url_for_validation(config.db_url)))
    _quote_identifier(config.primary_key, "default")
    _quote_identifier(config.updated_at_column, "default")
    for column in config.select_columns:
        _quote_identifier(column, "default")


def _resolve_db_url_for_validation(raw_db_url: str) -> str:
    if raw_db_url.startswith("env:"):
        return "default://placeholder"
    return raw_db_url


def _fetch_incremental_rows(config: DBSyncConfig) -> list[dict[str, Any]]:
    db_url = _resolve_db_url(config.db_url)
    dialect = _detect_sql_dialect(db_url)
    columns = _dedupe_columns([config.primary_key, config.updated_at_column, *config.select_columns])
    quoted_columns = ", ".join(_quote_identifier(column, dialect) for column in columns)
    quoted_table = _quote_identifier(config.table_name, dialect)
    quoted_watermark = _quote_identifier(config.updated_at_column, dialect)
    where_parts: list[str] = []
    limit = max(1, int(config.batch_size))
    params: dict[str, Any] = {}
    if config.last_watermark:
        where_parts.append(f"{quoted_watermark} > :last_watermark")
        params["last_watermark"] = config.last_watermark
    normalized_where_clause = _normalize_where_clause(config.where_clause)
    if normalized_where_clause:
        where_parts.append(f"({normalized_where_clause})")
    where_sql = f" WHERE {' AND '.join(where_parts)}" if where_parts else ""
    if dialect == "mssql":
        sql = f"SELECT TOP {limit} {quoted_columns} FROM {quoted_table}{where_sql} ORDER BY {quoted_watermark} ASC"
    else:
        params["limit"] = limit
        sql = f"SELECT {quoted_columns} FROM {quoted_table}{where_sql} ORDER BY {quoted_watermark} ASC LIMIT :limit"

    try:
        if db_url.startswith("sqlite:///"):
            return _fetch_sqlite_rows(db_url, sql, params)
        if db_url.startswith("mssql+pymssql://"):
            return _fetch_pymssql_rows(db_url, sql, params)
        return _fetch_sqlalchemy_rows(db_url, sql, params)
    except Exception as error:
        raise RuntimeError(f"{error}\n\n最终执行的 SQL：\n{sql}") from error


def _inspect_table_columns(config: DBSyncConfig) -> list[dict[str, str]]:
    db_url = _resolve_db_url(config.db_url)
    dialect = _detect_sql_dialect(db_url)
    schema_name, table_name = _split_table_name(config.table_name, dialect)
    if db_url.startswith("sqlite:///"):
        return _inspect_sqlite_columns(db_url, table_name)
    if db_url.startswith("mssql+pymssql://"):
        return _inspect_pymssql_columns(db_url, schema_name, table_name)
    return _inspect_sqlalchemy_columns(db_url, dialect, schema_name, table_name)


def _resolve_db_url(raw_db_url: str) -> str:
    value = raw_db_url.strip()
    if not value.startswith("env:"):
        return value
    env_name = value.replace("env:", "", 1).strip()
    if not env_name:
        raise ValueError("数据库连接 URL 的 env: 后面需要填写环境变量名。")
    resolved = os.getenv(env_name, "").strip()
    if not resolved:
        raise ValueError(f"环境变量 {env_name} 未配置数据库连接 URL。")
    return resolved


def _fetch_sqlite_rows(db_url: str, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    db_path = db_url.replace("sqlite:///", "", 1)
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(_sqlalchemy_to_sqlite_named_params(sql), params).fetchall()
    return [dict(row) for row in rows]


def _inspect_sqlite_columns(db_url: str, table_name: str) -> list[dict[str, str]]:
    db_path = db_url.replace("sqlite:///", "", 1)
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(f"PRAGMA table_info({_quote_identifier(table_name, 'sqlite')})").fetchall()
    return [{"字段名": str(row["name"]), "类型": str(row["type"])} for row in rows]


def _fetch_pymssql_rows(db_url: str, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        import pymssql
    except ModuleNotFoundError as error:
        raise RuntimeError("连接 SQL Server 的 mssql+pymssql URL 需要先安装 pymssql。") from error

    parsed = urlparse(db_url)
    database = parsed.path.lstrip("/")
    if not parsed.hostname or not database:
        raise ValueError("SQL Server 连接 URL 需要包含数据库地址和数据库名。")

    query = parse_qs(parsed.query)
    charset = query.get("charset", ["UTF-8"])[0]
    positional_params: list[Any] = []
    native_sql = sql
    if ":last_watermark" in native_sql:
        native_sql = native_sql.replace(":last_watermark", "%s")
        positional_params.append(params["last_watermark"])

    conn = _connect_pymssql(db_url)
    try:
        with conn.cursor() as cursor:
            cursor.execute(native_sql, tuple(positional_params))
            return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def _inspect_pymssql_columns(db_url: str, schema_name: str, table_name: str) -> list[dict[str, str]]:
    conn = _connect_pymssql(db_url)
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT COLUMN_NAME, DATA_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                ORDER BY ORDINAL_POSITION
                """,
                (schema_name, table_name),
            )
            return [{"字段名": str(row["COLUMN_NAME"]), "类型": str(row["DATA_TYPE"])} for row in cursor.fetchall()]
    finally:
        conn.close()


def _fetch_sqlalchemy_rows(db_url: str, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        from sqlalchemy import create_engine, text
    except ModuleNotFoundError as error:
        raise RuntimeError("连接 SQL Server/MySQL/PostgreSQL 等内网数据库需要先安装 SQLAlchemy 和对应数据库驱动。SQL Server 通常需要 pyodbc 和 Microsoft ODBC Driver。") from error

    try:
        engine = create_engine(db_url, pool_pre_ping=True)
        with engine.connect() as conn:
            rows = conn.execute(text(sql), params).mappings().all()
    except ModuleNotFoundError as error:
        raise RuntimeError("数据库驱动未安装。SQL Server 请安装 pyodbc，并确认系统已安装 Microsoft ODBC Driver；MySQL 请安装 PyMySQL。") from error
    return [dict(row) for row in rows]


def _inspect_sqlalchemy_columns(db_url: str, dialect: str, schema_name: str, table_name: str) -> list[dict[str, str]]:
    try:
        from sqlalchemy import create_engine, text
    except ModuleNotFoundError as error:
        raise RuntimeError("读取表字段需要先安装 SQLAlchemy 和对应数据库驱动。") from error

    engine = create_engine(db_url, pool_pre_ping=True)
    if dialect == "mssql":
        sql = text(
            """
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = :schema_name AND TABLE_NAME = :table_name
            ORDER BY ORDINAL_POSITION
            """
        )
        params = {"schema_name": schema_name, "table_name": table_name}
    else:
        sql = text(
            """
            SELECT column_name AS COLUMN_NAME, data_type AS DATA_TYPE
            FROM information_schema.columns
            WHERE table_schema = :schema_name AND table_name = :table_name
            ORDER BY ordinal_position
            """
        )
        params = {"schema_name": schema_name, "table_name": table_name}
    with engine.connect() as conn:
        rows = conn.execute(sql, params).mappings().all()
    return [{"字段名": str(row["COLUMN_NAME"]), "类型": str(row["DATA_TYPE"])} for row in rows]


def _connect_pymssql(db_url: str) -> Any:
    try:
        import pymssql
    except ModuleNotFoundError as error:
        raise RuntimeError("连接 SQL Server 的 mssql+pymssql URL 需要先安装 pymssql。") from error

    parsed = urlparse(db_url)
    database = parsed.path.lstrip("/")
    if not parsed.hostname or not database:
        raise ValueError("SQL Server 连接 URL 需要包含数据库地址和数据库名。")

    query = parse_qs(parsed.query)
    charset = query.get("charset", ["UTF-8"])[0]
    return pymssql.connect(
        server=parsed.hostname,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        database=unquote(database),
        port=parsed.port or 1433,
        charset=charset,
        as_dict=True,
    )


def _sqlalchemy_to_sqlite_named_params(sql: str) -> str:
    return re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", r":\1", sql)


def _normalize_where_clause(where_clause: str) -> str:
    normalized = where_clause.strip().rstrip(";").strip()
    for _ in range(4):
        previous = normalized
        normalized = normalized.strip().rstrip(";").strip()
        normalized = _strip_outer_parentheses(normalized)
        normalized = re.sub(r"^(where|and)\b\s+", "", normalized, flags=re.IGNORECASE).strip()
        if normalized == previous:
            break
    return normalized


def _strip_outer_parentheses(value: str) -> str:
    stripped = value.strip()
    while stripped.startswith("(") and stripped.endswith(")") and _has_wrapping_parentheses(stripped):
        stripped = stripped[1:-1].strip()
    return stripped


def _has_wrapping_parentheses(value: str) -> bool:
    depth = 0
    for index, char in enumerate(value):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0 and index != len(value) - 1:
                return False
        if depth < 0:
            return False
    return depth == 0


def _split_table_name(table_name: str, dialect: str) -> tuple[str, str]:
    parts = [part.strip(" []`\"") for part in table_name.split(".") if part.strip()]
    if len(parts) >= 2:
        return parts[-2], parts[-1]
    if dialect == "mssql":
        return "dbo", parts[0] if parts else ""
    if dialect == "mysql":
        return "", parts[0] if parts else ""
    return "public", parts[0] if parts else ""


def _format_db_error(error: Exception, config: DBSyncConfig) -> str:
    message = str(error)
    invalid_column_match = re.search(r"Invalid column name '([^']+)'", message, flags=re.IGNORECASE)
    if invalid_column_match:
        column_name = invalid_column_match.group(1)
        configured_columns = _dedupe_columns([config.primary_key, config.updated_at_column, *config.select_columns])
        return (
            f"数据库表中不存在字段：{column_name}。\n\n"
            "请检查“主键字段 / 增量水位字段 / 取数字段 / 过滤条件”里是否写了这个字段。\n"
            f"当前取数字段配置：{', '.join(configured_columns)}\n\n"
            "可以点击“读取表字段”查看当前表真实字段名。"
        )
    return message


def _detect_sql_dialect(db_url: str) -> str:
    lowered = db_url.lower()
    if lowered.startswith("mssql"):
        return "mssql"
    if lowered.startswith("mysql"):
        return "mysql"
    if lowered.startswith("sqlite"):
        return "sqlite"
    return "default"


def _quote_identifier(identifier: str, dialect: str) -> str:
    parts = [part.strip() for part in identifier.split(".") if part.strip()]
    if not parts:
        raise ValueError("数据库表名或字段名不能为空。")
    for part in parts:
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", part):
            raise ValueError(f"数据库表名或字段名包含不支持的字符：{identifier}")
    if dialect == "mysql":
        return ".".join(f"`{part}`" for part in parts)
    if dialect == "mssql":
        return ".".join(f"[{part}]" for part in parts)
    return ".".join(f'"{part}"' for part in parts)


def _dedupe_columns(columns: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for column in columns:
        if column not in seen:
            seen.add(column)
            result.append(column)
    return result


def _content_hash(text: str, metadata: dict[str, Any]) -> str:
    digest = hashlib.sha256()
    digest.update(text.encode("utf-8"))
    digest.update(json.dumps(metadata, ensure_ascii=False, sort_keys=True).encode("utf-8"))
    return digest.hexdigest()


def _make_job_id(seed: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_]+", "_", seed.strip())[:36].strip("_") or "db_sync"
    return f"{normalized}_{int(time.time())}"


def _collect_source_text(row: dict[str, Any], source: Any) -> str:
    if isinstance(source, str):
        source = [source]
    if not isinstance(source, list):
        return ""
    return "\n".join(_stringify(row.get(str(column), "")) for column in source)


def _normalize_metadata(metadata: dict[str, Any]) -> dict[str, str | int | float | bool]:
    normalized: dict[str, str | int | float | bool] = {}
    for key, value in metadata.items():
        if isinstance(value, (bool, int, float, str)):
            normalized[str(key)] = value
        elif value is not None:
            normalized[str(key)] = json.dumps(value, ensure_ascii=False)
    return normalized


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class _SafeDict(dict[str, str]):
    def __missing__(self, key: str) -> str:
        return ""
