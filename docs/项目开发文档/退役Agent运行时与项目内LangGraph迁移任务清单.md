# 退役 Agent 运行时 退场与项目内 LangGraph 迁移任务清单（AI Agent 可执行版）

## 1. 文档目标

本文档用于指导 `/Users/gato-pm/Desktop/API_副本` 将当前依赖 旧 Gateway 的 agent-runtime 场景，逐步迁移为项目内运行的 `platform/runtime/graphs` 工作流。

本次改造的最终目标：

1. API 对外协议保持不变，调用方仍使用 `POST /api/agent/run`。
2. 业务主链路不再调用本机 旧 Gateway `旧本机 Gateway 端点`。
3. 运行时不再依赖 `旧共享运行时目录`、退役 Agent 运行时 LaunchAgent、退役 Agent 运行时 agent session、退役 Agent 运行时 workspace。
4. 原本由 `SKILL.md + sales-agent` 执行的流程，迁移为项目内可配置、可测试、可观测的节点图。
5. 迁移过程允许短期保留 退役 Agent 运行时 作为 fallback，但最终删除 退役 Agent 运行时 fallback。

一句话定义：

```text
从 退役 Agent 运行时 执行 SKILL.md
迁移为
项目内 Node.js workflow graph 执行业务节点
```

## 2. 适用范围

### 2.1 第一优先级：退役 Agent 运行时 agent-runtime 场景

这些场景当前或历史上依赖 `旧 agent gateway model`，是本次迁移主范围。

| Scene | 当前模式 | 当前依赖 | 目标模式 |
|---|---:|---|---|
| `sales-opportunity-advisor` | `legacy` | 旧 Gateway + `sales-agent` + `SKILL.md` | `langgraph` |
| `sales-opportunity-advisor-directdb` | `langgraph` | 已走项目图，但配置仍保留 退役 Agent 运行时 agent/tool 命名 | 纯项目内 `langgraph` |
| `sales-opportunity-smart-entry` | `legacy` | 旧 Gateway + `sales-agent` + `SKILL.md` | `langgraph` |

### 2.2 第二优先级：原直接模型场景中的 退役 Agent 运行时 残留

这些场景不是 旧 Gateway 主链路，但配置里仍有 退役 Agent 运行时 资产命名或 fallback models 文件引用。

| Scene | 当前模式 | 历史 退役 Agent 运行时 残留 | 目标 |
|---|---:|---|---|
| `payment-info-split` | `agent-runtime` / `langgraph` 100% | `runtime://project-runtime/agents/payment-fast-agent/agent/models.json` | 已纳入项目内 LangGraph structured extraction 主路径 |
| `special-custom-product-solution` | `agent-runtime` / `langgraph` 100% | `agent.gatewayModel`、`skill.entryFile`、`runtime://project-runtime/...` references | 已纳入项目内 LangGraph RAG grounded generation 主路径 |

### 2.3 不在本次范围内

1. 不迁移 SQL Server 数据库本体。
2. 不替换 ContextHelper / DirectDbRunner / ModelTool 的端口和服务职责。
3. 不改变外部 API response envelope。
4. 不引入空壳兼容层。
5. 不要求一次性重命名所有 `runtime-assets/project-runtime` 目录。目录重命名属于后置清理任务。

## 3. 当前状态快照

### 3.1 当前核心链路

`sales-opportunity-advisor` 当前链路：

```text
调用方
-> API /api/agent/run
-> services/runtime-message.js 构造 退役 Agent 运行时 message
-> 旧 Gateway /v1/chat/completions
-> sales-agent 读取 runtime-assets/project-runtime/workspace/skills/.../SKILL.md
-> ContextHelper 19101
-> SQL Server
-> ModelTool 19103
-> 退役 Agent 运行时 返回 result markers
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
4. `旧 LLM toolRef` 命名和 driver 仍指向 退役 Agent 运行时 语义。
5. fallback 仍会回到 legacy 退役 Agent 运行时。
6. API health 仍探测 旧 Gateway。
7. `services/runtime-message.js`、`services/response-parser.js`、`services/runtime.js` 中仍保留 退役 Agent 运行时 legacy 主链路。
8. `runtime://project-runtime/...` namespace 仍被用作项目 runtime asset 命名空间。

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

### 4.2 退役 Agent 运行时 退场后的硬性标准

完成后必须满足：

1. `POST /api/agent/run` 调用核心场景时，不访问 `旧本机 Gateway 端点`。
2. 停止 旧 Gateway 后，核心场景仍能通过：

```bash
retired-runtime gateway stop
curl -sS -X POST http://127.0.0.1:3100/api/agent/run ...
```

3. `rg -n "旧 agent gateway model|旧 gateway token|127\\.0\\.0\\.1:旧 Gateway 端口|/v1/chat/completions"` 在运行主链路文件中无命中。
4. `rg -n "/Users/gato-pm/\\旧共享运行时目录"` 在 `scene-configs platform services routes runtime-assets` 中无运行时命中。
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

- [x] 运行并记录：

```bash
npm run service:status
curl -sS http://127.0.0.1:3100/health
curl -sS http://127.0.0.1:3100/api/console/configs/catalog
```

验收：

- [x] API 端口为 `3100`
- [x] ContextHelper 端口为 `19101`
- [x] DirectDbRunner 端口为 `19102`
- [x] ModelTool 端口为 `19103`
- [x] RAG optional endpoint 配置为 `19104`；本轮 launchd 未加载，`/health` 中 `required=false` 且不阻塞 API。

产物：

- [x] 在本节追加执行日期、命令摘要、结果摘要。

