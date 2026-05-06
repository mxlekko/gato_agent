# MySQL 配置中心化改造初始化导入说明

## 1. 目标

`T1-03` 负责把当前仓库中的配置基线一次性导入 MySQL 草稿表，作为后续控制台改造的初始数据。

本轮导入范围包括：

- `scene-configs/*.json`
- `platform/templates/*.yaml`
- `platform/skills/*.yaml`
- `platform/tools/*.yaml`
- `platform/assets/prompts/*.md`
- `runtime-assets/project-runtime/workspace/skills/**/references/*.md|*.json`
- `metadata/*.tsv`
- `ContextHelper/generated-queries/*.generated.js`

仍然遵守总架构约束：

- MySQL 只作为控制面草稿真源
- runtime 仍然不能直接读取 MySQL 草稿
- 发布与 bundle 切换留给后续任务

## 2. 脚本

新增脚本：`scripts/import_config_to_mysql.js`

支持两个命令：

- `import`：执行导入，然后立即校验导入结果
- `verify`：只做校验，不写入数据

对应 npm 命令：

- `npm run mysql:import-config`
- `npm run mysql:import-config:verify`

## 3. 导入规则

### 3.1 Scene Config

- 直接读取 `scene-configs/*.json` 原始文本
- 不复用 `file-store` 的解析结果入库，避免把路径解析后的扩展字段写进 MySQL
- 每个 scene config 写入 `cfg_scene_configs`，并生成 revision 1

### 3.2 Platform Resource

- 复用 `platform/compiler/validate.js` 的 YAML 解析入口
- 原始 YAML 文本写入 `cfg_platform_resources`
- 覆盖 `template / skill / tool / query`

### 3.3 Scene Asset

- `prompt / schema / dictionary / rules` 主要从 `BusinessSkill.spec.assetRefs` 收集
- `direct-model` 场景额外从 scene config 的 `directModel.promptFile` 和 `schemaReferenceId` 收集 prompt / schema
- 资产内容按文件原文写入 `cfg_scene_assets`
- `.json` 资产会同时保存解析后的 JSON 结构，便于 revision 留痕

### 3.4 Helper Script

- 导入 `ContextHelper/generated-queries/*.generated.js`
- 每个 scene 只允许一个 `generated-query` helper script
- 当前不导入 `ContextHelper/generated-queries/manifest.json`

## 4. 幂等策略

- 导入前会先构造完整的文件基线快照
- 若 MySQL 当前草稿记录与文件内容完全一致，则跳过该对象，不重复生成 revision
- 若记录不存在或内容不一致，则写入并生成新 revision

因此第一次导入会为每个对象生成 revision 1；后续重复执行时，未变更对象会直接跳过。

## 5. 校验内容

`verify` 会校验：

- MySQL 当前记录数量与文件基线数量完全一致
- 每条 scene/resource/asset/helper 数据与当前文件内容一致
- 每条记录都存在 `current_revision_id`
- 当前 revision 的 checksum 与源文件一致
- 初始导入后的每个对象只有 1 条 revision，且编号为 1

## 6. 当前基线结果

按当前仓库内容，初始化导入后应得到：

- `sceneConfigs = 4`
- `platformResources = 12`
- `sceneAssets = 14`
- `helperScripts = 2`
- `revisions = 32`

## 7. 备注

- `manifest.json` 目前仍保留在文件基线中，原因是 `cfg_helper_scripts` 采用“按 scene 建模”，而 manifest 属于全局辅助元数据；等 `T5-02 helper script 纳入 release bundle` 时再一起纳入 bundle 渲染链路。
- 当前脚本只负责“文件 -> MySQL 草稿”的初始化导入，不会反向覆盖本地文件，也不会改动 runtime 读取路径。
