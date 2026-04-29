require("./utils/load-env").loadProjectEnv();

const http = require("http");
const { runAgentRoute } = require("./routes/agent");
const {
  getConsoleSceneDictionaryAssetRoute,
  getConsoleSceneInputMappingRoute,
  getConsoleScenePromptAssetRoute,
  getConsoleSceneQueryProfileRoute,
  getConsoleSceneRulesAssetRoute,
  getConsoleSceneSchemaAssetRoute,
  getConsoleSceneSkillBindingRoute,
  getConsoleSceneWorkflowRoute,
  listConsoleScenesRoute,
  updateConsoleSceneDictionaryAssetRoute,
  updateConsoleSceneInputMappingRoute,
  updateConsoleScenePromptAssetRoute,
  updateConsoleSceneQueryProfileRoute,
  updateConsoleSceneRulesAssetRoute,
  updateConsoleSceneSchemaAssetRoute,
  updateConsoleSceneSkillBindingRoute
} = require("./routes/console-scenes");
const {
  compileConsoleConfigPreviewRoute,
  getConsoleConfigCatalogRoute,
  updateConsoleQueryStructuredConfigRoute,
  updateConsoleToolStructuredConfigRoute,
  validateConsoleConfigsRoute
} = require("./routes/console-configs");
const {
  getConsoleRevisionDetailRoute,
  listConsoleRevisionsRoute
} = require("./routes/console-audit");
const { executeGenericQueryRoute } = require("./routes/internal-query-runner");
const {
  getConsoleRolloutReportRoute,
  getConsoleSceneRoutingRoute,
  previewConsoleSceneRoutingChangeRoute
} = require("./routes/console-rollout");
const {
  getConsoleReleaseStatusRoute,
  rollbackConsoleReleaseRoute
} = require("./routes/console-releases");
const { getConsoleRunRoute, getConsoleShadowRoute, listConsoleRunsRoute } = require("./routes/console-runs");
const { getConsoleTraceRoute } = require("./routes/console-traces");
const { buildErrorResponse, buildSuccessResponse, createAppError, normalizeError } = require("./utils/errors");
const { info, error } = require("./utils/logger");
const { GATEWAY_BASE_URL } = require("./services/runtime-message");

const API_HOST = process.env.API_HOST || "0.0.0.0";
const API_PORT = Number(process.env.API_PORT || 3000);
const GATEWAY_MODELS_URL = `${GATEWAY_BASE_URL}/v1/models`;

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
    throw createAppError("INVALID_REQUEST", "Request body must be valid JSON.");
  }
}

async function checkGatewayHealth() {
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!token) {
    throw createAppError(
      "MISSING_GATEWAY_TOKEN",
      "OPENCLAW_GATEWAY_TOKEN is required for Gateway health checks."
    );
  }

  try {
    const response = await fetch(GATEWAY_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (response.status === 401 || response.status === 403) {
      throw createAppError("GATEWAY_AUTH_FAILED", "Gateway authentication failed.");
    }

    if (!response.ok) {
      throw createAppError("GATEWAY_UNAVAILABLE", `Gateway health probe returned HTTP ${response.status}.`, {
        details: {
          httpStatus: response.status
        }
      });
    }

    return {
      ok: true,
      httpStatus: response.status
    };
  } catch (caughtError) {
    if (caughtError.name === "AppError") {
      throw caughtError;
    }

    throw createAppError("GATEWAY_UNAVAILABLE", "Gateway health probe failed.", {
      details: {
        cause: caughtError.message
      }
    });
  }
}