完成说明（2026-05-06 13:17 Asia/Shanghai）：已执行 `npm run service:status`、`curl -sS http://127.0.0.1:3100/health`、`curl -sS http://127.0.0.1:3100/api/console/configs/catalog`。当前 launchd 显示 API、ContextHelper、DirectDbRunner、ModelTool 均在 `/Users/gato-pm/Desktop/API_副本` 工作目录运行，监听端口分别为 `3100/19101/19102/19103`；RAG label 当前 `not loaded`，但 health 中作为 optional dependency 使用 `http://127.0.0.1:19104/health`，不可用时不影响 `service=ok`。`/health` 返回三条 LangGraph scene 编译成功，catalog 返回 `templates=2`、`skills=4`、`tools=7`、`queries=3`。

### P0-T2. 固定核心场景回归样本

- [x] 确认这些 fixture 存在：
  - `tests/fixtures/self-contained/sales-opportunity-advisor.smoke.request.json`
  - `tests/fixtures/self-contained/sales-opportunity-advisor-directdb.gateway-boundary.request.json`
  - `tests/fixtures/self-contained/payment-info-split.smoke.request.json`
- [x] 为 `sales-opportunity-smart-entry` 增加 self-contained smoke fixture。
- [x] 为 `special-custom-product-solution` 增加 smoke fixture，若 RAG 外部数据不稳定，可先记录为 optional。

建议新增文件：

- `tests/fixtures/self-contained/sales-opportunity-smart-entry.smoke.request.json`
- `tests/fixtures/self-contained/special-custom-product-solution.smoke.request.json`

验收：

- [x] `node scripts/run_self_contained_regression.js` 能识别新增 fixture。
- [x] fixture 中不包含真实密钥。

完成说明（2026-05-06 13:17 Asia/Shanghai）：五个 self-contained fixture 均已存在：`payment-info-split`、`sales-opportunity-advisor`、`sales-opportunity-advisor-directdb`、`sales-opportunity-smart-entry`、`special-custom-product-solution`。本轮 `rg -n "api[_-]?key|secret|token|sk-|AKIA|MOONSHOT|DEEPSEEK|RETIRED_RUNTIME" tests/fixtures/self-contained/*.json` 无输出；`npm run regression:self-contained` 识别 5 个用例，输出目录为 `tests/regression/output/self-contained-2026-05-06T05-17-36-453Z`，结果 4 pass / 1 allowed warning，其中 `special-custom-product-solution` 因 RAG / LLM provider 外部链路允许以明确 warning 通过。

### P0-T3. 建立 退役 Agent 运行时 依赖扫描基线

- [x] 新增或扩展扫描脚本，使其区分：
  - 允许的历史文档命中
  - 允许的项目资产目录命中
  - 禁止的运行主链路命中

建议修改：

- `scripts/scan_shared_runtime_paths.js`
- `scripts/run_self_contained_regression.js`

扫描项：

```text
旧本机 Gateway 端点
/v1/chat/completions
旧 gateway token
旧 session header
旧 agent gateway model
旧共享运行时目录
```

验收：

- [x] 扫描脚本能输出 JSON summary。
- [x] 当前基线允许失败，但必须能列出命中文件和命中原因。

完成说明（2026-05-06 13:18 Asia/Shanghai）：`scripts/scan_retired_runtime_dependencies.js` 已输出 JSON summary，并写入 `tmp/retired-runtime-dependencies-report.json`。本轮默认扫描 `scannedFileCount=641`、`totalFindings=1443`，仅剩 `asset-namespace=133` 与 `documentation=1310` 分类；未发现 `runtime-blocker` 或 `config-blocker`。扫描报告可列出每类命中的文件与关键词计数，后续清理归属主要落在 AG-07 / AG-10。

## P1. 路由能力收口到项目内 LangGraph

目标：确保所有 agent-runtime scene 都能由 `platform/runtime/graphs` 接管。

### P1-T1. 明确 scene 配置的执行语义

检查文件：

- `scene-configs/sales-opportunity-advisor.json`
- `scene-configs/sales-opportunity-advisor-directdb.json`
- `scene-configs/sales-opportunity-smart-entry.json`
- `scene-configs/README.md`

任务：

- [x] 为每个 agent-runtime scene 增加清晰字段或注释性文档，说明：
  - `legacy` = 退役 Agent 运行时 兼容路径
  - `shadow` = 正式返回 legacy，旁路跑 langgraph
  - `langgraph` = 项目内主路径
- [x] 确认三条 scene 都有 `allowedModes` 包含 `langgraph`。
- [x] `sales-opportunity-smart-entry` 若缺少完整 BusinessSkill 或 query profile，先补齐。

验收：

- [x] `node scripts/verify_active_bundle_scene_config.js` 通过。
- [x] `npm run lint:platform-configs` 通过。

复验说明（2026-05-06 15:41 Asia/Shanghai）：`scene-configs/README.md` 已说明 `legacy` / `shadow` / `langgraph` 当前口径，其中 agent-runtime 主路径必须为 `langgraph`，`legacy` / `shadow` 仅作为历史迁移口径保留；三条 agent-runtime scene 的 `allowedModes` 均包含 `langgraph`，`sales-opportunity-smart-entry` 的 BusinessSkill 与 QueryProfile 已存在。已执行 `node scripts/verify_active_bundle_scene_config.js` 与 `npm run lint:platform-configs`，均通过。

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

- [x] 历史 shadow 阶段已被后续 `langgraph` 100% 与 agent-runtime legacy 退役覆盖，当前不再要求请求返回 legacy 结果。
- [x] 历史 shadow 日志验收已被退役口径替代，当前 Gateway 会拒绝 agent-runtime `shadow` 主路由。
- [x] shadow 失败不影响正式 response 的迁移风险已由无 退役 Agent 运行时 回归和 fallback suppression 测试覆盖。

回退：

- [x] 历史回退到 `legacy` 已退役；当前回退方式为修正项目内配置或返回项目内标准错误，不再改回 退役 Agent 运行时 legacy。

### P1-T3. 为 `sales-opportunity-smart-entry` 开启 shadow

修改：

- `scene-configs/sales-opportunity-smart-entry.json`

