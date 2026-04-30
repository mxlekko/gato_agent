from __future__ import annotations

import base64
import mimetypes
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from docx import Document
from docx.document import Document as DocxDocument
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph


SUPPORTED_EXTENSIONS = {".docx", ".md", ".txt", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}


@dataclass
class ParsedBlock:
    index: int
    text: str
    block_type: str
    char_count: int
    level: int | None = None


@dataclass
class ParsedDocument:
    doc_id: str
    file_name: str
    file_path: str
    source_type: str
    blocks: list[ParsedBlock]

    @property
    def text(self) -> str:
        return "\n\n".join(block.text for block in self.blocks)


def parse_document(file_path: str, doc_id: str) -> ParsedDocument:
    path = Path(file_path)
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix}")

    if suffix == ".docx":
        blocks = _read_docx_blocks(path)
    elif suffix == ".md":
        blocks = _read_markdown_blocks(path.read_text(encoding="utf-8", errors="ignore"))
    elif suffix == ".pdf":
        blocks = _read_pdf_blocks(path)
    elif suffix in _IMAGE_EXTENSIONS:
        blocks = _read_image_blocks(path)
    else:
        blocks = _read_text_blocks(path.read_text(encoding="utf-8", errors="ignore"))

    normalized_blocks = _normalize_blocks(blocks)
    if not normalized_blocks:
        raise ValueError(f"{path.name} does not contain readable text.")

    return ParsedDocument(
        doc_id=doc_id,
        file_name=path.name,
        file_path=str(path.resolve()),
        source_type=suffix.lstrip("."),
        blocks=normalized_blocks,
    )


def parse_text_content(
    text: str,
    doc_id: str,
    file_name: str,
    file_path: str,
    source_type: str,
    parse_mode: str = "markdown",
) -> ParsedDocument:
    if parse_mode == "markdown":
        blocks = _read_markdown_blocks(text)
    elif parse_mode == "text":
        blocks = _read_text_blocks(text)
    else:
        raise ValueError(f"Unsupported parse mode: {parse_mode}")

    normalized_blocks = _normalize_blocks(blocks)
    if not normalized_blocks:
        raise ValueError(f"{file_name} does not contain readable text.")

    return ParsedDocument(
        doc_id=doc_id,
        file_name=file_name,
        file_path=file_path,
        source_type=source_type,
        blocks=normalized_blocks,
    )


def blocks_to_editable_text(blocks: list[ParsedBlock]) -> str:
    rendered: list[str] = []
    for block in blocks:
        if block.block_type == "heading":
            level = min(max(block.level or 1, 1), 6)
            rendered.append(f"{'#' * level} {block.text}")
        elif block.block_type == "list":
            lines = [line.strip() for line in block.text.splitlines() if line.strip()]
            rendered.append("\n".join(_normalize_list_line(line) for line in lines))
        else:
            rendered.append(block.text)
    return "\n\n".join(rendered).strip()


def _read_markdown_blocks(text: str) -> list[ParsedBlock]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[ParsedBlock] = []
    buffer: list[str] = []
    buffer_type = "paragraph"
    in_code_block = False

    def flush_buffer() -> None:
        nonlocal buffer, buffer_type
        if not buffer:
            return
        _append_block(blocks, "\n".join(buffer), buffer_type)
        buffer = []
        buffer_type = "paragraph"

    for raw_line in lines:
        line = raw_line.rstrip()
        stripped = line.strip()

        if stripped.startswith("```") or stripped.startswith("~~~"):
            if in_code_block:
                buffer.append(line)
                flush_buffer()
                in_code_block = False
            else:
                flush_buffer()
                buffer_type = "code"
                buffer.append(line)
                in_code_block = True
            continue

        if in_code_block:
            buffer.append(line)
            continue

        if not stripped:
            flush_buffer()
            continue

        heading_match = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading_match:
            flush_buffer()
            level = len(heading_match.group(1))
            _append_block(blocks, heading_match.group(2), "heading", level=level)
            continue

        if re.match(r"^(\s*[-*+]\s+|\s*\d+\.\s+)", stripped):
            if buffer and buffer_type != "list":
                flush_buffer()
            buffer_type = "list"
            buffer.append(stripped)
            continue

        if stripped.startswith("|") and stripped.count("|") >= 2:
            if buffer and buffer_type != "table":
                flush_buffer()
            buffer_type = "table"
            buffer.append(stripped)
            continue

        if buffer and buffer_type != "paragraph":
            flush_buffer()
        buffer_type = "paragraph"
        buffer.append(stripped)

    flush_buffer()
    return blocks


def _read_text_blocks(text: str) -> list[ParsedBlock]:
    segments = [segment.strip() for segment in re.split(r"\n\s*\n", text.replace("\r\n", "\n").replace("\r", "\n"))]
    blocks: list[ParsedBlock] = []
    for segment in segments:
        if segment:
            _append_block(blocks, segment, "paragraph")
    return blocks


