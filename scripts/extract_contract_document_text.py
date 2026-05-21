#!/usr/bin/env python3
import base64
import io
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import PurePosixPath
from pathlib import Path
from xml.etree import ElementTree as ET


IMAGE_EXTENSIONS = {".bmp", ".jpg", ".jpeg", ".png", ".tif", ".tiff"}
TEXTUTIL_EXTENSIONS = {".doc", ".wps"}
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | TEXTUTIL_EXTENSIONS | {".docx", ".pdf", ".ofd", ".xlsx"}
DEFAULT_MAX_CHARS = 30000
DEFAULT_SUBPROCESS_TIMEOUT = 25


def local_name(tag):
    return str(tag).rsplit("}", 1)[-1]


def normalize_text(value):
    lines = []
    previous_blank = False
    for raw_line in str(value or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = " ".join(raw_line.strip().split())
        if not line:
            if not previous_blank:
                lines.append("")
            previous_blank = True
            continue
        lines.append(line)
        previous_blank = False
    return "\n".join(lines).strip()


def append_block(blocks, text):
    normalized = normalize_text(text)
    if normalized:
        blocks.append(normalized)


def read_zip_xml(zf, name):
    return ET.fromstring(zf.read(name))


def read_docx(data):
    blocks = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        if "word/document.xml" not in zf.namelist():
            raise ValueError("DOCX document.xml is missing.")
        root = read_zip_xml(zf, "word/document.xml")
        body = next((child for child in root if local_name(child.tag) == "body"), root)

        for child in body:
            child_type = local_name(child.tag)
            if child_type == "p":
                text = "".join(node.text or "" for node in child.iter() if local_name(node.tag) == "t")
                append_block(blocks, text)
            elif child_type == "tbl":
                rows = []
                for row in child.iter():
                    if local_name(row.tag) != "tr":
                        continue
                    cells = []
                    for cell in row:
                        if local_name(cell.tag) != "tc":
                            continue
                        cell_text = "".join(node.text or "" for node in cell.iter() if local_name(node.tag) == "t")
                        if normalize_text(cell_text):
                            cells.append(normalize_text(cell_text))
                    if cells:
                        rows.append(" | ".join(cells))
                if rows:
                    append_block(blocks, "\n".join(rows))
    return blocks


def read_shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = read_zip_xml(zf, "xl/sharedStrings.xml")
    values = []
    for si in root:
        if local_name(si.tag) != "si":
            continue
        text = "".join(node.text or "" for node in si.iter() if local_name(node.tag) == "t")
        values.append(normalize_text(text))
    return values


def read_workbook_sheets(zf):
    names = set(zf.namelist())
    if "xl/workbook.xml" not in names:
        return []

    rel_targets = {}
    if "xl/_rels/workbook.xml.rels" in names:
        rel_root = read_zip_xml(zf, "xl/_rels/workbook.xml.rels")
        for rel in rel_root:
            rel_id = rel.attrib.get("Id")
            target = rel.attrib.get("Target")
            if rel_id and target:
                rel_targets[rel_id] = str(PurePosixPath("xl") / target)

    workbook_root = read_zip_xml(zf, "xl/workbook.xml")
    sheets = []
    for sheet in workbook_root.iter():
        if local_name(sheet.tag) != "sheet":
            continue
        name = sheet.attrib.get("name") or f"Sheet{len(sheets) + 1}"
        rel_id = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        target = rel_targets.get(rel_id)
        if target and target in names:
            sheets.append((name, target))

    if sheets:
        return sheets

    worksheet_files = sorted(name for name in names if re.match(r"^xl/worksheets/sheet\d+\.xml$", name))
    return [(f"Sheet{index + 1}", name) for index, name in enumerate(worksheet_files)]


def read_xlsx_cell_text(cell, shared_strings):
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return normalize_text("".join(node.text or "" for node in cell.iter() if local_name(node.tag) == "t"))

    value_node = next((node for node in cell if local_name(node.tag) == "v"), None)
    raw_value = value_node.text if value_node is not None else ""
    if raw_value is None:
        return ""

    if cell_type == "s":
        try:
            return shared_strings[int(raw_value)]
        except (ValueError, IndexError):
            return ""

    if cell_type == "b":
        return "TRUE" if raw_value == "1" else "FALSE"

    return normalize_text(raw_value)


def read_xlsx(data):
    blocks = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        shared_strings = read_shared_strings(zf)
        sheets = read_workbook_sheets(zf)
        if not sheets:
            raise ValueError("XLSX worksheets are missing.")

        for sheet_name, sheet_path in sheets:
            root = read_zip_xml(zf, sheet_path)
            rows = []
            for row in root.iter():
                if local_name(row.tag) != "row":
                    continue
                cells = []
                for cell in row:
                    if local_name(cell.tag) != "c":
                        continue
                    text = read_xlsx_cell_text(cell, shared_strings)
                    if text:
                        cells.append(text)
                if cells:
                    rows.append(" | ".join(cells))
            if rows:
                append_block(blocks, f"工作表：{sheet_name}\n" + "\n".join(rows))
    return blocks


def read_pdf(data):
    try:
        import fitz
    except ImportError as exc:
        raise ValueError("PyMuPDF is required to parse PDF files.") from exc

    blocks = []
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        for page_index in range(len(doc)):
            page = doc.load_page(page_index)
            text = page.get_text("text")
            if normalize_text(text):
                append_block(blocks, f"PDF 第 {page_index + 1} 页\n{text}")
    finally:
        doc.close()
    return blocks


def read_mupdf_document(data, filetype, label):
    try:
        import fitz
    except ImportError as exc:
        raise ValueError("PyMuPDF is required to parse fixed-layout files.") from exc

    blocks = []
    doc = fitz.open(stream=data, filetype=filetype)
    try:
        for page_index in range(len(doc)):
            page = doc.load_page(page_index)
            text = page.get_text("text")
            if normalize_text(text):
                append_block(blocks, f"{label} 第 {page_index + 1} 页\n{text}")
    finally:
        doc.close()
    return blocks


def read_ofd_zip(data):
    blocks = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        xml_files = sorted(name for name in zf.namelist() if name.lower().endswith(".xml"))
        for name in xml_files:
            try:
                root = ET.fromstring(zf.read(name))
            except ET.ParseError:
                continue
            text_parts = []
            for node in root.iter():
                if local_name(node.tag) == "TextCode" and node.text:
                    text_parts.append(node.text)
            if text_parts:
                append_block(blocks, "\n".join(text_parts))
    return blocks


def read_ofd(data):
    try:
        blocks = read_mupdf_document(data, "ofd", "OFD")
        if blocks:
            return blocks
    except Exception:
        pass

    try:
        return read_ofd_zip(data)
    except zipfile.BadZipFile as exc:
        raise ValueError("OFD document cannot be parsed.") from exc


def run_subprocess(args, **kwargs):
    return subprocess.run(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=kwargs.pop("timeout", DEFAULT_SUBPROCESS_TIMEOUT),
        check=False,
        **kwargs
    )


def read_textutil_document(data, suffix):
    textutil = shutil.which("textutil")
    if not textutil:
        raise ValueError(f"{suffix} parsing requires macOS textutil or an equivalent converter.")

    with tempfile.TemporaryDirectory() as temp_dir:
        source_path = os.path.join(temp_dir, f"contract{suffix}")
        with open(source_path, "wb") as file:
            file.write(data)

        result = run_subprocess([textutil, "-convert", "txt", "-stdout", source_path])
        text = result.stdout.decode("utf-8", errors="replace")
        if normalize_text(text):
            return [text]

        # Some legacy Word/WPS files still expose useful text through strings.
        strings = shutil.which("strings")
        if strings:
            fallback = run_subprocess([strings, "-a", "-n", "2", source_path])
            fallback_text = fallback.stdout.decode("utf-8", errors="replace")
            if normalize_text(fallback_text):
                return [fallback_text]

        error_text = result.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"{suffix} document cannot be converted to readable text.{(' ' + error_text) if error_text else ''}")


