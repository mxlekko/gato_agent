const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { createAppError } = require("../../utils/errors");
const { resolvePathReference } = require("../../utils/path-resolver");
const { getDbPool, sql } = require("../../ContextHelper/services/db");
const { filterNonEmptyFields } = require("../../ContextHelper/providers/sales-opportunity/filter");
const { normalizeOpportunityId } = require("../../ContextHelper/providers/sales-opportunity/schema");
const { info } = require("../../utils/logger");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SCENE_CONFIG_PATH = path.join(PROJECT_ROOT, "scene-configs", "sales-opportunity-advisor-directdb.json");
const DICTIONARY_PATH = path.join(PROJECT_ROOT, "metadata", "sales_opportunity_advisor_directdb_dictionary.tsv");
const SQL_CACHE_DIR = path.join(PROJECT_ROOT, "DirectDbRunner", "sql-cache");
const SQL_CACHE_FILE = path.join(SQL_CACHE_DIR, "sales-opportunity-advisor-directdb.sql.json");
const RUNTIME_ROOT = path.join(PROJECT_ROOT, "runtime-assets");
const SQL_DEFINITION_BEGIN = "<<<SQL_BUSINESS_DEFINITION_BEGIN>>>";
const SQL_DEFINITION_END = "<<<SQL_BUSINESS_DEFINITION_END>>>";
const DEFAULT_SQL_MODEL = process.env.DIRECTDB_SQL_TEMPLATE_MODEL || "kimi-k2-turbo-preview";
const DEFAULT_SQL_TIMEOUT_MS = Number(process.env.DIRECTDB_SQL_TEMPLATE_TIMEOUT_MS || 30000);

function sha256(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
}

function extractSqlBusinessDefinition(skillContent) {
  const beginIndex = skillContent.indexOf(SQL_DEFINITION_BEGIN);
  const endIndex = skillContent.indexOf(SQL_DEFINITION_END);
  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    throw createAppError("INVALID_SQL_TEMPLATE", "SQL business definition markers were not found in the directdb skill.", {
      details: {
        markerBegin: SQL_DEFINITION_BEGIN,
        markerEnd: SQL_DEFINITION_END
      }
    });
  }

  const block = skillContent
    .slice(beginIndex + SQL_DEFINITION_BEGIN.length, endIndex)
    .trim();

  if (!block) {
    throw createAppError("INVALID_SQL_TEMPLATE", "SQL business definition block must not be empty.");
  }

  return block;
}

async function loadSkillContext() {
  let sceneConfig;
  try {
    sceneConfig = JSON.parse(await fsp.readFile(SCENE_CONFIG_PATH, "utf8"));
  } catch (error) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Failed to read directdb scene config for SQL template generation.", {
      details: {
        filePath: SCENE_CONFIG_PATH,
        cause: error?.message || "scene_config_read_failed"
      }
    });
  }

  const skillPathRef = sceneConfig?.skill?.entryFile;
  if (!skillPathRef) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Directdb scene config is missing skill.entryFile.");
  }

  let skillPath;
  try {
    skillPath = resolvePathReference(skillPathRef, {
      projectRoot: PROJECT_ROOT,
      runtimeRoot: RUNTIME_ROOT
    }).resolvedPath;
  } catch (error) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Failed to resolve directdb skill.entryFile.", {
      details: {
        skillPath: skillPathRef,
        cause: error?.message || "skill_path_resolve_failed"
      }
    });
  }

  const [skillContent, dictionaryContent] = await Promise.all([
    fsp.readFile(skillPath, "utf8"),
    fsp.readFile(DICTIONARY_PATH, "utf8")
  ]).catch((error) => {
    throw createAppError("INVALID_SQL_TEMPLATE", "Failed to read local files for SQL template generation.", {
      details: {
        skillPath,
        dictionaryPath: DICTIONARY_PATH,
        cause: error?.message || "local_file_read_failed"
      }
    });
  });

  return {
    scene: sceneConfig.scene,
    skillId: sceneConfig?.skill?.id || "sales-opportunity-advisor-directdb",
    skillPath: skillPathRef,
    skillHash: sha256(skillContent),
    businessDefinition: extractSqlBusinessDefinition(skillContent),
    dictionaryContent
  };
}

