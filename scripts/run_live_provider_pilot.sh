#!/usr/bin/env bash
# 真 provider 五棒演练（一键）
#
# 为什么要有这个脚本：
#   之前 13 轮真 MiniMax 实跑，每次都**撞闸之后**才发现问题
#   （401 认证失败 / 402 余额不足 / 模型已下线），一轮跑几分钟。
#   ⇒ 这个脚本**先预检**：认证通不通、模型在不在、账户有没有余额、
#     再决定要不要花十几分钟跑五棒。
#
# 用法：
#   BITBOT_LLM_MINIMAX_API_KEY=sk-xxx  bash scripts/run_live_provider_pilot.sh
#   # 或指定别的 provider：
#   BITBOT_LLM_PROVIDER=deepseek BITBOT_LLM_API_KEY=sk-xxx bash scripts/run_live_provider_pilot.sh
#
# 产物落在隔离数据根里（BITBOT_DATA_ROOT），**不碰用户真数据**。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PROVIDER="${BITBOT_LLM_PROVIDER:-minimax}"
case "$PROVIDER" in
  minimax)
    : "${BITBOT_LLM_MINIMAX_API_KEY:?需要 BITBOT_LLM_MINIMAX_API_KEY}"
    KEY_VAR=BITBOT_LLM_MINIMAX_API_KEY
    BASE_VAR=BITBOT_LLM_MINIMAX_BASE_URL
    MODEL_VAR=BITBOT_LLM_MINIMAX_MODEL
    DEFAULT_BASE="https://api.minimax.chat/v1"
    DEFAULT_MODEL="MiniMax-M3.1-Flash"
    ;;
  deepseek)
    : "${BITBOT_LLM_API_KEY:?需要 BITBOT_LLM_API_KEY}"
    KEY_VAR=BITBOT_LLM_API_KEY
    BASE_VAR=BITBOT_LLM_BASE_URL
    MODEL_VAR=BITBOT_LLM_MODEL
    DEFAULT_BASE="https://api.deepseek.com/v1"
    DEFAULT_MODEL="deepseek-chat"
    ;;
  qwen)
    : "${BITBOT_LLM_QWEN_API_KEY:?需要 BITBOT_LLM_QWEN_API_KEY}"
    KEY_VAR=BITBOT_LLM_QWEN_API_KEY
    BASE_VAR=BITBOT_LLM_QWEN_BASE_URL
    MODEL_VAR=BITBOT_LLM_QWEN_MODEL
    DEFAULT_BASE="https://dashscope.aliyuncs.com/compatible-mode/v1"
    DEFAULT_MODEL="qwen-plus"
    ;;
  moonshot)
    : "${BITBOT_LLM_MOONSHOT_API_KEY:?需要 BITBOT_LLM_MOONSHOT_API_KEY}"
    KEY_VAR=BITBOT_LLM_MOONSHOT_API_KEY
    BASE_VAR=BITBOT_LLM_MOONSHOT_BASE_URL
    MODEL_VAR=BITBOT_LLM_MOONSHOT_MODEL
    DEFAULT_BASE="https://api.moonshot.cn/v1"
    DEFAULT_MODEL="moonshot-v1-8k"
    ;;
  *)
    echo "不支持的 provider：$PROVIDER（支持 minimax / deepseek / qwen / moonshot）" >&2
    exit 2
    ;;
esac

# 把 base / model **显式**写出来（不是必须，但有价值）：
#   · resolveLlmConfig 的 scopedEnv 在 provider 有专属 env_base 时**不回落全局**
#     （provider 有专属名但没给值 ⇒ 取空），不过后面还有 provider.base_url 兜底
#     ⇒ 只给 key 其实也能跑（走内置端点）。
#   · 显式写出来是**为了让用户看得见实际打向哪个端点** ——
#     国内端 api.minimax.chat 与国际端 api.minimaxi.chat **密钥不通用**，
#     显式写出来才不会「以为在用国际端、其实打的是国内端」。
export "$BASE_VAR=${!BASE_VAR:-$DEFAULT_BASE}"
export "$MODEL_VAR=${!MODEL_VAR:-$DEFAULT_MODEL}"
export BITBOT_LLM_PROVIDER="$PROVIDER"
# 间接展开的结果落到普通变量（`${!VAR:-x}` 不是合法 bash 语法）。
BASE_VALUE="${!BASE_VAR}"
MODEL_VALUE="${!MODEL_VAR}"

echo "=== 真 provider 五棒演练 ==="
echo "  provider : $PROVIDER"
echo "  base     : ${!BASE_VAR}"
echo "  model    : ${!MODEL_VAR}"
# 间接展开取长度：${#!VAR} 不是合法 bash 语法 ⇒ 先落到普通变量再取长度。
KEY_VALUE="${!KEY_VAR}"
echo "  key 变量 : $KEY_VAR（长度 ${#KEY_VALUE}，不显示内容）"

# ---- 预检 1：端点可达 + 认证 ----
echo
echo "--- 预检 1/3：端点可达 + 认证 ---"
HTTP=$(curl -s -o /tmp/live-pilot-models.json -w "%{http_code}" \
  --max-time 25 -H "Authorization: Bearer $KEY_VALUE" "${!BASE_VAR}/models" 2>/dev/null)
case "$HTTP" in
  200) echo "  ✓ 认证通过（HTTP 200）" ;;
  401|403)
    echo "  ✗ 认证失败（HTTP $HTTP）⇒ key 无效，或这个 key 不适用于这个端点。" >&2
    echo "    注意：国内端 api.minimax.chat 与国际端 api.minimaxi.chat **密钥不通用**。" >&2
    exit 3 ;;
  402)
    echo "  ✗ 账户余额不足（HTTP 402）⇒ 充值后再跑。" >&2
    exit 3 ;;
  000)
    echo "  ✗ 连不上 ${!BASE_VAR}（网络不通）⇒ 跑五棒只会白等。" >&2
    exit 3 ;;
  *) echo "  ! 端点返回 HTTP $HTTP（不一定是致命问题，继续往下走）" ;;
