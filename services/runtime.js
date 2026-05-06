const { createAppError, normalizeError } = require("../utils/errors");
const { validateBusinessPayload } = require("./response-parser");
const { isDirectModelScene, runDirectModelScene } = require("./direct-model");

const RETIRED_AGENT_RUNTIME_BOUNDARY = Object.freeze({
  role: "retired-agent-runtime",
  ownsNewBusinessFlow: false,
  supportedUseCases: [
    "none"
  ]
});
const LEGACY_DIRECT_MODEL_BOUNDARY = Object.freeze({
  role: "legacy-primary",
  ownsNewBusinessFlow: true,
  supportedUseCases: [
    "direct_model_scene"
  ]
});

function mapRuntimeError(error) {
  return normalizeError(error, "GATEWAY_UNAVAILABLE");
}

async function runRetiredAgentRuntimeScene({ sceneConfig } = {}) {
  throw createAppError("INVALID_REQUEST", "Agent-runtime legacy execution has been retired. Use langgraph routing for this scene.", {
    stage: "scene-routing",
    retryable: false,
    details: {
      scene: sceneConfig?.scene || null,
      requiredMode: "langgraph"
    }
  });
}

async function runLegacyDirectModelScene({ requestId, sceneConfig, bizParams }) {
  const businessResult = validateBusinessPayload(
    await runDirectModelScene({
      requestId,
      sceneConfig,
      bizParams
    })
  );

  return {
    executionType: "direct-model",
    sessionKey: null,
    runtimeRequest: null,
    runtimeResult: null,
    businessResult,
    durationMs: businessResult.meta?.durationMs || null,
    compatibilityBoundary: LEGACY_DIRECT_MODEL_BOUNDARY
  };
}

async function runLegacySceneExecution({ requestId, sceneConfig, bizParams }) {
  if (isDirectModelScene(sceneConfig)) {
    return runLegacyDirectModelScene({
      requestId,
      sceneConfig,
      bizParams
    });
  }

  return runRetiredAgentRuntimeScene({
    sceneConfig
  });
}

module.exports = {
  LEGACY_DIRECT_MODEL_BOUNDARY,
  RETIRED_AGENT_RUNTIME_BOUNDARY,
  mapRuntimeError,
  runLegacyDirectModelScene,
  runLegacySceneExecution,
  runRetiredAgentRuntimeScene
};
