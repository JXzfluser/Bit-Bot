# Host-integration 接口契约缺口

> 相对：`interfaces.md` §9 `HostAbi`、`box_host` 现实现（含 `HostAbi::mock()`）、`host-ui-contract.md`。  
> 目的：列出 **升 I 前必须补齐的 Host 侧契约**；不修改已 PASS 的 kernel-contract。  
> 2026-10-17 Asia/Shanghai · Bit架构  
> **H2 证据面（项目负责人最终口径）**：**I = C′ Bit Bot 自有 Host 进程**；**B 拒**；**A 非升 I 前置**（仅可选对照）。详见 §3.0。  
> **H3 Host FFI**：**I-PASS×4**（2158/2174/0705/0411 · 批1 15:21；0705=平台子集）；契约见 **§5**。  
> **H4 真 MCP / OAuth / 出网**：CM-2163 / 2164 / 1105 / 2109 / 2120 / 2146 / 1703 — 升 I 证据格式见 **§4**；禁降 U；禁删未升 GAP（含 **0806**）。  
> **H5 媒体 / 卡 / 像素（本波）**：CM-1601 / 1602 / 1603 / 2157 / 1807 / 2131 / 2101 / 2128 / 2103 — 升 I 证据格式见 **§6**；`i_claimed=false`；禁翻矩阵 I-PASS；**0806 仍 GAP**；0705 residual 真手机 OS 卡仍 GAP。

## 0. 现状摘要

| 面 | 现状 | 缺口 |
|----|------|------|
| Kernel `HostAbi` 形状 | **G-ABI-1/2 已落地**（`HostBackend Mock\|Live`、audit span）；U 绿 | Live 失败仍禁止静默回落 Mock |
| Screenshot / H1 | **CM-0605/0802/2160 = I-PASS**；0806 仍 GAP | 复用 G-SCR-*；H2 真 UI 截帧沿用 LiveDisplay |
| Settings / Delete UI（H2） | U：枚举与深链已 PASS；**CM-1901/1902/1907 = I-PASS（C′复核 14:46）**；**CM-1903–1906 = I-PASS（批2 14:54）**；**CM-0204/0205/0206/1401/1405/1507/2178 = I-PASS（批3 15:12）** | H2 14 项全 I-PASS；残余 note：1507 锚点 DOM 回执（scrollTop/boundingRect）、G-UI-0205a 条件区、0204 事件名；B 拒；A 非前置 |
| MCP / OAuth / 出网（H4） | U：in-process / stub；$file:/write_to_file / Slack·Finance·Outlook·2146·1703 均 U-PASS | **§4 H4**：2163/2164 真 Host FS；1105/2109/2120 真 OAuth；2146 真切用户浏览器；1703 真出网禁凭据绕过 |
| Shell/FS / 设备 / Webhook 面板 | H0 **I-PASS×3**；**H3 I-PASS×4**（0705=平台子集） | §5 已兑现；0705 residual 真手机 OS 卡仍 GAP；**0806 仍 GAP**（H1） |
| 媒体 / 卡 / 像素（H5） | U：GenerateImage/Video/chart/pptx/React/math 等 kernel-contract PASS | **§6 H5**：真 PNG/MP4/PPTX；C′ pill/math/cursor-agent LiveDisplay；禁 mock MediaHost 冒充 I |

## 1. HostAbi：Mock vs Live（必须分叉，禁止覆盖）

```moonbit
enum HostBackend {
  Mock          // 仅 U；现有 HostAbi::mock()
  Live(LiveHostConfig)  // I；真 FFI
}

struct LiveHostConfig {
  display : String?          // e.g. Some(":1")
  workspace_root : String    // /workspace
  mcp_transport : McpTransportConfig?
  ui_automation : Bool       // 是否允许真 UI 自动化探针
}
```

**缺口 G-ABI-1**：`interfaces.md` / `box_host` 需文档化 `Mock | Live`；Live 失败不得静默回落 Mock。  
**缺口 G-ABI-2**：Live 每次副作用写 **审计 span**（tool 名、耗时、artifact 路径）供 Bit验证挂证据。

## 2. 真屏 Screenshot（CM-0605 I）

现有 U 字段（保留）：`has_frame`, `read_only`, `clicked`, 路径约定。

**建议追加（仅 Live 填充，不破坏 U）**：

```moonbit
struct ScreenshotEvidence {
  // 已有 U 字段…
  display_id : String?       // Some(":1") on Live
  frame_origin : FrameOrigin // Placeholder | LiveDisplay
  bytes_sha256 : String?     // I 必备
  captured_at : Instant?
}

enum FrameOrigin { Placeholder; LiveDisplay }
```

**缺口 G-SCR-1**：I 断言 `frame_origin == LiveDisplay` 且 `display_id == ":1"`。  
**缺口 G-SCR-2**：明确 Placeholder 帧 **永不得** 写入 host-integration PASS 证据。

## 3. Host UI（Wave H2）— 接口缺口与升 I 证据格式

### 3.0 项目负责人最终口径（Bitbot · 覆盖既往 A/B/C 讨论）— **单一口径，勿再问**

> **I = C′（Bit Bot 自有 Host 进程）** · **B 拒** · **A 非升 I 前置**  
> 本项目用 MoonBit **完整复刻** Grok Bot；Host UI 本身是复刻交付物。把 I 绑死在 Grok/Cursor 闭源客户端钩子（旧 A）会永久 BLOCKED = 砍能力/停工，已否决。  
> UX 仍对齐 [`host-ui-contract.md`](host-ui-contract.md)。`H2UiEvidence` / `host_h2_smoke` / artifacts（§3.3–3.5）**继续有效**。

| 选项 | 最终 |
|------|------|
| **C′ Bit Bot 自有 Host 进程** | **= I-PASS 语义**：可交互 Host 面（Settings 三入口 / 锚点 / Delete+确认）经 Live `HostUiShell` + `HostUiEvent`；升 I = 对该面的 **LiveDisplay 真帧** + `evidence_cmd`（可隔离 display） |
| B 剧本假窗 / xdotool 一次性窗 / 合成 PNG / `fixture-only` | **永不得升 I**（Bit验证拒收） |
| A 驱动 Grok/Cursor 闭源客户端 | **非升 I 前置**；将来有钩子可作**可选对照**证据，缺钩子不得挡 C′ 升 I |

