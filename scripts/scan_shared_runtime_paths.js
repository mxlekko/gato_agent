#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { RETIRED_AGENT_SHARED_HOME_PATTERN } = require("../utils/retired-runtime-markers");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_TARGETS = ["scene-configs", "platform", "services", "deploy"];
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "tmp", "shared-runtime-paths-report.json");
const SCAN_EXTENSIONS = new Set([".json", ".js", ".cjs", ".mjs", ".yaml", ".yml", ".plist", ".sh"]);

const RULES = [
  {
    id: "legacy-project-path",
    label: "Legacy project path",
    pattern: /\/Users\/gato-pm\/Desktop\/API(?!_)[^\s"'`,)]*/g,
    riskLevel: "critical",
    reason: "运行时仍依赖旧项目目录，副本迁移后容易串到旧仓。"
  },
  {
    id: "shared-legacy-agent-path",
    label: "Shared legacy agent path",
    pattern: RETIRED_AGENT_SHARED_HOME_PATTERN,
    riskLevel: "high",
    reason: "运行时仍依赖共享旧 agent 目录，副本无法真正自闭环。"
  }
];

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

function shouldScanFile(filePath) {
  return SCAN_EXTENSIONS.has(path.extname(filePath));
}

function walkFiles(targetPath, files = []) {
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });

  for (const entry of entries) {
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

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const findings = [];

  lines.forEach((line, index) => {
    for (const rule of RULES) {
      const matches = [...line.matchAll(rule.pattern)];

      for (const match of matches) {
        findings.push({
          ruleId: rule.id,
          ruleLabel: rule.label,
          riskLevel: rule.riskLevel,
          reason: rule.reason,
          file: path.relative(ROOT_DIR, filePath),
          absoluteFile: filePath,
          line: index + 1,
          column: (match.index || 0) + 1,
          match: match[0],
          lineText: line.trim()
        });
      }
    }
  });

  return findings;
}

function summarizeFindings(findings) {
  return {
    totalFindings: findings.length,
    filesWithFindings: new Set(findings.map((item) => item.file)).size,
    byRule: RULES.map((rule) => ({
      ruleId: rule.id,
      riskLevel: rule.riskLevel,
      count: findings.filter((item) => item.ruleId === rule.id).length
    })).filter((item) => item.count > 0),
    byRiskLevel: ["critical", "high", "medium", "low"]
      .map((riskLevel) => ({
        riskLevel,
        count: findings.filter((item) => item.riskLevel === riskLevel).length
      }))
      .filter((item) => item.count > 0)
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  const targetDirs = String(args.targets || DEFAULT_TARGETS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(ROOT_DIR, item));
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT);

  const missingTargets = targetDirs.filter((targetPath) => !fs.existsSync(targetPath));
  if (missingTargets.length > 0) {
    throw new Error(`Scan targets not found: ${missingTargets.join(", ")}`);
  }

  const files = targetDirs.flatMap((targetPath) => walkFiles(targetPath));
  const findings = files.flatMap((filePath) => scanFile(filePath));
  const report = {
    reportType: "shared-runtime-path-baseline",
    observedAt: new Date().toISOString(),
    rootDir: ROOT_DIR,
    scannedTargets: targetDirs.map((targetPath) => path.relative(ROOT_DIR, targetPath)),
    scannedFileCount: files.length,
    summary: summarizeFindings(findings),
    findings
  };

  writeJson(outputPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
