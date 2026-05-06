# API_副本自闭环逐文件修改蓝图任务清单（AI可执行版）

## 1. 文档目标

本文档用于把 `/Users/gato-pm/Desktop/API_副本` 改造成一套真正可独立运行、可独立调试、可独立演进的“自闭环副本”。

这里的“自闭环”指：

1. API、Console、ContextHelper、DirectDbRunner、ModelTool 可以只基于 `_副本` 启动。
2. 运行时不再隐式读取 `/Users/gato-pm/Desktop/API/...`。
3. 运行时不再隐式读取 `旧共享运行时目录/workspace-sales-agent/...`。
4. 运行时不再隐式兜底读取 `旧共享运行时目录/agents/.../agent/*.json`。
5. 允许继续依赖外部服务，但这些依赖必须显式声明在 `_副本` 的配置或 `.env` 中：
   - SQL Server
   - LLM Provider
   - 旧 Gateway

## 2. 执行原则

### 2.1 AI 执行规则

后续若由 AI 按本文档执行，必须遵守：

1. 每次只做一个最小可完成子任务。
2. 做完必须更新当前文档对应 checkbox。
3. 必须实际修改代码、配置、文档或脚本，不允许只停留在分析。
4. 必须运行验证。
5. 必须汇报：
   - 修改文件
   - 验证结果
   - 风险
   - 回退方式
6. 当前任务未验证通过，不进入下一任务。

### 2.2 本次改造不追求的内容

以下内容不作为本次自闭环改造的前置目标：

1. 不要求复制数据库。
2. 不要求复制 Moonshot / OpenAI 等云端模型服务。
3. 不要求重写业务逻辑为新编排框架。
4. 不要求先替换全部旧逻辑，只要求先把 `_副本` 的资产和运行时依赖收回本地。

### 2.3 自闭环验收标准

当全部任务完成后，至少要满足：

1. `npm run service:restart` 启动的是 `_副本` 这套服务。
2. `3200` 前端只代理到 `_副本` 指定 API 端口。
3. `payment-info-split` 可以跑通。
4. `sales-opportunity-advisor` 可以跑通。
5. `sales-opportunity-advisor-directdb` 可以跑通。
6. 在运行时配置中，不再出现对旧目录的隐式依赖：
   - `/Users/gato-pm/Desktop/API`
   - `旧共享运行时目录`
7. 保留的外部依赖只来自 `_副本/.env` 或 `_副本` 内受控 runtime assets。

## 3. 当前共享依赖快照

以下共享依赖是本轮自闭环必须清理的重点：

### 3.1 Scene 配置仍引用旧目录或 `旧共享运行时目录`

- `scene-configs/payment-info-split.json`
- `scene-configs/sales-opportunity-advisor.json`
- `scene-configs/sales-opportunity-advisor-directdb.json`

### 3.2 Platform 配置仍引用旧目录或 `旧共享运行时目录`

- `platform/skills/sales-opportunity-advisor.v1.yaml`
- `platform/skills/sales-opportunity-advisor-directdb.v1.yaml`
- `platform/tools/sales-opportunity-by-opportunity-id.query.yaml`
- `platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml`

### 3.3 运行时仍直接读取路径字符串

- `services/scene-config.js`
- `services/direct-model.js`

### 3.4 启动链路需要继续收口

- `scripts/install_launch_agents.sh`
- `deploy/launchd/*.plist`
- `console/.env.example`

## 4. 目标目录蓝图

建议收口到下面这套目录形态：

```text
API_副本/
  .env
  console/
  ContextHelper/
    generated-queries/
  DirectDbRunner/
    sql-cache/
  metadata/
    sales_opportunity_dictionary.tsv
  references/
    payment-info-split/
      prompt.md
      output_schema.json
    sales-opportunity-advisor/
      decision_rules.md
      output_schema.json
  runtime-assets/
    retired-runtime/
      agents/
        payment-fast-agent/
          agent/
            models.json
            auth-profiles.json
        sales-agent/
          agent/
            models.json
            auth-profiles.json
      workspace/
        skills/
          sales-opportunity-advisor/
            SKILL.md
            references/
          sales-opportunity-advisor-directdb/
            SKILL.md
            references/
  scene-configs/
  services/
  utils/
```

## 5. 逐文件改造总表

### 5.1 需要新增的文件或目录

- `runtime-assets/project-runtime/agents/payment-fast-agent/agent/models.json`
- `runtime-assets/project-runtime/agents/payment-fast-agent/agent/auth-profiles.json`
- `runtime-assets/project-runtime/agents/sales-agent/agent/models.json`
- `runtime-assets/project-runtime/agents/sales-agent/agent/auth-profiles.json`
- `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/SKILL.md`
- `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/*`
- `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb/SKILL.md`
- `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb/references/*`
- `references/payment-info-split/prompt.md`
- `references/payment-info-split/output_schema.json`
- `references/sales-opportunity-advisor/decision_rules.md`
- `references/sales-opportunity-advisor/output_schema.json`
- `utils/path-resolver.js`
- `scripts/scan_shared_runtime_paths.js`
- `tests/fixtures/self-contained/` 下最小回放样例

### 5.2 需要修改的现有文件

- `services/scene-config.js`
- `services/direct-model.js`
- `scene-configs/payment-info-split.json`
- `scene-configs/sales-opportunity-advisor.json`
- `scene-configs/sales-opportunity-advisor-directdb.json`
- `platform/skills/sales-opportunity-advisor.v1.yaml`
- `platform/skills/sales-opportunity-advisor-directdb.v1.yaml`
- `platform/tools/sales-opportunity-by-opportunity-id.query.yaml`
- `platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml`
- `scripts/install_launch_agents.sh`
- `deploy/launchd/com.gatopm.sales-opportunity-api.plist`
- `deploy/launchd/com.gatopm.sales-opportunity-context-helper.plist`
- `deploy/launchd/com.gatopm.sales-opportunity-directdb-runner.plist`
- `deploy/launchd/com.gatopm.sales-opportunity-model-tool.plist`
- `console/.env.example`
- `README.md`
- `常驻启动说明.md`

## 6. 分阶段任务清单

---

## 阶段C0：基线固化与共享依赖清单

### 阶段目标

先把 `_副本` 当前仍在引用的旧目录和共享资产彻底盘清，再进入资产复制和路径改造。

### 详细任务

- [x] `C0-T1` 生成共享路径基线报告
  - 目标：把所有仍引用旧目录和 `旧共享运行时目录` 的运行时文件列成一张表。
  - 前置依赖：无
  - 修改范围：
    - `scripts/scan_shared_runtime_paths.js`
    - 可选更新 `README.md`
  - 执行动作：
    1. 新增扫描脚本，扫描 `scene-configs/`、`platform/`、`services/`、`deploy/`。
    2. 识别以下高风险前缀：
       - `/Users/gato-pm/Desktop/API`
       - `旧共享运行时目录`
    3. 输出文件、行号、匹配值、风险级别。
  - 产出物：
    - `scripts/scan_shared_runtime_paths.js`
    - 一份扫描输出样例
  - 完成判定：可以一键得出“哪些运行时配置还未自闭环”。
  - 验证方式：
    - `node scripts/scan_shared_runtime_paths.js`
  - 回退方式：
    - 删除新增扫描脚本，不影响主运行链路。
  - 完成说明（2026-04-13）：已新增 [scripts/scan_shared_runtime_paths.js](/Users/gato-pm/Desktop/API_副本/scripts/scan_shared_runtime_paths.js)，默认扫描 `scene-configs/`、`platform/`、`services/`、`deploy/` 中的运行时配置文件，并识别旧项目目录 `/Users/gato-pm/Desktop/API` 与共享 退役 Agent 运行时 目录 `旧共享运行时目录`；已实跑生成样例报告 [tmp/shared-runtime-paths-report.json](/Users/gato-pm/Desktop/API_副本/tmp/shared-runtime-paths-report.json)，可输出文件、行号、命中值、风险级别与摘要统计。

