# Tools And Query Profiles

本目录用于承载 V1 的 `ToolDefinition` 和 `QueryProfile` 配置协议。

目标是把两类东西拆开：

- `ToolDefinition`
  - 平台里“能调用什么能力”
- `QueryProfile`
  - 某个业务“想查什么数据、允许怎么查、结果该长什么样”

这样业务 skill 只引用能力和 profile，不再自己内联：

- 任意 endpoint
- 任意 SQL
- 任意脚本路径

## 1. V1 资源类型

### `ToolDefinition`

```yaml
apiVersion: agent.platform/v1alpha1
kind: ToolDefinition
metadata:
  name: tool-name
  version: v1
spec:
  ref: tool://domain/tool-name@v1
  ...
```

### `QueryProfile`

```yaml
apiVersion: agent.platform/v1alpha1
kind: QueryProfile
metadata:
  name: query-name
  version: v1
spec:
  ref: query://domain/query-name@v1
  ...
```

## 2. ToolDefinition 字段

### `spec.ref`

工具的稳定引用地址，供 `BusinessSkill.spec.toolBindings` 使用。

### `spec.toolRole`

声明这个工具能绑定到哪个模板角色，例如：

- `context_fetcher`
- `knowledge_retriever`
- `advisory_llm`
- `output_validator`

### `spec.category`

V1 建议类别：

- `data`
- `llm`
- `validation`

### `spec.driver`

定义工具如何被调用。

V1 支持的受控驱动：

- `http`
- `project-llm`

其中：

- `http` 工具必须显式声明 endpoint 和网络策略
- `project-llm` 工具由项目内 LLM client 托管，不允许业务自己传 provider 密钥或外部 provider endpoint

### `spec.requestContract`

定义调用时必需输入。

V1 重点是：

- `requiredFields`
- `inputSources`

### `spec.responseContract`

定义工具返回值的约束，例如：

- `resultPath`
- `errorPath`
- `successField`

### `spec.limits`

V1 强制给每个工具固定上限：

- `timeoutMsDefault`
- `timeoutMsMax`
- `retryMaxAttempts`

业务配置只能在上限内缩紧，不能突破上限。

### `spec.policy`

定义受控边界，例如：

- 允许哪些 scene 使用
- 是否允许 endpoint override
- 是否允许内联凭据
- 是否允许原生 SQL 输入

## 3. QueryProfile 字段

### `spec.ref`

查询 profile 的稳定引用地址，供 `BusinessSkill.spec.dataBindings.queryProfileRef` 使用。

### `spec.toolRef`

绑定到哪个已注册 `ToolDefinition`。

### `spec.toolRole`

声明这个 profile 适用于哪个模板角色。V1 当前固定给 `context_fetcher`。

### `spec.primaryEntity`

描述主查询对象，例如：

- 表名
- 主键字段

### `spec.inputContract`

声明查询需要哪些业务输入。

V1 重点：

- `requiredInputs`
- 字段类型
- 来源路径

### `spec.selectionPolicy`

表达查询意图，而不是暴露 SQL。

V1 建议字段：

- `cardinality`
- `where`
- `statement.type`
- `statement.parameterPlaceholder`

### `spec.resultPolicy`

表达查询结果应该以什么形态返回。

V1 当前支持：

- `mode`
  - `single-row`
  - `multi-rows`
  - `column-values`
  - `aggregate-value`
- `fields`
- `distinct`
- `limit`

### `spec.outputPolicy`

表达允许返回什么数据。

V1 重点：

- `resultPath`

当前 V1 先固定只保留 `resultPath`，查询服务负责把原始结果落到运行时约定路径；字段翻译、字典映射和业务事实组装放到后置节点处理。

当前推荐做法是：

- `ToolDefinition`
  - 只承载通用查询执行能力
- `QueryProfile`
  - 描述查哪张表、按什么条件查、返回成什么结果模式

这样业务侧主要维护 `QueryProfile`，而不是去改底层执行器。

### `spec.generationConstraints`

用于约束 helper / planner / compiler 可以生成什么样的底层查询实现。

V1 必须限制：

- `allowJoin = false`
- `allowSubquery = false`
- `allowOrderBy = false`
- `allowWrite = false`
- `allowMultipleStatements = false`
- `allowRawSqlConfig = false`
- `allowInlineScript = false`

### `spec.limits`

和工具定义一样，固定：

- `timeoutMsDefault`
- `timeoutMsMax`
- `retryMaxAttempts`

## 4. V1 当前实例

当前已落地实例：

- [generic-query-runner.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/generic-query-runner.tool.yaml)
- [sales-opportunity-context-helper.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-context-helper.tool.yaml)
- [project-advisory-llm.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/project-advisory-llm.tool.yaml)
- [project-product-solution-llm.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/project-product-solution-llm.tool.yaml)
- [model-tool-structured-output.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/model-tool-structured-output.tool.yaml)
- [sales-opportunity-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-by-opportunity-id.query.yaml)
- [sales-opportunity-directdb-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml)
- [sales-opportunity-smart-entry-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-smart-entry-by-opportunity-id.query.yaml)

这组配置证明：

1. 当前销售机会 LangGraph 场景所需的数据、LLM 和校验能力可以受控注册
2. helper/directdb 查询业务可以作为 `QueryProfile` 表达
3. 查询配置表达的是“查什么”和“允许怎么查”，不是“直接执行什么 SQL”

## 5. V1 明确不允许

下面这些内容在 V1 不应出现在 `ToolDefinition` 或 `QueryProfile` 中：

- 任意 shell 脚本正文
- 任意 JS 查询脚本正文
- 原生 SQL 文本
- provider 密钥
- 非受控外部 endpoint
- 绝对脚本路径作为执行入口

迁移期允许保留旧系统路径，但只能放在：

- `migrationSource`
- `source`
- `note`

这类只读字段中，用于对照和校验，不用于直接执行。
