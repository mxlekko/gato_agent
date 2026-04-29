const { compileWorkflowGraphForScene } = require("../platform/compiler/compile-workflow");
const { createAppError } = require("../utils/errors");
const { loadRunBundles } = require("./console-runs");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function parseTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function eventBelongsToTrace(entry, traceId, traceKind) {
  const context = isObject(entry?.context) ? entry.context : {};

  if (context.traceId === traceId) {
    return true;
  }

  if (traceKind === "shadow" && context.shadowTraceId === traceId) {
    return true;
  }

  return false;
}

function compareTimeline(left, right) {
  const leftTs = parseTimestamp(left?.at);
  const rightTs = parseTimestamp(right?.at);

  if (leftTs === null && rightTs === null) {
    return 0;
  }

  if (leftTs === null) {
    return 1;
  }

  if (rightTs === null) {
    return -1;
  }

  return leftTs - rightTs;
}

function safeCompileGraph(scene) {
  if (!scene) {
    return null;
  }

  try {
    return compileWorkflowGraphForScene({ scene });
  } catch {
    return null;
  }
}

function findTraceBundle(traceId, options = {}) {
  if (!traceId || typeof traceId !== "string") {
    throw createAppError("INVALID_REQUEST", "traceId is required.", {
      stage: "console-trace-detail"
    });
  }

  const bundles = loadRunBundles(options);

  for (const bundle of bundles) {
    const record = bundle.record || {};
    const summary = bundle.summary || {};
    const startContext = isObject(record?.startEvent?.context) ? record.startEvent.context : {};
    const finalContext = isObject(record?.finalEvent?.context) ? record.finalEvent.context : {};
    const fallbackContext = isObject(record?.fallbackTriggeredEvent?.context)
      ? record.fallbackTriggeredEvent.context
      : {};

    if (
      summary.traceId === traceId
      || startContext.traceId === traceId
      || finalContext.traceId === traceId
      || fallbackContext.traceId === traceId
    ) {
      return {
        traceKind: "primary",
        bundle
      };
    }

    const shadowContext = isObject(record?.shadowCompletedEvent?.context)
      ? record.shadowCompletedEvent.context
      : {};
    if (shadowContext.shadowTraceId === traceId) {
      return {
        traceKind: "shadow",
        bundle
      };
    }
  }

  throw createAppError("INVALID_REQUEST", `Trace not found: ${traceId}.`, {
    httpStatus: 404,
    stage: "console-trace-detail",
    details: {
      traceId
    }
  });
}

function summarizeTimelineEntry(entry) {
  const context = isObject(entry?.context) ? entry.context : {};

  switch (entry?.message) {
    case "agent.run.start":
      return {
        label: "Run Started",
        status: "info",
        summary: [
          context.scene || null,
          context.requestedMode || null,
          context.effectiveMode || null,
          context.executionMode || null
        ].filter(Boolean).join(" / ")
      };
    case "agent.run.success":
      return {
        label: "Run Success",
        status: "success",
        summary: [
          `duration=${safeNumber(context.durationMs) ?? "-" }ms`,
          context.sceneExecutionType || null
        ].filter(Boolean).join(" / ")
      };
    case "agent.run.completed":
      return {
        label: "Run Completed",
        status: context.success === false ? "warning" : "success",
        summary: [
          `success=${String(Boolean(context.success))}`,
          context.code || null,
          context.stage || null,
          context.httpStatus ? `http=${context.httpStatus}` : null
        ].filter(Boolean).join(" / ")
      };
    case "agent.run.failed":
      return {
        label: "Run Failed",
        status: "error",
        summary: [
          context.code || null,
          context.stage || null,
          context.httpStatus ? `http=${context.httpStatus}` : null
        ].filter(Boolean).join(" / ")
      };
    case "agent.langgraph.fallback.triggered":
      return {
        label: "Fallback Triggered",
        status: "warning",
        summary: [
          context.fallbackErrorCode || null,
          context.fallbackErrorStage || null,
          context.fallbackLastNodeId || null
        ].filter(Boolean).join(" / ")
      };
    case "agent.langgraph.fallback.completed":
      return {
        label: "Fallback Completed",
        status: context.fallbackLegacySuccess === true ? "success" : "warning",
        summary: [
          `legacySuccess=${String(Boolean(context.fallbackLegacySuccess))}`,
          context.fallbackLegacyHttpStatus ? `http=${context.fallbackLegacyHttpStatus}` : null,
          context.fallbackLegacyDurationMs ? `duration=${context.fallbackLegacyDurationMs}ms` : null
        ].filter(Boolean).join(" / ")
      };
    case "agent.langgraph.fallback.failed":
      return {
        label: "Fallback Failed",
        status: "error",
        summary: [
          context.fallbackLegacyErrorCode || context.fallbackErrorCode || null,
          context.fallbackLegacyErrorStage || context.fallbackErrorStage || null
        ].filter(Boolean).join(" / ")
      };
    case "agent.shadow.completed":
      return {
        label: "Shadow Completed",
        status: context.shadowDiffPassed === true ? "success" : "warning",
        summary: [
          `passed=${String(Boolean(context.shadowDiffPassed))}`,
          context.shadowDifferenceCount !== undefined && context.shadowDifferenceCount !== null
            ? `differences=${context.shadowDifferenceCount}`
            : null,
          context.shadowErrorCode || null
        ].filter(Boolean).join(" / ")
      };
    case "agent.shadow.failed":
      return {
        label: "Shadow Failed",
        status: "error",
        summary: [
          context.code || null,
          context.stage || null
        ].filter(Boolean).join(" / ")
      };
    default:
      return {
        label: entry?.message || "unknown",
        status: entry?.level === "error" ? "error" : "info",
        summary: null
      };
  }
}

