# Sales Opportunity Advisor Contract

This file is the project-owned contract source for `sales-opportunity-advisor`.
The runtime path is `platform/runtime/graphs`; this document preserves the controlled query definition used by QueryProfile metadata.

## Request Contract

- `kind = sales_opportunity_advisor_request`
- `scene = sales-opportunity-advisor`
- `bizParams.opportunityId`

## Query Service Script Path

<<<CONTEXT_HELPER_QUERY_SCRIPT_PATH_BEGIN>>>
project://ContextHelper/generated-queries/sales-opportunity-advisor.generated.js
<<<CONTEXT_HELPER_QUERY_SCRIPT_PATH_END>>>

## Query Service Business Definition

<<<CONTEXT_HELPER_QUERY_DEFINITION_BEGIN>>>
查询销售机会表 `t_sales_opportunity` 中 `opportunityId` 等于传入参数 `opportunityId` 的单条记录，并返回该记录的全部字段。
查询服务脚本必须使用参数化占位符 `@opportunityId`。
查询服务脚本只允许执行单条 `SELECT TOP 1` 语句。
不允许联表，不允许子查询，不允许排序，不允许任何写操作。
<<<CONTEXT_HELPER_QUERY_DEFINITION_END>>>
