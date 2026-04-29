const { getSalesOpportunityContext } = require("../providers/sales-opportunity");
const { buildErrorResponse, buildSuccessResponse, normalizeError } = require("../../utils/errors");
const { writeAuditError, writeAuditLog } = require("../services/audit-log");

async function handleSalesOpportunityContext(body) {
  const startedAt = Date.now();
  const requestId = body?.requestId || null;
  const opportunityId = body?.opportunityId ?? null;

  try {
    const data = await getSalesOpportunityContext(body);
    writeAuditLog({
      requestId,
      opportunityId,
      provider: "sales-opportunity",
      durationMs: Date.now() - startedAt,
      success: true
    });

    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    writeAuditError({
      requestId,
      opportunityId,
      provider: "sales-opportunity",
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
  handleSalesOpportunityContext
};
