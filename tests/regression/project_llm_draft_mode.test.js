#!/usr/bin/env node

const assert = require("assert");
const {
  buildProjectAdvisoryMessages,
  invokeProjectAdvisoryLlm
} = require("../../platform/runtime/llm-client");
const { runDraftOutputNode } = require("../../platform/nodes/draft-output");

function withEnv(patch, fn) {
  const previous = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    if (patch[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = patch[key];
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function createToolDocument() {
  return {
    spec: {
      ref: "tool://llm/project-advisory@v1",
      toolRole: "advisory_llm",
      driver: {
        type: "project-llm",
        providerRef: "env"
      },
      limits: {
        timeoutMsDefault: 30000,
        timeoutMsMax: 35000
      }
    }
  };
}

function createDraftState() {
  return {
    request: {
      scene: "sales-opportunity-advisor-directdb",
      normalized: {
        biz_params: {
          opportunityId: "2041340312877535232"
        }
      },
      biz_params: {
        opportunityId: "2041340312877535232"
      }
    },
    runtime_context: {
      request_id: "req_project_llm_test"
    },
    artifacts: {
      references: {
        prompt: "请输出销售机会推进建议 JSON。",
        rules: "只基于事实输出。",
        output_schema: {
          type: "object"
        }
      },
      reference_meta: {
        prompt: {
          ref: "prompt://sales-opportunity-advisor-directdb/draft-business-output@v1"
        }
      },
      facts: {
        profile: {
          opportunityName: "测试机会",
          salesStage: "招标与投标"
        },
        items: [
          {
            field: "opportunityName",
            value_text: "测试机会"
          },
          {
            field: "salesStage",
            value_text: "招标与投标"
          }
        ],
        basis_fields: [
          "opportunityName",
          "salesStage"
        ]
      },
      knowledge: {
        matches: []
      }
    }
  };
}

function createSmartEntryDraftState() {
  return {
    request: {
      scene: "sales-opportunity-smart-entry",
      normalized: {
        biz_params: {
          opportunityId: "2041377071732625408",
          rawText: "客户反馈预算已确认，下周安排技术评审，请补充实施周期和交付风险。"
        }
      },
      biz_params: {
        opportunityId: "2041377071732625408",
        rawText: "客户反馈预算已确认，下周安排技术评审，请补充实施周期和交付风险。"
      }
    },
    runtime_context: {
      request_id: "req_smart_entry_draft_test"
    },
    artifacts: {
      context: {
        raw: {
          rawRow: {
            opportunityId: "2041377071732625408",
            salesScene: "noTender",
            opportunityName: "测试机会",
            customerName: "测试客户",
            projectBudgetAndSchedule: "原预算待确认"
          }
        }
      },
      references: {
        prompt: "请输出智能录入 JSON。",
        rules: "rawText 是本次字段更新指令。",
        output_schema: {
          type: "object"
        }
      },
      reference_meta: {
        prompt: {
          ref: "prompt://sales-opportunity-smart-entry/draft-business-output@v1"
        }
      },
      facts: {
        profile: {
          opportunityId: "2041377071732625408",
          salesScene: "noTender",
          opportunityName: "测试机会"
        },
        items: [
          {
            field: "opportunityId",
            raw_value: "2041377071732625408",
            value_text: "2041377071732625408"
          },
          {
            field: "salesScene",
            raw_value: "noTender",
            value_text: "不招标"
          },
          {
            field: "opportunityName",
            raw_value: "测试机会",
            value_text: "测试机会"
          }
        ],
        basis_fields: [
          "salesScene",
          "opportunityName"
        ]
      },
      knowledge: {
        matches: []
      }
    }
  };
}

async function testProjectLlmClientParsesJsonPayload() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({
      url,
      options
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "已生成",
                adviceText: "继续推进",
                nextActions: ["确认预算"]
              })
            }
          }
        ]
      })
    };
  };

  const result = await invokeProjectAdvisoryLlm({
    toolDocument: createToolDocument(),
    requestPayload: {
      prompt: "请输出 JSON。",
      request: {
        biz_params: {
          opportunityId: "2041340312877535232"
        }
      },
      facts: {
        salesStage: "招标与投标"
      },
      basisFields: ["salesStage"],
      rules: "只基于事实。",
      schema: {
        type: "object"
      }
    },
    promptRef: "prompt://test",
    scene: "sales-opportunity-advisor-directdb",
    env: {
      PROJECT_LLM_PROVIDER: "moonshot",
      PROJECT_LLM_API_KEY: "test-key",
      PROJECT_LLM_MODEL: "moonshot-v1-8k"
    },
    fetchImpl
  });

  assert.strictEqual(result.mode, "project-llm");
  assert.strictEqual(result.provider, "moonshot");
  assert.strictEqual(result.payload.summary, "已生成");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, "https://api.moonshot.cn/v1/chat/completions");
  assert.strictEqual(calls[0].options.headers.Authorization, "Bearer test-key");
}

