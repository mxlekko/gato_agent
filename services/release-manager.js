const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const { createBundleRenderer } = require("./bundle-renderer");
const { createConfigStore } = require("./config-store");
const { createReleaseValidator } = require("./release-validator");
const { createAppError } = require("../utils/errors");
const { PROJECT_ROOT } = require("../utils/path-resolver");

const DEFAULT_ACTIVE_ENV = "local";
const DEFAULT_BUNDLE_ROOT = path.join(PROJECT_ROOT, ".local", "runtime-bundles");
const DEFAULT_SCOPE_VALUE = "*";
const RELEASE_STATUS_DRAFT = "draft";
const RELEASE_STATUS_PUBLISHED = "published";
const RELEASE_MANAGER_RENDERER_VERSION = "bundle-renderer/v1";

const ENTRY_TYPE_ORDER = ["scene-config", "platform-resource", "scene-asset", "helper-script"];
const TARGET_TYPE_BY_ENTRY = {
  "scene-config": "scene-config",
  "platform-resource": "platform-resource",
  "scene-asset": "scene-asset",
  "helper-script": "helper-script"
};

function cloneJson(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

function toTrimmedString(value, fieldName, options = {}) {
  const trimmed = value === null || value === undefined ? "" : String(value).trim();
  if (!trimmed && options.required) {
    throw createAppError("INVALID_REQUEST", `${fieldName} is required.`, {
      stage: "release-manager"
    });
  }

  return trimmed;
}

function toDateValue(value, fieldName = "date") {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw createAppError("INVALID_REQUEST", `${fieldName} must be a valid date value.`, {
      stage: "release-manager"
    });
  }

  return date;
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function sanitizeReleaseSegment(value, fallback = "value") {
  const sanitized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();

  return sanitized || fallback;
}

function formatReleaseTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.(\d{3})Z$/, "$1Z");
}

function buildReleaseId(input) {
  const timestamp = formatReleaseTimestamp(input.createdAt);
  const suffix = shortHash(
    [timestamp, input.environment, input.scopeType, input.scopeValue, input.createdBy || ""].join(":")
  );

  return [
    "rel",
    timestamp,
    sanitizeReleaseSegment(input.environment, "env"),
    sanitizeReleaseSegment(input.scopeType, "scope"),
    sanitizeReleaseSegment(input.scopeValue, "all").slice(0, 24),
    suffix
  ]
    .join("_")
    .slice(0, 128);
}

function buildEntryKey(entryType, record) {
  switch (entryType) {
    case "scene-config":
      return record.scene;
    case "platform-resource":
      return `${record.kind}:${record.name}@${record.version}`;
    case "scene-asset":
      return `${record.scene}:${record.assetType}`;
    case "helper-script":
      return `${record.scene}:${record.scriptType}:${record.scriptName}`;
    default:
      throw createAppError("INVALID_REQUEST", `Unsupported release entry type: ${entryType}.`, {
        stage: "release-manager"
      });
  }
}

function buildEntryRelativePath(entry) {
  const safeKey = `${sanitizeReleaseSegment(entry.entryKey, "entry")}-${shortHash(entry.entryKey)}`;
  return path.join("entries", entry.entryType, `${safeKey}.json`);
}

function buildSnapshotJson(entryType, record, revision) {
  switch (entryType) {
    case "scene-config":
      return {
        scene: record.scene,
        title: record.title,
        enabled: record.enabled,
        executionMode: record.executionMode,
        status: record.status,
        document: cloneJson(revision.document)
      };
    case "platform-resource":
      return {
        kind: record.kind,
        name: record.name,
        version: record.version,
        ref: record.ref,
        scene: record.scene,
        status: record.status,
        document: cloneJson(revision.document)
      };
    case "scene-asset":
      return {
        scene: record.scene,
        assetType: record.assetType,
        ref: record.ref,
        contentFormat: record.contentFormat,
        status: record.status,
        document: cloneJson(revision.document)
      };
    case "helper-script":
      return {
        scene: record.scene,
        scriptType: record.scriptType,
        scriptName: record.scriptName,
        status: record.status,
        document: cloneJson(revision.document)
      };
    default:
      throw createAppError("INVALID_REQUEST", `Unsupported release entry type: ${entryType}.`, {
        stage: "release-manager"
      });
  }
}

