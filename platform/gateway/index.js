const { createHash } = require("crypto");
const { loadPlatformResources, resolvePlatformBaseDir } = require("../compiler/validate");
const { buildTraceContext } = require("../trace/context");
const { createAppError } = require("../../utils/errors");
const { info } = require("../../utils/logger");

const SUPPORTED_ROUTE_MODES = new Set([
  "langgraph"
]);

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function normalizeRoutingMode(rawMode) {
  const candidate = rawMode || "langgraph";

  if (typeof candidate !== "string") {
    throw createAppError("INVALID_REQUEST", "scene routing.mode must be a string.", {
      stage: "scene-routing"
    });
  }

  const normalized = candidate.trim() || "langgraph";
  if (!SUPPORTED_ROUTE_MODES.has(normalized)) {
    throw createAppError("INVALID_REQUEST", `Unsupported scene routing.mode: ${normalized}.`, {
      stage: "scene-routing",
      details: {
        supportedModes: Array.from(SUPPORTED_ROUTE_MODES)
      }
    });
  }

  return normalized;
}

function normalizeAllowedModes(rawModes) {
  if (rawModes === undefined || rawModes === null) {
    return null;
  }

  if (!Array.isArray(rawModes) || rawModes.length === 0) {
    throw createAppError("INVALID_REQUEST", "scene routing.allowedModes must be a non-empty array when provided.", {
      stage: "scene-routing"
    });
  }

  return Array.from(new Set(rawModes.map((item) => normalizeRoutingMode(item))));
}

function normalizeIdentityAllowlist(rawValues, fieldName) {
  if (rawValues === undefined || rawValues === null) {
    return [];
  }

  if (!Array.isArray(rawValues)) {
    throw createAppError("INVALID_REQUEST", `scene routing.${fieldName} must be an array when provided.`, {
      stage: "scene-routing"
    });
  }

  return uniqueStrings(rawValues);
}

function normalizeRequestPercentage(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return 0;
  }

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
    throw createAppError("INVALID_REQUEST", "scene routing.requestPercentage must be between 0 and 100.", {
      stage: "scene-routing"
    });
  }

  return numericValue;
}

function loadPlatformManagedAgentRuntimeScenes(baseDir = null) {
  const resources = loadPlatformResources(resolvePlatformBaseDir(baseDir));
  return new Set(
    resources.skills
      .map((record) => record?.document?.spec?.scene)
      .filter((scene) => typeof scene === "string" && scene.trim())
  );
}

function assertAgentRuntimeSceneIsTemplateBacked(sceneConfig, baseDir = null) {
  const scene = sceneConfig?.scene || null;
  const platformManagedScenes = loadPlatformManagedAgentRuntimeScenes(baseDir);
  const platformManagedScene = platformManagedScenes.has(scene);

  if (!platformManagedScene) {
    throw createAppError(
      "INVALID_REQUEST",
      `Agent-runtime scene ${scene || "unknown"} is not registered in platform/skills. New business must provide a platform BusinessSkill before it can run.`,
      {
        stage: "scene-routing",
        details: {
          scene,
          requiredRegistry: "platform/skills",
          requirement: "template_backed_agent_runtime_scene"
        }
      }
    );
  }

  return {
    platformManagedScene
  };
}

function normalizeLangGraphCutoverPolicy(rawPolicy) {
  if (rawPolicy === undefined || rawPolicy === null) {
    return {
      tenantAllowlist: [],
      userAllowlist: [],
      requestPercentage: 0
    };
  }

  if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
    throw createAppError("INVALID_REQUEST", "scene routing.langgraphCutover must be an object when provided.", {
      stage: "scene-routing"
    });
  }

  return {
    tenantAllowlist: normalizeIdentityAllowlist(
      rawPolicy.tenantAllowlist ?? rawPolicy.tenantWhitelist,
      "langgraphCutover.tenantAllowlist"
    ),
    userAllowlist: normalizeIdentityAllowlist(
      rawPolicy.userAllowlist ?? rawPolicy.userWhitelist,
      "langgraphCutover.userAllowlist"
    ),
    requestPercentage: normalizeRequestPercentage(
      rawPolicy.requestPercentage ?? rawPolicy.percentage
    )
  };
}

function buildRequestTrafficBucket(seed) {
  const digest = createHash("sha256")
    .update(String(seed || "route-default"))
    .digest("hex");
  const value = Number.parseInt(digest.slice(0, 8), 16);
  return value % 100;
}

