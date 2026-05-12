const { createAppError } = require("../utils/errors");

const DEFAULT_RAG_SERVICE_BASE_URL = "http://127.0.0.1:19104";
const DEFAULT_RAG_PROXY_TIMEOUT_MS = 15000;
const DEFAULT_RAG_CHUNK_UPDATE_TIMEOUT_MS = 180000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "rag"]);

function getRagServiceBaseUrl() {
  const rawBaseUrl = process.env.RAG_SERVICE_BASE_URL || DEFAULT_RAG_SERVICE_BASE_URL;
  let parsed;

  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw createAppError("INVALID_REQUEST", "RAG_SERVICE_BASE_URL must be a valid URL.", {
      stage: "console-rag-proxy",
      details: {
        baseUrl: rawBaseUrl
      }
    });
  }

  if (parsed.protocol !== "http:") {
    throw createAppError("INVALID_REQUEST", "RAG_SERVICE_BASE_URL must use http://.", {
      stage: "console-rag-proxy",
      details: {
        baseUrl: rawBaseUrl
      }
    });
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw createAppError("ACCESS_DENIED", "RAG proxy only allows loopback service URLs.", {
      stage: "console-rag-proxy",
      details: {
        baseUrl: rawBaseUrl,
        hostname: parsed.hostname
      }
    });
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function parsePositiveTimeoutMs(value, fallback) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getProxyTimeoutMs() {
  return parsePositiveTimeoutMs(process.env.RAG_PROXY_TIMEOUT_MS, DEFAULT_RAG_PROXY_TIMEOUT_MS);
}

function getChunkUpdateTimeoutMs() {
  return parsePositiveTimeoutMs(
    process.env.RAG_CHUNK_UPDATE_TIMEOUT_MS,
    DEFAULT_RAG_CHUNK_UPDATE_TIMEOUT_MS
  );
}

function buildRagUrl(pathname, query = {}) {
  const baseUrl = getRagServiceBaseUrl();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const basePath = baseUrl.pathname === "/" ? "" : baseUrl.pathname.replace(/\/+$/, "");
  const url = new URL(`${basePath}${normalizedPath}`, baseUrl);

  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

async function parseJsonResponse(response, requestPath) {
  const rawText = await response.text();
  if (!rawText.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw createAppError("RAG_INVALID_RESPONSE", "RAG service returned invalid JSON.", {
      httpStatus: 502,
      stage: "console-rag-proxy",
      retryable: false,
      details: {
        requestPath,
        httpStatus: response.status,
        body: rawText
      }
    });
  }
}

function throwUpstreamError(response, payload, requestPath) {
  const upstreamError = payload && typeof payload.error === "object" ? payload.error : null;
  const code = typeof upstreamError?.code === "string" && upstreamError.code
    ? upstreamError.code
    : "RAG_SERVICE_ERROR";
  const message = typeof upstreamError?.message === "string" && upstreamError.message
    ? upstreamError.message
    : `RAG service request failed with HTTP ${response.status}.`;

  throw createAppError(code, message, {
    httpStatus: response.status >= 400 ? response.status : 502,
    stage: "console-rag-proxy",
    retryable: response.status >= 500,
    details: {
      requestPath,
      upstreamHttpStatus: response.status,
      upstreamError: upstreamError || null
    }
  });
}

async function requestRagJson(pathname, options = {}) {
  const method = options.method || "GET";
  const timeoutMs = parsePositiveTimeoutMs(options.timeoutMs, getProxyTimeoutMs());
  const url = buildRagUrl(pathname, options.query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const payload = await parseJsonResponse(response, pathname);

    if (!response.ok || payload?.success === false) {
      throwUpstreamError(response, payload, pathname);
    }

    return payload;
  } catch (caughtError) {
    if (caughtError?.name === "AbortError") {
      throw createAppError("RUNTIME_TIMEOUT", "RAG service request timed out.", {
        stage: "console-rag-proxy",
        details: {
          requestPath: pathname,
          timeoutMs
        }
      });
    }

    if (caughtError?.name === "AppError") {
      throw caughtError;
    }

    throw createAppError("RAG_SERVICE_UNAVAILABLE", "RAG service is unavailable.", {
      httpStatus: 502,
      stage: "console-rag-proxy",
      retryable: true,
      details: {
        requestPath: pathname,
        cause: caughtError?.message || "unknown"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestRagFile(pathname, options = {}) {
  const method = options.method || "GET";
  const timeoutMs = parsePositiveTimeoutMs(options.timeoutMs, getProxyTimeoutMs());
  const url = buildRagUrl(pathname, options.query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const rawText = await response.text();
      let payload = {};
      if (contentType.includes("application/json") && rawText.trim()) {
        try {
          payload = JSON.parse(rawText);
        } catch {
          payload = {};
        }
      }
      throwUpstreamError(response, payload, pathname);
    }

    const body = Buffer.from(await response.arrayBuffer());
    return {
      body,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/octet-stream",
        "Content-Length": String(body.length),
        "Content-Disposition": response.headers.get("content-disposition") || "inline",
        "X-Content-Type-Options": response.headers.get("x-content-type-options") || "nosniff"
      }
    };
  } catch (caughtError) {
    if (caughtError?.name === "AbortError") {
      throw createAppError("RUNTIME_TIMEOUT", "RAG service request timed out.", {
        stage: "console-rag-proxy",
        details: {
          requestPath: pathname,
          timeoutMs
        }
      });
    }

    if (caughtError?.name === "AppError") {
      throw caughtError;
    }

    throw createAppError("RAG_SERVICE_UNAVAILABLE", "RAG service is unavailable.", {
      httpStatus: 502,
      stage: "console-rag-proxy",
      retryable: true,
      details: {
        requestPath: pathname,
        cause: caughtError?.message || "unknown"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getRagJson(pathname, query = {}) {
  return requestRagJson(pathname, {
    method: "GET",
    query
  });
}

async function postRagJson(pathname, body = {}) {
  return requestRagJson(pathname, {
    method: "POST",
    body
  });
}

async function patchRagJson(pathname, body = {}) {
  return requestRagJson(pathname, {
    method: "PATCH",
    body
  });
}

async function putRagJson(pathname, body = {}, options = {}) {
  return requestRagJson(pathname, {
    method: "PUT",
    body,
    timeoutMs: options.timeoutMs
  });
}

async function deleteRagJson(pathname, body = undefined) {
  return requestRagJson(pathname, {
    method: "DELETE",
    body
  });
}

async function getRagHealth() {
  const payload = await getRagJson("/health");
  return payload.data || null;
}

async function searchRag(body = {}) {
  const payload = await postRagJson("/internal/rag/search", body);
  return payload.data || null;
}

async function listRagDocuments(query = {}) {
  const payload = await getRagJson("/internal/rag/documents", query);
  return payload.data || null;
}

async function uploadRagDocument(body = {}) {
  const payload = await postRagJson("/internal/rag/documents", body);
  return payload.data || null;
}

async function getRagDocument(docId) {
  const encodedDocId = encodeURIComponent(String(docId || ""));
  const payload = await getRagJson(`/internal/rag/documents/${encodedDocId}`);
  return payload.data || null;
}

async function getRagDocumentOriginal(docId) {
  const encodedDocId = encodeURIComponent(String(docId || ""));
  return requestRagFile(`/internal/rag/documents/${encodedDocId}/original`);
}

async function updateRagDocument(docId, body = {}) {
  const encodedDocId = encodeURIComponent(String(docId || ""));
  const payload = await patchRagJson(`/internal/rag/documents/${encodedDocId}`, body);
  return payload.data || null;
}

async function deleteRagDocument(docId) {
  const encodedDocId = encodeURIComponent(String(docId || ""));
  const payload = await deleteRagJson(`/internal/rag/documents/${encodedDocId}`);
  return payload.data || null;
}

async function reindexRagDocument(docId, body = {}) {
  const encodedDocId = encodeURIComponent(String(docId || ""));
  const payload = await postRagJson(`/internal/rag/documents/${encodedDocId}/reindex`, body);
  return payload.data || null;
}

async function listRagDocumentChunks(docId, query = {}) {
  const encodedDocId = encodeURIComponent(String(docId || ""));
  const payload = await getRagJson(`/internal/rag/documents/${encodedDocId}/chunks`, query);
  return payload.data || null;
}

async function updateRagDocumentChunks(docId, body = {}) {
  const encodedDocId = encodeURIComponent(String(docId || ""));
  const payload = await putRagJson(
    `/internal/rag/documents/${encodedDocId}/chunks`,
    body,
    { timeoutMs: getChunkUpdateTimeoutMs() }
  );
  return payload.data || null;
}

async function listRagJobs(query = {}) {
  const payload = await getRagJson("/internal/rag/jobs", query);
  return payload.data || null;
}

async function getRagJob(jobId) {
  const encodedJobId = encodeURIComponent(String(jobId || ""));
  const payload = await getRagJson(`/internal/rag/jobs/${encodedJobId}`);
  return payload.data || null;
}

async function listRagDbSyncJobs(query = {}) {
  const payload = await getRagJson("/internal/rag/db-sync/jobs", query);
  return payload.data || null;
}

async function createRagDbSyncJob(body = {}) {
  const payload = await postRagJson("/internal/rag/db-sync/jobs", body);
  return payload.data || null;
}

async function getRagDbSyncJob(syncJobId, query = {}) {
  const encodedSyncJobId = encodeURIComponent(String(syncJobId || ""));
  const payload = await getRagJson(`/internal/rag/db-sync/jobs/${encodedSyncJobId}`, query);
  return payload.data || null;
}

async function updateRagDbSyncJob(syncJobId, body = {}) {
  const encodedSyncJobId = encodeURIComponent(String(syncJobId || ""));
  const payload = await patchRagJson(`/internal/rag/db-sync/jobs/${encodedSyncJobId}`, body);
  return payload.data || null;
}

async function deleteRagDbSyncJob(syncJobId) {
  const encodedSyncJobId = encodeURIComponent(String(syncJobId || ""));
  const payload = await deleteRagJson(`/internal/rag/db-sync/jobs/${encodedSyncJobId}`);
  return payload.data || null;
}

async function runRagDbSyncJob(syncJobId, body = {}) {
  const encodedSyncJobId = encodeURIComponent(String(syncJobId || ""));
  const payload = await postRagJson(`/internal/rag/db-sync/jobs/${encodedSyncJobId}/run`, body);
  return payload.data || null;
}

async function inspectRagDbSyncColumns(syncJobId) {
  const encodedSyncJobId = encodeURIComponent(String(syncJobId || ""));
  const payload = await postRagJson(`/internal/rag/db-sync/jobs/${encodedSyncJobId}/inspect-columns`, {});
  return payload.data || null;
}

module.exports = {
  createRagDbSyncJob,
  deleteRagDocument,
  deleteRagDbSyncJob,
  deleteRagJson,
  getRagDocument,
  getRagDocumentOriginal,
  getRagDbSyncJob,
  getRagJson,
  getRagJob,
  getRagHealth,
  inspectRagDbSyncColumns,
  listRagDocumentChunks,
  listRagDocuments,
  listRagDbSyncJobs,
  listRagJobs,
  patchRagJson,
  postRagJson,
  putRagJson,
  reindexRagDocument,
  runRagDbSyncJob,
  searchRag,
  uploadRagDocument,
  updateRagDbSyncJob,
  updateRagDocument,
  updateRagDocumentChunks
};
