#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_MANIFEST = path.join(ROOT_DIR, "tests", "fixtures", "self-contained", "manifest.json");
const DEFAULT_SCAN_SCRIPT = path.join(ROOT_DIR, "scripts", "scan_shared_runtime_paths.js");
const DEFAULT_RETIRED_RUNTIME_SCAN_SCRIPT = path.join(ROOT_DIR, "scripts", "scan_retired_runtime_dependencies.js");
const DEFAULT_SCAN_TARGETS = [
  "scene-configs",
  "platform",
  "services",
  "deploy",
  "runtime-assets"
];
const DEFAULT_NO_RETIRED_RUNTIME_SCAN_TARGETS = [
  "services",
  "platform",
  "scene-configs",
  "routes",
  "server.js",
  "scripts/bootstrap_local_runtime.js",
  "package.json"
];
const DEFAULT_NO_RETIRED_RUNTIME_LOG_FILES = [
  path.join(ROOT_DIR, "logs", "api.stdout.log"),
  path.join(ROOT_DIR, "logs", "api.stderr.log")
];
const NO_RETIRED_RUNTIME_FORBIDDEN_LOG_PATTERNS = [
  /gateway-http/i,
  /RetiredRuntime Gateway request timed out/i
];
const API_BASE_URL = process.env.SELF_CONTAINED_API_BASE_URL || "http://127.0.0.1:3100";
const MODEL_TOOL_BASE_URL = process.env.SELF_CONTAINED_MODEL_TOOL_BASE_URL || "http://127.0.0.1:19103";
const CONTEXT_HELPER_BASE_URL = process.env.SELF_CONTAINED_CONTEXT_HELPER_BASE_URL || "http://127.0.0.1:19101";
const DIRECTDB_RUNNER_BASE_URL = process.env.SELF_CONTAINED_DIRECTDB_RUNNER_BASE_URL || "http://127.0.0.1:19102";
const REQUEST_TIMEOUT_MS = Number(process.env.SELF_CONTAINED_TIMEOUT_MS || 130000);

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

function parseBooleanValue(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function getPathValue(target, dottedPath) {
  return String(dottedPath || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, segment) => (current == null ? undefined : current[segment]), target);
}

function resolveRouteTarget(route) {
  const [method, pathname] = String(route || "").split(" ");
  if (!method || !pathname) {
    throw new Error(`Invalid route definition: ${route}`);
  }

  if (pathname.startsWith("/api/")) {
    return { method, url: `${API_BASE_URL}${pathname}` };
  }

  if (pathname.startsWith("/internal/model/")) {
    return { method, url: `${MODEL_TOOL_BASE_URL}${pathname}` };
  }

  if (pathname.startsWith("/internal/context/")) {
    return { method, url: `${CONTEXT_HELPER_BASE_URL}${pathname}` };
  }

  if (pathname.startsWith("/internal/directdb/")) {
    return { method, url: `${DIRECTDB_RUNNER_BASE_URL}${pathname}` };
  }

  throw new Error(`Unsupported route target: ${route}`);
}

