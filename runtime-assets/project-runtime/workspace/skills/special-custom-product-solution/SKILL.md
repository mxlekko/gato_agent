---
name: special-custom-product-solution
description: 处理特殊定制产品部方案请求。当消息中包含 SPECIAL_CUSTOM_PRODUCT_SOLUTION 请求标记且 scene 为 special-custom-product-solution 时，先调用本地 RAG 检索相似片段，再基于定制要求和相似片段输出产品部方案 JSON。
metadata: {"openclaw":{"requires":{"bins":["curl","cat"]},"os":["darwin"]}}
---

# 特殊定制产品部方案 Skill

当当前消息中同时包含以下标记时，使用本 skill：

- `<<<SPECIAL_CUSTOM_PRODUCT_SOLUTION_REQUEST_JSON_BEGIN>>>`
- `<<<SPECIAL_CUSTOM_PRODUCT_SOLUTION_REQUEST_JSON_END>>>`

并且请求 JSON 中满足：

- `kind = special_custom_product_solution_request`
- `scene = special-custom-product-solution`

这是机器到机器请求。不要追问，不要闲聊，不要在最终 wrapped JSON 结果之外输出任何解释性文本。

## 请求契约

请求 JSON 字段：

- `requestId`
- `scene = special-custom-product-solution`
- `bizParams.specialCustomOrderNo`
- `bizParams.customRequirement`

`specialCustomOrderNo` 是特殊定制单号，必须原样保留在内部上下文中。
`customRequirement` 是文本型定制要求，是 RAG 检索和方案生成的主输入。

## 执行流程

1. 解析请求 JSON。
2. 用 `customRequirement` 调用本地 RAG 检索相似片段。
3. 读取输出 schema。
4. 基于 `customRequirement` 和 RAG 相似片段生成产品部方案。
5. 调用本地 model tool 校验结构化输出。
6. 只返回 wrapped JSON。

## Tool 1：RAG 检索

本地 RAG 检索入口：

`POST http://127.0.0.1:19104/internal/rag/search`

调用格式：

```bash
curl -sS -X POST http://127.0.0.1:19104/internal/rag/search \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"<REQUEST_ID>","query":"<CUSTOM_REQUIREMENT>","topK":5}'
```

规则：

- 只允许访问 `127.0.0.1`。
- `query` 必须使用 `customRequirement`。
- 如果 RAG 返回失败，应返回失败 wrapped JSON，错误 stage 使用 `rag-search`。

## 输出 schema

schema 路径：

`/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/special-custom-product-solution/references/output_schema.json`

读取方式：

```bash
cat /Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/special-custom-product-solution/references/output_schema.json
```

## Tool 2：结构校验

本地 model tool 校验入口：

`POST http://127.0.0.1:19103/internal/model/validate-structured-output`

调用格式：

```bash
curl -sS -X POST http://127.0.0.1:19103/internal/model/validate-structured-output \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"<REQUEST_ID>","scene":"special-custom-product-solution","payload":{"productSolution":"<方案文本>"},"schema":<OUTPUT_SCHEMA_JSON>}'
```

## 生成要求

生成 payload 只能包含：

```json
{
  "productSolution": "产品部方案文本"
}
```

硬性限制：

- 成功响应的 `payload` 只能有一个键：`productSolution`。
- 即使识别出了产品型号、固件版本、标签内容、包装方式等信息，也必须写进 `productSolution` 这一个字符串里。
- 严禁在 `payload` 中输出 `specialCustomOrderNo`、`productModel`、`firmwareVersion`、`labelContent`、`packagingType` 或任何其他并列字段。
- 如果你已经整理出多个结构化要点，把它们合并成一段产品部方案文本，放到 `payload.productSolution`。

方案文本要求：

- 面向产品部，给出可执行方案。
- 参考 RAG 相似片段，但不要照搬。
- 当前定制要求优先于相似片段。
- 包含产品方案、关键实现要点、风险与待确认事项。
- 不要输出 Markdown，不要输出推理过程。
- 不要增加 `specialCustomOrderNo`、`customRequirement`、`matches` 等额外字段。

## 成功返回

```text
<<<SPECIAL_CUSTOM_PRODUCT_SOLUTION_RESULT_JSON_BEGIN>>>
{"success":true,"scene":"special-custom-product-solution","requestId":"<REQUEST_ID>","payload":{"productSolution":"<方案文本>"},"error":null}
<<<SPECIAL_CUSTOM_PRODUCT_SOLUTION_RESULT_JSON_END>>>
```

## 失败返回

```text
<<<SPECIAL_CUSTOM_PRODUCT_SOLUTION_RESULT_JSON_BEGIN>>>
{"success":false,"scene":"special-custom-product-solution","requestId":"<REQUEST_ID>","payload":null,"error":{"code":"INVALID_RUNTIME_MESSAGE","message":"Request JSON block not found or invalid.","httpStatus":500,"stage":"request-reader","retryable":false,"details":null}}
<<<SPECIAL_CUSTOM_PRODUCT_SOLUTION_RESULT_JSON_END>>>
```
