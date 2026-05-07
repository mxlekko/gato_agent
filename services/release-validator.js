const fs = require("fs/promises");
const path = require("path");

const { normalizeBundlePathReference } = require("./bundle-renderer");
const { compileWorkflowGraphForScene } = require("../platform/compiler/compile-workflow");
const { loadPlatformResources, validatePlatformConfigs } = require("../platform/compiler/validate");
const { createAppError } = require("../utils/errors");
const { PROJECT_ROOT, resolvePathReference } = require("../utils/path-resolver");
const { RETIRED_AGENT_GATEWAY_MODEL_PREFIX } = require("../utils/retired-runtime-markers");

const JSON_SCAN_ROOTS = [
  "scene-configs",
  "references",
  "runtime-assets",
  path.join("DirectDbRunner", "sql-cache"),
  path.join("ContextHelper", "generated-queries")
];
const TSV_SCAN_ROOTS = ["metadata"];
const HELPER_SCRIPT_ROOT = path.join("ContextHelper", "generated-queries");
const HELPER_MANIFEST_PATH = path.join(HELPER_SCRIPT_ROOT, "manifest.json");
const HELPER_PATH_FIELDS = ["skillPath", "helperScriptPath", "helperManifestPath", "sqlCacheFile"];
const ASSET_REF_FIELDS = {
  prompts: "promptRef",
  schemas: "schemaRef",
  dictionaries: "dictionaryRef",
  rules: "rulesRef"
};

