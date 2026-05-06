---
name: sales-opportunity-advisor-directdb
description: 处理机器格式的销售机会推进建议 directdb 请求。当消息中包含 SALES_OPPORTUNITY_ADVISOR 请求标记且 scene 为 sales-opportunity-advisor-directdb 时，负责完成业务编排：让本地 directdb runner 根据本 skill 中的 SQL 业务定义首次生成或后续复用参数化 SQL 模板，获取原始销售机会数据，再读取本地字典完成字段清洗与映射，最后调用本地 model tool 校验结构化结果并返回 wrapped JSON。
---

# 销售机会推进建议 DirectDB Skill

> Deprecated: 项目内 LangGraph 主链路不再读取此文件；DirectDbRunner 当前读取 `project://references/sales-opportunity-advisor-directdb/sql_definition.md` 作为 SQL 业务定义来源。本文件仅保留为旧运行资产参考。

当当前消息中同时包含以下标记时，使用本 skill：

- `<<<SALES_OPPORTUNITY_ADVISOR_REQUEST_JSON_BEGIN>>>`
- `<<<SALES_OPPORTUNITY_ADVISOR_REQUEST_JSON_END>>>`

并且请求 JSON 中满足：

- `kind = sales_opportunity_advisor_directdb_request`
- `scene = sales-opportunity-advisor-directdb`

这是一个机器到机器的请求。不要进行普通聊天，不要追问，不要在最终 wrapped JSON 结果之外输出任何解释性文本。

## 性能规则

使用**快速路径执行**：

- 工具调用之间不要输出分析文字、事实列表或解释。
- 读取完请求后，立即发起需要的工具调用。
- 工具结果返回后，在内部静默整理候选 payload。
- 然后立刻调用 model tool。
- model tool 成功后，立刻返回最终 wrapped JSON。
- 不要输出类似 `Now I have the data`、`Analysis`、`Key facts`、`The model tool validated successfully` 之类的过程性文字。

## 目标

本 skill 是 directdb 场景下的主业务编排 skill，负责：

1. 读取请求。
2. 定义当前场景的 SQL 业务查询语义。
3. 调用本地 directdb data tool，让 runner 首次生成或后续复用缓存 SQL 模板并获取 `rawRow`。
4. 读取本地字段字典文件。
5. 在本 skill 内完成字段清洗和字段值映射。
6. 应用业务建议规则。
7. 生成最终业务 payload。
8. 调用本地 model tool 校验结构化输出。
9. 仅返回 wrapped JSON。

## 请求契约

消息中包含一个 JSON 数据块，字段要求如下：

- `kind = sales_opportunity_advisor_directdb_request`
- `version = 1.0`
- `requestId`
- `scene = sales-opportunity-advisor-directdb`
- `bizParams.opportunityId`

`bizParams.opportunityId` 可能是大整数对应的字符串。必须保留原值，不要经过 JavaScript number 格式化。

如果请求标记缺失，或者 JSON 不符合上述契约，只返回：

```text
<<<SALES_OPPORTUNITY_ADVISOR_RESULT_JSON_BEGIN>>>
{"success":false,"scene":"sales-opportunity-advisor-directdb","requestId":null,"payload":null,"error":{"code":"INVALID_RUNTIME_MESSAGE","message":"Request JSON block not found in runtime message.","httpStatus":500,"stage":"request-reader","retryable":false,"details":null}}
<<<SALES_OPPORTUNITY_ADVISOR_RESULT_JSON_END>>>
```

## SQL 业务定义

directdb runner 会读取下面这段业务定义，在首次使用时生成一份参数化 SQL 模板并缓存；当本 skill 文件变化时，会自动重新生成。

<<<SQL_BUSINESS_DEFINITION_BEGIN>>>
查询销售机会表 `t_sales_opportunity` 中 `opportunityId` 等于传入参数 `opportunityId` 的单条记录，并返回该记录的全部字段。
SQL 必须使用参数化占位符 `@opportunityId`。
SQL 必须是单条 `SELECT TOP 1` 语句。
不允许联表，不允许子查询，不允许排序，不允许任何写操作。
<<<SQL_BUSINESS_DEFINITION_END>>>

## Tool 1：data tool

directdb data tool 的本地入口是：

`POST http://127.0.0.1:19102/internal/directdb/sales-opportunity`

本场景：

- 不得传递原生 SQL
- 不得由本 skill 自己生成 SQL

runner 负责：

- 读取本 skill 中的 SQL 业务定义
- 首次生成参数化 SQL 模板
- 将 SQL 模板缓存到本地
- 当本 skill 文件变化时自动失效并重建
- 使用缓存 SQL 模板和 `@opportunityId` 执行查询

