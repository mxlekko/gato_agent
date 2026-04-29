const { getConsoleRevisionDetail, listConsoleRevisions } = require("../services/console-audit");
const { buildSuccessResponse } = require("../utils/errors");
const { buildRequestId } = require("../utils/request-id");

async function listConsoleRevisionsRoute(url) {
  const requestId = buildRequestId();
  const data = await listConsoleRevisions({
    targetType: url.searchParams.get("targetType"),
    targetId: url.searchParams.get("targetId"),
    scene: url.searchParams.get("scene"),
    assetType: url.searchParams.get("assetType"),
    kind: url.searchParams.get("kind"),
    name: url.searchParams.get("name"),
    version: url.searchParams.get("version"),
    ref: url.searchParams.get("ref"),
    scriptType: url.searchParams.get("scriptType"),
    limit: url.searchParams.get("limit")
  });

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleRevisionDetailRoute(revisionId) {
  const requestId = buildRequestId();
  const data = await getConsoleRevisionDetail({
    revisionId
  });

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

module.exports = {
  getConsoleRevisionDetailRoute,
  listConsoleRevisionsRoute
};
