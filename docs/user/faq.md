# Bit Bot 桌面版 · 常见问题（FAQ）

## 关了窗口，应用还在？

是的。点关闭按钮默认**隐藏到托盘**，这样后台的定时任务和通知还能继续。
真正退出：托盘菜单 → 退出，或应用菜单 → Quit（macOS 也可 `⌘Q`）。

## 没有 API Key 会怎样？

不会假装能聊天。发消息会返回明确的失败提示；首屏会提示「尚未配置大脑 key」。
配置方法见 [quickstart.md](quickstart.md) 第 3 节。填错 key 时「试连大脑」会给出
HTTP 状态或错误文本，而不是一句笼统的「失败」。

## 怎么换模型 / 换服务商？

用环境变量 `BITBOT_LLM_BASE_URL` / `BITBOT_LLM_MODEL` / `BITBOT_LLM_PROVIDER`
（`deepseek` / `qwen` / `moonshot`），改完重启应用。可选模型目录：
`data/llm/providers.json`。凭证仍只从本机 `.env.local` 或环境变量读，不会写进仓库。

## 我的聊天记录存在哪？会上传吗？

在仓库的 `data/desktop/`：`sessions.json`、`bots.json`、`rooms.json`、`settings.json`、
`approval-rules.json`、`approvals.log.jsonl`。退出应用后复制整个目录即可备份/迁移。

聊天内容只在你配置的模型请求里发出去；凭证保存在本机 `hosts/desktop/.env.local`，
该文件已被 `.gitignore` 忽略。仓库和安装包里不含真实密钥。

## 为什么文档写着 PASS，功能却点不到？

因为 `PASS` 只代表「实现 + 测试证据」，不代表「产品里有入口」。逐条能不能用看
[../qa/product-readiness.md](../qa/product-readiness.md)：当前 234 条里
用户可达 29、部分可达 10、仅测试可达 64、内核接线但入口未逐条点名 131。
这个分类由 `node scripts/prove_readiness_ledger.mjs` 机检，不是人工拍脑袋。

## 支持手机 / 多端吗？

桌面端是唯一完整产品路径。Android 目前只验证了两件事：能装载 Bot/会话名单、
能跑一个回合（`e2e_android_roster` / `e2e_android_turn`）。**Android 的其他能力
没有逐条验收，不能拿桌面的数字去套。** iOS 未做。

## 手机怎么连上这台桌面？

**账户头像 → 移动端远程控制** → 点 **允许手机连接** → **生成配对码**（6 位，5 分钟有效、
用过一次即作废），手机 App 里点「连接 Desktop」输入即可。令牌由手机端自己换到，
不需要手抄 64 位。也可以点 **复制配对链接** 把地址发给手机。

当前只做到「手机连上桌面大脑发消息」：远程指挥桌面当前工作区、扫码登录都还没做。
连不上的排查见 [troubleshooting.md](troubleshooting.md) 的「手机连不上桌面」。

## 群聊里 Bot 什么时候回答？

- `@某个Bot` → 只有被点名的回答（mentioned_only）
- `@everyone` → 所有 Bot 都可能回答
- 不 @ → 各 Bot 自行判断（bot_discretion）
- 审批请求和密钥永不进群（只在私聊里处理）

## 审批卡三个按钮有什么区别？

- **Allow once**：只放行这一次，下次还会问。
- **Always allow**：写一条 `<kind>:*` 规则，下次同类操作自动放行（有日志）。
- **Deny**：明确拒绝，并写一条回执到 `approvals.log.jsonl`。

「先问」优先于「允许」；如果某个操作被设为 never，审批卡会直接拒绝且不执行。

## 和 Grok Bot 是什么关系？

行为与交互原则对齐（布局、审批、群聊纪律等），**不是**像素级复刻，也没有对 Grok
做逆向或抓取。项目自己的规格在 `docs/grok-desktop-parity/`，能力合同在
`docs/capability-matrix.md`。

## 数据能手工改吗？

建议不要。应用启动和保存时会按自己的结构落盘，手改 JSON 容易让历史行丢失。
要迁移就整目录复制；要修问题先备份，再看 [troubleshooting.md](troubleshooting.md)。
