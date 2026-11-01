# Host 审批 UI 门禁（AU1–AU7）

状态：接线证据。不是 I。不关 AR-15。不改 capability matrix。不碰 H4。不宣称 Agent Loop MVP 或 Desktop Agent Loop MVP。

边界：`docs/agent-core/05-security-host-approval-ui.md`。

P0-3 仍是 U。内核证据仍是 `acceptance_CM-0702_machine_id_requires_approval`。本页不把它升成 I。

## 命令

```bash
bash scripts/prove_host_approval_ui.sh
```

| ID | 最低条 | 期望 |
|---|---|---|
| AU1 | 是 | 飞行中 `request_approval` 之后、shell `exec_tool` 之前出现 `#loop-approval`。参数 `"approved":true` 仍然弹卡 |
| AU2 | 是 | Allow 之后 `exec_tool` 的 trace `at` 晚于点击，观察为 `[product-shell]` |
| AU3 | 是 | Deny 之后没有 `exec_tool`，观察含 `approval denied` |
| AU4 | 是 | `args.approved`、无卡 IPC、跨 turn、错 action 都不执行 |
| AU5 | 否 | Desktop Allow、同 turn+action 的 `runAllowed`、CLI `--approved`、已存 allow |
| AU6 | 否 | cn-probe 试连保持；产品 turn 的 session 不是 `cn-probe` |
| AU7 | 否 | inbound 默认 `approved: false`；无卡 IPC 不放行 |

WP SoT 在同一条命令里再跑，不编号为 AU。

## 本地结果

`bash scripts/prove_host_approval_ui.sh`

`prove_host_approval_ui pass=69 fail=0`

其中 `prove_agent_loop_product_wire pass` 为 fail=0，moon `failed: 0`。这一行不是 AU，也不改 WP1–WP8 的裁决。P0-3 仍是 U。AR-15 未关。

## 2026-10-28 复跑（live Electron）

`prove_host_approval_ui pass=69 fail=0`，与 10-24 记录一致。

此前一段时间这条门禁在本机起不来，报 `Error: Process failed to launch!`，一度被归因为「残留 Electron 实例持全局单实例锁」。**归因错了**。真因在门禁自己的环境净化顺序上：

- `scripts/electron_env.mjs` 的 `electronLaunchEnv()` 先 `{...process.env}`、再删 `ELECTRON_RUN_AS_NODE`、最后 `Object.assign(env, extra)`；
- 而本脚本的 `llmEnv()` 把 `process.env` 展开进了 `extra`，于是 `ELECTRON_RUN_AS_NODE=1` 在剔除之后又被加了回来；
- electron 因此在 node 模式下启动，不认 playwright 传的 `--remote-debugging-port=0` → `bad option` → 启动握手失败。

修法是把它放回单一真源：**先合并、后剔除**。EG 之所以一直是绿的，是因为它传给 `electronLaunchEnv` 的只有 `BITBOT_*` 白名单字段，没有把 `process.env` 带进去。

用 `DEBUG=pw:browser` 复现时能看到决定性那一行：`[err] … bad option: --remote-debugging-port=0`。以后再遇到同类症状，先看这行，不要去猜锁。
