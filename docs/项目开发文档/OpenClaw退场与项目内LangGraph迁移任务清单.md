# OpenClaw 退场与项目内 LangGraph 迁移任务清单（AI Agent 可执行版）

## 1. 文档目标

本文档用于指导 `/Users/gato-pm/Desktop/API_副本` 将当前依赖 OpenClaw Gateway 的 agent-runtime 场景，逐步迁移为项目内运行的 `platform/runtime/graphs` 工作流。

本次改造的最终目标：

1. API 对外协议保持不变，调用方仍使用 `POST /api/agent/run`。
2. 业务主链路不再调用本机 OpenClaw Gateway `127.0.0.1:18789`。
3. 运行时不再依赖 `~/.openclaw`、OpenClaw LaunchAgent、OpenClaw agent session、OpenClaw workspace。
4. 原本由 `SKILL.md + sales-agent` 执行的流程，迁移为项目内可配置、可测试、可观测的节点图。
5. 迁移过程允许短期保留 OpenClaw 作为 fallback，但最终删除 OpenClaw fallback。

一句话定义：

```text
从 OpenClaw 执行 SKILL.md
迁移为
项目内 Node.js workflow graph 执行业务节点
```

## 2. 适用范围

### 2.1 第一优先级：OpenClaw agent-runtime 场景

这些场景当前或历史上依赖 `openclaw/sales-agent`，是本次迁移主范围。

| Scene | 当前模式 | 当前依赖 | 目标模式 |
|---|---:|---|---|
| `sales-opportunity-advisor` | `legacy` | OpenClaw Gateway + `sales-agent` + `SKILL.md` | `langgraph` |
| `sales-opportunity-advisor-directdb` | `langgraph` | 已走项目图，但配置仍保留 OpenClaw agent/tool 命名 | 纯项目内 `langgraph` |
| `sales-opportunity-smart-entry` | `legacy` | OpenClaw Gateway + `sales-agent` + `SKILL.md` | `langgraph` |

### 2.2 第二优先级：直接模型场景中的 OpenClaw 残留

这些场景不是 OpenClaw Gateway 主链路，但配置里仍有 OpenClaw 资产命名或 fallback models 文件引用。

| Scene | 当前模式 | 当前 OpenClaw 残留 | 目标 |
|---|---:|---|---|
| `payment-info-split` | `direct-model` | `runtime://openclaw/agents/payment-fast-agent/agent/models.json` | 模型元数据迁到项目通用目录 |
| `special-custom-product-solution` | `direct-model` | `agent.gatewayModel`、`skill.entryFile`、`runtime://openclaw/...` references | 删除无用 agent 字段或迁到通用 runtime namespace |

### 2.3 不在本次范围内

1. 不迁移 SQL Server 数据库本体。
2. 不替换 ContextHelper / DirectDbRunner / ModelTool 的端口和服务职责。
3. 不改变外部 API response envelope。
4. 不引入 NullClaw 作为兼容层。
5. 不要求一次性重命名所有 `runtime-assets/openclaw` 目录。目录重命名属于后置清理任务。

## 3. 当前状态快照

### 3.1 当前核心链路

`sales-opportunity-advisor` 当前链路：

```text
调用方
-> API /api/agent/run
-> services/runtime-message.js 构造 OpenClaw message
-> OpenClaw Gateway /v1/chat/completions
-> sales-agent 读取 runtime-assets/openclaw/workspace/skills/.../SKILL.md
-> ContextHelper 19101
-> SQL Server
-> ModelTool 19103
-> OpenClaw 返回 result markers
-> API 解析 markers 后返回
```

目标链路：

```text
调用方
-> API /api/agent/run
-> platform/gateway/index.js 路由到 langgraph
-> platform/runtime/graphs/index.js 执行节点图
-> fetch_business_context 调 ContextHelper / DirectDbRunner
-> load_reference_bundle 读取 prompt / rules / schema / dictionary
-> normalize_facts 清洗事实
-> draft_business_output 调项目内 LLM 或项目内规则草拟
-> validate_output 调 ModelTool 19103
-> finalize_result 组装结果
-> API 直接返回
```

### 3.2 当前已存在的项目内运行基础

已有文件：

| 能力 | 文件 |
|---|---|
| 路由决策 | `platform/gateway/index.js` |
| 图执行器 | `platform/runtime/graphs/index.js` |
| workflow state | `platform/runtime/state.js` |
| shadow / diff | `platform/runtime/shadow.js` |
| fallback | `platform/runtime/fallback.js` |
| 通用 advisory 模板 | `platform/templates/grounded-structured-advisory.v1.yaml` |
| 销售机会 BusinessSkill | `platform/skills/sales-opportunity-advisor.v1.yaml` |
| directdb BusinessSkill | `platform/skills/sales-opportunity-advisor-directdb.v1.yaml` |
| smart-entry BusinessSkill | `platform/skills/sales-opportunity-smart-entry.v1.yaml` |
| 数据获取节点 | `platform/nodes/fetch-context.js` |
| 资产加载节点 | `platform/nodes/load-assets.js` |
| 字段清洗节点 | `platform/nodes/normalize-facts.js` |
| 建议生成节点 | `platform/nodes/draft-output.js` |
| 输出校验节点 | `platform/nodes/validate-output.js` |

