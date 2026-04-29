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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertPathInside(rootPath, targetPath, label) {
  const relativePath = path.relative(rootPath, targetPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} is outside active bundle: ${targetPath}`);
  }
}

async function ensureActiveBundle(manager, store) {
  const environment = manager.activeEnv;
  const currentReferencesDir = path.join(manager.getCurrentBundlePath(environment), "references");
  const pointer = await store.getReleasePointer(environment, "all", "*");

  if (pointer?.activeReleaseId && (await exists(currentReferencesDir))) {
    return {
      createdReleaseId: null,
      activeReleaseId: pointer.activeReleaseId,
      currentReferencesDir
    };
  }

  const published = await manager.publishRelease({
    environment,
    scopeType: "all",
    scopeValue: "*",
    createdBy: "codex-t4-05",
    publishNote: "activate local bundle for direct-model runtime verification"
  });

  return {
    createdReleaseId: published.release.releaseId,
    activeReleaseId: published.release.releaseId,
    currentReferencesDir
  };
}

async function main() {
  const manager = createReleaseManager();
  const store = createConfigStore({ driver: "mysql" });
  const originalFetch = global.fetch;

  try {
    const ensured = await ensureActiveBundle(manager, store);
    const sceneConfigModule = resetModule("../services/scene-config");
    const directModelModule = resetModule("../services/direct-model");

    const sourceState = sceneConfigModule.getSceneConfigSourceState();
    if (sourceState.source !== "active-bundle") {
      throw new Error(`Expected active-bundle source, got ${sourceState.source}.`);
    }

    const sceneConfig = sceneConfigModule.getSceneConfig("payment-info-split");
    const schemaReference = sceneConfig.references.find((reference) => reference.id === sceneConfig.directModel.schemaReferenceId);
    if (!schemaReference?.path) {
      throw new Error("payment-info-split schema reference is missing.");
    }

    assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, sceneConfig.directModel.promptFile, "direct-model prompt");
    assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, sceneConfig.directModel.fallbackModelsFile, "direct-model models");
    assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, schemaReference.path, "direct-model schema");

    const refOnlyPrompt = directModelModule.__private.resolveDirectModelAssetPath({
      primaryValue: null,
      refValue: sceneConfig.directModel.promptFileRef,
      label: "direct-model prompt file",
      expectedType: "file",
      scene: sceneConfig.scene,
      extraDetails: {},
      pathState: sourceState
    });
    const refOnlySchema = directModelModule.__private.resolveDirectModelAssetPath({
      primaryValue: null,
      refValue: schemaReference.pathRef,
      label: "direct-model output schema",
      expectedType: "file",
      scene: sceneConfig.scene,
      extraDetails: {},
      pathState: sourceState
    });
    const refOnlyModels = directModelModule.__private.resolveDirectModelAssetPath({
      primaryValue: null,
      refValue: sceneConfig.directModel.fallbackModelsFileRef,
      label: "direct-model fallback models file",
      expectedType: "file",
      scene: sceneConfig.scene,
      extraDetails: {},
      pathState: sourceState
    });

    const verifySceneConfig = cloneJson(sceneConfig);
    verifySceneConfig.directModel.apiKeyEnv = "__CODEX_VERIFY_T4_05_API_KEY__";
    delete process.env.__CODEX_VERIFY_T4_05_API_KEY__;

    const credential = directModelModule.__private.resolveDirectModelCredential({
      sceneConfig: verifySceneConfig,
      directModelConfig: verifySceneConfig.directModel
    });
    if (!String(credential.source || "").startsWith("models:")) {
      throw new Error(`Expected credential source from models file, got ${credential.source || "missing"}.`);
    }
    assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, credential.source.slice("models:".length), "credential models source");

    const [promptFile, schemaFile] = await Promise.all([
      fs.readFile(sceneConfig.directModel.promptFile, "utf8"),
      fs.readFile(schemaReference.path, "utf8")
    ]);
    const expectedSchema = JSON.parse(schemaFile);
    const expectedPayload = {
      payeeName: "上海测试科技有限公司",
      payeeAccount: "6222020202020202020",
      bankName: "招商银行上海分行"
    };

    const fetchCapture = {
      url: null,
      method: null,
      headers: null,
      body: null
    };
    global.fetch = async (url, options = {}) => {
      fetchCapture.url = url;
      fetchCapture.method = options.method || null;
      fetchCapture.headers = options.headers || {};
      fetchCapture.body = typeof options.body === "string" ? JSON.parse(options.body) : null;

      return {
        status: 200,
        ok: true,
        async text() {
          return JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(expectedPayload)
                }
              }
            ]
          });
        }
      };
    };

    const result = await directModelModule.runDirectModelScene({
      requestId: "verify-t4-05",
      sceneConfig: verifySceneConfig,
      bizParams: {
        rawText: "收款方：上海测试科技有限公司\n账号：6222020202020202020\n开户行：招商银行上海分行"
      }
    });

    if (result?.success !== true) {
      throw new Error(`Unexpected direct-model result: ${JSON.stringify(result)}.`);
    }
    if (JSON.stringify(result.payload) !== JSON.stringify(expectedPayload)) {
      throw new Error(`Unexpected direct-model payload: ${JSON.stringify(result.payload)}.`);
    }
    if (fetchCapture.url !== `${verifySceneConfig.directModel.baseUrl}/chat/completions`) {
      throw new Error(`Unexpected direct-model URL: ${fetchCapture.url || "missing"}.`);
    }
    if (fetchCapture.method !== "POST") {
      throw new Error(`Unexpected direct-model method: ${fetchCapture.method || "missing"}.`);
    }
    if (!String(fetchCapture.headers?.Authorization || "").startsWith("Bearer ")) {
      throw new Error("Direct-model request is missing Authorization header.");
    }
    if (fetchCapture.body?.model !== verifySceneConfig.directModel.model) {
      throw new Error(`Unexpected direct-model request model: ${fetchCapture.body?.model || "missing"}.`);
    }
    if (fetchCapture.body?.messages?.[0]?.content !== promptFile.trim()) {
      throw new Error("Direct-model request did not use the active bundle prompt.");
    }
    if (!String(fetchCapture.body?.messages?.[1]?.content || "").includes(JSON.stringify(expectedSchema))) {
      throw new Error("Direct-model request did not embed the active bundle schema.");
    }

    console.log(
      JSON.stringify(
        {
          activeEnv: manager.activeEnv,
          createdReleaseId: ensured.createdReleaseId,
          activeReleaseId: ensured.activeReleaseId,
          sceneConfigSource: sourceState.source,
          promptFile: sceneConfig.directModel.promptFile,
          schemaFile: schemaReference.path,
          modelsFile: sceneConfig.directModel.fallbackModelsFile,
          refOnlyResolutions: {
            prompt: refOnlyPrompt,
            schema: refOnlySchema,
            models: refOnlyModels
          },
          credentialSource: credential.source,
          directModelRequest: {
            url: fetchCapture.url,
            model: fetchCapture.body?.model || null,
            messageCount: Array.isArray(fetchCapture.body?.messages) ? fetchCapture.body.messages.length : 0
          },
          result
        },
        null,
        2
      )
    );
  } finally {
    global.fetch = originalFetch;
    await manager.close().catch(() => null);
    await store.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
