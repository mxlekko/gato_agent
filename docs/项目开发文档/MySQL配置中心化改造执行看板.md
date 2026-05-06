# MySQL 配置中心化改造执行看板

## 1. 文件用途

本文件是“**顺序执行版任务看板**”，用于配合主文档：

- `MySQL配置中心化改造系统架构与任务清单.md`

后续人工实施、AI 接力执行、阶段验收，都以本文件中的任务状态为准。

---

## 2. 状态说明

任务状态只允许使用以下四种：

- `TODO`：未开始
- `DOING`：进行中
- `DONE`：已完成
- `BLOCKED`：受阻，不能继续

说明：

- `DOING`、`TODO`、`BLOCKED` 都属于“未完成”
- `DONE` 才代表该任务真正结束
- 任何未更新状态的任务，默认视为未完成

---

## 3. AI 顺序执行规则

AI 必须严格按以下流程执行：

1. 先读取主文档与本执行看板
2. 从“任务总表”顶部开始，寻找**第一个状态不是 `DONE` 的任务**
3. 如果该任务是 `DOING`，继续完成它
4. 如果该任务是 `TODO`，先改为 `DOING`，再开始实施
5. 如果该任务是 `BLOCKED`，必须先汇报阻塞原因，不能跳过它去做后续任务
6. 每一轮只允许执行一个任务，不允许同时推进多个任务
7. 任务完成后，必须把状态改为 `DONE`
8. 任务受阻后，必须把状态改为 `BLOCKED`，并补充阻塞说明
9. 每次任务结束后，必须补充：
   - 改动文件
   - 新增文件
   - 验证命令
   - 风险 / 备注
   - 回退方式
10. 下一轮再次从任务总表顶部扫描，不允许凭记忆跳到后面的任务

---

## 4. 任务总表

- `001` | `T0-01` | `DONE` | 前置：无 | 冻结当前文件布局与运行基线
- `002` | `T0-02` | `DONE` | 前置：T0-01 | 建立 bundle root 与环境变量规范
- `003` | `T0-03` | `DONE` | 前置：T0-02 | 准备 MySQL 环境
- `004` | `T0-04` | `DONE` | 前置：T0-03 | 初始化数据库与账号权限
- `005` | `T0-05` | `DONE` | 前置：T0-04 | 配置连接参数并验证连通性
- `006` | `T1-01` | `DONE` | 前置：T0-05 | 建立 MySQL 表结构
- `007` | `T1-02` | `DONE` | 前置：T1-01 | 实现 MySQL 仓储层
- `008` | `T1-03` | `DONE` | 前置：T1-02 | 编写初始化导入脚本
- `009` | `T2-01` | `DONE` | 前置：T1-03 | 改造 Console Scene Asset 读写链路
- `010` | `T2-02` | `DONE` | 前置：T2-01 | 改造 Console Config Catalog 读写链路
- `011` | `T2-03` | `DONE` | 前置：T2-02 | 场景绑定改为读取草稿配置
- `012` | `T3-01` | `DONE` | 前置：T2-03 | 实现 release manager
- `013` | `T3-02` | `DONE` | 前置：T3-01 | 实现 bundle renderer
- `014` | `T3-03` | `DONE` | 前置：T3-02 | 实现发布前校验
- `015` | `T4-01` | `DONE` | 前置：T3-03 | 改造场景配置读取入口
- `016` | `T4-02` | `DONE` | 前置：T4-01 | 改造平台资源读取入口
- `017` | `T4-03` | `DONE` | 前置：T4-02 | 改造 QueryProfile 运行时加载
- `018` | `T4-04` | `DONE` | 前置：T4-03 | 改造 runtime 资产加载
- `019` | `T4-05` | `DONE` | 前置：T4-04 | 改造 direct-model 资产解析
- `020` | `T5-01` | `DONE` | 前置：T4-05 | 去除 ContextHelper 硬编码项目根路径
- `021` | `T5-02` | `DONE` | 前置：T5-01 | helper script 纳入 release bundle
- `022` | `T6-01` | `DONE` | 前置：T5-02 | 实现回滚接口
- `023` | `T6-02` | `DONE` | 前置：T6-01 | 实现审计日志与 revision 查询
- `024` | `T6-03` | `DONE` | 前置：T6-02 | 实现发布状态与运行状态可观测

---

## 5. 任务卡片

以下卡片用于记录每个任务的执行结果。详细目标、动作、验收标准请回看主文档对应章节。

### T0-01 冻结当前文件布局与运行基线

