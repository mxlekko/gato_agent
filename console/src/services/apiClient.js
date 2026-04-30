import { requestJson } from "./httpClient";

function buildQueryString(params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, String(value));
    }
  }

  const suffix = query.toString();
  return suffix ? `?${suffix}` : "";
}

const RAG_SETTINGS_RESOURCE_ID = "rag-settings:default@v1";

export const apiClient = {
  getReleaseStatus(params = {}) {
    const suffix = buildQueryString(params);
    return requestJson(`/api/console/releases/status${suffix}`);
  },
  listScenes() {
    return requestJson("/api/console/scenes");
  },
  getSceneWorkflow(scene) {
    return requestJson(`/api/console/scenes/${scene}/workflow`);
  },
  getScenePromptAsset(scene) {
    return requestJson(`/api/console/scenes/${scene}/assets/prompt`);
  },
  updateScenePromptAsset(scene, body) {
    return requestJson(`/api/console/scenes/${scene}/assets/prompt`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },
  getSceneSchemaAsset(scene) {
    return requestJson(`/api/console/scenes/${scene}/assets/schema`);
  },
  updateSceneSchemaAsset(scene, body) {
    return requestJson(`/api/console/scenes/${scene}/assets/schema`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },
  getSceneDictionaryAsset(scene) {
    return requestJson(`/api/console/scenes/${scene}/assets/dictionary`);
  },
  updateSceneDictionaryAsset(scene, body) {
    return requestJson(`/api/console/scenes/${scene}/assets/dictionary`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },
  getSceneRulesAsset(scene) {
    return requestJson(`/api/console/scenes/${scene}/assets/rules`);
  },
  updateSceneRulesAsset(scene, body) {
    return requestJson(`/api/console/scenes/${scene}/assets/rules`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },
  getSceneQueryProfileConfig(scene) {
    return requestJson(`/api/console/scenes/${scene}/bindings/query-profile`);
  },
  updateSceneQueryProfileConfig(scene, body) {
    return requestJson(`/api/console/scenes/${scene}/bindings/query-profile`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },
  getSceneInputMappingConfig(scene) {
    return requestJson(`/api/console/scenes/${scene}/bindings/input-mapping`);
  },
  updateSceneInputMappingConfig(scene, body) {
    return requestJson(`/api/console/scenes/${scene}/bindings/input-mapping`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },
  getSceneSkillBinding(scene) {
    return requestJson(`/api/console/scenes/${scene}/bindings/skill`);
  },
  updateSceneSkillBinding(scene, body) {
    return requestJson(`/api/console/scenes/${scene}/bindings/skill`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },
  runAgent(body) {
    return requestJson("/api/agent/run", {
      method: "POST",
      body: JSON.stringify(body)
    });
  },
  listRuns() {
    return requestJson("/api/console/runs");
  },
  getRun(runId) {
    return requestJson(`/api/console/runs/${runId}`);
  },
  getShadow(runId) {
    return requestJson(`/api/console/runs/${runId}/shadow`);
  },
  getTrace(traceId) {
    return requestJson(`/api/console/traces/${traceId}`);
  },
  getConfigCatalog() {
    return requestJson("/api/console/configs/catalog");
  },
  updateToolStructuredConfig(resourceId, body) {
    return requestJson(`/api/console/configs/tools/${encodeURIComponent(resourceId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },
  updateQueryStructuredConfig(resourceId, body) {
    return requestJson(`/api/console/configs/queries/${encodeURIComponent(resourceId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
  },
  validateConfigs(body = {}) {
    return requestJson("/api/console/configs/validate", {
      method: "POST",
      body: JSON.stringify(body)
    });
  },
  compilePreview(body) {
    return requestJson("/api/console/configs/compile-preview", {
      method: "POST",
      body: JSON.stringify(body)
    });
  },
  getRagHealth() {
    return requestJson("/api/console/rag/health");
  },
  async getRagSettings() {
    const response = await requestJson("/api/console/configs/catalog");
    if (response.ok && response.payload?.success !== false && response.payload?.data?.ragSettings) {
      return {
        ...response,
        payload: {
          ...response.payload,
          data: response.payload.data.ragSettings
        }
      };
    }

    return response;
  },
  updateRagSettings(payload) {
    return requestJson(`/api/console/configs/tools/${encodeURIComponent(RAG_SETTINGS_RESOURCE_ID)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  searchRag(payload) {
    return requestJson("/api/console/rag/search", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  listRagDocuments(params = {}) {
    return requestJson(`/api/console/rag/documents${buildQueryString(params)}`);
  },
  uploadRagDocument(payload) {
    return requestJson("/api/console/rag/documents", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  getRagDocument(docId) {
    return requestJson(`/api/console/rag/documents/${encodeURIComponent(docId)}`);
  },
  updateRagDocument(docId, payload) {
    return requestJson(`/api/console/rag/documents/${encodeURIComponent(docId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  deleteRagDocument(docId) {
    return requestJson(`/api/console/rag/documents/${encodeURIComponent(docId)}`, {
      method: "DELETE"
    });
  },
  reindexRagDocument(docId, payload = {}) {
    return requestJson(`/api/console/rag/documents/${encodeURIComponent(docId)}/reindex`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  listRagDocumentChunks(docId, params = {}) {
    return requestJson(
      `/api/console/rag/documents/${encodeURIComponent(docId)}/chunks${buildQueryString(params)}`
    );
  },
  listRagJobs(params = {}) {
    return requestJson(`/api/console/rag/jobs${buildQueryString(params)}`);
  },
  getRagJob(jobId) {
    return requestJson(`/api/console/rag/jobs/${encodeURIComponent(jobId)}`);
  },
  listRagDbSyncJobs(params = {}) {
    return requestJson(`/api/console/rag/db-sync/jobs${buildQueryString(params)}`);
  },
  createRagDbSyncJob(payload) {
    return requestJson("/api/console/rag/db-sync/jobs", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  getRagDbSyncJob(syncJobId, params = {}) {
    return requestJson(
      `/api/console/rag/db-sync/jobs/${encodeURIComponent(syncJobId)}${buildQueryString(params)}`
    );
  },
  updateRagDbSyncJob(syncJobId, payload) {
    return requestJson(`/api/console/rag/db-sync/jobs/${encodeURIComponent(syncJobId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  deleteRagDbSyncJob(syncJobId) {
    return requestJson(`/api/console/rag/db-sync/jobs/${encodeURIComponent(syncJobId)}`, {
      method: "DELETE"
    });
  },
  runRagDbSyncJob(syncJobId, payload = {}) {
    return requestJson(`/api/console/rag/db-sync/jobs/${encodeURIComponent(syncJobId)}/run`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  inspectRagDbSyncColumns(syncJobId) {
    return requestJson(
      `/api/console/rag/db-sync/jobs/${encodeURIComponent(syncJobId)}/inspect-columns`,
      {
        method: "POST",
        body: JSON.stringify({})
      }
    );
  },
  getRolloutReport() {
    return requestJson("/api/console/rollout/report");
  },
  getSceneRouting(scene) {
    return requestJson(`/api/console/routing/scenes/${scene}`);
  },
  previewSceneRoutingChange(scene, body) {
    return requestJson(`/api/console/routing/scenes/${scene}/change-preview`, {
      method: "POST",
      body: JSON.stringify(body)
    });
  }
};
