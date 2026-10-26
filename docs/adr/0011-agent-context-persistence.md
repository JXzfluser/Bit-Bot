# ADR 0011 — AgentContext 跨进程持久化(「多轮不失忆」接线)

- 状态：Accepted
- 日期：2026-10-26
- 决策者：Bit架构
- 关联：ADR 0002(WASM/Host 边界)、ADR 0010(能力层)、`docs/agent-core/README.md` AR-03 / AR-04
- 实现：`cmd/desktop_turn/agent_loop_product_context.mbt`、`cmd/desktop_turn/agent_loop_product_native.mbt`、`hosts/shared/agent_loop_product_wire.js`
- 门禁：`bash scripts/prove_agent_context.sh`

## 背景

`runtime/agent_context.mbt` 里的 `AgentContext` **能力早就齐了**:会话历史、token 预算、
压缩、规划块、`encode` / `decode` 都在,`AgentLoop::run_with` 也早就接受外部 context。

但产品路径一次都没调过它们 —— AR-03 / AR-04 记的「**能力齐了,线没接**」:

- 产品路径 `cmd/desktop_turn/agent_loop_product_native.mbt` 调的是 `.run(ctx, host)`,
  每回合新建一个**空** context;
- 而且内核是**每回合新起进程**(`hosts/shared/run_moon_turn.js` 的 `spawn`),
  进程一死,就算在同一个进程里攒下来的 context 也没了。

结果:用户每说一句话,Agent 都从失忆状态开始。定时任务触发时更明显 ——
它跑在一个全新进程里,完全不知道用户昨天改过什么。

## 决策

**1. 上下文必须跨进程边界搬运,而搬运通道是 FFI。**

ADR 0002 的边界是「内核管策略,Host 管 I/O」,而**内核没有文件 IO 能力**
(`cmd/desktop_turn` 与 `runtime` 都不依赖任何 fs 库)。所以上下文不能由内核自己落盘。

新增两个 FFI op:

| op | 方向 | 语义 |
|---|---|---|
| `load_context` | 内核 → Host | 要一份**编码后**的上下文 |
| `save_context` | 内核 → Host | 把**更新后**的上下文交回去落盘 |

**语义仍然在内核**:`encode` / `decode` 都是内核的事,Host 只存字节,不懂内容。

**2. 槽位按 (Bot, 会话) 分。**

一开始按 Bot 分,后来改掉 —— 因为那是**真 bug**:桌面端有多个会话(对话),
用户新开一个对话时不该带着上个对话的记忆。那是「串味」,不是「记得我」。

改成 (Bot, 会话) 之后,跟产品既有的用法完全吻合:

- 桌面主聊天路径传 `sessionId`(当前会话 id)+ `botId`(renderer 的 `activeBotId`)
  ⇒ **一段对话一个上下文**;换对话就是新的
- 房间回合的 session id 本来就是 `room-<roomId>-<botId>`
  (`hosts/desktop/main.js` 的 `runRoomResponderTurn`)⇒ 同一房间的同一个 Bot
  记得自己说过什么,换个房间或换个 Bot 就不记得

**长期记忆是另一回事**:事实/偏好是 per-Bot 的(`botMemorySlot`),不受影响。

上下文回读后,session id 会被对齐到当前回合(`agent_context_aligned`),历史本身不动。

**3. 这条路径必须永不失败。**

- Host 不认识 `load_context` / `save_context`(旧 Host 配新内核)→ 回 `unknown op`
  → 内核把输出当空串 → **当作没有历史继续跑**。旧 Host 不会炸,只是没有跨回合记忆。
- 上下文落盘失败 → 只少记点事,**不能把回合搞崩**。
- 文件名里的槽位必须**不能逃出目录**:bot id 会进文件路径,所以
  `agentContextPath` 把它消毒成 `[A-Za-z0-9._-]`,并挡掉 `.` / `..`。
  bot id 形如 `../../etc/passwd` 只能变成一个普通文件名。

**4. 上下文是明文,落在用户自己的数据目录。**

`DATA_ROOT/agent-context/<bot>.ctx`。打包态 `DATA_ROOT` 就是 `userData/data`
(ADR 0010 之前的 `paths.js` 迁移已就位),开发态是仓库的 `data/`。
这与既有的会话存储(`data/sessions/`)是同一套保护口径。
粘贴密钥进对话仍被 CM-1106 的闸挡住。

**5. 上下文是有界的。**

`AgentContext` 自带 `keep_recent_turns` 与压缩(超预算先 compact 再停),
所以落盘的文件不会无限长。

## 非目标

- 不做**内核常驻进程**。真正的 daemon 化(内核进程常驻、跨回合复用)是更大的改动,
  而当前 FFI 协议是「一次 spawn、一个回合」。本决策解决的是**用户能感知的那一半**:
  上下文活过了进程边界。进程常驻能省的是启动开销,不是记忆。
- 不做跨 Bot / 跨机器的上下文同步(那是 W2 的 B-5 状态分槽,另一个决策)。
- 不改 `AgentContext` 的语义、不改预算算法、不改压缩策略。
- 不把任何 `CM-*` 从 U 升到 I。

## 后果

- **正面**:`AR-03` / `AR-04` 的「线没接」这一半接上了 —— 用户能感觉到「多轮不失忆」。
  定时任务触发时,新进程能读到上次的上下文。
- **正面**:上下文按 (Bot, 会话) 分槽 —— 多 Bot 不串味,**换对话也不串味**。
- **代价**:每个回合多两次 FFI 往返(一次读、一次写)。
- **代价**:对话内容多了一份明文落盘。与会话存储同口径,但确实是**新增的持久化面**。
- **代价**:上下文跨回合累积后,provider 请求体会变大 —— 靠 `keep_recent_turns` 与压缩兜底。
- **风险**:上下文里可能有用户没打算长期留存的话。真要「清空记忆」,
  需要一条显式的清空路径 —— **本决策没做**,留作后续。
- **代价**:会话 id 成了上下文的一部分。**门禁必须用每次运行唯一的 session id**,
  否则第二次跑会继承第一次跑的历史(这不是产品问题,是门禁卫生)。
  已经在受影响的门禁里加上了 `RUN_ID`。

## 验收

```bash
bash scripts/prove_agent_context.sh
```

该门禁跑**真 native 二进制**,provider 是本地 stub:

- **证到**:一个回合种下的事实,出现在**下一个回合**的 provider 请求体里(上下文跨过了进程边界);
  上下文文件真落盘且含该事实;**另一个 Bot 的槽位看不到它**(分槽隔离)。
- **不证**:模型会不会用好这个记忆。stub 只检查事实**在不在**请求里。

白盒测试:`cmd/desktop_turn/agent_loop_product_context_wbtest.mbt`(5 例:槽位回退、
请求编码与换行转义、未知 op 容错、encode/decode 往返、session id 对齐)。
