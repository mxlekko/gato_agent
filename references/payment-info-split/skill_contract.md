# 收款信息拆分 Skill Contract

## 输入

- `rawText`：原始收款信息文本，必填。

## 输出

返回符合 `schema://payment-info-split/output@v1` 的 JSON：

- `payeeName`：收款方、收款人、户名、公司名称、单位名称。
- `payeeAccount`：收款账号、银行账号、账号、卡号。
- `bankName`：开户行、开户银行、银行名称、支行、分行、营业部。

无法稳定识别的字段返回空字符串。
