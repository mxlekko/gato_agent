# 当前项目结构地图

生成日期：2026-04-30

本文件按当前仓库的可运行结构整理，重点覆盖源码、配置、资产、脚本、测试夹具和工程文档。不把 `node_modules/`、缓存、日志、临时目录、构建输出和 active bundle 历史版本当作源码结构的一部分。

## 结构结论

当前项目整体是清晰的，但还带着迁移期痕迹。

- 清晰的部分：后端 API、三个本地工具服务、React 控制台、平台 workflow、scene 配置、runtime 资产、RAG 服务分层明确。
- 不够清爽的部分：`docs/项目开发文档/` 历史文档很多；`rag-service/rag-service/data/local-runtime/*.sqlite3` 是被 Git 跟踪的运行数据；少量疑似遗留代码仍在仓库里。
- 当前需确认的工作区状态：根目录 `常驻启动说明.md` 显示删除，`docs/engineering/常驻启动说明.md` 显示新增。若这是有意移动，需要同步 README 链接；若不是，应恢复路径。

## 运行主线

```text
调用方 / Console
  -> server.js
  -> routes/*
  -> services/*
  -> platform/gateway + platform/runtime + platform/nodes
  -> ContextHelper / DirectDbRunner / ModelTool / RAG service / project runtime assets
```

## 根目录文件

| 文件 | 用途 |
| --- | --- |
| `.editorconfig` | 编辑器格式约定。 |
| `.env.example` | 根服务本地环境变量模板。 |
| `.gitattributes` | Git 文件属性和换行规则。 |
| `.gitignore` | 忽略本地依赖、缓存、日志、运行数据和构建产物。 |
| `README.md` | 项目总览、运行方式、scene、端口和路径规则说明。 |
| `package.json` | 根 Node 服务依赖和脚本入口。 |
| `package-lock.json` | 根 Node 依赖锁文件。 |
| `server.js` | API 服务入口，注册 health、agent、console、RAG 等 HTTP 路由。 |
| `table_t_sales_opportunity.md` | 销售机会表结构/字段说明资料。 |
| `常驻启动说明.md` | 常驻启动说明；当前工作区显示此根路径已删除，需确认是否迁移到 `docs/engineering/`。 |

## API 路由层

| 文件 | 用途 |
| --- | --- |
| `routes/agent.js` | 统一业务入口 `/api/agent/run` 的 route 适配、routing、shadow/fallback 处理。 |
| `routes/console-audit.js` | 控制台审计/revision 查询路由。 |
| `routes/console-configs.js` | 控制台配置目录、配置校验、编译预览和结构化配置更新路由。 |
| `routes/console-rag.js` | 控制台 RAG 文档库、检索、任务、DB sync 的代理路由。 |
| `routes/console-releases.js` | 控制台 release 状态、回滚等发布相关路由。 |
| `routes/console-rollout.js` | 控制台灰度、路由预检、rollout report 路由。 |
| `routes/console-runs.js` | 控制台运行记录和 shadow 对比查询路由。 |
| `routes/console-scenes.js` | 控制台 scene、workflow、资产、绑定关系编辑/查询路由。 |
| `routes/console-traces.js` | 控制台 trace 详情查询路由。 |
| `routes/internal-query-runner.js` | 内部通用查询执行入口。 |

## 后端服务层

