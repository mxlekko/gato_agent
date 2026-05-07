# 模板化新增场景改造 Agent 任务清单

## 1. 总目标

将当前“维护已有场景”的场景编排平台，改造成支持“新增模板化场景”的平台能力。

一期完成后，平台需要支持以下闭环：

```text
新增场景
-> 选择模板
-> 填写场景基本信息
-> 配置输入、输出、查询和业务资产
-> 生成草稿
-> 编译预览
-> 发布
-> active runtime 调用
```

## 2. 本期边界

### 2.1 本期要做

- 支持模板化新增场景。
- 支持新场景只有草稿、尚未发布的状态。
- 支持基于既有 WorkflowTemplate 生成 scene config、BusinessSkill 和场景资产草稿。
- 支持新增 QueryProfile，并优先绑定已有 `tool://data/generic-query-runner@v1`。
- 支持新增场景进入现有配置校验、编译预览、发布和运行链路。
- 前端提供“新增场景”入口和向导页面。

### 2.2 本期不做

- 不做 AI 自然语言生成场景。
- 不做自由拖拽流程画布。
- 不做任意 SQL 编辑。
- 不做复杂 join、subquery、多语句或写查询。
- 不做外部数据源凭据管理。
- 不做新外部工具的自动探测和自动注册。

### 2.3 二期预留

二期再做 AI 智能新增场景，例如：

```text
POST /api/console/scenes/generate-preview
```

二期 AI 能力必须复用一期的结构化草稿协议、校验链路和发布链路，不另起一套旁路逻辑。

## 3. 推荐执行顺序

1. 支持未发布场景。
2. 增加模板列表 API。
3. 增加场景草稿生成器。
4. 增加创建场景 API。
5. 增加 QueryProfile 创建能力。
6. 增加前端新增场景向导。
7. 适配场景详情页。
8. 适配发布链路。
9. 增加回归测试和验收脚本。

### 3.1 可轮询子任务清单

下面清单用于 agent 连续执行。每个子任务完成后，把对应的 `- [ ]` 改为 `- [x]`，并在同一行末尾补充简短结果，例如 `已通过 npm run check`。

状态约定：

- `[ ]`：未开始或未完成。
- `[x]`：已完成，并通过该子任务要求的最小验证。
- 若任务被阻塞，不要勾选，在该行后追加 `BLOCKED:` 和阻塞原因。

#### P1. 后端基础能力

- [x] P1-01 盘点现有场景生命周期，确认 `console-scenes`、`scene-config`、`release-validator`、`bundle-renderer` 和 config-store 的调用关系。已确认草稿、发布、运行链路和未发布阻塞点，见 3.2。
- [x] P1-02 修改未发布场景处理逻辑：本地 `scene-configs/{scene}.json` 不存在时返回 `published = null`，场景列表和详情 API 不报错。已通过 `npm run check`。
- [x] P1-03 调整 `buildSceneConfigState`、`getConsoleSceneCatalog`、`getConsoleSceneWorkflow` 返回结构，明确表达“未发布”。已返回 `publishState`、`hasPublishedSnapshot`，并通过 `npm run check`。
- [x] P1-04 增加场景模板读取能力，从现有场景配置和 BusinessSkill 抽象可用于新增场景的模板摘要。已改为输出五个场景模板，并通过模板摘要调用与验证脚本。
- [x] P1-05 增加 `GET /api/console/scene-templates`，并接入 `server.js` 与 `console/src/services/apiClient.js`。已通过 route 直调、`npm run check`、`npm --prefix console run build`。
- [x] P1-06 新增 `services/scene-draft-generator.js` 骨架，完成 sceneId、templateRef、唯一性校验。已新增校验骨架并通过轻量直测与 `npm run check`。
- [x] P1-07 实现不带查询的最小场景草稿生成：scene config、BusinessSkill、prompt、schema 基础草稿。已生成不落库草稿包并通过轻量直测与 `npm run check`。
- [x] P1-08 增加 `POST /api/console/scenes` 最小版本，能创建纯文本结构化抽取场景草稿。已接入 API，保存链路用假 store 验证，未写测试数据到 MySQL；通过语法检查、`npm run check`、`npm --prefix console run build`。
- [x] P1-09 执行 `npm run check`，并修复 P1 引入的问题。P1 完整链路已通过 `npm run check`。

