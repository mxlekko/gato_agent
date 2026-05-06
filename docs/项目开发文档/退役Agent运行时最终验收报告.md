# 退役 Agent 运行时 退场最终验收报告

记录时间：2026-05-06 13:12（Asia/Shanghai）

最近复验：2026-05-06 15:12（Asia/Shanghai）

## 结论

AG-11 已建立无 退役 Agent 运行时 回归入口：`npm run regression:no-retired-runtime`，并完成本轮复验。`payment-info-split` 作为 direct-model 场景仍优先要求成功；若外部模型 provider 返回明确的 direct-model 失败，也按 external warning 处理，避免把模型服务过载误判为 退役 Agent 运行时 退场失败。

本轮验收显示：

- agent-runtime 主场景默认走项目内 `langgraph`。
- no-retired-runtime 回归中 `legacyFallbackEnabled=false`。
- 退役 Agent 运行时 blocker 扫描结果为 `runtimeBlockers=0`、`configBlockers=0`。
- 本轮 5 个 no-retired-runtime 回归请求的 API 日志未出现 `gateway-http`、`旧 Gateway request timed out`、`agent.langgraph.fallback.triggered`。
- Rollout 指标复验中 `fallbackRatio=0`、`schemaFailureRate=0`、`p95DurationMs=3857`，无 alert。
- 手工 smoke 请求 `req_20260506_130403314_ece4f7f1` 命中 `langgraph-stategraph`，返回 `success=true`、非空 `summary/adviceText` 和 3 条 `nextActions`。

## 本轮命令结果

| 命令 | 结果 |
|---|---|
| `npm run lint:platform-configs` | 通过，`templates=2 / tools=7 / queries=3 / skills=4 / issueCount=0` |
| `node scripts/scan_retired_runtime_dependencies.js` | 通过；默认全量扫描只剩 `asset-namespace` 和 `documentation` 分类 |
| `node scripts/scan_retired_runtime_dependencies.js --fail-on-runtime-blocker --fail-on-config-blocker` | 通过；未发现 `runtime-blocker` 或 `config-blocker` |
| `npm run regression:self-contained` | 通过；最近输出目录 `tests/regression/output/self-contained-2026-05-06T07-11-53-463Z`，5 个用例，4 pass，1 warning，0 fail |
| `npm run regression:no-retired-runtime` | 通过；最近输出目录 `tests/regression/output/self-contained-2026-05-06T07-12-11-590Z`，5 个用例，4 pass，1 warning，0 fail；`legacyFallbackEnabled=false`，no-retired-runtime blocker 和日志检查均通过 |
| `node scripts/build_rollout_report.js --input <filtered-no-retired-runtime-langgraph-jsonl> --batch-id ag11-no-retired-runtime-langgraph-20260506-final --min-success-rate 0.98 --max-p95-ms 5000 --max-schema-failure-rate 0.01 --max-fallback-ratio 0 --fail-on-alert` | 通过；`langgraphRuns=3`、`successRate=1`、`fallbackRatio=0`、`schemaFailureRate=0`、`p95DurationMs=3857`、`alerts=[]` |
| `curl -sS http://127.0.0.1:3100/health` | 通过；`service=ok`，三条 LangGraph scene 编译成功，ContextHelper / DirectDbRunner / ModelTool 正常，RAG 为 optional unavailable |
| `curl -sS -X POST http://127.0.0.1:3100/api/agent/run ...sales-opportunity-advisor...` | 通过；`success=true`，`requestId=req_20260506_130403314_ece4f7f1`，核心业务字段非空 |
| `rg "req_20260506_130403314_ece4f7f1" logs/api.stdout.log logs/api.stderr.log \| rg "gateway-http\|旧 Gateway request timed out"` | 通过；无输出 |

## Rollout 指标

指标来源为最近一次 no-retired-runtime 回归中的三条 agent-runtime LangGraph 请求：`sales-opportunity-advisor`、`sales-opportunity-advisor-directdb`、`sales-opportunity-smart-entry`。

| 指标 | 结果 |
|---|---|
| `langgraphRuns` | `3` |
| `successRate` | `1` |
| `fallbackRatio` | `0` |
| `schemaFailureRate` | `0` |
| `p95DurationMs` | `3857` |
| `alerts` | `[]` |

本次本地 smoke 采用 `5000ms` p95 阈值通过；生产 rollout 仍建议保留 `3000ms` 目标作为真实流量放量前的延迟 guardrail。

## 回归覆盖

| 场景 | 结果 | 说明 |
|---|---|---|
| `payment-info-split` | pass / allowed external warning | 本轮 direct-model 路径成功；若 provider 返回明确 direct-model 外部错误，回归按 warning 处理 |
| `sales-opportunity-advisor` | pass | langgraph 路径成功 |
| `sales-opportunity-advisor-directdb` | pass | langgraph 路径成功 |
| `sales-opportunity-smart-entry` | pass | langgraph 路径成功 |
| `special-custom-product-solution` | warning | 返回明确 external warning，属于 RAG / direct-model 外部链路，不是 退役 Agent 运行时 依赖 |

## 剩余引用

`scripts/scan_retired_runtime_dependencies.js` 默认全量扫描仍会命中历史文档、迁移报告、旧回归输出，以及历史兼容别名说明。新回归输出会继续抬高默认全量命中数，因此当前判断以 blocker 分类为准。这些命中当前归类为：

- `asset-namespace`：主要来自历史报告和旧输出中的 `runtime://project-runtime` / `runtime-assets/project-runtime`。
- `documentation`：迁移说明、扫描脚本自身、控制台历史文案、测试 fixture 说明等。

当前未发现 `runtime-blocker` 或 `config-blocker`。

## 风险

- `payment-info-split` 和 `special-custom-product-solution` 仍依赖外部 direct-model provider；无 退役 Agent 运行时 回归允许明确的外部 provider warning，但不允许 退役 Agent 运行时 blocker、legacy fallback 或 gateway-http 日志痕迹。
- `special-custom-product-solution` 仍依赖本地 RAG；无 退役 Agent 运行时 回归允许它以明确 warning 形式通过。
- 日志检查依赖 `logs/api.stdout.log` / `logs/api.stderr.log` 可读；若 API 以非 launchd 方式运行，可通过 `NO_RETIRED_RUNTIME_LOG_FILES` 指定日志文件。
