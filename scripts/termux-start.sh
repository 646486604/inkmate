#!/usr/bin/env bash
# InkMate · Termux 启动器（生产模式：单进程托管已构建的 Web）
# 用法：bash scripts/termux-start.sh [start|open|stop|restart|status|doctor|log|ncm-log|install]
# 行为：先确保网易云边车（默认 127.0.0.1:3000）→ 后台拉起 apps/server/dist/index.js
#       → 轮询 /api/health → 用系统浏览器打开 127.0.0.1:8787
# 首次 start 会自动安装边车依赖；不想用网易云就设 INKMATE_NO_NETEASE=1。
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${INKMATE_DIR:-$(cd "$SELF_DIR/.." && pwd)}"
PORT="${PORT:-8787}"
LOG="${INKMATE_LOG:-$HOME/inkmate.log}"
PIDFILE="$HOME/.inkmate.pid"
URL="http://127.0.0.1:$PORT"
ENTRY="apps/server/dist/index.js"

# 网易云边车
NCM_PORT="${NETEASE_PORT:-3000}"
NCM_DIR="$REPO/tools/netease-api"
NCM_ENTRY="$NCM_DIR/start.js"
NCM_PIDFILE="$HOME/.inkmate-netease.pid"
NCM_LOG="${INKMATE_NETEASE_LOG:-$HOME/inkmate-netease.log}"
export NETEASE_API_URL="${NETEASE_API_URL:-http://127.0.0.1:$NCM_PORT}"

cd "$REPO" 2>/dev/null || { echo "✗ 找不到仓库 $REPO"; exit 1; }

pid_alive() { [ -s "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; }
ncm_pid_alive() { [ -s "$NCM_PIDFILE" ] && kill -0 "$(cat "$NCM_PIDFILE" 2>/dev/null)" 2>/dev/null; }

healthy() {
  U="$URL/api/health" node -e \
    'fetch(process.env.U,{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))' \
    >/dev/null 2>&1
}

ncm_port_open() {
  P="$NCM_PORT" node -e '
    const net = require("net");
    const socket = net.connect({ port: Number(process.env.P), host: "127.0.0.1" });
    const finish = (code) => { socket.destroy(); process.exit(code); };
    socket.on("connect", () => finish(0));
    socket.on("error", () => finish(1));
    setTimeout(() => finish(1), 1000);
  ' >/dev/null 2>&1
}

ncm_installed() {
  [ -f "$NCM_ENTRY" ] && [ -f "$NCM_DIR/node_modules/NeteaseCloudMusicApi/server.js" ]
}

ncm_install() {
  command -v npm >/dev/null 2>&1 || { echo "✗ 没有 npm，先跑 pkg install nodejs"; return 1; }
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' 2>/dev/null || {
    echo "✗ 网易云边车需要 Node ≥ 20，先升级 nodejs"
    return 1
  }
  echo "▶ 首次安装网易云边车（约 1–3 分钟，日志：$NCM_LOG）"
  : >>"$NCM_LOG"
  if npm install --prefix "$NCM_DIR" --ignore-scripts --no-audit --no-fund >>"$NCM_LOG" 2>&1; then
    echo "✓ 网易云边车已安装"
  else
    echo "✗ 边车安装失败，先不用网易云；日志末尾："
    tail -n 15 "$NCM_LOG" 2>/dev/null
    return 1
  fi
}

ncm_start() {
  if [ "${INKMATE_NO_NETEASE:-}" = "1" ]; then
    echo "○ 已跳过网易云边车（INKMATE_NO_NETEASE=1）"
    return 0
  fi
  if ncm_port_open; then
    echo "✓ 网易云边车已在运行：127.0.0.1:$NCM_PORT"
    return 0
  fi
  if [ -f "$NCM_PIDFILE" ] && ! ncm_pid_alive; then
    rm -f "$NCM_PIDFILE"
  fi
  if ! ncm_installed; then
    ncm_install || return 1
  fi

  echo "▶ 启动网易云边车…（日志：$NCM_LOG）"
  INKMATE_NETEASE_PORT="$NCM_PORT" INKMATE_NETEASE_HOST=127.0.0.1 \
    nohup node "$NCM_ENTRY" >>"$NCM_LOG" 2>&1 &
  echo $! >"$NCM_PIDFILE"

  for _ in $(seq 1 40); do
    sleep 0.5
    if ncm_port_open; then
      echo "✓ 网易云边车就绪：127.0.0.1:$NCM_PORT"
      return 0
    fi
  done
  echo "✗ 网易云边车 20 秒内未就绪，先继续启动墨伴；日志末尾："
  tail -n 15 "$NCM_LOG" 2>/dev/null
  return 1
}

ncm_stop() {
  if ncm_pid_alive; then
    kill "$(cat "$NCM_PIDFILE")" 2>/dev/null
    echo "■ 网易云边车已停止"
    for _ in $(seq 1 10); do
      ncm_port_open || break
      sleep 0.3
    done
  fi
  rm -f "$NCM_PIDFILE"
}

start() {
  ncm_start || true
  if healthy; then echo "✓ 墨伴已在运行：$URL"; return 0; fi
  [ -f "$ENTRY" ] || { echo "✗ 还没构建，先跑： cd $REPO && npm install && npm run build"; return 1; }
  local flag=""
  node -e "import('node:sqlite').then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1 \
    || flag="--experimental-sqlite"
  echo "▶ 启动墨伴…（日志：$LOG）"
  NODE_ENV=production PORT="$PORT" nohup node $flag "$ENTRY" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 60); do
    sleep 0.5
    healthy && break
  done
  if healthy; then echo "✓ 墨伴已就绪：$URL"; else echo "✗ 墨伴启动失败，日志末尾："; tail -n 20 "$LOG"; return 1; fi
}

