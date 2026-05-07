const { loadPlatformResources, resolvePlatformBaseDir } = require("../compiler/validate");
const { createAppError, normalizeError } = require("../../utils/errors");
const { mergeWorkflowState, recordNodeRun } = require("../runtime/state");
const { resolveHttpEndpoint } = require("./tool-runtime");

const NODE_ID = "fetch-context";
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStateError(error) {
  return {
    code: error.code,
    message: error.message,
    httpStatus: error.httpStatus,
    stage: error.stage,
    retryable: error.retryable,
    details: error.details || null
  };
}

function summarizeInput(state) {
  return {
    scene: state?.request?.scene || null,
    requestId: state?.runtime_context?.request_id || null,
    normalizedBizParamKeys: Object.keys(state?.request?.normalized?.biz_params || {}),
    hasWorkflowBinding: Boolean(state?.scene_contract?.workflow_binding)
  };
}

function loadRegistrySnapshot() {
  const resources = loadPlatformResources(resolvePlatformBaseDir());
  const toolsByRef = new Map();
  const queriesByRef = new Map();
  const skillsByScene = new Map();

  for (const record of resources.tools) {
    const ref = record?.document?.spec?.ref;
    if (ref) {
      toolsByRef.set(ref, record.document);
    }
  }

  for (const record of resources.queries) {
    const ref = record?.document?.spec?.ref;
    if (ref) {
      queriesByRef.set(ref, record.document);
    }
  }

  for (const record of resources.skills) {
    const scene = record?.document?.spec?.scene;
    if (scene && !skillsByScene.has(scene)) {
      skillsByScene.set(scene, record.document);
    }
  }

  return {
    toolsByRef,
    queriesByRef,
    skillsByScene
  };
}

function normalizePathExpression(pathExpression) {
  return String(pathExpression || "").trim();
}

