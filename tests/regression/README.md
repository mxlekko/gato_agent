# Regression Reports

本目录用于承载 baseline 回放和后续 shadow 对比的输出报告。

## 1. 当前脚本

当前已提供两支最小脚本：

1. [scripts/run_baseline_regression.js](/Users/gato-pm/Desktop/API_副本/scripts/run_baseline_regression.js)
   - 按 [tests/fixtures/baseline/manifest.json](/Users/gato-pm/Desktop/API_副本/tests/fixtures/baseline/manifest.json) 回放基线请求
   - 写出 actual response 和 per-case report
   - 汇总成 `summary.json`
2. [scripts/compare_results.js](/Users/gato-pm/Desktop/API_副本/scripts/compare_results.js)
   - 对 expected / actual JSON 做归一化比较
   - 支持忽略动态字段，例如 `requestId`
   - 输出 JSON 差异报告

## 2. 当前输出目录约定

默认输出到：

```text
tests/regression/output/<timestamp>/
```

其中每个 case 会生成：

- `<case-id>.actual.json`
- `<case-id>.report.json`

并额外生成：

- `summary.json`

## 3. 当前通过判定

`baseline-regression` 的默认通过条件是：

1. HTTP status 与预期一致
2. 响应 envelope 一致
3. 稳定字段一致

其中“稳定字段”当前包括：

- success path：
  - `data.opportunityId`
  - `data.summary` 非空
  - `data.adviceText` 非空
  - `data.nextActions` 非空数组
  - `data.basisFields` 非空数组
- error path：
  - `error.code`
  - `error.message`
  - `error.httpStatus`
  - `error.stage`

说明：

- `strictBodyMatch` 会额外输出，但当前不作为默认 pass gate。
- 这样做是因为成功样例中包含 LLM 文案，后续回放时可能存在轻微漂移。

## 4. 预留的 shadow 对比报告格式

当前报告中已预留：

```json
{
  "shadow": {
    "enabled": false,
    "shadowRunId": null,
    "baselineRunId": "2026-04-12T05-50-00-000Z",
    "diffSummary": null
  }
}
```

后续接入 shadow 运行时，建议扩展为：

```json
{
  "reportType": "shadow-diff",
  "comparisonMode": "shadow",
  "baseline": {
    "requestId": "req_xxx",
    "route": "POST /api/agent/run"
  },
  "shadow": {
    "enabled": true,
    "requestId": "req_shadow_xxx",
    "graphVersion": "v1",
    "nodeDiffs": [],
    "resultDiffs": []
  }
}
```

这样可以沿用当前报告结构，而不需要再重新设计输出目录和报告顶层字段。

## 5. 用法示例

回放全部 baseline：

```bash
node scripts/run_baseline_regression.js
```

只回放单个 case：

```bash
node scripts/run_baseline_regression.js --case sales-opportunity-advisor.not-found
```

对比单个 expected / actual：

```bash
node scripts/compare_results.js \
  --expected tests/fixtures/baseline/sales-opportunity-advisor.not-found.response.json \
  --actual tests/regression/output/<timestamp>/sales-opportunity-advisor.not-found.actual.json \
  --dynamic-fields requestId
```