function toTrimmedString(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function pushIssue(issues, payload) {
  issues.push({
    severity: "error",
    ...payload
  });
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSkillVersion(version) {
  return toTrimmedString(version) || "v1";
}

function isPathInside(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function toRelativePath(bundleRoot, filePath) {
  if (!filePath) {
    return null;
  }

  if (!path.isAbsolute(filePath)) {
    return String(filePath).replace(/\\/g, "/");
  }

  return path.relative(bundleRoot, filePath).replace(/\\/g, "/");
}

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function listFilesRecursively(rootPath) {
  const stat = await safeStat(rootPath);
  if (!stat || !stat.isDirectory()) {
    return [];
  }

  const results = [];
  const queue = [rootPath];

  while (queue.length > 0) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (entry.isFile()) {
        results.push(entryPath);
      }
    }
  }

  return results.sort();
}

async function ensureBundleReferencePath({
  reference,
  bundleRoot,
  runtimeRoot,
  filePath,
  field,
  expectedType = "file",
  issues,
  missingCode = "MISSING_BUNDLE_PATH_REFERENCE",
  absoluteCode = "ABSOLUTE_BUNDLE_PATH_NOT_ALLOWED",
  escapeCode = "BUNDLE_PATH_ESCAPES_ROOT",
  notFoundCode = "MISSING_BUNDLE_PATH_TARGET",
  typeCode = "BUNDLE_PATH_TYPE_MISMATCH",
  warningCode = "LEGACY_BUNDLE_PATH_NOT_ALLOWED"
}) {
  const trimmed = toTrimmedString(reference);
  const relativeFilePath = toRelativePath(bundleRoot, filePath);

  if (!trimmed) {
    pushIssue(issues, {
      code: missingCode,
      file: relativeFilePath,
      field,
      message: `${field} is required.`
    });
    return null;
  }

  if (path.isAbsolute(trimmed)) {
    pushIssue(issues, {
      code: absoluteCode,
      file: relativeFilePath,
      field,
      message: `${field} must use bundle-safe project:// or runtime:// references.`,
      value: trimmed
    });
    return null;
  }

  let resolution;
  try {
    resolution = resolvePathReference(trimmed, {
      projectRoot: bundleRoot,
      runtimeRoot
    });
  } catch (error) {
    pushIssue(issues, {
      code: "INVALID_BUNDLE_PATH_REFERENCE",
      file: relativeFilePath,
      field,
      message: `${field} could not be resolved: ${error?.message || "resolve_failed"}.`,
      value: trimmed
    });
    return null;
  }

  if (!isPathInside(bundleRoot, resolution.resolvedPath)) {
    pushIssue(issues, {
      code: escapeCode,
      file: relativeFilePath,
      field,
      message: `${field} resolves outside the release bundle.`,
      value: trimmed,
      resolvedPath: resolution.resolvedPath
    });
    return null;
  }

  if (Array.isArray(resolution.warnings) && resolution.warnings.length > 0) {
    pushIssue(issues, {
      code: warningCode,
      file: relativeFilePath,
      field,
      message: `${field} still points to a legacy path.`,
      value: trimmed,
      warnings: cloneJson(resolution.warnings)
    });
    return null;
  }

  const targetStat = await safeStat(resolution.resolvedPath);
  if (!targetStat) {
    pushIssue(issues, {
      code: notFoundCode,
      file: relativeFilePath,
      field,
      message: `${field} target does not exist in bundle.`,
      value: trimmed,
      resolvedPath: resolution.resolvedPath
    });
    return null;
  }

  const typeMatched = expectedType === "directory" ? targetStat.isDirectory() : targetStat.isFile();
  if (!typeMatched) {
    pushIssue(issues, {
      code: typeCode,
      file: relativeFilePath,
      field,
      message: `${field} must resolve to a ${expectedType}.`,
      value: trimmed,
      resolvedPath: resolution.resolvedPath
    });
    return null;
  }

  return resolution.resolvedPath;
}

async function validateJsonFiles(bundleRoot, issues) {
  const targetFiles = [
    path.join(bundleRoot, "manifest.json"),
    path.join(bundleRoot, "entries", "index.json")
  ];

  for (const relativeRoot of JSON_SCAN_ROOTS) {
    const files = await listFilesRecursively(path.join(bundleRoot, relativeRoot));
    targetFiles.push(...files.filter((filePath) => filePath.endsWith(".json")));
  }

  const uniqueFiles = Array.from(new Set(targetFiles)).sort();
  let parsedCount = 0;

  for (const filePath of uniqueFiles) {
    const stat = await safeStat(filePath);
    if (!stat || !stat.isFile()) {
      pushIssue(issues, {
        code: "MISSING_JSON_FILE",
        file: toRelativePath(bundleRoot, filePath),
        message: "Required JSON file is missing from bundle."
      });
      continue;
    }

    try {
      JSON.parse(await fs.readFile(filePath, "utf8"));
      parsedCount += 1;
    } catch (error) {
      pushIssue(issues, {
        code: "INVALID_JSON_FILE",
        file: toRelativePath(bundleRoot, filePath),
        message: `JSON parse failed: ${error?.message || "json_parse_failed"}.`
      });
    }
  }

  return {
    fileCount: uniqueFiles.length,
    parsedCount
  };
}

async function validateTsvFiles(bundleRoot, issues) {
  const files = [];
  for (const relativeRoot of TSV_SCAN_ROOTS) {
    const discovered = await listFilesRecursively(path.join(bundleRoot, relativeRoot));
    files.push(...discovered.filter((filePath) => filePath.endsWith(".tsv")));
  }

  const uniqueFiles = Array.from(new Set(files)).sort();
  if (uniqueFiles.length === 0) {
    pushIssue(issues, {
      code: "MISSING_TSV_FILES",
      file: "metadata",
      message: "Bundle metadata directory does not contain any TSV files."
    });
  }

  let validCount = 0;
  for (const filePath of uniqueFiles) {
    const relativePath = toRelativePath(bundleRoot, filePath);
    const content = await fs.readFile(filePath, "utf8");
    const lines = content
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      pushIssue(issues, {
        code: "EMPTY_TSV_FILE",
        file: relativePath,
        message: "TSV file must contain a header row."
      });
      continue;
    }

    const headers = lines[0].split("\t").map((item) => item.trim());
    if (headers.some((header) => !header)) {
      pushIssue(issues, {
        code: "INVALID_TSV_HEADER",
        file: relativePath,
        message: "TSV header row contains empty column names."
      });
      continue;
    }

    validCount += 1;
  }

  return {
    fileCount: uniqueFiles.length,
    validCount
  };
}

