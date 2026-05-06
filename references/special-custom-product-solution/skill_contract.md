# 特殊定制产品部方案 Skill Contract

## 输入

- `specialCustomOrderNo`：特殊定制单号，必填。
- `customRequirement`：定制要求，必填。

## 处理约束

- 优先调用本地 RAG 检索相似定制片段。
- 生成内容必须基于定制要求和可用 RAG 证据。
- 不输出解释性文本，只输出结构化业务 JSON。

## 输出

返回符合 `schema://special-custom-product-solution/output@v1` 的 JSON：

- `productSolution`：产品部方案文本。
