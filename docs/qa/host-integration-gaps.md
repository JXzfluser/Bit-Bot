# Host-integration GAP 索引

> **对齐**：`qa/gaps.md`（保留 host-integration 旁注行，勿删）、`capability-matrix.md`（主行 U=`PASS`；I=`todo`/`GAP`/`PASS`）、[`host-integration-roadmap.md`](../host-integration-roadmap.md)。  
> **时间**：2026-10-17 15:37 Asia/Shanghai · 维护：Bit验证（H0 + H1 I-PASS；**H2×14 I-PASS**；**H3·批1 2158/2174/0705/0411 → I-PASS**（0705=平台子集；residual 真手机 OS 卡仍 GAP）；**H4 待审**）/ 能力对标  
> **规则**：矩阵主行 **状态（U）** 保持 **PASS**；本表跟踪 **I**；已 I-PASS 移出 open GAP；gaps.md 升裁旁注保留。  
> **H2 升 I 口径（Bitbot · 2026-10-17 14:34 Asia/Shanghai）**：**C′**=Bit Bot 自有 Live Host UI 真帧可升 I；**拒 B**（剧本假窗/stub/合成 PNG）；**不要求** Grok/Cursor 闭源钩子前置；目标 **CM-1901/1902/1907**，齐后按 interface-gaps §3.3 审；证据=Live HostUiShell 可交互 Host 面 + LiveDisplay 真帧（详见 `gaps.md`「H2 升 I 口径」）。
> **H3 升 I 口径（Bit架构 · 2026-10-17 15:15 Asia/Shanghai）**：目标 **CM-2158 / 2174 / 0705 / 0411**；左列可升 / 右列拒升见 `gaps.md`「H3 升 I 口径」与 interface-gaps **§5.0 / §5.3**；**H3·批1 已升裁（15:21）** → 四条 I-PASS（0705=平台子集）；**不改 U**；未升 GAP 保留（含 **0806**）；0705 residual 真手机 OS 权限卡仍 GAP/todo。
> **H4 升 I 口径（Bit架构 · 2026-10-17 15:37 Asia/Shanghai）**：目标 **CM-2163 / 2164 / 1105 / 2109 / 2120 / 2146 / 1703**；左列可升 / 右列拒升见 `gaps.md`「H4 升 I 口径」与 interface-gaps **§4.0 / §4.3**；**H4 待审**（等 `host_h4_smoke` artifacts 再裁）；**不改 U**；未升 GAP 保留（含 **0806**）。

## 计数

| 项 | 值 |
|----|----|
| 矩阵原子行 | 234 |
| 全量 PASS (U) | 234 |
| FAIL (U) | 0 |
| `I-status=GAP`（本索引） | 17 |
| `I-status=todo` | 193 |
| `I-status=PASS` | 24（**无待复核**） |
| **H0 已升裁** | CM-0607 / CM-0608 / CM-2175 → **I-PASS**（Bit验证 2026-10-17 14:13；回填 14:14 Asia/Shanghai） |
| **H1 已升裁** | CM-0605 / CM-0802 / CM-2160 → **I-PASS**（2026-10-17 14:29 Asia/Shanghai 隔离复核：0802/2160 **解除待复核**；mktemp profile + CDP 9333 + 私有 :99；未碰 9223/chrome-profile；0605 维持）；CM-0806 **仍 GAP**（Bit验证） |
| **H2 升裁** | CM-1901 / CM-1902 / CM-1907 → **I-PASS**（14:46 C′复核）；**CM-1903 / CM-1904 / CM-1905 / CM-1906 → I-PASS**（2026-10-17 14:54 Asia/Shanghai 批2）；**CM-0204 / 0205 / 0206 / 1401 / 1405 / 1507 / 2178 → I-PASS**（2026-10-17 15:12 Asia/Shanghai 批3）；详见 gaps「升裁 H2·批3」 |
| **H3 升裁** | **CM-2158 / CM-2174 / CM-0705 / CM-0411 → I-PASS**（2026-10-17 15:21 Asia/Shanghai 批1）：Live Shell npm 沙箱；双会话同盘异桌面 `:40`/`:41`；0705 **I-PASS（平台子集）** `desktop_no_device_local_tools`（**residual**：真手机 OS 权限卡仍 GAP/todo）；0411 Host 面板复制回执+tool-read 拒+wake 不泄 key；详见 gaps「升裁 H3·批1」 |
| **H4 待审** | CM-2163 / 2164 / 1105 / 2109 / 2120 / 2146 / 1703 — 口径已挂（gaps「H4 升 I 口径」· interface-gaps §4.0/§4.3）；**未升裁**；等 `host_h4_smoke` artifacts |

## H0 探针绿线（roadmap Wave H0）

| CM | 短号 | 主题 | I-status | 摘要 |
|----|------|------|----------|------|
| CM-0607 | 0607 | box doctor 真探针 | **I-PASS** | 真 box-doctor；artifacts `cm-0607-box-doctor/` + `/tmp/box-doctor-h0.log` |
| CM-0608 | 0608 | docker/anyrun 探测 | **I-PASS** | 真 `/proc/1/cgroup` equiv → hosted-anyrun；artifacts `cm-0608-env-detect/` |
| CM-2175 | 2175 | box 时钟对齐用户时区 | **I-PASS** | 真 `TZ=Asia/Shanghai date` → CST/+08:00；artifacts `cm-2175-box-clock/` |

## H1 真屏/Desktop（roadmap Wave H1）

