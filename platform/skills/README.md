# Business Skills

本目录用于承载 V1 的 `BusinessSkill` 配置协议和业务实例。

它回答的不是“平台有哪些标准节点”，而是：

- 这个具体业务复用哪个 `WorkflowTemplate`
- 这个业务绑定哪些 prompt / schema / dictionary / rules 资产
- 这个业务把模板中的 `toolRole` 绑定到哪些受控 tool
- 这个业务选择哪个 `QueryProfile`
- 这个业务允许对哪些节点做受控覆盖、启停和同阶段重排

当前目标仍然是先把协议冻结下来，作为后续：

- `P2-T3` tool / query profile 注册
- `P2-T4` 配置校验器
- `P4-T5` workflow graph 编译

的共同输入。

## 1. V1 资源格式

```yaml
apiVersion: agent.platform/v1alpha1
kind: BusinessSkill
metadata:
  name: business-skill-name
  version: v1
spec:
  ...
```

## 2. V1 顶层字段

### `spec.scene`

- 当前业务对外暴露的 scene 标识
- 需要与现有 API / gateway 路由兼容

### `spec.templateRef`

引用可复用 workflow template。

示例：

```yaml
templateRef:
  name: grounded-structured-advisory
  version: v1
```

### `spec.runtimeContract`

保留与当前 API / agent 兼容所需的请求契约：

- `requestKind`
- `messageVersion`
- `requestMarkers`
- `resultMarkers`
- `responseFormat`

### `spec.inputContract`

定义业务输入字段及约束。

V1 先只支持静态声明式字段，例如：

- 字段名
- 类型
- 是否必填
- 来源路径

### `spec.outputContract`

定义最终输出 envelope 和业务 payload schema 引用。

V1 只允许通过 `schemaRef` 引用 schema，不允许在业务 skill 配置里内联大段 schema 文本。

### `spec.assetRefs`

定义业务依赖的资产引用。V1 推荐按类型拆分：

- `prompts`
- `schemas`
- `dictionaries`
- `rules`

每个资产记录应至少包含：

- `*Ref`
- `source.type`
- `source.path`

这样既能表达平台内逻辑引用，也能保留当前旧系统文件路径作为迁移期对照。

### `spec.toolBindings`

把模板节点上的 `toolRole` 绑定到受控 tool。

示例：

```yaml
toolBindings:
  context_fetcher:
    toolRef: tool://data/generic-query-runner@v1
  advisory_llm:
    toolRef: tool://llm/openclaw-sales-agent-default@v1
  output_validator:
    toolRef: tool://validation/model-tool-structured-output@v1
```

注意：

- V1 只允许引用注册过的 `toolRef`
- 不允许在业务配置里直接写任意可执行脚本或任意外部 endpoint

### `spec.dataBindings`

定义业务查询选择，不直接暴露 SQL。

V1 核心字段：

- `queryProfileRef`
- `inputMapping`
- `expectedResultPath`

其中 `queryProfileRef` 必须引用受控 `QueryProfile`，不能在业务 skill 中内联 SQL、JS 查询脚本或任意 DSL。
`expectedResultPath` 表示当前场景期望在运行态状态树中从哪里拿到查询结果，例如 `artifacts.context.raw.rawRow`。

### `spec.nodeOverrides`

定义节点级受控覆盖。

V1 允许的覆盖形式只包括：

- `enabled`
- `timeoutMs`
- `retry`
- `toolRole`
- `promptRef`
- `assetRefs`
- `maxBasisFields`

并且只能覆盖模板该节点 `allowedConfig` 中声明过的项。

`schemaRef` 在 V1 仍然是必需能力，但默认应放在 `spec.outputContract.schemaRef`
或资产引用中；只有模板某个节点明确把 `schemaRef` 暴露在 `allowedConfig`
里时，才允许在 `nodeOverrides` 中单独改写。

V1 不允许：

- 内联 handler 代码
- 内联 shell / JS / SQL
- 改写节点输入输出契约
- 越过模板保护节点

### `spec.nodeOrderOverrides`

定义同 phase 内的节点顺序覆盖。

V1 规则：

- 只允许同阶段重排
- 不允许跨 phase
- 不允许新增模板外节点
- 是否可重排仍以模板约束为准

### `spec.security`

固定 V1 的安全边界。

建议至少包含：

- `mode: controlled`
- `deny.inlineSql`
- `deny.inlineScript`
- `deny.inlineSchemaText`
- `deny.unregisteredToolRef`
- `deny.externalNetworkEndpoint`
- `deny.crossPhaseReorder`
- `deny.arbitraryNodeInsertion`

## 3. V1 节点覆盖边界

### 3.1 允许业务覆盖的内容

- 选择模板
- 选择 prompt / schema / dictionary / rules
- 绑定 tool role
- 绑定 query profile
- 控制可跳过节点是否启用
- 为节点设置受控参数
- 对允许重排的节点做同阶段调序

### 3.2 不允许业务覆盖的内容

- 权限校验底层实现
- 脱敏底层实现
- 平台 trace / audit
- 任意异常处理框架
- 任意节点插入
- 任意代码执行
- LLM provider 密钥

## 4. 当前业务实例

当前实例：

- [sales-opportunity-advisor.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor.v1.yaml)

这份配置的目标是证明：

1. 当前 `sales-opportunity-advisor` 可以不用复制业务代码路径，而是通过 `BusinessSkill + WorkflowTemplate` 表达
2. 当前 helper 查询方式可以沉淀为 `queryProfileRef`
3. 当前 prompt / schema / dictionary / rules 可以显式资产化
4. 当前 `ContextHelper`、业务 LLM、`ModelTool` 可以分别作为受控 `toolRole` 绑定

## 5. V1 迁移口径

V1 仍处于并行路径阶段，因此允许 `BusinessSkill` 同时保留：

- 平台逻辑引用，例如 `tool://...`
- 迁移来源路径，例如旧 `SKILL.md`、字典文件、本地 schema 文件

但这些来源路径只用于：

- 对照
- 编译期校验
- 后续资产拆分迁移

不意味着业务配置可以直接执行任意文件中的脚本。
