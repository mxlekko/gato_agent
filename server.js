require("./utils/load-env").loadProjectEnv();

const http = require("http");
const crypto = require("crypto");
const { runAgentRoute } = require("./routes/agent");
const {
  createConsoleSceneRoute,
  deleteConsoleSceneRoute,
  getConsoleSceneDictionaryAssetRoute,
  getConsoleSceneInputMappingRoute,
  getConsoleScenePromptAssetRoute,
  getConsoleSceneQueryProfileRoute,
  getConsoleSceneRulesAssetRoute,
  getConsoleSceneSchemaAssetRoute,
  getConsoleSceneSkillBindingRoute,
  getConsoleSceneWorkflowRoute,
  listConsoleSceneTemplatesRoute,
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
  publishConsoleReleaseRoute,
  rollbackConsoleReleaseRoute
} = require("./routes/console-releases");
const { getConsoleRunRoute, listConsoleRunsRoute } = require("./routes/console-runs");
const { getConsoleTraceRoute } = require("./routes/console-traces");
const {
  createConsoleRagDbSyncJobRoute,
  deleteConsoleRagDocumentRoute,
  deleteConsoleRagDbSyncJobRoute,
  getConsoleRagDocumentRoute,
  getConsoleRagDbSyncJobRoute,
  getConsoleRagHealthRoute,
  getConsoleRagJobRoute,
  getConsoleRagDocumentOriginalRoute,
  inspectConsoleRagDbSyncColumnsRoute,
  listConsoleRagDocumentChunksRoute,
  listConsoleRagDocumentsRoute,
  listConsoleRagDbSyncJobsRoute,
  listConsoleRagJobsRoute,
  reindexConsoleRagDocumentRoute,
  runConsoleRagDbSyncJobRoute,
  searchConsoleRagRoute,
  updateConsoleRagDocumentChunksRoute,
  updateConsoleRagDocumentRoute,
  updateConsoleRagDbSyncJobRoute,
  uploadConsoleRagDocumentRoute
} = require("./routes/console-rag");
const { compileWorkflowGraphForScene } = require("./platform/compiler/compile-workflow");
const { buildErrorResponse, buildSuccessResponse, createAppError, normalizeError } = require("./utils/errors");
const { info, error } = require("./utils/logger");

const API_HOST = process.env.API_HOST || "0.0.0.0";
const API_PORT = Number(process.env.API_PORT || 3000);
const HEALTH_PROBE_TIMEOUT_MS = Number(process.env.HEALTH_PROBE_TIMEOUT_MS || 1500);
const CONSOLE_ADMIN_TOKEN = String(process.env.CONSOLE_ADMIN_TOKEN || "").trim();
const MUTATING_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LANGGRAPH_HEALTH_SCENES = [
  "payment-info-split",
  "sales-opportunity-advisor",
  "sales-opportunity-advisor-directdb",
  "sales-opportunity-smart-entry",
  "special-custom-product-solution"
];

function isProductionLikeMode() {
  return [process.env.NODE_ENV, process.env.APP_ENV, process.env.CONFIG_ACTIVE_ENV]
    .some((value) => ["production", "prod"].includes(String(value || "").trim().toLowerCase()))
    || ["1", "true", "yes", "on"].includes(String(process.env.CONFIG_REQUIRE_ACTIVE_BUNDLE || "").trim().toLowerCase());
}

function isLoopbackAddress(address = "") {
  const normalized = String(address || "").trim();
  return normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1";
}

function extractConsoleAdminToken(req) {
  const explicitHeader = req.headers["x-console-admin-token"] || req.headers["x-admin-token"];
  if (Array.isArray(explicitHeader)) {
    return String(explicitHeader[0] || "").trim();
  }
  if (explicitHeader) {
    return String(explicitHeader).trim();
  }

  const authorization = req.headers.authorization;
  const authorizationValue = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  const bearerMatch = String(authorizationValue || "").match(/^Bearer\s+(.+)$/i);
  return bearerMatch ? bearerMatch[1].trim() : "";
}

function safeTokenEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireConsoleAdminAccess(req, operation) {
  if (CONSOLE_ADMIN_TOKEN) {
    const suppliedToken = extractConsoleAdminToken(req);
    if (!suppliedToken || !safeTokenEquals(suppliedToken, CONSOLE_ADMIN_TOKEN)) {
      throw createAppError("ACCESS_DENIED", "Console admin token is required for this operation.", {
        stage: "authorize-console",
        details: {
          operation
        }
      });
    }
    return;
  }

  if (isProductionLikeMode()) {
    throw createAppError("ACCESS_DENIED", "CONSOLE_ADMIN_TOKEN must be configured for mutating console operations in production mode.", {
      stage: "authorize-console",
      details: {
        operation
      }
    });
  }

  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    throw createAppError("ACCESS_DENIED", "Mutating console operations without CONSOLE_ADMIN_TOKEN are restricted to loopback clients.", {
      stage: "authorize-console",
      details: {
        operation,
        remoteAddress: req.socket?.remoteAddress || null
      }
    });
  }
}