#### P2. QueryProfile 与查询增强场景

- [x] P2-01 设计并实现新建场景请求中的 `queryProfile` 规范化逻辑。已实现受控规范化并通过轻量直测。
- [x] P2-02 生成受控 QueryProfile 草稿，固定绑定 `tool://data/generic-query-runner@v1`。已生成 `QueryProfile` 平台资源草稿并固定 toolRef。
- [x] P2-03 增加 QueryProfile 安全校验：只读、参数化、必须 limit、禁止 raw SQL、禁止 join、禁止 subquery、禁止 write、禁止多语句。已在请求规范化和生成约束中拦截。
- [x] P2-04 在 BusinessSkill 草稿中写入 `spec.dataBindings.queryProfileRef`、`inputMapping` 和 `expectedResultPath`。已写入查询增强草稿。
- [x] P2-05 支持查询增强模板创建完整草稿包，并确保编译预览能解析新 QueryProfile。已通过轻量编译直测解析 `data_profile.queryProfile`。
- [x] P2-06 补充重复 QueryProfile、非法 where、缺少 limit 的错误处理。已通过轻量错误分支直测。
- [x] P2-07 执行 `npm run check` 和 `node scripts/verify_bundle_renderer.js`，并修复 P2 引入的问题。已通过 `npm run check` 和 `node scripts/verify_bundle_renderer.js`。

#### P3. 前端新增场景向导

- [x] P3-01 在 `apiClient` 增加模板列表和创建场景方法。已确认 `listSceneTemplates()` 与 `createScene()` 可用。
- [x] P3-02 在 `App.jsx` 增加 `/scenes/new` 路由。已接入新增场景页面。
- [x] P3-03 在 `ScenesPage` 增加“新增场景”入口，并保持现有列表交互不退化。已增加入口并保留原列表跳转。
- [x] P3-04 新增 `NewScenePage.jsx`，实现基本信息、场景模板选择、输入输出配置、资产配置、查询配置、RAG 策略、编译预览并保存草稿。已新增向导页并调用创建 API 保存草稿。
- [x] P3-05 新增场景向导根据模板能力展示或隐藏查询配置，不做 AI 生成和自由拖拽。已按 `requiresQueryProfile` 控制查询表单。
- [x] P3-06 保存成功后跳转 `/scenes/{scene}`，失败时展示后端错误详情。已实现成功跳转和错误详情展示。
- [x] P3-07 适配 `SceneWorkflowPage`，让未发布场景显示“未发布”、草稿存储位置和当前发布状态。已补充发布状态显示。
- [x] P3-08 执行 `npm --prefix console run build`，并修复 P3 引入的问题。已通过 `npm --prefix console run build`。

#### P4. 发布链路与运行闭环

- [x] P4-01 检查 release entries 构建逻辑，确认新 scene config、BusinessSkill、assets、QueryProfile 都进入 release bundle。已通过新增验证脚本确认渲染后资源计数包含新 skill/query/assets。
- [x] P4-02 适配 `bundle-renderer` 和 `release-validator`，确保未发布草稿可以作为新发布内容进入 bundle。已支持模板新增场景授权校验和草稿资产解析。
- [x] P4-03 发布后确认 `getSupportedScenes()` 能从 active bundle 读取新场景。已在临时 active bundle 中验证新增场景可见。
- [x] P4-04 发布后确认 `/api/agent` 不因为 unsupported scene 拒绝新场景。已在临时 active bundle 中通过 `validateAgentRunRequest`。
- [x] P4-05 新增 `scripts/verify_create_template_scene.js`，覆盖纯文本抽取场景和查询增强场景。已新增并通过脚本验证。
- [x] P4-06 在验证脚本中覆盖重复 sceneId、模板不存在、QueryProfile 非法配置、未发布场景详情读取。已覆盖重复、模板缺失、缺少 limit、非法 where 和未发布详情。
- [x] P4-07 执行完整验证：`npm run check`、`npm --prefix console run build`、`node scripts/verify_bundle_renderer.js`、`node scripts/verify_active_bundle_scene_config.js`、`node scripts/verify_release_validator.js`。已全部通过。

