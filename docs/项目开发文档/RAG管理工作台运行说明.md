# RAG 管理工作台运行说明

本文用于本地开发和联调 RAG 管理工作台。运行数据、密钥和上传文件只保留在本机，不进入 Git。

## 1. 安装依赖

从仓库根目录执行：

```bash
npm run rag:install
```

该命令会在 `rag-service/.venv/` 创建 Python 虚拟环境，并安装 `rag-service/requirements.txt`。如果需要手工安装：

```bash
cd rag-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## 2. 环境变量

RAG 服务可读取仓库根目录 `.env` 或 `rag-service/.env`。推荐在本地文件中配置：

```bash
RAG_SEARCH_HOST=127.0.0.1
RAG_SEARCH_PORT=19104
RAG_COLLECTION_NAME=
RAG_SERVICE_BASE_URL=http://127.0.0.1:19104
RAG_PROXY_TIMEOUT_MS=15000

DASHSCOPE_API_KEY=
EMBEDDING_MODEL=text-embedding-v4
```

不要把 `.env`、真实 API Key、数据库密码或运行数据提交到 Git。

## 3. 启动与检查

启动 RAG 服务：

```bash
npm run start:rag
```

健康检查：

```bash
npm run rag:health
curl -sS http://127.0.0.1:19104/health
```

本地初始化预检：

```bash
npm run bootstrap:local:dry-run
```

dry-run 会报告 `rag-service/requirements.txt`、`rag-service/.venv`、`DASHSCOPE_API_KEY` 和 `GET /health` 状态，不会创建虚拟环境、写数据库或发布 bundle。

## 4. API 快速检查

文档列表：

```bash
curl -sS http://127.0.0.1:19104/internal/rag/documents
```

上传 Markdown 文档：

```bash
curl -sS -X POST http://127.0.0.1:19104/internal/rag/documents \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"example.md","content":"# Example\n\nKnowledge text."}'
```

重建索引：

```bash
curl -sS -X POST http://127.0.0.1:19104/internal/rag/documents/<DOC_ID>/reindex \
  -H 'Content-Type: application/json' \
  -d '{}'
```

查看任务：

```bash
curl -sS http://127.0.0.1:19104/internal/rag/jobs
curl -sS http://127.0.0.1:19104/internal/rag/jobs/<JOB_ID>
```

查看 chunks：

```bash
curl -sS http://127.0.0.1:19104/internal/rag/documents/<DOC_ID>/chunks
```

检索：

```bash
curl -sS -X POST http://127.0.0.1:19104/internal/rag/search \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"local-check","query":"测试检索","topK":3}'
```

`POST /internal/rag/search` 是现有 `special-custom-product-solution` 场景依赖的兼容接口，不要改外部调用协议。

## 5. 工作台页面

启动 API 和控制台后：

```bash
npm run start:api
npm run console:dev
```

访问 `http://127.0.0.1:3200`：

- `/rag/overview`：查看 RAG 服务状态、collection 和 chunk 数。
- `/rag/search`：输入 query，验证检索 matches。
- `/rag/library`：上传、查看、编辑、删除文档，触发重建索引，查看 chunks。
- `/rag/jobs`：查看文档导入、重建索引和同步任务状态。

## 6. 数据目录与备份

RAG 运行数据在 `rag-service/data/`：

- `chroma/`：向量库。
- `library/`：文档 manifest 和可编辑内容。
- `uploads/`：上传原始文件。
- `jobs.sqlite3`：任务队列状态。

日志在 `rag-service/logs/`。这些目录只跟踪 `.gitkeep`，备份时复制 `rag-service/data/` 即可；清理本地数据前先确认是否需要保留知识库。

## 7. 常见问题

- `RAG_SERVICE_UNAVAILABLE`：RAG 服务未启动或 `RAG_SERVICE_BASE_URL` 不正确。
- `RAG_DEPENDENCY_MISSING`：依赖未安装，执行 `npm run rag:install`。
- `DASHSCOPE_API_KEY missing`：本地环境变量未配置或服务未重启。
- 重建任务失败：在 `/rag/jobs` 查看错误详情，再检查依赖、API Key 和文档内容是否可解析。
- 检索为空：确认文档已上传、重建任务已完成，并使用相近的 query 测试。
