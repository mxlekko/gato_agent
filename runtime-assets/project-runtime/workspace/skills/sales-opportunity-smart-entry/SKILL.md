---
name: sales-opportunity-smart-entry
description: 处理机器格式的销售机会智能录入请求。当消息中包含 SALES_OPPORTUNITY_SMART_ENTRY 请求标记且 scene 为 sales-opportunity-smart-entry 时，负责完成业务编排：调用本地通用查询执行器获取当前销售机会全字段，读取本地字典文件完成字段清洗与映射，再结合 rawText 输出按销售场景裁剪的结构化字段结果，最后只返回 wrapped JSON。
metadata: {"runtime":{"requires":{"bins":["curl","cat"]},"os":["darwin"]}}
---

# 销售机会智能录入 Skill

当当前消息中同时包含以下标记时，使用本 skill：

- `<<<SALES_OPPORTUNITY_SMART_ENTRY_REQUEST_JSON_BEGIN>>>`
- `<<<SALES_OPPORTUNITY_SMART_ENTRY_REQUEST_JSON_END>>>`

并且请求 JSON 中满足：

- `kind = sales_opportunity_smart_entry_request`
- `scene = sales-opportunity-smart-entry`

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

本 skill 是销售机会智能录入场景下的主业务编排 skill，负责：

1. 读取请求。
2. 调用本地 data tool 获取 `rawRow`。
3. 读取本地字段字典文件。
4. 在本 skill 内完成字段清洗和字段值映射。
5. 应用字段更新规则。
6. 生成最终业务 payload。
7. 调用本地 model tool 校验结构化输出。
8. 仅返回 wrapped JSON。

## 请求契约

消息中包含一个 JSON 数据块，字段要求如下：

- `kind = sales_opportunity_smart_entry_request`
- `version = 1.0`
- `requestId`
- `scene = sales-opportunity-smart-entry`
- `bizParams.opportunityId`
- `bizParams.rawText`

`bizParams.opportunityId` 可能是大整数对应的字符串。必须保留原值，不要经过 JavaScript number 格式化。
`bizParams.rawText` 是本次用户希望更新当前机会字段的自然语言文本，应作为“对当前机会底稿的修改指令”处理。

如果请求标记缺失，或者 JSON 不符合上述契约，只返回：

```text
<<<SALES_OPPORTUNITY_SMART_ENTRY_RESULT_JSON_BEGIN>>>
{"success":false,"scene":"sales-opportunity-smart-entry","requestId":null,"payload":null,"error":{"code":"INVALID_RUNTIME_MESSAGE","message":"Request JSON block not found in runtime message.","httpStatus":500,"stage":"request-reader","retryable":false,"details":null}}
<<<SALES_OPPORTUNITY_SMART_ENTRY_RESULT_JSON_END>>>
```

## Tool 1：data tool

## 查询服务脚本路径

helper 查询服务会优先读取下面这段脚本路径定义。

- 如果 skill 中声明了脚本路径，并且该路径下脚本存在，则直接复用该脚本。
- 如果 skill 中声明了脚本路径，但该路径下脚本不存在，则 helper 服务必须根据后面的业务定义调用大模型生成执行脚本，并写回这个路径。
- 如果 skill 中没有声明脚本路径，则 helper 服务必须根据后面的业务定义调用大模型生成执行脚本，并使用 helper 自己管理的默认路径登记和复用。

<<<CONTEXT_HELPER_QUERY_SCRIPT_PATH_BEGIN>>>
project://ContextHelper/generated-queries/sales-opportunity-smart-entry.generated.js
<<<CONTEXT_HELPER_QUERY_SCRIPT_PATH_END>>>

## 查询服务业务定义

helper 查询服务必须读取下面这段业务定义，并根据这段业务定义生成或校验执行脚本中的查询逻辑。

脚本指向清单路径是：

`project://ContextHelper/generated-queries/manifest.json`

执行规则如下：

1. 先读取 skill 中的脚本路径定义。
2. 如果 skill 中声明了脚本路径，则检查该路径下脚本是否存在。
3. 如果脚本不存在，或者 skill 中没有声明脚本路径，则调用大模型根据下面这段业务定义生成查询执行脚本。
4. 生成完成后，把最终使用的脚本路径和业务定义哈希写入 `manifest.json`。
5. 后续请求优先复用 skill 中声明且仍然有效的脚本；如果 skill 未声明路径，则复用 helper 已登记且仍然有效的脚本。
6. 如果下面这段业务定义发生变化，则旧脚本失效，重新生成脚本并更新 `manifest.json`。