function countEntriesByType(entries) {
  return entries.reduce((result, entry) => {
    result[entry.entryType] = (result[entry.entryType] || 0) + 1;
    return result;
  }, {});
}

function buildManifest(input) {
  const manifestEntries = input.entries.map((entry) => ({
    entry_type: entry.entryType,
    entry_key: entry.entryKey,
    target_id: entry.targetId,
    revision_id: entry.revisionId,
    checksum: entry.checksum,
    path: entry.relativePath
  }));
  const checksums = Object.fromEntries(
    input.entries.map((entry) => [`${entry.entryType}:${entry.entryKey}`, entry.checksum])
  );

  return {
    release_id: input.releaseId,
    environment: input.environment,
    scope_type: input.scopeType,
    scope_value: input.scopeValue,
    created_at: input.createdAt.toISOString(),
    created_by: input.createdBy || null,
    publish_note: input.publishNote || null,
    renderer_version: input.rendererVersion,
    entries: {
      total: manifestEntries.length,
      by_type: countEntriesByType(input.entries),
      items: manifestEntries
    },
    checksums: {
      aggregate: shortHash(
        JSON.stringify(
          manifestEntries.map((entry) => ({
            entry_type: entry.entry_type,
            entry_key: entry.entry_key,
            revision_id: entry.revision_id,
            checksum: entry.checksum
          }))
        )
      ),
      entries: checksums
    },
    collection_strategy:
      input.scopeType === "scene"
        ? {
            scene_configs: "scope-only",
            scene_assets: "scope-only",
            helper_scripts: "scope-only",
            platform_resources: "shared-or-scene-matched"
          }
        : {
            scene_configs: "all",
            scene_assets: "all",
            helper_scripts: "all",
            platform_resources: "all"
          }
  };
}

async function safeLstat(filePath) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

class ReleaseManager {
  constructor(options = {}) {
    this.store = options.store || createConfigStore({ driver: options.driver || "mysql" });
    this.ownsStore = !options.store;
    this.activeEnv = toTrimmedString(
      options.activeEnv || process.env.CONFIG_ACTIVE_ENV || DEFAULT_ACTIVE_ENV,
      "activeEnv",
      { required: true }
    );
    this.bundleRoot = path.resolve(options.bundleRoot || process.env.CONFIG_BUNDLE_ROOT || DEFAULT_BUNDLE_ROOT);
    this.rendererVersion = toTrimmedString(
      options.rendererVersion || RELEASE_MANAGER_RENDERER_VERSION,
      "rendererVersion",
      { required: true }
    );
    this.bundleRenderer = options.bundleRenderer || createBundleRenderer({
      projectRoot: options.projectRoot || PROJECT_ROOT,
      rendererVersion: this.rendererVersion
    });
    this.releaseValidator = options.releaseValidator || createReleaseValidator({
      projectRoot: options.projectRoot || PROJECT_ROOT
    });
  }

  async close() {
    if (this.ownsStore && typeof this.store.close === "function") {
      await this.store.close();
    }
  }

  normalizeScope(input = {}) {
    const environment = toTrimmedString(input.environment || this.activeEnv, "environment", { required: true });
    const scopeType = toTrimmedString(input.scopeType || "all", "scopeType", { required: true });
    const scopeValue =
      scopeType === "all"
        ? toTrimmedString(input.scopeValue || DEFAULT_SCOPE_VALUE, "scopeValue", { required: true })
        : toTrimmedString(input.scopeValue, "scopeValue", { required: true });

    if (!["all", "scene"].includes(scopeType)) {
      throw createAppError("INVALID_REQUEST", `Unsupported release scopeType: ${scopeType}.`, {
        stage: "release-manager"
      });
    }

    return {
      environment,
      scopeType,
      scopeValue
    };
  }