| CM | 短号 | 主题 | I-status | 摘要 |
|----|------|------|----------|------|
| CM-0605 | 0605 | Screenshot | **I-PASS** | 真 `:1` x11grab 1920×1200；1018 色；sha 一致；read_only；未 click；artifacts `cm-0605-screenshot/` |
| CM-0802 | 0802 | box-chrome 启动 | **I-PASS** | 隔离重跑：pid≠共享；profile=mktemp；CDP 9333；bare_refusal 5/5；lineage=ok；artifacts `cm-0802-box-chrome/` |
| CM-2160 | 2160 | 浏览器导航可达 | **I-PASS** | 隔离重跑：`nav_method=cdp_put_json_new`@9333；example.com 真加载；帧 :99 1280×800 多色；artifacts `cm-2160-navigate/` |
| CM-0806 | 0806 | Update 后登录态 | **GAP** | Cookies 副本证据按共享会话规则**不收**；未发生真 Update Computer → 不升 |


## H2 Host UI（roadmap Wave H2 · 优先三项 + batch-2 + batch-3）

| CM | 短号 | 主题 | I-status | 摘要 |
|----|------|------|----------|------|
| CM-1901 | 1901 | Settings 三入口 | **I-PASS** | C′：`host_ui_shell_live.py`→`/api/host/open_settings`×3；audit+SettingsOpened；LiveDisplay entry_*；artifacts `cm-1901-settings-entry/` |
| CM-1902 | 1902 | Settings 锚点深链 | **I-PASS** | C′：HostUiShell `notify_anchor_visible` theme/timezone/update-computer；SettingsAnchorVisible；artifacts `cm-1902-settings-anchor/` |
| CM-1907 | 1907 | 侧栏 Delete 确认 | **I-PASS** | C′：context_menu→awaiting-confirm→cancelled；md5 独立；completed=false；artifacts `cm-1907-delete-agent/` |
| CM-1903 | 1903 | Update Computer 两步确认 | **I-PASS** | C′：`request_update`→`confirm_step`→cancel；非 Reset；两步帧独立；artifacts `cm-1903-update-computer/` · gaps「升裁 H2·批2」 |
| CM-1904 | 1904 | Reset Computer 可达非首选 | **I-PASS** | C′：`open_reset_computer`；`reset_preferred=false`；未真执行 Reset；artifacts `cm-1904-reset-computer/` |
| CM-1905 | 1905 | local-execution 关拒 machineId | **I-PASS** | C′：gate off + `try_machine_call` 真拒；gate_log+帧；artifacts `cm-1905-local-execution/` |
| CM-1906 | 1906 | Updates tab ≠ update-computer | **I-PASS** | C′：update-channel vs update-computer 双帧可区分；artifacts `cm-1906-updates-vs-update-computer/` |
| CM-0204 | 0204 | Hidden 不占主侧栏仍可寻址 | **I-PASS** | C′：`set_agent_hidden`→`address_agent` by id；侧栏行消失 + header hidden·addressable；artifacts `cm-0204-hidden-agent/` · gaps「升裁 H2·批3」 |
| CM-0205 | 0205 | Per-agent info pane 五区 | **I-PASS** | C′：`open_info_panel`；preview/Routines/Channels/Members/⚙；≠全局 Settings；note G-UI-0205a；artifacts `cm-0205-info-panel/` |
| CM-0206 | 0206 | 助手级通知开关隔离 | **I-PASS** | C′：`set_agent_notify` A；STATE.notify 仅 A 条目，B 默认；artifacts `cm-0206-notify-toggles/` |
| CM-1401 | 1401 | CreateAgent→侧栏+Members | **I-PASS** | C′：`create_agent` 抛型 id→侧栏行→Members；artifacts `cm-1401-create-agent-sidebar/` |
| CM-1405 | 1405 | 群聊 Members 于 info pane | **I-PASS** | C′：`open_members_panel` group；Members 列=member_ids；settingsOpen=false；artifacts `cm-1405-members-panel/` |
| CM-1507 | 1507 | auto-review 三锚点深链 | **I-PASS** | C′：SettingsAnchorVisible×3 + 高亮 ROI 逐行对应（滚动触底同位，靠高亮区分；无 scrollTop/rect → note）；artifacts `cm-1507-auto-review-deeplink/` |
| CM-2178 | 2178 | 缺权限引导→Settings 不假装连接 | **I-PASS** | C′：guide→Settings account；connected 恒 false；pretends_connected=false；artifacts `cm-2178-permission-guide-settings/` |

> 计数（H2 当时）：I-PASS **20**（1901/1902/1907 + 批2 1903–1906 + 批3 0204/0205/0206/1401/1405/1507/2178）；其后 **H3·批1 → I-PASS 24 / open 17**（见下 H3 节）。U=234 不动。详见 `gaps.md`「升裁 H2·批3」「升裁 H3·批1」。


## H3 Host FFI（roadmap Wave H3 · 批1）

| CM | 短号 | 主题 | I-status | 摘要 |
|----|------|------|----------|------|
| CM-2158 | 2158 | 经 Shell 装包 | **I-PASS** | Live npm `left-pad@1.3.0` 沙箱；pid/exit=0；non-Shell 拒；audit；artifacts `cm-2158-package-install/` · gaps「升裁 H3·批1」 |
| CM-2174 | 2174 | 跨代理共享 box FS | **I-PASS** | 双会话 `:40`/`:41` 同盘异桌面；A 见 B 写；`not_single_mock_self_rw`；artifacts `cm-2174-shared-box-fs/` |
| CM-0705 | 0705 | deviceLocalTools 权限 | **I-PASS（平台子集）** | `platform_subset.md`=`desktop_no_device_local_tools`；桌面空列表；无假 OS 卡；**residual** 真手机 OS 权限卡仍 GAP；artifacts `cm-0705-device-local-tools/` |
| CM-0411 | 0411 | Webhook key 不透明 | **I-PASS** | HostUiShell 面板复制回执；tool-read 拒；wake `<webhook_event>` 无 key；artifacts `cm-0411-webhook-panel/` |

