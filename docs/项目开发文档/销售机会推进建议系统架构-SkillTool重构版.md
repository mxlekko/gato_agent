# 销售机会推进建议系统架构

## Skill + Tool 当前落地版

本文档描述的是当前已经落地运行的版本，不是未来目标稿。

当前每个 scene 采用同一种结构：

- 1 个主 skill
- 1 个 data tool
- 1 个 model tool
- 多个 reference 文件
- 1 份 scene 配置清单

## 1. 当前场景

目前已落地的 scene 有两个：

1. `sales-opportunity-advisor`
2. `sales-opportunity-advisor-directdb`

两者差异只在 data tool：

- helper scene 走 `ContextHelper`
- directdb scene 走 `DirectDbRunner`

其余结构基本一致。

## 2. 总体架构

### 2.1 对外调用链

`调用方 -> API -> OpenClaw Gateway -> sales-agent -> 主 skill -> data tool -> SQL Server -> 主 skill -> model tool -> API -> 调用方`

### 2.2 当前原则

1. 对外统一入口，调用方只传 `scene` 和 `opportunityId`
2. API 负责桥接，不负责业务清洗
3. 主 skill 负责业务编排、字典读取、字段清洗、建议生成
4. helper service 负责优先读取 skill 中声明的脚本路径；当脚本缺失或 skill 未声明路径时，依据业务定义生成本地查询脚本，并将最终脚本指向写入独立 manifest 后复用，再返回 `rawRow`
5. directdb runner 负责依据 skill 中的 SQL 业务定义生成并缓存参数化 SQL 模板，再返回 `rawRow`
6. model tool 只负责结构化输出校验
7. 字典和规则文件以本地 reference 形式存在
8. scene 通过本地 JSON 配置驱动

## 3. 分层职责总表

| 层级 | 当前角色 | 负责内容 | 不负责内容 |
|---|---|---|---|
| 调用方层 | 外部系统 | 调 API，传 `scene/opportunityId` | 不关心 agent、skill、tool |
| API 层 | 本机 API 服务 | 校验、组装 runtime request、调 Gateway、统一回包 | 不负责业务清洗 |
| Runtime 层 | OpenClaw Gateway | 路由到 `sales-agent` 和独立 session | 不负责业务判断 |
| Agent 层 | `sales-agent` | 承接主 skill | 不直接对外 |
| Skill 层 | 主 skill | 业务编排、字典读取、字段清洗、建议生成、调用 model tool | 不直接管理 DB 实现 |
| Tool 层 | data tool / model tool | `rawRow` 取数、helper 查询脚本生成复用、schema 校验、directdb SQL 模板缓存执行 | 不负责业务建议 |
| Reference 层 | 字典/规则/schema 文件 | 运行时配置和业务依据 | 不直接执行逻辑 |
| Scene 配置层 | scene JSON | 描述每个 scene 的 agent/skill/tools/references/orchestration | 不直接跑业务 |

## 4. 从外部 API 到 Agent 内部的完整链路

### 4.1 调用方 -> API

对外入口：

- `POST /api/agent/run`

请求体：

```json
{
  "scene": "sales-opportunity-advisor",
  "bizParams": {
    "opportunityId": "2041340312877535232"
  }
}
```

API 负责：

1. 校验 `scene`
2. 校验 `opportunityId`
3. 读取对应 scene 配置
4. 生成 `requestId`
5. 生成独立 `sessionKey`
6. 组装 wrapped runtime message
7. 调 Gateway

### 4.2 API -> Gateway

当前正式入口：

- `POST http://127.0.0.1:18789/v1/chat/completions`

固定约束：

- `model = openclaw/sales-agent`
- `x-openclaw-session-key = agent:sales-agent:api:<requestId>`
- `Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>`

message 里会包裹 scene 对应的 request JSON。

### 4.3 Gateway -> 主 skill

Gateway 路由到：

- `sales-agent`

`sales-agent` 再根据：

- request markers
- request kind
- scene

命中对应主 skill。

## 5. 当前主 skill 设计

### 5.1 helper scene 主 skill

文件：