  async collectScopeRecords(scope) {
    if (scope.scopeType === "all") {
      const [sceneConfigs, platformResources, sceneAssets, helperScripts] = await Promise.all([
        this.store.listSceneConfigs(),
        this.store.listPlatformResources(),
        this.store.listSceneAssets(),
        this.store.listHelperScripts()
      ]);

      return {
        sceneConfigs,
        platformResources,
        sceneAssets,
        helperScripts
      };
    }

    const [sceneConfigs, allPlatformResources, sceneAssets, helperScripts] = await Promise.all([
      this.store.listSceneConfigs({ scene: scope.scopeValue }),
      this.store.listPlatformResources(),
      this.store.listSceneAssets({ scene: scope.scopeValue }),
      this.store.listHelperScripts({ scene: scope.scopeValue })
    ]);

    if (!sceneConfigs.length) {
      throw createAppError("INVALID_REQUEST", `Scene config not found for scope ${scope.scopeValue}.`, {
        stage: "release-manager"
      });
    }

    return {
      sceneConfigs,
      platformResources: allPlatformResources.filter(
        (resource) => !resource.scene || resource.scene === scope.scopeValue
      ),
      sceneAssets,
      helperScripts
    };
  }

  async buildFrozenEntry(entryType, record) {
    const revisionId = Number(record.currentRevisionId || 0);
    if (!revisionId) {
      throw createAppError("INVALID_REQUEST", `${entryType} ${buildEntryKey(entryType, record)} has no revision.`, {
        stage: "release-manager"
      });
    }

    const revision = await this.store.getRevisionById(revisionId);
    if (!revision) {
      throw createAppError("INVALID_REQUEST", `Revision ${revisionId} not found.`, {
        stage: "release-manager"
      });
    }

    const expectedTargetType = TARGET_TYPE_BY_ENTRY[entryType];
    if (revision.targetType !== expectedTargetType || Number(revision.targetId) !== Number(record.id)) {
      throw createAppError(
        "INVALID_REQUEST",
        `Revision ${revisionId} does not match ${entryType} target ${record.id}.`,
        {
          stage: "release-manager"
        }
      );
    }

    const entry = {
      entryType,
      entryKey: buildEntryKey(entryType, record),
      targetId: record.id,
      revisionId: revision.id,
      snapshotText: revision.sourceText || "",
      snapshotJson: buildSnapshotJson(entryType, record, revision),
      checksum: revision.checksum
    };
    entry.relativePath = buildEntryRelativePath(entry);
    return entry;
  }

  async collectReleaseEntries(scope) {
    const records = await this.collectScopeRecords(scope);
    const groupedRecords = [
      ["scene-config", records.sceneConfigs],
      ["platform-resource", records.platformResources],
      ["scene-asset", records.sceneAssets],
      ["helper-script", records.helperScripts]
    ];

    const entries = (
      await Promise.all(
        groupedRecords.flatMap(([entryType, items]) =>
          items.map((record) => this.buildFrozenEntry(entryType, record))
        )
      )
    ).sort((left, right) => {
      const typeDelta =
        ENTRY_TYPE_ORDER.indexOf(left.entryType) - ENTRY_TYPE_ORDER.indexOf(right.entryType);
      if (typeDelta !== 0) {
        return typeDelta;
      }

      return left.entryKey.localeCompare(right.entryKey);
    });

    if (!entries.length) {
      throw createAppError("INVALID_REQUEST", "No release entries found for the requested scope.", {
        stage: "release-manager"
      });
    }

    return entries;
  }

  getEnvironmentRoot(environment) {
    return path.join(this.bundleRoot, environment);
  }

  getReleaseBundlePath(environment, releaseId) {
    return path.join(this.getEnvironmentRoot(environment), releaseId);
  }

  getCurrentBundlePath(environment) {
    return path.join(this.getEnvironmentRoot(environment), "current");
  }

  async renderBundle(release, entries) {
    return this.bundleRenderer.renderBundle({ release, entries });
  }

  async validateBundle(release, entries = []) {
    return this.bundleRenderer.validateBundle({ release, entries });
  }

  async validateReleaseForPublish(release, entries = null) {
    const effectiveEntries = Array.isArray(entries) ? entries : await this.store.listReleaseEntries(release.releaseId);
    return this.releaseValidator.assertValid({
      release,
      entries: effectiveEntries
    });
  }

