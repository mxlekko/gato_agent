const { loadPlatformResources } = require("../platform/compiler/validate");
const { getDbPool, sql } = require("../ContextHelper/services/db");
const { createAppError } = require("../utils/errors");

const GENERIC_QUERY_TOOL_REF = "tool://data/generic-query-runner@v1";
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SUPPORTED_RESULT_MODES = new Set([
  "single-row",
  "multi-rows",
  "column-values",
  "aggregate-value"
]);
const SUPPORTED_STATEMENT_TYPES = new Set([
  "select-top-1",
  "select-rows",
  "select-column-values",
  "select-count"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values = []) {
  return Array.from(new Set(
    values
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
  ));
}

function sanitizeIdentifier(identifier, label = "identifier") {
  const normalized = String(identifier || "").trim();
  if (!normalized) {
    throw createAppError("INVALID_REQUEST", `${label} 不能为空。`, {
      stage: "generic-query-runner"
    });
  }

  const segments = normalized.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0 || !segments.every((segment) => IDENTIFIER_PATTERN.test(segment))) {
    throw createAppError("INVALID_REQUEST", `${label} 包含不安全的名称: ${normalized}。`, {
      stage: "generic-query-runner",
      details: {
        identifier: normalized,
        label
      }
    });
  }

  return segments.map((segment) => `[${segment}]`).join(".");
}

function resolveOutputPath(mode) {
  switch (mode) {
    case "multi-rows":
      return "data.rows";
    case "column-values":
      return "data.values";
    case "aggregate-value":
      return "data.value";
    case "single-row":
    default:
      return "data.rawRow";
  }
}

function resolveDefaultStatementType(mode) {
  switch (mode) {
    case "multi-rows":
      return "select-rows";
    case "column-values":
      return "select-column-values";
    case "aggregate-value":
      return "select-count";
    case "single-row":
    default:
      return "select-top-1";
  }
}

function deriveResultMode(querySpec = {}) {
  const explicitMode = String(querySpec?.resultPolicy?.mode || "").trim();
  if (explicitMode) {
    return explicitMode;
  }

  const resultPath = String(querySpec?.outputPolicy?.resultPath || "").trim();
  if (resultPath.endsWith(".rows")) {
    return "multi-rows";
  }
  if (resultPath.endsWith(".values")) {
    return "column-values";
  }
  if (resultPath.endsWith(".value")) {
    return "aggregate-value";
  }

  return "single-row";
}

function normalizeResultPolicy(querySpec = {}) {
  const rawPolicy = isObject(querySpec.resultPolicy) ? querySpec.resultPolicy : {};
  const mode = deriveResultMode(querySpec);
  if (!SUPPORTED_RESULT_MODES.has(mode)) {
    throw createAppError("INVALID_REQUEST", `暂不支持的结果模式: ${mode}。`, {
      stage: "generic-query-runner"
    });
  }

  const fields = uniqueStrings(Array.isArray(rawPolicy.fields) ? rawPolicy.fields : []);
  const distinct = rawPolicy.distinct === true;
  const parsedLimit = Number(rawPolicy.limit);
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 1000)
    : (mode === "single-row" ? 1 : null);

  if (mode === "column-values" && fields.length !== 1) {
    throw createAppError("INVALID_REQUEST", "列值合集模式必须且只能配置 1 个返回字段。", {
      stage: "generic-query-runner"
    });
  }

  return {
    mode,
    fields,
    distinct,
    limit,
    outputPath: resolveOutputPath(mode)
  };
}

function normalizeStatementType(querySpec = {}, resultPolicy = {}) {
  const type = String(querySpec?.selectionPolicy?.statement?.type || "").trim()
    || resolveDefaultStatementType(resultPolicy.mode);

  if (!SUPPORTED_STATEMENT_TYPES.has(type)) {
    throw createAppError("INVALID_REQUEST", `暂不支持的查询语句类型: ${type}。`, {
      stage: "generic-query-runner"
    });
  }

  const expectedType = resolveDefaultStatementType(resultPolicy.mode);
  if (type !== expectedType) {
    throw createAppError("INVALID_REQUEST", `查询语句类型 ${type} 与结果模式 ${resultPolicy.mode} 不匹配。`, {
      stage: "generic-query-runner"
    });
  }

  return type;
}

