const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs/promises");
const path = require("path");

const { createAppError } = require("../utils/errors");
const { PROJECT_ROOT } = require("../utils/path-resolver");

const PROJECT_PREFIX = "project://";
const RUNTIME_NAMESPACE = "openclaw";
const RUNTIME_PREFIX = `runtime://${RUNTIME_NAMESPACE}/`;
const LEGACY_PROJECT_ROOTS_ENV = "BUNDLE_RENDERER_LEGACY_PROJECT_ROOTS";
const PASS_THROUGH_RELATIVE_PATHS = [
  "runtime-assets",
  "metadata",
  "references",
  path.join("DirectDbRunner", "sql-cache"),
  path.join("ContextHelper", "generated-queries"),
  path.join("platform", "assets", "prompts")
];
const PLATFORM_DIRECTORIES = {
  template: path.join("platform", "templates"),
  skill: path.join("platform", "skills"),
  tool: path.join("platform", "tools"),
  query: path.join("platform", "tools")
};
const ASSET_GROUP_BY_TYPE = {
  prompt: "prompts",
  schema: "schemas",
  dictionary: "dictionaries",
  rules: "rules"
};
const ASSET_REF_FIELD_BY_TYPE = {
  prompt: "promptRef",
  schema: "schemaRef",
  dictionary: "dictionaryRef",
  rules: "rulesRef"
};
const MIGRATION_SOURCE_PATH_FIELDS = ["skillPath", "helperScriptPath", "helperManifestPath", "sqlCacheFile"];
const HELPER_GENERATED_QUERY_ROOT = path.join("ContextHelper", "generated-queries");
const QUERY_SCRIPT_PATH_BEGIN = "<<<CONTEXT_HELPER_QUERY_SCRIPT_PATH_BEGIN>>>";
const QUERY_SCRIPT_PATH_END = "<<<CONTEXT_HELPER_QUERY_SCRIPT_PATH_END>>>";
const QUERY_DEFINITION_BEGIN = "<<<CONTEXT_HELPER_QUERY_DEFINITION_BEGIN>>>";
const QUERY_DEFINITION_END = "<<<CONTEXT_HELPER_QUERY_DEFINITION_END>>>";

function cloneJson(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function toTrimmedString(value, fieldName, options = {}) {
  const trimmed = value === null || value === undefined ? "" : String(value).trim();
  if (!trimmed && options.required) {
    throw createAppError("INVALID_REQUEST", `${fieldName} is required.`, {
      stage: "bundle-renderer"
    });
  }

  return trimmed;
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function ensureBundleRelativePath(relativePath, fieldName) {
  const normalized = path.posix.normalize(normalizeSlashes(relativePath)).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw createAppError("INVALID_REQUEST", `${fieldName} points outside bundle root: ${relativePath}.`, {
      stage: "bundle-renderer"
    });
  }

  return normalized;
}

function getProjectRootsForBundleReference() {
  const configuredRoots = String(process.env[LEGACY_PROJECT_ROOTS_ENV] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));

  return Array.from(new Set([PROJECT_ROOT, ...configuredRoots].map((item) => normalizeSlashes(item))));
}

