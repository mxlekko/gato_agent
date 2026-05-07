const fs = require("fs/promises");
const path = require("path");

const { loadPlatformResources } = require("../platform/compiler/validate");
const { createReleaseManager } = require("./release-manager");
const { createAppError } = require("../utils/errors");
const { PROJECT_ROOT } = require("../utils/path-resolver");

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

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function buildPlatformResourceKey(resource) {
  return `${resource?.kind || ""}:${resource?.name || ""}@${resource?.version || ""}`;
}

function buildRepositoryPlatformIndex() {
  const resources = loadPlatformResources(path.join(PROJECT_ROOT, "platform"));
  const byKey = new Map();
  const toolByRef = new Map();

  for (const group of [resources.templates, resources.tools, resources.queries, resources.skills]) {
    for (const record of group) {
      const metadata = record.document?.metadata || {};
      const spec = record.document?.spec || {};
      const kind = String(record.document?.kind || "").trim();
      const normalizedKind = {
        WorkflowTemplate: "template",
        ToolDefinition: "tool",
        QueryProfile: "query",
        BusinessSkill: "skill"
      }[kind] || kind.toLowerCase();
      const indexed = {
        ...record,
        kind: normalizedKind,
        name: metadata.name,
        version: metadata.version
      };

      byKey.set(buildPlatformResourceKey(indexed), indexed);

      if (normalizedKind === "tool" && spec.ref) {
        toolByRef.set(spec.ref, indexed);
      }
    }
  }

  return {
    byKey,
    toolByRef
  };
}

