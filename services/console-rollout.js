const fs = require("fs");
const path = require("path");
const { buildRolloutReport, parseJsonLines } = require("../platform/trace/rollout-report");
const {
  buildRequestTrafficBucket,
  normalizeLangGraphCutoverPolicy,
  normalizeRoutingMode,
  resolveSceneRoutePlan
} = require("../platform/gateway");
const { isDirectModelScene } = require("./direct-model");
const { getSceneConfig, getSceneConfigs } = require("./scene-config");
const { createAppError } = require("../utils/errors");
const { info } = require("../utils/logger");

const DEFAULT_API_LOG_FILES = [
  path.resolve(__dirname, "..", "logs", "api.stdout.log"),
  path.resolve(__dirname, "..", "logs", "api.stderr.log")
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function safeRate(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function resolveApiLogFiles() {
  const envValue = String(process.env.CONSOLE_RUN_LOG_FILES || "").trim();
  if (!envValue) {
    return DEFAULT_API_LOG_FILES;
  }

  return envValue
    .split(",")
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .map((filePath) => (
      path.isAbsolute(filePath)
        ? filePath
        : path.resolve(__dirname, "..", filePath)
    ));
}

function readLogEntries(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) {
    return [];
  }

  try {
    return parseJsonLines(text);
  } catch (error) {
    throw createAppError("RUNTIME_INVALID_RESPONSE", `Failed to parse rollout log ${path.basename(filePath)}.`, {
      stage: "console-rollout-log",
      details: {
        filePath,
        cause: error.message
      }
    });
  }
}

function loadRolloutEntries() {
  return resolveApiLogFiles().flatMap((filePath) => readLogEntries(filePath));
}

function buildSceneOptions(sceneConfigs) {
  return Object.values(sceneConfigs)
    .map((sceneConfig) => ({
      scene: sceneConfig.scene,
      title: sceneConfig.title || sceneConfig.scene,
      executionMode: isDirectModelScene(sceneConfig) ? "direct-model" : "agent-runtime",
      routingMode: sceneConfig?.routing?.mode || "legacy",
      allowedModes: Array.isArray(sceneConfig?.routing?.allowedModes)
        ? cloneJson(sceneConfig.routing.allowedModes)
        : ["legacy"]
    }))
    .sort((left, right) => left.scene.localeCompare(right.scene));
}

function buildLatestRuns(report, scene) {
  const runs = Array.isArray(report?.runs) ? report.runs : [];
  return runs
    .filter((run) => run.scene === scene)
    .slice()
    .sort((left, right) => {
      const leftTs = Date.parse(left.completedAt || left.startedAt || 0);
      const rightTs = Date.parse(right.completedAt || right.startedAt || 0);
      return rightTs - leftTs;
    })
    .slice(0, 5)
    .map((run) => ({
      requestId: run.requestId,
      requestedMode: run.requestedMode,
      effectiveMode: run.effectiveMode,
      success: run.success === true,
      httpStatus: run.httpStatus,
      durationMs: run.durationMs,
      fallbackTriggered: run.fallbackTriggered === true,
      finalMessage: run.finalMessage
    }));
}

function buildSceneRolloutSummary(report, scene) {
  const sceneReport = isObject(report?.scenes?.[scene]) ? report.scenes[scene] : null;
  const totals = sceneReport?.totals || {};
  const rates = sceneReport?.rates || {};
  const latency = sceneReport?.latency || {};
  const failures = sceneReport?.failures || {};

  return {
    totals: {
      runs: safeNumber(totals.runs) || 0,
      successfulRuns: safeNumber(totals.successfulRuns) || 0,
      failedRuns: safeNumber(totals.failedRuns) || 0,
      langgraphRuns: safeNumber(totals.langgraphRuns) || 0,
      fallbackRuns: safeNumber(totals.fallbackRuns) || 0,
      schemaFailureRuns: safeNumber(totals.schemaFailureRuns) || 0
    },
    rates: {
      successRate: safeRate(rates.successRate),
      fallbackRatio: safeRate(rates.fallbackRatio),
      schemaFailureRate: safeRate(rates.schemaFailureRate)
    },
    latency: {
      p95DurationMs: safeNumber(latency.p95DurationMs),
      maxDurationMs: safeNumber(latency.maxDurationMs)
    },
    failures: cloneJson(failures),
    latestRuns: buildLatestRuns(report, scene)
  };
}

function buildRoutingSummary(sceneConfig, report) {
  const routePlan = resolveSceneRoutePlan(sceneConfig);
  const cutover = normalizeLangGraphCutoverPolicy(
    sceneConfig?.routing?.langgraphCutover ?? sceneConfig?.routing?.cutover
  );

  return {
    scene: sceneConfig.scene,
    title: sceneConfig.title || sceneConfig.scene,
    description: sceneConfig.description || "",
    executionMode: isDirectModelScene(sceneConfig) ? "direct-model" : "agent-runtime",
    current: {
      routingMode: sceneConfig?.routing?.mode || "legacy",
      allowedModes: cloneJson(routePlan.allowedModes || ["legacy"]),
      effectiveMode: routePlan.effectiveMode,
      routeReason: routePlan.reason,
      shadowExecutionEnabled: routePlan.shadowExecutionEnabled === true,
      platformManagedScene: routePlan.platformManagedScene === true,
      legacyRole: routePlan.legacyRole || null
    },
    cutover: {
      requestPercentage: cutover.requestPercentage,
      tenantAllowlist: cloneJson(cutover.tenantAllowlist),
      userAllowlist: cloneJson(cutover.userAllowlist),
      tenantCount: cutover.tenantAllowlist.length,
      userCount: cutover.userAllowlist.length
    },
    rollout: buildSceneRolloutSummary(report, sceneConfig.scene),
    canPreviewChange: !isDirectModelScene(sceneConfig)
  };
}

function parseStringList(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }

  if (typeof value === "string") {
    return uniqueStrings(value.split(/[,\n]/g));
  }

  return [];
}

