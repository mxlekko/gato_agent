const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { execFileSync } = require("child_process");
const { compileWorkflowGraphForScene } = require("../platform/compiler/compile-workflow");
const {
  loadPlatformResources,
  validatePlatformConfigs
} = require("../platform/compiler/validate");
const { isDirectModelScene } = require("./direct-model");
const { SCENE_CONFIG_DIR, getSceneConfigs } = require("./scene-config");
const { createConfigStore } = require("./config-store");
const { createAppError, normalizeError } = require("../utils/errors");
const {
  CANONICAL_RUNTIME_NAMESPACE,
  PROJECT_ROOT,
  RUNTIME_PREFIX,
  resolvePathReference
} = require("../utils/path-resolver");

const PLATFORM_BASE_DIR = path.resolve(__dirname, "..", "platform");
const PLATFORM_CONFIG_DIRS = [
  path.join(PLATFORM_BASE_DIR, "templates"),
  path.join(PLATFORM_BASE_DIR, "tools"),
  path.join(PLATFORM_BASE_DIR, "skills")
];
const ASSET_REF_KEYS = {
  prompts: "promptRef",
  schemas: "schemaRef",
  dictionaries: "dictionaryRef",
  rules: "rulesRef"
};
const CONSOLE_SCENE_CACHE = {
  signature: null,
  sceneConfigs: null,
  platformIndex: null,
  workflowsByScene: new Map(),
  catalog: null
};
const CONSOLE_SCENE_ASSET_STORE_DRIVER = "mysql";
const CONSOLE_SCENE_ASSET_STORAGE_TABLE = "cfg_scene_assets";
const CONSOLE_SCENE_ASSET_UPDATED_BY = "console-scene";
const CONSOLE_SCENE_CONFIG_STORE_DRIVER = "mysql";
const CONSOLE_SCENE_CONFIG_STORAGE_TABLE = "cfg_scene_configs";
const CONSOLE_SCENE_CONFIG_UPDATED_BY = "console-scene";
const CONSOLE_SCENE_PLATFORM_STORAGE_TABLE = "cfg_platform_resources";

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function withConsoleSceneAssetStore(callback) {
  const store = createConfigStore({
    driver: CONSOLE_SCENE_ASSET_STORE_DRIVER
  });

  try {
    return await callback(store);
  } finally {
    await store.close();
  }
}

async function withConsoleSceneDraftStore(callback) {
  const store = createConfigStore({
    driver: CONSOLE_SCENE_CONFIG_STORE_DRIVER
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
      stage: "console-scene",
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

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getExecutionMode(sceneConfig) {
  return isDirectModelScene(sceneConfig) ? "direct-model" : "agent-runtime";
}

function getRoutingMode(sceneConfig) {
  return sceneConfig?.routing?.mode || "legacy";
}

function getAllowedModes(sceneConfig) {
  return Array.isArray(sceneConfig?.routing?.allowedModes)
    ? sceneConfig.routing.allowedModes.slice()
    : ["legacy"];
}

function listConfigFiles(directoryPath, extension) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort();
}

function buildCacheSignature() {
  const filePaths = [
    ...listConfigFiles(SCENE_CONFIG_DIR, ".json"),
    ...PLATFORM_CONFIG_DIRS.flatMap((directoryPath) => listConfigFiles(directoryPath, ".yaml"))
  ];

  return filePaths
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      return `${filePath}:${stat.size}:${stat.mtimeMs}`;
    })
    .join("|");
}

function getConsoleSceneCacheState() {
  const signature = buildCacheSignature();
  if (CONSOLE_SCENE_CACHE.signature !== signature) {
    CONSOLE_SCENE_CACHE.signature = signature;
    CONSOLE_SCENE_CACHE.sceneConfigs = null;
    CONSOLE_SCENE_CACHE.platformIndex = null;
    CONSOLE_SCENE_CACHE.workflowsByScene = new Map();
    CONSOLE_SCENE_CACHE.catalog = null;
  }

  return CONSOLE_SCENE_CACHE;
}

function getCachedSceneConfigs() {
  const cacheState = getConsoleSceneCacheState();
  if (!cacheState.sceneConfigs) {
    cacheState.sceneConfigs = getSceneConfigs();
  }

  return cacheState.sceneConfigs;
}

function getCachedSceneConfig(scene) {
  const sceneConfigs = getCachedSceneConfigs();
  const sceneConfig = sceneConfigs[scene];
  if (!sceneConfig) {
    throw createAppError("INVALID_REQUEST", `Unsupported scene: ${scene}.`, {
      stage: "request-validate"
    });
  }

  return sceneConfig;
}

function normalizeSkillVersion(version) {
  return typeof version === "string" && version.trim() ? version.trim() : "v1";
}

function buildSkillKey(name, version = "v1") {
  return `${String(name || "").trim()}@${normalizeSkillVersion(version)}`;
}

function resolveSceneSkillSelection(sceneConfig) {
  const name = typeof sceneConfig?.skill?.id === "string" ? sceneConfig.skill.id.trim() : "";
  if (!name) {
    return null;
  }

  return {
    name,
    version: normalizeSkillVersion(sceneConfig?.skill?.version)
  };
}

function resolveSceneConfigFilePath(scene) {
  const filePath = path.join(SCENE_CONFIG_DIR, `${scene}.json`);
  if (!fs.existsSync(filePath)) {
    throw createAppError("INVALID_REQUEST", `Scene config file not found for ${scene}.`, {
      stage: "console-scene",
      details: {
        scene,
        filePath
      }
    });
  }

  return filePath;
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(PROJECT_ROOT, relativePath));
}

function buildProjectSkillWorkspaceRef(skillName) {
  return `project://references/${skillName}`;
}

function buildProjectSkillEntryFileRef(skillName) {
  const candidates = [
    "skill_contract.md",
    "sql_definition.md",
    "README.md"
  ];
  const selectedFile = candidates.find((fileName) => {
    return fileExists(path.join("references", skillName, fileName));
  }) || "skill_contract.md";

  return `${buildProjectSkillWorkspaceRef(skillName)}/${selectedFile}`;
}

function isRuntimeSkillAssetRef(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return false;
  }

  const prefixes = [
    `${RUNTIME_PREFIX}${CANONICAL_RUNTIME_NAMESPACE}/`
  ];
  return prefixes.some((prefix) => trimmed.startsWith(prefix));
}

function getPlatformResourceKind(document) {
  switch (document?.kind) {
    case "WorkflowTemplate":
      return "template";
    case "BusinessSkill":
      return "skill";
    case "ToolDefinition":
      return "tool";
    case "QueryProfile":
      return "query";
    default:
      return "unknown";
  }
}

function buildPlatformResourceKey(kind, name, version) {
  return `${kind}:${name}@${version}`;
}

function buildPlatformResourceStoragePath(kind, name, version) {
  return `mysql://${CONSOLE_SCENE_PLATFORM_STORAGE_TABLE}/${buildPlatformResourceKey(kind, name, version)}`;
}

function buildSceneConfigStoragePath(scene) {
  return `mysql://${CONSOLE_SCENE_CONFIG_STORAGE_TABLE}/${scene}`;
}

function buildSceneConfigSkillRef(sceneConfig) {
  const skillSelection = resolveSceneSkillSelection(sceneConfig);
  return skillSelection?.name
    ? buildSkillKey(skillSelection.name, skillSelection.version)
    : null;
}

function buildPlatformSourceMetadataIndex() {
  const resources = loadPlatformResources(PLATFORM_BASE_DIR);
  const byKey = new Map();
  const byRef = new Map();

  for (const record of [
    ...resources.templates,
    ...resources.skills,
    ...resources.tools,
    ...resources.queries
  ]) {
    const document = record?.document || {};
    const metadata = document.metadata || {};
    const spec = document.spec || {};
    const kind = getPlatformResourceKind(document);
    const key = buildPlatformResourceKey(kind, metadata.name || "unknown", metadata.version || "unknown");
    const sourceMetadata = {
      filePath: record.filePath,
      editable: isEditableProjectPath(record.filePath)
    };

    byKey.set(key, sourceMetadata);
    if (spec.ref) {
      byRef.set(spec.ref, sourceMetadata);
    }
  }

  return {
    byKey,
    byRef
  };
}