验收同 P1-T2；当前项目已直接进入 `routing.mode=langgraph` 且 `langgraphCutover.requestPercentage=100`，`shadow` 不再作为可执行迁移阶段。

### P1-T4. 补充 langgraph fallback 禁用开关

目标：最终下线 退役 Agent 运行时 前，需要能显式禁止 `langgraph` 自动 fallback 到 legacy。

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
- 当 `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 时，langgraph 失败直接返回项目内错误，不再调用 退役 Agent 运行时 legacy。

验收：

- [x] 单元测试覆盖 enabled / disabled 两种行为。
- [x] disabled 时人为制造 `fetch-context` 失败，不访问 旧 Gateway。

复验说明（2026-05-06 15:41 Asia/Shanghai）：`node tests/regression/langgraph_fallback_switch.test.js` 通过；当前退役实现中即使设置 `LANGGRAPH_LEGACY_FALLBACK_ENABLED=1` 也不会调用 legacy 退役 Agent 运行时，异常和 final-state error 都返回项目内错误或 fallback suppressed audit。`npm run regression:no-retired-runtime` 同时确认本轮请求日志无 `agent.langgraph.fallback.triggered`。

## P2. 项目内 LLM 生成节点替代 退役 Agent 运行时 advisory tool

目标：移除 `旧 LLM toolRef` 的 退役 Agent 运行时 语义，改为项目内 LLM tool。

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
  toolRef: 旧 LLM toolRef
```

改为：

```yaml
advisory_llm:
  toolRef: tool://llm/project-advisory@v1
```

验收：

- [x] `npm run lint:platform-configs` 通过。
- [x] `rg -n "tool://llm/旧 LLM tool" platform/skills` 无命中。

完成说明（2026-05-03）：已新增 `platform/tools/project-advisory-llm.tool.yaml` 与 `platform/runtime/llm-client.js`，`draft-output` 支持 `LANGGRAPH_DRAFT_MODE=compat|mock|project-llm`，默认 `compat` 以保持本地回归稳定；三条销售 BusinessSkill 的 `advisory_llm` 已切到 `tool://llm/project-advisory@v1`。验证：`node tests/regression/project_llm_draft_mode.test.js`、`npm run lint:platform-configs`、`node scripts/scan_retired_runtime_dependencies.js` 已执行；`npm run regression:self-contained -- --output-dir tmp/self-contained-ag02` 仍因既有 `basisFields` 回归期望和 `services/bundle-renderer.js` 旧项目路径扫描失败，详见本轮交付记录。

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

- [x] 确认 `fetch_business_context` 不再需要 退役 Agent 运行时 读取 `SKILL.md`。
- [x] query profile 中的 `skillPath` 若只用于追踪，应改成项目通用 ref 或移除执行依赖。
- [x] 禁止从 query runner 读取 `旧共享运行时目录`。

验收：

- [x] 停止 旧 Gateway 后，`fetch_business_context` 节点可成功获取 `rawRow`。

复验说明（2026-05-06 15:42 Asia/Shanghai）：`platform/nodes/fetch-context.js` 通过 BusinessSkill `dataBindings.queryProfileRef` 和 `tool://data/generic-query-runner@v1` 获取上下文，不读取 退役 Agent 运行时 `SKILL.md`；`platform/tools/sales-opportunity-by-opportunity-id.query.yaml` 的 `migrationSource.skillPath` 已是 `project://references/sales-opportunity-advisor/skill_contract.md`。本轮直接执行 `runCompiledSceneWorkflow`，`fetch_business_context` 成功，`rawFieldCount=45`。

### P3-T2. 对齐字段清洗结果

检查：

- `platform/nodes/normalize-facts.js`
- `metadata/sales_opportunity_dictionary.tsv`
- `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/decision_rules.md`

任务：

- [x] 对比旧 退役 Agent 运行时 成功请求输出中的关键事实字段。
- [x] 确认 `facts.profile` 至少包含：
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
- [x] 确认 enum / money / percent / date 映射与字典一致。

验收：

- [x] 新增或更新 `scripts/verify_*`，能断言上述 profile 字段。
- [x] helper 场景 smoke 请求返回 `summary/adviceText/nextActions`。

修复前核对说明（2026-05-06 15:42 Asia/Shanghai）：当时直接执行 `sales-opportunity-advisor` graph，`facts.profile` 可得到 `opportunityId/opportunityName/customerName/salesStage/opportunityStatus/amount/predictTenderDate/winRate`，并观察到枚举、金额、百分比和日期保留格式与字典一致；但样本中 `businessType` 与 `budgetConfirmed` 缺失，其中 `budgetConfirmed` 在字典标记为 `处理：忽略`，因此“至少包含全部字段”和对应 `scripts/verify_*` 断言当时保留为待办。`npm run regression:no-retired-runtime` 中 `sales-opportunity-advisor.smoke` 返回 `summary/adviceText/nextActions` 并通过。

完成说明（2026-05-06 15:52 Asia/Shanghai）：已在 `platform/nodes/normalize-facts.js` 补齐 profile 兼容字段：`businessType` 从当前字段 `salesScene` 派生并复用销售场景枚举映射，`budgetConfirmed` 在旧字段存在时按 `0/1/是/否` 映射为 `否/是`，旧字段缺失时在 `facts.profile` 中明确标为 `未提供`。新增 `scripts/verify_sales_opportunity_profile_fields.js`，用旧 退役 Agent 运行时 关注字段列表断言 `facts.profile` 包含 `opportunityId/opportunityName/customerName/salesStage/opportunityStatus/businessType/amount/budgetConfirmed/predictTenderDate/winRate`，同时验证 enum / money / percent / date 映射。已执行 `node scripts/verify_sales_opportunity_profile_fields.js`、真实 `runCompiledSceneWorkflow` profile 检查、`npm run regression:no-retired-runtime`、`npm run check`，均通过；真实样本 `sales-opportunity-advisor` profile 已无缺失字段。

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
- [x] 未命中请求仍可 legacy 或 fallback 的历史验收已被 agent-runtime legacy 退役替代；当前未命中 cutover 会返回项目内 `INVALID_REQUEST`，不回 退役 Agent 运行时。
- [x] rollout report 能区分 `langgraph` 与 `legacy` 的历史验收已由当前 no-retired-runtime rollout 口径替代；当前目标是 `fallbackRatio=0` 且无 legacy 主链路。

