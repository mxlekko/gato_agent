const path = require("path");
const { execFileSync } = require("child_process");
const {
  loadPlatformResources,
  validatePlatformConfigs
} = require("../platform/compiler/validate");
const { compileWorkflowGraphForScene } = require("../platform/compiler/compile-workflow");
const {
  resolveDefaultStatementType,
  resolveOutputPath
} = require("./generic-query-runner");
const { getSceneConfigs } = require("./scene-config");
const { createConfigStore } = require("./config-store");
const { PROJECT_ROOT } = require("../utils/path-resolver");
const { createAppError, normalizeError } = require("../utils/errors");

const PLATFORM_BASE_DIR = path.resolve(__dirname, "..", "platform");
const CONSOLE_CONFIG_STORE_DRIVER = "mysql";
const CONSOLE_CONFIG_STORAGE_TABLE = "cfg_platform_resources";
const CONSOLE_CONFIG_UPDATED_BY = "console-config";
const RAG_SETTINGS_KIND = "rag-settings";
const RAG_SETTINGS_NAME = "default";
const RAG_SETTINGS_VERSION = "v1";
const RAG_SETTINGS_RESOURCE_ID = `${RAG_SETTINGS_KIND}:${RAG_SETTINGS_NAME}@${RAG_SETTINGS_VERSION}`;
const RAG_SETTINGS_UPDATED_BY = "console-rag-settings";
const RAG_SETTINGS_DEFAULT_EMBEDDING_MODEL = "text-embedding-v4";
const RAG_SETTINGS_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const KIND_META = {
  WorkflowTemplate: {
    kind: "template",
    label: "WorkflowTemplate"
  },
  BusinessSkill: {
    kind: "skill",
    label: "BusinessSkill"
  },
  ToolDefinition: {
    kind: "tool",
    label: "ToolDefinition"
  },
  QueryProfile: {
    kind: "query",
    label: "QueryProfile"
  }
};

