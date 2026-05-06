# `special-custom-product-solution` 外部 API 对接文档

## 1. 接口概述

该接口用于根据特殊定制单号和定制要求，生成产品部可执行的方案文本。

当前场景标识固定为 `special-custom-product-solution`，通过统一业务入口 `POST /api/agent/run` 调用。

内部处理链路：

- 使用 `customRequirement` 调用本地 RAG 服务检索历史相似方案片段
- 使用大模型基于当前定制要求和相似片段生成产品部方案
- 对输出结果做结构校验后返回

说明：

- 这是一个同步接口
- 请求成功时 HTTP 状态码固定为 `200`
- 成功时只返回 `productSolution` 一个业务字段
- `productSolution` 是字符串，可能包含换行符 `\n`

## 2. 请求地址

```text
POST /api/agent/run
Content-Type: application/json
```

联调示例：

```text
http://192.168.9.162:3100/api/agent/run
```

当前文档中的联调地址按内网调用地址编写；如果后续网关地址变化，请统一替换为新的内网服务地址。

## 3. 请求参数

### 3.1 请求体

```json
{
  "scene": "special-custom-product-solution",
  "bizParams": {
    "specialCustomOrderNo": "SC-20260429-001",
    "customRequirement": "3.0程序；用灯控模块4.0烧录3.0网络设备，还要添加485地址所需的物料；型号：GT-KLMN03 V3.0"
  }
}
```

### 3.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `scene` | `string` | 是 | 固定传 `special-custom-product-solution` |
| `bizParams` | `object` | 是 | 业务入参对象 |
| `bizParams.specialCustomOrderNo` | `string` | 是 | 特殊定制单号，服务端会自动去掉首尾空格，最大长度 `100` |
| `bizParams.customRequirement` | `string` | 是 | 定制要求文本，服务端会自动去掉首尾空格，最大长度 `12000` |

### 3.3 入参约束

- `scene` 只能是 `special-custom-product-solution`
- `bizParams.specialCustomOrderNo` 必须是字符串
- `bizParams.specialCustomOrderNo` 去首尾空格后不能为空
- `bizParams.specialCustomOrderNo` 最大长度不能超过 `100`
- `bizParams.customRequirement` 必须是字符串
- `bizParams.customRequirement` 去首尾空格后不能为空
- `bizParams.customRequirement` 最大长度不能超过 `12000`

## 4. 成功响应

### 4.1 响应体结构

```json
{
  "success": true,
  "requestId": "req_20260429_092511086_1bdf8f11",
  "data": {
    "productSolution": "1、3.0程序\n2、用灯控模块4.0烧录3.0网络设备，还要添加485地址所需的物料\n3、型号：GT-KLMN03 V3.0"
  },
  "error": null
}
```

### 4.2 返回字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `success` | `boolean` | 成功时固定为 `true` |
| `requestId` | `string` | 平台生成的请求唯一标识，建议调用方记录 |
| `data.productSolution` | `string` | 产品部方案文本，最小长度 `1`，最大长度 `8000` |
| `error` | `null` | 成功时固定为 `null` |

### 4.3 换行展示说明

`productSolution` 中可能包含 JSON 字符串换行符 `\n`。

例如响应中的：

```json
"productSolution": "1、3.0程序\n2、用灯控模块4.0烧录3.0网络设备\n3、型号：GT-KLMN03 V3.0"
```

展示时应理解为：

```text
1、3.0程序
2、用灯控模块4.0烧录3.0网络设备
3、型号：GT-KLMN03 V3.0
```

前端如果已经拿到 JSON 解析后的 `data.productSolution`，建议使用 CSS 保留换行：

```css
.product-solution {
  white-space: pre-wrap;
}
```

React 示例：

```jsx
<div className="product-solution">
  {response.data.productSolution}
</div>
```

如果页面看到的是字面量 `\n`，通常说明前端展示的是 `JSON.stringify` 后的整段 JSON，而不是解析后的 `data.productSolution` 字段。

## 5. 失败响应

### 5.1 统一失败结构

```json
{
  "success": false,
  "requestId": "req_20260429_100000000_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.customRequirement is required.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": null
  }
}
```

### 5.2 失败字段说明

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

