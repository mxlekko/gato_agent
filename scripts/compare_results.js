#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function splitPath(pathText) {
  return String(pathText)
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function removePath(target, pathText) {
  const parts = splitPath(pathText);
  if (parts.length === 0) {
    return;
  }

  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!current || typeof current !== "object") {
      return;
    }
    current = current[parts[index]];
  }

  if (!current || typeof current !== "object") {
    return;
  }

  delete current[parts[parts.length - 1]];
}

function stripDynamicFields(value, dynamicFields = []) {
  const cloned = cloneJson(value);

  for (const fieldPath of dynamicFields) {
    removePath(cloned, fieldPath);
  }

  return cloned;
}

function inferExpectedStatus(expectedBody) {
  if (expectedBody?.success === true) {
    return 200;
  }

  if (typeof expectedBody?.error?.httpStatus === "number") {
    return expectedBody.error.httpStatus;
  }

  throw new Error("Unable to infer expected HTTP status from expected body.");
}

function compareEnvelope(expectedBody, actualBody) {
  const checks = [];

  checks.push({
    path: "success",
    passed: typeof actualBody?.success === "boolean" && actualBody.success === expectedBody?.success,
    expected: expectedBody?.success,
    actual: actualBody?.success
  });

  if (expectedBody?.success === true) {
    checks.push({
      path: "data",
      passed: Boolean(actualBody?.data) && typeof actualBody.data === "object",
      expected: "object",
      actual: actualBody?.data === null ? "null" : typeof actualBody?.data
    });
    checks.push({
      path: "error",
      passed: actualBody?.error === null,
      expected: null,
      actual: actualBody?.error
    });
  } else {
    checks.push({
      path: "data",
      passed: actualBody?.data === null,
      expected: null,
      actual: actualBody?.data
    });
    checks.push({
      path: "error",
      passed: Boolean(actualBody?.error) && typeof actualBody.error === "object",
      expected: "object",
      actual: actualBody?.error === null ? "null" : typeof actualBody?.error
    });
  }

  return {
    passed: checks.every((item) => item.passed),
    details: checks
  };
}

function buildConsistencyChecks(expectedBody, actualBody) {
  const checks = [
    {
      path: "success",
      passed: actualBody?.success === expectedBody?.success,
      expected: expectedBody?.success,
      actual: actualBody?.success
    }
  ];

  if (expectedBody?.success === true) {
    if (expectedBody?.data?.opportunityId !== undefined) {
      checks.push({
        path: "data.opportunityId",
        passed: actualBody?.data?.opportunityId === expectedBody.data.opportunityId,
        expected: expectedBody.data.opportunityId,
        actual: actualBody?.data?.opportunityId
      });
    }

    checks.push({
      path: "data.summary",
      passed: typeof actualBody?.data?.summary === "string" && actualBody.data.summary.trim().length > 0,
      expected: "non-empty string",
      actual: typeof actualBody?.data?.summary
    });
    checks.push({
      path: "data.adviceText",
      passed: typeof actualBody?.data?.adviceText === "string" && actualBody.data.adviceText.trim().length > 0,
      expected: "non-empty string",
      actual: typeof actualBody?.data?.adviceText
    });
    checks.push({
      path: "data.nextActions",
      passed: Array.isArray(actualBody?.data?.nextActions) && actualBody.data.nextActions.length >= 1,
      expected: "non-empty array",
      actual: Array.isArray(actualBody?.data?.nextActions) ? actualBody.data.nextActions.length : typeof actualBody?.data?.nextActions
    });
    checks.push({
      path: "data.basisFields",
      passed: Array.isArray(actualBody?.data?.basisFields) && actualBody.data.basisFields.length >= 1,
      expected: "non-empty array",
      actual: Array.isArray(actualBody?.data?.basisFields) ? actualBody.data.basisFields.length : typeof actualBody?.data?.basisFields
    });
  } else {
    const errorFields = ["code", "message", "httpStatus", "stage"];
    for (const fieldName of errorFields) {
      checks.push({
        path: `error.${fieldName}`,
        passed: actualBody?.error?.[fieldName] === expectedBody?.error?.[fieldName],
        expected: expectedBody?.error?.[fieldName],
        actual: actualBody?.error?.[fieldName]
      });
    }
  }

  return {
    passed: checks.every((item) => item.passed),
    details: checks
  };
}

