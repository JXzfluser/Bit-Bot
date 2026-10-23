# Grok Bot 真机截图观察（replica/screens/OBSERVATIONS.md）

> 来源：本地 `/Applications/Grok Bot.app`（Electron，v0.75.0）真机截取（2026-10-23，macOS 2940×1912，窗口 1040×760 逻辑点，2× retina 2080×1520）。
> 目的：为 Bit Bot 缺口复刻提供像素级依据。**仅作参考，不进产物**。

## 截图清单

| 文件 | 内容 | 对应 recon/replica |
|------|------|---------------------|
| `grok-composer.png` | 主窗口：左会话栏 + 中对话流 + 底部 composer | S01 主界面 |
| `grok-composer-controls.png` | composer 细节（`+` / 输入 / 麦克风 / 品红声波钮） | C4/C5 输入区 |
| `grok-markdown-reply.png` | 代码块 + markdown（加粗/列表/行内代码） | C1/C2 |
| `grok-regenerate.png` | 普通消息 hover 出的操作条（复制/↻/…） | C3 |
| `grok-reply-actions.png` | 代码回复右侧操作条（复制/↻/…） | C3 |
| `grok-team-conv.png` | 多智能体团队会话（成员协作） | 多 Bot 编排参考 |

## 关键发现（映射到 replica/design/components.md）

### 1. 整体外壳（对齐 token）
- 左栏：workspace 名「bitbot」+ 会话列表；每行 40px **彩色 blob 头像** + 标题 + 次要行；命中态 = 浅灰填充胶囊（≈ `--fill`），未读 = 行内小蓝点。
- 中间：消息气泡 `background ≈ #f4f4f5`（`--fill`）、圆角 ~16（`--r-sheet` 量级）、最大宽 ~760（对应 Bit Bot `--content-max`）、正文 `--text`、时间戳/说明 `--text-muted` + `--fs-caption`。
- 两人/多 agent 之间用分隔行：「N 条消息往来：[blob] 和 [blob]」小字 + 小头像。
- 结论：Grok 的浅色密度与 Bit Bot `--bg #f5f5f7 / --bg-elev #fff / --fill #f4f4f5 / --text #1a1a1a` 高度一致，token 体系可直接复用。

### 2. Composer 极简（缺口 4/3 的真相）
- 静止态只有：`+` 附件（圆形，`--fill` 底）、输入（胶囊、白底、细边）、**灰色麦克风（听写）**、**品红声波圆钮（语音模式）**。
- **没有**内联模型下拉、**没有**联网搜索开关 —— 模型选择在「设置」里。
- 含义：Bit Bot 若把「联网搜索开关 + 行内模型切换」显式放进 composer（我们的 C4），属于 **parity+ 的主动改进**，并非必须照抄。可保留，也可只在 `+` 菜单里提供以更贴近 Grok。

### 3. Markdown / 代码块（C1/C2）
- 代码块：等宽字体、`background ≈ #f4f4f5`（比 `--code-bg #f6f8fa` 更接近 `--fill`）、圆角 ~12–16、**无彩色语法高亮**（纯深色等宽文本）。
- markdown：`**加粗**`、无序列表、`行内代码`（等宽 + 浅底）。结构干净、无花哨。
- 含义：**Grok 不做语法高亮**。我们 C2 若加 highlight.js 属可选增强；要"像素对齐"就保持纯等宽灰底。`--code-bg` 可考虑贴近 `--fill`（#f4f4f5）。

### 4. 重生成 / 消息操作（C3）——已确认
- 悬停消息右侧浮现 **3 个 ghost 图标**：复制（❐）、重生成（↻）、更多（…），右对齐、`--text-muted`，hover 才显形。
- 含义：完全印证 C3 设计。Bit Bot 现有「编辑消息」可保留，另加 copy/regenerate/more 到同一 `.bb-msg-actions`。

### 5. 多智能体团队（对 Bit Bot GP-143~147 的参考）
- 团队会话右侧有 **成员栏**：blob 头像 + 名字（情报侦察员 / 选题策划师 / 内容主笔 / 事实编辑 / 公众号资深排版设计师）。
- 底部状态行：「情报侦察员、选题策划师 和 另外 3 个 正在工作…」。
- 含义：Bit Bot 的群聊/多 Bot 编排应复用这套「成员栏 + 正在工作」表达。

### 6. 设置面板（曾截到后覆盖）
- 左侧导航：通用 / 电脑 / 用量与账单 / 更新；内容为分组卡（rounded card + 分隔）、开关（toggle）、下拉（每次询问/从不允许）、红色危险按钮（重置）。
- 含义：Bit Bot 设置页可直接套 `bb-sheet` + `.bb-row` + `.bb-control` + `.bb-badge` + 危险色 `--danger`。

### 7. 唯一彩色强调
- 全局近乎黑白，唯一高饱和色是**语音钮的品红/洋红**（≈ #e13ba8）。
- 含义：Bit Bot token 的 `--accent` 是近黑（#1a1a1a）。若想复刻这抹品红，需要新增一个"品牌强调色"角色（并过对比）；否则保持黑白也成立。

## 未能截到 / 本客户端可能不存在
- 独立「模型下拉」浮层（模型在设置内，非 composer 内联）。
- 联网搜索开关 + 引用（该客户端 composer 无此项）。
- Canvas / 创作产物界面（本次会话未见入口）。
- 语音独立全屏态（品红钮未展开独立语音 UI，可能是"语音对话"复合态）。

> 若要精确到控件名/菜单项，可解 `Grok Bot.app/Contents/Resources/app.asar` 读前端源码（比截图更准），但属逆向、成本较高。
