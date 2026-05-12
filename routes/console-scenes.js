const {
  createConsoleSceneDraft,
  deleteConsoleSceneDraft,
  getConsoleSceneCatalog,
  getConsoleSceneDictionaryAssetContent,
  getConsoleSceneInputMappingContent,
  getConsoleSceneModelBinding,
  getConsoleScenePromptAssetContent,
  getConsoleSceneQueryProfileContent,
  getConsoleSceneRulesAssetContent,
  getConsoleSceneSchemaAssetContent,
  getConsoleSceneSkillBinding,
  getConsoleSceneTemplates,
  getConsoleSceneWorkflow,
  updateConsoleSceneDictionaryAssetContent,
  updateConsoleSceneInputMappingContent,
  updateConsoleSceneModelBinding,
  updateConsoleScenePromptAssetContent,
  updateConsoleSceneQueryProfileContent,
  updateConsoleSceneRulesAssetContent,
  updateConsoleSceneSchemaAssetContent,
  updateConsoleSceneSkillBinding
} = require("../services/console-scenes");
const { buildSuccessResponse } = require("../utils/errors");
const { buildRequestId } = require("../utils/request-id");

async function listConsoleScenesRoute() {
  const requestId = buildRequestId();
  const data = await getConsoleSceneCatalog();

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function listConsoleSceneTemplatesRoute() {
  const requestId = buildRequestId();
  const data = await getConsoleSceneTemplates();

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function createConsoleSceneRoute(body = {}) {
  const requestId = buildRequestId();
  const data = await createConsoleSceneDraft(body);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function deleteConsoleSceneRoute(scene) {
  const requestId = buildRequestId();
  const data = await deleteConsoleSceneDraft(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleSceneWorkflowRoute(scene) {
  const requestId = buildRequestId();
  const data = await getConsoleSceneWorkflow(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleScenePromptAssetRoute(scene) {
  const requestId = buildRequestId();
  const data = await getConsoleScenePromptAssetContent(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function updateConsoleScenePromptAssetRoute(scene, body = {}) {
  const requestId = buildRequestId();
  const data = await updateConsoleScenePromptAssetContent(scene, body.content);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleSceneSchemaAssetRoute(scene) {
  const requestId = buildRequestId();
  const data = await getConsoleSceneSchemaAssetContent(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function updateConsoleSceneSchemaAssetRoute(scene, body = {}) {
  const requestId = buildRequestId();
  const data = await updateConsoleSceneSchemaAssetContent(scene, body.content);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleSceneDictionaryAssetRoute(scene) {
  const requestId = buildRequestId();
  const data = await getConsoleSceneDictionaryAssetContent(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function updateConsoleSceneDictionaryAssetRoute(scene, body = {}) {
  const requestId = buildRequestId();
  const data = await updateConsoleSceneDictionaryAssetContent(scene, body.content);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleSceneRulesAssetRoute(scene) {
  const requestId = buildRequestId();
  const data = await getConsoleSceneRulesAssetContent(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function updateConsoleSceneRulesAssetRoute(scene, body = {}) {
  const requestId = buildRequestId();
  const data = await updateConsoleSceneRulesAssetContent(scene, body.content);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleSceneQueryProfileRoute(scene) {
  const requestId = buildRequestId();
  const data = await getConsoleSceneQueryProfileContent(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function updateConsoleSceneQueryProfileRoute(scene, body = {}) {
  const requestId = buildRequestId();
  const data = await updateConsoleSceneQueryProfileContent(scene, body.content);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleSceneInputMappingRoute(scene) {
  const requestId = buildRequestId();
  const data = await getConsoleSceneInputMappingContent(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function updateConsoleSceneInputMappingRoute(scene, body = {}) {
  const requestId = buildRequestId();
  const data = await updateConsoleSceneInputMappingContent(scene, body.content);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleSceneSkillBindingRoute(scene) {
  const requestId = buildRequestId();
  const data = await getConsoleSceneSkillBinding(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function updateConsoleSceneSkillBindingRoute(scene, body = {}) {
  const requestId = buildRequestId();
  const data = await updateConsoleSceneSkillBinding(scene, body);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function getConsoleSceneModelBindingRoute(scene) {
  const requestId = buildRequestId();
  const data = await getConsoleSceneModelBinding(scene);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

async function updateConsoleSceneModelBindingRoute(scene, body = {}) {
  const requestId = buildRequestId();
  const data = await updateConsoleSceneModelBinding(scene, body);

  return {
    statusCode: 200,
    payload: buildSuccessResponse(data, requestId)
  };
}

module.exports = {
  createConsoleSceneRoute,
  deleteConsoleSceneRoute,
  getConsoleSceneDictionaryAssetRoute,
  getConsoleSceneInputMappingRoute,
  getConsoleSceneModelBindingRoute,
  getConsoleScenePromptAssetRoute,
  getConsoleSceneQueryProfileRoute,
  getConsoleSceneRulesAssetRoute,
  getConsoleSceneSchemaAssetRoute,
  getConsoleSceneSkillBindingRoute,
  getConsoleSceneWorkflowRoute,
  listConsoleSceneTemplatesRoute,
  listConsoleScenesRoute,
  updateConsoleSceneDictionaryAssetRoute,
  updateConsoleSceneInputMappingRoute,
  updateConsoleSceneModelBindingRoute,
  updateConsoleScenePromptAssetRoute,
  updateConsoleSceneQueryProfileRoute,
  updateConsoleSceneRulesAssetRoute,
  updateConsoleSceneSchemaAssetRoute,
  updateConsoleSceneSkillBindingRoute
};
