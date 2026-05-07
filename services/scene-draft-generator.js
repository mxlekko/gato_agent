const path = require("path");
const { execFileSync } = require("child_process");

const { loadPlatformResources } = require("../platform/compiler/validate");
const { createConfigStore } = require("./config-store");
const { resolveSceneTemplate } = require("./scene-template-catalog");
const { getSceneConfigs } = require("./scene-config");
const { createAppError } = require("../utils/errors");

const PLATFORM_BASE_DIR = path.resolve(__dirname, "..", "platform");
const SCENE_ID_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const DEFAULT_SKILL_VERSION = "v1";
const SCENE_DRAFT_STORE_DRIVER = "mysql";
const DEFAULT_ADVISORY_TOOL_REF = "tool://llm/project-payment-info-split@v1";
const DEFAULT_OUTPUT_VALIDATOR_TOOL_REF = "tool://validation/model-tool-structured-output@v1";
const DEFAULT_QUERY_TOOL_REF = "tool://data/generic-query-runner@v1";
const DEFAULT_QUERY_TOOL_ROLE = "context_fetcher";
const SCENE_DRAFT_UPDATED_BY = "scene-draft-generator";
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const QUERY_NAME_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;
const SUPPORTED_QUERY_OPERATORS = new Set([
  "equals",
  "not_equals",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "like",
  "contains",
  "starts_with",
  "ends_with",
  "in",
  "is_null",
  "is_not_null"
]);
const PARAMETERIZED_QUERY_OPERATORS = new Set([
  "equals",
  "not_equals",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
  "like",
  "contains",
  "starts_with",
  "ends_with",
  "in"
]);
const SUPPORTED_QUERY_RESULT_MODES = new Set([
  "single-row",
  "multi-rows",
  "column-values",
  "aggregate-value"
]);

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toTrimmedString(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSceneId(value) {
  const scene = toTrimmedString(value).toLowerCase();
  if (!scene) {
    throw createAppError("INVALID_REQUEST", "Scene ID 不能为空。", {
      stage: "scene-draft-generator"
    });
  }

  if (scene.length < 3 || scene.length > 80) {
    throw createAppError("INVALID_REQUEST", "Scene ID 长度必须是 3 到 80 个字符。", {
      stage: "scene-draft-generator",
      details: {
        scene
      }
    });
  }

  if (!SCENE_ID_PATTERN.test(scene) || scene.includes("--")) {
    throw createAppError(
      "INVALID_REQUEST",
      "Scene ID 只能使用小写字母、数字和中划线，必须以小写字母开头，并以小写字母或数字结尾。",
      {
        stage: "scene-draft-generator",
        details: {
          scene
        }
      }
    );
  }

  return scene;
}

function normalizeTemplateRef(value = {}) {
  const name = toTrimmedString(value.name);
  const version = toTrimmedString(value.version) || DEFAULT_SKILL_VERSION;
  if (!name) {
    throw createAppError("INVALID_REQUEST", "请选择场景模板。", {
      stage: "scene-draft-generator"
    });
  }

  return {
    name,
    version
  };
}

function buildTemplateKey(templateRef) {
  return `${templateRef.name}@${templateRef.version}`;
}

function buildPlatformResourceKey(kind, name, version = DEFAULT_SKILL_VERSION) {
  return `${kind}:${name}@${version || DEFAULT_SKILL_VERSION}`;
}

function normalizeQueryName(value, fallback) {
  const name = toTrimmedString(value || fallback).toLowerCase();
  if (!name) {
    throw createAppError("INVALID_REQUEST", "QueryProfile 名称不能为空。", {
      stage: "scene-draft-generator"
    });
  }

  if (name.length < 3 || name.length > 100 || !QUERY_NAME_PATTERN.test(name) || name.includes("--")) {
    throw createAppError(
      "INVALID_REQUEST",
      "QueryProfile 名称只能使用小写字母、数字和中划线，必须以小写字母开头，并以小写字母或数字结尾。",
      {
        stage: "scene-draft-generator",
        details: {
          name
        }
      }
    );
  }

  return name;
}

function normalizeIdentifier(value, fieldName, { allowStar = false } = {}) {
  const normalized = toTrimmedString(value);
  if (allowStar && normalized === "*") {
    return normalized;
  }

  const segments = normalized.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0 || !segments.every((segment) => IDENTIFIER_PATTERN.test(segment))) {
    throw createAppError("INVALID_REQUEST", `${fieldName} 必须是安全字段名，只能使用字母、数字、下划线，并可用点号分隔层级。`, {
      stage: "scene-draft-generator",
      details: {
        fieldName,
        value: normalized
      }
    });
  }

  return segments.join(".");
}

function normalizeParamName(value, fieldName) {
  const normalized = toTrimmedString(value);
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw createAppError("INVALID_REQUEST", `${fieldName} 必须是安全参数名，只能使用字母、数字和下划线，且以字母或下划线开头。`, {
      stage: "scene-draft-generator",
      details: {
        fieldName,
        value: normalized
      }
    });
  }

  return normalized;
}

function formatJsonDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
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

