const templateDefinition = {
  name: "grounded-structured-advisory",
  version: "v1",
  title: "Grounded Structured Advisory",
  engineType: "langgraph-stategraph",
  description:
    "先获取 grounded business context，再加载业务 reference bundle，随后由 LLM 起草结构化输出，并通过 schema 校验与修复节点收口。",
  constraints: {
    entryNode: "bootstrap_runtime",
    exitNode: "observe_run",
    maxRepairLoops: 1,
    allowCrossPhaseReorder: false,
    parallelGroups: [
      {
        id: "context_and_assets",
        members: ["fetch_business_context", "load_reference_bundle"]
      }
    ]
  }
};

const templateNodes = [
  {
    id: "bootstrap_runtime",
    phase: "bootstrap",
    category: "system",
    handlerRef: "platform.node.bootstrap_runtime",
    required: true,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: false,
    replaceable: false,
    inputs: ["request.raw"],
    outputs: [
      "runtime.request_id",
      "runtime.trace_id",
      "runtime.started_at",
      "runtime.request_source"
    ],
    allowedConfig: ["timeoutMs"]
  },
  {
    id: "load_workflow_contract",
    phase: "contract",
    category: "system",
    handlerRef: "platform.node.load_workflow_contract",
    required: true,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: false,
    replaceable: false,
    inputs: ["runtime.request_id", "request.scene"],
    outputs: [
      "workflow_contract.template_ref",
      "workflow_contract.scene_ref",
      "workflow_contract.output_schema_ref"
    ],
    allowedConfig: ["timeoutMs"]
  },
  {
    id: "validate_input",
    phase: "policy",
    category: "validation",
    handlerRef: "platform.node.validate_input",
    required: true,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: false,
    replaceable: false,
    inputs: ["request.biz_params", "workflow_contract.input_contract"],
    outputs: ["request.normalized"],
    allowedConfig: ["timeoutMs"]
  },
  {
    id: "authorize_scope",
    phase: "policy",
    category: "policy",
    handlerRef: "platform.node.authorize_scope",
    required: true,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: false,
    replaceable: false,
    inputs: ["request.normalized", "workflow_contract.policy_profile"],
    outputs: ["policy.scope", "policy.allowed_fields"],
    allowedConfig: ["timeoutMs"]
  },
  {
    id: "resolve_data_plan",
    phase: "data",
    category: "planning",
    handlerRef: "platform.node.resolve_data_plan",
    required: false,
    defaultEnabled: true,
    skipAllowed: true,
    reorderable: true,
    replaceable: true,
    inputs: ["request.normalized", "workflow_contract.data_profile"],
    outputs: ["context.query_plan"],
    allowedConfig: ["enabled", "timeoutMs", "retry"]
  },
  {
    id: "fetch_business_context",
    phase: "data",
    category: "tool",
    handlerRef: "platform.node.fetch_business_context",
    required: true,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: true,
    replaceable: true,
    toolRole: "context_fetcher",
    inputs: ["request.normalized", "context.query_plan", "policy.allowed_fields"],
    outputs: ["context.raw"],
    allowedConfig: ["timeoutMs", "retry", "toolRole"]
  },
  {
    id: "load_reference_bundle",
    phase: "data",
    category: "asset",
    handlerRef: "platform.node.load_reference_bundle",
    required: false,
    defaultEnabled: true,
    skipAllowed: true,
    reorderable: true,
    replaceable: true,
    inputs: ["workflow_contract.reference_bundle"],
    outputs: [
      "references.dictionary",
      "references.rules",
      "references.output_schema",
      "references.prompt"
    ],
    allowedConfig: ["enabled", "timeoutMs", "assetRefs"]
  },
  {
    id: "normalize_facts",
    phase: "transform",
    category: "transform",
    handlerRef: "platform.node.normalize_facts",
    required: true,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: false,
    replaceable: false,
    inputs: ["context.raw", "references.dictionary", "policy.allowed_fields"],
    outputs: ["facts.items", "facts.profile"],
    allowedConfig: ["timeoutMs"]
  },
  {
    id: "select_basis_fields",
    phase: "transform",
    category: "transform",
    handlerRef: "platform.node.select_basis_fields",
    required: false,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: true,
    replaceable: true,
    inputs: ["facts.items", "facts.profile", "references.dictionary"],
    outputs: ["facts.basis_fields"],
    allowedConfig: ["timeoutMs", "maxBasisFields"]
  },
  {
    id: "draft_business_output",
    phase: "generation",
    category: "llm",
    handlerRef: "platform.node.draft_business_output",
    required: true,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: false,
    replaceable: true,
    toolRole: "advisory_llm",
    inputs: [
      "request.normalized",
      "facts.profile",
      "facts.items",
      "facts.basis_fields",
      "references.rules",
      "references.prompt"
    ],
    outputs: ["draft.payload"],
    allowedConfig: ["timeoutMs", "retry", "toolRole", "promptRef"]
  },
  {
    id: "validate_output",
    phase: "validation",
    category: "validation",
    handlerRef: "platform.node.validate_output",
    required: true,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: false,
    replaceable: true,
    toolRole: "output_validator",
    inputs: ["draft.payload", "references.output_schema"],
    outputs: [
      "validation.status",
      "validation.payload",
      "validation.error"
    ],
    allowedConfig: ["timeoutMs", "retry", "toolRole"]
  },
  {
    id: "repair_output",
    phase: "validation",
    category: "llm",
    handlerRef: "platform.node.repair_output",
    required: false,
    defaultEnabled: true,
    skipAllowed: true,
    reorderable: false,
    replaceable: true,
    toolRole: "advisory_llm",
    inputs: ["draft.payload", "validation.error", "references.output_schema"],
    outputs: ["draft.payload", "draft.repair_attempts"],
    allowedConfig: ["enabled", "timeoutMs", "retry", "toolRole"]
  },
  {
    id: "finalize_result",
    phase: "finalize",
    category: "finalize",
    handlerRef: "platform.node.finalize_result",
    required: true,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: false,
    replaceable: false,
    inputs: [
      "validation.payload",
      "validation.status",
      "validation.error",
      "error"
    ],
    outputs: ["result"],
    allowedConfig: ["timeoutMs"]
  },
  {
    id: "observe_run",
    phase: "observe",
    category: "observe",
    handlerRef: "platform.node.observe_run",
    required: true,
    defaultEnabled: true,
    skipAllowed: false,
    reorderable: false,
    replaceable: false,
    inputs: ["runtime", "request", "result", "error"],
    outputs: ["runtime.observed"],
    allowedConfig: ["timeoutMs"]
  }
];

