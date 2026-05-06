const { normalizeError } = require("../../utils/errors");

const FORCE_FALLBACK_STAGES = new Set([
  "graph-compile",
  "graph-runtime"
]);

const FORCE_FALLBACK_INVALID_REQUEST_STAGES = new Set([
  "graph-compile",
  "graph-runtime",
  "load-assets",
  "fetch-context"
]);
function normalizeBooleanEnvValue(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function isLangGraphLegacyFallbackEnabled(env = process.env) {
  void env;
  return false;
}

function summarizeNodeRuns(finalState = null) {
  const nodeRuns = Array.isArray(finalState?.artifacts?.node_runs)
    ? finalState.artifacts.node_runs
    : [];
  const lastNodeRun = nodeRuns.length > 0 ? nodeRuns[nodeRuns.length - 1] : null;

  return {
    nodeRunCount: nodeRuns.length,
    lastNodeId: lastNodeRun?.node_id || null,
    lastNodeStatus: lastNodeRun?.status || null
  };
}

function shouldFallbackForError(appError) {
  if (!appError) {
    return true;
  }

  if (appError.httpStatus >= 500) {
    return true;
  }

  if (FORCE_FALLBACK_STAGES.has(appError.stage)) {
    return true;
  }

  if (
    appError.code === "INVALID_REQUEST"
    && FORCE_FALLBACK_INVALID_REQUEST_STAGES.has(appError.stage)
  ) {
    return true;
  }

  return false;
}

function resolveLangGraphFallbackDecision({
  error = null,
  finalState = null,
  legacyFallbackEnabled = isLangGraphLegacyFallbackEnabled()
} = {}) {
  const hasExceptionalError = Boolean(error);
  const hasFailedFinalState = Boolean(finalState) && finalState?.result?.success !== true;

  if (!hasExceptionalError && !hasFailedFinalState) {
    return {
      shouldFallback: false,
      fallbackEligible: false,
      fallbackSuppressed: false,
      legacyFallbackEnabled,
      source: null,
      error: null,
      ...summarizeNodeRuns(finalState)
    };
  }

  const normalizedError = hasExceptionalError
    ? normalizeError(error)
    : normalizeError(finalState?.error);
  const fallbackEligible = shouldFallbackForError(normalizedError);
  const fallbackSuppressed = fallbackEligible && !legacyFallbackEnabled;

  return {
    shouldFallback: fallbackEligible && legacyFallbackEnabled,
    fallbackEligible,
    fallbackSuppressed,
    legacyFallbackEnabled,
    source: hasExceptionalError ? "exception" : "final_state_error",
    error: normalizedError,
    ...summarizeNodeRuns(finalState)
  };
}

function buildLangGraphFallbackAudit({
  requestId,
  traceId,
  scene,
  routePlan,
  fallbackDecision
} = {}) {
  return {
    fallbackTriggered: true,
    fallbackReason: "langgraph_auto_fallback",
    fallbackSource: fallbackDecision?.source || null,
    fallbackFromMode: routePlan?.requestedMode || routePlan?.effectiveMode || "langgraph",
    fallbackToMode: "legacy",
    fallbackEligible: fallbackDecision?.fallbackEligible ?? null,
    fallbackSuppressed: false,
    legacyFallbackEnabled: fallbackDecision?.legacyFallbackEnabled ?? null,
    fallbackErrorCode: fallbackDecision?.error?.code || null,
    fallbackErrorStage: fallbackDecision?.error?.stage || null,
    fallbackErrorHttpStatus: fallbackDecision?.error?.httpStatus || null,
    fallbackNodeRunCount: fallbackDecision?.nodeRunCount ?? 0,
    fallbackLastNodeId: fallbackDecision?.lastNodeId || null,
    fallbackLastNodeStatus: fallbackDecision?.lastNodeStatus || null,
    requestId: requestId || null,
    traceId: traceId || null,
    scene: scene || null
  };
}

function buildLangGraphFallbackSuppressedAudit({
  requestId,
  traceId,
  scene,
  routePlan,
  fallbackDecision
} = {}) {
  return {
    fallbackTriggered: false,
    fallbackSuppressed: true,
    fallbackReason: "langgraph_auto_fallback_disabled",
    fallbackSource: fallbackDecision?.source || null,
    fallbackFromMode: routePlan?.requestedMode || routePlan?.effectiveMode || "langgraph",
    fallbackToMode: null,
    fallbackEligible: fallbackDecision?.fallbackEligible ?? null,
    legacyFallbackEnabled: false,
    fallbackErrorCode: fallbackDecision?.error?.code || null,
    fallbackErrorStage: fallbackDecision?.error?.stage || null,
    fallbackErrorHttpStatus: fallbackDecision?.error?.httpStatus || null,
    fallbackNodeRunCount: fallbackDecision?.nodeRunCount ?? 0,
    fallbackLastNodeId: fallbackDecision?.lastNodeId || null,
    fallbackLastNodeStatus: fallbackDecision?.lastNodeStatus || null,
    requestId: requestId || null,
    traceId: traceId || null,
    scene: scene || null
  };
}

module.exports = {
  buildLangGraphFallbackAudit,
  buildLangGraphFallbackSuppressedAudit,
  isLangGraphLegacyFallbackEnabled,
  normalizeBooleanEnvValue,
  resolveLangGraphFallbackDecision,
  shouldFallbackForError,
  summarizeNodeRuns
};