function buildSceneConstant(scene) {
  return scene.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildRequestKind(scene) {
  return `${scene.replace(/-/g, "_")}_request`;
}

function buildPromptRef(scene) {
  return `prompt://${scene}/draft-business-output@v1`;
}

function buildSchemaRef(scene) {
  return `schema://${scene}/output@v1`;
}

function buildDictionaryRef(scene) {
  return `dictionary://${scene}/fields@v1`;
}

function buildRulesRef(scene) {
  return `rules://${scene}/decision-rules@v1`;
}

function buildPromptAssetPath(scene) {
  return `project://references/${scene}/prompt.md`;
}

function buildSchemaAssetPath(scene) {
  return `project://references/${scene}/output_schema.json`;
}

function buildDictionaryAssetPath(scene) {
  return `project://metadata/${scene.replace(/-/g, "_")}_dictionary.tsv`;
}

function buildRulesAssetPath(scene) {
  return `project://references/${scene}/decision_rules.md`;
}

function buildRuntimeContract(scene) {
  const sceneConstant = buildSceneConstant(scene);
  return {
    requestKind: buildRequestKind(scene),
    messageVersion: "1.0",
    requestMarkers: {
      begin: `<<<${sceneConstant}_REQUEST_JSON_BEGIN>>>`,
      end: `<<<${sceneConstant}_REQUEST_JSON_END>>>`
    },
    resultMarkers: {
      begin: `<<<${sceneConstant}_RESULT_JSON_BEGIN>>>`,
      end: `<<<${sceneConstant}_RESULT_JSON_END>>>`
    },
    responseFormat: {
      type: "json",
      schemaVersion: "1.0"
    }
  };
}

function getAssetRefKey(category) {
  switch (category) {
    case "prompts":
      return "promptRef";
    case "schemas":
      return "schemaRef";
    case "dictionaries":
      return "dictionaryRef";
    case "rules":
      return "rulesRef";
    default:
      return null;
  }
}

function collectAssetRefs(assetRefs, category) {
  const refKey = getAssetRefKey(category);
  const categoryEntries = isObject(assetRefs?.[category]) ? assetRefs[category] : {};
  if (!refKey) {
    return [];
  }

  return Object.values(categoryEntries)
    .map((entry) => entry?.[refKey])
    .filter((value) => typeof value === "string" && value.trim());
}

function getFirstAssetSourcePath(skillSpec, category) {
  const categoryEntries = isObject(skillSpec?.assetRefs?.[category]) ? skillSpec.assetRefs[category] : {};
  return Object.values(categoryEntries)
    .map((entry) => entry?.source?.path)
    .find((value) => typeof value === "string" && value.trim()) || null;
}

function normalizeInputContract(value = {}) {
  const requiredInputs = Array.isArray(value.required)
    ? value.required.map(toTrimmedString).filter(Boolean)
    : [];
  const fieldEntries = value.fields && typeof value.fields === "object"
    ? Object.entries(value.fields)
    : [];
  const fieldNames = Array.from(new Set([
    ...requiredInputs,
    ...fieldEntries.map(([fieldName]) => toTrimmedString(fieldName)).filter(Boolean)
  ]));

  if (fieldNames.length === 0) {
    fieldNames.push("rawText");
    requiredInputs.push("rawText");
  }

  const requiredSet = new Set(requiredInputs);
  const fields = {};
  for (const fieldName of fieldNames) {
    const fieldConfig = value.fields?.[fieldName] && typeof value.fields[fieldName] === "object"
      ? value.fields[fieldName]
      : {};
    fields[fieldName] = {
      type: toTrimmedString(fieldConfig.type) || "string",
      required: fieldConfig.required === undefined ? requiredSet.has(fieldName) : Boolean(fieldConfig.required),
      trim: fieldConfig.trim === undefined ? true : Boolean(fieldConfig.trim),
      sourcePath: toTrimmedString(fieldConfig.sourcePath) || `request.bizParams.${fieldName}`
    };

    if (Number.isFinite(Number(fieldConfig.maxLength))) {
      fields[fieldName].maxLength = Number(fieldConfig.maxLength);
    }
  }

  return {
    required: Array.from(requiredSet),
    fields
  };
}

function normalizeOutputSchema(value = {}) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
    return cloneJson(value);
  }

  return {
    type: "object",
    additionalProperties: true,
    properties: {},
    required: []
  };
}

function readAssetTextInput(assetsInput, assetType, fallback = "") {
  const assetInput = isObject(assetsInput?.[assetType]) ? assetsInput[assetType] : {};
  if (assetInput.contentText !== undefined && assetInput.contentText !== null) {
    return String(assetInput.contentText);
  }

  return String(fallback || "");
}

function buildDefaultDictionaryContent(inputContract) {
  const rows = [["field_name", "field_description"]];
  for (const [fieldName, fieldConfig] of Object.entries(inputContract?.fields || {})) {
    rows.push([
      fieldName,
      `type=${fieldConfig?.type || "string"}; source=${fieldConfig?.sourcePath || `request.bizParams.${fieldName}`}`
    ]);
  }

  return `${rows.map((row) => row.join("\t")).join("\n")}\n`;
}

function buildDefaultRulesContent({ title, scene }) {
  return [
    `# ${title || scene} Rules`,
    "",
    "- Only use facts available in the normalized request, query result, RAG result, and configured assets.",
    "- Do not invent customer facts, dates, amounts, products, contacts, or commitments.",
    "- Return only the structured payload required by the output schema."
  ].join("\n") + "\n";
}

function normalizeCreationAssets(input, context) {
  const assetsInput = isObject(input.assets) ? input.assets : {};
  const supportedAssetTypes = new Set(context.sceneTemplate?.supportedAssetTypes || []);
  const defaults = context.sceneTemplate?.assetDefaults || {};
  const promptFallback = defaults.prompt?.contentText || buildDefaultPromptContent(context);
  const dictionaryFallback = defaults.dictionary?.contentText || buildDefaultDictionaryContent(context.inputContract);
  const rulesFallback = defaults.rules?.contentText || buildDefaultRulesContent(context);
  const assets = {
    prompt: {
      contentText: readAssetTextInput(assetsInput, "prompt", promptFallback),
      contentFormat: "markdown"
    }
  };

  if (supportedAssetTypes.has("dictionary")) {
    assets.dictionary = {
      contentText: readAssetTextInput(assetsInput, "dictionary", dictionaryFallback),
      contentFormat: "tsv"
    };
  }

  if (supportedAssetTypes.has("rules")) {
    assets.rules = {
      contentText: readAssetTextInput(assetsInput, "rules", rulesFallback),
      contentFormat: "markdown"
    };
  }

  return assets;
}

function normalizeRagConfig(value, context = {}) {
  if (!context.sceneTemplate?.requiresRag) {
    if (value !== undefined && value !== null && isObject(value) && Object.keys(value).length > 0) {
      throw createAppError("INVALID_REQUEST", "当前场景模板不支持 RAG 配置。", {
        stage: "scene-draft-generator",
        details: {
          templateRef: context.templateRef || null
        }
      });
    }

    return null;
  }

  const defaults = context.sceneTemplate?.ragDefaults || {};
  const input = isObject(value) ? value : {};
  const topK = Number(input.topK ?? defaults.topK ?? 5);
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
    throw createAppError("INVALID_REQUEST", "RAG TopK 必须是 1 到 20 之间的整数。", {
      stage: "scene-draft-generator",
      details: {
        topK: input.topK
      }
    });
  }

  return {
    enabled: true,
    topK,
    docId: toTrimmedString(input.docId ?? defaults.docId),
    query: toTrimmedString(input.query ?? defaults.query),
    failOnError: input.failOnError === undefined ? defaults.failOnError === true : input.failOnError === true
  };
}

function templateSupportsQueryProfile(templateDocument) {
  const nodes = Array.isArray(templateDocument?.spec?.nodes)
    ? templateDocument.spec.nodes
    : [];
  return nodes.some((node) => (
    node?.id === "fetch_business_context" || node?.toolRole === DEFAULT_QUERY_TOOL_ROLE
  ));
}

function templateRequiresQueryProfile(templateDocument) {
  const nodes = Array.isArray(templateDocument?.spec?.nodes)
    ? templateDocument.spec.nodes
    : [];
  return nodes.some((node) => (
    (node?.id === "fetch_business_context" || node?.toolRole === DEFAULT_QUERY_TOOL_ROLE)
    && node?.required === true
    && node?.defaultEnabled !== false
  ));
}

function templateRequiresRag(templateDocument) {
  const nodes = Array.isArray(templateDocument?.spec?.nodes)
    ? templateDocument.spec.nodes
    : [];
  return nodes.some((node) => (
    (node?.id === "retrieve_knowledge_context" || node?.toolRole === "knowledge_retriever")
    && node?.required === true
    && node?.defaultEnabled !== false
  ));
}

