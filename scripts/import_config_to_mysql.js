require("../utils/load-env").loadProjectEnv();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { createConfigStore } = require("../services/config-store");
const { loadPlatformResources } = require("../platform/compiler/validate");
const { PROJECT_ROOT, resolvePathReference } = require("../utils/path-resolver");

const IMPORT_OPERATOR = "codex-t1-03";
const IMPORT_STATUS = "draft";
const HELPER_SCRIPT_TYPE = "generated-query";
const HELPER_QUERY_DIR = path.join(PROJECT_ROOT, "ContextHelper", "generated-queries");
const HELPER_QUERY_SUFFIX = ".generated.js";
const PLATFORM_BASE_DIR = path.join(PROJECT_ROOT, "platform");
const REPOSITORY_SCENE_CONFIG_DIR = path.join(PROJECT_ROOT, "scene-configs");
const ASSET_GROUPS = [
  {
    groupName: "prompts",
    assetType: "prompt",
    refField: "promptRef"
  },
  {
    groupName: "schemas",
    assetType: "schema",
    refField: "schemaRef"
  },
  {
    groupName: "dictionaries",
    assetType: "dictionary",
    refField: "dictionaryRef"
  },
  {
    groupName: "rules",
    assetType: "rules",
    refField: "rulesRef"
  }
];

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function toRelativePath(filePath) {
  return normalizePath(path.relative(PROJECT_ROOT, filePath) || path.basename(filePath));
}

function sortRecords(records, selector) {
  return [...records].sort((left, right) => selector(left).localeCompare(selector(right)));
}

function mapPlatformKind(documentKind) {
  switch (documentKind) {
    case "WorkflowTemplate":
      return "template";
    case "BusinessSkill":
      return "skill";
    case "ToolDefinition":
      return "tool";
    case "QueryProfile":
      return "query";
    default:
      throw new Error(`Unsupported platform resource kind: ${documentKind || "unknown"}.`);
  }
}

function inferContentFormat(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".json":
      return "json";
    case ".md":
      return "markdown";
    case ".tsv":
      return "tsv";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".js":
      return "javascript";
    default:
      return "text";
  }
}

function tryParseJsonDocument(filePath, sourceText) {
  if (path.extname(filePath).toLowerCase() !== ".json") {
    return null;
  }

  return JSON.parse(sourceText);
}

