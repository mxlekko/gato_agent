const { compileWorkflowGraphForScene } = require("../../compiler/compile-workflow");
const { createAppError, normalizeError } = require("../../../utils/errors");
const { mergeWorkflowState, recordNodeRun } = require("../state");
const { runAuthorizeScopeNode } = require("../../nodes/authorize-scope");
const { runDraftOutputNode } = require("../../nodes/draft-output");
const { runExtractContractDocumentNode } = require("../../nodes/extract-contract-document");
const { runFetchContextNode } = require("../../nodes/fetch-context");
const { runLoadAssetsNode } = require("../../nodes/load-assets");
const { runNormalizeFactsNode } = require("../../nodes/normalize-facts");
const { runRepairOutputNode } = require("../../nodes/repair-output");
const { runRetrieveKnowledgeNode } = require("../../nodes/retrieve-knowledge");
const { runValidateInputNode } = require("../../nodes/validate-input");
const { runValidateOutputNode } = require("../../nodes/validate-output");

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toStateError(error) {
  return {
    code: error.code,
    message: error.message,
    httpStatus: error.httpStatus,
    stage: error.stage,
    retryable: error.retryable,
    details: error.details || null
  };
}

function summarizeGraphInput(state, graph) {
  return {
    scene: state?.request?.scene || null,
    requestId: state?.runtime_context?.request_id || null,
    traceId: state?.runtime_context?.trace_id || null,
    template: graph?.template?.name || null
  };
}

function renameLatestNodeRun(state, nodeId) {
  const nodeRuns = Array.isArray(state?.artifacts?.node_runs)
    ? state.artifacts.node_runs
    : [];

  if (nodeRuns.length === 0) {
    return state;
  }

  const nextNodeRuns = nodeRuns.slice();
  nextNodeRuns[nextNodeRuns.length - 1] = {
    ...nextNodeRuns[nextNodeRuns.length - 1],
    node_id: nodeId
  };

  return mergeWorkflowState(state, {
    artifacts: {
      node_runs: nextNodeRuns
    }
  });
}

async function runBootstrapRuntimeNode({ state, nodeId, graph }) {
  const startedAt = new Date();
  return recordNodeRun(state, {
    nodeId,
    status: "success",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    inputSummary: summarizeGraphInput(state, graph),
    outputSummary: {
      initialized: true
    }
  });
}

async function runLoadWorkflowContractNode({ state, nodeId, graph }) {
  const startedAt = new Date();
  let nextState = recordNodeRun(state, {
    nodeId,
    status: "success",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    inputSummary: summarizeGraphInput(state, graph),
    outputSummary: {
      template: graph?.template?.name || null,
      skill: graph?.skill?.name || null
    }
  });

  nextState = mergeWorkflowState(nextState, {
    scene_contract: {
      request_contract: {
        bizParams: cloneJson(graph?.workflowBinding?.input_contract?.bizParams || state?.scene_contract?.request_contract?.bizParams || {})
      },
      workflow_binding: {
        ...(cloneJson(state?.scene_contract?.workflow_binding || {})),
        ...(cloneJson(graph?.workflowBinding || {}))
      },
      runtime_contract: cloneJson(graph?.workflowBinding?.runtime_contract || null),
      output_contract: cloneJson(graph?.workflowBinding?.output_contract || null)
    },
    artifacts: {
      graph: {
        execution: {
          engine: "langgraph-stategraph",
          template: cloneJson(graph?.template || null),
          skill: cloneJson(graph?.skill || null),
          ordered_node_ids: cloneJson(graph?.orderedNodeIds || [])
        }
      }
    },
    error: null
  });

  return nextState;
}

async function runResolveDataPlanNode({ state, nodeId, graph }) {
  const startedAt = new Date();
  const dataProfile = cloneJson(graph?.workflowBinding?.data_profile || {});
  let nextState = recordNodeRun(state, {
    nodeId,
    status: "success",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    inputSummary: summarizeGraphInput(state, graph),
    outputSummary: {
      queryProfileRef: dataProfile.queryProfileRef || null
    }
  });

  nextState = mergeWorkflowState(nextState, {
    artifacts: {
      context: {
        query_plan: {
          query_profile_ref: dataProfile.queryProfileRef || null,
          input_mapping: cloneJson(dataProfile.inputMapping || null),
          expected_result_path: dataProfile.expectedResultPath || null,
          selection_policy: cloneJson(dataProfile.queryProfile?.selectionPolicy || null)
        }
      }
    },
    error: null
  });

  return nextState;
}

