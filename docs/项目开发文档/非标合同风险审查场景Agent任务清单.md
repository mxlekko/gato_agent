# 非标合同风险审查场景 Agent 任务清单

## 1. 总目标

新增 `非标合同风险审查` 场景，让调用方通过统一入口 `POST /api/agent/run` 提交一份非标合同文件，系统完成文件文本抽取、模型风险审查、结构化校验，并返回精简业务结果：

- `approvalAdvice`：审批建议
- `riskPoints`：风险点列表

推荐场景标识：

```text
non-standard-contract-risk-review
```

## 2. 本期边界

### 2.1 本期要做

- 支持通过 `multipart/form-data` 的 `baseFile` 文件字段上传合同文件；同时支持 `baseFileURL` 文件地址。
- 保留 JSON 调试兼容格式：`bizParams.baseFile = { fileName, fileContentBase64, fileMimeType }`。
- 支持图片 `.bmp`、`.jpg`、`.jpeg`、`.png`、`.tif`、`.tiff`，文档 `.doc`、`.docx`、`.wps`、`.pdf`、`.ofd`，以及 `.xlsx`；用户口径中的 `xlxs` 按 `.xlsx` 处理。
- 在进入大模型前完成文件解析，把文件内容转换为合同文本、表格文本和基础元信息。
- 新增该场景的 `scene-config`、`BusinessSkill`、LLM tool、输出 schema、prompt 和外部对接文档。
- 输出 payload 只包含 `approvalAdvice` 和 `riskPoints`。
- 接入现有 LangGraph agent-runtime、结构化输出校验、配置校验、发布和回归链路。

### 2.2 本期不做

- 不做专门的前端合同上传页面。
- 不做专门的文件上传暂存接口；文件仅用于本次审查链路。
- 不支持加密文件、压缩包、多文件合并审查。
- 不把合同文件写入 RAG 知识库或长期持久化文档库。
- 不承诺法律结论替代法务审查；返回结果只作为审批辅助建议。
- 不扩展输出字段到风险等级、金额、条款定位、缺失条款等复杂结构。

### 2.3 二期预留

- 支持扫描版 PDF OCR 质量检测和人工复核提示。
- 引入法务条款库、红线规则库或 RAG 检索增强。
- 输出风险等级、引用条款、修改建议、需要法务复核标记等增强字段。
- 在控制台增加合同审查调试页和文件上传组件。

## 3. 推荐执行顺序

1. 固定输入输出契约和场景资源落点。
2. 补齐文件型入参校验和一次性文件解析能力。
3. 新增合同风险审查模板 / skill / tool / prompt / schema。
4. 接入运行时、发布链路和回归脚本。
5. 补充外部 API 文档和验收说明。

### 3.1 可轮询子任务清单

状态约定：

- `[ ]`：未开始或未完成。
- `[x]`：已完成，并通过该子任务要求的最小验证。
- 如被阻塞，保持 `[ ]`，并在同一行末尾追加 `BLOCKED: <原因>`。
- 勾选任务时必须在同一行末尾补充简短结果，例如 `已通过 npm run check`。

#### P1. 契约与资源设计

- [x] P1-01 确认场景 ID、中文标题、统一入口、请求字段和返回字段，并记录到本任务文档的数据模型章节。已确认 `non-standard-contract-risk-review`、`POST /api/agent/run`、`baseFile/baseFileURL` 和 `approvalAdvice/riskPoints`。
- [x] P1-02 盘点现有 `payment-info-split`、`prompt-structured-extraction`、`request-validation`、`draft-output`、`validate-output` 链路，确认新场景复用点和必须新增点。已补充“现有链路复用点与新增点”章节。
- [x] P1-03 设计 `output_schema.json`，确保只允许 `approvalAdvice` 和 `riskPoints` 两个字段。已新增 `references/non-standard-contract-risk-review/output_schema.json`。
- [x] P1-04 设计 prompt 初稿，要求模型只基于解析后的合同文本输出 JSON，不输出 Markdown 和额外字段。已新增 `references/non-standard-contract-risk-review/prompt.md`。
- [x] P1-05 执行静态契约复核，确认本阶段未改业务代码或只落文档草稿。已完成文件存在与契约字段静态复核。

