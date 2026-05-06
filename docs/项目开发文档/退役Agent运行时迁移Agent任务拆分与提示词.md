# 退役 Agent 运行时 退场迁移 Agent 任务拆分与执行提示词

## 1. 文档用途

本文档把 [退役 Agent 运行时退场与项目内LangGraph迁移任务清单.md](/Users/gato-pm/Desktop/API_副本/docs/项目开发文档/退役 Agent 运行时退场与项目内LangGraph迁移任务清单.md) 拆成可以交给多个 AI agent 开发的工单。

目标不是做 退役 Agent 运行时 兼容，也不是迁移到空壳兼容层，而是按“全部迁移到项目中去跑”的策略，把主链路收口到项目内 `platform/runtime/graphs`。

每个工单都包含：

1. 任务目标
2. 前置依赖
3. 建议写入范围
4. 关键参考文件
5. 实施要点
6. 验收标准
7. 可直接复制给 AI agent 的执行提示词

## 2. 总体迁移原则

### 2.1 不变项

1. 对外 API 不变：调用方仍使用 `POST /api/agent/run`。
2. 请求和响应 envelope 不变：`success`、`scene`、`requestId`、`payload`、`error` 等字段语义保持稳定。
3. SQL Server、ContextHelper、DirectDbRunner、ModelTool 的职责不在本次改造中重做。
4. 已有 scene 名称不变。
5. 已有业务 prompt、rules、schema、dictionary 的业务语义不变。

### 2.2 必须变化

1. 业务主链路不再调用 旧 Gateway `旧本机 Gateway 端点`。
2. 运行时不再依赖 `旧 gateway token`。
3. 运行时不再依赖 `旧共享运行时目录`。
4. `sales-opportunity-advisor`、`sales-opportunity-advisor-directdb`、`sales-opportunity-smart-entry` 最终全部走项目内 `langgraph`。
5. `platform/tools/旧 LLM tool 配置` 这类 退役 Agent 运行时 agent tool 不再作为主链路 tool。
6. `runtime://project-runtime/...` 资产命名逐步迁移到项目通用 namespace。

### 2.3 Agent 开发统一约束

所有 agent 都必须遵守：

1. 先读代码再改代码。
2. 不允许还原他人改动。
3. 不允许执行 `git reset --hard`、`git checkout --` 等破坏性命令。
4. 手工编辑文件使用 `apply_patch`。
5. 搜索优先使用 `rg`。
6. 每个任务只修改自己负责的文件范围。
7. 如果发现依赖任务未完成，先记录阻塞点，不要用临时代码绕过。
8. 完成后必须运行任务内指定的验证命令；跑不了要写清楚原因。
9. 最终回答必须列出修改文件、验证结果、遗留风险。

## 3. 推荐派工顺序

### 3.1 串行主路径

```text
AG-00 基线与依赖扫描
-> AG-01 路由与 fallback 策略收口
-> AG-02 项目内 LLM tool/client
-> AG-03 sales-opportunity-advisor 迁移
-> AG-04 sales-opportunity-advisor-directdb 纯项目化
-> AG-05 sales-opportunity-smart-entry 迁移
-> AG-08 启动、health、bootstrap 去 退役 Agent 运行时
-> AG-09 删除 legacy 退役 Agent 运行时 主链路
-> AG-10 runtime namespace 清理
-> AG-11 最终回归与上线门槛
```

### 3.2 可并行任务

在 `AG-00` 完成后，可以并行：

1. `AG-06` 直接模型场景 退役 Agent 运行时 残留清理。
2. `AG-07` 文档、图示、控制台文案去 退役 Agent 运行时。
3. `AG-02` 项目内 LLM tool/client 的底层实现。

在 `AG-02` 完成后，可以并行：

1. `AG-03` helper 版销售建议迁移。
2. `AG-04` directdb 版销售建议清理。
3. `AG-05` smart-entry 迁移。

在 `AG-03`、`AG-04`、`AG-05` 都完成后，才能做：

1. `AG-09` 删除 legacy 退役 Agent 运行时 主链路。
2. `AG-10` runtime namespace 清理。
3. `AG-11` 最终无 退役 Agent 运行时 回归。

## 4. 工单总览

| 工单 | 主题 | 优先级 | 是否可并行 | 主要写入范围 |
|---|---:|---:|---:|---|
| AG-00 | 基线与 退役 Agent 运行时 依赖扫描 | P0 | 否 | `docs/`、`scripts/`、`tests/fixtures/` |
| AG-01 | 路由与 fallback 策略收口 | P0 | 否 | `platform/gateway/`、`platform/runtime/fallback.js`、测试 |
| AG-02 | 项目内 LLM tool/client | P0 | 部分可并行 | `platform/tools/`、`platform/runtime/`、`platform/nodes/draft-output.js` |
| AG-03 | `sales-opportunity-advisor` 迁移 | P1 | 是 | `scene-configs/`、`platform/skills/`、fixtures/tests |
| AG-04 | `sales-opportunity-advisor-directdb` 纯项目化 | P1 | 是 | directdb scene/skill/query/tests |
| AG-05 | `sales-opportunity-smart-entry` 迁移 | P1 | 是 | smart-entry scene/skill/query/tests |
| AG-06 | direct-model 退役 Agent 运行时 残留清理 | P2 | 是 | `payment-info-split`、`special-custom-product-solution` 相关配置 |
| AG-07 | 文档、控制台、图示清理 | P2 | 是 | `docs/`、`services/console-*`、`scripts/generate_*` |
| AG-08 | health/bootstrap/startup 去 退役 Agent 运行时 | P1 | 否 | `server.js`、`scripts/bootstrap_local_runtime.js`、启动脚本 |
| AG-09 | 删除 legacy 退役 Agent 运行时 主链路 | P1 | 否 | `services/runtime*.js`、response parser、gateway handlers |
| AG-10 | runtime namespace 清理 | P2 | 否 | `runtime-assets/`、path resolver、bundle renderer、configs |
| AG-11 | 最终回归与上线门槛 | P0 | 否 | `scripts/`、`tests/`、rollout report |

## 5. 通用 Agent 提示词模板

下面每个工单都有专用提示词。若需要统一包装，可以使用这个前缀：

```text
你是本项目的开发 agent，工作目录是 /Users/gato-pm/Desktop/API_副本。

请先阅读 docs/项目开发文档/退役 Agent 运行时退场与项目内LangGraph迁移任务清单.md 和本工单描述，再进行代码修改。

本次目标是把 旧 Gateway 主链路迁移为项目内 LangGraph/workflow graph 运行。不要做空壳兼容，不要依赖旧共享运行时目录，不要新增对旧本机 Gateway 端点的调用。

约束：
- 先用 rg/sed 阅读相关文件，确认现状。
- 只修改本工单允许的写入范围。
- 不要还原其他人的改动。
- 手工编辑使用 apply_patch。
- 完成后运行工单要求的验证命令。
- 最终回复列出修改文件、验证结果、未解决风险。
```

---

## AG-00. 基线与 退役 Agent 运行时 依赖扫描

### 目标

建立迁移前基线，明确项目中所有 退役 Agent 运行时 依赖点，补齐后续任务可用的扫描和回归入口。

### 前置依赖

无。此任务必须第一个执行。

### 建议写入范围

1. `docs/项目开发文档/`
2. `scripts/`
3. `tests/fixtures/`
4. `tests/regression/`

### 关键参考文件

