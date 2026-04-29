const {
  getConsoleRolloutReport,
  getConsoleSceneRouting,
  previewConsoleSceneRoutingChange
} = require("../services/console-rollout");
const { buildSuccessResponse } = require("../utils/errors");
const { buildRequestId } = require("../utils/request-id");

async function getConsoleRolloutReportRoute() {
  const requestId = buildRequestId();
  const data = getConsoleRolloutReport();

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleSceneRoutingRoute(scene) {
  const requestId = buildRequestId();
  const data = getConsoleSceneRouting(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function previewConsoleSceneRoutingChangeRoute(scene, body = {}) {
  const requestId = buildRequestId();
  const data = previewConsoleSceneRoutingChange(scene, body, requestId);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

module.exports = {
  getConsoleRolloutReportRoute,
  getConsoleSceneRoutingRoute,
  previewConsoleSceneRoutingChangeRoute
};