function buildDraftPlatformIndex(platformRecords = []) {
  const sourceMetadataIndex = buildPlatformSourceMetadataIndex();
  const resources = {
    templates: [],
    skills: [],
    tools: [],
    queries: []
  };
  const templatesByKey = new Map();
  const skillsByKey = new Map();
  const skillsByScene = new Map();
  const toolsByRef = new Map();
  const queriesByRef = new Map();

  for (const record of platformRecords) {
    const document = cloneJson(record?.document || {});
    const metadata = document.metadata || {};
    const spec = document.spec || {};
    const kind = getPlatformResourceKind(document);
    const key = buildPlatformResourceKey(kind, metadata.name || "unknown", metadata.version || "unknown");
    const sourceMetadata = sourceMetadataIndex.byKey.get(key)
      || (spec.ref ? sourceMetadataIndex.byRef.get(spec.ref) : null)
      || null;
    const normalizedRecord = {
      document,
      sourceText: typeof record?.sourceText === "string" ? record.sourceText : null,
      filePath: sourceMetadata?.filePath || null,
      sourceFilePath: sourceMetadata?.filePath || null,
      editable: sourceMetadata?.editable ?? false,
      status: record?.status || metadata.status || null,
      currentRevisionId: record?.currentRevisionId || null,
      updatedBy: record?.updatedBy || null,
      updatedAt: toIsoString(record?.updatedAt),
      storageDriver: CONSOLE_SCENE_CONFIG_STORE_DRIVER,
      storageTable: CONSOLE_SCENE_PLATFORM_STORAGE_TABLE,
      storagePath: buildPlatformResourceStoragePath(kind, metadata.name || "unknown", metadata.version || "unknown")
    };

    if (kind === "template") {
      resources.templates.push(normalizedRecord);
      if (metadata.name && metadata.version) {
        templatesByKey.set(`${metadata.name}@${metadata.version}`, normalizedRecord);
      }
      continue;
    }

    if (kind === "skill") {
      resources.skills.push(normalizedRecord);
      if (metadata.name) {
        skillsByKey.set(buildSkillKey(metadata.name, metadata.version), normalizedRecord);
      }
      if (spec.scene && !skillsByScene.has(spec.scene)) {
        skillsByScene.set(spec.scene, normalizedRecord);
      }
      continue;
    }

    if (kind === "tool") {
      resources.tools.push(normalizedRecord);
      if (spec.ref) {
        toolsByRef.set(spec.ref, normalizedRecord);
      }
      continue;
    }

    if (kind === "query") {
      resources.queries.push(normalizedRecord);
      if (spec.ref) {
        queriesByRef.set(spec.ref, normalizedRecord);
      }
    }
  }

  return {
    resources,
    templatesByKey,
    skillsByKey,
    skillsByScene,
    toolsByRef,
    queriesByRef
  };
}

async function loadDraftPlatformIndex() {
  const platformRecords = await withConsoleSceneDraftStore((store) => store.listPlatformResources());
  return buildDraftPlatformIndex(platformRecords);
}

function getPublishedSceneConfigSnapshot(scene) {
  const filePath = resolveSceneConfigFilePath(scene);
  const sourceText = fs.readFileSync(filePath, "utf8");
  const stat = fs.statSync(filePath);
  let document;
  try {
    document = JSON.parse(sourceText);
  } catch (error) {
    throw createAppError("INVALID_REQUEST", `Scene config ${scene} is not valid JSON.`, {
      stage: "console-scene",
      details: {
        scene,
        filePath,
        cause: error?.message || "json_parse_failed"
      }
    });
  }

  return {
    scene,
    document: cloneJson(document),
    sourceText,
    path: filePath,
    updatedAt: stat.mtime.toISOString()
  };
}

async function getDraftSceneConfigRecord(scene) {
  const draftRecord = await withConsoleSceneDraftStore((store) => store.getSceneConfig(scene));
  if (!draftRecord?.document) {
    throw createAppError("INVALID_REQUEST", `Scene ${scene} is missing config draft in config-store.`, {
      stage: "console-scene",
      details: {
        scene,
        storageTable: CONSOLE_SCENE_CONFIG_STORAGE_TABLE
      }
    });
  }

  return draftRecord;
}

async function listDraftSceneConfigRecords() {
  return withConsoleSceneDraftStore((store) => store.listSceneConfigs());
}

function buildPublishedSkillBinding(sceneConfig, platformIndex) {
  const skillSelection = resolveSceneSkillSelection(sceneConfig);
  if (!skillSelection?.name) {
    return null;
  }

  const skillRecord = platformIndex?.skillsByKey?.get(buildSkillKey(skillSelection.name, skillSelection.version));
  if (skillRecord?.document) {
    return buildSkillBindingOption(skillRecord);
  }

  return {
    name: skillSelection.name,
    version: skillSelection.version,
    title: skillSelection.name,
    status: null,
    scene: sceneConfig?.scene || null,
    templateRef: null,
    requestKind: sceneConfig?.runtime?.requestKind || null,
    outputSchemaRef: null
  };
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = sortJsonValue(value[key]);
        return result;
      }, {});
  }

  return value;
}

function normalizeSceneConfigForDiff(document) {
  const normalized = cloneJson(document || {});
  if (isObject(normalized.skill)) {
    normalized.skill.version = normalizeSkillVersion(normalized.skill.version);
  }

  return sortJsonValue(normalized);
}

function buildSceneConfigState(scene, draftRecord, publishedSnapshot, platformIndex) {
  const draftSceneConfig = cloneJson(draftRecord?.document || {});
  const publishedSceneConfig = cloneJson(publishedSnapshot?.document || {});
  const storagePath = buildSceneConfigStoragePath(scene);
  const draftSkillRef = buildSceneConfigSkillRef(draftSceneConfig);
  const publishedSkillRef = buildSceneConfigSkillRef(publishedSceneConfig);

  return {
    storageDriver: CONSOLE_SCENE_CONFIG_STORE_DRIVER,
    storageTable: CONSOLE_SCENE_CONFIG_STORAGE_TABLE,
    storagePath,
    hasUnpublishedChanges:
      JSON.stringify(normalizeSceneConfigForDiff(draftSceneConfig))
      !== JSON.stringify(normalizeSceneConfigForDiff(publishedSceneConfig)),
    draft: {
      status: draftRecord?.status || "draft",
      currentRevisionId: draftRecord?.currentRevisionId || null,
      updatedBy: draftRecord?.updatedBy || null,
      updatedAt: toIsoString(draftRecord?.updatedAt),
      skillRef: draftSkillRef,
      routingMode: getRoutingMode(draftSceneConfig),
      allowedModes: getAllowedModes(draftSceneConfig),
      executionMode: getExecutionMode(draftSceneConfig)
    },
    published: {
      status: "published",
      path: publishedSnapshot?.path || null,
      updatedAt: publishedSnapshot?.updatedAt || null,
      skillRef: publishedSkillRef,
      routingMode: getRoutingMode(publishedSceneConfig),
      allowedModes: getAllowedModes(publishedSceneConfig),
      executionMode: getExecutionMode(publishedSceneConfig)
    },
    publishedCurrent: buildPublishedSkillBinding(publishedSceneConfig, platformIndex)
  };
}

function resolveSkillRecordBySelection(skillSelection, platformIndex = null) {
  const activePlatformIndex = platformIndex || getCachedPlatformIndex();
  if (!skillSelection?.name) {
    return null;
  }

  return activePlatformIndex.skillsByKey.get(
    buildSkillKey(skillSelection.name, skillSelection.version)
  ) || null;
}

function resolveSceneSkillRecord(scene, platformIndex = null, sceneConfig = null) {
  const activePlatformIndex = platformIndex || getCachedPlatformIndex();
  const activeSceneConfig = sceneConfig || getCachedSceneConfig(scene);
  const selectedSkill = resolveSceneSkillSelection(activeSceneConfig);
  const skillRecord = selectedSkill?.name
    ? resolveSkillRecordBySelection(selectedSkill, activePlatformIndex)
    : activePlatformIndex.skillsByScene.get(scene);
  if (!skillRecord?.document?.spec || !skillRecord?.filePath) {
    const detail = selectedSkill?.name
      ? `skillRef ${buildSkillKey(selectedSkill.name, selectedSkill.version)}`
      : `scene ${scene}`;
    throw createAppError("INVALID_REQUEST", `No BusinessSkill found for ${detail}.`, {
      stage: "console-scene",
      details: {
        scene,
        selectedSkill: selectedSkill || null
      }
    });
  }

  return skillRecord;
}

