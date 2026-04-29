const { createAppError } = require("../../../utils/errors");

function normalizeOpportunityId(rawValue) {
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      throw createAppError("INVALID_REQUEST", "opportunityId must not be empty.", {
        stage: "context-query"
      });
    }
    return trimmed;
  }

  if (typeof rawValue === "number") {
    if (!Number.isFinite(rawValue) || !Number.isInteger(rawValue)) {
      throw createAppError("INVALID_REQUEST", "opportunityId must be an integer.", {
        stage: "context-query"
      });
    }

    if (!Number.isSafeInteger(rawValue)) {
      throw createAppError("INVALID_REQUEST", "Large opportunityId values must be sent as strings.", {
        stage: "context-query"
      });
    }

    return String(rawValue);
  }

  throw createAppError("INVALID_REQUEST", "opportunityId must be a string or integer.", {
    stage: "context-query"
  });
}

function validateInput(params) {
  if (!params || typeof params !== "object") {
    throw createAppError("INVALID_REQUEST", "Context request must be a JSON object.", {
      stage: "context-query"
    });
  }

  if (!params.requestId || typeof params.requestId !== "string") {
    throw createAppError("INVALID_REQUEST", "requestId is required for context lookup.", {
      stage: "context-query"
    });
  }

  return {
    requestId: params.requestId,
    opportunityId: normalizeOpportunityId(params.opportunityId)
  };
}

module.exports = {
  normalizeOpportunityId,
  validateInput
};