const conditionalEdges = [
  {
    from: "authorize_scope",
    when: "policy.denied == true",
    to: "finalize_result",
    description: "权限不足时提前收口。"
  },
  {
    from: "fetch_business_context",
    when: "context.status == 'no_data'",
    to: "finalize_result",
    description: "查无数据时直接返回业务失败。"
  },
  {
    from: "validate_output",
    when: "validation.status == 'invalid' && draft.repair_attempts < 1",
    to: "repair_output",
    description: "允许一次结构修复。"
  },
  {
    from: "validate_output",
    when: "validation.status == 'invalid' && draft.repair_attempts >= 1",
    to: "finalize_result",
    description: "修复次数达到上限后结束。"
  },
  {
    from: "any",
    when: "error != null",
    to: "finalize_result",
    description: "任一节点出现 fatal error 都统一走失败收口。"
  }
];

const sharedAssets = {
  prompts: [
    "prompt://sales-opportunity-advisor/draft-business-output@v1"
  ],
  schemas: [
    "schema://sales-opportunity-advisor/output@v1"
  ],
  dictionaries: [
    "dictionary://sales-opportunity-advisor/fields@v1"
  ],
  rules: [
    "rules://sales-opportunity-advisor/decision-rules@v1"
  ]
};

const sharedEditableAssets = {
  prompt: {
    ref: "prompt://sales-opportunity-advisor/draft-business-output@v1",
    sourceType: "local-file",
    path: "/Users/gato-pm/Desktop/API_副本/platform/assets/prompts/sales-opportunity-advisor.draft-business-output.v1.md",
    editable: true
  },
  schema: {
    ref: "schema://sales-opportunity-advisor/output@v1",
    sourceType: "local-file",
    path: "/Users/gato-pm/Desktop/API_副本/runtime-assets/openclaw/workspace/skills/sales-opportunity-advisor/references/output_schema.json",
    editable: true
  },
  dictionary: {
    ref: "dictionary://sales-opportunity-advisor/fields@v1",
    sourceType: "local-file",
    path: "/Users/gato-pm/Desktop/API_副本/metadata/sales_opportunity_dictionary.tsv",
    editable: true
  },
  rules: {
    ref: "rules://sales-opportunity-advisor/decision-rules@v1",
    sourceType: "local-file",
    path: "/Users/gato-pm/Desktop/API_副本/runtime-assets/openclaw/workspace/skills/sales-opportunity-advisor/references/decision_rules.md",
    editable: true
  }
};

