const path = require("path");
const { loadPlatformResources } = require("../compiler/validate");
const { createAppError } = require("../../utils/errors");

const PLATFORM_BASE_DIR = path.resolve(__dirname, "..");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function loadRegistrySnapshot() {
  const resources = loadPlatformResources(PLATFORM_BASE_DIR);
  const toolsByRef = new Map();
  const queriesByRef = new Map();
  const skillsByScene = new Map();

  for (const record of resources.tools) {
    const ref = record?.document?.spec?.ref;
    if (ref) {
      toolsByRef.set(ref, record.document);
    }
  }

  for (const record of resources.queries) {
    const ref = record?.document?.spec?.ref;
    if (ref) {
      queriesByRef.set(ref, record.document);
    }
  }

  for (const record of resources.skills) {
    const scene = record?.document?.spec?.scene;
    if (scene && !skillsByScene.has(scene)) {
      skillsByScene.set(scene, record.document);
    }
  }

  return {
    toolsByRef,
    queriesByRef,
    skillsByScene
  };
}

function resolveWorkflowBinding(state) {
  return isObject(state?.scene_contract?.workflow_binding)
    ? state.scene_contract.workflow_binding
    : {};
}

function resolveSkillSpec(state, registrySnapshot, explicitSkillSpec = null) {
  if (isObject(explicitSkillSpec)) {
    return explicitSkillSpec;
  }

  const workflowBinding = resolveWorkflowBinding(state);
  if (isObject(workflowBinding.skillSpec)) {
    return workflowBinding.skillSpec;
  }

  if (isObject(workflowBinding.skill_spec)) {
    return workflowBinding.skill_spec;
  }

  const scene = state?.request?.scene || null;
  const skillDocument = scene ? registrySnapshot.skillsByScene.get(scene) : null;
  if (isObject(skillDocument?.spec)) {
    return skillDocument.spec;
  }

  throw createAppError("INVALID_REQUEST", `No BusinessSkill config found for scene ${scene || "unknown"}.`, {
    stage: "workflow-node"
  });
}

function resolveNodeOverride({
  state,
  skillSpec,
  nodeId,
  fallbackNodeId = null
} = {}) {
  const workflowBinding = resolveWorkflowBinding(state);
  const nodeOverrides = isObject(skillSpec?.nodeOverrides)
    ? skillSpec.nodeOverrides
    : {};
  const bindingNodeOverrides = isObject(workflowBinding?.nodeOverrides)
    ? workflowBinding.nodeOverrides
    : isObject(workflowBinding?.node_overrides)
      ? workflowBinding.node_overrides
      : {};
  const overrideKey = nodeId && nodeOverrides[nodeId]
    ? nodeId
    : fallbackNodeId && nodeOverrides[fallbackNodeId]
      ? fallbackNodeId
      : nodeId;
  const bindingKey = nodeId && bindingNodeOverrides[nodeId]
    ? nodeId
    : fallbackNodeId && bindingNodeOverrides[fallbackNodeId]
      ? fallbackNodeId
      : nodeId;

  return {
    ...(isObject(nodeOverrides[overrideKey]) ? nodeOverrides[overrideKey] : {}),
    ...(isObject(bindingNodeOverrides[bindingKey]) ? bindingNodeOverrides[bindingKey] : {})
  };
}

function resolveToolDocumentByRole({
  registrySnapshot,
  skillSpec,
  toolRole,
  toolRef = null
} = {}) {
  const binding = isObject(skillSpec?.toolBindings?.[toolRole])
    ? skillSpec.toolBindings[toolRole]
    : null;
  const resolvedToolRef = toolRef || binding?.toolRef || null;

  if (!resolvedToolRef) {
    throw createAppError("INVALID_REQUEST", `No toolRef configured for toolRole=${toolRole || "missing"}.`, {
      stage: "workflow-node"
    });
  }

  const toolDocument = registrySnapshot.toolsByRef.get(resolvedToolRef);
  if (!toolDocument?.spec) {
    throw createAppError("INVALID_REQUEST", `Unknown toolRef ${resolvedToolRef}.`, {
      stage: "workflow-node"
    });
  }

  if (toolDocument.spec.toolRole !== toolRole) {
    throw createAppError(
      "INVALID_REQUEST",
      `Tool ${resolvedToolRef} does not match expected toolRole ${toolRole}.`,
      {
        stage: "workflow-node"
      }
    );
  }

  return {
    toolDocument,
    toolRef: resolvedToolRef,
    binding
  };
}

function normalizePathExpression(pathExpression) {
  return String(pathExpression || "").trim();
}

