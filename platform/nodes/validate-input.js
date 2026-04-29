const { createAppError, normalizeError } = require("../../utils/errors");
const { validateBizParamsAgainstContract } = require("../../services/request-validation");
const { mergeWorkflowState, recordNodeRun } = require("../runtime/state");

const NODE_ID = "validate-input";

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
    kind: state?.request?.kind || null,
    version: state?.request?.version || null,
    bizParamKeys: Object.keys(state?.request?.biz_params || {})
  };
}

function resolveInputContract(state, inputContract = null) {
  if (isObject(inputContract)) {
    return inputContract;
  }

  const resolved = state?.scene_contract?.request_contract?.bizParams;
  if (isObject(resolved)) {
    return resolved;
  }

  throw createAppError("INVALID_REQUEST", "validate-input requires an input contract.", {
    stage: "validate-input"
  });
}

function requireValidateInputState(state) {
  if (!isObject(state)) {
    throw createAppError("INVALID_REQUEST", "validate-input requires workflow state.", {
      stage: "validate-input"
    });
  }

  if (!state?.request?.scene) {
    throw createAppError("INVALID_REQUEST", "validate-input requires state.request.scene.", {
      stage: "validate-input"
    });
  }

  if (!isObject(state?.request?.biz_params)) {
    throw createAppError("INVALID_REQUEST", "validate-input requires state.request.biz_params.", {
      stage: "validate-input"
    });
  }

  return state;
}

async function runValidateInputNode({
  state,
  inputContract = null
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);

  try {
    requireValidateInputState(state);
    const resolvedInputContract = resolveInputContract(state, inputContract);
    const normalizedBizParams = validateBizParamsAgainstContract(
      resolvedInputContract,
      state.request.biz_params,
      {
        stage: "validate-input"
      }
    );

    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "success",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      outputSummary: {
        normalizedBizParamKeys: Object.keys(normalizedBizParams)
      }
    });

    nextState = mergeWorkflowState(nextState, {
      request: {
        normalized: {
          scene: state.request.scene,
          kind: state.request.kind || null,
          version: state.request.version || null,
          biz_params: normalizedBizParams
        }
      },
      artifacts: {
        outputs: {
          validate_input: {
            valid: true,
            normalized_biz_param_keys: Object.keys(normalizedBizParams)
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
          validate_input: {
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
  runValidateInputNode
};