- [x] `C0-T2` 产出资产复制映射表
  - 目标：把“源路径 -> `_副本` 目标路径”沉淀成文档，避免复制时漏项。
  - 前置依赖：`C0-T1`
  - 修改范围：
    - 当前文档
  - 执行动作：
    1. 按资源类型整理 source/target 对照表：
       - prompt
       - schema
       - rules
       - dictionary
       - skill
       - query cache
       - models/auth-profiles
    2. 标记哪些文件允许共享、哪些必须复制。
  - 产出物：
    - 本文档更新版
  - 完成判定：复制边界清晰，后续任务不需要临场猜路径。
  - 验证方式：
    - 人工检查映射表是否覆盖 `payment-info-split` 和 `sales-opportunity-advisor*`
  - 回退方式：
    - 文档回退，不影响运行。
  - 完成说明（2026-04-13）：已把第 7 节资产复制映射表扩展为可执行版本，增加了“场景/业务、资源类型、必须复制、允许继续共享、复制原因、目标文件”字段，并明确排除了 DB/LLM/Gateway 这类外部依赖不属于本轮复制对象；映射表已覆盖 `payment-info-split`、`sales-opportunity-advisor`、`sales-opportunity-advisor-directdb` 三条链路所需的 prompt/schema/rules/dictionary/skill/query cache/models/auth-profiles。

---

## 阶段C1：复制 runtime assets 与业务资产

### 阶段目标

把运行时所需的 skill、prompt、schema、rules、模型配置全部复制到 `_副本` 内部目录，形成第一版资产闭环。

### 详细任务

- [x] `C1-T1` 复制 `payment-info-split` 资产
  - 目标：让 `payment-info-split` 的 prompt/schema 不再依赖旧目录。
  - 前置依赖：`C0-T2`
  - 修改范围：
    - 新增 `references/payment-info-split/`
  - 执行动作：
    1. 从旧路径复制 `prompt.md` 到 `_副本/references/payment-info-split/prompt.md`
    2. 从旧路径复制 `output_schema.json` 到 `_副本/references/payment-info-split/output_schema.json`
  - 产出物：
    - `references/payment-info-split/prompt.md`
    - `references/payment-info-split/output_schema.json`
  - 完成判定：`payment-info-split` 所需 prompt/schema 在 `_副本` 内完整存在。
  - 验证方式：
    - `test -f references/payment-info-split/prompt.md`
    - `test -f references/payment-info-split/output_schema.json`
  - 回退方式：
    - 删除新复制文件。
  - 完成说明（2026-04-13）：已将旧仓 [prompt.md](/Users/gato-pm/Desktop/API/references/payment-info-split/prompt.md) 与 [output_schema.json](/Users/gato-pm/Desktop/API/references/payment-info-split/output_schema.json) 复制到 `_副本` 的 [prompt.md](/Users/gato-pm/Desktop/API_副本/references/payment-info-split/prompt.md) 与 [output_schema.json](/Users/gato-pm/Desktop/API_副本/references/payment-info-split/output_schema.json)；已通过 `test -f`、`cmp -s` 与 JSON 解析校验，确认文件存在、内容一致、schema 可正常解析。

- [x] `C1-T2` 复制销售机会 skill 资产
  - 目标：把 `sales-opportunity-advisor*` 所依赖的 skill 和 references 从 `旧共享运行时目录/workspace-sales-agent` 收入 `_副本`。
  - 前置依赖：`C0-T2`
  - 修改范围：
    - 新增 `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/`
    - 新增 `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb/`
  - 执行动作：
    1. 复制两个 `SKILL.md`
    2. 复制各自 `references/`
    3. 若 directdb 仍复用 helper skill 的 prompt，先按现状复制，不先拆内容
  - 产出物：
    - `_副本/runtime-assets/project-runtime/workspace/skills/...`
  - 完成判定：skill 不再依赖 `旧共享运行时目录/workspace-sales-agent`。
  - 验证方式：
    - `find runtime-assets/project-runtime/workspace/skills -name 'SKILL.md'`
  - 回退方式：
    - 删除新复制 skill 目录。
  - 完成说明（2026-04-13）：已将 [sales-opportunity-advisor](旧共享运行时目录/workspace-sales-agent/skills/sales-opportunity-advisor) 与 [sales-opportunity-advisor-directdb](旧共享运行时目录/workspace-sales-agent/skills/sales-opportunity-advisor-directdb) 两个 skill 目录完整复制到 `_副本` 的 [sales-opportunity-advisor](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor) 与 [sales-opportunity-advisor-directdb](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb)；已通过 `find`、`cmp -s` 校验 `SKILL.md` 与 helper 场景 `references/` 内容一致。补充说明：源 `sales-opportunity-advisor-directdb` 目录当前本身只有 `SKILL.md`，没有独立 `references/` 目录，因此本次按源目录原样复制。

- [x] `C1-T3` 复制模型配置资产
  - 目标：把 direct-model 和 agent-runtime 的模型 profile 收入 `_副本`。
  - 前置依赖：`C0-T2`
  - 修改范围：
    - 新增 `runtime-assets/project-runtime/agents/payment-fast-agent/agent/`
    - 新增 `runtime-assets/project-runtime/agents/sales-agent/agent/`
  - 执行动作：
    1. 复制 `models.json`
    2. 复制 `auth-profiles.json`
    3. 检查文件权限和敏感信息处理方式
  - 产出物：
    - `_副本/runtime-assets/project-runtime/agents/...`
  - 完成判定：不再需要去 `旧共享运行时目录/agents/...` 读模型配置。
  - 验证方式：
    - `find runtime-assets/project-runtime/agents -name 'models.json' -o -name 'auth-profiles.json'`
  - 回退方式：
    - 删除新复制 agent assets。
  - 完成说明（2026-04-13）：已将 [payment-fast-agent](旧共享运行时目录/agents/payment-fast-agent/agent/models.json) 与 [sales-agent](旧共享运行时目录/agents/sales-agent/agent/models.json) 两套 agent 配置中的 `models.json`、`auth-profiles.json` 复制到 `_副本` 的 [payment-fast-agent](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/agents/payment-fast-agent/agent/models.json) 与 [sales-agent](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/agents/sales-agent/agent/models.json) 对应目录；已通过 `find`、`cmp -s` 与 JSON 解析校验，确认四个文件存在、内容一致且可正常解析。

- [x] `C1-T4` 复制字典与查询产物
  - 目标：把字典、generated query、sql cache 收回 `_副本`。
  - 前置依赖：`C0-T2`
  - 修改范围：
    - `metadata/`
    - `ContextHelper/generated-queries/`
    - `DirectDbRunner/sql-cache/`
  - 执行动作：
    1. 确认或复制 `metadata/sales_opportunity_dictionary.tsv`
    2. 复制 `ContextHelper/generated-queries/sales-opportunity-advisor.generated.js`
    3. 复制 `ContextHelper/generated-queries/manifest.json`
    4. 复制 `DirectDbRunner/sql-cache/sales-opportunity-advisor-directdb.sql.json`
  - 产出物：
    - `_副本/metadata/...`
    - `_副本/ContextHelper/generated-queries/...`
    - `_副本/DirectDbRunner/sql-cache/...`
  - 完成判定：query profile 后续可完全改指向 `_副本` 内部路径。
  - 验证方式：
    - `test -f` 检查上述文件
  - 回退方式：
    - 删除复制文件。
  - 完成说明（2026-04-13）：已将旧仓的 [sales_opportunity_dictionary.tsv](/Users/gato-pm/Desktop/API/metadata/sales_opportunity_dictionary.tsv)、[sales-opportunity-advisor.generated.js](/Users/gato-pm/Desktop/API/ContextHelper/generated-queries/sales-opportunity-advisor.generated.js)、[manifest.json](/Users/gato-pm/Desktop/API/ContextHelper/generated-queries/manifest.json)、[sales-opportunity-advisor-directdb.sql.json](/Users/gato-pm/Desktop/API/DirectDbRunner/sql-cache/sales-opportunity-advisor-directdb.sql.json) 覆盖复制到 `_副本` 对应目录；已通过 `test -f`、`cmp -s` 和 JSON 解析校验。补充说明：这些目标文件在 `_副本` 中原本已存在，本次执行以“刷新并确认与旧仓一致”为准，确保后续任务可直接改引用而不需要再补资产。