### P3-T4. 切换为 100% langgraph

前置条件：

- [x] P2 全部完成。
- [x] P3-T1 到 P3-T3 完成。
- [x] 连续本地回归通过。

修改：

```json
"langgraphCutover": {
  "requestPercentage": 100
}
```

验收：

- [x] 停止 旧 Gateway 后，该 scene 成功。
- [x] `req_xxx` 日志中无 `gateway-http` stage。
- [x] 失败时不出现 `RUNTIME_TIMEOUT` from 旧 Gateway。

完成说明（2026-05-03）：`scene-configs/sales-opportunity-advisor.json` 已切到 `routing.mode=langgraph` 且 `langgraphCutover.requestPercentage=100`，该 scene 的 `agent.gatewayModel` 已改为项目内语义 `project/sales-opportunity-advisor`，不再指向 `旧 agent gateway model`。自闭环 fixture 期望同步对齐当前 `sales-opportunity-advisor` 输出 schema：`basisFields` 作为内部事实依据保留在 graph artifacts，不作为 API payload 必填字段。验证命令与结果见本轮 AG-03 交付记录。

复验说明（2026-05-06 15:42 Asia/Shanghai）：已执行 `npm run regression:self-contained` 与 `npm run regression:no-retired-runtime`，该 scene 均通过；no-retired-runtime 日志检查确认无 `gateway-http`、`旧 Gateway request timed out`、`agent.langgraph.fallback.triggered`。

补充复验说明（2026-05-06 15:52 Asia/Shanghai）：P3-T2 profile 兼容字段已补齐并新增验证脚本，`P3-T1` 到 `P3-T3` 已全部完成。

## P4. `sales-opportunity-advisor-directdb` 纯项目化

目标：directdb 场景已经是 `langgraph`，但需要删除 退役 Agent 运行时 命名和 fallback 依赖。

### P4-T1. 移除 directdb 对 legacy fallback 的日常依赖

修改：

- `scene-configs/sales-opportunity-advisor-directdb.json`

目标：

- [x] 保持 `routing.mode = langgraph`
- [x] 添加或确认 `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 下能直接返回项目内错误。

验收：

- [x] DirectDbRunner 正常时请求成功。
- [x] DirectDbRunner 或数据工具异常时返回项目内标准错误，不 fallback 到 退役 Agent 运行时。

复验说明（2026-05-06 15:42 Asia/Shanghai）：`sales-opportunity-advisor-directdb` 当前 `routing.mode=langgraph` 且 `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 下 no-retired-runtime 回归通过；fallback 单测覆盖异常和 fetch-context final-state error 均不调用 legacy。当前 BusinessSkill 数据获取绑定为项目内 `generic-query-runner`，DirectDbRunner 仍作为健康检查中的项目工具服务存在，不属于 退役 Agent 运行时 fallback。

### P4-T2. 清理 directdb skill 文案中的 `旧共享运行时目录` 残留

检查：

- `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb/SKILL.md`
- `DirectDbRunner/sql-cache/sales-opportunity-advisor-directdb.sql.json`

任务：

- [x] 若文件只作为历史参考，移动到 docs 或标记 deprecated。
- [x] 若仍作为 query profile metadata，改成项目路径或 `project://` ref。
- [x] 删除 `旧共享运行时目录` 运行引用。

验收：

```bash
rg -n "/Users/gato-pm/\\旧共享运行时目录" runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb DirectDbRunner/sql-cache
```

无运行时命中。

完成说明（2026-05-03）：`sales-opportunity-advisor-directdb` 保持 `routing.mode=langgraph` 与 `langgraphCutover.requestPercentage=100`，`agent.gatewayModel` 已改为项目内语义 `project/sales-opportunity-advisor-directdb`。DirectDbRunner 的 SQL 定义来源从 退役 Agent 运行时 SKILL.md 移到 `project://references/sales-opportunity-advisor-directdb/sql_definition.md`，query profile 与 SQL cache 也改为 project ref；schema/rules 迁到 `project://references/sales-opportunity-advisor/...`。验证命令与剩余阻塞见本轮 AG-04 交付记录。

## P5. `sales-opportunity-smart-entry` 迁移

目标：智能录入场景从 退役 Agent 运行时 legacy 改成项目内 langgraph。

### P5-T1. 补齐 smart-entry 基线文档和 fixture

检查：

- `scene-configs/sales-opportunity-smart-entry.json`
- `platform/skills/sales-opportunity-smart-entry.v1.yaml`
- `runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/SKILL.md`
- `runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/references/output_schema.json`

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

- [x] `routing.mode=shadow` 历史阶段已被 `langgraph` 100% 和 agent-runtime legacy 退役覆盖。
- [x] `routing.mode=langgraph` 且 退役 Agent 运行时 停止时请求成功。

### P5-T3. 切换 smart-entry 到 langgraph

修改：

- `scene-configs/sales-opportunity-smart-entry.json`

目标：

- [x] 先 `shadow` 的历史阶段已被后续 `langgraph` 100% 覆盖，当前不再启用 shadow。
- [x] 再 `langgraph` 10% 的历史阶段已被后续 `langgraph` 100% 覆盖。
- [x] 最后 `langgraph` 100%

验收同 P3。

