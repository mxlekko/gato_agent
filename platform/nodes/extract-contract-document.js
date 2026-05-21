const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createAppError, normalizeError } = require("../../utils/errors");
const { PROJECT_ROOT } = require("../../utils/path-resolver");
const { mergeWorkflowState, recordNodeRun } = require("../runtime/state");

const NODE_ID = "extract-contract-document";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_CHARS = 30000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15000;
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStateError(error) {
  return {
    code: error.code,
    message: error.message,
    httpStatus: error.httpStatus,
    stage: error.stage,
    retryable: error.retryable,
    details: error.details || null
  };
}

function resolvePythonExecutable() {
  const configured = String(process.env.CONTRACT_DOCUMENT_PYTHON || "").trim();
  if (configured) {
    return configured;
  }

  const ragVenvPython = path.join(PROJECT_ROOT, "rag-service", ".venv", "bin", "python");
  if (fs.existsSync(ragVenvPython)) {
    return ragVenvPython;
  }

  return "python3";
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function extractFileExtension(fileName) {
  const index = String(fileName || "").lastIndexOf(".");
  return index >= 0 ? String(fileName).slice(index).toLowerCase() : "";
}

function fileExtensionForMimeType(mimeType) {
  const normalized = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (normalized === "image/bmp" || normalized === "image/x-ms-bmp") {
    return ".bmp";
  }
  if (normalized === "image/jpeg") {
    return ".jpg";
  }
  if (normalized === "image/png") {
    return ".png";
  }
  if (normalized === "image/tiff") {
    return ".tif";
  }
  if (normalized === "application/msword") {
    return ".doc";
  }
  if (normalized === "application/pdf") {
    return ".pdf";
  }
  if (normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return ".docx";
  }
  if (normalized === "application/vnd.ms-works" || normalized === "application/kswps") {
    return ".wps";
  }
  if (normalized === "application/ofd") {
    return ".ofd";
  }
  if (normalized === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return ".xlsx";
  }
  return "";
}

function sanitizeDownloadedFileName(fileName, mimeType) {
  const raw = String(fileName || "").trim();
  const baseName = raw.split(/[\\/]/u).filter(Boolean).pop() || "downloaded-contract";
  const extension = extractFileExtension(baseName) || fileExtensionForMimeType(mimeType);
  if (extractFileExtension(baseName) || !extension) {
    return baseName;
  }
  return `${baseName}${extension}`;
}

function parseContentDispositionFileName(value) {
  const raw = String(value || "");
  const filenameStarMatch = raw.match(/(?:^|;)\s*filename\*=UTF-8''([^;]+)/i);
  if (filenameStarMatch) {
    try {
      return decodeURIComponent(filenameStarMatch[1].trim().replace(/^"|"$/gu, ""));
    } catch {
      return filenameStarMatch[1].trim().replace(/^"|"$/gu, "");
    }
  }

  const filenameMatch = raw.match(/(?:^|;)\s*filename=(?:"([^"]*)"|([^;]+))/i);
  return filenameMatch ? String(filenameMatch[1] || filenameMatch[2] || "").trim() : "";
}

function fileNameFromUrl(value) {
  try {
    const parsed = new URL(value);
    const pathName = decodeURIComponent(parsed.pathname || "");
    return path.basename(pathName);
  } catch {
    return "";
  }
}

async function downloadBaseFileURL(baseFileURL, {
  timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_FILE_BYTES
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(baseFileURL, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      throw createAppError("DOCUMENT_FETCH_FAILED", "baseFileURL download failed.", {
        stage: "extract-contract-document",
        httpStatus: 400,
        details: {
          status: response.status
        }
      });
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maxBytes) {
      throw createAppError("INVALID_REQUEST", "baseFileURL file is too large.", {
        stage: "extract-contract-document",
        details: {
          maxBytes,
          actualBytes: declaredLength
        }
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > maxBytes) {
      throw createAppError("INVALID_REQUEST", "baseFileURL file is too large.", {
        stage: "extract-contract-document",
        details: {
          maxBytes,
          actualBytes: buffer.length
        }
      });
    }

    const mimeType = String(response.headers.get("content-type") || "").trim();
    const dispositionFileName = parseContentDispositionFileName(response.headers.get("content-disposition"));
    const fileName = sanitizeDownloadedFileName(dispositionFileName || fileNameFromUrl(baseFileURL), mimeType);

    return {
      fileName,
      fileContentBase64: buffer.toString("base64"),
      fileMimeType: mimeType,
      source: "baseFileURL"
    };
  } catch (error) {
    if (error?.code) {
      throw error;
    }
    throw createAppError("DOCUMENT_FETCH_FAILED", "baseFileURL download failed.", {
      stage: "extract-contract-document",
      httpStatus: 400,
      details: {
        cause: error?.name === "AbortError" ? "timeout" : error?.message || "request_failed"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveContractDocumentInput(bizParams = {}) {
  if (isObject(bizParams.baseFile)) {
    return {
      fileName: bizParams.baseFile.fileName,
      fileContentBase64: bizParams.baseFile.fileContentBase64,
      fileMimeType: bizParams.baseFile.fileMimeType || "",
      source: "baseFile"
    };
  }

  if (bizParams.fileName && bizParams.fileContentBase64) {
    return {
      fileName: bizParams.fileName,
      fileContentBase64: bizParams.fileContentBase64,
      fileMimeType: bizParams.fileMimeType || "",
      source: "legacyBase64"
    };
  }

  if (typeof bizParams.baseFileURL === "string" && bizParams.baseFileURL.trim()) {
    return downloadBaseFileURL(bizParams.baseFileURL.trim(), {
      timeoutMs: parsePositiveInteger(
        process.env.CONTRACT_DOCUMENT_DOWNLOAD_TIMEOUT_MS,
        DEFAULT_DOWNLOAD_TIMEOUT_MS
      ),
      maxBytes: parsePositiveInteger(
        process.env.CONTRACT_REVIEW_MAX_FILE_BYTES,
        DEFAULT_MAX_FILE_BYTES
      )
    });
  }

  throw createAppError("INVALID_REQUEST", "Contract document parser requires baseFile or baseFileURL.", {
    stage: "extract-contract-document"
  });
}

function summarizeInput(state) {
  const bizParams = state?.request?.normalized?.biz_params || state?.request?.biz_params || {};
  const baseFile = isObject(bizParams.baseFile) ? bizParams.baseFile : null;
  return {
    scene: state?.request?.scene || null,
    fileName: baseFile?.fileName || bizParams.fileName || null,
    hasBaseFile: Boolean(baseFile),
    hasBaseFileURL: typeof bizParams.baseFileURL === "string" && bizParams.baseFileURL.trim().length > 0,
    hasFileContentBase64: typeof bizParams.fileContentBase64 === "string" && bizParams.fileContentBase64.length > 0
  };
}

function runParserProcess({
  fileName,
  fileContentBase64,
  timeoutMs,
  maxChars
} = {}) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(PROJECT_ROOT, "scripts", "extract_contract_document_text.py");
    const child = spawn(resolvePythonExecutable(), [scriptPath], {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(createAppError("RUNTIME_TIMEOUT", "Contract document parser timed out.", {
          stage: "extract-contract-document",
          details: {
            timeoutMs
          }
        }));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(createAppError("DOCUMENT_PARSE_FAILED", "Contract document parser failed to start.", {
          stage: "extract-contract-document",
          details: {
            cause: error?.message || "spawn_failed"
          }
        }));
      }
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);

      let payload = null;
      try {
        payload = JSON.parse(stdout.trim() || "{}");
      } catch {
        reject(createAppError("RUNTIME_INVALID_RESPONSE", "Contract document parser returned invalid JSON.", {
          stage: "extract-contract-document",
          details: {
            exitCode: code,
            stderr: stderr.slice(0, 1000),
            stdout: stdout.slice(0, 1000)
          }
        }));
        return;
      }

      if (code !== 0 || payload?.success === false) {
        reject(createAppError("DOCUMENT_PARSE_FAILED", payload?.error?.message || "Contract document parsing failed.", {
          stage: "extract-contract-document",
          details: {
            exitCode: code,
            stderr: stderr.slice(0, 1000)
          }
        }));
        return;
      }

      resolve(payload);
    });

    child.stdin.end(JSON.stringify({
      fileName,
      fileContentBase64,
      maxChars
    }));
  });
}

function summarizeOutput(document) {
  return {
    fileName: document?.fileName || null,
    sourceType: document?.sourceType || null,
    charCount: document?.charCount || 0,
    blockCount: document?.blockCount || 0,
    warningCount: Array.isArray(document?.warnings) ? document.warnings.length : 0
  };
}

async function runExtractContractDocumentNode({
  state,
  timeoutMs = null,
  maxChars = null
} = {}) {
  const startedAt = new Date();
  const startMs = Date.now();
  const inputSummary = summarizeInput(state);

  try {
    const bizParams = state?.request?.normalized?.biz_params || state?.request?.biz_params || {};
    const contractDocumentInput = await resolveContractDocumentInput(bizParams);

    const parserPayload = await runParserProcess({
      fileName: contractDocumentInput.fileName,
      fileContentBase64: contractDocumentInput.fileContentBase64,
      timeoutMs: parsePositiveInteger(timeoutMs || process.env.CONTRACT_DOCUMENT_PARSE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
      maxChars: parsePositiveInteger(maxChars || process.env.CONTRACT_DOCUMENT_MAX_CHARS, DEFAULT_MAX_CHARS)
    });
    const document = parserPayload?.data;
    if (!isObject(document) || typeof document.text !== "string" || !document.text.trim()) {
      throw createAppError("DOCUMENT_PARSE_FAILED", "Contract document parser did not return readable text.", {
        stage: "extract-contract-document"
      });
    }

    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "success",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      outputSummary: summarizeOutput(document)
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        document,
        outputs: {
          extract_contract_document: {
            extracted: true,
            ...summarizeOutput(document)
          }
        }
      },
      error: null
    });

    return nextState;
  } catch (error) {
    const normalized = normalizeError(error);
    let nextState = recordNodeRun(state, {
      nodeId: NODE_ID,
      status: "error",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      inputSummary,
      error: {
        code: normalized.code,
        message: normalized.message,
        httpStatus: normalized.httpStatus,
        stage: normalized.stage,
        details: normalized.details || null
      }
    });

    nextState = mergeWorkflowState(nextState, {
      artifacts: {
        outputs: {
          extract_contract_document: {
            extracted: false,
            error_code: normalized.code
          }
        }
      },
      result: null,
      error: toStateError(normalized)
    });

    return nextState;
  }
}

module.exports = {
  NODE_ID,
  runExtractContractDocumentNode
};