**消费方（写死）**：

| 对象 | 谁消费 / 谁执行 |
|------|----------------|
| `grokbot://app/v1/settings?id=<anchor>` | **Bit Bot Host 进程** 解析并滚到锚点（URI 形态契约兼容） |
| `OpenSettingsIntent` / `DeleteAgentIntent` | Kernel → Effect → Host FFI → Bit Bot `HostUiShell` Live |
| `HostUiShell` Live | **产品 Host 面**（侧栏 / Settings / 右键 Delete），非 fixture |
| agent 桌面 Chrome/Terminal | CM-0605 等；证 1901/1902/1907 须帧内可见 **Host UI 壳控件** |

**C′ vs B 可证伪清单**（Bit验证拒升对齐；缺任一条 C′ → 按 B 拒收）：

| 维度 | **C′（可升 I）** | **B（拒升 I）** |
|------|------------------|-----------------|
| UI 驱动 | 经 Live **`HostUiShell` 方法**打开/推进 UI（`open_settings` / `request_delete_agent` / `confirm_delete_agent` 等） | 静态夹具页 + **CDP / 页面 JS 直调**绕过 HostUiShell |
| smoke 入口 | **只经** `HostAbi` / `run_h2_probe`（及 `host_h2_smoke.sh` 调上述路径） | smoke 旁路直接截夹具/演示壳 |
| 审计 | Live 副作用有 **audit span**（tool/耗时/artifact） | 无 span，或 span 指向 `fixture-only/` |
| 事件回注 | phase / 入口来自 Host→Kernel **`HostUiEvent`**（SettingsOpened / SettingsAnchorVisible / DeleteAgentPhaseChanged…） | `HostUiShell` **仅内存事件**、无真实 Host 面状态推进 |
| 产物标注 | artifacts 在 §3.3 正规目录；`frame_origin=LiveDisplay` | 目录含 **`fixture-only/`** / 演示壳 / 合成 PNG |

Bit验证：申报升 I 时逐行勾选左列；命中右列任一条 → **拒升**，GAP 保留。禁降 U。

**MoonBit核开工（不自标 I）**：

1. **实现** C′ 可交互 Host 面 + G-UI-1/2 骨架（勿等闭源客户端钩子）。  
2. `host_h2_smoke` 可复跑；对 Live Host 面截真帧 → §3.3 artifacts。  
3. 仅当本波 Host 面尚未编进/未拉起时，smoke 可记 `NOT_READY`（实现中），**禁止**以「无 Grok 客户端钩子」为由长期 BLOCKED。  
4. B 类产物只许 `fixture-only/`，不得混入升 I 路径。  
5. artifacts 齐后点 Bit验证升 I；禁降 U、禁删未升 GAP。

> **波次**：roadmap Wave H2（14）：1901/1902/1907 **优先**，再 1903–1906、0204/0205/0206、1401/1405、1507、2178。  
> **硬性**：禁降 U；禁删未升 GAP；`HostAbi::mock()` 与 Live 并存；I 证据必须真 UI / 真屏，禁止剧本假窗冒充。  
> **对照**：[`host-ui-contract.md`](host-ui-contract.md)、[`qa/host-integration-gaps.md`](qa/host-integration-gaps.md) open 行、H0/H1 证据形（`H1ProbeRecord` / `scripts/host_h*_smoke.sh`）。

### 3.1 现状（相对 U）

| 层 | 已有 | 升 I 仍缺 |
|----|------|-----------|
| Kernel / `ui_protocol` | SettingsEntry 闭集、SettingsAnchor 双射、DeleteAgentPhase 状态机 U-PASS | 无 |
| `HostUiShell` trait 草图 | `open_settings` / `request_delete_agent` / `confirm_delete_agent` | **Live** 实现 + Host→Kernel 事件观测 |
| 真屏 | H1 CM-0605 I-PASS（`:1` LiveDisplay） | H2：打开 **Bit Bot Host UI** Settings/侧栏 Delete 后截 LiveDisplay 真帧 |

### 3.2 Live HostUiShell + 事件回注（契约增量）

Kernel 已有意图类型（见 host-ui-contract）。升 I 需要 Host → Kernel 的可选事件（**观测，非再决策**）：

```moonbit
enum HostUiEvent {
  SettingsOpened(SettingsEntry, SettingsAnchor?)
  SettingsAnchorVisible(SettingsAnchor)  // 深链滚动到位
  DeleteAgentPhaseChanged(AgentId, DeleteAgentPhase)
  // H2 其余面（同波，后置）
  InfoPanelOpened(AgentId)               // CM-0205
  SidebarHiddenAgentAddressable(AgentId) // CM-0204
  MembersPanelVisible                    // CM-1401 / 1405
  LocalExecutionGateChanged(Bool)        // CM-1905
  UpdateComputerPhaseChanged(String)     // CM-1903 两步确认
}

/// Live 专用证据记录（对齐 H1ProbeRecord；i_claimed 永假，仅 Bit验证升裁）
struct H2UiEvidence {
  cm_id : String
  entry : SettingsEntry?          // 1901
  anchor : SettingsAnchor?        // 1902 / 1507 / 2178
  delete_phase : DeleteAgentPhase? // 1907
  frame_origin : FrameOrigin      // 必须 LiveDisplay
  display_id : String             // ":1"（或声明的真屏）
  bytes_sha256 : String
  artifact_dir : String
  evidence_cmd_hint : String
  audit_span_id : String
  i_claimed : Bool                // 骨架恒 false
}
```

**缺口 G-UI-1**：`HostUiShell` **Live** 实现（`box_host`）；Mock 保留仅 U。失败不得静默回落 Mock。  
**缺口 G-UI-2**：出站 `OutboundMessage` 深链 ↔ 真 UI 锚点可见对照；I 抽检 ≥3 锚点（强制含 `theme` / `timezone` / `update-computer`）。  
**缺口 G-UI-3**：`H2UiEvidence` + `scripts/host_h2_smoke.sh`（形同 H0/H1）；产物落 `docs/qa/artifacts/cm-XXXX-*/`。  
**缺口 G-UI-4**：删除助手确认态必须出现 `AwaitingConfirm` 真 UI 帧；无确认不得标 Completed 证据。  
**缺口 G-UI-5**：禁齿轮/Preferences 假路径的 **像素级负例**（打开后断言无齿轮入口控件标签）。

