# Scene Configs

本目录承载当前项目的 **scene 配置清单**。

它的作用是把每个 scene 对应的：

- 执行模式
- agent / 直连模型配置
- runtime 契约
- 主 skill
- tools
- references
- orchestration

统一收口成 JSON，供 API 服务运行时读取。

## 1. 当前运行方式

API 会通过 [scene-config.js](/Users/gato-pm/Desktop/API_副本/services/scene-config.js) 在请求时读取本目录下的 `*.json` 文件。

这意味着：

- 新增或修改 scene 配置后，不需要改 API 代码
- 只要 JSON 合法且 `enabled = true`，API 就能识别该 scene

注意：

- scene 配置变更只解决 API 路由问题
- `agent-runtime` scene 对应的 OpenClaw skill、reference 和内部 tool 仍然必须真实存在
- `direct-model` scene 只需要 prompt/schema 等本地 reference 和 provider 配置

## 2. 当前配置结构

每个 scene 一个 JSON 文件，至少包含：

- `scene`
- `enabled`
- `title`
- `description`
- `execution`
- `references`
- `request`

如果 `execution.mode = agent-runtime`，还会包含：

- `agent`
- `runtime`
- `skill`
- `tools`
- `orchestration`

如果 `execution.mode = direct-model`，还会包含：

- `directModel`

## 3. 字段说明

### `scene`

对外暴露给调用方的业务场景标识。

### `enabled`

必须显式为 `true`，否则 API 不会接受该 scene。

### `execution`

定义 scene 的执行方式。

当前支持：

- `agent-runtime`
- `direct-model`

### `agent`

定义 `agent-runtime` scene 归属的 OpenClaw agent。

当前常用字段：

- `id`
- `gatewayModel`
- `sessionKeyPrefix`

### `runtime`

定义 `agent-runtime` scene 的 API -> Gateway -> agent 契约。

当前常用字段：

- `requestKind`
- `messageVersion`
- `responseFormat`

### `skill`

定义 `agent-runtime` scene 对应的主 skill。

当前常用字段：

- `id`
- `type`
- `workspacePath`
- `entryFile`
- `responsibility`

### `tools`

定义 `agent-runtime` scene 绑定的工具列表。

当前项目里的 tool 分两类：

- `data-tool`
- `model-tool`

每个 tool 一般包含：

- `id`
- `type`
- `binding`
- `endpoint`
- `responseContract`
- `params`

### `directModel`

定义 `direct-model` scene 的模型调用方式。

当前常用字段：

- `provider`
- `model`
- `baseUrl`
- `apiKeyEnv`
- `promptFile`
- `schemaReferenceId`
- `timeoutMs`

### `references`

定义当前 scene 运行时依赖的 reference 文件。

当前通常包括：

- 本地字典文件
- 决策规则文件
- 输出 schema 文件

### `orchestration`

定义 `agent-runtime` scene 的编排步骤。

每一步一般包含：

- `order`
- `step`
- `owner`
- `toolId`
- `description`

## 4. 当前文件

- [sales-opportunity-advisor.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor.json)
- [sales-opportunity-advisor-directdb.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor-directdb.json)
- [payment-info-split.json](/Users/gato-pm/Desktop/API_副本/scene-configs/payment-info-split.json)

## 5. 后续前台配置建议

如果后续要做前台配置页，建议直接沿用本目录的 JSON 结构：

1. 前台维护 scene 配置
2. 后端把配置发布为本地 JSON 文件
3. API 运行时直接读取本目录

这样就能保持：

- 前台配置数据结构
- 本地落地文件结构
- API 运行时读取结构

三者一致。

## 6. 并行迁移新增设计态字段：`routing`

为支持“新平台并行路径”迁移，建议后续在 scene 配置中新增设计态字段：

```json
{
  "routing": {
    "mode": "legacy",
    "shadow": {
      "enabled": false,
      "baselineMode": "legacy",
      "candidateMode": "langgraph",
      "recordDiff": true,
      "returnSource": "baseline"
    },
    "fallback": {
      "enabled": true,
      "targetMode": "legacy",
      "on": [
        "graph_compile_failed",
        "graph_timeout",
        "graph_node_failed",
        "tool_transport_failed",
        "llm_transport_failed",
        "graph_invalid_output"
      ],
      "maxPerRequest": 1
    }
  }
}
```

字段说明：

- `routing.mode`
  - scene 主运行模式
  - V1 统一值：
    - `legacy`
    - `shadow`
    - `langgraph`
- `routing.allowedModes`
  - scene 允许被配置成的运行模式白名单
  - 未提供时，交由平台默认约束处理
  - V1 当前建议：
    - `sales-opportunity-advisor`：`legacy / shadow / langgraph`
    - `sales-opportunity-advisor-directdb`：`legacy`
    - `payment-info-split`：`legacy`
- `routing.shadow`
  - 只用于旁路运行，不直接向调用方返回候选结果
- `routing.fallback`
  - 只用于正式模式下的平台内部失败兜底
  - 默认目标是 `legacy`

当前说明：

1. 这套字段目前是设计口径，还不是现有代码已实现功能。
2. 在真正落地前，即使 scene 配置里暂时没有 `routing` 字段，也应按 `mode = legacy` 理解。
3. `INVALID_REQUEST`、`POLICY_DENIED`、`AUTH_FAILED`、`OPPORTUNITY_NOT_FOUND` 这类错误不应触发自动回退。

更完整的定义见：

- [平台运行模式与回退开关设计.md](/Users/gato-pm/Desktop/API_副本/平台运行模式与回退开关设计.md)
