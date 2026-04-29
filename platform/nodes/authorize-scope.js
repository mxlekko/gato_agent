const { createAppError, normalizeError } = require("../../utils/errors");
const { mergeWorkflowState, normalizePermissions, recordNodeRun } = require("../runtime/state");

const NODE_ID = "authorize-scope";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    normalizedBizParamKeys: Object.keys(state?.request?.normalized?.biz_params || {}),
    permissionCount: Array.isArray(state?.runtime_context?.permissions)
      ? state.runtime_context.permissions.length
      : 0
  };
}

function resolvePolicyProfile(state, policyProfile = null) {
  if (isObject(policyProfile)) {
    return policyProfile;
  }

  const workflowProfile = state?.scene_contract?.workflow_binding?.policy_profile;
  if (isObject(workflowProfile)) {
    return workflowProfile;
  }

  return {
    scope: state?.request?.scene || null,
    requiredPermissions: [],
    allowedFields: ["*"]
  };
}

function requireAuthorizeScopeState(state) {
  if (!isObject(state)) {
    throw createAppError("INVALID_REQUEST", "authorize-scope requires workflow state.", {
      stage: "authorize-scope"
    });
  }

  if (!isObject(state?.request?.normalized?.biz_params)) {
    throw createAppError("INVALID_REQUEST", "authorize-scope requires state.request.normalized.biz_params.", {
      stage: "authorize-scope"
    });
  }

  return state;
}

function evaluatePolicyDecision(state, policyProfile) {
  const grantedPermissions = normalizePermissions(state?.runtime_context?.permissions);
  const requiredPermissions = uniqueStrings(
    Array.isArray(policyProfile?.requiredPermissions)
      ? policyProfile.requiredPermissions
      : []
  );
  const allowedFields = uniqueStrings(
    Array.isArray(policyProfile?.allowedFields)
      ? policyProfile.allowedFields
      : ["*"]
  );
  const missingPermissions = requiredPermissions.filter((permission) => !grantedPermissions.includes(permission));
  const denied = missingPermissions.length > 0;

  return {
    denied,
    scope: policyProfile?.scope || state?.request?.scene || null,
    required_permissions: requiredPermissions,
    granted_permissions: grantedPermissions,
    missing_permissions: missingPermissions,
    allowed_fields: allowedFields.length > 0 ? allowedFields : ["*"]
  };
}

async function runAuthorizeScopeNode({
  state,
  policyProfile = null
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);

  try {
    requireAuthorizeScopeState(state);
    const resolvedPolicyProfile = resolvePolicyProfile(state, policyProfile);
    const decision = evaluatePolicyDecision(state, resolvedPolicyProfile);

    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: decision.denied ? "business_error" : "success",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      outputSummary: {
        denied: decision.denied,
        scope: decision.scope,
        allowedFieldCount: decision.allowed_fields.length,
        missingPermissionCount: decision.missing_permissions.length
      }
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        outputs: {
          authorize_scope: decision
        }
      }
    });

    if (!decision.denied) {
      return mergeWorkflowState(nextState, {
        error: null
      });
    }

    const deniedError = createAppError("ACCESS_DENIED", "Permission denied for current workflow scope.", {
      stage: "authorize-scope",
      details: {
        scope: decision.scope,
        missingPermissions: decision.missing_permissions,
        requiredPermissions: decision.required_permissions
      }
    });

    return mergeWorkflowState(nextState, {
      result: null,
      error: toStateError(deniedError)
    });
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
          authorize_scope: {
            denied: true,
            scope: state?.request?.scene || null,
            required_permissions: [],
            granted_permissions: normalizePermissions(state?.runtime_context?.permissions),
            missing_permissions: [],
            allowed_fields: []
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
  runAuthorizeScopeNode
};
