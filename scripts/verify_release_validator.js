require("../utils/load-env").loadProjectEnv();

const fs = require("fs/promises");
const path = require("path");

const { createConfigStore } = require("../services/config-store");
const { createReleaseManager } = require("../services/release-manager");
const { PROJECT_ROOT } = require("../utils/path-resolver");

const VERIFY_ENV = "verifyvalidator";

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
  const verificationRoot = path.join(PROJECT_ROOT, ".tmp", `release-validator-verify-${Date.now()}`);
  const manager = createReleaseManager({
    bundleRoot: verificationRoot,
    activeEnv: VERIFY_ENV
  });
  const store = createConfigStore({ driver: "mysql" });
  const createdReleaseIds = [];

  try {
    const healthy = await manager.publishRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t3-03",
      publishNote: "release validator healthy publish"
    });
    createdReleaseIds.push(healthy.release.releaseId);

    if (!healthy.preflightValidation?.valid) {
      throw new Error("Healthy publish did not return a valid create-time preflight validation summary.");
    }
    if (!healthy.activation?.preflightValidation?.valid) {
      throw new Error("Healthy publish did not return a valid activation-time preflight validation summary.");
    }
    if (healthy.preflightValidation?.helperScripts?.manifestEntries !== 2) {
      throw new Error(
        `Healthy publish expected 2 helper manifest entries, got ${healthy.preflightValidation?.helperScripts?.manifestEntries || 0}.`
      );
    }
    if (healthy.release.status !== "published") {
      throw new Error(`Healthy publish expected status=published, got ${healthy.release.status || "unknown"}.`);
    }

    const healthyCurrentTarget = await readCurrentTarget(verificationRoot, VERIFY_ENV);
    if (healthyCurrentTarget !== healthy.release.releaseId) {
      throw new Error("Healthy publish did not update current symlink.");
    }

    const draft = await manager.createRelease({
      environment: VERIFY_ENV,
      scopeType: "all",
      scopeValue: "*",
      createdBy: "codex-t3-03",
      publishNote: "release validator missing helper script"
    });
    createdReleaseIds.push(draft.release.releaseId);

    if (!draft.preflightValidation?.valid) {
      throw new Error("Draft release did not pass create-time preflight validation before tampering.");
    }

    const missingHelperScriptPath = path.join(
      draft.release.bundlePath,
      "ContextHelper",
      "generated-queries",
      "sales-opportunity-advisor.generated.js"
    );
    await fs.rm(missingHelperScriptPath, { force: true });

    let activationError = null;
    try {
      await manager.activateRelease({
        releaseId: draft.release.releaseId,
        updatedBy: "codex-t3-03"
      });
    } catch (error) {
      activationError = error;
    }

    if (!activationError) {
      throw new Error("Expected activation to fail after removing a required helper script.");
    }
    if (activationError.stage !== "release-validator") {
      throw new Error(`Expected release-validator stage, got ${activationError.stage || "unknown"}.`);
    }

    const failedSummary = activationError.details || {};
    const issueCodes = Array.isArray(failedSummary.issues)
      ? failedSummary.issues.map((issue) => issue.code)
      : [];
    if (!issueCodes.includes("MISSING_HELPER_SCRIPT_FILE")) {
      throw new Error(`Expected MISSING_HELPER_SCRIPT_FILE issue, got ${JSON.stringify(issueCodes)}.`);
    }

    const currentTargetAfterFailure = await readCurrentTarget(verificationRoot, VERIFY_ENV);
    if (currentTargetAfterFailure !== healthy.release.releaseId) {
      throw new Error("Failed activation should not replace the current symlink target.");
    }

    const pointerAfterFailure = await store.getReleasePointer(VERIFY_ENV, "all", "*");
    if (pointerAfterFailure?.activeReleaseId !== healthy.release.releaseId) {
      throw new Error("Failed activation should not replace the active release pointer.");
    }

    const draftReleaseAfterFailure = await store.getRelease(draft.release.releaseId);
    if (draftReleaseAfterFailure?.status !== "draft") {
      throw new Error(`Broken release should remain draft, got ${draftReleaseAfterFailure?.status || "missing"}.`);
    }

    console.log(
      JSON.stringify(
        {
          verificationRoot,
          healthyReleaseId: healthy.release.releaseId,
          brokenReleaseId: draft.release.releaseId,
          healthySceneCount: healthy.preflightValidation.sceneConfigs.total,
          healthyCompileCount: healthy.preflightValidation.compilePreview.validated,
          blockedIssueCount: failedSummary.issueCount || 0,
          blockedIssueCodes: issueCodes,
          currentTargets: {
            afterHealthyPublish: healthyCurrentTarget,
            afterBrokenActivation: currentTargetAfterFailure
          }
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