async function testProjectLlmMissingKeyReturnsClearError() {
  let thrown = null;
  try {
    await invokeProjectAdvisoryLlm({
      toolDocument: createToolDocument(),
      requestPayload: {
        prompt: "请输出 JSON。",
        request: {},
        facts: {},
        rules: "只基于事实。",
        schema: {
          type: "object"
        }
      },
      env: {
        PROJECT_LLM_PROVIDER: "moonshot"
      },
      fetchImpl: async () => {
        throw new Error("fetch must not be called without a key");
      }
    });
  } catch (error) {
    thrown = error;
  }

  assert(thrown);
  assert.strictEqual(thrown.code, "MODEL_INVOCATION_FAILED");
  assert.strictEqual(thrown.stage, "project-llm");
  assert.deepStrictEqual(thrown.details.keyEnvNames, [
    "LANGGRAPH_LLM_API_KEY",
    "PROJECT_LLM_API_KEY",
    "MOONSHOT_API_KEY"
  ]);
}

async function testProjectLlmInvalidJsonUsesDedicatedCode() {
  let thrown = null;
  try {
    await invokeProjectAdvisoryLlm({
      toolDocument: createToolDocument(),
      requestPayload: {
        prompt: "请输出 JSON。",
        request: {},
        facts: {},
        rules: "只基于事实。",
        schema: {
          type: "object"
        }
      },
      env: {
        PROJECT_LLM_PROVIDER: "moonshot",
        PROJECT_LLM_API_KEY: "test-key"
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [
            {
              message: {
                content: "not json"
              }
            }
          ]
        })
      })
    });
  } catch (error) {
    thrown = error;
  }

  assert(thrown);
  assert.strictEqual(thrown.code, "MODEL_INVALID_JSON");
  assert.strictEqual(thrown.stage, "project-llm");
}

async function testDraftOutputProjectLlmModeCanBeInjected() {
  await withEnv({
    LANGGRAPH_DRAFT_MODE: "project-llm"
  }, async () => {
    const nextState = await runDraftOutputNode({
      state: createDraftState(),
      invokeProjectLlm: async ({ toolDocument, requestPayload, promptRef, scene }) => {
        assert.strictEqual(toolDocument.spec.ref, "tool://llm/project-advisory@v1");
        assert.strictEqual(requestPayload.promptRef, "prompt://sales-opportunity-advisor-directdb/draft-business-output@v1");
        assert.strictEqual(requestPayload.prompt, "请输出销售机会推进建议 JSON。");
        assert.strictEqual(scene, "sales-opportunity-advisor-directdb");
        return {
          mode: "project-llm",
          provider: "mock-provider",
          model: "mock-model",
          apiKeySource: "MOCK_API_KEY",
          payload: {
            opportunityId: "2041340312877535232",
            summary: "测试机会处于招标与投标阶段。",
            adviceText: "准备投标材料。",
            nextActions: ["确认投标节点"],
            basisFields: ["opportunityName", "salesStage"]
          }
        };
      }
    });

    assert.strictEqual(nextState.error, null);
    assert.strictEqual(nextState.artifacts.draft.mode, "project-llm");
    assert.strictEqual(nextState.artifacts.draft.tool_ref, "tool://llm/project-advisory@v1");
    assert.strictEqual(nextState.artifacts.draft.provider, "mock-provider");
    assert.strictEqual(nextState.artifacts.draft.model, "mock-model");
    assert.strictEqual(nextState.artifacts.draft.api_key_source, "MOCK_API_KEY");
    assert.strictEqual(nextState.artifacts.draft.payload.summary, "测试机会处于招标与投标阶段。");
    const nodeRun = nextState.artifacts.node_runs[nextState.artifacts.node_runs.length - 1];
    assert.strictEqual(nodeRun.output_summary.provider, "mock-provider");
    assert.strictEqual(nodeRun.output_summary.model, "mock-model");
    assert.strictEqual(nodeRun.output_summary.apiKeySource, "MOCK_API_KEY");
  });
}

async function testDraftOutputDefaultCompatModeUsesCompatPayload() {
  await withEnv({
    LANGGRAPH_DRAFT_MODE: undefined
  }, async () => {
    const nextState = await runDraftOutputNode({
      state: createDraftState()
    });

    assert.strictEqual(nextState.error, null);
    assert.strictEqual(nextState.artifacts.draft.mode, "compat");
    assert.strictEqual(nextState.artifacts.draft.tool_ref, "tool://llm/project-advisory@v1");
    assert.strictEqual(nextState.artifacts.draft.payload.opportunityId, "2041340312877535232");
  });
}