### 3.3 优先三项：升 I 证据格式（Bit验证可机读）

每条升 I 最低字段与 roadmap §3 / H0–H1 一致：`CM` / `evidence_cmd` / `artifact` / `assert` / `env`。

#### CM-1901 — Settings 三入口

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1901` |
| `artifact` | `docs/qa/artifacts/cm-1901-settings-entry/`：三入口各一真帧（`entry_sidebar.png` / `entry_shortcut.png` / `entry_palette.png`）+ `evidence.json` |
| `assert` | 三次均 `frame_origin=LiveDisplay` 且 Settings 壳可见；`evidence.json.entries == [SidebarAccountButton, KeyboardShortcut, CommandPalette]`；负例：无齿轮图标命中 |
| `env` | Bit Bot Live Host UI 可达；`ui_automation=true`；Asia/Shanghai |

契约动作：Live `open_settings(...)` → Bit Bot Host UI 打开 → `SettingsOpened` → Host UI 真帧。

#### CM-1902 — tabs / 锚点深链

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1902` |
| `artifact` | `docs/qa/artifacts/cm-1902-settings-anchors/`：至少 `theme.png` / `timezone.png` / `update-computer.png` + `evidence.json` |
| `assert` | 对每个抽检锚点：深链 `grokbot://app/v1/settings?id=<anchor>` → `SettingsAnchorVisible`；帧内锚点区可见（DOM/无障碍名或像素 ROI 之一，写入 assert）；未知 `id` 不得产生假滚动成功 |
| `env` | 同 1901（Bit Bot Host UI）；Vault/Billing 不可见时允许 `skipped_reason=account_feature_off` |

契约动作：深链由 **Bit Bot Host UI** 消费 → `SettingsAnchorVisible` → Host UI 真帧。

#### CM-1907 — 侧栏右键 Delete + 确认

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1907` |
| `artifact` | `docs/qa/artifacts/cm-1907-delete-agent/`：`context_menu.png` / `awaiting_confirm.png` /（可选）`completed.png` + `evidence.json` |
| `assert` | phase 序列含 `Requested → AwaitingConfirm`；确认前无 `Completed`；删除路径 **不在** Settings；完成后侧栏无该助手行（可与 CM-0203 U 对照，I 需真侧栏帧） |
| `env` | 同 1901（Bit Bot Host UI 侧栏）；**抛型测试助手**（mktemp），禁删真生产助手 |

契约动作：`request_delete_agent` → Host UI 侧栏右键 → 确认框 → phase 事件链 + 真帧。

### 3.4 H2 其余 11 项 — 证据槽位（同脚本，后置落地）

| CM | artifact 子目录 | `assert` 要点（I） |
|----|-----------------|-------------------|
| 1903 | `cm-1903-update-computer/` | 真两步确认 UI；非 Reset |
| 1904 | `cm-1904-reset-computer/` | Reset 真 UI 可达；指引仍非首选 |
| 1905 | `cm-1905-local-execution/` | 关闭后真拒 machineId 调用（Host 闸门日志 + 可选帧） |
| 1906 | `cm-1906-updates-vs-update-computer/` | Updates tab 与 `update-computer` 锚点双轨可区分真帧 |
| 0204 | `cm-0204-hidden-agent/` | Hidden 不占主侧栏列表但仍可寻址（真侧栏） |
| 0205 | `cm-0205-info-panel/` | 五锚点 Info 面板真屏；≠ 全局 Settings |
| 0206 | `cm-0206-notify-toggles/` | 助手级通知开关真 UI 隔离 |
| 1401 | `cm-1401-create-agent-sidebar/` | CreateAgent 后真侧栏 ∧ Members 可见 |
| 1405 | `cm-1405-members-panel/` | Members 与 app-ui 锚点一致 |
| 1507 | `cm-1507-auto-review-deeplink/` | `auto-review` / `auto-review-rules` / `security-keys` 真滚动 |
| 2178 | `cm-2178-permission-guide-settings/` | 缺权限导引真打开 Settings；不假装已连接 |

统一 `evidence_cmd` 形：`bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-<短号>`；`all` 跑优先三项，再可选 `--full` 跑 14。

### 3.5 MoonBit核落地清单（host_h2，不改 U）

1. `box_host`：`H2Intent` / `H2UiEvidence` / `HostAbi::run_h2_probe`（对齐 `h1_probes.mbt`；`i_claimed=false`）。  
2. Live：`HostUiShell` = **Bit Bot 自有 Host UI**（§3.0 C′）；Mock 只记 effect。剧本假窗 ≠ I。  
3. `scripts/host_h2_smoke.sh`：`cm-1901|cm-1902|cm-1907|all`（优先）；对 **C′ Host 面** 截帧；产物目录见 §3.3–3.4。  
4. 点 Bit验证升 I：**仅**对 C′ Live Host artifacts 齐且 assert 过的 CM；其余 GAP 保留。  
5. **禁止**：B 类假窗/合成 PNG / 无 LiveDisplay 申报 I；**禁止**以缺 Grok 客户端钩子停工；禁止改矩阵 U-PASS。


## 4. 真 MCP / OAuth / 出网（Wave H4）— 接口缺口与升 I 证据格式

> **波次**：roadmap Wave H4（7）：**CM-2163 / CM-2164 / CM-1105 / CM-2109 / CM-2120 / CM-2146 / CM-1703**。  
> **硬性**：禁降 U；禁删未升 GAP（**含 CM-0806**）；`HostAbi::mock()` / in-process fake MCP / stub authenticate **永不得**升 I；I 证据必须真 Host FS / 真 OAuth / 真出网。  
> **证据形**：与 H0–H3 一致 — `CM` / `evidence_cmd` / `artifact` / `assert` / `env`；脚本 `scripts/host_h4_smoke.sh`；`H4IoEvidence` / `HostAbi::run_h4_probe`；`i_claimed=false` 直至 Bit验证升裁。  
> **对照**：§5 H3、§3 H2、[`qa/host-integration-gaps.md`](qa/host-integration-gaps.md) open 行（当前 open=17；I-PASS=24）。

### 4.0 口径（可证伪左列 / 拒升右列）

| 面 | **可升 I** | **拒升 I** |
|----|------------|------------|
| MCP `$file:`（2163） | Live Host FS 读盘注入；chat 仅 `$file:` ref；真 MCP call 载荷含注入体 | in-process fake FS；chat 内嵌 LARGE_PAYLOAD；无 Host 读路径 |
| MCP `write_to_file`（2164） | 大结果真写 `/workspace/agent-tools/`；返回路径；chat 无 body | 内存假路径；返回体含 PAYLOAD；目录不存在仍报成功 |
| Slack connect（1105） | 真 OAuth/Details → Connected 完成态；面板可复跑 | stub `authenticate→Ready`；假 Connected 无 token/会话证据 |
| user-Finance（2109） | 真 OAuth NeedsAuth→Ready；认证前拒调 | stub authenticate；无 OAuth 窗/回调证据 |
| Outlook（2120） | 真 OAuth 后 draft/send 可用；NeedsAuth 时拒 | mock draft/send；无 OAuth 完成态 |
| App vs User 浏览器（2146） | 须用户身份时**真切换**已登录浏览器会话（可观测 profile/cookie/CDP 目标） | 仅枚举 `SwitchToSignedInBrowser` 意图；未切会话 |
| Fetch 公共回退（1703） | 真 403/封锁 → browser 或 curl 公共出网成功；auth 墙**不**公共回退 | mock WebHost；用登录 cookie/凭证旁路当「公共回退」 |

Bit验证：申报升 I 时逐行勾选左列；命中右列任一条 → **拒升**，GAP 保留。禁降 U。  
无沙箱账号/无真连接器时：smoke 可记 `NOT_READY`（实现中），**禁止**以 stub 冒充 I；亦禁止永久 BLOCKED 砍能力。

### 4.1 现状（相对 U）

| 层 | 已有（U） | 升 I 仍缺 |
|----|-----------|-----------|
| CM-2163 | `McpHostFs::expand_file_arg`；chat 仅 ref；plain 拒 | Live Host 读盘 + 真 MCP transport 注入 |
| CM-2164 | `write_to_file_result` → `/workspace/agent-tools/` 路径约定 | Live 真写盘 + 可 `stat`/`sha256` 产物 |
| CM-1105 | SetUpSlack connect→Connected 状态机 | 真 Slack OAuth / Details 面板完成流 |
| CM-2109 | NeedsAuth 拒调；stub authenticate→Ready | 真 user-Finance OAuth |
| CM-2120 | NeedsAuth 拒 draft/send；mock 认证后可用 | 真 Outlook OAuth 后 draft/send |
| CM-2146 | App+UserRequired→SwitchToSignedInBrowser 意图 | Live 切到已登录用户浏览器会话 |
| CM-1703 | mock 403→browser/curl 回退；auth 墙拒旁路 | 真出网 fallback；禁凭据绕过可证伪 |

### 4.2 Live 契约增量（保留既有 G-MCP-*，并入本波）

```moonbit
trait McpTransport {
  list_tools(self : Self, ns : String) -> Result[Array[ToolDesc], McpError]
  call(self : Self, ns : String, tool : ToolName, args : Json) -> ToolResult
  auth_status(self : Self, ns : String) -> NamespaceStatus
}

