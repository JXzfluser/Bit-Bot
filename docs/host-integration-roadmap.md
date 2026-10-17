# Host-integration 验收路线（下一阶段）

> **前提**：内核契约已收口 — Bit验证 **PASS=234/234**（口径=`kernel-contract` / U）。  
> **硬性**：不得改写、降级或删除已 PASS 的 kernel-contract 口径；本阶段只**追加** Host-integration（I）证据轨。  
> **时间基准**：2026-10-17 Asia/Shanghai · 作者：Bit架构  
> **对齐**：`architecture.md` §2.1、`adr/0002`、`host-ui-contract.md`、`qa/gaps.md`、`capability-matrix.md`  
> **I 库存权威表**：[`qa/host-integration-gaps.md`](qa/host-integration-gaps.md)（**41** 行，MoonBit核维护；本路线图分波必须覆盖该表全集，不得少列）

## 1. 目标

把目前大量「kernel-contract PASS + **host-integration GAP**」的能力，按可证伪 Host 证据升到 **I（host-integration）**，覆盖三类真依赖：

1. **真屏 / Desktop `:1`** — Screenshot、computerUse、Host UI 像素路径  
2. **Host FFI** — 真实 Shell/FS/`date`/跨代理同 box、Update Computer、本机权限卡  
3. **真 MCP I** — 真实 MCP transport、OAuth、`$file:` 注入与大结果落盘、Gmail/GitHub 等连接器出网

## 2. 验收分层（不可混裁）

| 层 | 代码位置 | 证据 | 可否 mock |
|----|----------|------|-----------|
| **U · kernel-contract** | `*/acceptance_*.mbt`、`HostAbi::mock()` | 类型/状态机/策略/路径约定 | **允许** mock Host |
| **I · host-integration** | Host 进程 + 集成脚本 / 真环境探针 | 真屏帧、真进程、真 OAuth、真 MCP JSON-RPC | **禁止**用占位 PNG / stub transport 冒充 |

裁决规则（Bit验证既有拍板，保持）：

- 矩阵主行可继续记 **PASS（U）**。  
- **host-integration GAP 另列跟踪**；升 I 前**不得删 GAP**。  
- 拒绝「整项挂死到真 Host」导致内核长期 FAIL（见 gaps CM-0605 选 A）。

## 3. 证据格式（升 I 最低条）

每条升 I 必须在 [`qa/host-integration-gaps.md`](qa/host-integration-gaps.md) 更新状态，并在 `qa/gaps.md` 留证据摘要：

| 字段 | 要求 |
|------|------|
| `CM-*` | 合同 ID |
| `evidence_cmd` | 可复现命令（如跑集成脚本、探针） |
| `artifact` | 路径：真 PNG / 日志 / MCP trace / HAR 摘要 |
| `assert` | 可机读断言（帧非占位魔数策略、display=:1、HTTP 200 from real endpoint…） |
| `env` | box runtime（local-docker / hosted-anyrun）、时区、账号是否沙箱 |

**占位魔数 PNG、空 OAuth stub、MCP in-process fake server** → 仍算 U，不算 I。

## 4. backlog 分波（覆盖 `qa/host-integration-gaps.md` 全 41 行）

**权威库存**：[`qa/host-integration-gaps.md`](qa/host-integration-gaps.md)（MoonBit核）。本分波是排期视图；增删 CM 以库存表为准，改库存后须回写本分波覆盖证明。

**覆盖证明（41）**：H0(3)+H1(4)+H2(14)+H3(4)+H4(7)+H5(9)=41。

### Wave H0 — 探针与绿线（先打通 I 流水线）· 3

| ID | 主题 | I 成功信号 |
|----|------|------------|
| CM-0607 | box doctor 真探针 | 真写 `/tmp/box-doctor.log`，PASS/FAIL 来自真环境 |
| CM-0608 | docker/anyrun 探测 | 真读 `/.dockerenv` 或等价 Host 探针 |
| CM-2175 | box 时钟对齐用户时区 | 真执行 `date`，匹配用户 IANA |

