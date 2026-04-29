#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_MANIFEST = path.join(ROOT_DIR, "tests", "fixtures", "self-contained", "manifest.json");
const DEFAULT_SCAN_SCRIPT = path.join(ROOT_DIR, "scripts", "scan_shared_runtime_paths.js");
const DEFAULT_SCAN_TARGETS = [
  "scene-configs",
  "platform",
  "services",
  "deploy",
  "runtime-assets/openclaw/workspace/skills"
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

function evaluateCaseResult(actual, expectation) {
  if (!expectation || expectation.type === "success") {
    return evaluateSuccessExpectation(actual, expectation || {});
  }

  if (expectation.type === "external-warning") {
    return evaluateExternalWarningExpectation(actual, expectation);
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

  fs.mkdirSync(outputDir, { recursive: true });

  const scanReport = runScan({ scanScriptPath, scanTargets, outputDir });
  const scanFailed = Number(scanReport?.summary?.totalFindings || 0) > 0;

  const cases = Array.isArray(manifest.cases)
    ? manifest.cases.filter((item) => !selectedCaseId || item.id === selectedCaseId)
    : [];

  if (cases.length === 0) {
    throw new Error(selectedCaseId ? `No self-contained case found for id: ${selectedCaseId}` : "No self-contained cases found.");
  }

  const caseResults = [];
  for (const item of cases) {
    caseResults.push(await runCase(item, manifestDir, outputDir));
  }

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
    cases: caseResults
  };

  writeJson(path.join(outputDir, "summary.json"), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (scanFailed || summary.totals.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