function extractJsonObject(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) {
    throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", "SQL template generation returned empty content.");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", "SQL template generation returned invalid JSON.", {
        details: {
          content: trimmed
        }
      });
    }

    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", "SQL template generation returned malformed JSON.", {
        details: {
          content: trimmed
        }
      });
    }
  }
}

function validateGeneratedSql(rawSql) {
  if (typeof rawSql !== "string" || !rawSql.trim()) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated SQL must be a non-empty string.");
  }

  const normalized = rawSql
    .replace(/;+\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  const upper = normalized.toUpperCase();
  const forbiddenPatterns = [
    /\bINSERT\b/u,
    /\bUPDATE\b/u,
    /\bDELETE\b/u,
    /\bALTER\b/u,
    /\bDROP\b/u,
    /\bTRUNCATE\b/u,
    /\bEXEC\b/u,
    /\bMERGE\b/u,
    /\bUNION\b/u,
    /\bJOIN\b/u,
    /\bINTO\b/u
  ];

  if (!upper.startsWith("SELECT ")) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated SQL must start with SELECT.", {
      details: {
        sql: normalized
      }
    });
  }

  if (normalized.includes(";")) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated SQL must contain only one statement.", {
      details: {
        sql: normalized
      }
    });
  }

  if (!/\bTOP\s+1\b/iu.test(normalized)) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated SQL must include TOP 1.", {
      details: {
        sql: normalized
      }
    });
  }

  if (!/\bFROM\s+t_sales_opportunity\b/iu.test(normalized)) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated SQL must read from t_sales_opportunity only.", {
      details: {
        sql: normalized
      }
    });
  }

  if (!/@opportunityId\b/iu.test(normalized)) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated SQL must use the @opportunityId parameter.", {
      details: {
        sql: normalized
      }
    });
  }

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(upper)) {
      throw createAppError("INVALID_SQL_TEMPLATE", "Generated SQL contains a forbidden keyword.", {
        details: {
          sql: normalized,
          keyword: pattern.toString()
        }
      });
    }
  }

  return normalized;
}

async function callSqlTemplateModel({ businessDefinition, dictionaryContent, skillPath, skillHash }) {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", "Missing MOONSHOT_API_KEY for SQL template generation.", {
      retryable: false
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_SQL_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_SQL_MODEL,
        temperature: 0,
        max_tokens: 256,
        stream: false,
        messages: [
          {
            role: "system",
            content: [
              "你是一个 SQL 模板生成器。",
              "只允许输出一个 JSON 对象，格式为 {\"sql\":\"...\"}。",
              "SQL 必须是参数化的单条 SELECT 语句。",
              "禁止输出解释、注释、Markdown、代码块。",
              "禁止生成写操作、联表、子查询、多语句、DDL、DML。",
              "只允许查询表 t_sales_opportunity。",
              "必须使用参数 @opportunityId。",
              "必须使用 SELECT TOP 1。"
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `skillPath: ${skillPath}`,
              `skillHash: ${skillHash}`,
              "",
              "业务查询定义：",
              businessDefinition,
              "",
              "字段字典：",
              dictionaryContent
            ].join("\n")
          }
        ]
      }),
      signal: controller.signal
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", `SQL template generation failed with HTTP ${response.status}.`, {
        details: {
          httpStatus: response.status,
          body: rawText
        }
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", "SQL template generation gateway returned invalid JSON.", {
        details: {
          body: rawText
        }
      });
    }

    const content = parsed?.choices?.[0]?.message?.content;
    const contentJson = extractJsonObject(content);
    return validateGeneratedSql(contentJson.sql);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createAppError("RUNTIME_TIMEOUT", "SQL template generation timed out.", {
        stage: "directdb-sql-template"
      });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readCachedTemplate() {
  try {
    if (!fs.existsSync(SQL_CACHE_FILE)) {
      return null;
    }

    return JSON.parse(await fsp.readFile(SQL_CACHE_FILE, "utf8"));
  } catch (error) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Failed to read cached SQL template.", {
      details: {
        filePath: SQL_CACHE_FILE,
        cause: error?.message || "cache_read_failed"
      }
    });
  }
}