| 文件 | 用途 |
| --- | --- |
| `services/runtime.js` | direct-model 执行入口和已退役 agent-runtime legacy 边界。 |
| `services/runtime-message.js` | runtime marker 和机器消息序列化辅助；不再构造外部 Gateway 请求。 |
| `services/direct-model.js` | direct-model scene 的模型调用、RAG 注入、schema 校验和结果归一。 |
| `services/response-parser.js` | 模型/agent 响应解析与业务 payload 提取。 |
| `services/request-validation.js` | agent run 请求参数校验。 |
| `services/scene-config.js` | scene 配置加载、active bundle 优先读取、路径引用解析。 |
| `services/generic-query-runner.js` | 通用 SQL query profile 执行器。 |
| `services/bundle-renderer.js` | 从配置中心 release entries 渲染可运行 bundle。 |
| `services/release-manager.js` | release 创建、激活、回滚、current symlink 管理。 |
| `services/release-validator.js` | release bundle 预检和关键文件/配置校验。 |
| `services/console-audit.js` | 控制台 revision/audit 数据服务。 |
| `services/console-configs.js` | 控制台配置目录、结构化编辑、RAG settings 配置服务。 |
| `services/console-rag.js` | API 到 RAG service 的控制台代理服务。 |
| `services/console-releases.js` | 控制台发布状态和回滚服务。 |
| `services/console-rollout.js` | 灰度报告、路由摘要、切流预检服务。 |
| `services/console-runs.js` | 运行日志和 shadow diff 查询服务。 |
| `services/console-scenes.js` | scene 工作流、资产、字典、prompt、schema、绑定关系服务。 |
| `services/console-traces.js` | trace 详情聚合和节点运行展示服务。 |
| `services/config-store/index.js` | 配置仓储工厂，按 driver 选择 file/mysql store。 |
| `services/config-store/file-store.js` | 文件型配置仓储适配器。 |
| `services/config-store/mysql-store.js` | MySQL 配置中心仓储适配器。 |

## 共享工具

| 文件 | 用途 |
| --- | --- |
| `utils/errors.js` | 统一 AppError、错误响应、错误归一化。 |
| `utils/load-env.js` | 加载项目 `.env`。 |
| `utils/logger.js` | 统一日志输出。 |
| `utils/path-resolver.js` | `project://`、`runtime://` 等受控路径解析。 |
| `utils/request-id.js` | requestId/traceId 生成。 |

## 平台运行层

| 文件 | 用途 |
| --- | --- |
| `platform/gateway/index.js` | routing 决策，处理 langgraph/direct-model 的模式选择；agent-runtime legacy 已退役。 |
| `platform/compiler/compile-workflow.js` | 根据 scene skill/template/query/tool 配置编译 workflow graph。 |
| `platform/compiler/validate.js` | 平台配置结构校验。 |
| `platform/runtime/README.md` | runtime 状态结构和运行说明。 |
| `platform/runtime/state.js` | workflow state 合并、node run 记录等状态工具。 |
| `platform/runtime/graphs/index.js` | 编译后 workflow 的节点调度器。 |
| `platform/runtime/shadow.js` | 历史 shadow/diff 工具；当前主路由不再依赖 legacy 对比。 |
| `platform/runtime/fallback.js` | langgraph failure 审计与回退禁用策略。 |
| `platform/nodes/authorize-scope.js` | 权限和字段范围校验节点。 |
| `platform/nodes/draft-output.js` | 调模型生成业务初稿节点。 |
| `platform/nodes/fetch-context.js` | 调数据工具取上下文节点。 |
| `platform/nodes/legacy-scene-runner.js` | 旧兼容节点；当前未注册到主运行图，疑似遗留候选。 |
| `platform/nodes/load-assets.js` | 加载 prompt、schema、dictionary、rules 等引用资产节点。 |
| `platform/nodes/normalize-facts.js` | 业务事实归一和 basis fields 生成节点。 |
| `platform/nodes/repair-output.js` | 输出结构不合格时的修复节点。 |
| `platform/nodes/retrieve-knowledge.js` | 调 RAG 检索知识上下文节点。 |
| `platform/nodes/tool-runtime.js` | 工具调用通用运行时。 |
| `platform/nodes/validate-input.js` | 输入契约校验节点。 |
| `platform/nodes/validate-output.js` | 输出 schema 校验节点。 |
| `platform/trace/context.js` | trace 上下文和允许追踪 scene 定义。 |
| `platform/trace/rollout-report.js` | 从事件日志生成 rollout 指标报告。 |

## 平台配置资产