function normalizeAbsolutePathToBundleReference(value) {
  const normalized = normalizeSlashes(value);

  for (const normalizedRoot of getProjectRootsForBundleReference()) {
    if (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`)) {
      const relativePath = ensureBundleRelativePath(normalized.slice(normalizedRoot.length + 1), "absolutePath");
      if (relativePath.startsWith(`runtime-assets/${RUNTIME_NAMESPACE}/`)) {
        return `${RUNTIME_PREFIX}${relativePath.slice(`runtime-assets/${RUNTIME_NAMESPACE}/`.length)}`;
      }

      return `${PROJECT_PREFIX}${relativePath}`;
    }
  }

  return value;
}

function normalizeBundlePathReference(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if (trimmed.startsWith(PROJECT_PREFIX) || trimmed.startsWith(RUNTIME_PREFIX)) {
    return trimmed;
  }

  if (path.isAbsolute(trimmed)) {
    return normalizeAbsolutePathToBundleReference(trimmed);
  }

  return trimmed;
}

function bundleReferenceToRelativePath(reference, fieldName) {
  const normalizedReference = normalizeBundlePathReference(reference);
  if (typeof normalizedReference !== "string" || !normalizedReference.trim()) {
    throw createAppError("INVALID_REQUEST", `${fieldName} is missing a valid path reference.`, {
      stage: "bundle-renderer"
    });
  }

  if (normalizedReference.startsWith(PROJECT_PREFIX)) {
    return ensureBundleRelativePath(normalizedReference.slice(PROJECT_PREFIX.length), fieldName);
  }

  if (normalizedReference.startsWith(RUNTIME_PREFIX)) {
    return ensureBundleRelativePath(
      path.posix.join("runtime-assets", RUNTIME_NAMESPACE, normalizedReference.slice(RUNTIME_PREFIX.length)),
      fieldName
    );
  }

  if (path.isAbsolute(normalizedReference)) {
    const normalizedAbsolute = normalizeAbsolutePathToBundleReference(normalizedReference);
    if (normalizedAbsolute !== normalizedReference) {
      return bundleReferenceToRelativePath(normalizedAbsolute, fieldName);
    }
  }

  return ensureBundleRelativePath(normalizedReference, fieldName);
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

function formatJsonDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
}

function extractMarkedBlock(content, beginMarker, endMarker, { required = true, label = "helper skill block" } = {}) {
  const beginIndex = content.indexOf(beginMarker);
  const endIndex = content.indexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    if (!required) {
      return null;
    }

    throw createAppError("INVALID_REQUEST", `Required ${label} markers were not found.`, {
      stage: "bundle-renderer",
      details: {
        label,
        beginMarker,
        endMarker
      }
    });
  }

  return {
    beginIndex,
    endIndex,
    content: content.slice(beginIndex + beginMarker.length, endIndex).trim()
  };
}

function normalizeHelperDeclaredBundleReference(rawPathContent) {
  const trimmed = toTrimmedString(rawPathContent, "helperScript.declaredFilePath");
  if (!trimmed) {
    return null;
  }

  const lines = trimmed
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) {
    throw createAppError("INVALID_REQUEST", "Helper skill script path block must contain exactly one path.", {
      stage: "bundle-renderer",
      details: {
        lines
      }
    });
  }

  return normalizeBundlePathReference(lines[0]);
}

function toProjectReference(relativePath) {
  return `${PROJECT_PREFIX}${normalizeSlashes(relativePath)}`;
}

function tryLoadHelperScriptMetadata(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    const loaded = require(filePath);
    return {
      generatedAt: toTrimmedString(loaded?.generatedAt, "generatedAt"),
      definitionHash: toTrimmedString(loaded?.definitionHash, "definitionHash")
    };
  } catch {
    return {
      generatedAt: null,
      definitionHash: null
    };
  }
}

function parseEntryDocument(entry, fieldName, options = {}) {
  const fromSnapshot = cloneJson(entry?.snapshotJson?.document);
  if (fromSnapshot && typeof fromSnapshot === "object") {
    return fromSnapshot;
  }

  if (options.format === "json") {
    return JSON.parse(entry.snapshotText);
  }

  throw createAppError("INVALID_REQUEST", `${fieldName} document is missing.`, {
    stage: "bundle-renderer",
    details: {
      entryType: entry?.entryType,
      entryKey: entry?.entryKey
    }
  });
}

function buildPlatformResourceRelativePath(entry) {
  const kind = toTrimmedString(entry?.snapshotJson?.kind, "platformResource.kind", { required: true });
  const name = toTrimmedString(entry?.snapshotJson?.name, "platformResource.name", { required: true });
  const version = toTrimmedString(entry?.snapshotJson?.version, "platformResource.version", { required: true });
  const directory = PLATFORM_DIRECTORIES[kind];

  if (!directory) {
    throw createAppError("INVALID_REQUEST", `Unsupported platform resource kind: ${kind}.`, {
      stage: "bundle-renderer"
    });
  }

  switch (kind) {
    case "tool":
      return path.join(directory, `${name}.tool.yaml`);
    case "query":
      return path.join(directory, `${name}.query.yaml`);
    default:
      return path.join(directory, `${name}.${version}.yaml`);
  }
}

function rewriteSceneConfigDocument(document) {
  const nextDocument = cloneJson(document) || {};
  const directModel = nextDocument.directModel || null;

  if (directModel) {
    if (typeof directModel.promptFile === "string") {
      directModel.promptFile = normalizeBundlePathReference(directModel.promptFile);
    }
    if (typeof directModel.fallbackModelsFile === "string") {
      directModel.fallbackModelsFile = normalizeBundlePathReference(directModel.fallbackModelsFile);
    }
  }

  if (nextDocument.skill && typeof nextDocument.skill === "object") {
    if (typeof nextDocument.skill.workspacePath === "string") {
      nextDocument.skill.workspacePath = normalizeBundlePathReference(nextDocument.skill.workspacePath);
    }
    if (typeof nextDocument.skill.entryFile === "string") {
      nextDocument.skill.entryFile = normalizeBundlePathReference(nextDocument.skill.entryFile);
    }
  }

  if (Array.isArray(nextDocument.references)) {
    nextDocument.references = nextDocument.references.map((reference) => {
      if (!reference || typeof reference !== "object") {
        return reference;
      }

      return {
        ...reference,
        path: typeof reference.path === "string" ? normalizeBundlePathReference(reference.path) : reference.path
      };
    });
  }

  return nextDocument;
}

function rewritePlatformResourceDocument(document) {
  const nextDocument = cloneJson(document) || {};
  const spec = nextDocument.spec || {};
  const assetRefs = spec.assetRefs || {};

  for (const [groupName, groupEntries] of Object.entries(assetRefs)) {
    if (!groupEntries || typeof groupEntries !== "object") {
      continue;
    }

    for (const [entryName, assetEntry] of Object.entries(groupEntries)) {
      if (!assetEntry || typeof assetEntry !== "object" || !assetEntry.source || typeof assetEntry.source !== "object") {
        continue;
      }

      groupEntries[entryName] = {
        ...assetEntry,
        source: {
          ...assetEntry.source,
          path: typeof assetEntry.source.path === "string"
            ? normalizeBundlePathReference(assetEntry.source.path)
            : assetEntry.source.path
        }
      };
    }
  }

  const migrationSource = spec.migrationSource;
  if (migrationSource && typeof migrationSource === "object") {
    for (const fieldName of MIGRATION_SOURCE_PATH_FIELDS) {
      if (typeof migrationSource[fieldName] === "string") {
        migrationSource[fieldName] = normalizeBundlePathReference(migrationSource[fieldName]);
      }
    }
  }

  return nextDocument;
}

function buildEntryMaps(entries) {
  const sceneConfigDocuments = new Map();
  const skillDocumentsByScene = new Map();

  for (const entry of entries) {
    if (entry.entryType === "scene-config") {
      sceneConfigDocuments.set(
        toTrimmedString(entry?.snapshotJson?.scene, "sceneConfig.scene", { required: true }),
        parseEntryDocument(entry, "sceneConfig", { format: "json" })
      );
      continue;
    }

    if (entry.entryType === "platform-resource" && entry?.snapshotJson?.kind === "skill") {
      const document = parseEntryDocument(entry, "platformResource.skill");
      const scene = toTrimmedString(document?.spec?.scene, "skill.spec.scene");
      if (!scene) {
        continue;
      }

      const current = skillDocumentsByScene.get(scene) || [];
      current.push(document);
      skillDocumentsByScene.set(scene, current);
    }
  }

  return {
    sceneConfigDocuments,
    skillDocumentsByScene
  };
}

function collectSceneConfigAssetCandidates(sceneConfigDocument, sceneAssetEntry) {
  const candidates = [];
  if (!sceneConfigDocument || typeof sceneConfigDocument !== "object") {
    return candidates;
  }

  const references = Array.isArray(sceneConfigDocument.references) ? sceneConfigDocument.references : [];
  for (const reference of references) {
    if (!reference || typeof reference !== "object" || typeof reference.path !== "string") {
      continue;
    }

    if (sceneAssetEntry.snapshotJson?.ref && reference.id === sceneAssetEntry.snapshotJson.ref) {
      candidates.push(reference.path);
    }
  }

  if (sceneConfigDocument.execution?.mode === "direct-model") {
    if (sceneAssetEntry.snapshotJson?.assetType === "prompt" && sceneConfigDocument.directModel?.promptFile) {
      candidates.push(sceneConfigDocument.directModel.promptFile);
    }

    if (sceneAssetEntry.snapshotJson?.assetType === "schema" && sceneConfigDocument.directModel?.schemaReferenceId) {
      const schemaReference = references.find(
        (reference) => reference && reference.id === sceneConfigDocument.directModel.schemaReferenceId
      );
      if (schemaReference?.path) {
        candidates.push(schemaReference.path);
      }
    }
  }

  return candidates;
}

function collectSkillAssetCandidates(skillDocuments, sceneAssetEntry) {
  const candidates = [];
  const assetType = toTrimmedString(sceneAssetEntry?.snapshotJson?.assetType, "sceneAsset.assetType", { required: true });
  const groupName = ASSET_GROUP_BY_TYPE[assetType];
  const refField = ASSET_REF_FIELD_BY_TYPE[assetType];

  if (!groupName || !refField) {
    throw createAppError("INVALID_REQUEST", `Unsupported scene asset type: ${assetType}.`, {
      stage: "bundle-renderer"
    });
  }

  for (const skillDocument of skillDocuments || []) {
    const groupEntries = skillDocument?.spec?.assetRefs?.[groupName];
    if (!groupEntries || typeof groupEntries !== "object") {
      continue;
    }

    for (const assetEntry of Object.values(groupEntries)) {
      if (!assetEntry || typeof assetEntry !== "object" || !assetEntry.source || typeof assetEntry.source !== "object") {
        continue;
      }

      if (sceneAssetEntry.snapshotJson?.ref && assetEntry[refField] === sceneAssetEntry.snapshotJson.ref) {
        candidates.push(assetEntry.source.path);
      }
    }
  }

  if (!candidates.length) {
    for (const skillDocument of skillDocuments || []) {
      const groupEntries = skillDocument?.spec?.assetRefs?.[groupName];
      if (!groupEntries || typeof groupEntries !== "object") {
        continue;
      }

      for (const assetEntry of Object.values(groupEntries)) {
        if (assetEntry?.source?.path) {
          candidates.push(assetEntry.source.path);
        }
      }
    }
  }

  return candidates;
}

function resolveSceneAssetRelativePath(sceneAssetEntry, entryMaps) {
  const scene = toTrimmedString(sceneAssetEntry?.snapshotJson?.scene, "sceneAsset.scene", { required: true });
  const sceneConfigDocument = entryMaps.sceneConfigDocuments.get(scene) || null;
  const skillDocuments = entryMaps.skillDocumentsByScene.get(scene) || [];
  const candidates = [
    ...collectSceneConfigAssetCandidates(sceneConfigDocument, sceneAssetEntry),
    ...collectSkillAssetCandidates(skillDocuments, sceneAssetEntry)
  ]
    .map((candidate) => normalizeBundlePathReference(candidate))
    .filter((candidate) => typeof candidate === "string" && candidate.trim());
  const uniqueCandidates = Array.from(new Set(candidates));

  if (uniqueCandidates.length === 0) {
    throw createAppError(
      "INVALID_REQUEST",
      `Failed to resolve bundle path for scene asset ${sceneAssetEntry.entryKey}.`,
      {
        stage: "bundle-renderer",
        details: {
          scene,
          assetType: sceneAssetEntry?.snapshotJson?.assetType || null,
          ref: sceneAssetEntry?.snapshotJson?.ref || null
        }
      }
    );
  }

  if (uniqueCandidates.length > 1) {
    throw createAppError(
      "INVALID_REQUEST",
      `Multiple bundle paths matched scene asset ${sceneAssetEntry.entryKey}.`,
      {
        stage: "bundle-renderer",
        details: {
          scene,
          candidates: uniqueCandidates
        }
      }
    );
  }

  return bundleReferenceToRelativePath(uniqueCandidates[0], "sceneAsset.sourcePath");
}

async function writeFile(filePath, content, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, options.encoding || "utf8");
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

class BundleRenderer {
  constructor(options = {}) {
    this.projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
    this.rendererVersion = toTrimmedString(options.rendererVersion || "bundle-renderer/v1", "rendererVersion", {
      required: true
    });
  }

  getPassThroughSources() {
    return PASS_THROUGH_RELATIVE_PATHS.map((relativePath) => ({
      sourcePath: path.join(this.projectRoot, relativePath),
      targetPath: relativePath
    }));
  }

  async copyPassThroughFiles(releaseDir) {
    for (const entry of this.getPassThroughSources()) {
      if (!(await exists(entry.sourcePath))) {
        continue;
      }

      await fs.mkdir(path.dirname(path.join(releaseDir, entry.targetPath)), { recursive: true });
      await fs.cp(entry.sourcePath, path.join(releaseDir, entry.targetPath), {
        recursive: true,
        force: true
      });
    }
  }

  async writeEntrySnapshots(release, entries) {
    const releaseDir = release.bundlePath;
    const indexPayload = [];

    for (const entry of entries) {
      indexPayload.push({
        entry_type: entry.entryType,
        entry_key: entry.entryKey,
        target_id: entry.targetId,
        revision_id: entry.revisionId,
        checksum: entry.checksum,
        path: entry.relativePath
      });

      await writeFile(path.join(releaseDir, entry.relativePath), JSON.stringify({
        release_id: release.releaseId,
        entry_type: entry.entryType,
        entry_key: entry.entryKey,
        target_id: entry.targetId,
        revision_id: entry.revisionId,
        checksum: entry.checksum,
        snapshot_json: entry.snapshotJson,
        snapshot_text: entry.snapshotText
      }, null, 2) + "\n");
    }

    await writeFile(path.join(releaseDir, "entries", "index.json"), JSON.stringify(indexPayload, null, 2) + "\n");

    return {
      entryIndexPath: path.join(releaseDir, "entries", "index.json"),
      entryCount: entries.length
    };
  }

  async renderSceneConfigs(releaseDir, entries) {
    const sceneEntries = entries.filter((entry) => entry.entryType === "scene-config");

    for (const entry of sceneEntries) {
      const document = rewriteSceneConfigDocument(parseEntryDocument(entry, "sceneConfig", { format: "json" }));
      const scene = toTrimmedString(document.scene || entry.snapshotJson?.scene, "sceneConfig.scene", { required: true });
      await writeFile(path.join(releaseDir, "scene-configs", `${scene}.json`), formatJsonDocument(document));
    }
  }

  async renderPlatformResources(releaseDir, entries) {
    const resourceEntries = entries.filter((entry) => entry.entryType === "platform-resource");

    for (const entry of resourceEntries) {
      const document = rewritePlatformResourceDocument(parseEntryDocument(entry, "platformResource"));
      const relativePath = buildPlatformResourceRelativePath(entry);
      await writeFile(path.join(releaseDir, relativePath), dumpYamlDocument(document));
    }
  }

  async renderSceneAssets(releaseDir, entries, entryMaps) {
    const assetEntries = entries.filter((entry) => entry.entryType === "scene-asset");

    for (const entry of assetEntries) {
      const relativePath = resolveSceneAssetRelativePath(entry, entryMaps);
      await writeFile(path.join(releaseDir, relativePath), entry.snapshotText || "");
    }
  }

  async renderHelperScripts(releaseDir, entries) {
    const helperEntries = entries.filter((entry) => entry.entryType === "helper-script");

    for (const entry of helperEntries) {
      const scriptName = toTrimmedString(entry?.snapshotJson?.scriptName, "helperScript.scriptName", { required: true });
      await writeFile(path.join(releaseDir, HELPER_GENERATED_QUERY_ROOT, scriptName), entry.snapshotText || "");
    }
  }

  async renderHelperManifest(releaseDir, release, entries, entryMaps) {
    const helperEntries = entries.filter((entry) => entry.entryType === "helper-script");
    const manifest = {};

    for (const entry of helperEntries) {
      const scene = toTrimmedString(entry?.snapshotJson?.scene, "helperScript.scene", { required: true });
      const scriptName = toTrimmedString(entry?.snapshotJson?.scriptName, "helperScript.scriptName", { required: true });
      const sceneConfigDocument = entryMaps.sceneConfigDocuments.get(scene);

      if (!sceneConfigDocument) {
        throw createAppError("INVALID_REQUEST", `Helper script ${scene}:${scriptName} is missing a scene config entry.`, {
          stage: "bundle-renderer"
        });
      }

      const renderedSceneConfig = rewriteSceneConfigDocument(sceneConfigDocument);
      const skillPath = toTrimmedString(renderedSceneConfig?.skill?.entryFile, "sceneConfig.skill.entryFile", {
        required: true
      });
      const skillRelativePath = bundleReferenceToRelativePath(skillPath, "sceneConfig.skill.entryFile");
      const skillAbsolutePath = path.join(releaseDir, skillRelativePath);
      const skillContent = await fs.readFile(skillAbsolutePath, "utf8");
      const scriptPathBlock = extractMarkedBlock(skillContent, QUERY_SCRIPT_PATH_BEGIN, QUERY_SCRIPT_PATH_END, {
        required: false,
        label: "helper query script path"
      });
      const definitionBlock = extractMarkedBlock(skillContent, QUERY_DEFINITION_BEGIN, QUERY_DEFINITION_END, {
        label: "helper query business definition"
      });
      const helperFileReference = toProjectReference(path.join(HELPER_GENERATED_QUERY_ROOT, scriptName));
      const helperScriptMetadata = tryLoadHelperScriptMetadata(path.join(releaseDir, HELPER_GENERATED_QUERY_ROOT, scriptName));

      manifest[scene] = {
        scene,
        skillPath,
        declaredFilePath: normalizeHelperDeclaredBundleReference(scriptPathBlock?.content) || helperFileReference,
        definitionHash: sha256(definitionBlock.content),
        filePath: helperFileReference,
        generatedAt: helperScriptMetadata.generatedAt || release.createdAt.toISOString()
      };
    }

    await writeFile(path.join(releaseDir, HELPER_GENERATED_QUERY_ROOT, "manifest.json"), formatJsonDocument(manifest));
  }

  async renderBundle(input) {
    const release = input.release;
    const entries = Array.isArray(input.entries) ? input.entries : [];

    if (!release?.bundlePath) {
      throw createAppError("INVALID_REQUEST", "release.bundlePath is required for bundle rendering.", {
        stage: "bundle-renderer"
      });
    }

    const releaseDir = release.bundlePath;
    const entryMaps = buildEntryMaps(entries);

    await fs.rm(releaseDir, { recursive: true, force: true });
    await fs.mkdir(releaseDir, { recursive: true });

    await this.copyPassThroughFiles(releaseDir);
    const snapshotResult = await this.writeEntrySnapshots(release, entries);
    await this.renderSceneConfigs(releaseDir, entries);
    await this.renderPlatformResources(releaseDir, entries);
    await this.renderSceneAssets(releaseDir, entries, entryMaps);
    await this.renderHelperScripts(releaseDir, entries);
    await this.renderHelperManifest(releaseDir, release, entries, entryMaps);
    await writeFile(path.join(releaseDir, "manifest.json"), JSON.stringify(release.manifest, null, 2) + "\n");

    return {
      releaseDir,
      manifestPath: path.join(releaseDir, "manifest.json"),
      entryIndexPath: snapshotResult.entryIndexPath,
      entryCount: snapshotResult.entryCount
    };
  }

  async validateBundle(input) {
    const release = input.release;
    const entries = Array.isArray(input.entries) ? input.entries : [];

    if (!release?.bundlePath || !release?.releaseId) {
      throw createAppError("INVALID_REQUEST", "release.bundlePath and release.releaseId are required.", {
        stage: "bundle-renderer"
      });
    }

    const manifestPath = path.join(release.bundlePath, "manifest.json");
    const manifest = await readJsonFile(manifestPath);

    if (manifest.release_id !== release.releaseId) {
      throw createAppError("INVALID_REQUEST", "Bundle manifest release_id mismatch.", {
        stage: "bundle-renderer",
        details: {
          expected: release.releaseId,
          actual: manifest.release_id || null
        }
      });
    }

    const entryItems = Array.isArray(manifest.entries?.items) ? manifest.entries.items : [];
    const aggregateSource = [];

    for (const item of entryItems) {
      const snapshotPath = path.join(release.bundlePath, item.path);
      const payload = await readJsonFile(snapshotPath);

      if (payload.release_id !== null && payload.release_id !== release.releaseId) {
        throw createAppError("INVALID_REQUEST", `Entry snapshot ${item.entry_key} points to another release.`, {
          stage: "bundle-renderer"
        });
      }

      if (payload.revision_id !== item.revision_id || payload.checksum !== item.checksum) {
        throw createAppError("INVALID_REQUEST", `Entry snapshot ${item.entry_key} checksum mismatch.`, {
          stage: "bundle-renderer"
        });
      }

      aggregateSource.push({
        entry_type: item.entry_type,
        entry_key: item.entry_key,
        revision_id: item.revision_id,
        checksum: item.checksum
      });
    }

    const aggregateChecksum = require("crypto")
      .createHash("sha256")
      .update(JSON.stringify(aggregateSource))
      .digest("hex")
      .slice(0, 12);

    if (aggregateChecksum !== manifest.checksums?.aggregate) {
      throw createAppError("INVALID_REQUEST", "Bundle aggregate checksum mismatch.", {
        stage: "bundle-renderer"
      });
    }

    const requiredDirectories = ["scene-configs", "platform", "runtime-assets", path.join("ContextHelper", "generated-queries")];
    for (const relativePath of requiredDirectories) {
      if (!(await exists(path.join(release.bundlePath, relativePath)))) {
        throw createAppError("INVALID_REQUEST", `Bundle directory is missing: ${relativePath}.`, {
          stage: "bundle-renderer"
        });
      }
    }

    if (entries.length) {
      const entryMaps = buildEntryMaps(entries);

      for (const entry of entries) {
        let relativePath = null;

        switch (entry.entryType) {
          case "scene-config":
            relativePath = path.join("scene-configs", `${entry.snapshotJson?.scene}.json`);
            break;
          case "platform-resource":
            relativePath = buildPlatformResourceRelativePath(entry);
            break;
          case "scene-asset":
            relativePath = resolveSceneAssetRelativePath(entry, entryMaps);
            break;
          case "helper-script":
            relativePath = path.join(
              "ContextHelper",
              "generated-queries",
              toTrimmedString(entry?.snapshotJson?.scriptName, "helperScript.scriptName", { required: true })
            );
            break;
          default:
            break;
        }

        if (relativePath && !(await exists(path.join(release.bundlePath, relativePath)))) {
          throw createAppError("INVALID_REQUEST", `Bundle output is missing: ${relativePath}.`, {
            stage: "bundle-renderer",
            details: {
              entryType: entry.entryType,
              entryKey: entry.entryKey
            }
          });
        }
      }
    }

    return {
      manifestPath,
      entryCount: entryItems.length,
      aggregateChecksum
    };
  }
}

function createBundleRenderer(options = {}) {
  return new BundleRenderer(options);
}

module.exports = {
  BundleRenderer,
  buildPlatformResourceRelativePath,
  bundleReferenceToRelativePath,
  createBundleRenderer,
  normalizeBundlePathReference,
  resolveSceneAssetRelativePath
};
