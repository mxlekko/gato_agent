# MySQL 配置中心化改造运行基线清单

## 1. 基线快照信息

- 快照时间：`2026-04-16 11:16:04 +0800`
- 目的：冻结当前文件式配置中心的运行基线，作为后续 MySQL 配置中心化改造、发布 bundle 渲染、回归验证与回滚对照依据。

## 2. 本次冻结的主基线目录

本次任务按主文档要求，先冻结以下 4 类目录：

| 目录 | 当前文件数 | 用途 |
| --- | ---: | --- |
| `scene-configs` | 5 | 场景入口配置 |
| `platform` | 41 | 平台资源注册、模板、工具、技能与节点实现 |
| `runtime-assets/project-runtime/workspace` | 13 | legacy/retired-runtime skill 与业务 references |
| `ContextHelper/generated-queries` | 3 | helper 查询脚本与 manifest |

说明：

- 以上 4 类目录是当前改造任务要求冻结的主基线。
- 但当前系统的实际运行配置**不只**来自这 4 类目录，还依赖若干补充路径，见下文“主基线外的关键依赖”。

## 3. 当前关键加载入口

当前运行面主要通过以下本地文件入口装配配置：

- 场景配置加载：[services/scene-config.js](/Users/gato-pm/Desktop/API_副本/services/scene-config.js)
- 平台资源注册表加载：[platform/compiler/validate.js](/Users/gato-pm/Desktop/API_副本/platform/compiler/validate.js)
- QueryProfile 运行时加载：[services/generic-query-runner.js](/Users/gato-pm/Desktop/API_副本/services/generic-query-runner.js)
- prompt/schema/dictionary/rules 加载：[platform/nodes/load-assets.js](/Users/gato-pm/Desktop/API_副本/platform/nodes/load-assets.js)
- direct-model 资产加载：[services/direct-model.js](/Users/gato-pm/Desktop/API_副本/services/direct-model.js)
- ContextHelper 查询脚本读取与生成：[ContextHelper/services/generated-query-file.js](/Users/gato-pm/Desktop/API_副本/ContextHelper/services/generated-query-file.js)

## 4. 当前场景运行清单

本仓库当前纳入基线冻结的场景如下：

1. `payment-info-split`
2. `sales-opportunity-advisor`
3. `sales-opportunity-smart-entry`
4. `sales-opportunity-advisor-directdb`

## 5. 主基线外的关键依赖

以下路径未包含在本次主基线 4 个目录中，但当前场景运行会直接或间接依赖：

- `platform/assets/prompts/*.md`
- `references/payment-info-split/*`
- `metadata/*.tsv`
- `DirectDbRunner/sql-cache/*`（directdb 场景的 SQL 缓存）
- `runtime://project-runtime/agents/payment-fast-agent/agent/models.json`（`payment-info-split` 的 fallback models file）

结论：

- 后续如果只把 `scene-configs / platform / runtime-assets / ContextHelper` 物化为 bundle，而漏掉上述补充路径，运行时可能与当前基线不一致。

## 6. 各场景当前生效配置来源

以下按“当前主要配置入口 / 直接引用文件 / 补充依赖”整理。

### 6.1 `payment-info-split`

- 场景入口配置：
  - [scene-configs/payment-info-split.json](/Users/gato-pm/Desktop/API_副本/scene-configs/payment-info-split.json)
- 执行模式：
  - `direct-model`
- 当前直接引用文件：
  - [references/payment-info-split/prompt.md](/Users/gato-pm/Desktop/API_副本/references/payment-info-split/prompt.md)
  - [references/payment-info-split/output_schema.json](/Users/gato-pm/Desktop/API_副本/references/payment-info-split/output_schema.json)
- 运行补充依赖：
  - 环境变量 `MOONSHOT_API_KEY`
  - `runtime://project-runtime/agents/payment-fast-agent/agent/models.json`

判定：

- 当前场景**不依赖 BusinessSkill / WorkflowTemplate / QueryProfile**。
- 当前场景的结构化输出基线主要来自 `scene-config + prompt.md + output_schema.json`。

### 6.2 `sales-opportunity-advisor`

- 场景入口配置：
  - [scene-configs/sales-opportunity-advisor.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor.json)
- 场景配置声明：
  - `execution.mode` 默认为 agent-runtime
  - `routing.mode = legacy`
  - `routing.allowedModes = legacy / shadow / langgraph`

当前 legacy 主链直接依赖：

