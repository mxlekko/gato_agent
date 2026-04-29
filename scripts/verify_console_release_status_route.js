require("../utils/load-env").loadProjectEnv();

const fs = require("fs/promises");
const path = require("path");

const { createConfigStore } = require("../services/config-store");
const { getConsoleReleaseStatus } = require("../services/console-releases");
const { createReleaseManager } = require("../services/release-manager");
const { getConsoleReleaseStatusRoute } = require("../routes/console-releases");
const { PROJECT_ROOT } = require("../utils/path-resolver");

const VERIFY_ENV = "verifyreleasestatus";

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
  const verificationRoot = path.join(PROJECT_ROOT, ".tmp", `console-release-status-verify-${Date.now()}`);
  const manager = createReleaseManager({
    bundleRoot: verificationRoot,
    activeEnv: VERIFY_ENV
  });
  const store = createConfigStore({ driver: "mysql" });
  const createdReleaseIds = [];
  const previousBundleRoot = process.env.CONFIG_BUNDLE_ROOT;
  const previousActiveEnv = process.env.CONFIG_ACTIVE_ENV;

  process.env.CONFIG_BUNDLE_ROOT = verificationRoot;
  process.env.CONFIG_ACTIVE_ENV = VERIFY_ENV;

  try {
    const first = await manager.publishRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t6-03",
      publishNote: "console release status verify #1"
    });
    createdReleaseIds.push(first.release.releaseId);

    const second = await manager.publishRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t6-03",
      publishNote: "console release status verify #2"
    });
    createdReleaseIds.push(second.release.releaseId);

    const broken = await manager.createRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t6-03",
      publishNote: "console release status verify broken"
    });
    createdReleaseIds.push(broken.release.releaseId);

    const missingHelperPath = path.join(
      broken.release.bundlePath,
      "ContextHelper",
      "generated-queries",
      "sales-opportunity-advisor.generated.js"
    );
    await fs.rm(missingHelperPath, { force: true });

    let activationError = null;
    try {
      await manager.activateRelease({
        releaseId: broken.release.releaseId,
        updatedBy: "codex-t6-03"
      });
    } catch (error) {
      activationError = error;
    }

    if (!activationError) {
      throw new Error("Expected broken release activation to fail.");
    }

    const currentTarget = await readCurrentTarget(verificationRoot, VERIFY_ENV);
    if (currentTarget !== second.release.releaseId) {
      throw new Error(`Expected current bundle to remain on second release, got ${currentTarget || "missing"}.`);
    }

    const serviceData = await getConsoleReleaseStatus({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      bundleRoot: verificationRoot,
      activeEnv: VERIFY_ENV
    });

    if (serviceData.activeRelease?.releaseId !== second.release.releaseId) {
      throw new Error(`Expected active release ${second.release.releaseId}, got ${serviceData.activeRelease?.releaseId || "missing"}.`);
    }
    if (serviceData.previousRelease?.releaseId !== first.release.releaseId) {
      throw new Error(`Expected previous release ${first.release.releaseId}, got ${serviceData.previousRelease?.releaseId || "missing"}.`);
    }
    if (serviceData.latestFailedRelease?.releaseId !== broken.release.releaseId) {
      throw new Error(`Expected latest failed release ${broken.release.releaseId}, got ${serviceData.latestFailedRelease?.releaseId || "missing"}.`);
    }
    if (serviceData.currentBundle?.symlinkTarget !== second.release.releaseId) {
      throw new Error(
        `Expected current symlink target ${second.release.releaseId}, got ${serviceData.currentBundle?.symlinkTarget || "missing"}.`
      );
    }
    if (serviceData.currentBundle?.matchesActiveRelease !== true) {
      throw new Error("Expected current bundle to match active release.");
    }
    if (serviceData.activeRelease?.validation?.valid !== true) {
      throw new Error("Expected active release validation to be valid.");
    }
    if (serviceData.previousRelease?.validation?.valid !== true) {
      throw new Error("Expected previous release validation to be valid.");
    }
    if (serviceData.latestFailedRelease?.validation?.valid !== false) {
      throw new Error("Expected latest failed release validation to be invalid.");
    }

    const failedIssueCodes = (serviceData.latestFailedRelease?.validation?.issues || []).map((issue) => issue.code);
    if (!failedIssueCodes.includes("MISSING_HELPER_SCRIPT_FILE")) {
      throw new Error(`Expected MISSING_HELPER_SCRIPT_FILE in failed issues, got ${JSON.stringify(failedIssueCodes)}.`);
    }

    const routeResult = await getConsoleReleaseStatusRoute(
      new URL(`http://localhost/api/console/releases/status?environment=${VERIFY_ENV}&scopeType=all&scopeValue=*`)
    );
    if (routeResult.statusCode !== 200 || routeResult.payload?.success !== true) {
      throw new Error("Release status route did not return success.");
    }

    const routeData = routeResult.payload?.data || null;
    if (routeData?.activeRelease?.releaseId !== second.release.releaseId) {
      throw new Error("Route payload active release mismatch.");
    }
    if (routeData?.previousRelease?.releaseId !== first.release.releaseId) {
      throw new Error("Route payload previous release mismatch.");
    }
    if (routeData?.latestFailedRelease?.releaseId !== broken.release.releaseId) {
      throw new Error("Route payload latest failed release mismatch.");
    }

    const pointer = await store.getReleasePointer(VERIFY_ENV, "all", "*");
    if (pointer?.activeReleaseId !== second.release.releaseId || pointer?.previousReleaseId !== first.release.releaseId) {
      throw new Error("Release pointer summary does not match expected active/previous releases.");
    }

    console.log(JSON.stringify({
      verificationRoot,
      activeReleaseId: serviceData.activeRelease.releaseId,
      previousReleaseId: serviceData.previousRelease.releaseId,
      latestFailedReleaseId: serviceData.latestFailedRelease.releaseId,
      currentBundleTarget: serviceData.currentBundle.symlinkTarget,
      failedIssueCodes
    }, null, 2));
  } finally {
    await store.deleteReleasePointer(VERIFY_ENV, "all", "*").catch(() => null);

    for (const releaseId of createdReleaseIds.reverse()) {
      await store.deleteRelease(releaseId).catch(() => null);
    }

    await manager.close().catch(() => null);
    await store.close().catch(() => null);
    await fs.rm(verificationRoot, { recursive: true, force: true }).catch(() => null);

    if (previousBundleRoot === undefined) {
      delete process.env.CONFIG_BUNDLE_ROOT;
    } else {
      process.env.CONFIG_BUNDLE_ROOT = previousBundleRoot;
    }

    if (previousActiveEnv === undefined) {
      delete process.env.CONFIG_ACTIVE_ENV;
    } else {
      process.env.CONFIG_ACTIVE_ENV = previousActiveEnv;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
