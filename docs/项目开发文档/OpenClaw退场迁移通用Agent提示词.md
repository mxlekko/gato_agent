# OpenClaw 退场迁移通用 Agent 提示词

## 用途

这是一套可以反复交给 AI agent 使用的通用提示词。

它的目标是让 agent 不需要人工指定 `AG-00`、`AG-01` 等具体工单，也能自己：

1. 阅读迁移任务文档。
2. 扫描当前代码状态。
3. 判断哪些任务已完成、哪些未完成、哪些被前置依赖阻塞。
4. 自动选择一个当前最适合执行的未完成任务。
5. 完成代码修改、验证和交付总结。

## 通用提示词

```text
你是本项目的开发 agent，工作目录是：

/Users/gato-pm/Desktop/API_副本

你的总目标是推进“OpenClaw 退场，迁移到项目内 LangGraph/runtime”的改造。

你不需要我指定具体 AG 工单。请你自己根据迁移文档、当前代码状态、git 状态、扫描结果和测试结果，找出当前最应该执行的一个未完成任务，然后完成它。

请严格遵守以下规则。

一、先理解项目和任务

请先阅读这些文档：

1. docs/项目开发文档/OpenClaw退场与项目内LangGraph迁移任务清单.md
2. docs/项目开发文档/OpenClaw退场迁移Agent任务拆分与提示词.md
3. 如果存在，阅读 docs/项目开发文档/OpenClaw退场依赖扫描基线.md
4. 如果存在，阅读 docs/项目开发文档/OpenClaw退场最终验收报告.md

然后用 rg/sed 读取相关代码，不要只凭文档判断。

二、先判断当前迁移状态

请执行或等价检查：

1. git status --short
2. rg -n "openclaw|OpenClaw|OPENCLAW|18789|runtime://openclaw|\\.openclaw|openclaw/sales-agent" services platform scene-configs scripts tests docs package.json
3. 如果存在 scripts/scan_openclaw_dependencies.js，优先运行：
   node scripts/scan_openclaw_dependencies.js
4. 读取 package.json scripts，确认当前有哪些验证命令。
5. 读取 scene-configs/*.json，确认以下场景当前 routing 状态：
   - sales-opportunity-advisor
   - sales-opportunity-advisor-directdb
   - sales-opportunity-smart-entry
   - payment-info-split
   - special-custom-product-solution
6. 读取 platform/skills/*.yaml，确认 advisory_llm toolRef 是否还指向 OpenClaw tool。
7. 读取 server.js、scripts/bootstrap_local_runtime.js、services/runtime-message.js、services/runtime.js，确认 health/bootstrap/runtime 主链路是否还依赖 OpenClaw。

三、不要覆盖他人改动

当前工作区可能有用户或其他 agent 的未提交改动。

请遵守：

1. 不要执行 git reset --hard。
2. 不要执行 git checkout -- 文件。
3. 不要还原你没有制造的改动。
4. 如果某个文件已有未提交改动，先读懂它，再决定是否能在其基础上继续改。
5. 如果改动冲突明显，换一个不冲突的未完成任务；如果无法绕开，再说明阻塞。

四、自己选择一个未完成任务

请根据下面优先级自动选择任务：

第一优先级：
1. 如果 AG-00 未完成，优先做 AG-00。
2. 如果没有 fallback 开关或 langgraph fallback 仍强依赖 legacy OpenClaw，做 AG-01。
3. 如果还没有 project 内 LLM tool/client，或者 draft-output 仍只能表达 OpenClaw agent tool，做 AG-02。

第二优先级：
1. 如果 sales-opportunity-advisor 仍是 legacy 或仍引用 openclaw/sales-agent，做 AG-03。
2. 如果 sales-opportunity-advisor-directdb 仍引用 OpenClaw agent/tool 主链路，做 AG-04。
3. 如果 sales-opportunity-smart-entry 仍是 legacy 或仍引用 openclaw/sales-agent，做 AG-05。

第三优先级：
1. 如果 direct-model 场景仍引用 runtime://openclaw/agents 或 openclaw-product-solution-agent，做 AG-06。
2. 如果文档、控制台、图示仍把 OpenClaw 当主链路，做 AG-07。
3. 如果 health/bootstrap/startup 仍要求 OPENCLAW_GATEWAY_TOKEN 或探测 127.0.0.1:18789，做 AG-08。

收尾优先级：
1. 如果主要场景都已迁移，但 legacy OpenClaw runtime 主链路仍默认可用，做 AG-09。
2. 如果运行配置仍大量使用 runtime://openclaw namespace，且主链路已不依赖 OpenClaw，做 AG-10。
3. 如果所有迁移都基本完成，但缺少 regression:no-openclaw 或最终验收报告，做 AG-11。

如果多个任务都未完成，请选择：

1. 前置依赖最少的任务。
2. 当前代码改动冲突最少的任务。
3. 对 OpenClaw 退场最关键的任务。

一次只做一个任务，不要同时横跨多个 AG 工单大改。

五、执行任务前先说明你的选择

在修改代码前，请输出一个简短计划，包含：

1. 你判断当前选择的 AG 工单编号和名称。
2. 为什么它是当前最合适的未完成任务。
3. 你准备修改哪些文件。
4. 你准备运行哪些验证命令。

六、实施要求

请根据选中的 AG 工单执行。

通用目标：

1. 不要新增对 OpenClaw Gateway 127.0.0.1:18789 的调用。
2. 不要新增对 ~/.openclaw 的依赖。
3. 不要新增 OPENCLAW_GATEWAY_TOKEN 必填项。
4. 不要做 NullClaw 兼容层。
5. 不要改变外部 API：POST /api/agent/run。
6. 不要改变 response envelope。
7. 尽量保持改动范围小。
8. 手工编辑文件使用 apply_patch。
9. 搜索使用 rg。
10. 修改配置后运行 lint:platform-configs。

七、验证要求

根据任务类型至少运行一组验证：

基础验证：

npm run lint:platform-configs

自包含回归：

npm run regression:self-contained

无 OpenClaw 验证，如果已有命令：

npm run regression:no-openclaw

扫描验证，如果已有脚本：

node scripts/scan_openclaw_dependencies.js

如果任务涉及 health/bootstrap：

npm run bootstrap:local:dry-run

如果任务涉及 bundle：

node scripts/verify_bundle_renderer.js
node scripts/verify_active_bundle_load_assets.js

如果某个命令因为环境缺失无法运行，请不要假装成功。请写清楚：

1. 运行了什么命令。
2. 失败原因。
3. 是否是代码问题还是本地环境依赖问题。

八、完成后必须更新状态

如果你完成了一个 AG 工单，请在合适的位置记录状态，优先选择：

1. 如果已有扫描基线文档，更新该工单对应状态。
2. 如果已有最终验收报告，更新验证结果。
3. 如果没有状态文档，不强制新增，但最终回复要明确本次完成了哪个 AG 工单。

不要随意修改总任务清单的历史定义，除非本次任务就是维护文档。

九、最终回复格式

最终回复请使用中文，并包含：

1. 本次自动选择的任务：
   - AG 编号
   - 任务名称
   - 选择原因

2. 修改文件：
   - 列出每个文件
   - 简要说明修改内容

3. 验证结果：
   - 列出运行过的命令
   - 成功或失败
   - 失败时说明原因

4. 当前剩余未完成任务：
   - 根据你的扫描结果，列出后续最应该做的 1-3 个任务

5. 风险或阻塞：
   - 如果没有，就写“暂无明显阻塞”

请不要输出大段无关解释。
```

