const { buildComparisonReport } = require("../../scripts/compare_results");
const { runLegacySceneExecution } = require("../../services/runtime");
const { buildErrorResponse, buildSuccessResponse, normalizeError } = require("../../utils/errors");
const { buildTimestampedId } = require("../../utils/request-id");
const { runCompiledSceneWorkflow } = require("./graphs");
const { createInitialWorkflowState, mergeWorkflowState } = require("./state");

function buildShadowCompatRoutePlan(routePlan = null) {
  return {
    requestedMode: "shadow",
    effectiveMode: "langgraph-compat",
    executionMode: "langgraph-compat",
    allowedModes: Array.isArray(routePlan?.allowedModes) ? routePlan.allowedModes.slice() : null,
    reason: "shadow_langgraph_compat",
    shadowExecutionEnabled: true
  };
}

function buildShadowIds() {
  return {
    shadowRequestId: buildTimestampedId("shadowreq"),
    shadowTraceId: buildTimestampedId("shadowtrace")
  };
}

function buildLegacyHttpResponse(execution, fallbackRequestId = null) {
  if (execution?.businessResult?.success === false) {
    return {
      statusCode: execution.businessResult.error.httpStatus,
      payload: buildErrorResponse(execution.businessResult.error, execution.businessResult.requestId || fallbackRequestId)
    };
  }

  return {
    statusCode: 200,
    payload: buildSuccessResponse(
      execution?.businessResult?.payload,
      execution?.businessResult?.requestId || fallbackRequestId
    )
  };
}

function buildHttpResponseFromState(state) {
  if (state?.result?.success === true) {
    return {
      statusCode: 200,
      payload: buildSuccessResponse(
        state.result.payload,
        state.result.requestId || state?.runtime_context?.request_id || null
      )
    };
  }

  const normalizedError = normalizeError(state?.error);
  return {
    statusCode: normalizedError.httpStatus,
    payload: buildErrorResponse(normalizedError, state?.runtime_context?.request_id || null)
  };
}

function summarizeShadowState(state) {
  const nodeRuns = Array.isArray(state?.artifacts?.node_runs)
    ? state.artifacts.node_runs
    : [];

  return {
    shadowRequestId: state?.runtime_context?.request_id || null,
    shadowTraceId: state?.runtime_context?.trace_id || null,
    nodeRunCount: nodeRuns.length,
    nodeStatuses: nodeRuns.map((run) => ({
      nodeId: run.node_id || null,
      status: run.status || null
    })),
    compatArtifact: state?.artifacts?.compat?.legacy_scene_runner
      || state?.artifacts?.graph?.execution
      || null,
    resultSuccess: state?.result?.success === true,
    errorCode: state?.error?.code || null
  };
}

function buildShadowDiffReport({ scene, legacyResponse, shadowResponse }) {
  const report = buildComparisonReport({
    caseId: `${scene || "unknown"}.shadow`,
    route: `shadow:${scene || "unknown"}`,
    reportType: "shadow-diff",
    expectedStatus: legacyResponse.statusCode,
    actualStatus: shadowResponse.statusCode,
    expectedBody: legacyResponse.payload,
    actualBody: shadowResponse.payload,
    dynamicFields: ["requestId"],
    observedAt: new Date().toISOString()
  });

  return {
    report,
    summary: {
      passed: report.passed,
      httpStatusMatch: report.checks.httpStatusMatch,
      responseEnvelopeMatch: report.checks.responseEnvelopeMatch,
      consistencyFieldsMatch: report.checks.consistencyFieldsMatch,
      strictBodyMatch: report.checks.strictBodyMatch,
      differenceCount: Array.isArray(report.differences) ? report.differences.length : 0
    }
  };
}

async function executeShadowCompatWorkflow({
  requestId,
  traceId,
  scene,
  sceneConfig,
  bizParams,
  routePlan,
  executeShadowNode = runCompiledSceneWorkflow,
  graphExecutors = {}
} = {}) {
  const { shadowRequestId, shadowTraceId } = buildShadowIds();
  let shadowState = createInitialWorkflowState({
    requestId: shadowRequestId,
    traceId: shadowTraceId,
    scene,
    sceneConfig,
    bizParams,
    rawRequest: {
      scene,
      bizParams
    },
    routePlan: buildShadowCompatRoutePlan(routePlan),
    workflowBinding: {
      runtime_mode: "langgraph-compat",
      parent_request_id: requestId || null,
      parent_trace_id: traceId || null
    },
    tenantId: null,
    userId: null,
    permissions: null
  });

  shadowState = mergeWorkflowState(shadowState, {
    artifacts: {
      shadow: {
        parent_request_id: requestId || null,
        parent_trace_id: traceId || null,
        execution_label: "langgraph-compat"
      }
    }
  });

  const finalState = await executeShadowNode({
    state: shadowState,
    sceneConfig,
    executors: graphExecutors
  });

  return {
    shadowRequestId,
    shadowTraceId,
    state: finalState,
    response: buildHttpResponseFromState(finalState),
    summary: summarizeShadowState(finalState)
  };
}

async function runLegacyAndShadowCompat({
  requestId,
  traceId,
  scene,
  sceneConfig,
  bizParams,
  routePlan,
  executeLegacyScene = runLegacySceneExecution,
  executeShadowCompat = executeShadowCompatWorkflow
} = {}) {
  const [legacySettlement, shadowSettlement] = await Promise.allSettled([
    executeLegacyScene({
      requestId,
      sceneConfig,
      bizParams
    }),
    executeShadowCompat({
      requestId,
      traceId,
      scene,
      sceneConfig,
      bizParams,
      routePlan
    })
  ]);

  const result = {
    legacyExecution: null,
    legacyResponse: null,
    legacyError: null,
    shadow: {
      ok: false,
      shadowRequestId: null,
      shadowTraceId: null,
      state: null,
      response: null,
      summary: null,
      error: null
    },
    diffReport: null,
    diffSummary: null
  };

  if (legacySettlement.status === "fulfilled") {
    result.legacyExecution = legacySettlement.value;
    result.legacyResponse = buildLegacyHttpResponse(legacySettlement.value, requestId);
  } else {
    result.legacyError = normalizeError(legacySettlement.reason);
  }

  if (shadowSettlement.status === "fulfilled") {
    result.shadow = {
      ok: true,
      error: null,
      ...shadowSettlement.value
    };
  } else {
    result.shadow = {
      ok: false,
      shadowRequestId: null,
      shadowTraceId: null,
      state: null,
      response: null,
      summary: null,
      error: normalizeError(shadowSettlement.reason)
    };
  }

  if (result.legacyResponse && result.shadow.response) {
    const diff = buildShadowDiffReport({
      scene,
      legacyResponse: result.legacyResponse,
      shadowResponse: result.shadow.response
    });

    result.diffReport = diff.report;
    result.diffSummary = diff.summary;
  }

  return result;
}

module.exports = {
  buildLegacyHttpResponse,
  buildShadowCompatRoutePlan,
  buildShadowDiffReport,
  buildHttpResponseFromState,
  executeShadowCompatWorkflow,
  runLegacyAndShadowCompat,
  summarizeShadowState
};
