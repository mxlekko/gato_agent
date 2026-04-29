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
  const currentPlatformDir = path.join(manager.getCurrentBundlePath(environment), "platform");
  const pointer = await store.getReleasePointer(environment, "all", "*");

  if (pointer?.activeReleaseId && (await exists(currentPlatformDir))) {
    return {
      createdReleaseId: null,
      activeReleaseId: pointer.activeReleaseId,
      currentPlatformDir
    };
  }

  const published = await manager.publishRelease({
    environment,
    scopeType: "all",
    scopeValue: "*",
    createdBy: "codex-t4-02",
    publishNote: "activate local bundle for platform resource verification"
  });

  return {
    createdReleaseId: published.release.releaseId,
    activeReleaseId: published.release.releaseId,
    currentPlatformDir
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
    const validateModule = resetModule("../platform/compiler/validate");
    const compileModule = resetModule("../platform/compiler/compile-workflow");
    const sceneConfigModule = resetModule("../services/scene-config");

    const sourceState = validateModule.getPlatformResourceSourceState();
    if (sourceState.source !== "active-bundle") {
      throw new Error(`Expected active-bundle source, got ${sourceState.source}.`);
    }

    const resources = validateModule.loadPlatformResources();
    const resourceCounts = {
      templates: resources.templates.length,
      skills: resources.skills.length,
      tools: resources.tools.length,
      queries: resources.queries.length
    };
    if (resourceCounts.templates === 0 || resourceCounts.skills === 0 || resourceCounts.tools === 0 || resourceCounts.queries === 0) {
      throw new Error(`Unexpected platform resource counts: ${JSON.stringify(resourceCounts)}.`);
    }

    for (const record of [...resources.templates, ...resources.skills, ...resources.tools, ...resources.queries]) {
      assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, record.filePath, "platform resource");
    }

    const validationSummary = validateModule.validatePlatformConfigs({});
    if (!validationSummary.valid) {
      throw new Error(`Expected active bundle platform validation to pass, got ${validationSummary.issueCount} issues.`);
    }

    const compileSummary = compileModule.compileWorkflowGraphForScene({
      scene: "sales-opportunity-advisor"
    });
    if (!Array.isArray(compileSummary.orderedNodeIds) || compileSummary.orderedNodeIds.length === 0) {
      throw new Error("Compile preview returned an empty workflow graph.");
    }
    if (compileSummary.skill?.name !== "sales-opportunity-advisor") {
      throw new Error(`Unexpected compiled skill: ${compileSummary.skill?.name || "missing"}.`);
    }

    console.log(
      JSON.stringify(
        {
          activeEnv: manager.activeEnv,
          createdReleaseId: ensured.createdReleaseId,
          activeReleaseId: ensured.activeReleaseId,
          platformSource: sourceState.source,
          platformBaseDir: sourceState.platformBaseDir,
          sceneConfigDir: sceneConfigModule.getSceneConfigSourceState().sceneConfigDir,
          resourceCounts,
          compileSummary: {
            scene: compileSummary.scene,
            template: compileSummary.template,
            skill: compileSummary.skill,
            orderedNodeCount: compileSummary.orderedNodeIds.length
          }
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