struct McpCallOptions {
  expand_file_refs : Bool     // $file: → Host 读盘注入
  write_to_file : Bool        // 大结果落 /workspace/agent-tools/
  max_inline_bytes : Int
}

/// Live 专用证据（对齐 H0/H1/H2/H3 ProbeRecord）
struct H4IoEvidence {
  cm_id : String
  // 2163 / 2164
  file_ref : String?              // "$file:/workspace/…"
  injected_bytes : Int?
  result_path : String?           // /workspace/agent-tools/…
  path_sha256 : String?
  chat_has_payload_marker : Bool? // 必须 false
  // 1105 / 2109 / 2120
  oauth_provider : String?        // slack | finance | outlook
  namespace_before : String?       // NeedsAuth
  namespace_after : String?        // Ready / Connected
  oauth_callback_observed : Bool?
  // 2146
  identity_mode : String?         // AppSufficient | UserRequired
  browser_session_switched : Bool?
  user_profile_dir : String?
  // 1703
  primary_status : Int?           // e.g. 403
  fallback_kind : String?         // browser | curl
  credential_bypass : Bool?       // 必须 false
  // 共用
  artifact_dir : String
  evidence_cmd_hint : String
  audit_span_id : String
  i_claimed : Bool                // 骨架恒 false
}

enum H4Intent {
  Cm2163McpFileExpand
  Cm2164McpWriteToFile
  Cm1105SlackConnect
  Cm2109FinanceOauth
  Cm2120OutlookOauth
  Cm2146AppVsUserBrowser
  Cm1703FetchPublicFallback
}
```

**缺口 G-MCP-1**：`connectors` U 测可继续用 fake；**Live** 必须走真实 JSON-RPC（stdio/HTTP/SSE 之一，配置化）。  
**缺口 G-MCP-2**：`$file:` 扩展与 `write_to_file` 在 **Host FS** 执行；Kernel 只见路径 ref（U 已测，I 需真盘）。  
**缺口 G-MCP-3**：`needsAuth` → Host 拉起 OAuth；完成前回调 `NamespaceStatus`；禁止 Kernel 存 refresh token 明文。  
**缺口 G-MCP-4**：App-identity vs User-browser（CM-2146）— Live 切换会话的 Host API 须在 `interfaces.md` 写死。  
**缺口 G-H4-1**：`HostAbi::run_h4_probe` / `run_h4_wave`；`scripts/host_h4_smoke.sh`；产物 `docs/qa/artifacts/cm-XXXX-*/`。  
**缺口 G-H4-2**：OAuth 三项（1105/2109/2120）共用「真回调可观测」模板；sandbox 账号或 `NOT_READY` 诚实标记。  
**缺口 G-H4-3**：1703 负例：登录墙 URL 不得走公共 fallback 成功。

### 4.3 七项：升 I 证据格式（Bit验证可机读）

每条升 I 最低字段与 roadmap §3 / H0–H3 一致：`CM` / `evidence_cmd` / `artifact` / `assert` / `env`。

#### CM-2163 — MCP `$file:` 注入

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2163` |
| `artifact` | `docs/qa/artifacts/cm-2163-mcp-file-expand/`：源文件副本、`mcp_call.args.json`（注入后）、`chat_excerpt.txt`、`evidence.json` |
| `assert` | Host 真读 `$file:` 路径；MCP 侧收到注入体；chat 仅 ref、**无** LARGE_PAYLOAD；plain 字符串拒扩展；audit span |
| `env` | Live MCP transport（非 in-process fake）；Asia/Shanghai |

