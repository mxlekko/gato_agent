#!/usr/bin/env bash
set -euo pipefail

MYSQL_LOCAL_HOME="${MYSQL_LOCAL_HOME:-$HOME/.codex-mysql}"
MYSQL_VERSION="${MYSQL_VERSION:-8.4.8}"
MYSQL_DIST_NAME="${MYSQL_DIST_NAME:-mysql-${MYSQL_VERSION}-macos15-arm64}"
MYSQL_DOWNLOAD_URL="${MYSQL_DOWNLOAD_URL:-https://cdn.mysql.com//Downloads/MySQL-8.4/${MYSQL_DIST_NAME}.tar.gz}"
MYSQL_BASE_DIR="${MYSQL_BASE_DIR:-$MYSQL_LOCAL_HOME/install/$MYSQL_DIST_NAME}"
MYSQL_DATA_DIR="${MYSQL_DATA_DIR:-$MYSQL_LOCAL_HOME/data/mysql-${MYSQL_VERSION}-dev}"
MYSQL_DIST_DIR="${MYSQL_DIST_DIR:-$MYSQL_LOCAL_HOME/dist}"
MYSQL_RUN_DIR="${MYSQL_RUN_DIR:-$MYSQL_LOCAL_HOME/run}"
MYSQL_LOG_DIR="${MYSQL_LOG_DIR:-$MYSQL_LOCAL_HOME/log}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_SOCKET="${MYSQL_SOCKET:-$MYSQL_RUN_DIR/mysql.sock}"
MYSQL_PID_FILE="${MYSQL_PID_FILE:-$MYSQL_RUN_DIR/mysql.pid}"
MYSQL_LOG_FILE="${MYSQL_LOG_FILE:-$MYSQL_LOG_DIR/mysql-${MYSQL_VERSION}-dev.err}"

mkdir -p "$MYSQL_DIST_DIR" "$MYSQL_RUN_DIR" "$MYSQL_LOG_DIR" "$(dirname "$MYSQL_DATA_DIR")" "$(dirname "$MYSQL_BASE_DIR")"

require_install() {
  if [[ ! -x "$MYSQL_BASE_DIR/bin/mysqld" ]]; then
    echo "MySQL is not installed. Run: $0 install" >&2
    exit 1
  fi
}

install_mysql() {
  local tarball="$MYSQL_DIST_DIR/${MYSQL_DIST_NAME}.tar.gz"
  if [[ ! -x "$MYSQL_BASE_DIR/bin/mysqld" ]]; then
    mkdir -p "$MYSQL_DIST_DIR" "$(dirname "$MYSQL_BASE_DIR")"
    curl -L "$MYSQL_DOWNLOAD_URL" -o "$tarball"
    tar -xzf "$tarball" -C "$(dirname "$MYSQL_BASE_DIR")"
  fi

  if [[ ! -d "$MYSQL_DATA_DIR/mysql" ]]; then
    mkdir -p "$MYSQL_DATA_DIR"
    "$MYSQL_BASE_DIR/bin/mysqld" \
      --initialize-insecure \
      --basedir="$MYSQL_BASE_DIR" \
      --datadir="$MYSQL_DATA_DIR"
  fi
}

start_mysql() {
  require_install

  if status_mysql >/dev/null 2>&1; then
    echo "MySQL is already running on ${MYSQL_HOST}:${MYSQL_PORT}"
    return 0
  fi

  "$MYSQL_BASE_DIR/bin/mysqld" \
    --daemonize \
    --basedir="$MYSQL_BASE_DIR" \
    --datadir="$MYSQL_DATA_DIR" \
    --bind-address="$MYSQL_HOST" \
    --port="$MYSQL_PORT" \
    --socket="$MYSQL_SOCKET" \
    --pid-file="$MYSQL_PID_FILE" \
    --log-error="$MYSQL_LOG_FILE" \
    --character-set-server=utf8mb4 \
    --collation-server=utf8mb4_0900_ai_ci \
    --default-time-zone=+00:00 \
    --mysqlx=0

  ping_mysql
}

stop_mysql() {
  require_install
  if [[ -S "$MYSQL_SOCKET" ]]; then
    "$MYSQL_BASE_DIR/bin/mysqladmin" --socket="$MYSQL_SOCKET" -u root shutdown
  elif [[ -f "$MYSQL_PID_FILE" ]]; then
    kill "$(cat "$MYSQL_PID_FILE")"
  else
    echo "MySQL is not running"
  fi
}

status_mysql() {
  require_install
  "$MYSQL_BASE_DIR/bin/mysqladmin" --protocol=TCP -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u root ping
}

ping_mysql() {
  status_mysql
}

mysql_client() {
  require_install
  exec "$MYSQL_BASE_DIR/bin/mysql" --protocol=TCP -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u root "$@"
}

show_env() {
  cat <<EOF
MYSQL_LOCAL_HOME=$MYSQL_LOCAL_HOME
MYSQL_VERSION=$MYSQL_VERSION
MYSQL_BASE_DIR=$MYSQL_BASE_DIR
MYSQL_DATA_DIR=$MYSQL_DATA_DIR
MYSQL_HOST=$MYSQL_HOST
MYSQL_PORT=$MYSQL_PORT
MYSQL_SOCKET=$MYSQL_SOCKET
MYSQL_LOG_FILE=$MYSQL_LOG_FILE
EOF
}

usage() {
  cat <<EOF
Usage: $0 <command>

Commands:
  install   Download official MySQL Community Server tarball and initialize data dir
  start     Start local MySQL with utf8mb4 and UTC defaults
  stop      Stop local MySQL
  status    Check server status
  ping      Ping server over TCP
  client    Open mysql client as root
  env       Print resolved paths and ports
EOF
}

command="${1:-}"
shift || true

case "$command" in
  install) install_mysql ;;
  start) start_mysql ;;
  stop) stop_mysql ;;
  status) status_mysql ;;
  ping) ping_mysql ;;
  client) mysql_client "$@" ;;
  env) show_env ;;
  *) usage; exit 1 ;;
esac
