# Grounded Structured Advisory V1 Revision Notes

本文档记录 `P6-T3` 基于第二业务 `sales-opportunity-advisor-directdb` 模板复用验证后，对 [grounded-structured-advisory.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/templates/grounded-structured-advisory.v1.yaml) 得出的补强建议。

目标不是继续给当前模板叠加场景特例，而是把已经验证过的复用边界和安全护栏显式化，便于后续相似业务继续接入。

## 1. 这次复用已经证明的能力

`sales-opportunity-advisor-directdb` 已证明下面这些差异可以主要通过配置覆盖，而不需要复制主流程：

- `scene` 与 `requestKind`
- `context_fetcher` 对应的数据 tool
- `queryProfileRef`
- `load_reference_bundle` 节点引用的资产选择

同时，下面这些内容已经证明适合继续保持模板复用：

- 标准节点顺序和阶段划分
- 事实标准化与 basis fields 选择逻辑
- 结构化输出草拟、校验、修复、收口
- 统一 envelope、trace、运行时 state 结构

## 2. 本轮识别出的模板补强点

### 2.1 需要更明确开放的模板扩展点

这些能力已经在实际复用里用到，建议继续保留为模板级显式扩展点：

- `fetch_business_context.toolRole`
- `dataBindings.queryProfileRef`
- `load_reference_bundle.assetRefs`
- `draft_business_output.promptRef`
- `select_basis_fields.maxBasisFields`
- 可选节点的 `enabled / timeoutMs / retry`
- 同 phase 内、仅限 `reorderable=true` 节点的重排

建议继续把这些扩展点的控制面固定在：

- `WorkflowTemplate.spec.nodes[*].allowedConfig`
- `BusinessSkill.spec.nodeOverrides`
- `BusinessSkill.spec.nodeOrderOverrides`

不要引入第二套覆盖入口。

### 2.2 需要加强校验的复用护栏

第二业务接入时暴露出一条真实缺口：`BusinessSkill` 绑定的共享 tool 已完成注册，也符合 `toolRole`，但 `ToolDefinition.spec.policy.allowedScenes` 可能没有覆盖新 scene。

这类问题会导致：

- 配置表面上能编译
- 运行期却出现“业务已切到新模板，底层 tool 仍未授权该 scene”的错位

因此建议把下面这条规则固定为编译前校验：

- `BusinessSkill.toolBindings.<role>.toolRef` 对应的 `ToolDefinition.spec.policy.allowedScenes` 如已声明，则必须包含 `BusinessSkill.spec.scene`

本轮已在 `platform/compiler/validate.js` 落地该校验。

### 2.3 需要更明确写进模板说明的边界

从第二业务验证结果看，下面这些边界必须继续保持系统内建，不应被新业务配置突破：

- 受保护节点不能跳过
- 节点输入输出 state contract 不能被业务配置改写
- 不允许跨 phase 重排
- 不允许任意插入新节点
- 不允许通过业务配置覆盖 loopback endpoint、secret、raw SQL、inline script
- 不允许通过业务配置绕开权限和字段白名单

## 3. 建议的非破坏性演进顺序

建议按下面顺序补强，而不是直接扩大模板能力：

1. 先补校验器护栏，确保新 scene 复用共享 tool 时不会漏掉 allowlist
2. 再把模板扩展点矩阵写清楚，避免后续业务重复猜测“哪些能配、哪些不能配”
3. 等出现第三个相似业务后，再评估是否需要把资产复用策略抽成更显式的协议字段

## 4. 当前不建议做的事

基于本轮验证，下面这些方向暂时不要做：

- 不要为了 directdb 单独新增一套专用模板
- 不要开放跨 phase 重排
- 不要开放任意自定义节点注入
- 不要把底层 tool endpoint、安全策略、secret 管理下放到业务 skill
- 不要把 query 执行底层约束改成业务可写

## 5. 本轮结论

`grounded-structured-advisory@v1` 当前已经足够支撑第二个相似业务接入，问题不在“模板不够通用”，而在“模板扩展点和共享能力护栏还不够显式”。

因此，`P6-T3` 的正确收口方式是：

- 保持模板主结构不变
- 补足模板说明
- 补足配置校验器护栏

而不是继续为单一业务增加特判逻辑。
