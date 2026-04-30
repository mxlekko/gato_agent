# RAG Service

This directory contains the Python RAG service that backs the business workbench knowledge base module.

## Runtime

- Recommended Python: 3.11
- Local virtual environments, `.env`, Chroma data, uploaded files, and logs must stay local and are ignored by Git.

## Install

```bash
cd rag-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

`streamlit` from the original demo is intentionally not included because the React business workbench replaces the demo UI.

From the repository root, the same setup can be run with:

```bash
npm run rag:install
```

## Environment

Create `rag-service/.env` locally when running the service:

```bash
RAG_SEARCH_HOST=127.0.0.1
RAG_SEARCH_PORT=19104
RAG_COLLECTION_NAME=

DASHSCOPE_API_KEY=
EMBEDDING_MODEL=text-embedding-v4
PDF_OCR_ENGINE=auto
PDF_OCR_LANG=zh-Hans,en-US

CHAT_MODEL=
CHAT_BASE_URL=
CHAT_API_KEY=

RAG_SYNC_DB_URL=
```

Do not commit `.env` or real API keys.

The Node API proxy uses `RAG_SERVICE_BASE_URL` and defaults to `http://127.0.0.1:19104`. Keep this value on loopback.

Scanned PDF pages use local OCR instead of a vision model. The pipeline renders each PDF page to an image, preprocesses it with OpenCV, and then runs the configured OCR engine. `PDF_OCR_ENGINE` supports `auto` (default), `ocrmac`, `pytesseract`, or `paddleocr`. On macOS, `auto` first uses local Apple Vision OCR through Python. When using `pytesseract`, install the system `tesseract` binary and Chinese language data separately. PaddleOCR is optional and is not the default engine on macOS.

## Source Layout

```text
rag-service/
  rag_mvp/
    embeddings.py
    store.py
    library.py
    parsers.py
    semantic_chunker.py
    db_sync.py
  data/
  logs/
```

The service entrypoint is `rag_search_server.py`. It keeps the existing `GET /health` and `POST /internal/rag/search` contracts used by `special-custom-product-solution`.

## Static Check

```bash
python3 -m py_compile rag_search_server.py rag_mvp/*.py
```

## Service Startup

```bash
cd rag-service
source .venv/bin/activate
python rag_search_server.py
```

From the repository root:

```bash
npm run start:rag
npm run rag:health
```

Health check:

```bash
curl -sS http://127.0.0.1:19104/health
```

Search check:

```bash
curl -sS -X POST http://127.0.0.1:19104/internal/rag/search \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"local-check","query":"测试检索","topK":3}'
```

`query` is required. `topK` and `top_k` are both accepted and capped at 10. `docId` and `doc_id` are optional. Successful responses keep matches at `data.matches`, with each match containing `text`, `metadata`, `distance`, and `score`.

## Document Management API

The first document-management batch supports JSON uploads. Uploaded originals are written under `rag-service/data/uploads/`, editable library content is written under `rag-service/data/library/`, and both directories stay ignored by Git.

List documents:

```bash
curl -sS http://127.0.0.1:19104/internal/rag/documents
```

Upload a Markdown or text document:

```bash
curl -sS -X POST http://127.0.0.1:19104/internal/rag/documents \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"example.md","content":"# Example\n\nKnowledge text."}'
```

For binary formats, send `contentBase64` instead of `content`.

Document detail:

```bash
curl -sS http://127.0.0.1:19104/internal/rag/documents/<DOC_ID>
```

Update editable content:

```bash
curl -sS -X PATCH http://127.0.0.1:19104/internal/rag/documents/<DOC_ID> \
  -H 'Content-Type: application/json' \
  -d '{"content":"Updated markdown text."}'
```

Delete a document:

```bash
curl -sS -X DELETE http://127.0.0.1:19104/internal/rag/documents/<DOC_ID>
```

## Indexing And Jobs

Trigger document reindex:

```bash
curl -sS -X POST http://127.0.0.1:19104/internal/rag/documents/<DOC_ID>/reindex \
  -H 'Content-Type: application/json' \
  -d '{}'
```

List indexed chunks:

```bash
curl -sS http://127.0.0.1:19104/internal/rag/documents/<DOC_ID>/chunks
```

List jobs:

```bash
curl -sS http://127.0.0.1:19104/internal/rag/jobs
```

Job detail:

```bash
curl -sS http://127.0.0.1:19104/internal/rag/jobs/<JOB_ID>
```

## Data Directories

Runtime data stays under `rag-service/data/`:

- `data/chroma/`: local vector store
- `data/library/`: editable document manifests and content
- `data/uploads/`: uploaded original files
- `data/jobs.sqlite3`: lightweight task queue state
- `logs/`: local service logs

Only `.gitkeep` placeholders are tracked. Back up `data/` before deleting it if the local knowledge base needs to be preserved.

## Troubleshooting

- `DASHSCOPE_API_KEY missing`: create `rag-service/.env` or configure the variable in the shell before startup.
- `ModuleNotFoundError`: run `npm run rag:install` from the repository root.
- Scanned PDF OCR fails: confirm `opencv-python-headless` and the selected local OCR engine are installed. On macOS, `ocrmac` is installed from `requirements.txt`. For `pytesseract`, also install the system `tesseract` command and Chinese language data.
- `GET /health` fails: confirm the service is listening on `RAG_SEARCH_HOST` and `RAG_SEARCH_PORT`.
- Search returns no matches: upload a document, trigger reindex, and confirm the job succeeded before searching.
- Do not commit `.env`, `.venv`, `data/`, `logs/`, uploaded files, Chroma files, or SQLite runtime data.
