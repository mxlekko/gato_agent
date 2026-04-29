# Agent业务平台并行迁移分阶段任务清单（AI可执行版）

## 1. 文档目标

本文档用于把“当前已跑通的垂直业务 agent 场景”迁移为“可配置、可复用的业务编排平台”，并将迁移计划拆解成可由 AI 按阶段推进的任务清单。

约束前提：

1. 不推倒重来。
2. 保持现有 `POST /api/agent/run` 尽量兼容。
3. 新平台先作为并行路径落地。
4. 当前已跑通的 `sales-opportunity-advisor` 先做旁路迁移。
5. 每一阶段都必须可运行、可测试、可回退。

## 2. 执行原则

### 2.1 总体迁移策略

- 先固化当前行为，再搭旁路，不直接替换主链路。
- 先让新平台“能看见并复现现状”，再让它“真正接管流量”。
- 先复用当前 API、ContextHelper、ModelTool，再逐步把编排能力抽离出来。
- 第一版不做 monorepo 改造，不拆仓，不改语言栈；新平台代码先落在当前仓库内。

### 2.2 V1 不先动的边界

以下内容在前几个阶段只允许复用，不允许优先重写：

- [server.js](/Users/gato-pm/Desktop/API_副本/server.js)
- [routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js)
- [ContextHelper/server.js](/Users/gato-pm/Desktop/API_副本/ContextHelper/server.js)
- [ModelTool/server.js](/Users/gato-pm/Desktop/API_副本/ModelTool/server.js)
- `.openclaw` 下当前正在运行的 `sales-agent` 和现有 `SKILL.md`
- `deploy/` 下常驻启动脚本

说明：

- 前期允许在 API 和路由层做“加法式接入”，不做高风险重写。
- 前期不改变外部调用方协议，不要求调用方改接入方式。

### 2.3 V1 建议新增目录

为了避免一开始就做目录大搬家，建议先在当前仓库内新增：

```text
platform/
  gateway/
  templates/
  skills/
  tools/
  compiler/
  runtime/
  nodes/
  policy/
  trace/
  tests/
scripts/
tests/
  fixtures/
  regression/
```

说明：

- 现有 `services/`、`scene-configs/`、`ContextHelper/`、`ModelTool/` 保持原样。
- 新平台先以 `platform/` 并行增量落地，后续稳定后再考虑再拆分。

### 2.4 前端页面在本次迁移中的定位

前端页面需要纳入计划，但不应成为后端平台迁移的前置阻塞项。

建议定位为：

- 面向内部的“平台控制台”，不是外部调用方页面
- 先做只读和联调能力，再做受控配置编辑
- 先服务迁移、联调、排障，再服务运营化和低代码化

V1 前端页面建议只覆盖下面几类能力：

1. Workflow / Scene 浏览页
2. 单次请求调试页
3. Shadow 对比页
4. Trace / Audit 查看页
5. 受控配置查看与校验页

V1 不建议优先做：

- 可视化拖拽编排器
- 在线自由改节点逻辑
- 在线自由改查询脚本或 SQL
- 生产环境直接发布配置

### 2.5 V1 前端建议落点

如果仓库内补一个最小前端控制台，建议独立为：

```text
console/
  src/
    pages/
      scenes/
      workflows/
      runs/
      traces/
      configs/
    components/
    services/
    mocks/
```

说明：

- `console/` 作为独立页面工程，不反向依赖后端主链路。
- 即使前端未完成，后端阶段0到阶段5仍然可以继续推进。

## 3. 阶段依赖关系

```text
阶段0 -> 阶段1 -> 阶段2 -> 阶段3 -> 阶段4 -> 阶段5 -> 阶段6 -> 阶段7
```

前端支线建议依赖：

```text
前端阶段FE0 从阶段2后开始
前端阶段FE1 从阶段3后开始
前端阶段FE2 从阶段4后开始
前端阶段FE3 从阶段5后开始
```

放行原则：

- 当前阶段未通过验证，不进入下一阶段。
- 当前阶段没有明确回退手段，不进入下一阶段。

## 4. 任务清单字段说明

为了让 AI 或工程师都能直接执行，下面每个任务都按同一格式描述：

- `任务ID`：唯一编号
- `目标`：这一项要完成什么
- `前置依赖`：依赖哪些任务完成
- `修改范围`：会动哪些模块
- `执行动作`：应做的具体动作
- `产出物`：交付文件、代码、脚本、配置、文档
- `完成判定`：达到什么标准才算完成

## 5. 分阶段任务清单

---

## 阶段0：固化当前基线

### 阶段目标

把当前 `sales-opportunity-advisor` 的真实运行链路、输入输出、依赖关系和样例结果固化下来，作为后续并行迁移的对照基线。

### 修改范围

- 允许新增文档、测试样例、比对脚本
- 尽量不改现有运行逻辑

### 产出物

- 基线样例
- 黄金输出
- 依赖清单
- 影子对比脚本设计
- 回退开关设计

### 主要风险

- 只固化了“能跑通”的 happy path，没有覆盖错误路径
- 迁移完成后无法证明“新旧结果一致”

### 详细任务

- [x] `P0-T1` 盘点当前真实运行链路
  - 目标：把现有 API、Gateway、agent、skill、tool、reference 的真实调用顺序和依赖固化成文档
  - 前置依赖：无
  - 修改范围：只读 [server.js](/Users/gato-pm/Desktop/API_副本/server.js)、[routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js)、[services/runtime.js](/Users/gato-pm/Desktop/API_副本/services/runtime.js)、[services/runtime-message.js](/Users/gato-pm/Desktop/API_副本/services/runtime-message.js)、[services/scene-config.js](/Users/gato-pm/Desktop/API_副本/services/scene-config.js)、[ContextHelper](/Users/gato-pm/Desktop/API_副本/ContextHelper)、[ModelTool](/Users/gato-pm/Desktop/API_副本/ModelTool)
  - 执行动作：
    1. 确认对外入口、场景配置加载方式、Gateway 调用方式
    2. 确认当前 helper/directdb/model tool 的边界
    3. 确认 skill 中引用的字典、规则、schema 资产
  - 产出物：一份“当前工作流基线文档”
  - 完成判定：基线文档可以回答“当前每一步是谁做的、输入输出是什么、是否调 LLM、是否调外部服务”
  - 完成说明（2026-04-12）：已新增 [销售机会推进建议当前工作流基线文档.md](/Users/gato-pm/Desktop/API_副本/销售机会推进建议当前工作流基线文档.md)，固化了 helper 场景的 API -> Gateway -> agent -> skill -> ContextHelper -> ModelTool -> API 回包全链路，并补入了 2026-04-12 会话样本证据；已通过 scene 配置、runtime 常量和关键资产路径静态校验。

- [x] `P0-T2` 补齐基线请求与黄金输出样例
  - 目标：沉淀可重复回放的请求和结果样例
  - 前置依赖：`P0-T1`
  - 修改范围：`examples/`、`tests/fixtures/`
  - 执行动作：
    1. 基于现有 [examples](/Users/gato-pm/Desktop/API_副本/examples) 复制并补齐正常、参数错误、查无数据、结构校验失败样例
    2. 为当前 `sales-opportunity-advisor` 固化黄金输出
    3. 样例中记录请求时间、scene、requestId 生成规则说明
  - 产出物：`tests/fixtures/baseline/*.request.json`、`tests/fixtures/baseline/*.response.json`
  - 完成判定：样例可用于重复调用 API，并能和黄金输出做差异比对
  - 完成说明（2026-04-12）：已新增 [tests/fixtures/baseline/README.md](/Users/gato-pm/Desktop/API_副本/tests/fixtures/baseline/README.md) 与 [tests/fixtures/baseline/manifest.json](/Users/gato-pm/Desktop/API_副本/tests/fixtures/baseline/manifest.json)，固化了 API 成功、参数错误、查无数据三类真实回放结果，以及一条 ModelTool 结构校验失败样例；已记录 `requestId` 动态规则与每个 case 的 `observedAt`、`route`、`dynamicFields`。

- [x] `P0-T3` 增加最小回归和对比脚本
  - 目标：让后续每一阶段都能自动做“现状对比”
  - 前置依赖：`P0-T2`
  - 修改范围：`scripts/`、`tests/regression/`
  - 执行动作：
    1. 新增基线回放脚本
    2. 新增结果对比脚本，至少支持：HTTP 成功率、响应 envelope、一致性字段比对
    3. 预留影子运行对比报告格式
  - 产出物：`scripts/run_baseline_regression.*`、`scripts/compare_results.*`
  - 完成判定：能够一键回放当前业务样例，并输出一致/不一致报告
  - 完成说明（2026-04-12）：已新增 [scripts/run_baseline_regression.js](/Users/gato-pm/Desktop/API_副本/scripts/run_baseline_regression.js) 与 [scripts/compare_results.js](/Users/gato-pm/Desktop/API_副本/scripts/compare_results.js)，并补充 [tests/regression/README.md](/Users/gato-pm/Desktop/API_副本/tests/regression/README.md) 说明 baseline summary / per-case report / shadow 预留格式；已实跑全部 baseline case，输出目录为 `tests/regression/output/2026-04-12T05-50-36-452Z`，4/4 case 通过，`strictBodyMatchRate = 0.75`。

- [x] `P0-T4` 明确运行模式与回退开关
  - 目标：在进入并行迁移前，先定义好 `legacy / shadow / langgraph` 模式和切换方式
  - 前置依赖：`P0-T1`
  - 修改范围：文档、配置设计
  - 执行动作：
    1. 定义场景级运行模式字段
    2. 定义默认模式为 `legacy`
    3. 定义回退优先级和切换顺序
  - 产出物：运行模式说明文档
  - 完成判定：后续所有阶段都可以引用同一套运行模式定义
  - 完成说明（2026-04-12）：已新增 [平台运行模式与回退开关设计.md](/Users/gato-pm/Desktop/API_副本/平台运行模式与回退开关设计.md)，冻结了 `legacy / shadow / langgraph` 三种运行模式、默认值、切换顺序、自动 fallback 允许范围和不允许回退的安全边界；并在 [scene-configs/README.md](/Users/gato-pm/Desktop/API_副本/scene-configs/README.md) 补充了设计态 `routing` 字段说明。当前未修改真实 scene JSON，旧链路行为保持不变。

### 验证方式

1. 启动现有服务：
   ```bash
   npm run start:helper
   npm run start:model-tool
   npm run start:api
   ```
2. 检查健康接口：
   ```bash
   curl -sS http://127.0.0.1:3000/health
   curl -sS http://127.0.0.1:19001/health
   curl -sS http://127.0.0.1:19003/health
   ```
3. 用基线请求回放当前 API，确认输出与黄金样例一致