const FIELD_POLICY_DEFINITIONS = {
  template: {
    configurable: [
      {
        path: "spec.description",
        reason: "模板描述可以随模板版本一起演进。"
      },
      {
        path: "spec.compatibleScenes",
        reason: "模板可以受控扩展适用场景。"
      },
      {
        path: "spec.nodes[*].allowedConfig",
        reason: "模板决定下游业务可覆盖哪些节点参数。"
      },
      {
        path: "spec.nodes[*].defaultEnabled / skipAllowed / reorderable / replaceable",
        reason: "模板作者可以受控开放节点启停、重排和替换能力。"
      }
    ],
    guarded: [
      {
        path: "metadata.name / metadata.version",
        reason: "资源标识由 registry 管控，不能在页面里随意修改。"
      },
      {
        path: "spec.engine",
        reason: "执行引擎属于平台能力边界。"
      },
      {
        path: "spec.nodes[*].handlerRef",
        reason: "节点 handler 绑定的是平台实现，不对业务开放。"
      },
      {
        path: "spec.edges / spec.conditionalEdges / spec.constraints",
        reason: "流程骨架、保护节点和跨阶段约束不能绕过平台安全边界。"
      }
    ]
  },
  skill: {
    configurable: [
      {
        path: "spec.templateRef",
        reason: "新业务可以选择复用哪个 workflow template。"
      },
      {
        path: "spec.runtimeContract / spec.inputContract / spec.outputContract",
        reason: "业务请求契约和输出 schema 引用需要按场景配置。"
      },
      {
        path: "spec.assetRefs",
        reason: "prompt/schema/dictionary/rules 需要按业务绑定。"
      },
      {
        path: "spec.toolBindings / spec.dataBindings",
        reason: "业务可以在受控 registry 内选择 tool 和 query profile。"
      },
      {
        path: "spec.nodeOverrides / spec.nodeOrderOverrides",
        reason: "业务可以在模板允许的范围内做节点启停、参数覆盖和同阶段重排。"
      }
    ],
    guarded: [
      {
        path: "metadata.name / metadata.version / spec.scene",
        reason: "业务资源标识一旦注册，就不应在页面里直接改写。"
      },
      {
        path: "spec.security",
        reason: "安全边界必须由平台固定，不能靠页面放开。"
      },
      {
        path: "spec.nodeOverrides[*].handlerRef / script / rawSql",
        reason: "业务配置不能注入代码、脚本或 SQL。"
      }
    ]
  },
  tool: {
    configurable: [
      {
        path: "spec.limits",
        reason: "超时和重试上限可由平台维护者受控调整。"
      },
      {
        path: "spec.policy.allowedScenes",
        reason: "工具的场景白名单可以按治理策略扩展。"
      }
    ],
    guarded: [
      {
        path: "spec.ref / spec.toolRole / spec.category",
        reason: "工具注册身份属于平台 registry，不应该在页面内漂移。"
      },
      {
        path: "spec.driver",
        reason: "endpoint/runtimeRef/networkPolicy 都是系统安全边界。"
      },
      {
        path: "spec.requestContract / spec.responseContract",
        reason: "工具执行器协议属于系统接口契约。"
      }
    ]
  },
  query: {
    configurable: [
      {
        path: "spec.primaryEntity / spec.inputContract / spec.selectionPolicy / spec.resultPolicy",
        reason: "查询最核心的是面向哪张主表、如何接收入参、按什么条件取数以及返回成什么结果形态。"
      },
      {
        path: "spec.limits",
        reason: "查询调用的超时和重试上限可受控调整。"
      }
    ],
    guarded: [
      {
        path: "spec.ref / spec.toolRef / spec.toolRole",
        reason: "query profile 和执行 tool 的绑定不能被页面随意改掉。"
      },
      {
        path: "spec.generationConstraints",
        reason: "防 join / 防子查询 / 防写入 是系统级安全规则。"
      },
      {
        path: "spec.migrationSource",
        reason: "迁移来源只用于对照和审计，不是业务可配项。"
      }
    ]
  }
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseYamlContent(content, label = "YAML content") {
  const rubyScript = [
    "require 'json'",
    "require 'yaml'",
    "begin",
    "data = YAML.load(STDIN.read)",
    "print JSON.generate({ ok: true, data: data })",
    "rescue => e",
    "print JSON.generate({ ok: false, error: e.message })",
    "end"
  ].join(";");

  const rawOutput = execFileSync("ruby", ["-e", rubyScript], {
    input: content,
    encoding: "utf8"
  });
  const parsed = JSON.parse(rawOutput);

  if (!parsed.ok) {
    throw createAppError("INVALID_REQUEST", `${label} must be valid YAML.`, {
      stage: "console-config",
      details: {
        cause: parsed.error || "yaml_parse_failed"
      }
    });
  }

  return parsed.data;
}

function dumpYamlDocument(document) {
  const rubyScript = [
    "require 'json'",
    "require 'yaml'",
    "data = JSON.parse(STDIN.read)",
    "text = YAML.dump(data)",
    "text = text.sub(/\\A---\\s*\\n/, '')",
    "print text"
  ].join(";");

  return execFileSync("ruby", ["-e", rubyScript], {
    input: JSON.stringify(document),
    encoding: "utf8"
  });
}

function isEditableProjectPath(filePath) {
  if (!filePath) {
    return false;
  }

  const relativePath = path.relative(PROJECT_ROOT, filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function formatJsonDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function withConsoleConfigStore(callback) {
  const store = createConfigStore({
    driver: CONSOLE_CONFIG_STORE_DRIVER
  });

  try {
    return await callback(store);
  } finally {
    await store.close();
  }
}

function toIsoString(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function getKindMeta(document) {
  return KIND_META[document?.kind] || {
    kind: "unknown",
    label: document?.kind || "Unknown"
  };
}

function buildResourceId(record) {
  const metadata = record?.document?.metadata || {};
  const { kind } = getKindMeta(record?.document || {});
  return `${kind}:${metadata.name || "unknown"}@${metadata.version || "unknown"}`;
}

function buildResourceLabel(record) {
  const metadata = record?.document?.metadata || {};
  return `${metadata.name || "unknown"}@${metadata.version || "unknown"}`;
}

function buildSummary(record) {
  const document = record?.document || {};
  const metadata = document.metadata || {};
  const spec = document.spec || {};
  const { kind } = getKindMeta(document);

  switch (kind) {
    case "template":
      return {
        primary: `${(spec.nodes || []).length} 个节点 / ${(spec.phases || []).length} 个阶段`,
        secondary: `${(spec.conditionalEdges || []).length} 条条件分支 / ${(spec.constraints?.protectedNodes || []).length} 个保护节点`
      };
    case "skill":
      return {
        primary: spec.scene || "-",
        secondary: [
          spec.templateRef?.name ? `${spec.templateRef.name}@${spec.templateRef.version}` : null,
          spec.dataBindings?.queryProfileRef || null
        ].filter(Boolean).join(" / ")
      };
    case "tool":
      return {
        primary: [spec.category || "-", spec.toolRole || "-"].join(" / "),
        secondary: [
          spec.driver?.type || null,
          Array.isArray(spec.policy?.allowedScenes)
            ? `${spec.policy.allowedScenes.length} scenes`
            : null
        ].filter(Boolean).join(" / ")
      };
    case "query":
      return {
        primary: spec.ref || "-",
        secondary: [
          spec.primaryEntity?.table || null,
          spec.resultPolicy?.mode || null,
          spec.toolRef || null
        ].filter(Boolean).join(" / ")
      };
    default:
      return {
        primary: metadata.title || metadata.name || "-",
        secondary: document.kind || "-"
      };
  }
}

function buildFieldPolicies(kind) {
  const definition = FIELD_POLICY_DEFINITIONS[kind] || {
    configurable: [],
    guarded: []
  };

  return {
    configurable: cloneJson(definition.configurable),
    guarded: cloneJson(definition.guarded)
  };
}

function buildConsoleConfigStoragePath(kind, name, version) {
  return `mysql://${CONSOLE_CONFIG_STORAGE_TABLE}/${kind}:${name}@${version}`;
}

function buildSourceMetadataIndex() {
  const resources = loadPlatformResources(PLATFORM_BASE_DIR);
  const byResourceId = new Map();
  const byRef = new Map();

  for (const record of [
    ...resources.templates,
    ...resources.skills,
    ...resources.tools,
    ...resources.queries
  ]) {
    const metadata = {
      filePath: record.filePath,
      editable: isEditableProjectPath(record.filePath)
    };
    const resourceId = buildResourceId(record);
    const ref = record?.document?.spec?.ref;

    byResourceId.set(resourceId, metadata);
    if (ref) {
      byRef.set(ref, metadata);
    }
  }

  return {
    byResourceId,
    byRef
  };
}

function resolveSourceMetadata(record, sourceMetadataIndex) {
  const resourceId = buildResourceId(record);
  const ref = record?.document?.spec?.ref;

  return sourceMetadataIndex.byResourceId.get(resourceId)
    || (ref ? sourceMetadataIndex.byRef.get(ref) : null)
    || null;
}

function buildCatalogItems(platformRecords, sourceMetadataIndex) {
  return platformRecords.map((record) => {
    const document = cloneJson(record.document || {});
    const { kind, label } = getKindMeta(document);
    const metadata = document.metadata || {};
    const spec = document.spec || {};
    const sourceMetadata = resolveSourceMetadata({ document }, sourceMetadataIndex);
    const storagePath = buildConsoleConfigStoragePath(
      kind,
      metadata.name || "unknown",
      metadata.version || "unknown"
    );

    return {
      resourceId: buildResourceId({ document }),
      kind,
      kindLabel: label,
      name: metadata.name || null,
      version: metadata.version || null,
      title: metadata.title || metadata.name || null,
      status: record.status || metadata.status || null,
      filePath: sourceMetadata?.filePath || null,
      sourceFilePath: sourceMetadata?.filePath || null,
      editable: sourceMetadata?.editable ?? true,
      ref: record.ref || spec.ref || null,
      scene: record.scene || spec.scene || null,
      summary: buildSummary({ document }),
      document,
      sourceText: typeof record.sourceText === "string" ? record.sourceText : null,
      storageDriver: CONSOLE_CONFIG_STORE_DRIVER,
      storageTable: CONSOLE_CONFIG_STORAGE_TABLE,
      storagePath,
      currentRevisionId: record.currentRevisionId || null,
      updatedBy: record.updatedBy || null,
      updatedAt: toIsoString(record.updatedAt),
      fieldPolicies: buildFieldPolicies(kind),
      relatedResources: [],
      compareCandidateIds: []
    };
  });
}

function buildPlatformResourcesFromItems(items) {
  const resources = {
    templates: [],
    skills: [],
    tools: [],
    queries: []
  };

  for (const item of items) {
    const record = {
      filePath: item.sourceFilePath || item.storagePath || item.resourceId,
      document: cloneJson(item.document)
    };

    if (item.kind === "template") {
      resources.templates.push(record);
      continue;
    }

    if (item.kind === "skill") {
      resources.skills.push(record);
      continue;
    }

    if (item.kind === "tool") {
      resources.tools.push(record);
      continue;
    }

    if (item.kind === "query") {
      resources.queries.push(record);
    }
  }

  return resources;
}

async function loadConsoleConfigCatalogState() {
  const platformRecords = await withConsoleConfigStore((store) => store.listPlatformResources());
  const sourceMetadataIndex = buildSourceMetadataIndex();
  const items = buildCatalogItems(platformRecords, sourceMetadataIndex);

  hydrateRelations(items);
  const sortedItems = sortItems(items);

  return {
    items: sortedItems,
    resources: buildPlatformResourcesFromItems(sortedItems)
  };
}

function buildCatalogStateWithUpdatedResource(state, resourceId, nextDocument, nextSourceText) {
  const nextItems = state.items.map((item) => {
    if (item.resourceId !== resourceId) {
      return {
        ...item,
        relatedResources: [],
        compareCandidateIds: []
      };
    }

    const metadata = nextDocument?.metadata || {};
    const spec = nextDocument?.spec || {};

    return {
      ...item,
      title: metadata.title || metadata.name || item.title,
      status: metadata.status || item.status,
      ref: spec.ref || null,
      scene: spec.scene || null,
      summary: buildSummary({ document: nextDocument }),
      document: cloneJson(nextDocument),
      sourceText: nextSourceText,
      relatedResources: [],
      compareCandidateIds: []
    };
  });

  hydrateRelations(nextItems);
  const sortedItems = sortItems(nextItems);

  return {
    items: sortedItems,
    resources: buildPlatformResourcesFromItems(sortedItems)
  };
}

function resolveCatalogItemByKind(state, resourceId, expectedKind) {
  const item = state.items.find((candidate) => candidate.resourceId === resourceId);
  if (!item || item.kind !== expectedKind) {
    const label = expectedKind === "tool" ? "Tool" : expectedKind === "query" ? "Query" : "Resource";
    throw createAppError("INVALID_REQUEST", `${label} resource ${resourceId} was not found.`, {
      stage: "console-config"
    });
  }

  return item;
}

function listExistingScenes() {
  return Object.values(getSceneConfigs())
    .map((sceneConfig) => ({
      scene: sceneConfig.scene,
      title: sceneConfig.title || sceneConfig.scene
    }))
    .sort((left, right) => left.scene.localeCompare(right.scene));
}

function buildDefaultRagCollectionName(embeddingModel) {
  const suffix = String(embeddingModel || RAG_SETTINGS_DEFAULT_EMBEDDING_MODEL)
    .replace(/-/g, "_")
    .replace(/\./g, "_");
  return `local_rag_mvp__${suffix}`;
}

function readPositiveIntEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hasConfiguredEnv(envNames) {
  return envNames.some((name) => Boolean(String(process.env[name] || "").trim()));
}

function getDefaultRagSettingsConfig() {
  const embeddingModel = String(process.env.EMBEDDING_MODEL || RAG_SETTINGS_DEFAULT_EMBEDDING_MODEL).trim()
    || RAG_SETTINGS_DEFAULT_EMBEDDING_MODEL;

  return {
    ragServiceBaseUrl: String(process.env.RAG_SERVICE_BASE_URL || "http://127.0.0.1:19104").trim()
      || "http://127.0.0.1:19104",
    requestTimeoutMs: readPositiveIntEnv("RAG_PROXY_TIMEOUT_MS", 15000),
    defaultTopK: 5,
    embeddingModel,
    collectionName: String(process.env.RAG_COLLECTION_NAME || "").trim()
      || buildDefaultRagCollectionName(embeddingModel),
    defaultChunkConfig: {
      minChars: 280,
      maxChars: 900,
      overlapChars: 80,
      similarityThreshold: 0.58
    },
    sceneBindings: {}
  };
}

function parseIntegerField(value, fieldName, { minimum = 1, maximum = null } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || (maximum !== null && parsed > maximum)) {
    const rangeText = maximum === null ? `大于等于 ${minimum}` : `${minimum} 到 ${maximum}`;
    throw createAppError("INVALID_REQUEST", `${fieldName} 必须是 ${rangeText} 的整数。`, {
      stage: "rag-settings-save"
    });
  }

  return parsed;
}

function parseFloatField(value, fieldName, { minimum = 0, maximum = 1 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw createAppError("INVALID_REQUEST", `${fieldName} 必须是 ${minimum} 到 ${maximum} 之间的数字。`, {
      stage: "rag-settings-save"
    });
  }

  return parsed;
}

function normalizeRagServiceBaseUrl(value) {
  const rawBaseUrl = String(value || "").trim();
  if (!rawBaseUrl) {
    throw createAppError("INVALID_REQUEST", "RAG 服务地址不能为空。", {
      stage: "rag-settings-save"
    });
  }

  let parsed;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw createAppError("INVALID_REQUEST", "RAG 服务地址必须是合法 URL。", {
      stage: "rag-settings-save"
    });
  }

  if (parsed.protocol !== "http:") {
    throw createAppError("INVALID_REQUEST", "RAG 服务地址只允许 http://。", {
      stage: "rag-settings-save"
    });
  }

  if (!RAG_SETTINGS_LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw createAppError("ACCESS_DENIED", "RAG 服务地址只允许本机 loopback 地址。", {
      stage: "rag-settings-save",
      details: {
        hostname: parsed.hostname
      }
    });
  }

  if (parsed.username || parsed.password) {
    throw createAppError("INVALID_REQUEST", "RAG 服务地址不能包含用户名或密码。", {
      stage: "rag-settings-save"
    });
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeRagCollectionName(value) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,62}$/.test(normalized)) {
    throw createAppError(
      "INVALID_REQUEST",
      "Collection 名称必须是 3 到 63 位的字母、数字、点、下划线或短横线组合。",
      {
        stage: "rag-settings-save"
      }
    );
  }

  return normalized;
}

function findSensitiveConfigPath(value, pathParts = []) {
  if (!isObject(value) && !Array.isArray(value)) {
    return null;
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);

  for (const [key, entryValue] of entries) {
    const nextPath = [...pathParts, key];
    if (/(api[_-]?key|secret|token|password|passwd|pwd|credential)/i.test(key)) {
      return nextPath.join(".");
    }

    const nestedPath = findSensitiveConfigPath(entryValue, nextPath);
    if (nestedPath) {
      return nestedPath;
    }
  }

  return null;
}

function normalizeRagSceneBindings(value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isObject(value)) {
    throw createAppError("INVALID_REQUEST", "场景绑定必须是 JSON 对象。", {
      stage: "rag-settings-save"
    });
  }

  const sensitivePath = findSensitiveConfigPath(value, ["sceneBindings"]);
  if (sensitivePath) {
    throw createAppError("INVALID_REQUEST", `场景绑定不能保存密钥字段: ${sensitivePath}。`, {
      stage: "rag-settings-save"
    });
  }

  const normalized = {};
  for (const [scene, binding] of Object.entries(value)) {
    const sceneKey = String(scene || "").trim();
    if (!sceneKey) {
      throw createAppError("INVALID_REQUEST", "场景绑定的 scene 不能为空。", {
        stage: "rag-settings-save"
      });
    }

    const knowledgeBase = typeof binding === "string"
      ? binding.trim()
      : isObject(binding)
        ? String(binding.knowledgeBase || binding.collectionName || "").trim()
        : "";

    if (!knowledgeBase) {
      throw createAppError("INVALID_REQUEST", `场景 ${sceneKey} 必须配置 knowledgeBase。`, {
        stage: "rag-settings-save"
      });
    }

    normalized[sceneKey] = { knowledgeBase };
  }

  return normalized;
}