| 文件 | 用途 |
| --- | --- |
| `platform/skills/README.md` | BusinessSkill 配置说明。 |
| `platform/skills/sales-opportunity-advisor.v1.yaml` | 销售机会推进建议业务 skill。 |
| `platform/skills/sales-opportunity-advisor-directdb.v1.yaml` | 销售机会 directdb 版本业务 skill。 |
| `platform/skills/sales-opportunity-smart-entry.v1.yaml` | 销售机会智能录入业务 skill。 |
| `platform/skills/special-custom-product-solution.v1.yaml` | 特殊定制产品方案业务 skill。 |
| `platform/templates/README.md` | workflow template 说明。 |
| `platform/templates/grounded-structured-advisory.v1.yaml` | 标准取数、生成、校验型 advisory workflow 模板。 |
| `platform/templates/grounded-structured-advisory.v1.revision-notes.md` | advisory 模板修订说明。 |
| `platform/templates/rag-grounded-product-solution.v1.yaml` | RAG grounded 产品方案 workflow 模板。 |
| `platform/tools/README.md` | tool/query profile 配置说明。 |
| `platform/tools/generic-query-runner.tool.yaml` | 通用查询执行工具配置。 |
| `platform/tools/local-rag-search.tool.yaml` | 本地 RAG 检索工具配置。 |
| `platform/tools/model-tool-structured-output.tool.yaml` | ModelTool 结构化输出校验工具配置。 |
| `platform/tools/project-advisory-llm.tool.yaml` | 项目内销售建议 LLM 工具配置。 |
| `platform/tools/project-product-solution-llm.tool.yaml` | 项目内产品方案 LLM 工具配置。 |
| `platform/tools/sales-opportunity-by-opportunity-id.query.yaml` | 销售机会按 opportunityId 查询 profile。 |
| `platform/tools/sales-opportunity-context-helper.tool.yaml` | ContextHelper 工具配置。 |
| `platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml` | directdb 按 opportunityId 查询 profile。 |
| `platform/tools/sales-opportunity-directdb-runner.tool.yaml` | DirectDbRunner 工具配置。 |
| `platform/tools/sales-opportunity-smart-entry-by-opportunity-id.query.yaml` | 智能录入按 opportunityId 查询 profile。 |
| `platform/assets/prompts/sales-opportunity-advisor.draft-business-output.v1.md` | 推进建议草稿生成 prompt。 |
| `platform/assets/prompts/sales-opportunity-advisor-directdb.draft-business-output.v1.md` | directdb 推进建议草稿生成 prompt。 |
| `platform/assets/prompts/sales-opportunity-smart-entry.draft-business-output.v1.md` | 智能录入草稿生成 prompt。 |
| `platform/assets/prompts/special-custom-product-solution.draft-business-output.v1.md` | 特殊定制产品方案生成 prompt。 |
| `platform/tests/fixtures/rollout/sample-events.jsonl` | rollout report 测试/示例事件流。 |

## Scene 配置

| 文件 | 用途 |
| --- | --- |
| `scene-configs/README.md` | scene 配置规范说明。 |
| `scene-configs/payment-info-split.json` | 收款信息拆分 direct-model scene。 |
| `scene-configs/sales-opportunity-advisor.json` | 销售机会推进建议 agent-runtime scene。 |
| `scene-configs/sales-opportunity-advisor-directdb.json` | 销售机会 directdb scene。 |
| `scene-configs/sales-opportunity-smart-entry.json` | 销售机会智能录入 scene。 |
| `scene-configs/special-custom-product-solution.json` | 特殊定制产品方案 direct-model + RAG scene。 |

## Runtime 资产

| 文件 | 用途 |
| --- | --- |
| `runtime-assets/model-profiles/payment-fast-agent/models.json` | 收款信息 direct-model fallback 模型元数据。 |
| `runtime-assets/model-profiles/sales-agent/models.json` | 销售/产品 direct-model fallback 模型元数据。 |
| `references/sales-opportunity-advisor/` | 销售机会推进建议项目内契约、规则和输出 schema。 |
| `references/sales-opportunity-advisor-directdb/` | directdb 版本项目内 SQL 定义。 |
| `references/sales-opportunity-smart-entry/` | 智能录入项目内契约、规则和输出 schema。 |
| `references/special-custom-product-solution/` | 特殊定制产品方案项目内规则和输出 schema。 |
| `runtime-assets/project-runtime/workspace/skills/**` | 历史 skill 资产迁入的项目 runtime 命名空间，主链路不再以该目录作为执行入口。 |