> 计数：I-PASS **24**（+H3×4）；open GAP **17**；U=234 不动；**0806 仍 GAP**；0705 residual 真手机 OS 卡另记。详见 `gaps.md`「升裁 H3·批1」。


## H4 真 MCP / OAuth / 出网（roadmap Wave H4 · **待审**）

| CM | 短号 | 主题 | I-status | 摘要 |
|----|------|------|----------|------|
| CM-2163 | 2163 | MCP `$file:` 注入 | **open / 待审** | 升 I 须真 Host FS；拒 in-process fake / chat 内嵌 payload · gaps「H4 升 I 口径」 |
| CM-2164 | 2164 | MCP `write_to_file` | **open / 待审** | 升 I 须真写 `/workspace/agent-tools/`；拒假路径 / chat 含 PAYLOAD |
| CM-1105 | 1105 | Slack connect | **open / 待审** | 升 I 须真 OAuth→Connected；拒 stub authenticate |
| CM-2109 | 2109 | user-Finance OAuth | **open / 待审** | 升 I 须真 OAuth NeedsAuth→Ready；拒 stub |
| CM-2120 | 2120 | Outlook OAuth | **open / 待审** | 升 I 须真 OAuth 后 draft/send；拒 mock |
| CM-2146 | 2146 | App vs User 浏览器 | **open / 待审** | 升 I 须真切用户浏览器会话；拒仅意图枚举 |
| CM-1703 | 1703 | Fetch 公共回退 | **open / 待审** | 升 I 须真出网 fallback；拒凭据旁路 |

> **H4 待审**：不升裁；等 `scripts/host_h4_smoke.sh` artifacts 齐且 §4.0 左列过后再点 Bit验证。U=234 不动；**0806 仍 GAP**。详见 `gaps.md`「H4 升 I 口径」。

## 已 I-PASS（H0）

三探针均已升 **I-PASS**；U 状态列仍为 PASS。

| CM | 短号 | 架构短号 | kernel-contract 主行 | host-integration GAP 摘要 | 来源 | 状态 |
|----|------|----------|----------------------|---------------------------|------|------|
| CM-0607 | 0607 | D-BOX | PASS (kernel-contract) | **I-PASS**（真 box-doctor；见 gaps 升裁 H0） | gaps.md 升裁 H0 | **I-PASS** H0 |
| CM-0608 | 0608 | D-BOX | PASS (kernel-contract) | **I-PASS**（真 cgroup/hosted-anyrun；见 gaps 升裁 H0） | gaps.md 升裁 H0 | **I-PASS** H0 |
| CM-2175 | 2175 | TIME-04 · D-TIME | PASS (kernel-contract) | **I-PASS**（真 `date` CST/+08:00；见 gaps 升裁 H0） | gaps.md 升裁 H0 | **I-PASS** H0 |

## 已 I-PASS（H1）

> **H1 复核结论（Bit验证 · 2026-10-17 14:29 Asia/Shanghai）**：共享会话硬规则仍生效。隔离重跑通过 → CM-0802 / CM-2160 **I-PASS（待复核已解除）**；CM-0605 维持；CM-0806 仍 GAP。详见 `gaps.md`「H1 复核结论·隔离重跑」。

| CM | 短号 | 架构短号 | kernel-contract 主行 | host-integration GAP 摘要 | 来源 | 状态 |
|----|------|----------|----------------------|---------------------------|------|------|
| CM-0605 | 0605 | FILE-03/DESK-02 · D-FILE/D-DESK | PASS (kernel-contract) | **I-PASS**（真 :1 帧；见 gaps 升裁 H1） | gaps.md 升裁 H1 | **I-PASS** H1 |
| CM-0802 | 0802 | D-DESK | PASS (kernel-contract) | **I-PASS**（隔离 throwaway box-chrome + bare_refusal 5/5；见 gaps 14:29） | gaps.md 复核结论 | **I-PASS** H1 |
| CM-2160 | 2160 | DESK-03 · D-DESK | PASS (kernel-contract) | **I-PASS**（隔离 CDP PUT /json/new@9333 + 真帧 :99；见 gaps 14:29） | gaps.md 复核结论 | **I-PASS** H1 |


## 已 I-PASS（H2）

> **H2·C′复核（Bit验证 · 2026-10-17 14:46 Asia/Shanghai）**：上次 B（CDP 直调静态壳）已改；§3.0 左列全过 → 1901/1902/1907 **I-PASS**。  
> **H2·批2（Bit验证 · 2026-10-17 14:54 Asia/Shanghai）**：1903–1906 §3.0 左列全过 + §3.4 assert → **I-PASS**。U=234 / H0 / H1 / 0806 不动。  
> **H2·批3（Bit验证 · 2026-10-17 15:12 Asia/Shanghai）**：0204/0205/0206/1401/1405/1507/2178 §3.0 左列全过 + §3.4 assert + app-ui 对照 → **I-PASS**（非阻断 note：G-UI-0205a、1507 锚点 DOM 回执、0204 事件名）。