1. [services/runtime-message.js](/Users/gato-pm/Desktop/API_副本/services/runtime-message.js)
2. [server.js](/Users/gato-pm/Desktop/API_副本/server.js)
3. [platform/tools/旧 LLM tool 配置](/Users/gato-pm/Desktop/API_副本/platform/tools/旧 LLM tool 配置)
4. [scene-configs/sales-opportunity-advisor.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor.json)
5. [scene-configs/sales-opportunity-advisor-directdb.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor-directdb.json)
6. [scene-configs/sales-opportunity-smart-entry.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-smart-entry.json)

### 实施要点

1. 新增或完善一个 退役 Agent 运行时 依赖扫描脚本，建议命名为 `scripts/scan_retired_runtime_dependencies.js`。
2. 扫描关键词至少包含：
   - `retired-runtime`
   - `RETIRED_RUNTIME`
   - `旧 Gateway 端口`
   - `runtime://project-runtime`
   - `旧共享运行时目录`
   - `旧 agent gateway model`
3. 扫描结果要分级：
   - `runtime-blocker`：运行时主链路仍依赖 退役 Agent 运行时。
   - `config-blocker`：scene/skill/tool 配置仍指向 退役 Agent 运行时。
   - `asset-namespace`：资产路径还叫 `runtime://project-runtime`，但不一定影响运行。
   - `documentation`：文档、图片脚本、历史说明。
4. 为 `sales-opportunity-advisor`、`sales-opportunity-advisor-directdb`、`sales-opportunity-smart-entry` 固化最小请求 fixture。
5. 输出一份迁移基线报告，建议路径：
   - `docs/项目开发文档/退役 Agent 运行时退场依赖扫描基线.md`

### 验收标准

1. 可以通过一个命令列出所有 退役 Agent 运行时 残留。
2. 报告能区分“必须改”和“后置清理”。
3. 后续 agent 可以基于该报告认领任务。

### 建议验证命令

```bash
node scripts/scan_retired_runtime_dependencies.js
npm run lint:platform-configs
npm run regression:self-contained
```

### Agent 执行提示词

```text
你负责 AG-00：退役 Agent 运行时 退场迁移的基线与依赖扫描。

工作目录：/Users/gato-pm/Desktop/API_副本。

任务目标：
1. 建立 退役 Agent 运行时 依赖扫描能力。
2. 输出迁移前基线报告。
3. 固化 sales-opportunity-advisor、sales-opportunity-advisor-directdb、sales-opportunity-smart-entry 的最小回归请求样本，供后续迁移验证使用。

请重点阅读：
- docs/项目开发文档/退役 Agent 运行时退场与项目内LangGraph迁移任务清单.md
- services/runtime-message.js
- server.js
- platform/gateway/index.js
- platform/runtime/fallback.js
- platform/tools/旧 LLM tool 配置
- scene-configs/*.json
- platform/skills/*.yaml

实现要求：
1. 新增或完善 scripts/scan_retired_runtime_dependencies.js。
2. 扫描关键词至少包括 retired-runtime、RETIRED_RUNTIME、旧 Gateway 端口、runtime://project-runtime、旧共享运行时目录、旧 agent gateway model。
3. 扫描结果按 runtime-blocker、config-blocker、asset-namespace、documentation 分类。
4. 新增 docs/项目开发文档/退役 Agent 运行时退场依赖扫描基线.md，写清楚当前残留点和建议归属工单。
5. 不修改业务路由逻辑。

验收命令：
- node scripts/scan_retired_runtime_dependencies.js
- npm run lint:platform-configs
- npm run regression:self-contained

最终回复请列出：
1. 新增/修改文件。
2. 扫描摘要。
3. 验证命令结果。
4. 后续阻塞或风险。
```

---

## AG-01. 路由与 Fallback 策略收口

### 目标

让 `langgraph` 成为可控主路径，并提供环境变量开关控制是否允许回退到 legacy 退役 Agent 运行时 主链路。

### 前置依赖

1. `AG-00` 完成。

### 建议写入范围

1. `platform/gateway/index.js`
2. `platform/runtime/fallback.js`
3. `platform/trace/context.js`
4. `tests/` 中与 gateway route/fallback 相关的测试

### 关键参考文件

1. [platform/gateway/index.js](/Users/gato-pm/Desktop/API_副本/platform/gateway/index.js)
2. [platform/runtime/fallback.js](/Users/gato-pm/Desktop/API_副本/platform/runtime/fallback.js)
3. [platform/runtime/shadow.js](/Users/gato-pm/Desktop/API_副本/platform/runtime/shadow.js)
4. [platform/tests/fixtures/rollout/sample-events.jsonl](/Users/gato-pm/Desktop/API_副本/platform/tests/fixtures/rollout/sample-events.jsonl)

### 实施要点

1. 新增环境变量：
   - `LANGGRAPH_LEGACY_FALLBACK_ENABLED`
   - 默认建议为 `false` 或仅本地开发为 `true`，最终生产必须可关闭。
2. 当 scene 配置为 `routing.mode=langgraph` 且 cutover 命中时：
   - 优先执行 `runLangGraphAgentRuntime`。
   - 如果失败，根据开关决定是否 fallback。
3. 如果 fallback 被关闭：
   - 不调用 `runLegacyAgentRuntime`。
   - 返回 langgraph 原始错误或最终 state error。
   - 日志中记录 `legacyFallbackEnabled=false`。
4. 当 scene 仍是 `legacy` 或 `shadow` 时，不改变现有行为。
5. 补充单元测试覆盖：
   - fallback enabled 时仍可回退。
   - fallback disabled 时不回退。
   - direct-model scene 不受影响。

### 验收标准

1. `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0` 时，langgraph 失败不会调用 legacy agent runtime。
2. routePlan 和 traceContext 能看出 fallback 是否启用。
3. 现有 `legacy` / `shadow` 行为不被误伤。

### 建议验证命令

```bash
npm run lint:platform-configs
npm run regression:self-contained
LANGGRAPH_LEGACY_FALLBACK_ENABLED=0 npm run regression:self-contained
```

### Agent 执行提示词

```text
你负责 AG-01：路由与 fallback 策略收口。

工作目录：/Users/gato-pm/Desktop/API_副本。

任务目标：
1. 为 langgraph -> legacy 的自动回退增加环境变量开关。
2. 确保关闭 fallback 后不会再调用 退役 Agent 运行时 legacy agent runtime。
3. 不改变 direct-model、legacy、shadow 的既有语义。

请重点阅读：
- platform/gateway/index.js
- platform/runtime/fallback.js
- platform/runtime/shadow.js
- services/runtime.js
- platform/trace/context.js
- platform/tests/fixtures/rollout/sample-events.jsonl

实现要求：
1. 新增 LANGGRAPH_LEGACY_FALLBACK_ENABLED 开关解析。
2. 在 langgraph 执行失败或 finalState error 时，只有开关开启才允许 buildFallbackRoutePlan 并调用 legacy。
3. fallback 关闭时，保留原始错误信息，trace/log 中明确 legacyFallbackEnabled=false。
4. 补充或更新测试，证明 fallback disabled 时不会调用 runLegacyAgentRuntime。
5. 不要修改 scene-configs 的路由比例，这由后续场景迁移工单处理。

验收命令：
- npm run lint:platform-configs
- npm run regression:self-contained
- LANGGRAPH_LEGACY_FALLBACK_ENABLED=0 npm run regression:self-contained

最终回复请列出：
1. 修改文件。
2. fallback 开关行为说明。
3. 覆盖的测试场景。
4. 验证结果。
```

---

## AG-02. 项目内 LLM Tool 与 Client

### 目标

新增项目内 LLM 调用能力，替代 `旧 LLM toolRef`，让 `draft-output` 节点可以直接调用项目内模型 client 生成结构化 payload。

### 前置依赖

1. `AG-00` 完成。
2. 可与 `AG-01` 部分并行，但合入时需要处理冲突。

