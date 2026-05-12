const fs = require("fs");
const path = require("path");

const SENSITIVE_KEYS = new Set([
  "authorization",
  "password",
  "token",
  "secret",
  "sqlserver_password"
]);

const LARGE_PAYLOAD_KEYS = new Set([
  "rawresponse",
  "jsonblock",
  "body",
  "messages",
  "message",
  "content"
]);

const FILE_LOG_ERROR_LIMIT = 3;
let fileLogErrorCount = 0;

function resolveFileLogPath(level) {
  const levelSpecificEnv = level === "error"
    ? process.env.APP_LOG_STDERR_FILE
    : process.env.APP_LOG_STDOUT_FILE;
  const filePath = String(levelSpecificEnv || process.env.APP_LOG_FILE || "").trim();

  return filePath || null;
}

function appendFileLog(level, line) {
  const filePath = resolveFileLogPath(level);
  if (!filePath) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(filePath), {
      recursive: true
    });
    fs.appendFileSync(filePath, `${line}\n`, "utf8");
  } catch (error) {
    if (fileLogErrorCount >= FILE_LOG_ERROR_LIMIT) {
      return;
    }

    fileLogErrorCount += 1;
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        message: "logger.file_append_failed",
        context: {
          filePath,
          cause: error.message
        }
      }) + "\n"
    );
  }
}

function sanitizeString(value, key) {
  const lowerKey = key.toLowerCase();

  if (SENSITIVE_KEYS.has(lowerKey)) {
    return "[REDACTED]";
  }

  if (value.includes("<<<SALES_OPPORTUNITY_ADVISOR_")) {
    return `[REDACTED_MARKED_BLOCK length=${value.length}]`;
  }

  if (LARGE_PAYLOAD_KEYS.has(lowerKey) && value.length > 120) {
    return `[REDACTED_TEXT length=${value.length}]`;
  }

  return value;
}

function sanitizeForLog(value, key = "") {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeString(value, key);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, key));
  }

  if (typeof value === "object") {
    if (key.toLowerCase() === "rawrow") {
      return {
        __redacted: "[REDACTED_RAW_ROW]",
        fields: Object.keys(value)
      };
    }

    const sanitized = {};

    for (const [childKey, childValue] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(childKey.toLowerCase())) {
        sanitized[childKey] = "[REDACTED]";
        continue;
      }

      sanitized[childKey] = sanitizeForLog(childValue, childKey);
    }

    return sanitized;
  }

  return String(value);
}

function write(level, message, context = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    context: sanitizeForLog(context)
  };

  const line = JSON.stringify(entry);
  appendFileLog(level, line);

  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

function info(message, context) {
  write("info", message, context);
}

function error(message, context) {
  write("error", message, context);
}

module.exports = {
  sanitizeForLog,
  info,
  error
};