function resolveNotFoundCode(querySpec = {}) {
  return String(querySpec?.primaryEntity?.idField || "").trim() === "opportunityId"
    ? "OPPORTUNITY_NOT_FOUND"
    : "QUERY_RESULT_NOT_FOUND";
}

function loadQueryProfile(queryProfileRef) {
  const resources = loadPlatformResources();
  const record = resources.queries.find((item) => item?.document?.spec?.ref === queryProfileRef);
  if (!record?.document?.spec) {
    throw createAppError("INVALID_REQUEST", `未找到 QueryProfile: ${queryProfileRef || "missing"}。`, {
      stage: "generic-query-runner"
    });
  }

  if (record.document.spec.toolRef !== GENERIC_QUERY_TOOL_REF) {
    throw createAppError("INVALID_REQUEST", `QueryProfile ${queryProfileRef} 未绑定通用查询执行器。`, {
      stage: "generic-query-runner",
      details: {
        queryProfileRef,
        toolRef: record.document.spec.toolRef || null
      }
    });
  }

  return record.document;
}

function normalizeScalarValue(value, typeHint = "") {
  if (value === null || value === undefined) {
    return value;
  }

  const normalizedType = String(typeHint || "").trim().toLowerCase();

  if (normalizedType === "boolean" || normalizedType === "bool") {
    return Boolean(value);
  }

  if (["int", "integer", "bigint", "float", "number", "decimal"].includes(normalizedType)) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw createAppError("INVALID_REQUEST", `字段值 ${value} 不是合法数字。`, {
        stage: "generic-query-runner"
      });
    }
    return parsed;
  }

  if (["date", "datetime", "datetime2", "timestamp"].includes(normalizedType)) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw createAppError("INVALID_REQUEST", `字段值 ${value} 不是合法日期。`, {
        stage: "generic-query-runner"
      });
    }
    return parsed;
  }

  return String(value);
}

function bindSqlInput(request, paramName, rawValue, typeHint = "") {
  const normalizedType = String(typeHint || "").trim().toLowerCase();
  const value = normalizeScalarValue(rawValue, normalizedType);

  if (value === null || value === undefined) {
    request.input(paramName, sql.NVarChar(4000), null);
    return value;
  }

  if (normalizedType === "boolean" || normalizedType === "bool" || typeof value === "boolean") {
    request.input(paramName, sql.Bit, value);
    return value;
  }

  if (normalizedType === "int" || normalizedType === "integer") {
    request.input(paramName, sql.Int, value);
    return value;
  }

  if (normalizedType === "bigint") {
    request.input(paramName, sql.BigInt, value);
    return value;
  }

  if (["float", "number", "decimal"].includes(normalizedType) || typeof value === "number") {
    request.input(paramName, sql.Float, value);
    return value;
  }

  if (normalizedType === "date") {
    request.input(paramName, sql.Date, value);
    return value;
  }

  if (["datetime", "datetime2", "timestamp"].includes(normalizedType) || value instanceof Date) {
    request.input(paramName, sql.DateTime2, value);
    return value;
  }

  request.input(paramName, sql.NVarChar(4000), String(value));
  return value;
}