function buildPlatformIndex() {
  const resources = loadPlatformResources(PLATFORM_BASE_DIR);
  const templatesByKey = new Map();
  const skillsByKey = new Map();
  const skillsByScene = new Map();
  const toolsByRef = new Map();
  const queriesByRef = new Map();

  for (const record of resources.templates) {
    const metadata = record?.document?.metadata || {};
    const key = `${metadata.name || ""}@${metadata.version || ""}`;
    if (metadata.name && metadata.version) {
      templatesByKey.set(key, record);
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

  for (const record of resources.tools) {
    const ref = record?.document?.spec?.ref;
    if (ref) {
      toolsByRef.set(ref, record);
    }
  }

  for (const record of resources.queries) {
    const ref = record?.document?.spec?.ref;
    if (ref) {
      queriesByRef.set(ref, record);
    }
  }

  return {
    resources,
    templatesByKey,
    skillsByKey,
    skillsByScene,
    toolsByRef,
    queriesByRef
  };
}

function getCachedPlatformIndex() {
  const cacheState = getConsoleSceneCacheState();
  if (!cacheState.platformIndex) {
    cacheState.platformIndex = buildPlatformIndex();
  }

  return cacheState.platformIndex;
}

function isEditableProjectPath(filePath) {
  if (!filePath) {
    return false;
  }

  const relativePath = path.relative(PROJECT_ROOT, filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function readAssetCatalogEntries(skillSpec, categoryName) {
  const rawCategory = isObject(skillSpec?.assetRefs?.[categoryName])
    ? skillSpec.assetRefs[categoryName]
    : {};

  return Object.entries(rawCategory)
    .map(([assetKey, entry]) => {
      if (!isObject(entry)) {
        return null;
      }

      const refKey = ASSET_REF_KEYS[categoryName];
      const ref = entry?.[refKey] || entry?.ref || null;
      const source = isObject(entry?.source)
        ? entry.source
        : entry?.path
          ? {
              type: "local-file",
              path: entry.path
            }
          : null;

      if (!ref || !source?.path) {
        return null;
      }

      return {
        assetKey,
        ref,
        sourceType: source.type || "local-file",
        sourcePath: source.path
      };
    })
    .filter(Boolean);
}

function readSelectedAssetRefs(skillSpec, categoryName) {
  const selectedRefs = skillSpec?.nodeOverrides?.load_reference_bundle?.assetRefs?.[categoryName];
  if (Array.isArray(selectedRefs) && selectedRefs.length > 0) {
    return selectedRefs.slice();
  }

  return readAssetCatalogEntries(skillSpec, categoryName).map((entry) => entry.ref);
}

function selectScenePromptRef(skillSpec) {
  return skillSpec?.nodeOverrides?.draft_business_output?.promptRef
    || readSelectedAssetRefs(skillSpec, "prompts")[0]
    || readAssetCatalogEntries(skillSpec, "prompts")[0]?.ref
    || null;
}

function selectSceneSchemaRef(skillSpec) {
  return skillSpec?.outputContract?.schemaRef
    || readSelectedAssetRefs(skillSpec, "schemas")[0]
    || readAssetCatalogEntries(skillSpec, "schemas")[0]?.ref
    || null;
}

function selectSceneDictionaryRef(skillSpec) {
  return readSelectedAssetRefs(skillSpec, "dictionaries")[0]
    || readAssetCatalogEntries(skillSpec, "dictionaries")[0]?.ref
    || null;
}

function selectSceneRulesRef(skillSpec) {
  return readSelectedAssetRefs(skillSpec, "rules")[0]
    || readAssetCatalogEntries(skillSpec, "rules")[0]?.ref
    || null;
}

const SCENE_EDITABLE_ASSET_TYPES = {
  prompt: {
    categoryName: "prompts",
    label: "Prompt",
    selectRef: selectScenePromptRef,
    normalizeContent(content) {
      if (typeof content !== "string") {
        throw createAppError("INVALID_REQUEST", "Prompt content must be a string.", {
          stage: "console-scene"
        });
      }

      const normalized = content.replace(/\r\n/g, "\n");
      if (!normalized.trim()) {
        throw createAppError("INVALID_REQUEST", "Prompt content cannot be empty.", {
          stage: "console-scene"
        });
      }

      return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
    }
  },
  schema: {
    categoryName: "schemas",
    label: "Schema",
    selectRef: selectSceneSchemaRef,
    normalizeContent(content) {
      if (typeof content !== "string") {
        throw createAppError("INVALID_REQUEST", "Schema content must be a string.", {
          stage: "console-scene"
        });
      }

      const normalized = content.replace(/\r\n/g, "\n").trim();
      if (!normalized) {
        throw createAppError("INVALID_REQUEST", "Schema content cannot be empty.", {
          stage: "console-scene"
        });
      }

      let parsed;
      try {
        parsed = JSON.parse(normalized);
      } catch (error) {
        throw createAppError("INVALID_REQUEST", "Schema content must be valid JSON.", {
          stage: "console-scene",
          details: {
            cause: error?.message || "json_parse_failed"
          }
        });
      }

      return `${JSON.stringify(parsed, null, 2)}\n`;
    }
  },
  dictionary: {
    categoryName: "dictionaries",
    label: "Dictionary",
    selectRef: selectSceneDictionaryRef,
    normalizeContent(content) {
      if (typeof content !== "string") {
        throw createAppError("INVALID_REQUEST", "Dictionary content must be a string.", {
          stage: "console-scene"
        });
      }

      const normalized = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").trim();
      if (!normalized) {
        throw createAppError("INVALID_REQUEST", "Dictionary content cannot be empty.", {
          stage: "console-scene"
        });
      }

      const lines = normalized.split("\n");
      const header = lines[0]
        .split("\t")
        .map((column) => column.trim());

      if (!header.includes("field_name") || !header.includes("field_description")) {
        throw createAppError(
          "INVALID_REQUEST",
          "Dictionary content must include TSV header field_name and field_description.",
          {
            stage: "console-scene",
            details: {
              header: lines[0]
            }
          }
        );
      }

      if (lines.length < 2) {
        throw createAppError("INVALID_REQUEST", "Dictionary content must include at least one data row.", {
          stage: "console-scene"
        });
      }

      for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.trim()) {
          continue;
        }

        if (!line.includes("\t")) {
          throw createAppError("INVALID_REQUEST", "Dictionary content must stay in TSV format.", {
            stage: "console-scene",
            details: {
              line: index + 1
            }
          });
        }
      }

      return `${normalized}\n`;
    }
  },
  rules: {
    categoryName: "rules",
    label: "Rules",
    selectRef: selectSceneRulesRef,
    normalizeContent(content) {
      if (typeof content !== "string") {
        throw createAppError("INVALID_REQUEST", "Rules content must be a string.", {
          stage: "console-scene"
        });
      }

      const normalized = content.replace(/\r\n/g, "\n");
      if (!normalized.trim()) {
        throw createAppError("INVALID_REQUEST", "Rules content cannot be empty.", {
          stage: "console-scene"
        });
      }

      return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
    }
  }
};

function resolveSceneAsset(scene, assetType, sceneConfig = null, platformIndex = null) {
  const assetConfig = SCENE_EDITABLE_ASSET_TYPES[assetType];
  if (!assetConfig) {
    throw createAppError("INVALID_REQUEST", `Unsupported editable asset type: ${assetType}.`, {
      stage: "console-scene"
    });
  }

  const activeSceneConfig = sceneConfig || getCachedSceneConfig(scene);
  if (isDirectModelScene(activeSceneConfig)) {
    const directModel = activeSceneConfig.directModel || {};
    const sceneReferences = Array.isArray(activeSceneConfig.references) ? activeSceneConfig.references : [];
    let assetRef = null;
    let sourceType = "local-file";
    let sourcePath = null;
    let assetKey = null;

    if (assetType === "prompt") {
      sourcePath = directModel.promptFile || null;
      const promptReference = sceneReferences.find(
        (reference) =>
          reference?.path === sourcePath
          || reference?.pathRef === directModel.promptFileRef
      );
      assetRef = promptReference?.id || directModel.promptFileRef || directModel.promptFile || null;
      assetKey = "promptFile";
    } else if (assetType === "schema") {
      const schemaReference = sceneReferences.find((reference) => reference?.id === directModel.schemaReferenceId);

      assetRef = schemaReference?.id || directModel.schemaReferenceId || null;
      sourceType = schemaReference?.type || "local-file";
      sourcePath = schemaReference?.path || null;
      assetKey = schemaReference?.id || "schemaReferenceId";
    } else {
      throw createAppError(
        "INVALID_REQUEST",
        `Direct-model scene ${scene} does not have ${assetConfig.label.toLowerCase()} configuration.`,
        {
          stage: "console-scene",
          details: {
            scene,
            assetType
          }
        }
      );
    }

    if (!assetRef || !sourcePath) {
      throw createAppError("INVALID_REQUEST", `Scene ${scene} is missing ${assetConfig.label.toLowerCase()} configuration.`, {
        stage: "console-scene",
        details: {
          scene,
          assetType
        }
      });
    }

    const resolution = resolvePathReference(sourcePath);
    const resolvedPath = resolution.resolvedPath;
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      throw createAppError("INVALID_REQUEST", `${assetConfig.label} asset file not found for scene ${scene}.`, {
        stage: "console-scene",
        details: {
          scene,
          assetRef,
          assetType,
          resolvedPath
        }
      });
    }

    return {
      scene,
      assetType,
      label: assetConfig.label,
      ref: assetRef,
      assetKey,
      sourceType,
      sourcePath,
      resolvedPath,
      editable: sourceType === "local-file" && isEditableProjectPath(resolvedPath),
      normalizeContent: assetConfig.normalizeContent
    };
  }

  const activePlatformIndex = platformIndex || getCachedPlatformIndex();
  const skillRecord = resolveSceneSkillRecord(scene, activePlatformIndex, activeSceneConfig);
  if (!skillRecord?.document?.spec) {
    throw createAppError("INVALID_REQUEST", `Scene ${scene} does not have a BusinessSkill.`, {
      stage: "console-scene"
    });
  }

  const skillSpec = skillRecord.document.spec;
  const assetRef = assetConfig.selectRef(skillSpec);

  if (!assetRef) {
    throw createAppError("INVALID_REQUEST", `Scene ${scene} is missing ${assetConfig.label.toLowerCase()} configuration.`, {
      stage: "console-scene"
    });
  }

  const assetEntry = readAssetCatalogEntries(skillSpec, assetConfig.categoryName)
    .find((entry) => entry.ref === assetRef);

  if (!assetEntry) {
    throw createAppError(
      "INVALID_REQUEST",
      `Scene ${scene} ${assetConfig.label.toLowerCase()} ref ${assetRef} is not registered in assetRefs.${assetConfig.categoryName}.`,
      {
      stage: "console-scene",
      details: {
        scene,
        assetRef,
        assetType
      }
      }
    );
  }

  const resolution = resolvePathReference(assetEntry.sourcePath);
  const resolvedPath = resolution.resolvedPath;
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw createAppError("INVALID_REQUEST", `${assetConfig.label} asset file not found for scene ${scene}.`, {
      stage: "console-scene",
      details: {
        scene,
        assetRef,
        assetType,
        resolvedPath
      }
    });
  }

  const editable = assetEntry.sourceType === "local-file" && isEditableProjectPath(resolvedPath);

  return {
    scene,
    assetType,
    label: assetConfig.label,
    ref: assetRef,
    assetKey: assetEntry.assetKey,
    sourceType: assetEntry.sourceType,
    sourcePath: assetEntry.sourcePath,
    resolvedPath,
    editable,
    normalizeContent: assetConfig.normalizeContent
  };
}