#### CM-2164 — MCP `write_to_file`

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2164` |
| `artifact` | `docs/qa/artifacts/cm-2164-mcp-write-to-file/`：结果文件（或 sha256+size）、`returned_path.txt`、`chat_excerpt.txt`、`evidence.json` |
| `assert` | 路径前缀 `/workspace/agent-tools/`；文件可 `stat`；返回值含路径、**不含** PAYLOAD body；chat 无 PAYLOAD；audit span |
| `env` | 同 2163 |

#### CM-1105 — Slack connect

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-1105` |
| `artifact` | `docs/qa/artifacts/cm-1105-slack-connect/`：OAuth 前后 `NamespaceStatus`、Details 面板帧或 HAR 摘要、`evidence.json`（**禁**写入 refresh token 明文） |
| `assert` | NeedsAuth/未连接 → 真 OAuth/Details → Connected；认证前相关写操作拒；非 stub authenticate |
| `env` | 沙箱 Slack 应用或 `NOT_READY`；Asia/Shanghai |

#### CM-2109 — user-Finance NeedsAuth

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2109` |
| `artifact` | `docs/qa/artifacts/cm-2109-finance-oauth/`：auth 前后状态、OAuth 回调观测日志、`evidence.json` |
| `assert` | NeedsAuth 时工具不可调；真 authenticate → Ready；非 stub |
| `env` | 沙箱 Finance 连接器或 `NOT_READY` |

#### CM-2120 — Outlook auth→draft/send

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2120` |
| `artifact` | `docs/qa/artifacts/cm-2120-outlook-oauth/`：NeedsAuth 拒稿日志、OAuth 完成态、认证后 draft（或 draft 卡）回执、`evidence.json` |
| `assert` | NeedsAuth 拒 draft/send；真 OAuth 后至少 draft 成功（send 可按出站规则只到草稿）；非 mock |
| `env` | 沙箱 Outlook 或 `NOT_READY`；出站仍遵守草稿默认 |

#### CM-2146 — App vs User 浏览器

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2146` |
| `artifact` | `docs/qa/artifacts/cm-2146-app-vs-user-browser/`：切换前后 session/profile 标识、`evidence.json` |
| `assert` | UserRequired → `browser_session_switched=true` 且可观测用户 profile；AppSufficient 不强制切；非仅意图枚举 |
| `env` | Live Host 浏览器；Asia/Shanghai |

#### CM-1703 — Fetch 公共回退

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-1703` |
| `artifact` | `docs/qa/artifacts/cm-1703-fetch-public-fallback/`：primary 失败日志（403/block）、fallback body 摘要、负例 auth-wall 日志、`evidence.json` |
| `assert` | 公共 URL：primary 失败后 browser **或** curl 真出网成功；`credential_bypass=false`；登录墙 URL 公共回退必须失败/拒 |
| `env` | 真出网；Asia/Shanghai |

统一 `evidence_cmd` 形：`bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-<短号>`；`all` 跑七项（缺账号项可 `NOT_READY` 但不造假）。

### 4.4 MoonBit核落地清单（host_h4，不改 U）

1. `box_host` / `connectors` / `tools`：`H4Intent` / `H4IoEvidence` / `HostAbi::run_h4_probe`（对齐 h0–h3；`i_claimed=false`）。  
2. Live：`McpTransport` JSON-RPC；Host FS `$file:` / `write_to_file`；OAuth 回调观测；浏览器会话切换；Fetch 真 fallback。  
3. `scripts/host_h4_smoke.sh`：`cm-2163|cm-2164|cm-1105|cm-2109|cm-2120|cm-2146|cm-1703|all`。  
4. 点 Bit验证升 I：仅 artifacts 齐且左列 assert 过的 CM；其余 GAP 保留（**0806 不删**）。  
5. **禁止**：in-process fake MCP、stub OAuth、假路径、凭据旁路冒充公共回退；禁止改矩阵 U-PASS。

## 5. Host FFI（Wave H3）— 接口缺口与升 I 证据格式

> **波次**：roadmap Wave H3（4）：**CM-2158 / CM-2174 / CM-0705 / CM-0411**。  
> **硬性**：禁降 U；禁删未升 GAP（**含 CM-0806**，H1 残余，不并入本波）；`HostAbi::mock()` 与 Live 并存；I 证据必须真 Shell/FS/OS 面板，禁止 mock effect 字符串冒充。  
> **证据形**：与 H0–H2 一致 — `CM` / `evidence_cmd` / `artifact` / `assert` / `env`；脚本 `scripts/host_h3_smoke.sh`；`H3FfiEvidence` / `HostAbi::run_h3_probe`；`i_claimed=false` 直至 Bit验证升裁。  
> **对照**：H0（`H0ProbeRecord` / `host_h0_smoke`）、H1（`H1ProbeRecord`）、H2（`H2UiEvidence` / §3.0）、[`qa/host-integration-gaps.md`](qa/host-integration-gaps.md) open 行。

### 5.0 口径（相对 H0 时钟/探针）

| 面 | I 语义 | 拒升 |
|----|--------|------|
| Shell 装包（2158） | 经 Live **`HostAbi::shell`** 真跑 apt/npm（沙箱）；audit span；stdout/stderr/exit 真值 | mock `shell:` 字符串、旁路 direct apt API、无 span |
| 跨代理 FS（2174） | **两助手会话**真同盘读写 + **异桌面** display；CHARTER 一致 | 单 HostAbi mock 自写自读冒充双会话；同 display 冒充异桌面 |
| 设备权限（0705） | 真 OS 权限路径（手机）**或**诚实 **平台子集声明**（桌面无 deviceLocalTools） | 内存假卡冒充 OS 对话框；桌面谎称已获手机权限 |
| Webhook 面板（0411） | 真 Host 面板可复制 URL/key；助手 `assistant_tool_read_key` → 拒；wake 含 `<webhook_event>` 且不泄 key | 仅 U 内存 `WebhookPanelSecrets`；面板假框无复制回执 |

