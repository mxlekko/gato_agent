const { info, error } = require("./logger");

function isDisabled() {
  return ["0", "false", "no", "off"].includes(
    String(process.env.HTTP_ACCESS_LOG || "1").trim().toLowerCase()
  );
}

function getHeaderValue(headers, name) {
  const value = headers?.[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] || null;
  }

  return value || null;
}

function parseRequestUrl(req) {
  try {
    const parsed = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    return {
      path: parsed.pathname,
      queryKeys: Array.from(parsed.searchParams.keys()).sort()
    };
  } catch {
    return {
      path: req.url || "/",
      queryKeys: []
    };
  }
}

function getResponseLogContext(res) {
  return res.__httpAccessLogContext || {};
}

function attachHttpAccessLog(req, res, options = {}) {
  if (isDisabled()) {
    return;
  }

  const startedAt = Date.now();
  const requestInfo = parseRequestUrl(req);

  res.once("finish", () => {
    const responseContext = getResponseLogContext(res);
    const context = {
      service: options.service || "http",
      method: req.method || "GET",
      path: requestInfo.path,
      queryKeys: requestInfo.queryKeys,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      requestId: responseContext.requestId || getHeaderValue(req.headers, "x-request-id"),
      success: responseContext.success,
      errorCode: responseContext.errorCode,
      errorStage: responseContext.errorStage,
      remoteAddress: req.socket?.remoteAddress || null,
      userAgent: getHeaderValue(req.headers, "user-agent")
    };

    if (res.statusCode >= 500) {
      error("http.request.completed", context);
      return;
    }

    info("http.request.completed", context);
  });
}

function setHttpResponseLogContext(res, payload) {
  if (!res || !payload || typeof payload !== "object") {
    return;
  }

  const payloadError = payload.error && typeof payload.error === "object"
    ? payload.error
    : null;

  res.__httpAccessLogContext = {
    requestId: typeof payload.requestId === "string" ? payload.requestId : null,
    success: typeof payload.success === "boolean" ? payload.success : null,
    errorCode: typeof payloadError?.code === "string" ? payloadError.code : null,
    errorStage: typeof payloadError?.stage === "string" ? payloadError.stage : null
  };
}

module.exports = {
  attachHttpAccessLog,
  setHttpResponseLogContext
};
