#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
LAUNCHD_SOURCE_DIR="$ROOT_DIR/deploy/launchd"
LAUNCHD_TARGET_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$ROOT_DIR/logs"
RAG_LOG_DIR="$ROOT_DIR/rag-service/logs"
UID_VALUE="$(id -u)"

API_LABEL="com.gatopm.sales-opportunity-api"
HELPER_LABEL="com.gatopm.sales-opportunity-context-helper"
DIRECTDB_RUNNER_LABEL="com.gatopm.sales-opportunity-directdb-runner"
MODEL_TOOL_LABEL="com.gatopm.sales-opportunity-model-tool"
RAG_LABEL="com.gatopm.sales-opportunity-rag"

API_SOURCE_PLIST="$LAUNCHD_SOURCE_DIR/$API_LABEL.plist"
HELPER_SOURCE_PLIST="$LAUNCHD_SOURCE_DIR/$HELPER_LABEL.plist"
DIRECTDB_RUNNER_SOURCE_PLIST="$LAUNCHD_SOURCE_DIR/$DIRECTDB_RUNNER_LABEL.plist"
MODEL_TOOL_SOURCE_PLIST="$LAUNCHD_SOURCE_DIR/$MODEL_TOOL_LABEL.plist"
API_TARGET_PLIST="$LAUNCHD_TARGET_DIR/$API_LABEL.plist"
HELPER_TARGET_PLIST="$LAUNCHD_TARGET_DIR/$HELPER_LABEL.plist"
DIRECTDB_RUNNER_TARGET_PLIST="$LAUNCHD_TARGET_DIR/$DIRECTDB_RUNNER_LABEL.plist"
MODEL_TOOL_TARGET_PLIST="$LAUNCHD_TARGET_DIR/$MODEL_TOOL_LABEL.plist"
RAG_TARGET_PLIST="$LAUNCHD_TARGET_DIR/$RAG_LABEL.plist"

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

resolve_rag_python() {
  local venv_python="$ROOT_DIR/rag-service/.venv/bin/python"
  local python_bin=""

  if [[ -x "$venv_python" ]]; then
    echo "$venv_python"
    return
  fi

  python_bin="$(command -v python3 || true)"
  if [[ -z "$python_bin" ]]; then
    echo "python3 not found. Run npm run rag:install before installing RAG LaunchAgent." >&2
    exit 1
  fi

  echo "$python_bin"
}

write_rag_plist() {
  local plist="$1"
  local python_bin
  python_bin="$(resolve_rag_python)"

  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$RAG_LABEL</string>

    <key>ProgramArguments</key>
    <array>
      <string>$python_bin</string>
      <string>$ROOT_DIR/rag-service/rag_search_server.py</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$ROOT_DIR</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>$RAG_LOG_DIR/rag-search.stdout.log</string>

    <key>StandardErrorPath</key>
    <string>$RAG_LOG_DIR/rag-search.stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
      <key>PYTHONUNBUFFERED</key>
      <string>1</string>
    </dict>
  </dict>
</plist>
PLIST
}