function normalizeRagSettingsConfig(input = {}) {
  const defaults = getDefaultRagSettingsConfig();
  const rawChunkConfig = isObject(input.defaultChunkConfig) ? input.defaultChunkConfig : {};
  const mergedChunkConfig = {
    ...defaults.defaultChunkConfig,
    ...rawChunkConfig
  };

  const config = {
    ...defaults,
    ...input,
    defaultChunkConfig: mergedChunkConfig
  };

  const embeddingModel = String(config.embeddingModel || "").trim();
  if (!embeddingModel) {
    throw createAppError("INVALID_REQUEST", "Embedding 模型不能为空。", {
      stage: "rag-settings-save"
    });
  }

  const minChars = parseIntegerField(mergedChunkConfig.minChars, "minChars", {
    minimum: 1,
    maximum: 50000
  });
  const maxChars = parseIntegerField(mergedChunkConfig.maxChars, "maxChars", {
    minimum: 2,
    maximum: 100000
  });
  const overlapChars = parseIntegerField(mergedChunkConfig.overlapChars, "overlapChars", {
    minimum: 0,
    maximum: 50000
  });
  const similarityThreshold = parseFloatField(mergedChunkConfig.similarityThreshold, "similarityThreshold");

  if (maxChars <= minChars) {
    throw createAppError("INVALID_REQUEST", "maxChars 必须大于 minChars。", {
      stage: "rag-settings-save"
    });
  }

  if (overlapChars >= maxChars) {
    throw createAppError("INVALID_REQUEST", "overlapChars 必须小于 maxChars。", {
      stage: "rag-settings-save"
    });
  }

  return {
    ragServiceBaseUrl: normalizeRagServiceBaseUrl(config.ragServiceBaseUrl),
    requestTimeoutMs: parseIntegerField(config.requestTimeoutMs, "requestTimeoutMs", {
      minimum: 1000,
      maximum: 120000
    }),
    defaultTopK: parseIntegerField(config.defaultTopK, "defaultTopK", {
      minimum: 1,
      maximum: 10
    }),
    embeddingModel,
    collectionName: normalizeRagCollectionName(config.collectionName),
    defaultChunkConfig: {
      minChars,
      maxChars,
      overlapChars,
      similarityThreshold
    },
    sceneBindings: normalizeRagSceneBindings(config.sceneBindings)
  };
}

