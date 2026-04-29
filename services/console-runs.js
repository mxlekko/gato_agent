const fs = require("fs");
const path = require("path");
const { parseJsonLines } = require("../platform/trace/rollout-report");
const { shouldIncludeRawText } = require("../platform/trace/context");
const { getSceneConfig } = require("./scene-config");
const { createAppError } = require("../utils/errors");

const FINAL_MESSAGES = new Set([
  "agent.run.success",
  "agent.run.completed",
  "agent.run.failed",
  "agent.langgraph.fallback.completed",
  "agent.langgraph.fallback.failed"
]);

const DEFAULT_API_LOG_FILES = [
  path.resolve(__dirname, "..", "logs", "api.stdout.log"),
  path.resolve(__dirname, "..", "logs", "api.stderr.log")
];

const LOG_MESSAGE_LABELS = {
  "agent-gateway.route.selected": "路由决策",
  "agent.run.start": "请求开始",
  "agent.run.success": "请求成功",
  "agent.run.completed": "请求完成",
  "agent.run.failed": "请求失败",
  "agent.langgraph.fallback.triggered": "触发回退",
  "agent.langgraph.fallback.completed": "回退完成",
  "agent.langgraph.fallback.failed": "回退失败",
  "agent.shadow.completed": "影子完成",
  "agent.shadow.failed": "影子失败"
};