## ContextHelper 服务

| 文件 | 用途 |
| --- | --- |
| `ContextHelper/server.js` | ContextHelper HTTP 服务入口。 |
| `ContextHelper/routes/sales-opportunity.js` | 销售机会 helper 路由。 |
| `ContextHelper/controllers/sales-opportunity.js` | helper 请求处理和响应组装。 |
| `ContextHelper/providers/sales-opportunity/index.js` | 销售机会 provider 聚合入口。 |
| `ContextHelper/providers/sales-opportunity/filter.js` | 销售机会字段过滤和非空字段处理。 |
| `ContextHelper/providers/sales-opportunity/query.js` | 查询销售机会数据。 |
| `ContextHelper/providers/sales-opportunity/schema.js` | opportunityId 和字段 schema 规范化。 |
| `ContextHelper/services/audit-log.js` | helper/model/directdb 审计日志写入。 |
| `ContextHelper/services/db.js` | SQL Server 连接池和查询封装。 |
| `ContextHelper/services/generated-query-file.js` | helper 查询脚本读取、校验、manifest 管理。 |
| `ContextHelper/generated-queries/manifest.json` | helper 查询脚本 manifest。 |
| `ContextHelper/generated-queries/sales-opportunity-advisor.generated.js` | 推进建议 helper SQL 脚本。 |
| `ContextHelper/generated-queries/sales-opportunity-smart-entry.generated.js` | 智能录入 helper SQL 脚本。 |

## DirectDbRunner 服务

| 文件 | 用途 |
| --- | --- |
| `DirectDbRunner/server.js` | DirectDbRunner HTTP 服务入口。 |
| `DirectDbRunner/routes/sales-opportunity.js` | directdb 销售机会路由。 |
| `DirectDbRunner/controllers/sales-opportunity.js` | directdb 请求处理和响应组装。 |
| `DirectDbRunner/services/sql-template.js` | directdb SQL 模板生成、缓存和执行。 |
| `DirectDbRunner/sql-cache/sales-opportunity-advisor-directdb.sql.json` | directdb 查询 SQL 缓存。 |

## ModelTool 服务

| 文件 | 用途 |
| --- | --- |
| `ModelTool/server.js` | ModelTool HTTP 服务入口。 |
| `ModelTool/routes/structured-output.js` | 结构化输出校验路由。 |
| `ModelTool/controllers/structured-output.js` | 结构化输出校验请求处理。 |
| `ModelTool/services/structured-output-validator.js` | JSON/schema 校验、错误归一和轻量修正。 |

## RAG 服务

| 文件 | 用途 |
| --- | --- |
| `rag-service/README.md` | RAG 服务说明。 |
| `rag-service/.gitignore` | RAG 子目录忽略规则。 |
| `rag-service/requirements.txt` | Python 依赖清单。 |
| `rag-service/rag_search_server.py` | RAG HTTP 服务入口，提供检索、文档库、任务和 DB sync 接口。 |
| `rag-service/rag_mvp/__init__.py` | Python package 初始化文件。 |
| `rag-service/rag_mvp/chunking.py` | 旧 chunking re-export 包装；当前内部未引用，疑似遗留候选。 |
| `rag-service/rag_mvp/db_sync.py` | 数据库同步配置、字段检查、水位和索引任务逻辑。 |
| `rag-service/rag_mvp/embeddings.py` | DashScope embedding 客户端封装。 |
| `rag-service/rag_mvp/jobs.py` | RAG 任务队列 SQLite 存储。 |
| `rag-service/rag_mvp/library.py` | 文档库导入、更新、删除和解析入口。 |
| `rag-service/rag_mvp/parsers.py` | md/txt/pdf/docx/image 等文档解析。 |
| `rag-service/rag_mvp/semantic_chunker.py` | 语义切片算法。 |
| `rag-service/rag_mvp/store.py` | Chroma 向量库写入、查询和文档 chunk 管理。 |
| `rag-service/data/.gitkeep` | 保留本地数据目录占位。 |
| `rag-service/logs/.gitkeep` | 保留本地日志目录占位。 |
| `rag-service/rag-service/data/local-runtime/chroma/chroma.sqlite3` | 被 Git 跟踪的旧/误入库 Chroma 数据，需确认是否保留。 |
| `rag-service/rag-service/data/local-runtime/db_sync/sync_state.sqlite3` | 被 Git 跟踪的旧/误入库 DB sync 状态，需确认是否保留。 |
| `rag-service/rag-service/data/local-runtime/jobs.sqlite3` | 被 Git 跟踪的旧/误入库任务数据库，需确认是否保留。 |