---

## 阶段C2：引入统一路径解析层

### 阶段目标

新增统一 resolver，让 scene/platform/runtime 配置可以使用受控路径，而不是继续写死绝对路径。

### 详细任务

- [x] `C2-T1` 新增通用路径解析器
  - 目标：支持 `project://` 与 `runtime://` 两类路径协议。
  - 前置依赖：`C1-T1` 到 `C1-T4`
  - 修改范围：
    - 新增 `utils/path-resolver.js`
  - 执行动作：
    1. 支持 `project://<path>` 映射到 `_副本` 根目录
    2. 支持 `runtime://project-runtime/<path>` 映射到 `_副本/runtime-assets/project-runtime/`
    3. 兼容旧绝对路径，但输出告警信息
  - 产出物：
    - `utils/path-resolver.js`
  - 完成判定：后续 scene/platform 配置不必继续写绝对路径。
  - 验证方式：
    - 为 resolver 写最小 Node 自测脚本或在 REPL 中验证
  - 回退方式：
    - 删除 resolver，并回到旧绝对路径读取逻辑。
  - 完成说明（2026-04-13）：已新增 [path-resolver.js](/Users/gato-pm/Desktop/API_副本/utils/path-resolver.js)，支持 `project://`、`runtime://project-runtime/...`、旧绝对路径和项目相对路径四种输入；返回结果统一包含 `original`、`resolvedPath`、`sourceType`、`warnings`，并支持通过 `onWarning` 回调输出告警信息。已通过 Node 自测验证：`project://` 与 `runtime://` 能正确解析到 `_副本` 路径且不误报；旧目录 `/Users/gato-pm/Desktop/API/...` 会输出 `legacy-project-path` 告警；共享 `旧共享运行时目录` 路径会输出 `shared-retired-runtime-path` 告警。

- [x] `C2-T2` 改造 `services/scene-config.js`
  - 目标：在 scene 配置加载时统一解析路径并做校验。
  - 前置依赖：`C2-T1`
  - 修改范围：
    - `services/scene-config.js`
  - 执行动作：
    1. 加载 scene config 后，对以下字段做路径解析：
       - `skill.workspacePath`
       - `skill.entryFile`
       - `references[*].path`
       - `directModel.promptFile`
       - `directModel.fallbackModelsFile`
    2. 在返回给运行时前保存 resolved path
    3. 保留原始引用值，便于调试和页面展示
  - 产出物：
    - 更新后的 `services/scene-config.js`
  - 完成判定：scene 配置可直接使用 `project://` 和 `runtime://`。
  - 验证方式：
    - 运行 `node -e` 调用 `getSceneConfig('payment-info-split')` 并检查 resolved 字段
  - 回退方式：
    - 恢复 `services/scene-config.js` 到旧版本。
  - 完成说明（2026-04-13）：已在 [scene-config.js](/Users/gato-pm/Desktop/API_副本/services/scene-config.js) 接入 [path-resolver.js](/Users/gato-pm/Desktop/API_副本/utils/path-resolver.js)，加载 scene 配置时会统一解析 `skill.workspacePath`、`skill.entryFile`、`references[*].path`、`directModel.promptFile`、`directModel.fallbackModelsFile`；运行时字段替换为 resolved 绝对路径，同时保留 `*Ref`、`*SourceType`、`*Warnings` 以及顶层 `pathResolutionWarnings` 供调试页与后续迁移查看。已通过 `node -c` 语法校验、`getSceneConfig('payment-info-split')` / `getSceneConfig('sales-opportunity-advisor')` 实际读取校验，以及 `project://`、`runtime://` 合成配置解析自测。

- [x] `C2-T3` 改造 `services/direct-model.js`
  - 目标：让 direct-model 读取 prompt/schema/credential 时统一使用 resolver 结果。
  - 前置依赖：`C2-T1`
  - 修改范围：
    - `services/direct-model.js`
  - 执行动作：
    1. 读取 `promptFile` 时支持 resolved path
    2. 读取 `schemaReference.path` 时支持 resolved path
    3. API key 查找改成：
       - `.env`
       - `_副本/runtime-assets/project-runtime/.../models.json`
       - `_副本/runtime-assets/project-runtime/.../auth-profiles.json`
    4. 迁移完成后禁止默认兜底到 `旧共享运行时目录`
  - 产出物：
    - 更新后的 `services/direct-model.js`
  - 完成判定：`payment-info-split` 不再读 `旧共享运行时目录` 或旧仓 prompt/schema。
  - 验证方式：
    - `curl POST /api/agent/run` 调 `payment-info-split`
  - 回退方式：
    - 恢复旧读取逻辑。
  - 完成说明（2026-04-13）：已在 [direct-model.js](/Users/gato-pm/Desktop/API_副本/services/direct-model.js) 增加 direct-model 资产路径解析与凭证收口逻辑：读取 `promptFile`、`schemaReference.path`、`fallbackModelsFile` 时会优先把旧仓 `/Users/gato-pm/Desktop/API/...` 与共享 `旧共享运行时目录/...` 自动映射到 `_副本` 的 `project root / runtime-assets/project-runtime`，因此不再真正读取旧仓 prompt/schema 或共享 退役 Agent 运行时 目录；凭证查找顺序已固定为 `.env` -> `_副本/runtime-assets/.../models.json` -> `_副本/runtime-assets/.../auth-profiles.json`，不再把 `旧共享运行时目录` 作为兜底来源。已通过三类验证：1）`node -c` 语法校验；2）Node 自测确认 `payment-info-split` 的 prompt/schema 会重定向到 `_副本/references/payment-info-split/*`，且 fallback credential source 为 `_副本/runtime-assets/project-runtime/agents/payment-fast-agent/agent/models.json`；3）重启 API 后实跑 `curl POST http://127.0.0.1:3000/api/agent/run`，`payment-info-split` 返回成功，requestId 为 `req_20260413_113811386_977ecefd`。

---

## 阶段C3：重写 scene-configs

### 阶段目标

把当前三个核心 scene 配置全部改成 `_副本` 内部路径，不再引用旧仓和 `旧共享运行时目录`。

### 详细任务