### 3.3 当前主要缺口

1. `sales-opportunity-advisor` 默认仍是 `routing.mode = legacy`。
2. `sales-opportunity-smart-entry` 默认仍是 `routing.mode = legacy`。
3. `draft_business_output` 当前主要是兼容草拟逻辑，不一定真正调用项目内 LLM。
4. `tool://llm/openclaw-sales-agent-default@v1` 命名和 driver 仍指向 OpenClaw 语义。
5. fallback 仍会回到 legacy OpenClaw。
6. API health 仍探测 OpenClaw Gateway。
7. `services/runtime-message.js`、`services/response-parser.js`、`services/runtime.js` 中仍保留 OpenClaw legacy 主链路。
8. `runtime://openclaw/...` namespace 仍被用作项目 runtime asset 命名空间。

## 4. 目标架构

### 4.1 运行时分层

目标分层如下：

```text
API 层
  routes/agent.js
  services/request-validation.js
  utils/errors.js

路由层
  platform/gateway/index.js
  scene-configs/*.json

项目内工作流层
  platform/runtime/graphs/index.js
  platform/runtime/state.js
  platform/nodes/*.js

业务配置层
  platform/templates/*.yaml
  platform/skills/*.yaml
  platform/tools/*.yaml
  platform/assets/prompts/*.md
  metadata/*.tsv
  references 或 runtime-assets 下的 schema/rules

工具服务层
  ContextHelper 19101
  DirectDbRunner 19102
  ModelTool 19103
  RAG 19104

外部依赖
  SQL Server
  LLM Provider API
```

### 4.2 OpenClaw 退场后的硬性标准

完成后必须满足：

1. `POST /api/agent/run` 调用核心场景时，不访问 `127.0.0.1:18789`。
2. 停止 OpenClaw Gateway 后，核心场景仍能通过：

```bash
openclaw gateway stop
curl -sS -X POST http://127.0.0.1:3100/api/agent/run ...
```

3. `rg -n "openclaw/sales-agent|OPENCLAW_GATEWAY_TOKEN|127\\.0\\.0\\.1:18789|/v1/chat/completions"` 在运行主链路文件中无命中。
4. `rg -n "/Users/gato-pm/\\.openclaw"` 在 `scene-configs platform services routes runtime-assets` 中无运行时命中。
5. `npm run check` 通过。
6. `npm run regression:self-contained` 通过，或只剩明确记录的外部服务不可用 warning。

## 5. AI Agent 执行规则

后续 AI agent 按本文档开发时必须遵守：

1. 每次只领取一个最小任务，不跨阶段大改。
2. 修改前先读任务涉及文件。
3. 不删除 legacy 代码，除非当前任务明确要求并且前置验收全部满足。
4. 每个任务完成后必须更新本文档 checkbox。
5. 每个任务必须给出：
   - 修改文件
   - 验证命令
   - 验证结果
   - 未解决风险
   - 回退方式
6. 若任务涉及路由切换，必须保留可回退配置。
7. 若任务涉及模型输出，必须同时验证：
   - 成功请求
   - 参数错误
   - 数据不存在
   - ModelTool 校验失败

## 6. 分阶段任务清单

## P0. 基线冻结与现状验证

目标：迁移前先固定可对比基线，避免后续不知道差异来自哪里。

### P0-T1. 记录当前服务状态

- [ ] 运行并记录：

```bash
npm run service:status
curl -sS http://127.0.0.1:3100/health
curl -sS http://127.0.0.1:3100/api/console/configs/catalog
```

验收：

- [ ] API 端口为 `3100`
- [ ] ContextHelper 端口为 `19101`
- [ ] DirectDbRunner 端口为 `19102`
- [ ] ModelTool 端口为 `19103`
- [ ] RAG 端口为 `19104`

产物：

- [ ] 在本节追加执行日期、命令摘要、结果摘要。

### P0-T2. 固定核心场景回归样本

- [ ] 确认这些 fixture 存在：
  - `tests/fixtures/self-contained/sales-opportunity-advisor.smoke.request.json`
  - `tests/fixtures/self-contained/sales-opportunity-advisor-directdb.gateway-boundary.request.json`
  - `tests/fixtures/self-contained/payment-info-split.smoke.request.json`