function getSceneAssetContentFormat(assetType) {
  switch (assetType) {
    case "prompt":
      return "markdown";
    case "schema":
      return "json";
    case "dictionary":
      return "tsv";
    case "rules":
      return "markdown";
    default:
      return "text";
  }
}

function parseSceneAssetDocument(assetType, contentText) {
  if (assetType !== "schema") {
    return undefined;
  }

  return JSON.parse(contentText);
}

function buildConsoleSceneAssetPayload(asset, draftAsset, overrides = {}) {
  return {
    scene: asset.scene,
    assetType: asset.assetType,
    ref: overrides.ref || draftAsset?.ref || asset.ref,
    sourceType: asset.sourceType,
    sourcePath: asset.sourcePath,
    path: asset.resolvedPath,
    editable: overrides.editable ?? asset.editable,
    storageDriver: CONSOLE_SCENE_ASSET_STORE_DRIVER,
    storageTable: CONSOLE_SCENE_ASSET_STORAGE_TABLE,
    content: overrides.content ?? draftAsset?.contentText ?? "",
    updatedAt: overrides.updatedAt || toIsoString(draftAsset?.updatedAt),
    draft: {
      status: draftAsset?.status || "draft",
      currentRevisionId: draftAsset?.currentRevisionId || null,
      updatedBy: draftAsset?.updatedBy || null
    }
  };
}

function resolvePromptAsset(scene, sceneConfig = null, platformIndex = null) {
  return resolveSceneAsset(scene, "prompt", sceneConfig, platformIndex);
}

function resolveSchemaAsset(scene, sceneConfig = null, platformIndex = null) {
  return resolveSceneAsset(scene, "schema", sceneConfig, platformIndex);
}

function resolveDictionaryAsset(scene, sceneConfig = null, platformIndex = null) {
  return resolveSceneAsset(scene, "dictionary", sceneConfig, platformIndex);
}

function resolveRulesAsset(scene, sceneConfig = null, platformIndex = null) {
  return resolveSceneAsset(scene, "rules", sceneConfig, platformIndex);
}

function resolveSceneQueryProfile(scene, sceneConfig = null, platformIndex = null) {
  const activePlatformIndex = platformIndex || getCachedPlatformIndex();
  const activeSceneConfig = sceneConfig || getCachedSceneConfig(scene);
  const skillRecord = resolveSceneSkillRecord(scene, activePlatformIndex, activeSceneConfig);
  const skillSpec = skillRecord.document.spec || {};
  const queryProfileRef = skillSpec?.dataBindings?.queryProfileRef || null;
  const queryRecord = queryProfileRef
    ? activePlatformIndex.queriesByRef.get(queryProfileRef)
    : null;

  if (!queryProfileRef || !queryRecord?.document?.spec || !queryRecord?.filePath) {
    throw createAppError("INVALID_REQUEST", `Scene ${scene} is missing query profile configuration.`, {
      stage: "console-scene",
      details: {
        scene,
        queryProfileRef
      }
    });
  }

  return {
    scene,
    queryProfileRef,
    queryRecord,
    editable: isEditableProjectPath(queryRecord.filePath)
  };
}

function resolveSceneInputMapping(scene, sceneConfig = null, platformIndex = null) {
  const activePlatformIndex = platformIndex || getCachedPlatformIndex();
  const activeSceneConfig = sceneConfig || getCachedSceneConfig(scene);
  const skillRecord = resolveSceneSkillRecord(scene, activePlatformIndex, activeSceneConfig);
  const inputMapping = isObject(skillRecord?.document?.spec?.dataBindings?.inputMapping)
    ? cloneJson(skillRecord.document.spec.dataBindings.inputMapping)
    : {};

  return {
    scene,
    skillRecord,
    inputMapping,
    editable: isEditableProjectPath(skillRecord.filePath)
  };
}

function inferDataSource(toolRef, toolRecord = null) {
  if (typeof toolRef === "string" && toolRef.includes("generic-query-runner")) {
    return {
      label: "GenericQueryRunner",
      kind: "generic-query-tool"
    };
  }

  if (typeof toolRef === "string" && toolRef.includes("directdb")) {
    return {
      label: "DirectDbRunner",
      kind: "directdb-tool"
    };
  }

  if (typeof toolRef === "string" && toolRef.includes("context-helper")) {
    return {
      label: "ContextHelper",
      kind: "helper-tool"
    };
  }

  return {
    label: toolRecord?.document?.metadata?.title || toolRef || "-",
    kind: "tool"
  };
}

function buildSkillBindingOption(record) {
  const document = record?.document || {};
  const metadata = document.metadata || {};
  const spec = document.spec || {};

  return {
    name: metadata.name || null,
    version: normalizeSkillVersion(metadata.version),
    title: metadata.title || metadata.name || null,
    status: metadata.status || null,
    scene: spec.scene || null,
    templateRef: spec?.templateRef
      ? `${spec.templateRef.name}@${spec.templateRef.version}`
      : null,
    requestKind: spec?.runtimeContract?.requestKind || null,
    outputSchemaRef: spec?.outputContract?.schemaRef || null
  };
}

function listSkillBindingOptions(platformIndex = null) {
  const activePlatformIndex = platformIndex || getCachedPlatformIndex();

  return activePlatformIndex.resources.skills
    .map((record) => buildSkillBindingOption(record))
    .sort((left, right) => {
      const leftLabel = `${left.title || ""}${left.name || ""}`;
      const rightLabel = `${right.title || ""}${right.name || ""}`;
      return leftLabel.localeCompare(rightLabel, "zh-CN");
    });
}

