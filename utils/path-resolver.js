const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = path.join(PROJECT_ROOT, "runtime-assets");
const PROJECT_PREFIX = "project://";
const RUNTIME_PREFIX = "runtime://";
const CANONICAL_RUNTIME_NAMESPACE = "project-runtime";
const RUNTIME_NAMESPACE_TO_DIRECTORY = Object.freeze({
  [CANONICAL_RUNTIME_NAMESPACE]: CANONICAL_RUNTIME_NAMESPACE
});

const LEGACY_RULES = [
  {
    code: "legacy-project-path",
    riskLevel: "critical",
    prefix: "/Users/gato-pm/Desktop/API",
    message: "Path still points to the legacy project directory."
  },
  {
    code: "shared-openclaw-path",
    riskLevel: "high",
    prefix: "/Users/gato-pm/.openclaw",
    message: "Path still points to the shared OpenClaw directory."
  }
];

function buildWarning(rule, original, resolvedPath) {
  return {
    code: rule.code,
    riskLevel: rule.riskLevel,
    original,
    resolvedPath,
    message: rule.message
  };
}

function normalizeSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

function isAbsolutePath(value) {
  return path.isAbsolute(String(value || ""));
}

function resolveProjectPath(reference, projectRoot) {
  const relativePath = reference.slice(PROJECT_PREFIX.length);
  return path.resolve(projectRoot, relativePath);
}

function resolveRuntimePath(reference, runtimeRoot) {
  const relativePath = reference.slice(RUNTIME_PREFIX.length);
  const [namespace, ...segments] = relativePath.split("/").filter(Boolean);

  if (!namespace) {
    throw new Error(`Invalid runtime path reference: ${reference}`);
  }

  const directoryName = RUNTIME_NAMESPACE_TO_DIRECTORY[namespace];
  if (!directoryName) {
    throw new Error(`Unsupported runtime namespace: ${namespace}`);
  }

  return path.resolve(runtimeRoot, directoryName, segments.join("/"));
}

function collectLegacyWarnings(original, resolvedPath) {
  const normalized = normalizeSlashes(resolvedPath);

  return LEGACY_RULES
    .filter((rule) => normalized === rule.prefix || normalized.startsWith(`${rule.prefix}/`))
    .map((rule) => buildWarning(rule, original, resolvedPath));
}

function resolvePathReference(reference, options = {}) {
  if (typeof reference !== "string" || reference.trim().length === 0) {
    throw new Error("Path reference must be a non-empty string.");
  }

  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const runtimeRoot = options.runtimeRoot || RUNTIME_ROOT;
  const trimmed = reference.trim();

  let sourceType = "relative";
  let resolvedPath;

  if (trimmed.startsWith(PROJECT_PREFIX)) {
    sourceType = "project";
    resolvedPath = resolveProjectPath(trimmed, projectRoot);
  } else if (trimmed.startsWith(RUNTIME_PREFIX)) {
    sourceType = "runtime";
    resolvedPath = resolveRuntimePath(trimmed, runtimeRoot);
  } else if (isAbsolutePath(trimmed)) {
    sourceType = "absolute";
    resolvedPath = path.normalize(trimmed);
  } else {
    resolvedPath = path.resolve(projectRoot, trimmed);
  }

  const warnings = collectLegacyWarnings(trimmed, resolvedPath);
  const onWarning = typeof options.onWarning === "function" ? options.onWarning : null;

  if (onWarning) {
    warnings.forEach((warning) => onWarning(warning));
  }

  return {
    original: trimmed,
    resolvedPath,
    sourceType,
    warnings
  };
}

function resolvePathList(references, options = {}) {
  if (!Array.isArray(references)) {
    throw new Error("Path reference list must be an array.");
  }

  return references.map((reference) => resolvePathReference(reference, options));
}

module.exports = {
  PROJECT_ROOT,
  RUNTIME_ROOT,
  PROJECT_PREFIX,
  RUNTIME_PREFIX,
  CANONICAL_RUNTIME_NAMESPACE,
  RUNTIME_NAMESPACE_TO_DIRECTORY,
  resolvePathReference,
  resolvePathList
};