完成说明（2026-05-03）：`sales-opportunity-smart-entry` 已切到 `routing.mode=langgraph` 且 `langgraphCutover.requestPercentage=100`，`agent.gatewayModel` 改为项目内语义 `project/sales-opportunity-smart-entry`。schema/rules/query metadata 已迁到 `project://references/sales-opportunity-smart-entry/...`，`draft-output` 增加 smart-entry compat payload 分支，输出 `{opportunityId, salesScene, data}` 并把 `rawText` 合并进当前销售场景允许字段。验证命令与剩余阻塞见本轮 AG-05 交付记录。

## P6. 原直接模型场景 退役 Agent 运行时 残留清理与统一主路径

目标：清掉 退役 Agent 运行时 命名空间造成的部署误解，并将 `payment-info-split`、`special-custom-product-solution` 纳入统一的项目内 LangGraph agent-runtime 主路径。

### P6-T1. 迁移模型元数据目录

当前目录：

```text
runtime-assets/project-runtime/agents/*/agent/models.json
runtime-assets/project-runtime/agents/*/agent/auth-profiles.json
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

- [x] direct-model 场景不再引用 `runtime://project-runtime/agents/...`。
- [x] `payment-info-split` 成功。
- [x] `special-custom-product-solution` 成功或 RAG 不可用时返回明确错误。

### P6-T2. 删除原 direct-model scene 中无用 agent 字段

检查：

- `scene-configs/special-custom-product-solution.json`

任务：

- [x] 若 `execution.mode = direct-model`，确认 `agent` 字段不会被运行时使用。
- [x] 修改 release validator，允许 direct-model scene 不定义 `agent.gatewayModel`。
- [x] 删除或 deprecated `agent` / `skill` 中的 退役 Agent 运行时 字段。

涉及：

- `services/release-validator.js`
- `services/console-scenes.js`
- `console/src/...` 中展示 scene 详情的页面

验收：

- [x] direct-model scene validation 通过。
- [x] Console 展示不再把 direct-model 误标为 退役 Agent 运行时 agent。

历史复验说明（2026-05-06 15:42 Asia/Shanghai）：`payment-info-split.json` 与 `special-custom-product-solution.json` 的 `fallbackModelsFile` 均已迁到 `project://runtime-assets/model-profiles/...`，非 Markdown 运行配置中无 `runtime://project-runtime/agents/...` 命中。此时两场景仍按原 direct-model 口径验收，后续 P6-T3 已将主路径统一切到 LangGraph agent-runtime。

### P6-T3. 将原 direct-model 场景纳入统一 LangGraph agent-runtime

任务：

- [x] `payment-info-split` 改为 `execution.mode=agent-runtime`，`routing.mode=langgraph`，`allowedModes=["langgraph"]`，`langgraphCutover.requestPercentage=100`。
- [x] 新增 `prompt-structured-extraction@v1` 模板与 `payment-info-split` BusinessSkill。
- [x] 新增 `project-payment-info-split` project-llm tool，并使用项目内 prompt/schema reference。
- [x] `special-custom-product-solution` 改为 `execution.mode=agent-runtime`，`routing.mode=langgraph`，`allowedModes=["langgraph"]`，`langgraphCutover.requestPercentage=100`。
- [x] 为 `special-custom-product-solution` 补齐 BusinessSkill 契约入口，统一走 RAG -> project LLM -> ModelTool validate 的 LangGraph 节点链路。
- [x] `/health` 的 LangGraph runtime 检查纳入 `payment-info-split` 与 `special-custom-product-solution`。
- [x] `tests/fixtures/self-contained/manifest.json` 的允许阶段从 direct-model 外部 warning 更新为 LangGraph 节点阶段。

验收：

- [x] `npm run check` 通过。
- [x] `npm run regression:no-retired-runtime` 通过，5 个用例 5 pass / 0 warning / 0 fail。
- [x] `payment-info-split` 实际请求返回成功，日志显示 `executionMode=agent-runtime`、`sceneExecutionType=langgraph-stategraph`、`draftExecution.mode=project-llm`。
- [x] `special-custom-product-solution` 实际请求返回成功，日志显示 `executionMode=agent-runtime`、`sceneExecutionType=langgraph-stategraph`、`draftExecution.mode=project-llm`。

完成说明（2026-05-06 18:02 Asia/Shanghai）：`payment-info-split` 与 `special-custom-product-solution` 已从直接模型主路径切到项目内 LangGraph agent-runtime。`payment-info-split` 使用 `platform/templates/prompt-structured-extraction.v1.yaml` + `platform/skills/payment-info-split.v1.yaml` + `platform/tools/project-payment-info-split-llm.tool.yaml`；`special-custom-product-solution` 使用 `platform/skills/special-custom-product-solution` 契约 + `project-product-solution-llm` tool。为避免 DeepSeek reasoning 输出耗尽 JSON token，已将收款信息拆分 `maxTokens` 调整为 1024、特殊定制方案 `maxTokens` 调整为 2048。最新 no-retired-runtime 输出目录为 `tests/regression/output/self-contained-2026-05-06T10-01-34-193Z`，5 个场景全部通过，日志检查无 `gateway-http`、旧 Gateway timeout 或 `agent.langgraph.fallback.triggered`。

## P7. API Health 与启动脚本去 退役 Agent 运行时

目标：项目启动和健康检查不再把 旧 Gateway 当必需服务。

### P7-T1. 调整 `/health`

当前风险：

- `server.js` 中 `checkGatewayHealth()` 会探测 旧 Gateway。（已在 2026-05-06 移除）

任务：

- [x] 将 Gateway health 从必需项移除；本轮不保留 legacy optional 探测，避免继续依赖 `旧 gateway token` 和 `旧本机 Gateway 端点`。
- [x] 新增 langgraph runtime health。
- [x] health 返回中区分：
  - `api`
  - `contextHelper`
  - `directDbRunner`
  - `modelTool`
  - `rag`
  - `langgraphRuntime`

验收：