- [sales-opportunity-advisor/SKILL.md](/Users/gato-pm/.openclaw/workspace-sales-agent/skills/sales-opportunity-advisor/SKILL.md)

负责：

1. 解析 request block
2. 保持 helper 查询脚本路径块和查询业务定义块
3. 调 helper data tool
4. 读取本地字典文件
5. 在 skill 内完成字段过滤、字典映射、事实整理
6. 读取业务规则
7. 生成业务 payload
8. 调 model tool 校验
9. 返回 wrapped result

### 5.2 directdb scene 主 skill

文件：

- [sales-opportunity-advisor-directdb/SKILL.md](/Users/gato-pm/.openclaw/workspace-sales-agent/skills/sales-opportunity-advisor-directdb/SKILL.md)

与 helper scene 的差异主要是：

- 调用的 data tool 不同
- DirectDbRunner 会读取此 skill 中的 SQL 业务定义
- DirectDbRunner 首次会生成并缓存参数化 SQL 模板，后续复用；当 skill 文件变化时自动失效

其余业务编排逻辑保持同构。

## 6. 当前 Tool 设计

### 6.1 Data Tool A：ContextHelper

入口：

- `POST http://127.0.0.1:19001/internal/context/sales-opportunity`

输入：

- `requestId`
- `opportunityId`

输出：

- `requestId`
- `opportunityId`
- `rawRow`

补充：

- `ContextHelper` 不接收原生 SQL
- `ContextHelper` 会从当前 helper skill 中读取脚本路径定义和查询业务定义
- 如果 skill 中声明的脚本缺失，或者 skill 没有声明脚本路径，则会生成本地查询脚本并把最终脚本路径写入独立 manifest
- 后续直接复用仍然有效的查询脚本，直到查询业务定义变化

### 6.2 Data Tool B：DirectDbRunner

入口：

- `POST http://127.0.0.1:19002/internal/directdb/sales-opportunity`

输入：

- `requestId`
- `opportunityId`

输出：

- `requestId`
- `opportunityId`
- `rawRow`

### 6.3 Model Tool：ModelTool

入口：

- `POST http://127.0.0.1:19003/internal/model/validate-structured-output`

输入：

- `requestId`
- `scene`
- `payload`
- `schema`

输出：

- `validated payload`

说明：

- 当前 model tool 不负责重新思考业务建议
- 它只负责 schema 校验和轻量规范化

## 7. 当前 Reference 设计

### 7.1 本地字典文件

文件：

- [sales_opportunity_dictionary.tsv](/Users/gato-pm/Desktop/API/metadata/sales_opportunity_dictionary.tsv)

结构：

- `field_name`
- `field_description`

用途：

- 提供字段中文名
- 提供枚举说明
- 提供金额、日期、百分比、忽略规则说明

### 7.2 业务规则文件

文件：

- [decision_rules.md](/Users/gato-pm/.openclaw/workspace-sales-agent/skills/sales-opportunity-advisor/references/decision_rules.md)

### 7.3 输出 schema 文件

文件：

- [output_schema.json](/Users/gato-pm/.openclaw/workspace-sales-agent/skills/sales-opportunity-advisor/references/output_schema.json)

## 8. 当前 Scene 配置设计

每个 scene 对应一份 JSON：

- [sales-opportunity-advisor.json](/Users/gato-pm/Desktop/API/scene-configs/sales-opportunity-advisor.json)
- [sales-opportunity-advisor-directdb.json](/Users/gato-pm/Desktop/API/scene-configs/sales-opportunity-advisor-directdb.json)

当前配置中已经定义：

- agent
- runtime
- skill
- tools
- references
- orchestration

当前 API 会直接读取这些 JSON 并驱动路由。

## 9. 当前收口结论

对当前系统来说，已经收口成下面这个稳定模型：

- scene 决定走哪条业务链
- scene 配置决定当前 agent / skill / tools / references
- 主 skill 负责所有业务编排
- data tool 只管拿 `rawRow`
- model tool 只管 schema 校验
- reference 文件承载字典和规则

这也是后续前台配置最适合承接的结构。