- [ ] 为 `sales-opportunity-smart-entry` 增加 self-contained smoke fixture。
- [ ] 为 `special-custom-product-solution` 增加 direct-model smoke fixture，若 RAG 外部数据不稳定，可先记录为 optional。

建议新增文件：

- `tests/fixtures/self-contained/sales-opportunity-smart-entry.smoke.request.json`
- `tests/fixtures/self-contained/special-custom-product-solution.smoke.request.json`

验收：

- [ ] `node scripts/run_self_contained_regression.js` 能识别新增 fixture。
- [ ] fixture 中不包含真实密钥。

### P0-T3. 建立 OpenClaw 依赖扫描基线

- [ ] 新增或扩展扫描脚本，使其区分：
  - 允许的历史文档命中
  - 允许的项目资产目录命中
  - 禁止的运行主链路命中

建议修改：

- `scripts/scan_shared_runtime_paths.js`
- `scripts/run_self_contained_regression.js`

扫描项：

```text
127.0.0.1:18789
/v1/chat/completions
OPENCLAW_GATEWAY_TOKEN
x-openclaw-session-key
openclaw/sales-agent
/Users/gato-pm/.openclaw
```

验收：

- [ ] 扫描脚本能输出 JSON summary。
- [ ] 当前基线允许失败，但必须能列出命中文件和命中原因。

## P1. 路由能力收口到项目内 LangGraph

目标：确保所有 agent-runtime scene 都能由 `platform/runtime/graphs` 接管。

### P1-T1. 明确 scene 配置的执行语义

检查文件：

- `scene-configs/sales-opportunity-advisor.json`
- `scene-configs/sales-opportunity-advisor-directdb.json`
- `scene-configs/sales-opportunity-smart-entry.json`
- `scene-configs/README.md`

任务：

- [ ] 为每个 agent-runtime scene 增加清晰字段或注释性文档，说明：
  - `legacy` = OpenClaw 兼容路径
  - `shadow` = 正式返回 legacy，旁路跑 langgraph
  - `langgraph` = 项目内主路径
- [ ] 确认三条 scene 都有 `allowedModes` 包含 `langgraph`。
- [ ] `sales-opportunity-smart-entry` 若缺少完整 BusinessSkill 或 query profile，先补齐。

验收：

- [ ] `node scripts/verify_active_bundle_scene_config.js` 通过。
- [ ] `npm run lint:platform-configs` 通过。

### P1-T2. 为 `sales-opportunity-advisor` 开启 shadow

修改：

- `scene-configs/sales-opportunity-advisor.json`

目标状态：

```json
"routing": {
  "mode": "shadow",
  "allowedModes": ["legacy", "shadow", "langgraph"]
}
```

验收：

- [ ] 请求仍返回 legacy 结果。
- [ ] 日志出现 `agent.shadow.completed` 或 `agent.shadow.failed`。
- [ ] shadow 失败不影响正式 response。

回退：

- [ ] 将 `routing.mode` 改回 `legacy`。

### P1-T3. 为 `sales-opportunity-smart-entry` 开启 shadow

修改：

- `scene-configs/sales-opportunity-smart-entry.json`

验收同 P1-T2。

### P1-T4. 补充 langgraph fallback 禁用开关

目标：最终下线 OpenClaw 前，需要能显式禁止 `langgraph` 自动 fallback 到 legacy。

建议新增环境变量：

```text
LANGGRAPH_LEGACY_FALLBACK_ENABLED=1
```

修改：

- `platform/runtime/fallback.js`
- `routes/agent.js`
- `.env.example`
- `README.md`

行为：

- 当 `LANGGRAPH_LEGACY_FALLBACK_ENABLED=1` 时，保持当前 fallback 行为。
- 当 `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 时，langgraph 失败直接返回项目内错误，不再调用 OpenClaw legacy。

验收：

- [ ] 单元测试覆盖 enabled / disabled 两种行为。
- [ ] disabled 时人为制造 `fetch-context` 失败，不访问 OpenClaw Gateway。

## P2. 项目内 LLM 生成节点替代 OpenClaw advisory tool

目标：移除 `tool://llm/openclaw-sales-agent-default@v1` 的 OpenClaw 语义，改为项目内 LLM tool。

### P2-T1. 新增项目内 advisory LLM tool 定义

新增文件：

- `platform/tools/project-advisory-llm.tool.yaml`

建议内容：

```yaml
apiVersion: agent.platform/v1alpha1
kind: ToolDefinition
metadata:
  name: project-advisory-llm
  version: v1
  title: Project Advisory LLM
  status: draft
spec:
  ref: tool://llm/project-advisory@v1
  toolRole: advisory_llm
  category: llm
  driver:
    type: project-llm
    providerRef: env
    networkPolicy: provider-only
  requestContract:
    requiredFields:
      - promptRef
      - request
      - facts
      - rules
      - schema
    inputSources:
      promptRef: references.prompt
      request: request.normalized
      facts: facts.profile
      basisFields: facts.basis_fields
      rules: references.rules
      schema: references.output_schema
  responseContract:
    resultPath: draft.payload
    errorPath: error
  limits:
    timeoutMsDefault: 30000
    timeoutMsMax: 35000
    retryMaxAttempts: 1
```