  async validateActiveBundleAfterActivation(release, pointer = null) {
    const entries = await this.store.listReleaseEntries(release.releaseId);
    const activePointer = pointer || await this.store.getReleasePointer(
      release.environment,
      release.scopeType,
      release.scopeValue
    );

    if (!activePointer || activePointer.activeReleaseId !== release.releaseId) {
      throw createAppError("INVALID_REQUEST", "Active release pointer does not match the published release.", {
        stage: "release-manager",
        details: {
          releaseId: release.releaseId,
          pointerActiveReleaseId: activePointer?.activeReleaseId || null
        }
      });
    }

    let currentPath = null;
    let currentTarget = null;
    if (this.shouldUpdateCurrentLink(release.scopeType)) {
      currentPath = this.getCurrentBundlePath(release.environment);
      const currentStat = await safeLstat(currentPath);
      if (!currentStat || !currentStat.isSymbolicLink()) {
        throw createAppError("INVALID_REQUEST", "Current bundle pointer is missing or is not a symlink.", {
          stage: "release-manager",
          details: {
            releaseId: release.releaseId,
            currentPath,
            exists: Boolean(currentStat)
          }
        });
      }

      currentTarget = await this.readCurrentLinkTarget(release.environment);
      if (currentTarget !== release.releaseId) {
        throw createAppError("INVALID_REQUEST", "Current bundle pointer does not target the published release.", {
          stage: "release-manager",
          details: {
            releaseId: release.releaseId,
            currentPath,
            currentTarget
          }
        });
      }
    }

    const activeBundleRelease = currentPath
      ? {
          ...release,
          bundlePath: currentPath
        }
      : release;
    const bundleValidation = await this.validateBundle(activeBundleRelease, entries);
    const releaseValidation = await this.validateReleaseForPublish(activeBundleRelease, entries);

    return {
      currentPath,
      currentTarget,
      bundleValidation,
      releaseValidation
    };
  }

  async saveDraftRelease(release, entries) {
    const persistedRelease = await this.store.saveRelease({
      releaseId: release.releaseId,
      environment: release.environment,
      scopeType: release.scopeType,
      scopeValue: release.scopeValue,
      status: RELEASE_STATUS_DRAFT,
      manifest: release.manifest,
      bundlePath: release.bundlePath,
      createdBy: release.createdBy,
      publishNote: release.publishNote,
      createdAt: release.createdAt,
      publishedAt: null
    });
    const persistedEntries = await this.store.setReleaseEntries(
      release.releaseId,
      entries.map((entry) => ({
        entryType: entry.entryType,
        entryKey: entry.entryKey,
        targetId: entry.targetId,
        revisionId: entry.revisionId,
        snapshotText: entry.snapshotText,
        snapshotJson: entry.snapshotJson,
        checksum: entry.checksum
      }))
    );

    return {
      release: persistedRelease,
      entries: persistedEntries
    };
  }

  async readCurrentLinkTarget(environment) {
    const currentPath = this.getCurrentBundlePath(environment);
    const currentStat = await safeLstat(currentPath);

    if (!currentStat) {
      return null;
    }

    if (!currentStat.isSymbolicLink()) {
      throw new Error(`${currentPath} already exists and is not a symlink.`);
    }

    return fs.readlink(currentPath);
  }

  async setCurrentLink(environment, releaseId) {
    const environmentRoot = this.getEnvironmentRoot(environment);
    const currentPath = this.getCurrentBundlePath(environment);
    const currentStat = await safeLstat(currentPath);

    await fs.mkdir(environmentRoot, { recursive: true });

    if (currentStat && !currentStat.isSymbolicLink()) {
      throw new Error(`${currentPath} already exists and is not a symlink.`);
    }

    const tempLinkPath = path.join(environmentRoot, `.current.${Date.now()}.${process.pid}`);
    await fs.rm(tempLinkPath, { recursive: true, force: true });
    await fs.symlink(releaseId, tempLinkPath, "dir");

    if (currentStat) {
      await fs.unlink(currentPath);
    }

    await fs.rename(tempLinkPath, currentPath);
    return currentPath;
  }

  async restoreCurrentLink(environment, linkTarget) {
    const currentPath = this.getCurrentBundlePath(environment);
    const currentStat = await safeLstat(currentPath);

    if (!linkTarget) {
      if (currentStat && currentStat.isSymbolicLink()) {
        await fs.unlink(currentPath);
      }
      return null;
    }

    await this.setCurrentLink(environment, linkTarget);
    return currentPath;
  }

