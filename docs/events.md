# 事件模型（T1-01）

> 状态：v1（2026-10-29）。本文是 T1/T2/T3 的共用契约——日志表结构、`seq` 语义、
> command/event 词表与 payload schema 在此定义一次，代码里不得再各写一份。
> 需求来源：`docs/next-target-requirements.md` §3.2 / §3.4 / T1-01。

## 1. 为什么要 seq

今天的状态只有 JSON 快照，全链路没有序号（评审记录 F1）。重连补流、多端同步、
崩溃去重、审批恢复都要求一个「可续订的光标」，而光标必须是**日志的属性**，不能是
进程内存里的计数器——所以 seq 由存储层在追加时分配，而不是由调用方传入。

## 2. 表结构

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,          -- 'log_version' | 'instance_id' | ...
  value TEXT NOT NULL
);

CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- 全局单调游标，见 §3
  session_id TEXT NOT NULL,
  turn_id    TEXT,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,                      -- JSON 文本，见 §5
  actor      TEXT NOT NULL,                      -- 写入者：machine_id / client_id
  ts         INTEGER NOT NULL,                   -- epoch ms，仅用于展示与审计
  idem_key   TEXT                                -- 非空时参与幂等约束，见 §4
);
CREATE INDEX events_session_seq ON events (session_id, seq);

CREATE UNIQUE INDEX events_idem ON events (idem_key) WHERE idem_key IS NOT NULL;

