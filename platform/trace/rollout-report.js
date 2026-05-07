const FINAL_RUN_MESSAGES = new Set([
  "agent.run.success",
  "agent.run.completed",
  "agent.run.failed"
]);

const DEFAULT_ALERT_THRESHOLDS = Object.freeze({
  minSuccessRate: 0.95,
  maxP95DurationMs: 2000,
  maxSchemaFailureRate: 0.05
});

const SCHEMA_ERROR_CODES = new Set([
  "INVALID_MODEL_OUTPUT"
]);

const SCHEMA_ERROR_STAGES = new Set([
  "model-tool",
  "result-parse"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeRate(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return Number((numerator / denominator).toFixed(4));
}

function parseTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function percentile(values, targetPercentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const sorted = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);

  if (sorted.length === 0) {
    return null;
  }

  const rank = Math.max(1, Math.ceil((targetPercentile / 100) * sorted.length));
  return sorted[rank - 1];
}

function deriveDurationMs(finalEvent, startEvent) {
  const recordedDuration = safeNumber(finalEvent?.context?.durationMs);
  if (recordedDuration !== null) {
    return recordedDuration;
  }

  const startTs = parseTimestamp(startEvent?.ts);
  const endTs = parseTimestamp(finalEvent?.ts);
  if (startTs !== null && endTs !== null && endTs >= startTs) {
    return endTs - startTs;
  }

  return null;
}

function pickLatestEvent(currentEvent, nextEvent) {
  if (!currentEvent) {
    return nextEvent;
  }

  const currentTs = parseTimestamp(currentEvent.ts);
  const nextTs = parseTimestamp(nextEvent.ts);

  if (currentTs === null) {
    return nextEvent;
  }

  if (nextTs === null) {
    return currentEvent;
  }

  return nextTs >= currentTs ? nextEvent : currentEvent;
}

function buildRunRecords(entries) {
  const recordsByRequestId = new Map();

  for (const entry of entries) {
    const context = isObject(entry?.context) ? entry.context : {};
    const requestId = context.requestId || null;
    if (!requestId) {
      continue;
    }

    if (!recordsByRequestId.has(requestId)) {
      recordsByRequestId.set(requestId, {
        requestId,
        events: [],
        startEvent: null,
        finalEvent: null
      });
    }

    const record = recordsByRequestId.get(requestId);
    record.events.push(entry);

    if (entry.message === "agent.run.start") {
      if (!record.startEvent) {
        record.startEvent = entry;
      } else {
        record.startEvent = pickLatestEvent(record.startEvent, entry) === record.startEvent
          ? record.startEvent
          : entry;
      }
    }

    if (FINAL_RUN_MESSAGES.has(entry.message)) {
      record.finalEvent = pickLatestEvent(record.finalEvent, entry);
    }
  }

  return Array.from(recordsByRequestId.values());
}

function isSchemaFailure(code, stage) {
  return SCHEMA_ERROR_CODES.has(code) || SCHEMA_ERROR_STAGES.has(stage);
}

function summarizeRunRecord(record) {
  const startContext = isObject(record?.startEvent?.context) ? record.startEvent.context : {};
  const finalContext = isObject(record?.finalEvent?.context) ? record.finalEvent.context : {};
  const primaryContext = Object.keys(finalContext).length > 0
    ? finalContext
    : startContext;
  const finalMessage = record?.finalEvent?.message || null;
  const durationMs = deriveDurationMs(record?.finalEvent, record?.startEvent);

  let success = false;
  let httpStatus = null;
  let errorCode = null;
  let errorStage = null;

  if (finalMessage === "agent.run.success") {
    success = true;
    httpStatus = 200;
  } else if (finalMessage === "agent.run.completed") {
    success = finalContext.success === true;
    httpStatus = safeNumber(finalContext.httpStatus) ?? (success ? 200 : null);
    errorCode = finalContext.code || null;
    errorStage = finalContext.stage || null;
  } else if (finalMessage === "agent.run.failed") {
    success = false;
    httpStatus = safeNumber(finalContext.httpStatus);
    errorCode = finalContext.code || null;
    errorStage = finalContext.stage || null;
  }

  return {
    requestId: record.requestId,
    scene: primaryContext.scene || null,
    requestedMode: primaryContext.requestedMode || null,
    effectiveMode: primaryContext.effectiveMode || null,
    executionMode: primaryContext.executionMode || null,
    sceneExecutionType: startContext.sceneExecutionType || finalContext.sceneExecutionType || null,
    finalMessage,
    success,
    httpStatus,
    durationMs,
    schemaFailure: isSchemaFailure(errorCode, errorStage),
    errorCode,
    errorStage
  };
}

function aggregateRunMetrics(runs) {
  const finalizedRuns = runs.filter((run) => run.finalMessage);
  const durations = finalizedRuns
    .map((run) => run.durationMs)
    .filter((value) => Number.isFinite(value));
  const langgraphRuns = finalizedRuns.filter(
    (run) => run.sceneExecutionType === "langgraph-stategraph"
  );
  const successCount = finalizedRuns.filter((run) => run.success === true).length;
  const schemaFailureCount = finalizedRuns.filter((run) => run.schemaFailure).length;
  const failedRuns = finalizedRuns.filter((run) => run.success !== true);

  return {
    totals: {
      runs: finalizedRuns.length,
	      successfulRuns: successCount,
	      failedRuns: failedRuns.length,
	      langgraphRuns: langgraphRuns.length,
	      schemaFailureRuns: schemaFailureCount
	    },
	    rates: {
	      successRate: safeRate(successCount, finalizedRuns.length),
	      schemaFailureRate: safeRate(schemaFailureCount, langgraphRuns.length || finalizedRuns.length)
    },
    latency: {
      p50DurationMs: percentile(durations, 50),
      p95DurationMs: percentile(durations, 95),
      maxDurationMs: durations.length > 0 ? Math.max(...durations) : null
    },
    failures: {
      byCode: Object.fromEntries(
        Object.entries(
          failedRuns.reduce((accumulator, run) => {
            const key = run.errorCode || "UNKNOWN";
            accumulator[key] = (accumulator[key] || 0) + 1;
            return accumulator;
          }, {})
        ).sort(([left], [right]) => left.localeCompare(right))
      ),
      byStage: Object.fromEntries(
        Object.entries(
          failedRuns.reduce((accumulator, run) => {
            const key = run.errorStage || "UNKNOWN";
            accumulator[key] = (accumulator[key] || 0) + 1;
            return accumulator;
          }, {})
        ).sort(([left], [right]) => left.localeCompare(right))
      )
    }
  };
}

function aggregateByScene(runs) {
  const scenes = {};
  const sceneNames = Array.from(
    new Set(
      runs
        .map((run) => run.scene)
        .filter((scene) => typeof scene === "string" && scene.length > 0)
    )
  ).sort();

  for (const scene of sceneNames) {
    scenes[scene] = aggregateRunMetrics(runs.filter((run) => run.scene === scene));
  }

  return scenes;
}

function buildAlerts(report, thresholds = {}) {
  const resolvedThresholds = {
    ...DEFAULT_ALERT_THRESHOLDS,
    ...thresholds
  };
  const alerts = [];

  if (report.rates.successRate < resolvedThresholds.minSuccessRate) {
    alerts.push({
      metric: "successRate",
      level: "warn",
      actual: report.rates.successRate,
      threshold: resolvedThresholds.minSuccessRate,
      message: `successRate ${report.rates.successRate} is below threshold ${resolvedThresholds.minSuccessRate}.`
    });
  }

  if (
    report.latency.p95DurationMs !== null
    && report.latency.p95DurationMs > resolvedThresholds.maxP95DurationMs
  ) {
    alerts.push({
      metric: "p95DurationMs",
      level: "warn",
      actual: report.latency.p95DurationMs,
      threshold: resolvedThresholds.maxP95DurationMs,
      message: `p95DurationMs ${report.latency.p95DurationMs} exceeds threshold ${resolvedThresholds.maxP95DurationMs}.`
    });
  }

  if (report.rates.schemaFailureRate > resolvedThresholds.maxSchemaFailureRate) {
    alerts.push({
      metric: "schemaFailureRate",
      level: "warn",
      actual: report.rates.schemaFailureRate,
      threshold: resolvedThresholds.maxSchemaFailureRate,
      message: `schemaFailureRate ${report.rates.schemaFailureRate} exceeds threshold ${resolvedThresholds.maxSchemaFailureRate}.`
    });
  }

  return alerts;
}

function buildRolloutReport(entries, options = {}) {
  const safeEntries = Array.isArray(entries) ? entries.slice() : [];
  const runRecords = buildRunRecords(safeEntries)
    .filter((record) => record.startEvent || record.finalEvent)
    .map(summarizeRunRecord);
  const summary = aggregateRunMetrics(runRecords);
  const startedAt = safeEntries
    .map((entry) => entry?.ts)
    .map(parseTimestamp)
    .filter((value) => value !== null)
    .sort((left, right) => left - right)[0] || null;
  const endedAt = safeEntries
    .map((entry) => entry?.ts)
    .map(parseTimestamp)
    .filter((value) => value !== null)
    .sort((left, right) => right - left)[0] || null;

  const report = {
    reportType: "langgraph-rollout-report",
    batchId: options.batchId || null,
    observedWindow: {
      startedAt: startedAt ? new Date(startedAt).toISOString() : null,
      endedAt: endedAt ? new Date(endedAt).toISOString() : null
    },
    totals: summary.totals,
    rates: summary.rates,
	    latency: summary.latency,
	    failures: summary.failures,
	    scenes: aggregateByScene(runRecords),
	    runs: runRecords
  };

  report.alerts = buildAlerts(report, options.thresholds || {});

  return report;
}

module.exports = {
  DEFAULT_ALERT_THRESHOLDS,
  buildAlerts,
  buildRolloutReport,
  parseJsonLines
};
