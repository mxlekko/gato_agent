from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

APP_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = APP_ROOT.parent
DEFAULT_DATA_DIR = APP_ROOT / "data"
DEFAULT_CHROMA_DIR = DEFAULT_DATA_DIR / "chroma"
DEFAULT_JOBS_DB = DEFAULT_DATA_DIR / "jobs.sqlite3"
DEFAULT_LIBRARY_DIR = DEFAULT_DATA_DIR / "library"
DEFAULT_UPLOAD_DIR = DEFAULT_DATA_DIR / "uploads"
DEFAULT_DB_SYNC_DIR = DEFAULT_DATA_DIR / "db_sync"
DEFAULT_COLLECTION_PREFIX = "local_rag_mvp"
SUPPORTED_UPLOAD_EXTENSIONS = {".docx", ".md", ".txt", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}


class RAGServiceError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _load_env_files() -> None:
    try:
        from dotenv import load_dotenv
    except ModuleNotFoundError:
        return

    for env_path in (PROJECT_ROOT / ".env", APP_ROOT / ".env"):
        if env_path.exists():
            load_dotenv(env_path, override=False)


def _runtime_data_root() -> Path:
    raw_root = os.getenv("RAG_DATA_DIR", "").strip()
    return Path(raw_root).expanduser().resolve() if raw_root else DEFAULT_DATA_DIR


def _runtime_path(env_name: str, default_path: Path, data_relative_path: str | None = None) -> Path:
    raw_value = os.getenv(env_name, "").strip()
    if raw_value:
        return Path(raw_value).expanduser().resolve()

    if data_relative_path:
        return _runtime_data_root() / data_relative_path

    return default_path


def _chroma_dir() -> Path:
    return _runtime_path("RAG_CHROMA_DIR", DEFAULT_CHROMA_DIR, "chroma")


def _jobs_db_path() -> Path:
    return _runtime_path("RAG_JOBS_DB", DEFAULT_JOBS_DB, "jobs.sqlite3")


def _library_dir() -> Path:
    return _runtime_path("RAG_LIBRARY_DIR", DEFAULT_LIBRARY_DIR, "library")


def _upload_dir() -> Path:
    return _runtime_path("RAG_UPLOAD_DIR", DEFAULT_UPLOAD_DIR, "uploads")


def _db_sync_dir() -> Path:
    return _runtime_path("RAG_DB_SYNC_DIR", DEFAULT_DB_SYNC_DIR, "db_sync")


def _json_response(handler: BaseHTTPRequestHandler, status_code: int, payload: dict[str, Any]) -> None:
    raw = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def _error_response(
    handler: BaseHTTPRequestHandler,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> None:
    error: dict[str, Any] = {
        "code": code,
        "message": message,
    }
    if details:
        error["details"] = details
    _json_response(
        handler,
        status_code,
        {
            "success": False,
            "data": None,
            "error": error,
        },
    )


def _read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or "0")
    if length <= 0:
        return {}

    raw = handler.rfile.read(length).decode("utf-8").strip()
    if not raw:
        return {}

    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("JSON body must be an object.")
    return payload


def _request_path(handler: BaseHTTPRequestHandler) -> str:
    path = urlparse(handler.path).path
    return path.rstrip("/") or "/"


def _query_params(handler: BaseHTTPRequestHandler) -> dict[str, str]:
    parsed = urlparse(handler.path)
    return {
        key: values[-1]
        for key, values in parse_qs(parsed.query, keep_blank_values=True).items()
        if values
    }


def _matches_path(handler: BaseHTTPRequestHandler, expected: str) -> bool:
    return _request_path(handler) == expected


