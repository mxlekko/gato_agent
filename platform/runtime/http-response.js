const { buildErrorResponse, buildSuccessResponse, normalizeError } = require("../../utils/errors");

function buildHttpResponseFromState(state) {
  if (state?.result?.success === true) {
    return {
      statusCode: 200,
      payload: buildSuccessResponse(
        state.result.payload,
        state.result.requestId || state?.runtime_context?.request_id || null
      )
    };
  }

  const normalizedError = normalizeError(state?.error);
  return {
    statusCode: normalizedError.httpStatus,
    payload: buildErrorResponse(normalizedError, state?.runtime_context?.request_id || null)
  };
}

module.exports = {
  buildHttpResponseFromState
};
