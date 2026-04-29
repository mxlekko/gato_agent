const { getConsoleReleaseStatus, rollbackConsoleRelease } = require("../services/console-releases");
const { buildSuccessResponse } = require("../utils/errors");
const { buildRequestId } = require("../utils/request-id");

async function getConsoleReleaseStatusRoute(url) {
  const requestId = buildRequestId();
  const data = await getConsoleReleaseStatus({
    environment: url.searchParams.get("environment"),
    scopeType: url.searchParams.get("scopeType"),
    scopeValue: url.searchParams.get("scopeValue")
  });

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function rollbackConsoleReleaseRoute(releaseId, body = {}) {
  const requestId = buildRequestId();
  const data = await rollbackConsoleRelease({
    releaseId,
    updatedBy: body.updatedBy || body.operator,
    updatedAt: body.updatedAt
  });

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

module.exports = {
  getConsoleReleaseStatusRoute,
  rollbackConsoleReleaseRoute
};