CREATE TABLE effects (
  id           TEXT PRIMARY KEY,   -- turn_id + "/" + idx，计划时生成（T2-FR2）
  session_id   TEXT NOT NULL,
  turn_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  target       TEXT NOT NULL,      -- machine_id 或 "local"
  approval     TEXT NOT NULL,      -- auto | ask | never
  idem_key     TEXT UNIQUE,
  deadline_ms  INTEGER,
  status       TEXT NOT NULL,      -- pending | running | finished | denied | expired
  result       TEXT                -- JSON 文本，effect_finished 时写入
);
CREATE INDEX effects_session ON effects (session_id, turn_id);
```

`log_version` 写在 `meta`，当前为 `1`。读侧遇到比自己已知版本更大的库必须**拒绝打开并报错**，
不得猜测解析（不变量 I7 的最低要求）。

## 3. seq 语义

| 规则 | 含义 |
|---|---|
| 分配 | 由 SQLite 在 `INSERT` 事务里分配（`AUTOINCREMENT`），调用方**不能**指定 seq |
| 单调 | 全局严格递增；跨会话有跳号是正常的，会话内一定递增 |
| 不复用 | `AUTOINCREMENT` 保证删行后 seq 不回收，客户端缓存的光标永远有效 |
| 不可变 | 事件一经追加不得 UPDATE / DELETE；修正只能靠追加新事件（`*_decided`、`turn_ended`） |
| 稠密性 | 只保证「同一 session 内 seq 递增且无缺口」——单写者（§6）是这条的前提 |
| 续订 | `subscribe(session_id, from_seq)` = `WHERE session_id=? AND seq > from_seq ORDER BY seq` |

客户端保存两份游标即可：`applied_seq`（已折叠进 UI 的最大 seq）与
`seen_seq`（已收到的最大 seq，含在途的 `delta`）。重连时从 `applied_seq` 续订，
`delta` 用 `seen_seq` 去重。

## 4. 幂等（T1-FR3 / AC-T1-2）

写命令（§5 的 command 侧）必须带 `idem_key`；`events_idem` 这个部分唯一索引就是
去重机制本身——重复投递的第二条 `INSERT` 直接撞唯一约束，返回「已受理」而不是再追加一行。

- `idem_key` 由**发起方**生成、随请求体走，建议 `"<client_id>:<uuid>"`；
- 命中重复时服务端读回原事件的 `seq` 返回给调用方，ack 内容一致；
- 「先落盘再 ack」= ack 只在 `INSERT` 事务提交后发出。返回 ack 而日志里没有这行，算 bug。

## 5. 词表

铁律（§3.4）：**客户端只能发 command、只能读 event；任何 UI 状态都能由 `fold(events)` 得到。**
command 不是独立的表——它被受理时表现为一条对应的 event（如 `user_message` → `message_committed`），
本文列出的是命令名与其入参。

### 5.1 command（12）

| 命令 | 入参 | 落库为 |
|---|---|---|
| `user_message` | `session_id, text, attachments[], idem_key` | `message_committed`（role=user）+ `turn_started` |
| `approve` | `session_id, approval_id, scope` | `approval_decided{decision:"approve"}` |
| `deny` | `session_id, approval_id, reason` | `approval_decided{decision:"deny"}` |
| `cancel_turn` | `session_id, turn_id` | `turn_ended{status:"cancelled"}` |
| `create_bot` | `bot{name, model, ...}` | （bots 是全局配置，见 §7） |
| `update_bot` | `bot_id, patch` | （同上） |
| `create_room` | `room{name, member_bot_ids[]}` | `session_created{kind:"room"}` |
| `send_room_message` | `room_id, text, mention_bot_ids[]` | 每个被 @ 的 bot 一条 `message_committed` |
| `set_setting` | `key, value` | （settings 是全局配置，见 §7） |
| `start_job` | `session_id, job{cmd, port_policy}` | `job_started`（T5） |
| `stop_job` | `session_id, job_id` | `job_ended`（T5） |
| `ack` | `session_id, upto_seq` | 不落库，只推进服务端记录的客户端游标 |

### 5.2 event（14）

`kind` 全集如下；除 `session_created` / `presence_changed` 外都必须带 `turn_id`。

| # | kind | 必带 payload | 说明 |
|---|---|---|---|
| 1 | `session_created` | `session{}` | 会话/群聊诞生 |
| 2 | `turn_started` | `turn_id, initiator` | 一回合开始 |
| 3 | `delta` | `turn_id, channel, text` | **不落库**，见 §5.3 |
| 4 | `progress` | `turn_id, row{}` | 进度行，语义等同 `progress_protocol.js` 的 row |
| 5 | `message_committed` | `message{}` | 一条完整消息（用户或模型） |
| 6 | `approval_requested` | `approval{}` | 需要人点头 |
| 7 | `approval_decided` | `approval_id, decision, scope, by` | 决定；必须能覆盖过期路径 |
| 8 | `effect_started` | `effect_id, kind, target` | |
| 9 | `effect_finished` | `effect_id, ok, result?` | 同 `idem_key` 只允许一次外部副作用 |
| 10 | `turn_ended` | `turn_id, status, usage?` | `ok \| error \| cancelled \| awaiting_approval` |
| 11 | `job_started` | `job_id, pid, port?, cmd` | T5 |
| 12 | `job_output` | `job_id, stream, text` | 有界（T5-FR4） |
| 13 | `job_ended` | `job_id, exit_code, signal?` | T5 |
| 14 | `presence_changed` | `machine_id, online, last_seen_ms` | `session_id` 取保留值 `"system"` |

保留 `session_id`：`"system"`（全局事件）、`"box"`（无头宿主自身）。业务会话 id
不得占用这两个字面量。

### 5.3 `delta` 为什么不落库

token 增量既大又无长期价值（评审 §8-5「不持久化 token 增量」）。它只进
**内存的 in-flight 缓冲**，随 `message_committed` 一起被替换掉；缓冲有容量上限，
超限即截断为「已回退到完整消息」，客户端此时靠 `message_committed` 纠正显示。

## 6. 单写者（T1-FR2）

每个 `session_id` 同一时刻只有一个 actor 能追加。actor 身份 = `machine_id`（由
ed25519 公钥派生，I5）+ 一个进程内的 writer token。同会话的所有状态变更经由该
actor 串行化，因此「seq 会话内稠密」不需要额外锁——**串行是稠密的前提**，两者一起测。

## 7. 本轮范围（不做的事）

日志只覆盖 **sessions / rooms / approvals** 三类（AC-T1-3 点名的三类）。
`bots.json`、`settings.json`、`host-routines.json`、`account-profile.json`、
`llm-usage.json` 仍走原 JSON 读写，不塞进事件日志：它们不是会话状态，硬套进
「每会话单写者」只会造出一个假的 system 会话。相应地，今天的
`bitbot:bots-changed` / `settings-changed` / `routines-changed` 三个广播在
本轮保持为广播，等 T3 的 core schema 落地后再决定是否需要全局流。

## 8. 现状 → 词表映射（供 T1-03 双写、T1-05 导入）

| 今天的载体 | 落到的 kind |
|---|---|
| `sessions.js:64,81` 写 `data/desktop/sessions.json` | `session_created` + `message_committed`（历史消息逐条导入） |
| `room_orchestrator.js:87-92` 写 `data/agents/sections/<room>.json` | `session_created{kind:"room"}` + `message_committed` |
| `product_surface.js:862` 写 `pending-approvals.jsonl` | `approval_requested` |
| `product_surface.js:24,59-62` 写 `approvals.log.jsonl` | `approval_decided` |
| `main.js:663,3087,3277` 广播 `bitbot:llm-stream` | phase=start → `turn_started`；phase=end → `message_committed` + `turn_ended`；中间 chunk → `delta` |
| `main.js:3129` 广播 `bitbot:turn-progress` | `progress`（row 结构不变，类别沿用 `progress_protocol.js` 的 `KIND_CATEGORY`） |
| `main.js:1580,1554` 广播 `bitbot:loop-approval` | `approval_requested` / `approval_decided`（`{clear:true}` 即 decided） |
| `main.js:3140` 广播 `bitbot:agent-loop` | `progress`（`category=tool_activity`） |
| `main.js:1976` 广播 `bitbot:room-turn-progress` | `progress`（带 room 的 turn_id） |
| `machine_presence.js:261` 写 `data/machines/presence.json` | `presence_changed` |
| `run_moon_turn.js:728` 写 `data/traces/<turn_id>.json` | 不迁入日志；trace 保持独立文件（体积与调试用途） |
| `routine_scheduler.js` 到点触发 | 走 `user_message` 命令（`actor=scheduler`），不新增 kind |

`bitbot:sessions-changed` / `rooms-changed` / `focus-session` 三个广播在新模型里
**由 fold 派生**，不再是事件来源：客户端收到自己订阅的会话事件后自行重绘。

## 9. 示例

单行 JSON（`payload` 列存的就是花括号里的内容）。

`session_created` — 普通会话：
```json
{"session": {"id": "s-9f3a", "title": "周报", "kind": "dm", "created_by": "desktop-a1b2"}}
```

`session_created` — 群聊：
```json
{"session": {"id": "room-7-sprint", "title": "冲刺室", "kind": "room", "member_bot_ids": ["bot-pm", "bot-eng"]}}
```

`turn_started`：
```json
{"turn_id": "t-0421", "initiator": "s-9f3a:user:mob-c9d1"}
```

`delta`（不落库，只在缓冲里）：
```json
{"turn_id": "t-0421", "channel": "assistant", "text": "本周主要"}
```

`message_committed` — 用户：
```json
{"message": {"id": "m-1", "session_id": "s-9f3a", "turn_id": "t-0421", "role": "user",
             "text": "帮我把这周的事写成周报", "attachments": [], "machine_id": "mob-c9d1"}}