function validateSceneSkillCompatibility(scene, sceneConfig, skillRecord, platformIndex = null) {
  const activePlatformIndex = platformIndex || getCachedPlatformIndex();
  const skillDocument = skillRecord?.document || {};
  const skillSpec = skillDocument.spec || {};
  const templateRef = skillSpec.templateRef || {};
  const templateKey = `${templateRef.name || ""}@${templateRef.version || ""}`;
  const templateRecord = activePlatformIndex.templatesByKey.get(templateKey);
  const compatibleScenes = templateRecord?.document?.spec?.compatibleScenes || [];

  if (Array.isArray(compatibleScenes) && compatibleScenes.length > 0 && !compatibleScenes.includes(scene)) {
    throw createAppError("INVALID_REQUEST", `业务技能 ${skillDocument?.metadata?.name || "missing"} 不支持场景 ${scene}。`, {
      stage: "console-scene-save",
      details: {
        scene,
        skill: buildSkillBindingOption(skillRecord),
        compatibleScenes
      }
    });
  }

  const toolBindings = isObject(skillSpec.toolBindings) ? skillSpec.toolBindings : {};
  for (const [role, binding] of Object.entries(toolBindings)) {
    const toolRef = binding?.toolRef || null;
    const toolRecord = toolRef ? activePlatformIndex.toolsByRef.get(toolRef) : null;
    const allowedScenes = toolRecord?.document?.spec?.policy?.allowedScenes;
    if (Array.isArray(allowedScenes) && allowedScenes.length > 0 && !allowedScenes.includes(scene)) {
      throw createAppError("INVALID_REQUEST", `业务技能工具绑定 ${role} 不允许在场景 ${scene} 中运行。`, {
        stage: "console-scene-save",
        details: {
          scene,
          role,
          toolRef,
          allowedScenes
        }
      });
    }
  }

  const requiredBizParams = Object.entries(skillSpec?.inputContract?.bizParams || {})
    .filter(([, fieldSpec]) => !isObject(fieldSpec) || fieldSpec.required !== false)
    .map(([fieldName]) => fieldName);
  const availableBizParams = isObject(sceneConfig?.request?.bizParams)
    ? Object.keys(sceneConfig.request.bizParams)
    : [];
  const missingBizParams = requiredBizParams.filter((fieldName) => !availableBizParams.includes(fieldName));

  if (missingBizParams.length > 0) {
    throw createAppError("INVALID_REQUEST", `当前场景缺少业务技能所需入参：${missingBizParams.join(", ")}。`, {
      stage: "console-scene-save",
      details: {
        scene,
        skill: buildSkillBindingOption(skillRecord),
        missingBizParams
      }
    });
  }
}

function buildPlatformManagedWorkflow(scene, sceneConfig, platformIndex) {
  const selectedSkill = resolveSceneSkillSelection(sceneConfig);
  const graph = compileWorkflowGraphForScene({
    scene,
    baseDir: PLATFORM_BASE_DIR,
    resources: platformIndex.resources,
    skillRef: selectedSkill
  });
  const skillRecord = resolveSceneSkillRecord(scene, platformIndex, sceneConfig);
  const skillDocument = skillRecord?.document || {};
  const skillSpec = skillDocument.spec || {};
  const templateKey = `${graph?.template?.name || ""}@${graph?.template?.version || ""}`;
  const templateRecord = platformIndex.templatesByKey.get(templateKey);
  const templateDocument = templateRecord?.document || {};
  const queryProfileRef = skillSpec?.dataBindings?.queryProfileRef || null;
  const contextToolRef = skillSpec?.toolBindings?.context_fetcher?.toolRef
    || platformIndex.queriesByRef.get(queryProfileRef)?.document?.spec?.toolRef
    || null;
  const contextToolRecord = contextToolRef ? platformIndex.toolsByRef.get(contextToolRef) : null;
  const queryRecord = queryProfileRef ? platformIndex.queriesByRef.get(queryProfileRef) : null;
  const dataSource = inferDataSource(contextToolRef, contextToolRecord);
  const promptAsset = resolvePromptAsset(scene, sceneConfig, platformIndex);
  const schemaAsset = resolveSchemaAsset(scene, sceneConfig, platformIndex);
  const dictionaryAsset = resolveDictionaryAsset(scene, sceneConfig, platformIndex);
  const rulesAsset = resolveRulesAsset(scene, sceneConfig, platformIndex);

  return {
    scene,
    title: sceneConfig.title || skillDocument?.metadata?.title || scene,
    description: sceneConfig.description || "",
    executionMode: getExecutionMode(sceneConfig),
    routingMode: getRoutingMode(sceneConfig),
    allowedModes: getAllowedModes(sceneConfig),
    platformManagedScene: true,
    template: {
      ...cloneJson(graph.template || null),
      constraints: cloneJson(templateDocument?.spec?.constraints || null)
    },
    skill: {
      name: skillDocument?.metadata?.name || null,
      version: skillDocument?.metadata?.version || null,
      title: skillDocument?.metadata?.title || null,
      status: skillDocument?.metadata?.status || null,
      scene: skillSpec?.scene || null,
      templateRef: skillSpec?.templateRef
        ? `${skillSpec.templateRef.name}@${skillSpec.templateRef.version}`
        : null,
      outputSchemaRef: skillSpec?.outputContract?.schemaRef || null
    },
    runtimeContract: cloneJson(skillSpec?.runtimeContract || sceneConfig.runtime || null),
    inputContract: {
      requiredBizParams: Object.keys(skillSpec?.inputContract?.bizParams || {}),
      inputMapping: cloneJson(skillSpec?.dataBindings?.inputMapping || {})
    },
    outputContract: cloneJson(skillSpec?.outputContract || null),
    dataSourceLabel: dataSource.label,
    dataSourceKind: dataSource.kind,
    entryNode: graph.entryNode,
    exitNode: graph.exitNode,
    orderedNodeIds: cloneJson(graph.orderedNodeIds || []),
    nodesById: cloneJson(graph.nodesById || {}),
    defaultNextByNodeId: cloneJson(graph.defaultNextByNodeId || {}),
    toolBindings: cloneJson(skillSpec?.toolBindings || {}),
    queryProfileRef,
    conditionalEdges: cloneJson(graph.conditionalEdges || []),
    nodeOverrides: cloneJson(skillSpec?.nodeOverrides || {}),
    nodeOrderOverrides: cloneJson(skillSpec?.nodeOrderOverrides || {}),
    assets: {
      prompts: readSelectedAssetRefs(skillSpec, "prompts"),
      schemas: readSelectedAssetRefs(skillSpec, "schemas"),
      dictionaries: readSelectedAssetRefs(skillSpec, "dictionaries"),
      rules: readSelectedAssetRefs(skillSpec, "rules")
    },
    editableAssets: {
      prompt: {
        ref: promptAsset.ref,
        sourceType: promptAsset.sourceType,
        sourcePath: promptAsset.sourcePath,
        path: promptAsset.resolvedPath,
        editable: promptAsset.editable,
        storageDriver: CONSOLE_SCENE_ASSET_STORE_DRIVER,
        storageTable: CONSOLE_SCENE_ASSET_STORAGE_TABLE
      },
      schema: {
        ref: schemaAsset.ref,
        sourceType: schemaAsset.sourceType,
        sourcePath: schemaAsset.sourcePath,
        path: schemaAsset.resolvedPath,
        editable: schemaAsset.editable,
        storageDriver: CONSOLE_SCENE_ASSET_STORE_DRIVER,
        storageTable: CONSOLE_SCENE_ASSET_STORAGE_TABLE
      },
      dictionary: {
        ref: dictionaryAsset.ref,
        sourceType: dictionaryAsset.sourceType,
        sourcePath: dictionaryAsset.sourcePath,
        path: dictionaryAsset.resolvedPath,
        editable: dictionaryAsset.editable,
        storageDriver: CONSOLE_SCENE_ASSET_STORE_DRIVER,
        storageTable: CONSOLE_SCENE_ASSET_STORAGE_TABLE
      },
      rules: {
        ref: rulesAsset.ref,
        sourceType: rulesAsset.sourceType,
        sourcePath: rulesAsset.sourcePath,
        path: rulesAsset.resolvedPath,
        editable: rulesAsset.editable,
        storageDriver: CONSOLE_SCENE_ASSET_STORE_DRIVER,
        storageTable: CONSOLE_SCENE_ASSET_STORAGE_TABLE
      }
    },
    editableBindings: {
      queryProfile: {
        ref: queryProfileRef,
        path: queryRecord?.filePath || null,
        editable: Boolean(queryRecord?.filePath) && isEditableProjectPath(queryRecord.filePath)
      },
      inputMapping: {
        path: skillRecord?.filePath || null,
        editable: Boolean(skillRecord?.filePath) && isEditableProjectPath(skillRecord.filePath)
      }
    },
    legacyOrchestration: cloneJson(sceneConfig.orchestration || [])
  };
}

