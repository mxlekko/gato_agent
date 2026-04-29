const crypto = require("crypto");
const mysql = require("mysql2/promise");
const { createAppError, normalizeError } = require("../../utils/errors");

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toTrimmedString(value, fieldName, { required = false, allowEmpty = false } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      throw createAppError("INVALID_REQUEST", `${fieldName} is required.`, {
        stage: "config-store"
      });
    }

    return null;
  }

  const normalized = String(value).trim();
  if (!allowEmpty && !normalized) {
    if (required) {
      throw createAppError("INVALID_REQUEST", `${fieldName} is required.`, {
        stage: "config-store"
      });
    }

    return null;
  }

  return normalized;
}

function toRawText(value, fieldName, { required = false, allowEmpty = false } = {}) {
  if (value === undefined || value === null) {
    if (required) {
      throw createAppError("INVALID_REQUEST", `${fieldName} is required.`, {
        stage: "config-store"
      });
    }

    return null;
  }

  const normalized = String(value);
  if (!allowEmpty && normalized.length === 0) {
    if (required) {
      throw createAppError("INVALID_REQUEST", `${fieldName} is required.`, {
        stage: "config-store"
      });
    }

    return null;
  }

  return normalized;
}

function toDateValue(value) {
  if (!value) {
    return new Date();
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createAppError("INVALID_REQUEST", `Invalid datetime value: ${value}.`, {
      stage: "config-store"
    });
  }

  return parsed;
}

function parseJsonColumn(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    return JSON.parse(value);
  }

  return value;
}

function parseSceneConfigDocument(sourceText) {
  try {
    return JSON.parse(sourceText);
  } catch (error) {
    throw createAppError("INVALID_REQUEST", "Scene config sourceText must be valid JSON.", {
      stage: "config-store",
      details: {
        cause: error.message
      }
    });
  }
}

function toJsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function resolvePlatformKind(inputKind, documentKind) {
  const normalizedInput = toTrimmedString(inputKind, "kind")?.toLowerCase();
  if (normalizedInput) {
    return normalizedInput;
  }

  switch (documentKind) {
    case "WorkflowTemplate":
      return "template";
    case "BusinessSkill":
      return "skill";
    case "ToolDefinition":
      return "tool";
    case "QueryProfile":
      return "query";
    default:
      throw createAppError("INVALID_REQUEST", `Unsupported platform resource kind: ${documentKind || "unknown"}.`, {
        stage: "config-store"
      });
  }
}

function normalizeSceneConfigDraft(input) {
  const document = cloneJson(input.document || parseSceneConfigDocument(input.sourceText));
  const scene = toTrimmedString(input.scene || document?.scene, "scene", { required: true });
  const title = toTrimmedString(input.title || document?.title || scene, "title", { required: true });
  const enabled = input.enabled ?? document?.enabled;
  const executionMode = toTrimmedString(
    input.executionMode || document?.execution?.mode || "agent-runtime",
    "executionMode",
    { required: true }
  );
  const status = toTrimmedString(input.status || document?.status || "draft", "status", { required: true });
  const sourceText = input.sourceText ? String(input.sourceText) : toJsonText(document);

  return {
    scene,
    title,
    enabled: enabled === true ? 1 : 0,
    executionMode,
    status,
    document,
    sourceText,
    checksum: toTrimmedString(input.checksum, "checksum") || hashText(sourceText),
    updatedBy: toTrimmedString(input.updatedBy, "updatedBy"),
    updatedAt: toDateValue(input.updatedAt)
  };
}

function normalizePlatformResourceDraft(input) {
  const document = cloneJson(input.document);
  if (!document || typeof document !== "object") {
    throw createAppError("INVALID_REQUEST", "Platform resource document is required.", {
      stage: "config-store"
    });
  }

  const metadata = document.metadata || {};
  const spec = document.spec || {};
  const kind = resolvePlatformKind(input.kind, document.kind);
  const name = toTrimmedString(input.name || metadata.name, "name", { required: true });
  const version = toTrimmedString(input.version || metadata.version, "version", { required: true });
  const ref = toTrimmedString(input.ref || spec.ref, "ref");
  const scene = toTrimmedString(input.scene || spec.scene, "scene");
  const status = toTrimmedString(input.status || metadata.status || "draft", "status", { required: true });
  const sourceText = toRawText(input.sourceText, "sourceText", { required: true, allowEmpty: true });

  return {
    kind,
    name,
    version,
    ref,
    scene,
    status,
    document,
    sourceText,
    checksum: toTrimmedString(input.checksum, "checksum") || hashText(sourceText),
    updatedBy: toTrimmedString(input.updatedBy, "updatedBy"),
    updatedAt: toDateValue(input.updatedAt)
  };
}