async function validateSceneConfigDocument({
  document,
  filePath,
  bundleRoot,
  runtimeRoot,
  issues
}) {
  const relativeFilePath = toRelativePath(bundleRoot, filePath);
  const scene = toTrimmedString(document?.scene);

  if (!isObject(document)) {
    pushIssue(issues, {
      code: "INVALID_SCENE_CONFIG_DOCUMENT",
      file: relativeFilePath,
      message: "Scene config must be a JSON object."
    });
    return {
      scene: null,
      executionMode: null,
      document
    };
  }

  if (!scene) {
    pushIssue(issues, {
      code: "MISSING_SCENE_NAME",
      file: relativeFilePath,
      message: "Scene config must define scene."
    });
  } else {
    const expectedFileName = `${scene}.json`;
    if (path.basename(filePath) !== expectedFileName) {
      pushIssue(issues, {
        code: "SCENE_CONFIG_FILENAME_MISMATCH",
        file: relativeFilePath,
        field: "scene",
        message: `Scene config file name must match ${expectedFileName}.`
      });
    }
  }

  if (document?.enabled !== true) {
    pushIssue(issues, {
      code: "SCENE_CONFIG_NOT_ENABLED",
      file: relativeFilePath,
      field: "enabled",
      message: "Scene config must be explicitly enabled."
    });
  }

  if (!isObject(document?.request?.bizParams)) {
    pushIssue(issues, {
      code: "MISSING_SCENE_BIZ_PARAMS",
      file: relativeFilePath,
      field: "request.bizParams",
      message: "Scene config must define request.bizParams."
    });
  }

  const references = Array.isArray(document.references) ? document.references : [];
  for (const [index, reference] of references.entries()) {
    const referenceId = toTrimmedString(reference?.id);
    const referenceField = `references[${index}].path`;

    if (!isObject(reference) || !referenceId) {
      pushIssue(issues, {
        code: "INVALID_SCENE_REFERENCE",
        file: relativeFilePath,
        field: `references[${index}]`,
        message: "Scene config references must define id and path."
      });
      continue;
    }

    await ensureBundleReferencePath({
      reference: reference.path,
      bundleRoot,
      runtimeRoot,
      filePath,
      field: referenceField,
      expectedType: "file",
      issues,
      missingCode: "MISSING_SCENE_REFERENCE_PATH",
      notFoundCode: "MISSING_SCENE_REFERENCE_TARGET"
    });
  }

  const executionMode = toTrimmedString(document?.execution?.mode) || "agent-runtime";

  if (executionMode === "agent-runtime") {
    const routingMode = toTrimmedString(document?.routing?.mode) || "langgraph";
    if (routingMode !== "langgraph") {
      pushIssue(issues, {
        code: "RETIRED_AGENT_RUNTIME_LEGACY_ROUTING",
        file: relativeFilePath,
        field: "routing.mode",
        message: "Agent-runtime legacy routing has been retired; use routing.mode=langgraph.",
        value: routingMode
      });
    }

    if (!toTrimmedString(document?.agent?.id) || !toTrimmedString(document?.agent?.gatewayModel)) {
      pushIssue(issues, {
        code: "MISSING_SCENE_AGENT",
        file: relativeFilePath,
        field: "agent",
        message: "Agent-runtime scene must define agent.id and agent.gatewayModel."
      });
    }

    const gatewayModel = toTrimmedString(document?.agent?.gatewayModel);
    if (gatewayModel.startsWith(RETIRED_AGENT_GATEWAY_MODEL_PREFIX)) {
      pushIssue(issues, {
        code: "RETIRED_AGENT_GATEWAY_MODEL",
        file: relativeFilePath,
        field: "agent.gatewayModel",
        message: "Agent-runtime scene must not use a retired agent gatewayModel.",
        value: gatewayModel
      });
    }

    if (!toTrimmedString(document?.runtime?.requestKind)) {
      pushIssue(issues, {
        code: "MISSING_RUNTIME_REQUEST_KIND",
        file: relativeFilePath,
        field: "runtime.requestKind",
        message: "Agent-runtime scene must define runtime.requestKind."
      });
    }

    if (!toTrimmedString(document?.runtime?.requestMarkers?.begin) || !toTrimmedString(document?.runtime?.requestMarkers?.end)) {
      pushIssue(issues, {
        code: "MISSING_RUNTIME_REQUEST_MARKERS",
        file: relativeFilePath,
        field: "runtime.requestMarkers",
        message: "Agent-runtime scene must define runtime.requestMarkers.begin/end."
      });
    }

    if (!toTrimmedString(document?.runtime?.resultMarkers?.begin) || !toTrimmedString(document?.runtime?.resultMarkers?.end)) {
      pushIssue(issues, {
        code: "MISSING_RUNTIME_RESULT_MARKERS",
        file: relativeFilePath,
        field: "runtime.resultMarkers",
        message: "Agent-runtime scene must define runtime.resultMarkers.begin/end."
      });
    }

    if (!toTrimmedString(document?.skill?.id)) {
      pushIssue(issues, {
        code: "MISSING_SCENE_SKILL_ID",
        file: relativeFilePath,
        field: "skill.id",
        message: "Agent-runtime scene must define skill.id."
      });
    }

    if (!Array.isArray(document?.tools) || document.tools.length === 0) {
      pushIssue(issues, {
        code: "MISSING_SCENE_TOOLS",
        file: relativeFilePath,
        field: "tools",
        message: "Agent-runtime scene must define at least one tool."
      });
    }

    await ensureBundleReferencePath({
      reference: document?.skill?.workspacePath,
      bundleRoot,
      runtimeRoot,
      filePath,
      field: "skill.workspacePath",
      expectedType: "directory",
      issues,
      missingCode: "MISSING_SKILL_WORKSPACE_PATH"
    });
    await ensureBundleReferencePath({
      reference: document?.skill?.entryFile,
      bundleRoot,
      runtimeRoot,
      filePath,
      field: "skill.entryFile",
      expectedType: "file",
      issues,
      missingCode: "MISSING_SKILL_ENTRY_FILE"
    });
  } else {
    pushIssue(issues, {
      code: "UNSUPPORTED_SCENE_EXECUTION_MODE",
      file: relativeFilePath,
      field: "execution.mode",
      message: `Unsupported scene execution mode: ${executionMode}; use agent-runtime.`
    });
  }

  return {
    scene,
    executionMode,
    document
  };
}

