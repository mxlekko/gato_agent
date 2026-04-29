const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { createAppError } = require("../utils/errors");
const { validateStructuredOutput } = require("../ModelTool/services/structured-output-validator");
const { resolvePathReference } = require("../utils/path-resolver");
const { getSceneConfigSourceState } = require("./scene-config");

const DEFAULT_TIMEOUT_MS = 30000;
const BLOCKED_PATH_WARNING_CODES = new Set(["legacy-project-path", "shared-openclaw-path"]);

function getExecutionMode(sceneConfig) {
  return sceneConfig?.execution?.mode || "agent-runtime";
}

function isDirectModelScene(sceneConfig) {
  return getExecutionMode(sceneConfig) === "direct-model";
}

function getSchemaReference(sceneConfig, referenceId) {
  const references = Array.isArray(sceneConfig?.references) ? sceneConfig.references : [];
  return references.find((reference) => reference.id === referenceId) || null;
}

function buildResolutionCandidates(primaryValue, refValue) {
  const seen = new Set();
  const candidates = [];

  const pushCandidate = (value, source) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      return;
    }

    const normalized = value.trim();
    if (seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    candidates.push({
      value: normalized,
      source
    });
  };

  for (const entry of [
    { value: primaryValue, source: "resolved" },
    { value: refValue, source: "ref" }
  ]) {
    if (typeof entry.value !== "string" || entry.value.trim().length === 0) {
      continue;
    }

    pushCandidate(entry.value, entry.source);
  }

  return candidates;
}

function getBlockedPathWarnings(warnings) {
  return Array.isArray(warnings)
    ? warnings.filter((warning) => BLOCKED_PATH_WARNING_CODES.has(warning?.code))
    : [];
}

function getDirectModelPathState() {
  const sourceState = getSceneConfigSourceState();
  return {
    projectRoot: sourceState.projectRoot,
    runtimeRoot: sourceState.runtimeRoot,
    source: sourceState.source
  };
}

function resolveDirectModelPathReference(reference, pathState) {
  return resolvePathReference(reference, {
    projectRoot: pathState.projectRoot,
    runtimeRoot: pathState.runtimeRoot
  });
}

function assertNoLegacyPathReferences({ primaryValue, refValue, label, scene, extraDetails, pathState }) {
  const blockedReferences = [];
  const effectivePathState = pathState || getDirectModelPathState();

  for (const candidate of [
    { value: primaryValue, source: "resolved" },
    { value: refValue, source: "ref" }
  ]) {
    if (typeof candidate.value !== "string" || candidate.value.trim().length === 0) {
      continue;
    }

    try {
      const resolution = resolveDirectModelPathReference(candidate.value, effectivePathState);
      const blockedWarnings = getBlockedPathWarnings(resolution.warnings);
      if (blockedWarnings.length > 0) {
        blockedReferences.push({
          source: candidate.source,
          originalValue: candidate.value,
          resolvedPath: resolution.resolvedPath,
          blockedWarnings
        });
      }
    } catch {
      // Ignore parse/resolve failures here and let the normal resolution path raise the canonical error.
    }
  }

  if (blockedReferences.length === 0) {
    return;
  }

  throw createAppError("INVALID_REQUEST", `Legacy runtime path is not allowed for ${label}.`, {
    stage: "direct-model",
    details: {
      scene,
      label,
      pathSource: effectivePathState.source,
      blockedReferences,
      ...extraDetails
    }
  });
}

function ensureExpectedPathType(resolvedPath, expectedType) {
  if (!fs.existsSync(resolvedPath)) {
    return "not_found";
  }

  const stat = fs.statSync(resolvedPath);
  if (expectedType === "directory") {
    return stat.isDirectory() ? null : "type_mismatch";
  }

  return stat.isFile() ? null : "type_mismatch";
}