function resolveQueryOutputPath(mode) {
  switch (mode) {
    case "multi-rows":
      return "data.rows";
    case "column-values":
      return "data.values";
    case "aggregate-value":
      return "data.value";
    case "single-row":
    default:
      return "data.rawRow";
  }
}

function resolveQueryStatementType(mode) {
  switch (mode) {
    case "multi-rows":
      return "select-rows";
    case "column-values":
      return "select-column-values";
    case "aggregate-value":
      return "select-count";
    case "single-row":
    default:
      return "select-top-1";
  }
}

function resolveExpectedResultPath(mode) {
  const outputPath = resolveQueryOutputPath(mode);
  return outputPath.replace(/^data\./, "artifacts.context.raw.");
}

function normalizeQueryResultMode(value) {
  const mode = toTrimmedString(value) || "single-row";
  if (!SUPPORTED_QUERY_RESULT_MODES.has(mode)) {
    throw createAppError("INVALID_REQUEST", `QueryProfile 结果模式不支持：${mode}。`, {
      stage: "scene-draft-generator",
      details: {
        mode,
        supportedModes: Array.from(SUPPORTED_QUERY_RESULT_MODES)
      }
    });
  }

  return mode;
}

function normalizeQueryResultFields(value, mode) {
  const rawFields = Array.isArray(value) ? value : ["*"];
  const fields = Array.from(new Set(
    rawFields
      .map((fieldName) => normalizeIdentifier(fieldName, "queryProfile.resultPolicy.fields[]", {
        allowStar: true
      }))
      .filter(Boolean)
  ));

  if (fields.length === 0) {
    fields.push("*");
  }

  if (fields.includes("*") && fields.length > 1) {
    throw createAppError("INVALID_REQUEST", "QueryProfile 返回字段不能同时填写 * 和具体字段名。", {
      stage: "scene-draft-generator",
      details: {
        fields
      }
    });
  }

  if (mode === "column-values" && (fields.length !== 1 || fields[0] === "*")) {
    throw createAppError("INVALID_REQUEST", "QueryProfile 的列值列表模式必须且只能填写一个具体返回字段。", {
      stage: "scene-draft-generator",
      details: {
        fields
      }
    });
  }

  return fields;
}

function normalizeQueryLimit(value, mode) {
  if (value === undefined || value === null || value === "") {
    throw createAppError("INVALID_REQUEST", "QueryProfile 必须填写 Limit。", {
      stage: "scene-draft-generator",
      details: {
        mode
      }
    });
  }

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw createAppError("INVALID_REQUEST", "QueryProfile Limit 必须是 1 到 1000 之间的整数。", {
      stage: "scene-draft-generator",
      details: {
        limit: value
      }
    });
  }

  if (mode === "single-row" && limit !== 1) {
    throw createAppError("INVALID_REQUEST", "QueryProfile 单条记录模式的 Limit 必须是 1。", {
      stage: "scene-draft-generator",
      details: {
        limit
      }
    });
  }

  return limit;
}

function normalizeQueryWhereItem(item, index) {
  if (!isObject(item)) {
    throw createAppError("INVALID_REQUEST", `QueryProfile 查询条件第 ${index + 1} 项必须是对象。`, {
      stage: "scene-draft-generator"
    });
  }

  const forbiddenKeys = ["sql", "rawSql", "querySql", "join", "subquery", "script", "value", "values"];
  const presentForbiddenKeys = forbiddenKeys.filter((key) => item[key] !== undefined);
  if (presentForbiddenKeys.length > 0) {
    throw createAppError("INVALID_REQUEST", `QueryProfile 查询条件第 ${index + 1} 项包含禁止字段。`, {
      stage: "scene-draft-generator",
      details: {
        forbiddenKeys: presentForbiddenKeys
      }
    });
  }

  const field = normalizeIdentifier(item.field, `queryProfile.where[${index}].field`);
  const operator = toTrimmedString(item.operator);
  if (!SUPPORTED_QUERY_OPERATORS.has(operator)) {
    throw createAppError("INVALID_REQUEST", `QueryProfile 查询条件第 ${index + 1} 项的操作符不支持。`, {
      stage: "scene-draft-generator",
      details: {
        operator,
        supportedOperators: Array.from(SUPPORTED_QUERY_OPERATORS)
      }
    });
  }

  const normalized = {
    field,
    operator
  };

  if (PARAMETERIZED_QUERY_OPERATORS.has(operator)) {
    normalized.param = normalizeParamName(item.param, `queryProfile.where[${index}].param`);
  } else if (item.param !== undefined && item.param !== null && String(item.param).trim() !== "") {
    throw createAppError("INVALID_REQUEST", `QueryProfile 查询条件第 ${index + 1} 项的操作符 ${operator} 不允许填写请求参数。`, {
      stage: "scene-draft-generator",
      details: {
        operator
      }
    });
  }

  return normalized;
}

function normalizeQueryWhere(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw createAppError("INVALID_REQUEST", "QueryProfile 至少需要一个查询条件。", {
      stage: "scene-draft-generator"
    });
  }

  const where = value.map((item, index) => normalizeQueryWhereItem(item, index));
  const parameterNames = Array.from(new Set(where.map((item) => item.param).filter(Boolean)));
  if (parameterNames.length === 0) {
    throw createAppError("INVALID_REQUEST", "QueryProfile 查询条件至少需要一个参数化条件。", {
      stage: "scene-draft-generator"
    });
  }

  return {
    where,
    parameterNames
  };
}

function normalizeQueryInputContract(queryProfile, inputContract, parameterNames) {
  const queryInputContract = isObject(queryProfile.inputContract) ? queryProfile.inputContract : {};
  const queryFields = isObject(queryInputContract.fields) ? queryInputContract.fields : {};
  const sceneFields = isObject(inputContract.fields) ? inputContract.fields : {};
  const requiredInputs = Array.from(new Set([
    ...parameterNames,
    ...(Array.isArray(queryInputContract.requiredInputs)
      ? queryInputContract.requiredInputs.map((fieldName) => normalizeParamName(fieldName, "queryProfile.inputContract.requiredInputs[]"))
      : [])
  ]));
  const fields = {};

  for (const fieldName of requiredInputs) {
    const queryField = isObject(queryFields[fieldName]) ? queryFields[fieldName] : {};
    const sceneField = isObject(sceneFields[fieldName]) ? sceneFields[fieldName] : {};
    fields[fieldName] = {
      type: toTrimmedString(queryField.type || sceneField.type) || "string",
      sourcePath: toTrimmedString(queryField.sourcePath || sceneField.sourcePath) || `request.bizParams.${fieldName}`
    };
  }

  return {
    requiredInputs,
    fields
  };
}

