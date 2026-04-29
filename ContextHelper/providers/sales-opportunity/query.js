const { createAppError } = require("../../../utils/errors");
const { getDbPool, sql } = require("../../services/db");
const { getOrCreateHelperQueryFile } = require("../../services/generated-query-file");

async function querySalesOpportunity(opportunityId) {
  try {
    const generatedQuery = await getOrCreateHelperQueryFile();
    const pool = await getDbPool();
    const result = await pool
      .request()
      .input("opportunityId", sql.NVarChar(64), opportunityId)
      .query(generatedQuery.sqlText);

    if (!result.recordset.length) {
      throw createAppError("OPPORTUNITY_NOT_FOUND", "未查询到对应的销售机会记录");
    }

    return result.recordset[0];
  } catch (caughtError) {
    if (caughtError?.name === "AppError") {
      throw caughtError;
    }

    throw createAppError("CONTEXT_QUERY_FAILED", "销售机会上下文查询失败。", {
      stage: "context-query",
      details: {
        cause: caughtError?.message || "sql_query_failed"
      }
    });
  }
}

module.exports = {
  querySalesOpportunity
};