function resolveDirectModelAssetPath({ primaryValue, refValue, label, expectedType, scene, extraDetails, pathState }) {
  const effectivePathState = pathState || getDirectModelPathState();
  assertNoLegacyPathReferences({
    primaryValue,
    refValue,
    label,
    scene,
    extraDetails,
    pathState: effectivePathState
  });

  const candidates = buildResolutionCandidates(primaryValue, refValue);
  if (candidates.length === 0) {
    throw createAppError("INVALID_REQUEST", `Missing ${label}.`, {
      stage: "direct-model",
      details: {
        scene,
        label,
        ...extraDetails
      }
    });
  }

  const failures = [];
  for (const candidate of candidates) {
    try {
      const resolution = resolveDirectModelPathReference(candidate.value, effectivePathState);
      const typeError = ensureExpectedPathType(resolution.resolvedPath, expectedType);
      if (!typeError) {
        return {
          path: resolution.resolvedPath,
          source: candidate.source,
          sourceType: resolution.sourceType,
          original: resolution.original
        };
      }

      failures.push({
        candidate: candidate.value,
        source: candidate.source,
        cause: typeError,
        resolvedPath: resolution.resolvedPath
      });
    } catch (error) {
      failures.push({
        candidate: candidate.value,
        source: candidate.source,
        cause: error?.message || "resolve_failed"
      });
    }
  }

  throw createAppError("INVALID_REQUEST", `Failed to resolve ${label}.`, {
    stage: "direct-model",
    details: {
      scene,
      label,
      pathSource: effectivePathState.source,
      candidates: failures,
      ...extraDetails
    }
  });
}

function deriveAuthProfilesFile(modelsFilePath) {
  return path.join(path.dirname(modelsFilePath), "auth-profiles.json");
}

function pickProviderApiKeyFromProfiles(parsed, provider) {
  const preferredProfileId = parsed?.lastGood?.[provider];
  const preferredProfile = preferredProfileId ? parsed?.profiles?.[preferredProfileId] : null;
  if (preferredProfile?.provider === provider && typeof preferredProfile?.key === "string" && preferredProfile.key.trim()) {
    return {
      apiKey: preferredProfile.key.trim(),
      profileId: preferredProfileId
    };
  }

  const profiles = Object.entries(parsed?.profiles || {});
  for (const [profileId, profile] of profiles) {
    if (profile?.provider === provider && typeof profile?.key === "string" && profile.key.trim()) {
      return {
        apiKey: profile.key.trim(),
        profileId
      };
    }
  }

  return null;
}

function resolveDirectModelCredential({ sceneConfig, directModelConfig }) {
  const pathState = getDirectModelPathState();
  const envKeyName = directModelConfig.apiKeyEnv || "MOONSHOT_API_KEY";
  const envValue = typeof process.env[envKeyName] === "string" ? process.env[envKeyName].trim() : "";
  if (envValue) {
    return {
      apiKey: envValue,
      source: `env:${envKeyName}`
    };
  }

  const modelsFile = resolveDirectModelAssetPath({
    primaryValue: directModelConfig.fallbackModelsFile,
    refValue: directModelConfig.fallbackModelsFileRef,
    label: "direct-model fallback models file",
    expectedType: "file",
    scene: sceneConfig.scene,
    extraDetails: {
      provider: directModelConfig.provider
    },
    pathState
  });

  const parsedModels = JSON.parse(fs.readFileSync(modelsFile.path, "utf8"));
  const providerConfig = parsedModels?.providers?.[directModelConfig.provider];
  if (typeof providerConfig?.apiKey === "string" && providerConfig.apiKey.trim()) {
    return {
      apiKey: providerConfig.apiKey.trim(),
      source: `models:${modelsFile.path}`
    };
  }

  const authProfilesFile = resolveDirectModelAssetPath({
    primaryValue: directModelConfig.authProfilesFile || deriveAuthProfilesFile(modelsFile.path),
    refValue: directModelConfig.authProfilesFileRef,
    label: "direct-model auth profiles file",
    expectedType: "file",
    scene: sceneConfig.scene,
    extraDetails: {
      provider: directModelConfig.provider,
      modelsFile: modelsFile.path
    },
    pathState
  });

  const parsedProfiles = JSON.parse(fs.readFileSync(authProfilesFile.path, "utf8"));
  const matchedProfile = pickProviderApiKeyFromProfiles(parsedProfiles, directModelConfig.provider);
  if (matchedProfile) {
    return {
      apiKey: matchedProfile.apiKey,
      source: `auth-profile:${matchedProfile.profileId}`
    };
  }

  throw createAppError("MODEL_INVOCATION_FAILED", `Missing API key for provider ${directModelConfig.provider}.`, {
    stage: "direct-model",
    details: {
      envKeyName,
      modelsFile: modelsFile.path,
      authProfilesFile: authProfilesFile.path
    }
  });
}

