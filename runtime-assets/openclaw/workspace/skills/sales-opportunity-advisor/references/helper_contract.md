# Local Data Tool Contract

## Endpoint

`POST http://127.0.0.1:19101/internal/context/sales-opportunity`

## Request

```json
{
  "requestId": "req_xxx",
  "opportunityId": "2041340312877535232"
}
```

## Success response

```json
{
  "success": true,
  "requestId": "req_xxx",
  "data": {
    "requestId": "req_xxx",
    "opportunityId": "2041340312877535232",
    "rawRow": {
      "opportunityName": "XX医院智能化改造",
      "customerName": "XX医院",
      "salesStage": 4,
      "opportunityStatus": 1,
      "businessType": 3,
      "amount": 2600000,
      "budgetConfirmed": 1
    }
  },
  "error": null
}
```

The data tool returns only `data.rawRow`. Field filtering, dictionary lookup, value mapping, `profile` generation, and `facts` generation must all happen in the main skill.

## Error response

```json
{
  "success": false,
  "requestId": "req_xxx",
  "data": null,
  "error": {
    "code": "OPPORTUNITY_NOT_FOUND",
    "message": "未查询到对应的销售机会记录",
    "httpStatus": 404,
    "stage": "context-query",
    "retryable": false,
    "details": null
  }
}
```