<<<CONTEXT_HELPER_QUERY_DEFINITION_BEGIN>>>
查询销售机会表 `t_sales_opportunity` 中 `opportunityId` 等于传入参数 `opportunityId` 的单条记录，并返回该记录的全部字段。
查询服务脚本必须使用参数化占位符 `@opportunityId`。
查询服务脚本只允许执行单条 `SELECT TOP 1` 语句。
不允许联表，不允许子查询，不允许排序，不允许任何写操作。
<<<CONTEXT_HELPER_QUERY_DEFINITION_END>>>

## Query service script pointer

<<<CONTEXT_HELPER_QUERY_FILE_POINTER_BEGIN>>>
{
  "path": "project://ContextHelper/generated-queries/sales-opportunity-smart-entry.generated.js",
  "definitionHash": "ca345fd3cc7615b5925a67c9ceff112418c25a1ff6bf955a1075dd6503a462ce",
  "generatedAt": "2026-04-10T06:49:43.474Z"
}
<<<CONTEXT_HELPER_QUERY_FILE_POINTER_END>>>

通用查询执行器的本地入口是：

`POST http://127.0.0.1:3100/internal/query/execute`

使用 `exec` 工具时，使用下面这种固定模式：

```bash
curl -sS -X POST http://127.0.0.1:3100/internal/query/execute \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"<REQUEST_ID>","queryProfileRef":"query://sales-opportunity-smart-entry/by-opportunity-id@v1","opportunityId":"<OPPORTUNITY_ID>"}'
```

规则：

- data tool 只允许访问本机，不得访问任何非 loopback 地址。
- 通用查询执行器负责按 QueryProfile 执行受控参数化查询。
- 本 skill 不得向查询服务传递原生 SQL。
- data tool 只返回 `data.rawRow`。
- 不要期待返回 `data.profile` 或 `data.facts`。

## 本地字段字典文件

本场景使用的字段字典文件是：

`project://metadata/sales_opportunity_smart_entry_dictionary.tsv`

需要时通过 `exec` 工具直接读取，例如：

```bash
cat project://metadata/sales_opportunity_smart_entry_dictionary.tsv
```

尽量直接读取本地文件，不要增加不必要的 shell 包装。

这个字典文件只有两列：

- `field_name`
- `field_description`

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

`project://platform/assets/prompts/sales-opportunity-smart-entry.draft-business-output.v1.md`

在草拟最终业务 payload 前，先读取该文件，并按其中字段目标与输出要求生成 payload。

## Tool 2：model tool

本地 model tool 入口是：

`POST http://127.0.0.1:19003/internal/model/validate-structured-output`

它的职责不是替你重新发明业务结果，而是对你草拟的最终 payload 做 schema 校验和轻量规范化。

输出 schema 文件位于：

`project://runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/references/output_schema.json`

在草拟完候选 payload 后，使用 `exec` 工具按下面这种固定模式调用：

```bash
curl -sS -X POST http://127.0.0.1:19003/internal/model/validate-structured-output \
  -H 'Content-Type: application/json' \
  -d '<MODEL_TOOL_REQUEST_JSON>'
```

其中 `<MODEL_TOOL_REQUEST_JSON>` 需要包含：

- `requestId`
- `scene = sales-opportunity-smart-entry`
- `payload = <你草拟的业务 payload>`
- `schema = <output_schema.json 中的 JSON schema>`

如果 model tool 返回 `success=false`：

1. 读取它的错误信息。
2. 在内部修复 payload 一次。
3. 再调用一次 model tool。
4. 如果第二次仍然失败，则把同样的错误对象放进最终 wrapped result 中返回。

## 执行步骤

1. 提取请求标记之间的 JSON 数据块。
2. 解析 JSON，并校验 `kind`、`version`、`scene`、`bizParams.opportunityId`、`bizParams.rawText`。
3. 调用通用查询执行器。
4. 解析查询服务的 JSON 响应。
5. 如果查询服务返回 `success=false`，则把同样的错误对象直接透传到最终 wrapped result 中。
6. 从查询服务响应中读取 `data.rawRow`。这是唯一的原始事实来源。
7. 读取本地字段字典 TSV 文件。
8. 在内部构建清洗后的事实集合：
   - 忽略空值
   - 忽略标记了 `处理：忽略` 的字段
   - 对字典中带 `枚举：` 的字段做中文映射
   - 对金额和百分比做格式化
   - 保留简洁的 `factText`，例如 `销售阶段：未判定`