function ensureArrayIncludes(document, pathSegments, value) {
  let cursor = document;
  for (const segment of pathSegments.slice(0, -1)) {
    if (!isObject(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  const finalKey = pathSegments[pathSegments.length - 1];
  const current = Array.isArray(cursor[finalKey]) ? cursor[finalKey] : [];
  if (current.includes(value)) {
    return false;
  }

  cursor[finalKey] = Array.from(new Set([...current, value]));
  return true;
}

function markDocumentPathTrue(document, pathSegments) {
  let cursor = document;
  for (const segment of pathSegments.slice(0, -1)) {
    if (!isObject(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }

  const finalKey = pathSegments[pathSegments.length - 1];
  if (cursor[finalKey] === true) {
    return false;
  }

  cursor[finalKey] = true;
  return true;
}

async function savePatchedPlatformResource(store, record, document, operator) {
  return store.savePlatformResourceDraft(
    {
      kind: record.kind,
      name: record.name,
      version: record.version,
      ref: record.ref,
      scene: record.scene,
      status: record.status,
      document,
      sourceText: JSON.stringify(document, null, 2),
      updatedBy: operator
    },
    {
      operator,
      changeNote: "prepare template-scene release policies"
    }
  );
}

async function ensureTemplateSceneReleasePolicies(store, options = {}) {
  const operator = toTrimmedString(options.operator || "console-api", "operator", { required: true });
  const resources = await store.listPlatformResources();
  const repositoryIndex = buildRepositoryPlatformIndex();
  const byKey = new Map(resources.map((resource) => [buildPlatformResourceKey(resource), resource]));
  const toolByRef = new Map(
    resources
      .filter((resource) => resource.kind === "tool" && resource.ref)
      .map((resource) => [resource.ref, resource])
  );
  const patchedByKey = new Map();

  function getMutableRecord(record) {
    const key = buildPlatformResourceKey(record);
    if (!patchedByKey.has(key)) {
      patchedByKey.set(key, {
        record,
        document: cloneJson(record.document),
        changed: false
      });
    }

    return patchedByKey.get(key);
  }

  for (const skill of resources.filter((resource) => resource.kind === "skill")) {
    const scene = toTrimmedString(skill.document?.spec?.scene || skill.scene);
    const templateRef = skill.document?.spec?.templateRef || {};
    const templateKey = `template:${templateRef.name || ""}@${templateRef.version || ""}`;
    const templateRecord = byKey.get(templateKey);
    const repositoryTemplate = repositoryIndex.byKey.get(templateKey);
    const repositoryAllowsNewScenes =
      repositoryTemplate?.document?.spec?.sceneCreation?.allowNewScenes === true;

    if (scene && templateRecord && repositoryAllowsNewScenes) {
      const mutable = getMutableRecord(templateRecord);
      mutable.changed = ensureArrayIncludes(
        mutable.document,
        ["spec", "compatibleScenes"],
        scene
      ) || mutable.changed;
      mutable.changed = markDocumentPathTrue(
        mutable.document,
        ["spec", "sceneCreation", "allowNewScenes"]
      ) || mutable.changed;
    }

    const toolBindings = isObject(skill.document?.spec?.toolBindings)
      ? skill.document.spec.toolBindings
      : {};

    for (const binding of Object.values(toolBindings)) {
      const toolRef = toTrimmedString(binding?.toolRef);
      const toolRecord = toolRef ? toolByRef.get(toolRef) : null;
      const repositoryTool = toolRef ? repositoryIndex.toolByRef.get(toolRef) : null;
      const repositoryAllowsTemplateScenes =
        repositoryTool?.document?.spec?.policy?.allowTemplateScenes === true;

      if (!scene || !toolRecord || !repositoryAllowsTemplateScenes) {
        continue;
      }

      const mutable = getMutableRecord(toolRecord);
      mutable.changed = ensureArrayIncludes(
        mutable.document,
        ["spec", "policy", "allowedScenes"],
        scene
      ) || mutable.changed;
      mutable.changed = markDocumentPathTrue(
        mutable.document,
        ["spec", "policy", "allowTemplateScenes"]
      ) || mutable.changed;
    }
  }

  const patchedResources = [];
  for (const item of patchedByKey.values()) {
    if (item.changed) {
      patchedResources.push(await savePatchedPlatformResource(
        store,
        item.record,
        item.document,
        operator
      ));
    }
  }

  return {
    patchedCount: patchedResources.length,
    patchedResources: patchedResources.map((resource) => ({
      kind: resource.kind,
      name: resource.name,
      version: resource.version
    }))
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

async function publishConsoleRelease(input = {}) {
  const environment = toTrimmedString(input.environment, "environment");
  const scopeType = toTrimmedString(input.scopeType || "all", "scopeType", { required: true });
  const scopeValue = scopeType === "all"
    ? toTrimmedString(input.scopeValue || "*", "scopeValue", { required: true })
    : toTrimmedString(input.scopeValue, "scopeValue", { required: true });
  const createdBy = toTrimmedString(input.createdBy || input.operator || "console-api", "createdBy", {
    required: true
  });
  const publishNote = toTrimmedString(input.publishNote || "console publish current drafts", "publishNote");
  const manager = createReleaseManager({
    activeEnv: environment || undefined
  });

  try {
    const policySync = await ensureTemplateSceneReleasePolicies(manager.store, {
      operator: createdBy
    });
    const published = await manager.publishRelease({
      environment: environment || undefined,
      scopeType,
      scopeValue,
      createdBy,
      publishNote,
      publishedAt: input.publishedAt
    });
    const entries = await manager.store.listReleaseEntries(published.release.releaseId);
    const currentBundleTarget = published.activation?.currentPath
      ? await manager.readCurrentLinkTarget(published.release.environment)
      : null;

    return {
      release: await buildReleaseSnapshot(manager, published.release, {
        entries,
        validation: published.activation?.preflightValidation || published.preflightValidation
      }),
      scope: {
        environment: published.release.environment,
        scopeType: published.release.scopeType,
        scopeValue: published.release.scopeValue
      },
      pointer: published.activation?.pointer || null,
      currentPath: published.activation?.currentPath || null,
      currentBundleTarget,
      renderedBundle: published.renderedBundle || null,
      policySync,
      validation: summarizeValidation(published.activation?.preflightValidation || published.preflightValidation)
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
  publishConsoleRelease,
  rollbackConsoleRelease
};