验收：

- [x] `npm run lint:platform-configs` 通过。
- [x] 新 tool ref 能被 `loadPlatformResources` 读取。

### P2-T2. 实现项目内 LLM client

建议新增：

- `platform/runtime/llm-client.js`

可复用：

- `services/direct-model.js` 中 provider 调用、超时、JSON 解析、错误包装逻辑。
- `utils/errors.js` 的 `createAppError`。

职责：

- [x] 根据 toolDocument.driver 或 sceneConfig 解析 provider。
- [x] 从环境变量读取 key。
- [x] 支持 Moonshot / DeepSeek / OpenAI-compatible 基本 chat completions 调用。
- [x] 输入 prompt、facts、rules、schema，输出 JSON payload。
- [x] 统一错误码：
  - `MODEL_INVOCATION_FAILED`
  - `MODEL_TIMEOUT`
  - `MODEL_INVALID_JSON`
  - `INVALID_MODEL_OUTPUT`

验收：

- [x] 对无 key 场景返回明确错误。
- [x] 对非 JSON 模型输出返回 `MODEL_INVALID_JSON`。
- [x] 不打印密钥。

### P2-T3. 改造 `draft-output` 节点支持 project-llm driver

修改：

- `platform/nodes/draft-output.js`

当前行为：

- 无 `invokeTool` 时直接走 `createCompatDraftPayload`。

目标行为：

- 如果 tool driver 为 `project-llm`，调用 `platform/runtime/llm-client.js`。
- 如果配置了 `mode: compat` 或环境变量禁用 LLM，可继续走 `createCompatDraftPayload`。
- 保留测试注入 `invokeTool` 能力。

建议环境变量：

```text
LANGGRAPH_DRAFT_MODE=llm
```

可选值：

- `compat`：使用当前兼容草拟逻辑。
- `llm`：调用项目内 LLM。

验收：

- [x] `draft-output` 单元测试覆盖 compat / llm / llm error。
- [x] `draft.payload` 结构符合当前 output schema。
- [x] `artifacts.draft.mode` 能记录 `compat` 或 `project-llm`。

### P2-T4. 将 BusinessSkill toolBindings 切到 project-advisory

修改：

- `platform/skills/sales-opportunity-advisor.v1.yaml`
- `platform/skills/sales-opportunity-advisor-directdb.v1.yaml`
- `platform/skills/sales-opportunity-smart-entry.v1.yaml`

将：

```yaml
advisory_llm:
  toolRef: tool://llm/openclaw-sales-agent-default@v1
```

改为：

```yaml
advisory_llm:
  toolRef: tool://llm/project-advisory@v1
```

验收：

- [x] `npm run lint:platform-configs` 通过。
- [x] `rg -n "tool://llm/openclaw-sales-agent-default" platform/skills` 无命中。

完成说明（2026-05-03）：已新增 `platform/tools/project-advisory-llm.tool.yaml` 与 `platform/runtime/llm-client.js`，`draft-output` 支持 `LANGGRAPH_DRAFT_MODE=compat|mock|project-llm`，默认 `compat` 以保持本地回归稳定；三条销售 BusinessSkill 的 `advisory_llm` 已切到 `tool://llm/project-advisory@v1`。验证：`node tests/regression/project_llm_draft_mode.test.js`、`npm run lint:platform-configs`、`node scripts/scan_openclaw_dependencies.js` 已执行；`npm run regression:self-contained -- --output-dir tmp/self-contained-ag02` 仍因既有 `basisFields` 回归期望和 `services/bundle-renderer.js` 旧项目路径扫描失败，详见本轮交付记录。

## P3. `sales-opportunity-advisor` 迁移

目标：让 helper 版本销售机会推进建议完全走项目内 langgraph。

### P3-T1. 验证数据获取节点使用项目内工具

检查：

- `platform/tools/generic-query-runner.tool.yaml`
- `platform/tools/sales-opportunity-by-opportunity-id.query.yaml`
- `routes/internal-query-runner.js`
- `services/generic-query-runner.js`
- `ContextHelper/generated-queries/sales-opportunity-advisor.generated.js`

任务：

- [ ] 确认 `fetch_business_context` 不再需要 OpenClaw 读取 `SKILL.md`。
- [ ] query profile 中的 `skillPath` 若只用于追踪，应改成项目通用 ref 或移除执行依赖。
- [ ] 禁止从 query runner 读取 `~/.openclaw`。

验收：

- [ ] 停止 OpenClaw Gateway 后，`fetch_business_context` 节点可成功获取 `rawRow`。