function normalizeSceneAssetDraft(input) {
  const contentText = toRawText(
    input.contentText || input.sourceText,
    "contentText",
    { required: true, allowEmpty: true }
  );
  const document = input.document === undefined ? null : cloneJson(input.document);

  return {
    scene: toTrimmedString(input.scene, "scene", { required: true }),
    assetType: toTrimmedString(input.assetType, "assetType", { required: true }),
    ref: toTrimmedString(input.ref, "ref"),
    contentText,
    contentFormat: toTrimmedString(input.contentFormat || "text", "contentFormat", { required: true }),
    document,
    checksum: toTrimmedString(input.checksum, "checksum") || hashText(contentText),
    status: toTrimmedString(input.status || "draft", "status", { required: true }),
    updatedBy: toTrimmedString(input.updatedBy, "updatedBy"),
    updatedAt: toDateValue(input.updatedAt)
  };
}

function normalizeHelperScriptDraft(input) {
  const contentText = toRawText(
    input.contentText || input.sourceText,
    "contentText",
    { required: true, allowEmpty: true }
  );

  return {
    scene: toTrimmedString(input.scene, "scene", { required: true }),
    scriptType: toTrimmedString(input.scriptType, "scriptType", { required: true }),
    scriptName: toTrimmedString(input.scriptName, "scriptName", { required: true }),
    contentText,
    checksum: toTrimmedString(input.checksum, "checksum") || hashText(contentText),
    status: toTrimmedString(input.status || "draft", "status", { required: true }),
    updatedBy: toTrimmedString(input.updatedBy, "updatedBy"),
    updatedAt: toDateValue(input.updatedAt)
  };
}

function normalizeRelease(input) {
  const manifest = cloneJson(input.manifest || {});

  return {
    releaseId: toTrimmedString(input.releaseId, "releaseId", { required: true }),
    environment: toTrimmedString(input.environment, "environment", { required: true }),
    scopeType: toTrimmedString(input.scopeType, "scopeType", { required: true }),
    scopeValue: toTrimmedString(input.scopeValue, "scopeValue", { required: true }),
    status: toTrimmedString(input.status, "status", { required: true }),
    manifest,
    bundlePath: toTrimmedString(input.bundlePath, "bundlePath", { required: true }),
    createdBy: toTrimmedString(input.createdBy, "createdBy"),
    publishNote: toTrimmedString(input.publishNote, "publishNote"),
    createdAt: toDateValue(input.createdAt),
    publishedAt: input.publishedAt ? toDateValue(input.publishedAt) : null
  };
}

function normalizeReleaseEntry(entry) {
  return {
    releaseId: toTrimmedString(entry.releaseId, "releaseId", { required: true }),
    entryType: toTrimmedString(entry.entryType, "entryType", { required: true }),
    entryKey: toTrimmedString(entry.entryKey, "entryKey", { required: true }),
    targetId: Number(entry.targetId),
    revisionId: Number(entry.revisionId),
    snapshotText: toRawText(entry.snapshotText, "snapshotText", { required: true, allowEmpty: true }),
    snapshotJson: entry.snapshotJson === undefined ? null : cloneJson(entry.snapshotJson),
    checksum: toTrimmedString(entry.checksum, "checksum") || hashText(entry.snapshotText)
  };
}

function normalizeReleasePointer(input) {
  return {
    environment: toTrimmedString(input.environment, "environment", { required: true }),
    scopeType: toTrimmedString(input.scopeType, "scopeType", { required: true }),
    scopeValue: toTrimmedString(input.scopeValue, "scopeValue", { required: true }),
    activeReleaseId: toTrimmedString(input.activeReleaseId, "activeReleaseId", { required: true }),
    previousReleaseId: toTrimmedString(input.previousReleaseId, "previousReleaseId"),
    updatedBy: toTrimmedString(input.updatedBy, "updatedBy"),
    updatedAt: toDateValue(input.updatedAt)
  };
}

function mapSceneConfigRow(row) {
  return row
    ? {
        id: row.id,
        scene: row.scene,
        title: row.title,
        enabled: row.enabled === 1,
        executionMode: row.execution_mode,
        status: row.status,
        document: parseJsonColumn(row.document_json),
        sourceText: row.source_text,
        checksum: row.checksum,
        currentRevisionId: row.current_revision_id,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at
      }
    : null;
}

function mapPlatformResourceRow(row) {
  return row
    ? {
        id: row.id,
        kind: row.kind,
        name: row.name,
        version: row.version,
        ref: row.ref,
        scene: row.scene,
        status: row.status,
        document: parseJsonColumn(row.document_json),
        sourceText: row.source_text,
        checksum: row.checksum,
        currentRevisionId: row.current_revision_id,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at
      }
    : null;
}