def _to_positive_int(value: Any, default: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed <= 0:
        return default
    return min(parsed, maximum)


class RAGSearchService:
    def __init__(self) -> None:
        _load_env_files()
        self.api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
        self.embedding_model = os.getenv("EMBEDDING_MODEL", "text-embedding-v4").strip() or "text-embedding-v4"
        self.collection_name = os.getenv("RAG_COLLECTION_NAME", "").strip() or self._default_collection_name()
        self.store: Any | None = None
        self.job_store: Any | None = None
        self.db_sync_service: Any | None = None

    def _default_collection_name(self) -> str:
        suffix = self.embedding_model.replace("-", "_").replace(".", "_")
        return f"{DEFAULT_COLLECTION_PREFIX}__{suffix}"

    def get_store(self) -> Any:
        if not self.api_key:
            raise RAGServiceError(
                "RAG_CONFIG_MISSING",
                "DASHSCOPE_API_KEY is required for RAG semantic search.",
            )

        if self.store is None:
            try:
                from rag_mvp.store import LocalRAGStore
            except ModuleNotFoundError as error:
                missing_name = getattr(error, "name", "") or str(error)
                raise RAGServiceError(
                    "RAG_DEPENDENCY_MISSING",
                    f"Python dependency is missing: {missing_name}. Run `python -m pip install -r rag-service/requirements.txt`.",
                ) from error

            self.store = LocalRAGStore(
                persist_directory=str(_chroma_dir()),
                api_key=self.api_key,
                collection_name=self.collection_name,
                embedding_model=self.embedding_model,
            )
        return self.store

    def get_library(self) -> Any:
        try:
            from rag_mvp.library import DocumentLibrary
        except ModuleNotFoundError as error:
            missing_name = getattr(error, "name", "") or str(error)
            raise RAGServiceError(
                "RAG_DEPENDENCY_MISSING",
                f"Python dependency is missing: {missing_name}. Run `python -m pip install -r rag-service/requirements.txt`.",
            ) from error

        return DocumentLibrary(str(_library_dir()))

    def get_job_store(self) -> Any:
        if self.job_store is None:
            try:
                from rag_mvp.jobs import JobStore
            except ModuleNotFoundError as error:
                missing_name = getattr(error, "name", "") or str(error)
                raise RAGServiceError(
                    "RAG_DEPENDENCY_MISSING",
                    f"Python dependency is missing: {missing_name}. Run `python -m pip install -r rag-service/requirements.txt`.",
                ) from error

            self.job_store = JobStore(str(_jobs_db_path()))
        return self.job_store

    def get_db_sync_service(self) -> Any:
        if self.db_sync_service is None:
            try:
                from rag_mvp.db_sync import DBSyncService
            except ModuleNotFoundError as error:
                missing_name = getattr(error, "name", "") or str(error)
                raise RAGServiceError(
                    "RAG_DEPENDENCY_MISSING",
                    f"Python dependency is missing: {missing_name}. Run `python -m pip install -r rag-service/requirements.txt`.",
                ) from error

            self.db_sync_service = DBSyncService(str(_db_sync_dir()))
        return self.db_sync_service

    def try_get_index_summary(self, doc_id: str) -> dict[str, Any] | None:
        if not self.api_key:
            return None

        try:
            return self.get_store().get_document_summary(doc_id)
        except Exception:
            return None

    def try_delete_document_chunks(self, doc_id: str) -> dict[str, Any]:
        try:
            deleted_count = self.get_store().delete_document(doc_id)
            return {
                "deletedChunkCount": deleted_count,
                "vectorDeleteSkipped": False,
                "vectorDeleteReason": None,
            }
        except RAGServiceError as error:
            return {
                "deletedChunkCount": 0,
                "vectorDeleteSkipped": True,
                "vectorDeleteReason": error.code,
            }
        except Exception as error:
            return {
                "deletedChunkCount": 0,
                "vectorDeleteSkipped": True,
                "vectorDeleteReason": str(error),
            }

    def reindex_document(self, doc_id: str, config: Any) -> dict[str, Any]:
        document = self.get_library().build_parsed_document(doc_id)
        store = self.get_store()
        chunks = store.chunk_document(document=document, config=config)
        result = store.upsert_document(document=document, chunks=chunks)
        index_summary = store.get_document_summary(doc_id)
        return {
            **result,
            "index_summary": index_summary,
        }

    def get_document_chunks(self, doc_id: str, limit: int | None = None) -> list[dict[str, Any]]:
        return self.get_store().get_document_chunks(doc_id, limit=limit)

    def create_reindex_job(self, doc_id: str, config: Any) -> dict[str, Any]:
        self.get_library().get_document(doc_id)
        job = self.get_job_store().create_job(
            "document_reindex",
            payload={
                "docId": doc_id,
                "chunkConfig": _chunk_config_to_dict(config),
            },
            message="Queued document reindex.",
        )
        thread = threading.Thread(
            target=self._run_reindex_job,
            args=(job["jobId"], doc_id, config),
            daemon=True,
        )
        thread.start()
        return job

    def _run_reindex_job(self, job_id: str, doc_id: str, config: Any) -> None:
        job_store = self.get_job_store()
        try:
            job_store.update_job(job_id, status="running", progress=5, message="Loading document.")
            document = self.get_library().build_parsed_document(doc_id)

            job_store.update_job(job_id, progress=25, message="Chunking document.")
            store = self.get_store()
            chunks = store.chunk_document(document=document, config=config)

            job_store.update_job(job_id, progress=70, message="Writing vectors.")
            result = store.upsert_document(document=document, chunks=chunks)
            index_summary = store.get_document_summary(doc_id)

            job_store.update_job(
                job_id,
                status="succeeded",
                progress=100,
                message="Document reindex completed.",
                error=None,
                result={
                    "docId": doc_id,
                    "chunkCount": int(result.get("chunk_count", 0)),
                    "indexSummary": index_summary,
                    "chunkConfig": _chunk_config_to_dict(config),
                },
            )
        except RAGServiceError as error:
            job_store.update_job(
                job_id,
                status="failed",
                progress=100,
                message="Document reindex failed.",
                error={
                    "code": error.code,
                    "message": error.message,
                },
            )
        except Exception as error:
            job_store.update_job(
                job_id,
                status="failed",
                progress=100,
                message="Document reindex failed.",
                error={
                    "code": "RAG_DOCUMENT_REINDEX_FAILED",
                    "message": str(error),
                },
            )

    def create_db_sync_execution_job(self, sync_job_id: str) -> dict[str, Any]:
        config = self.get_db_sync_service().get_config(sync_job_id)
        if config is None:
            raise FileNotFoundError(f"DB sync job not found: {sync_job_id}")

        job = self.get_job_store().create_job(
            "db_sync",
            payload={
                "syncJobId": config.id,
                "syncJobName": config.name,
                "tableName": config.table_name,
            },
            message="Queued database sync.",
        )
        thread = threading.Thread(
            target=self._run_db_sync_execution_job,
            args=(job["jobId"], config.id),
            daemon=True,
        )
        thread.start()
        return job

    def _run_db_sync_execution_job(self, job_id: str, sync_job_id: str) -> None:
        job_store = self.get_job_store()
        try:
            job_store.update_job(job_id, status="running", progress=5, message="Loading database sync config.")
            service = self.get_db_sync_service()
            config = service.get_config(sync_job_id)
            if config is None:
                raise FileNotFoundError(f"DB sync job not found: {sync_job_id}")

            job_store.update_job(job_id, progress=20, message="Fetching and indexing database rows.")
            result = service.run_config(config, self.get_store())

            try:
                from rag_mvp.db_sync import db_sync_result_to_dict
            except ModuleNotFoundError as error:
                missing_name = getattr(error, "name", "") or str(error)
                raise RAGServiceError(
                    "RAG_DEPENDENCY_MISSING",
                    f"Python dependency is missing: {missing_name}. Run `python -m pip install -r rag-service/requirements.txt`.",
                ) from error

            result_payload = db_sync_result_to_dict(result)
            if result.error_message:
                job_store.update_job(
                    job_id,
                    status="failed",
                    progress=100,
                    message="Database sync failed.",
                    error={
                        "code": "RAG_DB_SYNC_FAILED",
                        "message": result.error_message,
                    },
                    result=result_payload,
                )
                return

            job_store.update_job(
                job_id,
                status="succeeded",
                progress=100,
                message="Database sync completed.",
                error=None,
                result=result_payload,
            )
        except RAGServiceError as error:
            job_store.update_job(
                job_id,
                status="failed",
                progress=100,
                message="Database sync failed.",
                error={
                    "code": error.code,
                    "message": error.message,
                },
            )
        except Exception as error:
            job_store.update_job(
                job_id,
                status="failed",
                progress=100,
                message="Database sync failed.",
                error={
                    "code": "RAG_DB_SYNC_FAILED",
                    "message": str(error),
                },
            )


SERVICE = RAGSearchService()


class RAGSearchHandler(BaseHTTPRequestHandler):
    server_version = "LocalRAGSearch/0.2"

    def log_message(self, format: str, *args: Any) -> None:
        if os.getenv("RAG_SEARCH_ACCESS_LOG", "").strip() == "1":
            super().log_message(format, *args)

    def do_GET(self) -> None:
        if _matches_path(self, "/health"):
            self._handle_health()
            return

        if _matches_path(self, "/internal/rag/documents"):
            self._handle_list_documents()
            return

        if _matches_path(self, "/internal/rag/jobs"):
            self._handle_list_jobs()
            return

        if _matches_path(self, "/internal/rag/db-sync/jobs"):
            self._handle_list_db_sync_jobs()
            return

        db_sync_job_id = _match_db_sync_detail_path(self)
        if db_sync_job_id:
            self._handle_get_db_sync_job(db_sync_job_id)
            return

        job_id = _match_job_detail_path(self)
        if job_id:
            self._handle_get_job(job_id)
            return

        chunks_doc_id = _match_document_action_path(self, "chunks")
        if chunks_doc_id:
            self._handle_get_document_chunks(chunks_doc_id)
            return

        doc_id = _match_document_detail_path(self)
        if doc_id:
            self._handle_get_document(doc_id)
            return

        _error_response(self, 404, "NOT_FOUND", "Not found.")

    def do_POST(self) -> None:
        if _matches_path(self, "/internal/rag/search"):
            self._handle_search()
            return

        if _matches_path(self, "/internal/rag/documents"):
            self._handle_upload_document()
            return

        if _matches_path(self, "/internal/rag/db-sync/jobs"):
            self._handle_create_db_sync_job()
            return

        db_sync_inspect_id = _match_db_sync_action_path(self, "inspect-columns")
        if db_sync_inspect_id:
            self._handle_inspect_db_sync_columns(db_sync_inspect_id)
            return

        db_sync_run_id = _match_db_sync_action_path(self, "run")
        if db_sync_run_id:
            self._handle_run_db_sync_job(db_sync_run_id)
            return

        reindex_doc_id = _match_document_action_path(self, "reindex")
        if reindex_doc_id:
            self._handle_reindex_document(reindex_doc_id)
            return

        _error_response(self, 404, "NOT_FOUND", "Not found.")

    def do_PATCH(self) -> None:
        db_sync_job_id = _match_db_sync_detail_path(self)
        if db_sync_job_id:
            self._handle_update_db_sync_job(db_sync_job_id)
            return

        doc_id = _match_document_detail_path(self)
        if doc_id:
            self._handle_update_document(doc_id)
            return

        _error_response(self, 404, "NOT_FOUND", "Not found.")

    def do_DELETE(self) -> None:
        db_sync_job_id = _match_db_sync_detail_path(self)
        if db_sync_job_id:
            self._handle_delete_db_sync_job(db_sync_job_id)
            return

        doc_id = _match_document_detail_path(self)
        if doc_id:
            self._handle_delete_document(doc_id)
            return

        _error_response(self, 404, "NOT_FOUND", "Not found.")

    def _handle_health(self) -> None:
        try:
            store = SERVICE.get_store()
            chunk_count = store.chunk_count()
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "service": "ok",
                        "embeddingModel": SERVICE.embedding_model,
                        "collection": SERVICE.collection_name,
                        "chunkCount": chunk_count,
                    },
                    "error": None,
                },
            )
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_HEALTH_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_HEALTH_FAILED", str(error))

    def _handle_search(self) -> None:
        try:
            body = _read_json_body(self)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            _error_response(self, 400, "INVALID_JSON", str(error))
            return

        query = str(body.get("query") or "").strip()
        if not query:
            _error_response(self, 400, "INVALID_REQUEST", "query is required.")
            return

        top_k = _to_positive_int(body.get("topK", body.get("top_k")), default=5, maximum=10)
        doc_id = str(body.get("docId") or body.get("doc_id") or "").strip() or None

        try:
            results = SERVICE.get_store().search(query=query, top_k=top_k, doc_id=doc_id)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "requestId": body.get("requestId") or None,
                    "data": {
                        "query": query,
                        "topK": top_k,
                        "docId": doc_id,
                        "matches": results,
                    },
                    "error": None,
                },
            )
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_SEARCH_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_SEARCH_FAILED", str(error))

    def _handle_list_documents(self) -> None:
        params = _query_params(self)
        keyword = str(params.get("keyword") or "").strip().lower()
        source_type = str(params.get("sourceType") or params.get("source_type") or "").strip().lower()

        try:
            documents = []
            for manifest in SERVICE.get_library().list_documents():
                if keyword and keyword not in str(manifest.get("file_name", "")).lower():
                    continue
                if source_type and source_type != str(manifest.get("source_type", "")).lower():
                    continue
                documents.append(_document_summary(manifest, SERVICE.try_get_index_summary(manifest["doc_id"])))

            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "documents": documents,
                        "total": len(documents),
                    },
                    "error": None,
                },
            )
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DOCUMENTS_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DOCUMENTS_FAILED", str(error))

    def _handle_upload_document(self) -> None:
        try:
            body = _read_json_body(self)
            file_name = _safe_file_name(str(body.get("fileName") or body.get("file_name") or "").strip())
            raw_bytes = _decode_upload_content(body)
            upload_path = _write_upload_file(file_name, raw_bytes)
            managed = SERVICE.get_library().import_file(str(upload_path), display_name=_display_name(file_name))
            manifest = _managed_document_to_dict(managed)
            summary = _document_summary(manifest, None)

            _json_response(
                self,
                201,
                {
                    "success": True,
                    "data": {
                        "docId": managed.doc_id,
                        "document": summary,
                    },
                    "error": None,
                },
            )
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, binascii.Error) as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DOCUMENT_UPLOAD_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DOCUMENT_UPLOAD_FAILED", str(error))

    def _handle_get_document(self, doc_id: str) -> None:
        try:
            document = SERVICE.get_library().get_document(doc_id)
            index_summary = SERVICE.try_get_index_summary(doc_id)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "manifest": _document_summary(document, index_summary),
                        "content": document.get("content", ""),
                        "indexSummary": index_summary,
                    },
                    "error": None,
                },
            )
        except FileNotFoundError as error:
            _error_response(self, 404, "RAG_DOCUMENT_NOT_FOUND", str(error))
        except ValueError as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DOCUMENT_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DOCUMENT_FAILED", str(error))

    def _handle_update_document(self, doc_id: str) -> None:
        try:
            body = _read_json_body(self)
            content = body.get("content")
            if not isinstance(content, str):
                raise ValueError("content is required and must be a string.")

            managed = SERVICE.get_library().update_document_content(doc_id, content)
            manifest = _managed_document_to_dict(managed)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "docId": doc_id,
                        "document": _document_summary(manifest, None),
                        "indexStatus": "stale",
                    },
                    "error": None,
                },
            )
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except FileNotFoundError as error:
            _error_response(self, 404, "RAG_DOCUMENT_NOT_FOUND", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DOCUMENT_UPDATE_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DOCUMENT_UPDATE_FAILED", str(error))

    def _handle_delete_document(self, doc_id: str) -> None:
        try:
            library = SERVICE.get_library()
            document = library.get_document(doc_id)
            vector_result = SERVICE.try_delete_document_chunks(doc_id)
            library.delete_document(doc_id)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "docId": doc_id,
                        "fileName": document.get("file_name"),
                        "deleted": True,
                        **vector_result,
                    },
                    "error": None,
                },
            )
        except FileNotFoundError as error:
            _error_response(self, 404, "RAG_DOCUMENT_NOT_FOUND", str(error))
        except ValueError as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DOCUMENT_DELETE_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DOCUMENT_DELETE_FAILED", str(error))

    def _handle_reindex_document(self, doc_id: str) -> None:
        try:
            body = _read_json_body(self)
            config = _chunk_config_from_body(body)
            job = SERVICE.create_reindex_job(doc_id, config)
            _json_response(
                self,
                202,
                {
                    "success": True,
                    "data": {
                        "docId": doc_id,
                        "jobId": job["jobId"],
                        "job": job,
                        "chunkConfig": _chunk_config_to_dict(config),
                    },
                    "error": None,
                },
            )
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except FileNotFoundError as error:
            _error_response(self, 404, "RAG_DOCUMENT_NOT_FOUND", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DOCUMENT_REINDEX_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DOCUMENT_REINDEX_FAILED", str(error))

    def _handle_list_jobs(self) -> None:
        params = _query_params(self)
        limit = _to_positive_int(params.get("limit"), default=50, maximum=200)
        job_type = str(params.get("type") or params.get("jobType") or params.get("job_type") or "").strip() or None
        status = str(params.get("status") or "").strip() or None

        try:
            jobs = SERVICE.get_job_store().list_jobs(limit=limit, job_type=job_type, status=status)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "jobs": jobs,
                        "total": len(jobs),
                        "limit": limit,
                    },
                    "error": None,
                },
            )
        except ValueError as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_JOBS_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_JOBS_FAILED", str(error))

    def _handle_get_job(self, job_id: str) -> None:
        try:
            job = SERVICE.get_job_store().get_job(job_id)
            if job is None:
                _error_response(self, 404, "RAG_JOB_NOT_FOUND", f"Job not found: {job_id}")
                return

            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "job": job,
                    },
                    "error": None,
                },
            )
        except ValueError as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_JOB_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_JOB_FAILED", str(error))

    def _handle_get_document_chunks(self, doc_id: str) -> None:
        try:
            SERVICE.get_library().get_document(doc_id)
            limit = _to_positive_int(_query_params(self).get("limit"), default=100, maximum=1000)
            chunks = SERVICE.get_document_chunks(doc_id, limit=limit)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "docId": doc_id,
                        "chunks": [_chunk_row_to_dict(doc_id, row) for row in chunks],
                        "total": len(chunks),
                        "limit": limit,
                    },
                    "error": None,
                },
            )
        except FileNotFoundError as error:
            _error_response(self, 404, "RAG_DOCUMENT_NOT_FOUND", str(error))
        except ValueError as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DOCUMENT_CHUNKS_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DOCUMENT_CHUNKS_FAILED", str(error))

    def _handle_list_db_sync_jobs(self) -> None:
        try:
            service = SERVICE.get_db_sync_service()
            jobs = [service.to_api_dict(config) for config in service.list_configs()]
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "jobs": jobs,
                        "total": len(jobs),
                    },
                    "error": None,
                },
            )
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DB_SYNC_JOBS_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DB_SYNC_JOBS_FAILED", str(error))

    def _handle_create_db_sync_job(self) -> None:
        try:
            body = _read_json_body(self)
            service = SERVICE.get_db_sync_service()
            config = service.config_from_payload(body)
            saved = service.save_config(config)
            _json_response(
                self,
                201,
                {
                    "success": True,
                    "data": {
                        "syncJobId": saved.id,
                        "job": service.to_api_dict(saved),
                    },
                    "error": None,
                },
            )
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DB_SYNC_CREATE_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DB_SYNC_CREATE_FAILED", str(error))

    def _handle_get_db_sync_job(self, sync_job_id: str) -> None:
        try:
            service = SERVICE.get_db_sync_service()
            config = service.get_config(sync_job_id)
            if config is None:
                _error_response(self, 404, "RAG_DB_SYNC_JOB_NOT_FOUND", f"DB sync job not found: {sync_job_id}")
                return

            limit = _to_positive_int(_query_params(self).get("stateLimit"), default=20, maximum=200)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "job": service.to_api_dict(config),
                        "recentRows": service.state_rows(sync_job_id, limit=limit),
                    },
                    "error": None,
                },
            )
        except ValueError as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DB_SYNC_JOB_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DB_SYNC_JOB_FAILED", str(error))

    def _handle_update_db_sync_job(self, sync_job_id: str) -> None:
        try:
            body = _read_json_body(self)
            service = SERVICE.get_db_sync_service()
            existing = service.get_config(sync_job_id)
            if existing is None:
                _error_response(self, 404, "RAG_DB_SYNC_JOB_NOT_FOUND", f"DB sync job not found: {sync_job_id}")
                return

            config = service.config_from_payload(body, existing=existing)
            config.id = sync_job_id
            saved = service.save_config(config)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "syncJobId": saved.id,
                        "job": service.to_api_dict(saved),
                    },
                    "error": None,
                },
            )
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DB_SYNC_UPDATE_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DB_SYNC_UPDATE_FAILED", str(error))

    def _handle_delete_db_sync_job(self, sync_job_id: str) -> None:
        try:
            service = SERVICE.get_db_sync_service()
            if service.get_config(sync_job_id) is None:
                _error_response(self, 404, "RAG_DB_SYNC_JOB_NOT_FOUND", f"DB sync job not found: {sync_job_id}")
                return

            service.delete_config(sync_job_id)
            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "syncJobId": sync_job_id,
                        "deleted": True,
                    },
                    "error": None,
                },
            )
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DB_SYNC_DELETE_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DB_SYNC_DELETE_FAILED", str(error))

    def _handle_run_db_sync_job(self, sync_job_id: str) -> None:
        try:
            body = _read_json_body(self)
            if body.get("resetWatermark") or body.get("reset_watermark"):
                SERVICE.get_db_sync_service().reset_watermark(sync_job_id)
            job = SERVICE.create_db_sync_execution_job(sync_job_id)
            _json_response(
                self,
                202,
                {
                    "success": True,
                    "data": {
                        "syncJobId": sync_job_id,
                        "jobId": job["jobId"],
                        "job": job,
                    },
                    "error": None,
                },
            )
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except FileNotFoundError as error:
            _error_response(self, 404, "RAG_DB_SYNC_JOB_NOT_FOUND", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DB_SYNC_RUN_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DB_SYNC_RUN_FAILED", str(error))

    def _handle_inspect_db_sync_columns(self, sync_job_id: str) -> None:
        try:
            service = SERVICE.get_db_sync_service()
            config = service.get_config(sync_job_id)
            if config is None:
                _error_response(self, 404, "RAG_DB_SYNC_JOB_NOT_FOUND", f"DB sync job not found: {sync_job_id}")
                return

            _json_response(
                self,
                200,
                {
                    "success": True,
                    "data": {
                        "syncJobId": sync_job_id,
                        "columns": service.inspect_columns(config),
                    },
                    "error": None,
                },
            )
        except ValueError as error:
            _error_response(self, 400, "INVALID_REQUEST", str(error))
        except RAGServiceError as error:
            _error_response(self, 500, "RAG_DB_SYNC_INSPECT_COLUMNS_FAILED", error.message, {"reason": error.code})
        except Exception as error:
            _error_response(self, 500, "RAG_DB_SYNC_INSPECT_COLUMNS_FAILED", str(error))


def _match_job_detail_path(handler: BaseHTTPRequestHandler) -> str | None:
    match = re.fullmatch(r"/internal/rag/jobs/([^/]+)", _request_path(handler))
    if not match:
        return None
    return unquote(match.group(1))


def _match_db_sync_action_path(handler: BaseHTTPRequestHandler, action: str) -> str | None:
    match = re.fullmatch(rf"/internal/rag/db-sync/jobs/([^/]+)/{re.escape(action)}", _request_path(handler))
    if not match:
        return None
    return unquote(match.group(1))


def _match_db_sync_detail_path(handler: BaseHTTPRequestHandler) -> str | None:
    match = re.fullmatch(r"/internal/rag/db-sync/jobs/([^/]+)", _request_path(handler))
    if not match:
        return None
    return unquote(match.group(1))


def _match_document_action_path(handler: BaseHTTPRequestHandler, action: str) -> str | None:
    match = re.fullmatch(rf"/internal/rag/documents/([^/]+)/{re.escape(action)}", _request_path(handler))
    if not match:
        return None
    return unquote(match.group(1))


def _match_document_detail_path(handler: BaseHTTPRequestHandler) -> str | None:
    match = re.fullmatch(r"/internal/rag/documents/([^/]+)", _request_path(handler))
    if not match:
        return None
    return unquote(match.group(1))


def _safe_file_name(file_name: str) -> str:
    if not file_name:
        raise ValueError("fileName is required.")

    name = Path(file_name).name.strip()
    name = re.sub(r"[\x00-\x1f/\\]+", "_", name)
    if not name or name in {".", ".."}:
        raise ValueError("fileName is invalid.")

    suffix = Path(name).suffix.lower()
    if suffix not in SUPPORTED_UPLOAD_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix or 'missing'}")
    return name