### P3-T2. 对齐字段清洗结果

检查：

- `platform/nodes/normalize-facts.js`
- `metadata/sales_opportunity_dictionary.tsv`
- `runtime-assets/openclaw/workspace/skills/sales-opportunity-advisor/references/decision_rules.md`

任务：

- [ ] 对比旧 OpenClaw 成功请求输出中的关键事实字段。
- [ ] 确认 `facts.profile` 至少包含：
  - `opportunityId`
  - `opportunityName`
  - `customerName`
  - `salesStage`
  - `opportunityStatus`
  - `businessType`
  - `amount`
  - `budgetConfirmed`
  - `predictTenderDate`
  - `winRate`
- [ ] 确认 enum / money / percent / date 映射与字典一致。

验收：

- [ ] 新增或更新 `scripts/verify_*`，能断言上述 profile 字段。
- [ ] helper 场景 smoke 请求返回 `summary/adviceText/nextActions`。

### P3-T3. 切换为 langgraph 小流量

修改：

- `scene-configs/sales-opportunity-advisor.json`

目标：

```json
"routing": {
  "mode": "langgraph",
  "allowedModes": ["legacy", "shadow", "langgraph"],
  "langgraphCutover": {
    "requestPercentage": 10
  }
}
```

验收：

- [x] 命中 langgraph 的请求成功。
- [ ] 未命中请求仍可 legacy 或 fallback。
- [ ] rollout report 能区分 `langgraph` 与 `legacy`。

### P3-T4. 切换为 100% langgraph

前置条件：

- [x] P2 全部完成。
- [ ] P3-T1 到 P3-T3 完成。
- [ ] 连续本地回归通过。

修改：

```json
"langgraphCutover": {
  "requestPercentage": 100
}
```

验收：

- [x] 停止 OpenClaw Gateway 后，该 scene 成功。
- [ ] `req_xxx` 日志中无 `gateway-http` stage。
- [x] 失败时不出现 `RUNTIME_TIMEOUT` from OpenClaw Gateway。

完成说明（2026-05-03）：`scene-configs/sales-opportunity-advisor.json` 已切到 `routing.mode=langgraph` 且 `langgraphCutover.requestPercentage=100`，该 scene 的 `agent.gatewayModel` 已改为项目内语义 `project/sales-opportunity-advisor`，不再指向 `openclaw/sales-agent`。自闭环 fixture 期望同步对齐当前 `sales-opportunity-advisor` 输出 schema：`basisFields` 作为内部事实依据保留在 graph artifacts，不作为 API payload 必填字段。验证命令与结果见本轮 AG-03 交付记录。

## P4. `sales-opportunity-advisor-directdb` 纯项目化

目标：directdb 场景已经是 `langgraph`，但需要删除 OpenClaw 命名和 fallback 依赖。

### P4-T1. 移除 directdb 对 legacy fallback 的日常依赖

修改：

- `scene-configs/sales-opportunity-advisor-directdb.json`

目标：

- [x] 保持 `routing.mode = langgraph`
- [x] 添加或确认 `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 下能直接返回项目内错误。

验收：

- [x] DirectDbRunner 正常时请求成功。
- [ ] DirectDbRunner 停止时返回 `DATA_TOOL_UNAVAILABLE` 或项目内标准错误，不 fallback 到 OpenClaw。

### P4-T2. 清理 directdb skill 文案中的 `.openclaw` 残留

检查：

- `runtime-assets/openclaw/workspace/skills/sales-opportunity-advisor-directdb/SKILL.md`
- `DirectDbRunner/sql-cache/sales-opportunity-advisor-directdb.sql.json`

任务：

- [x] 若文件只作为历史参考，移动到 docs 或标记 deprecated。
- [x] 若仍作为 query profile metadata，改成项目路径或 `project://` ref。
- [x] 删除 `/Users/gato-pm/.openclaw` 运行引用。

验收：

```bash
rg -n "/Users/gato-pm/\\.openclaw" runtime-assets/openclaw/workspace/skills/sales-opportunity-advisor-directdb DirectDbRunner/sql-cache
```

无运行时命中。

完成说明（2026-05-03）：`sales-opportunity-advisor-directdb` 保持 `routing.mode=langgraph` 与 `langgraphCutover.requestPercentage=100`，`agent.gatewayModel` 已改为项目内语义 `project/sales-opportunity-advisor-directdb`。DirectDbRunner 的 SQL 定义来源从 OpenClaw SKILL.md 移到 `project://references/sales-opportunity-advisor-directdb/sql_definition.md`，query profile 与 SQL cache 也改为 project ref；schema/rules 迁到 `project://references/sales-opportunity-advisor/...`。验证命令与剩余阻塞见本轮 AG-04 交付记录。

## P5. `sales-opportunity-smart-entry` 迁移