async function runSelectBasisFieldsNode({ state, nodeId, graph }) {
  const startedAt = new Date();
  const basisFields = Array.isArray(state?.artifacts?.facts?.basis_fields)
    ? state.artifacts.facts.basis_fields
    : [];
  const maxBasisFields = Number(graph?.nodesById?.select_basis_fields?.maxBasisFields || 8);
  const trimmedBasisFields = basisFields.slice(0, Number.isFinite(maxBasisFields) ? maxBasisFields : 8);

  let nextState = recordNodeRun(state, {
    nodeId,
    status: "success",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    inputSummary: summarizeGraphInput(state, graph),
    outputSummary: {
      basisFieldCount: trimmedBasisFields.length
    }
  });

  nextState = mergeWorkflowState(nextState, {
    artifacts: {
      facts: {
        basis_fields: trimmedBasisFields
      }
    },
    error: null
  });

  return nextState;
}

async function runFinalizeResultNode({ state, nodeId, graph }) {
  const startedAt = new Date();
  const validationPayload = state?.artifacts?.validation?.payload;
  const resultPayload = validationPayload || state?.artifacts?.draft?.payload || null;
  const hasError = Boolean(state?.error);
  let nextState = recordNodeRun(state, {
    nodeId,
    status: hasError ? "business_error" : "success",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    inputSummary: summarizeGraphInput(state, graph),
    outputSummary: {
      finalizedSuccess: !hasError && Boolean(resultPayload),
      errorCode: state?.error?.code || null
    }
  });

  if (!hasError && resultPayload) {
    nextState = mergeWorkflowState(nextState, {
      result: {
        success: true,
        scene: state?.request?.scene || null,
        requestId: state?.runtime_context?.request_id || null,
        payload: cloneJson(resultPayload)
      },
      error: null,
      artifacts: {
        graph: {
          execution: {
            finalized_at: new Date().toISOString(),
            result_source: validationPayload ? "validation" : "draft"
          }
        },
        outputs: {
          finalize_result: {
            finalized: true,
            success: true
          }
        }
      }
    });

    return nextState;
  }

  nextState = mergeWorkflowState(nextState, {
    result: null,
    error: hasError ? toStateError(normalizeError(state.error)) : null,
    artifacts: {
      graph: {
        execution: {
          finalized_at: new Date().toISOString(),
          result_source: "error"
        }
      },
      outputs: {
        finalize_result: {
          finalized: true,
          success: false,
          error_code: state?.error?.code || null
        }
      }
    }
  });

  return nextState;
}

async function runObserveRunNode({ state, nodeId, graph }) {
  const startedAt = new Date();
  const nodeRuns = Array.isArray(state?.artifacts?.node_runs) ? state.artifacts.node_runs : [];
  let nextState = recordNodeRun(state, {
    nodeId,
    status: "success",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    inputSummary: summarizeGraphInput(state, graph),
    outputSummary: {
      nodeRunCount: nodeRuns.length,
      resultSuccess: state?.result?.success === true,
      errorCode: state?.error?.code || null
    }
  });

  nextState = mergeWorkflowState(nextState, {
    artifacts: {
      graph: {
        execution: {
          observed_at: new Date().toISOString(),
          node_run_count: nodeRuns.length + 1,
          result_success: state?.result?.success === true,
          error_code: state?.error?.code || null
        }
      },
      outputs: {
        observe_run: {
          observed: true,
          node_run_count: nodeRuns.length + 1,
          result_success: state?.result?.success === true,
          error_code: state?.error?.code || null
        }
      }
    }
  });

  return nextState;
}