## React 控制台

| 文件 | 用途 |
| --- | --- |
| `console/package.json` | 控制台前端依赖和 Vite 脚本。 |
| `console/package-lock.json` | 控制台依赖锁文件。 |
| `console/.env.example` | 控制台环境变量模板。 |
| `console/.env.local.example` | 控制台本地环境变量模板。 |
| `console/.gitignore` | 控制台子目录忽略规则。 |
| `console/README.md` | 控制台运行说明。 |
| `console/index.html` | Vite HTML 入口。 |
| `console/vite.config.js` | Vite 配置和 API proxy。 |
| `console/public/favicon.svg` | 控制台 favicon。 |
| `console/src/main.jsx` | React 应用挂载入口。 |
| `console/src/App.jsx` | 前端路由定义。 |
| `console/src/styles.css` | 控制台全局样式。 |
| `console/src/components/ShellLayout.jsx` | 控制台左侧导航和页面壳。 |
| `console/src/components/PageFrame.jsx` | 页面标题/操作区通用布局。 |
| `console/src/components/PlaceholderPanel.jsx` | 占位面板组件；当前未被引用，疑似遗留候选。 |
| `console/src/services/apiClient.js` | 控制台 API 方法封装。 |
| `console/src/services/clientFactory.js` | mock/real client 选择。 |
| `console/src/services/httpClient.js` | fetch 封装。 |
| `console/src/services/mockClient.js` | 控制台 mock 数据客户端。 |
| `console/src/utils/dateTime.js` | 日期时间格式化工具。 |
| `console/src/pages/scenes/ScenesPage.jsx` | scene 列表页。 |
| `console/src/pages/scenes/SceneWorkflowPage.jsx` | scene workflow 详情和资产编辑页。 |
| `console/src/pages/debug/RunOncePage.jsx` | 单次请求调试页。 |
| `console/src/pages/runs/RunListPage.jsx` | 运行记录列表页。 |
| `console/src/pages/runs/RunDetailPage.jsx` | 运行详情页。 |
| `console/src/pages/runs/ShadowComparePage.jsx` | shadow 对比详情页。 |
| `console/src/pages/traces/TraceDetailPage.jsx` | trace 详情页。 |
| `console/src/pages/configs/ConfigCatalogPage.jsx` | skill/template/query/tool 配置目录和编辑页。 |
| `console/src/pages/configs/CompilePreviewPage.jsx` | workflow 编译预览页。 |
| `console/src/pages/configs/ValidateConfigPage.jsx` | 配置校验页。 |
| `console/src/pages/rollout/RolloutPage.jsx` | 灰度、发布状态和回滚页面。 |
| `console/src/pages/workflows/WorkflowIvrFlow.jsx` | workflow IVR 风格连线图组件。 |
| `console/src/pages/workflows/WorkflowNodeList.jsx` | workflow 节点列表组件。 |
| `console/src/pages/rag/RagOverviewPage.jsx` | RAG 服务总览页。 |
| `console/src/pages/rag/RagSearchPage.jsx` | RAG 检索测试页。 |
| `console/src/pages/rag/RagLibraryPage.jsx` | RAG 文档库列表页。 |
| `console/src/pages/rag/RagLibraryDetailPage.jsx` | RAG 文档详情页。 |
| `console/src/pages/rag/RagLibraryEditPage.jsx` | RAG 文档编辑页。 |
| `console/src/pages/rag/RagJobsPage.jsx` | RAG 任务队列页。 |
| `console/src/pages/rag/RagSyncPage.jsx` | RAG 数据库同步页。 |
| `console/src/pages/rag/RagSettingsPage.jsx` | RAG 设置页。 |
| `console/src/pages/rag/components/RagStates.jsx` | RAG 状态展示组件。 |
| `console/src/pages/rag/components/index.js` | RAG 组件 barrel export。 |

