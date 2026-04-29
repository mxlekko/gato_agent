# Agent 业务平台控制台

当前目录对应 `FE1-T1` 的最小前端工程。

## 本地启动

默认开发端口固定为 `3200`：

```bash
cd console
npm install
npm run dev
```

默认会将 `/api` 代理到 `http://127.0.0.1:3100`。
这里的 `3100` 默认应对应当前 `_副本` API，而不是旧仓或其他实验端口。

如果需要切到实验 API：

```bash
cd console
cp .env.local.example .env.local
```

然后把 `.env.local` 里的 `VITE_API_PROXY_TARGET` 改成目标端口，例如：

```bash
VITE_API_PROXY_TARGET=http://127.0.0.1:3001
```

修改后重启 `npm run dev` 即可。未设置 `.env.local` 时，3200 控制台默认始终代理到 `http://127.0.0.1:3100`。

## 环境变量

- `VITE_API_BASE_URL`
  - 可选。为空时使用 Vite dev proxy。
- `VITE_API_PROXY_TARGET`
  - 可选。默认 `http://127.0.0.1:3100`，用于控制 `/api` 的 dev proxy 目标。
  - 在当前仓中，`3100` 应指向 `_副本` API。
  - 若要切换到实验端口，优先在 `.env.local` 中覆盖，不直接改 `.env.example`。
- `VITE_CONSOLE_DATA_MODE`
  - `mock` 或 `api`
  - 当前默认 `mock`

## 当前包含

- React + Vite 独立工程
- 路由骨架
- 基础布局
- API client
- mock client

后续页面按任务清单继续补齐，不在本次子任务内扩展。