function resolveApiKey(args) {
  return resolveDirectModelCredential(args).apiKey;
}

async function readJsonFile(filePath, label) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    throw createAppError("INVALID_REQUEST", `Failed to read ${label}.`, {
      stage: "direct-model",
      details: {
        filePath,
        cause: error?.message || "read_failed"
      }
    });
  }
}

async function readTextFile(filePath, label) {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch (error) {
    throw createAppError("INVALID_REQUEST", `Failed to read ${label}.`, {
      stage: "direct-model",
      details: {
        filePath,
        cause: error?.message || "read_failed"
      }
    });
  }
}

function formatRagMatches(matches = []) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return "未检索到相似片段。";
  }

  return matches
    .slice(0, 3)
    .map((match, index) => {
      const text = String(match?.text || "").trim();
      const score = typeof match?.score === "number" ? ` score=${match.score}` : "";
      return `${index + 1}. ${text.slice(0, 800)}${score}`;
    })
    .join("\n\n");
}

function buildSpecialCustomProductMessages({ promptTemplate, schema, bizParams, ragMatches }) {
  return [
    {
      role: "system",
      content: promptTemplate.trim()
    },
    {
      role: "user",
      content: [
        "请只基于当前定制要求和 RAG 历史方案相似片段生成产品部方案。",
        "禁止补充未在 customRequirement 或 knowledgeMatches 中明确出现的工艺、物料、型号、颜色色号、包装方式、检验方法、成本、交期、风险、客户事实或承诺。",
        "没有依据的方案要点只能写“历史方案未提供依据，需人工确认”。",
        "productSolution 只输出最终产品部方案，不要写参考历史方案、当前定制要求、依据 RAG 等来源说明。",
        "只返回一个 JSON 对象，且只能包含 productSolution 一个字段。",
        "",
        "specialCustomOrderNo:",
        bizParams.specialCustomOrderNo,
        "",
        "customRequirement:",
        bizParams.customRequirement,
        "",
        "knowledgeMatches:",
        formatRagMatches(ragMatches),
        "",
        "outputSchema:",
        JSON.stringify(schema)
      ].join("\n")
    }
  ];
}

function buildSpecialCustomProductRetryMessages({ schema, bizParams, ragMatches }) {
  return [
    {
      role: "system",
      content: [
        "你是产品部方案生成器。",
        "只允许基于当前定制要求和历史方案片段生成结果。",
        "禁止编造未在输入中出现的工艺、物料、型号、包装、检验、成本、交期、风险或客户事实。",
        "productSolution 只输出最终产品部方案，不要写参考来源说明。",
        "只返回 JSON，且只能包含 productSolution。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        "当前定制要求:",
        bizParams.customRequirement,
        "",
        "历史方案片段:",
        formatRagMatches(ragMatches),
        "",
        "输出 schema:",
        JSON.stringify(schema)
      ].join("\n")
    }
  ];
}

function extractHistoricalPlanText(matchText) {
  const text = String(matchText || "").trim();
  if (!text) {
    return "";
  }

  const marker = "历史产品部方案：";
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    return text;
  }

  return text.slice(markerIndex + marker.length).trim();
}

function normalizeProductSolutionText(text) {
  return String(text || "").trim();
}

