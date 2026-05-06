#!/usr/bin/env node

const assert = require("assert");
const { runSceneThroughGateway, resolveSceneRoutePlan } = require("../../platform/gateway");
const { runLangGraphAgentRuntimeRoute } = require("../../routes/agent");
const { createAppError } = require("../../utils/errors");

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous;
      }
    });
}

function createLangGraphRouteArgs(legacyFallbackEnabled) {
  const routePlan = {
    requestedMode: "langgraph",
    effectiveMode: "langgraph",
    executionMode: "agent-runtime",
    allowedModes: ["legacy", "langgraph"],
    reason: "langgraph_request_percentage",
    shadowExecutionEnabled: false,
    platformManagedScene: true,
    legacyFallbackEnabled
  };

  return {
    requestId: "req_fallback_switch",
    traceId: "trace_fallback_switch",
    scene: "sales-opportunity-advisor-directdb",
    sceneConfig: {
      scene: "sales-opportunity-advisor-directdb"
    },
    bizParams: {
      opportunityId: "2041340312877535232"
    },
    routePlan,
    traceContext: {
      requestId: "req_fallback_switch",
      traceId: "trace_fallback_switch",
      scene: "sales-opportunity-advisor-directdb",
      requestedMode: "langgraph",
      effectiveMode: "langgraph",
      executionMode: "agent-runtime",
      shadowExecutionEnabled: false,
      legacyFallbackEnabled,
      routeReason: "langgraph_request_percentage"
    }
  };
}

function createGraphRuntimeError() {
  return createAppError("RUNTIME_TIMEOUT", "Synthetic graph timeout.", {
    stage: "graph-runtime"
  });
}

async function testFallbackEnabledIsRetiredAndDoesNotCallLegacy() {
  await withEnv("LANGGRAPH_LEGACY_FALLBACK_ENABLED", "1", async () => {
    let legacyCalls = 0;
    let thrown = null;

    try {
      await runLangGraphAgentRuntimeRoute(
        createLangGraphRouteArgs(true),
        {
          executeLangGraph: async () => {
            throw createGraphRuntimeError();
          },
          executeLegacyScene: async () => {
            legacyCalls += 1;
            throw new Error("legacy must not be called");
          }
        }
      );
    } catch (error) {
      thrown = error;
    }

    assert(thrown);
    assert.strictEqual(legacyCalls, 0);
    assert.strictEqual(thrown.code, "RUNTIME_TIMEOUT");
    assert.strictEqual(thrown.traceContext?.legacyFallbackEnabled, false);
    assert.strictEqual(thrown.traceContext?.fallbackSuppressed, true);
  });
}

async function testFallbackDisabledDoesNotCallLegacyOnException() {
  await withEnv("LANGGRAPH_LEGACY_FALLBACK_ENABLED", "0", async () => {
    let legacyCalls = 0;
    let thrown = null;

    try {
      await runLangGraphAgentRuntimeRoute(
        createLangGraphRouteArgs(false),
        {
          executeLangGraph: async () => {
            throw createGraphRuntimeError();
          },
          executeLegacyScene: async () => {
            legacyCalls += 1;
            throw new Error("legacy must not be called");
          }
        }
      );
    } catch (error) {
      thrown = error;
    }

    assert.strictEqual(legacyCalls, 0);
    assert(thrown);
    assert.strictEqual(thrown.code, "RUNTIME_TIMEOUT");
    assert.strictEqual(thrown.traceContext?.legacyFallbackEnabled, false);
    assert.strictEqual(thrown.traceContext?.fallbackSuppressed, true);
  });
}

async function testFallbackDisabledDoesNotCallLegacyOnFinalStateError() {
  await withEnv("LANGGRAPH_LEGACY_FALLBACK_ENABLED", "0", async () => {
    let legacyCalls = 0;
    const response = await runLangGraphAgentRuntimeRoute(
      createLangGraphRouteArgs(false),
      {
        executeLangGraph: async () => ({
          runtime_context: {
            request_id: "req_fallback_switch"
          },
          result: null,
          error: createGraphRuntimeError(),
          artifacts: {
            node_runs: [
              {
                node_id: "fetch_context",
                status: "error"
              }
            ]
          }
        }),
        executeLegacyScene: async () => {
          legacyCalls += 1;
          throw new Error("legacy must not be called");
        }
      }
    );

    assert.strictEqual(legacyCalls, 0);
    assert.strictEqual(response.statusCode, 504);
    assert.strictEqual(response.payload.success, false);
    assert.strictEqual(response.payload.error.code, "RUNTIME_TIMEOUT");
  });
}

async function testDirectModelRouteUnaffected() {
  await withEnv("LANGGRAPH_LEGACY_FALLBACK_ENABLED", "0", async () => {
    let directModelCalls = 0;
    let langGraphCalls = 0;
    const response = await runSceneThroughGateway({
      requestId: "req_direct_model",
      traceId: "trace_direct_model",
      scene: "payment-info-split",
      sceneConfig: {
        scene: "payment-info-split",
        execution: {
          mode: "direct-model"
        },
        routing: {
          mode: "legacy",
          allowedModes: ["legacy"]
        }
      },
      bizParams: {
        rawText: "收款方：测试公司；账号：123；开户行：测试银行"
      },
      handlers: {
        runLegacyDirectModel: async ({ routePlan }) => {
          directModelCalls += 1;
          assert.strictEqual(routePlan.executionMode, "direct-model");
          return {
            statusCode: 200,
            payload: {
              success: true
            }
          };
        },
        runLegacyAgentRuntime: async () => {
          throw new Error("agent runtime must not be called");
        },
        runLangGraphAgentRuntime: async () => {
          langGraphCalls += 1;
          throw new Error("langgraph must not be called");
        }
      }
    });

    assert.strictEqual(directModelCalls, 1);
    assert.strictEqual(langGraphCalls, 0);
    assert.strictEqual(response.statusCode, 200);
  });
}

async function testRoutePlanExposesFallbackSwitch() {
  await withEnv("LANGGRAPH_LEGACY_FALLBACK_ENABLED", undefined, async () => {
    const routePlan = resolveSceneRoutePlan({
      scene: "sales-opportunity-advisor-directdb",
      routing: {
        mode: "langgraph",
        allowedModes: ["legacy", "langgraph"],
        langgraphCutover: {
          requestPercentage: 100
        }
      }
    }, {
      requestId: "req_route_plan"
    });

    assert.strictEqual(routePlan.effectiveMode, "langgraph");
    assert.strictEqual(routePlan.legacyFallbackEnabled, false);
  });
}

async function main() {
  await testFallbackEnabledIsRetiredAndDoesNotCallLegacy();
  await testFallbackDisabledDoesNotCallLegacyOnException();
  await testFallbackDisabledDoesNotCallLegacyOnFinalStateError();
  await testDirectModelRouteUnaffected();
  await testRoutePlanExposesFallbackSwitch();
  process.stdout.write("langgraph fallback switch tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
