const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { CONFIG_CURRENT_BUNDLE } = require("../../services/scene-config");

const PLATFORM_API_VERSION = "agent.platform/v1alpha1";
const REPOSITORY_PLATFORM_BASE_DIR = path.resolve(__dirname, "..");
const PLATFORM_BASE_DIR = path.resolve(
  process.env.CONFIG_PLATFORM_DIR || path.join(CONFIG_CURRENT_BUNDLE, "platform")
);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const SECRET_KEY_NAMES = new Set([
  "password",
  "secret",
  "apiKey",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "privateKey",
  "providerKey"
]);
const RAW_SQL_KEY_NAMES = new Set(["sql", "rawSql", "querySql"]);
const INLINE_SCRIPT_KEY_NAMES = new Set(["script", "scriptBody", "command", "shell"]);
const ABSOLUTE_SCRIPT_PATH_KEY_NAMES = new Set(["scriptPath", "helperScriptPath"]);
const ABSOLUTE_PATH_WHITELIST_CONTAINERS = new Set(["source", "migrationSource"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pushIssue(issues, payload) {
  issues.push(payload);
}

function loadYamlFile(filePath) {
  const rubyScript = [
    "require 'json'",
    "require 'yaml'",
    "file = ARGV[0]",
    "data = YAML.load_file(file)",
    "print JSON.generate(data)"
  ].join(";");

  const rawOutput = execFileSync("ruby", ["-e", rubyScript, filePath], {
    encoding: "utf8"
  });

  return JSON.parse(rawOutput);
}

function listYamlFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort();
}

function getPlatformResourceSourceState() {
  if (fs.existsSync(PLATFORM_BASE_DIR) && fs.statSync(PLATFORM_BASE_DIR).isDirectory()) {
    return {
      platformBaseDir: PLATFORM_BASE_DIR,
      source: "active-bundle"
    };
  }

  return {
    platformBaseDir: REPOSITORY_PLATFORM_BASE_DIR,
    source: "repository-fallback"
  };
}

function resolvePlatformBaseDir(baseDir) {
  if (baseDir === undefined || baseDir === null || baseDir === "") {
    return getPlatformResourceSourceState().platformBaseDir;
  }

  return path.resolve(baseDir);
}

function getPlatformDirectories(baseDir) {
  const effectiveBaseDir = resolvePlatformBaseDir(baseDir);
  return {
    templates: path.join(effectiveBaseDir, "templates"),
    tools: path.join(effectiveBaseDir, "tools"),
    skills: path.join(effectiveBaseDir, "skills")
  };
}

function loadPlatformResources(baseDir) {
  const effectiveBaseDir = resolvePlatformBaseDir(baseDir);
  const directories = getPlatformDirectories(effectiveBaseDir);
  const templateFiles = listYamlFiles(directories.templates);
  const toolFiles = listYamlFiles(directories.tools);
  const skillFiles = listYamlFiles(directories.skills);
  const resources = {
    templates: templateFiles.map((filePath) => ({ filePath, document: loadYamlFile(filePath) })),
    tools: [],
    queries: [],
    skills: skillFiles.map((filePath) => ({ filePath, document: loadYamlFile(filePath) }))
  };

  for (const filePath of toolFiles) {
    const document = loadYamlFile(filePath);
    const record = { filePath, document };

    if (document?.kind === "ToolDefinition") {
      resources.tools.push(record);
      continue;
    }

    if (document?.kind === "QueryProfile") {
      resources.queries.push(record);
      continue;
    }

    resources.tools.push(record);
  }

  return resources;
}

function buildRegistry(resources) {
  const templateByKey = new Map();
  const toolByRef = new Map();
  const queryByRef = new Map();
  const issues = [];

  for (const record of resources.templates) {
    const metadata = record.document?.metadata || {};
    const key = `${metadata.name || ""}@${metadata.version || ""}`;
    if (!metadata.name || !metadata.version) {
      pushIssue(issues, {
        code: "INVALID_TEMPLATE_METADATA",
        file: record.filePath,
        message: "WorkflowTemplate metadata.name and metadata.version are required."
      });
      continue;
    }

    if (templateByKey.has(key)) {
      pushIssue(issues, {
        code: "DUPLICATE_TEMPLATE",
        file: record.filePath,
        message: `Duplicate WorkflowTemplate found for ${key}.`
      });
      continue;
    }

    templateByKey.set(key, record);
  }

  for (const record of resources.tools) {
    const ref = record.document?.spec?.ref;
    if (!ref) {
      pushIssue(issues, {
        code: "INVALID_TOOL_REF",
        file: record.filePath,
        message: "ToolDefinition spec.ref is required."
      });
      continue;
    }

    if (toolByRef.has(ref)) {
      pushIssue(issues, {
        code: "DUPLICATE_TOOL_REF",
        file: record.filePath,
        message: `Duplicate ToolDefinition found for ${ref}.`
      });
      continue;
    }

    toolByRef.set(ref, record);
  }

  for (const record of resources.queries) {
    const ref = record.document?.spec?.ref;
    if (!ref) {
      pushIssue(issues, {
        code: "INVALID_QUERY_REF",
        file: record.filePath,
        message: "QueryProfile spec.ref is required."
      });
      continue;
    }

    if (queryByRef.has(ref)) {
      pushIssue(issues, {
        code: "DUPLICATE_QUERY_REF",
        file: record.filePath,
        message: `Duplicate QueryProfile found for ${ref}.`
      });
      continue;
    }

    queryByRef.set(ref, record);
  }

  return {
    templateByKey,
    toolByRef,
    queryByRef,
    issues
  };
}

function validateApiVersion(document, filePath, expectedKind, issues) {
  if (document?.apiVersion !== PLATFORM_API_VERSION) {
    pushIssue(issues, {
      code: "INVALID_API_VERSION",
      file: filePath,
      message: `${expectedKind} must use apiVersion=${PLATFORM_API_VERSION}.`
    });
  }

  if (document?.kind !== expectedKind) {
    pushIssue(issues, {
      code: "INVALID_KIND",
      file: filePath,
      message: `Expected kind=${expectedKind}, received kind=${document?.kind || "unknown"}.`
    });
  }
}

function validateLimits(limits, filePath, issues, subjectLabel) {
  if (!isObject(limits)) {
    pushIssue(issues, {
      code: "INVALID_LIMITS",
      file: filePath,
      message: `${subjectLabel} must define spec.limits.`
    });
    return;
  }

  const defaultTimeout = Number(limits.timeoutMsDefault);
  const maxTimeout = Number(limits.timeoutMsMax);
  const retryMaxAttempts = Number(limits.retryMaxAttempts);

  if (!Number.isFinite(defaultTimeout) || defaultTimeout <= 0) {
    pushIssue(issues, {
      code: "INVALID_TIMEOUT_DEFAULT",
      file: filePath,
      message: `${subjectLabel} limits.timeoutMsDefault must be a positive number.`
    });
  }

  if (!Number.isFinite(maxTimeout) || maxTimeout <= 0) {
    pushIssue(issues, {
      code: "INVALID_TIMEOUT_MAX",
      file: filePath,
      message: `${subjectLabel} limits.timeoutMsMax must be a positive number.`
    });
  }

  if (Number.isFinite(defaultTimeout) && Number.isFinite(maxTimeout) && defaultTimeout > maxTimeout) {
    pushIssue(issues, {
      code: "INVALID_TIMEOUT_RANGE",
      file: filePath,
      message: `${subjectLabel} limits.timeoutMsDefault cannot exceed timeoutMsMax.`
    });
  }

  if (!Number.isFinite(retryMaxAttempts) || retryMaxAttempts < 0) {
    pushIssue(issues, {
      code: "INVALID_RETRY_MAX",
      file: filePath,
      message: `${subjectLabel} limits.retryMaxAttempts must be zero or a positive number.`
    });
  }
}

function validateHttpEndpoint(endpoint, filePath, issues, subjectLabel) {
  try {
    const parsedUrl = new URL(endpoint);

    if (!LOOPBACK_HOSTS.has(parsedUrl.hostname)) {
      pushIssue(issues, {
        code: "EXTERNAL_ENDPOINT_NOT_ALLOWED",
        file: filePath,
        message: `${subjectLabel} endpoint must stay on loopback, received host=${parsedUrl.hostname}.`
      });
    }
  } catch (error) {
    pushIssue(issues, {
      code: "INVALID_ENDPOINT",
      file: filePath,
      message: `${subjectLabel} endpoint is not a valid URL: ${endpoint}.`
    });
  }
}

function validateTemplate(record, issues) {
  const { filePath, document } = record;
  validateApiVersion(document, filePath, "WorkflowTemplate", issues);

  const nodes = document?.spec?.nodes;
  const constraints = document?.spec?.constraints;

  if (!Array.isArray(nodes) || nodes.length === 0) {
    pushIssue(issues, {
      code: "EMPTY_TEMPLATE_NODES",
      file: filePath,
      message: "WorkflowTemplate spec.nodes must be a non-empty array."
    });
    return;
  }

  const nodeIds = new Set();
  for (const node of nodes) {
    if (!node?.id) {
      pushIssue(issues, {
        code: "INVALID_TEMPLATE_NODE",
        file: filePath,
        message: "WorkflowTemplate nodes must define id."
      });
      continue;
    }

    if (nodeIds.has(node.id)) {
      pushIssue(issues, {
        code: "DUPLICATE_TEMPLATE_NODE",
        file: filePath,
        message: `WorkflowTemplate node id duplicated: ${node.id}.`
      });
      continue;
    }

    nodeIds.add(node.id);
  }

  for (const protectedNodeId of constraints?.protectedNodes || []) {
    if (!nodeIds.has(protectedNodeId)) {
      pushIssue(issues, {
        code: "UNKNOWN_PROTECTED_NODE",
        file: filePath,
        message: `Template protected node ${protectedNodeId} does not exist in spec.nodes.`
      });
    }
  }
}

function scanForForbiddenConfig(value, options) {
  const {
    issues,
    filePath,
    kind,
    pathStack = []
  } = options;

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      scanForForbiddenConfig(item, {
        ...options,
        pathStack: pathStack.concat(String(index))
      });
    });
    return;
  }

  if (!isObject(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPathStack = pathStack.concat(key);
    const dottedPath = nextPathStack.join(".");
    const insideWhitelistedContainer = nextPathStack.some((segment) => ABSOLUTE_PATH_WHITELIST_CONTAINERS.has(segment));

    if (SECRET_KEY_NAMES.has(key)) {
      pushIssue(issues, {
        code: "SECRET_NOT_ALLOWED",
        file: filePath,
        field: dottedPath,
        message: `Secrets are not allowed in config field ${dottedPath}.`
      });
    }

    if (RAW_SQL_KEY_NAMES.has(key) && typeof child === "string" && child.trim()) {
      pushIssue(issues, {
        code: "RAW_SQL_NOT_ALLOWED",
        file: filePath,
        field: dottedPath,
        message: `Raw SQL is not allowed in config field ${dottedPath}.`
      });
    }

    if (INLINE_SCRIPT_KEY_NAMES.has(key) && typeof child === "string" && child.trim()) {
      pushIssue(issues, {
        code: "INLINE_SCRIPT_NOT_ALLOWED",
        file: filePath,
        field: dottedPath,
        message: `Inline executable content is not allowed in config field ${dottedPath}.`
      });
    }

    if (ABSOLUTE_SCRIPT_PATH_KEY_NAMES.has(key) && typeof child === "string" && path.isAbsolute(child) && !insideWhitelistedContainer) {
      pushIssue(issues, {
        code: "ABSOLUTE_SCRIPT_PATH_NOT_ALLOWED",
        file: filePath,
        field: dottedPath,
        message: `Absolute script path is not allowed in executable config field ${dottedPath}.`
      });
    }

    if (key === "endpoint") {
      if (kind !== "ToolDefinition") {
        pushIssue(issues, {
          code: "UNREGISTERED_ENDPOINT_NOT_ALLOWED",
          file: filePath,
          field: dottedPath,
          message: `Endpoint fields are only allowed in ToolDefinition driver config, found ${dottedPath}.`
        });
      } else if (!nextPathStack.includes("driver")) {
        pushIssue(issues, {
          code: "INVALID_ENDPOINT_LOCATION",
          file: filePath,
          field: dottedPath,
          message: `ToolDefinition endpoint must live under spec.driver, found ${dottedPath}.`
        });
      }
    }

    scanForForbiddenConfig(child, {
      ...options,
      pathStack: nextPathStack
    });
  }
}