function mapSceneAssetRow(row) {
  return row
    ? {
        id: row.id,
        scene: row.scene,
        assetType: row.asset_type,
        ref: row.ref,
        contentText: row.content_text,
        contentFormat: row.content_format,
        checksum: row.checksum,
        status: row.status,
        currentRevisionId: row.current_revision_id,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at
      }
    : null;
}

function mapHelperScriptRow(row) {
  return row
    ? {
        id: row.id,
        scene: row.scene,
        scriptType: row.script_type,
        scriptName: row.script_name,
        contentText: row.content_text,
        checksum: row.checksum,
        status: row.status,
        currentRevisionId: row.current_revision_id,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at
      }
    : null;
}

function mapRevisionRow(row) {
  return row
    ? {
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        revisionNo: row.revision_no,
        sourceText: row.source_text,
        document: parseJsonColumn(row.document_json),
        checksum: row.checksum,
        operator: row.operator,
        changeNote: row.change_note,
        createdAt: row.created_at
      }
    : null;
}

function mapReleaseRow(row) {
  return row
    ? {
        id: row.id,
        releaseId: row.release_id,
        environment: row.environment,
        scopeType: row.scope_type,
        scopeValue: row.scope_value,
        status: row.status,
        manifest: parseJsonColumn(row.manifest_json),
        bundlePath: row.bundle_path,
        createdBy: row.created_by,
        publishNote: row.publish_note,
        createdAt: row.created_at,
        publishedAt: row.published_at
      }
    : null;
}

function mapReleaseEntryRow(row) {
  return row
    ? {
        id: row.id,
        releaseId: row.release_id,
        entryType: row.entry_type,
        entryKey: row.entry_key,
        targetId: row.target_id,
        revisionId: row.revision_id,
        snapshotText: row.snapshot_text,
        snapshotJson: parseJsonColumn(row.snapshot_json),
        checksum: row.checksum
      }
    : null;
}

function mapReleasePointerRow(row) {
  return row
    ? {
        id: row.id,
        environment: row.environment,
        scopeType: row.scope_type,
        scopeValue: row.scope_value,
        activeReleaseId: row.active_release_id,
        previousReleaseId: row.previous_release_id,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at
      }
    : null;
}

async function selectRows(connection, sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  return rows;
}

async function selectOne(connection, sql, params = [], mapper = (row) => row) {
  const rows = await selectRows(connection, sql, params);
  return rows.length > 0 ? mapper(rows[0]) : null;
}

async function getNextRevisionNo(connection, targetType, targetId) {
  const row = await selectOne(
    connection,
    "SELECT COALESCE(MAX(revision_no), 0) AS next_revision_base FROM cfg_revisions WHERE target_type = ? AND target_id = ?",
    [targetType, targetId]
  );

  return Number(row?.next_revision_base || 0) + 1;
}

class MySQLConfigStore {
  constructor(pool) {
    this.pool = pool;
  }

  async close() {
    await this.pool.end();
  }

  async withTransaction(callback) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async withConnection(callback) {
    const connection = await this.pool.getConnection();
    try {
      return await callback(connection);
    } finally {
      connection.release();
    }
  }

  async listSceneConfigs(filters = {}) {
    return this.withConnection(async (connection) => {
      const clauses = [];
      const params = [];

      if (filters.scene) {
        clauses.push("scene = ?");
        params.push(filters.scene);
      }
      if (filters.status) {
        clauses.push("status = ?");
        params.push(filters.status);
      }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await selectRows(
        connection,
        `SELECT * FROM cfg_scene_configs ${where} ORDER BY scene ASC`,
        params
      );

      return rows.map(mapSceneConfigRow);
    });
  }

  async getSceneConfig(scene) {
    return this.withConnection((connection) =>
      selectOne(
        connection,
        "SELECT * FROM cfg_scene_configs WHERE scene = ? LIMIT 1",
        [scene],
        mapSceneConfigRow
      )
    );
  }