- Skill 入口：
  - [runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/SKILL.md](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/SKILL.md)
- 本地 references：
  - [runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/decision_rules.md](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/decision_rules.md)
  - [runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/output_schema.json](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/output_schema.json)
- 提示词与字典：
  - [platform/assets/prompts/sales-opportunity-advisor.draft-business-output.v1.md](/Users/gato-pm/Desktop/API_副本/platform/assets/prompts/sales-opportunity-advisor.draft-business-output.v1.md)
  - [metadata/sales_opportunity_dictionary.tsv](/Users/gato-pm/Desktop/API_副本/metadata/sales_opportunity_dictionary.tsv)
- helper 查询脚本：
  - [ContextHelper/generated-queries/sales-opportunity-advisor.generated.js](/Users/gato-pm/Desktop/API_副本/ContextHelper/generated-queries/sales-opportunity-advisor.generated.js)
  - [ContextHelper/generated-queries/manifest.json](/Users/gato-pm/Desktop/API_副本/ContextHelper/generated-queries/manifest.json)

当前平台注册资源文件：

- BusinessSkill：
  - [platform/skills/sales-opportunity-advisor.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor.v1.yaml)
- WorkflowTemplate：
  - [platform/templates/grounded-structured-advisory.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/templates/grounded-structured-advisory.v1.yaml)
- ToolDefinition：
  - [platform/tools/generic-query-runner.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/generic-query-runner.tool.yaml)
  - [platform/tools/旧 LLM tool 配置](/Users/gato-pm/Desktop/API_副本/platform/tools/旧 LLM tool 配置)
  - [platform/tools/model-tool-structured-output.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/model-tool-structured-output.tool.yaml)
  - [platform/tools/sales-opportunity-context-helper.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-context-helper.tool.yaml)
- QueryProfile：
  - [platform/tools/sales-opportunity-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-by-opportunity-id.query.yaml)

判定：

- **当前 legacy 主运行基线**主要是 `scene-config + runtime skill + prompt + dictionary + rules + schema + helper generated query`。
- `platform/skills + platform/templates + platform/tools` 已经是并行存在的平台注册配置，后续切到 langgraph / bundle 时必须保持一致。

### 6.3 `sales-opportunity-smart-entry`

- 场景入口配置：
  - [scene-configs/sales-opportunity-smart-entry.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-smart-entry.json)
- 场景配置声明：
  - `execution.mode` 默认为 agent-runtime
  - `routing.mode = legacy`
  - `routing.allowedModes = legacy / shadow / langgraph`

当前 legacy 主链直接依赖：

- Skill 入口：
  - [runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/SKILL.md](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/SKILL.md)
- 本地 references：
  - [runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/references/decision_rules.md](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/references/decision_rules.md)
  - [runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/references/output_schema.json](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-smart-entry/references/output_schema.json)
- 提示词与字典：
  - [platform/assets/prompts/sales-opportunity-smart-entry.draft-business-output.v1.md](/Users/gato-pm/Desktop/API_副本/platform/assets/prompts/sales-opportunity-smart-entry.draft-business-output.v1.md)
  - [metadata/sales_opportunity_smart_entry_dictionary.tsv](/Users/gato-pm/Desktop/API_副本/metadata/sales_opportunity_smart_entry_dictionary.tsv)

当前平台注册资源文件：

- BusinessSkill：
  - [platform/skills/sales-opportunity-smart-entry.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-smart-entry.v1.yaml)
- WorkflowTemplate：
  - [platform/templates/grounded-structured-advisory.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/templates/grounded-structured-advisory.v1.yaml)
- ToolDefinition：
  - [platform/tools/generic-query-runner.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/generic-query-runner.tool.yaml)
  - [platform/tools/旧 LLM tool 配置](/Users/gato-pm/Desktop/API_副本/platform/tools/旧 LLM tool 配置)
  - [platform/tools/model-tool-structured-output.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/model-tool-structured-output.tool.yaml)
- QueryProfile：
  - [platform/tools/sales-opportunity-smart-entry-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-smart-entry-by-opportunity-id.query.yaml)

辅助/迁移来源文件：

- [ContextHelper/generated-queries/sales-opportunity-smart-entry.generated.js](/Users/gato-pm/Desktop/API_副本/ContextHelper/generated-queries/sales-opportunity-smart-entry.generated.js)
- [ContextHelper/generated-queries/manifest.json](/Users/gato-pm/Desktop/API_副本/ContextHelper/generated-queries/manifest.json)