function validateToolDefinition(record, issues) {
  const { filePath, document } = record;
  validateApiVersion(document, filePath, "ToolDefinition", issues);

  const spec = document?.spec || {};
  const driver = spec.driver || {};

  if (!spec.ref) {
    pushIssue(issues, {
      code: "INVALID_TOOL_REF",
      file: filePath,
      message: "ToolDefinition spec.ref is required."
    });
  }

  if (!spec.toolRole) {
    pushIssue(issues, {
      code: "INVALID_TOOL_ROLE",
      file: filePath,
      message: "ToolDefinition spec.toolRole is required."
    });
  }

  if (!driver.type) {
    pushIssue(issues, {
      code: "INVALID_TOOL_DRIVER",
      file: filePath,
      message: "ToolDefinition spec.driver.type is required."
    });
  }

  if (driver.type === "http") {
    if (!driver.endpoint) {
      pushIssue(issues, {
        code: "MISSING_HTTP_ENDPOINT",
        file: filePath,
        message: "HTTP ToolDefinition must provide spec.driver.endpoint."
      });
    } else {
      validateHttpEndpoint(driver.endpoint, filePath, issues, "ToolDefinition");
    }

    if (driver.networkPolicy !== "loopback-only") {
      pushIssue(issues, {
        code: "INVALID_NETWORK_POLICY",
        file: filePath,
        message: "HTTP ToolDefinition must set spec.driver.networkPolicy=loopback-only."
      });
    }
  }

  validateLimits(spec.limits, filePath, issues, "ToolDefinition");
  scanForForbiddenConfig(document, {
    issues,
    filePath,
    kind: "ToolDefinition"
  });
}