const sharedEditableBindings = {
  queryProfile: {
    ref: "query://sales-opportunity/by-opportunity-id@v1",
    path: "/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-by-opportunity-id.query.yaml",
    editable: true
  },
  inputMapping: {
    path: "/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor.v1.yaml",
    editable: true
  }
};

const helperLegacyOrchestration = [
  {
    order: 1,
    step: "parse-request",
    owner: "skill",
    description: "解析 runtime request，校验 scene、kind、version、opportunityId。"
  },
  {
    order: 2,
    step: "fetch-raw-row",
    owner: "data-tool",
    description: "通过 GenericQueryRunner 按 QueryProfile 执行受控查询并获取销售机会数据。"
  },
  {
    order: 3,
    step: "load-references",
    owner: "skill",
    description: "读取本地字典、规则和输出 schema。"
  },
  {
    order: 4,
    step: "normalize-fields",
    owner: "skill",
    description: "在 skill 内完成字段清洗、字典映射和事实归一。"
  },
  {
    order: 5,
    step: "generate-advice",
    owner: "skill",
    description: "基于事实和规则生成建议 payload。"
  },
  {
    order: 6,
    step: "validate-output",
    owner: "model-tool",
    description: "调用 ModelTool 做结构化输出校验。"
  },
  {
    order: 7,
    step: "return-result",
    owner: "skill",
    description: "封装业务结果并回传 API。"
  }
];

const directdbLegacyOrchestration = [
  {
    order: 1,
    step: "parse-request",
    owner: "skill",
    description: "解析 runtime request，校验 scene、kind、version、opportunityId。"
  },
  {
    order: 2,
    step: "resolve-query-profile",
    owner: "skill",
    description: "在 skill 内选择当前场景绑定的 QueryProfile 和输入映射。"
  },
  {
    order: 3,
    step: "fetch-raw-row",
    owner: "data-tool",
    description: "通过 GenericQueryRunner 按 QueryProfile 执行受控查询并获取销售机会数据。"
  },
  {
    order: 4,
    step: "load-references",
    owner: "skill",
    description: "读取本地字典、规则和输出 schema。"
  },
  {
    order: 5,
    step: "normalize-fields",
    owner: "skill",
    description: "在 skill 内完成字段清洗、字典映射和事实归一。"
  },
  {
    order: 6,
    step: "generate-advice",
    owner: "skill",
    description: "基于事实和规则生成建议 payload。"
  },
  {
    order: 7,
    step: "validate-output",
    owner: "model-tool",
    description: "调用 ModelTool 做结构化输出校验。"
  },
  {
    order: 8,
    step: "return-result",
    owner: "skill",
    description: "封装业务结果并回传 API。"
  }
];

function resolveEnvelope(data, requestId = "mock_console_request") {
  return Promise.resolve({
    ok: true,
    status: 200,
    payload: {
      success: true,
      requestId,
      data,
      error: null
    }
  });
}