#### P5. 文档与交付

- [x] P5-01 更新接口文档或 README，记录 `GET /api/console/scene-templates` 和 `POST /api/console/scenes`。已更新 README。
- [x] P5-02 补充新建场景示例请求，包括纯文本抽取和客户投诉归因查询增强场景。已在 README 补充两个 curl 示例。
- [x] P5-03 记录本期限制：无 AI 生成、无自由拖拽、无任意 SQL、无外部凭据管理。已在 README 记录一期限制。
- [x] P5-04 输出最终修改文件清单、验证结果和已知风险。将在本轮最终回复输出。

### 3.2 现有场景生命周期盘点

当前场景生命周期分为控制台草稿、发布渲染和运行时读取三条链路：

- 控制台草稿链路：`services/console-scenes.js` 固定使用 MySQL config-store，场景配置来自 `cfg_scene_configs`，平台资源来自 `cfg_platform_resources`，场景资产来自 `cfg_scene_assets`。`getConsoleSceneCatalog()` 先列出草稿场景，再用 `buildSceneWorkflow()` 基于草稿 scene config 和草稿平台资源编译展示 workflow。
- 发布态对比链路：`console-scenes` 里的 `getPublishedSceneConfigSnapshot(scene)` 当前通过 `resolveSceneConfigFilePath(scene)` 读取 active bundle 或仓库 fallback 下的 `scene-configs/{scene}.json`。这个函数现在强依赖本地发布文件存在，是新建未发布场景的首个阻塞点。
- 发布渲染链路：`services/release-manager.js` 从 config-store 收集 `scene-config`、`platform-resource`、`scene-asset`、`helper-script` release entries；`services/bundle-renderer.js` 将这些 entries 渲染为 release bundle 中的 `scene-configs/*.json`、`platform/**/*.yaml`、业务资产和 helper manifest。
- 发布校验链路：`services/release-validator.js` 扫描 bundle 中的 scene config、平台资源和资产路径，校验 agent-runtime/langgraph 约束，并通过 `compileWorkflowGraphForScene()` 对 bundle 内每个 agent-runtime scene 做编译预览。
- 运行时读取链路：`services/scene-config.js` 优先读取 `.local/runtime-bundles/{env}/current/scene-configs`，不存在时回退到仓库 `scene-configs`。`getSupportedScenes()` 和 `/api/agent` 都来自这条链路，因此新场景只有发布进 active bundle 后才会被运行时识别。

对一期新增场景的直接影响：

- 未发布场景必须允许 `published = null`，不能要求 `scene-configs/{scene}.json` 已存在。
- 控制台详情页应继续基于草稿 scene config 和草稿平台资源编译 workflow。
- 发布后仍应复用现有 release-manager、bundle-renderer、release-validator、scene-config active bundle 链路，不新增旁路运行时。

## 4. 数据模型约定

### 4.1 新建场景请求示例

```json
{
  "scene": "customer-complaint-attribution",
  "title": "客户投诉归因",
  "description": "根据投诉文本和客户历史订单生成归因、责任部门和建议动作。",
  "templateRef": {
    "name": "grounded-structured-advisory",
    "version": "v1"
  },
  "inputContract": {
    "required": ["complaintText", "customerId"],
    "fields": {
      "complaintText": {
        "type": "string",
        "sourcePath": "request.bizParams.complaintText"
      },
      "customerId": {
        "type": "string",
        "sourcePath": "request.bizParams.customerId"
      }
    }
  },
  "outputSchema": {
    "type": "object",
    "required": ["attribution", "responsibleDepartment", "suggestedActions"],
    "properties": {
      "attribution": {
        "type": "string"
      },
      "responsibleDepartment": {
        "type": "string"
      },
      "suggestedActions": {
        "type": "array",
        "items": {
          "type": "string"
        }
      }
    }
  },
  "queryProfile": {
    "enabled": true,
    "name": "customer-orders-by-customer-id",
    "title": "客户历史订单查询",
    "primaryEntity": {
      "table": "t_customer_order",
      "idField": "customerId"
    },
    "where": [
      {
        "field": "customerId",
        "operator": "equals",
        "param": "customerId"
      }
    ],
    "resultPolicy": {
      "mode": "multi-rows",
      "fields": ["*"],
      "limit": 20
    },
    "outputPolicy": {
      "resultPath": "data.orders"
    }
  }
}
```