### 回退方式

- 阶段0只新增文档、样例、脚本
- 若产出有问题，直接回退新增文件，不影响现有业务链路

---

## 阶段1：引入兼容路由层，先并上旁路

### 阶段目标

在不改变外部 API 的前提下，引入内部 `Agent Gateway` 路由层，让每个 scene 能按配置选择 `legacy / shadow / langgraph` 路径。

### 修改范围

- 小改现有 API 入口和 runtime 路由逻辑
- 新增内部平台网关模块

### 产出物

- 统一路由器
- 场景级运行模式开关
- 基础 trace 包装

### 主要风险

- 路由错误把正式请求误打到新链路
- 新增逻辑影响现有成功率或延迟

### 详细任务

- [x] `P1-T1` 新增内部 Agent Gateway 路由器
  - 目标：把“外部 API 请求”转成“内部执行模式选择”
  - 前置依赖：`P0-T4`
  - 修改范围：[routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js)、`platform/gateway/`
  - 执行动作：
    1. 新增 `platform/gateway/index.*`
    2. 把 scene 路由决策从 `routes/agent.js` 中抽成独立模块
    3. 支持 `legacy`、`shadow`、`langgraph` 三种执行模式
  - 产出物：网关路由器代码
  - 完成判定：默认所有 scene 仍然走 `legacy`，结果与当前一致
  - 完成说明（2026-04-12）：已新增 [platform/gateway/index.js](/Users/gato-pm/Desktop/API_副本/platform/gateway/index.js)，将 scene 的运行模式解析和执行入口收口到内部 Agent Gateway；[routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js) 已改为通过 Gateway 调度 `legacy` 执行器。当前 `shadow / langgraph` 已能被识别，但在运行时仍兼容回落到 `legacy`；`direct-model` scene 在 V1 仍限制为 `legacy`。已使用临时端口 `3001` 实跑 baseline 回归，4/4 case 通过。

- [x] `P1-T2` 为 scene 增加可选运行模式配置
  - 目标：让每个 scene 能在不改 API 的情况下切换运行模式
  - 前置依赖：`P1-T1`
  - 修改范围：[scene-configs](/Users/gato-pm/Desktop/API_副本/scene-configs) 或新增 `platform/skills/routing/`
  - 执行动作：
    1. 增加可选字段 `routing.mode`
    2. 默认值为 `legacy`
    3. 允许只对 `sales-opportunity-advisor` 单独开 `shadow`
  - 产出物：增强后的场景配置
  - 完成判定：不配置时行为不变，配置后可切换模式
  - 完成说明（2026-04-12）：已为 [sales-opportunity-advisor.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor.json)、[sales-opportunity-advisor-directdb.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor-directdb.json)、[payment-info-split.json](/Users/gato-pm/Desktop/API_副本/scene-configs/payment-info-split.json) 增加 `routing.mode` 与 `routing.allowedModes`；其中仅 `sales-opportunity-advisor` 允许配置为 `shadow / langgraph`，其余 scene 当前只允许 `legacy`。网关已按 `allowedModes` 校验，且在临时端口 `3001` 上实跑 baseline 回归，4/4 case 通过。

- [x] `P1-T3` 新增统一 trace 上下文包装
  - 目标：为后续影子运行和节点追踪准备公共上下文
  - 前置依赖：`P1-T1`
  - 修改范围：`platform/trace/`、[utils/request-id.js](/Users/gato-pm/Desktop/API_副本/utils/request-id.js)
  - 执行动作：
    1. 标准化 `request_id`、`trace_id`、`scene`、`run_mode`
    2. 让 `legacy` 和 `shadow` 都能写出统一 trace 结构
  - 产出物：统一 trace 上下文对象
  - 完成判定：每次请求都能区分自己走的是哪条路径
  - 完成说明（2026-04-12）：已新增 [platform/trace/context.js](/Users/gato-pm/Desktop/API_副本/platform/trace/context.js) 和 [utils/request-id.js](/Users/gato-pm/Desktop/API_副本/utils/request-id.js) 中的 `buildTraceId`，并将统一 trace 上下文接入 [platform/gateway/index.js](/Users/gato-pm/Desktop/API_副本/platform/gateway/index.js) 与 [routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js)。当前 `legacy` 路径的路由选择、启动、成功、参数失败日志均已携带 `traceId / requestId / scene / requestedMode / effectiveMode / executionMode`；在临时端口 `3001` 上实跑 baseline 回归，输出目录 `tests/regression/output/2026-04-12T06-33-48-465Z`，4/4 case 通过。

### 验证方式

1. `routing.mode` 为空时，API 行为不变
2. `routing.mode = legacy` 时，输出与阶段0基线一致
3. `routing.mode = shadow` 时，正式响应仍返回 legacy 结果
4. trace 中能看到 `legacy` 和 `shadow` 的区分

### 回退方式

- 将相关 scene 的 `routing.mode` 切回 `legacy`
- 如有必要，回退 `routes/agent.js` 中接入 `platform/gateway` 的改动

---

## 阶段2：落地 V1 配置协议和模板注册

### 阶段目标

把“当前业务编排定义”从代码和自由 skill 描述中抽离，沉淀为模板、业务 skill、tool、query profile 四类受控配置，但先不承担正式执行。

### 修改范围

- 新增配置协议、注册表和编译前校验
- 不替换现有 scene 执行逻辑

### 产出物

- Workflow Template 配置
- Business Skill 配置
- Tool 注册配置
- Query Profile 配置
- 配置校验器

### 主要风险

- 抽象过度，配置脱离当前真实链路
- 配置过宽，给后续留下安全漏洞

### 详细任务

- [x] `P2-T1` 定义 workflow template 配置协议
  - 目标：定义模板、标准节点、边、约束、可覆盖范围
  - 前置依赖：`P1-T1`
  - 修改范围：`platform/templates/`
  - 执行动作：
    1. 定义模板资源格式
    2. 固定标准节点清单
    3. 明确哪些节点可跳过、可重排、可替换
  - 产出物：`platform/templates/*.yaml`
  - 完成判定：当前业务可以映射到该模板，不需要复制整条业务代码
  - 完成说明（2026-04-12）：已新增 [platform/templates/README.md](/Users/gato-pm/Desktop/API_副本/platform/templates/README.md) 与 [platform/templates/grounded-structured-advisory.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/templates/grounded-structured-advisory.v1.yaml)，固定了 `WorkflowTemplate` 的顶层资源格式、状态切片、phase、标准节点、默认边、条件边和保护约束；模板中已明确 `sales-opportunity-advisor` 与 `sales-opportunity-advisor-directdb` 的映射方式。已使用系统 YAML 解析器静态验证，结果为 `node_count=14`、`edge_count=14`、`conditional_edge_count=5`。

- [x] `P2-T2` 定义 business skill 配置协议
  - 目标：让具体业务通过配置引用模板和资产
  - 前置依赖：`P2-T1`
  - 修改范围：`platform/skills/`
  - 执行动作：
    1. 定义 `templateRef`、`promptRef`、`schemaRef`、`toolBindings`、`queryProfileRef`
    2. 定义节点覆盖、启停、重排的配置结构
    3. 限定 V1 只允许受控配置，不允许任意脚本
  - 产出物：`platform/skills/*.yaml`
  - 完成判定：`sales-opportunity-advisor` 可被完整表达为一份业务 skill 配置
  - 完成说明（2026-04-12）：已新增 [platform/skills/README.md](/Users/gato-pm/Desktop/API_副本/platform/skills/README.md) 与 [platform/skills/sales-opportunity-advisor.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor.v1.yaml)，固定了 `BusinessSkill` 的 V1 资源格式、`templateRef / promptRef / schemaRef / toolBindings / queryProfileRef` 的表达方式，以及节点启停、受控覆盖、同 phase 重排和 `security.mode=controlled` 的安全边界。当前 `sales-opportunity-advisor` 已可通过一份业务 skill 配置完整映射到模板。已用系统 YAML 解析器做静态校验，校验结果为 `template=grounded-structured-advisory@v1`、`scene=sales-opportunity-advisor`、`node_override_count=7`、`tool_binding_roles=3`。

- [x] `P2-T3` 定义 tool 注册和 query profile 配置
  - 目标：把“可调用能力”和“可配置查询业务”分开注册
  - 前置依赖：`P2-T2`
  - 修改范围：`platform/tools/`
  - 执行动作：
    1. 定义 `ToolDefinition`
    2. 定义 `QueryProfile`
    3. 约束 allowed fields、required inputs、tool role、超时和重试上限
  - 产出物：`platform/tools/*.yaml`
  - 完成判定：查询业务能以受控 profile 表达，而不是自由 SQL
  - 完成说明（2026-04-12）：已新增 [platform/tools/README.md](/Users/gato-pm/Desktop/API_副本/platform/tools/README.md)、[sales-opportunity-context-helper.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-context-helper.tool.yaml)、[openclaw-sales-agent-default.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/openclaw-sales-agent-default.tool.yaml)、[model-tool-structured-output.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/model-tool-structured-output.tool.yaml)、[sales-opportunity-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-by-opportunity-id.query.yaml)，固定了 `ToolDefinition` 与 `QueryProfile` 的 V1 资源格式，并为当前 `sales-opportunity-advisor` 注册了 3 个受控 tool 与 1 个查询 profile。查询 profile 仅表达查询意图、输入契约、字段白名单来源和生成约束，不携带自由 SQL。已静态校验 `BusinessSkill` 与注册表交叉引用，结果为 `tool_count=3`、`query_count=1`、`query_ref=query://sales-opportunity/by-opportunity-id@v1`。

- [x] `P2-T4` 实现配置校验器
  - 目标：在运行前阻止非法配置进入系统
  - 前置依赖：`P2-T1`、`P2-T2`、`P2-T3`
  - 修改范围：`platform/compiler/validate.*`
  - 执行动作：
    1. 校验模板引用是否存在
    2. 校验节点覆盖是否合法
    3. 校验 tool role 与 capability 是否匹配
    4. 拒绝 secrets、raw SQL、绝对脚本路径、未注册 endpoint
  - 产出物：配置校验器
  - 完成判定：非法配置无法通过编译前校验
  - 完成说明（2026-04-12）：已新增 [platform/compiler/validate.js](/Users/gato-pm/Desktop/API_副本/platform/compiler/validate.js) 与 [scripts/validate_platform_configs.js](/Users/gato-pm/Desktop/API_副本/scripts/validate_platform_configs.js)，实现对 `WorkflowTemplate`、`BusinessSkill`、`ToolDefinition`、`QueryProfile` 的编译前静态校验；校验内容包括模板引用存在性、节点覆盖白名单、节点重排 phase 合法性、tool role 与注册 capability 匹配、HTTP tool loopback 限制，以及对 secrets、raw SQL、绝对脚本路径、未注册 endpoint 的拒绝。已新增反例样例 [invalid-business-skill-inline-endpoint.yaml](/Users/gato-pm/Desktop/API_副本/tests/fixtures/platform-config/invalid-business-skill-inline-endpoint.yaml) 与 [invalid-query-profile-raw-sql.yaml](/Users/gato-pm/Desktop/API_副本/tests/fixtures/platform-config/invalid-query-profile-raw-sql.yaml)。验证结果为：当前平台配置 `valid=true`，非法 skill 反例被 `UNREGISTERED_ENDPOINT_NOT_ALLOWED` 与 `ABSOLUTE_SCRIPT_PATH_NOT_ALLOWED` 拒绝，非法 query 反例被 `RAW_SQL_NOT_ALLOWED` 拒绝。