function readReferencedFile(sourcePath, declaredByPath, label) {
  const resolution = resolvePathReference(sourcePath);
  const resolvedPath = resolution.resolvedPath;

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`${label} declared by ${toRelativePath(declaredByPath)} points to a missing file: ${sourcePath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`${label} declared by ${toRelativePath(declaredByPath)} must point to a file: ${sourcePath}`);
  }

  const contentText = fs.readFileSync(resolvedPath, "utf8");

  return {
    sourcePath,
    filePath: resolvedPath,
    contentText,
    contentFormat: inferContentFormat(resolvedPath),
    document: tryParseJsonDocument(resolvedPath, contentText),
    checksum: hashText(contentText)
  };
}

function buildSceneAssetRecord({ scene, assetType, ref, sourcePath, declaredByPath }) {
  const fileRecord = readReferencedFile(sourcePath, declaredByPath, `${scene}:${assetType}`);

  return {
    scene,
    assetType,
    ref: ref || null,
    contentText: fileRecord.contentText,
    contentFormat: fileRecord.contentFormat,
    document: fileRecord.document,
    status: IMPORT_STATUS,
    updatedBy: IMPORT_OPERATOR,
    checksum: fileRecord.checksum,
    filePath: fileRecord.filePath,
    sourcePath: fileRecord.sourcePath,
    declaredByPath,
    changeNote: `initial import from ${toRelativePath(fileRecord.filePath)}`
  };
}

function registerSceneAsset(targetMap, assetRecord) {
  const key = `${assetRecord.scene}:${assetRecord.assetType}`;
  const existing = targetMap.get(key);

  if (!existing) {
    targetMap.set(key, assetRecord);
    return;
  }

  if (
    existing.filePath === assetRecord.filePath &&
    existing.ref === assetRecord.ref &&
    existing.checksum === assetRecord.checksum
  ) {
    return;
  }

  throw new Error(
    `Scene ${assetRecord.scene} has multiple ${assetRecord.assetType} assets: ` +
      `${toRelativePath(existing.filePath)} and ${toRelativePath(assetRecord.filePath)}.`
  );
}

function loadSceneConfigRecords() {
  const sceneConfigDir = REPOSITORY_SCENE_CONFIG_DIR;

  const records = fs
    .readdirSync(sceneConfigDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(sceneConfigDir, entry.name);
      const sourceText = fs.readFileSync(filePath, "utf8");
      const document = JSON.parse(sourceText);
      const scene = String(document.scene || path.basename(entry.name, ".json")).trim();

      if (!scene) {
        throw new Error(`Scene config ${toRelativePath(filePath)} is missing scene.`);
      }

      return {
        scene,
        title: document.title || scene,
        enabled: document.enabled === true,
        executionMode: document?.execution?.mode || "agent-runtime",
        status: document.status || IMPORT_STATUS,
        document,
        sourceText,
        updatedBy: IMPORT_OPERATOR,
        checksum: hashText(sourceText),
        filePath,
        changeNote: `initial import from ${toRelativePath(filePath)}`
      };
    });

  return sortRecords(records, (record) => record.scene);
}

function loadPlatformResourceRecords() {
  const resources = loadPlatformResources(PLATFORM_BASE_DIR);
  const allRecords = [...resources.templates, ...resources.skills, ...resources.tools, ...resources.queries];

  return sortRecords(
    allRecords.map((record) => {
      const sourceText = fs.readFileSync(record.filePath, "utf8");
      const document = record.document;
      const metadata = document.metadata || {};
      const spec = document.spec || {};
      const kind = mapPlatformKind(document.kind);
      const name = String(metadata.name || "").trim();
      const version = String(metadata.version || "").trim();

      if (!name || !version) {
        throw new Error(`Platform resource ${toRelativePath(record.filePath)} is missing metadata.name or metadata.version.`);
      }

      return {
        kind,
        name,
        version,
        ref: spec.ref || null,
        scene: spec.scene || null,
        status: metadata.status || IMPORT_STATUS,
        document,
        sourceText,
        updatedBy: IMPORT_OPERATOR,
        checksum: hashText(sourceText),
        filePath: record.filePath,
        changeNote: `initial import from ${toRelativePath(record.filePath)}`
      };
    }),
    (record) => `${record.kind}:${record.name}:${record.version}`
  );
}

function collectSkillSceneAssets(platformResources) {
  const assetMap = new Map();

  for (const resource of platformResources.filter((record) => record.kind === "skill")) {
    const scene = String(resource.scene || "").trim();
    const assetRefs = resource.document?.spec?.assetRefs || {};

    if (!scene) {
      throw new Error(`BusinessSkill ${resource.name}@${resource.version} is missing spec.scene.`);
    }

    for (const assetGroup of ASSET_GROUPS) {
      const groupEntries = assetRefs[assetGroup.groupName];
      if (!groupEntries || typeof groupEntries !== "object") {
        continue;
      }

      for (const groupEntry of Object.values(groupEntries)) {
        if (!groupEntry || typeof groupEntry !== "object") {
          continue;
        }

        const sourcePath = groupEntry.source?.path;
        if (!sourcePath) {
          throw new Error(
            `BusinessSkill ${resource.name}@${resource.version} is missing source.path for ${assetGroup.assetType}.`
          );
        }

        registerSceneAsset(
          assetMap,
          buildSceneAssetRecord({
            scene,
            assetType: assetGroup.assetType,
            ref: groupEntry[assetGroup.refField] || null,
            sourcePath,
            declaredByPath: resource.filePath
          })
        );
      }
    }
  }

  return assetMap;
}

function loadHelperScriptRecords(sceneConfigs) {
  const sceneSet = new Set(sceneConfigs.map((record) => record.scene));
  const helperScriptMap = new Map();

  if (!fs.existsSync(HELPER_QUERY_DIR)) {
    return [];
  }

  const entries = fs
    .readdirSync(HELPER_QUERY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(HELPER_QUERY_SUFFIX));

  for (const entry of entries) {
    const filePath = path.join(HELPER_QUERY_DIR, entry.name);
    const scene = entry.name.slice(0, -HELPER_QUERY_SUFFIX.length);

    if (!sceneSet.has(scene)) {
      throw new Error(`Helper script ${toRelativePath(filePath)} does not match any known scene.`);
    }

    const key = `${scene}:${HELPER_SCRIPT_TYPE}`;
    if (helperScriptMap.has(key)) {
      throw new Error(`Scene ${scene} has multiple ${HELPER_SCRIPT_TYPE} helper scripts.`);
    }

    const contentText = fs.readFileSync(filePath, "utf8");
    helperScriptMap.set(key, {
      scene,
      scriptType: HELPER_SCRIPT_TYPE,
      scriptName: entry.name,
      contentText,
      status: IMPORT_STATUS,
      updatedBy: IMPORT_OPERATOR,
      checksum: hashText(contentText),
      filePath,
      changeNote: `initial import from ${toRelativePath(filePath)}`
    });
  }

  return sortRecords(Array.from(helperScriptMap.values()), (record) => `${record.scene}:${record.scriptType}`);
}

function buildImportPayload() {
  const sceneConfigs = loadSceneConfigRecords();
  const platformResources = loadPlatformResourceRecords();
  const sceneAssetMap = collectSkillSceneAssets(platformResources);

  const sceneAssets = sortRecords(Array.from(sceneAssetMap.values()), (record) => `${record.scene}:${record.assetType}`);
  const helperScripts = loadHelperScriptRecords(sceneConfigs);

  return {
    sceneConfigs,
    platformResources,
    sceneAssets,
    helperScripts,
    counts: {
      sceneConfigs: sceneConfigs.length,
      platformResources: platformResources.length,
      sceneAssets: sceneAssets.length,
      helperScripts: helperScripts.length
    }
  };
}

function sceneConfigMatches(existing, expected) {
  return Boolean(existing) &&
    existing.title === expected.title &&
    existing.enabled === expected.enabled &&
    existing.executionMode === expected.executionMode &&
    existing.status === expected.status &&
    existing.checksum === expected.checksum &&
    existing.sourceText === expected.sourceText;
}

function platformResourceMatches(existing, expected) {
  return Boolean(existing) &&
    existing.kind === expected.kind &&
    existing.name === expected.name &&
    existing.version === expected.version &&
    existing.ref === expected.ref &&
    existing.scene === expected.scene &&
    existing.status === expected.status &&
    existing.checksum === expected.checksum &&
    existing.sourceText === expected.sourceText;
}

function sceneAssetMatches(existing, expected) {
  return Boolean(existing) &&
    existing.scene === expected.scene &&
    existing.assetType === expected.assetType &&
    existing.ref === expected.ref &&
    existing.contentFormat === expected.contentFormat &&
    existing.status === expected.status &&
    existing.checksum === expected.checksum &&
    existing.contentText === expected.contentText;
}

function helperScriptMatches(existing, expected) {
  return Boolean(existing) &&
    existing.scene === expected.scene &&
    existing.scriptType === expected.scriptType &&
    existing.scriptName === expected.scriptName &&
    existing.status === expected.status &&
    existing.checksum === expected.checksum &&
    existing.contentText === expected.contentText;
}

function createImportSummary(payload) {
  return {
    counts: payload.counts,
    sceneConfigs: {
      imported: 0,
      skipped: 0
    },
    platformResources: {
      imported: 0,
      skipped: 0
    },
    sceneAssets: {
      imported: 0,
      skipped: 0
    },
    helperScripts: {
      imported: 0,
      skipped: 0
    }
  };
}

async function importSceneConfigs(store, payload, summary) {
  for (const record of payload.sceneConfigs) {
    const existing = await store.getSceneConfig(record.scene);
    if (sceneConfigMatches(existing, record)) {
      summary.sceneConfigs.skipped += 1;
      continue;
    }

    await store.saveSceneConfigDraft(
      {
        scene: record.scene,
        title: record.title,
        enabled: record.enabled,
        executionMode: record.executionMode,
        status: record.status,
        document: record.document,
        sourceText: record.sourceText,
        updatedBy: record.updatedBy
      },
      {
        operator: IMPORT_OPERATOR,
        changeNote: record.changeNote
      }
    );

    summary.sceneConfigs.imported += 1;
  }
}

async function importPlatformResources(store, payload, summary) {
  for (const record of payload.platformResources) {
    const existing = await store.getPlatformResource({
      kind: record.kind,
      name: record.name,
      version: record.version
    });

    if (platformResourceMatches(existing, record)) {
      summary.platformResources.skipped += 1;
      continue;
    }

    await store.savePlatformResourceDraft(
      {
        kind: record.kind,
        name: record.name,
        version: record.version,
        ref: record.ref,
        scene: record.scene,
        status: record.status,
        document: record.document,
        sourceText: record.sourceText,
        updatedBy: record.updatedBy
      },
      {
        operator: IMPORT_OPERATOR,
        changeNote: record.changeNote
      }
    );

    summary.platformResources.imported += 1;
  }
}

async function importSceneAssets(store, payload, summary) {
  for (const record of payload.sceneAssets) {
    const existing = await store.getSceneAsset(record.scene, record.assetType);
    if (sceneAssetMatches(existing, record)) {
      summary.sceneAssets.skipped += 1;
      continue;
    }

    await store.saveSceneAssetDraft(
      {
        scene: record.scene,
        assetType: record.assetType,
        ref: record.ref,
        contentText: record.contentText,
        contentFormat: record.contentFormat,
        document: record.document,
        status: record.status,
        updatedBy: record.updatedBy
      },
      {
        operator: IMPORT_OPERATOR,
        changeNote: record.changeNote
      }
    );

    summary.sceneAssets.imported += 1;
  }
}

async function importHelperScripts(store, payload, summary) {
  for (const record of payload.helperScripts) {
    const existing = await store.getHelperScript(record.scene, record.scriptType);
    if (helperScriptMatches(existing, record)) {
      summary.helperScripts.skipped += 1;
      continue;
    }

    await store.saveHelperScriptDraft(
      {
        scene: record.scene,
        scriptType: record.scriptType,
        scriptName: record.scriptName,
        contentText: record.contentText,
        status: record.status,
        updatedBy: record.updatedBy
      },
      {
        operator: IMPORT_OPERATOR,
        changeNote: record.changeNote
      }
    );

    summary.helperScripts.imported += 1;
  }
}

async function runImport(payload) {
  const store = createConfigStore({ driver: "mysql" });
  const summary = createImportSummary(payload);

  try {
    await importSceneConfigs(store, payload, summary);
    await importPlatformResources(store, payload, summary);
    await importSceneAssets(store, payload, summary);
    await importHelperScripts(store, payload, summary);
    return summary;
  } finally {
    await store.close();
  }
}

function buildSceneConfigKey(record) {
  return record.scene;
}

function buildPlatformResourceKey(record) {
  return `${record.kind}:${record.name}:${record.version}`;
}

function buildSceneAssetKey(record) {
  return `${record.scene}:${record.assetType}`;
}

function buildHelperScriptKey(record) {
  return `${record.scene}:${record.scriptType}`;
}

function compareCounts(expectedCounts, actualCounts) {
  for (const field of Object.keys(expectedCounts)) {
    if (expectedCounts[field] !== actualCounts[field]) {
      throw new Error(`MySQL ${field} count mismatch: expected ${expectedCounts[field]}, received ${actualCounts[field]}.`);
    }
  }
}

async function assertRevisionState(store, { label, targetType, targetId, currentRevisionId, expectedChecksum }) {
  if (!currentRevisionId) {
    throw new Error(`${label} is missing current_revision_id.`);
  }

  const currentRevision = await store.getRevisionById(currentRevisionId);
  if (!currentRevision) {
    throw new Error(`${label} current_revision_id=${currentRevisionId} does not point to an existing revision.`);
  }

  if (currentRevision.targetType !== targetType || currentRevision.targetId !== targetId) {
    throw new Error(`${label} current_revision_id=${currentRevisionId} points to a different target.`);
  }

  if (currentRevision.checksum !== expectedChecksum) {
    throw new Error(`${label} revision checksum mismatch.`);
  }

  return currentRevision.revisionNo;
}

async function verifySceneConfigRecords(store, expectedRecords, actualRecords) {
  const actualByKey = new Map(actualRecords.map((record) => [buildSceneConfigKey(record), record]));
  let revisionCount = 0;

  for (const expected of expectedRecords) {
    const actual = actualByKey.get(buildSceneConfigKey(expected));
    if (!sceneConfigMatches(actual, expected)) {
      throw new Error(`Scene config ${expected.scene} does not match current file content.`);
    }

    revisionCount += await assertRevisionState(store, {
      label: `scene-config ${expected.scene}`,
      targetType: "scene-config",
      targetId: actual.id,
      currentRevisionId: actual.currentRevisionId,
      expectedChecksum: expected.checksum
    });
  }

  return revisionCount;
}

async function verifyPlatformResourceRecords(store, expectedRecords, actualRecords) {
  const actualByKey = new Map(actualRecords.map((record) => [buildPlatformResourceKey(record), record]));
  let revisionCount = 0;

  for (const expected of expectedRecords) {
    const actual = actualByKey.get(buildPlatformResourceKey(expected));
    if (!platformResourceMatches(actual, expected)) {
      throw new Error(`Platform resource ${expected.kind}:${expected.name}:${expected.version} does not match file content.`);
    }

    revisionCount += await assertRevisionState(store, {
      label: `platform-resource ${expected.kind}:${expected.name}:${expected.version}`,
      targetType: "platform-resource",
      targetId: actual.id,
      currentRevisionId: actual.currentRevisionId,
      expectedChecksum: expected.checksum
    });
  }

  return revisionCount;
}

async function verifySceneAssetRecords(store, expectedRecords, actualRecords) {
  const actualByKey = new Map(actualRecords.map((record) => [buildSceneAssetKey(record), record]));
  let revisionCount = 0;

  for (const expected of expectedRecords) {
    const actual = actualByKey.get(buildSceneAssetKey(expected));
    if (!sceneAssetMatches(actual, expected)) {
      throw new Error(`Scene asset ${expected.scene}:${expected.assetType} does not match source file content.`);
    }

    revisionCount += await assertRevisionState(store, {
      label: `scene-asset ${expected.scene}:${expected.assetType}`,
      targetType: "scene-asset",
      targetId: actual.id,
      currentRevisionId: actual.currentRevisionId,
      expectedChecksum: expected.checksum
    });
  }

  return revisionCount;
}

async function verifyHelperScriptRecords(store, expectedRecords, actualRecords) {
  const actualByKey = new Map(actualRecords.map((record) => [buildHelperScriptKey(record), record]));
  let revisionCount = 0;

  for (const expected of expectedRecords) {
    const actual = actualByKey.get(buildHelperScriptKey(expected));
    if (!helperScriptMatches(actual, expected)) {
      throw new Error(`Helper script ${expected.scene}:${expected.scriptType} does not match file content.`);
    }

    revisionCount += await assertRevisionState(store, {
      label: `helper-script ${expected.scene}:${expected.scriptType}`,
      targetType: "helper-script",
      targetId: actual.id,
      currentRevisionId: actual.currentRevisionId,
      expectedChecksum: expected.checksum
    });
  }

  return revisionCount;
}

async function runVerification(payload) {
  const store = createConfigStore({ driver: "mysql" });

  try {
    const [sceneConfigs, platformResources, sceneAssets, helperScripts] = await Promise.all([
      store.listSceneConfigs(),
      store.listPlatformResources(),
      store.listSceneAssets(),
      store.listHelperScripts()
    ]);

    const actualCounts = {
      sceneConfigs: sceneConfigs.length,
      platformResources: platformResources.length,
      sceneAssets: sceneAssets.length,
      helperScripts: helperScripts.length
    };

    compareCounts(payload.counts, actualCounts);

    const sceneConfigRevisionCount = await verifySceneConfigRecords(store, payload.sceneConfigs, sceneConfigs);
    const platformResourceRevisionCount = await verifyPlatformResourceRecords(store, payload.platformResources, platformResources);
    const sceneAssetRevisionCount = await verifySceneAssetRecords(store, payload.sceneAssets, sceneAssets);
    const helperScriptRevisionCount = await verifyHelperScriptRecords(store, payload.helperScripts, helperScripts);

    return {
      expectedCounts: payload.counts,
      actualCounts,
      verifiedEntities: {
        sceneConfigs: payload.sceneConfigs.length,
        platformResources: payload.platformResources.length,
        sceneAssets: payload.sceneAssets.length,
        helperScripts: payload.helperScripts.length
      },
      verifiedRevisionCount:
        sceneConfigRevisionCount +
        platformResourceRevisionCount +
        sceneAssetRevisionCount +
        helperScriptRevisionCount
    };
  } finally {
    await store.close();
  }
}

async function main() {
  const command = String(process.argv[2] || "import").trim().toLowerCase();
  if (!["import", "verify"].includes(command)) {
    throw new Error(`Unsupported command: ${command}`);
  }

  const payload = buildImportPayload();

  if (command === "verify") {
    const verification = await runVerification(payload);
    console.log(JSON.stringify({ command, verification }, null, 2));
    return;
  }

  const summary = await runImport(payload);
  const verification = await runVerification(payload);

  console.log(
    JSON.stringify(
      {
        command,
        summary,
        verification
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