function buildRagSettingsDocument(config) {
  return {
    kind: "RagSettings",
    apiVersion: "openclaw.console/v1",
    metadata: {
      name: RAG_SETTINGS_NAME,
      version: RAG_SETTINGS_VERSION,
      title: "RAG console settings",
      status: "draft"
    },
    spec: cloneJson(config)
  };
}

function buildRagSettingsReadonly() {
  return {
    dashscopeApiKeyConfigured: hasConfiguredEnv(["DASHSCOPE_API_KEY"]),
    chatApiKeyConfigured: hasConfiguredEnv([
      "CHAT_API_KEY",
      "MOONSHOT_API_KEY",
      "OPENAI_API_KEY",
      "OPENCLAW_GATEWAY_TOKEN"
    ]),
    pythonServiceVersion: String(process.env.RAG_PYTHON_SERVICE_VERSION || "").trim() || null,
    chromaPersistDirectory: path.join("rag-service", "data", "chroma")
  };
}

function buildRagSettingsStoragePath() {
  return `mysql://${CONSOLE_CONFIG_STORAGE_TABLE}/${RAG_SETTINGS_RESOURCE_ID}`;
}

function buildRagSettingsPayload(record = null) {
  const rawSpec = isObject(record?.document?.spec) ? record.document.spec : {};
  const config = normalizeRagSettingsConfig(rawSpec);
  const storagePath = buildRagSettingsStoragePath();

  return {
    resourceId: RAG_SETTINGS_RESOURCE_ID,
    kind: RAG_SETTINGS_KIND,
    name: RAG_SETTINGS_NAME,
    version: RAG_SETTINGS_VERSION,
    status: record?.status || record?.document?.metadata?.status || "draft",
    storageDriver: CONSOLE_CONFIG_STORE_DRIVER,
    storageTable: CONSOLE_CONFIG_STORAGE_TABLE,
    storagePath,
    currentRevisionId: record?.currentRevisionId || null,
    updatedBy: record?.updatedBy || null,
    updatedAt: toIsoString(record?.updatedAt),
    config,
    readOnly: buildRagSettingsReadonly(),
    editable: true
  };
}

