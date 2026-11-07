# 从本机 Grok Bot 搬 Bot、群和对话过来

> 一句话结论：**Bot 的人设、群和成员的组成、整段对话历史，能不手工抄一个字地整段搬过来；
> 「正在跑的那一次」和云端产物搬不了。**
>
> 定时任务不在这个库里，走另一条路：`docs/grok-migration.md`。

## 1. 为什么是"直读本机库"而不是"读官方导出"

Grok Bot 桌面版（`/Applications/Grok Bot.app`，`CFBundleIdentifier = com.anysphere.sand`，Electron 壳）
把客户端状态持久化在本地磁盘上，没有"导出 Bot"这种按钮。所以要整段搬，只有两条路：
让你手抄（24 个 Bot、1466 条消息，不现实），或者直接读它的本地库。

这里选后者，因为**它是确定性的**：一个 base32 键名对应一个切片，切片里是 JSON。
脚本只做「解码 → 读 → 映射」，不猜、不推测、不从 DOM 里刮。

## 2. 数据在哪、长什么样

```
~/Library/Application Support/Grok Bot/
  sand-client-persistence/
    <BASE32>.blob      # 每个文件 = 一个键，内容 {"schemaVersion":1,"value":{…}}
```

- **文件名是键名的 base32 编码**（大写字母表 `A–Z2–7`，无填充）。
  例：`onqw4zbomnwgszlooqxhg3djmnss45ljfvwgc6lpov2a.blob` → `sand.client.slice.ui-layout`
- 键名以 `sand.client.slice.` 开头，后面是切片名。我们只关心三个：

| 键名（后缀） | 里面是什么 | 用来干什么 |
| --- | --- | --- |
| `.roster.last-roster` | `value.rows[]`：Bot 与群同一张表，群用 `isGroup` / `memberIds` 区分 | 建 Bot、建群 |
| `.transcript.replicas.<id>` | `value.entries[]`：一条对话的全部条目 | 建会话、灌消息 |
| `.cloud-agents.infos` / `.mcp.connected-app-count` … | 其它状态 | **不迁**（见 §6） |

条目（`entries[]`）只有两种形态值得转：

- `kind: "message"` —— 有 `role`（user/assistant/system）与 `content`（字符串或富文本块数组）
- `kind: "send-message"` —— 有 `message.type`：
  `text` 是普通回复；`widget` 是选项卡片；`attachment` / `cursor-agent` / `email-draft` /
  `connector` / `secret-request` / `scm-connect` / `local-tool-permission` /
  `auto-review-approval` 这些没有可读文本

## 3. 怎么跑

**在应用里（推荐）**：设置 → 常规 → 数据 → 「从 Grok 搬过来…」。

会弹一份三段清单（Bot / 群 / 对话），每段可全选：

- 已迁过的条目**留在原位**但不可勾，右侧标「已迁移」—— 藏掉最省事，代价是你以为
  "我 Grok 里就这些"；
- 建不成的群灰着并写清原因（人数不足 / 成员叫不出名字），而且**排在群段第一位**，
  不然一屏两行根本看不到它；
- 勾选后点「开始迁移」，回执会写建成了几个、备份在哪、哪些没建成**以及为什么**；
- 迁完自动重扫：条目变「已迁移」、按钮变灰、底部提示"已经全部搬过来了"。

**在命令行**（脚本 / 自动化 / 没有界面时）：

```bash
# 1) 先看清单（只列名字，不读对话，最快）
node scripts/import_grok_bot.js --list

# 2) 预演（读全量、算出要建什么，但不写盘）
node scripts/import_grok_bot.js

# 3) 看明白了再真写
node scripts/import_grok_bot.js --apply

# 机器读（给自动化/门禁用）
node scripts/import_grok_bot.js --json
```

两条路走的是**同一份实现**（`hosts/desktop/grok_import.js`）。CLI 那边只是参数解析与打印；
界面那边是 IPC 转一次调用。所以不存在"命令行能跑、界面搬出来不一样"。

可选：`--source <目录>` 换数据源（默认上面那个路径）、`--data-root <目录>` 换本项目的库
（默认 `data/`，也认 `BITBOT_DATA_ROOT`）、`--limit N` 只迁前 N 条（试水用）。

## 4. 这次真跑的结果（2026-11-07）

```
读到 24 个条目：Bot 21 / 群 3 / 线程 24（共 1466 条消息）
  · 其中 42 条是选项卡片，已转成文字
  · 跳过 51 条

建好：Bot 21 / 群 2 / 会话 24   已存在跳过 0
```

- 21 个 Bot 全部建成，人设（`description`）原样带过来，短职责标签（`job`）取人设第一行的前 24 字。
- 2 个群建成：`自媒体内容团队（6 人）`、`今日头条自媒体团队（6 人）`。
- 24 个会话全部建成，标题统一加 `Grok · ` 前缀，方便和本机自己的对话分开。
- 那个只有 1 名成员的群（名字是一整句话：「我想围绕近期或者未来确实 ai应用相关的 公司进行复刻…」）
  **没有建成群** —— 本机建群至少 2 人。它那 18 条对话没有丢，作为一条普通会话留下了。
- 跳过的 51 条逐类记账，不静默吞：
  `attachment×25`、`cursor-agent×11`、`event×4`、`user-attachment×3`、`connector×2`、
  `email-draft×1`、`local-tool-permission×1`、`notice×1`、`secret-request×1`、
  `auto-review-approval×1`、`scm-connect×1`

