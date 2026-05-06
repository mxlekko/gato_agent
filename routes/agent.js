const { getSceneConfig, getSupportedScenes } = require("../services/scene-config");
const { normalizeOpportunityId, validateSceneBizParams } = require("../services/request-validation");
const { runLegacySceneExecution } = require("../services/runtime");
const { runSceneThroughGateway } = require("../platform/gateway");
const {
  buildLangGraphFallbackSuppressedAudit,
  resolveLangGraphFallbackDecision
} = require("../platform/runtime/fallback");
const { runCompiledSceneWorkflow } = require("../platform/runtime/graphs");
const { createInitialWorkflowState } = require("../platform/runtime/state");
const { buildHttpResponseFromState } = require("../platform/runtime/shadow");
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

  const supportedScenes = getSupportedScenes();
  if (!supportedScenes.includes(body.scene)) {
    throw createAppError("INVALID_REQUEST", `scene must be one of: ${supportedScenes.join(", ")}.`);
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

function buildSuppressedFallbackTraceContext(traceContext, fallbackSuppressedAudit) {
  return {
    ...traceContext,
    legacyFallbackEnabled: false,
    fallbackSuppressed: true,
    routeReason: "langgraph_auto_fallback_disabled",
    ...fallbackSuppressedAudit
  };
}

function logSuppressedFallback(traceContext, fallbackSuppressedAudit) {
  info("agent.langgraph.fallback.suppressed", {
    ...buildSuppressedFallbackTraceContext(traceContext, fallbackSuppressedAudit)
  });
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
  executeLangGraph = runCompiledSceneWorkflow
} = {}) {
  const startedAt = Date.now();
  const langGraphRoutePlan = routePlan
    ? {
        ...routePlan,
        legacyFallbackEnabled: false
      }
    : routePlan;
  const langGraphTraceContext = {
    ...traceContext,
    legacyFallbackEnabled: false
  };

  info("agent.run.start", {
    ...langGraphTraceContext,
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
    routePlan: langGraphRoutePlan,
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
      error: caughtError,
      legacyFallbackEnabled: false
    });

    const fallbackSuppressedAudit = buildLangGraphFallbackSuppressedAudit({
      requestId,
      traceId,
      scene,
      routePlan: langGraphRoutePlan,
      fallbackDecision
    });
    logSuppressedFallback(langGraphTraceContext, fallbackSuppressedAudit);
    const normalized = fallbackDecision.error || normalizeError(caughtError);
    normalized.traceContext = buildSuppressedFallbackTraceContext(langGraphTraceContext, fallbackSuppressedAudit);
    throw normalized;
  }

  const fallbackDecision = resolveLangGraphFallbackDecision({
    finalState,
    legacyFallbackEnabled: false
  });

  const fallbackSuppressedAudit = fallbackDecision.fallbackSuppressed
    ? buildLangGraphFallbackSuppressedAudit({
        requestId,
        traceId,
        scene,
        routePlan: langGraphRoutePlan,
        fallbackDecision
      })
    : null;
  const completionTraceContext = fallbackSuppressedAudit
    ? buildSuppressedFallbackTraceContext(langGraphTraceContext, fallbackSuppressedAudit)
    : langGraphTraceContext;

  if (fallbackSuppressedAudit) {
    logSuppressedFallback(langGraphTraceContext, fallbackSuppressedAudit);
  }

  const response = buildHttpResponseFromState(finalState);

  if (finalState?.result?.success === true) {
    info("agent.run.success", {
      ...completionTraceContext,
      durationMs: Date.now() - startedAt,
      sceneExecutionType: "langgraph-stategraph",
      responseEnvelope: response.payload
    });
  } else {
    info("agent.run.completed", {
      ...completionTraceContext,
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
