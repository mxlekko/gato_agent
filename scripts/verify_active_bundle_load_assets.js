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

function assertPathInside(rootPath, targetPath, label) {
  const relativePath = path.relative(rootPath, targetPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} is outside active bundle: ${targetPath}`);
  }
}

async function ensureActiveBundle(manager, store) {
  const environment = manager.activeEnv;
  const currentRuntimeDir = path.join(manager.getCurrentBundlePath(environment), "runtime-assets");
  const pointer = await store.getReleasePointer(environment, "all", "*");

  if (pointer?.activeReleaseId && (await exists(currentRuntimeDir))) {
    return {
      createdReleaseId: null,
      activeReleaseId: pointer.activeReleaseId,
      currentRuntimeDir
    };
  }

  const published = await manager.publishRelease({
    environment,
    scopeType: "all",
    scopeValue: "*",
    createdBy: "codex-t4-04",
    publishNote: "activate local bundle for load-assets runtime verification"
  });

  return {
    createdReleaseId: published.release.releaseId,
    activeReleaseId: published.release.releaseId,
    currentRuntimeDir
  };
}

async function main() {
  const manager = createReleaseManager();
  const store = createConfigStore({ driver: "mysql" });

  try {
    const ensured = await ensureActiveBundle(manager, store);
    const sceneConfigModule = resetModule("../services/scene-config");
    const validateModule = resetModule("../platform/compiler/validate");
    const compileModule = resetModule("../platform/compiler/compile-workflow");
    const stateModule = resetModule("../platform/runtime/state");
    const loadAssetsModule = resetModule("../platform/nodes/load-assets");

    const sceneSourceState = sceneConfigModule.getSceneConfigSourceState();
    const platformSourceState = validateModule.getPlatformResourceSourceState();
    if (sceneSourceState.source !== "active-bundle") {
      throw new Error(`Expected active-bundle scene source, got ${sceneSourceState.source}.`);
    }
    if (platformSourceState.source !== "active-bundle") {
      throw new Error(`Expected active-bundle platform source, got ${platformSourceState.source}.`);
    }

    const scene = "sales-opportunity-advisor";
    const sceneConfig = sceneConfigModule.getSceneConfig(scene);
    const graph = compileModule.compileWorkflowGraphForScene({ scene });
    const initialState = stateModule.createInitialWorkflowState({
      requestId: "verify-t4-04",
      scene,
      sceneConfig,
      bizParams: {
        opportunityId: "verify-t4-04-opportunity"
      },
      workflowBinding: graph.workflowBinding
    });

    const nextState = await loadAssetsModule.runLoadAssetsNode({
      state: initialState
    });

    const referenceMeta = nextState?.artifacts?.reference_meta || {};
    const references = nextState?.artifacts?.references || {};
    const outputSummary = nextState?.artifacts?.outputs?.load_assets || {};

    const requiredKeys = ["prompt", "output_schema", "dictionary", "rules"];
    for (const key of requiredKeys) {
      if (!(key in references)) {
        throw new Error(`Missing loaded reference ${key}.`);
      }
      if (!referenceMeta[key]?.path) {
        throw new Error(`Missing loaded reference_meta path for ${key}.`);
      }
      assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, referenceMeta[key].path, `${key} asset`);
    }

    if (referenceMeta.prompt.path_ref !== "project://platform/assets/prompts/sales-opportunity-advisor.draft-business-output.v1.md") {
      throw new Error(`Unexpected prompt path_ref: ${referenceMeta.prompt.path_ref || "missing"}.`);
    }
    if (referenceMeta.output_schema.path_ref !== "runtime://openclaw/workspace/skills/sales-opportunity-advisor/references/output_schema.json") {
      throw new Error(`Unexpected output_schema path_ref: ${referenceMeta.output_schema.path_ref || "missing"}.`);
    }
    if (referenceMeta.dictionary.path_ref !== "project://metadata/sales_opportunity_dictionary.tsv") {
      throw new Error(`Unexpected dictionary path_ref: ${referenceMeta.dictionary.path_ref || "missing"}.`);
    }
    if (referenceMeta.rules.path_ref !== "runtime://openclaw/workspace/skills/sales-opportunity-advisor/references/decision_rules.md") {
      throw new Error(`Unexpected rules path_ref: ${referenceMeta.rules.path_ref || "missing"}.`);
    }

    const [promptFile, schemaFile, dictionaryFile, rulesFile] = await Promise.all([
      fs.readFile(referenceMeta.prompt.path, "utf8"),
      fs.readFile(referenceMeta.output_schema.path, "utf8"),
      fs.readFile(referenceMeta.dictionary.path, "utf8"),
      fs.readFile(referenceMeta.rules.path, "utf8")
    ]);

    if (references.prompt !== promptFile) {
      throw new Error("Loaded prompt content does not match active bundle file.");
    }
    if (JSON.stringify(references.output_schema) !== JSON.stringify(JSON.parse(schemaFile))) {
      throw new Error("Loaded output schema does not match active bundle file.");
    }
    if (references.dictionary !== dictionaryFile) {
      throw new Error("Loaded dictionary content does not match active bundle file.");
    }
    if (references.rules !== rulesFile) {
      throw new Error("Loaded rules content does not match active bundle file.");
    }

    if (outputSummary.loaded !== true || outputSummary.asset_count !== 4) {
      throw new Error(`Unexpected load-assets summary: ${JSON.stringify(outputSummary)}.`);
    }
    if ((outputSummary.categories?.prompts || []).length !== 1
      || (outputSummary.categories?.schemas || []).length !== 1
      || (outputSummary.categories?.dictionaries || []).length !== 1
      || (outputSummary.categories?.rules || []).length !== 1) {
      throw new Error(`Unexpected category counts: ${JSON.stringify(outputSummary.categories)}.`);
    }

    console.log(
      JSON.stringify(
        {
          activeEnv: manager.activeEnv,
          createdReleaseId: ensured.createdReleaseId,
          activeReleaseId: ensured.activeReleaseId,
          sceneConfigSource: sceneSourceState.source,
          platformSource: platformSourceState.source,
          orderedNodeIds: graph.orderedNodeIds,
          loadAssetsSummary: outputSummary,
          referenceMeta
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
