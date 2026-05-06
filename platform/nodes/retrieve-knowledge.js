const { normalizeError, createAppError } = require("../../utils/errors");
const { mergeWorkflowState, recordNodeRun } = require("../runtime/state");
const {
  buildToolRequestPayload,
  isObject,
  loadRegistrySnapshot,
  resolveHttpEndpoint,
  resolveNodeOverride,
  resolveSkillSpec,
  resolveToolDocumentByRole
} = require("./tool-runtime");

const NODE_ID = "retrieve-knowledge";
const OVERRIDE_NODE_ID = "retrieve_knowledge_context";
const DEFAULT_TOOL_ROLE = "knowledge_retriever";

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

function stringifyValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(stringifyValue).filter(Boolean).join("；");
  }

  if (isObject(value)) {
    return Object.entries(value)
      .map(([key, entryValue]) => {
        const text = stringifyValue(entryValue);
        return text ? `${key}:${text}` : "";
      })
      .filter(Boolean)
      .join("；");
  }

  return String(value);
}

function buildKnowledgeQuery(state, nodeOverride = {}) {
  if (typeof nodeOverride.query === "string" && nodeOverride.query.trim()) {
    return nodeOverride.query.trim();
  }

  const rawText = state?.request?.normalized?.biz_params?.rawText
    || state?.request?.biz_params?.rawText
    || state?.request?.normalized?.biz_params?.customRequirement
    || state?.request?.biz_params?.customRequirement
    || "";
  const specialCustomOrderNo = state?.request?.normalized?.biz_params?.specialCustomOrderNo
    || state?.request?.biz_params?.specialCustomOrderNo
    || "";
  const profile = isObject(state?.artifacts?.facts?.profile)
    ? state.artifacts.facts.profile
    : {};
  const highlights = Array.isArray(profile.highlights) ? profile.highlights : [];
  const basisFields = Array.isArray(state?.artifacts?.facts?.basis_fields)
    ? state.artifacts.facts.basis_fields
    : [];
  const basisTexts = basisFields
    .map((fieldName) => {
      const label = profile.field_labels?.[fieldName] || fieldName;
      const value = profile.field_values?.[fieldName] || profile[fieldName] || "";
      return value ? `${label}：${value}` : "";
    })
    .filter(Boolean);

  return [
    rawText,
    specialCustomOrderNo ? `特殊定制单号：${specialCustomOrderNo}` : "",
    profile.opportunityName ? `商机：${profile.opportunityName}` : "",
    profile.customerName ? `客户：${profile.customerName}` : "",
    ...basisTexts,
    ...highlights.slice(0, 4)
  ].map(stringifyValue).filter(Boolean).join("；").slice(0, 1200);
}

function summarizeInput(state) {
  return {
    scene: state?.request?.scene || null,
    requestId: state?.runtime_context?.request_id || null,
    hasFactsProfile: isObject(state?.artifacts?.facts?.profile)
  };
}

function summarizeOutput(matches, toolRef, query) {
  return {
    toolRef,
    queryLength: String(query || "").length,
    matchCount: matches.length,
    topScore: typeof matches[0]?.score === "number" ? matches[0].score : null
  };
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
      throw createAppError("RUNTIME_INVALID_RESPONSE", "RAG tool returned invalid JSON.", {
        stage: "retrieve-knowledge",
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
      throw createAppError("RUNTIME_TIMEOUT", "RAG tool request timed out.", {
        stage: "retrieve-knowledge",
        details: {
          endpoint,
          timeoutMs
        }
      });
    }

    if (error?.code) {
      throw error;
    }

    throw createAppError("RAG_INVOCATION_FAILED", "RAG tool request failed.", {
      stage: "retrieve-knowledge",
      details: {
        endpoint,
        cause: error?.message || "network_failed"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function runRetrieveKnowledgeNode({
  state,
  skillSpec = null,
  invokeTool = null
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);
  let failOnError = false;

  try {
    const registrySnapshot = loadRegistrySnapshot();
    const resolvedSkillSpec = resolveSkillSpec(state, registrySnapshot, skillSpec);
    const nodeOverride = resolveNodeOverride({
      state,
      skillSpec: resolvedSkillSpec,
      nodeId: OVERRIDE_NODE_ID,
      fallbackNodeId: NODE_ID
    });

    if (nodeOverride.enabled === false) {
      return recordNodeRun(state, {
        nodeId: NODE_ID,
        status: "skipped",
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        inputSummary,
        outputSummary: {
          skipped: true
        }
      });
    }

    failOnError = nodeOverride.failOnError === true;
    const toolRole = nodeOverride.toolRole || DEFAULT_TOOL_ROLE;
    const { toolDocument, toolRef } = resolveToolDocumentByRole({
      registrySnapshot,
      skillSpec: resolvedSkillSpec,
      toolRole
    });
    const query = buildKnowledgeQuery(state, nodeOverride);
    const topK = Number(nodeOverride.topK || nodeOverride.top_k || 5);
    const preparedState = mergeWorkflowState(state, {
      artifacts: {
        knowledge: {
          query,
          top_k: Number.isFinite(topK) ? Math.max(1, Math.min(Math.floor(topK), 10)) : 5,
          doc_id: nodeOverride.docId || nodeOverride.doc_id || null
        }
      }
    });
    const requestPayload = buildToolRequestPayload(preparedState, toolDocument);
    const timeoutMs = Number(nodeOverride.timeoutMs || toolDocument?.spec?.limits?.timeoutMsDefault || 30000);
    const execution = invokeTool
      ? await invokeTool({
          toolDocument,
          requestPayload,
          timeoutMs
      })
      : await invokeHttpTool({
          endpoint: resolveHttpEndpoint(toolDocument),
          requestPayload,
          timeoutMs
        });
    const toolPayload = execution?.payload;

    if (!isObject(toolPayload)) {
      throw createAppError("RUNTIME_INVALID_RESPONSE", "RAG tool response payload is missing.", {
        stage: "retrieve-knowledge",
        details: {
          toolRef
        }
      });
    }

    if (toolPayload.success === false) {
      const toolError = normalizeError(toolPayload.error);
      throw createAppError(toolError.code || "RAG_TOOL_ERROR", toolError.message || "RAG tool returned an error.", {
        stage: "retrieve-knowledge",
        details: {
          toolRef,
          toolError
        }
      });
    }

    const matches = Array.isArray(toolPayload?.data?.matches) ? toolPayload.data.matches : [];
    let nextState = recordNodeRun(preparedState, {
      nodeId: NODE_ID,
      status: "success",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      outputSummary: summarizeOutput(matches, toolRef, query)
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        knowledge: {
          query,
          matches,
          tool_ref: toolRef,
          match_count: matches.length
        },
        outputs: {
          retrieve_knowledge_context: {
            retrieved: true,
            tool_ref: toolRef,
            match_count: matches.length
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
      status: failOnError ? "error" : "business_error",
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
        knowledge: {
          matches: [],
          match_count: 0,
          error_code: normalized.code
        },
        outputs: {
          retrieve_knowledge_context: {
            retrieved: false,
            error_code: normalized.code
          }
        }
      },
      ...(failOnError
        ? {
            result: null,
            error: toStateError(normalized)
          }
        : {
            error: null
          })
    });

    return nextState;
  }
}

module.exports = {
  NODE_ID,
  buildKnowledgeQuery,
  runRetrieveKnowledgeNode
};