  shouldUpdateCurrentLink(scopeType) {
    return scopeType === "all";
  }

  async activateRelease(input) {
    const releaseId = toTrimmedString(input.releaseId, "releaseId", { required: true });
    const updatedBy = toTrimmedString(input.updatedBy || input.createdBy || "system", "updatedBy", {
      required: true
    });
    const publishedAt = toDateValue(input.publishedAt, "publishedAt");
    const release = await this.store.getRelease(releaseId);

    if (!release) {
      throw createAppError("INVALID_REQUEST", `Release ${releaseId} not found.`, {
        stage: "release-manager"
      });
    }

    await this.validateBundle(release);
    const releaseValidation = await this.validateReleaseForPublish(release);

    const previousPointer = await this.store.getReleasePointer(
      release.environment,
      release.scopeType,
      release.scopeValue
    );
    const previousLinkTarget = this.shouldUpdateCurrentLink(release.scopeType)
      ? await this.readCurrentLinkTarget(release.environment)
      : null;
    const previousStatus = {
      status: release.status,
      publishedAt: release.publishedAt
    };

    await this.store.saveRelease({
      ...release,
      status: RELEASE_STATUS_PUBLISHED,
      publishedAt,
      publishNote: input.publishNote || release.publishNote
    });

    let pointer = null;
    let currentPath = null;
    let postActivationValidation = null;
    const nextPreviousReleaseId =
      previousPointer?.activeReleaseId && previousPointer.activeReleaseId !== releaseId
        ? previousPointer.activeReleaseId
        : previousPointer?.previousReleaseId || null;

    try {
      pointer = await this.store.setReleasePointer({
        environment: release.environment,
        scopeType: release.scopeType,
        scopeValue: release.scopeValue,
        activeReleaseId: release.releaseId,
        previousReleaseId: nextPreviousReleaseId,
        updatedBy,
        updatedAt: publishedAt
      });

      if (this.shouldUpdateCurrentLink(release.scopeType)) {
        currentPath = await this.setCurrentLink(release.environment, release.releaseId);
      }

      postActivationValidation = await this.validateActiveBundleAfterActivation(release, pointer);
    } catch (error) {
      await this.store.saveRelease({
        ...release,
        status: previousStatus.status,
        publishedAt: previousStatus.publishedAt
      });

      if (previousPointer) {
        await this.store.setReleasePointer({
          environment: previousPointer.environment,
          scopeType: previousPointer.scopeType,
          scopeValue: previousPointer.scopeValue,
          activeReleaseId: previousPointer.activeReleaseId,
          previousReleaseId: previousPointer.previousReleaseId,
          updatedBy: previousPointer.updatedBy,
          updatedAt: previousPointer.updatedAt
        });
      } else {
        await this.store.deleteReleasePointer(release.environment, release.scopeType, release.scopeValue);
      }

      if (this.shouldUpdateCurrentLink(release.scopeType)) {
        await this.restoreCurrentLink(release.environment, previousLinkTarget);
      }

      throw error;
    }

    return {
      release: await this.store.getRelease(release.releaseId),
      pointer,
      currentPath,
      preflightValidation: releaseValidation,
      postActivationValidation
    };
  }

