const { getSceneConfig } = require("../../services/scene-config");
const { runLegacySceneExecution } = require("../../services/runtime");
const { createAppError, normalizeError } = require("../../utils/errors");
const { mergeWorkflowState, recordNodeRun } = require("../runtime/state");

const NODE_ID = "legacy-scene-runner";

function summarizeInput(state) {
  return {
    scene: state?.request?.scene || null,
    requestId: state?.runtime_context?.request_id || null,
    traceId: state?.runtime_context?.trace_id || null,
    bizParamKeys: Object.keys(state?.request?.biz_params || {})
  };
}

function summarizeOutput(execution) {
  return {
    executionType: execution?.executionType || null,
    businessSuccess: execution?.businessResult?.success ?? null,
    requestId: execution?.businessResult?.requestId || null,
    sessionKey: execution?.sessionKey || null,
    durationMs: execution?.durationMs ?? null,
    errorCode: execution?.businessResult?.error?.code || null
  };
}

function buildCompatArtifact(execution) {
  return {
    execution_type: execution?.executionType || null,
    session_key: execution?.sessionKey || null,
    duration_ms: execution?.durationMs ?? null,
    request_id: execution?.businessResult?.requestId || null,
    business_success: execution?.businessResult?.success ?? null
  };
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

function requireLegacyNodeInputs(state) {
  if (!state || typeof state !== "object") {
    throw createAppError("INVALID_REQUEST", "legacy-scene-runner requires workflow state.", {
      stage: "legacy-scene-runner"
    });
  }

  const scene = state?.request?.scene || null;
  const requestId = state?.runtime_context?.request_id || null;
  const bizParams = state?.request?.biz_params;

  if (!scene) {
    throw createAppError("INVALID_REQUEST", "legacy-scene-runner requires state.request.scene.", {
      stage: "legacy-scene-runner"
    });
  }

  if (!requestId) {
    throw createAppError("INVALID_REQUEST", "legacy-scene-runner requires state.runtime_context.request_id.", {
      stage: "legacy-scene-runner"
    });
  }

  if (!bizParams || typeof bizParams !== "object") {
    throw createAppError("INVALID_REQUEST", "legacy-scene-runner requires state.request.biz_params.", {
      stage: "legacy-scene-runner"
    });
  }

  return {
    scene,
    requestId,
    bizParams
  };
}

async function runLegacySceneRunnerNode({
  state,
  sceneConfig = null,
  executeLegacyScene = runLegacySceneExecution,
  resolveSceneConfig = getSceneConfig
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);

  try {
    const { scene, requestId, bizParams } = requireLegacyNodeInputs(state);
    const resolvedSceneConfig = sceneConfig || resolveSceneConfig(scene);
    const execution = await executeLegacyScene({
      requestId,
      sceneConfig: resolvedSceneConfig,
      bizParams
    });
    const finishedAt = new Date();
    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: execution.businessResult?.success === false ? "business_error" : "success",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      outputSummary: summarizeOutput(execution)
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        compat: {
          legacy_scene_runner: buildCompatArtifact(execution)
        }
      }
    });

    if (execution.businessResult?.success === false) {
      return mergeWorkflowState(nextState, {
        result: null,
        error: execution.businessResult.error
      });
    }

    return mergeWorkflowState(nextState, {
      result: {
        success: true,
        scene: execution.businessResult.scene,
        requestId: execution.businessResult.requestId,
        payload: execution.businessResult.payload
      },
      error: null
    });
  } catch (error) {
    const normalized = normalizeError(error);
    const finishedAt = new Date();
    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "error",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
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
        compat: {
          legacy_scene_runner: {
            execution_type: null,
            session_key: null,
            duration_ms: Date.now() - startMs,
            request_id: state?.runtime_context?.request_id || null,
            business_success: false
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
  runLegacySceneRunnerNode
};