写入前自动备份：`data/import-backup-<时间>/`（`bots.json` / `rooms.json` / `sessions.json`）。

## 5. 六条硬规矩

1. **键名解错就等于静默丢数据。** base32 解错一个字符会变成另一个键，表现是"少了一个 Bot"，
   而不是报错。所以解码器对非 base32 字符返回 `null`，不返回乱码；门禁里做了真实文件名的
   反解与任意键名的往返。
2. **转不了的条目绝不硬塞。** 附件、事件、私钥请求这些没有文本的条目，记一条 skip 原因，
   不写空消息 —— 空消息会让对话看起来"断了"，而用户无法判断是迁移丢的还是本来就没有。
3. **群成员只认 roster 里确实存在的非群行。** 叫不出名字的成员单独记账（`missing_members`），
   既不静默丢，也不把群塞成群成员（Grok 侧允许群中套群，本机不允许）。
4. **空跑不留痕迹。** 备份只在"真要写第一个东西"之前做一次；没有新内容时不备份、不改盘、
   不重写台账。否则第二遍空跑会在 `data/` 下堆一堆一模一样的 `import-backup-*`，
   以后就分不清"到底动没动过数据"。
5. **幂等靠台账，不靠名字。** 迁过的 Grok id 记在 `data/desktop/grok-import-map.json`；
   再跑只报"已存在"，不会因为改了 Bot 名字就再建一个。
6. **算好的时间必须真的落地。** 每条消息都带原始 `timestampMs` 转成的 `at`；
   `sessions.appendMessages` 会用它（不传才写"现在"）。第一条 `--apply` 时这个参数是被
   无视的 —— 1466 条消息的时间全成了导入那一刻。现在的判据是跨源对拍：迁移后最早的一条
   时间必须逐毫秒等于源端 `entries` 里最早的 `timestampMs`。

## 6. 什么能迁、什么不能

| Grok 里的 | 迁过来变成 | 能迁吗 |
| --- | --- | --- |
| Bot 的名字 + 人设（description） | Bot 的 `name` / `description` / `job` | ✅ 原样 |
| 群与成员组成 | 群 + 成员 id（映射到本机新建的 Bot） | ✅（≥2 人） |
| 对话历史（文字、回复、选项卡片） | 会话消息（选项卡片转成「问题 + · 选项」的文字） | ✅ |
| 头像颜色（`avatarColor`） | — | ❌ 本机头像走另一套 |
| 附件 / 图片 / 生成的文件 | 只标 `[附件]` 占位 | ⚠️ 字节没搬 |
| 一次正在跑的回合 | — | ❌ 进程状态，不是数据 |
| 云端产物（cursor-agent 会话、connector 调用结果） | — | ❌ 留在 Grok 侧 |
| 定时任务 | — | ❌ 不在这个库里，见 `docs/grok-migration.md` |
| MCP 连接、账号授权 | — | ❌ 各自重新连 |

迁过来的是**一份快照**：迁移之后你在 Grok 侧新增的对话不会自动同步。要再搬一次，
先删掉台账里对应的那几行（或整个 `grok-import-map.json`）再跑。

## 7. 判据

```bash
node scripts/prove_m53d_grok_bot_import.js   # 40/0 —— 解析与计划（纯函数层）
node scripts/e2e_desktop_grok_import.mjs     # 13/0 —— 真 Electron，界面全链路
```

`prove_m53d`：真实文件名反解 + 4 个键名往返 + 坏输入返回 null；富文本块拼接；11 种条目形态
（认识的转对、不认识的拒收）；假 store 上的完整计划（单人/群/空线程/附件/统计自洽/没 roster
要报错）；单人群与缺人群的区分；预演不写盘（跑前后三个文件 sha 不变）；`planMigration` 幂等。
**四条负向对照**（各自把实现打坏，断言必须翻假）：标题前缀抹空 → 前缀断言翻假；
widget 分支短路 → "选项卡片转成文字"翻假；群成员去掉 `!is_group` 过滤 → 群被塞进成员翻假；
跳过分支短路 → skip 计数翻假。

`e2e_desktop_grok_import`：**临时空数据根**（不碰你的库）跑一遍完整流程 —— 打开对话框、
三段清单数量、建不成的群不可勾且排第一、全选、点迁移、回执、**真的落盘**（读临时根的
三个 json，1466 条消息跨 23 天）、迁完重扫变「已迁移」且不可再勾。

## 8. 残留（如实）

- **依赖桌面版的路径与格式**：`sand-client-persistence/*.blob` 是内部实现，不是公开契约。
  Grok 升级换格式时脚本会"更保守地拒绝"（解不出 roster 就报错退出），而不是猜着写。
- **只搬了主线程**：`.transcript.replicas.<id>` 之外如果还有分支/子会话的切片，这轮没处理
  （本机这份数据里没看到）。
- **附件只留占位**：原始字节在哪、能不能一起搬，没有做。
- **那个 1 人群没建成**：见 §4。要的话可以手工建一个 2 人以上的群再把 18 条对话挂进去。
- **不做增量同步**：快照式。再次搬需要清台账。
- **没有"取消/回滚"按钮**：写之前有自动备份（`data/import-backup-<时间>/`），但应用里没有
  一键还原。要回退就手工把备份里的三个文件拷回去。
