# Agent 平台自闭环运行说明

本仓库是一个本地可运行的 Agent 业务平台副本，包含：

- API 服务：统一业务入口、控制台接口、配置校验和发布查询
- 本地工具服务：`ContextHelper`、`DirectDbRunner`、`ModelTool`
- RAG 服务：本地知识库检索、文档库和索引任务接口
- 平台运行层：workflow 编译、LangGraph 运行、运行追踪
- React 控制台：场景、配置、运行记录、灰度和发布状态页面
- Runtime 资产：scene 配置、prompt、schema、项目内 runtime references、模型元数据和业务字典

统一业务入口是：

```text
POST /api/agent/run
```

本地 API 入口由 [server.js](server.js) 提供。

## 当前 Scene

当前代码中启用 5 个 scene：

| scene | 模式 | 模型/Agent | 主要入参 |
| --- | --- | --- | --- |
| `payment-info-split` | `langgraph` | 项目内 LangGraph + Project Payment LLM + ModelTool | `rawText` |
| `sales-opportunity-advisor` | `langgraph` | 项目内 LangGraph + ContextHelper + Project Advisory LLM | `opportunityId` |
| `sales-opportunity-advisor-directdb` | `langgraph` | 项目内 LangGraph + DirectDbRunner + Project Advisory LLM | `opportunityId` |
| `sales-opportunity-smart-entry` | `langgraph` | 项目内 LangGraph + GenericQueryRunner + Project Advisory LLM | `opportunityId`, `rawText` |
| `special-custom-product-solution` | `langgraph` | 项目内 LangGraph + Local RAG + Project LLM + ModelTool | `specialCustomOrderNo`, `customRequirement` |

对应配置在 [scene-configs](scene-configs) 中。本地开发默认优先读取 `.local/runtime-bundles/local/current/scene-configs`，缺失时才回退到仓库内的 `scene-configs`；生产/prod 或 `CONFIG_REQUIRE_ACTIVE_BUNDLE=1` 会禁止仓库 fallback，必须存在 active bundle。

## 当前链路

`payment-info-split`:

```text
调用方 -> API -> Platform Gateway -> LangGraph Runtime -> Project Payment LLM -> ModelTool -> 返回收款信息
```

`sales-opportunity-advisor`:

```text
调用方 -> API -> Platform Gateway -> LangGraph Runtime -> ContextHelper -> SQL Server -> Project Advisory LLM -> ModelTool -> 返回推进建议
```

`sales-opportunity-advisor-directdb`:

```text
调用方 -> API -> Platform Gateway -> LangGraph Runtime -> DirectDbRunner -> SQL Server -> Project Advisory LLM -> ModelTool -> 返回推进建议
```

`sales-opportunity-smart-entry`:

```text
调用方 -> API -> Platform Gateway -> LangGraph Runtime -> GenericQueryRunner -> SQL Server -> Project Advisory LLM -> ModelTool -> 返回智能录入结果
```

`special-custom-product-solution`:

```text
调用方 -> API -> Platform Gateway -> LangGraph Runtime -> 本地 RAG(19104) -> Project LLM -> ModelTool -> 返回产品部方案
```

## 端口

本机当前 `.env` 使用的副本端口组是：

| 服务 | 地址 |
| --- | --- |
| API | `0.0.0.0:3100` |
| ContextHelper | `127.0.0.1:19101` |
| DirectDbRunner | `127.0.0.1:19102` |
| ModelTool | `127.0.0.1:19103` |
| Console dev | `127.0.0.1:3200` |
| RAG / special RAG | `127.0.0.1:19104` |

代码内置默认值仍是 `3000/19001/19002/19003`。本副本日常运行建议使用 `3100/19101/19102/19103`，这样可以和旧仓或其他实验端口并行。

## 运行配置来源

项目启动时读取根目录 `.env`。`.env` 不提交到 Git，脱敏模板是 [.env.example](.env.example)。

常用变量：

