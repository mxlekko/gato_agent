const { runMysql } = require("./lib/mysql_cli");

function main() {
  const result = runMysql({
    args: [
      "-e",
      "SELECT CURRENT_USER() AS current_login, DATABASE() AS current_db, @@version AS mysql_version, @@port AS mysql_port;"
    ]
  });

  process.stdout.write(`mysql_client_bin=${result.mysqlClientBin}\n`);
  process.stdout.write(result.stdout);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