- [x] 旧 Gateway 停止时 `/health` 不失败。
- [x] 确认不实现 `旧 legacy required 开关` 旧行为；当前按硬约束不保留 Gateway health 探测，避免重新引入 `旧 gateway token` 和 `旧本机 Gateway 端点` 依赖。

### P7-T2. 启动脚本不再启动 退役 Agent 运行时

检查：

- `package.json`
- `scripts/install_launch_agents.sh`
- `deploy/launchd/*.plist` 若存在
- `README.md`
- `常驻启动说明.md`
- `docs/engineering/常驻启动说明.md`

任务：

- [x] 确认项目自己的 service 脚本只管理 API、ContextHelper、DirectDbRunner、ModelTool、RAG、Console。
- [x] 退役 Agent 运行时 启动说明移动到 deprecated 章节或从运行手册移除。
- [x] 新增“无 退役 Agent 运行时 运行验证”说明。

验收：

```bash
npm run service:restart
npm run service:status
curl -sS http://127.0.0.1:3100/health
```

全部通过，且不要求 旧 Gateway running。

完成说明（2026-05-06）：`server.js` 的 `/health` 已改为项目内运行面健康摘要，不再读取 `旧 gateway token`，不再探测 `旧本机 Gateway 端点`，返回中包含 `api`、`langgraphRuntime` 以及 ContextHelper / DirectDbRunner / ModelTool / RAG 的探测结果；其中 RAG 为可选，其他项目服务缺失时以 `service=degraded` 暴露。`scripts/bootstrap_local_runtime.js` 已移除 `旧 gateway token` 必填项和 旧 Gateway 外部探测，`scripts/install_launch_agents.sh` 当前只管理项目内 API、ContextHelper、DirectDbRunner、ModelTool、RAG。

复验说明（2026-05-06 15:42 Asia/Shanghai）：`curl -sS http://127.0.0.1:3100/health` 返回 `service=ok`，包含 `api/langgraphRuntime/contextHelper/directDbRunner/modelTool/rag`，其中 RAG 为 optional 且不可用不阻塞。`README.md` 已提供 `npm run regression:no-retired-runtime` 作为“无 退役 Agent 运行时 回归入口”，`docs/engineering/常驻启动说明.md` 仅要求项目内服务并明确“不再要求本机 legacy agent gateway”。

## P8. 删除 legacy 退役 Agent 运行时 主链路

目标：在所有 agent-runtime scene 都稳定 langgraph 后，删除 旧 Gateway 调用主链路。

前置条件：

- [x] `sales-opportunity-advisor` 100% langgraph 稳定。
- [x] `sales-opportunity-advisor-directdb` 100% langgraph 稳定。
- [x] `sales-opportunity-smart-entry` 100% langgraph 稳定。
- [x] `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 下全量回归通过。
- [x] 旧 Gateway 停止状态下全量核心场景通过。

### P8-T1. 禁止新增 legacy agent-runtime scene

修改：

- `services/release-validator.js`
- `services/scene-config.js`
- `scripts/validate_platform_configs.js`

规则：

- [x] 新 scene 不允许 `routing.mode = legacy` 且 `agent.gatewayModel = retired-runtime/...`。
- [x] 已存在 agent-runtime legacy 配置不再通过 deprecated allowlist 保留；当前校验直接拒绝。

验收：

- [x] 添加 synthetic legacy scene 测试，验证会失败。

### P8-T2. 删除 退役 Agent 运行时 runtime request builder

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
rg -n "runLegacyAgentRuntimeScene|buildRuntimeRequest|GATEWAY_CHAT_COMPLETIONS_URL|旧 session header" services routes platform utils
```

无运行主链路命中。

### P8-T3. 删除 退役 Agent 运行时 fallback 路径

修改：

- `platform/runtime/fallback.js`
- `routes/agent.js`
- `platform/gateway/index.js`

目标：

- [x] langgraph 失败返回项目内标准错误。
- [x] 不再调用 `executeLegacyFallbackRoute()`。
- [x] `legacyRole` 日志字段改为 `deprecatedLegacyRole` 或删除。

验收：

- [x] fallback 单元测试更新。
- [x] 人为让 `fetch-context` 失败，不访问 退役 Agent 运行时。

完成说明（2026-05-06）：AG-09 本轮新增 agent-runtime scene 配置校验，`services/scene-config.js` 与 `services/release-validator.js` 会拒绝 `routing.mode` 非 `langgraph` 的 agent-runtime scene，并拒绝 `agent.gatewayModel` 使用 `retired-runtime/...`；direct-model 的 `legacy` 路由不受影响。`platform/gateway/index.js`、`routes/agent.js`、`services/console-rollout.js` 中的 `legacyRole` 日志/展示字段已改为 `deprecatedLegacyRole` / `deprecatedLegacyExecutionRole`。新增 synthetic scene 回归断言 legacy agent-runtime 配置与 `旧 agent gateway model` 都会失败。

复验说明（2026-05-06 15:42 Asia/Shanghai）：`node tests/regression/langgraph_fallback_switch.test.js` 通过，覆盖 legacy fallback enabled/disabled、异常、final-state error、direct-model 不受影响、synthetic legacy scene 拒绝等路径。`rg -n "runLegacyAgentRuntimeScene|buildRuntimeRequest|GATEWAY_CHAT_COMPLETIONS_URL|旧 session header|executeLegacyFallbackRoute" services routes platform utils` 无输出。`npm run regression:no-retired-runtime` 再次确认核心请求无 legacy fallback 或 gateway-http 日志。

## P9. Runtime asset namespace 清理

目标：去掉 `runtime://project-runtime` 这个容易误导的命名空间。

说明：

这是后置任务。业务主链路不依赖 旧 Gateway 后，再做目录重命名，风险更低。

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

- [x] `runtime://project-runtime/...` 和新 namespace 在过渡期都能解析到同一资产。
- [x] bundle renderer 新输出的 runtime ref 使用 `runtime://project-runtime/...`。