async function getConsoleRagSettings() {
  try {
    const record = await withConsoleConfigStore((store) => store.getPlatformResource({
      kind: RAG_SETTINGS_KIND,
      name: RAG_SETTINGS_NAME,
      version: RAG_SETTINGS_VERSION
    }));

    return buildRagSettingsPayload(record);
  } catch (error) {
    throw normalizeError(error, "INVALID_REQUEST");
  }
}

async function updateConsoleRagSettings(body = {}) {
  try {
    return await withConsoleConfigStore(async (store) => {
      const currentRecord = await store.getPlatformResource({
        kind: RAG_SETTINGS_KIND,
        name: RAG_SETTINGS_NAME,
        version: RAG_SETTINGS_VERSION
      });
      const currentConfig = buildRagSettingsPayload(currentRecord).config;
      const normalized = normalizeRagSettingsConfig({
        ...currentConfig,
        ...body,
        defaultChunkConfig: {
          ...currentConfig.defaultChunkConfig,
          ...(isObject(body.defaultChunkConfig) ? body.defaultChunkConfig : {})
        },
        sceneBindings: body.sceneBindings === undefined
          ? currentConfig.sceneBindings
          : body.sceneBindings
      });
      const document = buildRagSettingsDocument(normalized);
      const sourceText = formatJsonDocument(document);
      const savedDraft = await store.savePlatformResourceDraft(
        {
          kind: RAG_SETTINGS_KIND,
          name: RAG_SETTINGS_NAME,
          version: RAG_SETTINGS_VERSION,
          status: "draft",
          document,
          sourceText,
          updatedBy: RAG_SETTINGS_UPDATED_BY
        },
        {
          operator: RAG_SETTINGS_UPDATED_BY,
          changeNote: `console rag settings draft update for ${RAG_SETTINGS_RESOURCE_ID}`
        }
      );

      return {
        ...buildRagSettingsPayload(savedDraft),
        validation: {
          valid: true,
          issueCount: 0
        }
      };
    });
  } catch (error) {
    throw normalizeError(error, "INVALID_REQUEST");
  }
}

function normalizeToolStructuredConfig(body = {}, currentDocument = {}) {
  const rawLimits = isObject(body.limits) ? body.limits : {};
  const rawAllowedScenes = Array.isArray(body.allowedScenes) ? body.allowedScenes : null;
  const existingScenes = listExistingScenes();
  const allowedSceneSet = new Set(existingScenes.map((item) => item.scene));

  const timeoutMsDefault = Number(rawLimits.timeoutMsDefault);
  const timeoutMsMax = Number(rawLimits.timeoutMsMax);
  const retryMaxAttempts = Number(rawLimits.retryMaxAttempts);

  if (!Number.isInteger(timeoutMsDefault) || timeoutMsDefault <= 0) {
    throw createAppError("INVALID_REQUEST", "默认超时必须是大于 0 的整数毫秒值。", {
      stage: "console-config-save"
    });
  }

  if (!Number.isInteger(timeoutMsMax) || timeoutMsMax <= 0) {
    throw createAppError("INVALID_REQUEST", "最大超时必须是大于 0 的整数毫秒值。", {
      stage: "console-config-save"
    });
  }

  if (timeoutMsMax < timeoutMsDefault) {
    throw createAppError("INVALID_REQUEST", "最大超时不能小于默认超时。", {
      stage: "console-config-save"
    });
  }

  if (!Number.isInteger(retryMaxAttempts) || retryMaxAttempts < 0) {
    throw createAppError("INVALID_REQUEST", "重试次数必须是大于等于 0 的整数。", {
      stage: "console-config-save"
    });
  }

  if (!rawAllowedScenes) {
    throw createAppError("INVALID_REQUEST", "场景白名单必须是数组。", {
      stage: "console-config-save"
    });
  }

  const normalizedAllowedScenes = Array.from(new Set(
    rawAllowedScenes
      .map((scene) => (typeof scene === "string" ? scene.trim() : ""))
      .filter(Boolean)
  ));

  if (normalizedAllowedScenes.length === 0) {
    throw createAppError("INVALID_REQUEST", "场景白名单至少选择一个系统已有场景。", {
      stage: "console-config-save"
    });
  }

  const invalidScenes = normalizedAllowedScenes.filter((scene) => !allowedSceneSet.has(scene));
  if (invalidScenes.length > 0) {
    throw createAppError("INVALID_REQUEST", `场景白名单包含未注册场景: ${invalidScenes.join(", ")}。`, {
      stage: "console-config-save",
      details: {
        invalidScenes
      }
    });
  }

  const currentSpec = isObject(currentDocument.spec) ? currentDocument.spec : {};
  if (currentDocument?.kind !== "ToolDefinition") {
    throw createAppError("INVALID_REQUEST", "当前资源不是 ToolDefinition，不能保存工具配置。", {
      stage: "console-config-save"
    });
  }

  if (!isObject(currentSpec.policy) || !Array.isArray(currentSpec.policy.allowedScenes)) {
    throw createAppError("INVALID_REQUEST", "当前工具缺少可编辑的场景白名单配置。", {
      stage: "console-config-save"
    });
  }

  if (!isObject(currentSpec.limits)) {
    throw createAppError("INVALID_REQUEST", "当前工具缺少可编辑的 limits 配置。", {
      stage: "console-config-save"
    });
  }

  return {
    limits: {
      timeoutMsDefault,
      timeoutMsMax,
      retryMaxAttempts
    },
    allowedScenes: normalizedAllowedScenes,
    availableScenes: existingScenes
  };
}

