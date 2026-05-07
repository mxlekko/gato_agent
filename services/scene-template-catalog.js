const fs = require("fs");
const path = require("path");

const { compileWorkflowGraphForScene } = require("../platform/compiler/compile-workflow");
const { loadPlatformResources } = require("../platform/compiler/validate");
const { getSceneConfigs } = require("./scene-config");
const { createAppError } = require("../utils/errors");
const { PROJECT_ROOT, resolvePathReference } = require("../utils/path-resolver");

const PLATFORM_BASE_DIR = path.resolve(__dirname, "..", "platform");
const DEFAULT_VERSION = "v1";
const ASSET_REF_KEYS = {
  prompts: "promptRef",
  schemas: "schemaRef",
  dictionaries: "dictionaryRef",
  rules: "rulesRef"
};
const ASSET_TYPE_LABELS = {
  prompts: "prompt",
  schemas: "schema",
  dictionaries: "dictionary",
  rules: "rules"
};

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeVersion(version) {
  return typeof version === "string" && version.trim() ? version.trim() : DEFAULT_VERSION;
}

function buildSkillKey(name, version = DEFAULT_VERSION) {
  return `${String(name || "").trim()}@${normalizeVersion(version)}`;
}

function buildSceneTemplateKey(templateRef) {
  return `${templateRef.name}@${normalizeVersion(templateRef.version)}`;
}

function normalizeSceneTemplateRef(value = {}) {
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const version = normalizeVersion(value.version);
  if (!name) {
    throw createAppError("INVALID_REQUEST", "请选择场景模板。", {
      stage: "scene-template-catalog"
    });
  }

  return {
    name,
    version
  };
}

function buildPlatformIndex(resources = loadPlatformResources(PLATFORM_BASE_DIR)) {
  const templatesByKey = new Map();
  const skillsByKey = new Map();
  const skillsByScene = new Map();
  const queriesByRef = new Map();
  const toolsByRef = new Map();

  for (const record of resources.templates) {
    const metadata = record?.document?.metadata || {};
    if (metadata.name && metadata.version) {
      templatesByKey.set(`${metadata.name}@${metadata.version}`, record);
    }
  }

  for (const record of resources.skills) {
    const metadata = record?.document?.metadata || {};
    const scene = record?.document?.spec?.scene;
    if (metadata.name) {
      skillsByKey.set(buildSkillKey(metadata.name, metadata.version), record);
    }
    if (scene && !skillsByScene.has(scene)) {
      skillsByScene.set(scene, record);
    }
  }

  for (const record of resources.queries) {
    const ref = record?.document?.spec?.ref;
    if (ref) {
      queriesByRef.set(ref, record);
    }
  }

  for (const record of resources.tools) {
    const ref = record?.document?.spec?.ref;
    if (ref) {
      toolsByRef.set(ref, record);
    }
  }

  return {
    resources,
    templatesByKey,
    skillsByKey,
    skillsByScene,
    queriesByRef,
    toolsByRef
  };
}

function resolveSceneSkillSelection(sceneConfig) {
  const name = typeof sceneConfig?.skill?.id === "string" ? sceneConfig.skill.id.trim() : "";
  if (!name) {
    return null;
  }

  return {
    name,
    version: normalizeVersion(sceneConfig?.skill?.version)
  };
}

function resolveSkillRecord(scene, sceneConfig, platformIndex) {
  const selectedSkill = resolveSceneSkillSelection(sceneConfig);
  const skillRecord = selectedSkill?.name
    ? platformIndex.skillsByKey.get(buildSkillKey(selectedSkill.name, selectedSkill.version))
    : platformIndex.skillsByScene.get(scene);

  if (!skillRecord?.document?.spec) {
    return null;
  }

  return skillRecord;
}

function buildInputContract(skillDocument, sceneConfig) {
  const bizParams = isObject(skillDocument?.spec?.inputContract?.bizParams)
    ? skillDocument.spec.inputContract.bizParams
    : (isObject(sceneConfig?.request?.bizParams) ? sceneConfig.request.bizParams : {});
  const fields = {};
  const required = [];

  for (const [fieldName, fieldConfig] of Object.entries(bizParams)) {
    const source = isObject(fieldConfig) ? fieldConfig : {};
    fields[fieldName] = {
      ...cloneJson(source),
      sourcePath: source.sourcePath || `request.bizParams.${fieldName}`
    };

    if (source.required !== false) {
      required.push(fieldName);
    }
  }

  return {
    required,
    fields
  };
}

