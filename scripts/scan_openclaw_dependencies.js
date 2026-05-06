#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

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
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "tmp", "openclaw-dependencies-report.json");
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
    id: "openclaw-lower",
    pattern: /openclaw/g
  },
  {
    id: "OpenClaw-title",
    pattern: /OpenClaw/g
  },
  {
    id: "OPENCLAW-upper",
    pattern: /OPENCLAW/g
  },
  {
    id: "gateway-port-18789",
    pattern: /18789/g
  },
  {
    id: "runtime-openclaw-uri",
    pattern: /runtime:\/\/openclaw/g
  },
  {
    id: "shared-openclaw-dir",
    pattern: /\.openclaw/g
  },
  {
    id: "sales-agent-model",
    pattern: /openclaw\/sales-agent/g
  }
];

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
    return /Gateway|gateway|openclaw|OPENCLAW|\/v1\/chat\/completions|127\.0\.0\.1/.test(lineText);
  }

  if (relativeFile === "server.js") {
    return /GATEWAY|Gateway|OPENCLAW|18789/.test(lineText);
  }

  if (relativeFile === "scripts/bootstrap_local_runtime.js") {
    return /OPENCLAW_GATEWAY_TOKEN|OpenClaw Gateway|18789/.test(lineText);
  }

  return false;
}

function isConfigBlocker(relativeFile, lineText) {
  if (/^scene-configs\/.+\.json$/.test(relativeFile)) {
    return /gatewayModel|openclaw\/sales-agent|workspacePath|entryFile|fallbackModelsFile/.test(lineText);
  }

  if (/^platform\/skills\/.+\.ya?ml$/.test(relativeFile)) {
    return /tool:\/\/llm\/openclaw|runtime:\/\/openclaw|runtime-assets\/openclaw/.test(lineText);
  }

  if (/^platform\/tools\/.+\.ya?ml$/.test(relativeFile)) {
    return /tool:\/\/llm\/openclaw|runtimeRef:\s*openclaw|OpenClaw|openclaw\/sales-agent/.test(lineText);
  }

  return false;
}

function isAssetNamespace(relativeFile, lineText) {
  if (/runtime:\/\/openclaw|runtime-assets\/openclaw/.test(lineText)) {
    return true;
  }

  if (/^scripts\/verify_/.test(relativeFile) && /openclaw/.test(lineText)) {
    return true;
  }

  if (relativeFile === "scripts/run_self_contained_regression.js" && /runtime-assets\/openclaw/.test(lineText)) {
    return true;
  }

  if (relativeFile === "scripts/check_project_structure.js" && /runtime-assets\/openclaw/.test(lineText)) {
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
    reportType: "openclaw-dependency-scan",
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
    process.stderr.write(`OpenClaw dependency scan failed: ${failingCategories.map((item) => `${item.category}=${item.count}`).join(", ")}\n`);
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