async function invokeJsonRoute(route, body) {
  const target = resolveRouteTarget(route);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(target.url, {
      method: target.method,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const rawText = await response.text();
    let json;
    try {
      json = JSON.parse(rawText);
    } catch {
      throw new Error(`Route ${route} returned invalid JSON: ${rawText}`);
    }

    return {
      status: response.status,
      body: json
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Route ${route} timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function evaluateSuccessExpectation(actual, expectation) {
  const requiredDataFields = Array.isArray(expectation.requiredDataFields) ? expectation.requiredDataFields : [];
  const checks = {
    http2xx: actual.status >= 200 && actual.status < 300,
    envelopeSuccess: actual.body?.success === true,
    requiredDataFieldsPresent: requiredDataFields.every((fieldPath) => getPathValue(actual.body, fieldPath) != null)
  };

  return {
    classification: checks.http2xx && checks.envelopeSuccess && checks.requiredDataFieldsPresent ? "pass" : "fail",
    checks,
    expectationSummary: {
      type: "success",
      requiredDataFields
    }
  };
}

function evaluateExternalWarningExpectation(actual, expectation) {
  const allowedErrorCodes = Array.isArray(expectation.allowedErrorCodes) ? expectation.allowedErrorCodes : [];
  const allowedStages = Array.isArray(expectation.allowedStages) ? expectation.allowedStages : [];
  const allowedHttpStatuses = Array.isArray(expectation.allowedHttpStatuses) ? expectation.allowedHttpStatuses : [];

  const checks = {
    envelopeFailure: actual.body?.success === false,
    allowedErrorCode: allowedErrorCodes.includes(actual.body?.error?.code),
    allowedStage: allowedStages.includes(actual.body?.error?.stage),
    allowedHttpStatus: allowedHttpStatuses.includes(actual.status)
  };

  return {
    classification: checks.envelopeFailure && checks.allowedErrorCode && checks.allowedStage && checks.allowedHttpStatus ? "warning" : "fail",
    checks,
    expectationSummary: {
      type: "external-warning",
      allowedErrorCodes,
      allowedStages,
      allowedHttpStatuses
    }
  };
}

function evaluateSuccessOrExternalWarningExpectation(actual, expectation) {
  const successEvaluation = evaluateSuccessExpectation(actual, expectation);
  if (successEvaluation.classification === "pass") {
    return {
      ...successEvaluation,
      expectationSummary: {
        ...successEvaluation.expectationSummary,
        type: "success-or-external-warning"
      }
    };
  }

  const warningEvaluation = evaluateExternalWarningExpectation(actual, expectation);
  return {
    ...warningEvaluation,
    expectationSummary: {
      ...warningEvaluation.expectationSummary,
      type: "success-or-external-warning",
      requiredDataFields: Array.isArray(expectation.requiredDataFields) ? expectation.requiredDataFields : []
    }
  };
}

function evaluateCaseResult(actual, expectation) {
  if (!expectation || expectation.type === "success") {
    return evaluateSuccessExpectation(actual, expectation || {});
  }

  if (expectation.type === "external-warning") {
    return evaluateExternalWarningExpectation(actual, expectation);
  }

  if (expectation.type === "success-or-external-warning") {
    return evaluateSuccessOrExternalWarningExpectation(actual, expectation);
  }

  throw new Error(`Unsupported expectation type: ${expectation.type}`);
}

function runScan({ scanScriptPath, scanTargets, outputDir }) {
  const outputPath = path.join(outputDir, "scan-report.json");
  execFileSync(process.execPath, [
    scanScriptPath,
    "--targets",
    scanTargets.join(","),
    "--output",
    outputPath
  ], {
    cwd: ROOT_DIR,
    stdio: "pipe"
  });

  return readJson(outputPath);
}

function getCategoryCount(report, category) {
  return report?.summary?.byCategory?.find((item) => item.category === category)?.count || 0;
}

function runNoRetiredRuntimeDependencyScan({ scanScriptPath, scanTargets, outputDir }) {
  const outputPath = path.join(outputDir, "retired-runtime-scan-report.json");
  const args = [
    scanScriptPath,
    "--targets",
    scanTargets.join(","),
    "--output",
    outputPath,
    "--fail-on-runtime-blocker",
    "--fail-on-config-blocker"
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT_DIR,
    encoding: "utf8"
  });
  const report = fs.existsSync(outputPath) ? readJson(outputPath) : null;

  return {
    command: `node ${path.relative(ROOT_DIR, scanScriptPath)} --targets ${scanTargets.join(",")} --fail-on-runtime-blocker --fail-on-config-blocker`,
    status: result.status,
    failed: result.status !== 0,
    reportFile: path.relative(ROOT_DIR, outputPath),
    runtimeBlockers: getCategoryCount(report, "runtime-blocker"),
    configBlockers: getCategoryCount(report, "config-blocker"),
    stderr: String(result.stderr || "").trim() || null
  };
}

function resolvePathList(rawValue, defaults) {
  return String(rawValue || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(ROOT_DIR, item))
    .concat(rawValue ? [] : defaults);
}

function snapshotLogFiles(logFiles) {
  return logFiles.map((filePath) => {
    if (!fs.existsSync(filePath)) {
      return {
        filePath,
        exists: false,
        size: 0
      };
    }

    const stat = fs.statSync(filePath);
    return {
      filePath,
      exists: true,
      size: stat.size
    };
  });
}

function readLogDeltas(snapshots) {
  return snapshots.map((snapshot) => {
    if (!fs.existsSync(snapshot.filePath)) {
      return {
        filePath: snapshot.filePath,
        exists: false,
        text: ""
      };
    }

    const stat = fs.statSync(snapshot.filePath);
    const start = snapshot.exists && stat.size >= snapshot.size ? snapshot.size : 0;
    const fd = fs.openSync(snapshot.filePath, "r");
    try {
      const length = stat.size - start;
      const buffer = Buffer.alloc(Math.max(length, 0));
      if (length > 0) {
        fs.readSync(fd, buffer, 0, length, start);
      }
      return {
        filePath: snapshot.filePath,
        exists: true,
        text: buffer.toString("utf8")
      };
    } finally {
      fs.closeSync(fd);
    }
  });
}

function buildNoRetiredRuntimeLogCheck({ snapshots, requestIds }) {
  const requestIdSet = new Set(requestIds.filter(Boolean));
  const deltas = readLogDeltas(snapshots);
  const checkedFiles = deltas.filter((item) => item.exists).map((item) => path.relative(ROOT_DIR, item.filePath));
  const findings = [];

  for (const delta of deltas) {
    const lines = delta.text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      if (requestIdSet.size > 0 && !Array.from(requestIdSet).some((requestId) => line.includes(requestId))) {
        continue;
      }

      const matchedPattern = NO_RETIRED_RUNTIME_FORBIDDEN_LOG_PATTERNS.find((pattern) => pattern.test(line));
      if (!matchedPattern) {
        continue;
      }

      findings.push({
        file: path.relative(ROOT_DIR, delta.filePath),
        pattern: matchedPattern.source,
        line: line.slice(0, 500)
      });
    }
  }

  return {
    checked: checkedFiles.length > 0,
    checkedFiles,
    requestIds: Array.from(requestIdSet),
    forbiddenPatterns: NO_RETIRED_RUNTIME_FORBIDDEN_LOG_PATTERNS.map((pattern) => pattern.source),
    findings,
    failed: findings.length > 0
  };
}

async function runCase(caseItem, manifestDir, outputDir) {
  const requestPath = path.join(manifestDir, caseItem.requestFile);
  const requestBody = readJson(requestPath);
  const actual = await invokeJsonRoute(caseItem.route, requestBody);
  const evaluation = evaluateCaseResult(actual, caseItem.expectation || { type: "success" });

  const actualFilePath = path.join(outputDir, `${caseItem.id}.actual.json`);
  const reportFilePath = path.join(outputDir, `${caseItem.id}.report.json`);
  writeJson(actualFilePath, actual.body);
  writeJson(reportFilePath, {
    reportType: "self-contained-case-report",
    observedAt: new Date().toISOString(),
    caseId: caseItem.id,
    route: caseItem.route,
    requestFile: path.relative(ROOT_DIR, requestPath),
    actualStatus: actual.status,
    classification: evaluation.classification,
    expectation: evaluation.expectationSummary,
    checks: evaluation.checks,
    actualBody: actual.body
  });

  return {
    id: caseItem.id,
    scene: caseItem.scene,
    route: caseItem.route,
    classification: evaluation.classification,
    actualStatus: actual.status,
    requestId: actual.body?.requestId || null,
    requestFile: path.relative(ROOT_DIR, requestPath),
    actualFile: path.relative(ROOT_DIR, actualFilePath),
    reportFile: path.relative(ROOT_DIR, reportFilePath),
    checks: evaluation.checks
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const manifestPath = path.resolve(args.manifest || DEFAULT_MANIFEST);
  const manifest = readJson(manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const selectedCaseId = args.case || null;
  const outputDir = path.resolve(
    args["output-dir"] || path.join(ROOT_DIR, "tests", "regression", "output", `self-contained-${safeTimestamp()}`)
  );
  const scanScriptPath = path.resolve(args["scan-script"] || DEFAULT_SCAN_SCRIPT);
  const scanTargets = String(args["scan-targets"] || DEFAULT_SCAN_TARGETS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const noRetiredRuntimeRequired = Boolean(args["no-retired-runtime"]) || parseBooleanValue(process.env.NO_RETIRED_RUNTIME_REQUIRED, false);
  const noRetiredRuntimeScanScriptPath = path.resolve(args["retired-runtime-scan-script"] || DEFAULT_RETIRED_RUNTIME_SCAN_SCRIPT);
  const noRetiredRuntimeScanTargets = String(args["retired-runtime-scan-targets"] || DEFAULT_NO_RETIRED_RUNTIME_SCAN_TARGETS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const noRetiredRuntimeLogFiles = resolvePathList(args["no-retired-runtime-log-files"] || process.env.NO_RETIRED_RUNTIME_LOG_FILES, DEFAULT_NO_RETIRED_RUNTIME_LOG_FILES);

  fs.mkdirSync(outputDir, { recursive: true });

  const scanReport = runScan({ scanScriptPath, scanTargets, outputDir });
  const scanFailed = Number(scanReport?.summary?.totalFindings || 0) > 0;
  const noRetiredRuntimeScan = noRetiredRuntimeRequired
    ? runNoRetiredRuntimeDependencyScan({
        scanScriptPath: noRetiredRuntimeScanScriptPath,
        scanTargets: noRetiredRuntimeScanTargets,
        outputDir
      })
    : null;

  const cases = Array.isArray(manifest.cases)
    ? manifest.cases.filter((item) => !selectedCaseId || item.id === selectedCaseId)
    : [];

  if (cases.length === 0) {
    throw new Error(selectedCaseId ? `No self-contained case found for id: ${selectedCaseId}` : "No self-contained cases found.");
  }

  const noRetiredRuntimeLogSnapshots = noRetiredRuntimeRequired ? snapshotLogFiles(noRetiredRuntimeLogFiles) : null;
  const caseResults = [];
  for (const item of cases) {
    caseResults.push(await runCase(item, manifestDir, outputDir));
  }
  const noRetiredRuntimeLogCheck = noRetiredRuntimeRequired
    ? buildNoRetiredRuntimeLogCheck({
        snapshots: noRetiredRuntimeLogSnapshots,
        requestIds: caseResults.map((item) => item.requestId)
      })
    : null;

  const summary = {
    reportType: "self-contained-regression-summary",
    observedAt: new Date().toISOString(),
    manifest: path.relative(ROOT_DIR, manifestPath),
    outputDir: path.relative(ROOT_DIR, outputDir),
    apiBaseUrl: API_BASE_URL,
    scan: {
      targets: scanTargets,
      reportFile: path.relative(ROOT_DIR, path.join(outputDir, "scan-report.json")),
      findings: scanReport?.summary?.totalFindings || 0,
      failed: scanFailed
    },
    totals: {
      cases: caseResults.length,
      passed: caseResults.filter((item) => item.classification === "pass").length,
      warnings: caseResults.filter((item) => item.classification === "warning").length,
      failed: caseResults.filter((item) => item.classification === "fail").length
    },
    cases: caseResults,
    noRetiredRuntime: noRetiredRuntimeRequired
      ? {
          required: true,
	          env: {
	            LANGGRAPH_DRAFT_MODE: process.env.LANGGRAPH_DRAFT_MODE || null
	          },
	          dependencyScan: noRetiredRuntimeScan,
          logCheck: noRetiredRuntimeLogCheck
        }
      : {
          required: false
        }
  };

  writeJson(path.join(outputDir, "summary.json"), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (
    scanFailed
    || summary.totals.failed > 0
    || noRetiredRuntimeScan?.failed
    || noRetiredRuntimeLogCheck?.failed
  ) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
