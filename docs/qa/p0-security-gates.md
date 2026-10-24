# P0 security gates（AR-15 / Wave 0）

> 合同：[ADR 0008](../adr/0008-remote-turn-auth-and-sandbox.md)、[05-security](../agent-core/05-security.md)。  
> 这些门是 Host 入站 curl / 进程证据。**不是** H4 升 I。CM 的 U PASS 不能抄到 I 列。

| ID | 裁决 | 期望 | 级别 |
|---|---|---|---|
| P0-1 | 本波实现 | `POST /v1/turn` 无 `Authorization` → HTTP **401**，`onTurn` 不调用，`pending-turns.jsonl` 不增长 | Host curl |
| P0-2 | 本波实现 | 坏签名（钉钉 `sign` 错误，以及 turn HMAC 错误）→ HTTP **401**，不唤醒 | Host curl |
| P0-3 | **U 已绿，不升 I** | 无审批 shell 不执行。证据是内核 `acceptance_CM-0702_machine_id_requires_approval` | U only |
| P0-4 | 本波实现 | 请求体超过上限 → HTTP **413**，不唤醒 | Host curl |

## evidence_cmd

```bash
bash scripts/prove_p0_inbound_security.sh
```

脚本会：

1. 在临时目录拉起 loopback 入站（假 `onTurn` 只计数，不跑模型）。
2. `curl` 无 Authorization 的 `POST /v1/turn`，断言 401 且 wake 计数仍为 0。
3. `curl` 钉钉回调带错误 `sign`，断言 401 且 wake 仍为 0。另发一条 turn HMAC 坏签名，同样 401、不唤醒。
4. `curl` 发送 `DEFAULT_MAX_BODY_BYTES + 1`（1048577）字节，断言 413 且 wake 仍为 0。
5. `curl` 带正确 Bearer，断言 200 且恰好唤醒 1 次（证明 401/413 不是把端口打挂）。
6. Host 侧断言：默认 bind 解析为 `127.0.0.1`；入站源码不再固定 `approved:true`；无审批 shell 不创建标记文件；已审批 shell 的子进程环境里没有 `BITBOT_LLM_API_KEY`。

P0-3 不在本脚本里改判。既有 U 命令（有 MoonBit 工具链时）：

```bash
moon test --filter acceptance_CM-0702
```

不要把该测试的 PASS 写进 `docs/qa/artifacts/h6-matrix-i/`。

## 实测

2026-10-24，本分支从 `aaec3b27` 重新接上 `hosts/shared/p0_security.js` 之后：

```bash
bash scripts/prove_p0_inbound_security.sh
```

结果：`prove_p0_inbound_security pass=8 fail=0`，随后 host checks `pass=11 fail=0`。curl 打在临时 loopback 端口（不是固定 18765），假 `onTurn` 只计数。

| 探针 | HTTP | 唤醒 |
|---|---|---|
| `POST /v1/turn` 无 `Authorization` | 401 `unauthorized` | 0 |
| `POST /v1/turn` Bearer 错误 | 401 `invalid_token` | 0 |
| `POST /dingtalk/callback` 错误 `sign` | 401 `bad_signature` | 0 |
| `POST /v1/turn` HMAC 错误 | 401 `bad_signature` | 0 |
| 钉钉正确签名 | 200 | +1 |
| `POST /v1/turn` 1048577 字节 | 413 `payload_too_large` | 不变 |
| `POST /v1/turn` 正确 Bearer | 200 `brain=shared_desktop_host` | +1 |
| `GET /health` | 200 | 响应不含 token |

Host 检查（不是 I）：默认 bind `127.0.0.1`；`BITBOT_BIND_LAN=1` → `0.0.0.0` 且 `warn`；入站 `onTurn` 不再固定 `approved:true`；无审批 shell 不创建标记文件；`cwd=/etc` 拒绝；已审批 shell 能 `echo`，子进程环境与产物都不含 `BITBOT_LLM_API_KEY`。

这些 host-checks 是 P0 旁证，不是 SK。它们变绿不算 `docs/agent-core/05-security-sandbox-secrets.md` 的 residual 已关。SK 只认 `bash scripts/prove_sandbox_secrets.sh`。

P0-3 未升 I。没有改 `docs/qa/artifacts/h6-matrix-i/`。