def _display_name(file_name: str) -> str:
    return re.sub(r"^[0-9a-f]{12}_", "", file_name, count=1)


def _decode_upload_content(body: dict[str, Any]) -> bytes:
    content_base64 = body.get("contentBase64", body.get("content_base64"))
    if isinstance(content_base64, str) and content_base64.strip():
        return base64.b64decode(content_base64, validate=True)

    content = body.get("content")
    if isinstance(content, str):
        return content.encode("utf-8")

    raise ValueError("contentBase64 or content is required.")


def _write_upload_file(file_name: str, raw_bytes: bytes) -> Path:
    if not raw_bytes:
        raise ValueError("Uploaded content is empty.")

    upload_dir = _upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(raw_bytes).hexdigest()
    upload_path = upload_dir / f"{digest[:12]}_{file_name}"
    upload_path.write_bytes(raw_bytes)
    return upload_path


def _managed_document_to_dict(document: Any) -> dict[str, Any]:
    return {
        "doc_id": document.doc_id,
        "file_name": document.file_name,
        "source_type": document.source_type,
        "original_upload_path": document.original_upload_path,
        "content_path": document.content_path,
        "parse_mode": document.parse_mode,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
        "char_count": document.char_count,
        "block_count": document.block_count,
        "edited": document.edited,
    }


