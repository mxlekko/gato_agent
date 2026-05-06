# 退役 Agent 运行时 退场依赖扫描基线

生成时间：2026-05-03

最近更新：2026-05-06 11:45（Asia/Shanghai）

本报告对应 AG-00，用于给后续 退役 Agent 运行时 退场任务提供可复跑的依赖扫描入口和当前残留分层。当前代码侧主链路已经迁到项目内 LangGraph/runtime；本文档保留基线入口，并同步记录最新扫描结果，避免后续 agent 继续按早期阻塞项重复开发。完整机器可读报告由以下命令生成到 `tmp/retired-runtime-dependencies-report.json`：

```bash
node scripts/scan_retired_runtime_dependencies.js --output tmp/retired-runtime-dependencies-report.json
```

默认扫描范围：

```text
services, platform, scene-configs, scripts, tests, docs, server.js, package.json
```

扫描关键词：

```text
retired-runtime, 退役 Agent 运行时, RETIRED_RUNTIME, 旧 Gateway 端口, runtime://project-runtime, 旧共享运行时目录, 旧 agent gateway model
```

## 扫描摘要

最近一次扫描摘要：总命中 761，涉及 61 个文件。该总数会随着 `tests/regression/output/` 下的新回归输出增加而漂移，当前判断以 `runtime-blocker = 0`、`config-blocker = 0` 为准。

| 分类 | 命中数 | 文件数/代表文件 | 建议归属 |
|---|---:|---|---|
| `runtime-blocker` | 0 | 无 | 已完成，持续用扫描守住 |
| `config-blocker` | 0 | 无 | 已完成，持续用扫描守住 |
| `asset-namespace` | 132 | 历史报告、旧回归输出、`runtime://project-runtime` 兼容别名说明 | AG-10 后置清理 |
| `documentation` | 629 | 迁移说明、扫描脚本自身、历史回归报告、少量兼容字段说明 | AG-07 后置清理 |

说明：`asset-namespace` 表示路径或 bundle namespace 仍叫 `retired-runtime`，不等同于一定会访问本机 旧 Gateway。当前这些命中没有被扫描脚本归为运行阻塞或配置阻塞。

## 当前必须优先处理的残留

当前未发现 `runtime-blocker` 或 `config-blocker`。

已确认的关键状态：

1. `services/runtime.js` 中 agent-runtime legacy 执行已退役，只保留 direct-model 的 legacy 边界。
2. `server.js` 的 `/health` 探测项目内依赖：ContextHelper、DirectDbRunner、ModelTool、RAG 和 LangGraph 编译状态，不再探测 旧 Gateway。
3. `scripts/bootstrap_local_runtime.js` 不再要求 `旧 gateway token`，也不再探测 `旧本机 Gateway 端点`。
4. `sales-opportunity-advisor`、`sales-opportunity-advisor-directdb`、`sales-opportunity-smart-entry` 均为 `routing.mode=langgraph` 且 `langgraphCutover.requestPercentage=100`。
5. 三条销售 BusinessSkill 的 `advisory_llm` 均绑定 `tool://llm/project-advisory@v1`。
6. `payment-info-split` 与 `special-custom-product-solution` 的 direct-model fallback models 已迁到 `project://runtime-assets/model-profiles/...`。

## AG-00 到 AG-11 状态判断

| 工单 | 状态 | 判断依据 |
|---|---|---|
| AG-00 基线与依赖扫描 | 已完成 | `scripts/scan_retired_runtime_dependencies.js` 可复跑并输出分层 JSON。 |
| AG-01 路由与 fallback 策略收口 | 已完成 | `platform/runtime/fallback.js` 默认关闭 legacy fallback，gateway trace 会记录 fallback 状态。 |
| AG-02 项目内 LLM tool/client | 已完成 | 已有 `platform/tools/project-advisory-llm.tool.yaml`、`platform/runtime/llm-client.js`，draft-output 支持 `compat/mock/project-llm`。 |
| AG-03 advisor 迁移 | 已完成 | `sales-opportunity-advisor` 已 `langgraph` 100% cutover，agent model 改为项目内语义。 |
| AG-04 directdb 纯项目化 | 已完成 | `sales-opportunity-advisor-directdb` 保持 `langgraph` 100%，引用已迁到 project refs。 |
| AG-05 smart-entry 迁移 | 已完成 | `sales-opportunity-smart-entry` 已 `langgraph` 100%，fixture 已进入 self-contained manifest。 |
| AG-06 direct-model 退役 Agent 运行时 残留清理 | 已完成 | direct-model 场景模型元数据引用已迁到 `project://runtime-assets/model-profiles/...`。 |
| AG-07 文档、控制台与图示清理 | 已完成当前口径收口 | 用户可见运行文档已指向项目内 runtime；控制台新写入的 RAG settings 文档版本已改为 `agent.console/v1`；本轮追加清理 Console mock 和页面中的 direct-model `legacy-only` / `旧链路` 误导文案，历史迁移文档和旧回归输出仍可保留 退役 Agent 运行时 命中。 |
| AG-08 health/bootstrap/startup 去 退役 Agent 运行时 | 已完成 | health/bootstrap 不再依赖 旧 Gateway、`旧共享运行时目录` 或 `旧 gateway token`。 |
| AG-09 删除 legacy 退役 Agent 运行时 主链路 | 已完成 | agent-runtime legacy runner 已退役，gateway 不再调用 退役 Agent 运行时 agent 主链路。 |
| AG-10 runtime namespace 清理 | 已完成 | `runtime://project-runtime/...` 是唯一运行解析 namespace；历史 `runtime://project-runtime/...` 不再被 path resolver / bundle renderer 静默兼容，剩余命中来自历史文档和旧回归输出。 |
| AG-11 最终回归与上线门槛 | 已完成 | 已有 `npm run regression:no-retired-runtime` 和最终验收报告，扫描无 runtime/config blocker。 |

## 回归样本状态

已存在：

- `tests/fixtures/self-contained/payment-info-split.smoke.request.json`
- `tests/fixtures/self-contained/sales-opportunity-advisor.smoke.request.json`
- `tests/fixtures/self-contained/sales-opportunity-advisor-directdb.gateway-boundary.request.json`

本轮新增并已纳入默认 self-contained suite：

- `tests/fixtures/self-contained/sales-opportunity-smart-entry.smoke.request.json`

## 后续建议

1. 持续把新增运行文档限定在项目内 Platform Gateway、LangGraph Runtime、ContextHelper、DirectDbRunner、ModelTool、RAG 和 Project LLM Client 口径，历史迁移文档保留时应标注为历史链路。
2. 保持 `node scripts/scan_retired_runtime_dependencies.js --fail-on-runtime-blocker --fail-on-config-blocker` 和 `npm run regression:no-retired-runtime` 作为上线前守门命令。
3. 若后续清理历史回归输出或历史文档，需要区分“历史记录命中”和“运行配置命中”，避免误删迁移审计材料。
