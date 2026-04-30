const {
  createRagDbSyncJob,
  deleteRagDocument,
  deleteRagDbSyncJob,
  getRagDocument,
  getRagDocumentOriginal,
  getRagDbSyncJob,
  getRagHealth,
  getRagJob,
  inspectRagDbSyncColumns,
  listRagDocumentChunks,
  listRagDocuments,
  listRagDbSyncJobs,
  listRagJobs,
  runRagDbSyncJob,
  reindexRagDocument,
  updateRagDocumentChunks,
  updateRagDocument,
  updateRagDbSyncJob,
  uploadRagDocument,
  searchRag
} = require("../services/console-rag");
const {
  getConsoleRagSettings,
  updateConsoleRagSettings
} = require("../services/console-configs");
const { buildErrorResponse, buildSuccessResponse, normalizeError } = require("../utils/errors");
const { buildRequestId } = require("../utils/request-id");

async function getConsoleRagHealthRoute() {
  const requestId = buildRequestId();

  try {
    const data = await getRagHealth();
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function searchConsoleRagRoute(body = {}) {
  const requestId = buildRequestId();

  try {
    const data = await searchRag(body);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function listConsoleRagDocumentsRoute(url) {
  const requestId = buildRequestId();

  try {
    const query = {
      keyword: url?.searchParams?.get("keyword") || undefined,
      sourceType: url?.searchParams?.get("sourceType") || url?.searchParams?.get("source_type") || undefined
    };
    const data = await listRagDocuments(query);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function uploadConsoleRagDocumentRoute(body = {}) {
  const requestId = buildRequestId();

  try {
    const data = await uploadRagDocument(body);
    return {
      statusCode: 201,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function getConsoleRagDocumentRoute(docId) {
  const requestId = buildRequestId();

  try {
    const data = await getRagDocument(docId);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function getConsoleRagDocumentOriginalRoute(docId) {
  const requestId = buildRequestId();

  try {
    const data = await getRagDocumentOriginal(docId);
    return {
      statusCode: 200,
      headers: data.headers,
      body: data.body
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function updateConsoleRagDocumentRoute(docId, body = {}) {
  const requestId = buildRequestId();

  try {
    const data = await updateRagDocument(docId, body);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function deleteConsoleRagDocumentRoute(docId) {
  const requestId = buildRequestId();

  try {
    const data = await deleteRagDocument(docId);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function reindexConsoleRagDocumentRoute(docId, body = {}) {
  const requestId = buildRequestId();

  try {
    const data = await reindexRagDocument(docId, body);
    return {
      statusCode: 202,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function listConsoleRagDocumentChunksRoute(docId, url) {
  const requestId = buildRequestId();

  try {
    const query = {
      limit: url?.searchParams?.get("limit") || undefined
    };
    const data = await listRagDocumentChunks(docId, query);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function updateConsoleRagDocumentChunksRoute(docId, body = {}) {
  const requestId = buildRequestId();

  try {
    const data = await updateRagDocumentChunks(docId, body);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function listConsoleRagJobsRoute(url) {
  const requestId = buildRequestId();

  try {
    const query = {
      limit: url?.searchParams?.get("limit") || undefined,
      type: url?.searchParams?.get("type") || url?.searchParams?.get("jobType") || undefined,
      status: url?.searchParams?.get("status") || undefined
    };
    const data = await listRagJobs(query);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function getConsoleRagJobRoute(jobId) {
  const requestId = buildRequestId();

  try {
    const data = await getRagJob(jobId);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function listConsoleRagDbSyncJobsRoute(url) {
  const requestId = buildRequestId();

  try {
    const query = {
      keyword: url?.searchParams?.get("keyword") || undefined,
      active: url?.searchParams?.get("active") || undefined
    };
    const data = await listRagDbSyncJobs(query);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function createConsoleRagDbSyncJobRoute(body = {}) {
  const requestId = buildRequestId();

  try {
    const data = await createRagDbSyncJob(body);
    return {
      statusCode: 201,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function getConsoleRagDbSyncJobRoute(syncJobId, url) {
  const requestId = buildRequestId();

  try {
    const query = {
      stateLimit: url?.searchParams?.get("stateLimit") || undefined
    };
    const data = await getRagDbSyncJob(syncJobId, query);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function updateConsoleRagDbSyncJobRoute(syncJobId, body = {}) {
  const requestId = buildRequestId();

  try {
    const data = await updateRagDbSyncJob(syncJobId, body);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function deleteConsoleRagDbSyncJobRoute(syncJobId) {
  const requestId = buildRequestId();

  try {
    const data = await deleteRagDbSyncJob(syncJobId);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function runConsoleRagDbSyncJobRoute(syncJobId, body = {}) {
  const requestId = buildRequestId();

  try {
    const data = await runRagDbSyncJob(syncJobId, body);
    return {
      statusCode: 202,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function inspectConsoleRagDbSyncColumnsRoute(syncJobId) {
  const requestId = buildRequestId();

  try {
    const data = await inspectRagDbSyncColumns(syncJobId);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function getConsoleRagSettingsRoute() {
  const requestId = buildRequestId();

  try {
    const data = await getConsoleRagSettings();
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

async function updateConsoleRagSettingsRoute(body = {}) {
  const requestId = buildRequestId();

  try {
    const data = await updateConsoleRagSettings(body);
    return {
      statusCode: 200,
      payload: buildSuccessResponse(data, requestId)
    };
  } catch (caughtError) {
    const appError = normalizeError(caughtError);
    return {
      statusCode: appError.httpStatus,
      payload: buildErrorResponse(appError, requestId)
    };
  }
}

module.exports = {
  createConsoleRagDbSyncJobRoute,
  deleteConsoleRagDocumentRoute,
  deleteConsoleRagDbSyncJobRoute,
  getConsoleRagDocumentRoute,
  getConsoleRagDocumentOriginalRoute,
  getConsoleRagDbSyncJobRoute,
  getConsoleRagHealthRoute,
  getConsoleRagJobRoute,
  getConsoleRagSettingsRoute,
  inspectConsoleRagDbSyncColumnsRoute,
  listConsoleRagDocumentChunksRoute,
  listConsoleRagDocumentsRoute,
  listConsoleRagDbSyncJobsRoute,
  listConsoleRagJobsRoute,
  reindexConsoleRagDocumentRoute,
  runConsoleRagDbSyncJobRoute,
  updateConsoleRagDocumentChunksRoute,
  updateConsoleRagDocumentRoute,
  updateConsoleRagDbSyncJobRoute,
  updateConsoleRagSettingsRoute,
  uploadConsoleRagDocumentRoute,
  searchConsoleRagRoute
};