| CM | 短号 | 架构短号 | kernel-contract 主行 | host-integration GAP 摘要 | 来源 | 状态 |
|----|------|----------|----------------------|---------------------------|------|------|
| CM-1901 | 1901 | D-PROF(Host UI) | PASS (kernel-contract) | **I-PASS**（C′ Live HostUiShell→`/api/host/*` + LiveDisplay；见 gaps 升裁 H2·C′复核） | gaps.md 升裁 H2·C′复核 | **I-PASS** H2 |
| CM-1902 | 1902 | D-PROF(Host UI) | PASS (kernel-contract) | **I-PASS**（同上；锚点深链 HostUiEvent） | gaps.md 升裁 H2·C′复核 | **I-PASS** H2 |
| CM-1907 | 1907 | D-PROF(Host UI) | PASS (kernel-contract) | **I-PASS**（同上；独立 context_menu + Cancel-only） | gaps.md 升裁 H2·C′复核 | **I-PASS** H2 |
| CM-1903 | 1903 | D-PROF(Host UI) | PASS (kernel-contract) | **I-PASS**（两步 Update≠Reset；UpdateComputerPhaseChanged；见 gaps 升裁 H2·批2） | gaps.md 升裁 H2·批2 | **I-PASS** H2 |
| CM-1904 | 1904 | D-PROF(Host UI) | PASS (kernel-contract) | **I-PASS**（Reset 可达；reset_preferred=false；未真 Reset） | gaps.md 升裁 H2·批2 | **I-PASS** H2 |
| CM-1905 | 1905 | D-PROF(Host UI) | PASS (kernel-contract) | **I-PASS**（gate off 真拒 machineId；gate_log+帧） | gaps.md 升裁 H2·批2 | **I-PASS** H2 |
| CM-1906 | 1906 | D-PROF(Host UI) | PASS (kernel-contract) | **I-PASS**（Updates tab ≠ update-computer 双帧可区分） | gaps.md 升裁 H2·批2 | **I-PASS** H2 |
| CM-0204 | 0204 | D-PROF | PASS (kernel-contract) | **I-PASS**（C′ hidden 不进侧栏仍按 id 寻址；见 gaps 升裁 H2·批3） | gaps.md 升裁 H2·批3 | **I-PASS** H2 |
| CM-0205 | 0205 | D-PROF | PASS (kernel-contract) | **I-PASS**（C′ info pane 五区≠Settings；note G-UI-0205a；见 gaps 升裁 H2·批3） | gaps.md 升裁 H2·批3 | **I-PASS** H2 |
| CM-0206 | 0206 | D-PROF | PASS (kernel-contract) | **I-PASS**（C′ 助手级通知 STATE 隔离；见 gaps 升裁 H2·批3） | gaps.md 升裁 H2·批3 | **I-PASS** H2 |
| CM-1401 | 1401 | TEAM-02 · D-TEAM | PASS (kernel-contract) | **I-PASS**（C′ CreateAgent→侧栏+Members；见 gaps 升裁 H2·批3） | gaps.md 升裁 H2·批3 | **I-PASS** H2 |
| CM-1405 | 1405 | D-TEAM | PASS (kernel-contract) | **I-PASS**（C′ 群聊 Members 在 info pane；见 gaps 升裁 H2·批3） | gaps.md 升裁 H2·批3 | **I-PASS** H2 |
| CM-1507 | 1507 | D-SEC/D-PERM | PASS (kernel-contract) | **I-PASS**（C′ 三锚点高亮 ROI；触底同位 note；见 gaps 升裁 H2·批3） | gaps.md 升裁 H2·批3 | **I-PASS** H2 |
| CM-2178 | 2178 | PERM-05 · D-PERM | PASS (kernel-contract) | **I-PASS**（C′ 引导→Settings account；恒 Not connected；见 gaps 升裁 H2·批3） | gaps.md 升裁 H2·批3 | **I-PASS** H2 |


## 已 I-PASS（H3）

> **H3·批1（Bit验证 · 2026-10-17 15:21 Asia/Shanghai）**：§5.0 左列全过 → 2158/2174/0705/0411 **I-PASS**（0705=平台子集）。U=234 / H0 / H1 / H2 / 0806 不动。  
> **0705 residual**：真 iOS/Android OS permission dialog + OS grant for deviceLocalTools — **仍 GAP/todo**（有手机后再走路径甲；不倒裁平台子集 I-PASS）。

| CM | 短号 | 架构短号 | kernel-contract 主行 | host-integration GAP 摘要 | 来源 | 状态 |
|----|------|----------|----------------------|---------------------------|------|------|
| CM-2158 | 2158 | BOX-05 · D-BOX | PASS (kernel-contract) | **I-PASS**（Live Shell npm 沙箱；见 gaps 升裁 H3·批1） | gaps.md 升裁 H3·批1 | **I-PASS** H3 |
| CM-2174 | 2174 | STORE-04 · D-STORE | PASS (kernel-contract) | **I-PASS**（双会话同盘异桌面；见 gaps 升裁 H3·批1） | gaps.md 升裁 H3·批1 | **I-PASS** H3 |
| CM-0705 | 0705 | MACH-06 · D-MACH | PASS (kernel-contract) | **I-PASS（平台子集）**；residual 真手机 OS 卡仍 GAP | gaps.md 升裁 H3·批1 | **I-PASS（平台子集）** H3 |
| CM-0411 | 0411 | D-RTN | PASS (kernel-contract) | **I-PASS**（Host 面板复制+opaque；见 gaps 升裁 H3·批1） | gaps.md 升裁 H3·批1 | **I-PASS** H3 |

## 全量索引（open GAP；与矩阵 `I-status=GAP` 集合相等）