async function loadAndValidateSceneConfigs(bundleRoot, issues) {
  const sceneConfigDir = path.join(bundleRoot, "scene-configs");
  const files = (await listFilesRecursively(sceneConfigDir)).filter((filePath) => filePath.endsWith(".json"));

  if (files.length === 0) {
    pushIssue(issues, {
      code: "MISSING_SCENE_CONFIGS",
      file: "scene-configs",
      message: "Bundle does not contain any scene config JSON files."
    });
  }

  const sceneConfigs = [];
  const seenScenes = new Map();
  const counts = {
    total: 0,
    agentRuntime: 0
  };

  for (const filePath of files) {
    let document;
    try {
      document = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      pushIssue(issues, {
        code: "INVALID_SCENE_CONFIG_JSON",
        file: toRelativePath(bundleRoot, filePath),
        message: `Scene config JSON parse failed: ${error?.message || "json_parse_failed"}.`
      });
      continue;
    }

    const validated = await validateSceneConfigDocument({
      document,
      filePath,
      bundleRoot,
      runtimeRoot: path.join(bundleRoot, "runtime-assets"),
      issues
    });
    if (validated.scene) {
      if (seenScenes.has(validated.scene)) {
        pushIssue(issues, {
          code: "DUPLICATE_SCENE_CONFIG",
          file: toRelativePath(bundleRoot, filePath),
          field: "scene",
          message: `Duplicate scene config found for ${validated.scene}.`,
          previousFile: seenScenes.get(validated.scene)
        });
      } else {
        seenScenes.set(validated.scene, toRelativePath(bundleRoot, filePath));
      }
    }

    counts.total += 1;
    if (validated.executionMode === "agent-runtime") {
      counts.agentRuntime += 1;
    }

    sceneConfigs.push(validated);
  }

  return {
    files,
    sceneConfigs,
    counts
  };
}

