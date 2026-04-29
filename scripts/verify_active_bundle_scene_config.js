require("../utils/load-env").loadProjectEnv();

const fs = require("fs/promises");
const path = require("path");

const { createConfigStore } = require("../services/config-store");
const { createReleaseManager } = require("../services/release-manager");

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

async function ensureActiveBundle(manager, store) {
  const environment = manager.activeEnv;
  const currentSceneConfigDir = path.join(manager.getCurrentBundlePath(environment), "scene-configs");
  const pointer = await store.getReleasePointer(environment, "all", "*");

  if (pointer?.activeReleaseId && (await exists(currentSceneConfigDir))) {
    return {
      createdReleaseId: null,
      activeReleaseId: pointer.activeReleaseId,
      currentSceneConfigDir
    };
  }

  const published = await manager.publishRelease({
    environment,
    scopeType: "all",
    scopeValue: "*",
    createdBy: "codex-t4-01",
    publishNote: "activate local bundle for scene-config runtime verification"
  });

  return {
    createdReleaseId: published.release.releaseId,
    activeReleaseId: published.release.releaseId,
    currentSceneConfigDir
  };
}

function assertPathInside(rootPath, targetPath, label) {
  const relativePath = path.relative(rootPath, targetPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} is outside active bundle: ${targetPath}`);
  }
}

async function main() {
  const manager = createReleaseManager();
  const store = createConfigStore({ driver: "mysql" });

  try {
    const ensured = await ensureActiveBundle(manager, store);
    const sceneConfigModule = resetModule("../services/scene-config");
    const routeModule = resetModule("../routes/agent");
    const sourceState = sceneConfigModule.getSceneConfigSourceState();

    if (sourceState.source !== "active-bundle") {
      throw new Error(`Expected active-bundle source, got ${sourceState.source}.`);
    }
    if (sourceState.sceneConfigDir !== sceneConfigModule.SCENE_CONFIG_DIR) {
      throw new Error("scene-config module is not reading from the configured current bundle directory.");
    }

    const advisorConfig = sceneConfigModule.getSceneConfig("sales-opportunity-advisor");
    const paymentConfig = sceneConfigModule.getSceneConfig("payment-info-split");
    const validatedRequest = routeModule.validateAgentRunRequest({
      scene: "sales-opportunity-advisor",
      bizParams: {
        opportunityId: "verify-t4-01"
      }
    });

    assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, advisorConfig.skill.entryFile, "skill.entryFile");
    assertPathInside(
      sceneConfigModule.CONFIG_CURRENT_BUNDLE,
      advisorConfig.references[0].path,
      "advisor dictionary reference"
    );
    assertPathInside(
      sceneConfigModule.CONFIG_CURRENT_BUNDLE,
      paymentConfig.directModel.promptFile,
      "payment direct-model prompt"
    );
    assertPathInside(
      sceneConfigModule.CONFIG_CURRENT_BUNDLE,
      validatedRequest.sceneConfig.skill.entryFile,
      "validated request skill.entryFile"
    );

    console.log(
      JSON.stringify(
        {
          activeEnv: manager.activeEnv,
          createdReleaseId: ensured.createdReleaseId,
          activeReleaseId: ensured.activeReleaseId,
          sceneConfigSource: sourceState.source,
          sceneConfigDir: sourceState.sceneConfigDir,
          supportedScenes: sceneConfigModule.getSupportedScenes(),
          advisorEntryFile: advisorConfig.skill.entryFile,
          paymentPromptFile: paymentConfig.directModel.promptFile
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