#### P2. 文件入参与解析能力

- [x] P2-01 在 `services/request-validation.js` 增加文件型入参校验能力，支持 `baseFile`、`baseFileURL` 二选一，限制扩展名和文件大小。已新增 `fileObject` / `fileUrl` 类型并保留 JSON 调试兼容。
- [x] P2-02 在 `platform/nodes/validate-input.js` 路径确认文件型字段能被图内节点复用，失败时返回统一 `INVALID_REQUEST`。已复用同一 `validateBizParamsAgainstContract` 校验入口。
- [x] P2-03 新增一次性合同文件解析能力，支持图片 OCR、`.doc`/`.wps` 转文本、`.docx`、`.pdf`、`.ofd`、`.xlsx` 转为文本，不进入 RAG 文档库。已新增 `platform/nodes/extract-contract-document.js`、`scripts/extract_contract_document_text.py` 与 macOS Vision OCR 脚本。
- [x] P2-04 如复用 `rag-service/rag_mvp/parsers.py`，补齐 `.xlsx` 表格读取能力，并避免上传原件被长期持久化。未走 RAG 入库路径；一次性解析脚本已支持 `.xlsx`，PDF/OFD 解析优先使用 `rag-service/.venv` 中的 PyMuPDF。
- [x] P2-05 新增解析结果裁剪策略，超长合同时返回可控长度文本，并记录 `extractWarnings` 供 prompt 使用。已在解析脚本中加入 `maxChars` 裁剪和 `warnings`。
- [x] P2-06 增加解析失败、空文本、非法 base64、非法后缀、超大小文件的单元或脚本验证。已通过 `node -c`、Python 编译、非法后缀/坏文件分支和 docx/pdf/xlsx/图片 OCR smoke 验证。

#### P3. 平台模板、工具与业务技能

- [x] P3-01 新增或扩展 `WorkflowTemplate`，在 `validate_input` 后、`draft_business_output` 前加入合同文件解析节点。已新增 `platform/templates/document-structured-review.v1.yaml`。
- [x] P3-02 在 `platform/runtime/graphs/index.js` 注册新解析节点执行器，确保编译后的图能按节点 ID 执行。已注册 `extract_contract_document`。
- [x] P3-03 新增合同文件解析 tool 或平台节点配置，明确输入来自 `request.normalized.biz_params`，输出落到 `artifacts.document`. 已通过平台节点写入 `artifacts.document`。
- [x] P3-04 新增 `platform/tools/project-contract-risk-review-llm.tool.yaml`，绑定 `advisory_llm`，输入包含 prompt、解析文本、schema。已新增并通过平台配置 lint。
- [x] P3-05 新增 `platform/skills/non-standard-contract-risk-review.v1.yaml`，绑定模板、prompt、schema、LLM tool 和 output validator。已新增 BusinessSkill。
- [x] P3-06 新增 `scene-configs/non-standard-contract-risk-review.json`，接入 agent-runtime + langgraph 路由。已新增 scene config。
- [x] P3-07 更新 `server.js` 健康检查场景清单，确保新场景编译失败能在 `/health` 暴露。已改为按当前支持场景动态编译健康检查。
- [x] P3-08 执行 `npm run lint:platform-configs` 和图编译直测，修复配置或编译问题。已通过 `npm run lint:platform-configs` 和仓库配置路径图编译直测。

#### P4. 模型生成与结构化校验