function validateQueryProfile(record, registry, issues) {
  const { filePath, document } = record;
  validateApiVersion(document, filePath, "QueryProfile", issues);

  const spec = document?.spec || {};
  const resultPolicy = isObject(spec.resultPolicy) ? spec.resultPolicy : {};
  const toolRef = spec.toolRef;
  const registeredTool = toolRef ? registry.toolByRef.get(toolRef) : null;

  if (!registeredTool) {
    pushIssue(issues, {
      code: "UNKNOWN_QUERY_TOOL_REF",
      file: filePath,
      message: `QueryProfile references unknown toolRef=${toolRef || "missing"}.`
    });
  } else {
    const toolRole = registeredTool.document?.spec?.toolRole;
    if (toolRole !== spec.toolRole) {
      pushIssue(issues, {
        code: "QUERY_TOOL_ROLE_MISMATCH",
        file: filePath,
        message: `QueryProfile toolRole=${spec.toolRole || "missing"} does not match tool role ${toolRole || "missing"}.`
      });
    }
  }

  validateLimits(spec.limits, filePath, issues, "QueryProfile");

  const requiredInputs = spec?.inputContract?.requiredInputs;
  if (!Array.isArray(requiredInputs) || requiredInputs.length === 0) {
    pushIssue(issues, {
      code: "INVALID_QUERY_REQUIRED_INPUTS",
      file: filePath,
      message: "QueryProfile spec.inputContract.requiredInputs must be a non-empty array."
    });
  }

  if (typeof spec?.primaryEntity?.table !== "string" || spec.primaryEntity.table.trim().length === 0) {
    pushIssue(issues, {
      code: "INVALID_QUERY_PRIMARY_ENTITY",
      file: filePath,
      message: "QueryProfile spec.primaryEntity.table is required."
    });
  }

  if (!Array.isArray(spec?.selectionPolicy?.where) || spec.selectionPolicy.where.length === 0) {
    pushIssue(issues, {
      code: "INVALID_QUERY_WHERE",
      file: filePath,
      message: "QueryProfile spec.selectionPolicy.where must be a non-empty array."
    });
  }

  const cardinality = spec?.selectionPolicy?.cardinality;
  if (!["single-record", "multi-record"].includes(cardinality)) {
    pushIssue(issues, {
      code: "INVALID_QUERY_CARDINALITY",
      file: filePath,
      message: "QueryProfile spec.selectionPolicy.cardinality must be single-record or multi-record."
    });
  }

  const resultMode = resultPolicy?.mode;
  if (!["single-row", "multi-rows", "column-values", "aggregate-value"].includes(resultMode)) {
    pushIssue(issues, {
      code: "INVALID_QUERY_RESULT_MODE",
      file: filePath,
      message: "QueryProfile spec.resultPolicy.mode must be single-row, multi-rows, column-values, or aggregate-value."
    });
  }

  const statementType = spec?.selectionPolicy?.statement?.type;
  const expectedStatementTypeByMode = {
    "single-row": "select-top-1",
    "multi-rows": "select-rows",
    "column-values": "select-column-values",
    "aggregate-value": "select-count"
  };
  if (statementType !== expectedStatementTypeByMode[resultMode]) {
    pushIssue(issues, {
      code: "INVALID_QUERY_STATEMENT_TYPE",
      file: filePath,
      message: `QueryProfile statement.type=${statementType || "missing"} does not match resultPolicy.mode=${resultMode || "missing"}.`
    });
  }

  const expectedResultPathByMode = {
    "single-row": "data.rawRow",
    "multi-rows": "data.rows",
    "column-values": "data.values",
    "aggregate-value": "data.value"
  };
  if (spec?.outputPolicy?.resultPath !== expectedResultPathByMode[resultMode]) {
    pushIssue(issues, {
      code: "INVALID_QUERY_RESULT_PATH",
      file: filePath,
      message: `QueryProfile outputPolicy.resultPath=${spec?.outputPolicy?.resultPath || "missing"} does not match resultPolicy.mode=${resultMode || "missing"}.`
    });
  }

  if (resultMode === "column-values") {
    const fields = Array.isArray(resultPolicy.fields) ? resultPolicy.fields : [];
    if (fields.length !== 1) {
      pushIssue(issues, {
        code: "INVALID_QUERY_RESULT_FIELDS",
        file: filePath,
        message: "QueryProfile column-values mode must configure exactly one result field."
      });
    }
  }

  const requiredFalseFlags = [
    "allowJoin",
    "allowSubquery",
    "allowOrderBy",
    "allowWrite",
    "allowMultipleStatements",
    "allowRawSqlConfig",
    "allowInlineScript"
  ];

  for (const flagName of requiredFalseFlags) {
    if (spec?.generationConstraints?.[flagName] !== false) {
      pushIssue(issues, {
        code: "INVALID_QUERY_CONSTRAINT",
        file: filePath,
        message: `QueryProfile generationConstraints.${flagName} must be false in V1.`
      });
    }
  }

  scanForForbiddenConfig(document, {
    issues,
    filePath,
    kind: "QueryProfile"
  });
}