function buildGroundedFallbackProductSolution({ bizParams, ragMatches }) {
  const requirement = String(bizParams?.customRequirement || "").trim();

  for (const match of Array.isArray(ragMatches) ? ragMatches.slice(0, 1) : []) {
    const historicalPlan = extractHistoricalPlanText(match?.text);
    if (!historicalPlan) {
      continue;
    }

    return {
      productSolution: normalizeProductSolutionText(historicalPlan)
    };
  }

  return {
    productSolution: normalizeProductSolutionText(requirement || "历史方案未提供依据，需人工确认")
  };
}

function buildPromptMessages({ promptTemplate, schema, bizParams, scene, ragMatches = [] }) {
  if (scene === "special-custom-product-solution") {
    return buildSpecialCustomProductMessages({
      promptTemplate,
      schema,
      bizParams,
      ragMatches
    });
  }

  return [
    {
      role: "system",
      content: promptTemplate.trim()
    },
    {
      role: "user",
      content: [
        "请直接完成字段提取，并只返回一个 JSON 对象。",
        "",
        "rawText:",
        bizParams.rawText,
        "",
        "outputSchema:",
        JSON.stringify(schema)
      ].join("\n")
    }
  ];
}

async function retrieveRagMatches({ requestId, sceneConfig, bizParams }) {
  const ragConfig = sceneConfig?.directModel?.ragSearch;
  if (sceneConfig?.scene !== "special-custom-product-solution" || !ragConfig?.endpoint) {
    return [];
  }

  const controller = new AbortController();
  const timeoutMs = Number(ragConfig.timeoutMs || 12000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ragConfig.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requestId,
        query: bizParams.customRequirement,
        topK: Number(ragConfig.topK || 5)
      }),
      signal: controller.signal
    });
    const rawText = await response.text();
    let payload;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw createAppError("RAG_SEARCH_FAILED", "RAG search returned invalid JSON.", {
        stage: "direct-model-rag",
        details: {
          endpoint: ragConfig.endpoint,
          body: rawText
        }
      });
    }

    if (!response.ok || payload?.success === false) {
      throw createAppError("RAG_SEARCH_FAILED", "RAG search failed.", {
        stage: "direct-model-rag",
        details: {
          endpoint: ragConfig.endpoint,
          httpStatus: response.status,
          error: payload?.error || null
        }
      });
    }

    return Array.isArray(payload?.data?.matches) ? payload.data.matches : [];
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createAppError("RUNTIME_TIMEOUT", "RAG search timed out.", {
        stage: "direct-model-rag",
        details: {
          endpoint: ragConfig.endpoint,
          timeoutMs
        }
      });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractJsonObject(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) {
    throw createAppError("INVALID_MODEL_OUTPUT", "Direct-model response content is empty.", {
      stage: "direct-model"
    });
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw createAppError("INVALID_MODEL_OUTPUT", "Direct-model response is not valid JSON.", {
        stage: "direct-model",
        details: {
          content: trimmed
        }
      });
    }

    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      throw createAppError("INVALID_MODEL_OUTPUT", "Direct-model response contains invalid JSON.", {
        stage: "direct-model",
        details: {
          content: trimmed
        }
      });
    }
  }
}

