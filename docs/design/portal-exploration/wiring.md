# v8 交互 × 当前项目：接线图

> 这份文档回答“v8 的交互深度具体落在现有代码的哪里”。
> 不是愿望清单——下面每个 API 都是现在就存在、指挥台已经在用的。

## 一、事实核对（我读了代码，不是猜）

| 能力 | 真实位置 | 现状 |
|---|---|---|
| 消息 DOM | `index.html:5991 addMsg(role,text,opts)` | 每行 `<div class="msg {role}"><div class="role">…<div class="body">`；`opts.mid` → `dataset.mid`；`opts.speaker` → `botSpeakerHead` |
| 消息操作条 | `attachMessageActions(el, role, text)` @6217 | ghost 图标 `↩ 😊 ⧉ ↺`，`iconActionBtn(glyph,i18nKey)`；有 mid 才挂 |
| 反应 | `renderReactions` @6197 + `sessions.react` | chip 从 store 行渲染，点 chip 走同一 IPC 撤销 |
| 右键·会话 | `showSessionMenu` @7472 | 重命名 / 删除 / 对话详情 |
| 右键·Bot | `showBotMenu` @16561 | 置顶 / 编辑 / 设置 / 分组 / 删除 |
| 指挥台聚合 | `hosts/shared/task_view.js` | `aggregateCommandTasks` 唯一一份；桌面与手机共用 |
| 指挥动作 | `index.html:26774+` | `rooms.steerTask` / `replanTask` / `cancelTask` / `swapAssignee` |
| 任务实体 | `data/desktop/tasks.json` | `{id: room_id|sig, room_id, state, task, question, waiting_since, …}` |
| 转录带钩 | `product_surface.js` 多处 | `task_sig` 落在 bot_reply / task_state 转录行 |
| 跨端 | `cn_inbound_server.js` | `/v1/tasks` `/v1/approvals` `/v1/turn` `/v1/events` |

**关键洞察**：`addMsg` 已有 `opts`（mid / speaker / reactions / replyTo / artifacts）。
任务钩子不需要新组件族——它是 `opts.task` 的一种，跟 `opts.artifacts` 一样挂在消息行上。

## 二、v8 六个交互落到哪里

### 1. 消息内任务钩子 → `addMsg` 的 `opts.task`

```js
// 现在的调用形态（举例，非真实行号）：
addMsg("assistant", text, { mid, speaker, reactions, replyToText, artifacts });
// 加一个可选字段，行为与 artifacts 完全同构：
addMsg("assistant", text, { …, task: { sig, state, question, choices } });
```

渲染时插入 `.task-hook`（视觉复用引用卡语言：1px 边框、10px 圆角、11px meta），
**放在 `.body` 之后、`.msg-actions` 之前**——位置跟 `renderReactions` 插 chip 一样。

### 2. 就地拍板 → 复用 `rooms.steerTask`

```
点 A/B/C → rooms.steerTask({ task_sig: sig, room_id, text: 选项文案 })
         → CMD_STATE.note = 回执
         → 本行钩子状态变（不重新渲染整条消息）
```

**不要新建 IPC**。指挥台已经这么干了（26784 行附近），消息里只是第二个调用点。

### 3. 三处状态联动 → 一个 `taskView` 订阅

桌面现在没有事件订阅机制的话，最小做法是**本地广播一次**：
`broadcast("bitbot:task-state", {sig,state})` →
① 消息钩子 ② 顶部 taskbar ③ rail 任务卡 同时更新。
这不是第二数据源——三处都只读 `task_sig` 指向的那张卡。

### 4. 顶部 taskbar“稍后不丢” → 只需前端状态

`localStorage` 记 dismissed sig 列表，下次会话/重启仍在 `tasks.json`，
所以“稍后”只收起提示，不影响实体。

### 5. rail 任务当前/轨迹 → 现有 rail 加一个 tab

真机 rail 已有“电脑预览 / 群组 / 后台审批 / 关闭”。加“任务”tab，
内容读同一个 `task_view.js` + 转录行；轨迹 = 过滤 `task_sig` 的转录。

### 6. 发布审批防重复 → `rooms.approveTask`（若已有则复用）

点完禁用按钮 + 等 IPC 回执；回执失败要恢复按钮（不能“点了没反应还废了”）。

## 三、不要做的事（红线）

1. **不要在渲染层另建任务状态表**。三处都从 `tasks.json` / `task_view.js` 读。
2. **不要改 `addMsg` 的既有语义**：`opts.task` 缺席时行为逐字不变（老消息零影响）。
3. **不要新增列/新配色/新菜单族**：v11 已核对真实骨架与全部交互面。
4. **消息里的按钮不能替用户“发出去”**：草稿与发送分离，沿用模板里的边界承诺。
5. **一个 sig 一张卡**：已有 bug 教训（合并顺序错 → 两张卡），新界面不得重现。

## 四、落地顺序（最小可验证）

1. `addMsg` 加 `opts.task` 渲染钩子（静态，不接 IPC）——先验证视觉与位置。
2. 消息按钮接 `rooms.steerTask`，带回执 toast——验证“0 跳拍板”。
3. 本地广播让 taskbar/rail 同步——验证三处联动。
4. rail 加“任务”tab 与轨迹过滤——验证审计可回溯。
5. 最后才做发布审批与防重复。

每一步都能单独验，前一步没绿不做后一步。
