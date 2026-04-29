const fs = require("fs");
const path = require("path");
const { createAppError } = require("../utils/errors");
const { PROJECT_ROOT, RUNTIME_ROOT, resolvePathReference } = require("../utils/path-resolver");

const DEFAULT_ACTIVE_ENV = "local";
const DEFAULT_BUNDLE_ROOT = path.join(PROJECT_ROOT, ".local", "runtime-bundles");
const REPOSITORY_SCENE_CONFIG_DIR = path.join(PROJECT_ROOT, "scene-configs");
const CONFIG_ACTIVE_ENV = String(process.env.CONFIG_ACTIVE_ENV || DEFAULT_ACTIVE_ENV).trim() || DEFAULT_ACTIVE_ENV;
const CONFIG_BUNDLE_ROOT = path.resolve(process.env.CONFIG_BUNDLE_ROOT || DEFAULT_BUNDLE_ROOT);
const CONFIG_CURRENT_BUNDLE = path.resolve(
  process.env.CONFIG_CURRENT_BUNDLE || path.join(CONFIG_BUNDLE_ROOT, CONFIG_ACTIVE_ENV, "current")
);
const CONFIG_PROJECT_ROOT = path.resolve(process.env.CONFIG_PROJECT_ROOT || CONFIG_CURRENT_BUNDLE);
const CONFIG_RUNTIME_ROOT = path.resolve(process.env.CONFIG_RUNTIME_ROOT || path.join(CONFIG_PROJECT_ROOT, "runtime-assets"));
const SCENE_CONFIG_DIR = path.resolve(process.env.CONFIG_SCENE_CONFIG_DIR || path.join(CONFIG_CURRENT_BUNDLE, "scene-configs"));
const BLOCKED_PATH_WARNING_CODES = new Set(["legacy-project-path", "shared-openclaw-path"]);

function getSceneConfigSourceState() {
  if (fs.existsSync(SCENE_CONFIG_DIR)) {
    const stat = fs.statSync(SCENE_CONFIG_DIR);
    if (stat.isDirectory()) {
      return {
        sceneConfigDir: SCENE_CONFIG_DIR,
        projectRoot: CONFIG_PROJECT_ROOT,
        runtimeRoot: CONFIG_RUNTIME_ROOT,
        source: "active-bundle"
      };
    }
  }

  return {
    sceneConfigDir: REPOSITORY_SCENE_CONFIG_DIR,
    projectRoot: PROJECT_ROOT,
    runtimeRoot: RUNTIME_ROOT,
    source: "repository-fallback"
  };
}

function readSceneConfigFiles() {
  const { sceneConfigDir } = getSceneConfigSourceState();
  const entries = fs.readdirSync(sceneConfigDir, {
    withFileTypes: true
  });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(sceneConfigDir, entry.name))
    .sort();
}

