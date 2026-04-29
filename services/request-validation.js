const { createAppError } = require("../utils/errors");

function buildValidationError(message, {
  stage = "request-validate",
  details = null,
  httpStatus,
  retryable
} = {}) {
  return createAppError("INVALID_REQUEST", message, {
    stage,
    details,
    httpStatus,
    retryable
  });
}

function normalizeOpportunityId(rawValue, stage = "request-validate") {
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      throw buildValidationError("bizParams.opportunityId must not be empty.", {
        stage
      });
    }
    return trimmed;
  }

  if (typeof rawValue === "number") {
    if (!Number.isFinite(rawValue) || !Number.isInteger(rawValue)) {
      throw buildValidationError("bizParams.opportunityId must be an integer.", {
        stage
      });
    }

    if (!Number.isSafeInteger(rawValue)) {
      throw buildValidationError(
        "Large bizParams.opportunityId values must be sent as strings to avoid precision loss.",
        {
          stage
        }
      );
    }

    return String(rawValue);
  }

  throw buildValidationError("bizParams.opportunityId must be a string or integer.", {
    stage
  });
}

function normalizeStringField(rawValue, fieldName, rule = {}, stage = "request-validate") {
  if (typeof rawValue !== "string") {
    throw buildValidationError(`${fieldName} must be a string.`, {
      stage
    });
  }

  const normalized = rule.trim === false ? rawValue : rawValue.trim();

  if (rule.required !== false && normalized.length === 0) {
    throw buildValidationError(`${fieldName} must not be empty.`, {
      stage
    });
  }

  if (rule.maxLength && normalized.length > rule.maxLength) {
    throw buildValidationError(`${fieldName} is too long.`, {
      stage,
      details: {
        fieldName,
        maxLength: rule.maxLength
      }
    });
  }

  return normalized;
}

function normalizeBizParamByRule(fieldName, rawValue, rule = {}, stage = "request-validate") {
  switch (rule.type) {
    case "opportunityId":
      return normalizeOpportunityId(rawValue, stage);
    case "string":
      return normalizeStringField(rawValue, `bizParams.${fieldName}`, rule, stage);
    default:
      throw buildValidationError(`Unsupported request field type for bizParams.${fieldName}.`, {
        stage,
        details: {
          fieldName,
          type: rule.type || null
        }
      });
  }
}

function validateBizParamsAgainstContract(definitions, bizParams, {
  stage = "request-validate"
} = {}) {
  if (!definitions || typeof definitions !== "object") {
    throw buildValidationError("Request contract must define bizParams.", {
      stage
    });
  }

  if (!bizParams || typeof bizParams !== "object") {
    throw buildValidationError("bizParams is required.", {
      stage
    });
  }

  const normalized = {};

  for (const [fieldName, rule] of Object.entries(definitions)) {
    const rawValue = bizParams[fieldName];

    if (rawValue === undefined || rawValue === null) {
      if (rule.required === false) {
        continue;
      }
      throw buildValidationError(`bizParams.${fieldName} is required.`, {
        stage
      });
    }

    normalized[fieldName] = normalizeBizParamByRule(fieldName, rawValue, rule, stage);
  }

  return normalized;
}

function validateSceneBizParams(sceneConfig, bizParams, options = {}) {
  return validateBizParamsAgainstContract(sceneConfig?.request?.bizParams, bizParams, options);
}

module.exports = {
  normalizeOpportunityId,
  normalizeStringField,
  normalizeBizParamByRule,
  validateBizParamsAgainstContract,
  validateSceneBizParams
};
