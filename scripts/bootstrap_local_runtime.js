#!/usr/bin/env node

require("../utils/load-env").loadProjectEnv();

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawnSync } = require("child_process");

const { createReleaseManager } = require("../services/release-manager");
const { PROJECT_ROOT } = require("../utils/path-resolver");

const RAG_SERVICE_DIR = path.join(PROJECT_ROOT, "rag-service");
const RAG_REQUIREMENTS_PATH = path.join(RAG_SERVICE_DIR, "requirements.txt");
const RAG_ENV_PATH = path.join(RAG_SERVICE_DIR, ".env");
const RAG_VENV_DIR = path.join(RAG_SERVICE_DIR, ".venv");

const REQUIRED_ENV_KEYS = [
  "API_HOST",
  "API_PORT",
  "CONTEXT_HELPER_PORT",
  "DIRECTDB_RUNNER_PORT",
  "MODEL_TOOL_PORT",
  "MOONSHOT_API_KEY",
  "DEEPSEEK_API_KEY",
  "SQLSERVER_HOST",
  "SQLSERVER_PORT",
  "SQLSERVER_DATABASE",
  "SQLSERVER_USER",
  "SQLSERVER_PASSWORD",
  "MYSQL_HOST",
  "MYSQL_PORT",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "MYSQL_PASSWORD"
];

const OPTIONAL_EXTERNAL_ENDPOINTS = [
  {
    name: "special-custom-product-solution RAG",
    url: "http://127.0.0.1:19104/internal/rag/search",
    method: "POST",
    body: {
      requestId: "bootstrap_probe",
      scene: "special-custom-product-solution",
      query: "bootstrap probe",
      topK: 1
    }
  }
];

function parseArgs(argv) {
  const args = {
    dryRun: false,
    skipSchema: false,
    skipImport: false,
    skipPublish: false,
    skipExternalChecks: false,
    installDeps: false,
    environment: "local",
    scopeType: "all",
    scopeValue: "*"
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--skip-schema":
        args.skipSchema = true;
        break;
      case "--skip-import":
        args.skipImport = true;
        break;
      case "--skip-publish":
        args.skipPublish = true;
        break;
      case "--skip-external-checks":
        args.skipExternalChecks = true;
        break;
      case "--install-deps":
        args.installDeps = true;
        break;
      case "--environment":
        args.environment = readNextValue(argv, index, token);
        index += 1;
        break;
      case "--scope-type":
        args.scopeType = readNextValue(argv, index, token);
        index += 1;
        break;
      case "--scope-value":
        args.scopeValue = readNextValue(argv, index, token);
        index += 1;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function readNextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function printUsage() {
  process.stdout.write(`Usage: node scripts/bootstrap_local_runtime.js [options]

Options:
  --dry-run                Print checks and planned actions without changing MySQL or bundles.
  --install-deps           Run npm install in root and console before bootstrapping.
  --skip-schema            Do not apply MySQL config-center schema.
  --skip-import            Do not import file configs into MySQL config-center tables.
  --skip-publish           Do not create and activate a local runtime bundle.
  --skip-external-checks   Do not probe RAG endpoints, including RAG /health.
  --environment <name>     Release environment. Default: local.
  --scope-type <type>      Release scope type. Default: all.
  --scope-value <value>    Release scope value. Default: *.
`);
}

function buildStep(name, status, details = {}) {
  return {
    name,
    status,
    ...details
  };
}

function redactedValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return "<set>";
}

function inspectEnv() {
  const values = Object.fromEntries(
    REQUIRED_ENV_KEYS.map((key) => [key, redactedValue(process.env[key])])
  );
  const missing = REQUIRED_ENV_KEYS.filter((key) => !String(process.env[key] || "").trim());

  return {
    values,
    missing
  };
}

function parseEnvFileValue(filePath, targetKey) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (key !== targetKey) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }

  return null;
}

function inspectRagApiKey() {
  const sources = [];

  if (String(process.env.DASHSCOPE_API_KEY || "").trim()) {
    sources.push("process.env/root .env");
  }

  const ragEnvValue = parseEnvFileValue(RAG_ENV_PATH, "DASHSCOPE_API_KEY");
  if (String(ragEnvValue || "").trim()) {
    sources.push("rag-service/.env");
  }

  return {
    configured: sources.length > 0,
    value: sources.length > 0 ? "<set>" : null,
    sources
  };
}