- [x] P4-01 新增 `references/non-standard-contract-risk-review/output_schema.json`，只包含 `approvalAdvice` 与 `riskPoints`。已新增 schema 且 `additionalProperties=false`。
- [x] P4-02 新增 `references/non-standard-contract-risk-review/prompt.md`，约束模型输出精简、中文、JSON 对象、不得新增字段。已新增 prompt。
- [x] P4-03 调整 `platform/runtime/llm-client.js` 或工具请求构造，确保合同文本字段会进入模型 user prompt。已通过 LLM tool `request: artifacts.document` 传入解析文本，无需改 llm-client。
- [x] P4-04 确认 `ModelTool` 结构化校验能拦截多字段、缺字段、字段类型错误等模型输出。已补强 `additionalProperties=false` 的额外字段拦截并完成 Node 验证。
- [x] P4-05 增加 mock/compat 模式下的最小可用草稿输出，便于无真实模型密钥时跑回归。已在 `draft-output` 增加合同审查 compat payload。
- [x] P4-06 用样例合同文本或最小测试文件跑通 `draft_business_output -> validate_output`。已用最小 xlsx 合同样本跑通完整 LangGraph，并通过 mock validator 返回成功。

#### P5. 回归、发布与外部文档

- [x] P5-01 新增 `tests/fixtures/self-contained/non-standard-contract-risk-review.smoke.request.json`，覆盖 JSON `baseFile` 调试入参。已新增 docx baseFile smoke fixture 并通过解析脚本验证。
- [x] P5-02 更新 self-contained manifest 或新增验证脚本，把新场景纳入回归。已更新 `tests/fixtures/self-contained/manifest.json`。
- [x] P5-03 执行 `npm run check`，并修复平台配置、结构校验和回归问题。已通过 `npm run check`。
- [x] P5-04 执行 `node scripts/verify_bundle_renderer.js` 和 release validator 相关脚本，确认新资源进入发布 bundle。已导入 MySQL 配置中心并发布 active bundle；`verify_active_bundle_scene_config`、`verify_bundle_renderer`、`verify_release_validator` 均通过。
- [x] P5-05 新增 `docs/场景外部对接文档/non-standard-contract-risk-review外部API对接文档.md`。已新增外部 API 对接文档。
- [x] P5-06 在外部文档中明确返回体只有 `approvalAdvice` 与 `riskPoints`，并给出 curl 示例。已补充成功/失败响应与 curl 示例。
- [x] P5-07 如本地服务可用，使用 `curl POST /api/agent/run` 跑一次 smoke 请求，记录 requestId 和结果摘要。已实跑成功，requestId=`req_20260521_103950802_19063846`，返回 `approvalAdvice` 和 `riskPoints`。

## 4. 数据模型 / 接口约定

### 4.1 请求结构

统一入口支持正式文件上传和 JSON 调试兼容两种形态。

```text
POST /api/agent/run
Content-Type: multipart/form-data
```

正式对接推荐字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `scene` | `string` | 是 | 固定为 `non-standard-contract-risk-review` |
| `baseFile` | `file` | 和 `baseFileURL` 二选一 | 合同文件，优先级高于 `baseFileURL` |
| `baseFileURL` | `string` | 和 `baseFile` 二选一 | 合同文件 URL，仅支持 `http`/`https` |

JSON 调试兼容请求体：

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

字段约束：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `scene` | `string` | 是 | 固定为 `non-standard-contract-risk-review` |
| `bizParams.baseFile` | `object` | 和 `baseFileURL` 二选一 | JSON 调试兼容文件对象，内部字段为 `fileName/fileContentBase64/fileMimeType` |
| `bizParams.baseFileURL` | `string` | 和 `baseFile` 二选一 | 合同文件 URL |

### 4.2 成功响应结构

最终 `data` 只返回两个业务字段：

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

### 4.3 输出 Schema 草案

```json
{
  "type": "object",
  "required": ["approvalAdvice", "riskPoints"],
  "properties": {
    "approvalAdvice": {
      "type": "string",
      "minLength": 0,
      "maxLength": 2000
    },
    "riskPoints": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 1000
      },
      "maxItems": 20
    }
  },
  "additionalProperties": false
}
```

### 4.4 现有链路复用点与新增点

可复用能力：