  async createRelease(input = {}) {
    const scope = this.normalizeScope(input);
    const createdAt = toDateValue(input.createdAt, "createdAt");
    const createdBy = toTrimmedString(input.createdBy || "system", "createdBy", { required: true });
    const publishNote = toTrimmedString(input.publishNote, "publishNote");
    const entries = await this.collectReleaseEntries(scope);
    const releaseId = toTrimmedString(input.releaseId, "releaseId") || buildReleaseId({
      environment: scope.environment,
      scopeType: scope.scopeType,
      scopeValue: scope.scopeValue,
      createdAt,
      createdBy
    });
    const existing = await this.store.getRelease(releaseId);

    if (existing) {
      throw createAppError("INVALID_REQUEST", `Release ${releaseId} already exists.`, {
        stage: "release-manager"
      });
    }

    const release = {
      releaseId,
      environment: scope.environment,
      scopeType: scope.scopeType,
      scopeValue: scope.scopeValue,
      createdAt,
      createdBy,
      publishNote,
      bundlePath: this.getReleaseBundlePath(scope.environment, releaseId)
    };

    for (const entry of entries) {
      entry.relativePath = buildEntryRelativePath(entry);
    }

    release.manifest = buildManifest({
      releaseId,
      environment: scope.environment,
      scopeType: scope.scopeType,
      scopeValue: scope.scopeValue,
      createdAt,
      createdBy,
      publishNote,
      rendererVersion: this.rendererVersion,
      entries
    });

    let renderedBundle = null;
    try {
      renderedBundle = await this.renderBundle(release, entries);
      const validation = await this.validateBundle(release, entries);
      const preflightValidation = await this.validateReleaseForPublish(release, entries);
      const persisted = await this.saveDraftRelease(release, entries);

      return {
        release: persisted.release,
        entries: persisted.entries,
        renderedBundle,
        validation,
        preflightValidation
      };
    } catch (error) {
      await this.store.deleteRelease(release.releaseId);
      await fs.rm(release.bundlePath, { recursive: true, force: true });
      throw error;
    }
  }

  async publishRelease(input = {}) {
    const created = await this.createRelease(input);
    const activation = await this.activateRelease({
      releaseId: created.release.releaseId,
      updatedBy: input.createdBy || "system",
      publishNote: input.publishNote,
      publishedAt: input.publishedAt
    });

    return {
      ...created,
      release: activation.release,
      activation
    };
  }

  async rollbackRelease(input = {}) {
    const scope = this.normalizeScope(input);
    const updatedAt = toDateValue(input.updatedAt, "updatedAt");
    const updatedBy = toTrimmedString(input.updatedBy || "system", "updatedBy", { required: true });
    const pointer = await this.store.getReleasePointer(scope.environment, scope.scopeType, scope.scopeValue);

    if (!pointer || !pointer.previousReleaseId) {
      throw createAppError("INVALID_REQUEST", "No previous release is available for rollback.", {
        stage: "release-manager"
      });
    }

    const previousRelease = await this.store.getRelease(pointer.previousReleaseId);
    if (!previousRelease) {
      throw createAppError("INVALID_REQUEST", `Previous release ${pointer.previousReleaseId} not found.`, {
        stage: "release-manager"
      });
    }

    await this.validateBundle(previousRelease);
    await this.validateReleaseForPublish(previousRelease);

    const previousLinkTarget = this.shouldUpdateCurrentLink(scope.scopeType)
      ? await this.readCurrentLinkTarget(scope.environment)
      : null;

    try {
      if (this.shouldUpdateCurrentLink(scope.scopeType)) {
        await this.setCurrentLink(scope.environment, previousRelease.releaseId);
      }
    } catch (error) {
      throw error;
    }

    let nextPointer = null;
    try {
      nextPointer = await this.store.setReleasePointer({
        environment: scope.environment,
        scopeType: scope.scopeType,
        scopeValue: scope.scopeValue,
        activeReleaseId: previousRelease.releaseId,
        previousReleaseId: pointer.activeReleaseId,
        updatedBy,
        updatedAt
      });
    } catch (error) {
      if (this.shouldUpdateCurrentLink(scope.scopeType)) {
        await this.restoreCurrentLink(scope.environment, previousLinkTarget);
      }
      throw error;
    }

    return {
      release: previousRelease,
      pointer: nextPointer,
      currentPath: this.shouldUpdateCurrentLink(scope.scopeType)
        ? this.getCurrentBundlePath(scope.environment)
        : null
    };
  }

  async getReleaseSnapshot(releaseId) {
    const normalizedReleaseId = toTrimmedString(releaseId, "releaseId", { required: true });
    const [release, entries] = await Promise.all([
      this.store.getRelease(normalizedReleaseId),
      this.store.listReleaseEntries(normalizedReleaseId)
    ]);

    if (!release) {
      return null;
    }

    return {
      release,
      entries
    };
  }
}

function createReleaseManager(options = {}) {
  return new ReleaseManager(options);
}

module.exports = {
  DEFAULT_ACTIVE_ENV,
  DEFAULT_BUNDLE_ROOT,
  RELEASE_MANAGER_RENDERER_VERSION,
  ReleaseManager,
  buildReleaseId,
  createReleaseManager
};
