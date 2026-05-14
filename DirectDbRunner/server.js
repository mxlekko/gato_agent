require("../utils/load-env").loadProjectEnv();

const http = require("http");
const { getDbClient } = require("../ContextHelper/services/db");
const { getDirectDbSalesOpportunityRoute } = require("./routes/sales-opportunity");
const { buildErrorResponse, buildSuccessResponse, createAppError, normalizeError } = require("../utils/errors");
const { attachHttpAccessLog, setHttpResponseLogContext } = require("../utils/http-access-log");
const { info, error } = require("../utils/logger");

const DIRECTDB_RUNNER_PORT = Number(process.env.DIRECTDB_RUNNER_PORT || 19002);
const DIRECTDB_RUNNER_HOST = process.env.DIRECTDB_RUNNER_HOST || "127.0.0.1";

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
    throw createAppError("INVALID_REQUEST", "Direct DB runner request body must be valid JSON.", {
      stage: "directdb-query"
    });
  }
}

const server = http.createServer(async (req, res) => {
  attachHttpAccessLog(req, res, { service: "directdb-runner" });

  try {
    const method = req.method || "GET";
    const pathname = new URL(req.url, `http://${req.headers.host || DIRECTDB_RUNNER_HOST}`).pathname;

    if (method === "GET" && pathname === "/health") {
      const dbClient = getDbClient();
      sendJson(res, 200, buildSuccessResponse({
        service: "ok",
        provider: "sales-opportunity-directdb-runner",
        mode: dbClient.mode,
        database: {
          server: dbClient.server,
          port: dbClient.port,
          database: dbClient.database
        }
      }, "healthcheck"));
      return;
    }

    if (method === "POST" && pathname === "/internal/directdb/sales-opportunity") {
      const body = await readJsonBody(req);
      const result = await getDirectDbSalesOpportunityRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    sendJson(res, 404, buildErrorResponse(
      createAppError("INVALID_REQUEST", `Route not found: ${method} ${pathname}.`, {
        httpStatus: 404,
        stage: "directdb-route"
      }),
      null
    ));
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    error("directdb-runner.unhandled", {
      code: appError.code,
      httpStatus: appError.httpStatus,
      stage: appError.stage
    });
    sendJson(res, appError.httpStatus, buildErrorResponse(appError, null));
  }
});

server.listen(DIRECTDB_RUNNER_PORT, DIRECTDB_RUNNER_HOST, () => {
  const dbClient = getDbClient();
  info("directdb-runner.started", {
    port: DIRECTDB_RUNNER_PORT,
    host: DIRECTDB_RUNNER_HOST,
    mode: dbClient.mode,
    database: {
      server: dbClient.server,
      port: dbClient.port,
      database: dbClient.database
    }
  });
});
