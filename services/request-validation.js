const { createAppError } = require("../utils/errors");

const DEFAULT_MAX_BASE64_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_ALLOWED_CONTRACT_EXTENSIONS = [
  ".bmp",
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".doc",
  ".docx",
  ".wps",
  ".pdf",
  ".ofd",
  ".xlsx"
];

function buildValidationError(message, {
  stage = "request-validate",
  details = null,
  httpStatus,
  retryable
} = {}) {
  return createAppError("INVALID_REQUEST", message, {
    stage,
    details,
    httpStatus,
    retryable
  });
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFileExtension(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }

  return raw.startsWith(".") ? raw : `.${raw}`;
}

function getAllowedExtensions(rule = {}) {
  const configured = Array.isArray(rule.allowedExtensions)
    ? rule.allowedExtensions
    : DEFAULT_ALLOWED_CONTRACT_EXTENSIONS;
  return configured
    .map(normalizeFileExtension)
    .filter(Boolean);
}

function getFileExtension(fileName) {
  const index = String(fileName || "").lastIndexOf(".");
  return index >= 0 ? String(fileName).slice(index).toLowerCase() : "";
}

function normalizeFileNameField(rawValue, fieldName, rule = {}, stage = "request-validate") {
  if (typeof rawValue !== "string") {
    throw buildValidationError(`${fieldName} must be a string.`, {
      stage
    });
  }

  let normalized = rule.trim === false ? rawValue : rawValue.trim();
  if (rule.required !== false && normalized.length === 0) {
    throw buildValidationError(`${fieldName} must not be empty.`, {
      stage
    });
  }

  if (/[\x00-\x1f/\\]/u.test(normalized) || normalized === "." || normalized === "..") {
    throw buildValidationError(`${fieldName} is invalid.`, {
      stage
    });
  }

  if (rule.maxLength && normalized.length > rule.maxLength) {
    throw buildValidationError(`${fieldName} is too long.`, {
      stage,
      details: {
        fieldName,
        maxLength: rule.maxLength
      }
    });
  }

  const extension = getFileExtension(normalized);
  if (extension === ".xlxs") {
    normalized = `${normalized.slice(0, -extension.length)}.xlsx`;
  }

  const normalizedExtension = getFileExtension(normalized);
  const allowedExtensions = getAllowedExtensions(rule);
  if (allowedExtensions.length > 0 && !allowedExtensions.includes(normalizedExtension)) {
    throw buildValidationError(`${fieldName} must use one of these file types: ${allowedExtensions.join(", ")}.`, {
      stage,
      details: {
        fieldName,
        extension: normalizedExtension || null,
        allowedExtensions
      }
    });
  }

  return normalized;
}

function normalizeBase64FileField(rawValue, fieldName, rule = {}, stage = "request-validate") {
  if (typeof rawValue !== "string") {
    throw buildValidationError(`${fieldName} must be a string.`, {
      stage
    });
  }

  const normalized = rawValue.replace(/\s+/g, "");
  if (rule.required !== false && normalized.length === 0) {
    throw buildValidationError(`${fieldName} must not be empty.`, {
      stage
    });
  }

  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    throw buildValidationError(`${fieldName} must be valid base64.`, {
      stage
    });
  }

  let decoded;
  try {
    decoded = Buffer.from(normalized, "base64");
  } catch {
    throw buildValidationError(`${fieldName} must be valid base64.`, {
      stage
    });
  }

  if (decoded.length === 0) {
    throw buildValidationError(`${fieldName} must not be empty.`, {
      stage
    });
  }

  const maxBytes = parsePositiveInteger(
    rule.maxBytes || process.env.CONTRACT_REVIEW_MAX_FILE_BYTES,
    DEFAULT_MAX_BASE64_FILE_BYTES
  );
  if (decoded.length > maxBytes) {
    throw buildValidationError(`${fieldName} is too large.`, {
      stage,
      details: {
        fieldName,
        maxBytes,
        actualBytes: decoded.length
      }
    });
  }

  return normalized;
}

function normalizeFileObjectField(rawValue, fieldName, rule = {}, stage = "request-validate") {
  if (!isObject(rawValue)) {
    throw buildValidationError(`${fieldName} must be a file object.`, {
      stage
    });
  }

  const fileName = normalizeFileNameField(rawValue.fileName, `${fieldName}.fileName`, rule, stage);
  const fileContentBase64 = normalizeBase64FileField(
    rawValue.fileContentBase64,
    `${fieldName}.fileContentBase64`,
    rule,
    stage
  );

  const normalized = {
    fileName,
    fileContentBase64
  };

  if (rawValue.fileMimeType !== undefined && rawValue.fileMimeType !== null) {
    normalized.fileMimeType = normalizeStringField(
      rawValue.fileMimeType,
      `${fieldName}.fileMimeType`,
      {
        required: false,
        trim: true,
        maxLength: rule.mimeTypeMaxLength || 200
      },
      stage
    );
  }

  const decodedBytes = Buffer.from(fileContentBase64, "base64").length;
  normalized.sizeBytes = decodedBytes;

  return normalized;
}

