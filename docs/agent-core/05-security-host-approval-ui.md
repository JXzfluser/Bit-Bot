# Host 审批 UI

状态：Accepted。这是接线边界，不是 I，不关 AR-15 状态列，不改 capability matrix，不碰 H4，不宣称 Agent Loop MVP 或 Desktop Agent Loop MVP。

本页在本工作区原先不存在。内容按 ADR 0008（远程回合不得默认带上审批放行）和 `docs/qa/p0-security-gates.md` 的 P0-3（无审批则 shell 不执行；内核证据仍是 `acceptance_CM-0702_machine_id_requires_approval`，U，不升 I）写死 Host 审批 UI 这一段。

P0-3 保持 U。本页的 UI 证据不是那条内核验收，也不把它写成 I。

## 路径

1. 产品 Chat 仍走 `open_turn` → `AgentLoop::run`。Shell 在 Call 边界发出 `request_approval`。Host 回答这一行 FFI，不另开一套模型循环。
2. Desktop 在飞行中的回合上弹出审批卡（`#loop-approval`）。Allow 回 `verdict=allow`，Deny 回 `verdict=deny`。内核 Allow 之后才 `exec_tool`。Deny 的观察是 `approval denied`，没有 `exec_tool`。
3. 卡上的按钮只调用 `bitbot:loop-approval:answer`。不第二次 `runUserTurn`，不调用 `executeLlmChat`。
4. 合法放行，四条都留着：
   - Desktop Allow：用户点当前这张卡的 Allow。
   - `bitbot:approvals:runAllowed`：仅当记录过的 grant 与这次的 turn id、动作一致时，才带着既有的 `approved: true` 执行。用过即失效。
   - CLI `--approved`：只放行该进程这一回合里被批准的那个动作。
   - 已存 allow 规则，或 `local_execution=always`：这一回合这个动作可以不弹卡。`local_execution=never` 拒绝。
5. `bitbot:secrets:probeCnChannels` 里的 `sessionId: "cn-probe"` 与 `approved: true` 是渠道试连，保持不动。产品 `bitbot:turn` 的会话不是 `cn-probe`，试连参数不进入产品回合。
6. 伪造到不了执行：
   - 工具参数里的 `approved` 不构成 grant。
   - 远程 inbound（Desktop `ensureCnInbound` 与 `createProductOnTurn`）默认 `approved: false`。
   - 没有活卡时的 answer IPC，或 id 对不上，返回 `no_card`，不执行。
   - 另一个 turn id，或同一 turn 的另一个动作，`runAllowed` 返回 `no_grant`，不执行。
7. 没有 UI 回调时（WP 证明脚本），`BITBOT_LOOP_APPROVAL` 仍决定 allow / deny / cancel。装了回调之后，这个环境变量不能代替那张卡。

## 验收

AU1–AU4 是这条链的最低条。AU5–AU7 一起跑。通过这些门不关闭 AR-15，不把 P0-3 升成 I，也不把结果写成 MVP。

| ID | 最低条 | 期望 |
|---|---|---|
| AU1 | 是 | 真实 Electron 回合还在飞时，内核 `request_approval` 之后、任何 shell `exec_tool` 之前，出现 `#loop-approval`。工具参数可以带 `"approved":true`，卡仍然出现 |
| AU2 | 是 | 点这张卡的 Allow。Host 回 allow。`exec_tool` 的 trace `at` 晚于点击。观察是 `[product-shell]`，不是跳过审批 |
| AU3 | 是 | 点这张卡的 Deny。`request_approval` 之后没有 `exec_tool`。观察含 `approval denied` |
| AU4 | 是 | 伪造不可达：`args.approved` 不放行；无卡的 `runAllowed` 或 answer IPC 不执行；跨 turn 或错 action 的 grant 不执行 |
| AU5 | 否 | 合法路径：Desktop Allow（AU2）、`runAllowed` 仅同一 turn+action、CLI `--approved` 只放行该 turn、已存 allow 可以不弹卡 |
| AU6 | 否 | cn-probe 的 `sessionId:"cn-probe"` 与 `approved: true` 仍是渠道试连。产品 chat turn 的 session 不是 `cn-probe` |
| AU7 | 否 | 远程 inbound 默认不是 `approved: true`。无卡 IPC 不能放行 |

证明脚本里的 `ok` / `FAIL` 标签与上表同号。WP SoT `bash scripts/prove_agent_loop_product_wire.sh` 由同一条 evidence_cmd 再跑，必须 fail=0。那一行不编号成 AU，也不改写 WP1–WP8 的已有裁决。

## evidence_cmd

```bash
bash scripts/prove_host_approval_ui.sh
```

脚本拉起真实 `hosts/desktop/main.js`。AU1–AU4 在飞行中的 Chat 里读审批卡、trace 和 loopback provider。AU5 覆盖同一 turn+action 的 `runAllowed`、已存 allow，以及 CLI `--approved`。AU6–AU7 核对 cn-probe 试连与 inbound 默认值。缺 Electron、显示或 moon 时失败退出，不把缺工具链写成 PASS。
