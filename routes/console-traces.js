const { getConsoleTraceDetail } = require("../services/console-traces");
const { buildSuccessResponse } = require("../utils/errors");
const { buildRequestId } = require("../utils/request-id");

async function getConsoleTraceRoute(traceId) {
  const requestId = buildRequestId();
  const data = getConsoleTraceDetail(traceId);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

module.exports = {
  getConsoleTraceRoute
};
