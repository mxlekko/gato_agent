const { buildSessionKey, SUPPORTED_SCENES } = require("../services/runtime-message");
const { getSceneConfig } = require("../services/scene-config");
const { normalizeOpportunityId, validateSceneBizParams } = require("../services/request-validation");
const { runLegacySceneExecution } = require("../services/runtime");
const { buildFallbackRoutePlan, runSceneThroughGateway } = require("../platform/gateway");
const {
  buildLangGraphFallbackAudit,
  resolveLangGraphFallbackDecision
} = require("../platform/runtime/fallback");
const { runCompiledSceneWorkflow } = require("../platform/runtime/graphs");
const { createInitialWorkflowState } = require("../platform/runtime/state");
const { buildHttpResponseFromState, runLegacyAndShadowCompat } = require("../platform/runtime/shadow");
const { buildErrorResponse, buildSuccessResponse, createAppError, normalizeError } = require("../utils/errors");
const { info, error } = require("../utils/logger");
const { buildRequestId, buildTraceId } = require("../utils/request-id");
const { buildTraceContext } = require("../platform/trace/context");

function extractRuntimeIdentity(body) {
  if (body?.runtimeContext === undefined || body?.runtimeContext === null) {
    return {
      tenantId: null,
      userId: null
    };
  }

  if (!body.runtimeContext || typeof body.runtimeContext !== "object" || Array.isArray(body.runtimeContext)) {
    throw createAppError("INVALID_REQUEST", "runtimeContext must be an object when provided.");
  }

  const tenantId = body.runtimeContext.tenantId;
  const userId = body.runtimeContext.userId;

  if (tenantId !== undefined && tenantId !== null && typeof tenantId !== "string") {
    throw createAppError("INVALID_REQUEST", "runtimeContext.tenantId must be a string when provided.");
  }

  if (userId !== undefined && userId !== null && typeof userId !== "string") {
    throw createAppError("INVALID_REQUEST", "runtimeContext.userId must be a string when provided.");
  }

  return {
    tenantId: typeof tenantId === "string" ? tenantId.trim() || null : null,
    userId: typeof userId === "string" ? userId.trim() || null : null
  };
}

function validateAgentRunRequest(body) {
  if (!body || typeof body !== "object") {
    throw createAppError("INVALID_REQUEST", "Request body must be a JSON object.");
  }

  if (!body.scene || typeof body.scene !== "string") {
    throw createAppError("INVALID_REQUEST", "scene is required.");
  }

  if (!SUPPORTED_SCENES.includes(body.scene)) {
    throw createAppError("INVALID_REQUEST", `scene must be one of: ${SUPPORTED_SCENES.join(", ")}.`);
  }

  if (!body.bizParams || typeof body.bizParams !== "object") {
    throw createAppError("INVALID_REQUEST", "bizParams is required.");
  }

  const sceneConfig = getSceneConfig(body.scene);
  const normalizedBizParams = validateSceneBizParams(sceneConfig, body.bizParams);
  const { tenantId, userId } = extractRuntimeIdentity(body);

  return {
    scene: body.scene,
    sceneConfig,
    bizParams: normalizedBizParams,
    tenantId,
    userId
  };
}

function buildHttpSuccessResponse(payload, requestId) {
  return buildSuccessResponse(payload, requestId);
}

function buildHttpErrorResponse(appError, requestId) {
  return buildErrorResponse(appError, requestId);
}

function buildSceneExecutionHttpResponse(execution, requestId) {
  const businessResult = execution?.businessResult;

  if (businessResult?.success === false) {
    return {
      statusCode: businessResult.error.httpStatus,
      payload: buildHttpErrorResponse(businessResult.error, businessResult.requestId || requestId)
    };
  }

  return {
    statusCode: 200,
    payload: buildHttpSuccessResponse(businessResult?.payload, businessResult?.requestId || requestId)
  };
}

function logShadowExecutionOutcome({ traceContext, legacySessionKey = null, shadowBundle }) {
  if (!shadowBundle?.shadow) {
    return;
  }

  if (!shadowBundle.shadow.ok) {
    error("agent.shadow.failed", {
      ...traceContext,
      legacySessionKey,
      shadowRequestId: shadowBundle.shadow.shadowRequestId,
      shadowTraceId: shadowBundle.shadow.shadowTraceId,
      code: shadowBundle.shadow.error?.code || null,
      httpStatus: shadowBundle.shadow.error?.httpStatus || null,
      stage: shadowBundle.shadow.error?.stage || null
    });
    return;
  }

  const shadowSessionKey = shadowBundle.shadow.summary?.compatArtifact?.session_key || null;
  info("agent.shadow.completed", {
    ...traceContext,
    legacySessionKey,
    shadowRequestId: shadowBundle.shadow.shadowRequestId,
    shadowTraceId: shadowBundle.shadow.shadowTraceId,
    shadowSessionKey,
    sessionSeparated: Boolean(legacySessionKey && shadowSessionKey && legacySessionKey !== shadowSessionKey),
    shadowNodeRunCount: shadowBundle.shadow.summary?.nodeRunCount || 0,
    shadowNodeStatuses: shadowBundle.shadow.summary?.nodeStatuses || [],
    shadowResultSuccess: shadowBundle.shadow.summary?.resultSuccess ?? null,
    shadowErrorCode: shadowBundle.shadow.summary?.errorCode || null,
    shadowDiffPassed: shadowBundle.diffSummary?.passed ?? null,
    shadowHttpStatusMatch: shadowBundle.diffSummary?.httpStatusMatch ?? null,
    shadowEnvelopeMatch: shadowBundle.diffSummary?.responseEnvelopeMatch ?? null,
    shadowConsistencyMatch: shadowBundle.diffSummary?.consistencyFieldsMatch ?? null,
    shadowStrictBodyMatch: shadowBundle.diffSummary?.strictBodyMatch ?? null,
    shadowDifferenceCount: shadowBundle.diffSummary?.differenceCount ?? null
  });
}

