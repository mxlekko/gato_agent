# Self-contained regression fixtures

These fixtures are used by `npm run regression:self-contained`.

Goals:

- scan runtime-bearing directories for retired project paths and shared `旧共享运行时目录` paths
- replay the canonical scenes through the `_副本` service chain
- separate internal self-contained regressions from explicit external dependency instability

Notes:

- `payment-info-split` and `sales-opportunity-advisor` are strict success cases
- `sales-opportunity-advisor-directdb` now defaults to the template-backed `langgraph` runtime path in `_副本`, so the self-contained suite expects a success response instead of a gateway-boundary warning
- `sales-opportunity-smart-entry.smoke.request.json` is included in the default manifest and runs through LangGraph routing.