async function validateSkillDocumentPaths({ record, bundleRoot, runtimeRoot, issues }) {
  const relativeFilePath = toRelativePath(bundleRoot, record.filePath);
  const document = record.document || {};
  const assetRefs = isObject(document?.spec?.assetRefs) ? document.spec.assetRefs : {};
  const knownAssetRefs = new Set();

  for (const [groupName, groupEntries] of Object.entries(assetRefs)) {
    if (!isObject(groupEntries)) {
      continue;
    }

    const refField = ASSET_REF_FIELDS[groupName];
    for (const [assetName, assetEntry] of Object.entries(groupEntries)) {
      if (!isObject(assetEntry)) {
        continue;
      }

      const refValue = refField ? toTrimmedString(assetEntry[refField]) : "";
      if (refValue) {
        knownAssetRefs.add(refValue);
      }

      await ensureBundleReferencePath({
        reference: assetEntry?.source?.path,
        bundleRoot,
        runtimeRoot,
        filePath: record.filePath,
        field: `spec.assetRefs.${groupName}.${assetName}.source.path`,
        expectedType: "file",
        issues,
        missingCode: "MISSING_SKILL_ASSET_SOURCE_PATH",
        notFoundCode: "MISSING_SKILL_ASSET_SOURCE_FILE"
      });
    }
  }

  const selectedAssetRefs = isObject(document?.spec?.nodeOverrides?.load_reference_bundle?.assetRefs)
    ? document.spec.nodeOverrides.load_reference_bundle.assetRefs
    : {};

  for (const [groupName, refs] of Object.entries(selectedAssetRefs)) {
    if (!Array.isArray(refs)) {
      continue;
    }

    for (const refValue of refs) {
      const normalizedRef = toTrimmedString(refValue);
      if (normalizedRef && !knownAssetRefs.has(normalizedRef)) {
        pushIssue(issues, {
          code: "UNKNOWN_REFERENCE_BUNDLE_ASSET_REF",
          file: relativeFilePath,
          field: `spec.nodeOverrides.load_reference_bundle.assetRefs.${groupName}`,
          message: `Selected asset ref ${normalizedRef} is not declared in spec.assetRefs.`
        });
      }
    }
  }
}

async function validateQueryDocumentPaths({ record, bundleRoot, runtimeRoot, issues }) {
  const relativeFilePath = toRelativePath(bundleRoot, record.filePath);
  const migrationSource = isObject(record?.document?.spec?.migrationSource)
    ? record.document.spec.migrationSource
    : null;

  if (!migrationSource) {
    return {
      queryHelperCount: 0
    };
  }

  const hasHelperPair = Boolean(migrationSource.helperScriptPath || migrationSource.helperManifestPath);
  if (hasHelperPair && (!migrationSource.helperScriptPath || !migrationSource.helperManifestPath)) {
    pushIssue(issues, {
      code: "INCOMPLETE_HELPER_MIGRATION_SOURCE",
      file: relativeFilePath,
      field: "spec.migrationSource",
      message: "QueryProfile migrationSource must define helperScriptPath and helperManifestPath together."
    });
  }

  for (const fieldName of HELPER_PATH_FIELDS) {
    if (!migrationSource[fieldName]) {
      continue;
    }

    await ensureBundleReferencePath({
      reference: migrationSource[fieldName],
      bundleRoot,
      runtimeRoot,
      filePath: record.filePath,
      field: `spec.migrationSource.${fieldName}`,
      expectedType: "file",
      issues,
      missingCode: "MISSING_QUERY_MIGRATION_SOURCE_PATH",
      notFoundCode:
        fieldName === "helperScriptPath"
          ? "MISSING_HELPER_SCRIPT_FILE"
          : fieldName === "helperManifestPath"
            ? "MISSING_HELPER_MANIFEST_FILE"
            : "MISSING_QUERY_MIGRATION_SOURCE_FILE"
    });
  }

  return {
    queryHelperCount: hasHelperPair ? 1 : 0
  };
}

async function loadAndValidatePlatformResources(bundleRoot, issues) {
  const platformDir = path.join(bundleRoot, "platform");
  const runtimeRoot = path.join(bundleRoot, "runtime-assets");
  let resources = null;
  let summary = null;

  try {
    resources = loadPlatformResources(platformDir);
    summary = validatePlatformConfigs({
      baseDir: platformDir,
      resources
    });
  } catch (error) {
    pushIssue(issues, {
      code: "INVALID_PLATFORM_YAML",
      file: "platform",
      message: `Platform YAML parse failed: ${error?.message || "yaml_parse_failed"}.`
    });

    return {
      resources: null,
      summary: {
        valid: false,
        counts: {
          templates: 0,
          tools: 0,
          queries: 0,
          skills: 0
        },
        issueCount: 1,
        issues: []
      },
      helperCounts: {
        queryHelperCount: 0
      }
    };
  }

  for (const issue of summary.issues || []) {
    pushIssue(issues, {
      code: issue.code || "INVALID_PLATFORM_RESOURCE",
      file: toRelativePath(bundleRoot, issue.file),
      field: issue.field || null,
      message: issue.message
    });
  }

  for (const record of resources.skills) {
    await validateSkillDocumentPaths({ record, bundleRoot, runtimeRoot, issues });
  }

  let queryHelperCount = 0;
  for (const record of resources.queries) {
    const counts = await validateQueryDocumentPaths({ record, bundleRoot, runtimeRoot, issues });
    queryHelperCount += counts.queryHelperCount;
  }

  return {
    resources,
    summary,
    helperCounts: {
      queryHelperCount
    }
  };
}