**出口**：Host 侧集成入口跑通 H0；产物落 `docs/qa/artifacts/`。与 MoonBit核 **Live 骨架**并行。

> **状态（2026-10-17）**：**smoke + I-PASS 完成**（Bit验证）。

### Wave H1 — 真屏与 Desktop（`:1`）· 4

| ID | 主题 | I 成功信号 |
|----|------|------------|
| **CM-0605** | Screenshot | `frame_origin=LiveDisplay`，display `:1`；非占位帧；`read_only`；未 click |
| CM-0802 | box-chrome 启动 | 真进程 + lockfile pid；拒裸 Chrome |
| CM-2160 | 浏览器导航可达 | 真导航公共 URL；可截真帧 |
| CM-0806 | Update 后登录态 | 真 Update Computer 后 cookie/jar 仍在 |

**出口**：CM-0605 host-integration GAP → **I PASS**（矩阵 U-PASS 不变）。

> **状态（2026-10-17）**：**smoke + I-PASS 完成**（含 CM-0806 隔离 throwaway jar；共享 9223 untouched）。

### Wave H2 — Host UI（真控件）· 14

| ID | 主题 | I 成功信号 |
|----|------|------------|
| CM-1901 | Settings 三入口 | 真侧栏账户 / Cmd+, / 命令面板 |
| CM-1902 | tabs/锚点深链 | 真滚动到 `id=`（抽测 theme/timezone/update-computer） |
| CM-1903 | Update Computer | 真两步确认 |
| CM-1904 | Reset Computer | 真 UI；非首选指引仍成立 |
| CM-1905 | local-execution | 关闭后真拒 machine 调用 |
| CM-1906 | Updates ≠ Update Computer | 真 UI 双轨可区分 |
| CM-1907 | 删除助手 | 真侧栏右键 Delete + 确认 |
| CM-0204 | Hidden 助手 | 真侧栏不占主列表仍可寻址 |
| CM-0205 | Info 面板五锚点 | 真屏与 app-ui 一致 |
| CM-0206 | 助手级通知开关 | 真 Host UI 隔离 |
| CM-1401 | CreateAgent 入侧栏/Members | 真面板 |
| CM-1405 | Members 与 app-ui | 真面板 |
| CM-1507 | auto-review 深链 | 真锚点滚动 |
| CM-2178 | 缺权限导 Settings | 真打开；不假装已连接 |

契约：[`host-ui-contract.md`](host-ui-contract.md)。

> **QA 注脚（Bitbot · 2026-10-17 14:34 Asia/Shanghai）**：H2 升 I **以 C′ 为准**（Bit Bot 自有 Live Host UI 真帧）；**拒 B**；**A（Grok/Cursor 闭源钩子）非升 I 前置**——若他文曾写「A=唯一 I」语义，以本注脚与 [`qa/gaps.md`](qa/gaps.md)「H2 升 I 口径」、[`host-integration-interface-gaps.md`](host-integration-interface-gaps.md) §3.0 覆盖。不改本路线正文大段。

> **状态（2026-10-17）**：**smoke + I-PASS 完成**（×14）。

### Wave H3 — Host FFI（Shell/FS/机器/面板）· 4

| ID | 主题 | I 成功信号 |
|----|------|------------|
| CM-2158 | 经 Shell 装包 | 真 apt/npm（沙箱） |
| CM-2174 | 跨代理共享 box FS | 两助手真同盘异桌面 |
| CM-0705 | 设备本地工具权限卡 | 真 OS 权限路径（或平台子集声明） |
| CM-0411 | Webhook key 不透明 | 真面板复制；工具读 key → 拒 |

> **状态（2026-10-17）**：**smoke + I-PASS 完成**（0705=平台子集；真手机 OS 卡 residual 仍 GAP）。

### Wave H4 — 真 MCP / OAuth / 出网（库存内）· 7

