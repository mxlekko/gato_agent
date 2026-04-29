const { normalizeError, createAppError } = require("../../utils/errors");
const { mergeWorkflowState, recordNodeRun } = require("../runtime/state");
const {
  isObject,
  loadRegistrySnapshot,
  resolveNodeOverride,
  resolveRetryMaxAttempts,
  resolveSkillSpec,
  resolveToolDocumentByRole
} = require("./tool-runtime");
const { createCompatDraftPayload } = require("./draft-output");

const NODE_ID = "repair-output";
const OVERRIDE_NODE_ID = "repair_output";
const DEFAULT_TOOL_ROLE = "advisory_llm";

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
    validationCode: state?.artifacts?.validation?.error?.code || state?.error?.code || null,
    repairAttemptCount: Array.isArray(state?.artifacts?.draft?.repair_attempts)
      ? state.artifacts.draft.repair_attempts.length
      : 0
  };
}

function getFieldFromError(validationError) {
  const requiredField = validationError?.details?.requiredField;
  if (requiredField) {
    return requiredField;
  }

  const path = validationError?.details?.path || "";
  if (!path.startsWith("payload.")) {
    return null;
  }

  return path.slice("payload.".length).split("[")[0] || null;
}

function buildRepairedPayload(currentPayload, validationError, compatPayload) {
  const fieldName = getFieldFromError(validationError);
  const repairedFields = [];
  const nextPayload = isObject(currentPayload)
    ? JSON.parse(JSON.stringify(currentPayload))
    : {};

  const applyField = (targetField) => {
    if (!targetField || compatPayload[targetField] === undefined) {
      return;
    }
    nextPayload[targetField] = compatPayload[targetField];
    repairedFields.push(targetField);
  };

  if (fieldName) {
    applyField(fieldName);
  }

  if (!Array.isArray(nextPayload.nextActions) || nextPayload.nextActions.length < 3) {
    applyField("nextActions");
  }

  if (!Array.isArray(nextPayload.basisFields) || nextPayload.basisFields.length < 1) {
    applyField("basisFields");
  }

  if (typeof nextPayload.summary !== "string" || nextPayload.summary.trim().length === 0) {
    applyField("summary");
  }

  if (typeof nextPayload.adviceText !== "string" || nextPayload.adviceText.trim().length === 0) {
    applyField("adviceText");
  }

  if (!nextPayload.opportunityId) {
    applyField("opportunityId");
  }

  if (repairedFields.length === 0) {
    for (const [key, value] of Object.entries(compatPayload)) {
      if (nextPayload[key] === undefined) {
        nextPayload[key] = value;
        repairedFields.push(key);
      }
    }
  }

  return {
    payload: nextPayload,
    repairedFields: Array.from(new Set(repairedFields))
  };
}

function summarizeOutput(repairedFields, toolRef, mode, attemptNumber, limitReached) {
  return {
    toolRef,
    mode,
    attemptNumber,
    repairedFieldCount: repairedFields.length,
    limitReached
  };
}

async function runRepairOutputNode({
  state,
  skillSpec = null,
  invokeTool = null
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);

  try {
    const currentPayload = state?.artifacts?.draft?.payload;
    const validationError = state?.artifacts?.validation?.error || state?.error || null;

    if (!isObject(currentPayload)) {
      throw createAppError("INVALID_REQUEST", "repair-output requires artifacts.draft.payload.", {
        stage: "repair-output"
      });
    }

    if (!validationError?.code) {
      throw createAppError("INVALID_REQUEST", "repair-output requires a validation error to repair.", {
        stage: "repair-output"
      });
    }

    const registrySnapshot = loadRegistrySnapshot();
    const resolvedSkillSpec = resolveSkillSpec(state, registrySnapshot, skillSpec);
    const nodeOverride = resolveNodeOverride({
      state,
      skillSpec: resolvedSkillSpec,
      nodeId: OVERRIDE_NODE_ID,
      fallbackNodeId: NODE_ID
    });
    const repairAttempts = Array.isArray(state?.artifacts?.draft?.repair_attempts)
      ? state.artifacts.draft.repair_attempts
      : [];
    const maxAttempts = resolveRetryMaxAttempts(nodeOverride, 1);

    if (repairAttempts.length >= maxAttempts) {
      let nextState = recordNodeRun(state, {
        nodeId: NODE_ID,
        status: "business_error",
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        inputSummary,
        outputSummary: summarizeOutput([], null, "skipped", repairAttempts.length, true)
      });

      nextState = mergeWorkflowState(nextState, {
        artifacts: {
          outputs: {
            repair_output: {
              repaired: false,
              limit_reached: true,
              attempt_count: repairAttempts.length
            }
          }
        },
        result: null,
        error: toStateError(validationError)
      });

      return nextState;
    }

    const toolRole = nodeOverride.toolRole || DEFAULT_TOOL_ROLE;
    const { toolRef } = resolveToolDocumentByRole({
      registrySnapshot,
      skillSpec: resolvedSkillSpec,
      toolRole
    });
    const compatPayload = createCompatDraftPayload({
      state,
      requestPayload: {}
    });
    const execution = invokeTool
      ? await invokeTool({
          currentPayload,
          validationError,
          compatPayload,
          toolRef,
          toolRole
        })
      : buildRepairedPayload(currentPayload, validationError, compatPayload);
    const repairedPayload = isObject(execution?.payload) ? execution.payload : currentPayload;
    const repairedFields = Array.isArray(execution?.repairedFields)
      ? execution.repairedFields
      : [];
    const mode = execution?.mode || "compat";
    const attemptRecord = {
      attempt: repairAttempts.length + 1,
      tool_ref: toolRef,
      tool_role: toolRole,
      mode,
      error_code: validationError.code,
      error_path: validationError?.details?.path || null,
      repaired_fields: repairedFields
    };

    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "success",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      outputSummary: summarizeOutput(
        repairedFields,
        toolRef,
        mode,
        attemptRecord.attempt,
        false
      )
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        draft: {
          payload: repairedPayload,
          repair_attempts: repairAttempts.concat(attemptRecord)
        },
        validation: {
          status: "repaired_pending_validation",
          payload: null,
          last_error: toStateError(validationError),
          error: null
        },
        outputs: {
          repair_output: {
            repaired: true,
            attempt_count: repairAttempts.length + 1,
            repaired_fields: repairedFields,
            tool_ref: toolRef,
            mode
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
          repair_output: {
            repaired: false,
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
  runRepairOutputNode
};
