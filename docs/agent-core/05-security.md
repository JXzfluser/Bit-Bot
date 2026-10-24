# 安全参考（Wave 0 / AR-15）

> 状态：Accepted 合同的实现说明。决策见 [ADR 0008](../adr/0008-remote-turn-auth-and-sandbox.md)。  
> 口径：Host 入站与 shell 边界。`CM-*` 的 U PASS 不是 I，也不能代替下面的 curl 门。

## 威胁

| 威胁 | 以前 | 现在 |
|---|---|---|
| 局域网任意人 `POST /v1/turn` | 无认证，且入站回合 `approved:true` | 无 Bearer → 401，不唤醒；入站 `approved:false` |
| 默认监听 `0.0.0.0` | 一开机就对网卡开放 | 默认 `127.0.0.1`；LAN 要显式打开并告警 |
| 伪造审批 | 效果参数 `approved=true`，或远程回合固定批准 | 只有本回合用户动作 / CLI `--approved` / 已保存的 allow 规则 |
| Shell 偷密钥 | `/bin/bash -lc` 继承 `process.env` | 最小 env；cwd 允许列表；超时与输出上限 |
| 渠道回调伪造 | 钉钉「有 token 才验」，缺签名仍入队 | 签名必填，常量时间比较，失败 401 且不入队 |
| 超大 body | `readBody` 无上限 | 默认 1 MiB，超出 413，不唤醒 |
| 日志泄漏 | 错误和产物可能带上 API key | 写入前 scrub |

## `/v1/turn`

- 凭证：`Authorization: Bearer <token>`。
- Token 来源，按顺序：构造参数 `turnToken`、环境变量 `BITBOT_TURN_TOKEN`、`data/host/turn-token`（0600，缺失则生成）。状态接口不返回 token 原文。
- 没有 `Authorization` 头：`401`，`error=unauthorized`。
- Bearer 不对：`401`，`error=invalid_token`。
- 另一种凭证（给不想把 token 放在 Authorization 的客户端）：`X-Bitbot-Timestamp`（毫秒）、`X-Bitbot-Nonce`、`X-Bitbot-Signature` = hex HMAC-SHA256(token, `timestamp + "\n" + nonce + "\n" + rawBody`)。过期、重放、或摘要不对都是 401，并且不调用 `onTurn`。
- `GET /health` 仍不要求 token，便于本机探活。它不返回密钥。

## Bind

| 配置 | 结果 |
|---|---|
| 什么都不设 | `127.0.0.1` |
| `BITBOT_CN_INBOUND_HOST=<ip>` | 使用该地址；非 loopback 则告警 |
| `BITBOT_BIND_LAN=1` | `0.0.0.0` 并告警 |

## 审批

远程入站（`cn_inbound_product_on_turn` 与 Desktop `ensureCnInbound`）固定 `approved:false`。桌面上用户点击 Allow、以及 CLI 显式 `--approved`，仍然是本回合的用户动作。已保存的 auto-review allow / `local_execution=always` 是先前的用户配置，不是请求体里的字段。

MCP / 效果参数里的 `args.approved` 不再放行 shell。

## Shell

- 可继承：`PATH`、`HOME`、`USER`、`LOGNAME`、`LANG`、`LC_*`、`TZ`、`TMPDIR`、`SHELL`、`TERM`、`BITBOT_TZ`。
- 不可继承：`BITBOT_LLM_API_KEY` 以及名字以 `_KEY`、`_TOKEN`、`_SECRET`、`_PASSWORD`、`_WEBHOOK` 结尾的变量。
- cwd 必须在允许根之下，默认是仓库根。
- 超时 30 秒；子进程缓冲 256 KiB；落盘文本再截断。
- 无审批：`needs_approval`，`ran:false`，不启动 bash。危险命令仍由原拒绝表挡住。

P0-3 的内核证据仍是 `box_host` 的 `acceptance_CM-0702_machine_id_requires_approval`（U）。Host 沙箱是第二条边界，**不**把该 CM 升为 I。

## Webhook

| 渠道 | Secret | 签名 |
|---|---|---|
| 钉钉 | `BITBOT_DINGTALK_APP_SECRET` | 头 `timestamp` + `sign` = base64 HMAC-SHA256 |
| 飞书 | `BITBOT_FEISHU_ENCRYPT_KEY`，否则 `BITBOT_FEISHU_VERIFICATION_TOKEN` | `X-Lark-Request-Timestamp` / `X-Lark-Request-Nonce` / `X-Lark-Signature` = sha256(ts + nonce + key + body) |
| 企微 | `BITBOT_WECOM_CALLBACK_TOKEN`，否则 `BITBOT_WECOM_TOKEN` | query `msg_signature` / `timestamp` / `nonce`（及 `echostr` 或 body）的 sha1 |

Secret 未设置、头缺失、摘要不对：一律 401，不 `enqueueTurn`。

## Body

`BITBOT_INBOUND_MAX_BODY` 默认 `1048576`。`Content-Length` 或实际字节超出 → 413 `payload_too_large`。

## 移动端

iOS `TurnBridge` 与 Android `TurnBridge` 从「凭证」或 `BITBOT_TURN_TOKEN` 读取 token，并放进 `Authorization`。Simulator / 模拟器默认打到本机 Desktop；真机要 Desktop 显式 LAN bind，并在手机上配置同一个 token。DeepSeek key 不进手机。

## 验收命令

P0、AU、SK 是三道门。过一道不算另外一道。P0 的 host-checks 旁证不算 SK residual 已关。

```bash
bash scripts/prove_p0_inbound_security.sh
bash scripts/prove_sandbox_secrets.sh
```

入站 curl 对照 `docs/qa/p0-security-gates.md`。沙箱与密钥对照 `docs/agent-core/05-security-sandbox-secrets.md`（SK1–SK8）。两条都不关 AR-15，都不升 I。
