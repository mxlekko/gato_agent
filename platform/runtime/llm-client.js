const { createAppError } = require("../../utils/errors");

const DEFAULT_TIMEOUT_MS = 30000;

const PROVIDER_DEFAULTS = {
  moonshot: {
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    keyEnvNames: ["MOONSHOT_API_KEY"]
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    keyEnvNames: ["DEEPSEEK_API_KEY"]
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyEnvNames: ["OPENAI_API_KEY"]
  },
  "openai-compatible": {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyEnvNames: ["OPENAI_API_KEY", "MOONSHOT_API_KEY", "DEEPSEEK_API_KEY"]
  }
};

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstEnvValue(env, names) {
  for (const name of names) {
    const value = trimString(env?.[name]);
    if (value) {
      return {
        name,
        value
      };
    }
  }

  return null;
}

function normalizeProviderName(rawValue) {
  const normalized = trimString(rawValue).toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["openai_compatible", "openai-compatible", "compatible"].includes(normalized)) {
    return "openai-compatible";
  }

  return normalized;
}

function inferProvider(env = process.env, driver = {}) {
  const explicit = normalizeProviderName(
    env.LANGGRAPH_LLM_PROVIDER
      || env.PROJECT_LLM_PROVIDER
      || env.CHAT_PROVIDER
      || driver.provider
  );
  if (explicit) {
    return explicit;
  }

  if (trimString(env.CHAT_BASE_URL) || trimString(env.CHAT_MODEL)) {
    return "openai-compatible";
  }

  if (trimString(env.MOONSHOT_API_KEY)) {
    return "moonshot";
  }

  if (trimString(env.DEEPSEEK_API_KEY)) {
    return "deepseek";
  }

  if (trimString(env.OPENAI_API_KEY)) {
    return "openai";
  }

  return "openai-compatible";
}

function normalizeBaseUrl(rawBaseUrl) {
  const baseUrl = trimString(rawBaseUrl).replace(/\/+$/, "");
  if (!baseUrl) {
    throw createAppError("MODEL_INVOCATION_FAILED", "Project LLM base URL is missing.", {
      stage: "project-llm",
      retryable: false
    });
  }

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw createAppError("MODEL_INVOCATION_FAILED", "Project LLM base URL is invalid.", {
      stage: "project-llm",
      retryable: false
    });
  }

  return baseUrl;
}

function resolveProjectLlmConfig({
  toolDocument = null,
  env = process.env
} = {}) {
  const driver = isObject(toolDocument?.spec?.driver) ? toolDocument.spec.driver : {};
  const provider = inferProvider(env, driver);
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS["openai-compatible"];
  const baseUrl = normalizeBaseUrl(
    env.LANGGRAPH_LLM_BASE_URL
      || env.PROJECT_LLM_BASE_URL
      || env.CHAT_BASE_URL
      || driver.baseUrl
      || defaults.baseUrl
  );
  const model = trimString(
    env.LANGGRAPH_LLM_MODEL
      || env.PROJECT_LLM_MODEL
      || env.CHAT_MODEL
      || driver.model
      || defaults.model
  );

  if (!model) {
    throw createAppError("MODEL_INVOCATION_FAILED", "Project LLM model is missing.", {
      stage: "project-llm",
      retryable: false,
      details: {
        provider
      }
    });
  }

  const keyEnvNames = [
    "LANGGRAPH_LLM_API_KEY",
    "PROJECT_LLM_API_KEY",
    ...(defaults.keyEnvNames || [])
  ];
  const apiKey = firstEnvValue(env, keyEnvNames);
  if (!apiKey) {
    throw createAppError("MODEL_INVOCATION_FAILED", `Missing API key for project LLM provider ${provider}.`, {
      stage: "project-llm",
      retryable: false,
      details: {
        provider,
        keyEnvNames
      }
    });
  }

  const timeoutMax = Number(toolDocument?.spec?.limits?.timeoutMsMax || 0);
  const requestedTimeout = Number(
    env.LANGGRAPH_LLM_TIMEOUT_MS
      || env.PROJECT_LLM_TIMEOUT_MS
      || toolDocument?.spec?.limits?.timeoutMsDefault
      || DEFAULT_TIMEOUT_MS
  );
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? timeoutMax > 0
      ? Math.min(requestedTimeout, timeoutMax)
      : requestedTimeout
    : DEFAULT_TIMEOUT_MS;

  return {
    provider,
    baseUrl,
    model,
    apiKey: apiKey.value,
    apiKeySource: apiKey.name,
    timeoutMs,
    temperature: Number(env.LANGGRAPH_LLM_TEMPERATURE || env.PROJECT_LLM_TEMPERATURE || driver.temperature || 0),
    maxTokens: Number(env.LANGGRAPH_LLM_MAX_TOKENS || env.PROJECT_LLM_MAX_TOKENS || driver.maxTokens || 1200)
  };
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify(String(value));
  }
}

