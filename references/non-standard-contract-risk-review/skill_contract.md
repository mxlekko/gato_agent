# 非标合同风险审查 Skill Contract

## 输入

- `baseFile`：合同文件，和 `baseFileURL` 二选一。正式接口调用时按 `multipart/form-data` 的文件字段传入；平台内部会规范化为文件对象。
- `baseFileURL`：合同文件 URL，和 `baseFile` 二选一。仅支持 `http`/`https`。

约束：

- `baseFile` 优先级高于 `baseFileURL`；当 `baseFile` 存在时，`baseFileURL` 不生效。
- 文件大小不超过 `50MB`。
- 当前场景支持图片 `.bmp`、`.jpg`、`.jpeg`、`.png`、`.tif`、`.tiff`，文档 `.doc`、`.docx`、`.wps`、`.pdf`、`.ofd`，以及 `.xlsx`。

## 输出

返回符合 `schema://non-standard-contract-risk-review/output@v1` 的 JSON：

- `approvalAdvice`：审批建议。
- `riskPoints`：风险点列表。

输出不得包含其他业务字段。
