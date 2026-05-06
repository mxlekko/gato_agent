const { getSupportedScenes } = require("./scene-config");

const DEFAULT_REQUEST_BEGIN = "<<<SALES_OPPORTUNITY_ADVISOR_REQUEST_JSON_BEGIN>>>";
const DEFAULT_REQUEST_END = "<<<SALES_OPPORTUNITY_ADVISOR_REQUEST_JSON_END>>>";
const DEFAULT_RESULT_BEGIN = "<<<SALES_OPPORTUNITY_ADVISOR_RESULT_JSON_BEGIN>>>";
const DEFAULT_RESULT_END = "<<<SALES_OPPORTUNITY_ADVISOR_RESULT_JSON_END>>>";
const MESSAGE_VERSION = "1.0";
const SUPPORTED_SCENES = getSupportedScenes();

function getRequestMarkers(sceneConfig) {
  const markers = sceneConfig?.runtime?.requestMarkers;
  return {
    begin: markers?.begin || DEFAULT_REQUEST_BEGIN,
    end: markers?.end || DEFAULT_REQUEST_END
  };
}

function getResultMarkers(sceneConfig) {
  const markers = sceneConfig?.runtime?.resultMarkers;
  return {
    begin: markers?.begin || DEFAULT_RESULT_BEGIN,
    end: markers?.end || DEFAULT_RESULT_END
  };
}

function buildRuntimeMessage({ requestId, sceneConfig, bizParams }) {
  return {
    kind: sceneConfig?.runtime?.requestKind || null,
    version: sceneConfig?.runtime?.messageVersion || MESSAGE_VERSION,
    requestId,
    scene: sceneConfig?.scene || null,
    bizParams: { ...(bizParams || {}) },
    responseFormat: sceneConfig?.runtime?.responseFormat || {
      type: "json",
      schemaVersion: "1.0"
    }
  };
}

function serializeRuntimeMessage(sceneConfig, messageObject) {
  const markers = getRequestMarkers(sceneConfig);
  return `${markers.begin}\n${JSON.stringify(messageObject)}\n${markers.end}`;
}

module.exports = {
  MESSAGE_VERSION,
  DEFAULT_REQUEST_BEGIN,
  DEFAULT_REQUEST_END,
  DEFAULT_RESULT_BEGIN,
  DEFAULT_RESULT_END,
  SUPPORTED_SCENES,
  buildRuntimeMessage,
  getRequestMarkers,
  getResultMarkers,
  serializeRuntimeMessage
};
