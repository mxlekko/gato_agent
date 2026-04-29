const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { createAppError } = require("../../utils/errors");
const { info } = require("../../utils/logger");
const { getSceneConfig, getSceneConfigSourceState } = require("../../services/scene-config");
const { PROJECT_ROOT, resolvePathReference } = require("../../utils/path-resolver");

const DEFAULT_SCENE = "sales-opportunity-advisor";
const LEGACY_PROJECT_ROOTS = [PROJECT_ROOT, "/Users/gato-pm/Desktop/API"];

const QUERY_SCRIPT_PATH_BEGIN = "<<<CONTEXT_HELPER_QUERY_SCRIPT_PATH_BEGIN>>>";
const QUERY_SCRIPT_PATH_END = "<<<CONTEXT_HELPER_QUERY_SCRIPT_PATH_END>>>";
const QUERY_DEFINITION_BEGIN = "<<<CONTEXT_HELPER_QUERY_DEFINITION_BEGIN>>>";
const QUERY_DEFINITION_END = "<<<CONTEXT_HELPER_QUERY_DEFINITION_END>>>";

const DEFAULT_MODEL = process.env.HELPER_QUERY_SCRIPT_MODEL || "kimi-k2-turbo-preview";
const DEFAULT_TIMEOUT_MS = Number(process.env.HELPER_QUERY_SCRIPT_TIMEOUT_MS || 30000);

function sha256(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
}

async function loadSceneConfig(scene = DEFAULT_SCENE) {
  const pathState = getSceneConfigSourceState();
  const sceneConfigPath = path.join(pathState.sceneConfigDir, `${scene}.json`);

  try {
    return {
      scene,
      pathState,
      sceneConfigPath,
      sceneConfig: getSceneConfig(scene)
    };
  } catch (error) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Failed to read helper scene config.", {
      stage: "context-query-script",
      details: {
        scene,
        filePath: sceneConfigPath,
        cause: error?.message || "scene_config_read_failed"
      }
    });
  }
}

function getHelperPaths(scene, pathState) {
  const generatedQueryDir = path.join(pathState.projectRoot, "ContextHelper", "generated-queries");
  return {
    generatedQueryDir,
    defaultGeneratedQueryFile: path.join(generatedQueryDir, `${scene}.generated.js`),
    manifestFile: path.join(generatedQueryDir, "manifest.json")
  };
}

function isPathInside(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function normalizeManagedFilePath(rawPath, pathState) {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("project://") || trimmed.startsWith("runtime://") || !path.isAbsolute(trimmed)) {
    return resolvePathReference(trimmed, {
      projectRoot: pathState.projectRoot,
      runtimeRoot: pathState.runtimeRoot
    }).resolvedPath;
  }

  const normalizedPath = path.resolve(trimmed);
  for (const rootPath of [pathState.projectRoot, ...LEGACY_PROJECT_ROOTS]) {
    if (isPathInside(rootPath, normalizedPath)) {
      return path.join(pathState.projectRoot, path.relative(rootPath, normalizedPath));
    }
  }

  return normalizedPath;
}

function extractMarkedBlock(content, beginMarker, endMarker, { required = true, label = "helper skill block" } = {}) {
  const beginIndex = content.indexOf(beginMarker);
  const endIndex = content.indexOf(endMarker);

  if (beginIndex === -1 || endIndex === -1 || endIndex <= beginIndex) {
    if (!required) {
      return null;
    }

    throw createAppError("INVALID_SQL_TEMPLATE", `Required ${label} markers were not found.`, {
      stage: "context-query-script",
      details: {
        label,
        beginMarker,
        endMarker
      }
    });
  }

  return {
    beginIndex,
    endIndex,
    content: content.slice(beginIndex + beginMarker.length, endIndex).trim()
  };
}

