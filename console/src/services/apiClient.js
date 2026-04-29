import { requestJson } from "./httpClient";

export const apiClient = {
  getReleaseStatus(params = {}) {
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        query.set(key, String(value));
      }
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";
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