function buildWhereClause(whereItems, payload, inputFields, request) {
  if (!Array.isArray(whereItems) || whereItems.length === 0) {
    throw createAppError("INVALID_REQUEST", "通用查询至少要配置 1 条查询条件。", {
      stage: "generic-query-runner"
    });
  }

  const clauses = [];

  whereItems.forEach((item, index) => {
    const field = sanitizeIdentifier(item?.field, `查询条件第 ${index + 1} 项 field`);
    const operator = String(item?.operator || "").trim();
    const param = String(item?.param || "").trim();
    const typeHint = inputFields?.[param]?.type || "";
    const rawValue = payload[param];

    switch (operator) {
      case "equals":
      case "not_equals":
      case "greater_than":
      case "greater_or_equal":
      case "less_than":
      case "less_or_equal":
      case "like":
      case "contains":
      case "starts_with":
      case "ends_with": {
        if (rawValue === undefined || rawValue === null || rawValue === "") {
          throw createAppError("INVALID_REQUEST", `查询条件参数 ${param} 缺失。`, {
            stage: "generic-query-runner"
          });
        }

        const paramName = `p${index}`;
        let sqlOperator = "=";
        let value = rawValue;

        switch (operator) {
          case "not_equals":
            sqlOperator = "<>";
            break;
          case "greater_than":
            sqlOperator = ">";
            break;
          case "greater_or_equal":
            sqlOperator = ">=";
            break;
          case "less_than":
            sqlOperator = "<";
            break;
          case "less_or_equal":
            sqlOperator = "<=";
            break;
          case "like":
            sqlOperator = "LIKE";
            value = String(rawValue);
            break;
          case "contains":
            sqlOperator = "LIKE";
            value = `%${String(rawValue)}%`;
            break;
          case "starts_with":
            sqlOperator = "LIKE";
            value = `${String(rawValue)}%`;
            break;
          case "ends_with":
            sqlOperator = "LIKE";
            value = `%${String(rawValue)}`;
            break;
          default:
            sqlOperator = "=";
        }

        bindSqlInput(request, paramName, value, typeHint || "string");
        clauses.push(`${field} ${sqlOperator} @${paramName}`);
        break;
      }
      case "in": {
        if (!Array.isArray(rawValue) || rawValue.length === 0) {
          throw createAppError("INVALID_REQUEST", `查询条件参数 ${param} 必须是非空数组。`, {
            stage: "generic-query-runner"
          });
        }

        const placeholders = rawValue.map((value, valueIndex) => {
          const paramName = `p${index}_${valueIndex}`;
          bindSqlInput(request, paramName, value, typeHint);
          return `@${paramName}`;
        });
        clauses.push(`${field} IN (${placeholders.join(", ")})`);
        break;
      }
      case "is_null":
        clauses.push(`${field} IS NULL`);
        break;
      case "is_not_null":
        clauses.push(`${field} IS NOT NULL`);
        break;
      default:
        throw createAppError("INVALID_REQUEST", `暂不支持的查询操作符: ${operator || "missing"}。`, {
          stage: "generic-query-runner"
        });
    }
  });

  return ` WHERE ${clauses.join(" AND ")}`;
}

function buildSelectFields(resultPolicy) {
  if (resultPolicy.mode === "aggregate-value") {
    return "COUNT(1) AS [value]";
  }

  if (resultPolicy.fields.length === 0 || (resultPolicy.fields.length === 1 && resultPolicy.fields[0] === "*")) {
    return "*";
  }

  return resultPolicy.fields
    .map((fieldName) => sanitizeIdentifier(fieldName, "返回字段"))
    .join(", ");
}

function compactRow(row = {}) {
  return Object.entries(row).reduce((result, [key, value]) => {
    if (value === null || value === undefined) {
      return result;
    }

    if (typeof value === "string" && value.trim().length === 0) {
      return result;
    }

    result[key] = value;
    return result;
  }, {});
}

function shapeResultData(rows, querySpec, resultPolicy) {
  if (resultPolicy.mode === "single-row") {
    if (rows.length === 0) {
      throw createAppError(resolveNotFoundCode(querySpec), "未查询到符合条件的数据记录。", {
        stage: "context-query"
      });
    }

    return {
      rawRow: compactRow(rows[0])
    };
  }

  if (resultPolicy.mode === "column-values") {
    const fieldName = resultPolicy.fields[0];
    const values = rows
      .map((row) => row[fieldName])
      .filter((value) => value !== null && value !== undefined && !(typeof value === "string" && value.trim().length === 0));

    return {
      values
    };
  }

  if (resultPolicy.mode === "aggregate-value") {
    return {
      value: rows[0]?.value ?? 0
    };
  }

  return {
    rows: rows.map((row) => compactRow(row))
  };
}