Bit验证：申报升 I 时按上表左列勾选；命中右列 → **拒升**，GAP 保留。禁降 U。

### 5.1 现状（相对 U）

| 层 | 已有（U） | 升 I 仍缺 |
|----|-----------|-----------|
| CM-2158 | `plan_box_package_install` / `install_box_package_via_shell` / `reject_non_shell_*`；HostAbi mock effects 含 `shell:` | Live shell 真 apt/npm（沙箱）+ 日志产物 |
| CM-2174 | `charter_shared_box_fs` / `check_cross_agent_shared_box_charter`（mock 双读） | Live 双会话夹具：A 见 B 写；桌面 display 不同 |
| CM-0705 | `DeviceLocalToolsRegistry` / `needs_permission`→审批卡；桌面无工具 | Live OS 权限卡 **或** `platform_subset=desktop_no_device_local_tools` 声明产物 |
| CM-0411 | `WebhookPanelSecrets` opaque；wake 标签；tool-read 拒 | Live Host 面板复制回执 + 工具读 key 拒的 Host 闸门日志 |
| H0 对照 | 0607/0608/2175 **I-PASS** | 本波不重复；时钟/doctor 契约复用 G-SH/G-TIME 精神 |

**既有缺口保留（§5 旧表并入，不删）**：

| 缺口 | 说明 | 波次 |
|------|------|------|
| G-SH-1 | Live `shell`：真实 pid/exit/stdout/stderr/timeout；与 mock effect 字符串协议兼容或版本化 | H3（2158 消费） |
| G-SH-2 | `AwaitShell` Live：真后台 job 表 | H3 基建（本波可先最小可用） |
| G-FS-1 | 跨代理共享 FS + 异桌面（CM-2174）— Live 双会话夹具 | H3 |
| G-TIME-1 | Live `date` 对齐用户 tz（CM-2175） | **H0 I-PASS**（保留指针，不重开） |
| G-DEV-1 | Live deviceLocalTools 权限卡 / 平台子集声明（CM-0705） | H3 |
| G-WH-1 | Live Webhook 面板复制 URL/key + opaque 闸门（CM-0411） | H3 |

### 5.2 Live Host FFI + 证据记录（契约增量）

```moonbit
/// Live 专用证据记录（对齐 H0ProbeRecord / H1ProbeRecord / H2UiEvidence）
struct H3FfiEvidence {
  cm_id : String
  // 2158
  package_manager : String?       // "apt" | "npm" | …
  shell_pid : Int?
  shell_exit : Int?
  // 2174
  agent_a_id : String?
  agent_b_id : String?
  shared_path : String?           // e.g. /workspace/cross-agent-shared.txt
  desktop_a_display : String?
  desktop_b_display : String?
  // 0705
  platform_subset : String?       // None=真手机路径；Some("desktop_no_device_local_tools")
  permission_card_shown : Bool?
  // 0411
  panel_copy_url_ok : Bool?
  panel_copy_key_ok : Bool?
  tool_read_key_rejected : Bool?
  wake_has_webhook_event : Bool?
  // 共用
  artifact_dir : String
  evidence_cmd_hint : String
  audit_span_id : String
  i_claimed : Bool                // 骨架恒 false
}

enum H3Intent {
  Cm2158PackageInstall
  Cm2174SharedBoxFs
  Cm0705DeviceLocalTools
  Cm0411WebhookKeyOpaque
}
```

**缺口 G-H3-1**：`HostAbi::run_h3_probe` / `run_h3_wave`（形同 `h0_probes` / `h1_probes`）；Mock 只记计划；Live 写 audit span。  
**缺口 G-H3-2**：`scripts/host_h3_smoke.sh`（`cm-2158|cm-2174|cm-0705|cm-0411|all`）；产物 `docs/qa/artifacts/cm-XXXX-*/`。  
**缺口 G-H3-3**：2158 沙箱策略写死（允许装/卸的包白名单或 `--dry-run`+真 exit 二选一；优先真装可卸载小包）。  
**缺口 G-H3-4**：2174 双会话不得共用同一 `HostAbi::mock()` 实例冒充；须两 Live 会话或等价双 cwd/双 desktop 夹具。  
**缺口 G-H3-5**：0705 无手机时 **必须** 产出 `platform_subset.md` 声明，不得静默跳过当 I-PASS。  
**缺口 G-H3-6**：0411 面板须 Bit Bot Host 面（可与 H2 C′ 同进程）；复制动作有回执（剪贴板或面板「已复制」日志），非纯内存字段。

### 5.3 四项：升 I 证据格式（Bit验证可机读）

每条升 I 最低字段与 roadmap §3 / H0–H2 一致：`CM` / `evidence_cmd` / `artifact` / `assert` / `env`。

#### CM-2158 — 经 Shell 装包

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-2158` |
| `artifact` | `docs/qa/artifacts/cm-2158-package-install/`：`shell.stdout.txt` / `shell.stderr.txt` / `shell.meta.txt`（pid/exit/cmd）+ `evidence.json` +（可选）卸载回执 |
| `assert` | 命令经 Live `HostAbi::shell`（或 smoke 调 `run_h3_probe(Cm2158…)`）；cmd 含 `apt-get`/`npm`；`exit` 真值；**拒** non-Shell 旁路有负例日志；`audit_span` 存在；`i_claimed=false` 直至升裁 |
| `env` | box Live Host；沙箱；Asia/Shanghai；禁止污染共享生产 PATH 的不可逆全局装包（白名单或装后卸） |

契约动作：`plan_box_package_install` → Live `shell` → 真 OS 包管理器 → audit span + 日志产物。

#### CM-2174 — 跨代理共享 box FS

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-2174` |
| `artifact` | `docs/qa/artifacts/cm-2174-shared-box-fs/`：`agent_b_write.txt` 副本、`agent_a_read.txt`、`desktops.json`（两 display）+ `evidence.json` |
| `assert` | A 读到 B 写入的同一路径内容；`desktop_a_display != desktop_b_display`；`shared_fs=true`；异 Host 实例不得串盘负例（可选）；非单 mock 自写自读 |
| `env` | 同 box Live；两助手会话（或等价双会话夹具）；Asia/Shanghai |

契约动作：会话 B `write(shared_path)` → 会话 A `read(shared_path)` → 对照 `desktop_for(A/B)`。