### 4.2 新增资源落点

新建场景至少需要写入以下草稿：

- `cfg_scene_configs`
- `cfg_platform_resources`
- `cfg_scene_assets`

如生成查询配置，还需要在 `cfg_platform_resources` 中新增 `QueryProfile` 草稿。

## 5. 任务卡片

### T1. 支持未发布场景

目标：新建场景只有配置中心草稿、没有 `scene-configs/{scene}.json` 时，场景列表和详情页不报错。

重点文件：

- `services/console-scenes.js`
- `services/scene-config.js`
- `services/release-validator.js`
- `console/src/pages/scenes/ScenesPage.jsx`
- `console/src/pages/scenes/SceneWorkflowPage.jsx`

实现要求：

- `getPublishedSceneConfigSnapshot(scene)` 在本地文件不存在时返回 `null`，不要抛出业务错误。
- `buildSceneConfigState` 支持 `published: null`。
- `publishedCurrent` 在未发布场景下返回 `null`。
- 场景列表支持展示“未发布”状态。
- 场景详情页可以基于草稿 scene config 渲染 workflow。
- 已有已发布场景行为不能变化。

验收：

```bash
npm run check
npm --prefix console run build
```

### T2. 增加模板列表 API

目标：前端可以读取可用于新建场景的模板列表。

新增接口：

```text
GET /api/console/scene-templates
```

重点文件：

- `scene-configs/*.json`
- `platform/skills/*.yaml`
- `platform/templates/*.yaml`
- `services/console-scenes.js`
- `routes/console-scenes.js`
- `server.js`
- `console/src/services/apiClient.js`

返回字段建议：

```json
{
  "items": [
    {
      "name": "sales-opportunity-advisor",
      "version": "v1",
      "title": "销售机会推进建议（helper）模板",
      "description": "...",
      "sourceScene": "sales-opportunity-advisor",
      "workflowTemplateRef": {
        "name": "grounded-structured-advisory",
        "version": "v1"
      },
      "orderedNodeIds": ["bootstrap_runtime", "..."],
      "requiresQueryProfile": true,
      "requiresRag": false,
      "supportedAssetTypes": ["prompt", "schema", "dictionary", "rules"]
    }
  ]
}
```

模板识别规则：

- 对外展示的模板是场景模板，例如 `payment-info-split@v1`、`sales-opportunity-advisor@v1`、`sales-opportunity-smart-entry@v1`。
- 每个场景模板来自一个现有场景，包含该场景的实际启用节点、BusinessSkill 绑定、资产类型和默认输入输出契约。
- 底层 `WorkflowTemplate` 仍作为编译/运行协议存在，但不是新增页直接选择的模板。

验收：

```bash
curl http://127.0.0.1:3000/api/console/scene-templates
```

返回可用模板列表，且字段足够前端渲染模板选择页。

### T3. 增加场景草稿生成器

目标：封装模板化新建场景的后端核心逻辑。

建议新增文件：

```text
services/scene-draft-generator.js
```

职责：

- 校验 `scene` 合法性。
- 校验 scene 唯一性。
- 校验 `templateRef` 存在。
- 根据模板生成 scene config JSON document。
- 生成 BusinessSkill YAML document。
- 生成 prompt、schema、rules、dictionary 等场景资产草稿。
- 可选生成 QueryProfile document。
- 写入 config-store。
- 触发平台配置校验和编译预览。
- 返回新场景 workflow summary。