当前 open = **17**（H3·批1 移出 2158/2174/0705/0411；矩阵 I-status 列待能力对标同步）。**0806 仍 open**。0705 主行已 I-PASS（平台子集）；residual 真手机 OS 卡见「已 I-PASS（H3）」注。

| CM | 短号 | 架构短号 | kernel-contract 主行 | host-integration GAP 摘要 | 来源 | 状态 |
|----|------|----------|----------------------|---------------------------|------|------|
| CM-0806 | 0806 | D-DESK | PASS (kernel-contract) | 真 Host UI/实例属 I；H1 Cookies 副本证据按共享会话规则不收（未真 Update Computer） | gaps.md:L553 | open |
| CM-1105 | 1105 | D-CHAN | PASS (kernel-contract) | 真 Slack OAuth/Details 面板属 Host/I | gaps.md:L249 | open |
| CM-1601 | 1601 | FILE-05 · D-FILE | PASS (kernel-contract) | 真扩散/Host 出图属 Host/I | gaps.md:L214 | open |
| CM-1602 | 1602 | FILE-06 · D-FILE | PASS (kernel-contract) | 真文生视频/编码属 Host/I | gaps.md:L97 | open |
| CM-1603 | 1603 | D-FILE | PASS (kernel-contract) | 真视频解码属 Host/I | gaps.md:L215 | open |
| CM-1703 | 1703 | D-FILE(tools/web) | PASS (kernel-contract) | 真浏览器/curl 出网属 Host/I | gaps.md:L216 | open |
| CM-1807 | 1807 | D-SKILL/D-BUY | PASS (kernel-contract) | 真 PPTX 打开属 Host/I | gaps.md:L218 | open |
| CM-2101 | 2101 | TURN-07 · D-TURN | PASS (kernel-contract) | 真消息 pill 像素属 Host/I | gaps.md:L201 | open |
| CM-2103 | 2103 | COMM-01 · D-COMM | PASS (kernel-contract) | 真公式/图画渲染属 Host/I | gaps.md:L203 | open |
| CM-2109 | 2109 | D-补遗 | PASS (kernel-contract) | 真 OAuth 属 Host/I；工具全集 TBD | gaps.md:L104 | open |
| CM-2120 | 2120 | MAIL-04 · D-MAIL | PASS (kernel-contract) | 真 OAuth 属 Host/I | gaps.md:L189 | open |
| CM-2128 | 2128 | TURN-07 · D-TURN | PASS (kernel-contract) | 真 pill 像素属 Host/I | gaps.md:L191 | open |
| CM-2131 | 2131 | D-补遗 | PASS (kernel-contract) | 真卡打开属 Host/I | gaps.md:L169 | open |
| CM-2146 | 2146 | D-补遗 | PASS (kernel-contract) | 真浏览器会话属 Host/I | gaps.md:L176 | open |
| CM-2157 | 2157 | FILE-04 · D-FILE | PASS (kernel-contract) | 真图渲染/编码属 Host/I | gaps.md:L89 | open |
| CM-2163 | 2163 | MCP-06 · D-MCP | PASS (kernel-contract) | 真 Host FFI/MCP 属 I | gaps.md:L127 | open |
| CM-2164 | 2164 | MCP-07 · D-MCP | PASS (kernel-contract) | 真写盘/MCP 属 I | gaps.md:L128 | open |

## 波次对照（roadmap §4；仅索引，不改裁决）

| Wave | CM 列表 |
|------|---------|
| H0 | CM-0607, CM-0608, CM-2175 |
| H1 | CM-0605, CM-0802, CM-2160, CM-0806 |
| H2 | CM-1901, CM-1902, CM-1907, CM-1903, CM-1904, CM-1905, CM-1906, CM-0204, CM-0205, CM-0206, CM-1401, CM-1405, CM-1507, CM-2178 |
| H3 | CM-2158, CM-2174, CM-0705, CM-0411 |
| H4 | CM-2163, CM-2164, CM-1105, CM-2109, CM-2120, CM-2146, CM-1703 |
| H5 | CM-1601, CM-1602, CM-2157, CM-1603, CM-1807, CM-2131 |
| 其他（gaps 有 HI、未单列波次） | CM-2101, CM-2103, CM-2128 |

## 备注

- 主裁决表 gaps **GAP=0**（host-integration 为旁注跟踪，不计入主 GAP 计数）。
- BB 批 **CM-2157** 已 U-PASS（kernel-contract）；I 仍 open（真图渲染/编码属 Host/I）。
- 本文件 **open GAP** 与矩阵 `I-status=GAP` **集合必须相等**（当前 17）；已 I-PASS（H0 三行 + H1 三行 + H2 十四行 + H3 四行）单独成节。MoonBit核若已写同路径，合并时保留双方条目、以 gaps 全量扫描为准补缺。
- **0705 residual**：真手机 OS 权限卡仍 GAP/todo（平台子集 I-PASS 不覆盖路径甲）。

---

## 既有内容保留

# Host-integration GAP 清单（Host 阶段 I 库存）

- **时间**: 2026-10-17 Asia/Shanghai
- **来源**: `docs/qa/gaps.md`（及 capability-matrix / scaffold-status 交叉核对）
- **口径**: 下列项在矩阵主裁决上多为 **kernel-contract PASS**；除 H0 三探针已 **I-PASS** 外，其余 **host-integration 仍为 open GAP**，待真实 Host 集成验收（I）。

## 目的

本文件是 **Host 阶段 I** 的缺口库存：内核契约已绿、但仍需真实 Host 面才能升 I 的 CM 项。

