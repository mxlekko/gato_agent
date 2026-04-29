# MySQL 配置中心化改造仓储层说明

本文档记录 `T1-02 实现 MySQL 仓储层` 的落地结果，覆盖 `config-store` 接口、MySQL 实现、file-store 兼容实现，以及验证方式。

## 1. 新增入口

当前仓库已新增以下入口：

- [services/config-store/index.js](/Users/gato-pm/Desktop/API_副本/services/config-store/index.js)
- [services/config-store/mysql-store.js](/Users/gato-pm/Desktop/API_副本/services/config-store/mysql-store.js)
- [services/config-store/file-store.js](/Users/gato-pm/Desktop/API_副本/services/config-store/file-store.js)

默认驱动：

- `CONFIG_STORE_DRIVER` 未设置时默认使用 `file`
- 显式指定 `mysql` 时使用 MySQL 仓储层

## 2. mysql-store 能力

`mysql-store` 当前提供以下能力：

- scene config 草稿读写删 + revision 生成
- platform resource 草稿读写删 + revision 生成
- scene asset 草稿读写删 + revision 生成
- helper script 草稿读写删 + revision 生成
- revision 查询
- release 读写删
- release entries 批量替换与查询
- release pointer 读写删

设计要点：

- 所有草稿写入都在事务内完成
- 当前草稿表更新和 `cfg_revisions` 写入同事务提交
- `current_revision_id` 在 revision 插入后回填
- 所有 JSON 字段统一通过仓储层做序列化 / 反序列化

## 3. file-store 当前边界

`file-store` 当前保留为兼容实现，重点是给后续渐进迁移提供统一入口。

已经支持：

- scene config 文件读取 / 写入 / 删除
- platform resource 文件读取 / 写入 / 删除

暂不支持：

- scene asset
- helper script
- revision
- release

这些方法会明确抛出 `file-store` 不支持的错误，避免静默降级。

## 4. 验证脚本

新增验证脚本：

- [scripts/verify_config_store.js](/Users/gato-pm/Desktop/API_副本/scripts/verify_config_store.js)

推荐命令：

```bash
node scripts/verify_config_store.js
npm run mysql:store:verify
```

验证内容：

1. `file-store` 能读取现有 scene config 和 platform resources
2. `mysql-store` 能完成 probe 数据的写入、revision 生成、release / pointer 写入、读回和清理

## 5. 当前边界

本任务只实现仓储层，不做以下事情：

- 不导入现有文件配置到 MySQL
- 不修改控制台现有文件读写链路
- 不让 runtime 请求路径直接读取 MySQL 草稿

这些动作分别留给 `T1-03`、`T2-01` 之后的任务。