### 验证方式

1. 对当前业务配置执行 lint
2. 校验当前业务模板能成功通过校验器
3. 构造非法配置样例，确认会被拒绝

### 回退方式

- 阶段2只新增 `platform/` 配置与校验逻辑
- 若协议设计不合理，可回退新增配置，不影响现有业务路径

---

## 阶段3：先跑一个兼容子图，验证新运行时骨架

### 阶段目标

让 LangGraph 运行时先跑起来，但先不重写当前业务节点，而是用“兼容节点”包裹现有旧执行器，验证状态传递、trace、失败处理和影子运行机制。

### 修改范围

- 新增运行时骨架和兼容节点
- 不接管正式响应

### 产出物

- LangGraph Runtime 骨架
- 状态模型
- 兼容执行节点
- 影子运行接线

### 主要风险

- 影子路径污染旧 session
- 兼容节点和旧执行器之间状态定义不统一

### 详细任务

- [x] `P3-T1` 落地 State 和运行时上下文模型
  - 目标：明确新平台执行期要保存和传递的状态
  - 前置依赖：`P2-T4`
  - 修改范围：`platform/runtime/`
  - 执行动作：
    1. 定义 `request`、`runtime_context`、`scene_contract`、`artifacts`、`result`、`error`
    2. 把 `request_id`、`tenant_id`、`user_id`、`permissions`、`trace_id` 放入统一 context
  - 产出物：状态定义文件
  - 完成判定：兼容节点可以读写统一 state
  - 完成说明（2026-04-12）：已新增 [platform/runtime/state.js](/Users/gato-pm/Desktop/API_副本/platform/runtime/state.js) 与 [platform/runtime/README.md](/Users/gato-pm/Desktop/API_副本/platform/runtime/README.md)，固定了阶段 3 运行时的 6 个顶层 slice：`request`、`runtime_context`、`scene_contract`、`artifacts`、`result`、`error`。其中 `runtime_context` 已统一承载 `request_id`、`trace_id`、`tenant_id`、`user_id`、`permissions`、路由快照与 trace context；同时提供 `createInitialWorkflowState`、`mergeWorkflowState`、`recordNodeRun` 三个基础入口，供后续兼容节点直接读写统一 state。已通过 Node 静态验证初始化、节点运行记录写入、result patch 写回，以及未知 slice 拒绝保护。

- [x] `P3-T2` 新增 legacy-scene-runner 兼容节点
  - 目标：让新运行时先通过旧执行器完成业务
  - 前置依赖：`P3-T1`
  - 修改范围：`platform/nodes/legacy-scene-runner.*`、[services/runtime.js](/Users/gato-pm/Desktop/API_副本/services/runtime.js)
  - 执行动作：
    1. 把旧 runtime 调用包装成节点
    2. 将节点输出适配为新 state 的 `result`
    3. 保留错误映射和 trace 信息
  - 产出物：兼容节点
  - 完成判定：LangGraph 可以通过单节点复用旧逻辑跑通当前业务
  - 完成说明（2026-04-12）：已新增 [platform/nodes/legacy-scene-runner.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/legacy-scene-runner.js)，并在 [services/runtime.js](/Users/gato-pm/Desktop/API_副本/services/runtime.js) 中抽出 `runLegacySceneExecution`、`runLegacyAgentRuntimeScene`、`runLegacyDirectModelScene` 作为旧执行链的共享入口；[routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js) 已复用该入口，避免节点侧复制旧 runtime/build/parse 逻辑。兼容节点当前会把旧执行器结果映射到统一 state 的 `result / error / artifacts.compat / artifacts.node_runs`。已通过 mock 注入验证成功路径与业务错误路径的 state 适配，并验证原有 route 参数校验仍返回 `400 INVALID_REQUEST`。另已尝试对 `sales-opportunity-advisor` baseline 请求做 live smoke，兼容节点已成功打到旧 Gateway 链路，但当前本机 legacy 执行环境存在额外阻塞：`sales_opportunity_advisor` skill 路径读取失败和 Moonshot `429 token quota exceeded`，导致旧执行器返回非 wrapped 结果并触发 `INVALID_RUNTIME_RESULT`；该问题已在 `~/.openclaw/logs/gateway.err.log` 中确认，属于既有旧链路环境问题，不是兼容节点接线错误。

- [x] `P3-T3` 接入 shadow 执行但不影响正式返回
  - 目标：让同一请求可同时跑 `legacy` 和 `shadow`
  - 前置依赖：`P3-T2`
  - 修改范围：`platform/gateway/`、`platform/runtime/`
  - 执行动作：
    1. 在 `shadow` 模式下并行执行 `legacy` 和 `langgraph-compat`
    2. 正式响应仍返回 `legacy`
    3. 记录影子结果和差异
  - 产出物：影子运行机制
  - 完成判定：线上可旁路观察新运行时，而不会影响主结果
  - 完成说明（2026-04-12）：已新增 [platform/runtime/shadow.js](/Users/gato-pm/Desktop/API_副本/platform/runtime/shadow.js)，实现 `legacy + langgraph-compat` 并行执行、compat workflow state 到 HTTP envelope 的适配，以及 shadow diff 计算；[platform/gateway/index.js](/Users/gato-pm/Desktop/API_副本/platform/gateway/index.js) 已补充 `routePlan.shadowExecutionEnabled`，并在 [platform/trace/context.js](/Users/gato-pm/Desktop/API_副本/platform/trace/context.js) 与 [platform/runtime/state.js](/Users/gato-pm/Desktop/API_副本/platform/runtime/state.js) 中透传该标记；[routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js) 现已在 `routing.mode=shadow` 时并行执行主 `legacy` 路径和 `langgraph-compat` 兼容子图，正式 HTTP 响应仍严格返回 `legacy` 结果，同时通过 `agent.shadow.completed` 记录影子执行结果、session 分离情况、兼容节点状态和 diff 摘要。已用 route 级 monkey patch 集成验证两种情况：`shadow` 成功时 `sessionSeparated=true`、`shadowDiffPassed=true`、主返回仍为 `legacy`；`shadow` 兼容子图报 `RUNTIME_INVALID_RESPONSE` 时主返回仍为 `legacy 200`，trace 中可见 compat 节点 `status=error`。

### 验证方式

1. `shadow` 模式下单次请求能同时产生两份执行记录
2. 正式响应仍等于 `legacy`
3. 新旧路径 session 不串
4. trace 中可看到兼容子图执行结果

### 回退方式

- 将 scene 切回 `legacy`
- 禁用 `shadow` 执行分支

---

## 阶段4：把当前业务拆成真实模板节点，但继续影子运行

### 阶段目标

把当前 `sales-opportunity-advisor` 从“兼容节点”逐步拆成真正的标准节点，形成可复用模板，但在正式响应上仍然只做影子运行。

### 修改范围

- 实现标准节点
- 复用现有 ContextHelper 和 ModelTool 作为 tool adapter

### 产出物

- 当前业务对应的真实模板化工作流
- 节点级输入输出契约
- 节点级 trace

### 主要风险

- 新节点组合出来的结果与旧 skill 不一致
- 事实提取和字段 grounding 发生漂移

### 详细任务

- [x] `P4-T1` 实现输入校验与权限节点
  - 目标：把 API 中与 workflow 强相关的校验和授权逻辑收口为节点
  - 前置依赖：`P3-T3`
  - 修改范围：`platform/nodes/validate-input.*`、`platform/nodes/authorize-scope.*`
  - 执行动作：
    1. 实现请求格式校验节点
    2. 实现权限和字段范围校验节点
  - 产出物：输入校验节点、授权节点
  - 完成判定：校验失败和权限失败能够在图内被标准化处理
  - 完成说明（2026-04-12）：已新增 [services/request-validation.js](/Users/gato-pm/Desktop/API_副本/services/request-validation.js)、[platform/nodes/validate-input.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/validate-input.js) 与 [platform/nodes/authorize-scope.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/authorize-scope.js)，把原先散落在 API 路由中的 `bizParams` 归一化校验抽成共享校验器，并沉淀为 `validate-input` 与 `authorize-scope` 两个标准节点；同时更新了 [routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js) 复用同一套请求校验逻辑，并在 [utils/errors.js](/Users/gato-pm/Desktop/API_副本/utils/errors.js) 中补充 `ACCESS_DENIED` 标准错误定义。节点现在会把成功结果写入 `request.normalized` 与 `artifacts.outputs.*`，把校验失败和权限拒绝统一写入 `error` 与 `artifacts.node_runs`。已通过 Node 验证覆盖四条路径：校验成功、校验失败、权限通过、权限拒绝，并额外验证旧路由在非法 `opportunityId` 下仍返回 `400 INVALID_REQUEST`。

- [x] `P4-T2` 实现引用资产加载节点
  - 目标：把 prompt、schema、dictionary、rules 的读取显式节点化
  - 前置依赖：`P4-T1`
  - 修改范围：`platform/nodes/load-assets.*`
  - 执行动作：
    1. 支持读取配置中定义的 `promptRef`
    2. 支持读取 `schemaRef`、`dictionaryRef`、`rulesRef`
  - 产出物：资产加载节点
  - 完成判定：业务资产不再依赖 skill 中自由读取
  - 完成说明（2026-04-12）：已新增 [platform/nodes/load-assets.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/load-assets.js)，实现 `load-assets` 节点：支持从 `workflow_binding.skillSpec.assetRefs` 与 `nodeOverrides.load_reference_bundle.assetRefs` 中解析 `promptRef`、`schemaRef`、`dictionaryRef`、`rulesRef`，按受控 `source.path` 读取资产，并将结果写入 `artifacts.references`、`artifacts.reference_meta` 与 `artifacts.outputs.load_assets`。同时在 [utils/errors.js](/Users/gato-pm/Desktop/API_副本/utils/errors.js) 中补充 `ASSET_LOAD_FAILED` 标准错误类型，用于文件读取或 JSON 解析失败的标准化处理。节点还提供了 legacy fallback：当 workflow binding 尚未接入时，可从当前 [scene-configs/sales-opportunity-advisor.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor.json) 的 `skill.entryFile` 与 `references` 自动推导出 prompt / dictionary / rules / schema 资产。已通过 Node 验证三条路径：按当前业务 skill 配置结构加载四类资产成功、按 legacy scene config fallback 加载成功，以及非法 ref 选择时标准化返回 `INVALID_REQUEST / load-assets`。