function tokenizePath(pathExpression) {
  return normalizePathExpression(pathExpression)
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getValueBySegments(source, segments) {
  let current = source;
  for (const segment of segments) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function buildStatePathCandidates(pathExpression) {
  const normalized = normalizePathExpression(pathExpression);
  if (!normalized) {
    return [];
  }

  const candidates = [normalized];

  if (normalized.startsWith("runtime.")) {
    candidates.push(`runtime_context.${normalized.slice("runtime.".length)}`);
  }

  if (normalized.startsWith("draft.")) {
    candidates.push(`artifacts.draft.${normalized.slice("draft.".length)}`);
  }

  if (normalized.startsWith("validation.")) {
    candidates.push(`artifacts.validation.${normalized.slice("validation.".length)}`);
  }

  if (normalized.startsWith("facts.")) {
    candidates.push(`artifacts.facts.${normalized.slice("facts.".length)}`);
  }

  if (normalized.startsWith("knowledge.")) {
    candidates.push(`artifacts.knowledge.${normalized.slice("knowledge.".length)}`);
  }

  if (normalized.startsWith("references.")) {
    candidates.push(`artifacts.references.${normalized.slice("references.".length)}`);
  }

  if (normalized.startsWith("request.bizParams.")) {
    const suffix = normalized.slice("request.bizParams.".length);
    candidates.push(`request.normalized.biz_params.${suffix}`);
    candidates.push(`request.biz_params.${suffix}`);
  }

  if (normalized.startsWith("request.biz_params.")) {
    const suffix = normalized.slice("request.biz_params.".length);
    candidates.push(`request.normalized.biz_params.${suffix}`);
  }

  if (normalized.startsWith("request.normalized.bizParams.")) {
    const suffix = normalized.slice("request.normalized.bizParams.".length);
    candidates.push(`request.normalized.biz_params.${suffix}`);
  }

  return Array.from(new Set(candidates));
}

function readStatePath(state, pathExpression) {
  const candidates = buildStatePathCandidates(pathExpression);
  for (const candidate of candidates) {
    const value = getValueBySegments(state, tokenizePath(candidate));
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function buildToolRequestPayload(state, toolDocument) {
  const inputSources = isObject(toolDocument?.spec?.requestContract?.inputSources)
    ? toolDocument.spec.requestContract.inputSources
    : {};
  const payload = {};

  for (const [fieldName, pathExpression] of Object.entries(inputSources)) {
    payload[fieldName] = readStatePath(state, pathExpression);
  }

  const missingFields = (toolDocument?.spec?.requestContract?.requiredFields || [])
    .filter((fieldName) => payload[fieldName] === undefined || payload[fieldName] === null || payload[fieldName] === "");

  if (missingFields.length > 0) {
    throw createAppError(
      "INVALID_REQUEST",
      `Tool request is missing required fields: ${missingFields.join(", ")}.`,
      {
        stage: "workflow-node",
        details: {
          toolRef: toolDocument?.spec?.ref || null,
          missingFields
        }
      }
    );
  }

  return payload;
}

function resolveRetryMaxAttempts(nodeOverride, fallbackValue = 0) {
  const raw = Number(nodeOverride?.retry?.maxAttempts ?? fallbackValue);
  if (!Number.isFinite(raw) || raw < 0) {
    return fallbackValue;
  }

  return Math.floor(raw);
}

function appendEndpointPath(baseUrl, endpoint) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) {
    return endpoint;
  }

  try {
    const parsedEndpoint = new URL(endpoint);
    return `${base}${parsedEndpoint.pathname}${parsedEndpoint.search || ""}`;
  } catch {
    return endpoint;
  }
}

function resolveHttpEndpoint(toolDocument) {
  const endpoint = toolDocument?.spec?.driver?.endpoint;
  if (!endpoint) {
    return endpoint;
  }

  const ref = String(toolDocument?.spec?.ref || "");
  const toolRole = String(toolDocument?.spec?.toolRole || "");
  const category = String(toolDocument?.spec?.category || "");

  if (ref.includes("sales-opportunity-context-helper")) {
    return appendEndpointPath(process.env.CONTEXT_HELPER_BASE_URL, endpoint);
  }

  if (ref.includes("sales-opportunity-directdb-runner")) {
    return appendEndpointPath(process.env.DIRECTDB_RUNNER_BASE_URL, endpoint);
  }

  if (toolRole === "output_validator") {
    return appendEndpointPath(process.env.MODEL_TOOL_BASE_URL, endpoint);
  }

  if (toolRole === "knowledge_retriever" || category === "knowledge") {
    return appendEndpointPath(process.env.RAG_SERVICE_BASE_URL, endpoint);
  }

  return endpoint;
}

module.exports = {
  PLATFORM_BASE_DIR,
  buildToolRequestPayload,
  isObject,
  loadRegistrySnapshot,
  readStatePath,
  resolveHttpEndpoint,
  resolveNodeOverride,
  resolveRetryMaxAttempts,
  resolveSkillSpec,
  resolveToolDocumentByRole,
  resolveWorkflowBinding
};