function normalizePreviewPayload(sceneConfig, payload = {}) {
  const currentAllowedModes = Array.isArray(sceneConfig?.routing?.allowedModes)
    ? cloneJson(sceneConfig.routing.allowedModes)
    : ["legacy"];
  const proposedMode = normalizeRoutingMode(payload.mode ?? sceneConfig?.routing?.mode ?? "legacy");

  if (!currentAllowedModes.includes(proposedMode)) {
    throw createAppError("INVALID_REQUEST", `Scene ${sceneConfig.scene} does not allow preview mode=${proposedMode}.`, {
      stage: "console-routing-preview",
      details: {
        scene: sceneConfig.scene,
        allowedModes: currentAllowedModes,
        proposedMode
      }
    });
  }

  const currentCutover = normalizeLangGraphCutoverPolicy(
    sceneConfig?.routing?.langgraphCutover ?? sceneConfig?.routing?.cutover
  );
  const payloadCutover = isObject(payload.langgraphCutover) ? payload.langgraphCutover : {};
  const normalizedCutover = normalizeLangGraphCutoverPolicy({
    requestPercentage: payloadCutover.requestPercentage ?? payload.requestPercentage ?? currentCutover.requestPercentage,
    tenantAllowlist: payloadCutover.tenantAllowlist ?? payload.tenantAllowlist ?? currentCutover.tenantAllowlist,
    userAllowlist: payloadCutover.userAllowlist ?? payload.userAllowlist ?? currentCutover.userAllowlist
  });

  return {
    mode: proposedMode,
    allowedModes: currentAllowedModes,
    langgraphCutover: {
      requestPercentage: normalizedCutover.requestPercentage,
      tenantAllowlist: parseStringList(normalizedCutover.tenantAllowlist),
      userAllowlist: parseStringList(normalizedCutover.userAllowlist)
    }
  };
}

function buildPercentageExamples(scene, requestPercentage) {
  if (!(requestPercentage > 0)) {
    return {
      matched: null,
      unmatched: null
    };
  }

  let matched = null;
  let unmatched = null;

  for (let index = 0; index < 500; index += 1) {
    const requestId = `console-preview-${index}`;
    const bucket = buildRequestTrafficBucket(`${scene}:${requestId}`);

    if (!matched && bucket < requestPercentage) {
      matched = {
        requestId,
        bucket
      };
    }

    if (!unmatched && bucket >= requestPercentage) {
      unmatched = {
        requestId,
        bucket
      };
    }

    if (matched && unmatched) {
      break;
    }
  }

  return {
    matched,
    unmatched
  };
}

function buildPreviewDecision(label, routePlan, details = {}) {
  return {
    label,
    requestedMode: routePlan.requestedMode,
    effectiveMode: routePlan.effectiveMode,
    routeReason: routePlan.reason,
    shadowExecutionEnabled: routePlan.shadowExecutionEnabled === true,
    legacyRole: routePlan.legacyRole || null,
    matchedBy: routePlan.cutover?.matchedBy || null,
    bucket: routePlan.cutover?.bucket ?? null,
    details
  };
}

