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
  finalState = null
} = {}) {
  const hasExceptionalError = Boolean(error);
  const hasFailedFinalState = Boolean(finalState) && finalState?.result?.success !== true;

  if (!hasExceptionalError && !hasFailedFinalState) {
    return {
      shouldFallback: false,
      source: null,
      error: null,
      ...summarizeNodeRuns(finalState)
    };
  }

  const normalizedError = hasExceptionalError
    ? normalizeError(error)
    : normalizeError(finalState?.error);
  const shouldFallback = shouldFallbackForError(normalizedError);

  return {
    shouldFallback,
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
  resolveLangGraphFallbackDecision,
  shouldFallbackForError,
  summarizeNodeRuns
};
