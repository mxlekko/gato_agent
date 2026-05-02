# 冗余文件清单

生成日期：2026-04-30

本清单基于当前项目结构、`.gitignore`、Git 跟踪状态、入口引用关系和 `npm run check:structure` 的结果整理。清单只用于盘点，不表示已经删除任何文件。

清理原则：优先保证当前项目可以直接启动和验证。环境依赖、虚拟环境、本地 `.env`、当前 active bundle、当前运行需要的数据目录，不纳入“直接清理”范围。

## 结论摘要

- 项目结构检查通过，源码目录整体完整。
- 大部分冗余内容是缓存、日志、历史测试输出和构建产物。
- 为保证项目能跑，`node_modules/`、`console/node_modules/`、`rag-service/.venv/`、`.env`、当前 active bundle 不建议清理。
- 有 3 个 RAG SQLite 文件目前被 Git 跟踪，但当前默认 RAG 运行路径不再指向它们，建议重点确认。
- 少量源码文件当前静态入口不可达，需结合后续计划确认是否保留。

## 可直接清理

这些内容通常不需要提交到 Git，也不是源码基线的一部分。这里的“可清理”不是指每次启动项目都要删除或重建，而是指：如果需要释放空间、清理历史输出，删除后可以由工具在后续运行中自动生成，或通过对应命令重新生成。为了保证项目随时能跑，依赖目录和虚拟环境已单独列入“不建议清理”。

| 路径 | 类型 | 说明 |
| --- | --- | --- |
| `.DS_Store` | macOS 元数据 | 可删除。 |
| `console/.DS_Store` | macOS 元数据 | 可删除。 |
| `docs/.DS_Store` | macOS 元数据 | 可删除。 |
| `docs/场景外部对接文档/.DS_Store` | macOS 元数据 | 可删除。 |
| `runtime-assets/.DS_Store` | macOS 元数据 | 可删除。 |
| `runtime-assets/openclaw/.DS_Store` | macOS 元数据 | 可删除。 |
| `runtime-assets/openclaw/agents/.DS_Store` | macOS 元数据 | 可删除。 |
| `.npm-cache/` | npm 缓存 | 不影响已安装依赖；删除后下次安装依赖时 npm 会重新缓存。 |
| `console/.npm-cache/` | npm 缓存 | 不影响已安装依赖；删除后下次安装依赖时 npm 会重新缓存。 |
| `.npm-cache-playwright/` | Playwright/npm 缓存 | 不影响项目源码；删除后下次使用相关工具时会重新缓存。 |
| `.playwright-cli/` | Playwright 运行缓存与日志 | 主要是历史运行缓存与日志；删除后下次使用相关工具时会重新生成。 |
| `console/dist/` | 前端构建产物 | 开发模式不依赖它；如果要用 preview 或静态部署，需要先执行 `npm run console:build`。 |
| `logs/` | 服务日志 | 可清理历史日志。 |
| `rag-service/logs/` | RAG 服务日志 | 可清理历史日志。 |
| `tmp/` | 临时文件 | 可清理。 |
| `.tmp/` | 临时文件 | 可清理。 |
| `tests/regression/output/` | 回归测试输出 | 可清理历史输出。 |
| `platform/tests/output/` | 平台测试输出 | 可清理历史输出。 |

## 不建议清理的环境依赖

这些内容虽然通常可以重建，但删除后会影响当前项目立即运行，不应作为本轮冗余清理对象。

| 路径 | 类型 | 保留原因 |
| --- | --- | --- |
| `node_modules/` | Node 依赖 | 后端服务、校验脚本和运行命令依赖。删除后需重新安装。 |
| `console/node_modules/` | 前端依赖 | 控制台 dev/build 依赖。删除后需重新安装。 |
| `rag-service/.venv/` | Python 虚拟环境 | RAG 服务依赖。删除后需重新执行 `npm run rag:install`。 |
| `.env` | 本地运行配置 | 包含端口、数据库、模型服务等本地运行参数和密钥引用，不能删除。 |
| `.env.example` | 配置模板 | 项目基线文件，不能删除。 |
| `package-lock.json` | Node 锁文件 | 保障依赖版本可复现，不能删除。 |
| `console/package-lock.json` | 前端锁文件 | 保障前端依赖版本可复现，不能删除。 |
| `rag-service/requirements.txt` | Python 依赖清单 | RAG 环境重建依据，不能删除。 |

## 运行数据：谨慎清理