#### CM-0705 — 设备本地工具权限卡

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-0705` |
| `artifact` | `docs/qa/artifacts/cm-0705-device-local-tools/`：**路径甲**真 OS 权限对话框帧/系统日志；**或路径乙** `platform_subset.md`（声明桌面无 deviceLocalTools）+ 桌面 `list_for` 空工具证据 + `evidence.json` |
| `assert` | 路径甲：`needs_permission` → 真审批卡可见且 `permission_card_shown=true`；denied 无卡。路径乙：声明含 `desktop_no_device_local_tools` 且桌面工具列表为空；**禁止**内存假卡当 I |
| `env` | 有手机机：真 OS；仅桌面：平台子集声明合法；Asia/Shanghai |

契约动作：Live `device_local_tools_for` → OS 权限路径 **或** 诚实子集声明产物。

#### CM-0411 — Webhook key 不透明

| 字段 | 要求 |
|------|------|
| `evidence_cmd` | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-0411` |
| `artifact` | `docs/qa/artifacts/cm-0411-webhook-panel/`：面板真帧或复制回执日志、`tool_read_key.err.txt`、`wake_payload.txt` + `evidence.json` |
| `assert` | 用户从 **真 Host 面板**复制 URL/key 有回执；`assistant_tool_read_key` → Err（opaque）；wake 含 `<webhook_event>` 且 **不含** key 明文；仅 U 内存 secrets **不得**升 I |
| `env` | Bit Bot Live Host 面板可达（可与 H2 C′ 同进程）；Asia/Shanghai |

契约动作：面板展示 → 用户复制 → 工具读 key 拒 → webhook wake 事件标签不泄密。

### 5.4 MoonBit核落地清单（host_h3，不改 U）

1. `box_host`：`H3Intent` / `H3FfiEvidence` / `HostAbi::run_h3_probe` / `run_h3_wave`（对齐 `h0_probes.mbt` / `h1_probes.mbt`；`i_claimed=false`）。  
2. Live：`shell` / 双会话 FS / deviceLocalTools 或平台子集 / Webhook 面板闸门；Mock 只记 effect。  
3. `scripts/host_h3_smoke.sh`：`cm-2158|cm-2174|cm-0705|cm-0411|all`；产物目录见 §5.3。  
4. 点 Bit验证升 I：**仅** artifacts 齐且 assert 过的 CM；其余 GAP 保留（**0806 不删**）。  
5. **禁止**：mock stdout 冒充真 apt；单 mock 自写自读冒充 2174；假权限卡；无面板复制回执申报 0411；禁止改矩阵 U-PASS。

## 6. 媒体 / 卡 / 像素渲染（Wave H5）— 接口缺口与升 I 证据格式

> **波次**：roadmap Wave H5（9）：**CM-1601 / CM-1602 / CM-1603 / CM-2157 / CM-1807 / CM-2131 / CM-2101 / CM-2128 / CM-2103**。  
> **硬性**：禁降 U；禁删未升 GAP（**含 CM-0806**）；`HostAbi::mock()` / mock MediaHost / 假 magic-only 字符串 **永不得**升 I；I 证据必须真文件 / 真 Host UI 帧。  
> **证据形**：与 H0–H4 一致 — `CM` / `evidence_cmd` / `artifact` / `assert` / `env`；脚本 `scripts/host_h5_smoke.sh`；`H5MediaEvidence` / `HostAbi::run_h5_probe`；`i_claimed=false` 直至 Bit验证升裁。  
> **残差**：CM-0806 保持 GAP / NOT_READY（共享会话规则：禁拷 `chrome-profile` cookies、禁碰 CDP 9223）；CM-0705 仅强化 `platform_subset=desktop_no_device_local_tools`（真手机 OS 卡仍 GAP）。

### 6.0 口径（可证伪左列 / 拒升右列）

| 面 | **可升 I** | **拒升 I** |
|----|------------|------------|
| GenerateImage（1601） | Pillow（或等价）真写 PNG 于 `/workspace/agent-tools/`；magic `89504e47`；可打开 | mock magic-only 字符串；无落盘；假路径 |
| GenerateVideo（1602） | ffmpeg 真编码短 mp4；completion 通知 meta | 空文件 / 仅字符串「done」 |
| watchVideo（1603） | 真解码抽帧 PNG（magic 同上） | 预置无关 PNG 冒充抽帧 |
| StructuredChart（2157） | 结构化数据 → 真 chart PNG（可 Pillow；禁假矩阵） | 无数据合成装饰图冒充 chart |
| PPTX（1807） | python-pptx 真 `.pptx`（PK zip）；路径在 `/workspace` | 假扩展名 / 非 zip |
| cursor-agent 卡（2131） | Host UI 卡 + 隔离 chrome 打开 `https://cursor.com/agents/<id>` 抛型 | 共享 CDP **9223**；拷共享 profile |
| ReactToMessage（2101） | Host UI pill 可见/toggle；`/api/host/*`；LiveDisplay | CDP 页面 JS 突变（B） |
| 出站 React end_turn（2128） | end_turn 后 pill 仍在 LiveDisplay 帧 | 仅内存事件无像素 |
| math / mermaid（2103） | Host UI 真渲染公式 + 图（KaTeX/SVG + mermaid/SVG）；LiveDisplay | 纯文本冒充渲染 |

Bit验证：申报升 I 时逐行勾选左列；命中右列任一条 → **拒升**，GAP 保留。禁降 U。  
**禁止**宣称本波 `i_claimed=true` / 翻矩阵 I-PASS。

### 6.1 现状（相对 U）

| 层 | 已有（U） | 升 I 仍缺 |
|----|-----------|-----------|
| CM-1601 | GenerateImage kernel-contract / mock MediaHost | 真 PNG 落盘可打开 |
| CM-1602 / 1603 | 视频编解码契约 | 真 mp4 + 真抽帧 |
| CM-2157 | StructuredChart 契约 | 真 chart 渲染 PNG |
| CM-1807 | PPTX 契约 | 真 host-openable pptx |
| CM-2131 | cursor-agent 卡契约 | 真打开云代理页（隔离） |
| CM-2101 / 2128 | ReactToMessage / end_turn 契约 | Host UI pill 像素 |
| CM-2103 | math/mermaid 契约 | Host UI 真渲染帧 |