async function validateHelperScriptEntries({ bundleRoot, entries, issues }) {
  const helperEntries = Array.isArray(entries)
    ? entries.filter((entry) => entry?.entryType === "helper-script")
    : [];

  for (const entry of helperEntries) {
    const scriptName = toTrimmedString(entry?.snapshotJson?.scriptName);
    if (!scriptName) {
      pushIssue(issues, {
        code: "INVALID_HELPER_SCRIPT_ENTRY",
        file: null,
        message: "Helper-script release entry is missing scriptName."
      });
      continue;
    }

    const expectedPath = path.join(bundleRoot, HELPER_SCRIPT_ROOT, scriptName);
    const stat = await safeStat(expectedPath);
    if (!stat || !stat.isFile()) {
      pushIssue(issues, {
        code: "MISSING_HELPER_SCRIPT_FILE",
        file: toRelativePath(bundleRoot, expectedPath),
        message: `Helper script ${scriptName} is missing from bundle output.`,
        entryKey: entry.entryKey
      });
    }
  }

  return {
    helperEntryCount: helperEntries.length
  };
}

function buildExpectedHelperFileReference(scriptName) {
  return `project://${HELPER_SCRIPT_ROOT.replace(/\\/g, "/")}/${scriptName}`;
}

async function readHelperScriptDefinitionHash(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const match = content.match(/definitionHash:\s*"([^"]+)"/u);
  return match ? match[1] : null;
}

