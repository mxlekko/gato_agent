from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import chromadb

from rag_mvp.embeddings import DashScopeEmbedder
from rag_mvp.parsers import ParsedDocument
from rag_mvp.semantic_chunker import SemanticChunkConfig, TextChunk, semantic_chunk_document


class LocalRAGStore:
    def __init__(
        self,
        persist_directory: str,
        api_key: str,
        collection_name: str = "local_rag_mvp",
        embedding_model: str = "text-embedding-v4",
    ) -> None:
        Path(persist_directory).mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=persist_directory)
        self.collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )
        self.embedder = DashScopeEmbedder(api_key=api_key, model=embedding_model)

    def chunk_document(
        self,
        document: ParsedDocument,
        config: SemanticChunkConfig,
    ) -> list[TextChunk]:
        return semantic_chunk_document(document=document, embedder=self.embedder, config=config)

    def upsert_document(self, document: ParsedDocument, chunks: list[TextChunk]) -> dict[str, Any]:
        existing = self.collection.get(where={"doc_id": document.doc_id}, include=[])
        if existing["ids"]:
            self.collection.delete(ids=existing["ids"])

        texts = [chunk.text for chunk in chunks]
        embeddings = self.embedder.embed_documents(texts)
        timestamp = datetime.now().isoformat(timespec="seconds")

        metadatas = [
            {
                "doc_id": document.doc_id,
                "file_name": document.file_name,
                "file_path": document.file_path,
                "source_type": document.source_type,
                "chunk_index": chunk.index,
                "char_count": chunk.char_count,
                "unit_count": chunk.unit_count,
                "start_block_index": chunk.start_block_index,
                "end_block_index": chunk.end_block_index,
                "chunk_strategy": chunk.strategy,
                "uploaded_at": timestamp,
            }
            for chunk in chunks
        ]
        ids = [chunk.chunk_id for chunk in chunks]
        self.collection.upsert(
            ids=ids,
            documents=texts,
            embeddings=embeddings,
            metadatas=metadatas,
        )
        return {
            "file_name": document.file_name,
            "doc_id": document.doc_id,
            "block_count": len(document.blocks),
            "chunk_count": len(chunks),
            "char_count": sum(chunk.char_count for chunk in chunks),
        }

    def upsert_text_records(self, records: list[dict[str, Any]]) -> dict[str, Any]:
        if not records:
            return {"record_count": 0}

        ids = [str(record["id"]) for record in records]
        texts = [str(record["text"]) for record in records]
        embeddings = self.embedder.embed_documents(texts)
        timestamp = datetime.now().isoformat(timespec="seconds")
        metadatas = []
        for record_id, text, record in zip(ids, texts, records):
            metadata = _normalize_metadata(dict(record.get("metadata", {})))
            metadatas.append(
                {
                    "doc_id": record_id,
                    "file_name": metadata.pop("file_name", record_id),
                    "file_path": metadata.pop("file_path", metadata.get("source_table", "")),
                    "source_type": metadata.pop("source_type", "db"),
                    "chunk_index": 0,
                    "char_count": len(text),
                    "unit_count": 1,
                    "start_block_index": 0,
                    "end_block_index": 0,
                    "chunk_strategy": "db-row",
                    "uploaded_at": timestamp,
                    **metadata,
                }
            )

        self.collection.upsert(
            ids=ids,
            documents=texts,
            embeddings=embeddings,
            metadatas=metadatas,
        )
        return {"record_count": len(records)}

    def get_text_record(self, record_id: str) -> dict[str, Any] | None:
        payload = self.collection.get(ids=[record_id], include=["documents", "metadatas"])
        ids = payload.get("ids", [])
        if not ids:
            return None
        documents = payload.get("documents", [])
        metadatas = payload.get("metadatas", [])
        return {
            "id": ids[0],
            "text": documents[0] if documents else "",
            "metadata": metadatas[0] if metadatas else {},
        }

    def search(self, query: str, top_k: int = 5, doc_id: str | None = None) -> list[dict[str, Any]]:
        query_embedding = self.embedder.embed_query(query)
        query_kwargs: dict[str, Any] = {
            "query_embeddings": [query_embedding],
            "n_results": top_k,
            "include": ["documents", "metadatas", "distances"],
        }
        if doc_id:
            query_kwargs["where"] = {"doc_id": doc_id}
        results = self.collection.query(**query_kwargs)
        documents = results.get("documents", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        formatted: list[dict[str, Any]] = []
        for document, metadata, distance in zip(documents, metadatas, distances):
            formatted.append(
                {
                    "text": document,
                    "metadata": metadata,
                    "distance": float(distance),
                    "score": round(1 - float(distance), 4),
                }
            )
        return formatted

    def get_document_summary(self, doc_id: str) -> dict[str, Any] | None:
        payload = self.collection.get(where={"doc_id": doc_id}, include=["metadatas"], limit=self.collection.count() or 1)
        metadatas = payload.get("metadatas", [])
        if not metadatas:
            return None

        return {
            "doc_id": doc_id,
            "file_name": metadatas[0]["file_name"],
            "chunk_count": len(metadatas),
            "char_count": sum(int(item["char_count"]) for item in metadatas),
            "uploaded_at": max(item["uploaded_at"] for item in metadatas),
            "strategy": metadatas[0].get("chunk_strategy", "semantic"),
        }

    def get_document_chunks(self, doc_id: str, limit: int | None = None) -> list[dict[str, Any]]:
        payload = self.collection.get(where={"doc_id": doc_id}, include=["documents", "metadatas"])
        ids = payload.get("ids", [])
        documents = payload.get("documents", [])
        metadatas = payload.get("metadatas", [])
        rows = [
            {
                "chunk_id": chunk_id,
                "text": document,
                "metadata": metadata,
            }
            for chunk_id, document, metadata in zip(ids, documents, metadatas)
        ]
        rows.sort(key=lambda item: int(item["metadata"].get("chunk_index", 0)))
        return rows if limit is None else rows[:limit]

    def delete_document(self, doc_id: str) -> int:
        payload = self.collection.get(where={"doc_id": doc_id}, include=[])
        ids = payload.get("ids", [])
        if ids:
            self.collection.delete(ids=ids)
        return len(ids)

    def list_documents(self) -> list[dict[str, Any]]:
        total = self.collection.count()
        if total == 0:
            return []

        payload = self.collection.get(include=["metadatas"], limit=total)
        grouped: dict[str, dict[str, Any]] = {}
        for metadata in payload.get("metadatas", []):
            doc_id = metadata["doc_id"]
            if doc_id not in grouped:
                grouped[doc_id] = {
                    "doc_id": doc_id,
                    "file_name": metadata["file_name"],
                    "source_type": metadata["source_type"],
                    "file_path": metadata["file_path"],
                    "block_count": 0,
                    "chunk_count": 0,
                    "char_count": 0,
                    "strategy": metadata.get("chunk_strategy", "semantic"),
                    "uploaded_at": metadata["uploaded_at"],
                }
            grouped[doc_id]["chunk_count"] += 1
            grouped[doc_id]["char_count"] += int(metadata["char_count"])
            grouped[doc_id]["block_count"] = max(
                grouped[doc_id]["block_count"],
                int(metadata.get("end_block_index", metadata.get("chunk_index", 0))) + 1,
            )
            grouped[doc_id]["uploaded_at"] = max(grouped[doc_id]["uploaded_at"], metadata["uploaded_at"])
        return sorted(grouped.values(), key=lambda item: item["uploaded_at"], reverse=True)

    def chunk_count(self) -> int:
        return self.collection.count()


def _normalize_metadata(metadata: dict[str, Any]) -> dict[str, str | int | float | bool]:
    normalized: dict[str, str | int | float | bool] = {}
    for key, value in metadata.items():
        if isinstance(value, (bool, int, float, str)):
            normalized[str(key)] = value
        elif value is not None:
            normalized[str(key)] = str(value)
    return normalized