- [x] `C3-T1` 重写 `scene-configs/payment-info-split.json`
  - 目标：让 `payment-info-split` 全量引用 `_副本` 内资产。
  - 前置依赖：`C1-T1`、`C1-T3`、`C2-T2`、`C2-T3`
  - 修改范围：
    - `scene-configs/payment-info-split.json`
  - 执行动作：
    1. `fallbackModelsFile` 改为 `runtime://project-runtime/agents/payment-fast-agent/agent/models.json`
    2. `promptFile` 改为 `project://references/payment-info-split/prompt.md`
    3. `references[*].path` 改为 `project://references/payment-info-split/...`
  - 完成判定：文件内不再出现旧目录绝对路径。
  - 验证方式：
    - `curl POST /api/agent/run` 调 `payment-info-split`
  - 回退方式：
    - 恢复原 JSON。
  - 完成说明（2026-04-13）：已将 [payment-info-split.json](/Users/gato-pm/Desktop/API_副本/scene-configs/payment-info-split.json) 中的 `directModel.fallbackModelsFile` 改为 `runtime://project-runtime/agents/payment-fast-agent/agent/models.json`，`directModel.promptFile` 改为 `project://references/payment-info-split/prompt.md`，并把两个 `references[*].path` 全部改为 `project://references/payment-info-split/...`；文件内已不再出现旧仓 `/Users/gato-pm/Desktop/API` 或共享 `旧共享运行时目录` 绝对路径。已通过两类验证：1）Node 直接读取 `getSceneConfig('payment-info-split')`，确认 resolved path 已落到 `_副本` 内部路径且 `pathResolutionWarnings=[]`；2）实跑 `curl POST http://127.0.0.1:3000/api/agent/run`，请求 `payment-info-split` 成功，requestId 为 `req_20260413_114204205_52a83187`。

- [x] `C3-T2` 重写 `scene-configs/sales-opportunity-advisor.json`
  - 目标：让 helper 场景只引用 `_副本` 内 skill 和 reference。
  - 前置依赖：`C1-T2`、`C1-T4`、`C2-T2`
  - 修改范围：
    - `scene-configs/sales-opportunity-advisor.json`
  - 执行动作：
    1. `skill.workspacePath` 改为 `runtime://project-runtime/workspace`
    2. `skill.entryFile` 改为 `runtime://project-runtime/workspace/skills/sales-opportunity-advisor/SKILL.md`
    3. `references[*].path` 改为 `_副本` 内路径
  - 完成判定：不再出现 `旧共享运行时目录/workspace-sales-agent` 和旧仓 metadata 路径。
  - 验证方式：
    - `curl POST /api/agent/run` 调 `sales-opportunity-advisor`
  - 回退方式：
    - 恢复原 JSON。
  - 完成说明（2026-04-13）：已将 [sales-opportunity-advisor.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor.json) 中的 `skill.workspacePath` 改为 `runtime://project-runtime/workspace`，`skill.entryFile` 改为 `runtime://project-runtime/workspace/skills/sales-opportunity-advisor/SKILL.md`，并把 `references[*].path` 分别收口到 `_副本` 的 `project://metadata/sales_opportunity_dictionary.tsv` 与 `runtime://project-runtime/workspace/skills/sales-opportunity-advisor/references/*`；文件内已不再出现 `旧共享运行时目录/workspace-sales-agent` 或旧仓 metadata 绝对路径。已通过两类验证：1）Node 直接读取 `getSceneConfig('sales-opportunity-advisor')`，确认 resolved path 全部落到 `_副本` 内部且 `pathResolutionWarnings=[]`；2）实跑 `curl POST http://127.0.0.1:3000/api/agent/run`，`sales-opportunity-advisor` 返回成功，requestId 为 `req_20260413_114343022_77fdbcad`。

- [x] `C3-T3` 重写 `scene-configs/sales-opportunity-advisor-directdb.json`
  - 目标：让 directdb 场景也只引用 `_副本` 内 skill 和 reference。
  - 前置依赖：`C1-T2`、`C1-T4`、`C2-T2`
  - 修改范围：
    - `scene-configs/sales-opportunity-advisor-directdb.json`
  - 执行动作：
    1. `skill.workspacePath` 改为 `runtime://project-runtime/workspace`
    2. `skill.entryFile` 改为 `runtime://project-runtime/workspace/skills/sales-opportunity-advisor-directdb/SKILL.md`
    3. `references[*].path` 改为 `_副本` 内路径
  - 完成判定：不再出现 `旧共享运行时目录/workspace-sales-agent` 和旧仓 metadata 路径。
  - 验证方式：
    - `curl POST /api/agent/run` 调 `sales-opportunity-advisor-directdb`
  - 回退方式：
    - 恢复原 JSON。
  - 完成说明（2026-04-13）：已将 [sales-opportunity-advisor-directdb.json](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor-directdb.json) 中的 `skill.workspacePath` 改为 `runtime://project-runtime/workspace`，`skill.entryFile` 改为 `runtime://project-runtime/workspace/skills/sales-opportunity-advisor-directdb/SKILL.md`，并把 `references[*].path` 分别收口到 `_副本` 的 `project://metadata/sales_opportunity_dictionary.tsv` 与 `runtime://project-runtime/workspace/skills/sales-opportunity-advisor/references/*`；文件内已不再出现 `旧共享运行时目录/workspace-sales-agent` 或旧仓 metadata 绝对路径。已通过两类验证：1）Node 直接读取 `getSceneConfig('sales-opportunity-advisor-directdb')`，确认 resolved path 全部落到 `_副本` 内部且 `pathResolutionWarnings=[]`；2）实跑 `curl POST http://127.0.0.1:3000/api/agent/run`，`sales-opportunity-advisor-directdb` 返回成功，requestId 为 `req_20260413_123034309_5e2a0f22`。

---

## 阶段C4：重写 platform 配置

### 阶段目标

把平台层 skill / query profile 配置也改成 `_副本` 自己的路径体系，避免平台页与运行时走两套依赖。

### 详细任务

- [x] `C4-T1` 重写 `platform/skills/sales-opportunity-advisor.v1.yaml`
  - 目标：让平台 skill 定义只引用 `_副本` 内资产。
  - 前置依赖：`C1-T2`、`C1-T4`
  - 修改范围：
    - `platform/skills/sales-opportunity-advisor.v1.yaml`
  - 执行动作：
    1. `assetRefs.prompts.*.source.path` 指向 `_副本/runtime-assets/...`
    2. `assetRefs.schemas.*.source.path` 指向 `_副本/references/...`
    3. `assetRefs.dictionaries.*.source.path` 指向 `_副本/metadata/...`
    4. `assetRefs.rules.*.source.path` 指向 `_副本/references/...`
  - 完成判定：skill YAML 不再引用旧仓或 `旧共享运行时目录`。
  - 验证方式：
    - 走配置目录 / 编译预览接口检查文档内容
  - 回退方式：
    - 恢复原 YAML。
  - 完成说明（2026-04-13）：已将 [sales-opportunity-advisor.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor.v1.yaml) 中 `assetRefs.prompts/schemas/dictionaries/rules` 的 `source.path` 全部收口到 `_副本` 内部路径：prompt 指向 `_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/SKILL.md`，dictionary 指向 `_副本/metadata/sales_opportunity_dictionary.tsv`，schema 与 rules 指向 `_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/*`。补充说明：当前销售机会的 schema/rules 资产在 `_副本` 中尚未单独复制到 `references/` 目录，因此本任务按“现有真实资产位置”收口到 `runtime-assets/.../references/`，未额外扩展复制范围。已通过两类接口验证：1）`GET /api/console/configs/catalog` 中 `sales-opportunity-advisor` 的 skill 文档已不再包含旧仓或 `旧共享运行时目录` 路径；2）`POST /api/console/configs/compile-preview`（scene=`sales-opportunity-advisor`）返回的 `workflowBinding.skillSpec.assetRefs.*.source.path` 全部为 `_副本` 路径。

