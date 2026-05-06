#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  RETIRED_AGENT_RUNTIME_TOKEN,
  RETIRED_AGENT_RUNTIME_TITLE,
  RETIRED_AGENT_RUNTIME_UPPER,
  RETIRED_AGENT_GATEWAY_PORT,
  RETIRED_AGENT_RUNTIME_URI_PREFIX,
  RETIRED_AGENT_RUNTIME_ASSET_PREFIX,
  RETIRED_AGENT_SHARED_HOME,
  literalPattern
} = require("../utils/retired-runtime-markers");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_TARGETS = [
  "services",
  "platform",
  "scene-configs",
  "scripts",
  "tests",
  "docs",
  "server.js",
  "package.json"
];
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "tmp", "retired-runtime-dependencies-report.json");
const SCAN_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".txt",
  ".tsv",
  ".py",
  ".sh"
]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".venv",
  "dist",
  "build",
  ".next",
  ".cache"
]);

const KEYWORDS = [
  {
    id: "legacy-agent-token-lower",
    pattern: literalPattern(RETIRED_AGENT_RUNTIME_TOKEN)
  },
  {
    id: "legacy-agent-token-title",
    pattern: literalPattern(RETIRED_AGENT_RUNTIME_TITLE)
  },
  {
    id: "legacy-agent-token-upper",
    pattern: literalPattern(RETIRED_AGENT_RUNTIME_UPPER)
  },
  {
    id: "legacy-gateway-port",
    pattern: literalPattern(RETIRED_AGENT_GATEWAY_PORT)
  },
  {
    id: "legacy-runtime-uri",
    pattern: literalPattern(RETIRED_AGENT_RUNTIME_URI_PREFIX)
  },
  {
    id: "legacy-shared-dir",
    pattern: literalPattern(path.basename(RETIRED_AGENT_SHARED_HOME))
  },
  {
    id: "sales-agent-model",
    pattern: literalPattern(`${RETIRED_AGENT_RUNTIME_TOKEN}/sales-agent`)
  }
];

const LEGACY_RUNTIME_TOKEN_PATTERN = literalPattern(RETIRED_AGENT_RUNTIME_TOKEN, "i");
const LEGACY_GATEWAY_PORT_PATTERN = literalPattern(RETIRED_AGENT_GATEWAY_PORT);
const LEGACY_GATEWAY_MODEL_PATTERN = literalPattern(`${RETIRED_AGENT_RUNTIME_TOKEN}/sales-agent`);
const LEGACY_LLM_TOOL_PATTERN = literalPattern(`tool://llm/${RETIRED_AGENT_RUNTIME_TOKEN}`);
const LEGACY_RUNTIME_URI_PATTERN = literalPattern(RETIRED_AGENT_RUNTIME_URI_PREFIX);
const LEGACY_RUNTIME_ASSET_PATTERN = literalPattern(RETIRED_AGENT_RUNTIME_ASSET_PREFIX);
const LEGACY_GATEWAY_TOKEN_ENV_PATTERN = literalPattern(`${RETIRED_AGENT_RUNTIME_UPPER}_GATEWAY_TOKEN`);

function testPattern(pattern, lineText) {
  pattern.lastIndex = 0;
  return pattern.test(lineText);
}

function matchesAny(lineText, patterns) {
  return patterns.some((pattern) => testPattern(pattern, lineText));
}

const CATEGORY_ORDER = [
  "runtime-blocker",
  "config-blocker",
  "asset-namespace",
  "documentation"
];

const WORK_ITEM_BY_CATEGORY = {
  "runtime-blocker": "AG-08/AG-09",
  "config-blocker": "AG-01/AG-02/AG-03/AG-04/AG-05/AG-06",
  "asset-namespace": "AG-10",
  documentation: "AG-07"
};

