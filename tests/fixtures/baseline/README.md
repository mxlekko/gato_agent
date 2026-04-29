# Baseline Fixtures

本目录用于固化 `sales-opportunity-advisor` 当前已跑通链路的基线请求与黄金输出，供后续回放、影子对比和回归使用。

## 1. 基线范围

当前已固化的样例包括：

1. API 正常请求成功样例
2. API 参数错误样例
3. API 查无数据样例
4. ModelTool 结构校验失败样例

说明：

- 前 3 个样例是 `POST /api/agent/run` 的真实回放结果。
- 第 4 个样例是 `POST /internal/model/validate-structured-output` 的 tool-level 基线。
- 当前主 API 链路没有稳定、无侵入的方式强制产出一次“schema 校验失败”结果，因此这类失败先在 ModelTool 层固化。

## 2. requestId 规则

当前 API 中 `requestId` 的生成规则来自 [utils/request-id.js](/Users/gato-pm/Desktop/API_副本/utils/request-id.js)：

```text
req_<YYYYMMDD>_<HHmmssSSS>_<uuidPrefix8>
```

例如：

```text
req_20260412_134149043_3304d97e
```

因此以下字段在后续回放对比中应视为动态字段：

- API / ModelTool 响应中的 `requestId`

## 3. 样例说明

详细样例索引见：

- [manifest.json](/Users/gato-pm/Desktop/API_副本/tests/fixtures/baseline/manifest.json)

每个 case 都记录了：

- `route`
- `scene`
- `observedAt`
- `requestFile`
- `responseFile`
- `dynamicFields`
- `notes`