async function validateHelperManifest({ bundleRoot, entries, issues }) {
  const helperEntries = Array.isArray(entries)
    ? entries.filter((entry) => entry?.entryType === "helper-script")
    : [];
  const manifestPath = path.join(bundleRoot, HELPER_MANIFEST_PATH);
  const manifestStat = await safeStat(manifestPath);

  if (!manifestStat || !manifestStat.isFile()) {
    if (helperEntries.length > 0) {
      pushIssue(issues, {
        code: "MISSING_HELPER_MANIFEST_FILE",
        file: HELPER_MANIFEST_PATH.replace(/\\/g, "/"),
        message: "Helper manifest is missing from bundle output."
      });
    }

    return {
      manifestEntryCount: 0
    };
  }

  let manifest = {};
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    pushIssue(issues, {
      code: "INVALID_HELPER_MANIFEST_JSON",
      file: HELPER_MANIFEST_PATH.replace(/\\/g, "/"),
      message: `Helper manifest JSON parse failed: ${error?.message || "json_parse_failed"}.`
    });

    return {
      manifestEntryCount: 0
    };
  }

  const runtimeRoot = path.join(bundleRoot, "runtime-assets");

  for (const entry of helperEntries) {
    const scene = toTrimmedString(entry?.snapshotJson?.scene);
    const scriptName = toTrimmedString(entry?.snapshotJson?.scriptName);
    const manifestEntry = isObject(manifest?.[scene]) ? manifest[scene] : null;

    if (!scene || !scriptName) {
      continue;
    }

    if (!manifestEntry) {
      pushIssue(issues, {
        code: "MISSING_HELPER_MANIFEST_ENTRY",
        file: HELPER_MANIFEST_PATH.replace(/\\/g, "/"),
        field: scene,
        message: `Helper manifest is missing the ${scene} entry.`
      });
      continue;
    }

    await ensureBundleReferencePath({
      reference: manifestEntry.skillPath,
      bundleRoot,
      runtimeRoot,
      filePath: manifestPath,
      field: `${scene}.skillPath`,
      expectedType: "file",
      issues,
      missingCode: "MISSING_HELPER_MANIFEST_SKILL_PATH",
      notFoundCode: "MISSING_HELPER_MANIFEST_SKILL_FILE"
    });
    const declaredFileResolvedPath = await ensureBundleReferencePath({
      reference: manifestEntry.declaredFilePath,
      bundleRoot,
      runtimeRoot,
      filePath: manifestPath,
      field: `${scene}.declaredFilePath`,
      expectedType: "file",
      issues,
      missingCode: "MISSING_HELPER_MANIFEST_DECLARED_PATH",
      notFoundCode: "MISSING_HELPER_MANIFEST_DECLARED_FILE"
    });
    const helperFileResolvedPath = await ensureBundleReferencePath({
      reference: manifestEntry.filePath,
      bundleRoot,
      runtimeRoot,
      filePath: manifestPath,
      field: `${scene}.filePath`,
      expectedType: "file",
      issues,
      missingCode: "MISSING_HELPER_MANIFEST_FILE_PATH",
      notFoundCode: "MISSING_HELPER_MANIFEST_SCRIPT_FILE"
    });

    const expectedReference = buildExpectedHelperFileReference(scriptName);
    if (normalizeBundlePathReference(manifestEntry.filePath) !== expectedReference) {
      pushIssue(issues, {
        code: "HELPER_MANIFEST_FILE_PATH_MISMATCH",
        file: HELPER_MANIFEST_PATH.replace(/\\/g, "/"),
        field: `${scene}.filePath`,
        message: `Helper manifest filePath for ${scene} must point to ${expectedReference}.`,
        expected: expectedReference,
        actual: manifestEntry.filePath || null
      });
    }

    if (normalizeBundlePathReference(manifestEntry.declaredFilePath) !== expectedReference) {
      pushIssue(issues, {
        code: "HELPER_MANIFEST_DECLARED_PATH_MISMATCH",
        file: HELPER_MANIFEST_PATH.replace(/\\/g, "/"),
        field: `${scene}.declaredFilePath`,
        message: `Helper manifest declaredFilePath for ${scene} must point to ${expectedReference}.`,
        expected: expectedReference,
        actual: manifestEntry.declaredFilePath || null
      });
    }

    if (!toTrimmedString(manifestEntry.definitionHash)) {
      pushIssue(issues, {
        code: "MISSING_HELPER_MANIFEST_DEFINITION_HASH",
        file: HELPER_MANIFEST_PATH.replace(/\\/g, "/"),
        field: `${scene}.definitionHash`,
        message: `Helper manifest entry ${scene} must define definitionHash.`
      });
    } else if (helperFileResolvedPath) {
      const scriptDefinitionHash = await readHelperScriptDefinitionHash(helperFileResolvedPath);
      if (scriptDefinitionHash !== manifestEntry.definitionHash) {
        pushIssue(issues, {
          code: "HELPER_MANIFEST_DEFINITION_HASH_MISMATCH",
          file: HELPER_MANIFEST_PATH.replace(/\\/g, "/"),
          field: `${scene}.definitionHash`,
          message: `Helper manifest definitionHash for ${scene} does not match the rendered helper script.`,
          expected: manifestEntry.definitionHash,
          actual: scriptDefinitionHash || null
        });
      }
    }

    if (declaredFileResolvedPath && helperFileResolvedPath && declaredFileResolvedPath !== helperFileResolvedPath) {
      pushIssue(issues, {
        code: "HELPER_MANIFEST_DECLARED_TARGET_MISMATCH",
        file: HELPER_MANIFEST_PATH.replace(/\\/g, "/"),
        field: `${scene}.declaredFilePath`,
        message: `Helper manifest declaredFilePath for ${scene} must resolve to the rendered helper script.`,
        expected: helperFileResolvedPath,
        actual: declaredFileResolvedPath
      });
    }
  }

  return {
    manifestEntryCount: Object.keys(manifest).length
  };
}

function buildCompileSkillRef(sceneConfigDocument) {
  const skillId = toTrimmedString(sceneConfigDocument?.skill?.id);
  if (!skillId) {
    return null;
  }

  return {
    name: skillId,
    version: normalizeSkillVersion(sceneConfigDocument?.skill?.version)
  };
}