async function handleHealth(_req, res) {
  try {
    const gateway = await checkGatewayHealth();
    sendJson(res, 200, buildSuccessResponse({
      service: "ok",
      gateway
    }, "healthcheck"));
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    sendJson(res, appError.httpStatus, buildErrorResponse(appError, "healthcheck"));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    const url = new URL(req.url, `http://${req.headers.host || `${API_HOST}:${API_PORT}`}`);
    const pathname = url.pathname;

    if (method === "GET" && pathname === "/health") {
      await handleHealth(req, res);
      return;
    }

    if (method === "POST" && pathname === "/internal/query/execute") {
      const body = await readJsonBody(req);
      const result = await executeGenericQueryRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/runs") {
      const result = await listConsoleRunsRoute(url);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/scenes") {
      const result = await listConsoleScenesRoute();
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const scenePromptAssetMatch = pathname.match(/^\/api\/console\/scenes\/([^/]+)\/assets\/prompt$/);
    if (method === "GET" && scenePromptAssetMatch) {
      const result = await getConsoleScenePromptAssetRoute(
        decodeURIComponent(scenePromptAssetMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "PATCH" && scenePromptAssetMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleScenePromptAssetRoute(
        decodeURIComponent(scenePromptAssetMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const sceneSchemaAssetMatch = pathname.match(/^\/api\/console\/scenes\/([^/]+)\/assets\/schema$/);
    if (method === "GET" && sceneSchemaAssetMatch) {
      const result = await getConsoleSceneSchemaAssetRoute(
        decodeURIComponent(sceneSchemaAssetMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "PATCH" && sceneSchemaAssetMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleSceneSchemaAssetRoute(
        decodeURIComponent(sceneSchemaAssetMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const sceneDictionaryAssetMatch = pathname.match(/^\/api\/console\/scenes\/([^/]+)\/assets\/dictionary$/);
    if (method === "GET" && sceneDictionaryAssetMatch) {
      const result = await getConsoleSceneDictionaryAssetRoute(
        decodeURIComponent(sceneDictionaryAssetMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "PATCH" && sceneDictionaryAssetMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleSceneDictionaryAssetRoute(
        decodeURIComponent(sceneDictionaryAssetMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const sceneRulesAssetMatch = pathname.match(/^\/api\/console\/scenes\/([^/]+)\/assets\/rules$/);
    if (method === "GET" && sceneRulesAssetMatch) {
      const result = await getConsoleSceneRulesAssetRoute(
        decodeURIComponent(sceneRulesAssetMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "PATCH" && sceneRulesAssetMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleSceneRulesAssetRoute(
        decodeURIComponent(sceneRulesAssetMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const sceneQueryProfileMatch = pathname.match(/^\/api\/console\/scenes\/([^/]+)\/bindings\/query-profile$/);
    if (method === "GET" && sceneQueryProfileMatch) {
      const result = await getConsoleSceneQueryProfileRoute(
        decodeURIComponent(sceneQueryProfileMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "PATCH" && sceneQueryProfileMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleSceneQueryProfileRoute(
        decodeURIComponent(sceneQueryProfileMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const sceneInputMappingMatch = pathname.match(/^\/api\/console\/scenes\/([^/]+)\/bindings\/input-mapping$/);
    if (method === "GET" && sceneInputMappingMatch) {
      const result = await getConsoleSceneInputMappingRoute(
        decodeURIComponent(sceneInputMappingMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "PATCH" && sceneInputMappingMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleSceneInputMappingRoute(
        decodeURIComponent(sceneInputMappingMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const sceneSkillBindingMatch = pathname.match(/^\/api\/console\/scenes\/([^/]+)\/bindings\/skill$/);
    if (method === "GET" && sceneSkillBindingMatch) {
      const result = await getConsoleSceneSkillBindingRoute(
        decodeURIComponent(sceneSkillBindingMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "PATCH" && sceneSkillBindingMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleSceneSkillBindingRoute(
        decodeURIComponent(sceneSkillBindingMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const sceneWorkflowMatch = pathname.match(/^\/api\/console\/scenes\/([^/]+)\/workflow$/);
    if (method === "GET" && sceneWorkflowMatch) {
      const result = await getConsoleSceneWorkflowRoute(
        decodeURIComponent(sceneWorkflowMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const shadowDetailMatch = pathname.match(/^\/api\/console\/runs\/([^/]+)\/shadow$/);
    if (method === "GET" && shadowDetailMatch) {
      const result = await getConsoleShadowRoute(decodeURIComponent(shadowDetailMatch[1]));
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const runDetailMatch = pathname.match(/^\/api\/console\/runs\/([^/]+)$/);
    if (method === "GET" && runDetailMatch) {
      const result = await getConsoleRunRoute(decodeURIComponent(runDetailMatch[1]));
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const traceDetailMatch = pathname.match(/^\/api\/console\/traces\/([^/]+)$/);
    if (method === "GET" && traceDetailMatch) {
      const result = await getConsoleTraceRoute(decodeURIComponent(traceDetailMatch[1]));
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/configs/catalog") {
      const result = await getConsoleConfigCatalogRoute();
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const toolStructuredConfigMatch = pathname.match(/^\/api\/console\/configs\/tools\/([^/]+)$/);
    if (method === "PATCH" && toolStructuredConfigMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleToolStructuredConfigRoute(
        decodeURIComponent(toolStructuredConfigMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const queryStructuredConfigMatch = pathname.match(/^\/api\/console\/configs\/queries\/([^/]+)$/);
    if (method === "PATCH" && queryStructuredConfigMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleQueryStructuredConfigRoute(
        decodeURIComponent(queryStructuredConfigMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "POST" && pathname === "/api/console/configs/validate") {
      const body = await readJsonBody(req);
      const result = await validateConsoleConfigsRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "POST" && pathname === "/api/console/configs/compile-preview") {
      const body = await readJsonBody(req);
      const result = await compileConsoleConfigPreviewRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/audit/revisions") {
      const result = await listConsoleRevisionsRoute(url);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const revisionDetailMatch = pathname.match(/^\/api\/console\/audit\/revisions\/([^/]+)$/);
    if (method === "GET" && revisionDetailMatch) {
      const result = await getConsoleRevisionDetailRoute(
        decodeURIComponent(revisionDetailMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/rollout/report") {
      const result = await getConsoleRolloutReportRoute();
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/releases/status") {
      const result = await getConsoleReleaseStatusRoute(url);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const releaseRollbackMatch = pathname.match(/^\/api\/console\/releases\/([^/]+)\/rollback$/);
    if (method === "POST" && releaseRollbackMatch) {
      const body = await readJsonBody(req);
      const result = await rollbackConsoleReleaseRoute(
        decodeURIComponent(releaseRollbackMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const routingChangePreviewMatch = pathname.match(/^\/api\/console\/routing\/scenes\/([^/]+)\/change-preview$/);
    if (method === "POST" && routingChangePreviewMatch) {
      const body = await readJsonBody(req);
      const result = await previewConsoleSceneRoutingChangeRoute(
        decodeURIComponent(routingChangePreviewMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const routingSceneMatch = pathname.match(/^\/api\/console\/routing\/scenes\/([^/]+)$/);
    if (method === "GET" && routingSceneMatch) {
      const result = await getConsoleSceneRoutingRoute(
        decodeURIComponent(routingSceneMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "POST" && pathname === "/api/agent/run") {
      const body = await readJsonBody(req);
      const result = await runAgentRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    sendJson(res, 404, buildErrorResponse(
      createAppError("INVALID_REQUEST", `Route not found: ${method} ${pathname}.`, {
        httpStatus: 404,
        stage: "request-route"
      }),
      null
    ));
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    error("server.unhandled", {
      code: appError.code,
      httpStatus: appError.httpStatus,
      stage: appError.stage
    });
    sendJson(res, appError.httpStatus, buildErrorResponse(appError, null));
  }
});

server.listen(API_PORT, API_HOST, () => {
  info("api.server.started", {
    port: API_PORT,
    host: API_HOST
  });
});
