from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

JOB_TYPES = frozenset(
    {
        "document_import",
        "document_reindex",
        "full_reindex",
        "db_sync",
    }
)

JOB_STATUSES = frozenset(
    {
        "pending",
        "running",
        "succeeded",
        "failed",
        "cancelled",
    }
)

DEFAULT_JOB_LIMIT = 50
MAX_JOB_LIMIT = 200

_MISSING = object()


class JobStoreError(ValueError):
    pass


class JobStore:
    def __init__(self, database_path: str | Path) -> None:
        self.database_path = Path(database_path)
        self._schema_lock = threading.RLock()
        self._schema_ready = False

    def create_job(
        self,
        job_type: str,
        payload: dict[str, Any] | None = None,
        message: str = "",
        progress: int = 0,
    ) -> dict[str, Any]:
        _validate_job_type(job_type)
        progress = _validate_progress(progress)
        now = _now()
        job_id = f"job_{uuid.uuid4().hex}"

        with self._connect() as connection:
            self._ensure_schema(connection)
            connection.execute(
                """
                INSERT INTO rag_jobs (
                    job_id,
                    job_type,
                    status,
                    progress,
                    message,
                    error_json,
                    payload_json,
                    result_json,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    job_type,
                    "pending",
                    progress,
                    message,
                    None,
                    _to_json(payload or {}),
                    None,
                    now,
                    now,
                ),
            )
            connection.commit()

        job = self.get_job(job_id)
        if job is None:
            raise JobStoreError(f"Created job cannot be loaded: {job_id}")
        return job

    def update_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        message: str | None = None,
        error: Any = _MISSING,
        result: Any = _MISSING,
    ) -> dict[str, Any]:
        if status is not None:
            _validate_job_status(status)
        if progress is not None:
            progress = _validate_progress(progress)

        assignments: list[str] = []
        values: list[Any] = []

        if status is not None:
            assignments.append("status = ?")
            values.append(status)
        if progress is not None:
            assignments.append("progress = ?")
            values.append(progress)
        if message is not None:
            assignments.append("message = ?")
            values.append(message)
        if error is not _MISSING:
            assignments.append("error_json = ?")
            values.append(_to_json(error) if error is not None else None)
        if result is not _MISSING:
            assignments.append("result_json = ?")
            values.append(_to_json(result) if result is not None else None)

        assignments.append("updated_at = ?")
        values.append(_now())
        values.append(job_id)

        with self._connect() as connection:
            self._ensure_schema(connection)
            cursor = connection.execute(
                f"UPDATE rag_jobs SET {', '.join(assignments)} WHERE job_id = ?",
                values,
            )
            connection.commit()

        if cursor.rowcount == 0:
            raise KeyError(f"Job not found: {job_id}")

        job = self.get_job(job_id)
        if job is None:
            raise KeyError(f"Job not found: {job_id}")
        return job

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            self._ensure_schema(connection)
            row = connection.execute(
                "SELECT * FROM rag_jobs WHERE job_id = ?",
                (job_id,),
            ).fetchone()

        return _row_to_job(row) if row is not None else None

    def list_jobs(
        self,
        *,
        limit: int = DEFAULT_JOB_LIMIT,
        job_type: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        limit = _validate_limit(limit)
        where_clauses: list[str] = []
        values: list[Any] = []

        if job_type:
            _validate_job_type(job_type)
            where_clauses.append("job_type = ?")
            values.append(job_type)
        if status:
            _validate_job_status(status)
            where_clauses.append("status = ?")
            values.append(status)

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        values.append(limit)

        with self._connect() as connection:
            self._ensure_schema(connection)
            rows = connection.execute(
                f"""
                SELECT *
                FROM rag_jobs
                {where_sql}
                ORDER BY datetime(updated_at) DESC, job_id DESC
                LIMIT ?
                """,
                values,
            ).fetchall()

        return [_row_to_job(row) for row in rows]

    def _connect(self) -> sqlite3.Connection:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    def _ensure_schema(self, connection: sqlite3.Connection) -> None:
        if self._schema_ready:
            return

        with self._schema_lock:
            if self._schema_ready:
                return
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS rag_jobs (
                    job_id TEXT PRIMARY KEY,
                    job_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    message TEXT NOT NULL DEFAULT '',
                    error_json TEXT,
                    payload_json TEXT,
                    result_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_rag_jobs_updated_at ON rag_jobs(updated_at)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_rag_jobs_status ON rag_jobs(status)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_rag_jobs_type ON rag_jobs(job_type)"
            )
            connection.commit()
            self._schema_ready = True


def _row_to_job(row: sqlite3.Row) -> dict[str, Any]:
    job_id = str(row["job_id"])
    job_type = str(row["job_type"])
    status = str(row["status"])
    progress = int(row["progress"])
    created_at = str(row["created_at"])
    updated_at = str(row["updated_at"])
    return {
        "jobId": job_id,
        "job_id": job_id,
        "type": job_type,
        "status": status,
        "progress": progress,
        "message": str(row["message"] or ""),
        "error": _from_json(row["error_json"]),
        "payload": _from_json(row["payload_json"]) or {},
        "result": _from_json(row["result_json"]),
        "createdAt": created_at,
        "created_at": created_at,
        "updatedAt": updated_at,
        "updated_at": updated_at,
    }


def _validate_job_type(job_type: str) -> None:
    if job_type not in JOB_TYPES:
        raise JobStoreError(f"Unsupported job type: {job_type}")


def _validate_job_status(status: str) -> None:
    if status not in JOB_STATUSES:
        raise JobStoreError(f"Unsupported job status: {status}")


def _validate_progress(progress: int) -> int:
    try:
        parsed = int(progress)
    except (TypeError, ValueError) as error:
        raise JobStoreError("progress must be an integer.") from error
    if parsed < 0 or parsed > 100:
        raise JobStoreError("progress must be between 0 and 100.")
    return parsed


def _validate_limit(limit: int) -> int:
    try:
        parsed = int(limit)
    except (TypeError, ValueError):
        return DEFAULT_JOB_LIMIT
    if parsed <= 0:
        return DEFAULT_JOB_LIMIT
    return min(parsed, MAX_JOB_LIMIT)


def _to_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _from_json(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")
