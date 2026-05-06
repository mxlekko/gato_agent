# OpenClaw 退场依赖扫描基线

生成时间：2026-05-03

本报告对应 AG-00，用于给后续 OpenClaw 退场任务提供可复跑的依赖扫描入口和当前残留分层。完整机器可读报告由以下命令生成到 `tmp/openclaw-dependencies-report.json`：

```bash
node scripts/scan_openclaw_dependencies.js --output tmp/openclaw-dependencies-report.json
```

默认扫描范围：

```text
services, platform, scene-configs, scripts, tests, docs, server.js, package.json
```

扫描关键词：

```text
openclaw, OpenClaw, OPENCLAW, 18789, runtime://openclaw, .openclaw, openclaw/sales-agent
```

## 扫描摘要

最近一次扫描摘要：总命中 685，涉及 73 个文件。

| 分类 | 命中数 | 文件数/代表文件 | 建议归属 |
|---|---:|---|---|
| `runtime-blocker` | 17 | `services/runtime-message.js`, `services/runtime.js`, `server.js`, `scripts/bootstrap_local_runtime.js` | AG-08 / AG-09 |
| `config-blocker` | 32 | `scene-configs/*.json`, `platform/skills/*.yaml`, `platform/tools/openclaw-*.yaml` | AG-01 到 AG-06 |
| `asset-namespace` | 172 | `runtime://openclaw`、`runtime-assets/openclaw` 相关配置、校验脚本、历史回归输出 | AG-10 |
| `documentation` | 464 | `docs/`、架构图生成脚本、README、历史回归报告 | AG-07 |

说明：`asset-namespace` 表示路径或 bundle namespace 仍叫 `openclaw`，不等同于一定会访问本机 OpenClaw Gateway；是否影响运行需要结合对应 AG 工单判断。

## 当前必须优先处理的残留

1. `services/runtime-message.js` 仍固定 `http://127.0.0.1:18789`，并读取 `OPENCLAW_GATEWAY_TOKEN` 构造 Gateway 请求。
2. `services/runtime.js` 仍校验 `openclaw/` model、`x-openclaw-session-key`，并执行 legacy Gateway chat completion。
3. `server.js` 的 `/health` 仍通过 `OPENCLAW_GATEWAY_TOKEN` 探测 OpenClaw Gateway。
4. `scripts/bootstrap_local_runtime.js` 仍把 `OPENCLAW_GATEWAY_TOKEN` 列为 required env，并探测 `http://127.0.0.1:18789/v1/models`。
5. `sales-opportunity-advisor` 与 `sales-opportunity-smart-entry` 的 scene routing 仍是 `legacy`，并指向 `openclaw/sales-agent`。
6. `sales-opportunity-advisor-directdb` 已是 `langgraph` 100% cutover，但 scene/skill 仍保留 OpenClaw agent、tool 命名和 `runtime://openclaw` 资产引用。
7. `payment-info-split` 与 `special-custom-product-solution` 仍使用 `runtime://openclaw/.../models.json` 作为 direct-model fallback models 文件；`special-custom-product-solution` 还保留 OpenClaw agent/skill 配置。

## AG-00 到 AG-11 状态判断

| 工单 | 状态 | 判断依据 |
|---|---|---|
| AG-00 基线与依赖扫描 | 已完成本轮落地 | 已新增 `scripts/scan_openclaw_dependencies.js`，本报告已建立；已有 advisor/directdb fixture，并补齐 smart-entry fixture。 |
| AG-01 路由与 fallback 策略收口 | 未完成 | `LANGGRAPH_LEGACY_FALLBACK_ENABLED` 尚不存在；LangGraph 异常仍会自动 fallback 到 legacy。 |
| AG-02 项目内 LLM tool/client | 未完成 | `platform/tools/openclaw-sales-agent-default.tool.yaml` 与 `openclaw-product-solution-agent.tool.yaml` 仍是 `agent-runtime` / `openclaw/sales-agent`；`draft-output` 仍以兼容草稿为默认。 |
| AG-03 advisor 迁移 | 未完成，依赖 AG-01/AG-02 | `scene-configs/sales-opportunity-advisor.json` 仍是 `routing.mode=legacy` 且保留 `openclaw/sales-agent`。 |
| AG-04 directdb 纯项目化 | 部分完成，依赖 AG-01/AG-02 | scene 已 `langgraph` 100% cutover，但配置仍保留 OpenClaw agent/skill/tool 命名与 namespace。 |
| AG-05 smart-entry 迁移 | 未完成，依赖 AG-01/AG-02 | scene 仍是 `routing.mode=legacy`，本轮只补了最小请求 fixture。 |
| AG-06 direct-model OpenClaw 残留清理 | 未完成，可在 AG-00 后处理 | `payment-info-split` 和 `special-custom-product-solution` 仍有 `runtime://openclaw` fallback models；后者还有 OpenClaw agent/skill 字段。 |
| AG-07 文档、控制台与图示清理 | 未完成，可在 AG-00 后处理 | 文档、架构图脚本、控制台服务中仍有 OpenClaw 文案或 workspace mirror 残留。 |
| AG-08 health/bootstrap/startup 去 OpenClaw | 未完成，建议等 AG-03 到 AG-05 稳定后处理 | `/health` 与 bootstrap 仍探测 OpenClaw Gateway。 |
| AG-09 删除 legacy OpenClaw 主链路 | 未完成，阻塞于 AG-03/AG-04/AG-05 | `services/runtime*.js` 仍是 legacy Gateway 主链路实现。 |
| AG-10 runtime namespace 清理 | 未完成，阻塞于 AG-09 | 大量 `runtime://openclaw` / `runtime-assets/openclaw` 仍作为资产 namespace。 |
| AG-11 最终回归与上线门槛 | 未完成，阻塞于 AG-01 到 AG-10 | 尚无 `regression:no-openclaw` npm script，且扫描仍有 runtime/config blocker。 |

## 回归样本状态

已存在：

- `tests/fixtures/self-contained/payment-info-split.smoke.request.json`
- `tests/fixtures/self-contained/sales-opportunity-advisor.smoke.request.json`
- `tests/fixtures/self-contained/sales-opportunity-advisor-directdb.gateway-boundary.request.json`

本轮新增：

- `tests/fixtures/self-contained/sales-opportunity-smart-entry.smoke.request.json`

`sales-opportunity-smart-entry` 目前未加入默认 `manifest.json`，因为该 scene 仍是 legacy routing；后续 AG-05 切到项目内 LangGraph 后，再把它纳入默认 self-contained suite。

## 后续建议

1. 下一优先级是 AG-01：给 LangGraph fallback 增加显式开关，默认关闭或至少可关闭，避免迁移 scene 悄悄回到 OpenClaw。
2. 随后做 AG-02：落地项目内 LLM tool/client，并替换 `tool://llm/openclaw-sales-agent-default@v1` 的主链路语义。
3. AG-03/AG-04/AG-05 再分别切三个销售机会场景；其中 directdb 已有较多基础，适合在 AG-02 后较快纯项目化。