function normalizeQueryProfile(value, context = {}) {
  if (!isObject(value) || value.enabled !== true) {
    return null;
  }

  const {
    scene,
    title,
    inputContract,
    templateDocument
  } = context;
  if (!templateSupportsQueryProfile(templateDocument)) {
    throw createAppError("INVALID_REQUEST", "当前场景模板不支持 QueryProfile 配置。", {
      stage: "scene-draft-generator",
      details: {
        templateRef: context.templateRef || null
      }
    });
  }

  const name = normalizeQueryName(value.name, `${scene}-query`);
  const version = DEFAULT_SKILL_VERSION;
  const resultPolicyInput = isObject(value.resultPolicy) ? value.resultPolicy : {};
  const whereInput = Array.isArray(value.where)
    ? value.where
    : (Array.isArray(value.selectionPolicy?.where) ? value.selectionPolicy.where : []);
  const mode = normalizeQueryResultMode(resultPolicyInput.mode);
  const limit = normalizeQueryLimit(resultPolicyInput.limit, mode);
  const fields = normalizeQueryResultFields(resultPolicyInput.fields, mode);
  const { where, parameterNames } = normalizeQueryWhere(whereInput);
  const normalizedInputContract = normalizeQueryInputContract(value, inputContract, parameterNames);
  const resultPath = resolveQueryOutputPath(mode);

  return {
    enabled: true,
    name,
    version,
    title: toTrimmedString(value.title) || `${title || scene} Query`,
    ref: `query://${scene}/${name}@${version}`,
    toolRef: DEFAULT_QUERY_TOOL_REF,
    toolRole: DEFAULT_QUERY_TOOL_ROLE,
    primaryEntity: {
      table: normalizeIdentifier(value.primaryEntity?.table, "queryProfile.primaryEntity.table"),
      idField: normalizeIdentifier(value.primaryEntity?.idField || where[0]?.field, "queryProfile.primaryEntity.idField")
    },
    inputContract: normalizedInputContract,
    selectionPolicy: {
      cardinality: mode === "single-row" ? "single-record" : "multi-record",
      where,
      statement: {
        type: resolveQueryStatementType(mode),
        parameterPlaceholder: `@${parameterNames[0]}`
      }
    },
    resultPolicy: {
      mode,
      fields,
      distinct: resultPolicyInput.distinct === true,
      limit
    },
    outputPolicy: {
      resultPath
    },
    generationConstraints: {
      allowJoin: false,
      allowSubquery: false,
      allowOrderBy: false,
      allowWrite: false,
      allowMultipleStatements: false,
      allowRawSqlConfig: false,
      allowInlineScript: false
    },
    limits: {
      timeoutMsDefault: 30000,
      timeoutMsMax: 30000,
      retryMaxAttempts: 1
    },
    inputMapping: Object.fromEntries(
      Object.entries(normalizedInputContract.fields).map(([fieldName, fieldConfig]) => [
        fieldName,
        fieldConfig.sourcePath
      ])
    ),
    expectedResultPath: resolveExpectedResultPath(mode)
  };
}

function buildDefaultPromptContent({ scene, title, description }) {
  return [
    `You are the business output generator for scene "${title || scene}".`,
    description ? `Scene description: ${description}` : null,
    "Read the normalized request and produce a JSON object that matches the output schema.",
    "Use concise business language. Return JSON only."
  ]
    .filter(Boolean)
    .join("\n\n") + "\n";
}

function buildSceneConfigReferences({ sceneTemplate, promptRef, schemaRef, dictionaryRef = null, rulesRef = null, scene }) {
  const sourceSkillSpec = sceneTemplate?.sourceSkillDocument?.spec || {};
  const copiedReferences = [];

  if (dictionaryRef) {
    copiedReferences.push({
      id: dictionaryRef,
      type: "local-file",
      path: buildDictionaryAssetPath(scene),
      purpose: "Business field dictionary"
    });
  }

  if (rulesRef) {
    copiedReferences.push({
      id: rulesRef,
      type: "local-file",
      path: buildRulesAssetPath(scene),
      purpose: "Business decision rules"
    });
  }

  for (const category of ["dictionaries", "rules"]) {
    if ((category === "dictionaries" && dictionaryRef) || (category === "rules" && rulesRef)) {
      continue;
    }

    const refKey = getAssetRefKey(category);
    const categoryEntries = isObject(sourceSkillSpec?.assetRefs?.[category])
      ? sourceSkillSpec.assetRefs[category]
      : {};

    for (const [assetKey, entry] of Object.entries(categoryEntries)) {
      const ref = entry?.[refKey];
      const sourcePath = entry?.source?.path;
      if (!ref || !sourcePath) {
        continue;
      }

      copiedReferences.push({
        id: ref,
        type: entry?.source?.type || "local-file",
        path: sourcePath,
        purpose: assetKey
      });
    }
  }

  return [
    {
      id: schemaRef,
      type: "local-file",
      path: buildSchemaAssetPath(scene),
      purpose: "Structured output schema"
    },
    {
      id: promptRef,
      type: "local-file",
      path: buildPromptAssetPath(scene),
      purpose: "Business output generation prompt"
    },
    ...cloneJson(copiedReferences)
  ];
}

function buildSceneConfigDocument({
  scene,
  title,
  description,
  inputContract,
  promptRef,
  schemaRef,
  dictionaryRef = null,
  rulesRef = null,
  sceneTemplate = null
}) {
  const requestBizParams = Object.fromEntries(
    Object.entries(inputContract.fields).map(([fieldName, fieldConfig]) => {
      const { sourcePath, ...sceneFieldConfig } = fieldConfig;
      return [fieldName, sceneFieldConfig];
    })
  );
  const sourceSceneConfig = cloneJson(sceneTemplate?.sourceSceneConfigDocument || {});
  const sourceSkill = isObject(sourceSceneConfig.skill) ? sourceSceneConfig.skill : {};
  const sourceSkillType = toTrimmedString(sourceSkill.type) || "main-skill";

  return {
    ...sourceSceneConfig,
    scene,
    enabled: true,
    title,
    description,
    execution: {
      mode: "agent-runtime"
    },
    routing: {
      mode: "langgraph",
      allowedModes: ["langgraph"],
      langgraphCutover: {
        requestPercentage: 100
      }
    },
    agent: {
      id: `project-${scene}`,
      gatewayModel: `project/${scene}`,
      sessionKeyPrefix: `agent:project-${scene}:api`
    },
    runtime: buildRuntimeContract(scene),
    request: {
      bizParams: requestBizParams
    },
    skill: {
      id: scene,
      version: DEFAULT_SKILL_VERSION,
      type: sourceSkillType,
      workspacePath: "project://platform/skills",
      entryFile: `project://platform/skills/${scene}.${DEFAULT_SKILL_VERSION}.yaml`,
      responsibility: "Provide the project business contract; orchestration is executed by platform BusinessSkill and LangGraph."
    },
    tools: Array.isArray(sourceSceneConfig.tools)
      ? cloneJson(sourceSceneConfig.tools)
      : [
          {
            id: "project-structured-output-llm",
            type: "model-tool",
            binding: "project-llm",
            responseContract: "draftPayload",
            params: ["requestId", "request", "prompt", "schema"]
          },
          {
            id: "model-tool-structured-output",
            type: "model-tool",
            binding: "http",
            endpoint: "http://127.0.0.1:19103/internal/model/validate-structured-output",
            responseContract: "validatedPayload",
            params: ["requestId", "scene", "payload", "schema"]
          }
        ],
    references: buildSceneConfigReferences({
      sceneTemplate,
      promptRef,
      schemaRef,
      dictionaryRef,
      rulesRef,
      scene
    })
  };
}