- [x] `P4-T3` 实现上下文获取和事实标准化节点
  - 目标：把“取数”和“原始事实整理”拆成独立节点
  - 前置依赖：`P4-T2`
  - 修改范围：`platform/nodes/fetch-context.*`、`platform/nodes/normalize-facts.*`
  - 执行动作：
    1. 通过 tool registry 调用 ContextHelper
    2. 把 `rawRow` 标准化为 `facts`
    3. 明确 basis fields 选择规则
  - 产出物：取数节点、事实标准化节点
  - 完成判定：上下文获取与事实整理不再揉在一个大节点里
  - 完成说明（2026-04-12）：已新增 [platform/nodes/fetch-context.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/fetch-context.js) 与 [platform/nodes/normalize-facts.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/normalize-facts.js)。其中 `fetch-context` 节点会通过 [platform/compiler/validate.js](/Users/gato-pm/Desktop/API_副本/platform/compiler/validate.js) 读取当前 `platform/tools/*.yaml` 与 `platform/skills/*.yaml`，按 scene 解析 `BusinessSkill -> QueryProfile -> ToolDefinition` 链路，使用受控 `toolRef/queryProfileRef` 构造 ContextHelper 请求并把 `rawRow` 收口到 `artifacts.context.raw`；当 helper 返回业务错误时，会把原 error 标准化写入 graph state。`normalize-facts` 节点则负责解析已加载的 TSV 字典资产，按字典规则完成字段忽略、枚举中文映射、金额/百分比格式化、factText 生成，并输出 `artifacts.facts.items / profile / basis_fields`。当前 basis fields 规则已固定为：优先选择阶段、状态、业务类型、金额、预算、投标日期、赢率、招标/竞争/客户痛点等真正影响建议方向的字段，最多保留 `8` 个；同时遵守 `authorize_scope.allowed_fields` 的字段范围约束。已通过组合 Node 验证：`validate-input -> authorize-scope -> load-assets -> fetch-context -> normalize-facts` 成功链路可产出稳定 `facts` 和 `basis_fields`，并验证 `fetch-context` 在 helper 返回 `OPPORTUNITY_NOT_FOUND` 时会标准化为图内 `business_error`。

- [x] `P4-T4` 实现 LLM 生成、结构校验和修复节点
  - 目标：把“建议生成”和“schema 校验”拆成清晰节点
  - 前置依赖：`P4-T3`
  - 修改范围：`platform/nodes/draft-output.*`、`platform/nodes/validate-output.*`、`platform/nodes/repair-output.*`
  - 执行动作：
    1. 新增独立 LLM 生成节点
    2. 通过 tool registry 调用 ModelTool 做结构校验
    3. 加入有限次修复循环
  - 产出物：生成节点、校验节点、修复节点
  - 完成判定：LLM 调用与结构校验的职责边界清晰
  - 完成说明（2026-04-12）：已新增 [platform/nodes/tool-runtime.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/tool-runtime.js)、[platform/nodes/draft-output.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/draft-output.js)、[platform/nodes/validate-output.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/validate-output.js)、[platform/nodes/repair-output.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/repair-output.js)。其中 `draft-output` 节点已从平台注册表解析 `advisory_llm` 绑定，按 `prompt / facts / rules / basis_fields` 形成独立生成节点边界，并在当前并行迁移阶段提供 `compat` 草拟器作为默认执行器，保证不直接耦合旧 skill；`validate-output` 节点已通过 `output_validator` 受控 tool 配置构造 ModelTool 请求，并将校验成功 / 结构失败分别写入 `artifacts.validation` 与 graph `error`；`repair-output` 节点已实现有限次修复循环控制，会依据上一次 schema 错误和当前事实重写候选 payload，并通过 `draft.repair_attempts` 跟踪修复次数与命中字段，超过 `retry.maxAttempts` 后停止继续修复。已通过组合 Node 验证三条路径：1）`draft-output -> validate-output` 成功链路可直接产出合法 payload；2）`draft-output(非法 payload) -> validate-output(结构失败) -> repair-output -> validate-output` 可完成一次修复后重新校验成功；3）修复次数达到上限时，`repair-output` 会标准化返回 `limit_reached=true`，不再继续循环。

- [x] `P4-T5` 组装当前业务的模板化图
  - 目标：把上述节点接成 `sales-opportunity-advisor` 的真实 workflow
  - 前置依赖：`P4-T4`
  - 修改范围：`platform/runtime/graphs/`、`platform/compiler/`
  - 执行动作：
    1. 用模板和业务 skill 配置编译出图
    2. 接入条件边和失败路径
    3. 保留最终 `finalize_result` 输出适配
  - 产出物：编译后的 workflow graph
  - 完成判定：新图可完整跑通当前业务影子链路
  - 完成说明（2026-04-12）：已新增 [platform/compiler/compile-workflow.js](/Users/gato-pm/Desktop/API_副本/platform/compiler/compile-workflow.js) 与 [platform/runtime/graphs/index.js](/Users/gato-pm/Desktop/API_副本/platform/runtime/graphs/index.js)，把 `WorkflowTemplate + BusinessSkill + Tool/Query 注册表` 编译为当前业务可执行图：包含模板节点排序、业务 `nodeOverrides / nodeOrderOverrides` 合并、`maxRepairLoops`、默认边以及 `workflowBinding` 注入；图运行时已接入 `bootstrap_runtime / load_workflow_contract / resolve_data_plan / select_basis_fields / finalize_result / observe_run` 等系统节点，并把既有 `validate-input / authorize-scope / fetch-context / load-assets / normalize-facts / draft-output / validate-output / repair-output` 标准节点接成完整业务 workflow。与此同时，[platform/runtime/shadow.js](/Users/gato-pm/Desktop/API_副本/platform/runtime/shadow.js) 已把 shadow 默认执行器从旧 `legacy_scene_runner` 切到新的 `runCompiledSceneWorkflow`，正式 HTTP 返回仍保持 `legacy`，shadow 侧则开始执行模板化图并输出节点级 trace / diff。已通过 5 组 Node 验证：1）图编译成功并产出 14 个模板节点顺序；2）成功链路可完整执行 13 个节点并产出合法 payload；3）非法草稿会走 `validate_output -> repair_output -> validate_output` 修复链路并成功收敛；4）`OPPORTUNITY_NOT_FOUND` 会走失败路径并经 `finalize_result + observe_run` 标准化落盘；5）`runLegacyAndShadowCompat` 下新旧结果 diff 通过，shadow 正常返回 `langgraph-stategraph` 执行摘要。

### 验证方式

1. 当前业务可以用新图跑通完整影子执行
2. 节点 trace 中能看到每一节点的输入摘要、输出摘要、耗时、错误
3. 新旧结果差异报告可定位到节点级别
4. 重点检查 `basisFields`、枚举映射、预算字段等 grounding 风险点

### 回退方式

- 保持正式返回仍来自 `legacy`
- 新图执行有问题时只关闭 `shadow` 的 `langgraph` 分支

---

## 阶段5：小流量切换当前业务，保留自动回退

### 阶段目标

让 `sales-opportunity-advisor` 逐步由新平台接正式流量，但采用白名单和灰度切换，保留错误自动回退。

### 修改范围

- 路由策略
- 降级和 fallback 逻辑
- 监控与告警

### 产出物

- 灰度切流规则
- 自动回退规则
- 运行监控面板

### 主要风险

- 长尾输入在真实流量下暴露问题
- 新路径延迟高于旧路径

### 详细任务

- [x] `P5-T1` 支持按 scene 和白名单切流
  - 目标：先只让极少量请求进入 `langgraph`
  - 前置依赖：`P4-T5`
  - 修改范围：`platform/gateway/`
  - 执行动作：
    1. 支持按 scene、tenant、user、请求比例做切流
    2. 默认比例为 0
  - 产出物：灰度切流策略
  - 完成判定：可仅对指定白名单开启新路径正式返回
  - 完成说明（2026-04-12）：已在 [platform/gateway/index.js](/Users/gato-pm/Desktop/API_副本/platform/gateway/index.js) 落地第一版灰度切流策略：支持 `routing.mode=langgraph` 下基于 `routing.langgraphCutover`（兼容别名 `routing.cutover`）按 `tenantAllowlist / userAllowlist / requestPercentage` 做正式返回切流，且默认 `requestPercentage = 0`，未命中白名单或比例时自动保持 `effectiveMode=legacy`；同时保留 `shadow` 模式现状不变。为让白名单切流真正能走正式新路径，[routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js) 已增加最小接线：支持从可选 `runtimeContext.tenantId / runtimeContext.userId` 读取路由身份，并新增 `runLangGraphAgentRuntimeRoute` 作为正式 `langgraph` handler；`runSceneThroughGateway` 现会在命中灰度策略时选择 `runLangGraphAgentRuntime`，否则继续走 `runLegacyAgentRuntime`。已通过 Node 验证 6 组场景：1）无 cutover 配置时 `requestedMode=langgraph` 仍回落 `legacy`；2）`userAllowlist` 命中时切到 `langgraph`；3）`tenantAllowlist` 命中时切到 `langgraph`；4）`requestPercentage=100` 时切到 `langgraph`；5）gateway 在命中和未命中时分别选择正确 handler；6）`runLangGraphAgentRuntimeRoute` 在 stub graph runner 下可产出正式 `200 success` HTTP envelope。