const SHADOW_CHECKS = [
  {
    id: "http-status",
    label: "HTTP Status",
    description: "新旧链路的 HTTP 状态码是否一致。",
    contextKey: "shadowHttpStatusMatch"
  },
  {
    id: "response-envelope",
    label: "Response Envelope",
    description: "success/data/error 的响应包络是否一致。",
    contextKey: "shadowEnvelopeMatch"
  },
  {
    id: "consistency-fields",
    label: "Consistency Fields",
    description: "关键业务字段的一致性检查是否通过。",
    contextKey: "shadowConsistencyMatch"
  },
  {
    id: "strict-body",
    label: "Strict Body",
    description: "忽略动态字段后，响应体是否严格一致。",
    contextKey: "shadowStrictBodyMatch"
  }
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizeResponseEnvelope(value) {
  if (!isObject(value)) {
    return null;
  }

  if (typeof value.success !== "boolean") {
    return null;
  }

  return {
    success: value.success,
    requestId: typeof value.requestId === "string" ? value.requestId : null,
    data: Object.prototype.hasOwnProperty.call(value, "data") ? value.data : null,
    error: isObject(value.error) ? value.error : null
  };
}

function compareEntryTs(left, right) {
  const leftTs = parseTimestamp(left?.ts);
  const rightTs = parseTimestamp(right?.ts);

  if (leftTs === null && rightTs === null) {
    return 0;
  }

  if (leftTs === null) {
    return -1;
  }

  if (rightTs === null) {
    return 1;
  }

  return leftTs - rightTs;
}

function pickLatestEvent(currentEvent, nextEvent) {
  if (!currentEvent) {
    return nextEvent;
  }

  return compareEntryTs(currentEvent, nextEvent) <= 0
    ? nextEvent
    : currentEvent;
}

function pickEarliestEvent(currentEvent, nextEvent) {
  if (!currentEvent) {
    return nextEvent;
  }

  return compareEntryTs(currentEvent, nextEvent) <= 0
    ? currentEvent
    : nextEvent;
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
    throw createAppError("RUNTIME_INVALID_RESPONSE", `Failed to parse run log ${path.basename(filePath)}.`, {
      stage: "console-run-log",
      details: {
        filePath,
        cause: error.message
      }
    });
  }
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

function loadRunEntries() {
  return resolveApiLogFiles()
    .flatMap((filePath) => readLogEntries(filePath))
    .filter((entry) => isObject(entry?.context) && entry.context.requestId)
    .sort(compareEntryTs);
}

function groupEntriesByRequestId(entries) {
  const recordsByRequestId = new Map();

  for (const entry of entries) {
    const requestId = entry?.context?.requestId || null;
    if (!requestId) {
      continue;
    }

    if (!recordsByRequestId.has(requestId)) {
      recordsByRequestId.set(requestId, {
        requestId,
        events: [],
        startEvent: null,
        finalEvent: null,
        fallbackTriggeredEvent: null,
        shadowCompletedEvent: null
      });
    }

    const record = recordsByRequestId.get(requestId);
    record.events.push(entry);

    if (entry.message === "agent.run.start") {
      record.startEvent = pickEarliestEvent(record.startEvent, entry);
    }

    if (FINAL_MESSAGES.has(entry.message)) {
      record.finalEvent = pickLatestEvent(record.finalEvent, entry);
    }

    if (entry.message === "agent.langgraph.fallback.triggered") {
      record.fallbackTriggeredEvent = pickLatestEvent(record.fallbackTriggeredEvent, entry);
    }

    if (entry.message === "agent.shadow.completed") {
      record.shadowCompletedEvent = pickLatestEvent(record.shadowCompletedEvent, entry);
    }
  }

  return Array.from(recordsByRequestId.values());
}

function getConfiguredExecutionMode(scene) {
  if (!scene) {
    return null;
  }

  try {
    return getSceneConfig(scene)?.execution?.mode || "agent-runtime";
  } catch {
    return null;
  }
}

function normalizeBizParamsSummary(summary = {}, keys = [], scene = null) {
  const normalized = {};
  const rawTextLength = safeNumber(summary.rawTextLength);
  const actualRawText = typeof summary.rawText === "string" ? summary.rawText : null;
  const includeRawText = shouldIncludeRawText(scene);

  for (const key of keys) {
    if (key === "rawText") {
      if (actualRawText !== null) {
        normalized.rawText = actualRawText;
      } else if (includeRawText && rawTextLength !== null) {
        normalized.rawText = `原文未落盘（长度 ${rawTextLength}）`;
      } else {
        normalized.rawText = rawTextLength !== null
          ? `[REDACTED_TEXT length=${rawTextLength}]`
          : "[REDACTED_TEXT]";
      }
      continue;
    }

    normalized[key] = summary[key] ?? null;
  }

  if (!keys.includes("rawText") && (actualRawText !== null || rawTextLength !== null)) {
    if (actualRawText !== null) {
      normalized.rawText = actualRawText;
    } else if (includeRawText && rawTextLength !== null) {
      normalized.rawText = `原文未落盘（长度 ${rawTextLength}）`;
    } else {
      normalized.rawText = `[REDACTED_TEXT length=${summary.rawTextLength}]`;
    }
  }

  if (!keys.includes("opportunityId") && summary.opportunityId) {
    normalized.opportunityId = summary.opportunityId;
  }

  return normalized;
}

function summarizeFinalState(record) {
  const finalContext = isObject(record?.finalEvent?.context) ? record.finalEvent.context : {};
  const finalMessage = record?.finalEvent?.message || null;

  if (finalMessage === "agent.run.success") {
    return {
      success: true,
      httpStatus: 200,
      errorCode: null,
      errorStage: null
    };
  }

  if (finalMessage === "agent.run.completed") {
    return {
      success: finalContext.success === true,
      httpStatus: safeNumber(finalContext.httpStatus) ?? (finalContext.success === true ? 200 : null),
      errorCode: finalContext.code || null,
      errorStage: finalContext.stage || null
    };
  }

  if (finalMessage === "agent.run.failed") {
    return {
      success: false,
      httpStatus: safeNumber(finalContext.httpStatus),
      errorCode: finalContext.code || null,
      errorStage: finalContext.stage || null
    };
  }

  if (finalMessage === "agent.langgraph.fallback.completed") {
    return {
      success: finalContext.fallbackLegacySuccess === true,
      httpStatus: safeNumber(finalContext.fallbackLegacyHttpStatus),
      errorCode: finalContext.fallbackErrorCode || null,
      errorStage: finalContext.fallbackErrorStage || null
    };
  }

  if (finalMessage === "agent.langgraph.fallback.failed") {
    return {
      success: false,
      httpStatus: safeNumber(finalContext.fallbackLegacyErrorHttpStatus)
        ?? safeNumber(finalContext.fallbackErrorHttpStatus),
      errorCode: finalContext.fallbackLegacyErrorCode
        || finalContext.fallbackErrorCode
        || null,
      errorStage: finalContext.fallbackLegacyErrorStage
        || finalContext.fallbackErrorStage
        || null
    };
  }

  return {
    success: null,
    httpStatus: null,
    errorCode: null,
    errorStage: null
  };
}

function deriveDurationMs(record) {
  const finalContext = isObject(record?.finalEvent?.context) ? record.finalEvent.context : {};
  const directDuration = safeNumber(finalContext.durationMs)
    ?? safeNumber(finalContext.fallbackLegacyDurationMs);
  if (directDuration !== null) {
    return directDuration;
  }

  const startedAt = parseTimestamp(record?.startEvent?.ts);
  const completedAt = parseTimestamp(record?.finalEvent?.ts);
  if (startedAt !== null && completedAt !== null && completedAt >= startedAt) {
    return completedAt - startedAt;
  }

  return null;
}

function summarizeRunRecord(record) {
  const startContext = isObject(record?.startEvent?.context) ? record.startEvent.context : {};
  const finalContext = isObject(record?.finalEvent?.context) ? record.finalEvent.context : {};
  const fallbackContext = isObject(record?.fallbackTriggeredEvent?.context)
    ? record.fallbackTriggeredEvent.context
    : {};
  const finalState = summarizeFinalState(record);
  const scene = startContext.scene || finalContext.scene || fallbackContext.scene || null;
  const configuredExecutionMode = getConfiguredExecutionMode(scene);
  const executionMode = finalContext.executionMode
    || startContext.executionMode
    || configuredExecutionMode
    || null;
  const sceneExecutionType = finalContext.sceneExecutionType
    || startContext.sceneExecutionType
    || null;
  const requestedMode = finalContext.requestedMode
    || startContext.requestedMode
    || fallbackContext.requestedMode
    || (sceneExecutionType === "langgraph-stategraph" ? "langgraph" : "legacy");
  const effectiveMode = finalContext.effectiveMode
    || startContext.effectiveMode
    || fallbackContext.effectiveMode
    || (record?.fallbackTriggeredEvent ? "legacy" : requestedMode);
  const bizParamKeys = Array.isArray(startContext.bizParamKeys) ? startContext.bizParamKeys : [];
  const bizParamSummary = isObject(startContext.bizParamSummary) ? startContext.bizParamSummary : {};
  const startedAt = record?.startEvent?.ts || null;
  const completedAt = record?.finalEvent?.ts || null;
  const responseEnvelope = normalizeResponseEnvelope(finalContext.responseEnvelope);

  return {
    runId: record.requestId,
    requestId: record.requestId,
    traceId: startContext.traceId || finalContext.traceId || null,
    scene,
    requestedMode,
    effectiveMode,
    executionMode,
    sceneExecutionType,
    success: finalState.success,
    httpStatus: finalState.httpStatus,
    durationMs: deriveDurationMs(record),
    fallbackTriggered: Boolean(record?.fallbackTriggeredEvent),
    errorCode: finalState.errorCode,
    errorStage: finalState.errorStage,
    finalMessage: record?.finalEvent?.message || null,
    startedAt,
    completedAt,
    responseEnvelope,
    request: {
      scene,
      bizParamKeys,
      bizParams: normalizeBizParamsSummary(bizParamSummary, bizParamKeys, scene)
    },
    shadow: {
      available: Boolean(record?.shadowCompletedEvent),
      shadowRunId: record?.shadowCompletedEvent?.context?.shadowRequestId || null
    }
  };
}

function buildListItem(summary) {
  return {
    logId: summary.runId,
    runId: summary.runId,
    requestId: summary.requestId,
    traceId: summary.traceId,
    timestamp: summary.completedAt || summary.startedAt || null,
    level: summary.success === false ? "error" : "info",
    message: summary.finalMessage || "agent.run.start",
    messageLabel: summary.finalMessage
      ? (LOG_MESSAGE_LABELS[summary.finalMessage] || summary.finalMessage)
      : "请求进行中",
    scene: summary.scene,
    requestedMode: summary.requestedMode,
    effectiveMode: summary.effectiveMode,
    executionMode: summary.executionMode,
    success: summary.success,
    httpStatus: summary.httpStatus,
    durationMs: summary.durationMs,
    fallbackTriggered: summary.fallbackTriggered,
    errorCode: summary.errorCode || null,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt,
    request: summary.request
  };
}

function sortRunSummaries(summaries) {
  return summaries.sort((left, right) => {
    const leftTs = parseTimestamp(left.completedAt || left.startedAt);
    const rightTs = parseTimestamp(right.completedAt || right.startedAt);

    if (leftTs === null && rightTs === null) {
      return 0;
    }

    if (leftTs === null) {
      return 1;
    }

    if (rightTs === null) {
      return -1;
    }

    return rightTs - leftTs;
  });
}

function loadRunBundles({ entries = null } = {}) {
  const records = groupEntriesByRequestId(entries || loadRunEntries());
  return records.map((record) => ({
    record,
    summary: summarizeRunRecord(record)
  }));
}

function findRunBundle(runId, options = {}) {
  if (!runId || typeof runId !== "string") {
    throw createAppError("INVALID_REQUEST", "runId is required.", {
      stage: "console-run-detail"
    });
  }

  const bundle = loadRunBundles(options).find((item) => item.summary.runId === runId);
  if (!bundle) {
    throw createAppError("INVALID_REQUEST", `Run not found: ${runId}.`, {
      httpStatus: 404,
      stage: "console-run-detail",
      details: {
        runId
      }
    });
  }

  return bundle;
}

function buildTracePath(traceId) {
  return traceId ? `/traces/${traceId}` : null;
}

function buildShadowChecks(context = {}) {
  return SHADOW_CHECKS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    passed: safeBoolean(context?.[definition.contextKey])
  }));
}