async function validateCompilePreview({ bundleRoot, resources, sceneConfigs, issues }) {
  const platformDir = path.join(bundleRoot, "platform");
  const counts = {
    validated: 0,
    skipped: 0
  };

  if (!resources) {
    if (sceneConfigs.some((item) => item.executionMode === "agent-runtime")) {
      pushIssue(issues, {
        code: "COMPILE_PREVIEW_UNAVAILABLE",
        file: "platform",
        message: "Compile preview validation could not run because platform resources failed to load."
      });
    }
    return counts;
  }

  for (const sceneConfig of sceneConfigs) {
    if (sceneConfig.executionMode !== "agent-runtime") {
      counts.skipped += 1;
      continue;
    }

    try {
      const compileSummary = compileWorkflowGraphForScene({
        scene: sceneConfig.scene,
        baseDir: platformDir,
        resources,
        skillRef: buildCompileSkillRef(sceneConfig.document)
      });

      if (!Array.isArray(compileSummary.orderedNodeIds) || compileSummary.orderedNodeIds.length === 0) {
        pushIssue(issues, {
          code: "EMPTY_COMPILE_PREVIEW",
          file: path.join("scene-configs", `${sceneConfig.scene}.json`),
          message: `Compile preview for ${sceneConfig.scene} did not produce any workflow nodes.`
        });
        continue;
      }

      counts.validated += 1;
    } catch (error) {
      pushIssue(issues, {
        code: "COMPILE_PREVIEW_FAILED",
        file: path.join("scene-configs", `${sceneConfig.scene}.json`),
        message: `Compile preview failed for ${sceneConfig.scene}: ${error?.message || "compile_failed"}.`,
        details: error?.details || null
      });
    }
  }

  return counts;
}

class ReleaseValidator {
  constructor(options = {}) {
    this.projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
  }

  async validateRelease({ release, entries = [] } = {}) {
    const releaseId = toTrimmedString(release?.releaseId);
    const bundleRoot = toTrimmedString(release?.bundlePath);

    if (!releaseId || !bundleRoot) {
      throw createAppError("INVALID_REQUEST", "release.releaseId and release.bundlePath are required.", {
        stage: "release-validator"
      });
    }

    const normalizedBundleRoot = path.resolve(bundleRoot);
    const issues = [];

    const sceneSummary = await loadAndValidateSceneConfigs(normalizedBundleRoot, issues);
    const platformSummary = await loadAndValidatePlatformResources(normalizedBundleRoot, issues);
    const jsonSummary = await validateJsonFiles(normalizedBundleRoot, issues);
    const tsvSummary = await validateTsvFiles(normalizedBundleRoot, issues);
    const helperEntrySummary = await validateHelperScriptEntries({
      bundleRoot: normalizedBundleRoot,
      entries,
      issues
    });
    const helperManifestSummary = await validateHelperManifest({
      bundleRoot: normalizedBundleRoot,
      entries,
      issues
    });
    const compileSummary = await validateCompilePreview({
      bundleRoot: normalizedBundleRoot,
      resources: platformSummary.resources,
      sceneConfigs: sceneSummary.sceneConfigs,
      issues
    });

    return {
      valid: issues.length === 0,
      releaseId,
      bundlePath: normalizedBundleRoot,
      sceneConfigs: sceneSummary.counts,
      platformResources: cloneJson(platformSummary.summary?.counts || {
        templates: 0,
        tools: 0,
        queries: 0,
        skills: 0
      }),
      jsonFiles: jsonSummary,
      tsvFiles: tsvSummary,
      compilePreview: compileSummary,
      helperScripts: {
        releaseEntries: helperEntrySummary.helperEntryCount,
        queryProfiles: platformSummary.helperCounts.queryHelperCount,
        manifestEntries: helperManifestSummary.manifestEntryCount
      },
      issueCount: issues.length,
      issues
    };
  }

  async assertValid(input) {
    const summary = await this.validateRelease(input);
    if (!summary.valid) {
      throw createAppError("INVALID_REQUEST", "Release preflight validation failed.", {
        stage: "release-validator",
        details: summary
      });
    }

    return summary;
  }
}

function createReleaseValidator(options = {}) {
  return new ReleaseValidator(options);
}

module.exports = {
  ReleaseValidator,
  createReleaseValidator
};