- [x] `P5-T2` 增加自动 fallback
  - 目标：新路径失败时自动降级回旧路径
  - 前置依赖：`P5-T1`
  - 修改范围：`platform/gateway/`、`platform/runtime/`
  - 执行动作：
    1. 定义 fallback 触发条件
    2. 对超时、编译失败、节点异常设置自动回退
    3. 回退行为写入 trace 和 audit
  - 产出物：自动回退机制
  - 完成判定：新路径异常不会把错误直接暴露给调用方
  - 完成说明（2026-04-12）：已新增 [platform/runtime/fallback.js](/Users/gato-pm/Desktop/API_副本/platform/runtime/fallback.js)，沉淀第一版 `langgraph -> legacy` 自动回退判定与审计摘要能力：对于 `graph-compile / graph-runtime` 阶段异常、以及图内产生的 5xx 平台错误（如超时、模型调用失败、资产加载失败、运行时无效响应等），统一判定为可自动回退；而业务性错误如 `OPPORTUNITY_NOT_FOUND`、权限拒绝、请求参数错误则保持原样返回，不触发回退。与此同时，[platform/gateway/index.js](/Users/gato-pm/Desktop/API_副本/platform/gateway/index.js) 已补充 `buildFallbackRoutePlan`，用于生成标准化的 fallback 路由快照；[routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js) 中的 `runLangGraphAgentRuntimeRoute` 已接入自动回退：当 `runCompiledSceneWorkflow` 抛出可回退异常，或返回带可回退错误的失败 state 时，会自动调用 `legacy` 场景执行，并通过 `agent.langgraph.fallback.triggered / completed / failed` 写入结构化 trace / audit 日志，记录触发来源、错误码、阶段、最后节点、legacy 回退结果等。已通过 Node 验证多组关键场景：1）`graph-compile` 400 配置异常会触发自动回退；2）`RUNTIME_TIMEOUT` 抛异常时会自动切回 `legacy` 并返回 `200`；3）图内 `MODEL_INVOCATION_FAILED` 502 失败 state 会自动切回 `legacy` 并返回 `200`；4）业务性 `OPPORTUNITY_NOT_FOUND` 404 不会触发回退，仍由 `langgraph` 正常返回 `404`；5）fallback trace 中 `fallbackFromMode=langgraph`、`fallbackToMode=legacy` 等审计字段已校验正确。

- [x] `P5-T3` 补齐运行监控和告警
  - 目标：让切流决策基于指标，而不是体感
  - 前置依赖：`P5-T2`
  - 修改范围：`platform/trace/`、`platform/tests/`
  - 执行动作：
    1. 统计成功率、P95、schema 失败率、fallback 比例
    2. 输出每日或每批次差异报告
  - 产出物：关键监控指标
  - 完成判定：切流时可以用指标判断是否继续放量
  - 完成说明（2026-04-12）：已新增 [platform/trace/rollout-report.js](/Users/gato-pm/Desktop/API_副本/platform/trace/rollout-report.js) 与 [scripts/build_rollout_report.js](/Users/gato-pm/Desktop/API_副本/scripts/build_rollout_report.js)，落地第一版可离线执行的 rollout 指标聚合与批次报告能力：从结构化 JSONL trace 日志中识别 `agent.run.start / success / completed / failed`、`agent.langgraph.fallback.*`、`agent.shadow.completed` 事件，按 request 维度聚合出 `successRate`、`p50/p95/maxDurationMs`、`schemaFailureRate`、`fallbackRatio`、失败码 / 阶段分布，以及 shadow diff 的 `diffPassRate / differenceCount / failedRequestIds`；同时支持按阈值生成 `alerts`，并通过 `--fail-on-alert` 返回非零退出码，作为后续批处理告警和 CI 门槛的基础。为便于验证与后续扩展，已补充 [platform/tests/fixtures/rollout/sample-events.jsonl](/Users/gato-pm/Desktop/API_副本/platform/tests/fixtures/rollout/sample-events.jsonl) 作为监控样例输入，覆盖 `langgraph` 成功、自动 fallback、schema 失败 fallback、业务 404、legacy 成功、shadow diff 成功 / 失败等关键场景。已通过脚本验证：1）`build_rollout_report` 可生成批次报告 JSON，正确统计 `runs=5 / successRate=0.8 / p95=3000 / schemaFailureRate=0.25 / fallbackRatio=0.5 / shadowDiffPassRate=0.5`；2）报告断言脚本通过；3）在存在告警时 `--fail-on-alert` 正确返回退出码 `2`，可用于后续自动告警或灰度放量前检查。

### 验证方式

1. 先用白名单用户切流
2. 再用极小比例切流
3. 观察成功率、耗时、fallback 比例是否在可接受范围
4. 调用方看到的响应 envelope 不变化

### 回退方式

- 一键将切流比例设为 0
- 场景级别切回 `legacy`

---

## 阶段6：接入第二个相似业务，验证模板复用

### 阶段目标

用同一套模板接入一个相似新业务，只通过配置覆盖差异，验证平台不是“把当前业务代码重新拼了一份”。

### 修改范围

- 新增一份业务 skill 配置
- 按需新增少量业务资产和少量扩展节点

### 产出物

- 第二个业务 workflow
- 模板覆盖示例
- 配置复用验证报告

### 主要风险

- 第二个业务一接入，模板就需要大量定制补丁
- 节点粒度不合理，导致难以复用

### 详细任务

- [x] `P6-T1` 选择一个相似业务作为模板复用验证样本
  - 目标：确保第二个业务与当前模板有足够相似性
  - 前置依赖：`P5-T3`
  - 修改范围：文档、业务样例
  - 执行动作：
    1. 选择一个输入结构相近、输出结构相近的场景
    2. 明确与当前业务的差异点：prompt、schema、query profile、规则文件
  - 产出物：第二业务范围说明
  - 完成判定：明确该业务主要靠配置覆盖，而不是重写主流程
  - 完成说明（2026-04-12）：已新增 [第二业务模板复用样本范围说明.md](/Users/gato-pm/Desktop/API_副本/第二业务模板复用样本范围说明.md) 与 [tests/fixtures/reuse-candidate/sales-opportunity-advisor-directdb.request.json](/Users/gato-pm/Desktop/API_副本/tests/fixtures/reuse-candidate/sales-opportunity-advisor-directdb.request.json)，将 `sales-opportunity-advisor-directdb` 冻结为阶段 6 的第二业务模板复用验证样本。说明文档明确了选择理由、为何不选 `payment-info-split`、与当前 helper 版的复用边界，以及 `prompt / schema / query profile / rules / dictionary` 的差异划分：其中 `prompt / schema / rules / dictionary` 在 `P6-T2` 默认复用，`query profile` 与 `data tool` 作为主要配置差异切换到 directdb 版本，核心目标是不重写主流程。已通过 Node 静态验证：1）directdb 样本请求可通过现有 scene 请求校验；2）helper 与 directdb 两个 scene 的输入键一致，且 directdb scene 已被 `grounded-structured-advisory@v1` 模板声明为兼容场景；3）两者共用同一套 dictionary / rules / output schema 资产；4）directdb 的主要差异确实集中在 `requestKind` 与 data tool endpoint；5）当前平台中尚无 `sales-opportunity-advisor-directdb` 的 BusinessSkill 配置，符合下一步 `P6-T2` 仅通过配置补齐的预期。

- [x] `P6-T2` 仅通过配置创建第二业务 workflow
  - 目标：尽量少写新代码，主要新增配置和资产
  - 前置依赖：`P6-T1`
  - 修改范围：`platform/skills/`、`platform/templates/`、`platform/tools/`
  - 执行动作：
    1. 新增业务 skill 配置
    2. 绑定已有模板和已注册 tool
    3. 根据差异新增 prompt/schema/query profile
  - 产出物：第二业务配置
  - 完成判定：第二业务能编译通过并完成端到端运行
  - 完成说明（2026-04-12）：已新增 [platform/skills/sales-opportunity-advisor-directdb.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor-directdb.v1.yaml)、[platform/tools/sales-opportunity-directdb-runner.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-directdb-runner.tool.yaml)、[platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml)，并补齐 [platform/tools/openclaw-sales-agent-default.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/openclaw-sales-agent-default.tool.yaml) 与 [platform/tools/model-tool-structured-output.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/model-tool-structured-output.tool.yaml) 的 `allowedScenes`。第二业务复用了 `grounded-structured-advisory@v1` 模板、既有 prompt/schema/rules/dictionary 与已注册 LLM/validator tool，只将 data tool 与 query profile 切换为 directdb 配置。已完成两类验证：1）平台配置全量校验通过，统计为 `templates=1 / tools=4 / queries=2 / skills=2 / issueCount=0`；2）对 `sales-opportunity-advisor-directdb` 进行编译与 stub 端到端运行，确认 graph 绑定 `query://sales-opportunity-directdb/by-opportunity-id@v1` 与 `tool://data/sales-opportunity-directdb-runner@v1`，最终以 `langgraph-stategraph` 引擎成功产出结构化结果。

- [x] `P6-T3` 总结模板需要补强的地方
  - 目标：根据第二业务反馈微调模板，而不是继续堆专用逻辑
  - 前置依赖：`P6-T2`
  - 修改范围：`platform/templates/`、`platform/compiler/`
  - 执行动作：
    1. 识别模板中需要开放为配置的内容
    2. 识别不应开放配置的系统边界
  - 产出物：模板修订建议
  - 完成判定：模板能力增强后，仍不突破安全边界
  - 完成说明（2026-04-12）：已新增 [platform/templates/grounded-structured-advisory.v1.revision-notes.md](/Users/gato-pm/Desktop/API_副本/platform/templates/grounded-structured-advisory.v1.revision-notes.md)，固化了基于 `sales-opportunity-advisor-directdb` 第二业务复用验证得出的模板补强结论：继续开放 `toolRole / queryProfileRef / assetRefs / promptRef / maxBasisFields / 可选节点启停与同 phase 重排` 等扩展点，但保持受保护节点、state contract、跨 phase 重排、任意节点插入、底层 endpoint / secret / raw SQL / inline script 等边界为系统内建。同步更新了 [platform/templates/README.md](/Users/gato-pm/Desktop/API_副本/platform/templates/README.md) 的阶段 6 结论说明，并在 [platform/compiler/validate.js](/Users/gato-pm/Desktop/API_副本/platform/compiler/validate.js) 补上 `TOOL_SCENE_NOT_ALLOWED` 校验规则：当 `BusinessSkill.toolBindings.*.toolRef` 绑定了声明 `policy.allowedScenes` 的 tool 时，allowlist 必须覆盖当前 `scene`。已完成两类验证：1）平台全量配置校验仍然通过，结果为 `templates=1 / tools=4 / queries=2 / skills=2 / issueCount=0`；2）使用临时坏样本验证新规则时，校验器能正确拦截 `context_fetcher` 绑定未授权 scene 的 helper tool，并返回 `TOOL_SCENE_NOT_ALLOWED`。

### 验证方式

1. 第二业务主要通过配置接入
2. 业务新增代码量明显小于复制一套旧链路
3. 模板复用边界清晰，不需要破坏平台底层安全规则

### 回退方式

- 第二业务保留旧实现或继续旁路
- 不影响已迁移的 `sales-opportunity-advisor`

---

## 阶段7：逐步收口旧编排逻辑

### 阶段目标

在至少两个业务都稳定运行在新平台后，再逐步收口旧的场景编排逻辑，但仍保留兼容层和回退抓手。