使用 `exec` 工具时，使用下面这种固定模式：

```bash
curl -sS -X POST http://127.0.0.1:19102/internal/directdb/sales-opportunity \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"<REQUEST_ID>","opportunityId":"<OPPORTUNITY_ID>"}'
```

规则：

- data tool 只允许访问本机，不得访问任何非 loopback 地址。
- 本场景不得调用 helper endpoint。
- 本 skill 中不得生成或执行原生 SQL。
- runner 才是 SQL 生成、缓存和执行的拥有者。
- data tool 只返回 `data.rawRow`。
- 不要期待返回 `data.profile` 或 `data.facts`。

## 本地字段字典文件

本场景使用独立维护的本地 TSV 字典文件：

`/Users/gato-pm/Desktop/API_副本/metadata/sales_opportunity_advisor_directdb_dictionary.tsv`

需要时通过 `exec` 工具直接读取，例如：

```bash
cat /Users/gato-pm/Desktop/API_副本/metadata/sales_opportunity_advisor_directdb_dictionary.tsv
```

尽量直接读取本地文件，不要增加不必要的 shell 包装。

对 `field_description` 的解释规则如下：

- 第一个 `；` 之前的内容视为字段中文名。
- 如果包含 `处理：忽略`，则该字段在事实整理时应忽略。
- 如果包含 `类型：enum` 且包含 `枚举：`，则按枚举说明把原始值映射成中文值。
- 如果包含 `类型：money`，则格式化为可读金额，例如 `15,000元`。
- 如果包含 `类型：percent`，则格式化为可读百分比，例如 `50%`。
- 如果包含 `类型：date` 或 `类型：datetime`，保留具体日期或时间，不要转成相对时间。
- 如果包含 `优先级：<N>`，优先把该字段作为建议判断依据。
- 如果字典中没有该字段，则使用原始字段名作为 label，原始值作为文本，不要臆造枚举映射。

## 业务起草提示词文件

平台可编辑提示词文件位于：

`/Users/gato-pm/Desktop/API_副本/platform/assets/prompts/sales-opportunity-advisor-directdb.draft-business-output.v1.md`

在草拟最终业务 payload 前，先读取该文件，并按其中字段目标与输出要求生成 payload。

## Tool 2：model tool

使用与 helper 场景相同的本地 model tool：

`POST http://127.0.0.1:19003/internal/model/validate-structured-output`

它负责对最终候选 payload 做 schema 校验和轻量规范化。

输出 schema 文件位于：

`/Users/gato-pm/Desktop/API_副本/references/sales-opportunity-advisor/output_schema.json`

在草拟完候选 payload 后，使用 `exec` 工具按下面这种固定模式调用：

```bash
curl -sS -X POST http://127.0.0.1:19003/internal/model/validate-structured-output \
  -H 'Content-Type: application/json' \
  -d '<MODEL_TOOL_REQUEST_JSON>'
```

其中 `<MODEL_TOOL_REQUEST_JSON>` 需要包含：

- `requestId`
- `scene = sales-opportunity-advisor-directdb`
- `payload = <你草拟的业务 payload>`
- `schema = <output_schema.json 中的 JSON schema>`

如果 model tool 返回 `success=false`：

1. 读取它的错误信息。
2. 在内部修复 payload 一次。
3. 再调用一次 model tool。
4. 如果第二次仍然失败，则把同样的错误对象放进最终 wrapped result 中返回。

## 执行步骤

1. 提取请求标记之间的 JSON 数据块。
2. 解析 JSON，并校验 `kind`、`version`、`scene`、`bizParams.opportunityId`。
3. 保持本 skill 中的 SQL 业务定义与真实查询意图一致。
4. 调用 directdb data tool，并传入 `requestId` 和 `opportunityId`。
5. 解析 data tool 的 JSON 响应。
6. 如果 data tool 返回 `success=false`，则把同样的错误对象直接透传到最终 wrapped result 中。
7. 从 data tool 响应中读取 `data.rawRow`。这是唯一的原始事实来源。
8. 读取本地字段字典 TSV 文件。
9. 在内部构建清洗后的事实集合：
   - 忽略空值
   - 忽略标记了 `处理：忽略` 的字段
   - 对字典中带 `枚举：` 的字段做中文映射
   - 对金额和百分比做格式化
   - 保留简洁的 `factText`，例如 `销售阶段：未判定`