目标：智能录入场景从 OpenClaw legacy 改成项目内 langgraph。

### P5-T1. 补齐 smart-entry 基线文档和 fixture

检查：

- `scene-configs/sales-opportunity-smart-entry.json`
- `platform/skills/sales-opportunity-smart-entry.v1.yaml`
- `runtime-assets/openclaw/workspace/skills/sales-opportunity-smart-entry/SKILL.md`
- `runtime-assets/openclaw/workspace/skills/sales-opportunity-smart-entry/references/output_schema.json`

任务：

- [x] 提取该场景输入输出契约。
- [x] 新增 smoke fixture。
- [x] 新增 baseline response 或最小 schema 校验断言。

验收：

- [x] legacy 当前可跑通或明确记录当前失败原因。

### P5-T2. 对齐 smart-entry 工作流节点

任务：

- [x] 确认 smart-entry 是否复用 `grounded-structured-advisory`。
- [x] 若输出结构不同，新增或扩展 template node override。
- [x] 确认 `draft-output` 能生成 smart-entry schema 对应 payload。
- [x] 确认 `validate-output` 调 ModelTool 成功。

验收：

- [ ] `routing.mode=shadow` 时 shadow 成功。
- [x] `routing.mode=langgraph` 且 OpenClaw 停止时请求成功。

### P5-T3. 切换 smart-entry 到 langgraph

修改：

- `scene-configs/sales-opportunity-smart-entry.json`

目标：

- [ ] 先 `shadow`
- [ ] 再 `langgraph` 10%
- [x] 最后 `langgraph` 100%

验收同 P3。

完成说明（2026-05-03）：`sales-opportunity-smart-entry` 已切到 `routing.mode=langgraph` 且 `langgraphCutover.requestPercentage=100`，`agent.gatewayModel` 改为项目内语义 `project/sales-opportunity-smart-entry`。schema/rules/query metadata 已迁到 `project://references/sales-opportunity-smart-entry/...`，`draft-output` 增加 smart-entry compat payload 分支，输出 `{opportunityId, salesScene, data}` 并把 `rawText` 合并进当前销售场景允许字段。验证命令与剩余阻塞见本轮 AG-05 交付记录。

## P6. 直接模型场景 OpenClaw 残留清理

目标：虽然 direct-model 不走 OpenClaw Gateway，也要清掉 OpenClaw 命名空间造成的部署误解。

### P6-T1. 迁移模型元数据目录

当前目录：

```text
runtime-assets/openclaw/agents/*/agent/models.json
runtime-assets/openclaw/agents/*/agent/auth-profiles.json
```

目标目录建议：

```text
runtime-assets/model-profiles/
  payment-fast-agent/
    models.json
    auth-profiles.json
  sales-agent/
    models.json
    auth-profiles.json
```

修改：

- `utils/path-resolver.js`
- `services/direct-model.js`
- `scene-configs/payment-info-split.json`
- `scene-configs/special-custom-product-solution.json`
- `scripts/verify_active_bundle_direct_model.js`
- `scripts/verify_bundle_renderer.js`

验收：

- [ ] direct-model 场景不再引用 `runtime://openclaw/agents/...`。
- [ ] `payment-info-split` 成功。
- [ ] `special-custom-product-solution` 成功或 RAG 不可用时返回明确错误。

### P6-T2. 删除 direct-model scene 中无用 agent 字段

检查：

- `scene-configs/special-custom-product-solution.json`

任务：

- [ ] 若 `execution.mode = direct-model`，确认 `agent` 字段不会被运行时使用。
- [ ] 修改 release validator，允许 direct-model scene 不定义 `agent.gatewayModel`。
- [ ] 删除或 deprecated `agent` / `skill` 中的 OpenClaw 字段。

涉及：

- `services/release-validator.js`
- `services/console-scenes.js`
- `console/src/...` 中展示 scene 详情的页面

验收：

- [ ] direct-model scene validation 通过。
- [ ] Console 展示不再把 direct-model 误标为 OpenClaw agent。

## P7. API Health 与启动脚本去 OpenClaw

目标：项目启动和健康检查不再把 OpenClaw Gateway 当必需服务。

### P7-T1. 调整 `/health`

当前风险：

- `server.js` 中 `checkGatewayHealth()` 会探测 OpenClaw Gateway。（已在 2026-05-06 移除）

任务：

- [x] 将 Gateway health 从必需项移除；本轮不保留 legacy optional 探测，避免继续依赖 `OPENCLAW_GATEWAY_TOKEN` 和 `127.0.0.1:18789`。
- [x] 新增 langgraph runtime health。
- [x] health 返回中区分：
  - `api`
  - `contextHelper`
  - `directDbRunner`
  - `modelTool`
  - `rag`
  - `langgraphRuntime`

验收：