function protectMutatingConsoleRoute(req, method, pathname) {
  if (MUTATING_HTTP_METHODS.has(method) && pathname.startsWith("/api/console/")) {
    requireConsoleAdminAccess(req, `${method} ${pathname}`);
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendBinary(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers || {
    "Content-Type": "application/octet-stream"
  });
  res.end(body);
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

function buildHealthUrl(port, pathname = "/health") {
  return `http://127.0.0.1:${port}${pathname}`;
}

function buildServiceHealthUrl({ baseUrl, port }) {
  if (!baseUrl) {
    return buildHealthUrl(port);
  }

  try {
    const parsed = new URL(baseUrl);
    const basePath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return new URL(`${basePath}/health`, parsed).toString();
  } catch {
    return buildHealthUrl(port);
  }
}

function buildRagHealthUrl() {
  const rawBaseUrl = process.env.RAG_SERVICE_BASE_URL
    || `http://${process.env.RAG_SEARCH_HOST || "127.0.0.1"}:${process.env.RAG_SEARCH_PORT || "19104"}`;

  try {
    const parsed = new URL(rawBaseUrl);
    const basePath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return new URL(`${basePath}/health`, parsed).toString();
  } catch {
    return buildHealthUrl(19104);
  }
}

function getProjectServiceHealthTargets() {
  return [
    {
      key: "contextHelper",
      name: "ContextHelper",
      required: true,
      url: buildServiceHealthUrl({
        baseUrl: process.env.CONTEXT_HELPER_BASE_URL,
        port: Number(process.env.CONTEXT_HELPER_PORT || 19101)
      })
    },
    {
      key: "directDbRunner",
      name: "DirectDbRunner",
      required: true,
      url: buildServiceHealthUrl({
        baseUrl: process.env.DIRECTDB_RUNNER_BASE_URL,
        port: Number(process.env.DIRECTDB_RUNNER_PORT || 19102)
      })
    },
    {
      key: "modelTool",
      name: "ModelTool",
      required: true,
      url: buildServiceHealthUrl({
        baseUrl: process.env.MODEL_TOOL_BASE_URL,
        port: Number(process.env.MODEL_TOOL_PORT || 19103)
      })
    },
    {
      key: "rag",
      name: "RAG",
      required: false,
      url: buildRagHealthUrl()
    }
  ];
}

async function probeHealthTarget(target) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(target.url, {
      method: "GET",
      signal: controller.signal
    });

    return {
      name: target.name,
      required: target.required,
      ok: response.ok,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      url: target.url
    };
  } catch (caughtError) {
    return {
      name: target.name,
      required: target.required,
      ok: false,
      durationMs: Date.now() - startedAt,
      url: target.url,
      error: caughtError?.name === "AbortError" ? "timeout" : caughtError?.message || "request_failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function checkLangGraphRuntime() {
  const sceneResults = LANGGRAPH_HEALTH_SCENES.map((scene) => {
    try {
      const graph = compileWorkflowGraphForScene({ scene });
      return {
        scene,
        ok: true,
        engine: "langgraph-stategraph",
        nodeCount: Array.isArray(graph?.orderedNodeIds) ? graph.orderedNodeIds.length : 0,
        entryNode: graph?.entryNode || null,
        exitNode: graph?.exitNode || null
      };
    } catch (caughtError) {
      const appError = normalizeError(caughtError);
      return {
        scene,
        ok: false,
        engine: "langgraph-stategraph",
        error: {
          code: appError.code,
          message: appError.message,
          stage: appError.stage
        }
      };
    }
  });

  return {
    ok: sceneResults.every((item) => item.ok),
    engine: "langgraph-stategraph",
    scenes: sceneResults
  };
}

async function checkProjectRuntimeHealth() {
  const dependencyEntries = await Promise.all(
    getProjectServiceHealthTargets().map(async (target) => [
      target.key,
      await probeHealthTarget(target)
    ])
  );
  const dependencies = Object.fromEntries(dependencyEntries);
  const langgraphRuntime = checkLangGraphRuntime();
  const requiredDependenciesOk = Object.values(dependencies)
    .filter((item) => item.required)
    .every((item) => item.ok);
  const ok = requiredDependenciesOk && langgraphRuntime.ok;

  return {
    status: ok ? "ok" : "degraded",
    api: {
      ok: true,
      host: API_HOST,
      port: API_PORT
    },
    langgraphRuntime,
    dependencies
  };
}

async function handleHealth(_req, res) {
  try {
    const health = await checkProjectRuntimeHealth();
    sendJson(res, 200, buildSuccessResponse({
      service: health.status,
      ...health
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
    protectMutatingConsoleRoute(req, method, pathname);

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

    if (method === "GET" && pathname === "/api/console/rag/health") {
      const result = await getConsoleRagHealthRoute();
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "POST" && pathname === "/api/console/rag/search") {
      const body = await readJsonBody(req);
      const result = await searchConsoleRagRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/rag/documents") {
      const result = await listConsoleRagDocumentsRoute(url);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "POST" && pathname === "/api/console/rag/documents") {
      const body = await readJsonBody(req);
      const result = await uploadConsoleRagDocumentRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const ragDocumentReindexMatch = pathname.match(/^\/api\/console\/rag\/documents\/([^/]+)\/reindex$/);
    if (method === "POST" && ragDocumentReindexMatch) {
      const body = await readJsonBody(req);
      const result = await reindexConsoleRagDocumentRoute(
        decodeURIComponent(ragDocumentReindexMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const ragDocumentChunksMatch = pathname.match(/^\/api\/console\/rag\/documents\/([^/]+)\/chunks$/);
    if (method === "GET" && ragDocumentChunksMatch) {
      const result = await listConsoleRagDocumentChunksRoute(
        decodeURIComponent(ragDocumentChunksMatch[1]),
        url
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "PUT" && ragDocumentChunksMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleRagDocumentChunksRoute(
        decodeURIComponent(ragDocumentChunksMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const ragDocumentOriginalMatch = pathname.match(/^\/api\/console\/rag\/documents\/([^/]+)\/original$/);
    if (method === "GET" && ragDocumentOriginalMatch) {
      const result = await getConsoleRagDocumentOriginalRoute(decodeURIComponent(ragDocumentOriginalMatch[1]));
      if (result.body) {
        sendBinary(res, result.statusCode, result.headers, result.body);
      } else {
        sendJson(res, result.statusCode, result.payload);
      }
      return;
    }

    const ragDocumentMatch = pathname.match(/^\/api\/console\/rag\/documents\/([^/]+)$/);
    if (method === "GET" && ragDocumentMatch) {
      const result = await getConsoleRagDocumentRoute(decodeURIComponent(ragDocumentMatch[1]));
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "PATCH" && ragDocumentMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleRagDocumentRoute(
        decodeURIComponent(ragDocumentMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "DELETE" && ragDocumentMatch) {
      const result = await deleteConsoleRagDocumentRoute(decodeURIComponent(ragDocumentMatch[1]));
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/rag/jobs") {
      const result = await listConsoleRagJobsRoute(url);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const ragJobMatch = pathname.match(/^\/api\/console\/rag\/jobs\/([^/]+)$/);
    if (method === "GET" && ragJobMatch) {
      const result = await getConsoleRagJobRoute(decodeURIComponent(ragJobMatch[1]));
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/rag/db-sync/jobs") {
      const result = await listConsoleRagDbSyncJobsRoute(url);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "POST" && pathname === "/api/console/rag/db-sync/jobs") {
      const body = await readJsonBody(req);
      const result = await createConsoleRagDbSyncJobRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const ragDbSyncInspectColumnsMatch = pathname.match(/^\/api\/console\/rag\/db-sync\/jobs\/([^/]+)\/inspect-columns$/);
    if (method === "POST" && ragDbSyncInspectColumnsMatch) {
      const result = await inspectConsoleRagDbSyncColumnsRoute(
        decodeURIComponent(ragDbSyncInspectColumnsMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const ragDbSyncRunMatch = pathname.match(/^\/api\/console\/rag\/db-sync\/jobs\/([^/]+)\/run$/);
    if (method === "POST" && ragDbSyncRunMatch) {
      const body = await readJsonBody(req);
      const result = await runConsoleRagDbSyncJobRoute(
        decodeURIComponent(ragDbSyncRunMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const ragDbSyncMatch = pathname.match(/^\/api\/console\/rag\/db-sync\/jobs\/([^/]+)$/);
    if (method === "GET" && ragDbSyncMatch) {
      const result = await getConsoleRagDbSyncJobRoute(
        decodeURIComponent(ragDbSyncMatch[1]),
        url
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "PATCH" && ragDbSyncMatch) {
      const body = await readJsonBody(req);
      const result = await updateConsoleRagDbSyncJobRoute(
        decodeURIComponent(ragDbSyncMatch[1]),
        body
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "DELETE" && ragDbSyncMatch) {
      const result = await deleteConsoleRagDbSyncJobRoute(
        decodeURIComponent(ragDbSyncMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/scenes") {
      const result = await listConsoleScenesRoute();
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "POST" && pathname === "/api/console/scenes") {
      const body = await readJsonBody(req);
      const result = await createConsoleSceneRoute(body);
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    const sceneRootMatch = pathname.match(/^\/api\/console\/scenes\/([^/]+)$/);
    if (method === "DELETE" && sceneRootMatch) {
      const result = await deleteConsoleSceneRoute(
        decodeURIComponent(sceneRootMatch[1])
      );
      sendJson(res, result.statusCode, result.payload);
      return;
    }

    if (method === "GET" && pathname === "/api/console/scene-templates") {
      const result = await listConsoleSceneTemplatesRoute();
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

    if (method === "POST" && pathname === "/api/console/releases/publish") {
      const body = await readJsonBody(req);
      const result = await publishConsoleReleaseRoute(body);
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
