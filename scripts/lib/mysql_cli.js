const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");
const LOCAL_MYSQL_MANAGER = path.join(REPO_ROOT, "scripts", "manage_local_mysql.sh");
const REQUIRED_ENV_KEYS = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"];

function loadMysqlEnv() {
  require("../../utils/load-env").loadProjectEnv();
}

function getRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required in .env before using the MySQL CLI helpers.`);
  }

  return value;
}

function getMysqlEnvConfig() {
  loadMysqlEnv();

  return {
    host: getRequiredEnv("MYSQL_HOST"),
    port: getRequiredEnv("MYSQL_PORT"),
    user: getRequiredEnv("MYSQL_USER"),
    password: getRequiredEnv("MYSQL_PASSWORD"),
    database: getRequiredEnv("MYSQL_DATABASE")
  };
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getMysqlFromPath() {
  const pathValue = String(process.env.PATH || "");
  const segments = pathValue.split(path.delimiter).filter(Boolean);

  for (const segment of segments) {
    const candidate = path.join(segment, "mysql");
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getMysqlFromLocalManager() {
  if (!isExecutable(LOCAL_MYSQL_MANAGER)) {
    return null;
  }

  const result = spawnSync(LOCAL_MYSQL_MANAGER, ["env"], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    return null;
  }

  const mysqlBaseDirLine = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("MYSQL_BASE_DIR="));

  if (!mysqlBaseDirLine) {
    return null;
  }

  const mysqlBaseDir = mysqlBaseDirLine.slice("MYSQL_BASE_DIR=".length).trim();
  const candidate = path.join(mysqlBaseDir, "bin", "mysql");
  return isExecutable(candidate) ? candidate : null;
}

function resolveMysqlClientBin() {
  loadMysqlEnv();

  const explicitBin = String(process.env.MYSQL_CLIENT_BIN || "").trim();
  if (explicitBin) {
    if (!isExecutable(explicitBin)) {
      throw new Error(`MYSQL_CLIENT_BIN is set but not executable: ${explicitBin}`);
    }

    return explicitBin;
  }

  return getMysqlFromPath() || getMysqlFromLocalManager();
}

function runMysql({ args = [], input = undefined }) {
  const mysqlClientBin = resolveMysqlClientBin();
  if (!mysqlClientBin) {
    throw new Error(
      "Unable to locate a mysql client binary. Install mysql in PATH, or keep using scripts/manage_local_mysql.sh."
    );
  }

  const config = getMysqlEnvConfig();
  const mysqlArgs = [
    "--protocol=TCP",
    "-h",
    config.host,
    "-P",
    config.port,
    "-u",
    config.user,
    config.database,
    ...args
  ];

  const result = spawnSync(mysqlClientBin, mysqlArgs, {
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      MYSQL_PWD: config.password
    }
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(stderr || `mysql exited with status ${result.status}`);
  }

  return {
    mysqlClientBin,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

module.exports = {
  getMysqlEnvConfig,
  resolveMysqlClientBin,
  runMysql
};