sceneId 校验建议：

- 只允许小写字母、数字和中划线。
- 必须以字母开头。
- 长度建议 3 到 80。
- 不允许与现有 scene config、草稿 scene config、BusinessSkill scene 冲突。

默认 scene config 要求：

```json
{
  "scene": "customer-complaint-attribution",
  "title": "客户投诉归因",
  "enabled": true,
  "status": "draft",
  "execution": {
    "mode": "agent-runtime"
  },
  "routing": {
    "mode": "langgraph",
    "allowedModes": ["langgraph"]
  },
  "skill": {
    "id": "customer-complaint-attribution",
    "version": "v1",
    "type": "main-skill"
  }
}
```

验收：

- 调用生成器可以生成完整草稿。
- 生成后 `getConsoleSceneCatalog()` 能返回新场景。
- 生成后 `getConsoleSceneWorkflow(scene)` 能返回 workflow。

### T4. 增加创建场景 API

目标：前端能够提交表单并创建模板化场景草稿。

新增接口：

```text
POST /api/console/scenes
```

重点文件：

- `routes/console-scenes.js`
- `services/console-scenes.js`
- `services/scene-draft-generator.js`
- `server.js`
- `console/src/services/apiClient.js`

成功响应建议：

```json
{
  "scene": "customer-complaint-attribution",
  "title": "客户投诉归因",
  "status": "draft",
  "published": null,
  "workflow": {
    "template": {
      "name": "grounded-structured-advisory",
      "version": "v1"
    },
    "orderedNodeIds": []
  },
  "validation": {
    "valid": true,
    "issueCount": 0
  },
  "compilePreview": {
    "orderedNodeCount": 0
  }
}
```

错误要求：

- 重复 sceneId 返回明确错误。
- 模板不存在返回明确错误。
- QueryProfile 不合法返回明确错误。
- 编译失败返回校验详情，不写入半成品；如果已写入部分资源，需要回滚或保证幂等可重试。

验收：

```bash
curl -X POST http://127.0.0.1:3000/api/console/scenes \
  -H 'Content-Type: application/json' \
  -d '{"scene":"customer-complaint-attribution","title":"客户投诉归因","templateRef":{"name":"grounded-structured-advisory","version":"v1"},"inputContract":{"required":["complaintText","customerId"]},"outputSchema":{"type":"object","properties":{}}}'
```

返回成功后，场景列表和详情页能看到新场景。

### T5. 增加 QueryProfile 创建能力

目标：查询增强模板可以在新建场景时新增查询配置。

重点文件：

- `services/scene-draft-generator.js`
- `services/console-configs.js`
- `platform/tools/README.md`
- `platform/tools/*.query.yaml`

约束：

- 只绑定 `tool://data/generic-query-runner@v1`。
- `toolRole` 固定为 `context_fetcher`。
- 只允许只读查询。
- 禁止 join。
- 禁止 subquery。
- 禁止 raw SQL。
- 禁止多语句。
- 禁止写操作。
- 必须有参数化 where。
- 必须有 `limit`。
- 默认 `generationConstraints.allowRawSqlConfig = false`。

生成示例：

```yaml
apiVersion: agent.platform/v1alpha1
kind: QueryProfile
metadata:
  name: customer-orders-by-customer-id
  version: v1
  title: 客户历史订单查询
  status: draft
spec:
  ref: query://customer-complaint/customer-orders-by-customer-id@v1
  toolRef: tool://data/generic-query-runner@v1
  toolRole: context_fetcher
  primaryEntity:
    table: t_customer_order
    idField: customerId
  inputContract:
    requiredInputs:
      - customerId
    fields:
      customerId:
        type: string
        sourcePath: request.bizParams.customerId
  selectionPolicy:
    cardinality: multi-records
    where:
      - field: customerId
        operator: equals
        param: customerId
    statement:
      type: select
      parameterPlaceholder: "@customerId"
  resultPolicy:
    mode: multi-rows
    fields:
      - "*"
    distinct: false
    limit: 20
  outputPolicy:
    resultPath: data.orders
  generationConstraints:
    allowJoin: false
    allowSubquery: false
    allowOrderBy: false
    allowWrite: false
    allowMultipleStatements: false
    allowRawSqlConfig: false
    allowInlineScript: false
  limits:
    timeoutMsDefault: 30000
    timeoutMsMax: 30000
    retryMaxAttempts: 1
```

