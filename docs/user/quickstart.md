# Bit Bot 桌面版 · 快速上手

> 适用：想在电脑上把 Bit Bot 真跑起来、配好模型、完成第一个任务的用户。
> 只想看代码结构：`docs/README.md`。想知道「哪些能力真能用」：`docs/qa/product-readiness.md`。

Bit Bot 目前以 **桌面端（Electron + MoonBit 内核）** 为唯一完整产品路径。
Android 只验证了「装载名单」和「跑一个回合」两条（见完成度账本），iOS 未做。

## 1. 准备环境

需要：

- **Node.js 22+** 与 npm
- **MoonBit 工具链**（内核是 MoonBit 写的）
- 一台能开窗口的桌面系统（Linux 无显示器时用 `xvfb-run`，见故障排查）

安装 MoonBit（官方脚本）：

```bash
curl -fsSL https://cli.moonbitlang.com/install/unix.sh | bash
export PATH="$HOME/.moon/bin:$PATH"
moon version --all
```

## 2. 启动

在仓库根目录：

```bash
export PATH="$HOME/.moon/bin:$PATH"
bash scripts/start-desktop.sh
```

首次启动会自动 `npm install` 桌面端依赖，然后打开 **Bit Bot Desktop** 窗口。
窗口里应该看到：左侧 Bot / 会话列表，中间聊天列，底部输入框。

## 3. 配置模型（第一次必做）

没有 key 时应用**不会假装能聊天**：发消息会得到诚实的失败提示。

两种方式任选其一：

**A. 界面里配（推荐）**

1. 打开 **设置 → 凭证**
2. 填入 DeepSeek 的 API Key（`sk-...`）
3. 点 **试连大脑**，看到成功提示即可

凭证写到 `hosts/desktop/.env.local`，不会进 Git（`.gitignore` 已忽略）。

**B. 环境变量**

```bash
export BITBOT_LLM_API_KEY=sk-...
export BITBOT_LLM_BASE_URL=https://api.deepseek.com/v1   # 默认
export BITBOT_LLM_MODEL=deepseek-chat                    # 默认
bash scripts/start-desktop.sh
```

可选：`BITBOT_LLM_PROVIDER=deepseek|qwen|moonshot`；模型目录在 `data/llm/providers.json`。

## 4. 第一个任务

在输入框里直接说人话，例如：

```text
帮我把今天的待办列出来，按优先级排序
```

或者试试模板（首屏「从模板开始」）：销售外呼、人才搜寻、广告投放、费用管理、Bug 复现、幕僚长。

群聊里要让某个 Bot 回答，就 `@它`：

```text
@Bit 总结一下这个群今天讨论了什么
```

## 5. 手机连上这台桌面（配对）

前提：桌面版正在运行，手机和电脑在同一个 Wi-Fi / 局域网。

1. 点左下角 **账户头像 → 移动端远程控制**
2. 弹窗顶部的状态点会如实说明现在能不能连（例如「入站没在听 — 手机没地方连」「只在桌面自己这台机器上开着」）。
   不能连时点 **允许手机连接**
3. 二选一：
   - 点 **生成配对码** → 手机 App 里点「连接 Desktop」，输入这 6 位数字。码 **5 分钟内有效、用过一次即作废**，
     中途可以点 **立即作废** 收回
   - 点 **复制配对链接** 把桌面地址发给手机
4. 手机端用短码自己换到令牌，之后就能向这台桌面发消息 —— **不需要手抄 64 位令牌**

边界（说清楚，别指望更多）：

- 这一步只解决「手机连上桌面大脑发消息」。在手机上远程指挥桌面当前工作区（切会话、看任务、接管）还没做。
- 弹窗里**没有二维码**，当前只有链接和短码两种给法。
- 只读到公网地址或 `169.254` 地址时（云主机、网卡没配上 DHCP），手机大概率连不通；弹窗会写明是哪一类地址，
  不会给你一个假装能连的地址。
- 同一 Wi-Fi 也连不上时才走手动填写：设置 → 凭证 → 手机与入站。
- 窗口宽度 ≤900px 时侧栏会自动折叠，先按 `Cmd/Ctrl+B` 展开侧栏才点得到账户菜单。

## 6. 数据在哪、怎么备份

产品数据都在仓库的 `data/desktop/`（JSON / JSONL）：

| 文件 | 内容 |
|------|------|
| `sessions.json` | 会话列表与活跃会话 |
| `bots.json` | Bot 名单（主 Bot、隐藏 Bot） |
| `rooms.json` | 群聊与群内 transcript |
| `settings.json` | 外观 / 语言 / 时区 / 本机执行 / 通知等 |
| `approval-rules.json` | 你选过「始终允许」的规则 |
| `approvals.log.jsonl` | 审批回执（deny / always-allow 都留痕） |

备份：退出应用后复制整个 `data/desktop/` 即可。不要手工删数组行来「清理」——
应用启动时会按自己的格式落盘，手改容易丢历史。

## 7. 常用快捷键

| 快捷键 | 作用 |
|--------|------|
| `Enter` | 发送 |
| `Shift+Enter` | 换行 |
| `↑` | 调出上一条输入 |
| `Cmd/Ctrl+B` | 折叠 / 展开侧边栏 |
| `Cmd/Ctrl+N` | 新对话 |
| `Ctrl+Shift+Space`（macOS `⌘⇧Space`） | 呼出 / 隐藏窗口（可用 `BITBOT_DESKTOP_HOTKEY` 覆盖） |

## 8. 退出

点窗口关闭按钮默认是**隐藏到托盘**，不是退出。要真正退出：托盘菜单 → 退出
（或系统菜单 → Quit）。

## 9. 下一步

- 遇到问题：[troubleshooting.md](troubleshooting.md)
- 常见疑问：[faq.md](faq.md)
- 已交付 / 未交付边界：[../qa/product-readiness.md](../qa/product-readiness.md)
