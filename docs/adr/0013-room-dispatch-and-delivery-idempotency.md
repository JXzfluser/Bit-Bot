# ADR 0013 — 群消息走同一条路:扇出下沉共享层,幂等认「投递」不认「文字」

- 状态：Accepted(v1 已落地)
- 日期：2026-10-26
- 关联：ADR 0002(Host 边界)、ADR 0010(能力层)、ADR 0012(权限模型)
- 实现：`hosts/shared/room_dispatch.js`、`hosts/shared/room_runtime.js`、`hosts/desktop/product_surface.js`、`hosts/shared/host_ffi.js`、`hosts/desktop/main.js`
- 门禁：`bash scripts/prove_room_dispatch.sh`(29/29)

## 背景

两个真问题,都出在**同一处**:群消息的处理路径不止一条。

### Q-6:CLI / 移动端发的群消息没人回,而且不报错

扇出(把消息交给群成员、收齐回话、汇总成 `final_report`)这一步,
**只在 `hosts/desktop/main.js` 的 Electron IPC handler 里**:

```
ipcMain.handle("bitbot:rooms:orchestrate")
  → surface.roomTurn → appendRoomTranscript → surface.orchestrateRoom  ← 只有这里有扇出
```

而所有非桌面路径 —— CLI、移动端、`cn_inbound` 的 `/v1/turn`、
任何走内核 `room_turn` effect 的调用 —— 落到 `host_ffi.js` 的
`room_turn` effect 分支时,只做了**路由 + 落转录**:

```js
res = surface.roomTurn(hitRoom.id, body, ...);
surface.appendRoomTranscript(hitRoom.id, res.transcript_entry);
// 到此为止。没有 orchestrateRoom。
```

消息落盘了,没人回,也没报错。**静默失效**——这是最坏的一类 bug:
用户以为发出去了,系统看起来一切正常,实际上什么都没发生。

### Q-5:幂等键认的是「文字」

`orchestrateRoom` 的幂等键原本是:

```js
const taskSig = room.id + "|" + task.toLowerCase();
```

于是**用户把同一句话再发一遍,会被当成同一次投递直接去重**,
第二次根本不跑。而 `force` 从来没人传 —— 幂等变成了「吃掉用户的第二次请求」。

## 决策

### 1. 扇出下沉共享层,一条路径

新增 `hosts/shared/room_dispatch.js` 的 `dispatchRoomTurn`:
**路由 → 落转录 → 扇出 → 汇总**,收成一个函数。

调用方:
- `hosts/desktop/main.js` 的 `bitbot:rooms:orchestrate` IPC
- `hosts/shared/host_ffi.js` 的 `room_turn` effect 分支

**两边走同一个函数** ⇒ 不会一个端回、另一个端不回。
这一条不是风格问题,是 Q-6 的根因:分歧的路径必然有一边是坏的。

### 2. 成员回合的实现也下沉

原先 `runRoomResponderTurn` / `runRoomDiscretionTurn` / `selectRoomResponders`
写在 `main.js` 里(桌面专属)。现在搬到 `hosts/shared/room_runtime.js`,
桌面和别的端用**同一份**代码。

依赖方向:`run_moon_turn.js` require `host_ffi.js`,所以 `host_ffi.js`
**不能**反过来 require `run_moon_turn.js`。解法是注册式:
`run_moon_turn.js` 创建 runner 后调 `ffi.setTurnRunner(runTurn)`,
`host_ffi.js` 用它跑群回合。没有注册完整 runner 时退化为嵌套 worker 回合
(仍是真的跑,只是没有群上下文)。

`room_context.js` / `room_discretion.js` 同样从 `hosts/desktop/` 移到
`hosts/shared/`(它们本来就是纯函数)。

### 3. 幂等键改成「投递 id」

```js
const sigKey = String(opts.message_id || "").trim() || task.toLowerCase();
const taskSig = room.id + "|" + sigKey;
```

- **有投递 id** ⇒ 幂等认的是「同一次投递」。
  渠道自带稳定 id:钉钉 `msgId`、飞书 `message_id`。
  平台重投同一条消息 ⇒ 同一个 id ⇒ 不重复执行;
  用户另发一条 ⇒ 新 id ⇒ 新的任务。
- **没有投递 id** ⇒ 每次进入房间回合现生成一个 ⇒ 一次调用 = 一个任务。

`force` 保留:显式重跑仍然可以。

### 4. 失败一律如实

- 群不存在 ⇒ `ok:false, error:"room_not_found"`,**不落转录、不叫任何成员**。
- 存储读不了 ⇒ `rooms_store_unreadable`。
- 某个成员失败 ⇒ 汇总如实是 `1/2` 且 `partial:true`,
  失败行以 `bot_reply_error` 落进转录。

## 非目标

- 不做「消息撤回」「编辑后重跑」—— 那是产品功能,不是这次的 bug。
- 不改房间成员模型、不改预算护栏、不改 `mentioned_only` / `all` / `bot_discretion` 三种策略。
- 不让 `bot_discretion` 退化成「全员都答」—— 没有真实自决依赖时,
  内核如实拒绝 `discretion_selector_required`。

## 后果

- **正面**:CLI / 移动端发的群消息**真的有人回**,并且回话落进转录。
- **正面**:桌面和别的端不会分叉 —— 一份实现、一个门禁。
- **正面**:用户把同一句话再发一遍,会**真的再跑一次**。
- **正面**:渠道重投不会重复烧 token。
- **代价**:非桌面路径现在会真的起多个模型回合(以前是 0 个)。
  这是正确的代价,但要如实说明:**群消息在 CLI 上变贵了**。
- **代价**:投递 id 只在渠道路径上天然存在;桌面/CLI 的「投递」是
  「一次调用」这个粒度,跨进程重试的保护要靠调用方自己传 id。
- **风险**:`main.js` 的 `roomSafeText` 改成委托共享实现,
  行为一致(同一条正则、同一套 token 规则),但脱敏规则从此只有一份 —— 改它的地方也只有一个。

## 验收

```bash
bash scripts/prove_room_dispatch.sh
```

- Q-6:群消息真的被扇出、回话落进转录、汇总如实 2/2。
- Q-6 负例:群不存在 ⇒ 如实失败、**没有成员被叫起来**、转录没多一行。
- Q-5:同样的字再发一遍 ⇒ 第二次**真的又跑了**。
- Q-5 幂等:同一个投递 id 重试 ⇒ 幂等命中,成员只被叫一次。
- 诚实聚合:一个成员失败 ⇒ `1/2` + `partial` + 转录里有失败行。
- 接线断言:host_ffi 的 `room_turn` 分支与桌面 IPC 都调 `dispatchRoomTurn`,
  且 `main.js` 不再自带一份 responder 实现。