function rewriteGeneratedAssetRefs(sourceAssetRefs, { scene, promptRef, schemaRef, dictionaryRef = null, rulesRef = null }) {
  const nextAssetRefs = cloneJson(sourceAssetRefs || {});

  if (!isObject(nextAssetRefs.prompts)) {
    nextAssetRefs.prompts = {};
  }
  if (!Object.keys(nextAssetRefs.prompts).length) {
    nextAssetRefs.prompts.draftBusinessOutput = {};
  }
  for (const entry of Object.values(nextAssetRefs.prompts)) {
    entry.promptRef = promptRef;
    entry.source = {
      type: "local-file",
      path: buildPromptAssetPath(scene)
    };
  }

  if (!isObject(nextAssetRefs.schemas)) {
    nextAssetRefs.schemas = {};
  }
  if (!Object.keys(nextAssetRefs.schemas).length) {
    nextAssetRefs.schemas.output = {};
  }
  for (const entry of Object.values(nextAssetRefs.schemas)) {
    entry.schemaRef = schemaRef;
    entry.source = {
      type: "local-file",
      path: buildSchemaAssetPath(scene)
    };
  }

  if (dictionaryRef) {
    if (!isObject(nextAssetRefs.dictionaries)) {
      nextAssetRefs.dictionaries = {};
    }
    if (!Object.keys(nextAssetRefs.dictionaries).length) {
      nextAssetRefs.dictionaries.fields = {};
    }
    for (const entry of Object.values(nextAssetRefs.dictionaries)) {
      entry.dictionaryRef = dictionaryRef;
      entry.source = {
        type: "local-file",
        path: buildDictionaryAssetPath(scene)
      };
    }
  }

  if (rulesRef) {
    if (!isObject(nextAssetRefs.rules)) {
      nextAssetRefs.rules = {};
    }
    if (!Object.keys(nextAssetRefs.rules).length) {
      nextAssetRefs.rules.decisionRules = {};
    }
    for (const entry of Object.values(nextAssetRefs.rules)) {
      entry.rulesRef = rulesRef;
      entry.source = {
        type: "local-file",
        path: buildRulesAssetPath(scene)
      };
    }
  }

  return nextAssetRefs;
}

function rewriteGeneratedNodeOverrides(sourceNodeOverrides, assetRefs, { promptRef, queryProfile, ragConfig = null, templateDocument }) {
  const nodeOverrides = cloneJson(sourceNodeOverrides || {});
  const loadReferenceOverride = isObject(nodeOverrides.load_reference_bundle)
    ? nodeOverrides.load_reference_bundle
    : {};
  const assetSelection = {};

  for (const category of ["prompts", "schemas", "dictionaries", "rules"]) {
    const refs = collectAssetRefs(assetRefs, category);
    if (refs.length > 0) {
      assetSelection[category] = refs;
    }
  }

  nodeOverrides.load_reference_bundle = {
    ...loadReferenceOverride,
    enabled: loadReferenceOverride.enabled !== undefined ? loadReferenceOverride.enabled : true,
    timeoutMs: loadReferenceOverride.timeoutMs || 1000,
    assetRefs: assetSelection
  };

  nodeOverrides.draft_business_output = {
    ...(isObject(nodeOverrides.draft_business_output) ? nodeOverrides.draft_business_output : {}),
    promptRef
  };

  if (queryProfile && templateSupportsQueryProfile(templateDocument)) {
    nodeOverrides.resolve_data_plan = {
      ...(isObject(nodeOverrides.resolve_data_plan) ? nodeOverrides.resolve_data_plan : {}),
      enabled: true,
      timeoutMs: nodeOverrides.resolve_data_plan?.timeoutMs || 1000,
      retry: nodeOverrides.resolve_data_plan?.retry || {
        maxAttempts: 1
      }
    };
    nodeOverrides.fetch_business_context = {
      ...(isObject(nodeOverrides.fetch_business_context) ? nodeOverrides.fetch_business_context : {}),
      toolRole: DEFAULT_QUERY_TOOL_ROLE,
      timeoutMs: nodeOverrides.fetch_business_context?.timeoutMs || 30000,
      retry: nodeOverrides.fetch_business_context?.retry || {
        maxAttempts: 1
      }
    };
  }

  if (ragConfig) {
    nodeOverrides.retrieve_knowledge_context = {
      ...(isObject(nodeOverrides.retrieve_knowledge_context) ? nodeOverrides.retrieve_knowledge_context : {}),
      enabled: true,
      topK: ragConfig.topK,
      failOnError: ragConfig.failOnError,
      timeoutMs: nodeOverrides.retrieve_knowledge_context?.timeoutMs || 30000,
      retry: nodeOverrides.retrieve_knowledge_context?.retry || {
        maxAttempts: 1
      }
    };

    if (ragConfig.docId) {
      nodeOverrides.retrieve_knowledge_context.docId = ragConfig.docId;
    } else {
      delete nodeOverrides.retrieve_knowledge_context.docId;
    }

    if (ragConfig.query) {
      nodeOverrides.retrieve_knowledge_context.query = ragConfig.query;
    } else {
      delete nodeOverrides.retrieve_knowledge_context.query;
    }
  }

  return nodeOverrides;
}