function buildTimeline(record, traceId, traceKind) {
  return (Array.isArray(record?.events) ? record.events : [])
    .filter((entry) => eventBelongsToTrace(entry, traceId, traceKind))
    .map((entry) => {
      const meta = summarizeTimelineEntry(entry);
      return {
        at: entry?.ts || null,
        level: entry?.level || "info",
        message: entry?.message || null,
        label: meta.label,
        status: meta.status,
        summary: meta.summary
      };
    })
    .sort(compareTimeline);
}

function buildObservedNodeMap({ traceKind, record, traceId }) {
  const observed = new Map();

  if (traceKind === "shadow") {
    const shadowContext = isObject(record?.shadowCompletedEvent?.context)
      ? record.shadowCompletedEvent.context
      : {};
    const statuses = Array.isArray(shadowContext.shadowNodeStatuses)
      ? shadowContext.shadowNodeStatuses
      : [];

    for (const item of statuses) {
      if (!item?.nodeId) {
        continue;
      }

      observed.set(item.nodeId, {
        status: item.status || "success",
        duration_ms: null,
        input_summary: null,
        output_summary: {
          source: "shadow-summary",
          nodeStatusKnown: true
        },
        error: null,
        source: "shadow-summary",
        observed: true
      });
    }

    return observed;
  }

  const fallbackContext = isObject(record?.fallbackTriggeredEvent?.context)
    ? record.fallbackTriggeredEvent.context
    : {};
  if (fallbackContext.traceId !== traceId || !fallbackContext.fallbackLastNodeId) {
    return observed;
  }

  observed.set(fallbackContext.fallbackLastNodeId, {
    status: fallbackContext.fallbackLastNodeStatus || "error",
    duration_ms: null,
    input_summary: null,
    output_summary: {
      source: "fallback-summary",
      fallbackNodeRunCount: safeNumber(fallbackContext.fallbackNodeRunCount)
    },
    error: {
      code: fallbackContext.fallbackErrorCode || null,
      stage: fallbackContext.fallbackErrorStage || null,
      httpStatus: safeNumber(fallbackContext.fallbackErrorHttpStatus)
    },
    source: "fallback-summary",
    observed: true
  });

  return observed;
}