- `POST /api/agent/run` 统一入口仍由 `routes/agent.js` 承载。
- `scene-configs/*.json` 继续提供场景注册、路由、输入契约和引用资产。
- `platform/templates/prompt-structured-extraction.v1.yaml` 的单轮结构化生成思路可复用，但本场景需要增加文件解析节点。
- `services/request-validation.js` 与 `platform/nodes/validate-input.js` 可复用为输入校验入口。
- `platform/nodes/load-assets.js` 可继续读取 prompt 和 output schema。
- `platform/nodes/draft-output.js` 与 `platform/runtime/llm-client.js` 可继续执行项目 LLM 结构化 JSON 生成。
- `platform/nodes/validate-output.js` 与 `ModelTool` 可继续做输出 schema 校验。

必须新增能力：

- 文件型入参校验，包含 `baseFile/baseFileURL` 二选一、后缀白名单和大小限制。
- 一次性合同文件解析节点，负责把图片、`.doc`、`.docx`、`.wps`、`.pdf`、`.ofd`、`.xlsx` 转成可审查文本。
- 面向合同审查的 `WorkflowTemplate`，在输入校验后、模型生成前插入文件解析。
- 面向合同审查的 `BusinessSkill`、LLM tool、prompt、schema 和 scene config。
- compat/mock 模式下的稳定输出，避免没有模型密钥时回归不可跑。

## 5. 任务卡片

### T1. 契约冻结与场景资源草稿

目标：冻结 `非标合同风险审查` 的最小输入输出协议和配置资源落点。

重点文件：

- `scene-configs/non-standard-contract-risk-review.json`
- `platform/skills/non-standard-contract-risk-review.v1.yaml`
- `references/non-standard-contract-risk-review/output_schema.json`
- `references/non-standard-contract-risk-review/prompt.md`
- `docs/场景外部对接文档/non-standard-contract-risk-review外部API对接文档.md`

实现要求：

- 场景 ID 使用 `non-standard-contract-risk-review`。
- 输出 schema 只允许 `approvalAdvice` 和 `riskPoints`。
- prompt 明确禁止输出额外字段、Markdown 和解释性文字。

验收：

```bash
npm run lint:platform-configs
```

### T2. 文件入参校验

目标：让统一入口能安全接收合同文件。

重点文件：

- `services/request-validation.js`
- `platform/nodes/validate-input.js`
- `routes/agent.js`
- `tests/fixtures/self-contained/non-standard-contract-risk-review.smoke.request.json`

实现要求：

- 支持正式 `multipart/form-data` 文件字段 `baseFile`。
- 支持 `baseFileURL`，并按 `baseFile > baseFileURL` 处理优先级。
- 支持 JSON 调试兼容格式 `bizParams.baseFile.fileName/fileContentBase64/fileMimeType`。
- 限制后缀为 `.bmp`、`.jpg`、`.jpeg`、`.png`、`.tif`、`.tiff`、`.doc`、`.docx`、`.wps`、`.pdf`、`.ofd`、`.xlsx`。
- 限制文件大小，默认不超过 `50MB`，实际阈值可用环境变量覆盖。
- base64 解码失败时返回 `INVALID_REQUEST`。

验收：

```bash
node -c services/request-validation.js
npm run check
```

### T3. 合同文件解析节点

目标：把合同文件转换为模型可审查文本。

重点文件：

- `platform/nodes/extract-contract-document.js`
- `platform/runtime/graphs/index.js`
- `rag-service/rag_mvp/parsers.py`
- `rag-service/requirements.txt`

实现要求：

- 图片读取 OCR 文本。
- `.doc` / `.wps` 优先通过系统转换器提取文本。
- `.docx` 读取段落和表格。
- `.pdf` 优先读取可选中文本，必要时沿用现有 OCR 能力。
- `.ofd` 优先通过固定版式解析器提取文本，失败时读取 OFD XML 文本节点。
- `.xlsx` 读取工作表、行列和单元格文本。
- 解析结果写入 `artifacts.document`，包含 `text`、`fileName`、`sourceType`、`charCount`、`warnings`。
- 不把文件导入 RAG 文档库，不长期保存原件。

验收：

```bash
node -c platform/runtime/graphs/index.js
npm run check
```

### T4. 模型审查与结构化输出