function buildBusinessSkillDocument({
  scene,
  title,
  templateRef,
  inputContract,
  promptRef,
  schemaRef,
  dictionaryRef = null,
  rulesRef = null,
  queryProfile,
  ragConfig = null,
  templateDocument,
  sceneTemplate = null
}) {
  const sceneConstant = buildSceneConstant(scene);
  const sourceSkillDocument = sceneTemplate?.sourceSkillDocument || null;
  const sourceSkillSpec = sourceSkillDocument?.spec || {};
  const runtimeContract = buildRuntimeContract(scene);
  const assetRefs = rewriteGeneratedAssetRefs(sourceSkillSpec.assetRefs, {
    scene,
    promptRef,
    schemaRef,
    dictionaryRef,
    rulesRef
  });
  const toolBindings = isObject(sourceSkillSpec.toolBindings)
    ? cloneJson(sourceSkillSpec.toolBindings)
    : {
        advisory_llm: {
          toolRef: DEFAULT_ADVISORY_TOOL_REF,
          purpose: "generate structured business output"
        },
        output_validator: {
          toolRef: DEFAULT_OUTPUT_VALIDATOR_TOOL_REF,
          purpose: "validate structured JSON output"
        }
      };
  const nodeOverrides = rewriteGeneratedNodeOverrides(sourceSkillSpec.nodeOverrides, assetRefs, {
    promptRef,
    queryProfile,
    ragConfig,
    templateDocument
  });
  const dataBindings = queryProfile
    ? {
        queryProfileRef: queryProfile.ref,
        inputMapping: cloneJson(queryProfile.inputMapping),
        expectedResultPath: queryProfile.expectedResultPath
      }
    : null;

  if (queryProfile) {
    toolBindings.context_fetcher = {
      toolRef: queryProfile.toolRef,
      purpose: "execute controlled query profile and fetch business context"
    };

    if (templateSupportsQueryProfile(templateDocument)) {
      nodeOverrides.resolve_data_plan = {
        enabled: true,
        timeoutMs: 1000,
        retry: {
          maxAttempts: 1
        }
      };
      nodeOverrides.fetch_business_context = {
        toolRole: DEFAULT_QUERY_TOOL_ROLE,
        timeoutMs: 30000,
        retry: {
          maxAttempts: 1
        }
      };
    }
  }

  const document = sourceSkillDocument ? cloneJson(sourceSkillDocument) : {};
  document.apiVersion = "agent.platform/v1alpha1";
  document.kind = "BusinessSkill";
  document.metadata = {
    ...(isObject(document.metadata) ? document.metadata : {}),
    name: scene,
    version: DEFAULT_SKILL_VERSION,
    title,
    status: "draft"
  };
  document.spec = {
    ...(isObject(document.spec) ? document.spec : {}),
    scene,
    templateRef,
    runtimeContract,
    inputContract: {
      bizParams: cloneJson(inputContract.fields)
    },
    outputContract: {
      envelope: {
        successField: "success",
        sceneField: "scene",
        requestIdField: "requestId",
        payloadField: "payload",
        errorField: "error"
      },
      schemaRef
    },
    assetRefs,
    toolBindings,
    nodeOverrides,
    security: cloneJson(sourceSkillSpec.security || {
      mode: "controlled",
      deny: {
        inlineSql: true,
        inlineScript: true,
        inlinePromptText: true,
        inlineSchemaText: true,
        unregisteredToolRef: true,
        externalNetworkEndpoint: true,
        crossPhaseReorder: true,
        arbitraryNodeInsertion: true
      }
    })
  };

  if (isObject(sourceSkillSpec.nodeOrderOverrides)) {
    document.spec.nodeOrderOverrides = cloneJson(sourceSkillSpec.nodeOrderOverrides);
  } else {
    delete document.spec.nodeOrderOverrides;
  }

  if (!sourceSkillDocument) {
    document.spec.runtimeContract = {
      requestKind: buildRequestKind(scene),
      messageVersion: "1.0",
      requestMarkers: {
        begin: `<<<${sceneConstant}_REQUEST_JSON_BEGIN>>>`,
        end: `<<<${sceneConstant}_REQUEST_JSON_END>>>`
      },
      resultMarkers: {
        begin: `<<<${sceneConstant}_RESULT_JSON_BEGIN>>>`,
        end: `<<<${sceneConstant}_RESULT_JSON_END>>>`
      },
      responseFormat: {
        type: "json",
        schemaVersion: "1.0"
      }
    };
  }

  if (dataBindings) {
    document.spec.dataBindings = dataBindings;
    document.spec.nodeOrderOverrides = {
      ...(isObject(document.spec.nodeOrderOverrides) ? document.spec.nodeOrderOverrides : {}),
      data: [
        "resolve_data_plan",
        "fetch_business_context",
        "load_reference_bundle"
      ]
    };
  } else {
    delete document.spec.dataBindings;
  }

  return document;
}

function buildLegacyBusinessSkillDocument({
  scene,
  title,
  templateRef,
  inputContract,
  promptRef,
  schemaRef,
  queryProfile,
  templateDocument
}) {
  const sceneConstant = buildSceneConstant(scene);
  const toolBindings = {
    advisory_llm: {
      toolRef: DEFAULT_ADVISORY_TOOL_REF,
      purpose: "generate structured business output"
    },
    output_validator: {
      toolRef: DEFAULT_OUTPUT_VALIDATOR_TOOL_REF,
      purpose: "validate structured JSON output"
    }
  };
  const nodeOverrides = {
    load_reference_bundle: {
      enabled: true,
      timeoutMs: 1000,
      assetRefs: {
        prompts: [promptRef],
        schemas: [schemaRef]
      }
    },
    draft_business_output: {
      toolRole: "advisory_llm",
      promptRef,
      timeoutMs: 30000,
      retry: {
        maxAttempts: 1
      }
    },
    validate_output: {
      toolRole: "output_validator",
      timeoutMs: 30000,
      retry: {
        maxAttempts: 2
      }
    }
  };
  const dataBindings = queryProfile
    ? {
        queryProfileRef: queryProfile.ref,
        inputMapping: cloneJson(queryProfile.inputMapping),
        expectedResultPath: queryProfile.expectedResultPath
      }
    : null;

  if (queryProfile) {
    toolBindings.context_fetcher = {
      toolRef: queryProfile.toolRef,
      purpose: "execute controlled query profile and fetch business context"
    };

    if (templateSupportsQueryProfile(templateDocument)) {
      nodeOverrides.resolve_data_plan = {
        enabled: true,
        timeoutMs: 1000,
        retry: {
          maxAttempts: 1
        }
      };
      nodeOverrides.fetch_business_context = {
        toolRole: DEFAULT_QUERY_TOOL_ROLE,
        timeoutMs: 30000,
        retry: {
          maxAttempts: 1
        }
      };
    }
  }

  const document = {
    apiVersion: "agent.platform/v1alpha1",
    kind: "BusinessSkill",
    metadata: {
      name: scene,
      version: DEFAULT_SKILL_VERSION,
      title,
      status: "draft"
    },
    spec: {
      scene,
      templateRef,
      runtimeContract: {
        requestKind: buildRequestKind(scene),
        messageVersion: "1.0",
        requestMarkers: {
          begin: `<<<${sceneConstant}_REQUEST_JSON_BEGIN>>>`,
          end: `<<<${sceneConstant}_REQUEST_JSON_END>>>`
        },
        resultMarkers: {
          begin: `<<<${sceneConstant}_RESULT_JSON_BEGIN>>>`,
          end: `<<<${sceneConstant}_RESULT_JSON_END>>>`
        },
        responseFormat: {
          type: "json",
          schemaVersion: "1.0"
        }
      },
      inputContract: {
        bizParams: cloneJson(inputContract.fields)
      },
      outputContract: {
        envelope: {
          successField: "success",
          sceneField: "scene",
          requestIdField: "requestId",
          payloadField: "payload",
          errorField: "error"
        },
        schemaRef
      },
      assetRefs: {
        prompts: {
          draftBusinessOutput: {
            promptRef,
            source: {
              type: "local-file",
              path: buildPromptAssetPath(scene)
            }
          }
        },
        schemas: {
          output: {
            schemaRef,
            source: {
              type: "local-file",
              path: buildSchemaAssetPath(scene)
            }
          }
        }
      },
      toolBindings,
      nodeOverrides,
      security: {
        mode: "controlled",
        deny: {
          inlineSql: true,
          inlineScript: true,
          inlinePromptText: true,
          inlineSchemaText: true,
          unregisteredToolRef: true,
          externalNetworkEndpoint: true,
          crossPhaseReorder: true,
          arbitraryNodeInsertion: true
        }
      }
    }
  };

  if (dataBindings) {
    document.spec.dataBindings = dataBindings;
    document.spec.nodeOrderOverrides = {
      data: [
        "resolve_data_plan",
        "fetch_business_context",
        "load_reference_bundle"
      ]
    };
  }

  return document;
}