function normalizeSkillDeclaredFilePath(rawPathContent, skillPath, pathState) {
  const trimmed = String(rawPathContent || "").trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Helper skill script path block must contain exactly one path.", {
      stage: "context-query-script",
      details: {
        skillPath,
        lines
      }
    });
  }

  const declaredPath = lines[0];
  if (!declaredPath.endsWith(".js")) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Helper skill script path must point to a .js file.", {
      stage: "context-query-script",
      details: {
        skillPath,
        declaredPath
      }
    });
  }

  return normalizeManagedFilePath(declaredPath, pathState);
}

function normalizeGeneratedSql(rawSql) {
  if (typeof rawSql !== "string" || !rawSql.trim()) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated helper SQL must be a non-empty string.", {
      stage: "context-query-script"
    });
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
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated helper SQL must start with SELECT.", {
      stage: "context-query-script",
      details: {
        sql: normalized
      }
    });
  }

  if (normalized.includes(";")) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated helper SQL must be a single statement.", {
      stage: "context-query-script",
      details: {
        sql: normalized
      }
    });
  }

  if (!/\bTOP\s+1\b/iu.test(normalized)) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated helper SQL must include TOP 1.", {
      stage: "context-query-script",
      details: {
        sql: normalized
      }
    });
  }

  if (!/\bFROM\s+t_sales_opportunity\b/iu.test(normalized)) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated helper SQL must query only t_sales_opportunity.", {
      stage: "context-query-script",
      details: {
        sql: normalized
      }
    });
  }

  if (!/@opportunityId\b/iu.test(normalized)) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated helper SQL must use the @opportunityId parameter.", {
      stage: "context-query-script",
      details: {
        sql: normalized
      }
    });
  }

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(upper)) {
      throw createAppError("INVALID_SQL_TEMPLATE", "Generated helper SQL contains a forbidden keyword.", {
        stage: "context-query-script",
        details: {
          sql: normalized,
          keyword: pattern.toString()
        }
      });
    }
  }

  return normalized;
}

function extractJsonObject(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) {
    throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", "Helper query generation returned empty content.", {
      stage: "context-query-script"
    });
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", "Helper query generation returned invalid JSON.", {
        stage: "context-query-script",
        details: {
          content: trimmed
        }
      });
    }

    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", "Helper query generation returned malformed JSON.", {
        stage: "context-query-script",
        details: {
          content: trimmed
        }
      });
    }
  }
}

async function readSkillContext(scene = DEFAULT_SCENE) {
  const loadedScene = await loadSceneConfig(scene);
  const helperPaths = getHelperPaths(loadedScene.scene, loadedScene.pathState);
  const sceneConfig = loadedScene.sceneConfig;
  const skillPath = sceneConfig?.skill?.entryFile;
  if (!skillPath) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Helper scene config is missing skill.entryFile.", {
      stage: "context-query-script"
    });
  }

  let skillContent;
  try {
    skillContent = await fsp.readFile(skillPath, "utf8");
  } catch (error) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Failed to read helper skill file.", {
      stage: "context-query-script",
      details: {
        skillPath,
        cause: error?.message || "skill_read_failed"
      }
    });
  }

  const scriptPathBlock = extractMarkedBlock(skillContent, QUERY_SCRIPT_PATH_BEGIN, QUERY_SCRIPT_PATH_END, {
    required: false,
    label: "helper query script path"
  });
  const definitionBlock = extractMarkedBlock(skillContent, QUERY_DEFINITION_BEGIN, QUERY_DEFINITION_END, {
    label: "helper query business definition"
  });

  return {
    sceneConfig,
    scene: loadedScene.scene,
    pathState: loadedScene.pathState,
    sceneConfigPath: loadedScene.sceneConfigPath,
    skillPath,
    declaredFilePath: normalizeSkillDeclaredFilePath(scriptPathBlock?.content, skillPath, loadedScene.pathState),
    generatedQueryDir: helperPaths.generatedQueryDir,
    defaultGeneratedQueryFile: helperPaths.defaultGeneratedQueryFile,
    manifestFile: helperPaths.manifestFile,
    definitionText: definitionBlock.content,
    definitionHash: sha256(definitionBlock.content)
  };
}

