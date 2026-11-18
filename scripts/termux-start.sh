#!/usr/bin/env bash
# InkMate · Termux 启动器（生产模式：单进程托管已构建的 Web）
# 用法：bash scripts/termux-start.sh [start|open|stop|restart|status|log]
# 依赖：pkg install -y nodejs git，然后 npm install && npm run build
# 行为：后台拉起 apps/server/dist/index.js -> 轮询 /api/health -> 用系统浏览器打开
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${INKMATE_DIR:-$(cd "$SELF_DIR/.." && pwd)}"
PORT="${PORT:-8787}"
LOG="${INKMATE_LOG:-$HOME/inkmate.log}"
PIDFILE="$HOME/.inkmate.pid"
URL="http://127.0.0.1:$PORT"
ENTRY="apps/server/dist/index.js"

cd "$REPO" 2>/dev/null || { echo "✗ 找不到仓库 $REPO"; exit 1; }

pid_alive() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; }

healthy() {
  U="$URL/api/health" node -e \
    'fetch(process.env.U,{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))' \
    >/dev/null 2>&1
}

start() {
  if healthy; then echo "✓ 已在运行：$URL"; return 0; fi
  [ -f "$ENTRY" ] || { echo "✗ 还没构建，先跑： cd $REPO && npm install && npm run build"; return 1; }
  local flag=""
  node -e "import('node:sqlite').then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1 \
    || flag="--experimental-sqlite"
  echo "▶ 启动中…（日志：$LOG）"
  NODE_ENV=production PORT="$PORT" nohup node $flag "$ENTRY" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 60); do
    sleep 0.5
    healthy && break
  done
  if healthy; then echo "✓ 已就绪：$URL"; else echo "✗ 启动失败，日志末尾："; tail -n 20 "$LOG"; return 1; fi
}

open_url() {
  termux-open-url "$URL" 2>/dev/null \
    || /system/bin/am start -a android.intent.action.VIEW -d "$URL" >/dev/null 2>&1 \
    || echo "→ 请手动打开 $URL"
}

stop() {
  if pid_alive; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
    echo "■ 已停止"
  else
    rm -f "$PIDFILE"
    echo "○ 没在运行"
  fi
}

case "${1:-start}" in
  start)   start && { [ "${INKMATE_NO_OPEN:-}" = "1" ] || open_url; } ;;
  open)    open_url ;;
  stop)    stop ;;
  restart) stop; sleep 1; start && { [ "${INKMATE_NO_OPEN:-}" = "1" ] || open_url; } ;;
  status)  if healthy; then echo "✓ 运行中：$URL"; else echo "○ 未运行"; fi ;;
  log)     tail -n 50 -f "$LOG" ;;
  *)       echo "用法：bash $0 [start|open|stop|restart|status|log]" ;;
esac