function buildTemplateNodeIndex(templateRecord) {
  const nodes = templateRecord?.document?.spec?.nodes || [];
  const nodeById = new Map();
  const phaseByNodeId = new Map();

  for (const node of nodes) {
    nodeById.set(node.id, node);
    phaseByNodeId.set(node.id, node.phase);
  }

  return { nodeById, phaseByNodeId };
}

function validateToolSceneAllowance({
  toolRecord,
  scene,
  filePath,
  field,
  issues,
  allowTemplateScene = false
} = {}) {
  const allowedScenes = toolRecord?.document?.spec?.policy?.allowedScenes;
  if (!Array.isArray(allowedScenes) || allowedScenes.length === 0) {
    return;
  }

  if (allowedScenes.includes(scene) || allowedScenes.includes("*")) {
    return;
  }

  if (allowTemplateScene && toolRecord?.document?.spec?.policy?.allowTemplateScenes === true) {
    return;
  }

  pushIssue(issues, {
    code: "TOOL_SCENE_NOT_ALLOWED",
    file: filePath,
    field,
    message: `ToolDefinition ${toolRecord?.document?.spec?.ref || "missing"} does not allow scene=${scene || "missing"} in spec.policy.allowedScenes.`
  });
}

function templateAllowsNewScenes(templateRecord) {
  return templateRecord?.document?.spec?.sceneCreation?.allowNewScenes === true;
}

