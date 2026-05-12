const { buildTraceId } = require("../../utils/request-id");
const { buildTraceContext } = require("../trace/context");

const WORKFLOW_STATE_VERSION = "v1";
const WORKFLOW_STATE_SLICES = Object.freeze([
  "request",
  "runtime_context",
  "scene_contract",
  "artifacts",
  "result",
  "error"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function normalizePermissions(permissions) {
  if (permissions === undefined || permissions === null) {
    return [];
  }

  if (typeof permissions === "string") {
    return uniqueStrings([permissions]);
  }

  if (Array.isArray(permissions)) {
    return uniqueStrings(permissions);
  }

  if (isObject(permissions)) {
    const flattened = [];
    for (const [key, enabled] of Object.entries(permissions)) {
      if (enabled) {
        flattened.push(key);
      }
    }
    return uniqueStrings(flattened);
  }

  return [];
}

function pickRouteSnapshot(routePlan = null) {
  if (!isObject(routePlan)) {
    return {
	      requested_mode: null,
	      effective_mode: null,
	      execution_mode: null,
	      allowed_modes: null,
	      reason: null
    };
  }

  return {
	    requested_mode: routePlan.requestedMode || null,
	    effective_mode: routePlan.effectiveMode || null,
	    execution_mode: routePlan.executionMode || null,
	    allowed_modes: Array.isArray(routePlan.allowedModes)
      ? cloneJsonValue(routePlan.allowedModes)
      : null,
    reason: routePlan.reason || null
  };
}

function buildRuntimeContext({
  requestId,
  traceId = null,
  scene = null,
  routePlan = null,
  requestSource = "api",
  tenantId = null,
  userId = null,
  permissions = null,
  startedAt = null
} = {}) {
  const resolvedTraceId = traceId || buildTraceId();
  const normalizedPermissions = normalizePermissions(permissions);
  const route = pickRouteSnapshot(routePlan);

  return {
    state_version: WORKFLOW_STATE_VERSION,
    request_id: requestId || null,
    trace_id: resolvedTraceId,
    request_source: requestSource,
    tenant_id: tenantId || null,
    user_id: userId || null,
    permissions: normalizedPermissions,
    started_at: startedAt || new Date().toISOString(),
    route,
    trace: buildTraceContext({
      requestId,
      traceId: resolvedTraceId,
      scene,
      routePlan,
      requestSource,
      tenantId,
      userId,
      permissionScope: normalizedPermissions
    })
  };
}

function buildSceneContract({
  scene = null,
  sceneConfig = null,
  routePlan = null,
  workflowBinding = null
} = {}) {
  const safeSceneConfig = isObject(sceneConfig) ? sceneConfig : {};

  return {
    scene: safeSceneConfig.scene || scene || null,
    title: safeSceneConfig.title || null,
    description: safeSceneConfig.description || null,
    enabled: safeSceneConfig.enabled !== false,
    routing: {
      configured_mode: safeSceneConfig?.routing?.mode || null,
      allowed_modes: Array.isArray(safeSceneConfig?.routing?.allowedModes)
        ? cloneJsonValue(safeSceneConfig.routing.allowedModes)
        : null,
	      requested_mode: routePlan?.requestedMode || null,
	      effective_mode: routePlan?.effectiveMode || null,
	      execution_mode: routePlan?.executionMode || null
	    },
    agent: cloneJsonValue(safeSceneConfig.agent || null),
    runtime: cloneJsonValue(safeSceneConfig.runtime || null),
    model: cloneJsonValue(safeSceneConfig.model || null),
    request_contract: cloneJsonValue(safeSceneConfig.request || null),
    skill: cloneJsonValue(safeSceneConfig.skill || null),
    tools: cloneJsonValue(safeSceneConfig.tools || []),
    references: cloneJsonValue(safeSceneConfig.references || []),
    workflow_binding: cloneJsonValue(workflowBinding || null)
  };
}

function buildRequestSlice({
  scene = null,
  bizParams = null,
  rawRequest = null,
  sceneConfig = null,
  receivedAt = null
} = {}) {
  return {
    scene,
    kind: sceneConfig?.runtime?.requestKind || null,
    version: sceneConfig?.runtime?.messageVersion || null,
    biz_params: cloneJsonValue(isObject(bizParams) ? bizParams : {}),
    raw_request: cloneJsonValue(rawRequest || null),
    received_at: receivedAt || new Date().toISOString()
  };
}

function createInitialWorkflowState({
  requestId,
  traceId = null,
  scene,
  sceneConfig = null,
  bizParams = null,
  rawRequest = null,
  routePlan = null,
  workflowBinding = null,
  requestSource = "api",
  tenantId = null,
  userId = null,
  permissions = null,
  startedAt = null,
  receivedAt = null
} = {}) {
  return {
    request: buildRequestSlice({
      scene,
      bizParams,
      rawRequest,
      sceneConfig,
      receivedAt
    }),
    runtime_context: buildRuntimeContext({
      requestId,
      traceId,
      scene,
      routePlan,
      requestSource,
      tenantId,
      userId,
      permissions,
      startedAt
    }),
    scene_contract: buildSceneContract({
      scene,
      sceneConfig,
      routePlan,
      workflowBinding
    }),
	    artifacts: {
	      node_runs: [],
	      outputs: {}
	    },
    result: null,
    error: null
  };
}

function deepMerge(baseValue, patchValue) {
  if (Array.isArray(patchValue)) {
    return cloneJsonValue(patchValue);
  }

  if (!isObject(patchValue)) {
    return patchValue;
  }

  const safeBaseValue = isObject(baseValue) ? baseValue : {};
  const merged = { ...safeBaseValue };

  for (const [key, value] of Object.entries(patchValue)) {
    merged[key] = deepMerge(safeBaseValue[key], value);
  }

  return merged;
}

function mergeWorkflowState(currentState, patch = {}) {
  const safeState = cloneJsonValue(currentState || {});
  const safePatch = isObject(patch) ? patch : {};
  const unknownSlices = Object.keys(safePatch).filter((key) => !WORKFLOW_STATE_SLICES.includes(key));

  if (unknownSlices.length > 0) {
    throw new Error(`Unknown workflow state slices: ${unknownSlices.join(", ")}`);
  }

  const nextState = { ...safeState };
  for (const sliceName of Object.keys(safePatch)) {
    nextState[sliceName] = deepMerge(safeState[sliceName], safePatch[sliceName]);
  }

  return nextState;
}

function recordNodeRun(currentState, {
  nodeId,
  status = "success",
  startedAt = null,
  finishedAt = null,
  durationMs = null,
  inputSummary = null,
  outputSummary = null,
  error = null
} = {}) {
  const safeState = cloneJsonValue(currentState || {});
  const existingArtifacts = isObject(safeState.artifacts) ? safeState.artifacts : {};
  const existingRuns = Array.isArray(existingArtifacts.node_runs)
    ? existingArtifacts.node_runs
    : [];

  const nodeRun = {
    node_id: nodeId || null,
    status,
    started_at: startedAt || null,
    finished_at: finishedAt || null,
    duration_ms: durationMs,
    input_summary: cloneJsonValue(inputSummary || null),
    output_summary: cloneJsonValue(outputSummary || null),
    error: cloneJsonValue(error || null)
  };

  return mergeWorkflowState(safeState, {
    artifacts: {
      node_runs: existingRuns.concat(nodeRun)
    }
  });
}

module.exports = {
  WORKFLOW_STATE_VERSION,
  WORKFLOW_STATE_SLICES,
  buildRequestSlice,
  buildRuntimeContext,
  buildSceneContract,
  createInitialWorkflowState,
  mergeWorkflowState,
  normalizePermissions,
  recordNodeRun
};
