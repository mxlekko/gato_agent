# MySQL 配置中心化改造连接参数与连通性说明

本文档记录 `T0-05 配置连接参数并验证连通性` 的落地结果，覆盖当前仓库启用的 `MYSQL_*` 连接参数、不同环境的配置约定，以及连通性验证方式。

## 1. 当前仓库启用的连接参数

当前仓库 `.env` 已补齐以下连接参数：

- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`

本地开发默认值对应 `T0-04` 已创建的独立配置中心账号：

- `MYSQL_HOST=127.0.0.1`
- `MYSQL_PORT=3306`
- `MYSQL_USER=cfg_app_dev`
- `MYSQL_DATABASE=config_center_dev`

密码由本地开发密钥文件生成并同步到 `.env`，供当前仓库内脚本和后续 MySQL 底座任务读取；示例值不写入文档，模板值保存在 `.env.example`。

## 2. 不同环境的参数约定

### 本地开发

- 连接目标：本机 `127.0.0.1:3306`
- 数据库：`config_center_dev`
- 账号：`cfg_app_dev`
- 凭据来源：`.env` 与 `~/.codex-mysql/config-center-dev.env`

### 测试环境

- 连接目标：测试环境独立托管 MySQL / RDS
- 数据库建议命名：`config_center_test`
- 账号建议命名：`cfg_app_test`
- 连接参数写入测试环境专用 `.env` 或密钥管理系统，不复用开发凭据

### 生产环境

- 连接目标：生产环境独立托管 MySQL / RDS
- 数据库建议命名：`config_center_prod`
- 账号建议命名：`cfg_app_prod`
- 连接参数通过生产环境密钥管理系统下发，不落本地开发文件

## 3. 连通性验证脚本

仓库新增连接探针脚本：

- `scripts/verify_mysql_connection.js`
- `npm run mysql:ping`

脚本行为：

1. 使用当前仓库 `utils/load-env.js` 读取 `.env`
2. 校验 `MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE`
3. 自动定位 `mysql` 客户端：
   - 优先使用 `MYSQL_CLIENT_BIN`
   - 其次查找当前 `PATH`
   - 再回退到 `scripts/manage_local_mysql.sh env` 暴露的本地安装路径
4. 使用 `MYSQL_*` 参数执行真实 SQL 查询，返回当前登录账号、当前数据库、MySQL 版本和端口

## 4. 当前边界

本任务只完成连接参数准备和连通性校验，不做以下事情：

- 不引入 MySQL 仓储层
- 不让 runtime 请求路径直接读取 MySQL 草稿
- 不把控制面读写链路切换到 MySQL

这些动作分别留给 `T1-02`、`T2-01`、`T2-02` 之后的任务。