function buildDirectModelWorkflow(scene, sceneConfig) {
  const directModel = sceneConfig.directModel || {};
  const schemaRef = sceneConfig.references?.find(
    (reference) => reference.id === directModel.schemaReferenceId
  );
  const promptAsset = resolveSceneAsset(scene, "prompt", sceneConfig);
  const schemaAsset = resolveSceneAsset(scene, "schema", sceneConfig);

  return {
    scene,
    title: sceneConfig.title || scene,
    description: sceneConfig.description || "",
    executionMode: getExecutionMode(sceneConfig),
    routingMode: getRoutingMode(sceneConfig),
    allowedModes: getAllowedModes(sceneConfig),
    platformManagedScene: false,
    dataSourceLabel: "Direct Model",
    dataSourceKind: "direct-model",
    directModel: {
      provider: directModel.provider || null,
      model: directModel.model || null,
      promptRef: directModel.promptFileRef || directModel.promptFile || null,
      schemaRef: schemaRef?.id || directModel.schemaReferenceId || null
    },
    editableAssets: {
      prompt: {
        ref: promptAsset.ref,
        sourceType: promptAsset.sourceType,
        sourcePath: promptAsset.sourcePath,
        path: promptAsset.resolvedPath,
        editable: promptAsset.editable,
        storageDriver: CONSOLE_SCENE_ASSET_STORE_DRIVER,
        storageTable: CONSOLE_SCENE_ASSET_STORAGE_TABLE
      },
      schema: {
        ref: schemaAsset.ref,
        sourceType: schemaAsset.sourceType,
        sourcePath: schemaAsset.sourcePath,
        path: schemaAsset.resolvedPath,
        editable: schemaAsset.editable,
        storageDriver: CONSOLE_SCENE_ASSET_STORE_DRIVER,
        storageTable: CONSOLE_SCENE_ASSET_STORAGE_TABLE
      }
    },
    references: cloneJson(
      (sceneConfig.references || []).map((reference) => ({
        type: reference.type || "local-file",
        ref: reference.id || null,
        purpose: reference.purpose || ""
      }))
    ),
    legacyOrchestration: cloneJson(sceneConfig.orchestration || []),
    legacyOnlyReason: "该场景使用 direct-model 独立执行边界，由直连模型链路处理，不进入模板化 LangGraph 节点编排。"
  };
}

async function buildSceneWorkflow(scene, sceneConfigRecord = null, platformIndex = null) {
  const draftSceneConfigRecord = sceneConfigRecord || await getDraftSceneConfigRecord(scene);
  const draftSceneConfig = cloneJson(draftSceneConfigRecord.document || {});
  const activePlatformIndex = platformIndex || await loadDraftPlatformIndex();
  const publishedSceneConfig = getPublishedSceneConfigSnapshot(scene);
  const configState = buildSceneConfigState(
    scene,
    draftSceneConfigRecord,
    publishedSceneConfig,
    activePlatformIndex
  );

  const workflow = isDirectModelScene(draftSceneConfig)
    ? buildDirectModelWorkflow(scene, draftSceneConfig)
    : buildPlatformManagedWorkflow(scene, draftSceneConfig, activePlatformIndex);

  return {
    ...workflow,
    configState
  };
}

async function getConsoleSceneWorkflow(scene) {
  return buildSceneWorkflow(scene);
}

async function getConsoleSceneSkillBinding(scene) {
  const draftSceneConfigRecord = await getDraftSceneConfigRecord(scene);
  const sceneConfig = cloneJson(draftSceneConfigRecord.document || {});
  if (isDirectModelScene(sceneConfig)) {
    throw createAppError("INVALID_REQUEST", `Scene ${scene} is not a platform-managed BusinessSkill scene.`, {
      stage: "console-scene"
    });
  }

  const platformIndex = await loadDraftPlatformIndex();
  const currentSkillRecord = resolveSceneSkillRecord(scene, platformIndex, sceneConfig);
  const publishedSceneConfig = getPublishedSceneConfigSnapshot(scene);
  const configState = buildSceneConfigState(
    scene,
    draftSceneConfigRecord,
    publishedSceneConfig,
    platformIndex
  );

  return {
    scene,
    path: buildSceneConfigStoragePath(scene),
    publishedPath: publishedSceneConfig.path,
    editable: true,
    storageDriver: CONSOLE_SCENE_CONFIG_STORE_DRIVER,
    storageTable: CONSOLE_SCENE_CONFIG_STORAGE_TABLE,
    storagePath: buildSceneConfigStoragePath(scene),
    current: buildSkillBindingOption(currentSkillRecord),
    publishedCurrent: configState.publishedCurrent,
    hasUnpublishedChanges: configState.hasUnpublishedChanges,
    draft: cloneJson(configState.draft),
    published: cloneJson(configState.published),
    options: listSkillBindingOptions(platformIndex),
    updatedAt: configState.draft.updatedAt
  };
}

function normalizeSceneSkillBindingPayload(body = {}) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    throw createAppError("INVALID_REQUEST", "Skill binding save requires name.", {
      stage: "console-scene-save"
    });
  }

  return {
    name,
    version: normalizeSkillVersion(body?.version)
  };
}

async function updateConsoleSceneSkillBinding(scene, body = {}) {
  const draftSceneConfigRecord = await getDraftSceneConfigRecord(scene);
  const currentSceneConfig = cloneJson(draftSceneConfigRecord.document || {});
  if (isDirectModelScene(currentSceneConfig)) {
    throw createAppError("INVALID_REQUEST", `Scene ${scene} is not a platform-managed BusinessSkill scene.`, {
      stage: "console-scene-save"
    });
  }

  const nextSkillSelection = normalizeSceneSkillBindingPayload(body);
  const platformIndex = await loadDraftPlatformIndex();
  const targetSkillRecord = resolveSkillRecordBySelection(nextSkillSelection, platformIndex);
  if (!targetSkillRecord?.document?.spec) {
    throw createAppError(
      "INVALID_REQUEST",
      `BusinessSkill ${buildSkillKey(nextSkillSelection.name, nextSkillSelection.version)} does not exist.`,
      {
        stage: "console-scene-save",
        details: {
          scene,
          skill: nextSkillSelection
        }
      }
    );
  }

  validateSceneSkillCompatibility(scene, currentSceneConfig, targetSkillRecord, platformIndex);
  const skillDocument = targetSkillRecord.document || {};
  const skillSpec = skillDocument.spec || {};
  const nextDocument = cloneJson(currentSceneConfig);
  const nextSkillConfig = isObject(nextDocument.skill) ? nextDocument.skill : {};

  nextSkillConfig.id = skillDocument?.metadata?.name || nextSkillSelection.name;
  nextSkillConfig.version = normalizeSkillVersion(skillDocument?.metadata?.version || nextSkillSelection.version);
  nextSkillConfig.type = nextSkillConfig.type || "main-skill";
  if (!nextSkillConfig.workspacePath || isRuntimeSkillAssetRef(nextSkillConfig.workspacePath)) {
    nextSkillConfig.workspacePath = buildProjectSkillWorkspaceRef(nextSkillConfig.id);
  }
  if (!nextSkillConfig.entryFile || isRuntimeSkillAssetRef(nextSkillConfig.entryFile)) {
    nextSkillConfig.entryFile = buildProjectSkillEntryFileRef(nextSkillConfig.id);
  }
  nextSkillConfig.responsibility = nextSkillConfig.responsibility
    || currentSceneConfig?.skill?.responsibility
    || "提供项目内业务契约；业务编排由 platform BusinessSkill 与项目内 LangGraph 执行。";
  nextDocument.skill = nextSkillConfig;

  if (isObject(skillSpec.runtimeContract)) {
    nextDocument.runtime = cloneJson(skillSpec.runtimeContract);
  }

  const nextContent = `${JSON.stringify(nextDocument, null, 2)}\n`;

  const validationSummary = validatePlatformConfigs({
    baseDir: PLATFORM_BASE_DIR,
    resources: platformIndex.resources
  });
  if (!validationSummary.valid) {
    buildValidationFailure(
      scene,
      buildSkillKey(nextSkillSelection.name, nextSkillSelection.version),
      validationSummary,
      "Scene skill binding"
    );
  }

  const compileSummary = compileWorkflowGraphForScene({
    scene,
    baseDir: PLATFORM_BASE_DIR,
    resources: platformIndex.resources,
    skillRef: nextSkillSelection
  });

  await withConsoleSceneDraftStore((store) => {
    if (String(draftSceneConfigRecord.sourceText || "") === nextContent) {
      return draftSceneConfigRecord;
    }

    return store.saveSceneConfigDraft(
      {
        scene,
        title: nextDocument.title || currentSceneConfig.title || scene,
        enabled: nextDocument.enabled === true,
        executionMode: nextDocument.execution?.mode || currentSceneConfig.execution?.mode || "agent-runtime",
        status: nextDocument.status || draftSceneConfigRecord.status || "draft",
        document: nextDocument,
        sourceText: nextContent,
        updatedBy: CONSOLE_SCENE_CONFIG_UPDATED_BY
      },
      {
        operator: CONSOLE_SCENE_CONFIG_UPDATED_BY,
        changeNote: `console scene draft update for ${scene}:skill-binding`
      }
    );
  });

  const savedBinding = await getConsoleSceneSkillBinding(scene);

  return {
    ...savedBinding,
    validation: {
      valid: true,
      issueCount: validationSummary.issueCount
    },
    compilePreview: {
      template: cloneJson(compileSummary.template || null),
      orderedNodeCount: Array.isArray(compileSummary.orderedNodeIds)
        ? compileSummary.orderedNodeIds.length
        : 0
    }
  };
}

