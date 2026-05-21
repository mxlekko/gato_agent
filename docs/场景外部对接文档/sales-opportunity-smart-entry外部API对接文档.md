# `sales-opportunity-smart-entry` 外部 API 对接文档

## 1. 接口概述

该接口用于根据销售机会 ID 查询当前销售机会数据，并结合一段自然语言录入文本，生成“应用本次录入内容后的销售机会结构化字段结果”。

当前场景标识固定为 `sales-opportunity-smart-entry`，通过统一业务入口 `POST /api/agent/run` 调用。

说明：

- 这是一个同步接口
- 请求成功时 HTTP 状态码固定为 `200`
- 接口会先按 `opportunityId` 查询当前销售机会记录
- 接口只返回结构化字段结果，不会直接写入或更新数据库
- 如果 `opportunityId` 对应记录不存在，会返回 HTTP `404`

## 2. 请求地址

```text
POST /api/agent/run
Content-Type: application/json
```

联调示例：

```text
http://192.168.9.163/api/agent/run
```

当前文档中的联调地址按 Docker 生产部署内网入口编写；外部请求走 `80` 端口的 Nginx `/api/` 代理，不需要额外加 `:3100`。如果后续网关地址变化，请统一替换为新的内网服务地址。

## 3. 请求参数

### 3.1 请求体

```json
{
  "scene": "sales-opportunity-smart-entry",
  "bizParams": {
    "opportunityId": "2052956605598666752",
    "rawText": "客户本周反馈预算已确认，预计下周安排技术评审，采购时间调整到2026-06-30。"
  }
}
```

可选传入运行上下文：

```json
{
  "scene": "sales-opportunity-smart-entry",
  "bizParams": {
    "opportunityId": "2052956605598666752",
    "rawText": "客户本周反馈预算已确认，预计下周安排技术评审，采购时间调整到2026-06-30。"
  },
  "runtimeContext": {
    "tenantId": "tenant-a",
    "userId": "user-a"
  }
}
```

### 3.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `scene` | `string` | 是 | 固定传 `sales-opportunity-smart-entry` |
| `bizParams` | `object` | 是 | 业务入参对象 |
| `bizParams.opportunityId` | `string \| integer` | 是 | 销售机会业务 ID；建议始终按字符串传入，避免大整数精度丢失 |
| `bizParams.rawText` | `string` | 是 | 本次智能录入的自然语言文本，服务端会自动去掉首尾空格，最大长度 `8000` |
| `runtimeContext` | `object` | 否 | 运行上下文 |
| `runtimeContext.tenantId` | `string` | 否 | 租户标识；传入时必须是字符串 |
| `runtimeContext.userId` | `string` | 否 | 用户标识；传入时必须是字符串 |

### 3.3 入参约束

- `scene` 只能是 `sales-opportunity-smart-entry`
- `bizParams.opportunityId` 可以是字符串或整数
- 大号雪花 ID 必须按字符串传入，避免 JavaScript 数字精度丢失
- `bizParams.opportunityId` 去首尾空格后不能为空
- `bizParams.rawText` 必须是字符串
- `bizParams.rawText` 去首尾空格后不能为空
- `bizParams.rawText` 最大长度不能超过 `8000`

## 4. 处理规则

接口处理顺序如下：

1. 校验 `scene`、`bizParams.opportunityId` 和 `bizParams.rawText`
2. 按 `opportunityId` 查询 `t_sales_opportunity` 单条销售机会记录
3. 根据当前机会事实识别 `salesScene`
4. 将查询结果视为修改前底稿，将 `rawText` 视为本次增量修改内容
5. 输出当前 `salesScene` 允许的结构化字段结果
6. 对结果做 schema 校验后返回

字段更新规则：

- 如果 `rawText` 明确修改某个字段，返回更新后的字段值
- 如果 `rawText` 没有提到某个字段，默认保留当前机会已有值
- 如果当前值为空，且 `rawText` 也不能稳定判断，则字段保持为空或不返回
- 如果 `rawText` 与当前值冲突，优先采用 `rawText` 中明确表达的新值
- 如果 `rawText` 表达含糊，不做猜测，优先保留当前值

## 5. 成功响应

### 5.1 响应体结构

