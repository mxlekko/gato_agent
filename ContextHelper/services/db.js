const sql = require("mssql");

const DEFAULT_DB_CONFIG = {
  server: process.env.SQLSERVER_HOST || "192.168.1.216",
  port: Number(process.env.SQLSERVER_PORT || 1433),
  database: process.env.SQLSERVER_DATABASE || "ERP_yfb",
  user: process.env.SQLSERVER_USER || "",
  password: process.env.SQLSERVER_PASSWORD || "",
  options: {
    encrypt: process.env.SQLSERVER_ENCRYPT === "1",
    trustServerCertificate: process.env.SQLSERVER_TRUST_CERT !== "0"
  },
  pool: {
    max: Number(process.env.SQLSERVER_POOL_MAX || 5),
    min: 0,
    idleTimeoutMillis: Number(process.env.SQLSERVER_IDLE_TIMEOUT_MS || 30000)
  },
  requestTimeout: Number(process.env.SQLSERVER_REQUEST_TIMEOUT_MS || 120000),
  connectionTimeout: Number(process.env.SQLSERVER_CONNECTION_TIMEOUT_MS || 15000)
};

let poolPromise = null;

function getDbConfig() {
  return { ...DEFAULT_DB_CONFIG };
}

function validateDbConfig(config) {
  if (!config.user) {
    throw new Error("SQLSERVER_USER is required.");
  }

  if (!config.password) {
    throw new Error("SQLSERVER_PASSWORD is required.");
  }

  return config;
}

async function getDbPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(validateDbConfig(getDbConfig())).catch((error) => {
      poolPromise = null;
      throw error;
    });
  }

  return poolPromise;
}

async function closeDbPool() {
  if (!poolPromise) {
    return;
  }

  const pool = await poolPromise;
  poolPromise = null;
  await pool.close();
}

function getDbClient() {
  const config = getDbConfig();

  return {
    mode: "sqlserver",
    provider: "sales-opportunity-context-helper",
    server: config.server,
    port: config.port,
    database: config.database
  };
}

module.exports = {
  closeDbPool,
  getDbClient,
  getDbConfig,
  getDbPool,
  sql,
  validateDbConfig
};
