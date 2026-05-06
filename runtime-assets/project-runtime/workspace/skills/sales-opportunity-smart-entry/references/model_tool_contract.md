# Local Model Tool Contract

## Endpoint

`POST http://127.0.0.1:19003/internal/model/validate-structured-output`

## Request

```json
{
  "requestId": "req_xxx",
  "scene": "sales-opportunity-smart-entry",
  "payload": {
    "opportunityId": "2041340312877535232",
    "summary": "机会处于未判定阶段，预算待确认。",
    "adviceText": "先完成需求澄清与预算确认，再倒排投标准备。",
    "nextActions": [
      "确认客户真实需求",
      "确认预算审批状态",
      "围绕预计投标日期倒排计划"
    ]
  },
  "schema": {
    "type": "object",
    "required": [
      "opportunityId",
      "summary",
      "adviceText",
      "nextActions"
    ],
    "properties": {
      "opportunityId": {
        "type": "string_or_number"
      },
      "summary": {
        "type": "string",
        "minLength": 1
      },
      "adviceText": {
        "type": "string",
        "minLength": 1
      },
      "nextActions": {
        "type": "array",
        "minItems": 3,
        "maxItems": 5,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "minLength": 1
        }
      }
    },
    "additionalProperties": false
  }
}
```

## Success response

```json
{
  "success": true,
  "requestId": "req_xxx",
  "data": {
    "requestId": "req_xxx",
    "scene": "sales-opportunity-smart-entry",
    "payload": {
      "opportunityId": "2041340312877535232",
      "summary": "机会处于未判定阶段，预算待确认。",
      "adviceText": "先完成需求澄清与预算确认，再倒排投标准备。",
      "nextActions": [
        "确认客户真实需求",
        "确认预算审批状态",
        "围绕预计投标日期倒排计划"
      ]
    }
  },
  "error": null
}
```

## Error response

```json
{
  "success": false,
  "requestId": "req_xxx",
  "data": null,
  "error": {
    "code": "INVALID_MODEL_OUTPUT",
    "message": "Required field is missing.",
    "httpStatus": 502,
    "stage": "model-tool",
    "retryable": false,
    "details": {
      "path": "payload.summary",
      "requiredField": "summary"
    }
  }
}
```