  async saveSceneConfigDraft(input, revisionMeta = {}) {
    const draft = normalizeSceneConfigDraft(input);

    return this.withTransaction(async (connection) => {
      const existing = await selectOne(
        connection,
        "SELECT * FROM cfg_scene_configs WHERE scene = ? LIMIT 1",
        [draft.scene],
        mapSceneConfigRow
      );

      let targetId = existing?.id || null;
      if (targetId) {
        await connection.execute(
          [
            "UPDATE cfg_scene_configs",
            "SET title = ?, enabled = ?, execution_mode = ?, status = ?, document_json = ?,",
            "    source_text = ?, checksum = ?, updated_by = ?, updated_at = ?",
            "WHERE id = ?"
          ].join(" "),
          [
            draft.title,
            draft.enabled,
            draft.executionMode,
            draft.status,
            JSON.stringify(draft.document),
            draft.sourceText,
            draft.checksum,
            draft.updatedBy,
            draft.updatedAt,
            targetId
          ]
        );
      } else {
        const [result] = await connection.execute(
          [
            "INSERT INTO cfg_scene_configs",
            "(scene, title, enabled, execution_mode, status, document_json, source_text, checksum, current_revision_id, updated_by, updated_at)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)"
          ].join(" "),
          [
            draft.scene,
            draft.title,
            draft.enabled,
            draft.executionMode,
            draft.status,
            JSON.stringify(draft.document),
            draft.sourceText,
            draft.checksum,
            draft.updatedBy,
            draft.updatedAt
          ]
        );
        targetId = result.insertId;
      }

      const revisionNo = await getNextRevisionNo(connection, "scene-config", targetId);
      const [revisionResult] = await connection.execute(
        [
          "INSERT INTO cfg_revisions",
          "(target_type, target_id, revision_no, source_text, document_json, checksum, operator, change_note, created_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          "scene-config",
          targetId,
          revisionNo,
          draft.sourceText,
          JSON.stringify(draft.document),
          draft.checksum,
          toTrimmedString(revisionMeta.operator, "operator"),
          toTrimmedString(revisionMeta.changeNote, "changeNote"),
          draft.updatedAt
        ]
      );

      await connection.execute(
        "UPDATE cfg_scene_configs SET current_revision_id = ? WHERE id = ?",
        [revisionResult.insertId, targetId]
      );

      return selectOne(
        connection,
        "SELECT * FROM cfg_scene_configs WHERE id = ? LIMIT 1",
        [targetId],
        mapSceneConfigRow
      );
    }).catch((error) => {
      throw normalizeError(error, "INVALID_REQUEST");
    });
  }

  async deleteSceneConfig(scene) {
    return this.withTransaction(async (connection) => {
      const existing = await selectOne(
        connection,
        "SELECT id FROM cfg_scene_configs WHERE scene = ? LIMIT 1",
        [scene]
      );

      if (!existing) {
        return false;
      }

      await connection.execute("DELETE FROM cfg_revisions WHERE target_type = ? AND target_id = ?", [
        "scene-config",
        existing.id
      ]);
      await connection.execute("DELETE FROM cfg_scene_configs WHERE id = ?", [existing.id]);
      return true;
    });
  }

  async listPlatformResources(filters = {}) {
    return this.withConnection(async (connection) => {
      const clauses = [];
      const params = [];

      for (const [field, column] of [
        ["kind", "kind"],
        ["scene", "scene"],
        ["status", "status"],
        ["ref", "ref"]
      ]) {
        if (filters[field]) {
          clauses.push(`${column} = ?`);
          params.push(filters[field]);
        }
      }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await selectRows(
        connection,
        `SELECT * FROM cfg_platform_resources ${where} ORDER BY kind ASC, name ASC, version ASC`,
        params
      );

      return rows.map(mapPlatformResourceRow);
    });
  }

  async getPlatformResource(identity) {
    return this.withConnection(async (connection) => {
      if (identity?.ref) {
        return selectOne(
          connection,
          "SELECT * FROM cfg_platform_resources WHERE ref = ? LIMIT 1",
          [identity.ref],
          mapPlatformResourceRow
        );
      }

      return selectOne(
        connection,
        "SELECT * FROM cfg_platform_resources WHERE kind = ? AND name = ? AND version = ? LIMIT 1",
        [identity.kind, identity.name, identity.version],
        mapPlatformResourceRow
      );
    });
  }