async function generateHelperQuerySql({ definitionText, definitionHash, skillPath }) {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", "Missing MOONSHOT_API_KEY for helper query generation.", {
      stage: "context-query-script",
      retryable: false
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0,
        max_tokens: 256,
        stream: false,
        messages: [
          {
            role: "system",
            content: [
              "你负责为本地查询服务生成查询脚本所需的 SQL。",
              "只返回一个 JSON 对象，格式为 {\"sql\":\"...\"}。",
              "SQL 必须是参数化的单条 SELECT 语句。",
              "禁止输出解释、注释、Markdown、代码块。",
              "只允许查询 t_sales_opportunity。",
              "必须使用参数 @opportunityId。",
              "必须使用 SELECT TOP 1。",
              "禁止联表、子查询、排序、写操作。"
            ].join("\n")
          },
          {
            role: "user",
            content: [
              `skillPath: ${skillPath}`,
              `definitionHash: ${definitionHash}`,
              "",
              "业务查询定义：",
              definitionText
            ].join("\n")
          }
        ]
      }),
      signal: controller.signal
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", `Helper query generation failed with HTTP ${response.status}.`, {
        stage: "context-query-script",
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
      throw createAppError("SQL_TEMPLATE_GENERATION_FAILED", "Helper query generation gateway returned invalid JSON.", {
        stage: "context-query-script",
        details: {
          body: rawText
        }
      });
    }

    const content = parsed?.choices?.[0]?.message?.content;
    const generated = extractJsonObject(content);
    return normalizeGeneratedSql(generated.sql);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createAppError("RUNTIME_TIMEOUT", "Helper query generation timed out.", {
        stage: "context-query-script"
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildGeneratedQueryFileContent({ definitionHash, sqlText }) {
  return [
    "\"use strict\";",
    "",
    "module.exports = {",
    `  definitionHash: ${JSON.stringify(definitionHash)},`,
    `  sqlText: ${JSON.stringify(sqlText)},`,
    `  generatedAt: ${JSON.stringify(new Date().toISOString())}`,
    "};",
    ""
  ].join("\n");
}

async function writeGeneratedQueryFile(filePath, { definitionHash, sqlText }) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, buildGeneratedQueryFileContent({ definitionHash, sqlText }), "utf8");
}

async function readManifest(skillContext) {
  try {
    if (!fs.existsSync(skillContext.manifestFile)) {
      return {};
    }
    return JSON.parse(await fsp.readFile(skillContext.manifestFile, "utf8"));
  } catch (error) {
    throw createAppError("INVALID_SQL_TEMPLATE", "Failed to read helper query manifest.", {
      stage: "context-query-script",
      details: {
        filePath: skillContext.manifestFile,
        cause: error?.message || "manifest_read_failed"
      }
    });
  }
}

