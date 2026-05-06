#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");

const requiredPaths = [
  "server.js",
  "package.json",
  ".env.example",
  ".gitignore",
  "routes",
  "services",
  "utils",
  "platform",
  "scene-configs",
  "runtime-assets",
  "ContextHelper/server.js",
  "DirectDbRunner/server.js",
  "ModelTool/server.js",
  "console/package.json",
  "console/src",
  "scripts",
  "docs"
];

const forbiddenTrackedPaths = [
  ".env",
  ".env.local",
  ".DS_Store",
  "node_modules",
  "console/node_modules",
  "logs",
  "tmp",
  ".tmp",
  "output",
  ".local",
  ".npm-cache",
  ".npm-cache-playwright",
  ".playwright-cli",
  "console/dist",
  "console/.npm-cache"
];

const forbiddenTrackedSuffixes = [
  ".log",
  "/.DS_Store"
];

const forbiddenSecretPatterns = [
  {
    name: "openai-style-api-key",
    pattern: /sk-[A-Za-z0-9_-]{12,}/
  }
];

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function getTrackedFiles() {
  try {
    const output = execFileSync("git", ["ls-files"], {
      cwd: projectRoot,
      encoding: "utf8"
    });

    return output.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function isForbiddenTracked(filePath) {
  const matchesPath = forbiddenTrackedPaths.some((forbiddenPath) => {
    return filePath === forbiddenPath || filePath.startsWith(`${forbiddenPath}/`);
  });

  if (matchesPath) {
    return true;
  }

  return forbiddenTrackedSuffixes.some((suffix) => filePath.endsWith(suffix));
}

function main() {
  const missing = requiredPaths.filter((relativePath) => !exists(relativePath));
  const trackedFiles = getTrackedFiles();
  const forbiddenTracked = trackedFiles.filter(isForbiddenTracked);
  const trackedSecretHits = trackedFiles.filter((relativePath) => {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return false;
    }

    let content;
    try {
      content = fs.readFileSync(absolutePath, "utf8");
    } catch {
      return false;
    }

    return forbiddenSecretPatterns.some((entry) => entry.pattern.test(content));
  });

  if (missing.length === 0 && forbiddenTracked.length === 0 && trackedSecretHits.length === 0) {
    process.stdout.write("Project structure check passed.\n");
    return;
  }

  if (missing.length > 0) {
    process.stderr.write("Missing required project paths:\n");
    for (const relativePath of missing) {
      process.stderr.write(`- ${relativePath}\n`);
    }
  }

  if (forbiddenTracked.length > 0) {
    process.stderr.write("Forbidden local/runtime paths are tracked by git:\n");
    for (const relativePath of forbiddenTracked) {
      process.stderr.write(`- ${relativePath}\n`);
    }
  }

  if (trackedSecretHits.length > 0) {
    process.stderr.write("Tracked files contain secret-like tokens:\n");
    for (const relativePath of trackedSecretHits) {
      process.stderr.write(`- ${relativePath}\n`);
    }
  }

  process.exitCode = 1;
}

main();