function inspectRagVenv() {
  const candidates = [
    path.join(RAG_VENV_DIR, "bin", "python"),
    path.join(RAG_VENV_DIR, "Scripts", "python.exe")
  ];
  const pythonPath = candidates.find((candidate) => fs.existsSync(candidate)) || null;

  return {
    path: path.relative(PROJECT_ROOT, RAG_VENV_DIR),
    exists: fs.existsSync(RAG_VENV_DIR),
    python: pythonPath ? path.relative(PROJECT_ROOT, pythonPath) : null
  };
}

function buildRagHealthUrl() {
  const rawBaseUrl = process.env.RAG_SERVICE_BASE_URL
    || `http://${process.env.RAG_SEARCH_HOST || "127.0.0.1"}:${process.env.RAG_SEARCH_PORT || "19104"}`;

  try {
    const parsed = new URL(rawBaseUrl);
    const basePath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return new URL(`${basePath}/health`, parsed).toString();
  } catch {
    return "http://127.0.0.1:19104/health";
  }
}

async function inspectRagRuntime(options = {}) {
  const requirements = {
    path: path.relative(PROJECT_ROOT, RAG_REQUIREMENTS_PATH),
    exists: fs.existsSync(RAG_REQUIREMENTS_PATH)
  };
  const venv = inspectRagVenv();
  const dashscopeApiKey = inspectRagApiKey();
  const healthUrl = buildRagHealthUrl();
  const health = options.skipHealth
    ? {
        name: "RAG service health",
        url: healthUrl,
        skipped: true
      }
    : {
        url: healthUrl,
        ...(await probeEndpoint({
          name: "RAG service health",
          url: healthUrl,
          method: "GET"
        }))
      };
  const blockers = [];

  if (!requirements.exists) {
    blockers.push("rag-service/requirements.txt missing");
  }
  if (!venv.exists || !venv.python) {
    blockers.push("rag-service/.venv python missing");
  }
  if (!dashscopeApiKey.configured) {
    blockers.push("DASHSCOPE_API_KEY missing");
  }
  if (!health.skipped && !health.ok) {
    blockers.push("GET /health unavailable");
  }

  return {
    requirements,
    venv,
    dashscopeApiKey,
    health,
    blockers
  };
}