function previewConsoleSceneRoutingChange(scene, payload = {}, requestId = null) {
  const sceneConfig = getSceneConfig(scene);
  const proposedRouting = normalizePreviewPayload(sceneConfig, payload);
  const previewConfig = cloneJson(sceneConfig);
  previewConfig.routing = {
    ...(isObject(previewConfig.routing) ? previewConfig.routing : {}),
    mode: proposedRouting.mode,
    allowedModes: cloneJson(proposedRouting.allowedModes),
    langgraphCutover: cloneJson(proposedRouting.langgraphCutover)
  };

  const decisions = [];
  const warnings = [];
  const defaultPlan = resolveSceneRoutePlan(previewConfig, {
    requestId: "console-preview-default"
  });
  decisions.push(buildPreviewDecision("default", defaultPlan));

  if (proposedRouting.langgraphCutover.tenantAllowlist[0]) {
    const tenantId = proposedRouting.langgraphCutover.tenantAllowlist[0];
    decisions.push(buildPreviewDecision(
      "tenant-allowlist-hit",
      resolveSceneRoutePlan(previewConfig, {
        requestId: "console-preview-tenant",
        tenantId
      }),
      { tenantId }
    ));
  }

  if (proposedRouting.langgraphCutover.userAllowlist[0]) {
    const userId = proposedRouting.langgraphCutover.userAllowlist[0];
    decisions.push(buildPreviewDecision(
      "user-allowlist-hit",
      resolveSceneRoutePlan(previewConfig, {
        requestId: "console-preview-user",
        userId
      }),
      { userId }
    ));
  }

  const percentageExamples = buildPercentageExamples(
    scene,
    proposedRouting.langgraphCutover.requestPercentage
  );
  if (percentageExamples.matched) {
    decisions.push(buildPreviewDecision(
      "percentage-hit",
      resolveSceneRoutePlan(previewConfig, {
        requestId: percentageExamples.matched.requestId
      }),
      percentageExamples.matched
    ));
  }

  if (percentageExamples.unmatched) {
    decisions.push(buildPreviewDecision(
      "percentage-miss",
      resolveSceneRoutePlan(previewConfig, {
        requestId: percentageExamples.unmatched.requestId
      }),
      percentageExamples.unmatched
    ));
  }

  if (
    proposedRouting.mode === "langgraph"
    && proposedRouting.langgraphCutover.requestPercentage === 0
    && proposedRouting.langgraphCutover.tenantAllowlist.length === 0
    && proposedRouting.langgraphCutover.userAllowlist.length === 0
  ) {
    warnings.push("当前 langgraph 模式下没有任何白名单或比例命中条件，正式请求仍会保持 legacy。");
  }

  if (
    proposedRouting.mode !== "langgraph"
    && (
      proposedRouting.langgraphCutover.requestPercentage > 0
      || proposedRouting.langgraphCutover.tenantAllowlist.length > 0
      || proposedRouting.langgraphCutover.userAllowlist.length > 0
    )
  ) {
    warnings.push("非 langgraph 模式下，langgraphCutover 设置不会生效。");
  }

  if (isDirectModelScene(sceneConfig)) {
    warnings.push("当前 scene 属于 direct-model，只允许 legacy，不能参与 langgraph 灰度。");
  }

  info("console.routing.change.previewed", {
    requestId,
    scene,
    currentMode: sceneConfig?.routing?.mode || "legacy",
    proposedMode: proposedRouting.mode,
    allowedModes: proposedRouting.allowedModes,
    requestPercentage: proposedRouting.langgraphCutover.requestPercentage,
    tenantAllowlistCount: proposedRouting.langgraphCutover.tenantAllowlist.length,
    userAllowlistCount: proposedRouting.langgraphCutover.userAllowlist.length,
    warningCount: warnings.length
  });

  return {
    scene,
    title: sceneConfig.title || scene,
    currentRouting: {
      mode: sceneConfig?.routing?.mode || "legacy",
      allowedModes: cloneJson(proposedRouting.allowedModes),
      langgraphCutover: normalizeLangGraphCutoverPolicy(
        sceneConfig?.routing?.langgraphCutover ?? sceneConfig?.routing?.cutover
      )
    },
    proposedRouting,
    decisions,
    warnings,
    audit: {
      event: "console.routing.change.previewed",
      requestId
    }
  };
}

function getConsoleRolloutReport() {
  const report = buildRolloutReport(loadRolloutEntries(), {
    batchId: "console-rollout"
  });
  const sceneConfigs = getSceneConfigs();

  return {
    ...report,
    sceneOptions: buildSceneOptions(sceneConfigs)
  };
}

function getConsoleSceneRouting(scene) {
  const sceneConfig = getSceneConfig(scene);
  const report = getConsoleRolloutReport();

  return buildRoutingSummary(sceneConfig, report);
}

module.exports = {
  getConsoleRolloutReport,
  getConsoleSceneRouting,
  previewConsoleSceneRoutingChange
};