async function executeGraphNode({ state, nodeId, graph, executors }) {
  switch (nodeId) {
    case "bootstrap_runtime":
      return runBootstrapRuntimeNode({ state, nodeId, graph });
    case "load_workflow_contract":
      return runLoadWorkflowContractNode({ state, nodeId, graph });
    case "validate_input":
      return renameLatestNodeRun(
        await runValidateInputNode({ state }),
        nodeId
      );
    case "authorize_scope":
      return renameLatestNodeRun(
        await runAuthorizeScopeNode({
          state,
          policyProfile: graph?.workflowBinding?.policy_profile || null
        }),
        nodeId
      );
    case "extract_contract_document":
      return renameLatestNodeRun(
        await runExtractContractDocumentNode({
          state,
          timeoutMs: graph?.nodesById?.extract_contract_document?.timeoutMs || null
        }),
        nodeId
      );
    case "resolve_data_plan":
      return runResolveDataPlanNode({ state, nodeId, graph });
    case "fetch_business_context":
      return renameLatestNodeRun(
        await runFetchContextNode({
          state,
          invokeTool: executors.fetchContext
        }),
        nodeId
      );
    case "load_reference_bundle":
      return renameLatestNodeRun(
        await runLoadAssetsNode({ state }),
        nodeId
      );
    case "normalize_facts":
      return renameLatestNodeRun(
        await runNormalizeFactsNode({
          state,
          maxBasisFields: graph?.nodesById?.select_basis_fields?.maxBasisFields || null
        }),
        nodeId
      );
    case "select_basis_fields":
      return runSelectBasisFieldsNode({ state, nodeId, graph });
    case "retrieve_knowledge_context":
      return renameLatestNodeRun(
        await runRetrieveKnowledgeNode({
          state,
          invokeTool: executors.retrieveKnowledge
        }),
        nodeId
      );
    case "draft_business_output":
      return renameLatestNodeRun(
        await runDraftOutputNode({
          state,
          invokeTool: executors.draftOutput
        }),
        nodeId
      );
    case "validate_output":
      return renameLatestNodeRun(
        await runValidateOutputNode({
          state,
          invokeTool: executors.validateOutput
        }),
        nodeId
      );
    case "repair_output":
      return renameLatestNodeRun(
        await runRepairOutputNode({
          state,
          invokeTool: executors.repairOutput
        }),
        nodeId
      );
    case "finalize_result":
      return runFinalizeResultNode({ state, nodeId, graph });
    case "observe_run":
      return runObserveRunNode({ state, nodeId, graph });
    default:
      throw createAppError("INVALID_REQUEST", `Unsupported graph node ${nodeId}.`, {
        stage: "graph-runtime"
      });
  }
}

function determineNextNodeId(currentNodeId, state, graph) {
  if (currentNodeId === graph.exitNode) {
    return null;
  }

  if (currentNodeId === "validate_output") {
    const validationStatus = state?.artifacts?.validation?.status || null;
    const repairAttempts = Array.isArray(state?.artifacts?.draft?.repair_attempts)
      ? state.artifacts.draft.repair_attempts.length
      : 0;
    const repairEnabled = graph?.nodesById?.repair_output?.enabled !== false;

    if (validationStatus === "invalid") {
      if (repairEnabled && repairAttempts < graph.maxRepairLoops) {
        return "repair_output";
      }
      return "finalize_result";
    }

    return "finalize_result";
  }

  if (currentNodeId === "repair_output") {
    return "validate_output";
  }

  if (state?.artifacts?.outputs?.authorize_scope?.denied) {
    return "finalize_result";
  }

  if (state?.error && currentNodeId !== "finalize_result" && currentNodeId !== "observe_run") {
    return "finalize_result";
  }

  return graph?.defaultNextByNodeId?.[currentNodeId] || null;
}

async function runCompiledSceneWorkflow({
  state,
  graph = null,
  compileWorkflowGraph = compileWorkflowGraphForScene,
  executors = {}
} = {}) {
  if (!state || typeof state !== "object") {
    throw createAppError("INVALID_REQUEST", "runCompiledSceneWorkflow requires workflow state.", {
      stage: "graph-runtime"
    });
  }

  const compiledGraph = graph || compileWorkflowGraph({
    scene: state?.request?.scene
  });
  let nextState = mergeWorkflowState(state, {
    scene_contract: {
      workflow_binding: {
        ...(cloneJson(state?.scene_contract?.workflow_binding || {})),
        ...(cloneJson(compiledGraph.workflowBinding || {}))
      }
    }
  });

  let currentNodeId = compiledGraph.entryNode;
  const maxSteps = compiledGraph.orderedNodeIds.length + compiledGraph.maxRepairLoops + 4;
  let steps = 0;

  while (currentNodeId) {
    steps += 1;
    if (steps > maxSteps) {
      throw createAppError("RUNTIME_INVALID_RESPONSE", "Compiled workflow exceeded step limit.", {
        stage: "graph-runtime",
        details: {
          scene: compiledGraph.scene,
          currentNodeId,
          maxSteps
        }
      });
    }

    nextState = await executeGraphNode({
      state: nextState,
      nodeId: currentNodeId,
      graph: compiledGraph,
      executors
    });

    currentNodeId = determineNextNodeId(currentNodeId, nextState, compiledGraph);
  }

  return nextState;
}

module.exports = {
  runCompiledSceneWorkflow
};
