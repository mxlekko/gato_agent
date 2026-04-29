#!/usr/bin/env node

const path = require("path");
const {
  validatePlatformConfigs,
  validateSingleConfigFile
} = require("../platform/compiler/validate");

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

function main() {
  const args = parseArgs(process.argv);
  const baseDir = path.resolve(args.root || path.join(process.cwd(), "platform"));
  const filePath = args.file ? path.resolve(args.file) : null;
  const report = filePath
    ? validateSingleConfigFile({ baseDir, filePath })
    : validatePlatformConfigs({ baseDir });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (!report.valid) {
    process.exitCode = 1;
  }
}

main();
