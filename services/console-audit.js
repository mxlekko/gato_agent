const { createConfigStore } = require("./config-store");
const { createAppError } = require("../utils/errors");

const CONSOLE_AUDIT_STORE_DRIVER = "mysql";
const SUPPORTED_TARGET_TYPES = new Set([
  "scene-config",
  "platform-resource",
  "scene-asset",
  "helper-script"
]);

function toTrimmedString(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toPositiveInteger(value, fieldName, { required = false } = {}) {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    if (required) {
      throw createAppError("INVALID_REQUEST", `${fieldName} is required.`, {
        stage: "console-audit"
      });
    }
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createAppError("INVALID_REQUEST", `${fieldName} must be a positive integer.`, {
      stage: "console-audit",
      details: {
        fieldName,
        value
      }
    });
  }

  return parsed;
}

function toIsoDateTime(value) {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    return null;
  }

  const isoCandidate = normalized.includes("T")
    ? normalized
    : `${normalized.replace(" ", "T")}Z`;
  const parsed = new Date(isoCandidate);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}

async function withConsoleAuditStore(callback) {
  const store = createConfigStore({
    driver: CONSOLE_AUDIT_STORE_DRIVER
  });

  try {
    return await callback(store);
  } finally {
    await store.close();
  }
}

function normalizeTargetType(value, { required = false } = {}) {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    if (required) {
      throw createAppError("INVALID_REQUEST", "targetType is required.", {
        stage: "console-audit"
      });
    }
    return null;
  }

  if (!SUPPORTED_TARGET_TYPES.has(normalized)) {
    throw createAppError("INVALID_REQUEST", `Unsupported targetType: ${normalized}.`, {
      stage: "console-audit",
      details: {
        supportedTargetTypes: Array.from(SUPPORTED_TARGET_TYPES)
      }
    });
  }

  return normalized;
}

function normalizeRevisionFilters(input = {}) {
  const targetType = normalizeTargetType(input.targetType);
  const targetId = toPositiveInteger(input.targetId, "targetId");
  const limit = (() => {
    const parsed = toPositiveInteger(input.limit, "limit");
    return parsed ? Math.min(parsed, 200) : 50;
  })();
  const filters = {
    targetType,
    targetId,
    scene: toTrimmedString(input.scene),
    assetType: toTrimmedString(input.assetType),
    kind: toTrimmedString(input.kind),
    name: toTrimmedString(input.name),
    version: toTrimmedString(input.version),
    ref: toTrimmedString(input.ref),
    scriptType: toTrimmedString(input.scriptType),
    limit
  };

  if (filters.targetId && !filters.targetType) {
    throw createAppError("INVALID_REQUEST", "targetType is required when targetId is provided.", {
      stage: "console-audit"
    });
  }

  if (filters.scene && !filters.targetType) {
    throw createAppError("INVALID_REQUEST", "targetType is required when scene is provided.", {
      stage: "console-audit"
    });
  }

  if ((filters.assetType || filters.scriptType || filters.kind || filters.name || filters.version || filters.ref) && !filters.targetType) {
    throw createAppError("INVALID_REQUEST", "targetType is required when using target-specific filters.", {
      stage: "console-audit",
      details: {
        targetType,
        availableFilters: {
          assetType: filters.assetType || null,
          scriptType: filters.scriptType || null,
          kind: filters.kind || null,
          name: filters.name || null,
          version: filters.version || null,
          ref: filters.ref || null
        }
      }
    });
  }

  if (filters.assetType && filters.targetType !== "scene-asset") {
    throw createAppError("INVALID_REQUEST", "assetType filter only supports targetType=scene-asset.", {
      stage: "console-audit"
    });
  }

  if (filters.scriptType && filters.targetType !== "helper-script") {
    throw createAppError("INVALID_REQUEST", "scriptType filter only supports targetType=helper-script.", {
      stage: "console-audit"
    });
  }

  if ((filters.kind || filters.name || filters.version || filters.ref) && filters.targetType !== "platform-resource") {
    throw createAppError("INVALID_REQUEST", "kind/name/version/ref filters only support targetType=platform-resource.", {
      stage: "console-audit"
    });
  }

  return filters;
}

