require("../utils/load-env").loadProjectEnv();

const http = require("http");
const { getSalesOpportunityContextRoute } = require("./routes/sales-opportunity");
const { getDbClient } = require("./services/db");
const { buildErrorResponse, buildSuccessResponse, createAppError, normalizeError } = require("../utils/errors");
const { attachHttpAccessLog, setHttpResponseLogContext } = require("../utils/http-access-log");
const { info, error } = require("../utils/logger");

const HELPER_PORT = Number(process.env.CONTEXT_HELPER_PORT || 19001);
const HELPER_HOST = process.env.CONTEXT_HELPER_HOST || "127.0.0.1";

function sendJson(res, statusCode, payload) {
  setHttpResponseLogContext(res, payload);
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
    throw createAppError("INVALID_REQUEST", "Context helper request body must be valid JSON.", {
      stage: "context-query"
    });
  }
}

const server = http.createServer(async (req, res) => {
  attachHttpAccessLog(req, res, { service: "context-helper" });

  try {
    const method = req.method || "GET";
    const pathname = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`).pathname;

    if (method === "GET" && pathname === "/health") {
      const dbClient = getDbClient();
      sendJson(res, 200, buildSuccessResponse({
        service: "ok",
        provider: "sales-opportunity-context-helper",
        mode: dbClient.mode,
        database: {
          server: dbClient.server,
          port: dbClient.port,
          database: dbClient.database
        }
      }, "healthcheck"));
      return;
    }

    if (method === "POST" && pathname === "/internal/context/sales-opportunity") {
      const body = await readJsonBody(req);
      const result = await getSalesOpportunityContextRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    sendJson(res, 404, buildErrorResponse(
      createAppError("INVALID_REQUEST", `Route not found: ${method} ${pathname}.`, {
        httpStatus: 404,
        stage: "context-route"
      }),
      null
    ));
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    error("context-helper.unhandled", {
      code: appError.code,
      httpStatus: appError.httpStatus,
      stage: appError.stage
    });
    sendJson(res, appError.httpStatus, buildErrorResponse(appError, null));
  }
});

server.listen(HELPER_PORT, HELPER_HOST, () => {
  const dbClient = getDbClient();
  info("context-helper.started", {
    port: HELPER_PORT,
    host: HELPER_HOST,
    mode: dbClient.mode,
    database: {
      server: dbClient.server,
      port: dbClient.port,
      database: dbClient.database
    }
  });
});