### 建议写入范围

1. `platform/tools/`
2. `platform/runtime/llm-client.js`
3. `platform/nodes/draft-output.js`
4. `platform/nodes/tool-runtime.js`
5. `platform/assets/prompts/`
6. 相关测试文件

### 关键参考文件

1. [platform/nodes/draft-output.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/draft-output.js)
2. [platform/nodes/tool-runtime.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/tool-runtime.js)
3. [platform/tools/旧 LLM tool 配置](/Users/gato-pm/Desktop/API_副本/platform/tools/旧 LLM tool 配置)
4. [platform/tools/model-tool-structured-output.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/model-tool-structured-output.tool.yaml)
5. [ModelTool/server.js](/Users/gato-pm/Desktop/API_副本/ModelTool/server.js)

### 实施要点

1. 新增 tool definition，建议：
   - `platform/tools/project-advisory-llm.tool.yaml`
   - `ref: tool://llm/project-advisory@v1`
   - `driver.type: project-llm`
2. 新增项目内 LLM client：
   - `platform/runtime/llm-client.js`
   - 支持读取现有模型配置和环境变量。
   - 不读取 `旧共享运行时目录`。
   - 不依赖 `旧 gateway token`。
3. `draft-output` 支持至少三种模式：
   - `compat`：当前本地确定性兼容 payload。
   - `project-llm`：调用项目内 LLM client。
   - `mock`：测试可注入稳定输出。
4. 建议新增环境变量：
   - `LANGGRAPH_DRAFT_MODE=compat|project-llm|mock`
   - 本地默认可保持 `compat`，迁移验证时切到 `project-llm`。
5. LLM 输出必须经过已有 `validate-output` / `repair-output` 流程。
6. 不要在 tool yaml 中写死外部 provider endpoint。
7. 不要引入 旧 Gateway 兼容层。

### 验收标准

1. `draft-output` 可在不启动 旧 Gateway 的情况下成功生成 payload。
2. `tool://llm/project-advisory@v1` 能被 BusinessSkill 绑定使用。
3. `LANGGRAPH_DRAFT_MODE=compat` 保持原测试稳定。
4. `LANGGRAPH_DRAFT_MODE=project-llm` 不访问 `旧本机 Gateway 端点`。

### 建议验证命令

```bash
npm run lint:platform-configs
npm run regression:self-contained
LANGGRAPH_DRAFT_MODE=compat npm run regression:self-contained
rg -n "旧 Gateway 端口|旧 gateway token|旧 agent gateway model" platform services scene-configs
```

### Agent 执行提示词

```text
你负责 AG-02：项目内 LLM tool 与 client。

工作目录：/Users/gato-pm/Desktop/API_副本。

任务目标：
1. 新增 project 内部 LLM tool，替代 旧 LLM tool。
2. 新增 platform/runtime/llm-client.js。
3. 改造 platform/nodes/draft-output.js，让 draft_business_output 节点可以走 project-llm driver。

请重点阅读：
- platform/nodes/draft-output.js
- platform/nodes/tool-runtime.js
- platform/tools/旧 LLM tool 配置
- platform/tools/model-tool-structured-output.tool.yaml
- platform/skills/sales-opportunity-advisor.v1.yaml
- platform/skills/sales-opportunity-advisor-directdb.v1.yaml
- platform/skills/sales-opportunity-smart-entry.v1.yaml
- ModelTool/server.js
- utils/load-env.js

实现要求：
1. 新增 platform/tools/project-advisory-llm.tool.yaml，ref 使用 tool://llm/project-advisory@v1，driver.type 使用 project-llm。
2. 新增 platform/runtime/llm-client.js，读取项目 .env 中的模型 provider key，不读取 旧共享运行时目录，不调用 旧本机 Gateway 端点。
3. draft-output 根据 toolDocument.spec.driver.type 或 LANGGRAPH_DRAFT_MODE 决定执行 compat/mock/project-llm。
4. project-llm 模式下，把 prompt、rules、facts、request、knowledgeMatches 组合成模型输入，并要求返回 JSON payload。
5. 如果模型返回非 JSON 或 schema 不完整，交给 validate-output/repair-output，不要在 draft-output 里吞掉错误。
6. 测试必须可以注入 mock，避免回归依赖真实模型 key。

验收命令：
- npm run lint:platform-configs
- LANGGRAPH_DRAFT_MODE=compat npm run regression:self-contained
- rg -n "旧 Gateway 端口|旧 gateway token|旧 agent gateway model" platform services scene-configs

最终回复请列出：
1. 新增/修改文件。
2. project-llm 的配置方式。
3. compat/mock/project-llm 三种模式行为。
4. 验证结果。
```

---

## AG-03. `sales-opportunity-advisor` 迁移

### 目标

把 `sales-opportunity-advisor` 从 `legacy` 主链路切到项目内 `langgraph` 主链路。

### 前置依赖

1. `AG-01` 完成。
2. `AG-02` 完成。

### 建议写入范围

1. `scene-configs/sales-opportunity-advisor.json`
2. `platform/skills/sales-opportunity-advisor.v1.yaml`
3. `platform/assets/prompts/sales-opportunity-advisor.draft-business-output.v1.md`
4. `platform/tools/sales-opportunity-by-opportunity-id.query.yaml`
5. 对应 fixtures/tests

### 关键参考文件

1. [scene-configs/sales-opportunity-advisor.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor.json)
2. [platform/skills/sales-opportunity-advisor.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor.v1.yaml)
3. [platform/templates/grounded-structured-advisory.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/templates/grounded-structured-advisory.v1.yaml)
4. [platform/tools/sales-opportunity-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-by-opportunity-id.query.yaml)

### 实施要点

1. 将 scene routing 调整为：
   - `mode: langgraph`
   - `allowedModes` 至少保留迁移期需要的模式。
   - `langgraphCutover.requestPercentage: 100`
2. 将 BusinessSkill 中 `toolBindings.advisory_llm.toolRef` 从 退役 Agent 运行时 tool 切到 `tool://llm/project-advisory@v1`。
3. 保留 `runtimeContract` 只用于 API 兼容，不再作为 退役 Agent 运行时 message 依据。
4. 确认数据链路为：
   - `generic-query-runner`
   - `query://sales-opportunity/by-opportunity-id@v1`
   - `ContextHelper/generated-queries/sales-opportunity-advisor.generated.js`
5. 确认输出仍符合 `sales-opportunity-advisor` schema。
6. 增加或更新回归：
   - 成功机会 ID。
   - 空 opportunityId。
   - 不存在 opportunityId。
   - 模型输出非法时的错误或修复路径。

### 验收标准

1. `sales-opportunity-advisor` 走 `langgraph`。
2. 关闭 legacy fallback 后仍能成功处理正常请求。
3. 请求过程中不访问 旧 Gateway。
4. 返回 payload 字段与旧链路兼容。

### 建议验证命令

```bash
npm run lint:platform-configs
LANGGRAPH_LEGACY_FALLBACK_ENABLED=0 LANGGRAPH_DRAFT_MODE=compat npm run regression:self-contained
rg -n "旧 agent gateway model|tool://llm/旧 LLM tool|旧本机 Gateway 端点" scene-configs/sales-opportunity-advisor.json platform/skills/sales-opportunity-advisor.v1.yaml
```

### Agent 执行提示词