注意：外层 `data` 是统一响应 envelope 的业务数据字段；内层 `data.data` 是本场景返回的销售机会字段对象。

```json
{
  "success": true,
  "requestId": "req_20260519_130000000_abcd1234",
  "data": {
    "opportunityId": "2052956605598666752",
    "salesScene": "noTender",
    "data": {
      "opportunityName": "上海某某项目",
      "tenderType": 3,
      "ownerName": "张三",
      "customerName": "上海某某科技有限公司",
      "industry": "education",
      "smartContacts": "[{\"name\":\"李四\",\"role\":\"技术负责人\"}]",
      "productCategory": "网络设备",
      "amount": "500000",
      "discountRate": "9折",
      "predictCloseDate": "2026-06-30",
      "predictTenderDate": "",
      "projectBudgetAndSchedule": "预算已确认，预计下周安排技术评审。",
      "projectReasonAndStandard": "",
      "competitorSituation": "",
      "integratorKeyPerson": "",
      "purchaseTime": "2026-06-30"
    }
  },
  "error": null
}
```

### 5.2 返回字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `success` | `boolean` | 成功时固定为 `true` |
| `requestId` | `string` | 平台生成的请求唯一标识，建议调用方记录 |
| `data.opportunityId` | `string \| number` | 销售机会业务 ID，通常与请求中的 `bizParams.opportunityId` 一致 |
| `data.salesScene` | `string` | 系统根据当前机会事实识别出的销售场景 |
| `data.data` | `object` | 当前销售场景下的结构化字段对象 |
| `error` | `null` | 成功时固定为 `null` |

### 5.3 `salesScene` 取值

| 取值 | 含义 |
| --- | --- |
| `tenderNoDesign` | 招标未设计 |
| `tenderDesigned` | 招标已设计 |
| `noTender` | 不招标 |
| `smallProject` | 小项目 |
| `designInstitute` | 设计院 |

调用方不需要在请求中传 `salesScene`，服务端会根据当前销售机会事实识别。

### 5.4 `data.data` 基础字段

以下字段为所有销售场景通用的基础字段。字段是否有值取决于当前机会数据和 `rawText` 内容。

| 字段 | 类型 | 最大长度 | 说明 |
| --- | --- | --- | --- |
| `opportunityName` | `string` | `200` | 机会名称 |
| `tenderType` | `string \| number` | - | 招标类型；常见编码：`1` 公开招标、`2` 邀标、`3` 不招标 |
| `ownerName` | `string` | `100` | 负责人姓名 |
| `customerName` | `string` | `200` | 客户名称 |
| `industry` | `string` | `100` | 行业编码或行业值 |
| `smartContacts` | `string` | `4000` | 智能录入联系人；如有联系人结果，通常是 JSON 数组字符串 |
| `productCategory` | `string` | `200` | 产品品类 |
| `amount` | `string \| number` | - | 预计合同金额 |
| `discountRate` | `string` | `50` | 折扣率 |
| `predictCloseDate` | `string` | `30` | 预计成交日期，建议按 `YYYY-MM-DD` 理解 |
| `predictTenderDate` | `string` | `30` | 预计开标日期，建议按 `YYYY-MM-DD` 理解 |

### 5.5 `data.data` 场景字段

不同 `salesScene` 会在基础字段之外返回对应场景字段。

| `salesScene` | 可返回的场景字段 |
| --- | --- |
| `tenderNoDesign` | `projectBudgetAndSchedule`, `projectReasonAndStandard`, `integratorCoverage`, `integratorInfluence`, `competitorSituation`, `tenderFlowAndKeyPerson`, `integratorKeyPerson`, `tenderBlueprintDate`, `tenderTime`, `bidTime`, `purchaseTime` |
| `tenderDesigned` | `integratorCoverage`, `integratorInfluence`, `competitorSituation`, `integratorKeyPerson`, `canControlBid`, `productShare`, `tenderTime`, `bidTime`, `purchaseTime` |
| `noTender` | `projectBudgetAndSchedule`, `projectReasonAndStandard`, `competitorSituation`, `integratorKeyPerson`, `purchaseTime` |
| `smallProject` | `projectBudgetAndSchedule`, `projectReasonAndStandard`, `competitorSituation`, `integratorKeyPerson`, `purchaseTime` |
| `designInstitute` | 当前无明确场景专属字段，通常只返回基础字段 |

