# Sales Opportunity Advisor DirectDb SQL Definition

This file is the project-owned SQL business definition source for `sales-opportunity-advisor-directdb`.
DirectDbRunner reads this file to build or validate the cached parameterized SQL template.

<<<SQL_BUSINESS_DEFINITION_BEGIN>>>
查询销售机会表 `t_sales_opportunity` 中 `opportunityId` 等于传入参数 `opportunityId` 的单条记录，并返回该记录的全部字段。
SQL 必须使用参数化占位符 `@opportunityId`。
SQL 必须是单条 `SELECT TOP 1` 语句。
不允许联表，不允许子查询，不允许排序，不允许任何写操作。
<<<SQL_BUSINESS_DEFINITION_END>>>
