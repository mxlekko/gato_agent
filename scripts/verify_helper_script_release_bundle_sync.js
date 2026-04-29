require("../utils/load-env").loadProjectEnv();

const fs = require("fs/promises");
const mysql = require("mysql2/promise");
const path = require("path");

const { createConfigStore } = require("../services/config-store");
const { createReleaseManager } = require("../services/release-manager");
const { PROJECT_ROOT } = require("../utils/path-resolver");

const VERIFY_ENV = "verifyhelper";
const SCENE = "sales-opportunity-advisor";
const SCRIPT_TYPE = "generated-query";
const UPDATED_GENERATED_AT = "2026-04-16T09:45:00.000Z";

function resetModule(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

function setBundleEnv(bundleRoot) {
  const currentBundle = path.join(bundleRoot, VERIFY_ENV, "current");
  process.env.CONFIG_BUNDLE_ROOT = bundleRoot;
  process.env.CONFIG_ACTIVE_ENV = VERIFY_ENV;
  process.env.CONFIG_CURRENT_BUNDLE = currentBundle;
  process.env.CONFIG_PROJECT_ROOT = currentBundle;
  process.env.CONFIG_RUNTIME_ROOT = path.join(currentBundle, "runtime-assets");
  process.env.CONFIG_SCENE_CONFIG_DIR = path.join(currentBundle, "scene-configs");
  return currentBundle;
}

function clearBundleEnv() {
  delete process.env.CONFIG_BUNDLE_ROOT;
  delete process.env.CONFIG_ACTIVE_ENV;
  delete process.env.CONFIG_CURRENT_BUNDLE;
  delete process.env.CONFIG_PROJECT_ROOT;
  delete process.env.CONFIG_RUNTIME_ROOT;
  delete process.env.CONFIG_SCENE_CONFIG_DIR;
}

function replaceGeneratedAt(contentText, generatedAt) {
  const replaced = String(contentText || "").replace(
    /generatedAt:\s*"[^"]+"/u,
    `generatedAt: ${JSON.stringify(generatedAt)}`
  );

  if (replaced === contentText) {
    throw new Error("Failed to replace generatedAt in helper script content.");
  }

  return replaced;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function openMysqlConnection() {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });
}

async function readCurrentHelperState(bundleRoot, scriptName) {
  const currentBundle = path.join(bundleRoot, VERIFY_ENV, "current");
  const helperScriptPath = path.join(currentBundle, "ContextHelper", "generated-queries", scriptName);
  const helperManifestPath = path.join(currentBundle, "ContextHelper", "generated-queries", "manifest.json");
  const helperScriptText = await fs.readFile(helperScriptPath, "utf8");
  const helperManifestText = await fs.readFile(helperManifestPath, "utf8");
  const helperManifest = JSON.parse(helperManifestText);

  return {
    currentBundle,
    helperScriptPath,
    helperManifestPath,
    helperScriptText,
    helperManifestText,
    helperManifest,
    advisorManifestEntry: helperManifest[SCENE] || null
  };
}

async function verifyContextHelperReadOnly(bundleRoot, expectedScriptPath, expectedSqlText) {
  const currentBundle = setBundleEnv(bundleRoot);
  const manifestPath = path.join(currentBundle, "ContextHelper", "generated-queries", "manifest.json");
  const manifestBefore = await fs.readFile(manifestPath, "utf8");

  resetModule("../services/scene-config");
  const helperModule = resetModule("../ContextHelper/services/generated-query-file");
  const result = await helperModule.getOrCreateHelperQueryFile({ scene: SCENE });
  const manifestAfter = await fs.readFile(manifestPath, "utf8");

  clearBundleEnv();

  if (result.cacheHit !== true) {
    throw new Error("Expected active bundle helper script lookup to be a cache hit.");
  }
  if (result.filePath !== expectedScriptPath) {
    throw new Error(`Unexpected helper script path from ContextHelper: ${result.filePath || "missing"}.`);
  }
  if (result.sqlText !== expectedSqlText) {
    throw new Error(`Unexpected helper SQL from ContextHelper: ${result.sqlText || "missing"}.`);
  }
  if (manifestBefore !== manifestAfter) {
    throw new Error("Active bundle helper manifest should remain unchanged after ContextHelper lookup.");
  }

  return {
    currentBundle,
    manifestPath
  };
}

