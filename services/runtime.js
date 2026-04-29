const { URL } = require("url");
const { createAppError, normalizeError } = require("../utils/errors");
const {
  buildRuntimeMessage,
  buildRuntimeRequest,
  buildSessionKey,
  serializeRuntimeMessage,
  writeDebugRequestSnapshot
} = require("./runtime-message");
const {
  parseBusinessPayload,
  parseRuntimeEnvelope,
  validateBusinessPayload
} = require("./response-parser");
const { isDirectModelScene, runDirectModelScene } = require("./direct-model");

const DEFAULT_TIMEOUT_MS = 120000;
const LEGACY_AGENT_RUNTIME_COMPATIBILITY_BOUNDARY = Object.freeze({
  role: "compatibility",
  ownsNewBusinessFlow: false,
  supportedUseCases: [
    "explicit_legacy_mode",
    "shadow_baseline",
    "langgraph_fallback"
  ]
});
const LEGACY_DIRECT_MODEL_BOUNDARY = Object.freeze({
  role: "legacy-primary",
  ownsNewBusinessFlow: true,
  supportedUseCases: [
    "direct_model_scene"
  ]
});

function parseAgentIdFromRuntimeModel(model) {
  if (typeof model !== "string" || !model.startsWith("openclaw/")) {
    return null;
  }

  const agentId = model.slice("openclaw/".length).trim();
  return agentId || null;
}

function validateRuntimeRequest(runtimeRequest) {
  if (!runtimeRequest || typeof runtimeRequest !== "object") {
    throw createAppError("RUNTIME_INVALID_RESPONSE", "Runtime request must be an object.", {
      stage: "runtime-request-build"
    });
  }

  if (runtimeRequest.method !== "POST") {
    throw createAppError("INVALID_GATEWAY_TARGET", "Runtime method must be POST.");
  }

  const target = new URL(runtimeRequest.url);
  if (!target.pathname.endsWith("/v1/chat/completions")) {
    throw createAppError("INVALID_GATEWAY_TARGET", "Gateway URL must target /v1/chat/completions.");
  }

  if (target.hostname !== "127.0.0.1") {
    throw createAppError("INVALID_GATEWAY_TARGET", "Gateway host must be 127.0.0.1.");
  }

  const runtimeModel = runtimeRequest.body?.model;
  const expectedAgentId = parseAgentIdFromRuntimeModel(runtimeModel);

  if (!expectedAgentId) {
    throw createAppError("INVALID_REQUEST", "Runtime model must target an openclaw agent.", {
      stage: "runtime-request-build"
    });
  }

  if (!runtimeRequest.sessionKey || !runtimeRequest.sessionKey.startsWith(`agent:${expectedAgentId}:`)) {
    throw createAppError("INVALID_REQUEST", `sessionKey must target ${expectedAgentId}.`, {
      stage: "runtime-request-build"
    });
  }

  if (!runtimeRequest.headers?.Authorization) {
    throw createAppError("MISSING_GATEWAY_TOKEN", "Gateway Authorization header is required.");
  }

  if (runtimeRequest.headers["x-openclaw-session-key"] !== runtimeRequest.sessionKey) {
    throw createAppError(
      "INVALID_REQUEST",
      "x-openclaw-session-key must match runtime sessionKey.",
      { stage: "runtime-request-build" }
    );
  }

  const message = runtimeRequest.body?.messages?.[0]?.content;
  if (typeof message !== "string" || message.length === 0) {
    throw createAppError("INVALID_REQUEST", "Runtime message content is required.", {
      stage: "runtime-request-build"
    });
  }

  return runtimeRequest;
}

async function executeGatewayChatCompletionRequest(runtimeRequest) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.GATEWAY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(runtimeRequest.url, {
      method: runtimeRequest.method,
      headers: runtimeRequest.headers,
      body: JSON.stringify(runtimeRequest.body),
      signal: controller.signal
    });

    const rawText = await response.text();
    return {
      httpStatus: response.status,
      rawText
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createAppError("RUNTIME_TIMEOUT", "OpenClaw Gateway request timed out.");
    }

    throw createAppError("GATEWAY_UNAVAILABLE", "OpenClaw Gateway is unavailable.", {
      details: {
        cause: error?.message || "fetch_failed"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function mapRuntimeError(error) {
  return normalizeError(error, "GATEWAY_UNAVAILABLE");
}

async function runAgentRuntime(runtimeRequest) {
  validateRuntimeRequest(runtimeRequest);
  const startedAt = Date.now();

  try {
    const { httpStatus, rawText } = await executeGatewayChatCompletionRequest(runtimeRequest);

    if (httpStatus === 401 || httpStatus === 403) {
      throw createAppError("GATEWAY_AUTH_FAILED", "Gateway authentication failed.", {
        details: {
          httpStatus,
          body: rawText
        }
      });
    }

    if (httpStatus < 200 || httpStatus >= 300) {
      throw createAppError("RUNTIME_INVALID_RESPONSE", `Gateway returned HTTP ${httpStatus}.`, {
        stage: "gateway-http",
        details: {
          httpStatus,
          body: rawText
        }
      });
    }

    return {
      ok: true,
      sessionKey: runtimeRequest.sessionKey,
      httpStatus,
      rawResponse: rawText,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const mapped = mapRuntimeError(error);
    if (!mapped.details || typeof mapped.details !== "object") {
      mapped.details = {};
    }
    mapped.details.durationMs = Date.now() - startedAt;
    throw mapped;
  }
}

async function runLegacyAgentRuntimeScene({ requestId, sceneConfig, bizParams }) {
  const sessionKey = buildSessionKey(sceneConfig, requestId);
  const runtimeMessage = buildRuntimeMessage({ requestId, sceneConfig, bizParams });
  const messageText = serializeRuntimeMessage(sceneConfig, runtimeMessage);
  const runtimeRequest = buildRuntimeRequest({ sceneConfig, sessionKey, messageText, requestId });

  await writeDebugRequestSnapshot(runtimeRequest);

  const runtimeResult = await runAgentRuntime(runtimeRequest);
  const envelope = parseRuntimeEnvelope(runtimeResult);
  const businessResult = validateBusinessPayload(parseBusinessPayload(sceneConfig, envelope));

  return {
    executionType: "agent-runtime",
    sessionKey,
    runtimeRequest,
    runtimeResult,
    businessResult,
    durationMs: runtimeResult.durationMs,
    compatibilityBoundary: LEGACY_AGENT_RUNTIME_COMPATIBILITY_BOUNDARY
  };
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

  return runLegacyAgentRuntimeScene({
    requestId,
    sceneConfig,
    bizParams
  });
}

module.exports = {
  LEGACY_AGENT_RUNTIME_COMPATIBILITY_BOUNDARY,
  LEGACY_DIRECT_MODEL_BOUNDARY,
  executeGatewayChatCompletionRequest,
  mapRuntimeError,
  runLegacyAgentRuntimeScene,
  runLegacyDirectModelScene,
  runLegacySceneExecution,
  runAgentRuntime,
  validateRuntimeRequest
};
