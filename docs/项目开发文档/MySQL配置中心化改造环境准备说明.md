# MySQL 配置中心化改造环境准备说明

本文档记录 `T0-03 准备 MySQL 环境` 的落地结果，仅覆盖 MySQL 实例准备与环境承载方式约定，不包含建库、建表、业务账号授权与应用连接参数落盘。

## 1. 本地开发环境

本地开发采用官方 MySQL Community Server 8.4 LTS 二进制包，安装在用户目录，不进入仓库：

- 安装目录：`~/.codex-mysql/install/mysql-8.4.8-macos15-arm64`
- 数据目录：`~/.codex-mysql/data/mysql-8.4.8-dev`
- 运行目录：`~/.codex-mysql/run`
- 日志文件：`~/.codex-mysql/log/mysql-8.4.8-dev.err`
- 监听地址：`127.0.0.1:3306`
- 管理脚本：`scripts/manage_local_mysql.sh`

本地环境约束：

- 版本：MySQL `8.4.8 LTS`
- 字符集：`utf8mb4`
- 排序规则：`utf8mb4_0900_ai_ci`
- 时区：`UTC`（`+00:00`）
- 网络访问方式：仅监听回环地址 `127.0.0.1`，不暴露公网

常用命令：

```bash
scripts/manage_local_mysql.sh env
scripts/manage_local_mysql.sh install
scripts/manage_local_mysql.sh start
scripts/manage_local_mysql.sh ping
scripts/manage_local_mysql.sh client
scripts/manage_local_mysql.sh stop
```

说明：

- 本地初始化阶段使用 `root@localhost` 空密码，仅用于环境引导。
- `T0-04` 必须补齐配置中心独立数据库、应用账号与最小权限边界。
- `T0-05` 再落应用侧连接参数，不在本任务提前写入 `.env`。

## 2. 测试环境

测试环境采用独立托管 MySQL / RDS 实例，不与业务主库复用，不在业务应用机手工安装数据库。

建议约束：

- 版本：MySQL `8.4 LTS`
- 字符集：`utf8mb4`
- 时区：`UTC`
- 网络访问方式：仅开放测试 VPC / 堡垒机 / CI Runner 白名单访问
- 备份：开启自动备份和 binlog
- 权限：测试环境账号与生产环境账号分离

## 3. 生产环境

生产环境优先采用托管 MySQL / RDS，多可用区或等价高可用方案，不在业务机器上手工安装 MySQL。

建议约束：

- 版本：MySQL `8.4 LTS`
- 字符集：`utf8mb4`
- 时区：`UTC`
- 网络访问方式：仅内网访问，禁止公网直连
- 高可用：主备切换、自动备份、监控告警、慢查询审计
- 权限：配置中心独立数据库、独立应用账号、最小权限授权

## 4. 当前任务产出

当前仓库已经具备以下前置条件：

- 本机已有一个可访问的 MySQL 实例可供后续 `T0-04`、`T0-05` 使用
- 开发 / 测试 / 生产三套承载方式已明确
- 版本、字符集、时区、网络访问方式已明确

后续顺序要求：

1. `T0-04` 初始化配置中心数据库与账号权限
2. `T0-05` 配置连接参数并完成应用连通性验证