### 6.2 Live 契约增量

```moonbit
struct H5MediaEvidence {
  cm_id : String
  image_path : String?          // 1601 / 2157
  png_magic_ok : Bool?
  video_path : String?          // 1602
  video_complete_notified : Bool?
  frame_path : String?          // 1603
  pptx_path : String?           // 1807
  pptx_pk_magic_ok : Bool?
  cursor_agent_url : String?    // 2131
  cursor_agent_opened : Bool?
  react_emoji : String?         // 2101 / 2128
  pill_visible : Bool?
  end_turn_left_pill : Bool?
  math_rendered : Bool?         // 2103
  mermaid_rendered : Bool?
  artifact_dir : String
  evidence_cmd_hint : String
  audit_span_id : String
  i_claimed : Bool              // 骨架恒 false
}

enum H5Intent {
  Cm1601GenerateImage
  Cm1602GenerateVideo
  Cm1603WatchVideo
  Cm2157StructuredChart
  Cm1807Pptx
  Cm2131CursorAgentCard
  Cm2101ReactToMessage
  Cm2128OutboundReactEndTurn
  Cm2103MathMermaid
}
```

**缺口 G-H5-1**：`HostAbi::run_h5_probe` / `run_h5_wave`；`scripts/host_h5_smoke.sh` + `host_h5_media.py`；产物 `docs/qa/artifacts/cm-XXXX-*/`。  
**缺口 G-H5-2**：UI 三项（2101/2128/2103）+ 2131 走 C′ `HostUiShell` → `/api/host/*`；禁 CDP page-JS。  
**缺口 G-H5-3**：残差 0806 / 0705 诚实 NOT_READY / platform_subset；禁删 GAP。

### 6.3 九项：升 I 证据格式（Bit验证可机读）

| CM | evidence_cmd | artifact | assert |
|----|--------------|----------|--------|
| CM-1601 | `bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1601` | `docs/qa/artifacts/cm-1601-generate-image/` | PNG magic `89504e47`；path under agent-tools |
| CM-1602 | `… cm-1602` | `cm-1602-generate-video/` | mp4 真编码 + completion notify |
| CM-1603 | `… cm-1603` | `cm-1603-watch-video/` | 抽帧 PNG magic |
| CM-2157 | `… cm-2157` | `cm-2157-structured-chart/` | chart PNG from structured series |
| CM-1807 | `… cm-1807` | `cm-1807-pptx/` | PK zip `.pptx` under `/workspace` |
| CM-2131 | `… cm-2131` | `cm-2131-cursor-agent-card/` | card + isolated open；9223 untouched |
| CM-2101 | `… cm-2101` | `cm-2101-react-pill/` | pill visible/toggle；LiveDisplay |
| CM-2128 | `… cm-2128` | `cm-2128-react-end-turn/` | end_turn 后 pill 像素 |
| CM-2103 | `… cm-2103` | `cm-2103-math-mermaid/` | math+mermaid 可见帧 |

### 6.4 MoonBit核落地清单（host_h5，不改 U）

1. `box_host/h5_probes.mbt`：`H5Intent` / `H5MediaEvidence` / `HostAbi::run_h5_probe`（`i_claimed=false`）。  
2. `box_host/host_h5_test.mbt`：骨架测；禁宣称 I-PASS。  
3. `scripts/host_h5_smoke.sh`：`cm-1601|…|media|ui|all`；残差 `residual-0806|residual-0705`。  
4. 扩展 `scripts/host_ui_surface/`：pill / math-mermaid / cursor-agent card（C′）。  
5. **禁止**：翻 capability-matrix I-PASS；删 0806 GAP；碰 9223 / chrome-profile；stub OAuth Connected。

## 7. computerUse / 浏览器（H1）

| 缺口 | 说明 |
|------|------|
| G-CU-1 | Live 启动 box-chrome 路径与 lockfile（CM-0802） |
| G-CU-2 | 导航与截帧流水线复用 G-SCR-*（CM-2160） |
| G-CU-3 | 禁止 Shell 旁路 xdotool/CDP（U 已拒；I 需确认真环境无旁路成功） |

## 8. 与 `interfaces.md` 的修订建议（增量，不破 U）

1. §9 `HostAbi` 增加 `backend : HostBackend` 与 Live 专用证据字段（§2）— **G-ABI 已由 MoonBit核落地，文档回填即可**。  
2. 新增 §9.1 `McpTransport` + `H4IoEvidence` + `scripts/host_h4_smoke.sh`（本节 §4；**H4 立即需要**）。  
3. 新增 §9.2 `HostUiEvent` + `H2UiEvidence`（本节 §3；H2 已用）。  
4. 标明：`HostAbi::mock()` **仅**用于 U；CI 的 I job 必须 `Live`。  
5. §9.3 引用 `scripts/host_h2_smoke.sh` 与 artifacts 约定（对齐 H0/H1）。  
6. §9.4 `H3Intent` + `H3FfiEvidence` + `scripts/host_h3_smoke.sh`（本节 §5；H3 已兑现）。  
7. §9.5 `H5Intent` + `H5MediaEvidence` + `scripts/host_h5_smoke.sh`（本节 §6；H5 本波）。

具体 `.mbt` 落地由 MoonBit核执行；本文只定契约缺口，避免实现方用 mock 填 I。

## 9. 跟踪

| 文档 | 用途 |
|------|------|
| [`host-integration-roadmap.md`](host-integration-roadmap.md) | 波次与升 I 顺序 |
| [`qa/host-integration-gaps.md`](qa/host-integration-gaps.md) | **I 库存权威表（open=17；I-PASS=24）** |
| `qa/gaps.md` | U 裁决 + I 证据摘要 |
| [`host-ui-contract.md`](host-ui-contract.md) | CM-19xx Kernel 契约 |
| `architecture.md` §2.1 | 分层总原则 |

**已挂 GAP 不因本文删除**（升 I 后由 Bit验证改 gaps 行）。  
**波次状态（2026-10-17 09:14 Asia/Shanghai）**：H0–H5 **smoke + I-PASS** 齐（41 行库存 **open=0**）；H1 含 CM-0806；H4 OAuth 用 local sandbox IdP；0705 residual 真手机 OS 卡仍 GAP（非 open 库存行）。详见 `qa/gaps.md`「升裁 H4·OAuth + CM-0806」。