function extractPersistedNodeRuns(record, traceId, traceKind) {
  const events = Array.isArray(record?.events) ? record.events : [];

  for (const entry of events) {
    if (!eventBelongsToTrace(entry, traceId, traceKind)) {
      continue;
    }

    const context = isObject(entry?.context) ? entry.context : {};
    const candidate =
      context.nodeRuns
      || context.node_runs
      || context?.artifacts?.node_runs
      || context?.finalState?.artifacts?.node_runs
      || null;

    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

function normalizeNodeRun(run, graphNode = null, fallback = {}) {
  const expectedInputs = Array.isArray(graphNode?.inputs) ? graphNode.inputs : [];
  const expectedOutputs = Array.isArray(graphNode?.outputs) ? graphNode.outputs : [];

  return {
    node_id: run?.node_id || run?.nodeId || graphNode?.id || fallback.nodeId || null,
    phase: graphNode?.phase || null,
    category: graphNode?.category || null,
    toolRole: graphNode?.toolRole || null,
    observed: run?.observed === true,
    status: run?.status || "unknown",
    duration_ms: safeNumber(run?.duration_ms ?? run?.durationMs),
    input_summary: run?.input_summary || run?.inputSummary || {
      source: fallback.summarySource || "workflow-contract",
      expectedInputs
    },
    output_summary: run?.output_summary || run?.outputSummary || {
      source: fallback.summarySource || "workflow-contract",
      expectedOutputs
    },
    error: isObject(run?.error) ? cloneJson(run.error) : (fallback.error || null),
    source: fallback.summarySource || "workflow-contract"
  };
}

function buildNodeRuns({ traceKind, summary, record, graph, traceId }) {
  if (!graph || (traceKind !== "shadow" && summary?.sceneExecutionType !== "langgraph-stategraph")) {
    return [];
  }

  const persistedNodeRuns = extractPersistedNodeRuns(record, traceId, traceKind);
  if (persistedNodeRuns.length > 0) {
    return persistedNodeRuns.map((run, index) => {
      const graphNode = graph.nodesById?.[run?.node_id || run?.nodeId] || graph.nodesById?.[graph.orderedNodeIds[index]];
      return normalizeNodeRun(run, graphNode, {
        summarySource: "runtime-node-run"
      });
    });
  }

  const observed = buildObservedNodeMap({
    traceKind,
    record,
    traceId
  });

  return graph.orderedNodeIds.map((nodeId) => {
    const graphNode = graph.nodesById?.[nodeId] || { id: nodeId };
    const observedRun = observed.get(nodeId);
    return normalizeNodeRun(observedRun || { node_id: nodeId, observed: false, status: "not_persisted" }, graphNode, {
      nodeId,
      summarySource: observedRun?.source || "workflow-contract",
      error: observedRun?.error || null
    });
  });
}

function buildToolSummary(nodeRuns, graph) {
  const toolBindings = isObject(graph?.workflowBinding?.skillSpec?.toolBindings)
    ? graph.workflowBinding.skillSpec.toolBindings
    : {};

  return nodeRuns
    .filter((nodeRun) => (
      nodeRun.category === "tool"
      || nodeRun.category === "llm"
      || Boolean(nodeRun.toolRole)
    ))
    .map((nodeRun) => {
      const binding = isObject(toolBindings[nodeRun.toolRole]) ? toolBindings[nodeRun.toolRole] : {};
      return {
        node_id: nodeRun.node_id,
        category: nodeRun.category,
        phase: nodeRun.phase,
        toolRole: nodeRun.toolRole || null,
        toolRef: binding.toolRef || null,
        purpose: binding.purpose || null,
        status: nodeRun.status,
        observed: nodeRun.observed === true,
        source: nodeRun.source
      };
    });
}

function buildTraceNote({ traceKind, summary, nodeRuns }) {
  if (nodeRuns.length > 0 && nodeRuns.some((item) => item.source === "runtime-node-run")) {
    return "当前 trace 已包含持久化 node_runs，可查看节点输入摘要、输出摘要、耗时和错误。";
  }

  if (traceKind === "shadow") {
    return "当前 shadow trace 只记录了 shadow 完成摘要；节点输入/输出先按 workflow 合同和 shadow 摘要兜底。";
  }

  if (summary?.sceneExecutionType === "langgraph-stategraph") {
    return "当前 trace 未持久化 node_runs；页面使用 workflow 合同和 fallback 事件摘要补全节点视图。";
  }

  return "当前 trace 来自 legacy/direct-model 运行日志，不包含节点级运行记录。";
}

function getConsoleTraceDetail(traceId, options = {}) {
  const { traceKind, bundle } = findTraceBundle(traceId, options);
  const { summary, record } = bundle;
  const shadowContext = isObject(record?.shadowCompletedEvent?.context)
    ? record.shadowCompletedEvent.context
    : {};
  const scene = summary.scene || shadowContext.scene || null;
  const graph = safeCompileGraph(scene);
  const timeline = buildTimeline(record, traceId, traceKind);
  const nodeRuns = buildNodeRuns({
    traceKind,
    summary,
    record,
    graph,
    traceId
  });
  const toolSummary = buildToolSummary(nodeRuns, graph);

  const resolvedRequest = traceKind === "shadow"
    ? {
        scene,
        bizParamKeys: Array.isArray(shadowContext.bizParamKeys) ? shadowContext.bizParamKeys : [],
        bizParams: isObject(shadowContext.bizParamSummary) ? cloneJson(shadowContext.bizParamSummary) : {}
      }
    : cloneJson(summary.request || null);
  const resolvedRouting = {
    requestedMode: traceKind === "shadow"
      ? (shadowContext.requestedMode || summary.requestedMode || null)
      : summary.requestedMode,
    effectiveMode: traceKind === "shadow"
      ? (shadowContext.effectiveMode || summary.effectiveMode || null)
      : summary.effectiveMode,
    executionMode: traceKind === "shadow"
      ? (shadowContext.executionMode || summary.executionMode || null)
      : summary.executionMode,
    sceneExecutionType: summary.sceneExecutionType,
    fallbackTriggered: summary.fallbackTriggered
  };
  const resolvedResult = {
    success: traceKind === "shadow"
      ? (safeBoolean(shadowContext.shadowResultSuccess) ?? summary.success)
      : summary.success,
    httpStatus: summary.httpStatus,
    durationMs: summary.durationMs,
    errorCode: traceKind === "shadow"
      ? (shadowContext.shadowErrorCode || summary.errorCode || null)
      : (summary.errorCode || null),
    errorStage: summary.errorStage || null
  };

  return {
    traceId,
    requestId: summary.requestId,
    runId: summary.runId,
    scene,
    traceKind,
    source: nodeRuns.some((item) => item.source === "runtime-node-run")
      ? "runtime-node-run"
      : "event-log-summary",
    startedAt: summary.startedAt || timeline[0]?.at || null,
    completedAt: summary.completedAt || timeline[timeline.length - 1]?.at || null,
    request: resolvedRequest,
    routing: resolvedRouting,
    result: resolvedResult,
    workflow: graph
      ? {
          template: cloneJson(graph.template),
          skill: cloneJson(graph.skill)
        }
      : null,
    timeline,
    nodeRuns,
    toolSummary,
    note: buildTraceNote({
      traceKind,
      summary,
      nodeRuns
    })
  };
}

module.exports = {
  getConsoleTraceDetail
};
