const {
  compileConsoleConfigPreview,
  getConsoleConfigCatalog,
  updateConsoleQueryStructuredConfig,
  updateConsoleToolStructuredConfig,
  validateConsoleConfigs
} = require("../services/console-configs");
const { buildSuccessResponse } = require("../utils/errors");
const { buildRequestId } = require("../utils/request-id");

async function getConsoleConfigCatalogRoute() {
  const requestId = buildRequestId();
  const data = await getConsoleConfigCatalog();

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function validateConsoleConfigsRoute() {
  const requestId = buildRequestId();
  const data = await validateConsoleConfigs();

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function compileConsoleConfigPreviewRoute(body = {}) {
  const requestId = buildRequestId();
  const data = await compileConsoleConfigPreview({
    scene: body.scene
  });

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function updateConsoleToolStructuredConfigRoute(resourceId, body = {}) {
  const requestId = buildRequestId();
  const data = await updateConsoleToolStructuredConfig(resourceId, body);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function updateConsoleQueryStructuredConfigRoute(resourceId, body = {}) {
  const requestId = buildRequestId();
  const data = await updateConsoleQueryStructuredConfig(resourceId, body);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

module.exports = {
  compileConsoleConfigPreviewRoute,
  getConsoleConfigCatalogRoute,
  updateConsoleQueryStructuredConfigRoute,
  updateConsoleToolStructuredConfigRoute,
  validateConsoleConfigsRoute
};
