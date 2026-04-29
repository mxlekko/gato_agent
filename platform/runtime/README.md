# Runtime State

阶段 3 的运行时先统一到一份轻量 state 模型，供兼容节点直接读写。

当前顶层 slice 固定为：

- `request`
- `runtime_context`
- `scene_contract`
- `artifacts`
- `result`
- `error`

其中：

- `request`
  - 保存标准化后的 scene、kind、version、biz_params、raw_request
- `runtime_context`
  - 保存 `request_id`、`trace_id`、`tenant_id`、`user_id`、`permissions`、路由快照和 trace context
- `scene_contract`
  - 保存 scene 配置、agent/runtime/skill/tool/reference 元信息，以及后续 workflow binding 的挂载位
- `artifacts`
  - 保存节点执行记录和兼容运行的中间产物
- `result`
  - 保存最终成功结果
- `error`
  - 保存最终失败结果

当前状态入口文件：

- [state.js](/Users/gato-pm/Desktop/API_副本/platform/runtime/state.js)

当前已提供的运行时辅助方法：

- `createInitialWorkflowState`
- `mergeWorkflowState`
- `recordNodeRun`

当前已提供的 `shadow` 辅助入口：

- [shadow.js](/Users/gato-pm/Desktop/API_副本/platform/runtime/shadow.js)
  - `executeShadowCompatWorkflow`
  - `runLegacyAndShadowCompat`

这样下一步 `legacy-scene-runner` 兼容节点可以直接：

1. 从 `request`、`runtime_context`、`scene_contract` 读取输入
2. 向 `artifacts.node_runs` 写执行记录
3. 向 `result` 或 `error` 写标准结果

同时在 `routing.mode = shadow` 时，运行时可以：

1. 保持正式返回仍来自 `legacy`
2. 旁路执行一份 `langgraph-compat`
3. 记录 shadow state、兼容节点执行结果和新旧差异摘要
