#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
LAUNCHD_SOURCE_DIR="$ROOT_DIR/deploy/launchd"
LAUNCHD_TARGET_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$ROOT_DIR/logs"
UID_VALUE="$(id -u)"

API_LABEL="com.gatopm.sales-opportunity-api"
HELPER_LABEL="com.gatopm.sales-opportunity-context-helper"
DIRECTDB_RUNNER_LABEL="com.gatopm.sales-opportunity-directdb-runner"
MODEL_TOOL_LABEL="com.gatopm.sales-opportunity-model-tool"

API_SOURCE_PLIST="$LAUNCHD_SOURCE_DIR/$API_LABEL.plist"
HELPER_SOURCE_PLIST="$LAUNCHD_SOURCE_DIR/$HELPER_LABEL.plist"
DIRECTDB_RUNNER_SOURCE_PLIST="$LAUNCHD_SOURCE_DIR/$DIRECTDB_RUNNER_LABEL.plist"
MODEL_TOOL_SOURCE_PLIST="$LAUNCHD_SOURCE_DIR/$MODEL_TOOL_LABEL.plist"
API_TARGET_PLIST="$LAUNCHD_TARGET_DIR/$API_LABEL.plist"
HELPER_TARGET_PLIST="$LAUNCHD_TARGET_DIR/$HELPER_LABEL.plist"
DIRECTDB_RUNNER_TARGET_PLIST="$LAUNCHD_TARGET_DIR/$DIRECTDB_RUNNER_LABEL.plist"
MODEL_TOOL_TARGET_PLIST="$LAUNCHD_TARGET_DIR/$MODEL_TOOL_LABEL.plist"

read_env_value() {
  local key="$1"
  local default_value="$2"
  local env_file="$ROOT_DIR/.env"
  local value=""

  if [[ -f "$env_file" ]]; then
    value="$(awk -F= -v key="$key" '
      /^[[:space:]]*#/ { next }
      $1 == key {
        sub(/^[[:space:]]+/, "", $2)
        sub(/[[:space:]]+$/, "", $2)
        print $2
        exit
      }
    ' "$env_file")"
  fi

  if [[ -n "$value" ]]; then
    echo "$value"
    return
  fi

  echo "$default_value"
}

rewrite_plist_paths() {
  local plist="$1"
  local entry_script="$2"
  local stdout_log="$3"
  local stderr_log="$4"

  /usr/libexec/PlistBuddy -c "Set :WorkingDirectory $ROOT_DIR" "$plist"
  /usr/libexec/PlistBuddy -c "Set :ProgramArguments:1 $entry_script" "$plist"
  /usr/libexec/PlistBuddy -c "Set :StandardOutPath $stdout_log" "$plist"
  /usr/libexec/PlistBuddy -c "Set :StandardErrorPath $stderr_log" "$plist"
}

assert_plist_binding() {
  local plist="$1"
  local entry_script="$2"
  local stdout_log="$3"
  local stderr_log="$4"
  local actual_workdir
  local actual_entry
  local actual_stdout
  local actual_stderr

  actual_workdir="$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "$plist")"
  actual_entry="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:1' "$plist")"
  actual_stdout="$(/usr/libexec/PlistBuddy -c 'Print :StandardOutPath' "$plist")"
  actual_stderr="$(/usr/libexec/PlistBuddy -c 'Print :StandardErrorPath' "$plist")"

  [[ "$actual_workdir" == "$ROOT_DIR" ]] || {
    echo "WorkingDirectory mismatch for $plist: $actual_workdir" >&2
    exit 1
  }
  [[ "$actual_entry" == "$entry_script" ]] || {
    echo "ProgramArguments mismatch for $plist: $actual_entry" >&2
    exit 1
  }
  [[ "$actual_stdout" == "$stdout_log" ]] || {
    echo "StandardOutPath mismatch for $plist: $actual_stdout" >&2
    exit 1
  }
  [[ "$actual_stderr" == "$stderr_log" ]] || {
    echo "StandardErrorPath mismatch for $plist: $actual_stderr" >&2
    exit 1
  }
}