function buildQueryProfileDocument(queryProfile) {
  return {
    apiVersion: "agent.platform/v1alpha1",
    kind: "QueryProfile",
    metadata: {
      name: queryProfile.name,
      version: queryProfile.version,
      title: queryProfile.title,
      status: "draft"
    },
    spec: {
      ref: queryProfile.ref,
      toolRef: queryProfile.toolRef,
      toolRole: queryProfile.toolRole,
      primaryEntity: cloneJson(queryProfile.primaryEntity),
      inputContract: cloneJson(queryProfile.inputContract),
      selectionPolicy: cloneJson(queryProfile.selectionPolicy),
      resultPolicy: cloneJson(queryProfile.resultPolicy),
      outputPolicy: cloneJson(queryProfile.outputPolicy),
      generationConstraints: cloneJson(queryProfile.generationConstraints),
      limits: cloneJson(queryProfile.limits)
    }
  };
}

function buildTemplateSceneDraftPackage(input) {
  const scene = input.scene;
  const title = input.title || scene;
  const description = input.description || "";
  const inputContract = normalizeInputContract(input.inputContract);
  const outputSchema = normalizeOutputSchema(input.outputSchema);
  const queryProfile = input.queryProfile || null;
  const creationAssets = input.assets || {};
  const ragConfig = input.ragConfig || null;
  const promptRef = buildPromptRef(scene);
  const schemaRef = buildSchemaRef(scene);
  const dictionaryRef = creationAssets.dictionary ? buildDictionaryRef(scene) : null;
  const rulesRef = creationAssets.rules ? buildRulesRef(scene) : null;
  const sceneConfigDocument = buildSceneConfigDocument({
    scene,
    title,
    description,
    inputContract,
    promptRef,
    schemaRef,
    dictionaryRef,
    rulesRef,
    sceneTemplate: input.sceneTemplate
  });
  const businessSkillDocument = buildBusinessSkillDocument({
    scene,
    title,
    templateRef: input.workflowTemplateRef || input.templateRef,
    inputContract,
    promptRef,
    schemaRef,
    dictionaryRef,
    rulesRef,
    queryProfile,
    ragConfig,
    templateDocument: input.template?.document,
    sceneTemplate: input.sceneTemplate
  });
  const promptContent = creationAssets.prompt?.contentText || buildDefaultPromptContent({ scene, title, description });
  const schemaContent = formatJsonDocument(outputSchema);
  const sceneAssets = [
    {
      scene,
      assetType: "prompt",
      ref: promptRef,
      contentText: promptContent,
      contentFormat: "markdown",
      document: null,
      status: "draft"
    },
    {
      scene,
      assetType: "schema",
      ref: schemaRef,
      contentText: schemaContent,
      contentFormat: "json",
      document: outputSchema,
      status: "draft"
    }
  ];

  if (creationAssets.dictionary) {
    sceneAssets.push({
      scene,
      assetType: "dictionary",
      ref: dictionaryRef,
      contentText: creationAssets.dictionary.contentText,
      contentFormat: "tsv",
      document: null,
      status: "draft"
    });
  }

  if (creationAssets.rules) {
    sceneAssets.push({
      scene,
      assetType: "rules",
      ref: rulesRef,
      contentText: creationAssets.rules.contentText,
      contentFormat: "markdown",
      document: null,
      status: "draft"
    });
  }

  const platformResources = [
    {
      kind: "skill",
      name: scene,
      version: DEFAULT_SKILL_VERSION,
      scene,
      status: "draft",
      document: businessSkillDocument,
      sourceText: dumpYamlDocument(businessSkillDocument)
    }
  ];

  if (queryProfile) {
    const queryProfileDocument = buildQueryProfileDocument(queryProfile);
    platformResources.push({
      kind: "query",
      name: queryProfile.name,
      version: queryProfile.version,
      scene,
      status: "draft",
      document: queryProfileDocument,
      sourceText: dumpYamlDocument(queryProfileDocument)
    });
  }

  return {
    sceneConfig: {
      scene,
      title,
      enabled: true,
      executionMode: "agent-runtime",
      status: "draft",
      document: sceneConfigDocument,
      sourceText: formatJsonDocument(sceneConfigDocument)
    },
    platformResources,
    sceneAssets
  };
}

function resolveSceneTemplateRecord(templateRef) {
  const sceneTemplate = resolveSceneTemplate(templateRef);
  if (!sceneTemplate?.workflowTemplateDocument?.spec) {
    throw createAppError("INVALID_REQUEST", `场景模板 ${buildTemplateKey(templateRef)} 缺少底层流程绑定。`, {
      stage: "scene-draft-generator",
      details: {
        templateRef
      }
    });
  }

  return sceneTemplate;
}

function collectPublishedSceneConflicts(scene) {
  const sceneConfigs = getSceneConfigs();
  return sceneConfigs[scene]
    ? [{
        source: "published-scene-config",
        key: scene
      }]
    : [];
}

function collectPlatformSkillConflicts(scene, platformResourceRecords = []) {
  const conflicts = [];
  const repositoryResources = loadPlatformResources(PLATFORM_BASE_DIR);
  const skillRecords = [
    ...repositoryResources.skills,
    ...platformResourceRecords
      .filter((record) => record?.kind === "skill")
      .map((record) => ({
        document: record.document
      }))
  ];
  const seen = new Set();

  for (const record of skillRecords) {
    const metadata = record?.document?.metadata || {};
    const spec = record?.document?.spec || {};
    const key = buildPlatformResourceKey("skill", metadata.name, metadata.version);
    const matchesScene = spec.scene === scene;
    const matchesGeneratedSkillName = metadata.name === scene;
    if ((!matchesScene && !matchesGeneratedSkillName) || seen.has(key)) {
      continue;
    }

    seen.add(key);
    conflicts.push({
      source: "business-skill",
      key,
      scene: spec.scene || null
    });
  }

  return conflicts;
}