### 修改范围

- 清理重复编排
- 保留兼容适配
- 不急于删除旧服务

### 产出物

- 旧新映射表
- 兼容层边界说明
- 旧逻辑下线路线图

### 主要风险

- 旧链路删得过早，出问题时没有回退路径

### 详细任务

- [x] `P7-T1` 梳理旧系统到新系统的映射关系
  - 目标：明确哪些旧模块已被新平台覆盖
  - 前置依赖：`P6-T3`
  - 修改范围：文档
  - 执行动作：
    1. 列出旧模块、新模块、迁移状态
    2. 标明仍需保留的兼容边界
  - 产出物：旧新映射表
  - 完成判定：所有关键模块都有归属说明
  - 完成说明（2026-04-12）：已新增 [旧系统到新系统模块映射表.md](/Users/gato-pm/Desktop/API_副本/旧系统到新系统模块映射表.md)，按 `已覆盖 / 包装复用 / 共享底座 / 旧链路保留` 四类状态梳理了 API 入口、scene config、legacy runtime、legacy skill、资产加载、数据 tool、ModelTool、trace、direct-model 等关键模块的旧新归属，并明确了当前阶段必须保留的兼容边界。文档同时给出 scene 维度归属：`sales-opportunity-advisor` 为模板已建立的并行双轨场景，`sales-opportunity-advisor-directdb` 为模板已建立但对外仍只开 `legacy` 的场景，`payment-info-split` 仍是 direct-model 旧链路保留场景。已完成两类静态验证：1）文档内 `63` 个绝对路径链接全部存在，无悬空引用；2）关键映射关系与代码一致，已验证 [routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js) 同时接入 `runLegacySceneExecution / buildFallbackRoutePlan / runCompiledSceneWorkflow`，已验证 [services/runtime.js](/Users/gato-pm/Desktop/API_副本/services/runtime.js) 仍导出 legacy 执行入口，已验证 `platform/skills` 下仅存在 `sales-opportunity-advisor` 与 `sales-opportunity-advisor-directdb` 两个模板化业务 skill，当前不存在 `payment-info-split` 的平台 skill 配置。

- [x] `P7-T2` 将旧编排降级为兼容层
  - 目标：让旧逻辑不再继续扩张，但短期仍可回退
  - 前置依赖：`P7-T1`
  - 修改范围：`routes/agent.js`、`services/runtime.js`、`platform/gateway/`
  - 执行动作：
    1. 明确 legacy 只作为兼容执行路径
    2. 新业务不再复制旧 skill 逻辑
  - 产出物：兼容层边界
  - 完成判定：平台新增业务默认走模板和配置，不再走旧编排复制
  - 完成说明（2026-04-12）：已在 [platform/gateway/index.js](/Users/gato-pm/Desktop/API_副本/platform/gateway/index.js) 增加 agent-runtime scene 的 template-backed 校验与 `legacyRole` 语义收口：gateway 现在会先检查 scene 是否已在 `platform/skills/*.yaml` 中注册 `BusinessSkill`，未注册的 agent-runtime scene 会在 `scene-routing` 阶段直接拒绝，从而阻止“只加 scene-config 和 legacy skill 就接入新业务”的路径继续扩张；对已模板化 scene，`legacy` 会被明确标记为 `compatibility`，`shadow` baseline 会被标记为 `compatibility-shadow-baseline`，`langgraph` 自动回退会被标记为 `compatibility-fallback`，而 `direct-model` scene 继续保留 `legacy-primary`。同时更新了 [services/runtime.js](/Users/gato-pm/Desktop/API_副本/services/runtime.js) 的 legacy 执行返回结构，补入 `compatibilityBoundary` 元信息，并在 [routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js) 日志上下文中补充 `platformManagedScene / legacyExecutionRole`，便于后续 trace 和下线评估。另新增 [旧编排兼容层边界说明.md](/Users/gato-pm/Desktop/API_副本/旧编排兼容层边界说明.md)，明确 legacy 当前仅用于显式 `legacy` 模式、`shadow` baseline、`langgraph` fallback 和尚未模板化的 direct-model scene。已完成三类验证：1）`sales-opportunity-advisor` 与 `sales-opportunity-advisor-directdb` 两个 agent-runtime scene 的 route plan 均返回 `platformManagedScene=true`、`legacyRole=compatibility`；2）`payment-info-split` direct-model scene 仍返回 `legacyRole=legacy-primary`；3）构造一个未在 `platform/skills` 注册的假 agent-runtime scene 时，gateway 会返回 `INVALID_REQUEST`，并带 `details.requirement=template_backed_agent_runtime_scene`，达到“新业务默认走模板和配置，不再走旧编排复制”的约束目标。

- [x] `P7-T3` 制定旧逻辑下线标准
  - 目标：避免“永远兼容”导致长期双轨维护
  - 前置依赖：`P7-T2`
  - 修改范围：文档、运维规则
  - 执行动作：
    1. 定义可下线条件：稳定时间、fallback 比例、覆盖业务数
    2. 定义下线前检查项
  - 产出物：旧逻辑下线标准
  - 完成判定：旧逻辑何时退场有明确门槛
  - 完成说明（2026-04-12）：已新增 [旧逻辑下线标准.md](/Users/gato-pm/Desktop/API_副本/旧逻辑下线标准.md)，将旧逻辑退场拆分为三层门槛：1）scene 默认执行从 `legacy` 切到 `langgraph`；2）关闭 scene 级显式 `legacy`；3）删除全局 `agent-runtime` 旧执行器。文档明确了适用范围仅限已在 `platform/skills` 注册的 template-backed `agent-runtime` scene，当前不包含 `payment-info-split` 这类 `direct-model` 旧链路场景；同时把可量化门槛固定为现有 rollout / regression 能力已经支持的指标口径，包括 `successRate`、`fallbackRatio`、`schemaFailureRate`、`latency.p95DurationMs`、`shadowDiff.diffPassRate`，并给出下线前检查项、推荐命令和禁止推动下线的场景。已完成两类验证：1）文档内 `9` 个绝对路径链接全部存在，且已检查包含 `稳定时间 / fallback 比例 / 覆盖 / 检查项 / successRate / shadowDiff.diffPassRate / payment-info-split` 等关键判定字段；2）按文档所引用命令实际执行 [scripts/build_rollout_report.js](/Users/gato-pm/Desktop/API_副本/scripts/build_rollout_report.js) 对 [platform/tests/fixtures/rollout/sample-events.jsonl](/Users/gato-pm/Desktop/API_副本/platform/tests/fixtures/rollout/sample-events.jsonl) 生成报告成功，报告中可正确读取 `successRate=0.8`、`fallbackRatio=0.5`、`schemaFailureRate=0.25`、`p95DurationMs=3000`、`shadowDiffPassRate=0.5`，证明标准所依赖的指标和脚本均已存在且可执行。

### 验证方式

1. 至少两个业务稳定运行于新平台
2. legacy 路径仅用于兼容和回退，不再承载新需求开发
3. 下线标准明确并被接受

### 回退方式

- 保留 legacy 兼容路径，直到满足下线标准
- 如收口后出现问题，可按 scene 重新切回 legacy

## 6. 前端控制台支线任务清单

### 前端支线目标

为新的 agent 业务平台补一套内部控制台页面，用于配置查看、workflow 调试、shadow 对比、trace 排障和受控配置管理。

前端支线原则：

1. 不阻塞后端主线迁移。
2. 不要求先做复杂可视化编排器。
3. 每一阶段都可独立运行、独立回退。
4. 先做只读和联调，再做配置编辑。

---

## 前端阶段FE0：冻结页面范围和接口契约

### 阶段目标

明确前端 V1 做哪些页面、不做哪些页面，并冻结前后端接口契约，避免页面一边做、后端协议一边漂。

### 修改范围

- 文档
- API / 配置协议说明
- 前端目录脚手架设计

### 产出物

- 页面信息架构
- 页面和接口映射表
- 前端目录设计
- Mock 数据约定

### 主要风险

- 页面范围过大，把前端做成新的阻塞项
- 后端协议未稳定，导致页面反复返工

### 详细任务

- [x] `FE0-T1` 定义前端 V1 页面范围
  - 目标：冻结 V1 最小页面清单
  - 前置依赖：`P2-T4`
  - 修改范围：文档
  - 执行动作：
    1. 定义只读页、调试页、trace 页、配置查看页
    2. 明确暂不做拖拽编排和生产直发
  - 产出物：页面范围说明
  - 完成判定：页面范围和非目标范围清晰
  - 完成说明（2026-04-12）：已新增 [前端V1页面范围说明.md](/Users/gato-pm/Desktop/API_副本/前端V1页面范围说明.md)，冻结了前端控制台 V1 的产品定位、目标用户、五个一级域（`Scenes / Debug / Runs / Configs / Rollout`）、建议路由骨架，以及按 `FE1 / FE2 / FE3` 拆分的 9 个页面清单：`Scene / Workflow 浏览页`、`单次请求调试页`、`Run 列表页`、`Run 详情页`、`Shadow 对比页`、`Trace 详情页`、`配置查看与差异页`、`配置校验与编译预览页`、`灰度切流操作页`。文档同时明确 V1 不做拖拽编排器、在线自由改节点逻辑、在线自由改 prompt / SQL / 脚本、生产环境直接发布配置，以及多租户运营后台等超范围能力；并为每类页面补充了“数据来源类别”说明，给下一步 `FE0-T2` 的接口映射提供输入。已完成两类静态验证：1）文档包含 `只读页 / 调试页 / Trace 详情页 / 配置查看与差异页 / 可视化拖拽编排器 / 生产环境直接发布配置 / 数据来源类别 / FE1 / FE2 / FE3` 等关键范围字段；2）文档完整定义了 9 个目标页面，且同时包含“V1 明确不做的范围”和“数据来源边界”章节，满足页面范围冻结要求。