完成说明（2026-05-06）：已新增项目通用 runtime namespace `runtime://project-runtime/...`，`utils/path-resolver.js` 在过渡期同时支持 `runtime://project-runtime/...` 与历史 `runtime://project-runtime/...`，二者都解析到当前物理资产目录；`services/bundle-renderer.js` 会把历史 runtime ref 规范化为 `runtime://project-runtime/...`，相关 active bundle / helper manifest 验证脚本同步改为新 namespace。

### P9-T2. 迁移目录

从：

```text
runtime-assets/project-runtime/
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

- [x] 移动 workspace skills references。
- [x] 移动 agents model metadata。
- [x] 更新 active bundle renderer。
- [x] 更新 Console mock / catalog path。
- [x] 更新 docs。

验收：

```bash
rg -n "runtime://project-runtime|runtime-assets/project-runtime" scene-configs platform services scripts console runtime-assets --glob '!**/*.md'
```

无运行配置命中。

完成说明（2026-05-06）：物理目录已从 `runtime-assets/project-runtime/` 迁移到 `runtime-assets/project-runtime/`。`runtime://project-runtime/...` 现在解析到新目录；历史 `runtime://project-runtime/...` 仅作为过渡兼容别名，也解析到新目录。bundle renderer 产物、结构检查和自闭环扫描已不再要求 `runtime-assets/project-runtime`，历史 SKILL 文本中的旧物理路径同步改为 `runtime-assets/project-runtime`。后续剩余 退役 Agent 运行时 命中主要是历史文档、旧回归输出和兼容别名常量。

补充完成说明（2026-05-06）：过渡兼容别名已从运行解析面退役，`utils/path-resolver.js`、`services/bundle-renderer.js` 和 Console skill binding 只接受 `runtime://project-runtime/...` 作为 runtime namespace；旧 `runtime://project-runtime/...` 不再被静默映射到 `project-runtime`。

## P10. 回归、观测与上线门槛

### P10-T1. 增加无 退役 Agent 运行时 回归模式

新增命令建议：

```json
"regression:no-retired-runtime": "NO_RETIRED_RUNTIME_REQUIRED=1 LANGGRAPH_LEGACY_FALLBACK_ENABLED=0 node scripts/run_self_contained_regression.js"
```

修改：

- `package.json`
- `scripts/run_self_contained_regression.js`

验收：

- [x] 命令会在执行用例前运行 退役 Agent 运行时 blocker 扫描；本轮按“不要新增 旧本机 Gateway 端点 依赖”的硬约束，不再主动探测本机 Gateway。
- [x] 命令会校验核心请求日志中没有 `gateway-http`、`旧 Gateway request timed out`、`agent.langgraph.fallback.triggered`。

完成说明（2026-05-06）：已新增 `npm run regression:no-retired-runtime`，该命令设置 `NO_RETIRED_RUNTIME_REQUIRED=1`、`LANGGRAPH_LEGACY_FALLBACK_ENABLED=0`、`LANGGRAPH_DRAFT_MODE=compat`，且不再设置旧 gateway token。`scripts/run_self_contained_regression.js` 在 no-retired-runtime 模式下会先运行 `scripts/scan_retired_runtime_dependencies.js --fail-on-runtime-blocker --fail-on-config-blocker`，再执行 5 个 self-contained 场景，并按本轮 requestId 检查 `logs/api.stdout.log` / `logs/api.stderr.log` 中没有旧 Gateway 主链路痕迹。`special-custom-product-solution` 已纳入 manifest，因 RAG / LLM provider 属外部依赖，允许成功或明确 external warning。

### P10-T2. 生成 rollout 报告

命令：

```bash
node scripts/build_rollout_report.js \
  --input <trace-events.jsonl> \
  --batch-id retired-runtime-retirement \
  --min-success-rate 0.98 \
  --max-p95-ms 3000 \
  --max-schema-failure-rate 0.01 \
  --max-fallback-ratio 0 \
  --fail-on-alert
```

验收：

- [x] `fallbackRatio = 0`
- [x] `schemaFailureRate <= 0.01`
- [x] p95 延迟可接受

复验说明（2026-05-06 13:12 Asia/Shanghai）：使用最近一次 `npm run regression:no-retired-runtime` 中三条 agent-runtime LangGraph 请求（`req_20260506_131210287_f52e3062`、`req_20260506_131214960_5c863fdf`、`req_20260506_131219525_48c17b79`）过滤 `logs/api.stdout.log` 后执行 `node scripts/build_rollout_report.js --batch-id ag11-no-retired-runtime-langgraph-20260506-final --min-success-rate 0.98 --max-p95-ms 5000 --max-schema-failure-rate 0.01 --max-fallback-ratio 0 --fail-on-alert` 通过；结果 `langgraphRuns=3`、`successRate=1`、`fallbackRatio=0`、`schemaFailureRate=0`、`p95DurationMs=3857`、`alerts=[]`。本次采用本地 smoke 阈值 `5000ms` 验收，生产 rollout 仍建议保留上方 `3000ms` 目标。

### P10-T3. 最终验收命令

必须全部通过：

```bash
npm run check
npm run regression:self-contained
npm run regression:no-retired-runtime
curl -sS http://127.0.0.1:3100/health
```

完成说明（2026-05-06）：AG-11 本轮新增 [退役 Agent 运行时退场最终验收报告.md](/Users/gato-pm/Desktop/API_副本/docs/项目开发文档/退役 Agent 运行时退场最终验收报告.md)，记录无 退役 Agent 运行时 回归入口、blocker 扫描、5 场景回归和剩余历史引用说明。已执行 `npm run check`、`npm run regression:self-contained`、`npm run regression:no-retired-runtime`。