```

`message_committed` — 模型：
```json
{"message": {"id": "m-2", "session_id": "s-9f3a", "turn_id": "t-0421", "role": "assistant",
             "text": "本周主要…", "model": "…", "usage": {"input": 812, "output": 240}}}
```

`progress`：
```json
{"turn_id": "t-0421", "row": {"index": 3, "total": 7, "kind": "web_search",
                              "category": "tool_activity", "phase": "done", "paths": []}}
```

`approval_requested`：
```json
{"approval": {"id": "ap-77", "session_id": "s-9f3a", "turn_id": "t-0421", "effect_id": "t-0421/4",
              "kind": "mail_send", "summary": "给 3 个人发周报", "expires_at_ms": 1790000000000}}
```

`approval_decided`：
```json
{"approval_id": "ap-77", "decision": "approve", "scope": "once", "by": "mob-c9d1"}
```

`effect_started`：
```json
{"effect_id": "t-0421/4", "kind": "mail_send", "target": "desktop-a1b2"}
```

`effect_finished`：
```json
{"effect_id": "t-0421/4", "ok": true, "result": {"delivered": 1, "message_id": "<id>"}}
```

`turn_ended`：
```json
{"turn_id": "t-0421", "status": "ok", "usage": {"input": 812, "output": 240, "cost_ms": 4210}}
```

`turn_ended` — 等审批挂起：
```json
{"turn_id": "t-0421", "status": "awaiting_approval", "approval_id": "ap-77"}
```

`job_started`：
```json
{"job_id": "j-12", "turn_id": "t-0421", "pid": 8812, "port": null, "cmd": "npm run dev",
 "restart": "no"}
```

`job_output`：
```json
{"job_id": "j-12", "stream": "stdout", "text": "ready in 812ms", "truncated": false}
```

`job_ended`：
```json
{"job_id": "j-12", "exit_code": 143, "signal": "SIGTERM"}
```

`presence_changed`：
```json
{"machine_id": "mob-c9d1", "online": true, "last_seen_ms": 1789999999000, "kind": "mobile"}
```

`user_message` 命令（`idem_key` 去重）：
```json
{"op": "user_message", "session_id": "s-9f3a", "text": "帮我把这周的事写成周报",
 "attachments": [], "idem_key": "mob-c9d1:6f1c-…"}
```

`approve` 命令：
```json
{"op": "approve", "session_id": "s-9f3a", "approval_id": "ap-77", "scope": "once",
 "idem_key": "mob-c9d1:7a20-…"}
```

## 10. 验收对应

| 验收 | 本文的机制 |
|---|---|
| AC-T1-1 群聊 3 Bot 进程创建=0 | T1-07 常驻进程；本文只保证 `send_room_message` 扇出成逐 bot 事件 |
| AC-T1-2 重启后重复投递=0 | §4 `events_idem` 唯一索引 +「先落盘再 ack」 |
| AC-T1-3 fold 与 JSON 快照逐字段相等 | §8 映射表就是导入与对拍的清单 |
| AC-T1-4 并发写无覆盖 | §6 单写者 |
| AC-T1-6 A 令牌读不到 B 会话 | §6 actor 身份 + T1-10 令牌（令牌→session 绑定在 T1-10 定义） |