async function writeManifest(manifest, skillContext) {
  await fsp.mkdir(skillContext.generatedQueryDir, { recursive: true });
  await fsp.writeFile(skillContext.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function loadGeneratedQueryModule(filePath) {
  delete require.cache[require.resolve(filePath)];
  const loaded = require(filePath);
  if (!loaded || typeof loaded.sqlText !== "string") {
    throw createAppError("INVALID_SQL_TEMPLATE", "Generated helper query file must export sqlText.", {
      stage: "context-query-script",
      details: {
        filePath
      }
    });
  }

  return {
    definitionHash: loaded.definitionHash || "",
    sqlText: normalizeGeneratedSql(loaded.sqlText)
  };
}

function tryLoadGeneratedQueryModule(filePath) {
  try {
    return loadGeneratedQueryModule(filePath);
  } catch (error) {
    info("context-helper.query-file.invalid", {
      filePath,
      cause: error?.message || "invalid_generated_query_file"
    });
    return null;
  }
}

function buildManifestEntry(skillContext, filePath) {
  return {
    scene: skillContext.sceneConfig.scene,
    skillPath: skillContext.skillPath,
    declaredFilePath: skillContext.declaredFilePath,
    definitionHash: skillContext.definitionHash,
    filePath,
    generatedAt: new Date().toISOString()
  };
}

function isActiveBundleSource(skillContext) {
  return skillContext?.pathState?.source === "active-bundle";
}

function buildReleasedHelperBundleError(skillContext, filePath, reason, details = {}) {
  return createAppError(
    "INVALID_SQL_TEMPLATE",
    "Published helper query script is missing or out of date. Please rebuild and republish the release bundle.",
    {
      stage: "context-query-script",
      retryable: false,
      details: {
        scene: skillContext.sceneConfig.scene,
        source: skillContext.pathState?.source || null,
        filePath,
        manifestFile: skillContext.manifestFile,
        reason,
        ...details
      }
    }
  );
}

async function getOrCreateHelperQueryFile({ scene = DEFAULT_SCENE } = {}) {
  const skillContext = await readSkillContext(scene);
  const manifest = await readManifest(skillContext);
  const manifestEntry = manifest[skillContext.sceneConfig.scene];
  const currentPointerPath =
    normalizeManagedFilePath(skillContext.declaredFilePath, skillContext.pathState) ||
    normalizeManagedFilePath(manifestEntry?.filePath, skillContext.pathState) ||
    skillContext.defaultGeneratedQueryFile;

  if (fs.existsSync(currentPointerPath)) {
    const loaded = tryLoadGeneratedQueryModule(currentPointerPath);
    if (loaded?.definitionHash === skillContext.definitionHash) {
      if (!isActiveBundleSource(skillContext)) {
        const nextManifestEntry = buildManifestEntry(skillContext, currentPointerPath);
        if (
          !manifestEntry ||
          manifestEntry.skillPath !== nextManifestEntry.skillPath ||
          manifestEntry.declaredFilePath !== nextManifestEntry.declaredFilePath ||
          manifestEntry.definitionHash !== nextManifestEntry.definitionHash ||
          manifestEntry.filePath !== nextManifestEntry.filePath
        ) {
          manifest[skillContext.sceneConfig.scene] = nextManifestEntry;
          await writeManifest(manifest, skillContext);
        }
      }

      return {
        cacheHit: true,
        filePath: currentPointerPath,
        sqlText: loaded.sqlText
      };
    }

    if (isActiveBundleSource(skillContext)) {
      throw buildReleasedHelperBundleError(skillContext, currentPointerPath, "definition-hash-mismatch", {
        expectedDefinitionHash: skillContext.definitionHash,
        actualDefinitionHash: loaded?.definitionHash || null
      });
    }
  } else if (isActiveBundleSource(skillContext)) {
    throw buildReleasedHelperBundleError(skillContext, currentPointerPath, "missing-helper-script");
  }

  const sqlText = await generateHelperQuerySql({
    definitionText: skillContext.definitionText,
    definitionHash: skillContext.definitionHash,
    skillPath: skillContext.skillPath
  });

  await writeGeneratedQueryFile(currentPointerPath, {
    definitionHash: skillContext.definitionHash,
    sqlText
  });

  manifest[skillContext.sceneConfig.scene] = buildManifestEntry(skillContext, currentPointerPath);
  await writeManifest(manifest, skillContext);

  info("context-helper.query-file.generated", {
    scene: skillContext.sceneConfig.scene,
    skillPath: skillContext.skillPath,
    filePath: currentPointerPath,
    manifestFile: skillContext.manifestFile,
    model: DEFAULT_MODEL
  });

  return {
    cacheHit: false,
    filePath: currentPointerPath,
    sqlText
  };
}

module.exports = {
  getOrCreateHelperQueryFile,
  normalizeGeneratedSql
};