def ocr_image_with_macos_vision(image_path):
    if platform.system() != "Darwin":
        return ""
    swift = shutil.which("swift")
    if not swift:
        return ""

    script_path = Path(__file__).resolve().parent / "ocr_image_macos.swift"
    if not script_path.exists():
        return ""

    result = run_subprocess([swift, str(script_path), image_path], timeout=DEFAULT_SUBPROCESS_TIMEOUT + 10)
    if result.returncode != 0:
        return ""
    return result.stdout.decode("utf-8", errors="replace")


def ocr_image_with_tesseract(image_path):
    tesseract = shutil.which("tesseract")
    if not tesseract:
        return ""

    languages = os.environ.get("CONTRACT_DOCUMENT_TESSERACT_LANG", "chi_sim+eng")
    result = run_subprocess([tesseract, image_path, "stdout", "-l", languages])
    if result.returncode != 0:
        return ""
    return result.stdout.decode("utf-8", errors="replace")


def read_image(data, suffix):
    with tempfile.TemporaryDirectory() as temp_dir:
        image_path = os.path.join(temp_dir, f"contract{suffix}")
        with open(image_path, "wb") as file:
            file.write(data)

        text = ocr_image_with_macos_vision(image_path) or ocr_image_with_tesseract(image_path)
        if normalize_text(text):
            return [text]

    raise ValueError("Image OCR did not return readable text. Install an OCR engine or upload a text-based document.")