这些是本地运行数据，不一定是源码必需项；但如果当前环境要保持可用、保留索引或任务历史，就不要清理。

| 路径 | 类型 | 建议 |
| --- | --- | --- |
| `rag-service/data/chroma/` | RAG 本地向量库 | 只有确认可重新索引、且不需要当前本地知识库时才清理。 |
| `rag-service/data/db_sync/` | RAG 数据库同步状态 | 只有确认不需要当前同步水位和状态时才清理。 |
| `rag-service/data/jobs.sqlite3` | RAG 任务队列状态 | 只有确认不需要当前任务历史时才清理。 |
| `.local/runtime-bundles/local/rel_*/` | 历史 release bundle | 至少保留当前 active release 和一个可回滚版本；不要整目录删除。 |

## 需确认后清理

这些文件看起来不属于当前主运行路径，但存在历史兼容、手工工具或误提交的可能，建议确认后再删。

| 路径 | 类型 | 判断依据 | 建议 |
| --- | --- | --- | --- |
| `rag-service/rag-service/data/local-runtime/chroma/chroma.sqlite3` | 已跟踪 SQLite 运行数据 | 当前 RAG 默认写入 `rag-service/data/`，项目内未搜到 `rag-service/rag-service` 或 `local-runtime` 的运行引用。 | 若确认不是验收样本或保留数据，应从 Git 移除并删除。 |
| `rag-service/rag-service/data/local-runtime/db_sync/sync_state.sqlite3` | 已跟踪 SQLite 运行数据 | 同上。 | 若确认无用，应从 Git 移除并删除。 |
| `rag-service/rag-service/data/local-runtime/jobs.sqlite3` | 已跟踪 SQLite 运行数据 | 同上。 | 若确认无用，应从 Git 移除并删除。 |
| `console/src/components/PlaceholderPanel.jsx` | 前端组件 | 当前没有被 `console/src` 引用。 | 若后续页面不再需要占位组件，可删除。 |
| `platform/nodes/legacy-scene-runner.js` | 平台兼容节点 | 文件导出节点，但当前 `platform/runtime/graphs/index.js` 未注册或调用。 | 若旧兼容节点不会再接回运行图，可删除；否则保留。 |
| `rag-service/rag_mvp/chunking.py` | Python 兼容包装模块 | 当前 RAG server 和 `rag_mvp/store.py` 都直接引用 `rag_mvp.semantic_chunker`，项目内未发现 `rag_mvp.chunking` import。 | 若确认没有外部脚本依赖该旧 import 路径，可删除。 |
| `drivers/mssql-jdbc-13.4.0.jre11.jar` | JDBC 驱动包 | 当前项目未搜到引用；Node 链路使用 npm 包 `mssql`。 | 若没有外部手工工具依赖，可删除。 |

## 暂不建议删除

| 路径 | 原因 |
| --- | --- |
| `.local/runtime-bundles/local/current` | 当前 active bundle 指针。运行时存在 active bundle 时会优先读取这里。 |
| `.local/runtime-bundles/local/rel_20260428T113553803Z_local_all_all_ce86c824f124/` | 当前 `current` 指向的 active release。 |
| `ContextHelper/generated-queries/*.generated.js` | 虽然静态 import 图看不到，但它们通过 manifest、skill 和 query profile 动态读取，是运行资产。 |
| `ContextHelper/generated-queries/manifest.json` | helper 查询脚本清单，运行和 release bundle 会引用。 |
| `.env` | 本地运行配置和密钥文件，未提交 Git，但不是冗余文件。 |
| `scene-configs/` | 当前 scene 配置基线，active bundle 不存在时会回退读取。 |
| `runtime-assets/` | OpenClaw runtime 资产，属于项目结构要求的运行资产。 |
| `metadata/` | 本地业务字典，多个 scene 和配置导入流程依赖。 |
| `references/` | direct-model prompt/schema 等资产。 |

## 建议清理顺序

1. 先清理不影响启动的内容：`.DS_Store`、缓存、历史日志、历史测试输出、`console/dist/`。
2. 不清理 `node_modules/`、`console/node_modules/`、`rag-service/.venv/`、`.env`、当前 active bundle。
3. 再确认 3 个 `rag-service/rag-service/data/local-runtime/*.sqlite3` 是否误提交。
4. 最后评估源码候选：`PlaceholderPanel.jsx`、`legacy-scene-runner.js`、`rag_mvp/chunking.py`、JDBC 驱动包。
5. 每轮清理后运行：

```bash
npm run check:structure
npm run lint:platform-configs
```