async function clearCachedTemplate() {
  if (fs.existsSync(SQL_CACHE_FILE)) {
    await fsp.unlink(SQL_CACHE_FILE);
  }
}

async function writeCachedTemplate(template) {
  await fsp.mkdir(SQL_CACHE_DIR, { recursive: true });
  await fsp.writeFile(SQL_CACHE_FILE, `${JSON.stringify(template, null, 2)}\n`, "utf8");
}

async function getOrCreateSqlTemplate() {
  const skillContext = await loadSkillContext();
  const cachedTemplate = await readCachedTemplate();

  if (cachedTemplate?.skillHash === skillContext.skillHash && typeof cachedTemplate.sql === "string") {
    return {
      cacheHit: true,
      sql: validateGeneratedSql(cachedTemplate.sql),
      metadata: cachedTemplate
    };
  }

  if (cachedTemplate) {
    await clearCachedTemplate();
  }

  const sqlText = await callSqlTemplateModel(skillContext);
  const template = {
    scene: skillContext.scene,
    skillId: skillContext.skillId,
    skillPath: skillContext.skillPath,
    skillHash: skillContext.skillHash,
    businessDefinition: skillContext.businessDefinition,
    sql: sqlText,
    generatedAt: new Date().toISOString(),
    model: DEFAULT_SQL_MODEL
  };

  await writeCachedTemplate(template);

  info("directdb-runner.sql-template.generated", {
    scene: skillContext.scene,
    skillId: skillContext.skillId,
    cacheFile: SQL_CACHE_FILE,
    model: DEFAULT_SQL_MODEL
  });

  return {
    cacheHit: false,
    sql: sqlText,
    metadata: template
  };
}

function validateSqlTemplateRequest(body) {
  if (!body || typeof body !== "object") {
    throw createAppError("INVALID_REQUEST", "Direct DB query request must be a JSON object.", {
      stage: "directdb-query"
    });
  }

  if (!body.requestId || typeof body.requestId !== "string") {
    throw createAppError("INVALID_REQUEST", "requestId is required for direct DB query.", {
      stage: "directdb-query"
    });
  }

  return {
    requestId: body.requestId,
    opportunityId: normalizeOpportunityId(body.opportunityId)
  };
}

async function executeSalesOpportunitySql({ opportunityId, sqlText }) {
  try {
    const pool = await getDbPool();
    const result = await pool
      .request()
      .input("opportunityId", sql.NVarChar(64), opportunityId)
      .query(sqlText);

    if (!result.recordset.length) {
      throw createAppError("OPPORTUNITY_NOT_FOUND", "未查询到对应的销售机会记录");
    }

    return result.recordset[0];
  } catch (caughtError) {
    if (caughtError?.name === "AppError") {
      throw caughtError;
    }

    throw createAppError("CONTEXT_QUERY_FAILED", "Direct DB query execution failed.", {
      stage: "directdb-query",
      details: {
        cause: caughtError?.message || "sql_query_failed"
      }
    });
  }
}

async function executeSqlTemplateRequest(body) {
  const validated = validateSqlTemplateRequest(body);
  const template = await getOrCreateSqlTemplate();
  const row = await executeSalesOpportunitySql({
    opportunityId: validated.opportunityId,
    sqlText: template.sql
  });
  const rawRow = filterNonEmptyFields(row);

  return {
    requestId: validated.requestId,
    opportunityId: validated.opportunityId,
    sqlTemplate: {
      cacheHit: template.cacheHit,
      generatedAt: template.metadata.generatedAt,
      skillHash: template.metadata.skillHash
    },
    rawRow
  };
}

module.exports = {
  executeSqlTemplateRequest,
  getOrCreateSqlTemplate,
  validateGeneratedSql,
  validateSqlTemplateRequest
};
