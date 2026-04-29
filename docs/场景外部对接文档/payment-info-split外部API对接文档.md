# `payment-info-split` 外部 API 对接文档

## 1. 接口概述

该接口用于将一段非结构化收款文本拆分为以下 3 个字段：

- `payeeName`：收款方名称
- `payeeAccount`：收款账号
- `bankName`：开户行名称

当前场景标识固定为 `payment-info-split`，通过统一业务入口 `POST /api/agent/run` 调用。

说明：

- 这是一个同步接口
- 请求成功时 HTTP 状态码固定为 `200`
- 当原文里缺少某个字段，接口不会报错，会返回空字符串 `""`

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
  "scene": "payment-info-split",
  "bizParams": {
    "rawText": "收款方：上海某某科技有限公司；开户行：中国银行上海浦东分行；账号：1234567890123456789"
  }
}
```

### 3.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `scene` | `string` | 是 | 固定传 `payment-info-split` |
| `bizParams` | `object` | 是 | 业务入参对象 |
| `bizParams.rawText` | `string` | 是 | 待拆分的原始收款文本，服务端会自动去掉首尾空格，最大长度 `4000` |

### 3.3 入参约束

- `scene` 只能是 `payment-info-split`
- `bizParams.rawText` 必须是字符串
- `bizParams.rawText` 去首尾空格后不能为空
- `bizParams.rawText` 最大长度不能超过 `4000`

## 4. 成功响应

### 4.1 响应体结构

```json
{
  "success": true,
  "requestId": "req_20260420_160935937_d25b0f7b",
  "data": {
    "payeeName": "上海某某科技有限公司",
    "payeeAccount": "1234567890123456789",
    "bankName": "中国银行上海浦东分行"
  },
  "error": null
}
```

### 4.2 返回字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `success` | `boolean` | 成功时固定为 `true` |
| `requestId` | `string` | 平台生成的请求唯一标识，建议调用方记录 |
| `data.payeeName` | `string` | 收款方名称，最大长度 `200` |
| `data.payeeAccount` | `string` | 收款账号，最大长度 `100` |
| `data.bankName` | `string` | 开户行名称，最大长度 `200` |
| `error` | `null` | 成功时固定为 `null` |

### 4.3 字段缺失时的返回规则

该场景按“尽量提取、无法确定则留空”的方式返回。

例如原文只有收款方，没有账号和开户行时，真实返回示例如下：

```json
{
  "success": true,
  "requestId": "req_20260420_160950903_0f75d01e",
  "data": {
    "payeeName": "上海某某科技有限公司",
    "payeeAccount": "",
    "bankName": ""
  },
  "error": null
}
```

这类情况不视为接口失败。

## 5. 失败响应

### 5.1 统一失败结构

```json
{
  "success": false,
  "requestId": "req_20260420_160935941_215fd52c",
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

#### 1) `rawText` 缺失

HTTP `400`

```json
{
  "success": false,
  "requestId": "req_20260420_160935941_215fd52c",
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

#### 2) `rawText` 不是字符串

HTTP `400`

```json
{
  "success": false,
  "requestId": "req_20260420_160935945_e2f24a3b",
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

#### 3) 上游模型调用失败

可能返回：

- HTTP `502`
- 错误码 `MODEL_INVOCATION_FAILED`
- `retryable=true` 或 `false`，取决于具体失败原因

适合重试的典型情况：

- 上游模型服务临时不可用
- 网络抖动

不适合重试的典型情况：

- 鉴权失败
- 固定配置错误

#### 4) 上游模型超时

可能返回：

- HTTP `504`
- 错误码 `RUNTIME_TIMEOUT`
- `retryable=true`

当前场景内部模型超时时间为 `30000ms`。建议调用方客户端超时时间设置为 `35s` 到 `40s`。

## 6. HTTP 状态码说明

| HTTP 状态码 | 含义 | 说明 |
| --- | --- | --- |
| `200` | 成功 | 结构化结果返回在 `data` 中 |
| `400` | 请求错误 | 常见于 `scene` 错误、`rawText` 缺失、类型不对、长度超限 |
| `502` | 上游依赖错误 | 常见于模型调用失败、模型返回内容不合法 |
| `504` | 上游超时 | 模型调用超时 |

## 7. 对接建议

1. 调用方务必记录 `requestId`，便于排查。
2. 当接口返回 `success=true` 但字段为空字符串时，应按“原文未明确提供”处理，不建议自动判定为接口异常。
3. 当返回 `retryable=true` 时，可按调用方重试策略进行有限次重试。
4. 如果调用方有前置清洗逻辑，建议保留原始银行文本中的分号、冒号、换行等分隔信息，有助于提取准确率。

## 8. `curl` 调用示例

```bash
curl -sS -X POST http://192.168.9.162:3100/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{
    "scene": "payment-info-split",
    "bizParams": {
      "rawText": "收款方：上海某某科技有限公司；开户行：中国银行上海浦东分行；账号：1234567890123456789"
    }
  }'
```

## 9. 当前文档对应的真实实现来源

本文档基于以下真实实现整理：

- 统一入口：`POST /api/agent/run`
- 场景配置：`scene-configs/payment-info-split.json`
- 输出结构：`references/payment-info-split/output_schema.json`
- 请求校验：`services/request-validation.js`
- 统一错误封装：`utils/errors.js`
- 真实成功 / 失败联调样例：本地服务实测返回结果