function normalizeQueryStructuredConfig(body = {}, currentDocument = {}) {
  if (currentDocument?.kind !== "QueryProfile") {
    throw createAppError("INVALID_REQUEST", "当前资源不是 QueryProfile，不能保存查询配置。", {
      stage: "console-config-save"
    });
  }

  const primaryEntity = isObject(body.primaryEntity) ? body.primaryEntity : {};
  const inputContract = isObject(body.inputContract) ? body.inputContract : {};
  const selectionPolicy = isObject(body.selectionPolicy) ? body.selectionPolicy : {};
  const resultPolicy = isObject(body.resultPolicy) ? body.resultPolicy : {};
  const limits = isObject(body.limits) ? body.limits : {};
  const currentSpec = isObject(currentDocument.spec) ? currentDocument.spec : {};
  const currentResultPolicy = isObject(currentSpec.resultPolicy) ? currentSpec.resultPolicy : {};
  const currentStatement = isObject(currentSpec.selectionPolicy?.statement)
    ? currentSpec.selectionPolicy.statement
    : {};
  const statement = isObject(selectionPolicy.statement)
    ? selectionPolicy.statement
    : {};

  const table = String(primaryEntity.table || "").trim();
  const idField = String(primaryEntity.idField || "").trim();
  if (!table) {
    throw createAppError("INVALID_REQUEST", "主表不能为空。", {
      stage: "console-config-save"
    });
  }

  if (!Array.isArray(inputContract.requiredInputs)) {
    throw createAppError("INVALID_REQUEST", "必填入参必须是数组。", {
      stage: "console-config-save"
    });
  }

  const requiredInputs = Array.from(new Set(
    inputContract.requiredInputs
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
  ));
  if (requiredInputs.length === 0) {
    throw createAppError("INVALID_REQUEST", "必填入参至少保留一个。", {
      stage: "console-config-save"
    });
  }

  if (!isObject(inputContract.fields)) {
    throw createAppError("INVALID_REQUEST", "输入字段映射必须是对象。", {
      stage: "console-config-save"
    });
  }

  const normalizedFields = {};
  for (const inputName of requiredInputs) {
    const fieldConfig = inputContract.fields[inputName];
    if (!isObject(fieldConfig)) {
      throw createAppError("INVALID_REQUEST", `输入字段 ${inputName} 缺少配置。`, {
        stage: "console-config-save"
      });
    }

    const fieldType = String(fieldConfig.type || "").trim();
    const sourcePath = String(fieldConfig.sourcePath || "").trim();
    if (!fieldType || !sourcePath) {
      throw createAppError("INVALID_REQUEST", `输入字段 ${inputName} 的 type 和 sourcePath 都不能为空。`, {
        stage: "console-config-save"
      });
    }

    normalizedFields[inputName] = {
      type: fieldType,
      sourcePath
    };
  }

  const cardinality = String(selectionPolicy.cardinality || "").trim();
  if (!cardinality) {
    throw createAppError("INVALID_REQUEST", "查询返回条数策略不能为空。", {
      stage: "console-config-save"
    });
  }

  if (!Array.isArray(selectionPolicy.where)) {
    throw createAppError("INVALID_REQUEST", "查询条件必须是数组。", {
      stage: "console-config-save"
    });
  }

  const normalizedWhere = selectionPolicy.where.map((item, index) => {
    if (!isObject(item)) {
      throw createAppError("INVALID_REQUEST", `查询条件第 ${index + 1} 项必须是对象。`, {
        stage: "console-config-save"
      });
    }

    const field = String(item.field || "").trim();
    const operator = String(item.operator || "").trim();
    const param = String(item.param || "").trim();
    if (!field || !operator || !param) {
      throw createAppError("INVALID_REQUEST", `查询条件第 ${index + 1} 项的 field/operator/param 不能为空。`, {
        stage: "console-config-save"
      });
    }

    return { field, operator, param };
  });

  const statementType = String(statement.type || "").trim();
  const cardinalityOptions = new Set(["single-record", "multi-record"]);
  if (!cardinalityOptions.has(cardinality)) {
    throw createAppError("INVALID_REQUEST", "查询返回策略只允许为 single-record 或 multi-record。", {
      stage: "console-config-save"
    });
  }

  const resultMode = String(resultPolicy.mode || currentResultPolicy.mode || "").trim() || "single-row";
  const resultModeOptions = new Set(["single-row", "multi-rows", "column-values", "aggregate-value"]);
  if (!resultModeOptions.has(resultMode)) {
    throw createAppError("INVALID_REQUEST", "结果模式只允许为 single-row、multi-rows、column-values、aggregate-value。", {
      stage: "console-config-save"
    });
  }

  const normalizedResultFields = Array.from(new Set(
    (Array.isArray(resultPolicy.fields) ? resultPolicy.fields : (Array.isArray(currentResultPolicy.fields) ? currentResultPolicy.fields : []))
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
  ));
  const resultDistinct = typeof resultPolicy.distinct === "boolean"
    ? resultPolicy.distinct
    : currentResultPolicy.distinct === true;
  const rawResultLimit = Number(
    resultPolicy.limit
    ?? currentResultPolicy.limit
    ?? (resultMode === "single-row" ? 1 : "")
  );
  const resultLimit = Number.isInteger(rawResultLimit) && rawResultLimit > 0
    ? rawResultLimit
    : (resultMode === "single-row" ? 1 : null);

  if (resultMode === "column-values" && normalizedResultFields.length !== 1) {
    throw createAppError("INVALID_REQUEST", "列值合集模式必须且只能配置 1 个返回字段。", {
      stage: "console-config-save"
    });
  }

  const normalizedStatementType = statementType || resolveDefaultStatementType(resultMode);
  if (!normalizedStatementType) {
    throw createAppError("INVALID_REQUEST", "查询语句类型不能为空。", {
      stage: "console-config-save"
    });
  }

  const expectedStatementType = resolveDefaultStatementType(resultMode);
  if (normalizedStatementType !== expectedStatementType) {
    throw createAppError("INVALID_REQUEST", `当前结果模式要求查询语句类型为 ${expectedStatementType}。`, {
      stage: "console-config-save"
    });
  }

  const timeoutMsDefault = Number(limits.timeoutMsDefault);
  const timeoutMsMax = Number(limits.timeoutMsMax);
  const retryMaxAttempts = Number(limits.retryMaxAttempts);
  if (!Number.isInteger(timeoutMsDefault) || timeoutMsDefault <= 0) {
    throw createAppError("INVALID_REQUEST", "默认超时必须是大于 0 的整数毫秒值。", {
      stage: "console-config-save"
    });
  }

  if (!Number.isInteger(timeoutMsMax) || timeoutMsMax <= 0) {
    throw createAppError("INVALID_REQUEST", "最大超时必须是大于 0 的整数毫秒值。", {
      stage: "console-config-save"
    });
  }

  if (timeoutMsMax < timeoutMsDefault) {
    throw createAppError("INVALID_REQUEST", "最大超时不能小于默认超时。", {
      stage: "console-config-save"
    });
  }

  if (!Number.isInteger(retryMaxAttempts) || retryMaxAttempts < 0) {
    throw createAppError("INVALID_REQUEST", "重试次数必须是大于等于 0 的整数。", {
      stage: "console-config-save"
    });
  }

  return {
    primaryEntity: {
      table,
      ...(idField ? { idField } : {})
    },
    inputContract: {
      requiredInputs,
      fields: normalizedFields
    },
    selectionPolicy: {
      cardinality,
      where: normalizedWhere,
      statement: {
        type: normalizedStatementType,
        parameterPlaceholder: String(currentStatement.parameterPlaceholder || "@opportunityId").trim() || "@opportunityId"
      }
    },
    resultPolicy: {
      mode: resultMode,
      fields: normalizedResultFields,
      distinct: resultDistinct,
      ...(Number.isInteger(resultLimit) ? { limit: resultLimit } : {})
    },
    outputPolicy: {
      resultPath: resolveOutputPath(resultMode)
    },
    limits: {
      timeoutMsDefault,
      timeoutMsMax,
      retryMaxAttempts
    }
  };
}