function collectQueryProfileConflicts(queryProfile, platformResourceRecords = []) {
  if (!queryProfile) {
    return [];
  }

  const conflicts = [];
  const repositoryResources = loadPlatformResources(PLATFORM_BASE_DIR);
  const queryRecords = [
    ...repositoryResources.queries,
    ...platformResourceRecords
      .filter((record) => record?.kind === "query")
      .map((record) => ({
        document: record.document
      }))
  ];
  const targetKey = buildPlatformResourceKey("query", queryProfile.name, queryProfile.version);
  const seen = new Set();

  for (const record of queryRecords) {
    const metadata = record?.document?.metadata || {};
    const spec = record?.document?.spec || {};
    const key = buildPlatformResourceKey("query", metadata.name, metadata.version);
    const matchesName = key === targetKey;
    const matchesRef = spec.ref === queryProfile.ref;
    if ((!matchesName && !matchesRef) || seen.has(`${key}:${spec.ref || ""}`)) {
      continue;
    }

    seen.add(`${key}:${spec.ref || ""}`);
    conflicts.push({
      source: "query-profile",
      key,
      ref: spec.ref || null
    });
  }

  return conflicts;
}

async function collectSceneIdentityConflicts(scene, store, queryProfile = null) {
  const [draftSceneConfigs, platformResources] = await Promise.all([
    store.listSceneConfigs({ scene }),
    store.listPlatformResources()
  ]);
  const conflicts = [];

  if (draftSceneConfigs.length > 0) {
    conflicts.push({
      source: "cfg_scene_configs",
      key: scene
    });
  }

  conflicts.push(...collectPublishedSceneConflicts(scene));
  conflicts.push(...collectPlatformSkillConflicts(scene, platformResources));
  conflicts.push(...collectQueryProfileConflicts(queryProfile, platformResources));

  return conflicts;
}

async function assertSceneIdentityAvailable(scene, store, queryProfile = null) {
  const conflicts = await collectSceneIdentityConflicts(scene, store, queryProfile);
  if (conflicts.length > 0) {
    const onlyQueryProfileConflicts = conflicts.every((conflict) => conflict.source === "query-profile");
    const message = onlyQueryProfileConflicts && queryProfile
      ? `QueryProfile ${queryProfile.name}@${queryProfile.version} 已存在，请换一个 QueryProfile 名称。`
      : `Scene ID ${scene} 已存在，请换一个 Scene ID。`;
    throw createAppError("INVALID_REQUEST", message, {
      stage: "scene-draft-generator",
      details: {
        scene,
        conflicts
      }
    });
  }
}

async function withSceneDraftStore(callback) {
  const store = createConfigStore({
    driver: SCENE_DRAFT_STORE_DRIVER
  });

  try {
    return await callback(store);
  } finally {
    await store.close();
  }
}

async function saveDraftPackage(draftPackage, store, options = {}) {
  const operator = toTrimmedString(options.operator) || SCENE_DRAFT_UPDATED_BY;
  const changeNote = `create template scene draft for ${draftPackage.sceneConfig.scene}`;
  const sceneConfig = await store.saveSceneConfigDraft(
    {
      ...draftPackage.sceneConfig,
      updatedBy: operator
    },
    {
      operator,
      changeNote
    }
  );
  const platformResources = [];
  const sceneAssets = [];

  for (const resource of draftPackage.platformResources) {
    platformResources.push(await store.savePlatformResourceDraft(
      {
        ...resource,
        updatedBy: operator
      },
      {
        operator,
        changeNote
      }
    ));
  }

  for (const asset of draftPackage.sceneAssets) {
    sceneAssets.push(await store.saveSceneAssetDraft(
      {
        ...asset,
        updatedBy: operator
      },
      {
        operator,
        changeNote
      }
    ));
  }

  return {
    sceneConfig,
    platformResources,
    sceneAssets
  };
}

async function validateTemplateSceneDraftInput(input = {}, options = {}) {
  const scene = normalizeSceneId(input.scene);
  const templateRef = normalizeTemplateRef(input.templateRef);
  const sceneTemplate = resolveSceneTemplateRecord(templateRef);
  const workflowTemplateRef = cloneJson(sceneTemplate.workflowTemplateRef);
  const workflowTemplateDocument = cloneJson(sceneTemplate.workflowTemplateDocument);
  const title = toTrimmedString(input.title) || scene;
  const inputContract = normalizeInputContract(input.inputContract);
  const description = toTrimmedString(input.description);
  const assets = normalizeCreationAssets(input, {
    scene,
    title,
    description,
    inputContract,
    sceneTemplate
  });
  const ragConfig = normalizeRagConfig(input.ragConfig, {
    sceneTemplate,
    templateRef
  });

  const queryProfile = normalizeQueryProfile(input.queryProfile, {
    scene,
    title,
    inputContract,
    templateDocument: workflowTemplateDocument,
    templateRef
  });

  if (!queryProfile && sceneTemplate.requiresQueryProfile) {
    throw createAppError("INVALID_REQUEST", `场景模板 ${buildTemplateKey(templateRef)} 需要配置 QueryProfile。`, {
      stage: "scene-draft-generator",
      details: {
        templateRef
      }
    });
  }

  if (options.skipUniqueness !== true) {
    if (options.store) {
      await assertSceneIdentityAvailable(scene, options.store, queryProfile);
    } else {
      await withSceneDraftStore((store) => assertSceneIdentityAvailable(scene, store, queryProfile));
    }
  }

  return {
    scene,
    title,
    description,
    inputContract,
    outputSchema: cloneJson(input.outputSchema || {}),
    assets,
    ragConfig,
    queryProfile,
    templateRef,
    workflowTemplateRef,
    sceneTemplateRef: cloneJson(templateRef),
    sceneTemplate: {
      ref: cloneJson(templateRef),
      sourceScene: sceneTemplate.sourceScene,
      sourceSceneTitle: sceneTemplate.sourceSceneTitle,
      sourceSkillDocument: cloneJson(sceneTemplate.sourceSkillDocument),
      sourceSceneConfigDocument: cloneJson(sceneTemplate.sourceSceneConfigDocument)
    },
    template: {
      filePath: sceneTemplate.workflowTemplateFilePath,
      document: workflowTemplateDocument
    }
  };
}

async function createTemplateSceneDraft(input = {}, options = {}) {
  if (options.save === true && !options.store) {
    return withSceneDraftStore((store) => createTemplateSceneDraft(input, {
      ...options,
      store
    }));
  }

  const normalized = await validateTemplateSceneDraftInput(input, options);
  const draftPackage = buildTemplateSceneDraftPackage(normalized);
  const saved = options.save === true
    ? await saveDraftPackage(draftPackage, options.store, options)
    : null;

  return {
    status: saved ? "draft-created" : "prepared",
    ...normalized,
    draftPackage,
    saved
  };
}

module.exports = {
  buildTemplateSceneDraftPackage,
  createTemplateSceneDraft,
  normalizeQueryProfile,
  normalizeSceneId,
  normalizeTemplateRef,
  validateTemplateSceneDraftInput
};