## 业务数据和引用资产

| 文件 | 用途 |
| --- | --- |
| `metadata/sales_opportunity_dictionary.tsv` | 销售机会字段字典。 |
| `metadata/sales_opportunity_advisor_directdb_dictionary.tsv` | directdb 版本字段字典。 |
| `metadata/sales_opportunity_smart_entry_dictionary.tsv` | 智能录入字段字典。 |
| `metadata/special_custom_product_solution_dictionary.tsv` | 特殊定制产品方案字段字典。 |
| `references/payment-info-split/prompt.md` | 收款信息拆分 prompt。 |
| `references/payment-info-split/output_schema.json` | 收款信息拆分输出 schema。 |

## 脚本

| 文件 | 用途 |
| --- | --- |
| `scripts/bootstrap_local_runtime.js` | 初始化本地运行时、导入配置、创建 active bundle。 |
| `scripts/build_rollout_report.js` | 从事件日志生成 rollout report。 |
| `scripts/check_project_structure.js` | 项目结构检查脚本。 |
| `scripts/compare_results.js` | 回归结果对比工具。 |
| `scripts/generate_agent_architecture_images.py` | 生成架构图片。 |
| `scripts/generate_sales_architecture_pdf.py` | 生成销售架构 PDF。 |
| `scripts/import_config_to_mysql.js` | 将文件配置导入 MySQL 配置中心。 |
| `scripts/init_config_center_mysql_access.sh` | 初始化 MySQL 配置中心数据库和账号权限。 |
| `scripts/install_launch_agents.sh` | 安装、启动、停止、查看 macOS launchd 常驻服务。 |
| `scripts/lib/mysql_cli.js` | MySQL CLI 调用封装。 |
| `scripts/manage_local_mysql.sh` | 本地 MySQL 实例管理脚本。 |
| `scripts/manage_mysql_config_schema.js` | 配置中心 schema apply/inspect 脚本。 |
| `scripts/query_sales_opportunity_directdb.js` | directdb 查询调试脚本。 |
| `scripts/rollback_release.js` | release 回滚脚本。 |
| `scripts/run_baseline_regression.js` | baseline 回归执行脚本。 |
| `scripts/run_self_contained_regression.js` | 自包含回归执行脚本。 |
| `scripts/scan_shared_runtime_paths.js` | 扫描旧仓/共享 runtime 绝对路径引用。 |
| `scripts/validate_platform_configs.js` | 平台 YAML/JSON 配置校验。 |
| `scripts/verify_active_bundle_context_helper_generated_query.js` | 验证 active bundle 中 helper generated query 读取。 |
| `scripts/verify_active_bundle_direct_model.js` | 验证 active bundle direct-model 资产读取。 |
| `scripts/verify_active_bundle_load_assets.js` | 验证 active bundle asset 加载。 |
| `scripts/verify_active_bundle_platform_resources.js` | 验证 active bundle platform resources。 |
| `scripts/verify_active_bundle_query_profile.js` | 验证 active bundle query profile。 |
| `scripts/verify_active_bundle_scene_config.js` | 验证 active bundle scene config。 |
| `scripts/verify_bundle_renderer.js` | 验证 bundle renderer。 |
| `scripts/verify_config_store.js` | 验证配置仓储 file/mysql 行为。 |
| `scripts/verify_console_audit_revisions.js` | 验证控制台审计 revision 接口。 |
| `scripts/verify_console_release_rollback_route.js` | 验证控制台 release 回滚接口。 |
| `scripts/verify_console_release_status_route.js` | 验证控制台 release 状态接口。 |
| `scripts/verify_helper_script_release_bundle_sync.js` | 验证 helper script 随 release bundle 同步切换。 |
| `scripts/verify_mysql_connection.js` | 验证 MySQL 连接。 |
| `scripts/verify_release_manager.js` | 验证 release manager。 |
| `scripts/verify_release_validator.js` | 验证 release validator。 |
| `scripts/sql/config_center_schema.sql` | MySQL 配置中心表结构 SQL。 |

