const { executeGenericQuery } = require("../services/generic-query-runner");
const { buildErrorResponse, buildSuccessResponse, normalizeError } = require("../utils/errors");

async function executeGenericQueryRoute(body = {}) {
  try {
    const requestId = typeof body?.requestId === "string" ? body.requestId : null;
    const data = await executeGenericQuery(body);

    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (error) {
    const normalized = normalizeError(error);
    return {
      statusCode: normalized.httpStatus,
      payload: buildErrorResponse(normalized, typeof body?.requestId === "string" ? body.requestId : null)
    };
  }
}

module.exports = {
  executeGenericQueryRoute
};
