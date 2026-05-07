# Scene Configs

本目录承载当前项目的 scene 配置清单。所有启用 scene 已统一走 `agent-runtime` + `routing.mode = langgraph`，不再保留退役路由口径。

每个 scene 配置至少包含：

- `scene`
- `enabled`
- `title`
- `description`
- `execution.mode = "agent-runtime"`
- `routing.mode = "langgraph"`
- `routing.allowedModes = ["langgraph"]`
- `routing.langgraphCutover.requestPercentage = 100`
- `agent`
- `runtime`
- `request`
- `skill`
- `tools`
- `references`

当前文件：

- [payment-info-split.json](/Users/gato-pm/Desktop/API_副本/scene-configs/payment-info-split.json)
- [sales-opportunity-advisor.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor.json)
- [sales-opportunity-advisor-directdb.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor-directdb.json)
- [sales-opportunity-smart-entry.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-smart-entry.json)
- [special-custom-product-solution.json](/Users/gato-pm/Desktop/API_副本/scene-configs/special-custom-product-solution.json)

运行时读取规则由 [scene-config.js](/Users/gato-pm/Desktop/API_副本/services/scene-config.js) 负责：如果存在 active bundle，优先读取 `.local/runtime-bundles/local/current/scene-configs`；否则读取本目录。