function resolveError(status, code, message, details = null) {
  return Promise.resolve({
    ok: false,
    status,
    payload: {
      success: false,
      requestId: "mock_console_request",
      data: null,
      error: {
        code,
        message,
        httpStatus: status,
        stage: "console-mock",
        retryable: false,
        details
      }
    }
  });
}

function buildNodeMap(nodeOverrides) {
  return Object.fromEntries(
    templateNodes.map((node) => {
      const override = nodeOverrides[node.id] || {};
      const enabled =
        override.enabled !== undefined
          ? Boolean(override.enabled)
          : node.defaultEnabled !== false;

      return [
        node.id,
        {
          ...node,
          ...override,
          enabled
        }
      ];
    })
  );
}

function buildTemplateBackedWorkflow({
  scene,
  title,
  description,
  routingMode,
  allowedModes,
  skill,
  runtimeContract,
  toolBindings,
  queryProfileRef,
  inputMapping,
  dataSourceLabel,
  dataSourceKind,
  nodeOverrides,
  nodeOrderOverrides,
  legacyOrchestration,
  editableBindings
}) {
  const nodesById = buildNodeMap(nodeOverrides);
  const orderedNodeIds = templateNodes
    .map((node) => node.id)
    .filter((nodeId) => nodesById[nodeId]?.enabled !== false);

  return {
    scene,
    title,
    description,
    executionMode: "agent-runtime",
    routingMode,
    allowedModes,
    platformManagedScene: true,
    template: templateDefinition,
    skill,
    runtimeContract,
    inputContract: {
      requiredBizParams: ["opportunityId"],
      inputMapping
    },
    outputContract: {
      schemaRef: "schema://sales-opportunity-advisor/output@v1"
    },
    dataSourceLabel,
    dataSourceKind,
    entryNode: templateDefinition.constraints.entryNode,
    exitNode: templateDefinition.constraints.exitNode,
    orderedNodeIds,
    nodesById,
    defaultNextByNodeId: Object.fromEntries(
      orderedNodeIds.map((nodeId, index) => [nodeId, orderedNodeIds[index + 1] || null])
    ),
    toolBindings,
    queryProfileRef,
    conditionalEdges,
    nodeOverrides,
    nodeOrderOverrides,
    assets: sharedAssets,
    editableAssets: sharedEditableAssets,
    editableBindings,
    legacyOrchestration
  };
}

