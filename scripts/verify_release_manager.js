require("../utils/load-env").loadProjectEnv();

const fs = require("fs/promises");
const path = require("path");

const { createConfigStore } = require("../services/config-store");
const { createReleaseManager } = require("../services/release-manager");
const { PROJECT_ROOT } = require("../utils/path-resolver");

const VERIFY_ENV = "verifyrelease";

async function readCurrentTarget(bundleRoot, environment) {
  try {
    return await fs.readlink(path.join(bundleRoot, environment, "current"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function main() {
  const verificationRoot = path.join(PROJECT_ROOT, ".tmp", `release-manager-verify-${Date.now()}`);
  const manager = createReleaseManager({
    bundleRoot: verificationRoot,
    activeEnv: VERIFY_ENV
  });
  const store = createConfigStore({ driver: "mysql" });
  const createdReleaseIds = [];

  try {
    const first = await manager.publishRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t3-01",
      publishNote: "release manager verification #1"
    });
    createdReleaseIds.push(first.release.releaseId);

    if (first.release.status !== "published") {
      throw new Error(`Expected first release to be published, got ${first.release.status || "unknown"}.`);
    }
    if (first.activation.pointer.activeReleaseId !== first.release.releaseId) {
      throw new Error("First release did not become the active release pointer.");
    }

    const firstCurrentTarget = await readCurrentTarget(verificationRoot, VERIFY_ENV);
    if (firstCurrentTarget !== first.release.releaseId) {
      throw new Error("Bundle current symlink did not point to the first release.");
    }

    const firstSnapshot = await manager.getReleaseSnapshot(first.release.releaseId);
    if (!firstSnapshot || !firstSnapshot.entries.length) {
      throw new Error("First release snapshot was not persisted.");
    }

    const second = await manager.publishRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t3-01",
      publishNote: "release manager verification #2"
    });
    createdReleaseIds.push(second.release.releaseId);

    if (second.release.status !== "published") {
      throw new Error(`Expected second release to be published, got ${second.release.status || "unknown"}.`);
    }
    if (second.activation.pointer.activeReleaseId !== second.release.releaseId) {
      throw new Error("Second release did not become the active release pointer.");
    }
    if (second.activation.pointer.previousReleaseId !== first.release.releaseId) {
      throw new Error("Second release did not preserve the previous release pointer.");
    }

    const secondCurrentTarget = await readCurrentTarget(verificationRoot, VERIFY_ENV);
    if (secondCurrentTarget !== second.release.releaseId) {
      throw new Error("Bundle current symlink did not point to the second release.");
    }

    const rollback = await manager.rollbackRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      updatedBy: "codex-t3-01"
    });

    if (rollback.pointer.activeReleaseId !== first.release.releaseId) {
      throw new Error("Rollback did not restore the first release as active.");
    }
    if (rollback.pointer.previousReleaseId !== second.release.releaseId) {
      throw new Error("Rollback did not keep the second release as previous.");
    }

    const rollbackCurrentTarget = await readCurrentTarget(verificationRoot, VERIFY_ENV);
    if (rollbackCurrentTarget !== first.release.releaseId) {
      throw new Error("Bundle current symlink did not roll back to the first release.");
    }

    console.log(
      JSON.stringify(
        {
          verificationRoot,
          releaseIds: createdReleaseIds,
          entryCounts: {
            first: first.entries.length,
            second: second.entries.length
          },
          currentTargets: {
            afterFirstPublish: firstCurrentTarget,
            afterSecondPublish: secondCurrentTarget,
            afterRollback: rollbackCurrentTarget
          },
          rollbackPointer: rollback.pointer
        },
        null,
        2
      )
    );
  } finally {
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
