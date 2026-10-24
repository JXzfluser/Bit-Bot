# 沙箱与密钥（SK1–SK8）

状态：接线证据。不是 I。不关 AR-15。不改 capability matrix。不碰 H4。不宣称 MVP。不宣称 residual 已关。

边界合同：[ADR 0008](../adr/0008-remote-turn-auth-and-sandbox.md) 第 4、7 条，以及 [05-security](05-security.md) 的 Shell / Secret scrub / 移动端。P0 入站 curl 和 AU 审批卡是另外两道门。本页不把它们算进来。

P0-3 仍是 U。内核证据仍是 `acceptance_CM-0702_machine_id_requires_approval`。本页不把它升成 I。

`scripts/prove_p0_inbound_host_checks.js` 里的 cwd / API key 断言是 P0 旁证。它变绿不算本页 residual 已关。SK 只认下面这条命令。

## 命令

```bash
bash scripts/prove_sandbox_secrets.sh
```

## 4. Binding

`ok SK1` … `ok SK8` 与下面八行逐字同构。脚本对每一行打一个 `ok` 或 `FAIL`。八行缺一即失败。phone host 不在此列。danger / echo 不在此列。

- SK1 allowlist env keeps LC_* PATH HOME BITBOT_TZ and drops secrets
- SK2 approval does not release secrets
- SK3 shell artifacts do not contain the model key or turn token
- SK4 cwd stays inside the allow root
- SK5 scrub removes secret values from stdout stderr and inbound logs
- SK6 shell timeout kills the child and the buffer cap fail-closes
- SK7 health 401 and 413 bodies do not leak the turn token or LLM API key
- SK8 regression P0 prove is green, P0-3 stays U, AU is not overturned

| ID | 断言 |
|---|---|
| SK1 | 子进程环境只留 `PATH` `HOME` `USER` `LOGNAME` `LANG` `LC_*` `TZ` `TMPDIR` `SHELL` `TERM` `BITBOT_TZ`。`BITBOT_LLM_API_KEY`、`*_TOKEN`、`*_SECRET`、`*_PASSWORD`、`*_WEBHOOK` 以及名单外的名字都丢掉。缺 `PATH` 时补上默认值 |
| SK2 | `approved: true` 仍然不把密钥放进子进程。`ffiOpts.env` 不能把密钥塞回去。本行只看子进程结果，不看产物 |
| SK3 | 独立产物行。`data/host-tools/shell` 里有已审批 shell 写下的产物，且产物不含模型密钥原文，也不含 turn token 原文 |
| SK4 | cwd 必须落在允许根之内。`/etc` 拒绝。指向允许根之外的符号链接拒绝。允许根内的子目录可以跑，`pwd -P` 是解析后的真实路径 |
| SK5 | 环境里的密钥值在 shell stdout、stderr、错误文本，以及入站 `scrubDeep` 日志里变成 `[redacted]`。长度不足 8 的值不参与替换。本行不是产物行 |
| SK6 | 超时与缓冲同一行。默认 30 秒（`SHELL_TIMEOUT_MS`），超时后子进程被杀掉。缓冲默认 256 KiB（`SHELL_MAX_BUFFER`），超出则失败关闭。stdout 再截到 8000 字符（`SHELL_OUTPUT_CAP`）。Host shell 不自行放宽这两项 |
| SK7 | 现场 `GET /health`、无 Authorization 的 `POST /v1/turn`（401）、超过 1 MiB 的请求（413）。这三段响应体都不含 turn token，也不含 LLM API key。phone host 不是本行 |
| SK8 | 回归声明。`bash scripts/prove_p0_inbound_security.sh` 为绿（`prove_p0_inbound_security pass=8 fail=0`）。P0-3 仍只是 U（`docs/qa/p0-security-gates.md` 该行仍是 U only，不升 I）。AU 不倒裁（`docs/qa/host-approval-ui-gates.md` 仍是 `pass=69 fail=0`，入站仍是 `approved: false`）。danger / echo 不是本行 |

## 实测

2026-10-24，标签改与本节 §4 同构之后，复跑：

```bash
bash scripts/prove_sandbox_secrets.sh
```

结果待本分支复跑写入。P0 host-checks 不是本页的关闭证据。

P0-3 未升 I。AR-15 未关。residual 未关。没有改 capability matrix。

## 非目标

- 不把 P0-1/2/4 的 curl，或 AU1–AU7 的审批卡，写成 SK 已绿。
- 不把 host-checks 旁证写成 residual 已关。
- 不把 phone host 标成 SK7。手机不持模型密钥仍可作旁证，但不是 §4 的 SK7。
- 不把 danger / echo 标成 SK8。危险命令仍走原来的拒绝表，那不是回归声明。
- 不关 AR-15，不升 I，不改 matrix，不宣称 MVP，不宣称 residual 已关。
- 不把 shell 做成完整文件系统监狱。cwd 允许列表、最小 env、超时、缓冲、scrub 是这道门。