function assertAdvisorManifestEntry(entry, scriptName) {
  const expectedFilePath = `project://ContextHelper/generated-queries/${scriptName}`;
  const expectedSkillPath = "runtime://openclaw/workspace/skills/sales-opportunity-advisor/SKILL.md";

  if (!entry) {
    throw new Error(`Missing helper manifest entry for ${SCENE}.`);
  }
  if (entry.filePath !== expectedFilePath) {
    throw new Error(`Unexpected helper manifest filePath: ${entry.filePath || "missing"}.`);
  }
  if (entry.declaredFilePath !== expectedFilePath) {
    throw new Error(`Unexpected helper manifest declaredFilePath: ${entry.declaredFilePath || "missing"}.`);
  }
  if (entry.skillPath !== expectedSkillPath) {
    throw new Error(`Unexpected helper manifest skillPath: ${entry.skillPath || "missing"}.`);
  }
  if (!entry.definitionHash) {
    throw new Error("Helper manifest entry is missing definitionHash.");
  }
}

async function main() {
  const verificationRoot = path.join(PROJECT_ROOT, ".tmp", `helper-release-bundle-verify-${Date.now()}`);
  const manager = createReleaseManager({
    bundleRoot: verificationRoot,
    activeEnv: VERIFY_ENV
  });
  const store = createConfigStore({ driver: "mysql" });
  const createdReleaseIds = [];
  let originalHelperScript = null;
  let originalRevisionIds = [];

  try {
    originalHelperScript = await store.getHelperScript(SCENE, SCRIPT_TYPE);
    if (!originalHelperScript) {
      throw new Error(`Helper script ${SCENE}:${SCRIPT_TYPE} was not found in MySQL store.`);
    }
    originalRevisionIds = (
      await store.listRevisions({
        targetType: "helper-script",
        targetId: originalHelperScript.id,
        limit: 1000
      })
    ).map((item) => Number(item.id));

    const releaseA = await manager.publishRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t5-02",
      publishNote: "helper release bundle verification A"
    });
    createdReleaseIds.push(releaseA.release.releaseId);

    const stateA = await readCurrentHelperState(verificationRoot, originalHelperScript.scriptName);
    assertAdvisorManifestEntry(stateA.advisorManifestEntry, originalHelperScript.scriptName);
    if (Object.keys(stateA.helperManifest).length < 2) {
      throw new Error("Expected helper manifest to contain both helper scene entries.");
    }
    await verifyContextHelperReadOnly(
      verificationRoot,
      stateA.helperScriptPath,
      "SELECT TOP 1 * FROM t_sales_opportunity WHERE opportunityId = @opportunityId"
    );

    const updatedHelperScriptText = replaceGeneratedAt(originalHelperScript.contentText, UPDATED_GENERATED_AT);
    await store.saveHelperScriptDraft(
      {
        scene: originalHelperScript.scene,
        scriptType: originalHelperScript.scriptType,
        scriptName: originalHelperScript.scriptName,
        contentText: updatedHelperScriptText,
        status: originalHelperScript.status,
        updatedBy: "codex-t5-02-verify"
      },
      {
        operator: "codex-t5-02-verify",
        changeNote: "helper release bundle verification B"
      }
    );

    const releaseB = await manager.publishRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t5-02",
      publishNote: "helper release bundle verification B"
    });
    createdReleaseIds.push(releaseB.release.releaseId);

    const stateB = await readCurrentHelperState(verificationRoot, originalHelperScript.scriptName);
    assertAdvisorManifestEntry(stateB.advisorManifestEntry, originalHelperScript.scriptName);
    if (stateB.helperScriptText !== updatedHelperScriptText) {
      throw new Error("Published release B did not switch current helper script to the updated bundle version.");
    }
    if (stateA.helperScriptText === stateB.helperScriptText) {
      throw new Error("Helper script content did not change between release A and release B.");
    }
    if (stateB.advisorManifestEntry.generatedAt !== UPDATED_GENERATED_AT) {
      throw new Error(
        `Release B helper manifest did not carry the updated generatedAt: ${stateB.advisorManifestEntry.generatedAt || "missing"}.`
      );
    }
    await verifyContextHelperReadOnly(
      verificationRoot,
      stateB.helperScriptPath,
      "SELECT TOP 1 * FROM t_sales_opportunity WHERE opportunityId = @opportunityId"
    );

    const rollback = await manager.rollbackRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      updatedBy: "codex-t5-02"
    });

    const rolledBackState = await readCurrentHelperState(verificationRoot, originalHelperScript.scriptName);
    assertAdvisorManifestEntry(rolledBackState.advisorManifestEntry, originalHelperScript.scriptName);
    if (rollback.release.releaseId !== releaseA.release.releaseId) {
      throw new Error(`Rollback should target release A, got ${rollback.release.releaseId || "missing"}.`);
    }
    if (rolledBackState.helperScriptText !== stateA.helperScriptText) {
      throw new Error("Rollback did not restore release A helper script content.");
    }
    if (rolledBackState.advisorManifestEntry.generatedAt !== stateA.advisorManifestEntry.generatedAt) {
      throw new Error("Rollback did not restore release A helper manifest entry.");
    }
    await verifyContextHelperReadOnly(
      verificationRoot,
      rolledBackState.helperScriptPath,
      "SELECT TOP 1 * FROM t_sales_opportunity WHERE opportunityId = @opportunityId"
    );

    console.log(
      JSON.stringify(
        {
          verificationRoot,
          environment: VERIFY_ENV,
          releaseIds: {
            a: releaseA.release.releaseId,
            b: releaseB.release.releaseId,
            rollbackTarget: rollback.release.releaseId
          },
          helperScriptPath: rolledBackState.helperScriptPath,
          helperManifestPath: rolledBackState.helperManifestPath,
          generatedAt: {
            releaseA: stateA.advisorManifestEntry.generatedAt,
            releaseB: stateB.advisorManifestEntry.generatedAt,
            afterRollback: rolledBackState.advisorManifestEntry.generatedAt
          }
        },
        null,
        2
      )
    );
  } finally {
    clearBundleEnv();

    if (originalHelperScript) {
      const connection = await openMysqlConnection().catch(() => null);
      if (connection) {
        try {
          await connection.execute(
            [
              "UPDATE cfg_helper_scripts",
              "SET content_text = ?, checksum = ?, status = ?, current_revision_id = ?, updated_by = ?, updated_at = ?",
              "WHERE id = ?"
            ].join(" "),
            [
              originalHelperScript.contentText,
              originalHelperScript.checksum,
              originalHelperScript.status,
              originalHelperScript.currentRevisionId,
              originalHelperScript.updatedBy,
              originalHelperScript.updatedAt,
              originalHelperScript.id
            ]
          );

          const deleteParams = ["helper-script", originalHelperScript.id];
          let deleteSql = "DELETE FROM cfg_revisions WHERE target_type = ? AND target_id = ?";
          if (originalRevisionIds.length > 0) {
            deleteSql += ` AND id NOT IN (${originalRevisionIds.map(() => "?").join(", ")})`;
            deleteParams.push(...originalRevisionIds);
          }

          await connection.execute(deleteSql, deleteParams);
        } finally {
          await connection.end().catch(() => null);
        }
      }
    }

    await store.deleteReleasePointer(VERIFY_ENV, "all", "*").catch(() => null);
    for (const releaseId of createdReleaseIds.reverse()) {
      await store.deleteRelease(releaseId).catch(() => null);
    }

    await manager.close().catch(() => null);
    await store.close().catch(() => null);
    await fs.rm(verificationRoot, { recursive: true, force: true }).catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