esac

# ---- 预检 2：模型在不在 ----
echo
echo "--- 预检 2/3：模型是否可用 ---"
if [ "$HTTP" = "200" ]; then
  node -e '
    const fs=require("fs");
    let ids=[];
    try { const d=JSON.parse(fs.readFileSync("/tmp/live-pilot-models.json","utf8")); ids=(d.data||[]).map(x=>String(x.id||"")); } catch(e) {}
    const want=process.argv[1];
    if (!ids.length) { console.log("  ? 拿不到模型列表（跳过这项检查）"); process.exit(0); }
    const hit=ids.find(i=>i===want) || ids.find(i=>i.toLowerCase().includes(want.toLowerCase().split("-").slice(-1)[0]));
    if (hit) console.log("  ✓ 模型可用："+hit);
    else { console.log("  ✗ 列表里没有 "+want+"（现有："+ids.slice(0,6).join(", ")+"）"); process.exit(4); }
  ' "$DEFAULT_MODEL" || exit 4
else
  echo "  ? 拿不到模型列表（跳过这项检查）"
fi

# ---- 预检 3：真打一次 chat ----
echo
echo "--- 预检 3/3：真打一次 chat（验账户能出 token）---"
CHAT=$(curl -s -o /tmp/live-pilot-chat.json -w "%{http_code}" --max-time 60 \
  -H "Authorization: Bearer $KEY_VALUE" -H "Content-Type: application/json" \
  -d "{\"model\":\"${!MODEL_VAR}\",\"messages\":[{\"role\":\"user\",\"content\":\"说「好」一个字\"}],\"max_tokens\":16}" \
  "$BASE_VALUE/chat/completions" 2>/dev/null)
case "$CHAT" in
  200)
    node -e '
      const fs=require("fs");
      try {
        const d=JSON.parse(fs.readFileSync("/tmp/live-pilot-chat.json","utf8"));
        const t=(d.choices&&d.choices[0]&&d.choices[0].message&&d.choices[0].message.content)||"";
        console.log("  ✓ 出 token 成功："+String(t).trim().slice(0,40));
      } catch(e) { console.log("  ! 响应结构异常（不影响，继续）"); }
    ' ;;
  402) echo "  ✗ 账户余额不足（HTTP 402）" >&2; exit 3 ;;
  404) echo "  ✗ 模型不存在（HTTP 404）⇒ 换 BITBOT_LLM_*_MODEL 再试" >&2; exit 4 ;;
  429) echo "  ! 限流（HTTP 429）⇒ 等一会儿再跑" >&2; exit 3 ;;
  *)   echo "  ✗ chat 失败（HTTP $CHAT）" >&2; head -c 300 /tmp/live-pilot-chat.json; exit 3 ;;
esac

# ---- 真跑五棒 ----
echo
echo "=== 真跑五棒（真 Electron + 真 provider + 真网络找料）==="
export BITBOT_CREATOR_LIVE_PROVIDER=1
export BITBOT_KEEP_GATE_ROOT=1
export PATH="$HOME/.moon/bin:$PATH"
export ELECTRON_DISABLE_SANDBOX=1
export PLAYWRIGHT_CORE_PATH="$REPO_ROOT/hosts/desktop/node_modules/playwright-core"
export BITBOT_ROOM_RESPONDER_TIMEOUT_MS="${BITBOT_ROOM_RESPONDER_TIMEOUT_MS:-600000}"
# 真 provider 一棒要写完 + 自检 + 改，一次调用 10~20 秒 ⇒ 20 次 / 180 秒
# 那个闸根本不够写一棒（实测第十轮：第二棒直接撞闸，流水线 1/2 中断）。
# ⇒ 真 provider 演练用宽预算；本地 stub 门禁走默认值（30 次 / 600 秒），
#    死循环照样由内核的「连续工具失败就停」与本闸兜住。
export BITBOT_LLM_CALL_GUARD_MAX="${BITBOT_LLM_CALL_GUARD_MAX:-60}"
# 内核 turn 超时（BITBOT_KERNEL_TIMEOUT_MS 默认 180000 = 3 分钟）。
# 真 provider 写一棒要几分钟（实测第二棒 6000+ 字）⇒ 3 分钟不够，
# 实测第十二轮第二棒直接 kernel_timeout（in_flight=k48）⇒ 链又断在第二棒。
# ⇒ 真 provider 演练用 15 分钟；本地 stub 门禁走默认值（门禁照样快）。
export BITBOT_KERNEL_TIMEOUT_MS="${BITBOT_KERNEL_TIMEOUT_MS:-900000}"
export BITBOT_LLM_CALL_GUARD_WINDOW_MS="${BITBOT_LLM_CALL_GUARD_WINDOW_MS:-900000}"

timeout "${PILOT_TIMEOUT:-2400}" xvfb-run -a node scripts/e2e_desktop_creator_pipeline.mjs
RC=$?

echo
echo "=== 结果 ==="
if [ "$RC" -eq 0 ]; then
  echo "  ✓ 五棒全过（真 provider）"
else
  echo "  ✗ 演练红（exit=$RC）⇒ 看上面的 LIVE-01~05 断言与产物目录"
fi
echo "  隔离数据根保留在：$(ls -dt /tmp/bitbot-e2e-creator-* 2>/dev/null | head -1)"
exit $RC
