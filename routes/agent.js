const { getSceneConfig, getSupportedScenes } = require("../services/scene-config");
const { normalizeOpportunityId, validateSceneBizParams } = require("../services/request-validation");
const { runSceneThroughGateway } = require("../platform/gateway");
const { runCompiledSceneWorkflow } = require("../platform/runtime/graphs");
const { createInitialWorkflowState } = require("../platform/runtime/state");
const { buildHttpResponseFromState } = require("../platform/runtime/http-response");
const { buildErrorResponse, createAppError, normalizeError } = require("../utils/errors");
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

function buildHttpErrorResponse(appError, requestId) {
  return buildErrorResponse(appError, requestId);
}

function pickDraftExecution(finalState) {
  const artifacts = finalState?.artifacts || {};
  const draft = artifacts.draft || {};
  const draftOutput = artifacts.outputs?.draft_output || {};
  const errorDetails = finalState?.error?.details || {};
  const nodeRuns = Array.isArray(artifacts.node_runs) ? artifacts.node_runs : [];
  const draftNodeRun = nodeRuns
    .slice()
    .reverse()
    .find((run) => run?.node_id === "draft-output");
  const outputSummary = draftNodeRun?.output_summary || {};
  const modeFromError = finalState?.error?.stage === "project-llm" ? "project-llm" : null;
  const draftExecution = {
    mode: draft.mode || draftOutput.mode || outputSummary.mode || modeFromError,
    provider: draft.provider || draftOutput.provider || outputSummary.provider || errorDetails.provider || null,
    model: draft.model || draftOutput.model || outputSummary.model || errorDetails.model || null,
    apiKeySource: draft.api_key_source || draftOutput.api_key_source || outputSummary.apiKeySource || null
  };

  return Object.values(draftExecution).some(Boolean) ? draftExecution : null;
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
  const langGraphRoutePlan = routePlan;
  const langGraphTraceContext = traceContext;

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
    const normalized = normalizeError(caughtError);
    normalized.traceContext = langGraphTraceContext;
    throw normalized;
  }

  const response = buildHttpResponseFromState(finalState);
  const draftExecution = pickDraftExecution(finalState);

  if (finalState?.result?.success === true) {
    info("agent.run.success", {
      ...langGraphTraceContext,
      durationMs: Date.now() - startedAt,
      sceneExecutionType: "langgraph-stategraph",
      draftExecution,
      responseEnvelope: response.payload
    });
  } else {
    info("agent.run.completed", {
      ...langGraphTraceContext,
      sceneExecutionType: "langgraph-stategraph",
      success: false,
      code: finalState?.error?.code || null,
      httpStatus: finalState?.error?.httpStatus || response.statusCode,
      stage: finalState?.error?.stage || null,
      draftExecution,
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
  normalizeOpportunityId,
  runLangGraphAgentRuntimeRoute,
  runAgentRoute,
  validateAgentRunRequest
};