- [x] `C4-T2` 重写 `platform/skills/sales-opportunity-advisor-directdb.v1.yaml`
  - 目标：让 directdb skill 定义同样只引用 `_副本` 内资产。
  - 前置依赖：`C1-T2`、`C1-T4`
  - 修改范围：
    - `platform/skills/sales-opportunity-advisor-directdb.v1.yaml`
  - 执行动作：
    1. 更新 prompt/schema/dictionary/rules 的 source.path
    2. 保留 directdb 自身 queryProfileRef 和 toolBindings
  - 完成判定：directdb skill YAML 不再引用旧仓或 `旧共享运行时目录`。
  - 验证方式：
    - 配置目录 / 编译预览接口
  - 回退方式：
    - 恢复原 YAML。
  - 完成说明（2026-04-13）：已将 [sales-opportunity-advisor-directdb.v1.yaml](/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor-directdb.v1.yaml) 中 `assetRefs.prompts/schemas/dictionaries/rules` 的 `source.path` 全部收口到 `_副本` 内部路径：prompt 仍按 V1 设计复用 helper 业务的 `_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/SKILL.md`，dictionary 指向 `_副本/metadata/sales_opportunity_dictionary.tsv`，schema 与 rules 指向 `_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/*`；同时保留了 directdb 自身的 `queryProfileRef` 与 `toolBindings` 不变。已通过两类接口验证：1）`GET /api/console/configs/catalog` 中 `sales-opportunity-advisor-directdb` 的 skill 文档已不再包含旧仓或 `旧共享运行时目录` 路径；2）`POST /api/console/configs/compile-preview`（scene=`sales-opportunity-advisor-directdb`）返回的 `workflowBinding.skillSpec.assetRefs.*.source.path` 全部为 `_副本` 路径。

- [x] `C4-T3` 重写 `platform/tools/sales-opportunity-by-opportunity-id.query.yaml`
  - 目标：让 helper query profile 只引用 `_副本` 里的 skill/generated query/manifest。
  - 前置依赖：`C1-T2`、`C1-T4`
  - 修改范围：
    - `platform/tools/sales-opportunity-by-opportunity-id.query.yaml`
  - 执行动作：
    1. `migrationSource.skillPath` 改为 `_副本/runtime-assets/...`
    2. `migrationSource.helperScriptPath` 改为 `_副本/ContextHelper/generated-queries/...`
    3. `migrationSource.helperManifestPath` 改为 `_副本/ContextHelper/generated-queries/manifest.json`
  - 完成判定：query profile 不再引用旧仓或 `旧共享运行时目录`。
  - 验证方式：
    - 配置目录 / 编译预览接口
  - 回退方式：
    - 恢复原 YAML。
  - 完成说明（2026-04-13）：已将 [sales-opportunity-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-by-opportunity-id.query.yaml) 的 `migrationSource.skillPath`、`migrationSource.helperScriptPath`、`migrationSource.helperManifestPath` 全部改为 `_副本` 内部路径，分别指向 `_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/SKILL.md`、`_副本/ContextHelper/generated-queries/sales-opportunity-advisor.generated.js` 与 `_副本/ContextHelper/generated-queries/manifest.json`；该 query profile 已不再引用旧仓或 `旧共享运行时目录`。已通过三类验证：1）静态扫描确认 YAML 中不存在旧仓 / `旧共享运行时目录` / `workspace-sales-agent` 路径；2）`GET /api/console/configs/catalog` 中 `sales-opportunity-by-opportunity-id` 的 query 文档已返回 `_副本` 的 `migrationSource.*` 路径；3）`POST /api/console/configs/compile-preview`（scene=`sales-opportunity-advisor`）可正常编译，且 `POST /api/console/configs/validate` 返回 `valid=true / issueCount=0`。补充说明：编译预览当前不会把 query `migrationSource` 全量内联到返回体，因此路径检查以 catalog 文档和全量配置校验为准。

- [x] `C4-T4` 重写 `platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml`
  - 目标：让 directdb query profile 只引用 `_副本` 里的 skill/sql cache。
  - 前置依赖：`C1-T2`、`C1-T4`
  - 修改范围：
    - `platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml`
  - 执行动作：
    1. `migrationSource.skillPath` 改为 `_副本/runtime-assets/...`
    2. `migrationSource.runnerServicePath` 改为 `_副本/DirectDbRunner/services/sql-template.js`
    3. `migrationSource.sqlCacheFile` 改为 `_副本/DirectDbRunner/sql-cache/...`
  - 完成判定：query profile 不再引用旧仓或 `旧共享运行时目录`。
  - 验证方式：
    - 配置目录 / 编译预览接口
  - 回退方式：
    - 恢复原 YAML。
  - 完成说明（2026-04-13）：已将 [sales-opportunity-directdb-by-opportunity-id.query.yaml](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml) 的 `migrationSource.skillPath`、`migrationSource.runnerServicePath`、`migrationSource.sqlCacheFile` 全部改为 `_副本` 内部路径，分别指向 `_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb/SKILL.md`、`_副本/DirectDbRunner/services/sql-template.js` 与 `_副本/DirectDbRunner/sql-cache/sales-opportunity-advisor-directdb.sql.json`；该 query profile 已不再引用旧仓或 `旧共享运行时目录`。已通过三类验证：1）静态扫描确认 YAML 中不存在旧仓 / `旧共享运行时目录` / `workspace-sales-agent` 路径；2）`GET /api/console/configs/catalog` 中 `sales-opportunity-directdb-by-opportunity-id` 的 query 文档已返回 `_副本` 的 `migrationSource.*` 路径；3）`POST /api/console/configs/compile-preview`（scene=`sales-opportunity-advisor-directdb`）可正常编译，且 `POST /api/console/configs/validate` 返回 `valid=true / issueCount=0`。补充说明：编译预览当前不会把 query `migrationSource` 全量内联到返回体，因此路径检查以 catalog 文档和全量配置校验为准。

---

## 阶段C5：运行时端口与启动链路收口

### 阶段目标

确保 `_副本` 的 API、辅助服务、前端代理不会再误打到其他端口或旧进程。

### 详细任务

- [x] `C5-T1` 固定 `_副本` 启动脚本只指向当前目录
  - 目标：确认 restart/start/stop/status 都只作用于 `_副本`。
  - 前置依赖：无
  - 修改范围：
    - `scripts/install_launch_agents.sh`
    - `deploy/launchd/*.plist`
  - 执行动作：
    1. 保持脚本按当前目录解析 `ROOT_DIR`
    2. 清理 plist 模板中的旧绝对路径
    3. 如需独立端口，统一在 `.env` 中声明
  - 完成判定：`npm run service:status` 输出的 `WorkingDirectory` 都是 `_副本`
  - 验证方式：
    - `npm run service:restart`
    - `npm run service:status`
  - 回退方式：
    - 恢复脚本和 plist。
  - 完成说明（2026-04-13）：已将 [install_launch_agents.sh](/Users/gato-pm/Desktop/API_副本/scripts/install_launch_agents.sh) 强化为按物理路径解析 `SCRIPT_DIR/ROOT_DIR`，并在复制 launchd 目标 plist 后追加 `assert_plist_binding` 校验，确保 `WorkingDirectory`、`ProgramArguments`、`StandardOutPath`、`StandardErrorPath` 都被重写为当前 `_副本` 目录；同时已将四个 launchd 模板 [api plist](/Users/gato-pm/Desktop/API_副本/deploy/launchd/com.gatopm.sales-opportunity-api.plist)、[helper plist](/Users/gato-pm/Desktop/API_副本/deploy/launchd/com.gatopm.sales-opportunity-context-helper.plist)、[directdb plist](/Users/gato-pm/Desktop/API_副本/deploy/launchd/com.gatopm.sales-opportunity-directdb-runner.plist)、[model-tool plist](/Users/gato-pm/Desktop/API_副本/deploy/launchd/com.gatopm.sales-opportunity-model-tool.plist) 中残留的旧仓绝对路径改为 `__ROOT_DIR__` 占位模板，彻底清理了旧目录硬编码。已通过三类验证：1）`zsh -n scripts/install_launch_agents.sh` 语法校验通过；2）静态扫描确认脚本与 `deploy/launchd/*.plist` 中不再包含旧仓或 `旧共享运行时目录` 绝对路径；3）实跑 `npm run service:restart` 与 `npm run service:status`，四个 launchd label 的 `arguments / working directory / stdout path / stderr path` 全部显示为 `/Users/gato-pm/Desktop/API_副本/...`。