```text
你负责 AG-03：sales-opportunity-advisor 迁移到项目内 langgraph。

工作目录：/Users/gato-pm/Desktop/API_副本。

前置假设：
- AG-01 已提供 LANGGRAPH_LEGACY_FALLBACK_ENABLED。
- AG-02 已提供 tool://llm/project-advisory@v1 和 project-llm/compat draft-output 能力。

任务目标：
1. 将 sales-opportunity-advisor 从 legacy 主链路切到 langgraph。
2. 不再使用 旧 agent gateway model 作为该场景主链路。
3. 保持 API response envelope 和业务 payload 兼容。

请重点阅读：
- scene-configs/sales-opportunity-advisor.json
- platform/skills/sales-opportunity-advisor.v1.yaml
- platform/templates/grounded-structured-advisory.v1.yaml
- platform/runtime/graphs/index.js
- platform/nodes/fetch-context.js
- platform/nodes/normalize-facts.js
- platform/nodes/draft-output.js
- platform/nodes/validate-output.js
- platform/tools/sales-opportunity-by-opportunity-id.query.yaml
- tests/fixtures/baseline/manifest.json

实现要求：
1. scene-configs/sales-opportunity-advisor.json 改为 routing.mode=langgraph，并设置 langgraphCutover.requestPercentage=100。
2. platform/skills/sales-opportunity-advisor.v1.yaml 的 advisory_llm toolRef 改为 tool://llm/project-advisory@v1。
3. 不删除 runtimeContract/requestMarkers/resultMarkers，除非已有代码确认不再需要；它们可作为兼容元数据保留。
4. 确保 query profile、dictionary、rules、schema 都能被 load-assets 和 fetch-context 正确读取。
5. 补充或更新回归 fixture/test，覆盖成功、空 opportunityId、不存在 opportunityId、模型输出异常。
6. 不修改 smart-entry 和 directdb 场景。

验收命令：
- npm run lint:platform-configs
- LANGGRAPH_LEGACY_FALLBACK_ENABLED=0 LANGGRAPH_DRAFT_MODE=compat npm run regression:self-contained
- rg -n "旧 agent gateway model|tool://llm/旧 LLM tool|旧本机 Gateway 端点" scene-configs/sales-opportunity-advisor.json platform/skills/sales-opportunity-advisor.v1.yaml

最终回复请列出：
1. 修改文件。
2. 新路由行为。
3. 对旧 response 兼容性的验证。
4. 验证命令结果。
```

---

## AG-04. `sales-opportunity-advisor-directdb` 纯项目化

### 目标

`sales-opportunity-advisor-directdb` 已经是 `langgraph`，本工单负责清理它对 退役 Agent 运行时 agent/tool 命名和 legacy fallback 的残留依赖。

### 前置依赖

1. `AG-01` 完成。
2. `AG-02` 完成。

### 建议写入范围

1. `scene-configs/sales-opportunity-advisor-directdb.json`
2. `platform/skills/sales-opportunity-advisor-directdb.v1.yaml`
3. `platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml`
4. `DirectDbRunner/sql-cache/`
5. directdb 相关测试

### 关键参考文件

1. [scene-configs/sales-opportunity-advisor-directdb.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor-directdb.json)
2. [platform/skills/sales-opportunity-advisor-directdb.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor-directdb.v1.yaml)
3. [platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml)
4. [platform/tools/sales-opportunity-directdb-runner.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-directdb-runner.tool.yaml)

### 实施要点

1. 保持 `routing.mode=langgraph` 和 `requestPercentage=100`。
2. 移除或弱化 scene config 中对 `agent.gatewayModel=旧 agent gateway model` 的运行时依赖。
3. BusinessSkill 的 advisory LLM 切到 `tool://llm/project-advisory@v1`。
4. 清理 `skill.entryFile`、query metadata 中不必要的 退役 Agent 运行时 path。
5. 如果 validator 当前要求 agent 字段存在，需要先由更通用的 scene schema 支持 `execution.mode=langgraph` 或 `agentRuntime=false`。
6. 确认 DirectDbRunner 仍能取数，不改变 SQL 缓存语义。

### 验收标准

1. `directdb` 场景关闭 fallback 后仍可走通。
2. 运行时不依赖 旧 Gateway。
3. 退役 Agent 运行时 残留只允许存在于历史文档或待 `AG-10` 统一清理的 asset namespace。

### 建议验证命令

```bash
npm run lint:platform-configs
LANGGRAPH_LEGACY_FALLBACK_ENABLED=0 LANGGRAPH_DRAFT_MODE=compat npm run regression:self-contained
rg -n "旧 agent gateway model|tool://llm/旧 LLM tool|旧本机 Gateway 端点" scene-configs/sales-opportunity-advisor-directdb.json platform/skills/sales-opportunity-advisor-directdb.v1.yaml platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml
```

### Agent 执行提示词

```text
你负责 AG-04：sales-opportunity-advisor-directdb 纯项目化。

工作目录：/Users/gato-pm/Desktop/API_副本。

前置假设：
- AG-01 已提供 fallback 开关。
- AG-02 已提供 project advisory LLM tool。

任务目标：
1. 保持 sales-opportunity-advisor-directdb 走 langgraph 100%。
2. 清理 directdb 配置里的 退役 Agent 运行时 agent/tool 主链路残留。
3. 不改变 DirectDbRunner 的 SQL 缓存和业务取数语义。

请重点阅读：
- scene-configs/sales-opportunity-advisor-directdb.json
- platform/skills/sales-opportunity-advisor-directdb.v1.yaml
- platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml
- platform/tools/sales-opportunity-directdb-runner.tool.yaml
- DirectDbRunner/sql-cache/sales-opportunity-advisor-directdb.sql.json
- platform/nodes/fetch-context.js
- platform/nodes/normalize-facts.js

实现要求：
1. advisory_llm toolRef 改为 tool://llm/project-advisory@v1。
2. 不再让 directdb 场景需要 旧 agent gateway model 才能通过配置校验。
3. 如果 services/scene-config.js 的校验强制 agent.gatewayModel，请改造成仅 legacy agent-runtime 需要该字段；langgraph 场景可以使用 platform BusinessSkill。
4. 清理 skillPath 中非必要 退役 Agent 运行时 引用，但不要做大规模 runtime-assets 目录重命名；目录命名由 AG-10 处理。
5. 补充或更新 directdb 回归。

验收命令：
- npm run lint:platform-configs
- LANGGRAPH_LEGACY_FALLBACK_ENABLED=0 LANGGRAPH_DRAFT_MODE=compat npm run regression:self-contained
- rg -n "旧 agent gateway model|tool://llm/旧 LLM tool|旧本机 Gateway 端点" scene-configs/sales-opportunity-advisor-directdb.json platform/skills/sales-opportunity-advisor-directdb.v1.yaml platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml

最终回复请列出：
1. 修改文件。
2. directdb 当前运行链路。
3. 配置校验变化。
4. 验证结果。
```

---

## AG-05. `sales-opportunity-smart-entry` 迁移

### 目标

把 `sales-opportunity-smart-entry` 从 退役 Agent 运行时 legacy 主链路迁移到项目内 `langgraph`。

### 前置依赖

1. `AG-01` 完成。
2. `AG-02` 完成。
3. 建议在 `AG-03` 完成后执行，因为 smart-entry 与 advisor 共享很多节点和输出校验路径。

### 建议写入范围

1. `scene-configs/sales-opportunity-smart-entry.json`
2. `platform/skills/sales-opportunity-smart-entry.v1.yaml`
3. `platform/assets/prompts/sales-opportunity-smart-entry.draft-business-output.v1.md`
4. `platform/tools/sales-opportunity-smart-entry-by-opportunity-id.query.yaml`
5. smart-entry fixtures/tests

### 关键参考文件