9. 在内部构建一个可供模型直接理解的当前机会事实视图，至少保留：
   - 当前机会所有可用字段的字段名、中文标签、格式化后的值
   - `salesScene`
   - `opportunityId`
   - 可用于判断当前场景字段范围的字段集合
10. 读取并应用 `{baseDir}/references/decision_rules.md` 中的字段更新约束。
11. 读取并应用 `project://platform/assets/prompts/sales-opportunity-smart-entry.draft-business-output.v1.md`。
12. 草拟最终业务 payload，字段以提示词文件与 output schema 为准，至少包含：
    - `opportunityId`
    - `salesScene`
    - `data`
13. 读取 `project://runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/references/output_schema.json`。
14. 调用本地 model tool 校验草拟的 payload。
15. 如果 model tool 返回成功，则使用 `data.payload` 作为最终 payload。
16. 最终只返回 wrapped JSON 结果块。

执行捷径：

- 第一步助手动作里，可以把查询服务调用、字典读取、规则文件读取、schema 读取一起批量完成。
- 第二步助手动作里，不要解释推理过程，直接调用 model tool。
- 最后一步只输出 wrapped JSON 结果块。

## 输出契约

最终输出必须只包含一个 wrapped result block：

```text
<<<SALES_OPPORTUNITY_SMART_ENTRY_RESULT_JSON_BEGIN>>>
{"success":true,"scene":"sales-opportunity-smart-entry","requestId":"req_xxx","payload":{"opportunityId":"2041340312877535232","salesScene":"tenderDesigned","data":{"opportunityName":"...","customerName":"...","integratorCoverage":"...","canControlBid":"..."}},"error":null}
<<<SALES_OPPORTUNITY_SMART_ENTRY_RESULT_JSON_END>>>
```

规则：

- 在结果块前后不要输出任何多余文字。
- `payload.opportunityId` 必须与传入请求值完全一致。
- `payload.salesScene` 必须根据当前机会事实识别。
- `payload.data` 必须只输出“基础字段 + 当前 salesScene 对应字段”。
- `payload.data` 中如果 `rawText` 明确修改了某个字段，必须输出修改后的最新值。
- `payload.data` 中如果 `rawText` 未涉及某个字段，应保留当前机会原值。
- 不要编造不存在的字段。
- 如果字典里有中文枚举映射，不要输出类似 `销售阶段4`、`状态1` 这种原始编码。
- 如果存在 `predictTenderDate`、`tenderTime`、`bidTime`、`purchaseTime`，优先输出具体日期。
- JSON 键名必须使用表字段名，不要输出中文展示名。

## 错误透传

如果查询服务或 model tool 返回：

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
<<<SALES_OPPORTUNITY_SMART_ENTRY_RESULT_JSON_BEGIN>>>
{"success":false,"scene":"sales-opportunity-smart-entry","requestId":"req_xxx","payload":null,"error":{...tool_error_object...}}
<<<SALES_OPPORTUNITY_SMART_ENTRY_RESULT_JSON_END>>>
```

## 事实关注提示

当 `rawRow` 中存在以下字段时，通常值得重点关注：

- `opportunityName`
- `customerName`
- `salesScene`
- `amount`
- `predictTenderDate`
- `tenderType`
- `projectBudgetAndSchedule`
- `canControlBid`
- `productShare`
- `integratorCoverage`
- `competitorSituation`
- `tenderTime`
- `bidTime`
- `purchaseTime`

建议关注提示：

- 如果 `rawText` 明确表示“修改/更新/更正/补充”某个字段，最终输出必须反映该字段的新值。
- 如果 `rawText` 没有涉及某个字段，优先保留当前机会已有值。
- 如果当前 `salesScene` 已确定，最终输出必须只包含基础字段和该场景对应字段。
- 如果时间类字段能从当前事实或 `rawText` 中明确识别，优先输出具体日期。
- 如果字段无法稳定判断，保留原值；原值也为空时可输出空字符串，但不要臆造内容。

## 内部工作方法

在输出最终 JSON 前，内部按以下方式处理：

1. 基于 `rawRow` 和本地 TSV 字典静默整理映射后的事实。
2. 识别当前机会所属 `salesScene`，并确定“基础字段 + 场景字段”的输出范围。
3. 应用 `{baseDir}/references/decision_rules.md` 中的字段更新约束。
4. 静默草拟业务 payload。
5. 使用本地 model tool 做校验。
6. 然后只输出最终 wrapped JSON。