function validateBusinessSkill(record, registry, issues) {
  const { filePath, document } = record;
  validateApiVersion(document, filePath, "BusinessSkill", issues);

  const spec = document?.spec || {};
  const templateRef = spec.templateRef || {};
  const templateKey = `${templateRef.name || ""}@${templateRef.version || ""}`;
  const templateRecord = registry.templateByKey.get(templateKey);

  if (!templateRecord) {
    pushIssue(issues, {
      code: "UNKNOWN_TEMPLATE_REF",
      file: filePath,
      message: `BusinessSkill references unknown templateRef=${templateKey}.`
    });
  }

  const allowTemplateScene = templateAllowsNewScenes(templateRecord);

  if (templateRecord) {
    const compatibleScenes = templateRecord.document?.spec?.compatibleScenes || [];
    if (
      Array.isArray(compatibleScenes)
      && compatibleScenes.length > 0
      && !compatibleScenes.includes(spec.scene)
      && !allowTemplateScene
    ) {
      pushIssue(issues, {
        code: "INCOMPATIBLE_SCENE",
        file: filePath,
        message: `BusinessSkill scene=${spec.scene || "missing"} is not listed in template compatibleScenes.`
      });
    }
  }

  const toolBindings = isObject(spec.toolBindings) ? spec.toolBindings : {};
  for (const [role, binding] of Object.entries(toolBindings)) {
    const toolRef = binding?.toolRef;
    const toolRecord = registry.toolByRef.get(toolRef);

    if (!toolRecord) {
      pushIssue(issues, {
        code: "UNKNOWN_TOOL_REF",
        file: filePath,
        field: `spec.toolBindings.${role}.toolRef`,
        message: `BusinessSkill tool binding ${role} references unknown toolRef=${toolRef || "missing"}.`
      });
      continue;
    }

    const toolRole = toolRecord.document?.spec?.toolRole;
    if (toolRole !== role) {
      pushIssue(issues, {
        code: "TOOL_ROLE_MISMATCH",
        file: filePath,
        field: `spec.toolBindings.${role}.toolRef`,
        message: `BusinessSkill tool binding role ${role} does not match registered tool role ${toolRole || "missing"}.`
      });
    }

    validateToolSceneAllowance({
      toolRecord,
      scene: spec.scene,
      filePath,
      field: `spec.toolBindings.${role}.toolRef`,
      issues,
      allowTemplateScene
    });
  }

  const queryProfileRef = spec?.dataBindings?.queryProfileRef;
  const requiresQueryProfile = Boolean(queryProfileRef || toolBindings?.context_fetcher);
  if (requiresQueryProfile) {
    const queryRecord = queryProfileRef ? registry.queryByRef.get(queryProfileRef) : null;
    if (!queryRecord) {
      pushIssue(issues, {
        code: "UNKNOWN_QUERY_REF",
        file: filePath,
        field: "spec.dataBindings.queryProfileRef",
        message: `BusinessSkill references unknown queryProfileRef=${queryProfileRef || "missing"}.`
      });
    } else {
      const boundContextToolRef = toolBindings?.context_fetcher?.toolRef;
      const queryToolRef = queryRecord.document?.spec?.toolRef;
      if (boundContextToolRef && queryToolRef && boundContextToolRef !== queryToolRef) {
        pushIssue(issues, {
          code: "QUERY_TOOL_BINDING_MISMATCH",
          file: filePath,
          field: "spec.dataBindings.queryProfileRef",
          message: `BusinessSkill context_fetcher toolRef=${boundContextToolRef} does not match QueryProfile toolRef=${queryToolRef}.`
        });
      }
    }
  }

  if (templateRecord) {
    const { nodeById, phaseByNodeId } = buildTemplateNodeIndex(templateRecord);
    const nodeOverrides = isObject(spec.nodeOverrides) ? spec.nodeOverrides : {};

    for (const [nodeId, override] of Object.entries(nodeOverrides)) {
      const node = nodeById.get(nodeId);
      if (!node) {
        pushIssue(issues, {
          code: "UNKNOWN_NODE_OVERRIDE",
          file: filePath,
          field: `spec.nodeOverrides.${nodeId}`,
          message: `BusinessSkill overrides unknown node ${nodeId}.`
        });
        continue;
      }

      const allowedConfig = Array.isArray(node.allowedConfig) ? node.allowedConfig : [];
      const illegalKeys = Object.keys(override || {}).filter((key) => !allowedConfig.includes(key));
      if (illegalKeys.length > 0) {
        pushIssue(issues, {
          code: "INVALID_NODE_OVERRIDE_KEY",
          file: filePath,
          field: `spec.nodeOverrides.${nodeId}`,
          message: `BusinessSkill override for node ${nodeId} uses disallowed keys: ${illegalKeys.join(", ")}.`
        });
      }
    }

    const nodeOrderOverrides = isObject(spec.nodeOrderOverrides) ? spec.nodeOrderOverrides : {};
    for (const [phase, orderedNodeIds] of Object.entries(nodeOrderOverrides)) {
      if (!Array.isArray(orderedNodeIds) || orderedNodeIds.length === 0) {
        pushIssue(issues, {
          code: "INVALID_NODE_ORDER_OVERRIDE",
          file: filePath,
          field: `spec.nodeOrderOverrides.${phase}`,
          message: `BusinessSkill nodeOrderOverrides.${phase} must be a non-empty array.`
        });
        continue;
      }

      for (const nodeId of orderedNodeIds) {
        const node = nodeById.get(nodeId);
        if (!node) {
          pushIssue(issues, {
            code: "UNKNOWN_NODE_ORDER_NODE",
            file: filePath,
            field: `spec.nodeOrderOverrides.${phase}`,
            message: `BusinessSkill phase ${phase} references unknown node ${nodeId}.`
          });
          continue;
        }

        if (phaseByNodeId.get(nodeId) !== phase) {
          pushIssue(issues, {
            code: "CROSS_PHASE_REORDER_NOT_ALLOWED",
            file: filePath,
            field: `spec.nodeOrderOverrides.${phase}`,
            message: `BusinessSkill phase ${phase} cannot reorder node ${nodeId} from phase ${phaseByNodeId.get(nodeId)}.`
          });
        }

        if (!node.reorderable) {
          pushIssue(issues, {
            code: "NODE_NOT_REORDERABLE",
            file: filePath,
            field: `spec.nodeOrderOverrides.${phase}`,
            message: `BusinessSkill phase ${phase} cannot reorder protected or fixed node ${nodeId}.`
          });
        }
      }
    }
  }

  scanForForbiddenConfig(document, {
    issues,
    filePath,
    kind: "BusinessSkill"
  });
}