def _document_summary(manifest: dict[str, Any], index_summary: dict[str, Any] | None) -> dict[str, Any]:
    doc_id = manifest["doc_id"]
    indexed_chunk_count = int(index_summary.get("chunk_count", 0)) if index_summary else 0
    index_status = _index_status(manifest, index_summary)
    edited = bool(manifest.get("edited"))

    return {
        "docId": doc_id,
        "doc_id": doc_id,
        "fileName": manifest.get("file_name", ""),
        "file_name": manifest.get("file_name", ""),
        "sourceType": manifest.get("source_type", ""),
        "source_type": manifest.get("source_type", ""),
        "originalUploadPath": manifest.get("original_upload_path", ""),
        "contentPath": manifest.get("content_path", ""),
        "parseMode": manifest.get("parse_mode", "markdown"),
        "createdAt": manifest.get("created_at", ""),
        "updatedAt": manifest.get("updated_at", ""),
        "charCount": int(manifest.get("char_count", 0)),
        "blockCount": int(manifest.get("block_count", 0)),
        "chunkCount": indexed_chunk_count,
        "indexStatus": index_status,
        "edited": edited,
    }


def _index_status(manifest: dict[str, Any], index_summary: dict[str, Any] | None) -> str:
    if not index_summary or int(index_summary.get("chunk_count", 0)) <= 0:
        return "not_indexed"

    indexed_at = str(index_summary.get("uploaded_at") or "")
    updated_at = str(manifest.get("updated_at") or "")
    if bool(manifest.get("edited")) and indexed_at < updated_at:
        return "stale"
    return "indexed"