目标：让模型基于解析文本生成精简审批建议和风险点。

重点文件：

- `platform/tools/project-contract-risk-review-llm.tool.yaml`
- `platform/runtime/llm-client.js`
- `platform/nodes/draft-output.js`
- `ModelTool/services/structured-output-validator.js`

实现要求：

- LLM 请求 payload 能拿到解析后的合同文本。
- 真实模型模式下只返回符合 schema 的 JSON。
- compat/mock 模式下可返回稳定示例，便于回归。
- 校验工具能拒绝额外字段和错误类型。

验收：

```bash
npm run lint:platform-configs
npm run regression:no-retired-runtime
```

### T5. 发布链路与外部对接文档

目标：新场景能进入配置校验、发布 bundle 和外部联调说明。

重点文件：

- `scripts/verify_bundle_renderer.js`
- `scripts/verify_active_bundle_scene_config.js`
- `scripts/verify_release_validator.js`
- `server.js`
- `docs/场景外部对接文档/non-standard-contract-risk-review外部API对接文档.md`

实现要求：

- 新 scene config、BusinessSkill、tool、prompt、schema 都能进入 bundle。
- `/health` 能覆盖新场景编译检查。
- 外部文档给出请求字段、成功响应、失败响应、curl 示例。

验收：

```bash
npm run check
node scripts/verify_bundle_renderer.js
node scripts/verify_active_bundle_scene_config.js
node scripts/verify_release_validator.js
```

## 6. 统一 Agent 执行提示词

```text
你正在 /Users/gato-pm/Desktop/API_副本 工作。

目标：
新增“非标合同风险审查”场景，通过 POST /api/agent/run 接收图片、doc/docx/wps/pdf/ofd/xlsx 合同文件，解析后交给大模型审查，最终只返回 approvalAdvice 和 riskPoints 两个业务字段。

唯一事实来源：
docs/项目开发文档/非标合同风险审查场景Agent任务清单.md

执行规则：
1. 先阅读这份任务清单。
2. 进入“可轮询子任务清单”。
3. 找到第一个未完成的 `- [ ]` 子任务。
4. 只执行该子任务以及完成它所必需的最小关联改动。
5. 运行该子任务对应的验收命令或最小验证。
6. 验证通过后，把该项改成 `- [x]`，并在同一行末尾追加简短完成说明。
7. 如果被外部依赖阻塞，不要猜测实现，保持未勾选并追加 `BLOCKED: <原因>`。
8. 不要把失败或未验证的工作标记为完成。
9. 如果时间和上下文允许，可以继续处理下一个未勾选子任务。

约束：
- 复用现有 agent-runtime、LangGraph、BusinessSkill、ToolDefinition、ModelTool 校验链路。
- 不新增旁路运行时。
- 不把合同文件导入 RAG 知识库或长期持久化。
- 不扩展输出字段，最终业务 payload 只能包含 approvalAdvice 和 riskPoints。
- 不回滚无关用户改动。

常用验证命令：
- npm run lint:platform-configs
- npm run check
- npm run regression:no-retired-runtime
- node scripts/verify_bundle_renderer.js
- node scripts/verify_active_bundle_scene_config.js
- node scripts/verify_release_validator.js

完成后汇报：
- 完成的子任务 ID
- 修改的文件
- 新增或变更的 API / scene / tool
- 运行过的验证命令和结果
- 已知限制或阻塞点
```

## 7. 最终验收标准

- `POST /api/agent/run` 支持 `scene=non-standard-contract-risk-review`。
- 请求可携带图片、`.doc`、`.docx`、`.wps`、`.pdf`、`.ofd`、`.xlsx` 合同文件内容。
- 非法后缀、非法 base64、空文件、解析不到文本时返回统一失败 envelope。
- 成功响应 `data` 只包含 `approvalAdvice` 和 `riskPoints`。
- `output_schema.json` 设置 `additionalProperties=false`。
- 新场景可通过平台配置校验和图编译。
- 新场景资源可进入 release bundle。
- 外部 API 对接文档包含 curl 示例和错误说明。
