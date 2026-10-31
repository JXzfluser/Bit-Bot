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

## 5. 数据在哪、怎么备份

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

## 6. 常用快捷键

| 快捷键 | 作用 |
|--------|------|
| `Enter` | 发送 |
| `Shift+Enter` | 换行 |
| `↑` | 调出上一条输入 |
| `Cmd/Ctrl+B` | 折叠 / 展开侧边栏 |
| `Cmd/Ctrl+N` | 新对话 |
| `Ctrl+Shift+Space`（macOS `⌘⇧Space`） | 呼出 / 隐藏窗口（可用 `BITBOT_DESKTOP_HOTKEY` 覆盖） |

## 7. 退出

点窗口关闭按钮默认是**隐藏到托盘**，不是退出。要真正退出：托盘菜单 → 退出
（或系统菜单 → Quit）。

## 8. 下一步

- 遇到问题：[troubleshooting.md](troubleshooting.md)
- 常见疑问：[faq.md](faq.md)
- 已交付 / 未交付边界：[../qa/product-readiness.md](../qa/product-readiness.md)