判定：

- 当前场景已接入通用查询执行器与 QueryProfile，因此后续切 bundle 时必须同时校验 `scene-config / BusinessSkill / QueryProfile / prompt / dictionary / rules / schema`。
- helper 生成脚本仍然保留在技能文件与 QueryProfile 的迁移来源中，属于不能忽略的历史依赖。

### 6.4 `sales-opportunity-advisor-directdb`

- 场景入口配置：
  - [scene-configs/sales-opportunity-advisor-directdb.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor-directdb.json)
- 场景配置声明：
  - `execution.mode` 默认为 agent-runtime
  - `routing.mode = langgraph`
  - `langgraphCutover.requestPercentage = 100`

当前直接依赖文件：

- Skill 入口：
  - [runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb/SKILL.md](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb/SKILL.md)
- 提示词与字典：
  - [platform/assets/prompts/sales-opportunity-advisor-directdb.draft-business-output.v1.md](/Users/gato-pm/Desktop/API_副本/platform/assets/prompts/sales-opportunity-advisor-directdb.draft-business-output.v1.md)
  - [metadata/sales_opportunity_advisor_directdb_dictionary.tsv](/Users/gato-pm/Desktop/API_副本/metadata/sales_opportunity_advisor_directdb_dictionary.tsv)
- 共用规则与 schema：
  - [runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/decision_rules.md](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/decision_rules.md)
  - [runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/output_schema.json](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/output_schema.json)

当前平台注册资源文件：

- BusinessSkill：
  - [platform/skills/sales-opportunity-advisor-directdb.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor-directdb.v1.yaml)
- WorkflowTemplate：
  - [platform/templates/grounded-structured-advisory.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/templates/grounded-structured-advisory.v1.yaml)
- ToolDefinition：
  - [platform/tools/generic-query-runner.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/generic-query-runner.tool.yaml)
  - [platform/tools/旧 LLM tool 配置](/Users/gato-pm/Desktop/API_副本/platform/tools/旧 LLM tool 配置)
  - [platform/tools/model-tool-structured-output.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/model-tool-structured-output.tool.yaml)
  - [platform/tools/sales-opportunity-directdb-runner.tool.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-directdb-runner.tool.yaml)
- QueryProfile：
  - [platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml)

运行补充依赖：

- `DirectDbRunner/sql-cache/sales-opportunity-advisor-directdb.sql.json`

判定：

- 当前场景声明为 `langgraph` 主路由，因此后续改造中需要优先保证 `scene-config + BusinessSkill + WorkflowTemplate + ToolDefinition + QueryProfile` 的一致性。
- 同时仍保留 `runtime-assets` 中的 skill 文件和共享 references，不能只冻结平台注册 YAML 而忽略 skill 侧资产。

## 7. 当前基线下的关键一致性提示

1. `payment-info-split` 的 prompt 和 schema 不在 4 个主基线目录中，后续如果做 bundle，必须补充这一类本地 references。
2. `sales-opportunity-advisor` 与 `sales-opportunity-smart-entry` 当前运行链路仍显著依赖 `runtime-assets` 中的 `SKILL.md` 与 `ContextHelper/generated-queries/*`。
3. `sales-opportunity-advisor-directdb` 既依赖平台注册 YAML，也依赖 `runtime-assets` 中的 skill 与共享 references，不能只迁移一半。
4. `sales-opportunity-advisor-directdb` 的 skill 文本中仍出现 `旧共享运行时目录/.../decision_rules.md` 的旧路径说明，后续迁移时需要统一为当前仓库或 bundle 路径。
5. `sales-opportunity-advisor-directdb` 在 [scene-configs/sales-opportunity-advisor-directdb.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor-directdb.json) 中声明了 `sales-opportunity-directdb-runner`，但在 [platform/skills/sales-opportunity-advisor-directdb.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor-directdb.v1.yaml) 中 `context_fetcher` 绑定的是 `tool://data/generic-query-runner@v1`，后续迁移前必须先确认当前主路由到底以哪一侧为准。

## 8. T0-01 验收结论

本次基线冻结任务已满足以下条件：

- 已冻结主文档要求的 4 类目录范围
- 已列出 4 个目标场景当前基线
- 已逐场景标明当前生效配置来源文件
- 已补充主基线外但实际运行仍依赖的关键路径

后续 `T0-02` 可以在本文件基础上继续定义 bundle root 与环境变量规范。