1. [scene-configs/sales-opportunity-smart-entry.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-smart-entry.json)
2. [platform/skills/sales-opportunity-smart-entry.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-smart-entry.v1.yaml)
3. [platform/tools/sales-opportunity-smart-entry-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-smart-entry-by-opportunity-id.query.yaml)
4. [runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/SKILL.md](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/SKILL.md)

### 实施要点

1. 将 scene routing 改为 `langgraph` 100%。
2. advisory LLM 切到 `tool://llm/project-advisory@v1`。
3. 确保 input contract 包含：
   - `opportunityId`
   - `rawText`
4. `draft-output` 对 smart-entry 不能复用 advisor 的建议 payload 结构，必须输出 smart-entry schema 需要的字段。
5. 必要时在 `draft-output` 或 project LLM prompt builder 中按 scene 分支构建输出要求。
6. 回归覆盖：
   - 正常 rawText。
   - rawText 为空或超长。
   - opportunityId 不存在。
   - 输出字段不符合 schema。

### 验收标准

1. smart-entry 不再依赖 旧 Gateway。
2. smart-entry 的 `rawText` 在项目内 graph 中被使用。
3. 输出 schema 与历史 scene 保持一致。

### 建议验证命令

```bash
npm run lint:platform-configs
LANGGRAPH_LEGACY_FALLBACK_ENABLED=0 LANGGRAPH_DRAFT_MODE=compat npm run regression:self-contained
rg -n "旧 agent gateway model|tool://llm/旧 LLM tool|旧本机 Gateway 端点" scene-configs/sales-opportunity-smart-entry.json platform/skills/sales-opportunity-smart-entry.v1.yaml
```

### Agent 执行提示词

```text
你负责 AG-05：sales-opportunity-smart-entry 迁移到项目内 langgraph。

工作目录：/Users/gato-pm/Desktop/API_副本。

前置假设：
- AG-01 已提供 fallback 开关。
- AG-02 已提供 project advisory LLM tool。
- AG-03 已完成 advisor 场景迁移，可参考其模式。

任务目标：
1. 将 sales-opportunity-smart-entry 从 legacy 切到 langgraph。
2. 保证 rawText 被项目内工作流使用。
3. 输出符合 smart-entry 的 output_schema.json。

请重点阅读：
- scene-configs/sales-opportunity-smart-entry.json
- platform/skills/sales-opportunity-smart-entry.v1.yaml
- platform/assets/prompts/sales-opportunity-smart-entry.draft-business-output.v1.md
- platform/tools/sales-opportunity-smart-entry-by-opportunity-id.query.yaml
- runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/SKILL.md
- runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/references/output_schema.json
- platform/nodes/draft-output.js
- platform/nodes/validate-input.js
- platform/nodes/validate-output.js

实现要求：
1. scene-configs/sales-opportunity-smart-entry.json 改为 routing.mode=langgraph，并设置 langgraphCutover.requestPercentage=100。
2. advisory_llm toolRef 改为 tool://llm/project-advisory@v1。
3. 确认 inputContract 中 opportunityId 和 rawText 都被正确映射。
4. 如 draft-output 当前只适合 advisor payload，请增加 scene-aware 的 smart-entry payload 构建逻辑，或通过 project-llm prompt builder 约束输出结构。
5. 补充或更新 smart-entry 回归 fixture/test。
6. 不修改 advisor/directdb 的路由配置。

验收命令：
- npm run lint:platform-configs
- LANGGRAPH_LEGACY_FALLBACK_ENABLED=0 LANGGRAPH_DRAFT_MODE=compat npm run regression:self-contained
- rg -n "旧 agent gateway model|tool://llm/旧 LLM tool|旧本机 Gateway 端点" scene-configs/sales-opportunity-smart-entry.json platform/skills/sales-opportunity-smart-entry.v1.yaml

最终回复请列出：
1. 修改文件。
2. smart-entry 的新运行链路。
3. rawText 参与生成的说明。
4. 验证结果。
```

---

## AG-06. Direct-Model 场景 退役 Agent 运行时 残留清理

### 目标

清理 `payment-info-split` 和 `special-custom-product-solution` 中与 退役 Agent 运行时 命名相关但非主链路的残留。

### 前置依赖

1. `AG-00` 完成。
2. 可与 `AG-02`、`AG-03` 并行。

### 建议写入范围

1. `scene-configs/payment-info-split.json`
2. `scene-configs/special-custom-product-solution.json`
3. `platform/skills/special-custom-product-solution.v1.yaml`
4. `platform/tools/旧 product-solution tool.tool.yaml` 或其替代文件
5. `runtime-assets/model-profiles/`
6. direct-model 相关测试和 bundle renderer 测试

### 关键参考文件

1. [scene-configs/payment-info-split.json](/Users/gato-pm/Desktop/API_副本/scene-configs/payment-info-split.json)
2. [scene-configs/special-custom-product-solution.json](/Users/gato-pm/Desktop/API_副本/scene-configs/special-custom-product-solution.json)
3. [platform/skills/special-custom-product-solution.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/special-custom-product-solution.v1.yaml)
4. [services/direct-model.js](/Users/gato-pm/Desktop/API_副本/services/direct-model.js)
5. [services/bundle-renderer.js](/Users/gato-pm/Desktop/API_副本/services/bundle-renderer.js)

### 实施要点

1. 将 `runtime://project-runtime/agents/payment-fast-agent/agent/models.json` 迁移到项目通用模型目录，例如：
   - `runtime-assets/model-profiles/payment-fast-agent/models.json`
   - 或 `runtime-assets/project-runtime/model-profiles/payment-fast-agent/models.json`
2. 调整引用该文件的 scene config 和 bundle renderer 测试。
3. `special-custom-product-solution` 如果是 direct-model，不应保留无用 `agent.gatewayModel`。
4. 若 `旧 product-solution tool.tool.yaml` 只是命名残留，新增 project 版 tool 并迁移引用。
5. 保持 direct-model 请求行为不变。

### 验收标准

1. direct-model 场景不再引用 `runtime://project-runtime/agents/...`。
2. direct-model 场景不要求 退役 Agent 运行时 agent 配置。
3. direct-model 回归不受影响。

### 建议验证命令

```bash
npm run lint:platform-configs
npm run regression:self-contained
rg -n "runtime://project-runtime/agents|旧 product-solution tool|旧 agent gateway model" scene-configs platform/skills platform/tools services tests scripts
```

### Agent 执行提示词

```text
你负责 AG-06：direct-model 场景 退役 Agent 运行时 残留清理。

工作目录：/Users/gato-pm/Desktop/API_副本。

任务目标：
1. 清理 payment-info-split 和 special-custom-product-solution 中非必要的 退役 Agent 运行时 命名和路径。
2. 不改变 direct-model 场景的运行行为。
3. 将模型元数据从 runtime://project-runtime/agents/... 迁移到项目通用目录。

请重点阅读：
- scene-configs/payment-info-split.json
- scene-configs/special-custom-product-solution.json
- services/direct-model.js
- services/bundle-renderer.js
- platform/skills/special-custom-product-solution.v1.yaml
- platform/tools/旧 product-solution tool.tool.yaml
- scripts/verify_bundle_renderer.js
- scripts/verify_active_bundle_direct_model.js

实现要求：
1. 新增项目通用模型元数据目录，例如 runtime-assets/model-profiles/payment-fast-agent/models.json。
2. 更新 payment-info-split 的 fallbackModelsFile 或等价引用。
3. 清理 special-custom-product-solution 中无用的 agent.gatewayModel/skill.entryFile，如果校验器要求这些字段，需要调整校验器区分 direct-model 和 langgraph。
4. 如果需要保留 product solution LLM tool，请新增 project 命名版本，不再使用 旧 product-solution tool 作为主引用。
5. 更新 bundle renderer 和 direct-model 相关测试。

验收命令：
- npm run lint:platform-configs
- npm run regression:self-contained
- rg -n "runtime://project-runtime/agents|旧 product-solution tool|旧 agent gateway model" scene-configs platform/skills platform/tools services tests scripts

最终回复请列出：
1. 修改文件。
2. 模型元数据迁移位置。
3. direct-model 行为是否变化。
4. 验证结果。
```