const workflowsByScene = {
  "sales-opportunity-advisor": buildTemplateBackedWorkflow({
    scene: "sales-opportunity-advisor",
    title: "销售机会推进建议（helper）",
    description:
      "通过 GenericQueryRunner 执行受控查询，再按 grounded-structured-advisory 模板完成归一、起草、校验和结果收口。",
    routingMode: "legacy",
    allowedModes: ["legacy", "shadow", "langgraph"],
    skill: {
      name: "sales-opportunity-advisor",
      version: "v1",
      title: "销售机会推进建议",
      status: "draft",
      templateRef: "grounded-structured-advisory@v1",
      outputSchemaRef: "schema://sales-opportunity-advisor/output@v1"
    },
    runtimeContract: {
      requestKind: "sales_opportunity_advisor_request",
      messageVersion: "1.0",
      responseFormat: "json@1.0"
    },
    toolBindings: {
      context_fetcher: {
        toolRef: "tool://data/generic-query-runner@v1",
        purpose: "按 QueryProfile 执行受控查询并获取销售机会数据"
      },
      advisory_llm: {
        toolRef: "tool://llm/openclaw-sales-agent-default@v1",
        purpose: "生成 grounded business advice payload"
      },
      output_validator: {
        toolRef: "tool://validation/model-tool-structured-output@v1",
        purpose: "做结构化 schema 校验和轻量归一"
      }
    },
    queryProfileRef: "query://sales-opportunity/by-opportunity-id@v1",
    inputMapping: {
      opportunityId: "request.bizParams.opportunityId"
    },
    dataSourceLabel: "GenericQueryRunner",
    dataSourceKind: "generic-query-tool",
    nodeOverrides: {
      resolve_data_plan: {
        enabled: true,
        timeoutMs: 1000,
        retry: { maxAttempts: 1 }
      },
      fetch_business_context: {
        toolRole: "context_fetcher",
        timeoutMs: 30000,
        retry: { maxAttempts: 1 }
      },
      load_reference_bundle: {
        enabled: true,
        timeoutMs: 1000,
        assetRefs: sharedAssets
      },
      select_basis_fields: {
        timeoutMs: 1000,
        maxBasisFields: 8
      },
      draft_business_output: {
        toolRole: "advisory_llm",
        promptRef: "prompt://sales-opportunity-advisor/draft-business-output@v1",
        timeoutMs: 30000,
        retry: { maxAttempts: 1 }
      },
      validate_output: {
        toolRole: "output_validator",
        timeoutMs: 30000,
        retry: { maxAttempts: 2 }
      },
      repair_output: {
        enabled: true,
        timeoutMs: 5000,
        retry: { maxAttempts: 1 }
      }
    },
    nodeOrderOverrides: {
      data: [
        "resolve_data_plan",
        "fetch_business_context",
        "load_reference_bundle"
      ]
    },
    editableBindings: sharedEditableBindings,
    legacyOrchestration: helperLegacyOrchestration
  }),
  "sales-opportunity-advisor-directdb": buildTemplateBackedWorkflow({
    scene: "sales-opportunity-advisor-directdb",
    title: "销售机会推进建议（directdb）",
    description:
      "通过 GenericQueryRunner 执行受控查询，再复用 grounded-structured-advisory 模板完成归一、起草、校验和结果收口。",
    routingMode: "legacy",
    allowedModes: ["legacy"],
    skill: {
      name: "sales-opportunity-advisor-directdb",
      version: "v1",
      title: "销售机会推进建议（directdb）",
      status: "draft",
      templateRef: "grounded-structured-advisory@v1",
      outputSchemaRef: "schema://sales-opportunity-advisor/output@v1"
    },
    runtimeContract: {
      requestKind: "sales_opportunity_advisor_directdb_request",
      messageVersion: "1.0",
      responseFormat: "json@1.0"
    },
    toolBindings: {
      context_fetcher: {
        toolRef: "tool://data/generic-query-runner@v1",
        purpose: "按 QueryProfile 执行受控查询并获取销售机会数据"
      },
      advisory_llm: {
        toolRef: "tool://llm/openclaw-sales-agent-default@v1",
        purpose: "生成 grounded business advice payload"
      },
      output_validator: {
        toolRef: "tool://validation/model-tool-structured-output@v1",
        purpose: "做结构化 schema 校验和轻量归一"
      }
    },
    queryProfileRef: "query://sales-opportunity-directdb/by-opportunity-id@v1",
    inputMapping: {
      opportunityId: "request.bizParams.opportunityId"
    },
    dataSourceLabel: "GenericQueryRunner",
    dataSourceKind: "generic-query-tool",
    nodeOverrides: {
      resolve_data_plan: {
        enabled: true,
        timeoutMs: 1000,
        retry: { maxAttempts: 1 }
      },
      fetch_business_context: {
        toolRole: "context_fetcher",
        timeoutMs: 30000,
        retry: { maxAttempts: 1 }
      },
      load_reference_bundle: {
        enabled: true,
        timeoutMs: 1000,
        assetRefs: sharedAssets
      },
      select_basis_fields: {
        timeoutMs: 1000,
        maxBasisFields: 8
      },
      draft_business_output: {
        toolRole: "advisory_llm",
        promptRef: "prompt://sales-opportunity-advisor/draft-business-output@v1",
        timeoutMs: 30000,
        retry: { maxAttempts: 1 }
      },
      validate_output: {
        toolRole: "output_validator",
        timeoutMs: 30000,
        retry: { maxAttempts: 2 }
      },
      repair_output: {
        enabled: true,
        timeoutMs: 5000,
        retry: { maxAttempts: 1 }
      }
    },
    nodeOrderOverrides: {
      data: [
        "resolve_data_plan",
        "fetch_business_context",
        "load_reference_bundle"
      ]
    },
    editableBindings: {
      queryProfile: {
        ref: "query://sales-opportunity-directdb/by-opportunity-id@v1",
        path: "/Users/gato-pm/Desktop/API_副本/platform/tools/sales-opportunity-directdb-by-opportunity-id.query.yaml",
        editable: true
      },
      inputMapping: {
        path: "/Users/gato-pm/Desktop/API_副本/platform/skills/sales-opportunity-advisor-directdb.v1.yaml",
        editable: true
      }
    },
    legacyOrchestration: directdbLegacyOrchestration
  }),
  "payment-info-split": {
    scene: "payment-info-split",
    title: "收款信息拆分",
    description:
      "当前场景直接走 direct-model，不进入 template-backed workflow，也不受 LangGraph 节点编排管理。",
    executionMode: "direct-model",
    routingMode: "legacy",
    allowedModes: ["legacy"],
    platformManagedScene: false,
    dataSourceLabel: "Direct Model",
    dataSourceKind: "direct-model",
    template: null,
    skill: null,
    directModel: {
      provider: "moonshot",
      model: "kimi-k2-turbo-preview",
      promptRef: "payment-info-prompt",
      schemaRef: "payment-info-output-schema"
    },
    references: [
      {
        type: "schema",
        ref: "payment-info-output-schema",
        purpose: "收款信息拆分结构化输出 schema"
      },
      {
        type: "prompt",
        ref: "payment-info-prompt",
        purpose: "收款信息拆分单轮模型提示词"
      }
    ],
    legacyOnlyReason: "该场景在 V1 仍属于 direct-model legacy-only 场景。"
  }
};