| 做 | 不做 |
|----|------|
| 跟踪 host-integration open GAP，挂依赖 Host 面与已有 kernel-contract 测名 | **仅** Bit验证升裁后标 **I-PASS**（H0 已落地） |
| 为 Host 适配 / 真屏验收排期提供 CM-id 全集 | **不**编造假「真屏」验收测 |
| 对照 ADR 0002（WASM Kernel + HostAbi）边界 | **不**改 capability-matrix 的 U「状态」列 |

升 I 前不得删 gaps 旁注；已 I-PASS 从 open 库存移出并保留测名指针；mock / 占位 PNG ≠ 真屏。

---

## 库存表

| CM-id | 简述 | 依赖 Host 面 | 相关测名 |
|-------|------|--------------|----------|
| CM-0204 | Hidden/系统助手不进主侧栏但仍可寻址 | 真侧边栏像素 | `ui_protocol/acceptance_cm0204_test.mbt`::acceptance_CM-0204_hidden_agent_not_in_main_sidebar · **I-PASS** `cm-0204-hidden-agent/`（升裁 H2·批3） |
| CM-0205 | Per-agent 信息面板五锚点与 app-ui 对齐 | 真屏 Info 面板 | `ui_protocol/acceptance_cm0205_test.mbt`::acceptance_CM-0205_per_agent_info_panel_fields · **I-PASS** `cm-0205-info-panel/`（升裁 H2·批3） |
| CM-0206 | 助手级 desktop/sound/mentions_only 通知开关隔离 | Settings UI / 真 Host UI | `ui_protocol/acceptance_cm0206_test.mbt`::acceptance_CM-0206_per_assistant_notification_settings · **I-PASS** `cm-0206-notify-toggles/`（升裁 H2·批3） |
| CM-0411 | Webhook 触发：wake 含事件、助手不可读 key | 真面板复制 URL/key | `routines/acceptance_cm0408_0412_test.mbt`::acceptance_CM-0411_webhook_trigger_key_opaque · **I-PASS** `cm-0411-webhook-panel/`（升裁 H3·批1） |
| CM-0605 | Screenshot：has_frame / read_only / 未 click | 真实 `:1` 画面 / Host FFI | `box_host/host_abi_test.mbt`::acceptance_CM-0605_screenshot_frame_evidence |
| CM-0607 | box-doctor PASS/FAIL/SUMMARY 可解析 | 真 Host 探针 | `box_host/acceptance_cm0607_test.mbt`::acceptance_CM-0607_box_doctor_pass_fail_parsable · **I-PASS H0** |
| CM-0608 | local-docker / hosted-anyrun / bare 环境诊断 | 真 `/.dockerenv` 探测 | `box_host/acceptance_cm0608_test.mbt`::acceptance_CM-0608_docker_vs_anyrun_env_detect · **I-PASS H0** |
| CM-0705 | deviceLocalTools：iOS needs_permission→审批卡 | 真手机 OS 权限 / 平台子集 | `box_host/acceptance_cm0705_test.mbt`::acceptance_CM-0705_device_local_tools_needs_permission_card · **I-PASS（平台子集）** `cm-0705-device-local-tools/`（升裁 H3·批1；residual 真手机 OS 卡仍 GAP） |
| CM-0802 | box-chrome 启动器；拒裸 chrome | 真浏览器进程 | `agents/computer_use/acceptance_cm0802_test.mbt`::acceptance_CM-0802_box_chrome_launcher_not_bare |
| CM-0806 | Update 后 cookie/登录态仍在 | 真 Host UI / 实例 | `box_host/acceptance_cm0806_1903_1905_test.mbt`::acceptance_CM-0806_login_persist_after_update |
| CM-1105 | SetUpSlack：connect→Connected；Details 完成流 | 真 Slack OAuth / Details 面板 | `channels/acceptance_cm1105_test.mbt`::acceptance_CM-1105_setup_slack_connect_flow |
| CM-1401 | CreateAgent 出现在 Members∧侧栏 | 真侧栏 / Members 面板 | `agents/teammates/acceptance_cm1401_test.mbt`::acceptance_CM-1401_create_agent_appears_in_members · **I-PASS** `cm-1401-create-agent-sidebar/`（升裁 H2·批3） |
| CM-1405 | Members 面板与 app-ui 锚点对齐 | Members 面板 / 真 Host UI | `agents/teammates/acceptance_cm1405_test.mbt`::acceptance_CM-1405_members_panel_matches_app_ui · **I-PASS** `cm-1405-members-panel/`（升裁 H2·批3） |
| CM-1507 | auto-review / rules / security-keys 深链双射 | Settings UI / 真屏锚点滚动 | `ui_protocol/acceptance_cm1507_test.mbt`::acceptance_CM-1507_auto_review_settings_deeplink_anchors · **I-PASS** `cm-1507-auto-review-deeplink/`（升裁 H2·批3） |
| CM-1601 | GenerateImage→/workspace 落盘+可投递 | GenerateImage / 真扩散出图 | `tools/media/acceptance_cm1601_test.mbt`::acceptance_CM-1601_generate_image_artifact_deliverable |
| CM-1602 | GenerateVideo 队列→完成+可通知 | GenerateVideo / 真文生视频编码 | `tools/media/acceptance_cm1602_test.mbt`::acceptance_CM-1602_generate_video_queue_and_notify |
| CM-1603 | watchVideo：帧抽取→答案 grounded | 真视频解码 | `agents/task/acceptance_cm1603_test.mbt`::acceptance_CM-1603_watch_video_answer_from_frames |
| CM-1703 | Fetch 403→browser/curl 公共回退；禁凭证旁路 | 真浏览器 / curl 出网 | `tools/acceptance_cm1703_test.mbt`::acceptance_CM-1703_fetch_fail_public_fallback_no_cred_bypass |
| CM-1807 | slides 生成 pptx（PK magic）可打开 | 真 PPTX 打开 | `skills/acceptance_cm1807_test.mbt`::acceptance_CM-1807_slides_pptx_openable |
| CM-1901 | Settings 仅三入口；禁齿轮假路径 | Settings UI | `ui_protocol/acceptance_cm1901_1902_1907_test.mbt`::acceptance_CM-1901_settings_entry_closed_set |
| CM-1902 | Settings tabs/锚点与深链双射 | Settings UI | `ui_protocol/acceptance_cm1901_1902_1907_test.mbt`::acceptance_CM-1902_settings_anchor_deeplink_bijection |
| CM-1903 | Update Bot's Computer 两步确认；指引优先于 Reset | Settings UI / 真 Host 实例 | `box_host/acceptance_cm0806_1903_1905_test.mbt`::acceptance_CM-1903_update_computer_two_step_prefer_guide · **I-PASS** `cm-1903-update-computer/`（升裁 H2·批2） |
| CM-1904 | Reset Bot's Computer 非首选 | Settings UI | `ui_protocol/acceptance_cm1904_1906_test.mbt`::acceptance_CM-1904_reset_computer_not_preferred · **I-PASS** `cm-1904-reset-computer/`（升裁 H2·批2） |
| CM-1905 | local-execution 关闭后拒 machine 调用 | Settings UI / 本机执行闸门 | `box_host/acceptance_cm0806_1903_1905_test.mbt`::acceptance_CM-1905_local_execution_off_rejects_machine · **I-PASS** `cm-1905-local-execution/`（升裁 H2·批2） |
| CM-1906 | 应用 Updates ≠ Update Computer | Settings UI | `ui_protocol/acceptance_cm1904_1906_test.mbt`::acceptance_CM-1906_update_channel_ne_update_computer · **I-PASS** `cm-1906-updates-vs-update-computer/`（升裁 H2·批2） |
| CM-1907 | 侧栏右键删除助手+确认；非 Settings | Settings UI / 真侧栏 | `ui_protocol/acceptance_cm1901_1902_1907_test.mbt`::acceptance_CM-1907_delete_agent_confirm_not_settings |
| CM-2101 | ReactToMessage：pill 可见/toggle | 真消息 pill React | `ui_protocol/acceptance_cm2101_test.mbt`::acceptance_CM-2101_react_to_message_pill_toggle |
| CM-2103 | Markdown 数学 \( \)/$$ 与 mermaid 解析 | 真公式/图画渲染 | `ui_protocol/acceptance_cm2103_test.mbt`::acceptance_CM-2103_markdown_math_and_mermaid |
| CM-2109 | user-Finance：NeedsAuth→authenticate→Ready | Finance auth / 真 OAuth | `connectors/acceptance_cm2109_test.mbt`::acceptance_CM-2109_user_finance_connector_needs_auth |
| CM-2120 | Outlook：NeedsAuth 拒 draft/send；认证后可用 | 真 OAuth | `connectors/mail/acceptance_cm2120_test.mbt`::acceptance_CM-2120_outlook_connector_auth_then_draft_send |
| CM-2128 | 出站 React end_turn；pill 可见、body 可省略 | 真 pill React 像素 | `ui_protocol/acceptance_cm2128_test.mbt`::acceptance_CM-2128_react_outbound_end_turn_pill_no_body |
| CM-2131 | cursor-agent 卡：open_cloud→cursor.com/agents/\<bcId\> | 真卡打开 | `ui_protocol/acceptance_cm2131_test.mbt`::acceptance_CM-2131_cursor_agent_card_opens_cloud |
| CM-2146 | 连接器 App vs 用户身份：须切已登录浏览器 | 真浏览器会话 | `connectors/acceptance_cm2146_test.mbt`::acceptance_CM-2146_connector_app_vs_user_identity_browser |
| CM-2157 | StructuredChart→/workspace 落盘+可投递 | 真图渲染/编码 | `tools/media/acceptance_cm2157_test.mbt`::acceptance_CM-2157_structured_chart_file_deliverable |
| CM-2158 | apt/npm 经 Shell；拒 non-Shell | apt/npm Shell | `box_host/acceptance_cm2158_test.mbt`::acceptance_CM-2158_box_package_install_via_shell · **I-PASS** `cm-2158-package-install/`（升裁 H3·批1） |
| CM-2160 | 浏览器导航：公开页可达 | browser Navigate | `agents/computer_use/acceptance_cm2160_test.mbt`::acceptance_CM-2160_browser_navigate_public_reachable |
| CM-2163 | MCP `$file:` 从 Host FS 注入；chat 仅 ref | MCP `$file` / Host FS | `tools/acceptance_cm2163_2164_test.mbt`::acceptance_CM-2163_mcp_file_arg_expand_no_chat_bloat |
| CM-2164 | MCP write_to_file→`/workspace/agent-tools/`；返回路径 | MCP write_to_file / 真写盘 | `tools/acceptance_cm2163_2164_test.mbt`::acceptance_CM-2164_mcp_write_to_file_returns_path |
| CM-2174 | 跨代理共享 box FS + 独立桌面 | Shared FS | `box_host/acceptance_cm2174_test.mbt`::acceptance_CM-2174_cross_agent_shared_box_fs_charter · **I-PASS** `cm-2174-shared-box-fs/`（升裁 H3·批1） |
| CM-2175 | box 时钟对齐用户时区（Asia/Shanghai） | box clock | `box_host/acceptance_cm2175_test.mbt`::acceptance_CM-2175_box_clock_aligns_user_timezone · **I-PASS H0** |
| CM-2178 | 缺权限导引 Settings；禁止假装已连接 | Settings UI | `ui_protocol/acceptance_cm2178_test.mbt`::acceptance_CM-2178_missing_permission_guide_settings_not_pretend · **I-PASS** `cm-2178-permission-guide-settings/`（升裁 H2·批3） |