### 5.3 常见错误场景

#### 1) `customRequirement` 缺失

HTTP `400`

```json
{
  "success": false,
  "requestId": "req_20260429_100000000_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.customRequirement is required.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": null
  }
}
```

#### 2) `specialCustomOrderNo` 缺失

HTTP `400`

```json
{
  "success": false,
  "requestId": "req_20260429_100000001_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.specialCustomOrderNo is required.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": null
  }
}
```

#### 3) 入参类型不对

HTTP `400`

例如 `customRequirement` 传了数字：

```json
{
  "success": false,
  "requestId": "req_20260429_100000002_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.customRequirement must be a string.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": null
  }
}
```

#### 4) RAG 检索失败

可能返回：

- HTTP `500`
- 错误码 `RAG_SEARCH_FAILED`
- `stage=direct-model-rag`

常见原因：

- 本地 RAG 服务不可用
- RAG 服务返回非 JSON 内容
- RAG 服务返回失败状态

#### 5) 上游模型调用失败

可能返回：

- HTTP `502`
- 错误码 `MODEL_INVOCATION_FAILED`
- `stage=direct-model`

常见原因：

- 模型服务临时不可用
- 模型鉴权失败
- 模型服务返回非成功 HTTP 状态

#### 6) 上游超时

可能返回：

- HTTP `504`
- 错误码 `RUNTIME_TIMEOUT`
- `retryable=true`

当前内部超时配置：

- RAG 检索超时：`12000ms`
- 模型调用超时：`30000ms`

建议调用方客户端超时时间设置为 `50s` 到 `80s`。如果调用方希望覆盖极少数模型空响应后自动重试的情况，建议按 `80s` 设置。

#### 7) 模型输出结构不合法

可能返回：

- HTTP `502`
- 错误码 `INVALID_MODEL_OUTPUT`

常见原因：

- 模型返回不是合法 JSON
- 模型返回 JSON 中缺少 `productSolution`
- `productSolution` 不是字符串
- `productSolution` 为空

## 6. HTTP 状态码说明

| HTTP 状态码 | 含义 | 说明 |
| --- | --- | --- |
| `200` | 成功 | 生成结果返回在 `data.productSolution` 中 |
| `400` | 请求错误 | 常见于 `scene` 错误、字段缺失、类型不对、长度超限 |
| `500` | 内部依赖或配置错误 | 常见于 RAG 检索异常 |
| `502` | 上游模型错误 | 常见于模型调用失败、模型返回内容不合法 |
| `504` | 上游超时 | RAG 或模型调用超时 |

## 7. 对接建议

1. 调用方务必记录 `requestId`，便于排查。
2. `productSolution` 是普通字符串，可能包含 `\n`，前端展示时建议使用 `white-space: pre-wrap`。
3. `customRequirement` 建议尽量保留原始换行、编号、型号、版本号和物料描述，有助于生成结果准确。
4. 当返回 `retryable=true` 时，可按调用方重试策略进行有限次重试。
5. 当返回 `success=true` 时，以 `data.productSolution` 作为最终业务结果，不需要再解析内部 JSON。
6. 如果调用方需要把结果入库，应按字符串保存，不要把换行符替换为空格。

## 8. `curl` 调用示例

```bash
curl -sS -X POST http://192.168.9.162:3100/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{
    "scene": "special-custom-product-solution",
    "bizParams": {
      "specialCustomOrderNo": "SC-20260429-001",
      "customRequirement": "3.0程序；用灯控模块4.0烧录3.0网络设备，还要添加485地址所需的物料；型号：GT-KLMN03 V3.0"
    }
  }'
```

## 9. 当前文档对应的真实实现来源

本文档基于以下真实实现整理：

- 统一入口：`POST /api/agent/run`
- 场景配置：`scene-configs/special-custom-product-solution.json`
- 输出结构：`references/special-custom-product-solution/output_schema.json`
- 生成提示词：`platform/assets/prompts/special-custom-product-solution.draft-business-output.v1.md`
- 业务规则：`references/special-custom-product-solution/decision_rules.md`
- 请求校验：`services/request-validation.js`
- 直连模型执行：`services/direct-model.js`
- 统一错误封装：`utils/errors.js`
