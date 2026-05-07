const { getConsoleRunDetail, listConsoleRuns } = require("../services/console-runs");
const { buildSuccessResponse } = require("../utils/errors");
const { buildRequestId } = require("../utils/request-id");

function parseLimit(searchParams) {
  const rawLimit = searchParams.get("limit");
  if (!rawLimit) {
    return 20;
  }

  const parsed = Number(rawLimit);
  return Number.isFinite(parsed) ? parsed : 20;
}

async function listConsoleRunsRoute(url) {
  const requestId = buildRequestId();
  const data = listConsoleRuns({
    limit: parseLimit(url.searchParams)
  });

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleRunRoute(runId) {
  const requestId = buildRequestId();
  const data = getConsoleRunDetail(runId);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

module.exports = {
  getConsoleRunRoute,
  listConsoleRunsRoute
};