**行数**: 41（历史全集）· **open GAP**: 38 · **已 I-PASS (H0)**: 3

---

## HostAbi 缺口注释（相对当前 mock）

对照 ADR 0002、`docs/04-interface-contracts.md` HostAbi 扩展点、`docs/host-ui-contract.md` §5：Kernel 只依赖 `HostAbi` / `HostUiShell`；下列为 **真 Host 必须暴露、mock 不可冒充 I-PASS** 的面。

| Host 面 | 相对 mock 须兑现 | 主要关联 CM |
|---------|------------------|-------------|
| **真屏 / Desktop FFI** | 真实 display `:1` 截帧；非占位 PNG | CM-0605 |
| **Settings / HostUiShell** | `open_settings`、锚点滚动、侧栏右键 Delete、local-execution 闸门、Update/Reset Computer 真实例流 | CM-1901–1907, CM-0206, CM-1507, CM-2178 |
| **侧栏 / Members / Info 面板** | 真像素：hidden 不占主列表、CreateAgent 入侧栏、Members 与 app-ui 对齐、五锚点面板 | CM-0204, CM-0205, CM-1401, CM-1405 |
| **真 OAuth / 连接面板** | Slack Details、Outlook、user-Finance 真鉴权窗；非 stub authenticate | CM-1105, CM-2120, CM-2109 |
| **浏览器 / Navigate** | box-chrome 真进程、公开页导航、已登录用户浏览器会话、Fetch 失败公共回退出网 | CM-0802, CM-2160, CM-2146, CM-1703 |
| **媒体编解码** | 真扩散出图、文生视频、视频解码、图表渲染/编码、PPTX 宿主打开 | CM-1601, CM-1602, CM-1603, CM-2157, CM-1807 |
| **Shell / 包 / 时钟 / FS** | 真 apt/npm、`date` 对齐用户区、跨代理 Shared FS、`/.dockerenv` / box-doctor 真探针 | **CM-2158 / CM-2174 = I-PASS H3**；**CM-2175 / CM-0608 / CM-0607 = I-PASS H0** |
| **MCP Host FFI** | `$file:` 真 Host FS 注入；`write_to_file` 真写盘返回路径 | CM-2163, CM-2164 |
| **UI 像素（pill / 卡 / 数学）** | 真消息 React pill、cursor-agent 卡打开、math/mermaid 渲染 | CM-2101, CM-2128, CM-2131, CM-2103 |
| **设备 / 登录持久** | 真手机 OS 权限卡；Update 后真 cookie/登录保留 | **CM-0705 = I-PASS（平台子集）H3**（residual 真手机 OS 卡仍 GAP）；CM-0806 仍 open |
| **Webhook 面板** | 真面板复制 URL/key（助手仍不可见 key） | **CM-0411 = I-PASS H3** |

