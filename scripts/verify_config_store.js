require("../utils/load-env").loadProjectEnv();

const { createConfigStore } = require("../services/config-store");

function dumpYamlLike(document) {
  return [
    "apiVersion: agent.platform/v1alpha1",
    `kind: ${document.kind}`,
    "metadata:",
    `  name: ${document.metadata.name}`,
    `  version: ${document.metadata.version}`,
    `  status: ${document.metadata.status}`,
    "spec:",
    `  ref: ${document.spec.ref}`,
    "  limits:",
    `    timeoutMsDefault: ${document.spec.limits.timeoutMsDefault}`,
    `    timeoutMsMax: ${document.spec.limits.timeoutMsMax}`,
    `    retryMaxAttempts: ${document.spec.limits.retryMaxAttempts}`
  ].join("\n");
}

async function verifyFileStore() {
  const store = createConfigStore({ driver: "file" });
  try {
    const scenes = await store.listSceneConfigs();
    const resources = await store.listPlatformResources();

    if (scenes.length === 0) {
      throw new Error("file-store should expose scene configs.");
    }
    if (resources.length === 0) {
      throw new Error("file-store should expose platform resources.");
    }

    return {
      sceneCount: scenes.length,
      resourceCount: resources.length
    };
  } finally {
    await store.close();
  }
}

async function verifyMysqlStore() {
  const store = createConfigStore({ driver: "mysql" });
  const suffix = `${Date.now()}`;
  const probeScene = `__repo_probe_scene_${suffix}`;
  const probeResourceName = `__repo_probe_query_${suffix}`;
  const probeReleaseId = `rel_repo_probe_${suffix}`;
  let releaseSaved = false;
  let pointerSaved = false;

  try {
    const sceneConfig = await store.saveSceneConfigDraft(
      {
        document: {
          scene: probeScene,
          title: "Repository Probe Scene",
          enabled: true,
	          execution: {
	            mode: "agent-runtime"
	          },
	          routing: {
	            mode: "langgraph",
	            allowedModes: ["langgraph"],
	            langgraphCutover: {
	              requestPercentage: 100
	            }
	          },
	          request: {
            bizParams: {
              rawText: {
                type: "string",
                required: true
              }
            }
          }
        },
        updatedBy: "codex-t1-02"
      },
      {
        operator: "codex-t1-02",
        changeNote: "repository verification scene config"
      }
    );

    const resourceDocument = {
      apiVersion: "agent.platform/v1alpha1",
      kind: "QueryProfile",
      metadata: {
        name: probeResourceName,
        version: "v1",
        status: "draft"
      },
      spec: {
        ref: `query://repo-probe/${suffix}@v1`,
        limits: {
          timeoutMsDefault: 1000,
          timeoutMsMax: 1000,
          retryMaxAttempts: 0
        }
      }
    };

    const platformResource = await store.savePlatformResourceDraft(
      {
        kind: "query",
        document: resourceDocument,
        sourceText: `${dumpYamlLike(resourceDocument)}\n`,
        updatedBy: "codex-t1-02"
      },
      {
        operator: "codex-t1-02",
        changeNote: "repository verification platform resource"
      }
    );

    const sceneAsset = await store.saveSceneAssetDraft(
      {
        scene: probeScene,
        assetType: "prompt",
        ref: `prompt://repo-probe/${suffix}@v1`,
        contentText: "Probe prompt body\n",
        contentFormat: "markdown",
        updatedBy: "codex-t1-02"
      },
      {
        operator: "codex-t1-02",
        changeNote: "repository verification scene asset"
      }
    );

    const helperScript = await store.saveHelperScriptDraft(
      {
        scene: probeScene,
        scriptType: "generated-query",
        scriptName: `probe-${suffix}.sql`,
        contentText: "SELECT 1 AS probe_value;\n",
        updatedBy: "codex-t1-02"
      },
      {
        operator: "codex-t1-02",
        changeNote: "repository verification helper script"
      }
    );

    const sceneRevisions = await store.listRevisions({
      targetType: "scene-config",
      targetId: sceneConfig.id,
      limit: 10
    });

    const release = await store.saveRelease({
      releaseId: probeReleaseId,
      environment: "local",
      scopeType: "scene",
      scopeValue: probeScene,
      status: "draft",
      manifest: {
        scene: probeScene
      },
      bundlePath: `/tmp/${probeReleaseId}`,
      createdBy: "codex-t1-02"
    });
    releaseSaved = true;

    const releaseEntries = await store.setReleaseEntries(probeReleaseId, [
      {
        entryType: "scene-config",
        entryKey: probeScene,
        targetId: sceneConfig.id,
        revisionId: sceneRevisions[0].id,
        snapshotText: sceneConfig.sourceText,
        snapshotJson: sceneConfig.document
      }
    ]);

    const releasePointer = await store.setReleasePointer({
      environment: "local",
      scopeType: "scene",
      scopeValue: probeScene,
      activeReleaseId: probeReleaseId,
      updatedBy: "codex-t1-02"
    });
    pointerSaved = true;

    const fetchedScene = await store.getSceneConfig(probeScene);
    const fetchedResource = await store.getPlatformResource({
      kind: "query",
      name: probeResourceName,
      version: "v1"
    });
    const fetchedAsset = await store.getSceneAsset(probeScene, "prompt");
    const fetchedHelper = await store.getHelperScript(probeScene, "generated-query");
    const fetchedRelease = await store.getRelease(probeReleaseId);
    const fetchedPointer = await store.getReleasePointer("local", "scene", probeScene);

    if (!fetchedScene || !fetchedResource || !fetchedAsset || !fetchedHelper || !fetchedRelease || !fetchedPointer) {
      throw new Error("mysql-store should read back all probe entities.");
    }

    return {
      sceneRevisionCount: sceneRevisions.length,
      releaseEntryCount: releaseEntries.length,
      releaseId: release.releaseId,
      releasePointerId: releasePointer.id,
      platformResourceId: platformResource.id,
      helperScriptId: helperScript.id,
      sceneAssetId: sceneAsset.id
    };
  } finally {
    if (pointerSaved) {
      await store.deleteReleasePointer("local", "scene", probeScene);
    }
    if (releaseSaved) {
      await store.deleteRelease(probeReleaseId);
    }

    await store.deleteHelperScript(probeScene, "generated-query");
    await store.deleteSceneAsset(probeScene, "prompt");
    await store.deletePlatformResource({
      kind: "query",
      name: probeResourceName,
      version: "v1"
    });
    await store.deleteSceneConfig(probeScene);
    await store.close();
  }
}

async function main() {
  const fileStoreSummary = await verifyFileStore();
  const mysqlStoreSummary = await verifyMysqlStore();

  console.log(
    JSON.stringify(
      {
        fileStore: fileStoreSummary,
        mysqlStore: mysqlStoreSummary
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