function buildQuerySql(querySpec, payload) {
  const tableName = sanitizeIdentifier(querySpec?.primaryEntity?.table, "主表");
  const resultPolicy = normalizeResultPolicy(querySpec);
  const statementType = normalizeStatementType(querySpec, resultPolicy);
  const selectFields = buildSelectFields(resultPolicy);
  const whereClause = buildWhereClause(
    querySpec?.selectionPolicy?.where || [],
    payload,
    isObject(querySpec?.inputContract?.fields) ? querySpec.inputContract.fields : {},
    payload.__request
  );
  const distinct = resultPolicy.distinct && statementType !== "select-top-1" ? "DISTINCT " : "";

  if (statementType === "select-top-1") {
    return {
      sqlText: `SELECT TOP 1 ${selectFields} FROM ${tableName}${whereClause}`,
      resultPolicy
    };
  }

  if (statementType === "select-count") {
    return {
      sqlText: `SELECT ${selectFields} FROM ${tableName}${whereClause}`,
      resultPolicy
    };
  }

  const topClause = Number.isInteger(resultPolicy.limit) && resultPolicy.limit > 0
    ? `TOP ${resultPolicy.limit} `
    : "";

  return {
    sqlText: `SELECT ${topClause}${distinct}${selectFields} FROM ${tableName}${whereClause}`,
    resultPolicy
  };
}

async function executeGenericQuery(body = {}) {
  const requestId = String(body.requestId || "").trim();
  const queryProfileRef = String(body.queryProfileRef || "").trim();

  if (!requestId) {
    throw createAppError("INVALID_REQUEST", "通用查询执行器缺少 requestId。", {
      stage: "generic-query-runner"
    });
  }

  if (!queryProfileRef) {
    throw createAppError("INVALID_REQUEST", "通用查询执行器缺少 queryProfileRef。", {
      stage: "generic-query-runner"
    });
  }

  const queryDocument = loadQueryProfile(queryProfileRef);
  const querySpec = isObject(queryDocument?.spec) ? queryDocument.spec : {};
  const requiredInputs = Array.isArray(querySpec?.inputContract?.requiredInputs)
    ? querySpec.inputContract.requiredInputs
    : [];

  for (const fieldName of requiredInputs) {
    if (body[fieldName] === undefined || body[fieldName] === null || body[fieldName] === "") {
      throw createAppError("INVALID_REQUEST", `通用查询执行器缺少入参 ${fieldName}。`, {
        stage: "generic-query-runner"
      });
    }
  }

  try {
    const pool = await getDbPool();
    const request = pool.request();
    const { sqlText, resultPolicy } = buildQuerySql(querySpec, {
      ...body,
      __request: request
    });
    const result = await request.query(sqlText);
    const rows = Array.isArray(result?.recordset) ? result.recordset : [];

    return {
      requestId,
      queryProfileRef,
      rowCount: rows.length,
      ...shapeResultData(rows, querySpec, resultPolicy)
    };
  } catch (error) {
    if (error?.name === "AppError" || error?.code) {
      throw error;
    }

    throw createAppError("CONTEXT_QUERY_FAILED", "通用查询执行失败。", {
      stage: "context-query",
      details: {
        queryProfileRef,
        cause: error?.message || "query_failed"
      }
    });
  }
}

module.exports = {
  GENERIC_QUERY_TOOL_REF,
  executeGenericQuery,
  loadQueryProfile,
  normalizeResultPolicy,
  resolveOutputPath,
  resolveDefaultStatementType
};