async function runLegacyDirectModelRoute({ requestId, scene, sceneConfig, bizParams, routePlan, traceContext }) {
  info("agent.run.start", {
    ...traceContext,
    platformManagedScene: routePlan?.platformManagedScene ?? null,
    legacyExecutionRole: routePlan?.legacyRole || null
  });

  const execution = await runLegacySceneExecution({
    requestId,
    sceneConfig,
    bizParams
  });
  const businessResult = execution.businessResult;
  const responsePayload = buildHttpSuccessResponse(
    businessResult.payload,
    businessResult.requestId || requestId
  );

  info("agent.run.success", {
    ...traceContext,
    durationMs: execution.durationMs,
    sceneExecutionType: execution.executionType,
    responseEnvelope: responsePayload
  });

  return {
    statusCode: 200,
    payload: responsePayload
  };
}

async function runLegacyAgentRuntimeRoute({ requestId, scene, sceneConfig, bizParams, traceContext }) {
  const sessionKey = buildSessionKey(sceneConfig, requestId);
  info("agent.run.start", {
    ...traceContext,
    sessionKey,
    sceneExecutionType: "agent-runtime",
    platformManagedScene: traceContext?.platformManagedScene ?? null,
    legacyExecutionRole: traceContext?.legacyRole || null
  });

  let execution;
  if (traceContext.shadowExecutionEnabled) {
    const shadowBundle = await runLegacyAndShadowCompat({
      requestId,
      traceId: traceContext.traceId,
      scene,
      sceneConfig,
      bizParams,
      routePlan: {
        requestedMode: traceContext.requestedMode,
        effectiveMode: traceContext.effectiveMode,
        executionMode: traceContext.executionMode,
        shadowExecutionEnabled: traceContext.shadowExecutionEnabled
      }
    });

    logShadowExecutionOutcome({
      traceContext,
      legacySessionKey: sessionKey,
      shadowBundle
    });

    if (shadowBundle.legacyError) {
      throw shadowBundle.legacyError;
    }

    execution = shadowBundle.legacyExecution;
  } else {
    execution = await runLegacySceneExecution({
      requestId,
      sceneConfig,
      bizParams
    });
  }

  const businessResult = execution.businessResult;

  if (businessResult.success === false) {
    const responsePayload = buildHttpErrorResponse(
      businessResult.error,
      businessResult.requestId || requestId
    );

    info("agent.run.completed", {
      ...traceContext,
      sessionKey,
      sceneExecutionType: execution.executionType,
      legacyExecutionRole: execution?.compatibilityBoundary?.role || traceContext?.legacyRole || null,
      success: false,
      code: businessResult.error.code,
      httpStatus: businessResult.error.httpStatus,
      stage: businessResult.error.stage,
      responseEnvelope: responsePayload
    });

    return {
      statusCode: businessResult.error.httpStatus,
      payload: responsePayload
    };
  }

  const responsePayload = buildHttpSuccessResponse(
    businessResult.payload,
    businessResult.requestId || requestId
  );

  info("agent.run.success", {
    ...traceContext,
    sessionKey,
    durationMs: execution.durationMs,
    sceneExecutionType: execution.executionType,
    legacyExecutionRole: execution?.compatibilityBoundary?.role || traceContext?.legacyRole || null,
    responseEnvelope: responsePayload
  });

  return {
    statusCode: 200,
    payload: responsePayload
  };
}

async function executeLegacyFallbackRoute({
  requestId,
  scene,
  sceneConfig,
  bizParams,
  traceContext,
  fallbackAudit,
  executeLegacyScene = runLegacySceneExecution
} = {}) {
  info("agent.langgraph.fallback.triggered", {
    ...traceContext,
    ...fallbackAudit
  });

  try {
    const execution = await executeLegacyScene({
      requestId,
      sceneConfig,
      bizParams
    });
    const response = buildSceneExecutionHttpResponse(execution, requestId);

    info("agent.langgraph.fallback.completed", {
      ...traceContext,
      ...fallbackAudit,
      fallbackLegacyExecutionType: execution?.executionType || null,
      fallbackLegacyHttpStatus: response.statusCode,
      fallbackLegacySuccess: response.statusCode < 400,
      fallbackLegacyDurationMs: execution?.durationMs || null,
      scene,
      responseEnvelope: response.payload
    });

    return response;
  } catch (caughtError) {
    const legacyError = normalizeError(caughtError);
    error("agent.langgraph.fallback.failed", {
      ...traceContext,
      ...fallbackAudit,
      fallbackLegacyErrorCode: legacyError.code,
      fallbackLegacyErrorStage: legacyError.stage,
      fallbackLegacyErrorHttpStatus: legacyError.httpStatus,
      scene
    });
    throw legacyError;
  }
}