---

## AG-07. 文档、控制台与图示去 退役 Agent 运行时

### 目标

把用户可见的控制台、文档、图示中的 退役 Agent 运行时 主链路描述改为项目内 LangGraph 描述，避免上线后误导运维和开发。

### 前置依赖

1. `AG-00` 完成。
2. 最好在 `AG-03` 至少完成后再最终收口。

### 建议写入范围

1. `docs/`
2. `services/console-*`
3. `scripts/generate_agent_architecture_images.py`
4. `scripts/generate_sales_architecture_pdf.py`
5. `platform/tools/README.md`
6. `platform/templates/README.md`

### 关键参考文件

1. [services/console-scenes.js](/Users/gato-pm/Desktop/API_副本/services/console-scenes.js)
2. [services/console-configs.js](/Users/gato-pm/Desktop/API_副本/services/console-configs.js)
3. [scripts/generate_agent_architecture_images.py](/Users/gato-pm/Desktop/API_副本/scripts/generate_agent_architecture_images.py)
4. [scripts/generate_sales_architecture_pdf.py](/Users/gato-pm/Desktop/API_副本/scripts/generate_sales_architecture_pdf.py)

### 实施要点

1. 控制台中如果展示 `retired-runtime.console/v1` 等历史标识，要判断是否只是配置中心版本名；不要盲目改破兼容字段。
2. 控制台不再把 `旧共享运行时目录/workspace-sales-agent` 当作镜像目标。
3. 架构图改为：
   - API Gateway
   - Platform Gateway
   - LangGraph Runtime
   - ContextHelper / DirectDbRunner / ModelTool
   - Project LLM Client
4. 文档中保留历史迁移说明可以，但运行指引不得要求启动 退役 Agent 运行时。

### 验收标准

1. 用户可见运行文档不再要求 旧 Gateway。
2. 架构图不再把 退役 Agent 运行时 画成主链路。
3. 控制台不会再尝试写入 `旧共享运行时目录`。

### 建议验证命令

```bash
rg -n "退役 Agent 运行时|retired-runtime|旧 Gateway 端口|旧共享运行时目录|workspace-sales-agent" docs services scripts platform | head -n 200
npm run check
```

### Agent 执行提示词

```text
你负责 AG-07：文档、控制台与图示去 退役 Agent 运行时。

工作目录：/Users/gato-pm/Desktop/API_副本。

任务目标：
1. 清理用户可见文档、控制台、架构图中的 退役 Agent 运行时 主链路描述。
2. 不破坏配置中心已有数据结构兼容。
3. 让部署和运维指引指向项目内 LangGraph/runtime。

请重点阅读：
- services/console-scenes.js
- services/console-configs.js
- services/console-traces.js
- services/console-runs.js
- scripts/generate_agent_architecture_images.py
- scripts/generate_sales_architecture_pdf.py
- platform/tools/README.md
- platform/templates/README.md
- docs/项目开发文档/退役 Agent 运行时退场与项目内LangGraph迁移任务清单.md

实现要求：
1. 控制台不再把 旧共享运行时目录/workspace-sales-agent 作为必须镜像目录。
2. 运行文档和启动说明不再要求 旧 Gateway。
3. 架构图脚本中的主链路从 旧 Gateway 改为 Platform Gateway + LangGraph Runtime。
4. 历史说明可以保留，但必须标注为历史链路。
5. 不修改 runtime 业务逻辑。

验收命令：
- rg -n "退役 Agent 运行时|retired-runtime|旧 Gateway 端口|旧共享运行时目录|workspace-sales-agent" docs services scripts platform | head -n 200
- npm run check

最终回复请列出：
1. 修改文件。
2. 哪些 退役 Agent 运行时 文案被保留为历史说明。
3. 哪些运行说明已切到项目内 runtime。
4. 验证结果。
```

---

## AG-08. Health、Bootstrap 与启动脚本去 退役 Agent 运行时

### 目标

项目启动和健康检查不再要求 旧 Gateway。

### 前置依赖

1. `AG-03`、`AG-04`、`AG-05` 至少完成主场景迁移。

### 建议写入范围

1. `server.js`
2. `scripts/bootstrap_local_runtime.js`
3. `scripts/install_launch_agents.sh`
4. `package.json`
5. `.env.example` 或部署文档

### 关键参考文件

1. [server.js](/Users/gato-pm/Desktop/API_副本/server.js)
2. [scripts/bootstrap_local_runtime.js](/Users/gato-pm/Desktop/API_副本/scripts/bootstrap_local_runtime.js)
3. [scripts/install_launch_agents.sh](/Users/gato-pm/Desktop/API_副本/scripts/install_launch_agents.sh)
4. [package.json](/Users/gato-pm/Desktop/API_副本/package.json)

### 实施要点

1. `/health` 不再检查 旧 Gateway。
2. `bootstrap_local_runtime.js` 的 `REQUIRED_ENV_KEYS` 移除 `旧 gateway token`。
3. `OPTIONAL_EXTERNAL_ENDPOINTS` 移除 旧 Gateway probe。
4. 启动脚本不再启动 退役 Agent 运行时 LaunchAgent。
5. 如有需要，新增 LangGraph runtime 自检：
   - platform configs 可加载。
   - graph 可 compile。
   - project LLM client 配置可检查。
6. 保留 ContextHelper、DirectDbRunner、ModelTool、RAG 等真实依赖检查。

### 验收标准

1. 没有 旧 Gateway 时 `/health` 不失败。
2. bootstrap 不要求 `旧 gateway token`。
3. `npm run bootstrap:local:dry-run` 不探测 `旧本机 Gateway 端点`。

### 建议验证命令

```bash
npm run bootstrap:local:dry-run
npm run check
rg -n "旧 gateway token|旧 Gateway 端口|旧 Gateway" server.js scripts package.json
```

### Agent 执行提示词

```text
你负责 AG-08：Health、Bootstrap 与启动脚本去 退役 Agent 运行时。

工作目录：/Users/gato-pm/Desktop/API_副本。

前置假设：
- 三个主要 agent-runtime 场景已迁移到项目内 langgraph。

任务目标：
1. /health 不再要求 旧 Gateway。
2. bootstrap 不再要求 旧 gateway token。
3. 本地和服务器启动脚本不再启动或检查 退役 Agent 运行时。

请重点阅读：
- server.js
- scripts/bootstrap_local_runtime.js
- scripts/install_launch_agents.sh
- package.json
- utils/load-env.js
- docs/项目开发文档/退役 Agent 运行时退场与项目内LangGraph迁移任务清单.md

实现要求：
1. 从 health check 中移除 旧 Gateway 检查。
2. 从 REQUIRED_ENV_KEYS 中移除 旧 gateway token。
3. 从 OPTIONAL_EXTERNAL_ENDPOINTS 中移除 旧本机 Gateway 模型探测端点。
4. 启动脚本不再启动 退役 Agent 运行时 相关服务。
5. 如需要替代检查，增加 project runtime/langgraph compile/config check。
6. 更新部署或 env 示例文档。

验收命令：
- npm run bootstrap:local:dry-run
- npm run check
- rg -n "旧 gateway token|旧 Gateway 端口|旧 Gateway" server.js scripts package.json

最终回复请列出：
1. 修改文件。
2. health/bootstrap 新检查项。
3. 被移除的 退役 Agent 运行时 检查项。
4. 验证结果。
```