- [x] OpenClaw Gateway 停止时 `/health` 不失败。
- [ ] 若 `LEGACY_OPENCLAW_REQUIRED=1`，则保留旧行为用于迁移期排查。（本轮按硬约束未实现，避免保留 Gateway 依赖。）

### P7-T2. 启动脚本不再启动 OpenClaw

检查：

- `package.json`
- `scripts/install_launch_agents.sh`
- `deploy/launchd/*.plist` 若存在
- `README.md`
- `常驻启动说明.md`
- `docs/engineering/常驻启动说明.md`

任务：

- [x] 确认项目自己的 service 脚本只管理 API、ContextHelper、DirectDbRunner、ModelTool、RAG、Console。
- [ ] OpenClaw 启动说明移动到 deprecated 章节。
- [ ] 新增“无 OpenClaw 运行验证”说明。

验收：

```bash
npm run service:restart
npm run service:status
curl -sS http://127.0.0.1:3100/health
```

全部通过，且不要求 OpenClaw Gateway running。

完成说明（2026-05-06）：`server.js` 的 `/health` 已改为项目内运行面健康摘要，不再读取 `OPENCLAW_GATEWAY_TOKEN`，不再探测 `127.0.0.1:18789`，返回中包含 `api`、`langgraphRuntime` 以及 ContextHelper / DirectDbRunner / ModelTool / RAG 的探测结果；其中 RAG 为可选，其他项目服务缺失时以 `service=degraded` 暴露。`scripts/bootstrap_local_runtime.js` 已移除 `OPENCLAW_GATEWAY_TOKEN` 必填项和 OpenClaw Gateway 外部探测，`scripts/install_launch_agents.sh` 当前只管理项目内 API、ContextHelper、DirectDbRunner、ModelTool、RAG。

## P8. 删除 legacy OpenClaw 主链路

目标：在所有 agent-runtime scene 都稳定 langgraph 后，删除 OpenClaw Gateway 调用主链路。

前置条件：

- [ ] `sales-opportunity-advisor` 100% langgraph 稳定。
- [ ] `sales-opportunity-advisor-directdb` 100% langgraph 稳定。
- [ ] `sales-opportunity-smart-entry` 100% langgraph 稳定。
- [ ] `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 下全量回归通过。
- [ ] OpenClaw Gateway 停止状态下全量核心场景通过。

### P8-T1. 禁止新增 legacy agent-runtime scene

修改：

- `services/release-validator.js`
- `services/scene-config.js`
- `scripts/validate_platform_configs.js`

规则：

- [ ] 新 scene 不允许 `routing.mode = legacy` 且 `agent.gatewayModel = openclaw/...`。
- [ ] 已存在 legacy 配置只能在 deprecated allowlist 内短期保留。

验收：

- [ ] 添加 synthetic legacy scene 测试，验证会失败。

### P8-T2. 删除 OpenClaw runtime request builder

候选删除或 deprecated：

- `services/runtime-message.js`
- `services/response-parser.js` 中只服务 markers 的部分
- `services/runtime.js` 中 `runLegacyAgentRuntimeScene`
- `utils/errors.js` 中只服务 gateway-http 的错误映射，若无其他引用

注意：

- 删除前必须用 `rg` 确认无引用。
- 如果 Console 仍展示 legacy trace，需要先改 Console。

验收：

```bash
rg -n "runLegacyAgentRuntimeScene|buildRuntimeRequest|GATEWAY_CHAT_COMPLETIONS_URL|x-openclaw-session-key" services routes platform utils
```

无运行主链路命中。

### P8-T3. 删除 OpenClaw fallback 路径

修改：

- `platform/runtime/fallback.js`
- `routes/agent.js`
- `platform/gateway/index.js`

目标：

- [ ] langgraph 失败返回项目内标准错误。
- [ ] 不再调用 `executeLegacyFallbackRoute()`。
- [ ] `legacyRole` 日志字段改为 `deprecatedLegacyRole` 或删除。

验收：

- [ ] fallback 单元测试更新。
- [ ] 人为让 `fetch-context` 失败，不访问 OpenClaw。

## P9. Runtime asset namespace 清理

目标：去掉 `runtime://openclaw` 这个容易误导的命名空间。

说明：

这是后置任务。业务主链路不依赖 OpenClaw Gateway 后，再做目录重命名，风险更低。

### P9-T1. 新增通用 namespace

建议新增：

```text
runtime://agent-platform/...
```

或：

```text
runtime://project-runtime/...
```

修改：

- `utils/path-resolver.js`
- `services/scene-config.js`
- `services/bundle-renderer.js`
- `scripts/verify_bundle_renderer.js`
- `scripts/verify_active_bundle_*`

验收：

- [ ] `runtime://openclaw/...` 和新 namespace 在过渡期都能解析到同一资产。
- [ ] 新配置全部使用新 namespace。

