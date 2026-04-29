require("../utils/load-env").loadProjectEnv();

const http = require("http");
const { getStructuredOutputValidationRoute } = require("./routes/structured-output");
const { buildErrorResponse, buildSuccessResponse, createAppError, normalizeError } = require("../utils/errors");
const { info, error } = require("../utils/logger");

const MODEL_TOOL_PORT = Number(process.env.MODEL_TOOL_PORT || 19003);
const MODEL_TOOL_HOST = "127.0.0.1";

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw createAppError("INVALID_REQUEST", "Model tool request body must be valid JSON.", {
      stage: "model-tool"
    });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    const pathname = new URL(req.url, `http://${req.headers.host || MODEL_TOOL_HOST}`).pathname;

    if (method === "GET" && pathname === "/health") {
      sendJson(res, 200, buildSuccessResponse({
        service: "ok",
        provider: "sales-opportunity-model-tool"
      }, "healthcheck"));
      return;
    }

    if (method === "POST" && pathname === "/internal/model/validate-structured-output") {
      const body = await readJsonBody(req);
      const result = await getStructuredOutputValidationRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    sendJson(res, 404, buildErrorResponse(
      createAppError("INVALID_REQUEST", `Route not found: ${method} ${pathname}.`, {
        httpStatus: 404,
        stage: "model-tool-route"
      }),
      null
    ));
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    error("model-tool.unhandled", {
      code: appError.code,
      httpStatus: appError.httpStatus,
      stage: appError.stage
    });
    sendJson(res, appError.httpStatus, buildErrorResponse(appError, null));
  }
});

server.listen(MODEL_TOOL_PORT, MODEL_TOOL_HOST, () => {
  info("model-tool.started", {
    port: MODEL_TOOL_PORT,
    host: MODEL_TOOL_HOST
  });
});