---

## AG-09. 删除 Legacy 退役 Agent 运行时 主链路

### 目标

在主场景全部迁移后，删除或隔离 退役 Agent 运行时 legacy runtime request builder 和 Gateway 调用路径。

### 前置依赖

1. `AG-03` 完成。
2. `AG-04` 完成。
3. `AG-05` 完成。
4. `AG-08` 完成。
5. fallback 已确认可以关闭。

### 建议写入范围

1. `services/runtime-message.js`
2. `services/runtime.js`
3. `services/response-parser.js`
4. `platform/gateway/index.js`
5. `services/scene-config.js`
6. legacy 相关测试

### 关键参考文件

1. [services/runtime-message.js](/Users/gato-pm/Desktop/API_副本/services/runtime-message.js)
2. [services/runtime.js](/Users/gato-pm/Desktop/API_副本/services/runtime.js)
3. [services/response-parser.js](/Users/gato-pm/Desktop/API_副本/services/response-parser.js)
4. [platform/gateway/index.js](/Users/gato-pm/Desktop/API_副本/platform/gateway/index.js)

### 实施要点

1. 禁止新增 `legacy` agent-runtime scene。
2. 对仍配置为 `legacy` 的 agent-runtime scene：
   - 启动/配置校验时报错。
   - 或仅在明确 `ALLOW_LEGACY_RETIRED_RUNTIME_RUNTIME=1` 的开发模式中启用。
3. 删除 `buildRuntimeRequest` 对 旧 Gateway 的主路径使用。
4. `response-parser` 不再以 退役 Agent 运行时 wrapped markers 为唯一解析方式。
5. 如果保留历史文件，必须标注 deprecated，且默认路径不引用。
6. 删除测试中对 legacy 退役 Agent 运行时 成功路径的依赖，改成验证“禁止 legacy”。

### 验收标准

1. 主路径代码中没有对 `旧本机 Gateway 端点` 的调用。
2. agent-runtime scene 不再能默认走 退役 Agent 运行时 legacy。
3. `npm run regression:self-contained` 通过。

### 建议验证命令

```bash
npm run check
npm run regression:self-contained
rg -n "旧本机 Gateway 端点|旧 gateway token|buildRuntimeRequest|GATEWAY_CHAT_COMPLETIONS_URL|旧 agent gateway model" services platform scene-configs tests
```

### Agent 执行提示词

```text
你负责 AG-09：删除 legacy 退役 Agent 运行时 主链路。

工作目录：/Users/gato-pm/Desktop/API_副本。

前置假设：
- sales-opportunity-advisor、sales-opportunity-advisor-directdb、sales-opportunity-smart-entry 均已走 langgraph。
- health/bootstrap 已不依赖 退役 Agent 运行时。
- fallback 默认已关闭。

任务目标：
1. 删除或隔离 退役 Agent 运行时 legacy runtime request builder 和 Gateway 调用路径。
2. 禁止 agent-runtime scene 默认走 legacy 退役 Agent 运行时。
3. 保持 direct-model 场景不受影响。

请重点阅读：
- services/runtime-message.js
- services/runtime.js
- services/response-parser.js
- platform/gateway/index.js
- services/scene-config.js
- tests/regression/README.md
- tests/fixtures/baseline/manifest.json

实现要求：
1. 移除主路径对 GATEWAY_CHAT_COMPLETIONS_URL / 旧本机 Gateway 端点 的调用。
2. 如果保留 services/runtime-message.js 作为历史兼容文件，默认代码不得引用它；文件和导出要标记 deprecated。
3. 新增校验：agent-runtime scene 不允许 routing.mode=legacy，除非显式开发开关 ALLOW_LEGACY_RETIRED_RUNTIME_RUNTIME=1。
4. 更新测试：不再期待 退役 Agent 运行时 legacy 成功，而是期待 legacy 禁止或 langgraph 成功。
5. 不删除 direct-model 运行代码。

验收命令：
- npm run check
- npm run regression:self-contained
- rg -n "旧本机 Gateway 端点|旧 gateway token|buildRuntimeRequest|GATEWAY_CHAT_COMPLETIONS_URL|旧 agent gateway model" services platform scene-configs tests

最终回复请列出：
1. 修改文件。
2. legacy 退役 Agent 运行时 如何被禁用。
3. 是否保留 deprecated 文件及原因。
4. 验证结果。
```

---

## AG-10. Runtime Asset Namespace 清理

### 目标

把 `runtime://project-runtime/...` 这种历史命名迁移为项目通用 runtime namespace，降低后续部署和理解成本。

### 前置依赖

1. `AG-03` 完成。
2. `AG-04` 完成。
3. `AG-05` 完成。
4. `AG-06` 完成。
5. `AG-09` 完成。

### 建议写入范围

1. `runtime-assets/`
2. `utils/path-resolver.js`
3. `services/bundle-renderer.js`
4. `services/scene-config.js`
5. `platform/skills/*.yaml`
6. `platform/tools/*.yaml`
7. `scene-configs/*.json`
8. bundle renderer / active bundle tests

### 关键参考文件

1. [utils/path-resolver.js](/Users/gato-pm/Desktop/API_副本/utils/path-resolver.js)
2. [services/bundle-renderer.js](/Users/gato-pm/Desktop/API_副本/services/bundle-renderer.js)
3. [platform/nodes/load-assets.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/load-assets.js)
4. [scripts/verify_bundle_renderer.js](/Users/gato-pm/Desktop/API_副本/scripts/verify_bundle_renderer.js)
5. [scripts/verify_active_bundle_load_assets.js](/Users/gato-pm/Desktop/API_副本/scripts/verify_active_bundle_load_assets.js)

### 实施要点

1. 选择新 namespace：
   - 推荐 `runtime://project-runtime/...`
   - 或 `runtime://agent-platform/...`
2. 迁移目录，例如：
   - `runtime-assets/project-runtime/workspace/skills/...`
   - 到 `runtime-assets/project-runtime/workspace/skills/...`
3. 更新 path resolver 支持新 namespace。
4. 如果短期保留旧 namespace 兼容，必须只作为迁移兼容，不得在新配置中继续使用。
5. 更新所有 scene/skill/tool/schema/rules 引用。
6. 更新 bundle renderer 测试中的期望路径。

### 验收标准

1. 运行配置中不再出现 `runtime://project-runtime`。
2. `load-assets` 能读取新 namespace 下的 prompt/rules/schema。
3. bundle renderer 和 active bundle 验证通过。

### 建议验证命令

```bash
npm run check
npm run regression:self-contained
node scripts/verify_bundle_renderer.js
node scripts/verify_active_bundle_load_assets.js
rg -n "runtime://project-runtime|runtime-assets/project-runtime" scene-configs platform services scripts tests runtime-assets
```

### Agent 执行提示词