- [x] `FE0-T2` 定义页面与后端接口映射
  - 目标：明确每个页面依赖哪些 API 和数据结构
  - 前置依赖：`FE0-T1`
  - 修改范围：文档、接口定义
  - 执行动作：
    1. 明确 Scene 列表、Workflow 详情、Run 详情、Trace 详情、配置校验等接口
    2. 标明哪些接口可先用 mock，哪些必须真实对接
  - 产出物：页面接口映射表
  - 完成判定：前端开发可据此独立推进
  - 完成说明（2026-04-12）：已新增 [前端页面与后端接口映射表.md](/Users/gato-pm/Desktop/API_副本/前端页面与后端接口映射表.md)，冻结了前端控制台页面到后端接口的映射关系，并统一规定前端只调用 `/api/*` facade，不直连 Gateway、ContextHelper、DirectDbRunner、ModelTool 等内部服务。文档按页面维度明确了 Scene 列表、Workflow 详情、单次请求调试、Run 列表 / 详情、Shadow 对比、Trace 详情、配置目录、配置校验、编译预览、Rollout / 灰度等接口，给出了每个接口的最小请求 / 响应结构、真实数据来源、mock 策略与阶段要求；其中明确 `POST /api/agent/run` 为 FE1 必须真实对接接口，Run / Shadow / Trace 在 FE2 必须真实，配置校验与编译预览在 FE3 必须真实，其余只读概览接口可先用 mock 启动页面。文档同时补充了可直接复用的 mock 数据来源，包括 [tests/fixtures/baseline](/Users/gato-pm/Desktop/API_副本/tests/fixtures/baseline)、[platform/tests/fixtures/rollout/sample-events.jsonl](/Users/gato-pm/Desktop/API_副本/platform/tests/fixtures/rollout/sample-events.jsonl)、[platform/tests/output/rollout-report.sample.json](/Users/gato-pm/Desktop/API_副本/platform/tests/output/rollout-report.sample.json) 以及 `scene-configs / platform/*` 配置目录。已完成三类静态验证：1）文档已覆盖 `GET /api/console/scenes`、`GET /api/console/scenes/:scene/workflow`、`POST /api/agent/run`、`GET /api/console/runs/:runId`、`GET /api/console/traces/:traceId`、`POST /api/console/configs/validate`、`POST /api/console/configs/compile-preview`、`GET /api/console/rollout/report` 等关键接口；2）文档包含页面清单、最小数据结构、mock / real 边界，且 `30` 个绝对路径链接全部存在；3）文档明确写入前端禁止直连 `Gateway / ContextHelper / DirectDbRunner / ModelTool` 的 4 个内部 endpoint，满足控制台前后端边界冻结要求。

### 验证方式

1. 页面范围被明确写入文档
2. 每个页面都有对应的数据来源说明
3. Mock 和真实接口边界明确

### 回退方式

- 这一阶段只产出文档和契约
- 若范围定义不合理，直接修改文档即可

---

## 前端阶段FE1：落地最小只读控制台

### 阶段目标

先做一个可运行的内部控制台，支持查看 scene/workflow 基本信息，并可发起单次联调请求。

### 修改范围

- 新增 `console/` 页面工程
- 新增前端请求层和最小页面骨架

### 产出物

- 前端工程脚手架
- Scene 列表页
- Workflow/Skill 详情页
- 单次请求调试页

### 主要风险

- 前端工程引入后打乱当前仓库结构
- 页面过早绑定未来接口，导致后面大改

### 详细任务

- [x] `FE1-T1` 初始化前端控制台工程
  - 目标：创建独立的控制台页面工程
  - 前置依赖：`FE0-T2`、`P3-T3`
  - 修改范围：`console/`
  - 执行动作：
    1. 初始化前端工程、路由、基础布局
    2. 约定开发端口和本地启动方式
    3. 准备 API client 和 mock client
  - 产出物：可启动的前端工程
  - 完成判定：本地可运行页面壳子
  - 完成说明（2026-04-12）：已新增独立 Vite + React 控制台工程 [console/package.json](/Users/gato-pm/Desktop/API_副本/console/package.json)、[console/src/App.jsx](/Users/gato-pm/Desktop/API_副本/console/src/App.jsx)、[console/src/services/clientFactory.js](/Users/gato-pm/Desktop/API_副本/console/src/services/clientFactory.js) 等基础文件，内置 `3200` 开发端口、基础导航布局、API/mock 双 client 与 `scenes / debug / runs / configs / rollout` 页面壳；已通过 `npm run build` 构建校验，并用 Playwright 打开 `http://127.0.0.1:3200/scenes` 验证页面可访问、主导航正常、控制台无阻断性错误。

- [x] `FE1-T2` 实现场景和 workflow 浏览页
  - 目标：支持查看 scene、模板、业务 skill 的只读信息
  - 前置依赖：`FE1-T1`
  - 修改范围：`console/src/pages/scenes/`、`console/src/pages/workflows/`
  - 执行动作：
    1. 展示 scene 基本信息、运行模式、模板引用
    2. 展示 workflow 节点顺序、可覆盖点、工具绑定
  - 产出物：场景列表页、workflow 详情页
  - 完成判定：用户可通过页面理解当前业务如何映射到模板
  - 完成说明（2026-04-12）：已将 [console/src/pages/scenes/ScenesPage.jsx](/Users/gato-pm/Desktop/API_副本/console/src/pages/scenes/ScenesPage.jsx) 从占位页升级为真实只读浏览页，补充 scene 总览指标、执行 / 路由 / 模板 / skill / 数据来源等关键信息；已将 [console/src/pages/scenes/SceneWorkflowPage.jsx](/Users/gato-pm/Desktop/API_副本/console/src/pages/scenes/SceneWorkflowPage.jsx) 升级为 workflow 详情页，展示模板映射、business skill 资产、tool / query 绑定、节点顺序、可覆盖点、条件分支与 legacy 对照；并新增 [console/src/pages/workflows/WorkflowNodeList.jsx](/Users/gato-pm/Desktop/API_副本/console/src/pages/workflows/WorkflowNodeList.jsx) 与 [console/src/services/mockClient.js](/Users/gato-pm/Desktop/API_副本/console/src/services/mockClient.js) 的模板化 mock 数据，覆盖 helper、directdb、legacy-only 三类 scene。已通过 `npm run build` 构建校验，并用 Playwright 先后打开 `http://127.0.0.1:3200/scenes`、`/scenes/sales-opportunity-advisor`、`/scenes/payment-info-split` 验证总览页、template-backed 详情页和 legacy-only 详情页均可正常展示，无阻断性控制台错误。

- [x] `FE1-T3` 实现单次请求调试页
  - 目标：支持在页面中发起一次 `POST /api/agent/run` 调试
  - 前置依赖：`FE1-T1`
  - 修改范围：`console/src/pages/runs/`
  - 执行动作：
    1. 输入 scene 和业务参数
    2. 发起 API 请求
    3. 展示响应和错误信息
  - 产出物：联调页
  - 完成判定：前端可用于最小 API 联调
  - 完成说明（2026-04-12）：已将 [console/src/pages/debug/RunOncePage.jsx](/Users/gato-pm/Desktop/API_副本/console/src/pages/debug/RunOncePage.jsx) 从占位页升级为真实联调页，支持选择 scene、编辑 `bizParams` JSON、填写 `tenantId / userId`、载入场景示例，并始终通过 [console/src/services/apiClient.js](/Users/gato-pm/Desktop/API_副本/console/src/services/apiClient.js) 真实调用 `POST /api/agent/run`；页面已补充请求预览、HTTP 状态、`requestId`、耗时、成功提示、错误提示、实际提交请求和原始响应 envelope 展示。同步更新了 [console/src/components/ShellLayout.jsx](/Users/gato-pm/Desktop/API_副本/console/src/components/ShellLayout.jsx) 阶段文案与 [console/src/styles.css](/Users/gato-pm/Desktop/API_副本/console/src/styles.css) 表单 / 响应样式。已通过 `npm run build` 构建校验；并使用 Playwright 真实打开 `http://127.0.0.1:3200/debug/run-once` 点击“发送真实请求”，验证 `payment-info-split` happy path 返回 `HTTP 200` 与真实 `requestId`，随后将 `bizParams` 改为 `{}` 再次提交，验证页面可展示真实 `HTTP 400 / INVALID_REQUEST / bizParams.rawText is required.` 错误回包；同时用 `curl` 直调现有 `/api/agent/run` 验证错误 envelope 与页面展示一致。

### 验证方式

1. 前端本地能启动
2. 页面可读取 mock 数据或真实只读接口
3. 联调页可对现有 `/api/agent/run` 发起请求并展示结果

### 回退方式

- 前端工程独立存在
- 页面有问题时不影响后端主链路，可单独停用

---

## 前端阶段FE2：补齐 Shadow 对比和 Trace 页面

### 阶段目标

在后端完成影子运行和节点 trace 之后，前端补齐 run 对比、节点详情和异常排查页面。

### 修改范围

- `console/src/pages/runs/`
- `console/src/pages/traces/`
- 对应前端服务层

### 产出物

- Run 列表页
- Run 详情页
- Shadow 差异页
- 节点 Trace 详情页

### 主要风险

- 后端 trace 结构变化频繁，页面展示逻辑会抖动
- 页面只展示最终结果，无法定位节点差异

### 详细任务

- [x] `FE2-T1` 实现 Run 列表和 Run 详情页
  - 目标：支持查看每次请求的运行结果和模式
  - 前置依赖：`FE1-T3`、`P4-T5`
  - 修改范围：`console/src/pages/runs/`
  - 执行动作：
    1. 展示 request_id、scene、run_mode、状态、耗时
    2. 展示最终结果和错误摘要
  - 产出物：Run 列表页、Run 详情页
  - 完成判定：可快速定位一条请求的基本运行情况
  - 完成说明（2026-04-12）：已新增真实 run 聚合服务 [services/console-runs.js](/Users/gato-pm/Desktop/API_副本/services/console-runs.js) 与只读 API facade [routes/console-runs.js](/Users/gato-pm/Desktop/API_副本/routes/console-runs.js)，并在 [server.js](/Users/gato-pm/Desktop/API_副本/server.js) 接入 `GET /api/console/runs`、`GET /api/console/runs/:runId`，从 `logs/api.stdout.log + logs/api.stderr.log` 聚合真实运行元数据、错误摘要和请求摘要；前端已将 [console/src/pages/runs/RunListPage.jsx](/Users/gato-pm/Desktop/API_副本/console/src/pages/runs/RunListPage.jsx) 与 [console/src/pages/runs/RunDetailPage.jsx](/Users/gato-pm/Desktop/API_副本/console/src/pages/runs/RunDetailPage.jsx) 升级为真实列表/详情页，展示 requestId、scene、requested/effective mode、executionMode、状态、耗时、错误码，以及单条 run 的请求摘要、路由摘要、结果摘要和错误摘要；并补充 [console/vite.config.js](/Users/gato-pm/Desktop/API_副本/console/vite.config.js)、[console/.env.example](/Users/gato-pm/Desktop/API_副本/console/.env.example)、[console/README.md](/Users/gato-pm/Desktop/API_副本/console/README.md) 支持通过 `VITE_API_PROXY_TARGET` 指向并行 API。已通过三类验证：1）Node 直接调用 run 聚合服务，能输出最近 runs 和单条 run 详情；2）并行 API `http://127.0.0.1:3001` 的 `GET /api/console/runs` 与 `GET /api/console/runs/req_20260412_122154138_8903e934` 返回真实日志聚合结果；3）并行前端 `http://127.0.0.1:3202/runs` 与 `/runs/req_20260412_122154138_8903e934` 通过 Playwright 验证，列表页和详情页均可正常展示，无阻断性控制台错误。