function parseArgs(argv) {
  const args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function normalizeTargetList(rawValue) {
  return String(rawValue || DEFAULT_TARGETS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function shouldScanFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  if (fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const extension = path.extname(filePath);
  if (!extension && path.basename(filePath) === "package.json") {
    return true;
  }

  return SCAN_EXTENSIONS.has(extension);
}

function walkFiles(targetPath, files = []) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    if (shouldScanFile(targetPath)) {
      files.push(targetPath);
    }
    return files;
  }

  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
      continue;
    }

    if (entry.isFile() && shouldScanFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function isDocumentationFile(relativeFile) {
  return relativeFile.startsWith("docs/")
    || relativeFile.startsWith("tests/regression/output/")
    || relativeFile.startsWith("tests/fixtures/")
    || /^scripts\/generate_.*\.(py|js)$/.test(relativeFile)
    || relativeFile === "scene-configs/README.md"
    || relativeFile === "platform/tools/README.md";
}

function isRuntimeBlocker(relativeFile, lineText) {
  if (relativeFile === "services/runtime-message.js") {
    return true;
  }

  if (relativeFile === "services/runtime.js") {
    return matchesAny(lineText, [
      /Gateway|gateway/,
      LEGACY_RUNTIME_TOKEN_PATTERN,
      /\/v1\/chat\/completions/,
      /127\.0\.0\.1/
    ]);
  }

  if (relativeFile === "server.js") {
    return matchesAny(lineText, [/GATEWAY|Gateway/, LEGACY_RUNTIME_TOKEN_PATTERN, LEGACY_GATEWAY_PORT_PATTERN]);
  }

  if (relativeFile === "scripts/bootstrap_local_runtime.js") {
    return matchesAny(lineText, [LEGACY_GATEWAY_TOKEN_ENV_PATTERN, LEGACY_RUNTIME_TOKEN_PATTERN, LEGACY_GATEWAY_PORT_PATTERN]);
  }

  return false;
}

function isConfigBlocker(relativeFile, lineText) {
  if (/^scene-configs\/.+\.json$/.test(relativeFile)) {
    return matchesAny(lineText, [/gatewayModel|workspacePath|entryFile|fallbackModelsFile/, LEGACY_GATEWAY_MODEL_PATTERN]);
  }

  if (/^platform\/skills\/.+\.ya?ml$/.test(relativeFile)) {
    return matchesAny(lineText, [LEGACY_LLM_TOOL_PATTERN, LEGACY_RUNTIME_URI_PATTERN, LEGACY_RUNTIME_ASSET_PATTERN]);
  }

  if (/^platform\/tools\/.+\.ya?ml$/.test(relativeFile)) {
    return matchesAny(lineText, [
      LEGACY_LLM_TOOL_PATTERN,
      new RegExp(`runtimeRef:\\s*${RETIRED_AGENT_RUNTIME_TOKEN}`),
      LEGACY_RUNTIME_TOKEN_PATTERN,
      LEGACY_GATEWAY_MODEL_PATTERN
    ]);
  }

  return false;
}

function isAssetNamespace(relativeFile, lineText) {
  if (matchesAny(lineText, [LEGACY_RUNTIME_URI_PATTERN, LEGACY_RUNTIME_ASSET_PATTERN])) {
    return true;
  }

  if (/^scripts\/verify_/.test(relativeFile) && testPattern(LEGACY_RUNTIME_TOKEN_PATTERN, lineText)) {
    return true;
  }

  if (relativeFile === "scripts/run_self_contained_regression.js" && testPattern(LEGACY_RUNTIME_ASSET_PATTERN, lineText)) {
    return true;
  }

  if (relativeFile === "scripts/check_project_structure.js" && testPattern(LEGACY_RUNTIME_ASSET_PATTERN, lineText)) {
    return true;
  }

  return false;
}

function classifyFinding(relativeFile, lineText) {
  if (isRuntimeBlocker(relativeFile, lineText)) {
    return "runtime-blocker";
  }

  if (isConfigBlocker(relativeFile, lineText)) {
    return "config-blocker";
  }

  if (isAssetNamespace(relativeFile, lineText)) {
    return "asset-namespace";
  }

  if (isDocumentationFile(relativeFile)) {
    return "documentation";
  }

  return "documentation";
}

function findKeywordMatches(lineText) {
  const matches = [];

  for (const keyword of KEYWORDS) {
    keyword.pattern.lastIndex = 0;
    const lineMatches = [...lineText.matchAll(keyword.pattern)];
    for (const match of lineMatches) {
      matches.push({
        keyword: keyword.id,
        match: match[0],
        column: (match.index || 0) + 1
      });
    }
  }

  return matches;
}

function scanFile(filePath) {
  const relativeFile = path.relative(ROOT_DIR, filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const findings = [];

  lines.forEach((lineText, index) => {
    const matches = findKeywordMatches(lineText);
    if (matches.length === 0) {
      return;
    }

    const category = classifyFinding(relativeFile, lineText);
    findings.push({
      category,
      suggestedWorkItem: WORK_ITEM_BY_CATEGORY[category],
      file: relativeFile,
      absoluteFile: filePath,
      line: index + 1,
      keywords: Array.from(new Set(matches.map((item) => item.keyword))),
      matches: matches.map((item) => ({
        keyword: item.keyword,
        match: item.match,
        column: item.column
      })),
      lineText: lineText.trim()
    });
  });

  return findings;
}

function summarizeFindings(findings) {
  const byCategory = CATEGORY_ORDER.map((category) => ({
    category,
    suggestedWorkItem: WORK_ITEM_BY_CATEGORY[category],
    count: findings.filter((item) => item.category === category).length,
    files: Array.from(new Set(
      findings
        .filter((item) => item.category === category)
        .map((item) => item.file)
    )).sort()
  })).filter((item) => item.count > 0);

  return {
    totalFindings: findings.length,
    filesWithFindings: new Set(findings.map((item) => item.file)).size,
    byCategory,
    byKeyword: KEYWORDS.map((keyword) => ({
      keyword: keyword.id,
      count: findings.filter((finding) => finding.keywords.includes(keyword.id)).length
    })).filter((item) => item.count > 0)
  };
}

function getCategoryCount(summary, category) {
  return summary.byCategory.find((item) => item.category === category)?.count || 0;
}

function resolveFailingCategories(summary, args) {
  const failOnAny = args["fail-on-any"] || args["fail-on-findings"];
  const failOnBlocker = args["fail-on-blocker"] || args["fail-on-blockers"];
  const flagByCategory = {
    "runtime-blocker": args["fail-on-runtime-blocker"] || failOnBlocker || failOnAny,
    "config-blocker": args["fail-on-config-blocker"] || failOnBlocker || failOnAny,
    "asset-namespace": args["fail-on-asset-namespace"] || failOnAny,
    documentation: args["fail-on-documentation"] || failOnAny
  };

  return CATEGORY_ORDER
    .filter((category) => flagByCategory[category])
    .map((category) => ({
      category,
      count: getCategoryCount(summary, category)
    }))
    .filter((item) => item.count > 0);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  const targetNames = normalizeTargetList(args.targets);
  const targetPaths = targetNames.map((target) => path.resolve(ROOT_DIR, target));
  const missingTargets = targetPaths.filter((targetPath) => !fs.existsSync(targetPath));
  if (missingTargets.length > 0) {
    throw new Error(`Scan targets not found: ${missingTargets.join(", ")}`);
  }

  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT);
  const files = Array.from(new Set(targetPaths.flatMap((targetPath) => walkFiles(targetPath)))).sort();
  const findings = files.flatMap((filePath) => scanFile(filePath));
  const report = {
    reportType: "retired-runtime-dependency-scan",
    observedAt: new Date().toISOString(),
    rootDir: ROOT_DIR,
    scannedTargets: targetNames,
    scannedFileCount: files.length,
    keywords: KEYWORDS.map((item) => item.id),
    categories: CATEGORY_ORDER.map((category) => ({
      category,
      suggestedWorkItem: WORK_ITEM_BY_CATEGORY[category]
    })),
    summary: summarizeFindings(findings),
    findings
  };

  writeJson(outputPath, report);
  const outputPayload = (args["print-findings"] || args.full)
    ? report
    : {
        reportType: report.reportType,
        observedAt: report.observedAt,
        rootDir: report.rootDir,
        reportFile: outputPath,
        scannedTargets: report.scannedTargets,
        scannedFileCount: report.scannedFileCount,
        summary: report.summary
      };
  process.stdout.write(`${JSON.stringify(outputPayload, null, 2)}\n`);

  const failingCategories = resolveFailingCategories(report.summary, args);
  if (failingCategories.length > 0) {
    process.stderr.write(`RetiredRuntime dependency scan failed: ${failingCategories.map((item) => `${item.category}=${item.count}`).join(", ")}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  }
}
