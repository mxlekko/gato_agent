const { createAppError } = require("../utils/errors");
const { getResultMarkers } = require("./runtime-message");

function parseRuntimeEnvelope(runtimeResult) {
  let parsed;
  try {
    parsed = JSON.parse(runtimeResult.rawResponse);
  } catch {
    throw createAppError("RUNTIME_INVALID_RESPONSE", "Gateway returned invalid JSON.", {
      details: {
        rawResponse: runtimeResult.rawResponse
      }
    });
  }

  const choices = parsed?.choices;
  const content = choices?.[0]?.message?.content;
  if (!Array.isArray(choices) || choices.length !== 1 || typeof content !== "string") {
    throw createAppError("RUNTIME_INVALID_RESPONSE", "Gateway response is missing choices[0].message.content.", {
      details: {
        responseShape: Object.keys(parsed || {})
      }
    });
  }

  return parsed;
}

function extractMarkedJson(content, beginMarker, endMarker) {
  const beginIndex = content.indexOf(beginMarker);
  const endIndex = content.indexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    throw createAppError(
      "INVALID_RUNTIME_RESULT",
      "Result JSON block was not found in Gateway response."
    );
  }

  return content
    .slice(beginIndex + beginMarker.length, endIndex)
    .trim();
}

function parseBusinessPayload(sceneConfig, envelope) {
  const content = envelope.choices[0].message.content;
  const markers = getResultMarkers(sceneConfig);
  const jsonBlock = extractMarkedJson(content, markers.begin, markers.end);

  try {
    return normalizeBusinessPayloadForScene(sceneConfig, JSON.parse(jsonBlock));
  } catch {
    throw createAppError("INVALID_MODEL_OUTPUT", "Result JSON block is not valid JSON.", {
      details: {
        jsonBlock
      }
    });
  }
}

function stringifyPayloadFields(payload) {
  return Object.entries(payload || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return `${key}：${value}`;
      }

      return `${key}：${JSON.stringify(value)}`;
    })
    .join("；");
}

function normalizeSpecialCustomProductSolutionResult(businessResult) {
  if (businessResult?.success !== true || !businessResult?.payload || typeof businessResult.payload !== "object") {
    return businessResult;
  }

  const productSolution = typeof businessResult.payload.productSolution === "string"
    ? businessResult.payload.productSolution.trim()
    : stringifyPayloadFields(businessResult.payload);

  return {
    ...businessResult,
    payload: {
      productSolution
    }
  };
}

function normalizeBusinessPayloadForScene(sceneConfig, businessResult) {
  if (sceneConfig?.scene === "special-custom-product-solution") {
    return normalizeSpecialCustomProductSolutionResult(businessResult);
  }

  return businessResult;
}

function validateBusinessPayload(businessResult) {
  if (typeof businessResult?.success !== "boolean") {
    throw createAppError("INVALID_MODEL_OUTPUT", "Business result must include boolean success.");
  }

  if (!businessResult.requestId || typeof businessResult.requestId !== "string") {
    throw createAppError("INVALID_MODEL_OUTPUT", "Business result must include requestId.");
  }

  if (businessResult.success) {
    const payload = businessResult.payload;
    if (!payload || typeof payload !== "object") {
      throw createAppError("INVALID_MODEL_OUTPUT", "Successful business result must include payload.");
    }
    if (businessResult.error !== null && businessResult.error !== undefined) {
      throw createAppError("INVALID_MODEL_OUTPUT", "Successful business result must set error to null.");
    }
    return businessResult;
  }

  if (businessResult.payload !== null) {
    throw createAppError("INVALID_MODEL_OUTPUT", "Failed business result must set payload to null.");
  }

  const error = businessResult.error;
  if (!error || typeof error !== "object") {
    throw createAppError("INVALID_MODEL_OUTPUT", "Failed business result must include error.");
  }

  const requiredFields = ["code", "message", "httpStatus", "stage", "retryable"];
  for (const field of requiredFields) {
    if (error[field] === undefined || error[field] === null) {
      throw createAppError("INVALID_MODEL_OUTPUT", `Failed business result is missing error.${field}.`);
    }
  }

  return businessResult;
}

module.exports = {
  parseBusinessPayload,
  parseRuntimeEnvelope,
  validateBusinessPayload
};