function buildShadowDifferences(summary, context = {}) {
  const differences = [];

  if (summary.success !== null && safeBoolean(context.shadowResultSuccess) !== null) {
    const shadowResultSuccess = safeBoolean(context.shadowResultSuccess);
    if (summary.success !== shadowResultSuccess) {
      differences.push({
        id: "result-success",
        label: "Result Success",
        baselineValue: String(summary.success),
        shadowValue: String(shadowResultSuccess),
        severity: "high"
      });
    }
  }

  const baselineErrorCode = summary.errorCode || null;
  const shadowErrorCode = context.shadowErrorCode || null;
  if (baselineErrorCode !== shadowErrorCode) {
    differences.push({
      id: "error-code",
      label: "Error Code",
      baselineValue: baselineErrorCode || "null",
      shadowValue: shadowErrorCode || "null",
      severity: "medium"
    });
  }

  const checkDifferences = buildShadowChecks(context)
    .filter((item) => item.passed === false)
    .map((item) => ({
      id: item.id,
      label: item.label,
      baselineValue: item.id === "http-status"
        ? String(summary.httpStatus || "unknown")
        : "match",
      shadowValue: item.id === "http-status"
        ? "mismatch"
        : "mismatch",
      severity: "medium",
      description: item.description
    }));

  return differences.concat(checkDifferences);
}

