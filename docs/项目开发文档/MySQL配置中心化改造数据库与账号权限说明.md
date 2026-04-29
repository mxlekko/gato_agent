# MySQL 配置中心化改造数据库与账号权限说明

本文档记录 `T0-04 初始化数据库与账号权限` 的落地约定，覆盖独立数据库命名、开发环境实际账号、权限边界，以及测试 / 生产环境的推荐拆分方式。

## 1. 开发环境实际落地

本地开发环境基于 `T0-03` 已准备好的 MySQL 实例，实际初始化以下对象：

- 数据库：`config_center_dev`
- 应用账号：`cfg_app_dev@127.0.0.1`
- 兼容本地 socket / localhost 登录：`cfg_app_dev@localhost`
- 本地密钥文件：`~/.codex-mysql/config-center-dev.env`
- 初始化脚本：`scripts/init_config_center_mysql_access.sh`

说明：

- 密钥文件不进入仓库，只保存本地开发凭证。
- 当前任务只完成数据库和账号准备，不修改应用 `.env`，也不让运行时直接读取 MySQL 草稿。
- 后续 `T0-05` 再把连接参数映射到应用侧 `MYSQL_*` 配置。

## 2. 开发环境权限范围

本地开发账号 `cfg_app_dev` 仅对 `config_center_dev` 单库授权，不持有全局管理权限。

当前授予的权限集合：

- `SELECT`
- `INSERT`
- `UPDATE`
- `DELETE`
- `CREATE`
- `DROP`
- `ALTER`
- `INDEX`

这样做的目的：

- 满足 `T1-01` 建表、改索引、重复初始化等开发动作
- 满足后续控制面写草稿、生成 revision、写 release 记录等单库读写动作
- 避免继续使用 `root` 作为后续开发任务连接账号

## 3. 测试与生产环境权限边界

测试和生产环境不应照搬开发环境的单账号做法，推荐拆分为以下职责：

- 平台 DBA / RDS 管理员：
  - 只负责一次性建库、建账号、授权，不作为应用运行账号
- `cfg_migrator_<env>`：
  - 仅在受控变更窗口执行建表、加索引、结构升级
  - 需要 `CREATE`、`ALTER`、`INDEX` 等 DDL 能力
- `cfg_app_<env>`：
  - 仅用于控制面草稿读写、revision / release 元数据写入
  - 默认只授予目标库范围内的 `SELECT`、`INSERT`、`UPDATE`、`DELETE`
- runtime / data plane：
  - 不授予配置库访问权限
  - 运行时只读已发布 release bundle

## 4. 当前任务验收口径

`T0-04` 完成后，应满足：

- 独立数据库已经创建完成
- 独立应用账号已经创建完成
- 账号权限已限定在配置中心目标库范围内
- 后续任务不再需要用 `root` 作为常规连接账号

## 5. 常用命令

```bash
scripts/init_config_center_mysql_access.sh env
scripts/init_config_center_mysql_access.sh init
scripts/init_config_center_mysql_access.sh verify
scripts/init_config_center_mysql_access.sh summary
```
