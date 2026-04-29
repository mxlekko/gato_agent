# API_副本 自闭环运行说明

本仓库是 `/Users/gato-pm/Desktop/API_副本` 的独立运行副本，目标是让 API、Console、ContextHelper、DirectDbRunner、ModelTool 都以 `_副本` 自己的配置、资产和端口运行，不再隐式依赖旧仓 `/Users/gato-pm/Desktop/API` 或共享 `.openclaw` 目录。

统一业务入口是 [server.js](/Users/gato-pm/Desktop/API_副本/server.js) 提供的 `POST /api/agent/run`。

当前对外支持三个 scene：

- `payment-info-split`
- `sales-opportunity-advisor`
- `sales-opportunity-advisor-directdb`

## 当前端口

当前 `_副本` 默认端口组由 [`.env`](/Users/gato-pm/Desktop/API_副本/.env) 控制：

- API: `3100`
- ContextHelper: `19101`
- DirectDbRunner: `19102`
- ModelTool: `19103`
- Console dev: `3200`
- OpenClaw Gateway: 默认外部依赖 `127.0.0.1:18789`

说明：

- `3100/19101/19102/19103` 属于 `_副本` 自己的服务端口
- `3100` 作为统一业务入口，默认可通过 `API_HOST=0.0.0.0` 提供给同一内网的其他机器访问
- `19101/19102/19103` 仍然只绑定 `127.0.0.1`，只允许本机 API 进程调用，不作为内网直连入口
- `3200` 只是前端 dev server 端口，`/api/*` 默认代理到 `_副本` API `http://127.0.0.1:3100`
- `3001` 可以继续作为旧 API 的并行验证端口，但不属于 `_副本` 默认运行链路

## 当前链路

`payment-info-split`:

`调用方 -> API(3100) -> 直接调用模型 -> 本地 schema 校验 -> 返回结果`

`sales-opportunity-advisor`:

`调用方 -> API(3100) -> OpenClaw Gateway -> sales-agent -> advisor skill -> ContextHelper(19101) -> SQL Server -> skill 读取本地字典与规则 -> ModelTool(19103) -> 返回结果`

`sales-opportunity-advisor-directdb`:

`调用方 -> API(3100) -> OpenClaw Gateway -> sales-agent -> advisor-directdb skill -> DirectDbRunner(19102) -> SQL Server -> skill 读取本地字典与规则 -> ModelTool(19103) -> 返回结果`

## 路径规则

运行时配置只允许使用下面两种受控路径引用：

- `project://...`
  - 解析到 `_副本` 仓库根目录下的本地文件
  - 例如 `project://references/payment-info-split/prompt.md`
- `runtime://openclaw/...`
  - 解析到 `_副本/runtime-assets/openclaw/...`
  - 例如 `runtime://openclaw/workspace/skills/sales-opportunity-advisor/SKILL.md`

不再允许：

- `/Users/gato-pm/Desktop/API/...`
- `/Users/gato-pm/.openclaw/...`

命中这些旧路径时，运行时会直接报错，不会再自动 remap 或偷偷读取。

## 允许保留的外部依赖

`_副本` 允许继续依赖以下外部系统，但必须显式来自 [`.env`](/Users/gato-pm/Desktop/API_副本/.env) 或受控 runtime 配置：

- SQL Server
- LLM Provider 凭证
- OpenClaw Gateway

不允许继续共享的内容：

- 旧仓本地 prompt / schema / metadata / query cache
- 共享 `.openclaw` 下的 skill、models、auth-profiles

## 目录入口

- [server.js](/Users/gato-pm/Desktop/API_副本/server.js): API 服务入口
- [routes/agent.js](/Users/gato-pm/Desktop/API_副本/routes/agent.js): 统一业务入口
- [services](/Users/gato-pm/Desktop/API_副本/services): scene 配置加载、runtime 调用、Gateway 调用、响应解析
- [scene-configs](/Users/gato-pm/Desktop/API_副本/scene-configs): scene 配置
- [references](/Users/gato-pm/Desktop/API_副本/references): direct-model scene prompt / schema
- [runtime-assets/openclaw](/Users/gato-pm/Desktop/API_副本/runtime-assets/openclaw): `_副本` 持有的 OpenClaw skill / models / auth-profiles
- [ContextHelper](/Users/gato-pm/Desktop/API_副本/ContextHelper): helper 型 data tool
- [DirectDbRunner](/Users/gato-pm/Desktop/API_副本/DirectDbRunner): directdb 型 data tool
- [ModelTool](/Users/gato-pm/Desktop/API_副本/ModelTool): 结构化输出校验 tool
- [metadata](/Users/gato-pm/Desktop/API_副本/metadata): 本地字段字典
- [console](/Users/gato-pm/Desktop/API_副本/console): 3200 调试控制台
- [deploy/launchd](/Users/gato-pm/Desktop/API_副本/deploy/launchd): macOS 常驻启动模板