async function callDirectModelApi({ directModelConfig, apiKey, messages }) {
  const controller = new AbortController();
  const timeoutMs = Number(directModelConfig.timeoutMs || process.env.DIRECT_MODEL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${directModelConfig.baseUrl || "https://api.moonshot.cn/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: directModelConfig.model,
        stream: false,
        temperature: directModelConfig.temperature ?? 0,
        max_tokens: directModelConfig.maxTokens ?? 256,
        messages
      }),
      signal: controller.signal
    });

    const rawText = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw createAppError("MODEL_INVOCATION_FAILED", "Direct-model authentication failed.", {
        stage: "direct-model",
        retryable: false,
        details: {
          httpStatus: response.status
        }
      });
    }

    if (!response.ok) {
      throw createAppError("MODEL_INVOCATION_FAILED", `Direct-model request failed with HTTP ${response.status}.`, {
        stage: "direct-model",
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
      throw createAppError("INVALID_MODEL_OUTPUT", "Direct-model gateway returned invalid JSON.", {
        stage: "direct-model",
        details: {
          body: rawText
        }
      });
    }

    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw createAppError("INVALID_MODEL_OUTPUT", "Direct-model response is missing choices[0].message.content.", {
        stage: "direct-model",
        details: {
          responseShape: Object.keys(parsed || {})
        }
      });
    }

    return content;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createAppError("RUNTIME_TIMEOUT", "Direct-model request timed out.", {
        stage: "direct-model"
      });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runDirectModelScene({ requestId, sceneConfig, bizParams }) {
  const startedAt = Date.now();
  const directModelConfig = sceneConfig.directModel;
  const pathState = getDirectModelPathState();
  const schemaReference = getSchemaReference(sceneConfig, directModelConfig.schemaReferenceId);
  if (!schemaReference?.path) {
    throw createAppError("INVALID_REQUEST", "Direct-model scene schema reference is missing.", {
      stage: "direct-model",
      details: {
        scene: sceneConfig.scene,
        schemaReferenceId: directModelConfig.schemaReferenceId
      }
    });
  }

  const promptFile = resolveDirectModelAssetPath({
    primaryValue: directModelConfig.promptFile,
    refValue: directModelConfig.promptFileRef,
    label: "direct-model prompt file",
    expectedType: "file",
    scene: sceneConfig.scene,
    extraDetails: {
      provider: directModelConfig.provider,
      model: directModelConfig.model
    },
    pathState
  });
  const schemaFile = resolveDirectModelAssetPath({
    primaryValue: schemaReference.path,
    refValue: schemaReference.pathRef,
    label: "direct-model output schema",
    expectedType: "file",
    scene: sceneConfig.scene,
    extraDetails: {
      referenceId: schemaReference.id
    },
    pathState
  });

  const [promptTemplate, schema] = await Promise.all([
    readTextFile(promptFile.path, "direct-model prompt file"),
    readJsonFile(schemaFile.path, "direct-model output schema")
  ]);

  const [apiKey, ragMatches] = await Promise.all([
    Promise.resolve(resolveApiKey({ sceneConfig, directModelConfig })),
    retrieveRagMatches({ requestId, sceneConfig, bizParams })
  ]);
  const messages = buildPromptMessages({
    promptTemplate,
    schema,
    bizParams,
    scene: sceneConfig.scene,
    ragMatches
  });
  let content = await callDirectModelApi({ directModelConfig, apiKey, messages });
  if (sceneConfig.scene === "special-custom-product-solution" && String(content || "").trim().length === 0) {
    content = await callDirectModelApi({
      directModelConfig,
      apiKey,
      messages: buildSpecialCustomProductRetryMessages({
        schema,
        bizParams,
        ragMatches
      })
    });
  }
  let payload;
  if (sceneConfig.scene === "special-custom-product-solution" && String(content || "").trim().length === 0) {
    payload = buildGroundedFallbackProductSolution({ bizParams, ragMatches });
  } else {
    try {
      payload = extractJsonObject(content);
    } catch (error) {
      if (sceneConfig.scene !== "special-custom-product-solution" || error?.code !== "INVALID_MODEL_OUTPUT") {
        throw error;
      }
      payload = buildGroundedFallbackProductSolution({ bizParams, ragMatches });
    }
  }
  if (sceneConfig.scene === "special-custom-product-solution" && typeof payload?.productSolution === "string") {
    payload.productSolution = normalizeProductSolutionText(payload.productSolution);
  }
  const validated = validateStructuredOutput({
    requestId,
    scene: sceneConfig.scene,
    payload,
    schema
  });

  return {
    success: true,
    scene: sceneConfig.scene,
    requestId,
    payload: validated.payload,
    error: null,
    meta: {
      durationMs: Date.now() - startedAt
    }
  };
}

module.exports = {
  getExecutionMode,
  isDirectModelScene,
  runDirectModelScene,
  __private: {
    assertNoLegacyPathReferences,
    resolveDirectModelAssetPath,
    resolveDirectModelCredential
  }
};
