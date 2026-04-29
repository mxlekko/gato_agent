require("../utils/load-env").loadProjectEnv();

const fs = require("fs/promises");
const path = require("path");

const { createConfigStore } = require("../services/config-store");
const { createReleaseManager } = require("../services/release-manager");
const { resolvePathReference } = require("../utils/path-resolver");

const SCENE = "sales-opportunity-advisor";

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

function resetModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function assertPathInside(rootPath, targetPath, label) {
  const relativePath = path.relative(rootPath, targetPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} is outside active bundle: ${targetPath}`);
  }
}

function resolveBundleManagedPath(sceneConfigModule, value) {
  if (!value) {
    throw new Error("Bundle-managed path is missing.");
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  return resolvePathReference(value, {
    projectRoot: sceneConfigModule.CONFIG_CURRENT_BUNDLE,
    runtimeRoot: sceneConfigModule.CONFIG_RUNTIME_ROOT
  }).resolvedPath;
}

async function ensureActiveBundle(manager, store) {
  const environment = manager.activeEnv;
  const currentHelperDir = path.join(manager.getCurrentBundlePath(environment), "ContextHelper", "generated-queries");
  const pointer = await store.getReleasePointer(environment, "all", "*");

  if (pointer?.activeReleaseId && (await exists(currentHelperDir))) {
    return {
      createdReleaseId: null,
      activeReleaseId: pointer.activeReleaseId,
      currentHelperDir
    };
  }

  const published = await manager.publishRelease({
    environment,
    scopeType: "all",
    scopeValue: "*",
    createdBy: "codex-t5-01",
    publishNote: "activate local bundle for context-helper generated query verification"
  });

  return {
    createdReleaseId: published.release.releaseId,
    activeReleaseId: published.release.releaseId,
    currentHelperDir
  };
}

async function main() {
  const manager = createReleaseManager();
  const store = createConfigStore({ driver: "mysql" });

  try {
    const ensured = await ensureActiveBundle(manager, store);
    const sceneConfigModule = resetModule("../services/scene-config");
    const helperModule = resetModule("../ContextHelper/services/generated-query-file");

    const sourceState = sceneConfigModule.getSceneConfigSourceState();
    if (sourceState.source !== "active-bundle") {
      throw new Error(`Expected active-bundle source, got ${sourceState.source}.`);
    }

    const expectedHelperFile = path.join(
      sceneConfigModule.CONFIG_CURRENT_BUNDLE,
      "ContextHelper",
      "generated-queries",
      `${SCENE}.generated.js`
    );
    const expectedManifestFile = path.join(
      sceneConfigModule.CONFIG_CURRENT_BUNDLE,
      "ContextHelper",
      "generated-queries",
      "manifest.json"
    );

    if (!(await exists(expectedHelperFile))) {
      throw new Error(`Expected helper script file is missing: ${expectedHelperFile}.`);
    }

    const defaultResult = await helperModule.getOrCreateHelperQueryFile();
    const explicitResult = await helperModule.getOrCreateHelperQueryFile({ scene: SCENE });
    const manifest = JSON.parse(await fs.readFile(expectedManifestFile, "utf8"));
    const manifestEntry = manifest[SCENE];
    const sceneConfig = sceneConfigModule.getSceneConfig(SCENE);

    if (defaultResult.filePath !== expectedHelperFile) {
      throw new Error(`Unexpected default helper file path: ${defaultResult.filePath || "missing"}.`);
    }
    if (explicitResult.filePath !== expectedHelperFile) {
      throw new Error(`Unexpected explicit helper file path: ${explicitResult.filePath || "missing"}.`);
    }
    if (defaultResult.sqlText !== explicitResult.sqlText) {
      throw new Error("Default and explicit scene helper resolutions returned different SQL.");
    }
    if (!/SELECT TOP 1/i.test(defaultResult.sqlText) || !/@opportunityId\b/i.test(defaultResult.sqlText)) {
      throw new Error(`Unexpected helper SQL: ${defaultResult.sqlText}.`);
    }
    if (!manifestEntry) {
      throw new Error(`Missing manifest entry for ${SCENE}.`);
    }

    const manifestSkillPath = resolveBundleManagedPath(sceneConfigModule, manifestEntry.skillPath);
    const manifestDeclaredFilePath = resolveBundleManagedPath(sceneConfigModule, manifestEntry.declaredFilePath);
    const manifestFilePath = resolveBundleManagedPath(sceneConfigModule, manifestEntry.filePath);
    const sceneSkillEntryPath = resolveBundleManagedPath(sceneConfigModule, sceneConfig.skill.entryFile);

    assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, manifestSkillPath, "manifest skillPath");
    assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, manifestDeclaredFilePath, "manifest declaredFilePath");
    assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, manifestFilePath, "manifest filePath");
    assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, sceneSkillEntryPath, "scene-config skill.entryFile");

    if (manifestFilePath !== expectedHelperFile) {
      throw new Error(`Unexpected manifest filePath: ${manifestEntry.filePath || "missing"}.`);
    }

    console.log(
      JSON.stringify(
        {
          activeEnv: manager.activeEnv,
          createdReleaseId: ensured.createdReleaseId,
          activeReleaseId: ensured.activeReleaseId,
          sceneConfigSource: sourceState.source,
          sceneConfigPath: path.join(sourceState.sceneConfigDir, `${SCENE}.json`),
          helperFile: defaultResult.filePath,
          helperSql: defaultResult.sqlText,
          manifestFile: expectedManifestFile,
          manifestEntry
        },
        null,
        2
      )
    );
  } finally {
    await manager.close().catch(() => null);
    await store.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