## 环境变量

项目启动时自动读取根目录 [`.env`](/Users/gato-pm/Desktop/API_副本/.env)。

常用变量：

- `API_HOST`
- `API_PORT`
- `CONTEXT_HELPER_PORT`
- `DIRECTDB_RUNNER_PORT`
- `MODEL_TOOL_PORT`
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `GATEWAY_TIMEOUT_MS`
- `MOONSHOT_API_KEY`
- `SQLSERVER_HOST`
- `SQLSERVER_PORT`
- `SQLSERVER_DATABASE`
- `SQLSERVER_USER`
- `SQLSERVER_PASSWORD`

当前默认建议：

- `API_HOST=0.0.0.0`，用于让统一入口 `3100` 可被内网其他机器访问
- `ContextHelper / DirectDbRunner / ModelTool / OpenClaw Gateway` 继续保持本机回环访问，不对内网单独开放

## 启动后端

手工启动：

```bash
cd /Users/gato-pm/Desktop/API_副本
npm run start:helper
npm run start:directdb-runner
npm run start:model-tool
npm run start:api
```

推荐使用常驻启动：

```bash
cd /Users/gato-pm/Desktop/API_副本
npm run service:install
npm run service:restart
npm run service:status
```

更详细的常驻方式见 [常驻启动说明.md](/Users/gato-pm/Desktop/API_副本/常驻启动说明.md)。

## 启动控制台

```bash
cd /Users/gato-pm/Desktop/API_副本
npm run console:dev
```

默认行为：

- `http://127.0.0.1:3200` 提供控制台页面
- `/api/*` 默认代理到 `http://127.0.0.1:3100`
- 如需切到其他实验 API，在 [console/.env.local.example](/Users/gato-pm/Desktop/API_副本/console/.env.local.example) 的格式基础上创建 `console/.env.local`

## 工程化检查

项目结构边界说明见 [docs/engineering/project-structure.md](/Users/gato-pm/Desktop/API_副本/docs/engineering/project-structure.md)。

提交前建议执行：

```bash
cd /Users/gato-pm/Desktop/API_副本
npm run check
```

当前检查包含：

- 项目关键目录和入口是否存在
- `.env`、`node_modules`、日志、缓存、构建产物是否被误加入 Git
- `platform` 配置是否合法

## 基础检查

API：

```bash
curl -sS http://127.0.0.1:3100/health
```

配置目录：

```bash
curl -sS http://127.0.0.1:3100/api/console/configs/catalog
```

payment-info-split：

```bash
curl -sS -X POST http://127.0.0.1:3100/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"scene":"payment-info-split","bizParams":{"rawText":"收款方：上海某某科技有限公司；开户行：中国银行上海浦东分行；账号：1234567890123456789"},"runtimeContext":{"userId":"user-a"}}'
```

## 自闭环回归

```bash
cd /Users/gato-pm/Desktop/API_副本
npm run regression:self-contained
```

当前回归会做两件事：

1. 扫描 `scene-configs / platform / services / deploy / runtime-assets/openclaw/workspace/skills` 是否还残留旧仓或共享 `.openclaw` 路径
2. 回放三个核心 scene

当前预期结果：

- `payment-info-split`: pass
- `sales-opportunity-advisor`: pass
- `sales-opportunity-advisor-directdb`: warning

最后这条 warning 允许来自外部 OpenClaw Gateway 边界的波动，不视为 `_副本` 本地串旧路径失败。

## 文档索引

- [常驻启动说明.md](/Users/gato-pm/Desktop/API_副本/常驻启动说明.md)
- [API_副本自闭环逐文件修改蓝图任务清单.md](/Users/gato-pm/Desktop/API_副本/API_副本自闭环逐文件修改蓝图任务清单.md)
- [前端页面与后端接口映射表.md](/Users/gato-pm/Desktop/API_副本/前端页面与后端接口映射表.md)