function collectAssetTypes(skillSpec) {
  return Object.entries(ASSET_REF_KEYS)
    .filter(([category, refKey]) => (
      Object.values(isObject(skillSpec?.assetRefs?.[category]) ? skillSpec.assetRefs[category] : {})
        .some((entry) => typeof entry?.[refKey] === "string" && entry[refKey].trim())
    ))
    .map(([category]) => ASSET_TYPE_LABELS[category]);
}

function readSchemaAsset(skillSpec) {
  const schemaEntries = Object.values(isObject(skillSpec?.assetRefs?.schemas)
    ? skillSpec.assetRefs.schemas
    : {});
  const sourcePath = schemaEntries
    .map((entry) => entry?.source?.path)
    .find((value) => typeof value === "string" && value.trim());

  if (!sourcePath) {
    return null;
  }

  try {
    const { resolvedPath } = resolvePathReference(sourcePath, {
      projectRoot: PROJECT_ROOT
    });
    if (!fs.existsSync(resolvedPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    return null;
  }
}

function readTextAsset(skillSpec, category) {
  const entries = Object.values(isObject(skillSpec?.assetRefs?.[category])
    ? skillSpec.assetRefs[category]
    : {});
  const sourcePath = entries
    .map((entry) => entry?.source?.path)
    .find((value) => typeof value === "string" && value.trim());

  if (!sourcePath) {
    return null;
  }

  try {
    const { resolvedPath } = resolvePathReference(sourcePath, {
      projectRoot: PROJECT_ROOT
    });
    if (!fs.existsSync(resolvedPath)) {
      return null;
    }

    return {
      contentText: fs.readFileSync(resolvedPath, "utf8"),
      sourcePath,
      contentFormat: category === "dictionaries" ? "tsv" : "markdown"
    };
  } catch (error) {
    return null;
  }
}

function buildAssetDefaults(skillSpec) {
  return {
    prompt: readTextAsset(skillSpec, "prompts"),
    dictionary: readTextAsset(skillSpec, "dictionaries"),
    rules: readTextAsset(skillSpec, "rules")
  };
}

function buildRagDefaults(skillSpec) {
  const override = isObject(skillSpec?.nodeOverrides?.retrieve_knowledge_context)
    ? skillSpec.nodeOverrides.retrieve_knowledge_context
    : null;
  if (!override) {
    return null;
  }

  return {
    enabled: override.enabled !== false,
    topK: Number.isFinite(Number(override.topK)) ? Number(override.topK) : 5,
    docId: typeof override.docId === "string" ? override.docId : "",
    query: typeof override.query === "string" ? override.query : "",
    failOnError: override.failOnError === true
  };
}

function collectQueryDefaults(skillSpec, platformIndex) {
  const queryProfileRef = skillSpec?.dataBindings?.queryProfileRef || null;
  const queryRecord = queryProfileRef ? platformIndex.queriesByRef.get(queryProfileRef) : null;
  const querySpec = queryRecord?.document?.spec || null;
  if (!querySpec) {
    return null;
  }

  const firstWhere = Array.isArray(querySpec.selectionPolicy?.where)
    ? querySpec.selectionPolicy.where[0]
    : null;

  return {
    ref: queryProfileRef,
    title: queryRecord?.document?.metadata?.title || null,
    primaryEntity: cloneJson(querySpec.primaryEntity || null),
    where: firstWhere ? cloneJson(firstWhere) : null,
    resultPolicy: cloneJson(querySpec.resultPolicy || null)
  };
}

function summarizeNodes(graph) {
  return (Array.isArray(graph?.orderedNodeIds) ? graph.orderedNodeIds : [])
    .map((nodeId) => graph?.nodesById?.[nodeId])
    .filter(Boolean)
    .map((node) => ({
      id: node.id,
      phase: node.phase || null,
      category: node.category || null,
      toolRole: node.toolRole || null,
      required: node.required === true,
      enabled: node.enabled !== false,
      inputs: Array.isArray(node.inputs) ? node.inputs.slice() : [],
      outputs: Array.isArray(node.outputs) ? node.outputs.slice() : []
    }));
}

function buildSceneTemplateRecord(scene, sceneConfig, platformIndex) {
  const skillRecord = resolveSkillRecord(scene, sceneConfig, platformIndex);
  if (!skillRecord) {
    return null;
  }

  const skillDocument = skillRecord.document;
  const skillSpec = skillDocument.spec || {};
  const templateRef = skillSpec.templateRef || {};
  const workflowTemplateRef = {
    name: templateRef.name || null,
    version: normalizeVersion(templateRef.version)
  };
  const workflowTemplateRecord = workflowTemplateRef.name
    ? platformIndex.templatesByKey.get(buildSceneTemplateKey(workflowTemplateRef))
    : null;

  if (!workflowTemplateRecord?.document?.spec) {
    return null;
  }

  const skillVersion = normalizeVersion(skillDocument?.metadata?.version);
  const graph = compileWorkflowGraphForScene({
    scene,
    baseDir: PLATFORM_BASE_DIR,
    resources: platformIndex.resources,
    skillRef: {
      name: skillDocument.metadata.name,
      version: skillVersion
    }
  });
  const nodes = summarizeNodes(graph);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const toolBindings = isObject(skillSpec.toolBindings) ? skillSpec.toolBindings : {};
  const requiresQueryProfile = Boolean(
    skillSpec?.dataBindings?.queryProfileRef ||
    toolBindings.context_fetcher ||
    nodeIds.has("fetch_business_context")
  );
  const requiresRag = Boolean(
    toolBindings.knowledge_retriever ||
    nodeIds.has("retrieve_knowledge_context")
  );
  const queryProfileDefaults = collectQueryDefaults(skillSpec, platformIndex);
  const sourceSceneTitle = sceneConfig.title || skillDocument?.metadata?.title || scene;

  return {
    name: scene,
    version: skillVersion,
    title: `${sourceSceneTitle}模板`,
    status: skillDocument?.metadata?.status || "draft",
    description: sceneConfig.description || workflowTemplateRecord.document?.spec?.description || "",
    sourceScene: scene,
    sourceSceneTitle,
    sourceSkillRef: {
      name: skillDocument?.metadata?.name || scene,
      version: skillVersion
    },
    workflowTemplateRef,
    workflowTemplateTitle: workflowTemplateRecord.document?.metadata?.title || workflowTemplateRef.name,
    engine: cloneJson(workflowTemplateRecord.document?.spec?.engine || null),
    phaseCount: Array.isArray(workflowTemplateRecord.document?.spec?.phases)
      ? workflowTemplateRecord.document.spec.phases.length
      : 0,
    nodeCount: nodes.length,
    orderedNodeIds: nodes.map((node) => node.id),
    nodes,
    requiresQueryProfile,
    requiresRag,
    supportedAssetTypes: collectAssetTypes(skillSpec),
    inputContract: buildInputContract(skillDocument, sceneConfig),
    outputSchema: readSchemaAsset(skillSpec),
    assetDefaults: buildAssetDefaults(skillSpec),
    ragDefaults: buildRagDefaults(skillSpec),
    queryProfileDefaults,
    sourceSceneConfigDocument: cloneJson(sceneConfig),
    sourceSkillDocument: cloneJson(skillDocument),
    workflowTemplateDocument: cloneJson(workflowTemplateRecord.document),
    workflowTemplateFilePath: workflowTemplateRecord.filePath,
    sourceSkillFilePath: skillRecord.filePath
  };
}

function listSceneTemplateRecords() {
  const sceneConfigs = getSceneConfigs();
  const platformIndex = buildPlatformIndex();

  return Object.entries(sceneConfigs)
    .map(([scene, sceneConfig]) => buildSceneTemplateRecord(scene, sceneConfig, platformIndex))
    .filter(Boolean)
    .sort((left, right) => {
      const titleDelta = String(left.sourceSceneTitle || "").localeCompare(String(right.sourceSceneTitle || ""), "zh-CN");
      return titleDelta || left.name.localeCompare(right.name);
    });
}

function stripSceneTemplateDocuments(record) {
  const {
    sourceSceneConfigDocument,
    sourceSkillDocument,
    workflowTemplateDocument,
    workflowTemplateFilePath,
    sourceSkillFilePath,
    ...summary
  } = record;

  return summary;
}

function getSceneTemplateSummaries() {
  return listSceneTemplateRecords().map(stripSceneTemplateDocuments);
}

function resolveSceneTemplate(templateRef) {
  const normalizedRef = normalizeSceneTemplateRef(templateRef);
  const key = buildSceneTemplateKey(normalizedRef);
  const record = listSceneTemplateRecords().find((item) => buildSceneTemplateKey(item) === key);

  if (!record) {
    throw createAppError("INVALID_REQUEST", `场景模板 ${key} 不存在，请重新选择。`, {
      stage: "scene-template-catalog",
      details: {
        templateRef: normalizedRef
      }
    });
  }

  return {
    ...record,
    ref: normalizedRef
  };
}

module.exports = {
  buildSceneTemplateKey,
  getSceneTemplateSummaries,
  normalizeSceneTemplateRef,
  resolveSceneTemplate
};