copy_plists() {
  mkdir -p "$LAUNCHD_TARGET_DIR" "$LOG_DIR"
  cp "$API_SOURCE_PLIST" "$API_TARGET_PLIST"
  cp "$HELPER_SOURCE_PLIST" "$HELPER_TARGET_PLIST"
  cp "$DIRECTDB_RUNNER_SOURCE_PLIST" "$DIRECTDB_RUNNER_TARGET_PLIST"
  cp "$MODEL_TOOL_SOURCE_PLIST" "$MODEL_TOOL_TARGET_PLIST"
  rewrite_plist_paths "$API_TARGET_PLIST" "$ROOT_DIR/server.js" "$LOG_DIR/api.stdout.log" "$LOG_DIR/api.stderr.log"
  rewrite_plist_paths "$HELPER_TARGET_PLIST" "$ROOT_DIR/ContextHelper/server.js" "$LOG_DIR/helper.stdout.log" "$LOG_DIR/helper.stderr.log"
  rewrite_plist_paths "$DIRECTDB_RUNNER_TARGET_PLIST" "$ROOT_DIR/DirectDbRunner/server.js" "$LOG_DIR/directdb-runner.stdout.log" "$LOG_DIR/directdb-runner.stderr.log"
  rewrite_plist_paths "$MODEL_TOOL_TARGET_PLIST" "$ROOT_DIR/ModelTool/server.js" "$LOG_DIR/model-tool.stdout.log" "$LOG_DIR/model-tool.stderr.log"
  assert_plist_binding "$API_TARGET_PLIST" "$ROOT_DIR/server.js" "$LOG_DIR/api.stdout.log" "$LOG_DIR/api.stderr.log"
  assert_plist_binding "$HELPER_TARGET_PLIST" "$ROOT_DIR/ContextHelper/server.js" "$LOG_DIR/helper.stdout.log" "$LOG_DIR/helper.stderr.log"
  assert_plist_binding "$DIRECTDB_RUNNER_TARGET_PLIST" "$ROOT_DIR/DirectDbRunner/server.js" "$LOG_DIR/directdb-runner.stdout.log" "$LOG_DIR/directdb-runner.stderr.log"
  assert_plist_binding "$MODEL_TOOL_TARGET_PLIST" "$ROOT_DIR/ModelTool/server.js" "$LOG_DIR/model-tool.stdout.log" "$LOG_DIR/model-tool.stderr.log"
  chmod 644 "$API_TARGET_PLIST" "$HELPER_TARGET_PLIST" "$DIRECTDB_RUNNER_TARGET_PLIST" "$MODEL_TOOL_TARGET_PLIST"
}

bootout_label() {
  local label="$1"
  launchctl bootout "gui/$UID_VALUE/$label" >/dev/null 2>&1 || true
  launchctl bootout "gui/$UID_VALUE" "$LAUNCHD_TARGET_DIR/$label.plist" >/dev/null 2>&1 || true
}

bootstrap_label() {
  local label="$1"
  local plist="$2"
  launchctl enable "gui/$UID_VALUE/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID_VALUE" "$plist"
  launchctl kickstart -k "gui/$UID_VALUE/$label"
}

start_services() {
  copy_plists
  bootout_label "$API_LABEL"
  bootout_label "$HELPER_LABEL"
  bootout_label "$DIRECTDB_RUNNER_LABEL"
  bootout_label "$MODEL_TOOL_LABEL"
  bootstrap_label "$HELPER_LABEL" "$HELPER_TARGET_PLIST"
  bootstrap_label "$DIRECTDB_RUNNER_LABEL" "$DIRECTDB_RUNNER_TARGET_PLIST"
  bootstrap_label "$MODEL_TOOL_LABEL" "$MODEL_TOOL_TARGET_PLIST"
  bootstrap_label "$API_LABEL" "$API_TARGET_PLIST"
}

stop_services() {
  bootout_label "$API_LABEL"
  bootout_label "$HELPER_LABEL"
  bootout_label "$DIRECTDB_RUNNER_LABEL"
  bootout_label "$MODEL_TOOL_LABEL"
}

status_services() {
  local api_port
  local helper_port
  local directdb_port
  local model_tool_port

  api_port="$(read_env_value API_PORT 3000)"
  helper_port="$(read_env_value CONTEXT_HELPER_PORT 19001)"
  directdb_port="$(read_env_value DIRECTDB_RUNNER_PORT 19002)"
  model_tool_port="$(read_env_value MODEL_TOOL_PORT 19003)"

  echo "== launchd labels =="
  launchctl print "gui/$UID_VALUE/$API_LABEL" | sed -n '1,80p'
  echo
  launchctl print "gui/$UID_VALUE/$HELPER_LABEL" | sed -n '1,80p'
  echo
  launchctl print "gui/$UID_VALUE/$DIRECTDB_RUNNER_LABEL" | sed -n '1,80p'
  echo
  launchctl print "gui/$UID_VALUE/$MODEL_TOOL_LABEL" | sed -n '1,80p'
  echo
  echo "== listeners =="
  lsof -nP -iTCP:"$api_port" -sTCP:LISTEN || true
  lsof -nP -iTCP:"$helper_port" -sTCP:LISTEN || true
  lsof -nP -iTCP:"$directdb_port" -sTCP:LISTEN || true
  lsof -nP -iTCP:"$model_tool_port" -sTCP:LISTEN || true
}

case "${1:-install}" in
  install)
    start_services
    ;;
  start)
    start_services
    ;;
  stop)
    stop_services
    ;;
  restart)
    stop_services
    start_services
    ;;
  status)
    status_services
    ;;
  *)
    echo "Usage: $0 {install|start|stop|restart|status}" >&2
    exit 1
    ;;
esac