## 部署模板

| 文件 | 用途 |
| --- | --- |
| `deploy/launchd/com.gatopm.sales-opportunity-api.plist` | API 服务 launchd 模板。 |
| `deploy/launchd/com.gatopm.sales-opportunity-context-helper.plist` | ContextHelper launchd 模板。 |
| `deploy/launchd/com.gatopm.sales-opportunity-directdb-runner.plist` | DirectDbRunner launchd 模板。 |
| `deploy/launchd/com.gatopm.sales-opportunity-model-tool.plist` | ModelTool launchd 模板。 |

## 示例请求和测试夹具

| 文件 | 用途 |
| --- | --- |
| `examples/api-agent-run.request.json` | agent run 请求示例。 |
| `examples/api-agent-run-directdb.request.json` | directdb scene 请求示例。 |
| `examples/api-agent-run.response.success.json` | 成功响应示例。 |
| `examples/api-agent-run.response.error.json` | 错误响应示例。 |
| `examples/helper-context.request.json` | ContextHelper 请求示例。 |
| `examples/payment-info-split.request.json` | 收款信息拆分请求示例。 |
| `tests/regression/README.md` | 回归测试说明。 |
| `tests/fixtures/baseline/README.md` | baseline fixture 说明。 |
| `tests/fixtures/baseline/manifest.json` | baseline 回归 manifest。 |
| `tests/fixtures/baseline/sales-opportunity-advisor.success.request.json` | 成功路径请求 fixture。 |
| `tests/fixtures/baseline/sales-opportunity-advisor.success.response.json` | 成功路径期望响应 fixture。 |
| `tests/fixtures/baseline/sales-opportunity-advisor.not-found.request.json` | not found 请求 fixture。 |
| `tests/fixtures/baseline/sales-opportunity-advisor.not-found.response.json` | not found 期望响应 fixture。 |
| `tests/fixtures/baseline/sales-opportunity-advisor.invalid-empty-opportunity-id.request.json` | 空 opportunityId 请求 fixture。 |
| `tests/fixtures/baseline/sales-opportunity-advisor.invalid-empty-opportunity-id.response.json` | 空 opportunityId 期望响应 fixture。 |
| `tests/fixtures/baseline/sales-opportunity-advisor.model-tool-invalid-payload.request.json` | ModelTool 非法 payload 请求 fixture。 |
| `tests/fixtures/baseline/sales-opportunity-advisor.model-tool-invalid-payload.response.json` | ModelTool 非法 payload 期望响应 fixture。 |
| `tests/fixtures/platform-config/invalid-business-skill-inline-endpoint.yaml` | 无效 platform config fixture。 |
| `tests/fixtures/platform-config/invalid-query-profile-raw-sql.yaml` | 无效 query profile fixture。 |
| `tests/fixtures/reuse-candidate/sales-opportunity-advisor-directdb.request.json` | 模板复用候选请求样本。 |
| `tests/fixtures/self-contained/README.md` | 自包含回归 fixture 说明。 |
| `tests/fixtures/self-contained/manifest.json` | 自包含回归 manifest。 |
| `tests/fixtures/self-contained/payment-info-split.smoke.request.json` | payment-info-split smoke 请求。 |
| `tests/fixtures/self-contained/sales-opportunity-advisor.smoke.request.json` | advisor smoke 请求。 |
| `tests/fixtures/self-contained/sales-opportunity-advisor-directdb.gateway-boundary.request.json` | directdb gateway boundary 请求。 |

## 工程和对接文档

