const fs = require("fs/promises");
const path = require("path");

const { createReleaseManager } = require("./release-manager");
const { createAppError } = require("../utils/errors");

function toTrimmedString(value, fieldName, { required = false } = {}) {
  const normalized = value === null || value === undefined ? "" : String(value).trim();
  if (!normalized && required) {
    throw createAppError("INVALID_REQUEST", `${fieldName} is required.`, {
      stage: "console-releases"
    });
  }

  return normalized;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toIsoDateTime(value) {
  const normalized = value === null || value === undefined ? "" : String(value).trim();
  if (!normalized) {
    return null;
  }

  const isoCandidate = normalized.includes("T")
    ? normalized
    : `${normalized.replace(" ", "T")}Z`;
  const parsed = new Date(isoCandidate);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}

async function safeLstat(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function pathExists(targetPath) {
  return Boolean(await safeLstat(targetPath));
}

function summarizeEntries(release, entries = []) {
  const manifestEntrySummary = release?.manifest?.entries || {};
  const byType = entries.reduce((result, entry) => {
    result[entry.entryType] = (result[entry.entryType] || 0) + 1;
    return result;
  }, {});

  return {
    total:
      Number.isInteger(manifestEntrySummary.total) && manifestEntrySummary.total >= 0
        ? manifestEntrySummary.total
        : entries.length,
    byType:
      manifestEntrySummary.by_type && typeof manifestEntrySummary.by_type === "object"
        ? cloneJson(manifestEntrySummary.by_type)
        : byType
  };
}

function summarizeValidation(validation) {
  if (!validation) {
    return null;
  }

  return {
    valid: validation.valid === true,
    issueCount: Number(validation.issueCount || 0),
    sceneConfigs: cloneJson(validation.sceneConfigs || null),
    platformResources: cloneJson(validation.platformResources || null),
    jsonFiles: cloneJson(validation.jsonFiles || null),
    tsvFiles: cloneJson(validation.tsvFiles || null),
    compilePreview: cloneJson(validation.compilePreview || null),
    helperScripts: cloneJson(validation.helperScripts || null),
    issues: Array.isArray(validation.issues)
      ? validation.issues.slice(0, 5).map((issue) => ({
          code: issue.code || null,
          file: issue.file || null,
          message: issue.message || null
        }))
      : []
  };
}

async function buildBundleSummary(release) {
  const bundlePath = toTrimmedString(release?.bundlePath, "bundlePath");
  const manifestPath = bundlePath ? path.join(bundlePath, "manifest.json") : null;

  return {
    bundlePath,
    bundleExists: bundlePath ? await pathExists(bundlePath) : false,
    manifestPath,
    manifestExists: manifestPath ? await pathExists(manifestPath) : false
  };
}

function buildReleaseListItem(release, pointer = null) {
  const entries = summarizeEntries(release, []);
  return {
    releaseId: release.releaseId,
    status: release.status,
    environment: release.environment,
    scopeType: release.scopeType,
    scopeValue: release.scopeValue,
    createdBy: release.createdBy || null,
    publishNote: release.publishNote || null,
    createdAt: toIsoDateTime(release.createdAt),
    publishedAt: toIsoDateTime(release.publishedAt),
    entryTotal: entries.total,
    entryCounts: entries.byType,
    aggregateChecksum: release.manifest?.checksums?.aggregate || null,
    rendererVersion: release.manifest?.renderer_version || null,
    isActive: pointer?.activeReleaseId === release.releaseId,
    isPrevious: pointer?.previousReleaseId === release.releaseId
  };
}

async function buildReleaseSnapshot(manager, release, options = {}) {
  if (!release) {
    return null;
  }

  const entries = Array.isArray(options.entries)
    ? options.entries
    : await manager.store.listReleaseEntries(release.releaseId);
  const validation =
    options.validation === undefined
      ? await manager.releaseValidator.validateRelease({ release, entries })
      : options.validation;
  const entrySummary = summarizeEntries(release, entries);
  const bundle = await buildBundleSummary(release);

  return {
    releaseId: release.releaseId,
    status: release.status,
    environment: release.environment,
    scopeType: release.scopeType,
    scopeValue: release.scopeValue,
    createdBy: release.createdBy || null,
    publishNote: release.publishNote || null,
    createdAt: toIsoDateTime(release.createdAt),
    publishedAt: toIsoDateTime(release.publishedAt),
    entryTotal: entrySummary.total,
    entryCounts: entrySummary.byType,
    rendererVersion: release.manifest?.renderer_version || null,
    aggregateChecksum: release.manifest?.checksums?.aggregate || null,
    bundle,
    validation: summarizeValidation(validation)
  };
}

async function findLatestFailedRelease(manager, releases, ignoredReleaseIds = new Set()) {
  for (const release of releases) {
    if (ignoredReleaseIds.has(release.releaseId) || release.status === "published") {
      continue;
    }

    const entries = await manager.store.listReleaseEntries(release.releaseId);
    const validation = await manager.releaseValidator.validateRelease({
      release,
      entries
    });

    if (!validation.valid) {
      return buildReleaseSnapshot(manager, release, {
        entries,
        validation
      });
    }
  }

  return null;
}

async function buildCurrentBundleStatus(manager, scope, pointer) {
  const currentPath = manager.shouldUpdateCurrentLink(scope.scopeType)
    ? manager.getCurrentBundlePath(scope.environment)
    : null;

  if (!currentPath) {
    return {
      currentPath: null,
      exists: false,
      isSymlink: false,
      symlinkTarget: null,
      resolvedBundlePath: null,
      pointsToExistingRelease: false,
      activeReleaseId: pointer?.activeReleaseId || null,
      matchesActiveRelease: null
    };
  }

  const currentStat = await safeLstat(currentPath);
  if (!currentStat) {
    return {
      currentPath,
      exists: false,
      isSymlink: false,
      symlinkTarget: null,
      resolvedBundlePath: null,
      pointsToExistingRelease: false,
      activeReleaseId: pointer?.activeReleaseId || null,
      matchesActiveRelease: pointer?.activeReleaseId ? false : null
    };
  }

  if (!currentStat.isSymbolicLink()) {
    return {
      currentPath,
      exists: true,
      isSymlink: false,
      symlinkTarget: null,
      resolvedBundlePath: null,
      pointsToExistingRelease: false,
      activeReleaseId: pointer?.activeReleaseId || null,
      matchesActiveRelease: false
    };
  }

  const symlinkTarget = await manager.readCurrentLinkTarget(scope.environment);
  const resolvedBundlePath = symlinkTarget ? path.resolve(path.dirname(currentPath), symlinkTarget) : null;

  return {
    currentPath,
    exists: true,
    isSymlink: true,
    symlinkTarget: symlinkTarget || null,
    resolvedBundlePath,
    pointsToExistingRelease: resolvedBundlePath ? await pathExists(resolvedBundlePath) : false,
    activeReleaseId: pointer?.activeReleaseId || null,
    matchesActiveRelease: pointer?.activeReleaseId ? symlinkTarget === pointer.activeReleaseId : null
  };
}

async function getConsoleReleaseStatus(input = {}) {
  const manager = createReleaseManager({
    bundleRoot: input.bundleRoot,
    activeEnv: input.activeEnv || input.environment
  });

  try {
    const scope = manager.normalizeScope({
      environment: input.environment,
      scopeType: input.scopeType,
      scopeValue: input.scopeValue
    });
    const releases = await manager.store.listReleases({
      environment: scope.environment,
      scopeType: scope.scopeType,
      scopeValue: scope.scopeValue
    });
    const pointer = await manager.store.getReleasePointer(
      scope.environment,
      scope.scopeType,
      scope.scopeValue
    );

    const activeRelease =
      pointer?.activeReleaseId
        ? releases.find((item) => item.releaseId === pointer.activeReleaseId)
          || await manager.store.getRelease(pointer.activeReleaseId)
        : null;
    const previousRelease =
      pointer?.previousReleaseId
        ? releases.find((item) => item.releaseId === pointer.previousReleaseId)
          || await manager.store.getRelease(pointer.previousReleaseId)
        : null;

    const [activeReleaseSnapshot, previousReleaseSnapshot, currentBundle] = await Promise.all([
      buildReleaseSnapshot(manager, activeRelease),
      buildReleaseSnapshot(manager, previousRelease),
      buildCurrentBundleStatus(manager, scope, pointer)
    ]);

    const ignoredReleaseIds = new Set(
      [activeRelease?.releaseId, previousRelease?.releaseId].filter(Boolean)
    );
    const latestFailedRelease = await findLatestFailedRelease(manager, releases, ignoredReleaseIds);

    return {
      observedAt: new Date().toISOString(),
      scope,
      pointer: pointer
        ? {
            environment: pointer.environment,
            scopeType: pointer.scopeType,
            scopeValue: pointer.scopeValue,
            activeReleaseId: pointer.activeReleaseId,
            previousReleaseId: pointer.previousReleaseId || null,
            updatedBy: pointer.updatedBy || null,
            updatedAt: toIsoDateTime(pointer.updatedAt)
          }
        : null,
      currentBundle,
      activeRelease: activeReleaseSnapshot,
      previousRelease: previousReleaseSnapshot,
      latestFailedRelease,
      recentReleases: releases.slice(0, 5).map((release) => buildReleaseListItem(release, pointer))
    };
  } finally {
    await manager.close().catch(() => null);
  }
}

async function rollbackConsoleRelease(input = {}) {
  const releaseId = toTrimmedString(input.releaseId, "releaseId", { required: true });
  const updatedBy = toTrimmedString(input.updatedBy || input.operator || "console-api", "updatedBy", {
    required: true
  });
  const updatedAt = input.updatedAt || new Date();
  const manager = createReleaseManager();

  try {
    const requestedRelease = await manager.store.getRelease(releaseId);
    if (!requestedRelease) {
      throw createAppError("INVALID_REQUEST", `Release ${releaseId} not found.`, {
        httpStatus: 404,
        stage: "console-releases"
      });
    }

    const currentPointer = await manager.store.getReleasePointer(
      requestedRelease.environment,
      requestedRelease.scopeType,
      requestedRelease.scopeValue
    );

    if (!currentPointer || currentPointer.activeReleaseId !== requestedRelease.releaseId) {
      throw createAppError("INVALID_REQUEST", `Release ${releaseId} is not the current active release.`, {
        httpStatus: 409,
        stage: "console-releases",
        details: {
          releaseId,
          environment: requestedRelease.environment,
          scopeType: requestedRelease.scopeType,
          scopeValue: requestedRelease.scopeValue,
          activeReleaseId: currentPointer?.activeReleaseId || null,
          previousReleaseId: currentPointer?.previousReleaseId || null
        }
      });
    }

    const rollback = await manager.rollbackRelease({
      environment: requestedRelease.environment,
      scopeType: requestedRelease.scopeType,
      scopeValue: requestedRelease.scopeValue,
      updatedBy,
      updatedAt
    });
    const currentBundleTarget = rollback.currentPath
      ? await manager.readCurrentLinkTarget(requestedRelease.environment)
      : null;

    return {
      requestedReleaseId: requestedRelease.releaseId,
      scope: {
        environment: requestedRelease.environment,
        scopeType: requestedRelease.scopeType,
        scopeValue: requestedRelease.scopeValue
      },
      activeBeforeRollback: requestedRelease.releaseId,
      activeAfterRollback: rollback.release.releaseId,
      previousBeforeRollback: currentPointer.previousReleaseId || null,
      previousAfterRollback: rollback.pointer?.previousReleaseId || null,
      release: rollback.release,
      pointer: rollback.pointer,
      currentPath: rollback.currentPath,
      currentBundleTarget
    };
  } finally {
    await manager.close().catch(() => null);
  }
}

module.exports = {
  getConsoleReleaseStatus,
  rollbackConsoleRelease
};