场景字段说明：

| 字段 | 类型 | 最大长度 | 说明 |
| --- | --- | --- | --- |
| `projectBudgetAndSchedule` | `string` | `2000` | 项目预算及进度说明 |
| `projectReasonAndStandard` | `string` | `2000` | 立项原因及标准说明 |
| `integratorCoverage` | `string` | `100` | 集成商控制力；常见编码：`strong`, `medium`, `weak`, `pending` |
| `integratorInfluence` | `string` | `2000` | 其他集成商影响说明 |
| `competitorSituation` | `string` | `2000` | 竞争对手情况 |
| `tenderFlowAndKeyPerson` | `string` | `2000` | 招标流程及关键人说明 |
| `integratorKeyPerson` | `string` | `2000` | 集成商关键人说明 |
| `tenderBlueprintDate` | `string` | `30` | 设计蓝图日期，建议按 `YYYY-MM-DD` 理解 |
| `tenderTime` | `string` | `30` | 投标时间，建议按 `YYYY-MM-DD` 理解 |
| `bidTime` | `string` | `30` | 开标时间，建议按 `YYYY-MM-DD` 理解 |
| `purchaseTime` | `string` | `30` | 采购时间，建议按 `YYYY-MM-DD` 理解 |
| `canControlBid` | `string` | `100` | 推荐品牌能否替换；常见编码：`replaceable`, `partialReplaceable`, `nonReplaceable`, `pending` |
| `productShare` | `string` | `100` | 核心参数是否满足；常见编码：`satisfied`, `partiallySatisfied`, `notSatisfied`, `pending` |

## 6. 失败响应

### 6.1 统一失败结构

```json
{
  "success": false,
  "requestId": "req_20260519_130000001_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.rawText is required.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": null
  }
}
```

### 6.2 失败字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `success` | `boolean` | 失败时固定为 `false` |
| `requestId` | `string \| null` | 平台请求 ID；大多数业务请求都会返回该值 |
| `data` | `null` | 失败时固定为 `null` |
| `error.code` | `string` | 错误码 |
| `error.message` | `string` | 可直接用于排查的问题描述 |
| `error.httpStatus` | `number` | 对应 HTTP 状态码 |
| `error.stage` | `string` | 错误发生阶段 |
| `error.retryable` | `boolean` | 是否建议重试 |
| `error.details` | `object \| null` | 补充排查信息 |

### 6.3 常见错误场景

#### 1) `opportunityId` 缺失

HTTP `400`

```json
{
  "success": false,
  "requestId": "req_20260519_130000002_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.opportunityId is required.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": null
  }
}
```

#### 2) `opportunityId` 为空字符串

HTTP `400`

```json
{
  "success": false,
  "requestId": "req_20260519_130000003_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.opportunityId must not be empty.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": null
  }
}
```

#### 3) `rawText` 缺失

HTTP `400`

```json
{
  "success": false,
  "requestId": "req_20260519_130000004_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.rawText is required.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": null
  }
}
```

#### 4) `rawText` 不是字符串

HTTP `400`

```json
{
  "success": false,
  "requestId": "req_20260519_130000005_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.rawText must be a string.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": null
  }
}
```

#### 5) `rawText` 为空字符串

HTTP `400`

```json
{
  "success": false,
  "requestId": "req_20260519_130000006_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.rawText must not be empty.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": null
  }
}
```

#### 6) `rawText` 超长

HTTP `400`

```json
{
  "success": false,
  "requestId": "req_20260519_130000007_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.rawText is too long.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": {
      "fieldName": "bizParams.rawText",
      "maxLength": 8000
    }
  }
}
```

#### 7) `opportunityId` 对应记录不存在

HTTP `404`

```json
{
  "success": false,
  "requestId": "req_20260519_125357238_10973d9f",
  "data": null,
  "error": {
    "code": "OPPORTUNITY_NOT_FOUND",
    "message": "未查询到符合条件的数据记录。",
    "httpStatus": 404,
    "stage": "context-query",
    "retryable": false,
    "details": null
  }
}
```