function tokenizePath(pathExpression) {
  return normalizePathExpression(pathExpression)
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getValueBySegments(source, segments) {
  let current = source;
  for (const segment of segments) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function buildStatePathCandidates(pathExpression) {
  const normalized = normalizePathExpression(pathExpression);
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];

  if (normalized.startsWith("runtime.")) {
    candidates.push(`runtime_context.${normalized.slice("runtime.".length)}`);
  }

  if (normalized.startsWith("request.bizParams.")) {
    const suffix = normalized.slice("request.bizParams.".length);
    candidates.push(`request.normalized.biz_params.${suffix}`);
    candidates.push(`request.biz_params.${suffix}`);
  }

  if (normalized.startsWith("request.biz_params.")) {
    const suffix = normalized.slice("request.biz_params.".length);
    candidates.push(`request.normalized.biz_params.${suffix}`);
  }

  if (normalized.startsWith("request.normalized.bizParams.")) {
    const suffix = normalized.slice("request.normalized.bizParams.".length);
    candidates.push(`request.normalized.biz_params.${suffix}`);
  }

  if (normalized.startsWith("request.normalized.biz_params.")) {
    const suffix = normalized.slice("request.normalized.biz_params.".length);
    candidates.push(`request.biz_params.${suffix}`);
  }

  return Array.from(new Set(candidates));
}

function readStatePath(state, pathExpression) {
  const candidates = buildStatePathCandidates(pathExpression);
  for (const candidate of candidates) {
    const value = getValueBySegments(state, tokenizePath(candidate));
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function requireFetchContextState(state) {
  if (!isObject(state)) {
    throw createAppError("INVALID_REQUEST", "fetch-context requires workflow state.", {
      stage: "fetch-context"
    });
  }

  if (!state?.request?.scene) {
    throw createAppError("INVALID_REQUEST", "fetch-context requires state.request.scene.", {
      stage: "fetch-context"
    });
  }

  if (!state?.runtime_context?.request_id) {
    throw createAppError("INVALID_REQUEST", "fetch-context requires state.runtime_context.request_id.", {
      stage: "fetch-context"
    });
  }

  if (!isObject(state?.request?.normalized?.biz_params)) {
    throw createAppError("INVALID_REQUEST", "fetch-context requires state.request.normalized.biz_params.", {
      stage: "fetch-context"
    });
  }

  return state;
}

function resolveWorkflowBinding(state) {
  return isObject(state?.scene_contract?.workflow_binding)
    ? state.scene_contract.workflow_binding
    : {};
}

function resolveSkillSpec(state, registrySnapshot, explicitSkillSpec = null) {
  if (isObject(explicitSkillSpec)) {
    return explicitSkillSpec;
  }

  const workflowBinding = resolveWorkflowBinding(state);
  if (isObject(workflowBinding.skillSpec)) {
    return workflowBinding.skillSpec;
  }

  if (isObject(workflowBinding.skill_spec)) {
    return workflowBinding.skill_spec;
  }

  const scene = state?.request?.scene || null;
  const skillDocument = scene ? registrySnapshot.skillsByScene.get(scene) : null;
  if (isObject(skillDocument?.spec)) {
    return skillDocument.spec;
  }

  throw createAppError("INVALID_REQUEST", `No BusinessSkill config found for scene ${scene || "unknown"}.`, {
    stage: "fetch-context"
  });
}

function resolveFetchPlan(skillSpec, fetchPlan = null) {
  const safePlan = isObject(fetchPlan) ? fetchPlan : {};
  const toolBinding = isObject(skillSpec?.toolBindings?.context_fetcher)
    ? skillSpec.toolBindings.context_fetcher
    : {};
  const dataBindings = isObject(skillSpec?.dataBindings)
    ? skillSpec.dataBindings
    : {};

  return {
    toolRef: safePlan.toolRef || toolBinding.toolRef || null,
    queryProfileRef: safePlan.queryProfileRef || dataBindings.queryProfileRef || null,
    inputMapping: isObject(safePlan.inputMapping)
      ? safePlan.inputMapping
      : (isObject(dataBindings.inputMapping) ? dataBindings.inputMapping : {})
  };
}

function resolveToolConfig(registrySnapshot, fetchPlan) {
  const queryDocument = fetchPlan.queryProfileRef
    ? registrySnapshot.queriesByRef.get(fetchPlan.queryProfileRef)
    : null;
  const toolRef = fetchPlan.toolRef || queryDocument?.spec?.toolRef || null;
  const toolDocument = toolRef
    ? registrySnapshot.toolsByRef.get(toolRef)
    : null;

  if (!queryDocument?.spec) {
    throw createAppError("INVALID_REQUEST", `Unknown queryProfileRef ${fetchPlan.queryProfileRef || "missing"}.`, {
      stage: "fetch-context"
    });
  }

  if (!toolDocument?.spec) {
    throw createAppError("INVALID_REQUEST", `Unknown toolRef ${toolRef || "missing"}.`, {
      stage: "fetch-context"
    });
  }

  if (queryDocument.spec.toolRef !== toolRef) {
    throw createAppError(
      "INVALID_REQUEST",
      `QueryProfile toolRef ${queryDocument.spec.toolRef || "missing"} does not match fetch toolRef ${toolRef}.`,
      {
        stage: "fetch-context"
      }
    );
  }

  if (toolDocument.spec.driver?.type !== "http") {
    throw createAppError("INVALID_REQUEST", `fetch-context only supports HTTP tools, received ${toolDocument.spec.driver?.type || "unknown"}.`, {
      stage: "fetch-context"
    });
  }

  return {
    queryDocument,
    toolDocument
  };
}

function buildRequestPayload(state, toolDocument, queryDocument, fetchPlan = {}) {
  const toolInputSources = isObject(toolDocument?.spec?.requestContract?.inputSources)
    ? toolDocument.spec.requestContract.inputSources
    : {};
  const queryInputFields = isObject(queryDocument?.spec?.inputContract?.fields)
    ? queryDocument.spec.inputContract.fields
    : {};
  const inputMapping = isObject(fetchPlan?.inputMapping) ? fetchPlan.inputMapping : {};
  const payload = {};

  const fieldNames = new Set([
    ...Object.keys(toolInputSources),
    ...Object.keys(queryInputFields),
    ...Object.keys(inputMapping)
  ]);

  for (const fieldName of fieldNames) {
    const pathExpression = inputMapping[fieldName]
      || queryInputFields[fieldName]?.sourcePath
      || toolInputSources[fieldName];
    payload[fieldName] = readStatePath(state, pathExpression);
  }

  if (
    (payload.queryProfileRef === undefined || payload.queryProfileRef === null || payload.queryProfileRef === "")
    && (toolDocument?.spec?.requestContract?.requiredFields || []).includes("queryProfileRef")
  ) {
    payload.queryProfileRef = fetchPlan?.queryProfileRef || null;
  }

  const resolvedMissingFields = (toolDocument?.spec?.requestContract?.requiredFields || [])
    .filter((fieldName) => payload[fieldName] === undefined || payload[fieldName] === null || payload[fieldName] === "");

  if (resolvedMissingFields.length > 0) {
    throw createAppError("INVALID_REQUEST", `fetch-context is missing required tool inputs: ${resolvedMissingFields.join(", ")}.`, {
      stage: "fetch-context",
      details: {
        missingFields: resolvedMissingFields
      }
    });
  }

  return payload;
}

async function invokeHttpTool({
  endpoint,
  requestPayload,
  timeoutMs,
  fetchImpl = fetch
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal
    });

    const rawText = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(rawText);
    } catch (error) {
      throw createAppError("CONTEXT_SERVICE_INVALID_RESPONSE", "Context helper returned invalid JSON.", {
        stage: "fetch-context",
        details: {
          endpoint,
          cause: error?.message || "json_parse_failed"
        }
      });
    }

    return {
      httpStatus: response.status,
      payload
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createAppError("RUNTIME_TIMEOUT", "Context helper request timed out.", {
        stage: "fetch-context",
        details: {
          endpoint,
          timeoutMs
        }
      });
    }

    if (error?.code) {
      throw error;
    }

    throw createAppError("CONTEXT_SERVICE_UNAVAILABLE", "Context helper request failed.", {
      stage: "fetch-context",
      details: {
        endpoint,
        cause: error?.message || "network_failed"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeOutput({
  queryProfileRef,
  toolRef,
  resultPath,
  resultValue,
  rawData
}) {
  const resultKind = Array.isArray(resultValue)
    ? "array"
    : isObject(resultValue)
      ? "object"
      : typeof resultValue;
  return {
    queryProfileRef,
    toolRef,
    resultPath,
    resultKind,
    rawFieldCount: isObject(rawData?.rawRow) ? Object.keys(rawData.rawRow).length : 0,
    rowCount: Array.isArray(rawData?.rows) ? rawData.rows.length : null,
    valueCount: Array.isArray(rawData?.values) ? rawData.values.length : null
  };
}

async function runFetchContextNode({
  state,
  skillSpec = null,
  fetchPlan = null,
  invokeTool = null
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);

  try {
    requireFetchContextState(state);
    const registrySnapshot = loadRegistrySnapshot();
    const resolvedSkillSpec = resolveSkillSpec(state, registrySnapshot, skillSpec);
    const resolvedFetchPlan = resolveFetchPlan(resolvedSkillSpec, fetchPlan);
    const { queryDocument, toolDocument } = resolveToolConfig(registrySnapshot, resolvedFetchPlan);
    const requestPayload = buildRequestPayload(state, toolDocument, queryDocument, resolvedFetchPlan);
    const endpoint = resolveHttpEndpoint(toolDocument);
    const timeoutMs = Number(toolDocument.spec?.limits?.timeoutMsDefault || 30000);
    const execution = invokeTool
      ? await invokeTool({
          toolDocument,
          queryDocument,
          requestPayload,
          timeoutMs
        })
      : await invokeHttpTool({
          endpoint,
          requestPayload,
          timeoutMs
        });

    const toolPayload = execution?.payload;
    if (!isObject(toolPayload)) {
      throw createAppError("CONTEXT_SERVICE_INVALID_RESPONSE", "Context helper response payload is missing.", {
        stage: "fetch-context",
        details: {
          endpoint
        }
      });
    }

    if (toolPayload.success === false) {
      const toolError = normalizeError(toolPayload.error);
      let nextState = recordNodeRun(state, {
        nodeId: NODE_ID,
        status: "business_error",
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        inputSummary,
        outputSummary: {
          queryProfileRef: resolvedFetchPlan.queryProfileRef,
          toolRef: toolDocument.spec.ref,
          errorCode: toolError.code
        }
      });

      nextState = mergeWorkflowState(nextState, {
        artifacts: {
          outputs: {
            fetch_context: {
              fetched: false,
              query_profile_ref: resolvedFetchPlan.queryProfileRef,
              tool_ref: toolDocument.spec.ref,
              error_code: toolError.code
            }
          }
        },
        result: null,
        error: toStateError(toolError)
      });

      return nextState;
    }

    const rawData = isObject(toolPayload.data) ? toolPayload.data : null;
    const resultPath = String(queryDocument?.spec?.outputPolicy?.resultPath || "data.rawRow").trim() || "data.rawRow";
    const resultValue = getValueBySegments(toolPayload, tokenizePath(resultPath));
    if (resultValue === undefined) {
      throw createAppError("CONTEXT_SERVICE_INVALID_RESPONSE", `Context helper response is missing ${resultPath}.`, {
        stage: "fetch-context",
        details: {
          endpoint,
          responseShape: Object.keys(rawData || {}),
          resultPath
        }
      });
    }

    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "success",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      outputSummary: summarizeOutput({
        queryProfileRef: resolvedFetchPlan.queryProfileRef,
        toolRef: toolDocument.spec.ref,
        resultPath,
        resultValue,
        rawData
      })
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        context: {
          tool_ref: toolDocument.spec.ref,
          query_profile_ref: resolvedFetchPlan.queryProfileRef,
          request_payload: requestPayload,
          raw: rawData
        },
        outputs: {
          fetch_context: {
            fetched: true,
            query_profile_ref: resolvedFetchPlan.queryProfileRef,
            tool_ref: toolDocument.spec.ref,
            result_path: resultPath,
            result_kind: Array.isArray(resultValue)
              ? "array"
              : isObject(resultValue)
                ? "object"
                : typeof resultValue,
            raw_field_count: isObject(rawData?.rawRow) ? Object.keys(rawData.rawRow).length : 0
          }
        }
      },
      error: null
    });

    return nextState;
  } catch (error) {
    const normalized = normalizeError(error);
    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "error",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      error: {
        code: normalized.code,
        message: normalized.message,
        httpStatus: normalized.httpStatus,
        stage: normalized.stage
      }
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        outputs: {
          fetch_context: {
            fetched: false,
            error_code: normalized.code
          }
        }
      },
      result: null,
      error: toStateError(normalized)
    });

    return nextState;
  }
}

module.exports = {
  NODE_ID,
  runFetchContextNode
};
