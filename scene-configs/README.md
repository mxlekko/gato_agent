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
- `agent-runtime` scene 通过 Platform Gateway 路由到项目内 LangGraph/runtime，BusinessSkill、references 和 tool binding 必须真实存在
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

定义 `agent-runtime` scene 的项目内 runtime 标识和兼容路由元数据。

当前常用字段：

- `id`
- `gatewayModel`
- `sessionKeyPrefix`

### `runtime`

定义 `agent-runtime` scene 的 API -> LangGraph runtime 契约。

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
- [sales-opportunity-smart-entry.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-smart-entry.json)
- [payment-info-split.json](/Users/gato-pm/Desktop/API_副本/scene-configs/payment-info-split.json)
- [special-custom-product-solution.json](/Users/gato-pm/Desktop/API_副本/scene-configs/special-custom-product-solution.json)

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

## 6. 运行路由字段：`routing`

`routing` 用于描述当前 scene 的运行入口。当前代码口径：

- `agent-runtime` scene 主路径必须走项目内 `langgraph`
- 退役的 `legacy` / `shadow` 只作为历史迁移口径保留，gateway 不再允许 agent-runtime scene 走 OpenClaw legacy 主链路
- `direct-model` scene 在 V1 仍使用 `routing.mode = legacy`，这里的 legacy 表示直连模型的既有执行边界，不表示 OpenClaw Gateway

当前 agent-runtime scene 的目标形态：

```json
{
  "routing": {
    "mode": "langgraph",
    "allowedModes": ["legacy", "shadow", "langgraph"],
    "langgraphCutover": {
      "requestPercentage": 100
    }
  }
}
```

字段说明：

- `routing.mode`
  - scene 主运行模式
  - V1 支持值：
    - `legacy`
    - `shadow`
    - `langgraph`
  - agent-runtime scene 当前必须配置为 `langgraph`
  - direct-model scene 当前保持 `legacy`
- `routing.allowedModes`
  - scene 允许被配置成的运行模式白名单，用于迁移历史和控制台展示
  - 即使白名单保留 `legacy` / `shadow`，agent-runtime gateway 仍会拒绝退役主链路
- `routing.langgraphCutover`
  - 控制 `langgraph` 命中策略
  - 已完成迁移的 agent-runtime scene 应保持 `requestPercentage = 100`

当前说明：

1. `sales-opportunity-advisor`、`sales-opportunity-advisor-directdb`、`sales-opportunity-smart-entry` 已经是 `langgraph` 100%。
2. 项目内 fallback 默认关闭，不会自动回到 OpenClaw agent-runtime。
3. `payment-info-split`、`special-custom-product-solution` 是 direct-model scene，不经过 OpenClaw Gateway。

更完整的定义见：

- [平台运行模式与回退开关设计.md](/Users/gato-pm/Desktop/API_副本/docs/项目开发文档/平台运行模式与回退开关设计.md)
