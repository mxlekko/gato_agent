require("../utils/load-env").loadProjectEnv();

const fs = require("fs/promises");
const Module = require("module");
const path = require("path");

const { createConfigStore } = require("../services/config-store");
const { createReleaseManager } = require("../services/release-manager");

const QUERY_PROFILE_REF = "query://sales-opportunity/by-opportunity-id@v1";

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
    createdBy: "codex-t4-03",
    publishNote: "activate local bundle for query profile runtime verification"
  });

  return {
    createdReleaseId: published.release.releaseId,
    activeReleaseId: published.release.releaseId,
    currentPlatformDir
  };
}

function installFakeDbModule() {
  const modulePath = require.resolve("../ContextHelper/services/db");
  const previousCacheEntry = require.cache[modulePath];
  const capture = {
    boundInputs: [],
    sqlText: null
  };

  const fakeDbModule = {
    async getDbPool() {
      return {
        request() {
          return {
            input(name, type, value) {
              capture.boundInputs.push({ name, type, value });
              return this;
            },
            async query(sqlText) {
              capture.sqlText = sqlText;
              return {
                recordset: [
                  {
                    opportunityId: "verify-t4-03-opportunity",
                    stage: "Qualification",
                    owner: "codex"
                  }
                ]
              };
            }
          };
        }
      };
    },
    sql: {
      NVarChar(length) {
        return `NVarChar(${length})`;
      },
      Bit: "Bit",
      Int: "Int",
      BigInt: "BigInt",
      Float: "Float",
      Date: "Date",
      DateTime2: "DateTime2"
    }
  };

  const fakeModule = new Module(modulePath);
  fakeModule.filename = modulePath;
  fakeModule.loaded = true;
  fakeModule.exports = fakeDbModule;
  require.cache[modulePath] = fakeModule;

  return {
    capture,
    restore() {
      if (previousCacheEntry) {
        require.cache[modulePath] = previousCacheEntry;
        return;
      }
      delete require.cache[modulePath];
    }
  };
}

async function main() {
  const manager = createReleaseManager();
  const store = createConfigStore({ driver: "mysql" });
  let restoreDbModule = null;

  try {
    const ensured = await ensureActiveBundle(manager, store);
    const sceneConfigModule = resetModule("../services/scene-config");
    const validateModule = resetModule("../platform/compiler/validate");
    const sourceState = validateModule.getPlatformResourceSourceState();

    if (sourceState.source !== "active-bundle") {
      throw new Error(`Expected active-bundle source, got ${sourceState.source}.`);
    }

    const resources = validateModule.loadPlatformResources();
    const queryRecord = resources.queries.find((item) => item?.document?.spec?.ref === QUERY_PROFILE_REF);
    if (!queryRecord) {
      throw new Error(`Unable to locate QueryProfile ${QUERY_PROFILE_REF}.`);
    }
    assertPathInside(sceneConfigModule.CONFIG_CURRENT_BUNDLE, queryRecord.filePath, "query profile");

    const fakeDb = installFakeDbModule();
    restoreDbModule = fakeDb.restore;

    const queryRunner = resetModule("../services/generic-query-runner");
    const queryDocument = queryRunner.loadQueryProfile(QUERY_PROFILE_REF);
    const migrationSource = queryDocument?.spec?.migrationSource || {};

    if (!String(migrationSource.skillPath || "").startsWith("runtime://")) {
      throw new Error(`Expected active bundle runtime:// skillPath, got ${migrationSource.skillPath || "missing"}.`);
    }
    if (!String(migrationSource.helperScriptPath || "").startsWith("project://")) {
      throw new Error(
        `Expected active bundle project:// helperScriptPath, got ${migrationSource.helperScriptPath || "missing"}.`
      );
    }

    const result = await queryRunner.executeGenericQuery({
      requestId: "verify-t4-03",
      queryProfileRef: QUERY_PROFILE_REF,
      opportunityId: "verify-t4-03-opportunity"
    });

    if (!fakeDb.capture.sqlText || !fakeDb.capture.sqlText.includes("SELECT TOP 1 * FROM [t_sales_opportunity]")) {
      throw new Error(`Unexpected SQL generated: ${fakeDb.capture.sqlText || "missing"}.`);
    }
    if (!fakeDb.capture.sqlText.includes("WHERE [opportunityId] = @p0")) {
      throw new Error(`Expected opportunityId filter in SQL, got ${fakeDb.capture.sqlText}.`);
    }
    if (fakeDb.capture.boundInputs.length !== 1 || fakeDb.capture.boundInputs[0].name !== "p0") {
      throw new Error(`Unexpected bound inputs: ${JSON.stringify(fakeDb.capture.boundInputs)}.`);
    }
    if (result?.rawRow?.opportunityId !== "verify-t4-03-opportunity") {
      throw new Error(`Unexpected query result payload: ${JSON.stringify(result)}.`);
    }

    console.log(
      JSON.stringify(
        {
          activeEnv: manager.activeEnv,
          createdReleaseId: ensured.createdReleaseId,
          activeReleaseId: ensured.activeReleaseId,
          platformSource: sourceState.source,
          queryFile: queryRecord.filePath,
          queryProfileRef: QUERY_PROFILE_REF,
          migrationSource: {
            skillPath: migrationSource.skillPath,
            helperScriptPath: migrationSource.helperScriptPath
          },
          generatedSql: fakeDb.capture.sqlText,
          boundInputs: fakeDb.capture.boundInputs,
          result
        },
        null,
        2
      )
    );
  } finally {
    if (restoreDbModule) {
      restoreDbModule();
    }
    await manager.close().catch(() => null);
    await store.close().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