- [x] `FE2-T2` 实现 Shadow 对比页
  - 目标：支持对比 `legacy` 和 `langgraph` 结果
  - 前置依赖：`FE2-T1`
  - 修改范围：`console/src/pages/runs/compare/`
  - 执行动作：
    1. 展示新旧结果差异摘要
    2. 标记关键字段差异
    3. 可跳转查看具体节点差异
  - 产出物：Shadow 对比页
  - 完成判定：新旧链路差异可被页面化查看
  - 完成说明（2026-04-12）：已在 [services/console-runs.js](/Users/gato-pm/Desktop/API_副本/services/console-runs.js) 补充 `getConsoleShadowDetail()`，从现有 run 日志中提取 `agent.shadow.completed` 摘要，输出 baseline / shadow 摘要、四类 diff checks、关键字段差异和 trace 跳转路径；并在 [routes/console-runs.js](/Users/gato-pm/Desktop/API_副本/routes/console-runs.js) 与 [server.js](/Users/gato-pm/Desktop/API_副本/server.js) 接入 `GET /api/console/runs/:runId/shadow`。前端已将 [console/src/pages/runs/ShadowComparePage.jsx](/Users/gato-pm/Desktop/API_副本/console/src/pages/runs/ShadowComparePage.jsx) 从骨架页升级为真实对比页，展示 diff pass/fail、difference count、关键字段差异、shadow 节点概览以及跳转到 baseline/shadow trace 的入口；同时在 [console/src/pages/runs/RunDetailPage.jsx](/Users/gato-pm/Desktop/API_副本/console/src/pages/runs/RunDetailPage.jsx)、[console/src/styles.css](/Users/gato-pm/Desktop/API_副本/console/src/styles.css)、[console/src/components/ShellLayout.jsx](/Users/gato-pm/Desktop/API_副本/console/src/components/ShellLayout.jsx) 补充对比页入口、样式和阶段文案。已通过四类验证：1）Node 直接调用 `getConsoleShadowDetail()`，对真实日志返回 `available=false`，对 `platform/tests/fixtures/rollout/sample-events.jsonl` 返回完整 diff 摘要；2）并行 API `http://127.0.0.1:3001/api/console/runs/:runId/shadow` 可返回真实日志下的无-shadow分支，fixture API `http://127.0.0.1:3003/api/console/runs/req-shadow-failed/shadow` 可返回完整差异数据；3）前端构建 `console npm run build` 通过；4）Playwright 已验证 `http://127.0.0.1:3202/runs/req_20260412_122154138_8903e934/shadow` 的无-shadow空态，以及 `http://127.0.0.1:3203/runs/req-shadow-failed/shadow` 的差异摘要、关键字段差异和 trace 跳转入口。

- [x] `FE2-T3` 实现节点 Trace 详情页
  - 目标：支持查看每个节点的输入摘要、输出摘要、耗时、错误
  - 前置依赖：`FE2-T1`
  - 修改范围：`console/src/pages/traces/`
  - 执行动作：
    1. 展示节点列表
    2. 展示节点执行时间线
    3. 展示 tool 调用和 LLM 调用摘要
  - 产出物：Trace 页面
  - 完成判定：页面可以辅助排查节点级问题
  - 完成说明（2026-04-12）：已新增 [services/console-traces.js](/Users/gato-pm/Desktop/API_副本/services/console-traces.js) 与 [routes/console-traces.js](/Users/gato-pm/Desktop/API_副本/routes/console-traces.js)，通过现有 run 日志、fallback/shadow 摘要以及已编译 workflow template 构建 trace 详情数据，并在 [server.js](/Users/gato-pm/Desktop/API_副本/server.js) 接入 `GET /api/console/traces/:traceId`；前端已将 [console/src/pages/traces/TraceDetailPage.jsx](/Users/gato-pm/Desktop/API_副本/console/src/pages/traces/TraceDetailPage.jsx) 从骨架页升级为真实页面，展示请求与路由摘要、事件时间线、节点执行时间线，以及 tool / LLM 摘要，同时在 [console/src/pages/runs/RunDetailPage.jsx](/Users/gato-pm/Desktop/API_副本/console/src/pages/runs/RunDetailPage.jsx) 补充 run 到 trace 的跳转入口，并更新 [console/src/components/ShellLayout.jsx](/Users/gato-pm/Desktop/API_副本/console/src/components/ShellLayout.jsx) 阶段文案。由于当前生产日志尚未持久化 `node_runs`，页面会明确标注“workflow 合同 + fallback/shadow 摘要兜底”；一旦后续日志落盘了 `node_runs`，同一接口可以直接展示真实节点输入/输出摘要。已通过四类验证：1）Node 直接调用 `getConsoleTraceDetail()`，对 `trace-lg-fallback-schema` 返回 `validate_output:error` 节点，对 `shadowtrace-2` 返回 shadow 节点摘要；2）fixture API `http://127.0.0.1:3003/api/console/traces/trace-lg-fallback-schema` 与 `/api/console/traces/shadowtrace-2` 返回完整 trace 数据；3）前端构建 `console npm run build` 通过；4）Playwright 已验证 `http://127.0.0.1:3203/traces/trace-lg-fallback-schema` 与 `/traces/shadowtrace-2`，页面可展示事件时间线、tool/LLM 摘要、节点时间线及异常节点提示，控制台无报错，仅有 React Router future warnings。

### 验证方式

1. 页面可展示真实 shadow 运行记录
2. 页面可定位到单个节点异常
3. 差异页可显示关键字段变更

### 回退方式

- 前端页面独立回退
- 即使页面不可用，后端影子运行仍可继续

---

## 前端阶段FE3：补齐受控配置管理页和灰度操作页

### 阶段目标

在配置协议、校验器、灰度切流稳定后，前端补齐受控配置查看/编辑、编译预览和灰度开关页面。

### 修改范围

- `console/src/pages/configs/`
- `console/src/pages/workflows/`
- `console/src/pages/ops/`

### 产出物

- 配置查看页
- 配置校验和编译预览页
- 灰度切流操作页

### 主要风险

- 前端误把“可查看”做成“可随意修改”
- 页面直接改线上配置，越过审核和校验

### 详细任务

- [x] `FE3-T1` 实现配置查看与差异页
  - 目标：让用户能查看模板、业务 skill、tool、query profile
  - 前置依赖：`FE2-T3`、`P5-T3`
  - 修改范围：`console/src/pages/configs/`
  - 执行动作：
    1. 展示配置资源详情
    2. 展示版本差异
    3. 标注可配置与不可配置字段
  - 产出物：配置查看页
  - 完成判定：配置资源可以被页面化浏览和比较

- [x] `FE3-T2` 实现配置校验与编译预览页
  - 目标：在发布前先做校验和 workflow 预览
  - 前置依赖：`FE3-T1`
  - 修改范围：`console/src/pages/workflows/preview/`
  - 执行动作：
    1. 展示配置 lint 结果
    2. 展示编译后的节点图和执行顺序
    3. 标出禁用节点、覆盖节点、替换节点
  - 产出物：校验与编译预览页
  - 完成判定：配置变更在页面上可先被预演

- [x] `FE3-T3` 实现灰度切流操作页
  - 目标：让内部用户在受控范围内查看和调整切流状态
  - 前置依赖：`FE3-T2`
  - 修改范围：`console/src/pages/ops/`
  - 执行动作：
    1. 展示当前 scene 路由模式
    2. 展示灰度比例、白名单、fallback 状态
    3. 所有变更操作必须走后端校验和审计
  - 产出物：灰度操作页
  - 完成判定：页面可用于受控灰度操作，而不是直接改文件

### 验证方式

1. 配置校验和编译预览与后端结果一致
2. 页面修改不会绕过后端校验
3. 灰度操作有审计记录

### 回退方式

- 禁用前端写操作，仅保留只读模式
- 如有必要，关闭控制台中的配置编辑和灰度操作入口

## 7. 建议的阶段性验收门槛

### 阶段0 放行门槛

- 有完整基线样例和黄金输出
- 有最小回归脚本
- 当前行为已被清晰记录

### 阶段1 放行门槛

- 新增网关后，默认 `legacy` 行为完全不变
- scene 可通过配置切换运行模式

### 阶段2 放行门槛

- 当前业务能被模板和业务 skill 配置完整表达
- 非法配置可以被校验器拦截

### 阶段3 放行门槛

- LangGraph 兼容子图能跑通当前业务
- `shadow` 模式不会影响正式返回

### 阶段4 放行门槛

- 当前业务的新图已具备节点级可观测性
- 与旧结果的关键差异可被定位

### 阶段5 放行门槛

- 有可控灰度和自动回退
- 小流量下指标稳定

### 阶段6 放行门槛

- 第二业务主要依赖配置复用模板
- 平台没有因为第二业务而失去边界

### 阶段7 放行门槛

- 新平台已覆盖主要目标业务
- 旧逻辑已降级为兼容层

### 前端阶段FE0 放行门槛

- 页面范围明确
- 前后端接口映射冻结

### 前端阶段FE1 放行门槛

- 前端工程可独立启动
- 场景浏览和单次联调可用

### 前端阶段FE2 放行门槛

- Shadow 对比页和 Trace 页可读真实数据
- 节点级问题可被页面定位

### 前端阶段FE3 放行门槛

- 配置校验和编译预览可用
- 灰度操作经过后端校验和审计

## 8. AI 执行建议顺序

如果要让 AI 分轮推进，建议严格按下面顺序执行：

1. 先做阶段0，生成基线文档、样例、回归脚本。
2. 再做阶段1，只引入路由层，不切新链路。
3. 再做阶段2，只落配置协议和校验，不接正式执行。
4. 阶段2完成后，可并行启动前端阶段FE0，先冻结页面范围和接口契约。
5. 再做阶段3，让新运行时通过兼容节点在影子路径跑起来。
6. 阶段3完成后，可并行启动前端阶段FE1，先做只读控制台和联调页。
7. 再做阶段4，把当前业务拆成标准节点。
8. 阶段4完成后，可并行启动前端阶段FE2，补齐 Shadow 对比和 Trace 页。
9. 再做阶段5，小流量切换当前业务。
10. 阶段5完成后，可并行启动前端阶段FE3，补齐配置校验预览和灰度操作页。
11. 再做阶段6，用第二业务验证模板复用。
12. 最后做阶段7，逐步收口旧编排。

不建议跳过阶段0，也不建议直接从阶段2或阶段4开始。