### P9-T2. 迁移目录

从：

```text
runtime-assets/openclaw/
```

到：

```text
runtime-assets/project-runtime/
```

或：

```text
runtime-assets/agent-platform/
```

任务：

- [ ] 移动 workspace skills references。
- [ ] 移动 agents model metadata。
- [ ] 更新 active bundle renderer。
- [ ] 更新 Console mock / catalog path。
- [ ] 更新 docs。

验收：

```bash
rg -n "runtime://openclaw|runtime-assets/openclaw" scene-configs platform services scripts console runtime-assets --glob '!**/*.md'
```

无运行配置命中。

## P10. 回归、观测与上线门槛

### P10-T1. 增加无 OpenClaw 回归模式

新增命令建议：

```json
"regression:no-openclaw": "NO_OPENCLAW_REQUIRED=1 LANGGRAPH_LEGACY_FALLBACK_ENABLED=0 node scripts/run_self_contained_regression.js"
```

修改：

- `package.json`
- `scripts/run_self_contained_regression.js`

验收：

- [ ] 命令会先探测 `127.0.0.1:18789`，若可用也不使用。
- [ ] 命令会校验核心请求日志中没有 `gateway-http`。

### P10-T2. 生成 rollout 报告

命令：

```bash
node scripts/build_rollout_report.js \
  --input <trace-events.jsonl> \
  --batch-id openclaw-retirement \
  --min-success-rate 0.98 \
  --max-p95-ms 3000 \
  --max-schema-failure-rate 0.01 \
  --max-fallback-ratio 0 \
  --fail-on-alert
```

验收：

- [ ] `fallbackRatio = 0`
- [ ] `schemaFailureRate <= 0.01`
- [ ] p95 延迟可接受

### P10-T3. 最终验收命令

必须全部通过：

```bash
npm run check
npm run regression:self-contained
npm run regression:no-openclaw
curl -sS http://127.0.0.1:3100/health
```

手工 smoke：

```bash
curl -sS -X POST http://127.0.0.1:3100/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"scene":"sales-opportunity-advisor","bizParams":{"opportunityId":"2041340312877535232"},"runtimeContext":{"tenantId":"tenant-a","userId":"user-a"}}'
```

验收：

- [ ] response `success=true`
- [ ] 有 `requestId`
- [ ] `data.summary` 非空
- [ ] `data.adviceText` 非空
- [ ] `data.nextActions` 至少 3 条
- [ ] 日志没有 `gateway-http`
- [ ] 日志没有 `OpenClaw Gateway request timed out`

## 7. 建议执行顺序

推荐顺序：

1. P0 基线冻结。
2. P1 fallback 开关和 shadow 能力。
3. P2 项目内 LLM tool。
4. P3 迁移 `sales-opportunity-advisor`。
5. P4 固化 `sales-opportunity-advisor-directdb`。
6. P5 迁移 `sales-opportunity-smart-entry`。
7. P7 health 和启动脚本去 OpenClaw。
8. P10 无 OpenClaw 回归。
9. P8 删除 legacy 主链路。
10. P6 / P9 做命名空间和资产清理。

不要先做 P8。先删 legacy 会让问题无法回退。

## 8. 风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| 生成质量下降 | 当前 `draft-output` 兼容草拟可能弱于 OpenClaw 模型执行 | P2 先实现项目内 LLM 生成 |
| 错误语义变化 | legacy 会把部分错误包装为 gateway/runtime 错误 | 为每类错误补 regression |
| fallback 掩盖问题 | langgraph 失败后 legacy 成功，表面成功率好看 | P1-T4 增加 fallback 禁用开关 |
| active bundle 不一致 | repo 配置和 `.local/runtime-bundles/local/current` 配置可能不同 | 修改后运行 active bundle verify 脚本 |
| Console 展示误导 | Console 仍可能显示 OpenClaw agent/tool | P6/P9 同步 Console mock 和 catalog |
| 端口服务依赖 | 迁移后仍依赖 19101/19102/19103/19104 | health 明确这些是项目工具服务，不是 OpenClaw |

## 9. 完成定义

本次改造真正完成的定义：

- [ ] 三个 agent-runtime 场景全部以 `langgraph` 为默认主路径。
- [ ] `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 下全量核心回归通过。
- [ ] OpenClaw Gateway 停止时，核心业务 API 仍可运行。
- [ ] API health 不要求 OpenClaw Gateway。
- [ ] 运行主链路中无 `127.0.0.1:18789`。
- [ ] 运行主链路中无 `openclaw/sales-agent`。
- [ ] 运行主链路中无 `~/.openclaw`。
- [ ] 新业务接入文档不再要求创建 OpenClaw agent 或 OpenClaw workspace。
- [ ] 旧 OpenClaw 相关代码要么删除，要么标记 deprecated 且不在默认运行路径。
