#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_ALERT_THRESHOLDS,
  buildRolloutReport,
  parseJsonLines
} = require("../platform/trace/rollout-report");

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

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveThresholds(args) {
	  return {
	    minSuccessRate: Number(args["min-success-rate"] ?? DEFAULT_ALERT_THRESHOLDS.minSuccessRate),
	    maxP95DurationMs: Number(args["max-p95-ms"] ?? DEFAULT_ALERT_THRESHOLDS.maxP95DurationMs),
	    maxSchemaFailureRate: Number(args["max-schema-failure-rate"] ?? DEFAULT_ALERT_THRESHOLDS.maxSchemaFailureRate)
	  };
}

function main() {
  const args = parseArgs(process.argv);
  const inputPath = path.resolve(args.input || "");

  if (!args.input) {
    throw new Error("--input is required.");
  }

  const text = readText(inputPath);
  const entries = parseJsonLines(text);
  const report = buildRolloutReport(entries, {
    batchId: args["batch-id"] || path.basename(inputPath, path.extname(inputPath)),
    thresholds: resolveThresholds(args)
  });

  if (args.output) {
    writeJson(path.resolve(args.output), report);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (args["fail-on-alert"] && Array.isArray(report.alerts) && report.alerts.length > 0) {
    process.exitCode = 2;
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
