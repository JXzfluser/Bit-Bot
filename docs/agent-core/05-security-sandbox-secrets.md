# 沙箱与密钥（SK1–SK8）

状态：接线证据。不是 I。不关 AR-15。不改 capability matrix。不碰 H4。不宣称 MVP。

边界合同：[ADR 0008](../adr/0008-remote-turn-auth-and-sandbox.md) 第 4、7 条，以及 [05-security](05-security.md) 的 Shell / Secret scrub / 移动端。P0 入站 curl 和 AU 审批卡是另外两道门。本页不把它们算进来。

P0-3 仍是 U。内核证据仍是 `acceptance_CM-0702_machine_id_requires_approval`。本页不把它升成 I。

`scripts/prove_p0_inbound_host_checks.js` 里的 cwd / API key 断言是 P0 旁证。它变绿**不算**本页 residual 已关。SK 只认下面这条命令。

## 命令

```bash
bash scripts/prove_sandbox_secrets.sh
```

| ID | 交付 | 期望 |
|---|---|---|
| SK1 | SK-D1 allowlist env | 子进程环境只留 `PATH` `HOME` `USER` `LOGNAME` `LANG` `LC_*` `TZ` `TMPDIR` `SHELL` `TERM` `BITBOT_TZ`。`BITBOT_LLM_API_KEY`、`*_TOKEN`、`*_SECRET`、`*_PASSWORD`、`*_WEBHOOK` 以及名单外的名字都丢掉。缺 `PATH` 时补上默认值 |
| SK2 | SK-D2 审批不放开密钥 | `approved: true`（Allow / CLI 那条 grant）仍然不把密钥放进子进程。`ffiOpts.env` 不能把密钥塞回去。结果和 `data/host-tools/shell` 产物都不含密钥原文 |
| SK3 | SK-D3 cwd | cwd 必须落在允许根（默认仓库根）之内。`/etc` 拒绝。指向允许根之外的符号链接拒绝。允许根内的子目录可以跑，`pwd -P` 是解析后的真实路径 |
| SK4 | SK-D4 超时 | 默认 30 秒（`SHELL_TIMEOUT_MS`）。Host shell 不自行放宽。超时后子进程被杀掉，不再留在进程表里 |
| SK5 | SK-D5 缓冲 | 子进程缓冲默认 256 KiB（`SHELL_MAX_BUFFER`）。超出则失败关闭。落盘前的 stdout 再截到 8000 字符（`SHELL_OUTPUT_CAP`）。Host shell 不自行放宽 |
| SK6 | SK-D6 scrub | 环境里的密钥值在 shell stdout、stderr、错误文本、产物，以及入站 `scrubDeep` 日志里变成 `[redacted]`。长度不足 8 的值不参与替换 |
| SK7 | SK-D7 手机不持 LLM key | iOS / Android / `hosts/mobile_host` 源码不出现 `BITBOT_LLM_API_KEY`。`mobileHostEnv` 丢掉模型密钥，保留 `BITBOT_TURN_TOKEN`。`BITBOT_MOBILE_HOST=1` 时 `resolveLlmConfig` 不用 env，也不用 `active.json` 里的 key |
| SK8 | 控制 | 已审批的普通 `echo` 仍然成功。`rm -rf /` 即使 `approved: true` 也由原拒绝表挡住，且 `ran: false` |

标签与上表同构：脚本对 SK1…SK8 各打一行 `ok` 或 `FAIL`。八行缺一即失败。

## 实测

2026-10-24，本分支从 #16 tip（`353bf767`）切开之后：

```bash
bash scripts/prove_sandbox_secrets.sh
```

`prove_sandbox_secrets pass=8 fail=0`。SK1…SK8 各一行。同一工作区 `bash scripts/prove_p0_inbound_security.sh` 仍是 `pass=8 fail=0`（host-checks `pass=11 fail=0`）。那条 host-checks 不是本页的关闭证据。

P0-3 未升 I。AR-15 未关。没有改 capability matrix，没有写 `docs/qa/artifacts/h6-matrix-i/`。

## 非目标

- 不把 P0-1/2/4 的 curl，或 AU1–AU7 的审批卡，写成 SK 已绿。
- 不把 host-checks 旁证写成 residual 已关。
- 不关 AR-15，不升 I，不改 matrix，不宣称 MVP。
- 不把 shell 做成完整文件系统监狱。cwd 允许列表、最小 env、超时、缓冲、scrub 是这道门。危险命令仍走原来的拒绝表。