async function getConsoleSceneCatalog() {
  const draftSceneConfigRecords = await listDraftSceneConfigRecords();
  const platformIndex = await loadDraftPlatformIndex();
  const items = [];

  for (const draftRecord of draftSceneConfigRecords.sort((left, right) => left.scene.localeCompare(right.scene))) {
    const workflow = await buildSceneWorkflow(draftRecord.scene, draftRecord, platformIndex);
    items.push({
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
      publishedSkillRef: workflow.configState?.published?.skillRef || null,
      dataSourceLabel: workflow.dataSourceLabel,
      configState: cloneJson(workflow.configState || null)
    });
  }

  return {
    items
  };
}

async function getConsoleSceneAssetContent(scene, assetType) {
  const asset = resolveSceneAsset(scene, assetType);
  const draftAsset = await withConsoleSceneAssetStore((store) => store.getSceneAsset(scene, assetType));

  if (!draftAsset) {
    throw createAppError(
      "INVALID_REQUEST",
      `Scene ${scene} is missing ${asset.label.toLowerCase()} draft in config-store.`,
      {
        stage: "console-scene",
        details: {
          scene,
          assetType,
          assetRef: asset.ref,
          storageTable: CONSOLE_SCENE_ASSET_STORAGE_TABLE
        }
      }
    );
  }

  return buildConsoleSceneAssetPayload(asset, draftAsset);
}

async function getConsoleScenePromptAssetContent(scene) {
  return getConsoleSceneAssetContent(scene, "prompt");
}

async function getConsoleSceneSchemaAssetContent(scene) {
  return getConsoleSceneAssetContent(scene, "schema");
}

async function getConsoleSceneDictionaryAssetContent(scene) {
  return getConsoleSceneAssetContent(scene, "dictionary");
}

async function getConsoleSceneRulesAssetContent(scene) {
  return getConsoleSceneAssetContent(scene, "rules");
}

async function getConsoleSceneQueryProfileContent(scene) {
  const { queryProfileRef, queryRecord, editable } = resolveSceneQueryProfile(scene);
  const content = await fsp.readFile(queryRecord.filePath, "utf8");
  const stat = await fsp.stat(queryRecord.filePath);

  return {
    scene,
    configType: "queryProfile",
    ref: queryProfileRef,
    path: queryRecord.filePath,
    editable,
    content,
    updatedAt: stat.mtime.toISOString()
  };
}

async function getConsoleSceneInputMappingContent(scene) {
  const { skillRecord, inputMapping, editable } = resolveSceneInputMapping(scene);
  const stat = await fsp.stat(skillRecord.filePath);

  return {
    scene,
    configType: "inputMapping",
    path: skillRecord.filePath,
    editable,
    content: `${JSON.stringify(inputMapping, null, 2)}\n`,
    value: inputMapping,
    updatedAt: stat.mtime.toISOString()
  };
}

function normalizeQueryProfileContent(content, currentDocument) {
  if (typeof content !== "string") {
    throw createAppError("INVALID_REQUEST", "Query profile content must be a string.", {
      stage: "console-scene"
    });
  }

  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw createAppError("INVALID_REQUEST", "Query profile content cannot be empty.", {
      stage: "console-scene"
    });
  }

  const nextDocument = parseYamlContent(normalized, "Query profile content");
  if (nextDocument?.kind !== "QueryProfile") {
    throw createAppError("INVALID_REQUEST", "Query profile content must keep kind=QueryProfile.", {
      stage: "console-scene"
    });
  }

  const guardedFields = [
    ["metadata.name", nextDocument?.metadata?.name, currentDocument?.metadata?.name],
    ["metadata.version", nextDocument?.metadata?.version, currentDocument?.metadata?.version],
    ["spec.ref", nextDocument?.spec?.ref, currentDocument?.spec?.ref],
    ["spec.toolRef", nextDocument?.spec?.toolRef, currentDocument?.spec?.toolRef],
    ["spec.toolRole", nextDocument?.spec?.toolRole, currentDocument?.spec?.toolRole]
  ];

  for (const [field, nextValue, currentValue] of guardedFields) {
    if (nextValue !== currentValue) {
      throw createAppError("INVALID_REQUEST", `Query profile save cannot change ${field}.`, {
        stage: "console-scene",
        details: {
          field,
          currentValue,
          nextValue
        }
      });
    }
  }

  const nextGenerationConstraints = JSON.stringify(nextDocument?.spec?.generationConstraints || null);
  const currentGenerationConstraints = JSON.stringify(currentDocument?.spec?.generationConstraints || null);
  if (nextGenerationConstraints !== currentGenerationConstraints) {
    throw createAppError("INVALID_REQUEST", "Query profile save cannot change spec.generationConstraints.", {
      stage: "console-scene"
    });
  }

  return {
    content: `${normalized}\n`,
    document: nextDocument
  };
}