function buildSceneConfigTarget(record) {
  return {
    targetType: "scene-config",
    targetId: record.id,
    label: `scene-config:${record.scene}`,
    scene: record.scene,
    title: record.title,
    status: record.status,
    currentRevisionId: record.currentRevisionId,
    updatedBy: record.updatedBy || null,
    updatedAt: toIsoDateTime(record.updatedAt)
  };
}

function buildPlatformResourceTarget(record) {
  return {
    targetType: "platform-resource",
    targetId: record.id,
    label: `${record.kind}:${record.name}@${record.version}`,
    kind: record.kind,
    name: record.name,
    version: record.version,
    scene: record.scene || null,
    ref: record.ref || null,
    status: record.status,
    currentRevisionId: record.currentRevisionId,
    updatedBy: record.updatedBy || null,
    updatedAt: toIsoDateTime(record.updatedAt)
  };
}

function buildSceneAssetTarget(record) {
  return {
    targetType: "scene-asset",
    targetId: record.id,
    label: `${record.scene}:${record.assetType}`,
    scene: record.scene,
    assetType: record.assetType,
    ref: record.ref || null,
    status: record.status,
    currentRevisionId: record.currentRevisionId,
    updatedBy: record.updatedBy || null,
    updatedAt: toIsoDateTime(record.updatedAt)
  };
}

function buildHelperScriptTarget(record) {
  return {
    targetType: "helper-script",
    targetId: record.id,
    label: `${record.scene}:${record.scriptType}:${record.scriptName}`,
    scene: record.scene,
    scriptType: record.scriptType,
    scriptName: record.scriptName,
    status: record.status,
    currentRevisionId: record.currentRevisionId,
    updatedBy: record.updatedBy || null,
    updatedAt: toIsoDateTime(record.updatedAt)
  };
}

function buildTargetSummary(targetType, record) {
  if (!record) {
    return {
      targetType,
      targetId: null,
      label: `${targetType}:deleted`,
      deleted: true
    };
  }

  switch (targetType) {
    case "scene-config":
      return buildSceneConfigTarget(record);
    case "platform-resource":
      return buildPlatformResourceTarget(record);
    case "scene-asset":
      return buildSceneAssetTarget(record);
    case "helper-script":
      return buildHelperScriptTarget(record);
    default:
      return {
        targetType,
        targetId: record.id,
        label: `${targetType}:${record.id}`
      };
  }
}

async function resolveTargetRecords(store, targetType, filters) {
  switch (targetType) {
    case "scene-config":
      return store.listSceneConfigs({
        scene: filters.scene || undefined
      });
    case "platform-resource": {
      const records = await store.listPlatformResources({
        kind: filters.kind || undefined,
        scene: filters.scene || undefined,
        ref: filters.ref || undefined
      });

      return records.filter((record) => {
        if (filters.name && record.name !== filters.name) {
          return false;
        }
        if (filters.version && record.version !== filters.version) {
          return false;
        }
        return true;
      });
    }
    case "scene-asset":
      return store.listSceneAssets({
        scene: filters.scene || undefined,
        assetType: filters.assetType || undefined
      });
    case "helper-script":
      return store.listHelperScripts({
        scene: filters.scene || undefined,
        scriptType: filters.scriptType || undefined
      });
    default:
      throw createAppError("INVALID_REQUEST", `Unsupported targetType: ${targetType}.`, {
        stage: "console-audit"
      });
  }
}

async function buildTargetLookup(store, targetTypes = []) {
  const requestedTypes = targetTypes.length > 0
    ? Array.from(new Set(targetTypes))
    : Array.from(SUPPORTED_TARGET_TYPES);
  const lookup = new Map();

  await Promise.all(requestedTypes.map(async (targetType) => {
    const records = await resolveTargetRecords(store, targetType, {});
    for (const record of records) {
      lookup.set(`${targetType}:${record.id}`, record);
    }
  }));

  return lookup;
}

