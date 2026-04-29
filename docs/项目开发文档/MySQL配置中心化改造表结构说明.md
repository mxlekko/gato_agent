# MySQL 配置中心化改造表结构说明

本文档记录 `T1-01 建立 MySQL 表结构` 的落地结果，覆盖当前配置中心核心表、执行脚本和验证方式。

## 1. 核心表清单

当前已在 `config_center_dev` 中创建以下 8 张核心表：

- `cfg_scene_configs`
- `cfg_platform_resources`
- `cfg_scene_assets`
- `cfg_helper_scripts`
- `cfg_revisions`
- `cfg_releases`
- `cfg_release_entries`
- `cfg_release_pointers`

## 2. 结构文件与执行脚本

- 建表 SQL：[scripts/sql/config_center_schema.sql](/Users/gato-pm/Desktop/API_副本/scripts/sql/config_center_schema.sql)
- 执行 / 检查脚本：[scripts/manage_mysql_config_schema.js](/Users/gato-pm/Desktop/API_副本/scripts/manage_mysql_config_schema.js)

推荐命令：

```bash
node scripts/manage_mysql_config_schema.js apply
node scripts/manage_mysql_config_schema.js inspect
npm run mysql:schema:apply
npm run mysql:schema:inspect
```

## 3. 约束与索引策略

本轮已落实主文档中要求的唯一约束，并补齐了后续控制面和发布面常用查询的辅助索引：

- `cfg_scene_configs`
  - `unique(scene)`
  - `index(current_revision_id)`
  - `index(status, updated_at)`
- `cfg_platform_resources`
  - `unique(kind, name, version)`
  - `unique(ref)`，保留 `NULL` 多值兼容
  - `index(scene)`、`index(current_revision_id)`、`index(kind, status)`
- `cfg_scene_assets`
  - `unique(scene, asset_type)`
  - `index(ref)`、`index(current_revision_id)`、`index(status)`
- `cfg_helper_scripts`
  - `unique(scene, script_type)`
  - `index(script_name)`、`index(current_revision_id)`、`index(status)`
- `cfg_revisions`
  - `unique(target_type, target_id, revision_no)`
  - `index(target_type, target_id, created_at)`、`index(checksum)`
- `cfg_releases`
  - `unique(release_id)`
  - `index(environment, scope_type, scope_value, status)`、`index(created_at)`
- `cfg_release_entries`
  - `index(release_id)`
  - `index(release_id, entry_type, entry_key)`
  - `index(revision_id)`
- `cfg_release_pointers`
  - `unique(environment, scope_type, scope_value)`
  - `index(active_release_id)`

## 4. 当前边界

本任务只完成表结构创建，不做以下事情：

- 不实现 MySQL 仓储层
- 不导入现有文件配置
- 不切换控制台读写链路
- 不让 runtime 请求路径直接读取 MySQL 草稿

这些动作分别留给 `T1-02`、`T1-03`、`T2-01` 之后的任务。
