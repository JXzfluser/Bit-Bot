# ADR 0008 — 远程 turn 认证、loopback、shell 沙箱、审批不可伪造

- 状态：Accepted
- 日期：2026-10-24
- 决策者：Bit架构
- 关联：`docs/agent-core/05-security.md`、`docs/agent-core/README.md` Wave 0、`docs/qa/p0-security-gates.md`
- 实现：`hosts/shared/p0_security.js`、`hosts/shared/cn_inbound_server.js`

## 背景

未认证的 `POST /v1/turn`、默认 `0.0.0.0:18765`、入站回合固定 `approved:true`、以及 `/bin/bash -lc` 继承完整 `process.env`，叠在一起就是远程代码执行。钉钉签名原先只在「secret、timestamp、sign 三者都有」时才比较，缺签名的回调会直接入队。`readBody` 没有上限。

CM 的 U PASS（例如 CM-0702 无审批 shell）证明的是内核合同，不是这条 Host 入站面。本 ADR 不把任何 CM 从 U 升到 I。

## 决策

1. **`/v1/turn` 与 `/turn` 必须带凭证。** `Authorization: Bearer <BITBOT_TURN_TOKEN>`，常量时间比较。没有 `Authorization` → HTTP **401** `unauthorized`，不调用 `onTurn`，不写 `pending-turns.jsonl`。Bearer 不匹配 → 401 `invalid_token`。可选签名：`X-Bitbot-Timestamp` + `X-Bitbot-Nonce` + `X-Bitbot-Signature`（HMAC-SHA256，5 分钟窗口，nonce 不可重放）；签名错误 → 401 `bad_signature`，同样不唤醒。
2. **默认 bind `127.0.0.1`。** 只有显式 `BITBOT_CN_INBOUND_HOST` 或 `BITBOT_BIND_LAN=1` 才监听非 loopback，并在 stderr 告警。告警不打印 token。
3. **禁止固定 `approved:true`。** 远程入站 / 移动端 `onTurn` 不得把 `approved:true` 当作默认。审批只能来自本回合的真实用户动作（桌面 Allow、CLI `--approved`、已保存的 auto-review allow 规则）。效果参数里的 `approved=true` 不能铸成审批。
4. **Shell 沙箱。** 用户 shell 使用最小环境（`PATH`/`HOME`/`USER`/`LANG`/`TZ`/`BITBOT_TZ` 等），**不**继承 `BITBOT_LLM_API_KEY` 及其他 `*_KEY`/`*_TOKEN`/`*_SECRET`/`*_PASSWORD`/`*_WEBHOOK`。cwd 必须落在允许根（默认仓库根）内。超时 30s，输出上限 256KiB（落盘再截断）。无审批的 shell 不执行。不可逆/危险命令仍走原有拒绝表。
5. **Webhook 签名必填。** 钉钉、飞书、企微在 secret 未配置、签名缺失或签名错误时 HTTP **401**，不入队。比较走常量时间。钉钉算法维持 `base64(HMAC-SHA256(timestamp + "\n" + secret))`。
6. **Body 上限。** 入站请求体默认 1 MiB（`BITBOT_INBOUND_MAX_BODY` 可覆盖）。超出 → HTTP **413** `payload_too_large`，不解析、不唤醒。
7. **Secret scrub。** 日志、错误响应、shell 产物里的 secret 值替换为 `[redacted]`。子进程环境按第 4 条裁剪。

## 非目标

- 不重写审批 UI。
- 不把 P0-3（无审批 shell 的内核 U 证据）升为 I。H4 矩阵证据目录不动。
- 不把 `CM-*` U PASS 写成 I-PASS。
- 不在这一决策里实现 Agent Loop。

## 后果

- 移动端连接 Desktop 时必须配置同一个 `BITBOT_TURN_TOKEN`（环境变量、`data/host/turn-token`，或应用「凭证」存储）。DeepSeek key 仍只在 Desktop。
- 物理手机访问局域网 IP 前，操作者要显式打开 LAN bind，并接受告警。
- 渠道回调在控制台配好签名 secret 之前会 401。这是失败关闭，不是残缺的可选校验。

## 验收

见 `docs/qa/p0-security-gates.md`。`evidence_cmd`：

```bash
bash scripts/prove_p0_inbound_security.sh
```

P0-1 / P0-2 / P0-4 用 curl 对 loopback 入站证伪。P0-3 维持既有内核 U 测试，本 ADR 的 Host shell 沙箱是额外边界，不升 I。
