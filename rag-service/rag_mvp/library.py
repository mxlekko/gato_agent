from __future__ import annotations

import hashlib
import json
import re
import shutil
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from rag_mvp.parsers import (
    SUPPORTED_EXTENSIONS,
    ParsedDocument,
    blocks_to_editable_text,
    parse_document,
    parse_text_content,
)


@dataclass
class ManagedDocument:
    doc_id: str
    file_name: str
    source_type: str
    original_upload_path: str
    content_path: str
    parse_mode: str
    created_at: str
    updated_at: str
    char_count: int
    block_count: int
    edited: bool


class DocumentLibrary:
    def __init__(self, root_dir: str) -> None:
        self.root = Path(root_dir)
        self.root.mkdir(parents=True, exist_ok=True)

    def bootstrap_from_upload_dir(self, upload_dir: str) -> None:
        uploads = Path(upload_dir)
        if not uploads.exists():
            return

        for path in sorted(uploads.iterdir()):
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            doc_id = _sha256_file(path)
            if self._manifest_path(doc_id).exists():
                continue
            parsed = parse_document(str(path), doc_id=doc_id)
            parsed = _rename_document(parsed, _display_name(path.name))
            self.save_uploaded_document(parsed, original_upload_path=str(path.resolve()))

    def save_uploaded_document(self, document: ParsedDocument, original_upload_path: str) -> ManagedDocument:
        editable_text = blocks_to_editable_text(document.blocks)
        return self._write_document(
            doc_id=document.doc_id,
            file_name=document.file_name,
            source_type=document.source_type,
            original_upload_path=original_upload_path,
            content=editable_text,
            parse_mode="markdown",
            edited=False,
        )

    def import_file(self, file_path: str, display_name: str | None = None) -> ManagedDocument:
        path = Path(file_path)
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"Upload file not found: {file_path}")

        doc_id = _sha256_file(path)
        parsed = parse_document(str(path), doc_id=doc_id)
        parsed = _rename_document(parsed, display_name or _display_name(path.name))
        return self.save_uploaded_document(parsed, original_upload_path=str(path.resolve()))

    def update_document_content(self, doc_id: str, content: str) -> ManagedDocument:
        manifest = self._read_manifest(doc_id)
        return self._write_document(
            doc_id=doc_id,
            file_name=manifest["file_name"],
            source_type=manifest["source_type"],
            original_upload_path=manifest["original_upload_path"],
            content=content,
            parse_mode=manifest.get("parse_mode", "markdown"),
            created_at=manifest["created_at"],
            edited=True,
        )

    def restore_original_content(self, doc_id: str) -> ManagedDocument:
        manifest = self._read_manifest(doc_id)
        parsed = parse_document(manifest["original_upload_path"], doc_id=doc_id)
        parsed = _rename_document(parsed, manifest["file_name"])
        editable_text = blocks_to_editable_text(parsed.blocks)
        return self._write_document(
            doc_id=doc_id,
            file_name=manifest["file_name"],
            source_type=manifest["source_type"],
            original_upload_path=manifest["original_upload_path"],
            content=editable_text,
            parse_mode=manifest.get("parse_mode", "markdown"),
            created_at=manifest["created_at"],
            edited=False,
        )

    def build_parsed_document(self, doc_id: str) -> ParsedDocument:
        manifest = self._read_manifest(doc_id)
        content = self._content_path(doc_id).read_text(encoding="utf-8")
        return parse_text_content(
            text=content,
            doc_id=doc_id,
            file_name=manifest["file_name"],
            file_path=manifest["original_upload_path"],
            source_type=manifest["source_type"],
            parse_mode=manifest.get("parse_mode", "markdown"),
        )

    def get_document(self, doc_id: str) -> dict[str, Any]:
        manifest = self._read_manifest(doc_id)
        content = self._content_path(doc_id).read_text(encoding="utf-8")
        return {**manifest, "content": content}

    def list_documents(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for manifest_path in sorted(self.root.glob("*/manifest.json")):
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            items.append(manifest)
        return sorted(items, key=lambda item: item["updated_at"], reverse=True)

    def delete_document(self, doc_id: str, remove_original_upload: bool = True) -> None:
        manifest = self._read_manifest(doc_id)
        doc_dir = (self.root / doc_id).resolve()
        root_resolved = self.root.resolve()
        if root_resolved not in doc_dir.parents:
            raise ValueError("Refusing to delete outside library root.")

        if remove_original_upload:
            original_path = Path(manifest["original_upload_path"]).resolve()
            if original_path.exists():
                original_path.unlink()

        if doc_dir.exists():
            shutil.rmtree(doc_dir)

    def _write_document(
        self,
        doc_id: str,
        file_name: str,
        source_type: str,
        original_upload_path: str,
        content: str,
        parse_mode: str,
        edited: bool,
        created_at: str | None = None,
    ) -> ManagedDocument:
        now = datetime.now().isoformat(timespec="seconds")
        parsed = parse_text_content(
            text=content,
            doc_id=doc_id,
            file_name=file_name,
            file_path=original_upload_path,
            source_type=source_type,
            parse_mode=parse_mode,
        )

        doc_dir = self.root / doc_id
        doc_dir.mkdir(parents=True, exist_ok=True)
        content_path = doc_dir / "content.md"
        content_path.write_text(content.strip(), encoding="utf-8")

        managed = ManagedDocument(
            doc_id=doc_id,
            file_name=file_name,
            source_type=source_type,
            original_upload_path=original_upload_path,
            content_path=str(content_path.resolve()),
            parse_mode=parse_mode,
            created_at=created_at or now,
            updated_at=now,
            char_count=len(content.strip()),
            block_count=len(parsed.blocks),
            edited=edited,
        )

        self._manifest_path(doc_id).write_text(
            json.dumps(asdict(managed), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return managed

    def _read_manifest(self, doc_id: str) -> dict[str, Any]:
        path = self._manifest_path(doc_id)
        if not path.exists():
            raise FileNotFoundError(f"Document manifest not found for {doc_id}")
        return json.loads(path.read_text(encoding="utf-8"))

    def _manifest_path(self, doc_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{64}", doc_id):
            raise ValueError("Invalid document id.")
        return self.root / doc_id / "manifest.json"

    def _content_path(self, doc_id: str) -> Path:
        return self.root / doc_id / "content.md"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _display_name(file_name: str) -> str:
    return re.sub(r"^[0-9a-f]{12}_", "", file_name, count=1)


def _rename_document(document: ParsedDocument, file_name: str) -> ParsedDocument:
    return ParsedDocument(
        doc_id=document.doc_id,
        file_name=file_name,
        file_path=document.file_path,
        source_type=document.source_type,
        blocks=document.blocks,
    )