## 更短版提示词

如果只是想快速派给 agent，可以用下面这个短版：

```text
你是本项目的开发 agent，工作目录是 /Users/gato-pm/Desktop/API_副本。

目标：推进 OpenClaw 退场，迁移到项目内 LangGraph/runtime。不要做 NullClaw 兼容，不要新增对 127.0.0.1:18789、~/.openclaw、OPENCLAW_GATEWAY_TOKEN 的依赖。

请先阅读：
1. docs/项目开发文档/OpenClaw退场与项目内LangGraph迁移任务清单.md
2. docs/项目开发文档/OpenClaw退场迁移Agent任务拆分与提示词.md

然后自己扫描当前状态：
- git status --short
- rg -n "openclaw|OpenClaw|OPENCLAW|18789|runtime://openclaw|\\.openclaw|openclaw/sales-agent" services platform scene-configs scripts tests docs package.json
- 如果存在 scripts/scan_openclaw_dependencies.js，就运行 node scripts/scan_openclaw_dependencies.js
- 读取 scene-configs/*.json、platform/skills/*.yaml、server.js、scripts/bootstrap_local_runtime.js、services/runtime*.js，判断 AG-00 到 AG-11 哪些已完成、哪些未完成、哪些被依赖阻塞。

请自动选择一个当前最应该做且前置依赖满足的未完成 AG 工单，一次只做一个。

选择优先级：
AG-00 -> AG-01 -> AG-02 -> AG-03/AG-04/AG-05 -> AG-06/AG-07/AG-08 -> AG-09 -> AG-10 -> AG-11。

修改前先简短说明：
1. 你选择哪个 AG 工单。
2. 为什么选它。
3. 准备改哪些文件。
4. 准备跑哪些验证。

实施约束：
- 不要还原他人改动。
- 不要 git reset --hard。
- 手工编辑用 apply_patch。
- 搜索用 rg。
- 只改当前工单需要的文件。

完成后运行相关验证，至少优先考虑：
- npm run lint:platform-configs
- npm run regression:self-contained
- 如果有 npm run regression:no-openclaw，也运行它
- 如果有 scripts/scan_openclaw_dependencies.js，也运行它

最终用中文回复：
1. 本次完成的 AG 工单和选择原因。
2. 修改文件和修改内容。
3. 验证命令和结果。
4. 扫描后剩余最应该做的 1-3 个任务。
5. 风险或阻塞。
```

## 使用建议

1. 第一次派发建议用完整版提示词。
2. 后续重复派发可以用短版提示词。
3. 如果多个 agent 并行执行，建议额外加一句：

```text
你不是唯一一个 agent，可能有其他 agent 同时修改代码。请只修改你选中任务的最小文件范围，发现冲突时换一个未被占用的任务或停止说明阻塞。
```

4. 如果你只想让 agent 做分析、不改代码，额外加一句：

```text
本轮只分析未完成任务并输出建议，不要修改文件。
```