  async savePlatformResourceDraft(input, revisionMeta = {}) {
    const draft = normalizePlatformResourceDraft(input);

    return this.withTransaction(async (connection) => {
      const existing = await selectOne(
        connection,
        "SELECT * FROM cfg_platform_resources WHERE kind = ? AND name = ? AND version = ? LIMIT 1",
        [draft.kind, draft.name, draft.version],
        mapPlatformResourceRow
      );

      let targetId = existing?.id || null;
      if (targetId) {
        await connection.execute(
          [
            "UPDATE cfg_platform_resources",
            "SET ref = ?, scene = ?, status = ?, document_json = ?, source_text = ?, checksum = ?, updated_by = ?, updated_at = ?",
            "WHERE id = ?"
          ].join(" "),
          [
            draft.ref,
            draft.scene,
            draft.status,
            JSON.stringify(draft.document),
            draft.sourceText,
            draft.checksum,
            draft.updatedBy,
            draft.updatedAt,
            targetId
          ]
        );
      } else {
        const [result] = await connection.execute(
          [
            "INSERT INTO cfg_platform_resources",
            "(kind, name, version, ref, scene, status, document_json, source_text, checksum, current_revision_id, updated_by, updated_at)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)"
          ].join(" "),
          [
            draft.kind,
            draft.name,
            draft.version,
            draft.ref,
            draft.scene,
            draft.status,
            JSON.stringify(draft.document),
            draft.sourceText,
            draft.checksum,
            draft.updatedBy,
            draft.updatedAt
          ]
        );
        targetId = result.insertId;
      }

      const revisionNo = await getNextRevisionNo(connection, "platform-resource", targetId);
      const [revisionResult] = await connection.execute(
        [
          "INSERT INTO cfg_revisions",
          "(target_type, target_id, revision_no, source_text, document_json, checksum, operator, change_note, created_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          "platform-resource",
          targetId,
          revisionNo,
          draft.sourceText,
          JSON.stringify(draft.document),
          draft.checksum,
          toTrimmedString(revisionMeta.operator, "operator"),
          toTrimmedString(revisionMeta.changeNote, "changeNote"),
          draft.updatedAt
        ]
      );

      await connection.execute(
        "UPDATE cfg_platform_resources SET current_revision_id = ? WHERE id = ?",
        [revisionResult.insertId, targetId]
      );

      return selectOne(
        connection,
        "SELECT * FROM cfg_platform_resources WHERE id = ? LIMIT 1",
        [targetId],
        mapPlatformResourceRow
      );
    }).catch((error) => {
      throw normalizeError(error, "INVALID_REQUEST");
    });
  }

  async deletePlatformResource(identity) {
    return this.withTransaction(async (connection) => {
      const existing = identity?.ref
        ? await selectOne(connection, "SELECT id FROM cfg_platform_resources WHERE ref = ? LIMIT 1", [identity.ref])
        : await selectOne(
            connection,
            "SELECT id FROM cfg_platform_resources WHERE kind = ? AND name = ? AND version = ? LIMIT 1",
            [identity.kind, identity.name, identity.version]
          );

      if (!existing) {
        return false;
      }

      await connection.execute("DELETE FROM cfg_revisions WHERE target_type = ? AND target_id = ?", [
        "platform-resource",
        existing.id
      ]);
      await connection.execute("DELETE FROM cfg_platform_resources WHERE id = ?", [existing.id]);
      return true;
    });
  }

  async listSceneAssets(filters = {}) {
    return this.withConnection(async (connection) => {
      const clauses = [];
      const params = [];

      for (const [field, column] of [
        ["scene", "scene"],
        ["assetType", "asset_type"],
        ["status", "status"]
      ]) {
        if (filters[field]) {
          clauses.push(`${column} = ?`);
          params.push(filters[field]);
        }
      }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await selectRows(
        connection,
        `SELECT * FROM cfg_scene_assets ${where} ORDER BY scene ASC, asset_type ASC`,
        params
      );

      return rows.map(mapSceneAssetRow);
    });
  }

  async getSceneAsset(scene, assetType) {
    return this.withConnection((connection) =>
      selectOne(
        connection,
        "SELECT * FROM cfg_scene_assets WHERE scene = ? AND asset_type = ? LIMIT 1",
        [scene, assetType],
        mapSceneAssetRow
      )
    );
  }