- `API_HOST`, `API_PORT`
- `CONTEXT_HELPER_PORT`, `DIRECTDB_RUNNER_PORT`, `MODEL_TOOL_PORT`
- `MOONSHOT_API_KEY`, `DEEPSEEK_API_KEY`
- `SQLSERVER_HOST`, `SQLSERVER_PORT`, `SQLSERVER_DATABASE`, `SQLSERVER_USER`, `SQLSERVER_PASSWORD`
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`
- `RAG_SERVICE_BASE_URL`, `RAG_SEARCH_HOST`, `RAG_SEARCH_PORT`, `RAG_COLLECTION_NAME`
- `DASHSCOPE_API_KEY`, `EMBEDDING_MODEL`
- `RAG_PROXY_TIMEOUT_MS`, `RAG_SYNC_DB_URL`
- `CONFIG_STORE_DRIVER`
- `CONFIG_ACTIVE_ENV`, `CONFIG_BUNDLE_ROOT`, `CONFIG_CURRENT_BUNDLE`, `CONFIG_SCENE_CONFIG_DIR`, `CONFIG_PROJECT_ROOT`, `CONFIG_RUNTIME_ROOT`
- `CONFIG_REQUIRE_ACTIVE_BUNDLE`
- `CONSOLE_ADMIN_TOKEN`

模型密钥只允许放在 `.env` 或环境变量里。`runtime-assets/model-profiles/*/models.json` 和 `auth-profiles.json` 只保留模型元数据和 `apiKeyEnv` / `keyEnv`，不能写真实 key。

## 路径规则

运行时配置支持两类受控路径：

- `project://...`
  - 解析到当前 project root
  - active bundle 存在时解析到 `.local/runtime-bundles/local/current`
  - 本地开发且未强制 active bundle 时，可回退到仓库根目录
- `runtime://project-runtime/...`
  - 解析到当前 runtime root 下的 `project-runtime`
  - active bundle 存在时解析到 `.local/runtime-bundles/local/current/runtime-assets/project-runtime`
  - 本地开发且未强制 active bundle 时，可回退到 `runtime-assets/project-runtime`

生产/prod 或 `CONFIG_REQUIRE_ACTIVE_BUNDLE=1` 时，`scene-configs` 和 `platform` 均不会回退到仓库目录；active bundle 缺失会直接启动/请求失败。

历史 `runtime://project-runtime/...` namespace 已退役，运行时只接受 `runtime://project-runtime/...`。

禁止继续引用：

- `/Users/gato-pm/Desktop/API/...`
- `旧共享运行时目录/...`

命中旧路径时，scene 配置和运行时资产解析会直接报错。

## 目录入口

- [server.js](server.js): API 服务入口
- [routes](routes): HTTP route 适配层
- [services](services): scene 配置、运行调用、控制台数据、发布和持久化服务
- [platform](platform): workflow 模板、技能、工具、编译器和运行时
- [scene-configs](scene-configs): scene 配置
- [runtime-assets/project-runtime](runtime-assets/project-runtime): 项目内 runtime 参考资产
- [runtime-assets/model-profiles](runtime-assets/model-profiles): 项目内 LLM 使用的模型元数据
- [metadata](metadata): 本地业务字段字典
- [ContextHelper](ContextHelper): helper 型数据工具
- [DirectDbRunner](DirectDbRunner): directdb 型数据工具
- [ModelTool](ModelTool): 结构化输出校验工具
- [console](console): React/Vite 控制台
- [scripts](scripts): 初始化、导入、校验、发布和回归脚本
- [deploy/launchd](deploy/launchd): macOS 常驻启动模板
- [docs](docs): 对接文档和工程文档

## 启动后端

手工启动：

```bash
npm run start:helper
npm run start:directdb-runner
npm run start:model-tool
npm run start:api
```

常驻启动：

```bash
npm run service:install
npm run service:restart
npm run service:status
```

更详细的常驻方式见 [docs/engineering/常驻启动说明.md](docs/engineering/常驻启动说明.md)。

## 启动 RAG 服务

首次安装 Python 依赖：

```bash
npm run rag:install
```

启动 RAG 服务：

```bash
npm run start:rag
```

健康检查：

```bash
npm run rag:health
```

默认 RAG 服务监听 `http://127.0.0.1:19104`。API 服务通过 `RAG_SERVICE_BASE_URL` 代理到 RAG 服务，控制台通过 `/api/console/rag/*` 访问文档库、检索和任务队列。`DASHSCOPE_API_KEY` 只允许写在本地 `.env` 或 `rag-service/.env` 中，不能写入 Git。

RAG 运行数据默认写入 `rag-service/data/`。需要做临时验收或隔离旧 Chroma 数据时，可以在启动前设置 `RAG_DATA_DIR` 指向一个被忽略的临时目录；如需更细粒度控制，也可分别设置 `RAG_CHROMA_DIR`、`RAG_LIBRARY_DIR`、`RAG_UPLOAD_DIR`、`RAG_JOBS_DB`、`RAG_DB_SYNC_DIR`。这些变量只影响本地运行数据位置，不改变 `POST /internal/rag/search` 和控制台代理协议。

常见排查：

- `RAG_SERVICE_UNAVAILABLE`：确认 `npm run start:rag` 已启动，且 `RAG_SERVICE_BASE_URL` 指向本机 loopback 地址。
- `RAG_DEPENDENCY_MISSING`：执行 `npm run rag:install` 后重启 RAG 服务。
- `DASHSCOPE_API_KEY missing`：在 `.env` 或 `rag-service/.env` 配置密钥后重启服务。
- 搜索无结果：先在 `/rag/library` 上传文档并触发重建索引，再到 `/rag/jobs` 查看任务是否完成。
- `rag-service/data/`、`rag-service/logs/`、`.venv/`、`.env` 都是本地运行内容，不提交到 Git。

## 启动控制台

从仓库根目录启动：

```bash
npm run console:dev
```

默认行为：

- `http://127.0.0.1:3200` 提供控制台页面
- `/api/*` 默认代理到 `http://127.0.0.1:3100`
- 控制台始终走真实 API，不再保留本地 mock 数据模式

切换代理目标时，复制 [console/.env.local.example](console/.env.local.example) 为 `console/.env.local`，修改 `VITE_API_PROXY_TARGET` 后重启控制台。

控制台写操作受访问保护：

- 配置 `CONSOLE_ADMIN_TOKEN` 后，所有写入类 `/api/console/*` 请求必须带 `X-Console-Admin-Token` 或 `Authorization: Bearer ...`。
- 未配置 token 时，仅本地开发允许 loopback 客户端执行写操作；生产/prod 或 `CONFIG_REQUIRE_ACTIVE_BUNDLE=1` 会强制要求 token。
- 内网 V1 可以在浏览器 localStorage 写入 `agent-platform-console-admin-token`，或在 `console/.env.local` 设置 `VITE_CONSOLE_ADMIN_TOKEN`；公网部署不要把管理员 token 打进前端包。

## 配置中心

控制台配置草稿默认写入 MySQL 配置中心，核心表包括：

- `cfg_scene_configs`
- `cfg_scene_assets`
- `cfg_platform_resources`
- `cfg_revisions`
- `cfg_releases`
- `cfg_release_pointers`

运行时读取发布后的 active bundle。控制台草稿和当前发布版不一致时，页面会显示 unpublished changes。发布后 `.local/runtime-bundles/local/current` 会指向最新 release，并在指针切换后再次校验 current symlink、bundle manifest、场景配置和平台资源；校验失败会回滚 release pointer 与 current symlink。

常用命令：

```bash
npm run mysql:ping
npm run mysql:schema:inspect
npm run mysql:schema:apply
npm run mysql:import-config
npm run mysql:import-config:verify
```

## 模板化新增场景

控制台新增场景入口是 `/scenes/new`。新增页展示的是“场景模板”：由当前已发布的五个场景配置和对应 BusinessSkill 抽象而来，包含来源场景、底层 WorkflowTemplate、实际启用节点、资产类型、查询/RAG 能力和默认输入输出契约。后端提供两个控制台接口：

- `GET /api/console/scene-templates`：返回五个现有场景抽象出的场景模板摘要，例如 `payment-info-split@v1`、`sales-opportunity-advisor@v1`、`sales-opportunity-smart-entry@v1`，并包含 `sourceScene`、`workflowTemplateRef`、`orderedNodeIds`、`requiresQueryProfile`、`requiresRag`、支持资产类型和默认契约。
- `POST /api/console/scenes`：基于场景模板创建场景草稿，写入 `cfg_scene_configs`、`cfg_platform_resources` 和 `cfg_scene_assets`；可配置 prompt、dictionary、rules 等场景资产，RAG 场景可配置检索策略；查询增强场景会额外生成 `QueryProfile` 草稿，并固定绑定 `tool://data/generic-query-runner@v1`。生成后的 BusinessSkill 仍绑定底层 WorkflowTemplate，以进入现有编译、发布和运行链路。

纯文本结构化抽取示例：

```bash
curl -sS -X POST http://127.0.0.1:3100/api/console/scenes \
  -H 'Content-Type: application/json' \
  -d '{
    "scene": "contract-summary-extraction",
    "title": "合同摘要抽取",
    "description": "从合同文本中抽取摘要和关键风险。",
    "templateRef": { "name": "payment-info-split", "version": "v1" },
    "inputContract": {
      "required": ["rawText"],
      "fields": {
        "rawText": { "type": "string", "sourcePath": "request.bizParams.rawText" }
      }
    },
    "outputSchema": {
      "type": "object",
      "required": ["summary", "risks"],
      "properties": {
        "summary": { "type": "string" },
        "risks": { "type": "array", "items": { "type": "string" } }
      }
    },
    "assets": {
      "prompt": { "contentText": "你是合同摘要抽取器，只返回 JSON。" }
    }
  }'
```

客户投诉归因查询增强示例：

```bash
curl -sS -X POST http://127.0.0.1:3100/api/console/scenes \
  -H 'Content-Type: application/json' \
  -d '{
    "scene": "customer-complaint-attribution",
    "title": "客户投诉归因",
    "description": "根据投诉文本和客户历史订单生成归因、责任部门和建议动作。",
    "templateRef": { "name": "sales-opportunity-advisor", "version": "v1" },
    "inputContract": {
      "required": ["complaintText", "customerId"],
      "fields": {
        "complaintText": { "type": "string", "sourcePath": "request.bizParams.complaintText" },
        "customerId": { "type": "string", "sourcePath": "request.bizParams.customerId" }
      }
    },
    "outputSchema": {
      "type": "object",
      "required": ["attribution", "responsibleDepartment", "suggestedActions"],
      "properties": {
        "attribution": { "type": "string" },
        "responsibleDepartment": { "type": "string" },
        "suggestedActions": { "type": "array", "items": { "type": "string" } }
      }
    },
    "assets": {
      "prompt": { "contentText": "你是客户投诉归因助手，只返回符合 schema 的 JSON。" },
      "dictionary": { "contentText": "field_name\tfield_description\ncustomerId\t客户 ID\ncomplaintText\t投诉文本\n" },
      "rules": { "contentText": "# 归因规则\n\n- 不要编造客户历史。\n- 只基于投诉文本和查询结果输出建议。\n" }
    },
    "queryProfile": {
      "enabled": true,
      "name": "customer-orders-by-customer-id",
      "title": "客户历史订单查询",
      "primaryEntity": { "table": "t_customer_order", "idField": "customerId" },
      "where": [
        { "field": "customerId", "operator": "equals", "param": "customerId" }
      ],
      "resultPolicy": { "mode": "multi-rows", "fields": ["*"], "limit": 20 }
    }
  }'
```

RAG 场景可额外传入：

```json
{
  "ragConfig": {
    "topK": 5,
    "docId": "",
    "query": "",
    "failOnError": true
  }
}
```

一期限制：

- 不做 AI 自然语言生成场景。
- 不做自由拖拽流程画布。
- 不开放任意 SQL、raw SQL、join、subquery、多语句或写查询。
- 不做外部数据源凭据管理。

## 本地初始化

clone 到新机器后，代码本身不能自动补齐 `.env`、MySQL 配置中心、active bundle、RAG 服务和业务数据库。先创建 `.env` 并填好真实配置：

```bash
cp .env.example .env
```

然后可以用 bootstrap 脚本做预检：

```bash
npm run bootstrap:local:dry-run
```

预检通过后执行：

```bash
npm run bootstrap:local
```

该脚本会按顺序完成：

- 检查 `.env` 必要变量
- 检查项目关键文件
- 检查 RAG requirements、虚拟环境、`DASHSCOPE_API_KEY` 和 `/health`
- 检查 `npm`、`mysql`、`ruby`
- 可选探测 special RAG 服务
- 应用 MySQL 配置中心表结构
- 将仓库内 scene / platform / asset / helper script 导入 MySQL 配置中心
- 创建并发布本地 active bundle 到 `.local/runtime-bundles/local/current`
- 执行 `npm run check`

可选参数：

```bash
node scripts/bootstrap_local_runtime.js --dry-run
node scripts/bootstrap_local_runtime.js --install-deps
node scripts/bootstrap_local_runtime.js --skip-external-checks
node scripts/bootstrap_local_runtime.js --skip-schema
node scripts/bootstrap_local_runtime.js --skip-import
node scripts/bootstrap_local_runtime.js --skip-publish
```

注意：bootstrap 只能恢复本仓库可管理的本地运行态，不能替你创建外部 SQL Server、RAG 服务或模型服务账号。

## 工程化检查

项目结构边界说明见 [docs/engineering/project-structure.md](docs/engineering/project-structure.md)。

提交前建议执行：

```bash
npm run check
```

当前检查包含：

- 项目关键目录和入口是否存在
- `.env`、`node_modules`、日志、缓存、构建产物是否被误加入 Git
- 已跟踪文件是否包含 `sk-*` 形式的密钥
- `platform` 配置是否合法

前端构建：

```bash
npm run console:build
```

## 基础检查

API 健康检查：

```bash
curl -sS http://127.0.0.1:3100/health
```

配置目录：

```bash
curl -sS http://127.0.0.1:3100/api/console/configs/catalog
```

scene 列表：

```bash
curl -sS http://127.0.0.1:3100/api/console/scenes
```

payment-info-split 示例：

```bash
curl -sS -X POST http://127.0.0.1:3100/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"scene":"payment-info-split","bizParams":{"rawText":"收款方：上海某某科技有限公司；开户行：中国银行上海浦东分行；账号：1234567890123456789"},"runtimeContext":{"userId":"user-a"}}'
```

special-custom-product-solution 示例：

```bash
curl -sS -X POST http://127.0.0.1:3100/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"scene":"special-custom-product-solution","bizParams":{"specialCustomOrderNo":"SC-20260429-001","customRequirement":"3.0程序；用灯控模块4.0烧录3.0网络设备，还要添加485地址所需的物料；型号：GT-KLMN03 V3.0"}}'
```

## 自闭环回归

```bash
npm run regression:self-contained
```

当前 manifest 覆盖五个 self-contained case：

- `payment-info-split.smoke`
- `sales-opportunity-advisor.smoke`
- `sales-opportunity-advisor-directdb.smoke`
- `sales-opportunity-smart-entry.smoke`
- `special-custom-product-solution.smoke`

回归会先扫描运行配置和主链路是否残留旧仓或共享 `旧共享运行时目录` 路径，再回放 manifest 中的请求。

无 退役 Agent 运行时 回归入口：

```bash
npm run regression:no-retired-runtime
```

该命令会扫描依赖和本轮请求日志，确认没有旧 Gateway 主链路痕迹。

## Git 和发布注意

- `.env`、本地缓存、日志、构建产物和 `.local/` 不提交
- `.env.example`、`runtime-assets`、`scene-configs`、`platform`、`docs` 需要提交
- 模型密钥不要写入 `models.json` 或 `auth-profiles.json`
- 如果密钥曾经进入 Git 历史，需要重写历史并作废旧 key

## 文档索引

- [docs/engineering/常驻启动说明.md](docs/engineering/常驻启动说明.md)
- [docs/engineering/Docker部署说明.md](docs/engineering/Docker部署说明.md)
- [docs/项目开发文档/RAG管理工作台运行说明.md](docs/项目开发文档/RAG管理工作台运行说明.md)
- [docs/engineering/project-structure.md](docs/engineering/project-structure.md)
- [docs/场景外部对接文档/payment-info-split外部API对接文档.md](docs/场景外部对接文档/payment-info-split外部API对接文档.md)
- [docs/场景外部对接文档/special-custom-product-solution外部API对接文档.md](docs/场景外部对接文档/special-custom-product-solution外部API对接文档.md)
- [docs/项目开发文档/API_副本自闭环逐文件修改蓝图任务清单.md](docs/项目开发文档/API_副本自闭环逐文件修改蓝图任务清单.md)
- [docs/项目开发文档/前端页面与后端接口映射表.md](docs/项目开发文档/前端页面与后端接口映射表.md)
- [docs/项目开发文档/MySQL配置中心化改造执行看板.md](docs/项目开发文档/MySQL配置中心化改造执行看板.md)
