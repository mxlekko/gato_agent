#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { buildComparisonReport, inferExpectedStatus } = require("./compare_results");

const DEFAULT_MANIFEST = path.join(process.cwd(), "tests", "fixtures", "baseline", "manifest.json");
const API_BASE_URL = process.env.REGRESSION_API_BASE_URL || "http://127.0.0.1:3000";
const MODEL_TOOL_BASE_URL = process.env.REGRESSION_MODEL_TOOL_BASE_URL || "http://127.0.0.1:19003";
const CONTEXT_HELPER_BASE_URL = process.env.REGRESSION_CONTEXT_HELPER_BASE_URL || "http://127.0.0.1:19001";
const DIRECTDB_RUNNER_BASE_URL = process.env.REGRESSION_DIRECTDB_RUNNER_BASE_URL || "http://127.0.0.1:19002";
const REQUEST_TIMEOUT_MS = Number(process.env.REGRESSION_TIMEOUT_MS || 90000);

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

function resolveRouteTarget(route) {
  const [method, pathname] = String(route).split(" ");

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

async function runCase(caseItem, manifestDir, outputDir) {
  const requestPath = path.join(manifestDir, caseItem.requestFile);
  const expectedPath = path.join(manifestDir, caseItem.responseFile);
  const requestBody = readJson(requestPath);
  const expectedBody = readJson(expectedPath);
  const expectedStatus = inferExpectedStatus(expectedBody);

  const actual = await invokeJsonRoute(caseItem.route, requestBody);
  const actualFileName = `${caseItem.id}.actual.json`;
  const reportFileName = `${caseItem.id}.report.json`;
  const actualFilePath = path.join(outputDir, actualFileName);
  const reportFilePath = path.join(outputDir, reportFileName);

  writeJson(actualFilePath, actual.body);

  const report = buildComparisonReport({
    caseId: caseItem.id,
    route: caseItem.route,
    reportType: "baseline-regression",
    expectedStatus,
    actualStatus: actual.status,
    expectedBody,
    actualBody: actual.body,
    dynamicFields: caseItem.dynamicFields || [],
    observedAt: new Date().toISOString()
  });

  writeJson(reportFilePath, report);

  return {
    id: caseItem.id,
    kind: caseItem.kind,
    route: caseItem.route,
    expectedStatus,
    actualStatus: actual.status,
    passed: report.passed,
    checks: report.checks,
    actualFile: path.relative(process.cwd(), actualFilePath),
    reportFile: path.relative(process.cwd(), reportFilePath)
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const manifestPath = path.resolve(args.manifest || DEFAULT_MANIFEST);
  const manifest = readJson(manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const selectedCaseId = args.case || null;
  const timestamp = safeTimestamp();
  const outputDir = path.resolve(args["output-dir"] || path.join(process.cwd(), "tests", "regression", "output", timestamp));

  const cases = manifest.cases.filter((item) => !selectedCaseId || item.id === selectedCaseId);

  if (cases.length === 0) {
    throw new Error(selectedCaseId ? `No baseline case found for id: ${selectedCaseId}` : "No baseline cases found.");
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const caseResults = [];
  for (const item of cases) {
    caseResults.push(await runCase(item, manifestDir, outputDir));
  }

  const total = caseResults.length;
  const passedCount = caseResults.filter((item) => item.passed).length;
  const strictBodyMatchCount = caseResults.filter((item) => item.checks.strictBodyMatch).length;
  const httpStatusMatchCount = caseResults.filter((item) => item.checks.httpStatusMatch).length;
  const envelopeMatchCount = caseResults.filter((item) => item.checks.responseEnvelopeMatch).length;
  const consistencyMatchCount = caseResults.filter((item) => item.checks.consistencyFieldsMatch).length;
  const http2xxCount = caseResults.filter((item) => item.actualStatus >= 200 && item.actualStatus < 300).length;

  const summary = {
    reportType: "baseline-regression-summary",
    comparisonMode: "baseline",
    manifest: path.relative(process.cwd(), manifestPath),
    outputDir: path.relative(process.cwd(), outputDir),
    observedAt: new Date().toISOString(),
    totals: {
      cases: total,
      passed: passedCount,
      failed: total - passedCount
    },
    rates: {
      passRate: Number((passedCount / total).toFixed(4)),
      httpStatusMatchRate: Number((httpStatusMatchCount / total).toFixed(4)),
      envelopeMatchRate: Number((envelopeMatchCount / total).toFixed(4)),
      consistencyMatchRate: Number((consistencyMatchCount / total).toFixed(4)),
      strictBodyMatchRate: Number((strictBodyMatchCount / total).toFixed(4)),
      http2xxRate: Number((http2xxCount / total).toFixed(4))
	    },
	    cases: caseResults
	  };

  writeJson(path.join(outputDir, "summary.json"), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (summary.totals.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