10. 在内部构建一个紧凑的 `profile`，优先关注：
   - `opportunityName`
   - `customerName`
   - `salesStage`
   - `opportunityStatus`
   - `businessType`
   - `amount`
   - `budgetConfirmed`
   - `predictTenderDate`
11. 读取并应用 `/Users/gato-pm/Desktop/API_副本/references/sales-opportunity-advisor/decision_rules.md` 中的业务规则。
12. 读取并应用 `/Users/gato-pm/Desktop/API_副本/platform/assets/prompts/sales-opportunity-advisor-directdb.draft-business-output.v1.md`。
13. 草拟最终业务 payload，字段以提示词文件与 output schema 为准，至少包含：
    - `opportunityId`
    - `summary`
    - `adviceText`
    - `nextActions`
14. 读取 `/Users/gato-pm/Desktop/API_副本/references/sales-opportunity-advisor/output_schema.json`。
15. 调用本地 model tool 校验草拟的 payload。
16. 如果 model tool 返回成功，则使用 `data.payload` 作为最终 payload。
17. 最终只返回 wrapped JSON 结果块。

执行捷径：

- 第一步助手动作里，可以把 directdb data tool 调用、字典读取、规则文件读取、schema 读取一起批量完成。
- 第二步助手动作里，不要解释推理过程，直接调用 model tool。
- 最后一步只输出 wrapped JSON 结果块。

## 输出契约

最终输出必须只包含一个 wrapped result block：

```text
<<<SALES_OPPORTUNITY_ADVISOR_RESULT_JSON_BEGIN>>>
{"success":true,"scene":"sales-opportunity-advisor-directdb","requestId":"req_xxx","payload":{"opportunityId":"2041340312877535232","summary":"...","adviceText":"...","nextActions":["..."]},"error":null}
<<<SALES_OPPORTUNITY_ADVISOR_RESULT_JSON_END>>>
```

规则：

- 在结果块前后不要输出任何多余文字。
- `payload.opportunityId` 必须与传入请求值完全一致。
- `nextActions` 必须是 `3` 到 `5` 条可执行动作。
- `summary` 和 `adviceText` 必须严格基于 `rawRow` 事实。
- 不要编造不存在的字段。
- 如果字典里有中文枚举映射，不要输出类似 `销售阶段4`、`状态1` 这种原始编码。
- 如果存在 `predictTenderDate`，优先提到具体日期，而不是只说 `临近投标`。
- `summary` 要简洁聚焦事实；`adviceText` 要聚焦主要推进策略。

## 错误透传

如果 data tool 或 model tool 返回：

```json
{
  "success": false,
  "requestId": "req_xxx",
  "data": null,
  "error": { "...": "..." }
}
```

那么最终返回：

```text
<<<SALES_OPPORTUNITY_ADVISOR_RESULT_JSON_BEGIN>>>
{"success":false,"scene":"sales-opportunity-advisor-directdb","requestId":"req_xxx","payload":null,"error":{...tool_error_object...}}
<<<SALES_OPPORTUNITY_ADVISOR_RESULT_JSON_END>>>
```

## 事实关注提示

当 `rawRow` 中存在以下字段时，通常值得重点关注：

- `opportunityName`
- `customerName`
- `salesStage`
- `opportunityStatus`
- `businessType`
- `amount`
- `budgetConfirmed`
- `predictTenderDate`
- `competitor`
- `customerPainPoint`
- `winRate`
- `tenderType`
- `tenderStatus`
- `canControlBid`
- `customerConcern`
- `latestFollowTime`

建议关注提示：

- 如果 `budgetConfirmed = 0`，至少有一条 `nextActions` 要明确处理预算确认问题。
- 如果存在 `predictTenderDate`，至少有一条 `nextActions` 要明确围绕该日期倒排推进。
- 如果存在 `competitor`，至少有一条 `nextActions` 要明确处理竞争策略。
- 如果存在 `customerPainPoint`，则 `adviceText` 或某条 `nextActions` 要直接回应这个痛点。
- 如果 `opportunityStatus = 2` 或 `3`，要调整建议方向，不要假装机会仍处于正常推进中。

## 内部工作方法

在输出最终 JSON 前，内部按以下方式处理：

1. 基于 `rawRow` 和本地 TSV 字典静默整理映射后的事实。
2. 只选出真正决定建议方向的少数字段。
3. 应用 `/Users/gato-pm/Desktop/API_副本/references/sales-opportunity-advisor/decision_rules.md` 中匹配的阶段、状态、预算、招标、竞争规则。
4. 静默草拟业务 payload。
5. 使用本地 model tool 做校验。
6. 然后只输出最终 wrapped JSON。