```text
你负责 AG-10：runtime asset namespace 清理。

工作目录：/Users/gato-pm/Desktop/API_副本。

前置假设：
- 主场景已不依赖 退役 Agent 运行时。
- legacy 退役 Agent 运行时 主链路已删除或禁用。

任务目标：
1. 将 runtime://project-runtime/... 迁移到项目通用 namespace。
2. 更新 runtime-assets 目录和所有配置引用。
3. 保证 bundle renderer、load-assets、active bundle 验证通过。

请重点阅读：
- utils/path-resolver.js
- services/bundle-renderer.js
- platform/nodes/load-assets.js
- scene-configs/*.json
- platform/skills/*.yaml
- platform/tools/*.yaml
- scripts/verify_bundle_renderer.js
- scripts/verify_active_bundle_load_assets.js

实现要求：
1. 选定新 namespace，推荐 runtime://project-runtime。
2. 迁移 runtime-assets/project-runtime/workspace/skills 到新目录。
3. 更新 path resolver 和 bundle renderer，让新 namespace 能被正确解析和打包。
4. 更新 scene-configs、platform/skills、platform/tools、tests 中所有运行配置引用。
5. 如保留旧 namespace 兼容，必须有注释或测试证明新配置不再使用旧 namespace。
6. 不修改业务 prompt/rules/schema 内容。

验收命令：
- npm run check
- npm run regression:self-contained
- node scripts/verify_bundle_renderer.js
- node scripts/verify_active_bundle_load_assets.js
- rg -n "runtime://project-runtime|runtime-assets/project-runtime" scene-configs platform services scripts tests runtime-assets

最终回复请列出：
1. 新 namespace。
2. 迁移目录。
3. 更新的引用类型。
4. 验证结果。
```

---

## AG-11. 最终回归、无 退役 Agent 运行时 模式与上线门槛

### 目标

建立最终上线前验证命令，确保在没有 退役 Agent 运行时 的服务器上项目能启动、回归通过、主场景可用。

### 前置依赖

1. `AG-01` 至 `AG-10` 全部完成。

### 建议写入范围

1. `scripts/`
2. `tests/`
3. `platform/trace/rollout-report.js`
4. `docs/项目开发文档/`
5. `package.json`

### 关键参考文件

1. [scripts/run_self_contained_regression.js](/Users/gato-pm/Desktop/API_副本/scripts/run_self_contained_regression.js)
2. [platform/trace/rollout-report.js](/Users/gato-pm/Desktop/API_副本/platform/trace/rollout-report.js)
3. [package.json](/Users/gato-pm/Desktop/API_副本/package.json)
4. [tests/regression/README.md](/Users/gato-pm/Desktop/API_副本/tests/regression/README.md)

### 实施要点

1. 新增无 退役 Agent 运行时 回归命令，建议：
   - `npm run regression:no-retired-runtime`
2. 该命令应设置：
   - `LANGGRAPH_LEGACY_FALLBACK_ENABLED=0`
   - `LANGGRAPH_DRAFT_MODE=compat` 或测试 mock
   - 不设置 `旧 gateway token`
3. 回归过程应覆盖：
   - `sales-opportunity-advisor`
   - `sales-opportunity-advisor-directdb`
   - `sales-opportunity-smart-entry`
   - `payment-info-split`
   - `special-custom-product-solution`
4. 新增最终验收脚本，检查：
   - 没有运行时 退役 Agent 运行时 blocker。
   - 没有 `旧本机 Gateway 端点` 主路径引用。
   - scene config 全部可校验。
   - platform graph 可 compile。
5. 生成上线报告文档，建议：
   - `docs/项目开发文档/退役 Agent 运行时退场最终验收报告.md`

### 验收标准

1. 一条命令可以证明“无 退役 Agent 运行时 环境可运行”。
2. 最终扫描只允许历史文档或迁移报告中出现 退役 Agent 运行时。
3. 所有主场景回归通过。

### 建议验证命令

```bash
npm run regression:no-retired-runtime
npm run check
node scripts/scan_retired_runtime_dependencies.js --fail-on-runtime-blocker
```

### Agent 执行提示词

```text
你负责 AG-11：最终回归、无 退役 Agent 运行时 模式与上线门槛。

工作目录：/Users/gato-pm/Desktop/API_副本。

前置假设：
- AG-01 到 AG-10 已完成。
- 主链路已迁移到项目内 langgraph。
- 退役 Agent 运行时 legacy 主链路已删除或默认禁用。

任务目标：
1. 新增 npm run regression:no-retired-runtime。
2. 新增最终验收脚本或完善现有扫描脚本。
3. 输出 退役 Agent 运行时 退场最终验收报告。

请重点阅读：
- package.json
- scripts/run_self_contained_regression.js
- scripts/scan_retired_runtime_dependencies.js
- tests/fixtures/self-contained/manifest.json
- tests/regression/README.md
- platform/trace/rollout-report.js
- docs/项目开发文档/退役 Agent 运行时退场与项目内LangGraph迁移任务清单.md

实现要求：
1. regression:no-retired-runtime 必须在不设置 旧 gateway token 的情况下运行。
2. regression:no-retired-runtime 必须设置 LANGGRAPH_LEGACY_FALLBACK_ENABLED=0。
3. 回归覆盖 sales-opportunity-advisor、sales-opportunity-advisor-directdb、sales-opportunity-smart-entry、payment-info-split、special-custom-product-solution。
4. scan_retired_runtime_dependencies.js 支持 --fail-on-runtime-blocker，发现 runtime blocker 时非零退出。
5. 新增 docs/项目开发文档/退役 Agent 运行时退场最终验收报告.md，包含验证命令、结果、剩余历史引用说明、上线建议。

验收命令：
- npm run regression:no-retired-runtime
- npm run check
- node scripts/scan_retired_runtime_dependencies.js --fail-on-runtime-blocker

最终回复请列出：
1. 修改文件。
2. regression:no-retired-runtime 的执行内容。
3. 最终扫描结论。
4. 是否达到上线门槛。
```

## 6. 多 Agent 协作建议

### 6.1 第一批

先只派：

1. `AG-00`
2. `AG-01`
3. `AG-02`

原因：

1. `AG-00` 给所有人提供扫描基线。
2. `AG-01` 决定 fallback 行为。
3. `AG-02` 是后续三个业务场景迁移的底座。

### 6.2 第二批

等 `AG-02` 合入后派：

1. `AG-03`
2. `AG-04`
3. `AG-05`
4. `AG-06`

这四个任务写入范围基本不同，但 `AG-03`、`AG-04`、`AG-05` 都可能接触 `platform/nodes/draft-output.js`。如果 `AG-02` 已经把 scene-aware 能力做好，后续三个任务应尽量只改各自 scene/skill/test。

### 6.3 第三批

主场景验证通过后派：

1. `AG-07`
2. `AG-08`

这两个任务偏运维、文档和可见面清理。

### 6.4 收尾批

最后派：

1. `AG-09`
2. `AG-10`
3. `AG-11`

这三个任务不建议并行。它们会删除旧链路、迁移 namespace、建立最终上线门槛，改动面大，必须按顺序做。

## 7. 合并检查清单

每个 agent 交付后，合并者需要检查：

1. 是否只改了该工单允许的文件范围。
2. 是否误删了其他 scene 的配置。
3. 是否新增了对 `旧本机 Gateway 端点` 的依赖。
4. 是否新增了对 `旧共享运行时目录` 的依赖。
5. 是否新增了 `旧 gateway token` 必填项。
6. 是否更新或补充测试。
7. 是否运行了验收命令。
8. 如果验收命令失败，失败原因是否明确且可复现。

## 8. 最终完成定义

全部工单完成后，项目应满足：

1. `sales-opportunity-advisor` 走项目内 `langgraph`。
2. `sales-opportunity-advisor-directdb` 走项目内 `langgraph`。
3. `sales-opportunity-smart-entry` 走项目内 `langgraph`。
4. `payment-info-split` 和 `special-custom-product-solution` 不再有 退役 Agent 运行时 主链路或 agent 命名依赖。
5. `/health` 不检查 旧 Gateway。
6. `bootstrap` 不要求 `旧 gateway token`。
7. 无 退役 Agent 运行时 环境下 `npm run regression:no-retired-runtime` 通过。
8. 运行时扫描无 `runtime-blocker`。
9. 文档明确说明 退役 Agent 运行时 只是历史链路，不再是部署依赖。