- 前置任务：无
- 参考：主文档 `Phase 0 / T0-01`
- 开始时间：2026-04-16 11:16:04 +0800
- 完成时间：2026-04-16 11:17:50 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`
- 新增文件：`MySQL配置中心化改造运行基线清单.md`
- 验证命令：`rg --files scene-configs platform runtime-assets/project-runtime/workspace/skills ContextHelper/generated-queries | sort`；`sed -n '1,260p' MySQL配置中心化改造运行基线清单.md`；`rg -n '^### 6\\.[1-4]|^## 8\\.' MySQL配置中心化改造运行基线清单.md`
- 风险 / 备注：已冻结 4 类主基线目录并列出 4 个场景的当前生效配置来源；同时确认当前运行还依赖 `platform/assets/prompts/*.md`、`references/payment-info-split/*`、`metadata/*.tsv`、`DirectDbRunner/sql-cache/*` 等主基线外路径；`sales-opportunity-advisor-directdb` 存在 scene-config 与 BusinessSkill 数据工具绑定不完全一致的问题，需在后续任务中继续核准。
- 回退方式：删除 `MySQL配置中心化改造运行基线清单.md`，并将任务总表中的 `T0-01` 状态改回 `TODO`，清空本任务卡片记录。

### T0-02 建立 bundle root 与环境变量规范

- 前置任务：T0-01
- 参考：主文档 `Phase 0 / T0-02`
- 开始时间：2026-04-16 11:18:00 +0800
- 完成时间：2026-04-16 11:23:14 +0800
- 改动文件：`MySQL配置中心化改造系统架构与任务清单.md`；`MySQL配置中心化改造执行看板.md`
- 新增文件：`MySQL配置中心化改造Bundle与环境变量规范.md`
- 验证命令：`sed -n '398,475p' MySQL配置中心化改造系统架构与任务清单.md`；`sed -n '1,260p' MySQL配置中心化改造Bundle与环境变量规范.md`；`rg -n 'CONFIG_BUNDLE_ROOT|CONFIG_ACTIVE_ENV|current|local|test|prod|projectRoot|runtimeRoot|sql-cache|references|metadata' MySQL配置中心化改造Bundle与环境变量规范.md`
- 风险 / 备注：已明确 `CONFIG_BUNDLE_ROOT`、`CONFIG_ACTIVE_ENV` 及其派生路径规则，并补齐本地开发 / 测试 / 生产三套路径规范；同时将主文档中的 bundle 目录结构修正为自包含 project root 镜像，纳入 `platform/assets/prompts`、`metadata`、`references`、`DirectDbRunner/sql-cache` 等当前基线仍依赖的目录。注意：本任务只完成规范定义，当前运行时代码仍未读取 bundle，真正切换留给 `T4-01 ~ T5-02`。
- 回退方式：删除 `MySQL配置中心化改造Bundle与环境变量规范.md`，回退 `MySQL配置中心化改造系统架构与任务清单.md` 中新增的 bundle 目录与环境变量细化说明，并将任务总表中的 `T0-02` 状态改回 `TODO`，清空本任务卡片记录。

### T0-03 准备 MySQL 环境

- 前置任务：T0-02
- 参考：主文档 `Phase 0 / T0-03`
- 开始时间：2026-04-16 11:36:37 +0800
- 完成时间：2026-04-16 11:41:33 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`
- 新增文件：`MySQL配置中心化改造环境准备说明.md`；`scripts/manage_local_mysql.sh`
- 验证命令：`scripts/manage_local_mysql.sh env`；`scripts/manage_local_mysql.sh start`；`scripts/manage_local_mysql.sh ping`；`scripts/manage_local_mysql.sh client -e "SELECT VERSION() AS version, @@port AS port, @@bind_address AS bind_address, @@character_set_server AS charset, @@collation_server AS collation, @@global.time_zone AS tz;"`；`lsof -nP -iTCP:3306 -sTCP:LISTEN`；`sed -n '1,220p' MySQL配置中心化改造环境准备说明.md`
- 风险 / 备注：已在本机用户目录 `~/.codex-mysql` 落地一个可访问的 MySQL Community Server `8.4.8 LTS` 实例，监听 `127.0.0.1:3306`，默认 `utf8mb4`、`utf8mb4_0900_ai_ci`、`UTC`；测试 / 生产已明确为托管 MySQL / RDS 承载，但实例本身尚未在本任务实际申请；本地引导阶段 `root@localhost` 为空密码，仅限回环访问，必须在 `T0-04` / `T0-05` 中补齐独立数据库、应用账号、权限边界与连接参数治理；由于 macOS 默认大小写不敏感文件系统，当前本地实例初始化后 `lower_case_table_names=2`，仅作为开发环境使用，不作为生产参数样板。
- 回退方式：执行 `scripts/manage_local_mysql.sh stop` 停掉本地实例，删除用户目录 `~/.codex-mysql` 下的安装、数据、运行与日志文件；删除 `MySQL配置中心化改造环境准备说明.md` 与 `scripts/manage_local_mysql.sh`，并将任务总表中的 `T0-03` 状态改回 `TODO`，清空本任务卡片记录。

### T0-04 初始化数据库与账号权限

- 前置任务：T0-03
- 参考：主文档 `Phase 0 / T0-04`
- 开始时间：2026-04-16 11:42:57 +0800
- 完成时间：2026-04-16 11:47:52 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`
- 新增文件：`MySQL配置中心化改造数据库与账号权限说明.md`；`scripts/init_config_center_mysql_access.sh`
- 验证命令：`scripts/init_config_center_mysql_access.sh env`；`scripts/init_config_center_mysql_access.sh init`；`scripts/init_config_center_mysql_access.sh verify`；`scripts/manage_local_mysql.sh client -e "SHOW DATABASES LIKE 'config_center_dev'; SHOW GRANTS FOR 'cfg_app_dev'@'127.0.0.1'; SHOW GRANTS FOR 'cfg_app_dev'@'localhost';"`；`source ~/.codex-mysql/config-center-dev.env && MYSQL_BASE_DIR="$(scripts/manage_local_mysql.sh env | awk -F= '/^MYSQL_BASE_DIR=/{print $2}')" && MYSQL_PWD="$CONFIG_CENTER_APP_PASSWORD" "$MYSQL_BASE_DIR/bin/mysql" --protocol=TCP -h "$CONFIG_CENTER_HOST" -P "$CONFIG_CENTER_PORT" -u "$CONFIG_CENTER_APP_USER" "$CONFIG_CENTER_DB" -e "SELECT CURRENT_USER() AS current_login, DATABASE() AS current_db;"`；`ls -l ~/.codex-mysql/config-center-dev.env`；`bash -n scripts/init_config_center_mysql_access.sh`；`sed -n '1,220p' MySQL配置中心化改造数据库与账号权限说明.md`
- 风险 / 备注：已在本地 MySQL 实例中创建独立数据库 `config_center_dev`，并创建独立应用账号 `cfg_app_dev@127.0.0.1` / `cfg_app_dev@localhost`；账号权限严格限定在 `config_center_dev.*`，当前为开发效率授予 `SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX`，足以支撑后续建表与控制面开发，但测试 / 生产环境不得直接照搬，需按文档拆分为 DBA / migrator / app 三类职责；本地凭据已写入用户目录 `~/.codex-mysql/config-center-dev.env` 且权限为 `600`，本任务未把连接参数接入应用 `.env`，该动作留给 `T0-05`。
- 回退方式：使用本地 root 连接删除 `cfg_app_dev@127.0.0.1`、`cfg_app_dev@localhost` 两个账号并删除数据库 `config_center_dev`，然后删除 `~/.codex-mysql/config-center-dev.env`；仓库内删除 `MySQL配置中心化改造数据库与账号权限说明.md` 与 `scripts/init_config_center_mysql_access.sh`，并将任务总表中的 `T0-04` 状态改回 `TODO`，清空本任务卡片记录。

### T0-05 配置连接参数并验证连通性

- 前置任务：T0-04
- 参考：主文档 `Phase 0 / T0-05`
- 开始时间：2026-04-16 12:27:07 +0800
- 完成时间：2026-04-16 12:28:29 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`.env`；`.env.example`；`package.json`
- 新增文件：`MySQL配置中心化改造连接参数与连通性说明.md`；`scripts/verify_mysql_connection.js`
- 验证命令：`node -e "require('./utils/load-env').loadProjectEnv(); console.log(JSON.stringify({host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER, database: process.env.MYSQL_DATABASE}, null, 2));"`；`node scripts/verify_mysql_connection.js`；`npm run mysql:ping`；`node --check scripts/verify_mysql_connection.js`；`sed -n '1,220p' .env.example`；`sed -n '1,220p' MySQL配置中心化改造连接参数与连通性说明.md`
- 风险 / 备注：已把 `MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE` 接入当前仓库 `.env`，并在 `.env.example` 提供模板值，后续 `T1-01` / `T1-02` 可以直接复用；新增 `npm run mysql:ping` 通过仓库自带 `utils/load-env.js` 读取 `.env` 后执行真实 SQL 登录，验证结果为 `cfg_app_dev@127.0.0.1` 成功连接 `config_center_dev`；当前本地开发凭据仍保存在工作区 `.env`，测试 / 生产环境必须改为各自独立凭据与密钥管理，不得复用开发密码；本任务仅完成控制面后续开发所需的连接参数与探针，未让 runtime 请求路径直接读取 MySQL 草稿。
- 回退方式：删除 `.env` 与 `.env.example` 中新增的 `MYSQL_*` 配置块，移除 `package.json` 中的 `mysql:ping` 脚本，删除 `MySQL配置中心化改造连接参数与连通性说明.md` 与 `scripts/verify_mysql_connection.js`；如需彻底撤销本地连接准备，可一并删除 `~/.codex-mysql/config-center-dev.env` 中对应凭据引用，并将任务总表中的 `T0-05` 状态改回 `TODO`，清空本任务卡片记录。

### T1-01 建立 MySQL 表结构

- 前置任务：T0-05
- 参考：主文档 `Phase 1 / T1-01`
- 开始时间：2026-04-16 12:30:49 +0800
- 完成时间：2026-04-16 12:32:33 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`package.json`；`scripts/verify_mysql_connection.js`
- 新增文件：`MySQL配置中心化改造表结构说明.md`；`scripts/lib/mysql_cli.js`；`scripts/manage_mysql_config_schema.js`；`scripts/sql/config_center_schema.sql`
- 验证命令：`node --check scripts/lib/mysql_cli.js`；`node --check scripts/manage_mysql_config_schema.js`；`node --check scripts/verify_mysql_connection.js`；`node scripts/manage_mysql_config_schema.js apply`；`node scripts/manage_mysql_config_schema.js inspect`；`npm run mysql:schema:apply`；`npm run mysql:schema:inspect`；`npm run mysql:ping`；`node -e "const { runMysql } = require('./scripts/lib/mysql_cli'); const result = runMysql({ args: ['-e', 'SHOW CREATE TABLE cfg_scene_configs; SHOW CREATE TABLE cfg_release_entries;'] }); process.stdout.write(result.stdout);" `；`sed -n '1,260p' MySQL配置中心化改造表结构说明.md`
- 风险 / 备注：已在 `config_center_dev` 中创建 8 张配置中心核心表，并补齐主文档要求的唯一约束与辅助索引；建表入口采用 `scripts/sql/config_center_schema.sql` + `scripts/manage_mysql_config_schema.js`，可重复执行，但当前仅适合作为初始化脚本，未来字段演进仍需在后续任务中引入显式迁移策略，不能依赖 `CREATE TABLE IF NOT EXISTS` 自动对齐旧表；本轮暂未加外键，避免在导入脚本和 revision / release 写入顺序尚未稳定前把控制面流程锁死，跨表一致性约束先由后续仓储层与发布流程控制；同时保留了 `mysql:ping` 探针并改为复用共享 MySQL CLI helper，确保连通性检查与建表脚本使用同一组 `MYSQL_*` 参数。
- 回退方式：执行 `node -e "const { runMysql } = require('./scripts/lib/mysql_cli'); const sql = 'DROP TABLE IF EXISTS cfg_release_pointers; DROP TABLE IF EXISTS cfg_release_entries; DROP TABLE IF EXISTS cfg_releases; DROP TABLE IF EXISTS cfg_revisions; DROP TABLE IF EXISTS cfg_helper_scripts; DROP TABLE IF EXISTS cfg_scene_assets; DROP TABLE IF EXISTS cfg_platform_resources; DROP TABLE IF EXISTS cfg_scene_configs;'; runMysql({ args: ['-e', sql] });"` 删除 8 张核心表；仓库内删除 `MySQL配置中心化改造表结构说明.md`、`scripts/lib/mysql_cli.js`、`scripts/manage_mysql_config_schema.js`、`scripts/sql/config_center_schema.sql`，回退 `package.json` 与 `scripts/verify_mysql_connection.js` 的改动，并将任务总表中的 `T1-01` 状态改回 `TODO`，清空本任务卡片记录。

### T1-02 实现 MySQL 仓储层

- 前置任务：T1-01
- 参考：主文档 `Phase 1 / T1-02`
- 开始时间：2026-04-16 12:37:47 +0800
- 完成时间：2026-04-16 12:45:40 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`package.json`；`package-lock.json`
- 新增文件：`MySQL配置中心化改造仓储层说明.md`；`services/config-store/index.js`；`services/config-store/file-store.js`；`services/config-store/mysql-store.js`；`scripts/verify_config_store.js`
- 验证命令：`node --check services/config-store/mysql-store.js`；`node --check services/config-store/file-store.js`；`node --check services/config-store/index.js`；`node --check scripts/verify_config_store.js`；`node -e "require('./services/config-store/mysql-store'); require('./services/config-store/file-store'); require('./services/config-store'); console.log('config-store-load=ok');"`；`node scripts/verify_config_store.js`；`npm run mysql:store:verify`；`node -e "require('./utils/load-env').loadProjectEnv(); const { createConfigStore } = require('./services/config-store'); const fileStore = createConfigStore({ driver: 'file' }); const mysqlStore = createConfigStore({ driver: 'mysql' }); Promise.all([fileStore.listSceneConfigs(), fileStore.listPlatformResources(), mysqlStore.listSceneConfigs(), mysqlStore.listPlatformResources(), mysqlStore.listSceneAssets(), mysqlStore.listHelperScripts(), mysqlStore.listReleases()]).then(async ([fileScenes, fileResources, mysqlScenes, mysqlResources, mysqlAssets, mysqlHelpers, mysqlReleases]) => { console.log(JSON.stringify({ fileScenes: fileScenes.length, fileResources: fileResources.length, mysqlScenes: mysqlScenes.length, mysqlResources: mysqlResources.length, mysqlAssets: mysqlAssets.length, mysqlHelpers: mysqlHelpers.length, mysqlReleases: mysqlReleases.length }, null, 2)); await fileStore.close(); await mysqlStore.close(); }).catch((error) => { console.error(error.message); process.exit(1); });"`；`sed -n '1,260p' MySQL配置中心化改造仓储层说明.md`
- 风险 / 备注：已引入 `services/config-store/*` 三件套，其中 `mysql-store` 使用 `mysql2/promise` 直连当前 MySQL 配置库，草稿写入与 `cfg_revisions` 生成在同一事务内提交，覆盖 scene/resource/asset/helper/revision/release/pointer 这几类核心对象；`file-store` 目前是保守兼容层，只完整覆盖 scene config 与 platform resource，scene asset / helper script / revision / release 仍显式报“不支持”，这是刻意保留的边界，避免后续控制面迁移时出现静默回退；本轮额外新增了 `mysql2` 依赖，后续环境在拉最新代码后需要执行 `npm install`；验证脚本会写入并清理 probe 数据，已确认执行后当前 MySQL 草稿表中 scene/resource/asset/helper/release 当前记录均回到 0。
- 回退方式：删除 `services/config-store/index.js`、`services/config-store/file-store.js`、`services/config-store/mysql-store.js`、`scripts/verify_config_store.js` 与 `MySQL配置中心化改造仓储层说明.md`，回退 `package.json` 与 `package-lock.json` 中新增的 `mysql2` 依赖和 `mysql:store:verify` 脚本，并将任务总表中的 `T1-02` 状态改回 `TODO`，清空本任务卡片记录。

### T1-03 编写初始化导入脚本

- 前置任务：T1-02
- 参考：主文档 `Phase 1 / T1-03`
- 开始时间：2026-04-16 12:48:44 +0800
- 完成时间：2026-04-16 12:56:23 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`package.json`；`services/config-store/mysql-store.js`
- 新增文件：`MySQL配置中心化改造初始化导入说明.md`；`scripts/import_config_to_mysql.js`
- 验证命令：`node --check scripts/import_config_to_mysql.js`；`node --check services/config-store/mysql-store.js`；`node scripts/import_config_to_mysql.js import`；`npm run mysql:import-config`；`npm run mysql:import-config:verify`；`npm run mysql:store:verify`；`node -e 'require("./utils/load-env").loadProjectEnv(); const mysql=require("mysql2/promise"); (async()=>{const conn=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE}); const [counts]=await conn.query("SELECT ? AS table_name, COUNT(*) AS row_count FROM cfg_scene_configs UNION ALL SELECT ?, COUNT(*) FROM cfg_platform_resources UNION ALL SELECT ?, COUNT(*) FROM cfg_scene_assets UNION ALL SELECT ?, COUNT(*) FROM cfg_helper_scripts UNION ALL SELECT ?, COUNT(*) FROM cfg_revisions", ["cfg_scene_configs","cfg_platform_resources","cfg_scene_assets","cfg_helper_scripts","cfg_revisions"]); const [revisions]=await conn.query("SELECT COUNT(*) AS non_initial_revisions FROM cfg_revisions WHERE revision_no <> 1"); console.log(JSON.stringify({counts, nonInitialRevisions: revisions[0].non_initial_revisions}, null, 2)); await conn.end();})().catch((error)=>{console.error(error);process.exit(1);});'`；`sed -n '1,260p' MySQL配置中心化改造初始化导入说明.md`
- 风险 / 备注：已新增初始化导入脚本，按当前文件基线成功导入 `4` 条 scene config、`12` 条 platform resource、`14` 条 scene asset、`2` 条 helper script，并验证 `cfg_revisions` 共 `32` 条且全部 `revision_no=1`；为满足“与当前文件内容一致”的验收要求，本轮同时修正了 `mysql-store` 对 platform resource / scene asset / helper script 原始文本的 `trim()` 行为，改为保留源文件尾部换行与原文内容；`ContextHelper/generated-queries/manifest.json` 仍未导入 MySQL，因为当前 helper script 表是按 scene 建模，manifest 属于全局辅助元数据，计划在 `T5-02` 统一纳入 release bundle；本任务仅完成文件到 MySQL 草稿的初始化导入，runtime 仍未直接读取 MySQL 草稿。
- 回退方式：执行 `node -e 'require("./utils/load-env").loadProjectEnv(); const mysql=require("mysql2/promise"); (async()=>{const conn=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE}); await conn.query("DELETE FROM cfg_release_pointers"); await conn.query("DELETE FROM cfg_release_entries"); await conn.query("DELETE FROM cfg_releases"); await conn.query("DELETE FROM cfg_revisions"); await conn.query("DELETE FROM cfg_helper_scripts"); await conn.query("DELETE FROM cfg_scene_assets"); await conn.query("DELETE FROM cfg_platform_resources"); await conn.query("DELETE FROM cfg_scene_configs"); await conn.end();})().catch((error)=>{console.error(error);process.exit(1);});'` 清空本轮导入的草稿与 revision 数据；删除 `MySQL配置中心化改造初始化导入说明.md` 与 `scripts/import_config_to_mysql.js`，移除 `package.json` 中新增的 `mysql:import-config` / `mysql:import-config:verify` 脚本，回退 `services/config-store/mysql-store.js` 中“保留原始文本”的调整，并将任务总表中的 `T1-03` 状态改回 `TODO`，清空本任务卡片记录。

### T2-01 改造 Console Scene Asset 读写链路

- 前置任务：T1-03
- 参考：主文档 `Phase 2 / T2-01`
- 开始时间：2026-04-16 12:57:43 +0800
- 完成时间：2026-04-16 13:03:03 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`services/console-scenes.js`
- 新增文件：无
- 验证命令：`node --check services/console-scenes.js`；`node --check routes/console-scenes.js`；`node -e "require('./services/console-scenes'); console.log('console-scenes-load=ok');"`；`node -e "require('./utils/load-env').loadProjectEnv(); const svc=require('./services/console-scenes'); (async()=>{ const data=await svc.getConsoleScenePromptAssetContent('sales-opportunity-advisor'); console.log(JSON.stringify({scene:data.scene, assetType:data.assetType, ref:data.ref, storageDriver:data.storageDriver, storageTable:data.storageTable, contentPrefix:data.content.slice(0,40), updatedAt:data.updatedAt}, null, 2)); })().catch((error)=>{console.error(error);process.exit(1);});"`；`node <<'NODE'
require('./utils/load-env').loadProjectEnv();
const fs = require('fs/promises');
const svc = require('./services/console-scenes');

(async () => {
  const scene = 'sales-opportunity-advisor';
  const before = await svc.getConsoleScenePromptAssetContent(scene);
  const fileBefore = await fs.readFile(before.path, 'utf8');
  const draftContent = `${before.content.replace(/\n$/, '')}\n[T2-01 draft probe]\n`;
  const updated = await svc.updateConsoleScenePromptAssetContent(scene, draftContent);
  const fileAfterDraft = await fs.readFile(before.path, 'utf8');
  const draftReadback = await svc.getConsoleScenePromptAssetContent(scene);
  const restored = await svc.updateConsoleScenePromptAssetContent(scene, before.content);
  const fileAfterRestore = await fs.readFile(before.path, 'utf8');

  console.log(JSON.stringify({
    scene,
    storageDriver: before.storageDriver,
    fileUnchangedDuringDraftSave: fileAfterDraft === fileBefore,
    mysqlDraftChanged: draftReadback.content === updated.content && draftReadback.content !== before.content,
    restoredMatchesOriginal: restored.content === before.content && fileAfterRestore === fileBefore,
    draftUpdatedAt: updated.updatedAt,
    restoredUpdatedAt: restored.updatedAt
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE`；`node -e "require('./utils/load-env').loadProjectEnv(); const svc=require('./services/console-scenes'); (async()=>{ const directPrompt=await svc.getConsoleScenePromptAssetContent('payment-info-split'); const directSchema=await svc.getConsoleSceneSchemaAssetContent('payment-info-split'); console.log(JSON.stringify({ prompt:{ref:directPrompt.ref, storageDriver:directPrompt.storageDriver, path:directPrompt.path}, schema:{ref:directSchema.ref, storageDriver:directSchema.storageDriver, path:directSchema.path} }, null, 2)); })().catch((error)=>{console.error(error);process.exit(1);});"`；`node -e "require('./utils/load-env').loadProjectEnv(); const svc=require('./services/console-scenes'); const { createConfigStore } = require('./services/config-store'); (async()=>{ const workflow=svc.getConsoleSceneWorkflow('sales-opportunity-advisor'); const store=createConfigStore({driver:'mysql'}); const asset=await store.getSceneAsset('sales-opportunity-advisor','prompt'); const revisions=await store.listRevisions({targetType:'scene-asset', targetId: asset.id, limit: 20}); console.log(JSON.stringify({ workflowEditablePrompt: workflow.editableAssets.prompt, promptCurrentRevisionId: asset.currentRevisionId, promptRevisionCount: revisions.length, latestRevisionNos: revisions.map((item)=>item.revisionNo) }, null, 2)); await store.close(); })().catch((error)=>{console.error(error);process.exit(1);});"`
- 风险 / 备注：已将 `services/console-scenes.js` 中 prompt / schema / dictionary / rules 的正文读取与保存切换为 MySQL `cfg_scene_assets` 草稿表，返回体中显式补充 `storageDriver=mysql` / `storageTable=cfg_scene_assets`，本地文件路径仅作为资产来源元数据保留，不再是控制台保存目标；`platform-managed` 场景保存后继续返回 `compilePreview`，`direct-model` 场景的 prompt / schema 也已可从 MySQL 草稿读取和保存，但这类场景没有 workflow graph 可编译，因此 `compilePreview` 返回 `null`；按真实 save/restore 验证后，本地文件确认未被修改，但为了证明 revision 生成链路生效，本轮在 `sales-opportunity-advisor:prompt`（`asset_id=25`）上新增了两条验证 revision：`id=109/revision_no=2` 与 `id=110/revision_no=3`，当前草稿内容已恢复原文。
- 回退方式：回退 `services/console-scenes.js` 中本轮改动，使 `getConsoleScene*AssetContent` / `updateConsoleSceneAssetContent` 恢复为文件读写实现，并将工作流返回中的 `editableAssets.*.storageDriver / storageTable / sourcePath` 字段移除；如需一并清理本轮真实 save/restore 验证留下的 revision，可执行 `UPDATE cfg_scene_assets SET current_revision_id = 96 WHERE id = 25; DELETE FROM cfg_revisions WHERE id IN (109, 110);`，使 `sales-opportunity-advisor:prompt` 回到初始导入时的 revision 1；随后将任务总表中的 `T2-01` 状态改回 `TODO`，清空本任务卡片记录。

### T2-02 改造 Console Config Catalog 读写链路

- 前置任务：T2-01
- 参考：主文档 `Phase 2 / T2-02`
- 开始时间：2026-04-16 13:05:03 +0800
- 完成时间：2026-04-16 13:15:46 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`platform/compiler/validate.js`；`services/console-configs.js`；`routes/console-configs.js`；`console/src/pages/configs/ConfigCatalogPage.jsx`
- 新增文件：无
- 验证命令：`node --check services/console-configs.js`；`node --check routes/console-configs.js`；`node --check platform/compiler/validate.js`；`node -e "require('./utils/load-env').loadProjectEnv(); const svc=require('./services/console-configs'); (async()=>{ const data=await svc.getConsoleConfigCatalog(); console.log(JSON.stringify({counts:data.counts, first:data.items[0] && {resourceId:data.items[0].resourceId, storageDriver:data.items[0].storageDriver, storageTable:data.items[0].storageTable, storagePath:data.items[0].storagePath, sourceFilePath:data.items[0].sourceFilePath}}, null, 2)); })().catch((error)=>{console.error(error);process.exit(1);});"`；`node -e "require('./utils/load-env').loadProjectEnv(); const svc=require('./services/console-configs'); (async()=>{ const data=await svc.validateConsoleConfigs(); console.log(JSON.stringify({valid:data.valid, issueCount:data.issueCount}, null, 2)); })().catch((error)=>{console.error(error);process.exit(1);});"`；`node -e "require('./utils/load-env').loadProjectEnv(); const svc=require('./services/console-configs'); (async()=>{ const data=await svc.compileConsoleConfigPreview({ scene: 'sales-opportunity-advisor' }); console.log(JSON.stringify({scene:data.scene, orderedNodeCount:(data.orderedNodeIds||[]).length, entryNode:data.entryNode, exitNode:data.exitNode, template:data.template && data.template.name, skill:data.skill && data.skill.name}, null, 2)); })().catch((error)=>{console.error(error);process.exit(1);});"`；`node -e "require('./utils/load-env').loadProjectEnv(); const route=require('./routes/console-configs'); (async()=>{ const result=await route.getConsoleConfigCatalogRoute(); console.log(JSON.stringify({statusCode:result.statusCode, success:result.payload.success, itemCount:result.payload.data.items.length}, null, 2)); })().catch((error)=>{console.error(error);process.exit(1);});"`；`node <<'NODE'
require('./utils/load-env').loadProjectEnv();
const fs = require('fs/promises');
const svc = require('./services/console-configs');
const { createConfigStore } = require('./services/config-store');
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function buildQueryBody(document, retryMaxAttempts) {
  const spec = document?.spec || {};
  const resultPolicy = spec.resultPolicy || {};
  return {
    primaryEntity: { table: spec.primaryEntity?.table || '', idField: spec.primaryEntity?.idField || '' },
    inputContract: {
      requiredInputs: Array.isArray(spec.inputContract?.requiredInputs) ? spec.inputContract.requiredInputs.slice() : [],
      fields: clone(spec.inputContract?.fields || {})
    },
    selectionPolicy: {
      cardinality: spec.selectionPolicy?.cardinality || '',
      where: clone(spec.selectionPolicy?.where || []),
      statement: { type: spec.selectionPolicy?.statement?.type || '' }
    },
    resultPolicy: {
      mode: resultPolicy.mode || 'single-row',
      fields: Array.isArray(resultPolicy.fields) ? resultPolicy.fields.slice() : [],
      distinct: resultPolicy.distinct === true,
      limit: resultPolicy.limit ?? null
    },
    limits: {
      timeoutMsDefault: Number(spec.limits?.timeoutMsDefault),
      timeoutMsMax: Number(spec.limits?.timeoutMsMax),
      retryMaxAttempts
    }
  };
}
function buildToolBody(document, retryMaxAttempts) {
  const spec = document?.spec || {};
  return {
    limits: {
      timeoutMsDefault: Number(spec.limits?.timeoutMsDefault),
      timeoutMsMax: Number(spec.limits?.timeoutMsMax),
      retryMaxAttempts
    },
    allowedScenes: Array.isArray(spec.policy?.allowedScenes) ? spec.policy.allowedScenes.slice() : []
  };
}
(async () => {
  const catalog = await svc.getConsoleConfigCatalog();
  const queryItem = catalog.items.find((item) => item.resourceId === 'query:sales-opportunity-by-opportunity-id@v1');
  const toolItem = catalog.items.find((item) => item.resourceId === 'tool:generic-query-runner@v1');
  const querySourceBefore = await fs.readFile(queryItem.sourceFilePath, 'utf8');
  const toolSourceBefore = await fs.readFile(toolItem.sourceFilePath, 'utf8');
  const queryOriginalRetry = Number(queryItem.document?.spec?.limits?.retryMaxAttempts || 0);
  const toolOriginalRetry = Number(toolItem.document?.spec?.limits?.retryMaxAttempts || 0);
  await svc.updateConsoleQueryStructuredConfig(queryItem.resourceId, buildQueryBody(queryItem.document, queryOriginalRetry + 1));
  await svc.updateConsoleToolStructuredConfig(toolItem.resourceId, buildToolBody(toolItem.document, toolOriginalRetry + 1));
  await svc.updateConsoleQueryStructuredConfig(queryItem.resourceId, buildQueryBody(queryItem.document, queryOriginalRetry));
  await svc.updateConsoleToolStructuredConfig(toolItem.resourceId, buildToolBody(toolItem.document, toolOriginalRetry));
  const querySourceAfterRestore = await fs.readFile(queryItem.sourceFilePath, 'utf8');
  const toolSourceAfterRestore = await fs.readFile(toolItem.sourceFilePath, 'utf8');
  const store = createConfigStore({ driver: 'mysql' });
  try {
    const query = await store.getPlatformResource({ kind: queryItem.kind, name: queryItem.name, version: queryItem.version });
    const tool = await store.getPlatformResource({ kind: toolItem.kind, name: toolItem.name, version: toolItem.version });
    const queryRevisions = await store.listRevisions({ targetType: 'platform-resource', targetId: query.id, limit: 3 });
    const toolRevisions = await store.listRevisions({ targetType: 'platform-resource', targetId: tool.id, limit: 3 });
    console.log(JSON.stringify({
      query: { sourceUnchangedAfterRestore: querySourceAfterRestore === querySourceBefore, currentRevisionId: query.currentRevisionId, latestRevisionIds: queryRevisions.map((revision) => revision.id) },
      tool: { sourceUnchangedAfterRestore: toolSourceAfterRestore === toolSourceBefore, currentRevisionId: tool.currentRevisionId, latestRevisionIds: toolRevisions.map((revision) => revision.id) }
    }, null, 2));
  } finally {
    await store.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
NODE`；`npm --prefix console run build`
- 风险 / 备注：`services/console-configs.js` 已切换为从 MySQL `cfg_platform_resources` 草稿读取 skill/template/tool/query，返回体新增 `storageDriver=mysql` / `storageTable=cfg_platform_resources` / `storagePath=mysql://...`，`sourceFilePath` 仅保留导入来源路径；tool/query 保存操作不再写 YAML 文件，而是写回 MySQL 并生成 revision。`validateConsoleConfigs` / `compileConsoleConfigPreview` 现在基于 MySQL 平台资源草稿运行，但 scene -> skill 选择仍沿用 scene-config 文件，待 T2-03 再切。按真实 save/restore 验证后，query `sales-opportunity-by-opportunity-id@v1`（`cfg_platform_resources.id=16`）与 tool `generic-query-runner@v1`（`id=23`）的源 YAML 均确认未被修改；为证明 revision 生成链路生效，本轮新增了 query revision `111` / `113` 与 tool revision `112` / `114`，当前草稿内容已恢复原值，但 `current_revision_id` 分别指向恢复后的 revision `113` / `114`。
- 回退方式：回退 `platform/compiler/validate.js`、`services/console-configs.js`、`routes/console-configs.js`、`console/src/pages/configs/ConfigCatalogPage.jsx` 中本轮改动，使 catalog 目录读取、平台校验、编译预览和 tool/query 保存恢复为文件读写实现，并将页面中的“草稿存储 / 保存到草稿”文案恢复为文件语义；如需一并清理本轮真实 save/restore 验证留下的 revision，可执行 `UPDATE cfg_platform_resources SET current_revision_id = 77 WHERE id = 16; UPDATE cfg_platform_resources SET current_revision_id = 84 WHERE id = 23; DELETE FROM cfg_revisions WHERE id IN (111, 112, 113, 114);`，使 query `sales-opportunity-by-opportunity-id@v1` 与 tool `generic-query-runner@v1` 回到初始导入时的 revision 1；随后将任务总表中的 `T2-02` 状态改回 `TODO`，清空本任务卡片记录。

### T2-03 场景绑定改为读取草稿配置

- 前置任务：T2-02
- 参考：主文档 `Phase 2 / T2-03`
- 开始时间：2026-04-16 13:18:03 +0800
- 完成时间：2026-04-16 13:27:19 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`services/console-scenes.js`；`routes/console-scenes.js`；`console/src/pages/scenes/SceneWorkflowPage.jsx`；`console/src/pages/scenes/ScenesPage.jsx`
- 新增文件：无
- 验证命令：`node --check services/console-scenes.js`；`node --check routes/console-scenes.js`；`node -e "require('./services/console-scenes'); console.log('console-scenes-load=ok');"`；`node <<'NODE'
require('./utils/load-env').loadProjectEnv();
const svc = require('./services/console-scenes');
(async()=> {
  const workflow = await svc.getConsoleSceneWorkflow('sales-opportunity-advisor');
  const binding = await svc.getConsoleSceneSkillBinding('sales-opportunity-advisor');
  const catalog = await svc.getConsoleSceneCatalog();
  console.log(JSON.stringify({
    workflow: {
      scene: workflow.scene,
      draftSkill: workflow.skill ? `${workflow.skill.name}@${workflow.skill.version}` : null,
      publishedSkill: workflow.configState?.published?.skillRef || null,
      hasUnpublishedChanges: workflow.configState?.hasUnpublishedChanges,
      storagePath: workflow.configState?.storagePath || null
    },
    binding: {
      current: binding.current ? `${binding.current.name}@${binding.current.version}` : null,
      publishedCurrent: binding.publishedCurrent ? `${binding.publishedCurrent.name}@${binding.publishedCurrent.version}` : null,
      storagePath: binding.storagePath,
      publishedPath: binding.publishedPath,
      hasUnpublishedChanges: binding.hasUnpublishedChanges
    },
    catalogFirst: catalog.items[0] ? {
      scene: catalog.items[0].scene,
      hasUnpublishedChanges: catalog.items[0].configState?.hasUnpublishedChanges
    } : null
  }, null, 2));
})().catch((error)=>{console.error(error);process.exit(1);});
NODE`；`node <<'NODE'
require('./utils/load-env').loadProjectEnv();
const fs = require('fs/promises');
const svc = require('./services/console-scenes');
const { createConfigStore } = require('./services/config-store');
(async () => {
  const scene = 'sales-opportunity-smart-entry';
  const beforeBinding = await svc.getConsoleSceneSkillBinding(scene);
  const fileBefore = await fs.readFile(beforeBinding.publishedPath, 'utf8');
  const saved = await svc.updateConsoleSceneSkillBinding(scene, { name: 'sales-opportunity-advisor', version: 'v1' });
  const afterSaveBinding = await svc.getConsoleSceneSkillBinding(scene);
  const afterSaveWorkflow = await svc.getConsoleSceneWorkflow(scene);
  const fileAfterSave = await fs.readFile(beforeBinding.publishedPath, 'utf8');
  const restored = await svc.updateConsoleSceneSkillBinding(scene, { name: beforeBinding.current.name, version: beforeBinding.current.version });
  const afterRestoreBinding = await svc.getConsoleSceneSkillBinding(scene);
  const afterRestoreWorkflow = await svc.getConsoleSceneWorkflow(scene);
  const fileAfterRestore = await fs.readFile(beforeBinding.publishedPath, 'utf8');
  const store = createConfigStore({ driver: 'mysql' });
  try {
    const draft = await store.getSceneConfig(scene);
    const revisions = await store.listRevisions({ targetType: 'scene-config', targetId: draft.id, limit: 5 });
    console.log(JSON.stringify({
      beforeHasUnpublishedChanges: beforeBinding.hasUnpublishedChanges,
      afterSave: {
        current: `${afterSaveBinding.current.name}@${afterSaveBinding.current.version}`,
        published: afterSaveBinding.publishedCurrent ? `${afterSaveBinding.publishedCurrent.name}@${afterSaveBinding.publishedCurrent.version}` : null,
        hasUnpublishedChanges: afterSaveBinding.hasUnpublishedChanges,
        workflowDraftSkill: afterSaveWorkflow.skill ? `${afterSaveWorkflow.skill.name}@${afterSaveWorkflow.skill.version}` : null,
        workflowPublishedSkill: afterSaveWorkflow.configState?.published?.skillRef || null,
        fileUnchanged: fileAfterSave === fileBefore,
        compilePreviewNodes: saved.compilePreview?.orderedNodeCount || null
      },
      afterRestore: {
        current: `${afterRestoreBinding.current.name}@${afterRestoreBinding.current.version}`,
        published: afterRestoreBinding.publishedCurrent ? `${afterRestoreBinding.publishedCurrent.name}@${afterRestoreBinding.publishedCurrent.version}` : null,
        hasUnpublishedChanges: afterRestoreBinding.hasUnpublishedChanges,
        workflowDraftSkill: afterRestoreWorkflow.skill ? `${afterRestoreWorkflow.skill.name}@${afterRestoreWorkflow.skill.version}` : null,
        workflowPublishedSkill: afterRestoreWorkflow.configState?.published?.skillRef || null,
        fileRestored: fileAfterRestore === fileBefore
      },
      draftState: {
        currentRevisionId: draft.currentRevisionId,
        latestRevisionIds: revisions.map((revision) => revision.id)
      },
      restoredCurrent: `${restored.current.name}@${restored.current.version}`
    }, null, 2));
  } finally {
    await store.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
NODE`；`node <<'NODE'
require('./utils/load-env').loadProjectEnv();
const routes = require('./routes/console-scenes');
(async()=> {
  const listResult = await routes.listConsoleScenesRoute();
  const workflowResult = await routes.getConsoleSceneWorkflowRoute('sales-opportunity-smart-entry');
  console.log(JSON.stringify({
    list: {
      statusCode: listResult.statusCode,
      itemCount: listResult.payload.data.items.length,
      firstScene: listResult.payload.data.items[0]?.scene || null,
      firstHasUnpublishedChanges: listResult.payload.data.items[0]?.configState?.hasUnpublishedChanges ?? null
    },
    workflow: {
      statusCode: workflowResult.statusCode,
      scene: workflowResult.payload.data.scene,
      draftSkill: workflowResult.payload.data.skill ? `${workflowResult.payload.data.skill.name}@${workflowResult.payload.data.skill.version}` : null,
      publishedSkill: workflowResult.payload.data.configState?.published?.skillRef || null,
      hasUnpublishedChanges: workflowResult.payload.data.configState?.hasUnpublishedChanges ?? null
    }
  }, null, 2));
})().catch((error)=>{console.error(error);process.exit(1);});
NODE`；`npm --prefix console run build`
- 风险 / 备注：`services/console-scenes.js` 中 scene workflow / scene catalog / skill binding 现在读取 MySQL `cfg_scene_configs` 草稿，并同时加载 `cfg_platform_resources` 草稿来构建模板、业务技能、工具与查询绑定，因此场景页展示的是控制台草稿视图；“当前发布”目前仍定义为仓库内 `scene-configs/*.json` 文件对应的现网前配置代理，而不是 release pointer，这个定义会在 `T3-01 ~ T4-01` 完成发布器与 bundle 切换后再收敛。场景业务技能绑定保存已改为写 MySQL scene-config draft 并生成 revision，不再回写文件；页面文案已改成“写入草稿 / 保存到草稿”，并显式展示草稿状态、草稿存储位置与当前发布 skillRef。按真实 save/restore 验证后，`sales-opportunity-smart-entry` 场景能看到 draft skill 与 published skill 分离，保存期间本地 `scene-configs/sales-opportunity-smart-entry.json` 未改动，restore 后状态恢复一致；为验证 revision 链路，本轮在 `sales-opportunity-smart-entry`（`cfg_scene_configs.id=11`）上新增了多条验证 revision，当前最新为 `id=120`，最近 5 条 revision 为 `120/119/118/117/116`。
- 回退方式：回退 `services/console-scenes.js`、`routes/console-scenes.js`、`console/src/pages/scenes/SceneWorkflowPage.jsx`、`console/src/pages/scenes/ScenesPage.jsx` 中本轮改动，使 scene workflow / scene catalog / skill binding 恢复为直接读取本地 `scene-configs/*.json` 文件，并将页面中的“草稿状态 / 当前发布 / 保存到草稿”提示恢复为文件语义；如需一并清理本轮真实 save/restore 验证留下的 revision，可执行 `UPDATE cfg_scene_configs SET current_revision_id = 76 WHERE id = 11; DELETE FROM cfg_revisions WHERE id IN (115, 116, 117, 118, 119, 120);`，使 `sales-opportunity-smart-entry` 回到初始导入时的 revision 1；随后将任务总表中的 `T2-03` 状态改回 `TODO`，清空本任务卡片记录。

### T3-01 实现 release manager

- 前置任务：T2-03
- 参考：主文档 `Phase 3 / T3-01`
- 开始时间：2026-04-16 13:34:33 +0800
- 完成时间：2026-04-16 13:41:02 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`
- 新增文件：`services/release-manager.js`；`scripts/verify_release_manager.js`
- 验证命令：`node --check services/release-manager.js`；`node --check scripts/verify_release_manager.js`；`node scripts/verify_release_manager.js`；`node -e 'require("./utils/load-env").loadProjectEnv(); const { createConfigStore } = require("./services/config-store"); (async()=>{ const store = createConfigStore({ driver: "mysql" }); const pointer = await store.getReleasePointer("local", "all", "*"); const releases = (await store.listReleases({ environment: "local" })).filter((item)=>item.releaseId.includes("_local_all_all_")); console.log(JSON.stringify({ pointer, matchingReleaseCount: releases.length }, null, 2)); await store.close(); })().catch((error)=>{ console.error(error); process.exit(1); });'`
- 风险 / 备注：已新增 release manager，支持按 `all` / `scene` scope 收集 MySQL 草稿对象、固定 `current_revision_id` 对应 revision、生成 `release_id`、写入 `cfg_releases` / `cfg_release_entries` / `cfg_release_pointers`，并把发布快照落到 bundle 目录中的 `manifest.json` 与 `entries/*`。当前 bundle 仍是 release manager 的最小落盘结构，真正面向 runtime 的目录镜像渲染留给 `T3-02`；为避免在 runtime 尚未切 bundle 前制造全局 `current` 语义歧义，文件系统 `current` symlink 目前只对 `scopeType=all` 更新，`scene` scope 只切数据库 pointer。`scopeType=scene` 下的平台资源当前采用“共享资源 + scene 精确匹配”的保守收集策略，后续若需要更细粒度依赖裁剪，再在 `T3-02 ~ T4-05` 结合 bundle renderer 与 runtime 消费路径一起收敛。验证脚本使用临时 bundle 根目录并在结束后自动清理；已额外确认 `local/all/*` pointer 与验证生成的 release 记录均未残留。
- 回退方式：删除 `services/release-manager.js` 与 `scripts/verify_release_manager.js`，并将任务总表中的 `T3-01` 状态改回 `TODO`，清空本任务卡片记录；如已通过该服务创建过真实发布记录，还需按对应 `release_id` 删除 `cfg_release_entries` / `cfg_releases`，按对应 scope 删除 `cfg_release_pointers`，并删除 bundle 根目录下对应的 release 目录与 `current` symlink（若该 symlink 指向该 release）。

### T3-02 实现 bundle renderer

- 前置任务：T3-01
- 参考：主文档 `Phase 3 / T3-02`
- 开始时间：2026-04-16 13:57:47 +0800
- 完成时间：2026-04-16 14:03:16 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`services/release-manager.js`
- 新增文件：`services/bundle-renderer.js`；`scripts/verify_bundle_renderer.js`
- 验证命令：`node --check services/bundle-renderer.js`；`node --check services/release-manager.js`；`node --check scripts/verify_bundle_renderer.js`；`node --check scripts/verify_release_manager.js`；`node scripts/verify_bundle_renderer.js`；`node scripts/verify_release_manager.js`；`node -e 'require("./utils/load-env").loadProjectEnv(); const { createConfigStore } = require("./services/config-store"); (async()=>{ const store = createConfigStore({ driver: "mysql" }); const pointer = await store.getReleasePointer("local", "all", "*"); const releases = (await store.listReleases({ environment: "local" })).filter((item)=>item.releaseId.includes("_local_all_all_")); console.log(JSON.stringify({ pointer, matchingReleaseCount: releases.length }, null, 2)); await store.close(); })().catch((error)=>{ console.error(error); process.exit(1); });'`；`node -e 'const fs=require("fs"); const path=require("path"); const tmpDir=path.join(process.cwd(), ".tmp"); const entries=fs.existsSync(tmpDir)?fs.readdirSync(tmpDir).filter((name)=>/bundle-renderer-verify|release-manager-verify/.test(name)):[]; console.log(JSON.stringify({ tempRoots: entries }, null, 2));'`
- 风险 / 备注：已新增 `services/bundle-renderer.js`，release 创建链路现在会先复制当前运行仍依赖的静态基线目录（`runtime-assets`、`metadata`、`references`、`DirectDbRunner/sql-cache`、`ContextHelper/generated-queries`、`platform/assets/prompts`），再用 MySQL release entries 覆盖 `scene-configs/*.json`、`platform/{skills,tools,templates}/*.yaml`、场景资产文件和 helper script，最终把 bundle 渲染成与当前运行时目录布局兼容的自包含目录。platform skill / query 文档中的绝对项目路径已在渲染时归一化为 `project://` / `runtime://`，因此后续 `T4-01 ~ T5-02` 切 active bundle 时可以直接复用这些配置对象；而 `SKILL.md`、helper manifest、directdb sql-cache 等当前仍带硬编码路径的静态文本，本轮先按基线复制保持兼容，后续分别由 `T5-01` / `T5-02` 继续收敛。`scopeType=scene` 的 bundle 当前仍会携带整套静态基线目录，而不是只裁剪本 scene 所需的只读文件，这是为了先保证结构兼容；更细粒度裁剪可在后续 runtime 切 bundle 时再做。两条真实验证链路均已自动清理测试 release、pointer 与临时 bundle 目录，确认当前 MySQL 中无验证残留。
- 回退方式：回退 `services/release-manager.js` 中对 bundle renderer 的接入，删除 `services/bundle-renderer.js` 与 `scripts/verify_bundle_renderer.js`，并将任务总表中的 `T3-02` 状态改回 `TODO`，清空本任务卡片记录；如已使用新渲染链路创建过真实 release，还需按对应 `release_id` 删除 `cfg_release_entries` / `cfg_releases`，按 scope 删除 `cfg_release_pointers`，并删除 bundle 根目录下对应 release 目录与 `current` symlink（若其指向该 release）。

### T3-03 实现发布前校验

- 前置任务：T3-02
- 参考：主文档 `Phase 3 / T3-03`
- 开始时间：2026-04-16 14:15:55 +0800
- 完成时间：2026-04-16 14:22:35 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`services/release-manager.js`
- 新增文件：`services/release-validator.js`；`scripts/verify_release_validator.js`
- 验证命令：`node --check services/release-validator.js`；`node --check services/release-manager.js`；`node --check scripts/verify_release_validator.js`；`node scripts/verify_release_validator.js`；`node scripts/verify_bundle_renderer.js`；`node scripts/verify_release_manager.js`；`node -e 'require("./utils/load-env").loadProjectEnv(); const { createConfigStore } = require("./services/config-store"); (async()=>{ const store = createConfigStore({ driver: "mysql" }); const pointer = await store.getReleasePointer("local", "all", "*"); const releases = (await store.listReleases({ environment: "local" })).filter((item)=>item.releaseId.includes("_local_all_all_")); console.log(JSON.stringify({ pointer, matchingReleaseCount: releases.length }, null, 2)); await store.close(); })().catch((error)=>{ console.error(error); process.exit(1); });'`；`node -e 'const fs=require("fs"); const path=require("path"); const tmpDir=path.join(process.cwd(), ".tmp"); const entries=fs.existsSync(tmpDir)?fs.readdirSync(tmpDir).filter((name)=>/bundle-renderer-verify|release-manager-verify|release-validator-verify/.test(name)):[]; console.log(JSON.stringify({ tempRoots: entries }, null, 2));'`
- 风险 / 备注：已新增 `services/release-validator.js`，发布链路现在会在 bundle 渲染完成后执行 scene config 结构与路径校验、platform resource registry 校验、JSON / YAML / TSV 解析校验、agent-runtime compile preview 校验，以及 helper script / helper manifest / migrationSource 文件存在性校验；`createRelease`、`activateRelease`、`rollbackRelease` 三条链路都会调用这套预检，因此缺少关键对象的 release 无法被保存为有效草稿后发布，已发布 release 如果 bundle 后续损坏也无法再次被激活。验证脚本已证明：健康 release 可以正常发布，而删除 `ContextHelper/generated-queries/sales-opportunity-advisor.generated.js` 后，激活会被 `release-validator` 阻断，pointer 与 `current` symlink 保持不变。当前预检只检查 runtime 真正消费的 bundle 配置与文件，不会去解释 `SKILL.md`、helper manifest 正文中的历史绝对路径文本；这些硬编码清理仍留给后续 `T5-01` / `T5-02`，本任务也未让 runtime 直接读取 MySQL 草稿。
- 回退方式：回退 `services/release-manager.js` 中对 `release-validator` 的接入，删除 `services/release-validator.js` 与 `scripts/verify_release_validator.js`，并将任务总表中的 `T3-03` 状态改回 `TODO`，清空本任务卡片记录；如需一并撤销验证，可删除本轮临时验证产生的 release（当前脚本已自动清理，无需额外处理）。

### T4-01 改造场景配置读取入口

- 前置任务：T3-03
- 参考：主文档 `Phase 4 / T4-01`
- 开始时间：2026-04-16 14:25:55 +0800
- 完成时间：2026-04-16 14:29:46 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`services/scene-config.js`
- 新增文件：`scripts/verify_active_bundle_scene_config.js`
- 验证命令：`node --check services/scene-config.js`；`node --check scripts/verify_active_bundle_scene_config.js`；`node scripts/verify_active_bundle_scene_config.js`；`node -e 'require("./utils/load-env").loadProjectEnv(); const fs=require("fs"); const path=require("path"); const { createConfigStore } = require("./services/config-store"); (async()=>{ const store=createConfigStore({driver:"mysql"}); const pointer=await store.getReleasePointer("local","all","*"); const currentPath=path.join(process.cwd(), ".local", "runtime-bundles", "local", "current"); const currentTarget=fs.readlinkSync(currentPath); console.log(JSON.stringify({ pointer, currentPath, currentTarget }, null, 2)); await store.close(); })().catch((error)=>{ console.error(error); process.exit(1); });'`；`node -e 'require("./utils/load-env").loadProjectEnv(); const { getSceneConfigSourceState, getSceneConfig } = require("./services/scene-config"); const advisor=getSceneConfig("sales-opportunity-advisor"); console.log(JSON.stringify({ sourceState:getSceneConfigSourceState(), advisorScene:advisor.scene, advisorEntryFile:advisor.skill.entryFile, advisorDictionary:advisor.references[0].path }, null, 2));'`
- 风险 / 备注：`services/scene-config.js` 现在默认从 `${CONFIG_CURRENT_BUNDLE}/scene-configs` 读取，并把 `project://` / `runtime://` 解析根同时切到 active bundle 的 `projectRoot` / `runtimeRoot`；当本地还没有 `current` bundle 时，会临时回退到仓库 `scene-configs`，避免开发环境在切换期间直接失效。为满足本任务验收，本轮通过 `scripts/verify_active_bundle_scene_config.js` 在默认 bundle 根目录下创建并激活了一个真实本地 release：`rel_20260416T062914556Z_local_all_all_9ba884ad8d28`，当前 `cfg_release_pointers(local/all/*)` 与 `.local/runtime-bundles/local/current` 均已指向该 release，`validateAgentRunRequest` 读取到的 scene config、skill entryFile、direct-model promptFile 也都来自 active bundle。残余风险是 `services/runtime-message.js` 里的 `SUPPORTED_SCENES` 仍在模块加载时缓存，如果未来 release 新增或删除 scene，长生命周期进程可能仍需重启后才能刷新 scene allowlist；但当前 4 个既有 scene 已可通过 active bundle 正常取配置，本任务也未让 runtime 直接读取 MySQL 草稿。
- 回退方式：回退 `services/scene-config.js` 中本轮改动，使其恢复为固定读取仓库 `scene-configs` 目录，删除 `scripts/verify_active_bundle_scene_config.js`，并将任务总表中的 `T4-01` 状态改回 `TODO`，清空本任务卡片记录；如需一并撤销本轮建立的本地 active bundle，可执行 `node -e 'require("./utils/load-env").loadProjectEnv(); const fs=require("fs/promises"); const path=require("path"); const { createConfigStore } = require("./services/config-store"); (async()=>{ const store=createConfigStore({driver:"mysql"}); await store.deleteReleasePointer("local","all","*"); await store.deleteRelease("rel_20260416T062914556Z_local_all_all_9ba884ad8d28"); await store.close(); await fs.rm(path.join(process.cwd(), ".local", "runtime-bundles", "local", "rel_20260416T062914556Z_local_all_all_9ba884ad8d28"), { recursive: true, force: true }); await fs.rm(path.join(process.cwd(), ".local", "runtime-bundles", "local", "current"), { recursive: true, force: true }); })().catch((error)=>{ console.error(error); process.exit(1); });'`。

### T4-02 改造平台资源读取入口

- 前置任务：T4-01
- 参考：主文档 `Phase 4 / T4-02`
- 开始时间：2026-04-16 15:38:38 +0800
- 完成时间：2026-04-16 15:42:55 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`platform/compiler/validate.js`；`platform/compiler/compile-workflow.js`
- 新增文件：`scripts/verify_active_bundle_platform_resources.js`
- 验证命令：`node --check platform/compiler/validate.js`；`node --check platform/compiler/compile-workflow.js`；`node --check scripts/verify_active_bundle_platform_resources.js`；`node scripts/verify_active_bundle_platform_resources.js`；`node -e 'require("./utils/load-env").loadProjectEnv(); const { getPlatformResourceSourceState, loadPlatformResources } = require("./platform/compiler/validate"); const resources = loadPlatformResources(); console.log(JSON.stringify({ sourceState: getPlatformResourceSourceState(), firstTemplate: resources.templates[0]?.filePath || null, firstSkill: resources.skills[0]?.filePath || null, firstTool: resources.tools[0]?.filePath || null, firstQuery: resources.queries[0]?.filePath || null }, null, 2));'`
- 风险 / 备注：`platform/compiler/validate.js` 现在默认把 `loadPlatformResources()` / `validatePlatformConfigs()` 的 baseDir 指向 `${CONFIG_CURRENT_BUNDLE}/platform`，当本地尚未建立 current bundle 时才回退到仓库 `platform/`；`platform/compiler/compile-workflow.js` 也已同步改成默认使用 active bundle 的 `platform/*` 与 `scene-configs/*`，因此不显式传 `baseDir` 的 validate / compile 路径都会跟随当前发布 bundle。验证脚本确认当前默认源为 `active-bundle`，实际读取到的 template / skill / tool / query 文件路径都位于 `.local/runtime-bundles/local/current/platform`，并且 `compileWorkflowGraphForScene({ scene: "sales-opportunity-advisor" })` 在不传 `baseDir` 时可正常编译出 `14` 个节点。为避免影响控制台草稿能力，本轮没有修改那些已显式传入草稿 `resources` 或仓库 `baseDir` 的控制面调用点；`services/generic-query-runner.js`、runtime 资产加载与 direct-model 资产解析仍留给后续 `T4-03 ~ T4-05` 继续切到 active bundle，本任务也未让 runtime 直接读取 MySQL 草稿。
- 回退方式：回退 `platform/compiler/validate.js` 与 `platform/compiler/compile-workflow.js` 中本轮改动，使 platform registry 与 compile workflow 默认恢复为读取仓库 `platform/` / `scene-configs/`，删除 `scripts/verify_active_bundle_platform_resources.js`，并将任务总表中的 `T4-02` 状态改回 `TODO`，清空本任务卡片记录；本轮验证复用了上一任务已建立的本地 active release，没有新增 release / pointer 变更，因此无需额外清理数据库或 bundle 目录。

### T4-03 改造 QueryProfile 运行时加载

- 前置任务：T4-02
- 参考：主文档 `Phase 4 / T4-03`
- 开始时间：2026-04-16 15:44:53 +0800
- 完成时间：2026-04-16 15:46:51 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`services/generic-query-runner.js`
- 新增文件：`scripts/verify_active_bundle_query_profile.js`
- 验证命令：`node --check services/generic-query-runner.js`；`node --check scripts/verify_active_bundle_query_profile.js`；`node scripts/verify_active_bundle_query_profile.js`
- 风险 / 备注：`services/generic-query-runner.js` 现已改为通过 `loadPlatformResources()` 的默认入口读取 QueryProfile，因此会跟随 `T4-02` 已建立的 active bundle 平台资源目录，在存在 `current` bundle 时优先读取 `.local/runtime-bundles/local/current/platform/tools/*.query.yaml`，仅在本地尚未建立 active bundle 时回退到仓库 `platform/`。验证脚本复用了现有本地 active release `rel_20260416T062914556Z_local_all_all_9ba884ad8d28`，确认 `query://sales-opportunity/by-opportunity-id@v1` 实际来自 active bundle 文件，且其中 `migrationSource.skillPath / helperScriptPath` 已是 bundle 渲染后的 `runtime://` / `project://` 形式；同时通过 fake DB 走通 `executeGenericQuery()` 执行链，成功生成 `SELECT TOP 1 * FROM [t_sales_opportunity] WHERE [opportunityId] = @p0` 并返回结果。本轮未修改真实 DB 执行逻辑，也未让 runtime 直接读取 MySQL 草稿；runtime 资产加载与 direct-model 资产解析仍留给 `T4-04 / T4-05` 继续切换。
- 回退方式：回退 `services/generic-query-runner.js` 中本轮改动，使 `loadQueryProfile()` 恢复为显式读取仓库 `platform/`，移除新增导出的 `loadQueryProfile`，删除 `scripts/verify_active_bundle_query_profile.js`，并将任务总表中的 `T4-03` 状态改回 `TODO`，清空本任务卡片记录；本轮验证复用了已有 active release，没有新增 release / pointer 变更，因此无需额外清理数据库或 bundle 目录。

### T4-04 改造 runtime 资产加载

- 前置任务：T4-03
- 参考：主文档 `Phase 4 / T4-04`
- 开始时间：2026-04-16 15:58:22 +0800
- 完成时间：2026-04-16 16:01:15 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`platform/nodes/load-assets.js`
- 新增文件：`scripts/verify_active_bundle_load_assets.js`
- 验证命令：`node --check platform/nodes/load-assets.js`；`node --check scripts/verify_active_bundle_load_assets.js`；`node scripts/verify_active_bundle_load_assets.js`
- 风险 / 备注：`platform/nodes/load-assets.js` 现在会对 `BusinessSkill.spec.assetRefs` 与 legacy fallback 中的 `source.path` 统一走 `resolvePathReference()`，并使用当前 `scene-config` 的 `projectRoot / runtimeRoot` 解析 `project://` 与 `runtime://`，因此在存在 active bundle 时会优先读取 `.local/runtime-bundles/local/current` 下的 prompt / schema / dictionary / rules 资产；当本地尚未建立 current bundle 时，则自动回退到仓库根目录解析。为避免 runtime 继续踩旧路径，本轮还复用了 `scene-config` 的 legacy path 拦截策略，若资产仍指向旧项目目录或共享 `旧共享运行时目录` 路径，会在 `load-assets` 节点直接报错而不是继续读取。验证脚本复用了现有 active release `rel_20260416T062914556Z_local_all_all_9ba884ad8d28`，实际编译并运行 `sales-opportunity-advisor` 的 `load_reference_bundle` 节点，确认四类资产都来自 current bundle，`reference_meta` / `outputs.load_assets.categories` 也已补充解析后的实际文件路径以及原始 `path_ref`。本轮没有让 runtime 直接读取 MySQL 草稿，direct-model 资产解析仍留给 `T4-05`。
- 回退方式：回退 `platform/nodes/load-assets.js` 中本轮改动，使其恢复为直接按 `source.path` 原样读取文件并移除新增的 `path_ref / path_source_type` 元数据，删除 `scripts/verify_active_bundle_load_assets.js`，并将任务总表中的 `T4-04` 状态改回 `TODO`，清空本任务卡片记录；本轮验证复用了已有 active release，没有新增 release / pointer 变更，因此无需额外清理数据库或 bundle 目录。

### T4-05 改造 direct-model 资产解析

- 前置任务：T4-04
- 参考：主文档 `Phase 4 / T4-05`
- 开始时间：2026-04-16 16:03:58 +0800
- 完成时间：2026-04-16 16:06:29 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`services/direct-model.js`
- 新增文件：`scripts/verify_active_bundle_direct_model.js`
- 验证命令：`node --check services/direct-model.js`；`node --check scripts/verify_active_bundle_direct_model.js`；`node scripts/verify_active_bundle_direct_model.js`
- 风险 / 备注：`services/direct-model.js` 现在会像 `scene-config` / `load-assets` 一样，使用当前 `scene-config` 的 `projectRoot / runtimeRoot` 解析 `project://` 与 `runtime://` 引用，因此 direct-model scene 在 active bundle 场景下，不论走 resolved absolute path 还是只保留 `*Ref` 的 ref-only 路径，都能稳定命中 `.local/runtime-bundles/local/current` 下的 prompt / schema / models / auth-profiles；legacy 旧路径拦截也同步改为基于当前 active bundle 的路径状态执行。验证脚本复用了现有 active release `rel_20260416T062914556Z_local_all_all_9ba884ad8d28`，确认 `payment-info-split` 的 prompt/schema/models 全部来自 current bundle，并在不出网的前提下用 stub fetch 跑通 `runDirectModelScene()`：request body 使用了 active bundle prompt 与 schema，credential source 来自 current bundle 的 `models.json`，最终返回结构化结果成功。由于本轮验证刻意 stub 了模型网关，所以没有实际调用外部 Moonshot 接口，但这也避免了把验收结果绑死在外部网络可用性上；本轮同样没有让 runtime 直接读取 MySQL 草稿。
- 回退方式：回退 `services/direct-model.js` 中本轮改动，使其恢复为直接用默认项目根解析 `project://` / `runtime://`，删除 `scripts/verify_active_bundle_direct_model.js`，并将任务总表中的 `T4-05` 状态改回 `TODO`，清空本任务卡片记录；本轮验证复用了已有 active release，没有新增 release / pointer 变更，因此无需额外清理数据库或 bundle 目录。

### T5-01 去除 ContextHelper 硬编码项目根路径

- 前置任务：T4-05
- 参考：主文档 `Phase 5 / T5-01`
- 开始时间：2026-04-16 16:08:38 +0800
- 完成时间：2026-04-16 16:13:32 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`ContextHelper/services/generated-query-file.js`
- 新增文件：`scripts/verify_active_bundle_context_helper_generated_query.js`
- 验证命令：`node --check ContextHelper/services/generated-query-file.js`；`node --check scripts/verify_active_bundle_context_helper_generated_query.js`；`node scripts/verify_active_bundle_context_helper_generated_query.js`
- 风险 / 备注：`ContextHelper/services/generated-query-file.js` 现已不再写死旧仓 `PROJECT_ROOT=/Users/gato-pm/Desktop/API` 与固定 `scene-configs/sales-opportunity-advisor.json` 文件路径，而是通过 `services/scene-config` 读取当前 active bundle 的 scene config / skill entry，并把 helper script / manifest 目录统一锚定到 `${CONFIG_CURRENT_BUNDLE}/ContextHelper/generated-queries`。同时，skill marker 与 manifest 中若仍残留仓库绝对路径或旧仓绝对路径，现在会自动按 active bundle 的 `projectRoot` / `runtimeRoot` 映射到 current bundle，因此读取 helper script 时不再落回仓库根目录；公开入口 `getOrCreateHelperQueryFile()` 也已支持按 scene 显式传参。验证脚本复用了现有 active release `rel_20260416T062914556Z_local_all_all_9ba884ad8d28`，确认 helper scene config、skill、helper script 与 manifest 全部来自 current bundle，返回的 SQL 仍是 `SELECT TOP 1 * FROM t_sales_opportunity WHERE opportunityId = @opportunityId`。当前剩余风险是：若 helper script cache miss 或业务定义变更，ContextHelper 仍会把新生成的脚本与 manifest 写回当前 active bundle 目录；这保证了 `T5-01` 的“生成 / 读取兼容 active bundle”，但 helper script 与 release version 的严格同版本发布 / 回滚切换仍留给 `T5-02` 继续收口。本轮没有让 runtime 直接读取 MySQL 草稿。
- 回退方式：回退 `ContextHelper/services/generated-query-file.js` 中本轮改动，使其恢复为固定读取仓库根目录与固定 scene config 路径，删除 `scripts/verify_active_bundle_context_helper_generated_query.js`，并将任务总表中的 `T5-01` 状态改回 `TODO`，清空本任务卡片记录；如需一并撤销本轮在 current bundle `ContextHelper/generated-queries/manifest.json` 上写入的路径收口结果，可将该 manifest 文件恢复为发布前版本或重新激活一次上一个 release 来重建 current bundle。

### T5-02 helper script 纳入 release bundle

- 前置任务：T5-01
- 参考：主文档 `Phase 5 / T5-02`
- 开始时间：2026-04-16 17:41:16 +0800
- 完成时间：2026-04-16 17:46:33 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`services/bundle-renderer.js`；`services/release-validator.js`；`ContextHelper/services/generated-query-file.js`；`scripts/verify_bundle_renderer.js`；`scripts/verify_release_validator.js`；`scripts/verify_active_bundle_context_helper_generated_query.js`
- 新增文件：`scripts/verify_helper_script_release_bundle_sync.js`
- 验证命令：`node --check services/bundle-renderer.js`；`node --check services/release-validator.js`；`node --check ContextHelper/services/generated-query-file.js`；`node --check scripts/verify_bundle_renderer.js`；`node --check scripts/verify_release_validator.js`；`node --check scripts/verify_active_bundle_context_helper_generated_query.js`；`node --check scripts/verify_helper_script_release_bundle_sync.js`；`node scripts/verify_bundle_renderer.js`；`node scripts/verify_release_validator.js`；`node scripts/verify_helper_script_release_bundle_sync.js`；`node scripts/verify_active_bundle_context_helper_generated_query.js`
- 风险 / 备注：`services/bundle-renderer.js` 现在会基于 release entries 与 scene skill 生成版本化的 `ContextHelper/generated-queries/manifest.json`，不再沿用仓库基线中的旧 manifest；`services/release-validator.js` 也新增了 helper manifest 校验，要求 `skillPath` / `declaredFilePath` / `filePath` 都是 bundle-safe 引用，且 `definitionHash` 与渲染出的 helper script 一致。`ContextHelper/services/generated-query-file.js` 在 `active-bundle` 模式下改为只读复用已发布 helper script：若 bundle 中 helper script 缺失或 definitionHash 不匹配，会直接报错要求重新发布，不再在运行时回写 current bundle，从而保证 helper script 与 QueryProfile 随 release/pointer 同步切换。本轮新增验证脚本使用独立环境 `verifyhelper` 完整验证了 publish -> republish -> rollback 三段切换，确认 helper script 与 helper manifest 的 `generatedAt` 都会一起回退；现网/本地已有的历史 bundle 若仍携带 T5-02 前的旧 manifest 结构，运行仍兼容，但要获得“只读 + 版本化 manifest”能力，需要重新发布一次新 release。本轮没有让 runtime 直接读取 MySQL 草稿。
- 回退方式：回退 `services/bundle-renderer.js`、`services/release-validator.js`、`ContextHelper/services/generated-query-file.js`、`scripts/verify_bundle_renderer.js`、`scripts/verify_release_validator.js`、`scripts/verify_active_bundle_context_helper_generated_query.js` 的本轮改动，删除 `scripts/verify_helper_script_release_bundle_sync.js`，并将任务总表中的 `T5-02` 状态改回 `TODO`，清空本任务卡片记录；如需恢复到“helper 可在 active bundle 运行时生成并回写”的旧行为，可一并重新发布一版回退后的 release bundle 覆盖 current 指针。

### T6-01 实现回滚接口

- 前置任务：T5-02
- 参考：主文档 `Phase 6 / T6-01`
- 开始时间：2026-04-16 17:54:16 +0800
- 完成时间：2026-04-16 17:57:24 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`server.js`
- 新增文件：`services/console-releases.js`；`routes/console-releases.js`；`scripts/rollback_release.js`；`scripts/verify_console_release_rollback_route.js`
- 验证命令：`node --check services/console-releases.js`；`node --check routes/console-releases.js`；`node --check scripts/rollback_release.js`；`node --check scripts/verify_console_release_rollback_route.js`；`node --check server.js`；`node scripts/verify_console_release_rollback_route.js`；`node -e 'require("./utils/load-env").loadProjectEnv(); const { createConfigStore } = require("./services/config-store"); (async()=>{ const store=createConfigStore({driver:"mysql"}); const pointer=await store.getReleasePointer("verifyrollbackapi","all","*"); const releases=(await store.listReleases({ environment:"verifyrollbackapi" })).map(item=>item.releaseId); console.log(JSON.stringify({ verifyrollbackapiPointer:pointer, verifyrollbackapiReleaseCount:releases.length }, null, 2)); await store.close(); })().catch((error)=>{console.error(error);process.exit(1);});'`；`node -e 'require("./utils/load-env").loadProjectEnv(); const { createConfigStore } = require("./services/config-store"); (async()=>{ const store=createConfigStore({driver:"mysql"}); const pointer=await store.getReleasePointer("local","all","*"); console.log(JSON.stringify({ localPointer:pointer }, null, 2)); await store.close(); })().catch((error)=>{console.error(error);process.exit(1);});'`
- 风险 / 备注：已新增 `POST /api/console/releases/:releaseId/rollback`，由 `services/console-releases.js` 包装现有 `release-manager.rollbackRelease()`，接口会先校验 `releaseId` 存在且必须是当前 active release，再按该 release 自身的 `environment/scope` 触发回滚，因此不会让调用方绕过 active pointer 直接指定任意旧 release；回滚成功后返回 `activeBeforeRollback`、`activeAfterRollback`、pointer 与 current bundle target，便于控制台确认运行时是否已切回旧 bundle。额外新增了 `scripts/rollback_release.js` 作为本地 CLI 入口，便于运维/验收直接按 releaseId 调用同一套回滚逻辑。验证脚本使用独立环境 `verifyrollbackapi` 发布两版 release，再经 route 执行回滚，确认 current symlink 与 active pointer 一起切回第一版，并且再次对非 active release 发起回滚会返回 `409`；验证结束后也已确认测试环境 pointer/release 记录全部清理完成，现有 `local/all/*` 指针未被改动。本轮没有让 runtime 直接读取 MySQL 草稿。
- 回退方式：删除 `services/console-releases.js`、`routes/console-releases.js`、`scripts/rollback_release.js`、`scripts/verify_console_release_rollback_route.js`，回退 `server.js` 中新增的 rollback 路由注册，并将任务总表中的 `T6-01` 状态改回 `TODO`，清空本任务卡片记录；如需同时撤销本轮 CLI/接口能力，请停止使用 `/api/console/releases/:releaseId/rollback` 与 `node scripts/rollback_release.js`，不需要改动任何已发布 release 或当前 active pointer。

### T6-02 实现审计日志与 revision 查询

- 前置任务：T6-01
- 参考：主文档 `Phase 6 / T6-02`
- 开始时间：2026-04-16 18:05:23 +0800
- 完成时间：2026-04-16 18:08:53 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`server.js`
- 新增文件：`services/console-audit.js`；`routes/console-audit.js`；`scripts/verify_console_audit_revisions.js`
- 验证命令：`node --check services/console-audit.js`；`node --check routes/console-audit.js`；`node --check scripts/verify_console_audit_revisions.js`；`node --check server.js`；`node scripts/verify_console_audit_revisions.js`
- 风险 / 备注：已新增 `GET /api/console/audit/revisions` 与 `GET /api/console/audit/revisions/:revisionId`，基于 MySQL `cfg_revisions` 提供 revision 列表与详情查询，并按 `scene-config` / `platform-resource` / `scene-asset` / `helper-script` 回填目标摘要、当前 revision 标记、operator、changeNote、checksum、createdAt 等审计信息；列表接口支持按 `targetType / targetId / scene / assetType / kind / name / version / ref / scriptType` 过滤，便于控制台追溯“谁在什么时候改了什么”。验证脚本使用现有 `sales-opportunity-advisor:prompt` revision 数据完成 route/service 双路径校验，没有新增 draft、release、pointer 或 runtime bundle 变更；runtime 仍然只读取 active bundle，没有直接读取 MySQL 草稿。当前发布状态与运行态聚合观测仍留待 `T6-03` 完成。
- 回退方式：删除 `services/console-audit.js`、`routes/console-audit.js`、`scripts/verify_console_audit_revisions.js`，回退 `server.js` 中新增的审计路由注册，并将任务总表中的 `T6-02` 状态改回 `TODO`，清空本任务卡片记录；本轮未新增 release / pointer / bundle 变更，因此不需要额外清理运行时目录或数据库指针。

### T6-03 实现发布状态与运行状态可观测

- 前置任务：T6-02
- 参考：主文档 `Phase 6 / T6-03`
- 开始时间：2026-04-16 18:15:21 +0800
- 完成时间：2026-04-16 18:22:13 +0800
- 改动文件：`MySQL配置中心化改造执行看板.md`；`services/console-releases.js`；`routes/console-releases.js`；`server.js`；`console/src/services/apiClient.js`；`console/src/pages/rollout/RolloutPage.jsx`
- 新增文件：`scripts/verify_console_release_status_route.js`
- 验证命令：`node --check services/console-releases.js`；`node --check routes/console-releases.js`；`node --check scripts/verify_console_release_status_route.js`；`node --check server.js`；`node scripts/verify_console_release_status_route.js`；`npm --prefix console run build`
- 风险 / 备注：已新增 `GET /api/console/releases/status`，聚合返回当前 `active release`、上一版本、最近失败发布、`current` symlink 与 pointer 对齐状态、最近 release 历史，以及 active/previous/failed 三类 release 的 bundle 校验摘要；控制台 `灰度概览` 页面已接入该接口，能直接展示发布状态与运行态观测。最近失败发布目前按“同 scope 下最新一个 bundle 校验失败且仍停留在非 published 状态的 release”推断，因为当前库表还没有单独持久化 `failed` 发布状态；这能覆盖发布校验/激活失败场景，但不等同于完整发布流水日志。验证脚本使用独立环境 `verifyreleasestatus` 发布两版成功 release，再构造一版 helper script 缺失的坏 bundle，确认 active/previous/failed/current 四块信息都能被接口和 route 正确观测；验证结束后已清理临时 release、pointer 与 bundle 目录。runtime 仍然只读取 active bundle，没有直接读取 MySQL 草稿。
- 回退方式：回退 `services/console-releases.js`、`routes/console-releases.js`、`server.js`、`console/src/services/apiClient.js`、`console/src/pages/rollout/RolloutPage.jsx` 中本轮改动，删除 `scripts/verify_console_release_status_route.js`，并将任务总表中的 `T6-03` 状态改回 `TODO`，清空本任务卡片记录；本轮验证使用的 `verifyreleasestatus` 环境数据已在脚本内清理完成，不需要额外手工回滚数据库 pointer 或运行时 bundle。