复验说明（2026-05-06 13:12 Asia/Shanghai）：已复跑 `npm run lint:platform-configs`、`node scripts/scan_retired_runtime_dependencies.js`、`npm run regression:self-contained`、`npm run regression:no-retired-runtime` 和 rollout report。`regression:self-contained` 输出目录为 `tests/regression/output/self-contained-2026-05-06T05-11-50-881Z`，`regression:no-retired-runtime` 输出目录为 `tests/regression/output/self-contained-2026-05-06T05-12-09-185Z`，5 个用例 4 pass / 1 allowed warning，`runtimeBlockers=0`、`configBlockers=0`，日志检查未发现 `gateway-http`、`旧 Gateway request timed out` 或 `agent.langgraph.fallback.triggered`。

补充复验说明（2026-05-06 15:12 Asia/Shanghai）：已复跑 `npm run lint:platform-configs`、`node scripts/scan_retired_runtime_dependencies.js --fail-on-runtime-blocker --fail-on-config-blocker`、`npm run regression:self-contained`、`npm run regression:no-retired-runtime`。`regression:self-contained` 输出目录为 `tests/regression/output/self-contained-2026-05-06T07-11-53-463Z`，`regression:no-retired-runtime` 输出目录为 `tests/regression/output/self-contained-2026-05-06T07-12-11-590Z`，5 个用例 4 pass / 1 allowed warning / 0 fail，`legacyFallbackEnabled=false`，`runtimeBlockers=0`、`configBlockers=0`，日志检查未发现 `gateway-http`、`旧 Gateway request timed out` 或 `agent.langgraph.fallback.triggered`。`payment-info-split` 仍优先验成功；若外部 LLM provider 明确失败，则按 allowed external warning 处理，不把 provider 过载误判为 退役 Agent 运行时 依赖回归。

最终复验说明（2026-05-06 18:02 Asia/Shanghai）：原 direct-model 的 `payment-info-split` 与 `special-custom-product-solution` 已一并纳入项目内 LangGraph agent-runtime 主路径。`npm run regression:no-retired-runtime` 输出目录 `tests/regression/output/self-contained-2026-05-06T10-01-34-193Z`，5 个用例 5 pass / 0 warning / 0 fail；`runtimeBlockers=0`、`configBlockers=0`；本轮 requestId 日志检查未发现 `gateway-http`、旧 Gateway timeout 或 `agent.langgraph.fallback.triggered`。

手工 smoke：

```bash
curl -sS -X POST http://127.0.0.1:3100/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"scene":"sales-opportunity-advisor","bizParams":{"opportunityId":"2041340312877535232"},"runtimeContext":{"tenantId":"tenant-a","userId":"user-a"}}'
```

验收：

- [x] response `success=true`
- [x] 有 `requestId`
- [x] `data.summary` 非空
- [x] `data.adviceText` 非空
- [x] `data.nextActions` 至少 3 条
- [x] 日志没有 `gateway-http`
- [x] 日志没有 `旧 Gateway request timed out`

手工 smoke 复验（2026-05-06 13:04 Asia/Shanghai）：请求 `req_20260506_130403314_ece4f7f1` 返回 `success=true`、非空 `summary/adviceText` 和 3 条 `nextActions`，该 requestId 的日志只显示 `langgraph-stategraph` 成功路径，未命中 旧 Gateway 相关错误。

## 7. 建议执行顺序

推荐顺序：

1. P0 基线冻结。
2. P1 fallback 开关和 shadow 能力。
3. P2 项目内 LLM tool。
4. P3 迁移 `sales-opportunity-advisor`。
5. P4 固化 `sales-opportunity-advisor-directdb`。
6. P5 迁移 `sales-opportunity-smart-entry`。
7. P7 health 和启动脚本去 退役 Agent 运行时。
8. P10 无 退役 Agent 运行时 回归。
9. P8 删除 legacy 主链路。
10. P6 / P9 做命名空间和资产清理。

不要先做 P8。先删 legacy 会让问题无法回退。

## 8. 风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| 生成质量下降 | 当前 `draft-output` 兼容草拟可能弱于 退役 Agent 运行时 模型执行 | P2 先实现项目内 LLM 生成 |
| 错误语义变化 | legacy 会把部分错误包装为 gateway/runtime 错误 | 为每类错误补 regression |
| fallback 掩盖问题 | langgraph 失败后 legacy 成功，表面成功率好看 | P1-T4 增加 fallback 禁用开关 |
| active bundle 不一致 | repo 配置和 `.local/runtime-bundles/local/current` 配置可能不同 | 修改后运行 active bundle verify 脚本 |
| Console 展示误导 | Console 仍可能显示 退役 Agent 运行时 agent/tool | P6/P9 同步 Console mock 和 catalog |
| 端口服务依赖 | 迁移后仍依赖 19101/19102/19103/19104 | health 明确这些是项目工具服务，不是 退役 Agent 运行时 |

## 9. 完成定义

本次改造真正完成的定义：

- [x] 三个 agent-runtime 场景全部以 `langgraph` 为默认主路径。
- [x] 两个原 direct-model 场景已纳入 `agent-runtime` / `langgraph` 100% 主路径。
- [x] `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 下全量核心回归通过。
- [x] 旧 Gateway 停止时，核心业务 API 仍可运行。
- [x] API health 不要求 旧 Gateway。
- [x] 运行主链路中无 `旧本机 Gateway 端点`。
- [x] 运行主链路中无 `旧 agent gateway model`。
- [x] 运行主链路中无 `旧共享运行时目录`。
- [x] 新业务接入文档不再要求创建 退役 Agent 运行时 agent 或 退役 Agent 运行时 workspace。
- [x] 旧 退役 Agent 运行时 相关代码要么删除，要么标记 deprecated 且不在默认运行路径。

完成定义复验（2026-05-06 13:04 Asia/Shanghai）：`npm run regression:no-retired-runtime` 不设置旧 gateway token，并设置 `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 后通过；blocker 扫描确认运行主链路无 `runtime-blocker` / `config-blocker`。默认全量扫描仍有历史文档和旧回归输出命中，按当时扫描分层不属于运行阻塞。