function normalizeInputMappingContent(content, requiredInputs = []) {
  if (typeof content !== "string") {
    throw createAppError("INVALID_REQUEST", "Input mapping content must be a string.", {
      stage: "console-scene"
    });
  }

  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    throw createAppError("INVALID_REQUEST", "Input mapping content cannot be empty.", {
      stage: "console-scene"
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    throw createAppError("INVALID_REQUEST", "Input mapping content must be valid JSON.", {
      stage: "console-scene",
      details: {
        cause: error?.message || "json_parse_failed"
      }
    });
  }

  if (!isObject(parsed)) {
    throw createAppError("INVALID_REQUEST", "Input mapping content must be a JSON object.", {
      stage: "console-scene"
    });
  }

  for (const [fieldName, pathExpression] of Object.entries(parsed)) {
    if (typeof pathExpression !== "string" || !pathExpression.trim()) {
      throw createAppError("INVALID_REQUEST", `Input mapping ${fieldName} must map to a non-empty path string.`, {
        stage: "console-scene"
      });
    }
  }

  const missingInputs = requiredInputs.filter((fieldName) => !Object.prototype.hasOwnProperty.call(parsed, fieldName));
  if (missingInputs.length > 0) {
    throw createAppError("INVALID_REQUEST", `Input mapping is missing required query inputs: ${missingInputs.join(", ")}.`, {
      stage: "console-scene",
      details: {
        missingInputs
      }
    });
  }

  return {
    content: `${JSON.stringify(parsed, null, 2)}\n`,
    value: parsed
  };
}

function buildValidationFailure(scene, assetRef, validationSummary, assetLabel) {
  throw createAppError("INVALID_REQUEST", `${assetLabel} save failed because platform validation did not pass.`, {
    stage: "console-scene-save",
    details: {
      scene,
      assetRef,
      issueCount: validationSummary.issueCount,
      issues: validationSummary.issues.slice(0, 20)
    }
  });
}

function withRollbackDetails(error, rollbackError = null) {
  const normalized = normalizeError(error);
  const rollbackMessage = rollbackError
    ? "原文件回滚失败。"
    : "原文件已回滚。";

  return createAppError(normalized.code, `${normalized.message} ${rollbackMessage}`, {
    httpStatus: normalized.httpStatus,
    stage: normalized.stage,
    retryable: normalized.retryable,
    details: {
      ...(normalized.details || {}),
      rollback: {
        restored: !rollbackError,
        error: rollbackError ? rollbackError.message : null
      }
    }
  });
}

async function updateConsoleSceneAssetContent(scene, assetType, content) {
  const asset = resolveSceneAsset(scene, assetType);
  const sceneConfig = getCachedSceneConfig(scene);
  const selectedSkill = resolveSceneSkillSelection(sceneConfig);
  const directModelScene = isDirectModelScene(sceneConfig);
  if (!asset.editable) {
    throw createAppError("INVALID_REQUEST", `${asset.label} asset for scene ${scene} is not editable through the platform.`, {
      stage: "console-scene-save",
      details: {
        scene,
        assetRef: asset.ref,
        assetType,
        sourceType: asset.sourceType
      }
    });
  }

  const nextContent = asset.normalizeContent(content);
  const validationSummary = validatePlatformConfigs({
    baseDir: PLATFORM_BASE_DIR
  });
  if (!validationSummary.valid) {
    buildValidationFailure(scene, asset.ref, validationSummary, asset.label);
  }

  const compileSummary = directModelScene
    ? null
    : compileWorkflowGraphForScene({
        scene,
        baseDir: PLATFORM_BASE_DIR,
        skillRef: selectedSkill
      });

  try {
    const savedAsset = await withConsoleSceneAssetStore(async (store) => {
      const existing = await store.getSceneAsset(scene, assetType);
      if (existing && existing.contentText === nextContent && existing.ref === asset.ref) {
        return existing;
      }

      return store.saveSceneAssetDraft(
        {
          scene,
          assetType,
          ref: asset.ref,
          contentText: nextContent,
          contentFormat: getSceneAssetContentFormat(assetType),
          document: parseSceneAssetDocument(assetType, nextContent),
          updatedBy: CONSOLE_SCENE_ASSET_UPDATED_BY
        },
        {
          operator: CONSOLE_SCENE_ASSET_UPDATED_BY,
          changeNote: `console asset draft update for ${scene}:${assetType}`
        }
      );
    });

    return {
      ...buildConsoleSceneAssetPayload(asset, savedAsset, {
        content: nextContent,
        editable: true
      }),
      validation: {
        valid: true,
        issueCount: validationSummary.issueCount
      },
      compilePreview: compileSummary
        ? {
            template: cloneJson(compileSummary.template || null),
            orderedNodeCount: Array.isArray(compileSummary.orderedNodeIds)
              ? compileSummary.orderedNodeIds.length
              : 0
          }
        : null
    };
  } catch (error) {
    throw normalizeError(error, "INVALID_REQUEST");
  }
}

async function updateConsoleScenePromptAssetContent(scene, content) {
  return updateConsoleSceneAssetContent(scene, "prompt", content);
}

async function updateConsoleSceneSchemaAssetContent(scene, content) {
  return updateConsoleSceneAssetContent(scene, "schema", content);
}

async function updateConsoleSceneDictionaryAssetContent(scene, content) {
  return updateConsoleSceneAssetContent(scene, "dictionary", content);
}

async function updateConsoleSceneRulesAssetContent(scene, content) {
  return updateConsoleSceneAssetContent(scene, "rules", content);
}

async function updateConsoleSceneQueryProfileContent(scene, content) {
  const { queryProfileRef, queryRecord, editable } = resolveSceneQueryProfile(scene);
  const sceneConfig = getCachedSceneConfig(scene);
  const selectedSkill = resolveSceneSkillSelection(sceneConfig);
  if (!editable) {
    throw createAppError("INVALID_REQUEST", `Query profile for scene ${scene} is not editable through the platform.`, {
      stage: "console-scene-save",
      details: {
        scene,
        queryProfileRef,
        path: queryRecord.filePath
      }
    });
  }

  const previousContent = await fsp.readFile(queryRecord.filePath, "utf8");
  const { content: nextContent } = normalizeQueryProfileContent(content, queryRecord.document);

  try {
    await fsp.writeFile(queryRecord.filePath, nextContent, "utf8");

    const validationSummary = validatePlatformConfigs({
      baseDir: PLATFORM_BASE_DIR
    });
    if (!validationSummary.valid) {
      buildValidationFailure(scene, queryProfileRef, validationSummary, "Query profile");
    }

    const compileSummary = compileWorkflowGraphForScene({
      scene,
      baseDir: PLATFORM_BASE_DIR,
      skillRef: selectedSkill
    });

    return {
      scene,
      configType: "queryProfile",
      ref: queryProfileRef,
      path: queryRecord.filePath,
      editable: true,
      content: nextContent,
      updatedAt: new Date().toISOString(),
      validation: {
        valid: true,
        issueCount: validationSummary.issueCount
      },
      compilePreview: {
        template: cloneJson(compileSummary.template || null),
        orderedNodeCount: Array.isArray(compileSummary.orderedNodeIds)
          ? compileSummary.orderedNodeIds.length
          : 0
      }
    };
  } catch (error) {
    let rollbackError = null;
    try {
      await fsp.writeFile(queryRecord.filePath, previousContent, "utf8");
    } catch (caughtRollbackError) {
      rollbackError = caughtRollbackError;
    }

    throw withRollbackDetails(error, rollbackError);
  }
}

async function updateConsoleSceneInputMappingContent(scene, content) {
  const { skillRecord, editable } = resolveSceneInputMapping(scene);
  const sceneConfig = getCachedSceneConfig(scene);
  const selectedSkill = resolveSceneSkillSelection(sceneConfig);
  if (!editable) {
    throw createAppError("INVALID_REQUEST", `Input mapping for scene ${scene} is not editable through the platform.`, {
      stage: "console-scene-save",
      details: {
        scene,
        path: skillRecord.filePath
      }
    });
  }

  const currentSkillDocument = cloneJson(skillRecord.document);
  const currentQueryProfileRef = currentSkillDocument?.spec?.dataBindings?.queryProfileRef || null;
  const currentQueryRecord = currentQueryProfileRef
    ? getCachedPlatformIndex().queriesByRef.get(currentQueryProfileRef)
    : null;
  const requiredInputs = Array.isArray(currentQueryRecord?.document?.spec?.inputContract?.requiredInputs)
    ? currentQueryRecord.document.spec.inputContract.requiredInputs
    : Object.keys(currentQueryRecord?.document?.spec?.inputContract?.fields || {});
  const { content: nextContent, value: nextValue } = normalizeInputMappingContent(content, requiredInputs);
  const previousContent = await fsp.readFile(skillRecord.filePath, "utf8");

  if (!isObject(currentSkillDocument.spec)) {
    throw createAppError("INVALID_REQUEST", `BusinessSkill for scene ${scene} is missing spec.`, {
      stage: "console-scene-save"
    });
  }

  currentSkillDocument.spec.dataBindings = isObject(currentSkillDocument.spec.dataBindings)
    ? currentSkillDocument.spec.dataBindings
    : {};
  currentSkillDocument.spec.dataBindings.inputMapping = nextValue;

  const nextSkillFileContent = dumpYamlDocument(currentSkillDocument);

  try {
    await fsp.writeFile(skillRecord.filePath, nextSkillFileContent, "utf8");

    const validationSummary = validatePlatformConfigs({
      baseDir: PLATFORM_BASE_DIR
    });
    if (!validationSummary.valid) {
      buildValidationFailure(scene, currentQueryProfileRef || "inputMapping", validationSummary, "Input mapping");
    }

    const compileSummary = compileWorkflowGraphForScene({
      scene,
      baseDir: PLATFORM_BASE_DIR,
      skillRef: selectedSkill
    });

    return {
      scene,
      configType: "inputMapping",
      path: skillRecord.filePath,
      editable: true,
      content: nextContent,
      value: nextValue,
      updatedAt: new Date().toISOString(),
      validation: {
        valid: true,
        issueCount: validationSummary.issueCount
      },
      compilePreview: {
        template: cloneJson(compileSummary.template || null),
        orderedNodeCount: Array.isArray(compileSummary.orderedNodeIds)
          ? compileSummary.orderedNodeIds.length
          : 0
      }
    };
  } catch (error) {
    let rollbackError = null;
    try {
      await fsp.writeFile(skillRecord.filePath, previousContent, "utf8");
    } catch (caughtRollbackError) {
      rollbackError = caughtRollbackError;
    }

    throw withRollbackDetails(error, rollbackError);
  }
}

module.exports = {
  getConsoleSceneCatalog,
  getConsoleSceneDictionaryAssetContent,
  getConsoleSceneInputMappingContent,
  getConsoleScenePromptAssetContent,
  getConsoleSceneQueryProfileContent,
  getConsoleSceneRulesAssetContent,
  getConsoleSceneSchemaAssetContent,
  getConsoleSceneSkillBinding,
  getConsoleSceneWorkflow,
  updateConsoleSceneDictionaryAssetContent,
  updateConsoleSceneInputMappingContent,
  updateConsoleScenePromptAssetContent,
  updateConsoleSceneQueryProfileContent,
  updateConsoleSceneRulesAssetContent,
  updateConsoleSceneSchemaAssetContent,
  updateConsoleSceneSkillBinding
};