async function testDraftOutputMockModeUsesCompatPayload() {
  await withEnv({
    LANGGRAPH_DRAFT_MODE: "mock"
  }, async () => {
    const nextState = await runDraftOutputNode({
      state: createDraftState()
    });

    assert.strictEqual(nextState.error, null);
    assert.strictEqual(nextState.artifacts.draft.mode, "mock");
    assert.strictEqual(nextState.artifacts.draft.tool_ref, "tool://llm/project-advisory@v1");
    assert.strictEqual(nextState.artifacts.draft.payload.opportunityId, "2041340312877535232");
  });
}

async function testSmartEntryCompatModeUsesRawTextAndSchemaShape() {
  await withEnv({
    LANGGRAPH_DRAFT_MODE: undefined
  }, async () => {
    const nextState = await runDraftOutputNode({
      state: createSmartEntryDraftState()
    });

    const payload = nextState.artifacts.draft.payload;
    assert.strictEqual(nextState.error, null);
    assert.strictEqual(nextState.artifacts.draft.mode, "compat");
    assert.strictEqual(payload.opportunityId, "2041377071732625408");
    assert.strictEqual(payload.salesScene, "noTender");
    assert(payload.data);
    assert.strictEqual(payload.summary, undefined);
    assert.strictEqual(payload.adviceText, undefined);
    assert.strictEqual(payload.nextActions, undefined);
    assert.match(payload.data.projectBudgetAndSchedule, /客户反馈预算已确认/);
  });
}

async function testSmartEntryProjectLlmUsesCompactContextAndMergesPayload() {
  await withEnv({
    LANGGRAPH_DRAFT_MODE: "project-llm"
  }, async () => {
    const state = createSmartEntryDraftState();
    state.request.normalized.biz_params.rawText = "客户确认这单属于招标已设计场景，推荐品牌可以替换，核心参数满足，投标时间改为2026-04-30，采购时间预计2026-05-20。";
    state.request.biz_params.rawText = state.request.normalized.biz_params.rawText;

    const nextState = await runDraftOutputNode({
      state,
      invokeProjectLlm: async ({ requestPayload, promptRef, scene }) => {
        assert.strictEqual(scene, "sales-opportunity-smart-entry");
        assert.strictEqual(promptRef, "prompt://sales-opportunity-smart-entry/draft-business-output@v1");
        assert.strictEqual(requestPayload.compact.kind, "sales-opportunity-smart-entry");
        assert.strictEqual(requestPayload.compact.currentPayload.salesScene, "noTender");

        const messages = buildProjectAdvisoryMessages({
          requestPayload,
          promptRef,
          scene
        });
        const totalMessageLength = messages.reduce((sum, message) => sum + message.content.length, 0);
        assert(totalMessageLength < 5000);
        assert(!messages[1].content.includes("outputSchema:"));

        return {
          mode: "project-llm",
          provider: "mock-provider",
          model: "mock-model",
          apiKeySource: "MOCK_API_KEY",
          payload: {
            opportunityId: "2041377071732625408",
            salesScene: "招标已设计",
            data: {
              canControlBid: "是",
              productShare: "是",
              tenderTime: "2026-04-30",
              purchaseTime: "2026-05-20"
            }
          }
        };
      }
    });

    const payload = nextState.artifacts.draft.payload;
    assert.strictEqual(nextState.error, null);
    assert.strictEqual(nextState.artifacts.draft.mode, "project-llm");
    assert.strictEqual(payload.salesScene, "tenderDesigned");
    assert.strictEqual(payload.data.opportunityName, "测试机会");
    assert.strictEqual(payload.data.canControlBid, "是");
    assert.strictEqual(payload.data.productShare, "是");
    assert.strictEqual(payload.data.tenderTime, "2026-04-30");
    assert.strictEqual(payload.data.purchaseTime, "2026-05-20");
    assert.strictEqual(payload.data.projectBudgetAndSchedule, undefined);
  });
}

async function main() {
  await testProjectLlmClientParsesJsonPayload();
  await testProjectLlmMissingKeyReturnsClearError();
  await testProjectLlmInvalidJsonUsesDedicatedCode();
  await testDraftOutputProjectLlmModeCanBeInjected();
  await testDraftOutputDefaultCompatModeUsesCompatPayload();
  await testDraftOutputMockModeUsesCompatPayload();
  await testSmartEntryCompatModeUsesRawTextAndSchemaShape();
  await testSmartEntryProjectLlmUsesCompactContextAndMergesPayload();
  process.stdout.write("project llm draft mode tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