- [x] `C5-T2` 固定 Console 代理目标
  - 目标：避免 3200 页面再次代理到错误 API 端口。
  - 前置依赖：无
  - 修改范围：
    - `console/.env.example`
    - 可选新增 `console/.env.local.example`
    - 若需要，补充 `常驻启动说明.md`
  - 执行动作：
    1. 明确 `VITE_API_PROXY_TARGET`
    2. 文档中写清楚“默认代理端口”和“如何切换到实验端口”
  - 完成判定：3200 请求命中的是 `_副本` 当前 API。
  - 验证方式：
    - `curl POST http://127.0.0.1:3200/api/agent/run`
  - 回退方式：
    - 恢复 console 环境配置说明。
  - 完成说明（2026-04-13）：已更新 [console/.env.example](/Users/gato-pm/Desktop/API_副本/console/.env.example)，明确 `VITE_API_PROXY_TARGET` 默认应指向当前 `_副本` API `http://127.0.0.1:3000`；新增 [console/.env.local.example](/Users/gato-pm/Desktop/API_副本/console/.env.local.example)，固定“本地覆盖代理目标”的推荐写法；并补充 [console/README.md](/Users/gato-pm/Desktop/API_副本/console/README.md)，写清楚 3200 默认代理端口、`.env.local` 覆盖方式以及切到实验端口后需要重启 `npm run dev`。已通过真实代理验证：`curl POST http://127.0.0.1:3200/api/agent/run` 成功返回 `payment-info-split` 结果，requestId 为 `req_20260413_125900866_137b67ae`，证明当前 3200 控制台代理命中的是 `_副本` API。

- [x] `C5-T3` 可选切独立端口
  - 目标：如果后续需要彻底并行运行，则把 `_副本` 切到独立端口组。
  - 前置依赖：`C5-T1`
  - 修改范围：
    - `_副本/.env`
    - `console/.env.example`
    - `常驻启动说明.md`
  - 执行动作：
    1. 为 `_副本` 设定独立 API / helper / directdb / model-tool 端口
    2. 调整前端代理
  - 完成判定：旧 API 与 `_副本` API 可以同时存在且不串线。
  - 验证方式：
    - 分别 `curl` 两套端口
  - 回退方式：
    - 恢复到当前端口组。
  - 完成说明（2026-04-13）：已将 [_副本/.env](/Users/gato-pm/Desktop/API_副本/.env) 中的 `_副本` 服务端口组切换为 `API_PORT=3100`、`CONTEXT_HELPER_PORT=19101`、`DIRECTDB_RUNNER_PORT=19102`、`MODEL_TOOL_PORT=19103`，并同步更新 [console/vite.config.js](/Users/gato-pm/Desktop/API_副本/console/vite.config.js)、[console/.env.example](/Users/gato-pm/Desktop/API_副本/console/.env.example)、[console/.env.local.example](/Users/gato-pm/Desktop/API_副本/console/.env.local.example)、[console/README.md](/Users/gato-pm/Desktop/API_副本/console/README.md) 与 [常驻启动说明.md](/Users/gato-pm/Desktop/API_副本/常驻启动说明.md)，将 3200 控制台默认代理目标收口到 `http://127.0.0.1:3100`；同时补齐 [sales-opportunity-advisor scene](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor.json)、[sales-opportunity-advisor-directdb scene](/Users/gato-pm/Desktop/API_副本/scene-configs/sales-opportunity-advisor-directdb.json)、[context helper tool](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-context-helper.tool.yaml)、[directdb runner tool](/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-directdb-runner.tool.yaml)、[model tool](/Users/gato-pm/Desktop/API_副本/platform/tools/model-tool-structured-output.tool.yaml) 中的内部 endpoint 端口，避免 `_副本` API 仍回打旧 helper/directdb/model-tool；另外补强 [install_launch_agents.sh](/Users/gato-pm/Desktop/API_副本/scripts/install_launch_agents.sh) 的 `status` 逻辑，使其按 `_副本/.env` 读取真实监听端口，避免切端口后状态输出误报。已完成验证：1）`zsh -n scripts/install_launch_agents.sh` 通过；2）`npm run service:status` 显示 `_副本` 当前监听端口为 `3100/19101/19102/19103`；3）`curl http://127.0.0.1:3001/api/console/configs/catalog` 成功，证明旧 API 端口仍可并存；4）`curl POST http://127.0.0.1:3100/api/agent/run` 与 `curl POST http://127.0.0.1:3200/api/agent/run` 均成功返回 `payment-info-split` 结果；5）`curl POST http://127.0.0.1:3100/api/agent/run` 跑通 `sales-opportunity-advisor`，requestId 为 `req_20260413_130859129_c5e2c2ce`；6）直连 `http://127.0.0.1:19102/internal/directdb/sales-opportunity` 可成功返回机会原始行数据，说明 directdb runner 已切到 `_副本` 端口；7）`sales-opportunity-advisor-directdb` 本次请求继续推进到了 `gateway-http` 阶段后因外部 旧 Gateway 不可用返回 `GATEWAY_UNAVAILABLE`，未发现端口串线问题。

---

## 阶段C6：去掉隐式 fallback 并补回归

### 阶段目标

在资产和路径都迁完后，明确禁止再从旧仓和 `旧共享运行时目录` 隐式兜底，避免“看起来独立，实际上还在串”。

### 详细任务

- [x] `C6-T1` 去掉运行时对旧目录的默认兜底
  - 目标：让服务在发现旧路径时直接报错，而不是偷偷去读。
  - 前置依赖：`C3-T1` 到 `C4-T4`
  - 修改范围：
    - `services/scene-config.js`
    - `services/direct-model.js`
  - 执行动作：
    1. 将旧绝对路径支持降级为迁移期告警
    2. 最终切换为默认报错
  - 完成判定：运行时不再隐式成功读取旧目录。
  - 验证方式：
    - 人工替换一条旧路径，确认服务显式报错
  - 回退方式：
    - 暂时恢复兼容分支。
  - 完成说明（2026-04-13）：已在 [scene-config.js](/Users/gato-pm/Desktop/API_副本/services/scene-config.js) 增加旧路径阻断逻辑：`resolveConfigPathField` 与 `resolveReferencePaths` 在解析到 `legacy-project-path` 或 `shared-retired-runtime-path` warning 时，不再继续做存在性校验和 resolved-path 回填，而是直接抛出 `INVALID_REQUEST`，从 scene 配置加载入口就拒绝旧仓 `/Users/gato-pm/Desktop/API/...` 与共享 `旧共享运行时目录` 路径；同时在 [direct-model.js](/Users/gato-pm/Desktop/API_副本/services/direct-model.js) 去掉 legacy path remap 兜底，并新增 `assertNoLegacyPathReferences` 作为二次防御，确保 direct-model 的 prompt/schema/models/authProfiles 一旦发现旧路径引用，也会显式报错而不是悄悄改读 `_副本` 资产。已完成验证：1）`node -c services/scene-config.js` 与 `node -c services/direct-model.js` 通过；2）`node -e` 直接读取 `getSceneConfig('payment-info-split')`，确认当前合法场景仍可正常加载且 `pathResolutionWarnings.length === 0`；3）`node -e` 构造一条带旧 prompt 路径的 synthetic scene config，`resolveSceneConfigPaths(...)` 明确返回 `INVALID_REQUEST`，字段为 `promptFile`；4）`node -e` 直调 `direct-model.__private.resolveDirectModelAssetPath(...)` 并传入共享 `旧共享运行时目录` models 路径，明确返回 `INVALID_REQUEST` 与 “Legacy runtime path is not allowed ...”；5）重启 `_副本` 服务后，`npm run service:status` 仍显示四个服务在 `_副本` 目录和 `3100/19101/19102/19103` 端口运行；6）`curl POST http://127.0.0.1:3100/api/agent/run` 调 `payment-info-split` 成功，requestId 为 `req_20260413_131628164_2ac7902b`，证明拒绝旧路径后现有收口链路未被打断。