| 文件 | 用途 |
| --- | --- |
| `docs/engineering/project-structure.md` | 既有项目结构原则说明。 |
| `docs/engineering/redundant-files-checklist.md` | 冗余/可清理文件盘点。 |
| `docs/engineering/current-project-map.md` | 本文件，当前结构地图。 |
| `docs/engineering/常驻启动说明.md` | 常驻启动说明；当前为新增未跟踪路径，需确认是否替代根目录文件。 |
| `docs/场景外部对接文档/payment-info-split外部API对接文档.md` | payment-info-split 外部 API 对接文档。 |
| `docs/场景外部对接文档/special-custom-product-solution外部API对接文档.md` | special-custom-product-solution 外部 API 对接文档。 |
| `docs/项目开发文档/AI顺序执行改造任务指令.md` | 历史 AI 执行任务说明。 |
| `docs/项目开发文档/API_副本自闭环逐文件修改蓝图任务清单.md` | API 副本迁移任务清单。 |
| `docs/项目开发文档/Agent业务平台并行迁移分阶段任务清单.md` | Agent 平台迁移阶段任务清单。 |
| `docs/项目开发文档/MySQL配置中心化改造仓储层说明.md` | MySQL 配置仓储层说明。 |
| `docs/项目开发文档/MySQL配置中心化改造初始化导入说明.md` | MySQL 配置初始化导入说明。 |
| `docs/项目开发文档/MySQL配置中心化改造执行看板.md` | MySQL 配置中心改造执行记录。 |
| `docs/项目开发文档/MySQL配置中心化改造数据库与账号权限说明.md` | MySQL 数据库和账号权限说明。 |
| `docs/项目开发文档/MySQL配置中心化改造环境准备说明.md` | MySQL 本地环境准备说明。 |
| `docs/项目开发文档/MySQL配置中心化改造系统架构与任务清单.md` | MySQL 配置中心架构和任务清单。 |
| `docs/项目开发文档/MySQL配置中心化改造表结构说明.md` | MySQL 配置中心表结构说明。 |
| `docs/项目开发文档/MySQL配置中心化改造运行基线清单.md` | MySQL 改造运行基线清单。 |
| `docs/项目开发文档/MySQL配置中心化改造连接参数与连通性说明.md` | MySQL 连接参数和连通性说明。 |
| `docs/项目开发文档/RAG管理工作台迁入业务工作台Agent开发任务清单.md` | RAG 工作台迁移开发任务清单。 |
| `docs/项目开发文档/RAG管理工作台运行说明.md` | RAG 管理工作台运行说明。 |
| `docs/项目开发文档/前端V1页面范围说明.md` | 前端 V1 页面范围说明。 |
| `docs/项目开发文档/前端页面与后端接口映射表.md` | 控制台页面与后端接口映射。 |
| `docs/项目开发文档/平台运行模式与回退开关设计.md` | legacy/shadow/langgraph/fallback 设计说明。 |
| `docs/项目开发文档/旧系统到新系统模块映射表.md` | 旧系统和新系统模块映射。 |
| `docs/项目开发文档/旧编排兼容层边界说明.md` | 旧编排兼容边界说明。 |
| `docs/项目开发文档/旧逻辑下线标准.md` | 旧逻辑下线门槛。 |
| `docs/项目开发文档/第二业务模板复用样本范围说明.md` | 第二业务模板复用样本说明。 |
| `docs/项目开发文档/销售机会推进建议当前工作流基线文档.md` | 销售机会当前工作流基线。 |
| `docs/项目开发文档/销售机会推进建议系统架构-SkillTool重构版.md` | 销售机会 SkillTool 重构架构说明。 |

## 其他文件

| 文件 | 用途 |
| --- | --- |
| `drivers/mssql-jdbc-13.4.0.jre11.jar` | JDBC 驱动包；当前 Node 项目未发现引用，需确认是否外部工具依赖。 |

## 不纳入源码结构的本地产物

| 路径 | 说明 |
| --- | --- |
| `.env` | 本地运行配置和密钥引用，保留但不提交。 |
| `.local/runtime-bundles/` | 本地 release bundle 和 current symlink，运行时可能读取。 |
| `node_modules/`、`console/node_modules/` | 已安装依赖，保证当前项目可直接运行。 |
| `rag-service/.venv/` | RAG Python 虚拟环境，保证 RAG 服务可直接运行。 |
| `.npm-cache*`、`console/.npm-cache/`、`.playwright-cli/` | 缓存和工具日志。 |
| `logs/`、`rag-service/logs/`、`tmp/`、`.tmp/` | 本地日志和临时文件。 |
| `console/dist/` | 前端构建输出。 |
| `tests/regression/output/`、`platform/tests/output/` | 测试输出。 |