function buildRevisionSummary(revision, targetSummary) {
  return {
    id: revision.id,
    targetType: revision.targetType,
    targetId: revision.targetId,
    revisionNo: revision.revisionNo,
    checksum: revision.checksum,
    operator: revision.operator || null,
    changeNote: revision.changeNote || null,
    createdAt: toIsoDateTime(revision.createdAt),
    isCurrentRevision: Boolean(targetSummary?.currentRevisionId && Number(targetSummary.currentRevisionId) === Number(revision.id)),
    target: targetSummary
  };
}

async function listRevisionRows(store, filters, matchedRecords = null) {
  if (!filters.targetType || !matchedRecords) {
    return store.listRevisions({
      targetType: filters.targetType || undefined,
      targetId: filters.targetId || undefined,
      limit: filters.limit
    });
  }

  if (filters.targetId) {
    return store.listRevisions({
      targetType: filters.targetType,
      targetId: filters.targetId,
      limit: filters.limit
    });
  }

  if (!matchedRecords.length) {
    return [];
  }

  const revisionGroups = await Promise.all(
    matchedRecords.map((record) =>
      store.listRevisions({
        targetType: filters.targetType,
        targetId: record.id,
        limit: filters.limit
      })
    )
  );

  return revisionGroups
    .flat()
    .sort((left, right) => {
      const leftTime = Date.parse(toIsoDateTime(left.createdAt) || 0);
      const rightTime = Date.parse(toIsoDateTime(right.createdAt) || 0);
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return Number(right.id) - Number(left.id);
    })
    .slice(0, filters.limit);
}

async function listConsoleRevisions(input = {}) {
  const filters = normalizeRevisionFilters(input);

  return withConsoleAuditStore(async (store) => {
    let matchedRecords = null;
    if (filters.targetType) {
      matchedRecords = await resolveTargetRecords(store, filters.targetType, filters);

      if (filters.targetId) {
        matchedRecords = matchedRecords.filter((record) => Number(record.id) === Number(filters.targetId));
      }
    }

    const revisions = await listRevisionRows(store, filters, matchedRecords);
    const targetLookup = await buildTargetLookup(
      store,
      filters.targetType ? [filters.targetType] : []
    );
    const items = revisions.map((revision) => {
      const record = targetLookup.get(`${revision.targetType}:${revision.targetId}`) || null;
      return buildRevisionSummary(revision, buildTargetSummary(revision.targetType, record));
    });
    const countsByTargetType = items.reduce((result, item) => {
      result[item.targetType] = (result[item.targetType] || 0) + 1;
      return result;
    }, {});

    return {
      filters: {
        targetType: filters.targetType || null,
        targetId: filters.targetId || null,
        scene: filters.scene || null,
        assetType: filters.assetType || null,
        kind: filters.kind || null,
        name: filters.name || null,
        version: filters.version || null,
        ref: filters.ref || null,
        scriptType: filters.scriptType || null,
        limit: filters.limit
      },
      total: items.length,
      countsByTargetType,
      items
    };
  });
}

async function getConsoleRevisionDetail(input = {}) {
  const revisionId = toPositiveInteger(input.revisionId, "revisionId", { required: true });

  return withConsoleAuditStore(async (store) => {
    const revision = await store.getRevisionById(revisionId);
    if (!revision) {
      throw createAppError("INVALID_REQUEST", `Revision ${revisionId} not found.`, {
        httpStatus: 404,
        stage: "console-audit"
      });
    }

    const targetLookup = await buildTargetLookup(store, [revision.targetType]);
    const record = targetLookup.get(`${revision.targetType}:${revision.targetId}`) || null;
    const target = buildTargetSummary(revision.targetType, record);

    return {
      revision: {
        ...buildRevisionSummary(revision, target),
        sourceText: revision.sourceText,
        document: cloneJson(revision.document)
      }
    };
  });
}

module.exports = {
  getConsoleRevisionDetail,
  listConsoleRevisions
};