function commandExists(command) {
  if (!command || typeof command !== "string") {
    return false;
  }

  if (command.includes(path.sep)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const searchPaths = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);

  return searchPaths.some((directoryPath) => {
    const candidate = path.join(directoryPath, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || PROJECT_ROOT,
    encoding: "utf8",
    stdio: options.stdio || "pipe"
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error([
      `${command} ${args.join(" ")} failed with status ${result.status}.`,
      stderr ? `stderr: ${stderr}` : null,
      stdout ? `stdout: ${stdout}` : null
    ].filter(Boolean).join("\n"));
  }

  return {
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

function assertRequiredFiles() {
  const requiredPaths = [
    ".env",
    "package.json",
    "console/package.json",
    "scripts/manage_mysql_config_schema.js",
    "scripts/import_config_to_mysql.js",
    "scene-configs",
    "platform",
    "runtime-assets/openclaw"
  ];
  const missing = requiredPaths.filter((relativePath) => {
    return !fs.existsSync(path.join(PROJECT_ROOT, relativePath));
  });

  return {
    requiredPaths,
    missing
  };
}

async function probeEndpoint(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const headers = {};
    if (endpoint.tokenEnv && process.env[endpoint.tokenEnv]) {
      headers.Authorization = `Bearer ${process.env[endpoint.tokenEnv]}`;
    }
    if (endpoint.body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(endpoint.url, {
      method: endpoint.method,
      headers,
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
      signal: controller.signal
    });

    return {
      name: endpoint.name,
      ok: response.ok,
      httpStatus: response.status
    };
  } catch (error) {
    return {
      name: endpoint.name,
      ok: false,
      error: error?.name === "AbortError" ? "timeout" : error?.message || "request_failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectCurrentBundle(environment) {
  const currentPath = path.join(PROJECT_ROOT, ".local", "runtime-bundles", environment, "current");
  const exists = fs.existsSync(currentPath);
  let target = null;

  if (exists) {
    try {
      target = await fsp.readlink(currentPath);
    } catch {
      target = null;
    }
  }

  return {
    currentPath,
    exists,
    symlinkTarget: target
  };
}

async function publishLocalBundle(args) {
  const manager = createReleaseManager({
    activeEnv: args.environment
  });

  try {
    const result = await manager.publishRelease({
      environment: args.environment,
      scopeType: args.scopeType,
      scopeValue: args.scopeValue,
      createdBy: "bootstrap-local-runtime",
      publishNote: "bootstrap local runtime bundle"
    });

    return {
      releaseId: result.release.releaseId,
      status: result.release.status,
      bundlePath: result.release.bundlePath,
      currentPath: result.activation.currentPath,
      entryCount: result.entries.length,
      pointer: result.activation.pointer
        ? {
            activeReleaseId: result.activation.pointer.activeReleaseId,
            previousReleaseId: result.activation.pointer.previousReleaseId || null
          }
        : null
    };
  } finally {
    await manager.close().catch(() => null);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const steps = [];
  const env = inspectEnv();
  const requiredFiles = assertRequiredFiles();
  const ragRuntime = await inspectRagRuntime({
    skipHealth: args.skipExternalChecks
  });
  const tools = {
    node: process.version,
    npm: commandExists("npm"),
    mysqlClient: commandExists(process.env.MYSQL_CLIENT_BIN || "mysql"),
    ruby: commandExists("ruby")
  };
  const missingTools = [];

  if (args.installDeps && !tools.npm) {
    missingTools.push("npm");
  }
  if (!args.skipSchema && !tools.mysqlClient) {
    missingTools.push(process.env.MYSQL_CLIENT_BIN || "mysql");
  }
  if ((!args.skipImport || !args.skipPublish) && !tools.ruby) {
    missingTools.push("ruby");
  }
  if (!tools.npm) {
    missingTools.push("npm");
  }

  steps.push(buildStep("inspect-env", env.missing.length ? "blocked" : "ok", env));
  steps.push(buildStep("inspect-files", requiredFiles.missing.length ? "blocked" : "ok", requiredFiles));
  steps.push(buildStep("inspect-rag-runtime", ragRuntime.blockers.length ? "blocked" : "ok", ragRuntime));
  steps.push(buildStep("inspect-tools", missingTools.length ? "blocked" : "ok", {
    ...tools,
    missing: [...new Set(missingTools)]
  }));
  steps.push(buildStep("inspect-current-bundle", "ok", await inspectCurrentBundle(args.environment)));

  if (!args.skipExternalChecks) {
    steps.push(buildStep("probe-external-services", "ok", {
      probes: await Promise.all(OPTIONAL_EXTERNAL_ENDPOINTS.map(probeEndpoint))
    }));
  }

  if (
    env.missing.length
    || requiredFiles.missing.length
    || ragRuntime.blockers.length
    || missingTools.length
    || args.dryRun
  ) {
    steps.push(buildStep("planned-actions", args.dryRun ? "dry-run" : "blocked", {
      installDeps: args.installDeps,
      applySchema: !args.skipSchema,
      importConfig: !args.skipImport,
      publishBundle: !args.skipPublish,
      environment: args.environment,
      scopeType: args.scopeType,
      scopeValue: args.scopeValue
    }));
    process.stdout.write(`${JSON.stringify({
      ok: env.missing.length === 0
        && requiredFiles.missing.length === 0
        && ragRuntime.blockers.length === 0
        && missingTools.length === 0,
      dryRun: args.dryRun,
      steps
    }, null, 2)}\n`);
    process.exitCode = !args.dryRun
      && (
        env.missing.length
        || requiredFiles.missing.length
        || ragRuntime.blockers.length
        || missingTools.length
      )
      ? 1
      : 0;
    return;
  }

  if (args.installDeps) {
    runCommand("npm", ["install"], { stdio: "inherit" });
    runCommand("npm", ["--prefix", "console", "install"], { stdio: "inherit" });
    steps.push(buildStep("install-deps", "ok"));
  }

  if (!args.skipSchema) {
    const result = runCommand(process.execPath, ["scripts/manage_mysql_config_schema.js", "apply"]);
    steps.push(buildStep("apply-mysql-schema", "ok", {
      output: result.stdout.trim().split(/\r?\n/).filter(Boolean)
    }));
  }

  if (!args.skipImport) {
    const result = runCommand(process.execPath, ["scripts/import_config_to_mysql.js", "import"]);
    steps.push(buildStep("import-config-to-mysql", "ok", {
      summary: JSON.parse(result.stdout)
    }));
  }

  if (!args.skipPublish) {
    steps.push(buildStep("publish-local-bundle", "ok", await publishLocalBundle(args)));
  }

  runCommand("npm", ["run", "check"]);
  steps.push(buildStep("npm-check", "ok"));
  steps.push(buildStep("inspect-current-bundle-after", "ok", await inspectCurrentBundle(args.environment)));

  process.stdout.write(`${JSON.stringify({ ok: true, dryRun: false, steps }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
