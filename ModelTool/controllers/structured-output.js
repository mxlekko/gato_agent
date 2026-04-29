const { buildErrorResponse, buildSuccessResponse, normalizeError } = require("../../utils/errors");
const { writeAuditError, writeAuditLog } = require("../../ContextHelper/services/audit-log");
const { validateStructuredOutput } = require("../services/structured-output-validator");

async function handleStructuredOutputValidation(body) {
  const startedAt = Date.now();
  const requestId = body?.requestId || null;
  const scene = body?.scene || null;

  try {
    const data = validateStructuredOutput(body);

    writeAuditLog({
      requestId,
      opportunityId: null,
      provider: "sales-opportunity-model-tool",
      durationMs: Date.now() - startedAt,
      success: true,
      scene
    });

    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);

    writeAuditError({
      requestId,
      opportunityId: null,
      provider: "sales-opportunity-model-tool",
      durationMs: Date.now() - startedAt,
      success: false,
      code: appError.code,
      stage: appError.stage,
      scene
    });

    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

module.exports = {
  handleStructuredOutputValidation
};