| ID | 主题 | I 成功信号 |
|----|------|------------|
| CM-2163 | MCP `$file:` | 真 Host FS 注入；chat 仅 ref |
| CM-2164 | MCP write_to_file | 真写 `/workspace/agent-tools/`；返回路径 |
| CM-1105 | Slack connect | 真 OAuth/Details 完成态 |
| CM-2109 | user-Finance NeedsAuth | 真 OAuth → Ready |
| CM-2120 | Outlook auth→draft/send | 真 OAuth 后可用 |
| CM-2146 | App vs User 浏览器 | 真切换已登录浏览器会话 |
| CM-1703 | Fetch 公共回退 | 真出网；禁凭据绕过 |

> **库存外延（不计入 41，勿抢占 H0–H1）**：若后续将 CM-0901–0903/0905/0906/0908 等列入 host-integration-gaps，再并入本波；当前以 41 行表为准。

> **状态（2026-10-17）**：**smoke + I-PASS 完成**（OAuth 三项用 **local sandbox IdP**，非生产）。

### Wave H5 — 媒体 / 卡 / 像素渲染 · 9

| ID | 主题 | I 成功信号 |
|----|------|------------|
| CM-1601 | GenerateImage | 真出图产物可打开 |
| CM-1602 | GenerateVideo | 真编码完成可通知 |
| CM-1603 | watchVideo | 真解码抽帧 |
| CM-2157 | StructuredChart | 真图渲染/编码 |
| CM-1807 | PPTX | 真文件可被宿主打开 |
| CM-2131 | cursor-agent 卡 | 真打开云代理页 |
| CM-2101 | ReactToMessage pill | 真消息 pill 可见/toggle |
| CM-2128 | 出站 React end_turn | 真 pill 像素 |
| CM-2103 | math / mermaid | 真公式/图画渲染 |

> **状态（2026-10-17）**：**smoke + I-PASS 完成**（×9）。41 行库存 **open GAP=0**；phone residual 另记。

## 5. 与 ROADMAP 映射

| ROADMAP | Host-integration 波次 |
|---------|------------------------|
| M3 Hosts | H0 + H1 + H3 |
| M4 Connectors & IO | H4 |
| M5–M6 UI/垂直 | H2 + H5 |
| M7 Hardening | 全波 I 清零（或平台声明子集 + 残留 GAP 显式标平台 N/A） |

**禁止**：为冲 I 而改 U 测名/删 GAP/把 mock 改称 I。

## 6. 角色分工

| 角色 | 职责 |
|------|------|
| **Bit架构** | 本路线 + [`host-integration-interface-gaps.md`](host-integration-interface-gaps.md) 契约缺口 |
| **MoonBit核** | 保持 U 绿；扩展 HostAbi **真实适配器**入口（不砍 mock） |
| **Bitbot** | 排期 H0→H1 优先；Host 仓/进程归属拍板 |
| **Bit验证** | 升 I 裁决；artifacts 另列 host-integration；冒烟增加 I 子集 |
| **能力对标** | 矩阵可加列 `I-status`（todo/GAP/PASS），**不改**已 U-PASS 行语义 |

## 7. 建议立即开工顺序（给 MoonBit核 / Host）

1. 落地 **真实 `HostAbi` 适配器**骨架（与 `HostAbi::mock()` 并存）— 见接口缺口文档 §1–2。  
2. H0 三探针集成脚本 + artifacts 目录约定。  
3. **CM-0605 I**：`:1` 真截屏证据链（关闭「占位魔数即 I」）。  
4. H2 抽测 CM-1901/1902/1907 真 UI（可与 H1 并行若有 desktop）。  
5. H4：先真 MCP list_tools + 一记只读 call（CM-0901/0902），再 Auth。

## 8. 非目标（本阶段）

- 不重开已 U-PASS 的 234 项内核辩论。  
- 不把 Host 实现塞进 `tools/`（仍经 `box_host`）。  
- 不要求一次清零全部 I；按波次升裁。

## 9. 库存交叉引用

- I 缺口库存（权威）：[`qa/host-integration-gaps.md`](qa/host-integration-gaps.md) · 41 行
- 接口缺口：[`host-integration-interface-gaps.md`](host-integration-interface-gaps.md)
- 主缺口报告：`qa/gaps.md`（U 裁决；I 证据摘要回写于此）