def _read_docx_blocks(path: Path) -> list[ParsedBlock]:
    document = Document(str(path))
    blocks: list[ParsedBlock] = []

    for item in _iter_docx_items(document):
        if isinstance(item, Paragraph):
            text = item.text.strip()
            if not text:
                continue
            style_name = item.style.name if item.style is not None else ""
            heading_match = re.search(r"Heading\s+(\d+)", style_name, re.IGNORECASE)
            if heading_match:
                _append_block(blocks, text, "heading", level=int(heading_match.group(1)))
            elif style_name.lower().startswith("list"):
                _append_block(blocks, text, "list")
            else:
                _append_block(blocks, text, "paragraph")
        elif isinstance(item, Table):
            rows: list[str] = []
            for row in item.rows:
                cells = [" ".join(cell.text.split()) for cell in row.cells if cell.text.strip()]
                if cells:
                    rows.append(" | ".join(cells))
            if rows:
                _append_block(blocks, "\n".join(rows), "table")

    return blocks


def _iter_docx_items(parent: DocxDocument | _Cell) -> Iterator[Paragraph | Table]:
    if isinstance(parent, DocxDocument):
        parent_element = parent.element.body
    else:
        parent_element = parent._tc

    for child in parent_element.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, parent)
        elif isinstance(child, CT_Tbl):
            yield Table(child, parent)


def _normalize_blocks(blocks: list[ParsedBlock]) -> list[ParsedBlock]:
    normalized: list[ParsedBlock] = []
    for block in blocks:
        text = _normalize_text(block.text)
        if not text:
            continue
        normalized.append(
            ParsedBlock(
                index=len(normalized),
                text=text,
                block_type=block.block_type,
                char_count=len(text),
                level=block.level,
            )
        )
    return normalized


def _append_block(
    blocks: list[ParsedBlock],
    text: str,
    block_type: str,
    level: int | None = None,
) -> None:
    normalized = _normalize_text(text)
    if not normalized:
        return
    blocks.append(
        ParsedBlock(
            index=len(blocks),
            text=normalized,
            block_type=block_type,
            char_count=len(normalized),
            level=level,
        )
    )


def _normalize_text(text: str) -> str:
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    cleaned: list[str] = []
    previous_blank = False
    for line in lines:
        stripped = " ".join(line.split())
        is_blank = not stripped
        if is_blank:
            if not previous_blank:
                cleaned.append("")
            previous_blank = True
            continue
        cleaned.append(stripped)
        previous_blank = False
    return "\n".join(cleaned).strip()


def _normalize_list_line(line: str) -> str:
    if re.match(r"^([-*+]\s+|\d+\.\s+)", line):
        return line
    return f"- {line}"


_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}


def _read_pdf_blocks(path: Path) -> list[ParsedBlock]:
    import fitz  # pymupdf

    blocks: list[ParsedBlock] = []
    try:
        doc = fitz.open(str(path))
    except Exception as exc:
        raise ValueError(f"Failed to open PDF {path.name}: {exc}") from exc

    for page_index in range(len(doc)):
        page = doc.load_page(page_index)
        text_blocks = page.get_text("blocks")
        for block in text_blocks:
            block_text = " ".join(block[4].split()) if len(block) >= 5 else str(block).strip()
            if block_text:
                _append_block(blocks, block_text, "paragraph")
    doc.close()
    if not blocks:
        raise ValueError(f"{path.name}: 此 PDF 未检测到可选中的文字（可能是扫描件或纯图片 PDF）。")
    return blocks


def _read_image_blocks(path: Path) -> list[ParsedBlock]:
    try:
        from PIL import Image as PILImage
    except ImportError:
        raise ImportError("Pillow is required for image parsing. Install it with: pip install Pillow")

    # Validate the image can be opened
    try:
        img = PILImage.open(str(path))
        img.verify()
    except Exception as exc:
        raise ValueError(f"{path.name} is not a readable image: {exc}") from exc

    description = _describe_image(path)
    if not description.strip():
        raise ValueError(f"{path.name}: 视觉模型未能生成有效描述。")

    blocks: list[ParsedBlock] = []
    _append_block(blocks, description, "paragraph")
    return blocks


def _describe_image(image_path: Path) -> str:
    api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not api_key or api_key == "your_dashscope_api_key_here":
        raise ValueError("DashScope API Key 未配置，无法对图片进行视觉识别。请在 .env 中设置 DASHSCOPE_API_KEY。")

    vision_model = os.environ.get("VISION_MODEL", "qwen-vl-plus").strip()

    # Read and encode image
    with open(image_path, "rb") as fh:
        image_data = base64.b64encode(fh.read()).decode("ascii")

    mime_type = mimetypes.guess_type(str(image_path))[0] or "image/png"
    data_uri = f"data:{mime_type};base64,{image_data}"

    try:
        from openai import OpenAI
    except ImportError:
        raise ImportError("openai is required for vision API calls.")

    client = OpenAI(
        api_key=api_key,
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    )

    prompt = (
        "请详细描述这张图片的内容，包括所有文字信息、图表数据、对象、场景、人物、动作、颜色、布局等可见要素。"
        "如果图片包含文字，请完整转写。如果是图表，请描述数据趋势和关键数字。"
    )

    try:
        response = client.chat.completions.create(
            model=vision_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_uri}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            max_tokens=1024,
        )
    except Exception as exc:
        error_msg = str(exc)
        if "AccessDenied" in error_msg or "Unpurchased" in error_msg:
            raise ValueError(
                f"当前 API Key 没有 {vision_model} 模型的调用权限。请在百炼开通该模型。\n"
                f"原始错误: {error_msg}"
            ) from exc
        raise ValueError(f"视觉模型调用失败: {error_msg}") from exc

    content = response.choices[0].message.content
    return content.strip() if content else ""
