#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MYSQL_MANAGER="${MYSQL_MANAGER:-$REPO_ROOT/scripts/manage_local_mysql.sh}"
CONFIG_CENTER_SECRET_FILE="${CONFIG_CENTER_SECRET_FILE:-$HOME/.codex-mysql/config-center-dev.env}"
CONFIG_CENTER_DB="${CONFIG_CENTER_DB:-config_center_dev}"
CONFIG_CENTER_APP_USER="${CONFIG_CENTER_APP_USER:-cfg_app_dev}"
CONFIG_CENTER_APP_PASSWORD="${CONFIG_CENTER_APP_PASSWORD:-}"
CONFIG_CENTER_HOST="${CONFIG_CENTER_HOST:-127.0.0.1}"
CONFIG_CENTER_PORT="${CONFIG_CENTER_PORT:-3306}"
CONFIG_CENTER_APP_HOSTS="${CONFIG_CENTER_APP_HOSTS:-127.0.0.1 localhost}"
CONFIG_CENTER_APP_PRIVILEGES="${CONFIG_CENTER_APP_PRIVILEGES:-SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX}"

require_mysql_manager() {
  if [[ ! -x "$MYSQL_MANAGER" ]]; then
    echo "MySQL manager script not found or not executable: $MYSQL_MANAGER" >&2
    exit 1
  fi
}

load_secret_file() {
  if [[ -f "$CONFIG_CENTER_SECRET_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CONFIG_CENTER_SECRET_FILE"
  fi
}

ensure_password() {
  load_secret_file
  if [[ -z "${CONFIG_CENTER_APP_PASSWORD:-}" ]]; then
    CONFIG_CENTER_APP_PASSWORD="$(openssl rand -hex 12)"
  fi
}

write_secret_file() {
  mkdir -p "$(dirname "$CONFIG_CENTER_SECRET_FILE")"
  umask 077
  cat >"$CONFIG_CENTER_SECRET_FILE" <<EOF
CONFIG_CENTER_DB=$CONFIG_CENTER_DB
CONFIG_CENTER_APP_USER=$CONFIG_CENTER_APP_USER
CONFIG_CENTER_APP_PASSWORD=$CONFIG_CENTER_APP_PASSWORD
CONFIG_CENTER_HOST=$CONFIG_CENTER_HOST
CONFIG_CENTER_PORT=$CONFIG_CENTER_PORT
EOF
  chmod 600 "$CONFIG_CENTER_SECRET_FILE"
}

ensure_mysql_running() {
  if ! "$MYSQL_MANAGER" ping >/dev/null 2>&1; then
    "$MYSQL_MANAGER" start >/dev/null
  fi
}

resolve_mysql_base_dir() {
  MYSQL_BASE_DIR="$("$MYSQL_MANAGER" env | awk -F= '/^MYSQL_BASE_DIR=/{print $2}')"
  MYSQL_BIN="$MYSQL_BASE_DIR/bin/mysql"
  if [[ ! -x "$MYSQL_BIN" ]]; then
    echo "mysql client binary not found: $MYSQL_BIN" >&2
    exit 1
  fi
}

provision_database_and_user() {
  local sql
  sql="CREATE DATABASE IF NOT EXISTS \`$CONFIG_CENTER_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"

  local host
  for host in $CONFIG_CENTER_APP_HOSTS; do
    sql+=$'\n'"CREATE USER IF NOT EXISTS '$CONFIG_CENTER_APP_USER'@'$host' IDENTIFIED BY '$CONFIG_CENTER_APP_PASSWORD';"
    sql+=$'\n'"ALTER USER '$CONFIG_CENTER_APP_USER'@'$host' IDENTIFIED BY '$CONFIG_CENTER_APP_PASSWORD';"
    sql+=$'\n'"GRANT $CONFIG_CENTER_APP_PRIVILEGES ON \`$CONFIG_CENTER_DB\`.* TO '$CONFIG_CENTER_APP_USER'@'$host';"
  done

  sql+=$'\n'"FLUSH PRIVILEGES;"
  "$MYSQL_MANAGER" client -e "$sql"
}

verify_app_privileges() {
  local probe_sql
  probe_sql=$(
    cat <<'SQL'
DROP TABLE IF EXISTS __cfg_privilege_probe;
CREATE TABLE __cfg_privilege_probe (
  id INT PRIMARY KEY,
  note VARCHAR(64) NOT NULL
);
ALTER TABLE __cfg_privilege_probe ADD COLUMN touched_by VARCHAR(32) NULL;
CREATE INDEX idx_note ON __cfg_privilege_probe(note);
INSERT INTO __cfg_privilege_probe (id, note, touched_by) VALUES (1, 'grant-check', 'init-script');
UPDATE __cfg_privilege_probe SET note = 'grant-check-ok' WHERE id = 1;
SELECT COUNT(*) AS probe_rows FROM __cfg_privilege_probe;
DELETE FROM __cfg_privilege_probe WHERE id = 1;
DROP TABLE __cfg_privilege_probe;
SQL
  )

  MYSQL_PWD="$CONFIG_CENTER_APP_PASSWORD" \
    "$MYSQL_BIN" \
      --protocol=TCP \
      -h "$CONFIG_CENTER_HOST" \
      -P "$CONFIG_CENTER_PORT" \
      -u "$CONFIG_CENTER_APP_USER" \
      "$CONFIG_CENTER_DB" \
      -e "$probe_sql"
}

show_summary() {
  "$MYSQL_MANAGER" client -e "SHOW CREATE DATABASE \`$CONFIG_CENTER_DB\`;"

  local host
  for host in $CONFIG_CENTER_APP_HOSTS; do
    "$MYSQL_MANAGER" client -e "SHOW GRANTS FOR '$CONFIG_CENTER_APP_USER'@'$host';"
  done

  cat <<EOF
CONFIG_CENTER_SECRET_FILE=$CONFIG_CENTER_SECRET_FILE
CONFIG_CENTER_DB=$CONFIG_CENTER_DB
CONFIG_CENTER_APP_USER=$CONFIG_CENTER_APP_USER
CONFIG_CENTER_HOST=$CONFIG_CENTER_HOST
CONFIG_CENTER_PORT=$CONFIG_CENTER_PORT
EOF
}

command="${1:-init}"

require_mysql_manager

case "$command" in
  init)
    ensure_mysql_running
    ensure_password
    write_secret_file
    resolve_mysql_base_dir
    provision_database_and_user
    verify_app_privileges
    show_summary
    ;;
  verify)
    ensure_mysql_running
    load_secret_file
    resolve_mysql_base_dir
    verify_app_privileges
    ;;
  summary)
    ensure_mysql_running
    load_secret_file
    show_summary
    ;;
  env)
    load_secret_file
    cat <<EOF
CONFIG_CENTER_SECRET_FILE=$CONFIG_CENTER_SECRET_FILE
CONFIG_CENTER_DB=$CONFIG_CENTER_DB
CONFIG_CENTER_APP_USER=$CONFIG_CENTER_APP_USER
CONFIG_CENTER_HOST=$CONFIG_CENTER_HOST
CONFIG_CENTER_PORT=$CONFIG_CENTER_PORT
EOF
    ;;
  *)
    cat <<EOF
Usage: $0 [init|verify|summary|env]
EOF
    exit 1
    ;;
esac