- [x] `C6-T2` 增加自闭环回归样例
  - 目标：给后续变更留一套专门的 `_副本` 自闭环回归用例。
  - 前置依赖：`C6-T1`
  - 修改范围：
    - `tests/fixtures/self-contained/`
    - 可选脚本 `scripts/run_self_contained_regression.js`
  - 执行动作：
    1. 固化三个 scene 的最小回放样例
    2. 增加“扫描共享路径 + 业务回放”组合校验
  - 完成判定：一键可以证明 `_副本` 没串旧目录且核心场景可运行。
  - 验证方式：
    - 新增回归脚本实跑
  - 回退方式：
    - 删除新增样例和脚本。
  - 完成说明（2026-04-13）：已新增自闭环回归脚本 [run_self_contained_regression.js](/Users/gato-pm/Desktop/API_副本/scripts/run_self_contained_regression.js) 与 npm 入口 [package.json](/Users/gato-pm/Desktop/API_副本/package.json)，支持一键串联“共享路径扫描 + 三条核心 scene 回放”，并将结果写入 `tests/regression/output/self-contained-<timestamp>/`；同时新增 [self-contained README](/Users/gato-pm/Desktop/API_副本/tests/fixtures/self-contained/README.md)、[manifest](/Users/gato-pm/Desktop/API_副本/tests/fixtures/self-contained/manifest.json) 以及三条最小请求样例 [payment-info-split](/Users/gato-pm/Desktop/API_副本/tests/fixtures/self-contained/payment-info-split.smoke.request.json)、[sales-opportunity-advisor](/Users/gato-pm/Desktop/API_副本/tests/fixtures/self-contained/sales-opportunity-advisor.smoke.request.json)、[sales-opportunity-advisor-directdb](/Users/gato-pm/Desktop/API_副本/tests/fixtures/self-contained/sales-opportunity-advisor-directdb.gateway-boundary.request.json)。为避免回归样例被 runtime skill 自身的旧端口/旧路径文案误导，还同步修正了 [advisor skill](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/SKILL.md)、[advisor helper contract](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/helper_contract.md)、[advisor field dictionary note](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/field_dictionary.md)、[advisor-directdb skill](/Users/gato-pm/Desktop/API_副本/runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb/SKILL.md) 中残留的旧仓 `/Users/gato-pm/Desktop/API/...` 与旧端口 `19001/19002`，统一收口到 `_副本` 路径与 `19101/19102`。已完成验证：1）`node -c scripts/run_self_contained_regression.js` 通过；2）静态扫描确认 `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor*` 中已无旧仓/旧端口命中；3）实跑 `npm run regression:self-contained` 成功输出 summary，扫描目标 `scene-configs/platform/services/deploy/runtime-assets/project-runtime/workspace/skills` 的 findings=0；4）三条回放结果为 `payment-info-split` 通过、`sales-opportunity-advisor` 通过、`sales-opportunity-advisor-directdb` 记为 warning，当前 warning 允许 `DATA_TOOL_UNAVAILABLE / RUNTIME_TIMEOUT / GATEWAY_UNAVAILABLE` 这类来自外部 旧 Gateway 边界或其缓存会话的波动，不视为 `_副本` 内部串旧路径失败；5）本次回归输出目录为 [self-contained regression output](/Users/gato-pm/Desktop/API_副本/tests/regression/output/self-contained-2026-04-13T05-51-25-292Z)。

- [x] `C6-T3` 更新运行文档
  - 目标：把 `_副本` 的真实启动、代理、路径规则写进文档，避免后续再次混线。
  - 前置依赖：`C5-T2`、`C6-T2`
  - 修改范围：
    - `README.md`
    - `常驻启动说明.md`
  - 执行动作：
    1. 写清楚 ports / service restart / console proxy
    2. 写清楚 `project://` 和 `runtime://` 规则
    3. 写清楚哪些外部依赖仍然允许存在
  - 完成判定：新同事或 AI 不用翻历史对话也能正确启动 `_副本`
  - 验证方式：
    - 按文档重新启动一遍服务
  - 回退方式：
    - 恢复文档内容。
  - 完成说明（2026-04-13）：已将 [README.md](/Users/gato-pm/Desktop/API_副本/README.md) 重写为 `_副本` 视角的运行说明，明确当前统一入口、三条 scene 链路、`3100/19101/19102/19103/3200` 端口组、`project://` 与 `runtime://project-runtime/...` 路径规则、允许继续保留的外部依赖（SQL Server / LLM Provider / 旧 Gateway），并补充了 `_副本` 的手工启动、常驻启动、控制台代理和 `npm run regression:self-contained` 的使用方式；同时已将 [常驻启动说明.md](/Users/gato-pm/Desktop/API_副本/常驻启动说明.md) 重写为稳定的日常操作手册，固定 `service:restart -> service:status -> health/catalog` 的检查顺序，写清楚 `3200 -> 3100` 的默认代理关系、旧 API 建议并行端口 `3001`、以及旧仓 `/Users/gato-pm/Desktop/API/...` 和共享 `旧共享运行时目录` 路径现在属于禁止项。已完成验证：1）静态扫描 [README.md](/Users/gato-pm/Desktop/API_副本/README.md) 与 [常驻启动说明.md](/Users/gato-pm/Desktop/API_副本/常驻启动说明.md) 中不再存在误导性的旧端口 `3000/19001/19002/19003`，命中的旧路径仅作为“禁止项”说明存在；2）按文档实跑 `npm run service:restart` 与 `npm run service:status`，确认四个服务的 `working directory` 都是 `/Users/gato-pm/Desktop/API_副本`，监听端口为 `3100/19101/19102/19103`；3）按文档执行 `curl -sS http://127.0.0.1:3100/health` 成功返回 `{"success":true,...}`；4）按文档执行 `curl -sS http://127.0.0.1:3100/api/console/configs/catalog` 成功返回配置目录结果，请求号为 `req_20260413_135712754_2ba1c851`。

## 7. 资产复制映射表

说明：

1. 下表只覆盖“本地文件资产”的复制策略，不覆盖数据库、云端 LLM、Gateway 这类外部依赖。
2. `必须复制 = 是` 表示该资产要进入 `_副本`，后续运行时不得再从旧仓或共享目录读取。
3. `允许继续共享 = 否` 表示本轮自闭环完成后，运行时应禁止再引用原路径。
4. `目标文件` 按后续任务默认落点给出，具体复制动作由 `C1-*` 阶段执行。