#### 8) 查询、模型或结构校验失败

可能返回：

- HTTP `502`
- 错误码 `CONTEXT_SERVICE_UNAVAILABLE`
- 错误码 `CONTEXT_SERVICE_INVALID_RESPONSE`
- 错误码 `CONTEXT_QUERY_FAILED`
- 错误码 `MODEL_INVOCATION_FAILED`
- 错误码 `INVALID_MODEL_OUTPUT`
- 错误码 `MODEL_INVALID_JSON`
- `retryable=true` 或 `false`，取决于具体失败原因

适合重试的典型情况：

- 查询服务或模型服务临时不可用
- 网络抖动
- 上游依赖短暂异常

不适合重试的典型情况：

- 请求参数固定错误
- `opportunityId` 对应记录不存在
- 模型鉴权失败
- 固定配置错误

#### 9) 查询、模型或内部工具调用超时

可能返回：

- HTTP `504`
- 错误码 `MODEL_TIMEOUT`：项目 LLM 调用超时
- 错误码 `RUNTIME_TIMEOUT`：查询服务或结构化校验工具调用超时
- `retryable=true`

当前场景的查询、项目 LLM 和结构化校验工具默认超时时间均为 `30000ms`。由于链路会串行经过查询、模型生成和结构校验，建议调用方客户端超时时间设置为 `120s` 到 `150s`，避免服务端仍在处理时客户端过早断开。

## 7. HTTP 状态码说明

| HTTP 状态码 | 含义 | 说明 |
| --- | --- | --- |
| `200` | 成功 | 结构化结果返回在 `data` 中 |
| `400` | 请求错误 | 常见于 `scene` 错误、`opportunityId` 缺失或格式不对、`rawText` 缺失或超长 |
| `404` | 数据不存在 | 常见于 `opportunityId` 未查询到销售机会记录 |
| `500` | 平台配置或资产错误 | 常见于运行时配置、资产加载等内部错误 |
| `502` | 上游依赖错误 | 常见于查询服务、模型调用或模型返回内容不合法 |
| `504` | 上游超时 | 查询服务、模型调用或结构化校验工具超时 |

## 8. 对接建议

1. 调用方务必记录 `requestId`，便于排查。
2. `opportunityId` 建议始终按字符串传入，不要用 JSON number 承载大号雪花 ID。
3. 本接口不会直接保存字段结果；如需落库，应由调用方在拿到结构化结果后走自己的保存流程。
4. 调用方不要在请求中传 `salesScene`；服务端会基于当前机会事实识别。
5. `data.data` 中的字段名是表字段英文名，前端展示时请自行映射中文标签。
6. `smartContacts` 如有值，通常是 JSON 数组字符串；前端需要展示联系人时，应先按字符串解析 JSON。
7. 当返回 `retryable=true` 时，可按调用方重试策略进行有限次重试。
8. `rawText` 建议保留原文中的换行、冒号、分号等结构，有助于模型识别字段和更新意图。

## 9. `curl` 调用示例

```bash
curl -sS -X POST http://192.168.9.163/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{
    "scene": "sales-opportunity-smart-entry",
    "bizParams": {
      "opportunityId": "2052956605598666752",
      "rawText": "客户本周反馈预算已确认，预计下周安排技术评审，采购时间调整到2026-06-30。"
    }
  }'
```

## 10. 当前文档对应的真实实现来源

本文档基于以下真实实现整理：

- 统一入口：`POST /api/agent/run`
- 场景配置：`scene-configs/sales-opportunity-smart-entry.json`
- 平台技能：`platform/skills/sales-opportunity-smart-entry.v1.yaml`
- 查询配置：`platform/tools/sales-opportunity-smart-entry-by-opportunity-id.query.yaml`
- 模型提示词：`platform/assets/prompts/sales-opportunity-smart-entry.draft-business-output.v1.md`
- 字段字典：`metadata/sales_opportunity_smart_entry_dictionary.tsv`
- 决策规则：`references/sales-opportunity-smart-entry/decision_rules.md`
- 输出结构：`references/sales-opportunity-smart-entry/output_schema.json`
- 请求校验：`services/request-validation.js`
- 统一错误封装：`utils/errors.js`
