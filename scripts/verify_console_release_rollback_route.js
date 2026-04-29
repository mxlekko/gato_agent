require("../utils/load-env").loadProjectEnv();

const fs = require("fs/promises");
const path = require("path");

const { createConfigStore } = require("../services/config-store");
const { createReleaseManager } = require("../services/release-manager");
const { rollbackConsoleReleaseRoute } = require("../routes/console-releases");
const { PROJECT_ROOT } = require("../utils/path-resolver");

const VERIFY_ENV = "verifyrollbackapi";
const ENV_KEYS = [
  "CONFIG_BUNDLE_ROOT",
  "CONFIG_ACTIVE_ENV",
  "CONFIG_CURRENT_BUNDLE",
  "CONFIG_PROJECT_ROOT",
  "CONFIG_RUNTIME_ROOT",
  "CONFIG_SCENE_CONFIG_DIR"
];

function applyVerificationEnv(bundleRoot) {
  const previous = {};
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key];
  }

  const currentBundle = path.join(bundleRoot, VERIFY_ENV, "current");
  process.env.CONFIG_BUNDLE_ROOT = bundleRoot;
  process.env.CONFIG_ACTIVE_ENV = VERIFY_ENV;
  process.env.CONFIG_CURRENT_BUNDLE = currentBundle;
  process.env.CONFIG_PROJECT_ROOT = currentBundle;
  process.env.CONFIG_RUNTIME_ROOT = path.join(currentBundle, "runtime-assets");
  process.env.CONFIG_SCENE_CONFIG_DIR = path.join(currentBundle, "scene-configs");

  return previous;
}

function restoreEnv(previous = {}) {
  for (const key of ENV_KEYS) {
    if (previous[key] === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = previous[key];
  }
}

async function readCurrentTarget(bundleRoot) {
  return fs.readlink(path.join(bundleRoot, VERIFY_ENV, "current"));
}

async function main() {
  const verificationRoot = path.join(PROJECT_ROOT, ".tmp", `console-release-rollback-route-verify-${Date.now()}`);
  const manager = createReleaseManager({
    bundleRoot: verificationRoot,
    activeEnv: VERIFY_ENV
  });
  const store = createConfigStore({ driver: "mysql" });
  const createdReleaseIds = [];
  const previousEnv = applyVerificationEnv(verificationRoot);

  try {
    const first = await manager.publishRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t6-01",
      publishNote: "console release rollback route verify #1"
    });
    createdReleaseIds.push(first.release.releaseId);

    const second = await manager.publishRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t6-01",
      publishNote: "console release rollback route verify #2"
    });
    createdReleaseIds.push(second.release.releaseId);

    const routed = await rollbackConsoleReleaseRoute(second.release.releaseId, {
      updatedBy: "codex-t6-01-route"
    });

    if (routed.statusCode !== 200 || routed.payload?.success !== true) {
      throw new Error(`Unexpected route result: ${JSON.stringify(routed)}`);
    }

    const data = routed.payload.data || {};
    if (data.requestedReleaseId !== second.release.releaseId) {
      throw new Error(`Unexpected requestedReleaseId: ${data.requestedReleaseId || "missing"}.`);
    }
    if (data.activeBeforeRollback !== second.release.releaseId) {
      throw new Error(`Unexpected activeBeforeRollback: ${data.activeBeforeRollback || "missing"}.`);
    }
    if (data.activeAfterRollback !== first.release.releaseId) {
      throw new Error(`Unexpected activeAfterRollback: ${data.activeAfterRollback || "missing"}.`);
    }
    if (data.previousBeforeRollback !== first.release.releaseId) {
      throw new Error(`Unexpected previousBeforeRollback: ${data.previousBeforeRollback || "missing"}.`);
    }

    const currentTarget = await readCurrentTarget(verificationRoot);
    if (currentTarget !== first.release.releaseId) {
      throw new Error(`Rollback route did not restore current bundle target: ${currentTarget || "missing"}.`);
    }

    const pointer = await store.getReleasePointer(VERIFY_ENV, "all", "*");
    if (pointer?.activeReleaseId !== first.release.releaseId) {
      throw new Error(`Rollback route did not restore active pointer: ${pointer?.activeReleaseId || "missing"}.`);
    }
    if (pointer?.previousReleaseId !== second.release.releaseId) {
      throw new Error(
        `Rollback route did not preserve previous pointer: ${pointer?.previousReleaseId || "missing"}.`
      );
    }

    let inactiveError = null;
    try {
      await rollbackConsoleReleaseRoute(second.release.releaseId, {
        updatedBy: "codex-t6-01-route"
      });
    } catch (error) {
      inactiveError = error;
    }

    if (!inactiveError) {
      throw new Error("Expected rollback route to reject a non-active release.");
    }
    if (inactiveError.httpStatus !== 409 || inactiveError.stage !== "console-releases") {
      throw new Error(
        `Unexpected inactive release error: ${inactiveError.httpStatus || "missing"} / ${inactiveError.stage || "missing"}.`
      );
    }

    console.log(
      JSON.stringify(
        {
          verificationRoot,
          environment: VERIFY_ENV,
          releaseIds: {
            first: first.release.releaseId,
            second: second.release.releaseId
          },
          rollbackResult: {
            requestedReleaseId: data.requestedReleaseId,
            activeAfterRollback: data.activeAfterRollback,
            previousAfterRollback: data.previousAfterRollback,
            currentBundleTarget: currentTarget
          },
          rejectedInactiveRelease: {
            code: inactiveError.code,
            httpStatus: inactiveError.httpStatus,
            stage: inactiveError.stage
          }
        },
        null,
        2
      )
    );
  } finally {
    restoreEnv(previousEnv);
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