function buildIndices(items) {
  const byId = new Map();
  const byKind = new Map();
  const byRef = new Map();
  const byScene = new Map();

  for (const item of items) {
    byId.set(item.resourceId, item);

    if (!byKind.has(item.kind)) {
      byKind.set(item.kind, []);
    }
    byKind.get(item.kind).push(item);

    if (item.ref) {
      byRef.set(item.ref, item);
    }

    if (item.scene) {
      byScene.set(item.scene, item);
    }
  }

  return {
    byId,
    byKind,
    byRef,
    byScene
  };
}

function pushRelation(item, target, relation, label = null) {
  if (!item || !target) {
    return;
  }

  item.relatedResources.push({
    resourceId: target.resourceId,
    relation,
    label: label || target.title || target.name || target.resourceId
  });
}

function hydrateRelations(items) {
  const index = buildIndices(items);

  for (const item of items) {
    const spec = item.document?.spec || {};

    if (item.kind === "skill") {
      const templateTarget = index.byId.get(
        `template:${spec.templateRef?.name || "unknown"}@${spec.templateRef?.version || "unknown"}`
      );
      pushRelation(item, templateTarget, "template");

      const queryTarget = index.byRef.get(spec.dataBindings?.queryProfileRef || null);
      pushRelation(item, queryTarget, "query-profile");

      const toolBindings = isObject(spec.toolBindings) ? spec.toolBindings : {};
      for (const [role, binding] of Object.entries(toolBindings)) {
        pushRelation(item, index.byRef.get(binding?.toolRef || null), `tool:${role}`);
      }
    }

    if (item.kind === "template") {
      for (const candidate of items) {
        if (candidate.kind !== "skill") {
          continue;
        }

        const templateRef = candidate.document?.spec?.templateRef || {};
        if (templateRef.name === item.name && templateRef.version === item.version) {
          pushRelation(item, candidate, "bound-skill");
        }
      }
    }

    if (item.kind === "query") {
      pushRelation(item, index.byRef.get(spec.toolRef || null), "tool");
    }

    if (item.kind === "tool") {
      for (const candidate of items) {
        if (candidate.kind === "query" && candidate.document?.spec?.toolRef === item.ref) {
          pushRelation(item, candidate, "query-profile");
        }

        if (candidate.kind === "skill") {
          const toolBindings = isObject(candidate.document?.spec?.toolBindings)
            ? candidate.document.spec.toolBindings
            : {};

          for (const [role, binding] of Object.entries(toolBindings)) {
            if (binding?.toolRef === item.ref) {
              pushRelation(item, candidate, `skill:${role}`);
            }
          }
        }
      }
    }
  }

  for (const item of items) {
    const compareCandidates = (index.byKind.get(item.kind) || [])
      .filter((candidate) => candidate.resourceId !== item.resourceId)
      .map((candidate) => candidate.resourceId);

    item.compareCandidateIds = compareCandidates;
  }
}

function sortItems(items) {
  const kindOrder = {
    skill: 1,
    template: 2,
    query: 3,
    tool: 4
  };

  return items.sort((left, right) => {
    const leftKindRank = kindOrder[left.kind] || 99;
    const rightKindRank = kindOrder[right.kind] || 99;
    if (leftKindRank !== rightKindRank) {
      return leftKindRank - rightKindRank;
    }

    const leftLabel = `${left.name || ""}@${left.version || ""}`;
    const rightLabel = `${right.name || ""}@${right.version || ""}`;
    return leftLabel.localeCompare(rightLabel);
  });
}

async function getConsoleConfigCatalog() {
  const state = await loadConsoleConfigCatalogState();
  const ragSettings = await getConsoleRagSettings();

  return {
    counts: {
      templates: state.items.filter((item) => item.kind === "template").length,
      skills: state.items.filter((item) => item.kind === "skill").length,
      tools: state.items.filter((item) => item.kind === "tool").length,
      queries: state.items.filter((item) => item.kind === "query").length
    },
    ragSettings,
    items: state.items
  };
}

async function validateConsoleConfigs() {
  const state = await loadConsoleConfigCatalogState();

  return validatePlatformConfigs({
    baseDir: PLATFORM_BASE_DIR,
    resources: state.resources
  });
}

async function compileConsoleConfigPreview({ scene } = {}) {
  const state = await loadConsoleConfigCatalogState();

  return compileWorkflowGraphForScene({
    scene,
    baseDir: PLATFORM_BASE_DIR,
    resources: state.resources
  });
}