function buildProjectAdvisoryMessages({
  requestPayload,
  promptRef = null,
  scene = null
} = {}) {
  const schema = requestPayload?.schema || {};
  const prompt = trimString(requestPayload?.prompt);
  const systemPrompt = [
    prompt || "你是项目内业务工作流的结构化输出生成节点。",
    "",
    "只返回一个 JSON 对象，不要使用 Markdown，不要输出解释性文字。",
    "JSON 必须符合当前 output schema，并且字段内容只能基于 request、facts、basisFields、rules 和 knowledgeMatches。"
  ].join("\n");
  const userPrompt = [
    `scene: ${scene || requestPayload?.request?.scene || "unknown"}`,
    `promptRef: ${promptRef || requestPayload?.promptRef || "unknown"}`,
    "",
    "request:",
    safeJsonStringify(requestPayload?.request || {}),
    "",
    "facts:",
    safeJsonStringify(requestPayload?.facts || {}),
    "",
    "basisFields:",
    safeJsonStringify(requestPayload?.basisFields || []),
    "",
    "knowledgeMatches:",
    safeJsonStringify(requestPayload?.knowledgeMatches || []),
    "",
    "rules:",
    trimString(requestPayload?.rules),
    "",
    "outputSchema:",
    safeJsonStringify(schema)
  ].join("\n");

  return [
    {
      role: "system",
      content: systemPrompt
    },
    {
      role: "user",
      content: userPrompt
    }
  ];
}

function extractJsonObject(content) {
  const trimmed = trimString(content)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!trimmed) {
    throw createAppError("MODEL_INVALID_JSON", "Project LLM response content is empty.", {
      httpStatus: 502,
      stage: "project-llm",
      retryable: false
    });
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw createAppError("MODEL_INVALID_JSON", "Project LLM response is not valid JSON.", {
        httpStatus: 502,
        stage: "project-llm",
        retryable: false,
        details: {
          contentPreview: trimmed.slice(0, 500)
        }
      });
    }

    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      throw createAppError("MODEL_INVALID_JSON", "Project LLM response contains invalid JSON.", {
        httpStatus: 502,
        stage: "project-llm",
        retryable: false,
        details: {
          contentPreview: trimmed.slice(0, 500)
        }
      });
    }
  }
}

async function callProjectLlmApi({
  config,
  messages,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw createAppError("MODEL_INVOCATION_FAILED", "fetch is not available for project LLM invocation.", {
      stage: "project-llm",
      retryable: false
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        temperature: Number.isFinite(config.temperature) ? config.temperature : 0,
        max_tokens: Number.isFinite(config.maxTokens) ? config.maxTokens : 1200,
        response_format: {
          type: "json_object"
        },
        messages
      }),
      signal: controller.signal
    });

    const rawText = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw createAppError("MODEL_INVOCATION_FAILED", "Project LLM authentication failed.", {
        stage: "project-llm",
        retryable: false,
        details: {
          provider: config.provider,
          httpStatus: response.status
        }
      });
    }

    if (!response.ok) {
      throw createAppError("MODEL_INVOCATION_FAILED", `Project LLM request failed with HTTP ${response.status}.`, {
        stage: "project-llm",
        retryable: true,
        details: {
          provider: config.provider,
          httpStatus: response.status,
          bodyPreview: rawText.slice(0, 500)
        }
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw createAppError("MODEL_INVALID_JSON", "Project LLM gateway returned invalid JSON.", {
        httpStatus: 502,
        stage: "project-llm",
        retryable: false,
        details: {
          bodyPreview: rawText.slice(0, 500)
        }
      });
    }

    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw createAppError("INVALID_MODEL_OUTPUT", "Project LLM response is missing choices[0].message.content.", {
        stage: "project-llm",
        retryable: false,
        details: {
          provider: config.provider,
          responseShape: Object.keys(parsed || {})
        }
      });
    }

    return content;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createAppError("MODEL_TIMEOUT", "Project LLM request timed out.", {
        httpStatus: 504,
        stage: "project-llm",
        retryable: true,
        details: {
          provider: config.provider,
          timeoutMs: config.timeoutMs
        }
      });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function invokeProjectAdvisoryLlm({
  toolDocument,
  requestPayload,
  promptRef = null,
  scene = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = resolveProjectLlmConfig({
    toolDocument,
    env
  });
  const messages = buildProjectAdvisoryMessages({
    requestPayload,
    promptRef,
    scene
  });
  const content = await callProjectLlmApi({
    config,
    messages,
    fetchImpl
  });
  const payload = extractJsonObject(content);

  if (!isObject(payload)) {
    throw createAppError("INVALID_MODEL_OUTPUT", "Project LLM response must be a JSON object.", {
      stage: "project-llm",
      retryable: false
    });
  }

  return {
    payload,
    mode: "project-llm",
    provider: config.provider,
    model: config.model,
    apiKeySource: config.apiKeySource
  };
}

module.exports = {
  buildProjectAdvisoryMessages,
  callProjectLlmApi,
  extractJsonObject,
  invokeProjectAdvisoryLlm,
  resolveProjectLlmConfig,
  __private: {
    inferProvider,
    normalizeBaseUrl
  }
};
