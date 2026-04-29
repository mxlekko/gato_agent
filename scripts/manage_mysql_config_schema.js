const fs = require("fs");
const path = require("path");
const { runMysql } = require("./lib/mysql_cli");

const SCHEMA_SQL_PATH = path.join(__dirname, "sql", "config_center_schema.sql");
const MANAGED_TABLES = [
  "cfg_scene_configs",
  "cfg_platform_resources",
  "cfg_scene_assets",
  "cfg_helper_scripts",
  "cfg_revisions",
  "cfg_releases",
  "cfg_release_entries",
  "cfg_release_pointers"
];

function readSchemaSql() {
  return fs.readFileSync(SCHEMA_SQL_PATH, "utf8");
}

function applySchema() {
  const schemaSql = readSchemaSql();
  const result = runMysql({
    input: schemaSql
  });

  process.stdout.write(`mysql_client_bin=${result.mysqlClientBin}\n`);
  process.stdout.write("schema_apply=ok\n");
}

function inspectSchema() {
  const tableList = MANAGED_TABLES.map((tableName) => `'${tableName}'`).join(", ");
  const inspectSql = `
SELECT table_name, table_rows
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (${tableList})
ORDER BY table_name;

SELECT table_name, index_name, non_unique, seq_in_index, column_name
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name IN (${tableList})
ORDER BY table_name, index_name, seq_in_index;
`;

  const result = runMysql({
    args: ["-e", inspectSql]
  });

  process.stdout.write(`mysql_client_bin=${result.mysqlClientBin}\n`);
  process.stdout.write(result.stdout);
}

function usage() {
  process.stderr.write("Usage: node scripts/manage_mysql_config_schema.js <apply|inspect>\n");
}

const command = String(process.argv[2] || "").trim();

try {
  if (command === "apply") {
    applySchema();
  } else if (command === "inspect") {
    inspectSchema();
  } else {
    usage();
    process.exit(1);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