function loadRunSummaries(options = {}) {
  return sortRunSummaries(
    loadRunBundles(options).map((bundle) => bundle.summary)
  );
}

function buildLogListItem(entry) {
  const context = isObject(entry?.context) ? entry.context : {};
  const scene = context.scene || null;
  const bizParamKeys = Array.isArray(context.bizParamKeys) ? context.bizParamKeys : [];
  const bizParamSummary = isObject(context.bizParamSummary) ? context.bizParamSummary : {};
  const requestedMode = context.requestedMode || null;
  const effectiveMode = context.effectiveMode || null;
  const executionMode = context.executionMode || getConfiguredExecutionMode(scene) || null;
  const durationMs = safeNumber(context.durationMs) ?? safeNumber(context.fallbackLegacyDurationMs);
  const httpStatus = safeNumber(context.httpStatus)
    ?? safeNumber(context.fallbackLegacyHttpStatus)
    ?? (entry.message === "agent.run.success" ? 200 : null);
  const errorCode = context.code
    || context.fallbackErrorCode
    || context.fallbackLegacyErrorCode
    || context.shadowErrorCode
    || null;

  return {
    logId: [
      entry?.ts || "no-ts",
      entry?.message || "no-message",
      context.requestId || "no-request"
    ].join(":"),
    runId: context.requestId || null,
    requestId: context.requestId || null,
    traceId: context.traceId || null,
    timestamp: entry?.ts || null,
    level: entry?.level || "info",
    message: entry?.message || null,
    messageLabel: LOG_MESSAGE_LABELS[entry?.message] || entry?.message || "未知事件",
    scene,
    requestedMode,
    effectiveMode,
    executionMode,
    httpStatus,
    durationMs,
    errorCode,
    request: {
      scene,
      bizParamKeys,
      bizParams: normalizeBizParamsSummary(bizParamSummary, bizParamKeys, scene)
    }
  };
}

function loadInterfaceLogItems(options = {}) {
  const entries = options.entries || loadRunEntries();

  return entries
    .filter((entry) => entry?.context?.requestId)
    .map(buildLogListItem)
    .sort((left, right) => {
      const leftTs = parseTimestamp(left.timestamp);
      const rightTs = parseTimestamp(right.timestamp);

      if (leftTs === null && rightTs === null) {
        return 0;
      }

      if (leftTs === null) {
        return 1;
      }

      if (rightTs === null) {
        return -1;
      }

      return rightTs - leftTs;
    });
}

