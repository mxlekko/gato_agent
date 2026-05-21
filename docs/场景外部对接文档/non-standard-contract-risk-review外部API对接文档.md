# `non-standard-contract-risk-review` 外部 API 对接文档

## 1. 接口概述

该接口用于审查非标合同文件，并返回精简结果：

- `approvalAdvice`：审批建议
- `riskPoints`：风险点列表

当前场景标识固定为 `non-standard-contract-risk-review`，通过统一业务入口 `POST /api/agent/run` 调用。

## 2. 请求地址

```text
POST /api/agent/run
```

正式集成推荐使用 `multipart/form-data` 上传文件；如文件已经在业务方对象存储中，也可以只传文件 URL。

## 3. 请求参数

### 3.1 multipart/form-data

| 参数 | 是否必选 | 类型 | 说明 |
| --- | --- | --- | --- |
| `scene` | 是 | `string` | 固定传 `non-standard-contract-risk-review` |
| `baseFile` | 和 `baseFileURL` 二选一 | `file` | 合同文件数据。支持上传一篇文件，文件大小不超过 `50MB` |
| `baseFileURL` | 和 `baseFile` 二选一 | `string` | 合同文件 URL，仅支持 `http`/`https` |
| `runtimeContext` | 否 | `json string` | 运行上下文，可传 `{"tenantId":"...","userId":"..."}` |

优先级：`baseFile > baseFileURL`。当 `baseFile` 字段存在时，`baseFileURL` 字段失效。

当前场景支持的文件类型：

- 图片：`.bmp`、`.jpg`、`.jpeg`、`.png`、`.tif`、`.tiff`
- 文档：`.doc`、`.docx`、`.wps`、`.pdf`、`.ofd`
- 表格：`.xlsx`

### 3.2 JSON 调试兼容格式

前端单次接口调试或自动化回归如果不方便传真实文件控件，可以使用 JSON 里的 `baseFile` 对象：

```json
{
  "scene": "non-standard-contract-risk-review",
  "bizParams": {
    "baseFile": {
      "fileName": "非标合同.docx",
      "fileContentBase64": "BASE64_ENCODED_FILE",
      "fileMimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    }
  }
}
```

也可以只传 URL：

```json
{
  "scene": "non-standard-contract-risk-review",
  "bizParams": {
    "baseFileURL": "https://example.com/contracts/非标合同.pdf"
  }
}
```

## 4. 成功响应

```json
{
  "success": true,
  "requestId": "req_20260521_120000000_abcd1234",
  "data": {
    "approvalAdvice": "建议有条件通过审批：需补充验收标准、付款节点和违约责任上限后再签署。",
    "riskPoints": [
      "付款条款未明确触发条件，存在回款延迟风险。",
      "验收标准和验收期限不清晰，可能导致客户长期不确认验收。"
    ]
  },
  "error": null
}
```

成功时 `data` 只包含 `approvalAdvice` 和 `riskPoints` 两个业务字段。

## 5. 失败响应

```json
{
  "success": false,
  "requestId": "req_20260521_120000000_abcd1234",
  "data": null,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "bizParams.baseFile or bizParams.baseFileURL is required.",
    "httpStatus": 400,
    "stage": "request-validate",
    "retryable": false,
    "details": {
      "oneOf": [
        "baseFile",
        "baseFileURL"
      ]
    }
  }
}
```

常见失败：

- `INVALID_REQUEST`：缺少文件字段、文件类型不支持、文件过大、URL 非法。
- `DOCUMENT_FETCH_FAILED`：`baseFileURL` 下载失败或超时。
- `DOCUMENT_PARSE_FAILED`：文件无法解析或没有可读文本。
- `MODEL_INVOCATION_FAILED`：模型调用失败。
- `RUNTIME_TIMEOUT`：文件解析、模型调用或校验超时。
- `INVALID_MODEL_OUTPUT`：模型输出不符合结构要求。

## 6. curl 示例

### 6.1 直接上传文件

```bash
curl -sS -X POST http://127.0.0.1:3100/api/agent/run \
  -F 'scene=non-standard-contract-risk-review' \
  -F 'baseFile=@./非标合同.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document'
```

### 6.2 使用文件 URL

```bash
curl -sS -X POST http://127.0.0.1:3100/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{
    "scene": "non-standard-contract-risk-review",
    "bizParams": {
      "baseFileURL": "https://example.com/contracts/contract.pdf"
    }
  }'
```

## 7. 对接建议

1. 正式集成优先使用 `multipart/form-data` 的 `baseFile` 文件字段，业务方不需要手动转 base64。
2. 如果文件已在对象存储或文档系统中，传 `baseFileURL` 更适合异步/系统间对接，但需要确保服务端可访问该 URL。
3. 调用方记录 `requestId`，便于排查。
4. 建议客户端超时时间设置为 `90s` 以上。
5. 图片类文件会先走 OCR 识别；清晰度、倾斜、遮挡和扫描质量会影响风险点识别效果。
6. 扫描版 PDF 可能受 OCR 能力影响，建议优先上传可复制文本的 PDF 或 `.docx` 文件。
7. 返回结果为审批辅助建议，不替代法务最终意见。