当前 `HostAbi` trait（list_machines / copy_* / open_desktop_session）与 `HostUiShell`（open_settings / delete_agent）多为契约草图；除 Bit验证已升裁的 **H0 三探针（I-PASS）** 外，上表其余面在真实 Host 仓落地前保持 open GAP。

---

## 索引

- 缺口主报告：`docs/qa/gaps.md`
- 矩阵：`docs/capability-matrix.md`（本文件不改其 PASS/done）
- 边界：`docs/adr/0002-wasm-host-boundary.md`、`docs/host-ui-contract.md`
- 验收波次（架构）：`docs/host-integration-roadmap.md`（覆盖历史 41；当前 open 38 + H0 I-PASS 3）
- 接口缺口：`docs/host-integration-interface-gaps.md`


---

## H0 证据指针（2026-10-17 Asia/Shanghai · **已 I-PASS**）

Host smoke 产物齐；Bit验证 14:13 升裁；能力对标 14:14 回填矩阵 `I-status=PASS` 与本索引。

| CM | evidence_cmd | artifact |
|----|--------------|----------|
| CM-0607 | `bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-0607` | `docs/qa/artifacts/cm-0607-box-doctor/` |
| CM-0608 | `bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-0608` | `docs/qa/artifacts/cm-0608-env-detect/` |
| CM-2175 | `bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-2175` | `docs/qa/artifacts/cm-2175-box-clock/` |

Live 骨架：`box_host/`（`HostBackend` / `screenshot_live` / `AuditSpan` / `run_h0_*`）。Mock 行为未改。

### H1 smoke evidence note (MoonBit核 · 2026-10-17 Asia/Shanghai)

Host smoke artifacts under `docs/qa/artifacts/` for Wave H1 (`scripts/host_h1_smoke.sh`). Status fields are `READY_FOR_I_REVIEW` / `NEEDS_REVIEW` only — **I-PASS not claimed**; GAP rows above stay **open** until Bit验证 promotes (CM-0605 first). Do not delete GAP lines or rewrite kernel-contract PASS.


> **Bit验证 回填（2026-10-17 14:21 Asia/Shanghai）**：上述 H1 已裁 — CM-0605 / CM-0802 / CM-2160 → **I-PASS**（已移出 open 索引，见「已 I-PASS（H1）」）；CM-0806 **仍 open GAP**（未真 Update Computer）。