async function runLangGraphAgentRuntimeRoute({
  requestId,
  traceId,
  scene,
  sceneConfig,
  bizParams,
  tenantId = null,
  userId = null,
  routePlan,
  traceContext
}, {
  executeLangGraph = runCompiledSceneWorkflow,
  executeLegacyScene = runLegacySceneExecution
} = {}) {
  const startedAt = Date.now();

  info("agent.run.start", {
    ...traceContext,
    sceneExecutionType: "langgraph-stategraph"
  });

  const initialState = createInitialWorkflowState({
    requestId,
    traceId,
    scene,
    sceneConfig,
    bizParams,
    rawRequest: {
      scene,
      bizParams,
      runtimeContext: {
        tenantId,
        userId
      }
    },
    routePlan,
    workflowBinding: {
      runtime_mode: "langgraph"
    },
    tenantId,
    userId,
    permissions: null
  });

  let finalState = null;

  try {
    finalState = await executeLangGraph({
      state: initialState
    });
  } catch (caughtError) {
    const fallbackDecision = resolveLangGraphFallbackDecision({
      error: caughtError
    });

    if (!fallbackDecision.shouldFallback) {
      throw caughtError;
    }

    const fallbackAudit = buildLangGraphFallbackAudit({
      requestId,
      traceId,
      scene,
      routePlan: buildFallbackRoutePlan(routePlan, fallbackDecision),
      fallbackDecision
    });

    return executeLegacyFallbackRoute({
      requestId,
      scene,
      sceneConfig,
      bizParams,
      traceContext: {
        ...traceContext,
        effectiveMode: "legacy",
        routeReason: "langgraph_auto_fallback"
      },
      fallbackAudit,
      executeLegacyScene
    });
  }

  const fallbackDecision = resolveLangGraphFallbackDecision({
    finalState
  });

  if (fallbackDecision.shouldFallback) {
    const fallbackAudit = buildLangGraphFallbackAudit({
      requestId,
      traceId,
      scene,
      routePlan: buildFallbackRoutePlan(routePlan, fallbackDecision),
      fallbackDecision
    });

    return executeLegacyFallbackRoute({
      requestId,
      scene,
      sceneConfig,
      bizParams,
      traceContext: {
        ...traceContext,
        effectiveMode: "legacy",
        routeReason: "langgraph_auto_fallback"
      },
      fallbackAudit,
      executeLegacyScene
    });
  }

  const response = buildHttpResponseFromState(finalState);

  if (finalState?.result?.success === true) {
    info("agent.run.success", {
      ...traceContext,
      durationMs: Date.now() - startedAt,
      sceneExecutionType: "langgraph-stategraph",
      responseEnvelope: response.payload
    });
  } else {
    info("agent.run.completed", {
      ...traceContext,
      sceneExecutionType: "langgraph-stategraph",
      success: false,
      code: finalState?.error?.code || null,
      httpStatus: finalState?.error?.httpStatus || response.statusCode,
      stage: finalState?.error?.stage || null,
      responseEnvelope: response.payload
    });
  }

  return response;
}

async function runAgentRoute(body) {
  const requestId = buildRequestId();
  const traceId = buildTraceId();
  let traceContext = buildTraceContext({
    requestId,
    traceId
  });

  try {
    const { scene, sceneConfig, bizParams, tenantId, userId } = validateAgentRunRequest(body);
    traceContext = buildTraceContext({
      requestId,
      traceId,
      scene,
      bizParams,
      tenantId,
      userId
    });

    return await runSceneThroughGateway({
      requestId,
      traceId,
      scene,
      sceneConfig,
      bizParams,
      tenantId,
      userId,
      handlers: {
        runLegacyDirectModel: runLegacyDirectModelRoute,
        runLegacyAgentRuntime: runLegacyAgentRuntimeRoute,
        runLangGraphAgentRuntime: runLangGraphAgentRuntimeRoute
      }
    });
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    if (caughtError?.traceContext && typeof caughtError.traceContext === "object") {
      traceContext = {
        ...traceContext,
        ...caughtError.traceContext
      };
    }

    const responsePayload = buildHttpErrorResponse(appError, requestId);

    error("agent.run.failed", {
      ...traceContext,
      code: appError.code,
      httpStatus: appError.httpStatus,
      stage: appError.stage,
      responseEnvelope: responsePayload
    });

    return {
      statusCode: appError.httpStatus,
      payload: responsePayload
    };
  }
}

module.exports = {
  buildHttpErrorResponse,
  buildHttpSuccessResponse,
  normalizeOpportunityId,
  runLangGraphAgentRuntimeRoute,
  runAgentRoute,
  validateAgentRunRequest
};
