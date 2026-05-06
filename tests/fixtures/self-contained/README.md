# Self-contained regression fixtures

These fixtures are used by `npm run regression:self-contained`.

Goals:

- scan runtime-bearing directories for legacy project paths and shared `.openclaw` paths
- replay the canonical scenes through the `_副本` service chain
- separate internal self-contained regressions from explicit external dependency instability

Notes:

- `payment-info-split` and `sales-opportunity-advisor` are strict success cases
- `sales-opportunity-advisor-directdb` now defaults to the template-backed `langgraph` runtime path in `_副本`, so the self-contained suite expects a success response instead of a gateway-boundary warning
- `sales-opportunity-smart-entry.smoke.request.json` is fixed here for AG-05 migration work; it is not in the default manifest yet because the scene still defaults to legacy routing