copy_plists() {
  mkdir -p "$LAUNCHD_TARGET_DIR" "$LOG_DIR" "$RAG_LOG_DIR"
  cp "$API_SOURCE_PLIST" "$API_TARGET_PLIST"
  cp "$HELPER_SOURCE_PLIST" "$HELPER_TARGET_PLIST"
  cp "$DIRECTDB_RUNNER_SOURCE_PLIST" "$DIRECTDB_RUNNER_TARGET_PLIST"
  cp "$MODEL_TOOL_SOURCE_PLIST" "$MODEL_TOOL_TARGET_PLIST"
  write_rag_plist "$RAG_TARGET_PLIST"
  rewrite_plist_paths "$API_TARGET_PLIST" "$ROOT_DIR/server.js" "$LOG_DIR/api.stdout.log" "$LOG_DIR/api.stderr.log"
  rewrite_plist_paths "$HELPER_TARGET_PLIST" "$ROOT_DIR/ContextHelper/server.js" "$LOG_DIR/helper.stdout.log" "$LOG_DIR/helper.stderr.log"
  rewrite_plist_paths "$DIRECTDB_RUNNER_TARGET_PLIST" "$ROOT_DIR/DirectDbRunner/server.js" "$LOG_DIR/directdb-runner.stdout.log" "$LOG_DIR/directdb-runner.stderr.log"
  rewrite_plist_paths "$MODEL_TOOL_TARGET_PLIST" "$ROOT_DIR/ModelTool/server.js" "$LOG_DIR/model-tool.stdout.log" "$LOG_DIR/model-tool.stderr.log"
  assert_plist_binding "$API_TARGET_PLIST" "$ROOT_DIR/server.js" "$LOG_DIR/api.stdout.log" "$LOG_DIR/api.stderr.log"
  assert_plist_binding "$HELPER_TARGET_PLIST" "$ROOT_DIR/ContextHelper/server.js" "$LOG_DIR/helper.stdout.log" "$LOG_DIR/helper.stderr.log"
  assert_plist_binding "$DIRECTDB_RUNNER_TARGET_PLIST" "$ROOT_DIR/DirectDbRunner/server.js" "$LOG_DIR/directdb-runner.stdout.log" "$LOG_DIR/directdb-runner.stderr.log"
  assert_plist_binding "$MODEL_TOOL_TARGET_PLIST" "$ROOT_DIR/ModelTool/server.js" "$LOG_DIR/model-tool.stdout.log" "$LOG_DIR/model-tool.stderr.log"
  assert_plist_binding "$RAG_TARGET_PLIST" "$ROOT_DIR/rag-service/rag_search_server.py" "$RAG_LOG_DIR/rag-search.stdout.log" "$RAG_LOG_DIR/rag-search.stderr.log"
  chmod 644 "$API_TARGET_PLIST" "$HELPER_TARGET_PLIST" "$DIRECTDB_RUNNER_TARGET_PLIST" "$MODEL_TOOL_TARGET_PLIST" "$RAG_TARGET_PLIST"
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
  bootout_label "$RAG_LABEL"
  bootout_label "$HELPER_LABEL"
  bootout_label "$DIRECTDB_RUNNER_LABEL"
  bootout_label "$MODEL_TOOL_LABEL"
  bootstrap_label "$HELPER_LABEL" "$HELPER_TARGET_PLIST"
  bootstrap_label "$DIRECTDB_RUNNER_LABEL" "$DIRECTDB_RUNNER_TARGET_PLIST"
  bootstrap_label "$MODEL_TOOL_LABEL" "$MODEL_TOOL_TARGET_PLIST"
  bootstrap_label "$RAG_LABEL" "$RAG_TARGET_PLIST"
  bootstrap_label "$API_LABEL" "$API_TARGET_PLIST"
}

stop_services() {
  bootout_label "$API_LABEL"
  bootout_label "$RAG_LABEL"
  bootout_label "$HELPER_LABEL"
  bootout_label "$DIRECTDB_RUNNER_LABEL"
  bootout_label "$MODEL_TOOL_LABEL"
}

print_launchd_label() {
  local label="$1"
  local output

  echo "-- $label --"
  if output="$(launchctl print "gui/$UID_VALUE/$label" 2>&1)"; then
    printf '%s\n' "$output" | sed -n '1,80p'
  else
    echo "not loaded"
  fi
  echo
}

status_services() {
  local api_port
  local helper_port
  local directdb_port
  local model_tool_port
  local rag_port

  api_port="$(read_env_value API_PORT 3000)"
  helper_port="$(read_env_value CONTEXT_HELPER_PORT 19001)"
  directdb_port="$(read_env_value DIRECTDB_RUNNER_PORT 19002)"
  model_tool_port="$(read_env_value MODEL_TOOL_PORT 19003)"
  rag_port="$(read_env_value RAG_SEARCH_PORT 19104)"

  echo "== launchd labels =="
  print_launchd_label "$API_LABEL"
  print_launchd_label "$RAG_LABEL"
  print_launchd_label "$HELPER_LABEL"
  print_launchd_label "$DIRECTDB_RUNNER_LABEL"
  print_launchd_label "$MODEL_TOOL_LABEL"
  echo "== listeners =="
  lsof -nP -iTCP:"$api_port" -sTCP:LISTEN || true
  lsof -nP -iTCP:"$rag_port" -sTCP:LISTEN || true
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
