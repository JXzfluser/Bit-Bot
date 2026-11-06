#!/usr/bin/env bash
# Start Bit Bot Desktop (Electron) with MoonBit on PATH.
#
# 2026-11-06 真启动一次后补的三件事（都是当场踩出来的，不是「保险起见」）：
#
#  ① **剔除 ELECTRON_RUN_AS_NODE**：不少开发机 / CI / 终端 shell 里它是常驻的
#     （本次会话就是 =1）。不剔，Electron 退化成纯 Node，ipcMain / BrowserWindow
#     全 undefined，main.js 第一句就 TypeError。同时剔代理变量：应用内请求要直连。
#     口径与 scripts/electron_env.mjs 的 DROP 清单保持一致。
#  ② **受限环境降级**：沙箱里 Chromium 起不来时日志是
#     "sandbox initialization failed" / "GPU process isn't usable. Goodbye."
#     （exit 133 / SIGTRAP）。默认**不改**启动形态；只有显式 BITBOT_DESKTOP_SAFE=1
#     或自动探测到沙箱不可用时才加 --no-sandbox --disable-gpu + 独立 user-data-dir。
#     绝不静默降级成不安全形态 —— 会打一行说明。
#  ③ **启动要判活**：进程活着 ≠ 起来好了。等日志出现 app= 与 cn-inbound listening，
#     再真打一次 /v1/pair/discover（--noproxy，否则读到的是代理的 502，不是产品）。
#     超时就报红并把日志尾部打出来，不让人对着一个半死的窗口猜。
#
# 用法：
#   bash scripts/start-desktop.sh                 # 前台运行（Ctrl-C 退出）
#   BITBOT_DESKTOP_SAFE=1 bash scripts/start-desktop.sh   # 受限环境强制降级
#   BITBOT_DESKTOP_NO_WAIT=1 bash scripts/start-desktop.sh  # 不判活（CI 用）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"
DESKTOP_DIR="$ROOT/hosts/desktop"

if ! command -v moon >/dev/null 2>&1; then
  echo "error: moon not found; install MoonBit and ensure \$HOME/.moon/bin is on PATH" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm not found" >&2
  exit 1
fi

cd "$DESKTOP_DIR"
if [[ ! -d node_modules/electron ]]; then
  echo "[desktop] npm install…"
  npm install
fi

# Electron 二进制以 electron 包自己写的 path.txt 为准（macOS 是
# Electron.app/Contents/MacOS/Electron，不是 Linux 的 dist/electron）。
ELECTRON_BIN="$(node --input-type=module -e '
import fs from "fs"; import path from "path";
const p = process.argv[1];
const dist = path.join(p, "dist");
const c = [];
try { const r = fs.readFileSync(path.join(p, "path.txt"), "utf8").trim(); if (r) c.push(path.join(dist, r)); } catch (_) {}
c.push(path.join(dist, "electron"), path.join(dist, "electron.exe"),
       path.join(dist, "Electron.app/Contents/MacOS/Electron"));
console.log(c.find((x) => fs.existsSync(x)) || "");
' "$DESKTOP_DIR/node_modules/electron")"
if [[ -z "$ELECTRON_BIN" || ! -x "$ELECTRON_BIN" ]]; then
  echo "error: Electron binary not found under hosts/desktop/node_modules/electron" >&2
  exit 1
fi

echo "[desktop] MoonBit=$(moon version 2>/dev/null | head -1 || true) target=${BITBOT_MOON_TARGET:-native}"
echo "[desktop] launching Electron from hosts/desktop…"

# ① 净化环境。**合并之后剔**，不能先剔后并（会把污染变量又加回来）。
CLEAN_ENV=(env)
for v in ELECTRON_RUN_AS_NODE NODE_OPTIONS HTTP_PROXY HTTPS_PROXY ALL_PROXY \
         http_proxy https_proxy all_proxy; do
  CLEAN_ENV+=(-u "$v")
done

# ② 受限环境降级：显式开关，或探测到 Chromium sandbox 明显不可用。
SAFE_ARGS=()
SAFE=0
if [[ "${BITBOT_DESKTOP_SAFE:-0}" == "1" ]]; then
  SAFE=1
elif [[ "$(uname -s)" == "Darwin" && -n "${CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS:-}" ]]; then
  # 运行在受限 agent 沙箱里：Chromium 的 sandbox 必然拿不到权限，
  # 硬起只会 SIGTRAP 并把 GPU/network service 反复重启刷满日志。
  SAFE=1
fi
if [[ "$SAFE" == "1" ]]; then
  UD="${BITBOT_DESKTOP_USER_DATA_DIR:-/tmp/bitbot-desktop-live-ud}"
  SAFE_ARGS=(--no-sandbox --disable-gpu "--user-data-dir=$UD")
  CLEAN_ENV+=(ELECTRON_DISABLE_SANDBOX=1)
  # 中文全角括号紧邻变量时 bash 会把多字节首字节吃进变量名（实测报
  # "UD?: unbound variable"），所以这里必须写 ${UD} 而不是 $UD。
  echo "[desktop] 受限环境：启用 --no-sandbox --disable-gpu（独立 user-data-dir=${UD}）"
  echo "[desktop] 注：这是降级形态，不等于日常双击 Bit Bot.app 的启动路径"
fi

LOG="${BITBOT_DESKTOP_LOG:-/tmp/bitbot-desktop-boot.log}"
: > "$LOG"

# ③ 判活：日志标记 + 真 HTTP。判活失败要把日志尾部留给人看。
wait_ready() {
  local i
  for i in $(seq 1 120); do              # 最多 ~24s
    if grep -aq 'cn-inbound listening=true' "$LOG" 2>/dev/null; then
      if curl --noproxy '*' -fsS --max-time 2 \
        http://127.0.0.1:18765/v1/pair/discover >/dev/null 2>&1; then
        grep -a 'app="Bit Bot"' "$LOG" | head -1 || true
        echo "[desktop] ready: /v1/pair/discover → 200；日志 $LOG"
        return 0
      fi
    fi
    if grep -aq "GPU process isn't usable\|FATAL" "$LOG" 2>/dev/null; then
      echo "[desktop] FATAL：Chromium 起不来。受限环境请设 BITBOT_DESKTOP_SAFE=1 重试。" >&2
      tail -12 "$LOG" >&2
      return 1
    fi
    # 进程已退出就别空等
    if ! kill -0 "${APP_PID:-}" 2>/dev/null; then
      echo "[desktop] 进程提前退出：" >&2
      tail -12 "$LOG" >&2
      return 1
    fi
    sleep 0.2
  done
  echo "[desktop] 判活超时（~24s）：没等到 cn-inbound listening 或 HTTP 200" >&2
  tail -12 "$LOG" >&2
  return 1
}

if [[ "${BITBOT_DESKTOP_NO_WAIT:-0}" == "1" ]]; then
  exec "${CLEAN_ENV[@]}" "$ELECTRON_BIN" . "${SAFE_ARGS[@]}" > "$LOG" 2>&1
fi

# 前台语义：app 跑在后台子进进、判活通过后 wait 它，Ctrl-C 一起收。
"${CLEAN_ENV[@]}" "$ELECTRON_BIN" . "${SAFE_ARGS[@]}" > "$LOG" 2>&1 &
APP_PID=$!
trap 'kill "$APP_PID" 2>/dev/null || true' EXIT INT TERM
if ! wait_ready; then
  kill "$APP_PID" 2>/dev/null || true
  exit 1
fi
echo "[desktop] pid=${APP_PID}（Ctrl-C 退出）"
wait "$APP_PID"