function diffValues(expectedValue, actualValue, currentPath = "") {
  if (expectedValue === actualValue) {
    return [];
  }

  const expectedIsArray = Array.isArray(expectedValue);
  const actualIsArray = Array.isArray(actualValue);

  if (expectedIsArray || actualIsArray) {
    if (!expectedIsArray || !actualIsArray) {
      return [
        {
          path: currentPath || "$",
          expected: expectedValue,
          actual: actualValue
        }
      ];
    }

    const diffs = [];
    const maxLength = Math.max(expectedValue.length, actualValue.length);
    for (let index = 0; index < maxLength; index += 1) {
      diffs.push(...diffValues(expectedValue[index], actualValue[index], `${currentPath}[${index}]`));
    }
    return diffs;
  }

  const expectedIsObject = Boolean(expectedValue) && typeof expectedValue === "object";
  const actualIsObject = Boolean(actualValue) && typeof actualValue === "object";

  if (expectedIsObject || actualIsObject) {
    if (!expectedIsObject || !actualIsObject) {
      return [
        {
          path: currentPath || "$",
          expected: expectedValue,
          actual: actualValue
        }
      ];
    }

    const diffs = [];
    const keys = Array.from(new Set([
      ...Object.keys(expectedValue),
      ...Object.keys(actualValue)
    ])).sort();

    for (const key of keys) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      diffs.push(...diffValues(expectedValue[key], actualValue[key], nextPath));
    }

    return diffs;
  }

  return [
    {
      path: currentPath || "$",
      expected: expectedValue,
      actual: actualValue
    }
  ];
}

function buildComparisonReport(options) {
  const expectedStatus = options.expectedStatus;
  const actualStatus = options.actualStatus;
  const expectedBody = options.expectedBody;
  const actualBody = options.actualBody;
  const dynamicFields = options.dynamicFields || [];
  const caseId = options.caseId || null;
  const route = options.route || null;
  const reportType = options.reportType || "baseline-regression";

  const normalizedExpected = stripDynamicFields(expectedBody, dynamicFields);
  const normalizedActual = stripDynamicFields(actualBody, dynamicFields);
  const envelope = compareEnvelope(normalizedExpected, normalizedActual);
  const consistency = buildConsistencyChecks(normalizedExpected, normalizedActual);
  const diffs = diffValues(normalizedExpected, normalizedActual);
  const strictBodyMatch = diffs.length === 0;
  const httpStatusMatch = expectedStatus === actualStatus;
  const passed = httpStatusMatch && envelope.passed && consistency.passed;

  return {
    reportType,
    comparisonMode: "baseline",
    caseId,
    route,
    observedAt: options.observedAt || new Date().toISOString(),
    passed,
    expectedStatus,
    actualStatus,
    dynamicFields,
    checks: {
      httpStatusMatch,
      responseEnvelopeMatch: envelope.passed,
      consistencyFieldsMatch: consistency.passed,
      strictBodyMatch
    },
    envelopeChecks: envelope.details,
    consistencyChecks: consistency.details,
    diffs,
    shadow: {
      enabled: false,
      baselineRequestId: actualBody?.requestId || expectedBody?.requestId || null,
      shadowRequestId: null,
      diffSummary: null
    }
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  const expectedPath = args.expected;
  const actualPath = args.actual;

  if (!expectedPath || !actualPath) {
    process.stderr.write("Usage: node scripts/compare_results.js --expected <expected.json> --actual <actual.json> [--expected-status <code>] [--dynamic-fields requestId,error.details.traceId] [--report-file <path>]\n");
    process.exit(1);
    return;
  }

  const expectedBody = readJson(expectedPath);
  const actualBody = readJson(actualPath);
  const expectedStatus = args["expected-status"] ? Number(args["expected-status"]) : inferExpectedStatus(expectedBody);
  const actualStatus = args["actual-status"] ? Number(args["actual-status"]) : inferExpectedStatus(actualBody);
  const dynamicFields = args["dynamic-fields"] ? String(args["dynamic-fields"]).split(",").map((item) => item.trim()).filter(Boolean) : [];

  const report = buildComparisonReport({
    caseId: args["case-id"] || path.basename(expectedPath, path.extname(expectedPath)),
    route: args.route || null,
    reportType: args["report-type"] || "baseline-regression",
    expectedStatus,
    actualStatus,
    expectedBody,
    actualBody,
    dynamicFields
  });

  if (args["report-file"]) {
    writeJson(args["report-file"], report);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (!report.passed) {
    process.exitCode = 1;
  }
}

module.exports = {
  buildComparisonReport,
  inferExpectedStatus,
  stripDynamicFields
};

if (require.main === module) {
  main();
}