function validateRecord(record, registry, issues) {
  const kind = record?.document?.kind;

  if (kind === "WorkflowTemplate") {
    validateTemplate(record, issues);
    return;
  }

  if (kind === "ToolDefinition") {
    validateToolDefinition(record, issues);
    return;
  }

  if (kind === "QueryProfile") {
    validateQueryProfile(record, registry, issues);
    return;
  }

  if (kind === "BusinessSkill") {
    validateBusinessSkill(record, registry, issues);
    return;
  }

  pushIssue(issues, {
    code: "UNSUPPORTED_KIND",
    file: record.filePath,
    message: `Unsupported config kind=${kind || "unknown"}.`
  });
}

function buildSummary(resources, issues, mode, subject = null) {
  return {
    valid: issues.length === 0,
    mode,
    subject,
    counts: {
      templates: resources.templates.length,
      tools: resources.tools.length,
      queries: resources.queries.length,
      skills: resources.skills.length
    },
    issueCount: issues.length,
    issues
  };
}

function validatePlatformConfigs({ baseDir, resources = null }) {
  const effectiveResources = resources || loadPlatformResources(baseDir);
  const registry = buildRegistry(effectiveResources);
  const issues = [...registry.issues];

  for (const record of effectiveResources.templates) {
    validateRecord(record, registry, issues);
  }

  for (const record of effectiveResources.tools) {
    validateRecord(record, registry, issues);
  }

  for (const record of effectiveResources.queries) {
    validateRecord(record, registry, issues);
  }

  for (const record of effectiveResources.skills) {
    validateRecord(record, registry, issues);
  }

  return buildSummary(effectiveResources, issues, "full");
}

function validateSingleConfigFile({ baseDir, filePath }) {
  const resources = loadPlatformResources(baseDir);
  const registry = buildRegistry(resources);
  const issues = [...registry.issues];
  const record = {
    filePath: path.resolve(filePath),
    document: loadYamlFile(path.resolve(filePath))
  };

  validateRecord(record, registry, issues);
  return buildSummary(resources, issues, "single-file", path.resolve(filePath));
}

module.exports = {
  PLATFORM_BASE_DIR,
  REPOSITORY_PLATFORM_BASE_DIR,
  getPlatformResourceSourceState,
  loadPlatformResources,
  resolvePlatformBaseDir,
  validatePlatformConfigs,
  validateSingleConfigFile
};