验收：

- 新场景创建时能同时创建 QueryProfile 草稿。
- BusinessSkill 的 `spec.dataBindings.queryProfileRef` 正确引用新 QueryProfile。
- 编译预览能解析该 QueryProfile。

### T6. 前端新增场景向导

目标：用户可以从场景列表进入新增场景流程。

新增页面：

```text
/scenes/new
```

重点文件：

- `console/src/App.jsx`
- `console/src/pages/scenes/ScenesPage.jsx`
- `console/src/pages/scenes/NewScenePage.jsx`
- `console/src/services/apiClient.js`
- `console/src/styles.css`

向导步骤：

```text
1. 基本信息
2. 选择模板
3. 输入输出配置
4. 查询配置，可选
5. 编译预览并保存草稿
```

页面要求：

- 不做营销式 landing page，打开就是可操作的新建表单。
- 表单字段要和模板能力联动。
- 查询配置只在查询增强模板里展示。
- RAG 模板展示知识库绑定提示，但本期不做复杂 RAG 自动配置。
- 保存成功后跳转 `/scenes/{scene}`。
- 保存失败展示后端返回的具体错误。

验收：

- 场景列表有“新增场景”入口。
- 可以新建纯文本结构化抽取场景。
- 可以新建查询增强型场景。
- 保存成功后自动跳转详情页。

### T7. 场景详情页适配新场景

目标：未发布新场景在详情页可正常展示和继续编辑。

重点文件：

- `console/src/pages/scenes/SceneWorkflowPage.jsx`
- `console/src/pages/workflows/WorkflowIvrFlow.jsx`
- `console/src/pages/workflows/WorkflowNodeList.jsx`

要求：

- published path 为空时显示“未发布”，不要显示 `-` 后让用户误解。
- 展示草稿存储位置。
- 展示“当前发布：未发布”。
- 允许继续编辑业务技能绑定和场景资产。
- 编译失败时展示缺失项和可行动提示。
- 不影响已发布场景的发布态对比。

验收：

- 新建后立即进入详情页不报错。
- 流程图或节点列表能正常展示。
- 未发布状态表达清楚。

### T8. 发布链路适配新场景

目标：新场景可以被发布到 runtime bundle，并被 active runtime 支持。

重点文件：

- `services/bundle-renderer.js`
- `services/release-manager.js`
- `services/release-validator.js`
- `services/scene-config.js`
- `scripts/verify_bundle_renderer.js`
- `scripts/verify_active_bundle_scene_config.js`

要求：

- 新 scene config 写入 release bundle。
- 新 BusinessSkill 写入 release bundle。
- 新 Prompt、Schema、Rules、Dictionary 写入 release bundle。
- 新 QueryProfile 写入 release bundle。
- 发布后 `getSupportedScenes()` 包含新场景。
- `/api/agent` 不因为 unsupported scene 拒绝新场景。
- 已有 bundle 渲染和校验不能退化。

验收：

```bash
npm run check
node scripts/verify_bundle_renderer.js
node scripts/verify_active_bundle_scene_config.js
node scripts/verify_release_validator.js
```

发布后调用：

```bash
curl -X POST http://127.0.0.1:3000/api/agent \
  -H 'Content-Type: application/json' \
  -d '{"scene":"customer-complaint-attribution","bizParams":{"complaintText":"订单一直未发货，客服没有回复。","customerId":"C001"}}'
```

不能因为 unsupported scene 被拒绝。

### T9. 测试与回归

目标：新增场景能力有自动化保护。

建议新增脚本：

```text
scripts/verify_create_template_scene.js
```

覆盖场景：