function resolveLangGraphCutoverDecision({
  sceneConfig,
  requestId = null,
  tenantId = null,
  userId = null
} = {}) {
  const routingConfig = sceneConfig?.routing || {};
  const policy = normalizeLangGraphCutoverPolicy(
    routingConfig.langgraphCutover ?? routingConfig.cutover
  );

  if (userId && policy.userAllowlist.includes(userId)) {
    return {
      matched: true,
      reason: "langgraph_user_allowlist",
      matchedBy: "user",
      bucket: null,
      policy
    };
  }

  if (tenantId && policy.tenantAllowlist.includes(tenantId)) {
    return {
      matched: true,
      reason: "langgraph_tenant_allowlist",
      matchedBy: "tenant",
      bucket: null,
      policy
    };
  }

  if (policy.requestPercentage > 0) {
    const bucket = buildRequestTrafficBucket(`${sceneConfig?.scene || "unknown"}:${requestId || "missing-request-id"}`);
    if (bucket < policy.requestPercentage) {
      return {
        matched: true,
        reason: "langgraph_request_percentage",
        matchedBy: "percentage",
        bucket,
        policy
      };
    }

    return {
      matched: false,
      reason: "langgraph_cutover_not_matched",
      matchedBy: null,
      bucket,
      policy
    };
  }

  return {
    matched: false,
    reason: "langgraph_cutover_not_matched",
    matchedBy: null,
    bucket: null,
    policy
  };
}

function resolveSceneRoutePlan(sceneConfig, routingContext = {}) {
  const requestedMode = normalizeRoutingMode(sceneConfig?.routing?.mode);
  const allowedModes = normalizeAllowedModes(sceneConfig?.routing?.allowedModes);
  const executionMode = sceneConfig?.execution?.mode || "agent-runtime";
  const { platformManagedScene } = assertAgentRuntimeSceneIsTemplateBacked(sceneConfig);

  if (executionMode !== "agent-runtime") {
    throw createAppError("INVALID_REQUEST", `Scene ${sceneConfig?.scene || "unknown"} must use agent-runtime execution.`, {
      stage: "scene-routing",
      details: {
        scene: sceneConfig?.scene || null,
        executionMode,
        requiredExecutionMode: "agent-runtime"
      }
    });
  }

  if (allowedModes && !allowedModes.includes(requestedMode)) {
    throw createAppError("INVALID_REQUEST", `Scene ${sceneConfig?.scene || "unknown"} does not allow routing.mode=${requestedMode}.`, {
      stage: "scene-routing",
      details: {
        requestedMode,
        allowedModes
      }
    });
  }

  if (requestedMode !== "langgraph") {
    throw createAppError("INVALID_REQUEST", `Scene ${sceneConfig?.scene || "unknown"} must use langgraph routing.`, {
      stage: "scene-routing",
      details: {
        requestedMode,
        executionMode,
        requiredMode: "langgraph"
      }
    });
  }

  const cutoverDecision = resolveLangGraphCutoverDecision({
    sceneConfig,
    requestId: routingContext.requestId || null,
    tenantId: routingContext.tenantId || null,
    userId: routingContext.userId || null
  });

  if (!cutoverDecision.matched) {
    throw createAppError("INVALID_REQUEST", `Scene ${sceneConfig?.scene || "unknown"} did not match langgraph cutover.`, {
      stage: "scene-routing",
      retryable: false,
      details: {
        scene: sceneConfig?.scene || null,
        requestedMode,
        executionMode,
        cutoverReason: cutoverDecision.reason,
        requiredMode: "langgraph",
        requiredRequestPercentage: 100
      }
    });
  }

  return {
    requestedMode,
    effectiveMode: "langgraph",
    executionMode,
    allowedModes,
    reason: cutoverDecision.reason,
    cutover: cutoverDecision,
    platformManagedScene
  };
}

async function runSceneThroughGateway({
  requestId,
  traceId,
  scene,
  sceneConfig,
  bizParams,
  handlers,
  tenantId = null,
  userId = null
}) {
  if (!handlers || typeof handlers !== "object") {
    throw createAppError("RUNTIME_INVALID_RESPONSE", "Agent Gateway handlers are required.", {
      stage: "scene-routing"
    });
  }

  const routePlan = resolveSceneRoutePlan(sceneConfig, {
    requestId,
    tenantId,
    userId
  });
  const traceContext = {
    ...buildTraceContext({
      requestId,
      traceId,
      scene,
      routePlan,
      bizParams,
      tenantId,
      userId
    }),
    platformManagedScene: routePlan.platformManagedScene ?? null
  };

  info("agent-gateway.route.selected", traceContext);

  const routeHandler = handlers.runLangGraphAgentRuntime;

  if (typeof routeHandler !== "function") {
    throw createAppError("RUNTIME_INVALID_RESPONSE", "Agent Gateway missing runLangGraphAgentRuntime handler.", {
      stage: "scene-routing"
    });
  }

  try {
    return await routeHandler({
      requestId,
      traceId,
      scene,
      sceneConfig,
      bizParams,
      tenantId,
      userId,
      routePlan,
      traceContext
    });
  } catch (error) {
    error.traceContext = {
      ...traceContext,
      ...(error?.traceContext && typeof error.traceContext === "object" ? error.traceContext : {})
    };
    throw error;
  }
}

module.exports = {
  SUPPORTED_ROUTE_MODES,
  assertAgentRuntimeSceneIsTemplateBacked,
  buildRequestTrafficBucket,
  loadPlatformManagedAgentRuntimeScenes,
  normalizeAllowedModes,
  normalizeLangGraphCutoverPolicy,
  normalizeRoutingMode,
  resolveLangGraphCutoverDecision,
  resolveSceneRoutePlan,
  runSceneThroughGateway
};