async function updateConsoleToolStructuredConfig(resourceId, body = {}) {
  if (resourceId === RAG_SETTINGS_RESOURCE_ID) {
    return updateConsoleRagSettings(body);
  }

  try {
    const state = await loadConsoleConfigCatalogState();
    const toolItem = resolveCatalogItemByKind(state, resourceId, "tool");
    if (toolItem.editable === false) {
      throw createAppError("INVALID_REQUEST", `Tool resource ${resourceId} is not editable through the platform.`, {
        stage: "console-config-save",
        details: {
          resourceId,
          path: toolItem.sourceFilePath || toolItem.filePath || null
        }
      });
    }

    const currentDocument = cloneJson(toolItem.document);
    const normalized = normalizeToolStructuredConfig(body, currentDocument);

    currentDocument.spec = isObject(currentDocument.spec) ? currentDocument.spec : {};
    currentDocument.spec.limits = {
      ...currentDocument.spec.limits,
      ...normalized.limits
    };
    currentDocument.spec.policy = isObject(currentDocument.spec.policy)
      ? currentDocument.spec.policy
      : {};
    currentDocument.spec.policy.allowedScenes = normalized.allowedScenes;

    const nextContent = dumpYamlDocument(currentDocument);
    const validationState = buildCatalogStateWithUpdatedResource(
      state,
      resourceId,
      currentDocument,
      nextContent
    );
    const validationSummary = validatePlatformConfigs({
      baseDir: PLATFORM_BASE_DIR,
      resources: validationState.resources
    });
    if (!validationSummary.valid) {
      throw createAppError("INVALID_REQUEST", "工具配置保存后平台校验未通过。", {
        stage: "console-config-save",
        details: {
          resourceId,
          issueCount: validationSummary.issueCount,
          issues: validationSummary.issues.slice(0, 20)
        }
      });
    }

    const savedDraft = await withConsoleConfigStore((store) => store.savePlatformResourceDraft(
      {
        kind: toolItem.kind,
        name: toolItem.name,
        version: toolItem.version,
        ref: currentDocument.spec?.ref || toolItem.ref,
        scene: currentDocument.spec?.scene || toolItem.scene,
        status: currentDocument.metadata?.status || toolItem.status || "draft",
        document: currentDocument,
        sourceText: nextContent,
        updatedBy: CONSOLE_CONFIG_UPDATED_BY
      },
      {
        operator: CONSOLE_CONFIG_UPDATED_BY,
        changeNote: `console config draft update for ${resourceId}`
      }
    ));

    return {
      resourceId,
      kind: "tool",
      path: toolItem.storagePath,
      sourceFilePath: toolItem.sourceFilePath || toolItem.filePath || null,
      storageDriver: CONSOLE_CONFIG_STORE_DRIVER,
      storageTable: CONSOLE_CONFIG_STORAGE_TABLE,
      storagePath: toolItem.storagePath,
      editable: toolItem.editable !== false,
      updatedAt: toIsoString(savedDraft?.updatedAt),
      draft: {
        status: savedDraft?.status || currentDocument.metadata?.status || "draft",
        currentRevisionId: savedDraft?.currentRevisionId || null,
        updatedBy: savedDraft?.updatedBy || CONSOLE_CONFIG_UPDATED_BY
      },
      config: {
        limits: normalized.limits,
        allowedScenes: normalized.allowedScenes
      },
      availableScenes: normalized.availableScenes,
      validation: {
        valid: true,
        issueCount: validationSummary.issueCount
      }
    };
  } catch (error) {
    throw normalizeError(error, "INVALID_REQUEST");
  }
}

async function updateConsoleQueryStructuredConfig(resourceId, body = {}) {
  try {
    const state = await loadConsoleConfigCatalogState();
    const queryItem = resolveCatalogItemByKind(state, resourceId, "query");
    if (queryItem.editable === false) {
      throw createAppError("INVALID_REQUEST", `Query resource ${resourceId} is not editable through the platform.`, {
        stage: "console-config-save",
        details: {
          resourceId,
          path: queryItem.sourceFilePath || queryItem.filePath || null
        }
      });
    }

    const currentDocument = cloneJson(queryItem.document);
    const normalized = normalizeQueryStructuredConfig(body, currentDocument);

    currentDocument.spec = isObject(currentDocument.spec) ? currentDocument.spec : {};
    currentDocument.spec.primaryEntity = normalized.primaryEntity;
    currentDocument.spec.inputContract = normalized.inputContract;
    currentDocument.spec.selectionPolicy = normalized.selectionPolicy;
    currentDocument.spec.resultPolicy = normalized.resultPolicy;
    currentDocument.spec.outputPolicy = normalized.outputPolicy;
    currentDocument.spec.limits = {
      ...(isObject(currentDocument.spec.limits) ? currentDocument.spec.limits : {}),
      ...normalized.limits
    };

    const nextContent = dumpYamlDocument(currentDocument);
    const validationState = buildCatalogStateWithUpdatedResource(
      state,
      resourceId,
      currentDocument,
      nextContent
    );
    const validationSummary = validatePlatformConfigs({
      baseDir: PLATFORM_BASE_DIR,
      resources: validationState.resources
    });
    if (!validationSummary.valid) {
      throw createAppError("INVALID_REQUEST", "查询配置保存后平台校验未通过。", {
        stage: "console-config-save",
        details: {
          resourceId,
          issueCount: validationSummary.issueCount,
          issues: validationSummary.issues.slice(0, 20)
        }
      });
    }

    const savedDraft = await withConsoleConfigStore((store) => store.savePlatformResourceDraft(
      {
        kind: queryItem.kind,
        name: queryItem.name,
        version: queryItem.version,
        ref: currentDocument.spec?.ref || queryItem.ref,
        scene: currentDocument.spec?.scene || queryItem.scene,
        status: currentDocument.metadata?.status || queryItem.status || "draft",
        document: currentDocument,
        sourceText: nextContent,
        updatedBy: CONSOLE_CONFIG_UPDATED_BY
      },
      {
        operator: CONSOLE_CONFIG_UPDATED_BY,
        changeNote: `console config draft update for ${resourceId}`
      }
    ));

    return {
      resourceId,
      kind: "query",
      path: queryItem.storagePath,
      sourceFilePath: queryItem.sourceFilePath || queryItem.filePath || null,
      storageDriver: CONSOLE_CONFIG_STORE_DRIVER,
      storageTable: CONSOLE_CONFIG_STORAGE_TABLE,
      storagePath: queryItem.storagePath,
      editable: queryItem.editable !== false,
      updatedAt: toIsoString(savedDraft?.updatedAt),
      draft: {
        status: savedDraft?.status || currentDocument.metadata?.status || "draft",
        currentRevisionId: savedDraft?.currentRevisionId || null,
        updatedBy: savedDraft?.updatedBy || CONSOLE_CONFIG_UPDATED_BY
      },
      config: normalized,
      validation: {
        valid: true,
        issueCount: validationSummary.issueCount
      }
    };
  } catch (error) {
    throw normalizeError(error, "INVALID_REQUEST");
  }
}

module.exports = {
  compileConsoleConfigPreview,
  getConsoleConfigCatalog,
  getConsoleRagSettings,
  RAG_SETTINGS_RESOURCE_ID,
  updateConsoleRagSettings,
  updateConsoleQueryStructuredConfig,
  updateConsoleToolStructuredConfig,
  validateConsoleConfigs
};