  async saveSceneAssetDraft(input, revisionMeta = {}) {
    const draft = normalizeSceneAssetDraft(input);

    return this.withTransaction(async (connection) => {
      const existing = await selectOne(
        connection,
        "SELECT * FROM cfg_scene_assets WHERE scene = ? AND asset_type = ? LIMIT 1",
        [draft.scene, draft.assetType],
        mapSceneAssetRow
      );

      let targetId = existing?.id || null;
      if (targetId) {
        await connection.execute(
          [
            "UPDATE cfg_scene_assets",
            "SET ref = ?, content_text = ?, content_format = ?, checksum = ?, status = ?, updated_by = ?, updated_at = ?",
            "WHERE id = ?"
          ].join(" "),
          [
            draft.ref,
            draft.contentText,
            draft.contentFormat,
            draft.checksum,
            draft.status,
            draft.updatedBy,
            draft.updatedAt,
            targetId
          ]
        );
      } else {
        const [result] = await connection.execute(
          [
            "INSERT INTO cfg_scene_assets",
            "(scene, asset_type, ref, content_text, content_format, checksum, status, current_revision_id, updated_by, updated_at)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)"
          ].join(" "),
          [
            draft.scene,
            draft.assetType,
            draft.ref,
            draft.contentText,
            draft.contentFormat,
            draft.checksum,
            draft.status,
            draft.updatedBy,
            draft.updatedAt
          ]
        );
        targetId = result.insertId;
      }

      const revisionNo = await getNextRevisionNo(connection, "scene-asset", targetId);
      const [revisionResult] = await connection.execute(
        [
          "INSERT INTO cfg_revisions",
          "(target_type, target_id, revision_no, source_text, document_json, checksum, operator, change_note, created_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" "),
        [
          "scene-asset",
          targetId,
          revisionNo,
          draft.contentText,
          draft.document === null ? null : JSON.stringify(draft.document),
          draft.checksum,
          toTrimmedString(revisionMeta.operator, "operator"),
          toTrimmedString(revisionMeta.changeNote, "changeNote"),
          draft.updatedAt
        ]
      );

      await connection.execute("UPDATE cfg_scene_assets SET current_revision_id = ? WHERE id = ?", [
        revisionResult.insertId,
        targetId
      ]);

      return selectOne(
        connection,
        "SELECT * FROM cfg_scene_assets WHERE id = ? LIMIT 1",
        [targetId],
        mapSceneAssetRow
      );
    }).catch((error) => {
      throw normalizeError(error, "INVALID_REQUEST");
    });
  }

  async deleteSceneAsset(scene, assetType) {
    return this.withTransaction(async (connection) => {
      const existing = await selectOne(
        connection,
        "SELECT id FROM cfg_scene_assets WHERE scene = ? AND asset_type = ? LIMIT 1",
        [scene, assetType]
      );

      if (!existing) {
        return false;
      }

      await connection.execute("DELETE FROM cfg_revisions WHERE target_type = ? AND target_id = ?", [
        "scene-asset",
        existing.id
      ]);
      await connection.execute("DELETE FROM cfg_scene_assets WHERE id = ?", [existing.id]);
      return true;
    });
  }

  async listHelperScripts(filters = {}) {
    return this.withConnection(async (connection) => {
      const clauses = [];
      const params = [];

      for (const [field, column] of [
        ["scene", "scene"],
        ["scriptType", "script_type"],
        ["status", "status"]
      ]) {
        if (filters[field]) {
          clauses.push(`${column} = ?`);
          params.push(filters[field]);
        }
      }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await selectRows(
        connection,
        `SELECT * FROM cfg_helper_scripts ${where} ORDER BY scene ASC, script_type ASC`,
        params
      );

      return rows.map(mapHelperScriptRow);
    });
  }

  async getHelperScript(scene, scriptType) {
    return this.withConnection((connection) =>
      selectOne(
        connection,
        "SELECT * FROM cfg_helper_scripts WHERE scene = ? AND script_type = ? LIMIT 1",
        [scene, scriptType],
        mapHelperScriptRow
      )
    );
  }

  async saveHelperScriptDraft(input, revisionMeta = {}) {
    const draft = normalizeHelperScriptDraft(input);

    return this.withTransaction(async (connection) => {
      const existing = await selectOne(
        connection,
        "SELECT * FROM cfg_helper_scripts WHERE scene = ? AND script_type = ? LIMIT 1",
        [draft.scene, draft.scriptType],
        mapHelperScriptRow
      );

      let targetId = existing?.id || null;
      if (targetId) {
        await connection.execute(
          [
            "UPDATE cfg_helper_scripts",
            "SET script_name = ?, content_text = ?, checksum = ?, status = ?, updated_by = ?, updated_at = ?",
            "WHERE id = ?"
          ].join(" "),
          [
            draft.scriptName,
            draft.contentText,
            draft.checksum,
            draft.status,
            draft.updatedBy,
            draft.updatedAt,
            targetId
          ]
        );
      } else {
        const [result] = await connection.execute(
          [
            "INSERT INTO cfg_helper_scripts",
            "(scene, script_type, script_name, content_text, checksum, status, current_revision_id, updated_by, updated_at)",
            "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)"
          ].join(" "),
          [
            draft.scene,
            draft.scriptType,
            draft.scriptName,
            draft.contentText,
            draft.checksum,
            draft.status,
            draft.updatedBy,
            draft.updatedAt
          ]
        );
        targetId = result.insertId;
      }

      const revisionNo = await getNextRevisionNo(connection, "helper-script", targetId);
      const [revisionResult] = await connection.execute(
        [
          "INSERT INTO cfg_revisions",
          "(target_type, target_id, revision_no, source_text, document_json, checksum, operator, change_note, created_at)",
          "VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)"
        ].join(" "),
        [
          "helper-script",
          targetId,
          revisionNo,
          draft.contentText,
          draft.checksum,
          toTrimmedString(revisionMeta.operator, "operator"),
          toTrimmedString(revisionMeta.changeNote, "changeNote"),
          draft.updatedAt
        ]
      );

      await connection.execute("UPDATE cfg_helper_scripts SET current_revision_id = ? WHERE id = ?", [
        revisionResult.insertId,
        targetId
      ]);

      return selectOne(
        connection,
        "SELECT * FROM cfg_helper_scripts WHERE id = ? LIMIT 1",
        [targetId],
        mapHelperScriptRow
      );
    }).catch((error) => {
      throw normalizeError(error, "INVALID_REQUEST");
    });
  }

  async deleteHelperScript(scene, scriptType) {
    return this.withTransaction(async (connection) => {
      const existing = await selectOne(
        connection,
        "SELECT id FROM cfg_helper_scripts WHERE scene = ? AND script_type = ? LIMIT 1",
        [scene, scriptType]
      );

      if (!existing) {
        return false;
      }

      await connection.execute("DELETE FROM cfg_revisions WHERE target_type = ? AND target_id = ?", [
        "helper-script",
        existing.id
      ]);
      await connection.execute("DELETE FROM cfg_helper_scripts WHERE id = ?", [existing.id]);
      return true;
    });
  }

  async listRevisions(filters = {}) {
    return this.withConnection(async (connection) => {
      const clauses = [];
      const params = [];

      if (filters.targetType) {
        clauses.push("target_type = ?");
        params.push(filters.targetType);
      }
      if (filters.targetId) {
        clauses.push("target_id = ?");
        params.push(filters.targetId);
      }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const limit = Number(filters.limit) > 0 ? Math.min(Number(filters.limit), 200) : 100;
      const rows = await selectRows(
        connection,
        `SELECT * FROM cfg_revisions ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
        params
      );

      return rows.map(mapRevisionRow);
    });
  }

  async getRevisionById(id) {
    return this.withConnection((connection) =>
      selectOne(connection, "SELECT * FROM cfg_revisions WHERE id = ? LIMIT 1", [id], mapRevisionRow)
    );
  }

  async saveRelease(input) {
    const release = normalizeRelease(input);

    return this.withTransaction(async (connection) => {
      const existing = await selectOne(
        connection,
        "SELECT * FROM cfg_releases WHERE release_id = ? LIMIT 1",
        [release.releaseId],
        mapReleaseRow
      );

      if (existing) {
        await connection.execute(
          [
            "UPDATE cfg_releases",
            "SET environment = ?, scope_type = ?, scope_value = ?, status = ?, manifest_json = ?,",
            "    bundle_path = ?, created_by = ?, publish_note = ?, created_at = ?, published_at = ?",
            "WHERE release_id = ?"
          ].join(" "),
          [
            release.environment,
            release.scopeType,
            release.scopeValue,
            release.status,
            JSON.stringify(release.manifest),
            release.bundlePath,
            release.createdBy,
            release.publishNote,
            release.createdAt,
            release.publishedAt,
            release.releaseId
          ]
        );
      } else {
        await connection.execute(
          [
            "INSERT INTO cfg_releases",
            "(release_id, environment, scope_type, scope_value, status, manifest_json, bundle_path, created_by, publish_note, created_at, published_at)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ].join(" "),
          [
            release.releaseId,
            release.environment,
            release.scopeType,
            release.scopeValue,
            release.status,
            JSON.stringify(release.manifest),
            release.bundlePath,
            release.createdBy,
            release.publishNote,
            release.createdAt,
            release.publishedAt
          ]
        );
      }

      return selectOne(
        connection,
        "SELECT * FROM cfg_releases WHERE release_id = ? LIMIT 1",
        [release.releaseId],
        mapReleaseRow
      );
    });
  }

  async listReleases(filters = {}) {
    return this.withConnection(async (connection) => {
      const clauses = [];
      const params = [];

      for (const [field, column] of [
        ["environment", "environment"],
        ["scopeType", "scope_type"],
        ["scopeValue", "scope_value"],
        ["status", "status"]
      ]) {
        if (filters[field]) {
          clauses.push(`${column} = ?`);
          params.push(filters[field]);
        }
      }

      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await selectRows(
        connection,
        `SELECT * FROM cfg_releases ${where} ORDER BY created_at DESC, id DESC`,
        params
      );

      return rows.map(mapReleaseRow);
    });
  }

  async getRelease(releaseId) {
    return this.withConnection((connection) =>
      selectOne(connection, "SELECT * FROM cfg_releases WHERE release_id = ? LIMIT 1", [releaseId], mapReleaseRow)
    );
  }

  async setReleaseEntries(releaseId, entries) {
    const normalizedEntries = entries.map((entry) => normalizeReleaseEntry({ ...entry, releaseId }));

    return this.withTransaction(async (connection) => {
      await connection.execute("DELETE FROM cfg_release_entries WHERE release_id = ?", [releaseId]);

      for (const entry of normalizedEntries) {
        await connection.execute(
          [
            "INSERT INTO cfg_release_entries",
            "(release_id, entry_type, entry_key, target_id, revision_id, snapshot_text, snapshot_json, checksum)",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ].join(" "),
          [
            entry.releaseId,
            entry.entryType,
            entry.entryKey,
            entry.targetId,
            entry.revisionId,
            entry.snapshotText,
            entry.snapshotJson === null ? null : JSON.stringify(entry.snapshotJson),
            entry.checksum
          ]
        );
      }

      const rows = await selectRows(
        connection,
        "SELECT * FROM cfg_release_entries WHERE release_id = ? ORDER BY entry_type ASC, entry_key ASC",
        [releaseId]
      );

      return rows.map(mapReleaseEntryRow);
    });
  }

  async listReleaseEntries(releaseId) {
    return this.withConnection(async (connection) => {
      const rows = await selectRows(
        connection,
        "SELECT * FROM cfg_release_entries WHERE release_id = ? ORDER BY entry_type ASC, entry_key ASC",
        [releaseId]
      );

      return rows.map(mapReleaseEntryRow);
    });
  }

  async deleteRelease(releaseId) {
    return this.withTransaction(async (connection) => {
      await connection.execute("DELETE FROM cfg_release_entries WHERE release_id = ?", [releaseId]);
      const [result] = await connection.execute("DELETE FROM cfg_releases WHERE release_id = ?", [releaseId]);
      return result.affectedRows > 0;
    });
  }

  async setReleasePointer(input) {
    const pointer = normalizeReleasePointer(input);

    return this.withTransaction(async (connection) => {
      const existing = await selectOne(
        connection,
        "SELECT * FROM cfg_release_pointers WHERE environment = ? AND scope_type = ? AND scope_value = ? LIMIT 1",
        [pointer.environment, pointer.scopeType, pointer.scopeValue],
        mapReleasePointerRow
      );

      if (existing) {
        await connection.execute(
          [
            "UPDATE cfg_release_pointers",
            "SET active_release_id = ?, previous_release_id = ?, updated_by = ?, updated_at = ?",
            "WHERE environment = ? AND scope_type = ? AND scope_value = ?"
          ].join(" "),
          [
            pointer.activeReleaseId,
            pointer.previousReleaseId,
            pointer.updatedBy,
            pointer.updatedAt,
            pointer.environment,
            pointer.scopeType,
            pointer.scopeValue
          ]
        );
      } else {
        await connection.execute(
          [
            "INSERT INTO cfg_release_pointers",
            "(environment, scope_type, scope_value, active_release_id, previous_release_id, updated_by, updated_at)",
            "VALUES (?, ?, ?, ?, ?, ?, ?)"
          ].join(" "),
          [
            pointer.environment,
            pointer.scopeType,
            pointer.scopeValue,
            pointer.activeReleaseId,
            pointer.previousReleaseId,
            pointer.updatedBy,
            pointer.updatedAt
          ]
        );
      }

      return selectOne(
        connection,
        "SELECT * FROM cfg_release_pointers WHERE environment = ? AND scope_type = ? AND scope_value = ? LIMIT 1",
        [pointer.environment, pointer.scopeType, pointer.scopeValue],
        mapReleasePointerRow
      );
    });
  }

  async getReleasePointer(environment, scopeType, scopeValue) {
    return this.withConnection((connection) =>
      selectOne(
        connection,
        "SELECT * FROM cfg_release_pointers WHERE environment = ? AND scope_type = ? AND scope_value = ? LIMIT 1",
        [environment, scopeType, scopeValue],
        mapReleasePointerRow
      )
    );
  }

  async deleteReleasePointer(environment, scopeType, scopeValue) {
    return this.withConnection(async (connection) => {
      const [result] = await connection.execute(
        "DELETE FROM cfg_release_pointers WHERE environment = ? AND scope_type = ? AND scope_value = ?",
        [environment, scopeType, scopeValue]
      );

      return result.affectedRows > 0;
    });
  }
}

function createMysqlStore(options = {}) {
  const pool = mysql.createPool({
    host: toTrimmedString(options.host || process.env.MYSQL_HOST, "MYSQL_HOST", { required: true }),
    port: Number(options.port || process.env.MYSQL_PORT || 3306),
    user: toTrimmedString(options.user || process.env.MYSQL_USER, "MYSQL_USER", { required: true }),
    password: String(options.password ?? process.env.MYSQL_PASSWORD ?? ""),
    database: toTrimmedString(options.database || process.env.MYSQL_DATABASE, "MYSQL_DATABASE", { required: true }),
    waitForConnections: true,
    connectionLimit: Number(options.connectionLimit || process.env.MYSQL_POOL_MAX || 10),
    queueLimit: 0,
    timezone: "Z",
    dateStrings: true
  });

  return new MySQLConfigStore(pool);
}

module.exports = {
  MySQLConfigStore,
  createMysqlStore
};