open_url() {
  local target="$URL" output=""
  # 1) 首选 Termux:API（需要 apt 包 termux-api + 应用商店里的 Termux:API 插件，两者缺一不可）
  if command -v termux-open-url >/dev/null 2>&1; then
    if output="$(termux-open-url "$target" 2>&1)"; then
      echo "✓ 已在浏览器打开：$target"
      return 0
    fi
    [ -n "$output" ] && echo "· termux-open-url 失败：$output"
  else
    echo "· 没有 termux-open-url（缺少 termux-api 包）"
  fi
  # 2) termux-open 也行
  if command -v termux-open >/dev/null 2>&1; then
    if output="$(termux-open "$target" 2>&1)"; then
      echo "✓ 已打开：$target"
      return 0
    fi
    [ -n "$output" ] && echo "· termux-open 失败：$output"
  fi
  # 3) 最后试系统 am（部分机型可用）
  if output="$(/system/bin/am start -a android.intent.action.VIEW -d "$target" 2>&1)"; then
    echo "✓ 已通过系统 intent 打开：$target"
    return 0
  fi
  echo "✗ 没能自动打开浏览器"
  echo "  修复办法（Termux 里执行）："
  echo "    pkg install termux-api"
  echo "  再去 F-Droid 装上「Termux:API」应用，并在系统设置里给它权限。"
  echo "  实在不行就手动打开：$target"
  return 1
}

stop() {
  if pid_alive; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    rm -f "$PIDFILE"
    echo "■ 墨伴已停止"
  else
    rm -f "$PIDFILE"
    echo "○ 墨伴没在运行"
  fi
  ncm_stop
}

status() {
  if healthy; then echo "✓ 墨伴运行中：$URL"; else echo "○ 墨伴未运行"; fi
  if ncm_port_open; then echo "✓ 网易云边车运行中：127.0.0.1:$NCM_PORT"; else echo "○ 网易云边车未运行"; fi
}

doctor() {
  echo "墨伴自检"
  echo "- 仓库：$REPO"
  if [ -f "$ENTRY" ]; then echo "- 构建产物：✓ $ENTRY"; else echo "- 构建产物：✗ 还没有，先 npm run build"; fi
  if healthy; then echo "- 服务：✓ 运行中 $URL"; else echo "- 服务：○ 未运行（bash $0 start）"; fi
  if command -v termux-open-url >/dev/null 2>&1; then
    echo "- termux-api 包：✓ 已装"
  else
    echo "- termux-api 包：✗ 未装 → pkg install termux-api"
  fi
  if [ -d /data/data/com.termux.api ] 2>/dev/null; then
    echo "- Termux:API 应用：✓ 已装"
  else
    echo "- Termux:API 应用：? 看不到（去 F-Droid 装 Termux:API，否则 termux-open-url 会失败）"
  fi
  echo "- 需要时：export INKMATE_NO_OPEN=1 可跳过自动开浏览器"
}

case "${1:-start}" in
  start)    start && { [ "${INKMATE_NO_OPEN:-}" = "1" ] || open_url; } ;;
  open)     open_url ;;
  stop)     stop ;;
  restart)  stop; sleep 1; start && { [ "${INKMATE_NO_OPEN:-}" = "1" ] || open_url; } ;;
  status)   status ;;
  doctor)   doctor ;;
  log)      tail -n 50 -f "$LOG" ;;
  ncm-log)  tail -n 50 -f "$NCM_LOG" ;;
  install)  ncm_install ;;
  *)        echo "用法：bash $0 [start|open|stop|restart|status|doctor|log|ncm-log|install]" ;;
esac
