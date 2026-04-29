const { executeSqlTemplateRequest } = require("../services/sql-template");
const { writeAuditError, writeAuditLog } = require("../../ContextHelper/services/audit-log");
const { buildErrorResponse, buildSuccessResponse, normalizeError } = require("../../utils/errors");

function compactDirectDbData(data) {
  return {
    requestId: data.requestId,
    opportunityId: data.opportunityId,
    rawRow: data.rawRow
  };
}

async function handleDirectDbSalesOpportunity(body) {
  const startedAt = Date.now();
  const requestId = body?.requestId || null;
  const opportunityId = body?.opportunityId ?? null;

  try {
    const data = await executeSqlTemplateRequest(body);
    const compactData = compactDirectDbData(data);

    writeAuditLog({
      requestId,
      opportunityId,
      provider: "sales-opportunity-directdb-runner",
      durationMs: Date.now() - startedAt,
      success: true
    });

    return {
      statusCode: 200,
      payload: buildSuccessResponse(compactData, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);

    writeAuditError({
      requestId,
      opportunityId,
      provider: "sales-opportunity-directdb-runner",
      durationMs: Date.now() - startedAt,
      success: false,
      code: appError.code,
      stage: appError.stage
    });

    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

module.exports = {
  handleDirectDbSalesOpportunity
};
