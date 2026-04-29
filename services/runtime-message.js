const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");
const { createAppError } = require("../utils/errors");
const { getSupportedScenes } = require("./scene-config");

const DEFAULT_REQUEST_BEGIN = "<<<SALES_OPPORTUNITY_ADVISOR_REQUEST_JSON_BEGIN>>>";
const DEFAULT_REQUEST_END = "<<<SALES_OPPORTUNITY_ADVISOR_REQUEST_JSON_END>>>";
const DEFAULT_RESULT_BEGIN = "<<<SALES_OPPORTUNITY_ADVISOR_RESULT_JSON_BEGIN>>>";
const DEFAULT_RESULT_END = "<<<SALES_OPPORTUNITY_ADVISOR_RESULT_JSON_END>>>";
const GATEWAY_BASE_URL = "http://127.0.0.1:18789";
const GATEWAY_CHAT_COMPLETIONS_URL = `${GATEWAY_BASE_URL}/v1/chat/completions`;
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

function buildSessionKey(sceneConfig, requestId) {
  if (!sceneConfig?.agent?.sessionKeyPrefix) {
    throw createAppError("INVALID_REQUEST", "Scene config must define agent.sessionKeyPrefix.", {
      stage: "runtime-request-build",
      details: {
        scene: sceneConfig?.scene || null
      }
    });
  }

  return `${sceneConfig.agent.sessionKeyPrefix}:${requestId}`;
}

function buildRuntimeMessage({ requestId, sceneConfig, bizParams }) {
  if (!sceneConfig?.scene || !sceneConfig?.runtime?.requestKind) {
    throw createAppError("INVALID_REQUEST", "sceneConfig is required to build runtime message.", {
      stage: "runtime-request-build"
    });
  }

  return {
    kind: sceneConfig.runtime.requestKind,
    version: sceneConfig.runtime.messageVersion || MESSAGE_VERSION,
    requestId,
    scene: sceneConfig.scene,
    bizParams: { ...bizParams },
    responseFormat: sceneConfig.runtime.responseFormat || {
      type: "json",
      schemaVersion: "1.0"
    }
  };
}

function serializeRuntimeMessage(sceneConfig, messageObject) {
  const markers = getRequestMarkers(sceneConfig);
  return `${markers.begin}\n${JSON.stringify(messageObject)}\n${markers.end}`;
}

function buildRuntimeRequest({ sceneConfig, sessionKey, messageText, requestId }) {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) {
    throw createAppError(
      "MISSING_GATEWAY_TOKEN",
      "OPENCLAW_GATEWAY_TOKEN is required to call the local Gateway."
    );
  }

  const url = new URL(GATEWAY_CHAT_COMPLETIONS_URL);
  if (url.hostname !== "127.0.0.1") {
    throw createAppError(
      "INVALID_GATEWAY_TARGET",
      "Gateway target must be bound to 127.0.0.1."
    );
  }

  return {
    requestId,
    method: "POST",
    url: GATEWAY_CHAT_COMPLETIONS_URL,
    sessionKey,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-openclaw-session-key": sessionKey
    },
    body: {
      model: sceneConfig.agent.gatewayModel,
      stream: false,
      n: 1,
      messages: [
        {
          role: "user",
          content: messageText
        }
      ]
    }
  };
}

async function writeDebugRequestSnapshot(runtimeRequest) {
  if (process.env.API_WRITE_DEBUG_SNAPSHOTS !== "1") {
    return null;
  }

  const requestId = runtimeRequest.requestId;
  const targetDir = path.join(__dirname, "..", "runtime", "requests");
  const targetPath = path.join(targetDir, `${requestId}.json`);

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(runtimeRequest, null, 2)}\n`, "utf8");
  return targetPath;
}

module.exports = {
  GATEWAY_BASE_URL,
  GATEWAY_CHAT_COMPLETIONS_URL,
  MESSAGE_VERSION,
  DEFAULT_REQUEST_BEGIN,
  DEFAULT_REQUEST_END,
  DEFAULT_RESULT_BEGIN,
  DEFAULT_RESULT_END,
  SUPPORTED_SCENES,
  buildRuntimeMessage,
  buildRuntimeRequest,
  buildSessionKey,
  getRequestMarkers,
  getResultMarkers,
  serializeRuntimeMessage,
  writeDebugRequestSnapshot
};