| 场景/业务 | 资源类型 | 当前来源 | 目标文件 | 必须复制 | 允许继续共享 | 复制原因 |
| --- | --- | --- | --- | --- | --- | --- |
| `payment-info-split` | prompt | `/Users/gato-pm/Desktop/API/references/payment-info-split/prompt.md` | `references/payment-info-split/prompt.md` | 是 | 否 | direct-model 场景当前直接引用旧仓 prompt，若不复制会持续串到旧目录。 |
| `payment-info-split` | output schema | `/Users/gato-pm/Desktop/API/references/payment-info-split/output_schema.json` | `references/payment-info-split/output_schema.json` | 是 | 否 | direct-model 输出校验依赖 schema，必须与 `_副本` prompt 同步收口。 |
| `payment-info-split` | models profile | `旧共享运行时目录/agents/payment-fast-agent/agent/models.json` | `runtime-assets/project-runtime/agents/payment-fast-agent/agent/models.json` | 是 | 否 | 当前模型配置和 fallback key 仍来自共享 退役 Agent 运行时 目录。 |
| `payment-info-split` | auth profile | `旧共享运行时目录/agents/payment-fast-agent/agent/auth-profiles.json` | `runtime-assets/project-runtime/agents/payment-fast-agent/agent/auth-profiles.json` | 是 | 否 | 后续 direct-model 兜底凭证读取要收回 `_副本`。 |
| `sales-opportunity-advisor` | skill entry | `旧共享运行时目录/workspace-sales-agent/skills/sales-opportunity-advisor/SKILL.md` | `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/SKILL.md` | 是 | 否 | helper 场景入口 skill 当前完全依赖共享 workspace。 |
| `sales-opportunity-advisor-directdb` | skill entry | `旧共享运行时目录/workspace-sales-agent/skills/sales-opportunity-advisor-directdb/SKILL.md` | `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb/SKILL.md` | 是 | 否 | directdb 场景入口 skill 当前完全依赖共享 workspace。 |
| `sales-opportunity-advisor*` | decision rules | `旧共享运行时目录/workspace-sales-agent/skills/sales-opportunity-advisor/references/decision_rules.md` | `references/sales-opportunity-advisor/decision_rules.md` | 是 | 否 | 两个销售机会场景共用规则文件，必须在 `_副本` 内形成单一受控副本。 |
| `sales-opportunity-advisor*` | output schema | `旧共享运行时目录/workspace-sales-agent/skills/sales-opportunity-advisor/references/output_schema.json` | `references/sales-opportunity-advisor/output_schema.json` | 是 | 否 | 结构化输出 schema 当前被 scene config 和 platform skill YAML 双重引用。 |
| `sales-opportunity-advisor*` | dictionary | `/Users/gato-pm/Desktop/API/metadata/sales_opportunity_dictionary.tsv` | `metadata/sales_opportunity_dictionary.tsv` | 是 | 否 | scene config 和 platform skill/query 都依赖该字典，必须去掉旧仓引用。 |
| `sales-opportunity-advisor` | generated query script | `/Users/gato-pm/Desktop/API/ContextHelper/generated-queries/sales-opportunity-advisor.generated.js` | `ContextHelper/generated-queries/sales-opportunity-advisor.generated.js` | 是 | 否 | helper query profile 当前指向旧仓 generated query。 |
| `sales-opportunity-advisor` | generated query manifest | `/Users/gato-pm/Desktop/API/ContextHelper/generated-queries/manifest.json` | `ContextHelper/generated-queries/manifest.json` | 是 | 否 | helper query profile 当前指向旧仓 manifest。 |
| `sales-opportunity-advisor-directdb` | sql cache | `/Users/gato-pm/Desktop/API/DirectDbRunner/sql-cache/sales-opportunity-advisor-directdb.sql.json` | `DirectDbRunner/sql-cache/sales-opportunity-advisor-directdb.sql.json` | 是 | 否 | directdb query profile 当前指向旧仓 SQL 缓存。 |
| `sales-opportunity-advisor*` | sales agent models profile | `旧共享运行时目录/agents/sales-agent/agent/models.json` | `runtime-assets/project-runtime/agents/sales-agent/agent/models.json` | 是 | 否 | 退役 Agent 运行时 agent-runtime 仍需模型列表与 provider 配置。 |
| `sales-opportunity-advisor*` | sales agent auth profile | `旧共享运行时目录/agents/sales-agent/agent/auth-profiles.json` | `runtime-assets/project-runtime/agents/sales-agent/agent/auth-profiles.json` | 是 | 否 | agent-runtime 仍需 provider 鉴权配置，但应改为 `_副本` 自持。 |
| `sales-opportunity-advisor*` | skill references 目录 | `旧共享运行时目录/workspace-sales-agent/skills/sales-opportunity-advisor/references/` | `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor/references/` | 是 | 否 | 保留原 skill 目录结构，便于低风险迁移后再逐步拆 prompt/schema/rules。 |
| `sales-opportunity-advisor-directdb` | skill references 目录 | `旧共享运行时目录/workspace-sales-agent/skills/sales-opportunity-advisor-directdb/references/` | `runtime-assets/project-runtime/workspace/skills/sales-opportunity-advisor-directdb/references/` | 是 | 否 | directdb skill 目录也要先整体复制，避免迁移中缺失附属参考文件。 |
| `_副本` 通用运行环境 | DB 连接参数 | `_副本/.env` 中的 `SQLSERVER_*` | 不复制，继续保留在 `_副本/.env` | 否 | 是 | 外部数据库属于显式外部依赖，不是本地文件资产。 |
| `_副本` 通用运行环境 | LLM provider key | `_副本/.env` 中的 `MOONSHOT_API_KEY` 等 | 不复制，继续保留在 `_副本/.env` | 否 | 是 | 云端模型凭证属于显式外部依赖，不属于本轮文件复制对象。 |
| `_副本` 通用运行环境 | Gateway token | `_副本/.env` 中的 `旧 gateway token` | 不复制，继续保留在 `_副本/.env` | 否 | 是 | Gateway 鉴权值应留在环境变量，不写入复制资产目录。 |

## 8. 最终放行检查清单

- [x] `rg -n '/Users/gato-pm/Desktop/API(?!_)|旧共享运行时目录' scene-configs platform services deploy --pcre2` 只允许命中文档说明，不允许命中运行时配置。
- [x] `npm run service:restart` 后四个服务的 `WorkingDirectory` 都指向 `_副本`。
- [x] `curl http://127.0.0.1:3100/health` 成功。
- [x] `curl -X POST http://127.0.0.1:3100/api/agent/run` 调 `payment-info-split` 成功。
- [x] `curl -X POST http://127.0.0.1:3100/api/agent/run` 调 `sales-opportunity-advisor` 成功。
- [x] `curl POST /api/agent/run` 调 `sales-opportunity-advisor-directdb` 成功。
- [x] `curl POST http://127.0.0.1:3200/api/agent/run` 能代理到 `_副本` API。
- [x] 配置目录、配置校验、编译预览页可正常打开。

## 9. 建议执行顺序

后续若要按本文档推进，建议严格按下面顺序：

1. `C0-T1`
2. `C0-T2`
3. `C1-T1`
4. `C1-T2`
5. `C1-T3`
6. `C1-T4`
7. `C2-T1`
8. `C2-T2`
9. `C2-T3`
10. `C3-T1`
11. `C3-T2`
12. `C3-T3`
13. `C4-T1`
14. `C4-T2`
15. `C4-T3`
16. `C4-T4`
17. `C5-T1`
18. `C5-T2`
19. `C5-T3`
20. `C6-T1`
21. `C6-T2`
22. `C6-T3`

说明：

- `payment-info-split` 先收口，因为它链路最短，最适合作为“路径闭环”试点。
- `sales-opportunity-advisor*` 放在第二批，避免一开始同时动 skill、query、helper、directdb。
- 去掉旧目录 fallback 一定要放在最后，否则中途很容易把现有链路打断。