function listConsoleRuns({ limit = 20, entries = null } = {}) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 20;

  return {
    items: sortRunSummaries(
      loadRunBundles({ entries }).map((bundle) => bundle.summary)
    )
      .map(buildListItem)
      .slice(0, safeLimit)
  };
}

function getConsoleRunDetail(runId, options = {}) {
  const { summary } = findRunBundle(runId, options);

  return {
    runId: summary.runId,
    requestId: summary.requestId,
    traceId: summary.traceId,
    request: summary.request,
    route: {
      requestedMode: summary.requestedMode,
      effectiveMode: summary.effectiveMode,
      executionMode: summary.executionMode,
      sceneExecutionType: summary.sceneExecutionType,
      fallbackTriggered: summary.fallbackTriggered
    },
    result: {
      success: summary.success,
      httpStatus: summary.httpStatus,
      durationMs: summary.durationMs,
      finalMessage: summary.finalMessage,
      responseEnvelopeAvailable: Boolean(summary.responseEnvelope),
      completedAt: summary.completedAt
    },
    responseEnvelope: summary.responseEnvelope,
    error: summary.errorCode
      ? {
          code: summary.errorCode,
          stage: summary.errorStage || null,
          httpStatus: summary.httpStatus || null
        }
      : null,
    shadow: summary.shadow,
    startedAt: summary.startedAt,
    completedAt: summary.completedAt
  };
}

function getConsoleShadowDetail(runId, options = {}) {
  const { summary, record } = findRunBundle(runId, options);
  const shadowContext = isObject(record?.shadowCompletedEvent?.context)
    ? record.shadowCompletedEvent.context
    : null;
  const resolvedScene = summary.scene || shadowContext?.scene || null;
  const resolvedBaselineTraceId = summary.traceId || shadowContext?.traceId || null;

  const baseline = {
    requestId: summary.requestId,
    traceId: resolvedBaselineTraceId,
    tracePath: buildTracePath(resolvedBaselineTraceId),
    mode: summary.effectiveMode || shadowContext?.effectiveMode || "legacy",
    success: summary.success,
    httpStatus: summary.httpStatus,
    errorCode: summary.errorCode,
    durationMs: summary.durationMs
  };

  if (!shadowContext) {
    return {
      runId: summary.runId,
      requestId: summary.requestId,
      scene: resolvedScene,
      available: false,
      baseline,
      shadow: null,
      diffSummary: null,
      differences: [],
      links: {
        runDetailPath: `/runs/${summary.runId}`,
        baselineTracePath: baseline.tracePath,
        shadowTracePath: null
      },
      note: "当前 run 未记录 shadow 执行结果。"
    };
  }

  const checks = buildShadowChecks(shadowContext);
  const shadowTraceId = shadowContext.shadowTraceId || null;
  const differences = buildShadowDifferences(summary, shadowContext);
  const loggedDifferenceCount = safeNumber(shadowContext.shadowDifferenceCount) || 0;

  return {
    runId: summary.runId,
    requestId: summary.requestId,
    scene: resolvedScene,
    available: true,
    baseline,
    shadow: {
      requestId: shadowContext.shadowRequestId || null,
      traceId: shadowTraceId,
      tracePath: buildTracePath(shadowTraceId),
      mode: "langgraph-compat",
      resultSuccess: safeBoolean(shadowContext.shadowResultSuccess),
      errorCode: shadowContext.shadowErrorCode || null,
      nodeRunCount: safeNumber(shadowContext.shadowNodeRunCount),
      nodeStatuses: Array.isArray(shadowContext.shadowNodeStatuses)
        ? shadowContext.shadowNodeStatuses
        : [],
      sessionSeparated: safeBoolean(shadowContext.sessionSeparated)
    },
    diffSummary: {
      passed: safeBoolean(shadowContext.shadowDiffPassed),
      differenceCount: Math.max(loggedDifferenceCount, differences.length),
      checks
    },
    differences,
    links: {
      runDetailPath: `/runs/${summary.runId}`,
      baselineTracePath: baseline.tracePath,
      shadowTracePath: buildTracePath(shadowTraceId)
    },
    note: "当前页面展示的是日志里已落盘的 shadow 摘要；完整节点差异请继续查看 trace。"
  };
}

module.exports = {
  getConsoleShadowDetail,
  getConsoleRunDetail,
  loadRunBundles,
  listConsoleRuns
};