def parse_document(file_name, data):
    suffix = "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix or 'missing'}")
    if suffix in IMAGE_EXTENSIONS:
        return suffix.lstrip("."), read_image(data, suffix)
    if suffix in TEXTUTIL_EXTENSIONS:
        return suffix.lstrip("."), read_textutil_document(data, suffix)
    if suffix == ".docx":
        return "docx", read_docx(data)
    if suffix == ".xlsx":
        return "xlsx", read_xlsx(data)
    if suffix == ".ofd":
        return "ofd", read_ofd(data)
    return "pdf", read_pdf(data)


def clamp_text(text, max_chars):
    warnings = []
    if len(text) <= max_chars:
        return text, warnings
    warnings.append(f"Document text was truncated from {len(text)} to {max_chars} characters.")
    return text[:max_chars], warnings


def main():
    body = json.loads(sys.stdin.read() or "{}")
    file_name = str(body.get("fileName") or body.get("file_name") or "").strip()
    content_base64 = str(body.get("fileContentBase64") or body.get("file_content_base64") or "").strip()
    max_chars = int(body.get("maxChars") or DEFAULT_MAX_CHARS)
    if not file_name:
        raise ValueError("fileName is required.")
    if not content_base64:
        raise ValueError("fileContentBase64 is required.")

    data = base64.b64decode(content_base64, validate=True)
    source_type, blocks = parse_document(file_name, data)
    normalized_blocks = [block for block in (normalize_text(item) for item in blocks) if block]
    text = "\n\n".join(normalized_blocks).strip()
    if not text:
        raise ValueError(f"{file_name} does not contain readable text.")
    text, warnings = clamp_text(text, max_chars)

    print(json.dumps({
        "success": True,
        "data": {
            "fileName": file_name,
            "sourceType": source_type,
            "text": text,
            "charCount": len(text),
            "blockCount": len(normalized_blocks),
            "truncated": bool(warnings),
            "warnings": warnings
        },
        "error": None
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({
            "success": False,
            "data": None,
            "error": {
                "message": str(exc)
            }
        }, ensure_ascii=False))
        sys.exit(1)
