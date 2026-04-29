# Workflow Templates

本目录用于承载 V1 的 `WorkflowTemplate` 配置协议和模板实例。

当前目标不是立即执行这些模板，而是先把“模板长什么样、包含哪些标准节点、允许哪些覆盖动作”固定下来，作为后续：

- `P2-T2` 业务 skill 配置协议
- `P2-T3` tool / query profile 配置
- `P2-T4` 配置校验器
- `P4-T5` workflow graph 编译

的共同基线。

## 1. V1 资源格式

V1 统一资源格式如下：

```yaml
apiVersion: agent.platform/v1alpha1
kind: WorkflowTemplate
metadata:
  name: template-name
  version: v1
spec:
  ...
```

## 2. V1 顶层字段说明

### `metadata`

- `name`
  - 模板稳定标识
- `version`
  - 模板版本
- `title`
  - 人类可读名称
- `status`
  - `draft` / `active`

### `spec.engine`

定义模板对应的执行引擎类型。

当前 V1 固定为：

- `type = langgraph-stategraph`

### `spec.stateSlices`

定义流程中需要持久传递的状态切片，例如：

- `request`
- `runtime`
- `workflow_contract`
- `policy`
- `context`
- `references`
- `facts`
- `draft`
- `validation`
- `result`
- `error`

### `spec.phases`

定义流程阶段，V1 用于约束节点的可重排范围。

当前建议阶段：

1. `bootstrap`
2. `contract`
3. `policy`
4. `data`
5. `transform`
6. `generation`
7. `validation`
8. `finalize`
9. `observe`

### `spec.nodes`

定义模板标准节点清单。

每个节点至少包含：

- `id`
- `phase`
- `category`
- `handlerRef`
- `required`
- `defaultEnabled`
- `skipAllowed`
- `reorderable`
- `replaceable`
- `inputs`
- `outputs`

### `spec.edges`

定义默认有向边。

### `spec.conditionalEdges`

定义条件分支。

V1 先只冻结表达口径，不实现任意 DSL 执行。

### `spec.constraints`

定义模板保护约束，例如：

- 入口节点
- 出口节点
- 受保护节点
- 最大修复循环次数
- 是否允许跨 phase 重排
- 是否允许任意插入节点

## 3. V1 节点覆盖规则

V1 先固定下面几类边界：

### 3.1 不允许跳过

以下节点属于平台保护节点，不能跳过：

- `bootstrap_runtime`
- `load_workflow_contract`
- `validate_input`
- `authorize_scope`
- `fetch_business_context`
- `normalize_facts`
- `validate_output`
- `finalize_result`
- `observe_run`

### 3.2 可以跳过

以下节点在 V1 可设计为可跳过节点：

- `resolve_data_plan`
- `load_reference_bundle`
- `repair_output`

### 3.3 可以替换

V1 只允许替换“实现”，不允许改节点输入输出契约：

- `resolve_data_plan`
- `fetch_business_context`
- `load_reference_bundle`
- `draft_business_output`
- `validate_output`
- `repair_output`

### 3.4 可以重排

V1 只允许同 phase 内重排，且不能跨过受保护节点。

例如：

- `fetch_business_context` 和 `load_reference_bundle` 可以并行或同阶段调序
- `draft_business_output` 不能被提前到 `normalize_facts` 之前

## 4. 当前模板实例

当前已落地的模板实例：

- [grounded-structured-advisory.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/templates/grounded-structured-advisory.v1.yaml)

这个模板来自当前已经跑通的 `sales-opportunity-advisor` 场景，但抽掉了具体业务差异，保留了下面这类通用结构：

1. 读取请求与运行时上下文
2. 加载 workflow contract
3. 输入校验与权限检查
4. 获取业务上下文
5. 读取参考资产
6. 事实标准化
7. 依据事实草拟结构化业务输出
8. 结构校验与有限修复
9. 最终回包和观察记录

## 5. 当前业务如何映射到模板

### `sales-opportunity-advisor`

当前 helper 场景可以映射为：

- `fetch_business_context`
  - 绑定 `context_fetcher` 角色
  - 当前实现对应 `ContextHelper`
- `load_reference_bundle`
  - 读取字典、规则、schema
- `draft_business_output`
  - 当前由 skill + LLM 完成
- `validate_output`
  - 绑定 `output_validator` 角色
  - 当前实现对应 `ModelTool`

### `sales-opportunity-advisor-directdb`

可复用同一模板，只需把：

- `fetch_business_context`

改绑到 `directdb_runner` 对应的 tool role。

这也正是 `P2-T1` 的完成判定：当前业务应能映射到模板，而不需要复制整条 workflow。

## 6. P6 模板补强结论

阶段 6 的第二业务复用验证说明，当前模板主结构已经足够稳定，后续优先补的是“扩展点说明”和“共享能力护栏”，而不是继续增加业务专用节点。

本轮补强结论见：

- [grounded-structured-advisory.v1.revision-notes.md](/Users/gato-pm/Desktop/API_副本/platform/templates/grounded-structured-advisory.v1.revision-notes.md)

其中一条已经落地到校验器的规则是：

- `BusinessSkill.toolBindings.*.toolRef` 如果绑定了声明 `policy.allowedScenes` 的 tool，则该 allowlist 必须覆盖当前 `scene`

这样可以避免第二业务虽然复用了模板和 tool role，但共享 tool 本身并未授权该 scene 的错配问题。
