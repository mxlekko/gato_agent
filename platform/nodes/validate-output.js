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

const NODE_ID = "validate-output";
const OVERRIDE_NODE_ID = "validate_output";
const DEFAULT_TOOL_ROLE = "output_validator";

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
    hasDraftPayload: isObject(state?.artifacts?.draft?.payload),
    hasSchema: isObject(state?.artifacts?.references?.output_schema)
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
      throw createAppError("RUNTIME_INVALID_RESPONSE", "Model tool returned invalid JSON.", {
        stage: "validate-output",
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
      throw createAppError("RUNTIME_TIMEOUT", "Model tool request timed out.", {
        stage: "validate-output",
        details: {
          endpoint,
          timeoutMs
        }
      });
    }

    if (error?.code) {
      throw error;
    }

    throw createAppError("MODEL_INVOCATION_FAILED", "Model tool request failed.", {
      stage: "validate-output",
      details: {
        endpoint,
        cause: error?.message || "network_failed"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeOutput(payload, toolRef, status) {
  return {
    toolRef,
    status,
    basisFieldCount: Array.isArray(payload?.basisFields) ? payload.basisFields.length : 0,
    nextActionCount: Array.isArray(payload?.nextActions) ? payload.nextActions.length : 0
  };
}

async function runValidateOutputNode({
  state,
  skillSpec = null,
  invokeTool = null
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);

  try {
    const registrySnapshot = loadRegistrySnapshot();
    const resolvedSkillSpec = resolveSkillSpec(state, registrySnapshot, skillSpec);
    const nodeOverride = resolveNodeOverride({
      state,
      skillSpec: resolvedSkillSpec,
      nodeId: OVERRIDE_NODE_ID,
      fallbackNodeId: NODE_ID
    });
    const toolRole = nodeOverride.toolRole || DEFAULT_TOOL_ROLE;
    const { toolDocument, toolRef } = resolveToolDocumentByRole({
      registrySnapshot,
      skillSpec: resolvedSkillSpec,
      toolRole
    });
    const requestPayload = buildToolRequestPayload(state, toolDocument);
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
      throw createAppError("RUNTIME_INVALID_RESPONSE", "Model tool response payload is missing.", {
        stage: "validate-output",
        details: {
          toolRef
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
          toolRef,
          errorCode: toolError.code
        }
      });

      nextState = mergeWorkflowState(nextState, {
        artifacts: {
          validation: {
            status: "invalid",
            payload: null,
            error: toStateError(toolError),
            tool_ref: toolRef
          },
          outputs: {
            validate_output: {
              valid: false,
              tool_ref: toolRef,
              error_code: toolError.code
            }
          }
        },
        result: null,
        error: toStateError(toolError)
      });

      return nextState;
    }

    const validatedPayload = toolPayload?.data?.payload;
    if (!isObject(validatedPayload)) {
      throw createAppError("RUNTIME_INVALID_RESPONSE", "Model tool response is missing data.payload.", {
        stage: "validate-output",
        details: {
          toolRef
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
      outputSummary: summarizeOutput(validatedPayload, toolRef, "valid")
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        draft: {
          payload: validatedPayload
        },
        validation: {
          status: "valid",
          payload: validatedPayload,
          error: null,
          tool_ref: toolRef
        },
        outputs: {
          validate_output: {
            valid: true,
            tool_ref: toolRef
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
        validation: {
          status: "error",
          payload: null,
          error: toStateError(normalized)
        },
        outputs: {
          validate_output: {
            valid: false,
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
  runValidateOutputNode
};