- 新建纯文本结构化抽取场景。
- 新建查询增强场景。
- 重复 sceneId。
- 模板不存在。
- QueryProfile 缺少 where。
- QueryProfile 未设置 limit。
- 未发布场景详情读取。
- 新场景编译预览。
- 新场景发布后进入 active bundle。

最终验证命令：

```bash
npm run check
npm --prefix console run build
node scripts/verify_bundle_renderer.js
node scripts/verify_active_bundle_scene_config.js
node scripts/verify_release_validator.js
```

## 6. 统一 Agent 执行提示词

可将下面内容作为统一执行提示词。这个提示词的设计目标是：无论 agent 第几次接手，都先读取本文档，定位第一个未完成的 `- [ ]` 子任务，然后继续推进，不需要用户反复指定下一步。

```text
你在 /Users/gato-pm/Desktop/API_副本 仓库中工作。

总目标：
实现“模板化新增场景”一期能力，让场景编排平台支持通过模板新增场景，并进入草稿、编译、发布、运行闭环。

唯一任务来源：
docs/项目开发文档/模板化新增场景改造Agent任务清单.md

执行方式：
1. 先读取该文档。
2. 优先查看“3.1 可轮询子任务清单”。
3. 找到第一个仍是 `- [ ]` 的子任务。
4. 只执行这个子任务以及完成它所必需的最小关联改动。
5. 完成后运行该子任务要求的最小验证命令。
6. 验证通过后，把该子任务从 `- [ ]` 改成 `- [x]`，并在同一行末尾补充简短结果。
7. 如果验证失败，修复后重跑验证；不要把失败任务标记为完成。
8. 如果被外部条件阻塞，不要勾选，在该任务行末尾追加 `BLOCKED:` 和阻塞原因。
9. 完成当前子任务后，如果上下文和时间允许，继续寻找下一个 `- [ ]` 子任务并重复执行。

本期必须完成：
1. 支持未发布场景：新场景只有配置中心草稿、没有 scene-configs/{scene}.json 时，场景列表和详情页不能报错。
2. 增加模板列表 API：GET /api/console/scene-templates。
3. 增加模板化创建场景 API：POST /api/console/scenes。
4. 支持新增 QueryProfile，并绑定 tool://data/generic-query-runner@v1。
5. 增加前端 /scenes/new 新增场景向导。
6. 适配场景详情页显示未发布场景。
7. 适配发布链路，新场景发布后 active runtime 可以识别并调用。

重点保证：
1. 优先复用现有 config-store、release-manager、bundle-renderer、compile-workflow、console-scenes 体系。
2. 新增能力必须进入现有草稿、校验、编译、发布链路。
3. 不要新建旁路运行时。
4. 不要破坏已有场景。
5. 不要回滚用户已有改动。
6. 不要恢复 direct model、fallback runtime、shadow runtime 或 mockClient。
7. QueryProfile 必须受控：只读、参数化、必须 limit、禁止 raw SQL、禁止 join、禁止 subquery、禁止 write、禁止多语句。
8. 本期不做 AI 自然语言生成场景，不做自由拖拽流程画布，不做外部数据源凭据管理。

常用验证命令：
- npm run check
- npm --prefix console run build
- node scripts/verify_bundle_renderer.js
- node scripts/verify_active_bundle_scene_config.js
- node scripts/verify_release_validator.js

完成后请提供：
- 修改文件清单
- 新增接口说明
- 本轮完成的子任务编号
- 验证命令和结果
- 已知限制
```

## 7. 最终验收标准

一期完成后，必须跑通以下用户链路：

```text
打开场景列表
-> 点击新增场景
-> 选择模板
-> 填写基本信息
-> 配置输入输出
-> 可选配置查询
-> 保存草稿
-> 查看流程详情
-> 编译预览通过
-> 发布
-> active runtime 调用新 scene
```

同时满足：

- 已有场景仍可读取、编辑、发布和运行。
- 已退役 direct model / mockClient 路径不被恢复。
- 新增查询配置遵守受控 QueryProfile 约束。
- 二期 AI 生成场景可以复用一期创建 API 和草稿协议。