def _chunk_config_from_body(body: dict[str, Any]) -> Any:
    try:
        from rag_mvp.semantic_chunker import SemanticChunkConfig
    except ModuleNotFoundError as error:
        missing_name = getattr(error, "name", "") or str(error)
        raise RAGServiceError(
            "RAG_DEPENDENCY_MISSING",
            f"Python dependency is missing: {missing_name}. Run `python -m pip install -r rag-service/requirements.txt`.",
        ) from error

    defaults = SemanticChunkConfig()
    config = SemanticChunkConfig(
        min_chars=_optional_positive_int(
            body.get("minChars", body.get("min_chars")),
            default=defaults.min_chars,
            maximum=50000,
            field_name="minChars",
        ),
        max_chars=_optional_positive_int(
            body.get("maxChars", body.get("max_chars")),
            default=defaults.max_chars,
            maximum=100000,
            field_name="maxChars",
        ),
        overlap_chars=_optional_non_negative_int(
            body.get("overlapChars", body.get("overlap_chars")),
            default=defaults.overlap_chars,
            maximum=50000,
            field_name="overlapChars",
        ),
        similarity_threshold=_optional_float(
            body.get("similarityThreshold", body.get("similarity_threshold")),
            default=defaults.similarity_threshold,
            field_name="similarityThreshold",
        ),
    )
    config.validate()
    return config