function normalizeFileUrlField(rawValue, fieldName, rule = {}, stage = "request-validate") {
  if (typeof rawValue !== "string") {
    throw buildValidationError(`${fieldName} must be a string.`, {
      stage
    });
  }

  const normalized = rule.trim === false ? rawValue : rawValue.trim();
  if (!normalized) {
    if (rule.required === false) {
      return "";
    }
    throw buildValidationError(`${fieldName} must not be empty.`, {
      stage
    });
  }

  if (rule.maxLength && normalized.length > rule.maxLength) {
    throw buildValidationError(`${fieldName} is too long.`, {
      stage,
      details: {
        fieldName,
        maxLength: rule.maxLength
      }
    });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalized);
  } catch {
    throw buildValidationError(`${fieldName} must be a valid URL.`, {
      stage
    });
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw buildValidationError(`${fieldName} must use http or https.`, {
      stage,
      details: {
        fieldName,
        protocol: parsedUrl.protocol || null
      }
    });
  }

  return parsedUrl.toString();
}

function normalizeOpportunityId(rawValue, stage = "request-validate") {
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      throw buildValidationError("bizParams.opportunityId must not be empty.", {
        stage
      });
    }
    return trimmed;
  }

  if (typeof rawValue === "number") {
    if (!Number.isFinite(rawValue) || !Number.isInteger(rawValue)) {
      throw buildValidationError("bizParams.opportunityId must be an integer.", {
        stage
      });
    }

    if (!Number.isSafeInteger(rawValue)) {
      throw buildValidationError(
        "Large bizParams.opportunityId values must be sent as strings to avoid precision loss.",
        {
          stage
        }
      );
    }

    return String(rawValue);
  }

  throw buildValidationError("bizParams.opportunityId must be a string or integer.", {
    stage
  });
}

function normalizeStringField(rawValue, fieldName, rule = {}, stage = "request-validate") {
  if (typeof rawValue !== "string") {
    throw buildValidationError(`${fieldName} must be a string.`, {
      stage
    });
  }

  const normalized = rule.trim === false ? rawValue : rawValue.trim();

  if (rule.required !== false && normalized.length === 0) {
    throw buildValidationError(`${fieldName} must not be empty.`, {
      stage
    });
  }

  if (rule.maxLength && normalized.length > rule.maxLength) {
    throw buildValidationError(`${fieldName} is too long.`, {
      stage,
      details: {
        fieldName,
        maxLength: rule.maxLength
      }
    });
  }

  return normalized;
}

function normalizeBizParamByRule(fieldName, rawValue, rule = {}, stage = "request-validate") {
  switch (rule.type) {
    case "opportunityId":
      return normalizeOpportunityId(rawValue, stage);
    case "string":
      return normalizeStringField(rawValue, `bizParams.${fieldName}`, rule, stage);
    case "fileName":
      return normalizeFileNameField(rawValue, `bizParams.${fieldName}`, rule, stage);
    case "base64File":
      return normalizeBase64FileField(rawValue, `bizParams.${fieldName}`, rule, stage);
    case "fileObject":
      return normalizeFileObjectField(rawValue, `bizParams.${fieldName}`, rule, stage);
    case "fileUrl":
      return normalizeFileUrlField(rawValue, `bizParams.${fieldName}`, rule, stage);
    default:
      throw buildValidationError(`Unsupported request field type for bizParams.${fieldName}.`, {
        stage,
        details: {
          fieldName,
          type: rule.type || null
        }
      });
  }
}

function hasUsableFileObject(value) {
  return isObject(value) &&
    typeof value.fileName === "string" &&
    value.fileName.trim() &&
    typeof value.fileContentBase64 === "string" &&
    value.fileContentBase64.trim();
}

function hasUsableFileUrl(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeFileInputPair(definitions, bizParams, normalized, stage) {
  if (!definitions.baseFile || !definitions.baseFileURL) {
    return;
  }

  const hasBaseFile = hasUsableFileObject(bizParams.baseFile);
  const hasBaseFileURL = hasUsableFileUrl(bizParams.baseFileURL);

  if (!hasBaseFile && !hasBaseFileURL) {
    throw buildValidationError("bizParams.baseFile or bizParams.baseFileURL is required.", {
      stage,
      details: {
        oneOf: ["baseFile", "baseFileURL"]
      }
    });
  }

  if (hasBaseFile && Object.prototype.hasOwnProperty.call(normalized, "baseFileURL")) {
    delete normalized.baseFileURL;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, "baseFileURL") && !normalized.baseFileURL) {
    delete normalized.baseFileURL;
  }
}

function validateBizParamsAgainstContract(definitions, bizParams, {
  stage = "request-validate"
} = {}) {
  if (!definitions || typeof definitions !== "object") {
    throw buildValidationError("Request contract must define bizParams.", {
      stage
    });
  }

  if (!bizParams || typeof bizParams !== "object") {
    throw buildValidationError("bizParams is required.", {
      stage
    });
  }

  const normalized = {};

  for (const [fieldName, rule] of Object.entries(definitions)) {
    const rawValue = bizParams[fieldName];

    if (rawValue === undefined || rawValue === null) {
      if (rule.required === false) {
        continue;
      }
      throw buildValidationError(`bizParams.${fieldName} is required.`, {
        stage
      });
    }

    normalized[fieldName] = normalizeBizParamByRule(fieldName, rawValue, rule, stage);
  }

  normalizeFileInputPair(definitions, bizParams, normalized, stage);

  return normalized;
}

function validateSceneBizParams(sceneConfig, bizParams, options = {}) {
  return validateBizParamsAgainstContract(sceneConfig?.request?.bizParams, bizParams, options);
}

module.exports = {
  DEFAULT_ALLOWED_CONTRACT_EXTENSIONS,
  normalizeOpportunityId,
  normalizeBase64FileField,
  normalizeFileObjectField,
  normalizeFileUrlField,
  normalizeFileNameField,
  normalizeStringField,
  normalizeBizParamByRule,
  validateBizParamsAgainstContract,
  validateSceneBizParams
};