function validateSceneConfig(config, filePath) {
  if (!config || typeof config !== "object") {
    throw createAppError("INVALID_REQUEST", "Scene config must be a JSON object.", {
      stage: "scene-config",
      details: {
        filePath
      }
    });
  }

  if (!config.scene || typeof config.scene !== "string") {
    throw createAppError("INVALID_REQUEST", "Scene config must contain scene.", {
      stage: "scene-config",
      details: {
        filePath
      }
    });
  }

  if (config.enabled !== true) {
    throw createAppError("INVALID_REQUEST", "Scene config must be explicitly enabled.", {
      stage: "scene-config",
      details: {
        filePath,
        scene: config.scene
      }
    });
  }

  const executionMode = config.execution?.mode || "agent-runtime";

  if (executionMode === "agent-runtime") {
    if (!config.agent || typeof config.agent !== "object" || !config.agent.id || !config.agent.gatewayModel) {
      throw createAppError("INVALID_REQUEST", "Scene config must define agent.id and agent.gatewayModel.", {
        stage: "scene-config",
        details: {
          filePath,
          scene: config.scene
        }
      });
    }

    if (!config.runtime || typeof config.runtime !== "object" || !config.runtime.requestKind) {
      throw createAppError("INVALID_REQUEST", "Scene config must define runtime.requestKind.", {
        stage: "scene-config",
        details: {
          filePath,
          scene: config.scene
        }
      });
    }

    if (
      !config.runtime.requestMarkers ||
      typeof config.runtime.requestMarkers !== "object" ||
      !config.runtime.requestMarkers.begin ||
      !config.runtime.requestMarkers.end
    ) {
      throw createAppError("INVALID_REQUEST", "Scene config must define runtime.requestMarkers.begin/end.", {
        stage: "scene-config",
        details: {
          filePath,
          scene: config.scene
        }
      });
    }

    if (
      !config.runtime.resultMarkers ||
      typeof config.runtime.resultMarkers !== "object" ||
      !config.runtime.resultMarkers.begin ||
      !config.runtime.resultMarkers.end
    ) {
      throw createAppError("INVALID_REQUEST", "Scene config must define runtime.resultMarkers.begin/end.", {
        stage: "scene-config",
        details: {
          filePath,
          scene: config.scene
        }
      });
    }

    if (!config.skill || typeof config.skill !== "object" || !config.skill.id) {
      throw createAppError("INVALID_REQUEST", "Scene config must define skill.id.", {
        stage: "scene-config",
        details: {
          filePath,
          scene: config.scene
        }
      });
    }

    if (!Array.isArray(config.tools) || config.tools.length === 0) {
      throw createAppError("INVALID_REQUEST", "Scene config must define at least one tool.", {
        stage: "scene-config",
        details: {
          filePath,
          scene: config.scene
        }
      });
    }
  } else if (executionMode === "direct-model") {
    if (!config.directModel || typeof config.directModel !== "object") {
      throw createAppError("INVALID_REQUEST", "Direct-model scene must define directModel.", {
        stage: "scene-config",
        details: {
          filePath,
          scene: config.scene
        }
      });
    }

    if (!config.directModel.provider || !config.directModel.model) {
      throw createAppError("INVALID_REQUEST", "directModel.provider and directModel.model are required.", {
        stage: "scene-config",
        details: {
          filePath,
          scene: config.scene
        }
      });
    }

    if (!config.directModel.promptFile) {
      throw createAppError("INVALID_REQUEST", "directModel.promptFile is required.", {
        stage: "scene-config",
        details: {
          filePath,
          scene: config.scene
        }
      });
    }

    if (!config.directModel.schemaReferenceId) {
      throw createAppError("INVALID_REQUEST", "directModel.schemaReferenceId is required.", {
        stage: "scene-config",
        details: {
          filePath,
          scene: config.scene
        }
      });
    }
  } else {
    throw createAppError("INVALID_REQUEST", `Unsupported scene execution mode: ${executionMode}.`, {
      stage: "scene-config",
      details: {
        filePath,
        scene: config.scene
      }
    });
  }

  if (
    !config.request ||
    typeof config.request !== "object" ||
    !config.request.bizParams ||
    typeof config.request.bizParams !== "object"
  ) {
    throw createAppError("INVALID_REQUEST", "Scene config must define request.bizParams.", {
      stage: "scene-config",
      details: {
        filePath,
        scene: config.scene
      }
    });
  }

  return config;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildPathResolutionError({ filePath, scene, field, originalValue, cause }) {
  return createAppError("INVALID_REQUEST", `Scene config path resolution failed for ${field}.`, {
    stage: "scene-config",
    details: {
      filePath,
      scene,
      field,
      originalValue,
      cause
    }
  });
}

function validateResolvedPathExists({ resolvedPath, expectedType, filePath, scene, field }) {
  if (!fs.existsSync(resolvedPath)) {
    throw createAppError("INVALID_REQUEST", `Scene config path not found for ${field}.`, {
      stage: "scene-config",
      details: {
        filePath,
        scene,
        field,
        resolvedPath,
        expectedType
      }
    });
  }

  const stat = fs.statSync(resolvedPath);
  const typeMatched = expectedType === "directory" ? stat.isDirectory() : stat.isFile();

  if (!typeMatched) {
    throw createAppError("INVALID_REQUEST", `Scene config path type mismatch for ${field}.`, {
      stage: "scene-config",
      details: {
        filePath,
        scene,
        field,
        resolvedPath,
        expectedType
      }
    });
  }
}

function applyResolvedPath(target, fieldName, resolution) {
  target[fieldName] = resolution.resolvedPath;
  target[`${fieldName}Ref`] = resolution.original;
  target[`${fieldName}SourceType`] = resolution.sourceType;
  target[`${fieldName}Warnings`] = resolution.warnings;
}

function getBlockedPathWarnings(warnings) {
  return Array.isArray(warnings)
    ? warnings.filter((warning) => BLOCKED_PATH_WARNING_CODES.has(warning?.code))
    : [];
}

function assertNoBlockedPathWarnings({ warnings, filePath, scene, field, originalValue }) {
  const blockedWarnings = getBlockedPathWarnings(warnings);
  if (blockedWarnings.length === 0) {
    return;
  }

  throw createAppError("INVALID_REQUEST", `Legacy runtime path is not allowed for ${field}.`, {
    stage: "scene-config",
    details: {
      filePath,
      scene,
      field,
      originalValue,
      blockedWarnings
    }
  });
}

function resolveConfigPathField({ target, fieldName, expectedType, filePath, scene, warnings, pathState }) {
  if (!target || typeof target !== "object" || typeof target[fieldName] !== "string" || target[fieldName].trim().length === 0) {
    return;
  }

  let resolution;
  try {
    resolution = resolvePathReference(target[fieldName], {
      projectRoot: pathState.projectRoot,
      runtimeRoot: pathState.runtimeRoot
    });
  } catch (error) {
    throw buildPathResolutionError({
      filePath,
      scene,
      field: fieldName,
      originalValue: target[fieldName],
      cause: error?.message || "resolve_failed"
    });
  }

  assertNoBlockedPathWarnings({
    warnings: resolution.warnings,
    filePath,
    scene,
    field: fieldName,
    originalValue: target[fieldName]
  });

  validateResolvedPathExists({
    resolvedPath: resolution.resolvedPath,
    expectedType,
    filePath,
    scene,
    field: fieldName
  });

  applyResolvedPath(target, fieldName, resolution);
  warnings.push(...resolution.warnings.map((warning) => ({
    ...warning,
    field: fieldName
  })));
}

function resolveReferencePaths(config, filePath, warnings, pathState) {
  if (!Array.isArray(config.references)) {
    return;
  }

  config.references = config.references.map((reference, index) => {
    if (!reference || typeof reference !== "object" || typeof reference.path !== "string" || reference.path.trim().length === 0) {
      return reference;
    }

    let resolution;
    try {
      resolution = resolvePathReference(reference.path, {
        projectRoot: pathState.projectRoot,
        runtimeRoot: pathState.runtimeRoot
      });
    } catch (error) {
      throw buildPathResolutionError({
        filePath,
        scene: config.scene,
        field: `references[${index}].path`,
        originalValue: reference.path,
        cause: error?.message || "resolve_failed"
      });
    }

    assertNoBlockedPathWarnings({
      warnings: resolution.warnings,
      filePath,
      scene: config.scene,
      field: `references[${index}].path`,
      originalValue: reference.path
    });

    validateResolvedPathExists({
      resolvedPath: resolution.resolvedPath,
      expectedType: "file",
      filePath,
      scene: config.scene,
      field: `references[${index}].path`
    });

    warnings.push(...resolution.warnings.map((warning) => ({
      ...warning,
      field: `references[${index}].path`
    })));

    return {
      ...reference,
      path: resolution.resolvedPath,
      pathRef: resolution.original,
      pathSourceType: resolution.sourceType,
      pathWarnings: resolution.warnings
    };
  });
}

function resolveSceneConfigPaths(config, filePath) {
  const resolvedConfig = cloneJson(config);
  const warnings = [];
  const pathState = getSceneConfigSourceState();

  resolveConfigPathField({
    target: resolvedConfig.skill,
    fieldName: "workspacePath",
    expectedType: "directory",
    filePath,
    scene: resolvedConfig.scene,
    warnings,
    pathState
  });
  resolveConfigPathField({
    target: resolvedConfig.skill,
    fieldName: "entryFile",
    expectedType: "file",
    filePath,
    scene: resolvedConfig.scene,
    warnings,
    pathState
  });
  resolveConfigPathField({
    target: resolvedConfig.directModel,
    fieldName: "promptFile",
    expectedType: "file",
    filePath,
    scene: resolvedConfig.scene,
    warnings,
    pathState
  });
  resolveConfigPathField({
    target: resolvedConfig.directModel,
    fieldName: "fallbackModelsFile",
    expectedType: "file",
    filePath,
    scene: resolvedConfig.scene,
    warnings,
    pathState
  });
  resolveReferencePaths(resolvedConfig, filePath, warnings, pathState);

  resolvedConfig.pathResolutionWarnings = warnings;
  return resolvedConfig;
}

function loadSceneConfigs() {
  const sceneConfigs = {};

  for (const filePath of readSceneConfigFiles()) {
    const rawContent = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(rawContent);
    const validated = validateSceneConfig(parsed, filePath);
    sceneConfigs[validated.scene] = resolveSceneConfigPaths(validated, filePath);
  }

  return sceneConfigs;
}

function getSceneConfigs() {
  return loadSceneConfigs();
}

function getSupportedScenes() {
  return Object.keys(loadSceneConfigs());
}

function getSceneConfig(scene) {
  const configs = loadSceneConfigs();
  const config = configs[scene];

  if (!config) {
    throw createAppError("INVALID_REQUEST", `Unsupported scene: ${scene}.`, {
      stage: "request-validate"
    });
  }

  return config;
}

module.exports = {
  CONFIG_ACTIVE_ENV,
  CONFIG_BUNDLE_ROOT,
  CONFIG_CURRENT_BUNDLE,
  CONFIG_PROJECT_ROOT,
  CONFIG_RUNTIME_ROOT,
  REPOSITORY_SCENE_CONFIG_DIR,
  SCENE_CONFIG_DIR,
  getSceneConfig,
  getSceneConfigs,
  getSceneConfigSourceState,
  getSupportedScenes,
  resolveSceneConfigPaths
};