def _optional_positive_int(value: Any, default: int, maximum: int, field_name: str) -> int:
    if value is None or value == "":
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field_name} must be an integer.") from error
    if parsed <= 0:
        raise ValueError(f"{field_name} must be positive.")
    return min(parsed, maximum)


def _optional_non_negative_int(value: Any, default: int, maximum: int, field_name: str) -> int:
    if value is None or value == "":
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field_name} must be an integer.") from error
    if parsed < 0:
        raise ValueError(f"{field_name} must be non-negative.")
    return min(parsed, maximum)


def _optional_float(value: Any, default: float, field_name: str) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field_name} must be a number.") from error


def _chunk_config_to_dict(config: Any) -> dict[str, Any]:
    return {
        "minChars": config.min_chars,
        "maxChars": config.max_chars,
        "overlapChars": config.overlap_chars,
        "similarityThreshold": config.similarity_threshold,
    }


def _chunk_row_to_dict(doc_id: str, row: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(row.get("metadata") or {})
    text = str(row.get("text") or "")
    chunk_index = _metadata_int(metadata, "chunk_index", default=int(row.get("index", 0) or 0))
    char_count = _metadata_int(metadata, "char_count", default=len(text))
    chunk_id = str(row.get("chunk_id") or row.get("id") or f"{doc_id}:{chunk_index}")
    return {
        "chunkId": chunk_id,
        "chunk_id": chunk_id,
        "chunkIndex": chunk_index,
        "chunk_index": chunk_index,
        "text": text,
        "metadata": metadata,
        "charCount": char_count,
        "char_count": char_count,
    }


def _metadata_int(metadata: dict[str, Any], key: str, default: int) -> int:
    try:
        return int(metadata.get(key, default))
    except (TypeError, ValueError):
        return default


def main() -> None:
    host = os.getenv("RAG_SEARCH_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.getenv("RAG_SEARCH_PORT", "19104"))
    server = ThreadingHTTPServer((host, port), RAGSearchHandler)
    print(f"Local RAG search server listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
