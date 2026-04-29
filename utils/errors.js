class AppError extends Error {
  constructor({ code, message, httpStatus, stage, retryable, details = null }) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.stage = stage;
    this.retryable = retryable;
    this.details = details;
  }
}

const ERROR_CATALOG = {
  INVALID_REQUEST: {
    httpStatus: 400,
    stage: "request-validate",
    retryable: false
  },
  ACCESS_DENIED: {
    httpStatus: 403,
    stage: "authorize-scope",
    retryable: false
  },
  ASSET_LOAD_FAILED: {
    httpStatus: 500,
    stage: "load-assets",
    retryable: false
  },
  INVALID_GATEWAY_TARGET: {
    httpStatus: 500,
    stage: "runtime-request-build",
    retryable: false
  },
  MISSING_GATEWAY_TOKEN: {
    httpStatus: 500,
    stage: "runtime-request-build",
    retryable: false
  },
  GATEWAY_UNAVAILABLE: {
    httpStatus: 502,
    stage: "gateway-http",
    retryable: true
  },
  OPPORTUNITY_NOT_FOUND: {
    httpStatus: 404,
    stage: "context-query",
    retryable: false
  },
  CONTEXT_SERVICE_UNAVAILABLE: {
    httpStatus: 502,
    stage: "context-query",
    retryable: true
  },
  CONTEXT_SERVICE_INVALID_RESPONSE: {
    httpStatus: 502,
    stage: "context-query",
    retryable: false
  },
  CONTEXT_QUERY_FAILED: {
    httpStatus: 500,
    stage: "context-query",
    retryable: true
  },
  QUERY_RESULT_NOT_FOUND: {
    httpStatus: 404,
    stage: "context-query",
    retryable: false
  },
  FIELD_MAPPING_FAILED: {
    httpStatus: 500,
    stage: "field-dictionary",
    retryable: false
  },
  SQL_TEMPLATE_GENERATION_FAILED: {
    httpStatus: 502,
    stage: "directdb-sql-template",
    retryable: true
  },
  INVALID_SQL_TEMPLATE: {
    httpStatus: 500,
    stage: "directdb-sql-template",
    retryable: false
  },
  MODEL_INVOCATION_FAILED: {
    httpStatus: 502,
    stage: "model-call",
    retryable: true
  },
  GATEWAY_AUTH_FAILED: {
    httpStatus: 502,
    stage: "gateway-http",
    retryable: false
  },
  RUNTIME_TIMEOUT: {
    httpStatus: 504,
    stage: "gateway-http",
    retryable: true
  },
  INVALID_RUNTIME_MESSAGE: {
    httpStatus: 500,
    stage: "request-reader",
    retryable: false
  },
  RUNTIME_INVALID_RESPONSE: {
    httpStatus: 502,
    stage: "response-parse",
    retryable: false
  },
  INVALID_RUNTIME_RESULT: {
    httpStatus: 502,
    stage: "result-parse",
    retryable: false
  },
  INVALID_MODEL_OUTPUT: {
    httpStatus: 502,
    stage: "result-parse",
    retryable: false
  }
};

function createAppError(code, message, overrides = {}) {
  const base = ERROR_CATALOG[code] || {
    httpStatus: 500,
    stage: "unknown",
    retryable: false
  };

  return new AppError({
    code,
    message,
    httpStatus: overrides.httpStatus ?? base.httpStatus,
    stage: overrides.stage ?? base.stage,
    retryable: overrides.retryable ?? base.retryable,
    details: overrides.details ?? null
  });
}

function normalizeError(error, fallbackCode = "RUNTIME_INVALID_RESPONSE") {
  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.httpStatus === "number" &&
    typeof error.stage === "string" &&
    typeof error.retryable === "boolean"
  ) {
    return new AppError(error);
  }

  if (error instanceof AppError) {
    return error;
  }

  return createAppError(
    fallbackCode,
    error?.message || "Unexpected application error.",
    {
      details: error ? { name: error.name || "Error" } : null
    }
  );
}

function buildSuccessResponse(data, requestId) {
  return {
    success: true,
    requestId,
    data,
    error: null
  };
}

function buildErrorResponse(error, requestId = null) {
  const normalized = normalizeError(error);

  return {
    success: false,
    requestId,
    data: null,
    error: {
      code: normalized.code,
      message: normalized.message,
      httpStatus: normalized.httpStatus,
      stage: normalized.stage,
      retryable: normalized.retryable,
      details: normalized.details
    }
  };
}

module.exports = {
  AppError,
  buildErrorResponse,
  buildSuccessResponse,
  createAppError,
  normalizeError
};