const scenes = Object.values(workflowsByScene).map((workflow) => ({
  scene: workflow.scene,
  title: workflow.title,
  description: workflow.description,
  executionMode: workflow.executionMode,
  routingMode: workflow.routingMode,
  allowedModes: workflow.allowedModes,
  platformManagedScene: workflow.platformManagedScene,
  templateRef: workflow.template
    ? {
        name: workflow.template.name,
        version: workflow.template.version
      }
    : null,
  skillRef: workflow.skill
    ? {
        name: workflow.skill.name,
        version: workflow.skill.version
      }
    : null,
  dataSourceLabel: workflow.dataSourceLabel
}));

const rolloutSummary = {
  reportType: "langgraph-rollout-report",
  totals: {
    runs: 5
  },
  rates: {
    successRate: 0.8,
    fallbackRatio: 0.5,
    schemaFailureRate: 0.25
  },
  latency: {
    p95DurationMs: 3000
  },
  shadowDiff: {
    diffPassRate: 0.5
  }
};

export const mockClient = {
  listScenes() {
    return resolveEnvelope({
      items: scenes
    }, "req_console_scenes");
  },
  getSceneWorkflow(scene) {
    const workflow = workflowsByScene[scene];
    if (!workflow) {
      return resolveError(404, "SCENE_NOT_FOUND", `未找到 scene: ${scene}`, {
        scene
      });
    }

    return resolveEnvelope(workflow, "req_console_scene_workflow");
  },
  getScenePromptAsset(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持编辑场景 ${scene} 的提示词。`,
      { scene }
    );
  },
  updateScenePromptAsset(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持保存场景 ${scene} 的提示词。`,
      { scene }
    );
  },
  getSceneSchemaAsset(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持编辑场景 ${scene} 的结构定义。`,
      { scene }
    );
  },
  updateSceneSchemaAsset(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持保存场景 ${scene} 的结构定义。`,
      { scene }
    );
  },
  getSceneDictionaryAsset(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持编辑场景 ${scene} 的数据字典。`,
      { scene }
    );
  },
  updateSceneDictionaryAsset(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持保存场景 ${scene} 的数据字典。`,
      { scene }
    );
  },
  getSceneRulesAsset(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持编辑场景 ${scene} 的规则。`,
      { scene }
    );
  },
  updateSceneRulesAsset(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持保存场景 ${scene} 的规则。`,
      { scene }
    );
  },
  getSceneQueryProfileConfig(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持编辑场景 ${scene} 的查询配置。`,
      { scene }
    );
  },
  updateSceneQueryProfileConfig(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持保存场景 ${scene} 的查询配置。`,
      { scene }
    );
  },
  getSceneInputMappingConfig(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持编辑场景 ${scene} 的输入映射。`,
      { scene }
    );
  },
  updateSceneInputMappingConfig(scene) {
    return resolveError(
      501,
      "MOCK_MODE_UNSUPPORTED",
      `模拟数据模式下不支持保存场景 ${scene} 的输入映射。`,
      { scene }
    );
  },
  runAgent() {
    return Promise.resolve({
      ok: false,
      status: 501,
      payload: {
        success: false,
        requestId: "mock_console_request",
        data: null,
        error: {
          code: "NOT_IMPLEMENTED",
          message: "Mock 模式下不执行真实 /api/agent/run。",
          httpStatus: 501,
          stage: "console-mock",
          retryable: false,
          details: null
        }
      }
    });
  },
  listRuns() {
    return resolveEnvelope({
      items: [
        {
          logId: "mock-log-1",
          runId: "req-lg-success",
          requestId: "req-lg-success",
          traceId: "trace-lg-success",
          timestamp: "2026-04-12T09:00:01.000Z",
          level: "info",
          message: "agent.run.success",
          messageLabel: "请求成功",
          scene: "sales-opportunity-advisor",
          requestedMode: "langgraph",
          effectiveMode: "langgraph",
          executionMode: "agent-runtime",
          success: true,
          httpStatus: 200,
          durationMs: 1000,
          errorCode: null,
          request: {
            scene: "sales-opportunity-advisor",
            bizParamKeys: ["opportunityId"],
            bizParams: {
              opportunityId: "2041340312877535232"
            }
          }
        }
      ]
    });
  },
  getRun(runId) {
    return resolveEnvelope({
      runId,
      route: {
        requestedMode: "langgraph",
        effectiveMode: "langgraph",
        executionMode: "agent-runtime"
      },
      result: {
        success: true,
        httpStatus: 200
      }
    });
  },
  getShadow(runId) {
    return resolveEnvelope({
      runId,
      diffSummary: {
        passed: true,
        differenceCount: 0
      },
      differences: []
    });
  },
  getTrace(traceId) {
    return resolveEnvelope({
      traceId,
      nodeRuns: [
        {
          node_id: "fetch_business_context",
          status: "success",
          duration_ms: 1000
        }
      ]
    });
  },
  getConfigCatalog() {
    return resolveEnvelope({
      templates: ["grounded-structured-advisory@v1"],
      skills: scenes
        .filter((scene) => scene.skillRef)
        .map((scene) => `${scene.skillRef.name}@${scene.skillRef.version}`),
      tools: [
        "tool://data/generic-query-runner@v1",
        "tool://llm/openclaw-sales-agent-default@v1",
        "tool://validation/model-tool-structured-output@v1"
      ],
      queries: [
        "query://sales-opportunity/by-opportunity-id@v1",
        "query://sales-opportunity-directdb/by-opportunity-id@v1"
      ]
    });
  },
  validateConfigs() {
    return resolveEnvelope({
      valid: true,
      summary: {
        templates: 1,
        skills: 2,
        tools: 3,
        queries: 2
      }
    });
  },
  compilePreview(body = {}) {
    return resolveEnvelope({
      scene: body.scene || "sales-opportunity-advisor",
      preview: workflowsByScene[body.scene || "sales-opportunity-advisor"]
    });
  },
  getRolloutReport() {
    return resolveEnvelope(rolloutSummary);
  }
};
