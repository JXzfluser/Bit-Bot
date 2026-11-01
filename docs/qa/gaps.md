# Bit Bot 缺口报告（gaps.md）

- **时间**: 2026-10-17 Asia/Shanghai
- **作者**: Bit验证
- **合同主键**: **CM-***
- **矩阵计数**: **234** / P0=**117**
- **矩阵自标状态**: U-PASS=234 · I-PASS=234 · I-todo=0
- **冒烟实测**: check_ok=True · test_ok=True · **升裁 H6·全矩阵 I 收口**：`host_matrix_i_sweep.sh all` → READY×193；I-PASS **41→234**；open todo **193→0**；U=234 不动；H0–H5 Host-hard 41 维持；0705 平台子集 wording 保留；phone residual 另记（不阻塞矩阵 I）
- **裁决口径**: GAP=无实现/无测；FAIL=有源+测但未达验收；PASS=C/U/I/B 且贴验收原文
- **本轮**: Wave H6 全矩阵 I 收口（ADR 0004）；禁 mock-only 冒充 Host-hard Live。

## H2 升 I 口径（Bitbot · 2026-10-17 14:34 Asia/Shanghai）

> **最终口径（以本条为准；覆盖架构若写「A=唯一 I」语义）**。本轮**不升任何 CM**、**不改 U**。

| 项 | 规则 |
|----|------|
| **C′** | Bit Bot 自有 **Live Host UI** 真帧可升 I |
| **拒 B** | 剧本假窗 / stub / 合成 PNG → **永不得**升 I |
| **A** | **不要求** Grok/Cursor 闭源客户端钩子作升 I 前置（有钩子仅可选对照） |
| **目标 CM** | **1901 / 1902 / 1907**；到齐后按 [`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) **§3.3** 字段审（`evidence_cmd`、`artifact`、`assert`、`env`） |
| **证据面** | 须来自 Bit Bot Live **HostUiShell** 驱动的可交互 Host 面 + **LiveDisplay** 真帧 |

对齐：`host-integration-interface-gaps.md` §3.0；旁注同步见 `qa/host-integration-gaps.md`。

## H3 升 I 口径（Bit架构 · 2026-10-17 15:15 Asia/Shanghai）

> 来源：[`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) **§5.0 / §5.3**。口径表仍有效。**H3·批1（15:21）已升裁** → 2158/2174/0705/0411 **I-PASS**（详见下「升裁 H3·批1」）；**不改 U**；未升 GAP 保留（含 **0806**）；0705 residual 真手机 OS 卡另记。

| CM | 可升（左列） | 拒升（右列） |
|----|--------------|--------------|
| **2158** | Live `HostAbi::shell` 真 apt/npm + audit | mock `shell:` / 旁路 |
| **2174** | 双会话同盘异桌面 | 单 mock 自写自读 |
| **0705** | 真 OS 卡或诚实 `platform_subset` 声明 | 内存假卡 |
| **0411** | 真面板复制回执 + tool-read 拒 + wake 不泄 key | 仅 U 内存 secrets |

对齐：interface-gaps §5.0 左列勾选、§5.3 证据字段；旁注同步见 `qa/host-integration-gaps.md`。


## H4 升 I 口径（Bit架构 · 2026-10-17 15:37 Asia/Shanghai）

> 来源：[`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) **§4.0 / §4.3**。口径表仍有效。**H4·批1（17:07）已升裁** → 2163/2164/2146/1703 **I-PASS**；**H4·OAuth（09:14）已升裁** → 1105/2109/2120 **I-PASS**（详见下「升裁 H4·OAuth + CM-0806」）；**不改 U**。

| CM | 可升（左列） | 拒升（右列） |
|----|--------------|--------------|
| **2163 / 2164** | 真 Host FS（`$file:` 读盘注入 / `write_to_file` 真写 `/workspace/agent-tools/`） | in-process fake FS；chat 内嵌 LARGE_PAYLOAD / PAYLOAD body；假路径 |
| **1105 / 2109 / 2120** | 真 OAuth → Ready / Connected（Slack / Finance / Outlook） | stub `authenticate`；假 Connected 无 token/会话/回调证据 |
| **2146** | 真切用户浏览器会话（可观测 profile/cookie/CDP） | 仅枚举 `SwitchToSignedInBrowser` 意图；未切会话 |
| **1703** | 真出网 fallback（403/封锁 → browser 或 curl 公共成功） | mock WebHost；凭据/登录 cookie 旁路冒充「公共回退」 |

对齐：interface-gaps §4.0 左列勾选、§4.3 证据字段（`evidence_cmd`=`host_h4_smoke.sh`、`artifact`、`assert`、`env`）；旁注同步见 `qa/host-integration-gaps.md`。

## H5 升 I 口径（Bit架构 · 2026-10-17 Asia/Shanghai）

> 来源：[`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) **§6.0 / §6.3**。口径表仍有效。**H5·批1（17:07）已升裁** → 1601/1602/1603/2157/1807/2131/2101/2128/2103 **I-PASS**；**CM-0806（09:14）已升裁** → **I-PASS**（隔离 throwaway jar；详见「升裁 H4·OAuth + CM-0806」）；**不改 U**；0705 residual 真手机 OS 卡另记。

| CM | 可升（左列） | 拒升（右列） |
|----|--------------|--------------|
| **1601 / 2157** | 真 PNG 落盘（magic `89504e47`）于 agent-tools | mock magic-only / 假路径 |
| **1602 / 1603** | 真 mp4 编码 + 真抽帧 PNG | 空文件 / 预置无关图 |
| **1807** | 真 `.pptx`（PK zip）under `/workspace` | 假扩展名 |
| **2131** | Host UI 卡 + 隔离打开云代理页 | 共享 CDP 9223 / 拷 chrome-profile |
| **2101 / 2128** | C′ pill 可见/toggle；end_turn 后 pill 像素 | CDP 页面 JS（B） |
| **2103** | math + mermaid 真渲染帧 | 纯文本冒充 |

对齐：interface-gaps §6.0/§6.3；旁注见 `qa/host-integration-gaps.md`。

## H6 升 I 口径（Bit架构 · 2026-10-17 Asia/Shanghai）

> 来源：[`adr/0004-full-matrix-i-closure.md`](../adr/0004-full-matrix-i-closure.md)。**H6 已升裁** → 其余 I=todo×193 **I-PASS**；**不改 U**；禁对 Host-hard 41 发明 mock-only Live；0705 平台子集 + phone residual 另记。

| 面 | 可升（左列） | 拒升（右列） |
|----|--------------|--------------|
| **kernel-sufficient** | U 验收测已 PASS；无独立 Host 硬面或 Host 面可由核契约覆盖 | 无 U 测 / U≠PASS |
| **covered-by-H0-H5** | Host 面已由 H0–H5 Live HostAbi / Host UI 覆盖 | 用 mock 冒充 Host-hard 41 的新 Live I |
| **0705** | 平台子集 I-PASS 已成立 | 删子集声明；假手机 OS 卡 |

对齐：ADR 0004；旁注见 `qa/host-integration-gaps.md`。

---

## 升裁 H6·全矩阵 I 收口 · host-integration I（Bit验证 · 2026-10-17 Asia/Shanghai）

> Wave H6：**193** 行 I=todo（U=PASS；Host 面 = kernel-sufficient 或 covered-by-H0-H5）。对照 ADR 0004。  
> **U/kernel-contract PASS=234 不动**；Host-hard **41** 条既有 I-PASS 不动；禁 mock-only 冒充 Host-hard Live；禁倒裁 U；禁碰共享 CDP **9223** / `/home/box/chrome-profile`。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `bash scripts/host_matrix_i_sweep.sh all` | 0 | moon test ≥452；`live_host_ping=true`；artifacts `docs/qa/artifacts/h6-matrix-i/` ×193 + `SUMMARY.json`；`i_claimed=false`；`status=READY_FOR_I_REVIEW` |

### 证据链

- **U acceptance**：每行既有验收测名（矩阵证据列）写入 `evidence.json` → `u_acceptance_test`。
- **Live HostAbi ping**：`HostAbi::live` / Host UI `/api/host/health` audit → `docs/qa/artifacts/h6-matrix-i/_live_host_ping/audit.jsonl`。
- **host_surface**：`kernel-sufficient` 或 `covered-by-H0-H5`。
- **Refused**：无（Host-hard 41 不在 todo 输入集）。

### 裁决（U 仍 PASS；host-integration **READY→I-PASS**）

| 范围 | U | I 升裁 | 说明 |
|------|---|--------|------|
| I=todo×193 | **PASS** | **READY→I-PASS** | H6 sweep；kernel-sufficient / covered-by-H0-H5 |
| Host-hard 41 | **PASS** | **维持 I-PASS** | H0–H5 Live 证据；不重 sweep 发明 |
| CM-0705 | **PASS** | **I-PASS（平台子集）** | phone OS residual 另记；**不**阻塞矩阵 I |

**禁止项核对**：未倒裁 U；未对 Host-hard 41 发明 mock-only Live；共享 9223/chrome-profile **未碰**；smoke `i_claimed=false`。  
**计数**：I-PASS **41→234**；open I-todo **193→0**；U=234 不动；**0705 residual** 真手机 OS 卡仍 GAP/todo（非矩阵 I 阻塞）。

---

## 升裁 H4·OAuth + CM-0806 · host-integration I（Bit验证 · 2026-10-17 09:14 Asia/Shanghai）

> Wave residual：**CM-1105 / CM-2109 / CM-2120 / CM-0806**。对照 interface-gaps **§4.0 左列**（OAuth）与 **H1/H5 0806** 左列（隔离 throwaway jar + 真 Update Computer）；gaps「H4/H5 升 I 口径」。  
> **U/kernel-contract PASS=234 不动**；已 I-PASS 37 条不动；禁倒裁 U；禁 stub OAuth；禁碰共享 CDP **9223** / `/home/box/chrome-profile`；禁 Cookie DB 副本入 artifacts。  
> OAuth IdP = **local sandbox**（`H4_OAUTH_SANDBOX=1` + per-provider `*_OAUTH_SANDBOX`）；非生产 IdP。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `bash scripts/host_h4_smoke.sh cm-1105` | 0 | `READY_FOR_I_REVIEW`；NeedsAuth→Connected；`oauth_callback_observed=true`；`stub_authenticate=false` |
| `bash scripts/host_h4_smoke.sh cm-2109` | 0 | `READY_FOR_I_REVIEW`；NeedsAuth→Ready；callback 观测；无 refresh token |
| `bash scripts/host_h4_smoke.sh cm-2120` | 0 | `READY_FOR_I_REVIEW`；NeedsAuth 拒 draft；OAuth 后 draft ok；callback 观测 |
| `bash scripts/host_h5_smoke.sh cm-0806` | 0 | `READY_FOR_I_REVIEW`；iso profile jar；Update `prompted→awaiting-second-confirm→completed`；digest 稳定；9223 untouched |

### §4.0 / 0806 左列勾选

| CM | 左列（可升） | 勾选 | 右列命中？ |
|----|--------------|------|------------|
| 1105 | 真 OAuth/Details → Connected | ✓ sandbox authorize→302 code+state→callback 200；`namespace_after=Connected`；Details Connected；`stub_authenticate=false`；无 refresh token | 否 |
| 2109 | 真 OAuth NeedsAuth→Ready | ✓ 同流；`namespace_after=Ready`；auth 前拒写；callback `has_code`+`state_matches` | 否 |
| 2120 | 真 OAuth 后 draft；NeedsAuth 拒 | ✓ auth 前 `REFUSED:draft:needsAuth`；callback 后 `create_draft` ok；sandbox send=`draft_only` 拒（非 stub Ready） | 否 |
| 0806 | 真 Update 后 jar 仍在（隔离） | ✓ throwaway `/tmp/h5-0806-profile.*/…/Cookies`；sha seed=before=after；`jar_intact_across_update=true`；`cookies_copied_to_artifacts=false`；`shared_cdp_9223=untouched` | 否（非共享会话拷 cookies） |

共享会话：四项均 `shared_cdp_9223=untouched`；0806 `chrome_profile=untouched`；OAuth 未碰 9223。

### 逐条核验

- **CM-1105**：local sandbox Slack OAuth HTTP code flow；callback 真观测；Connected；未 stub。**I-PASS**。
- **CM-2109**：local sandbox Finance OAuth；NeedsAuth→Ready；callback 真观测。**I-PASS**。
- **CM-2120**：local sandbox Outlook OAuth；NeedsAuth 拒 draft；认证后 draft；callback 真观测。**I-PASS**。
- **CM-0806**：隔离 throwaway jar + HostUiShell 两步 Update Computer completed；in-place digest 稳定；未碰 9223 / 共享 profile。**I-PASS**。

### 裁决（U 仍 PASS；host-integration **READY→I-PASS**）

| ID | U | host-integration | exit | 关键 assert | 裁决 |
|----|---|------------------|------|--------------|------|
| CM-1105 | **PASS** | **READY→I-PASS** | 0 | sandbox OAuth→Connected；callback observed；无 refresh | **I-PASS** |
| CM-2109 | **PASS** | **READY→I-PASS** | 0 | sandbox OAuth→Ready；callback observed | **I-PASS** |
| CM-2120 | **PASS** | **READY→I-PASS** | 0 | sandbox OAuth→Ready；draft after auth；NeedsAuth 拒 | **I-PASS** |
| CM-0806 | **PASS** | **READY→I-PASS** | 0 | iso throwaway jar；Update completed；digest stable；≠9223 | **I-PASS** |

### 证据指针

| CM | evidence_cmd | artifact |
|----|--------------|----------|
| CM-1105 | `bash scripts/host_h4_smoke.sh cm-1105` | `docs/qa/artifacts/cm-1105-slack-connect/` |
| CM-2109 | `bash scripts/host_h4_smoke.sh cm-2109` | `docs/qa/artifacts/cm-2109-finance-oauth/` |
| CM-2120 | `bash scripts/host_h4_smoke.sh cm-2120` | `docs/qa/artifacts/cm-2120-outlook-oauth/` |
| CM-0806 | `bash scripts/host_h5_smoke.sh cm-0806` | `docs/qa/artifacts/cm-0806-session-jar/` |

**禁止项核对**：未倒裁 U；未动既有 37 条 I-PASS；未以 stub OAuth 冒充 Connected/Ready；共享 9223/chrome-profile/Cookie 副本 **未碰**；OAuth 明文仅用 redacted token 摘要。  
**计数**：I-PASS **37→41**（+1105/2109/2120/0806）；open GAP **4→0**（41 行库存）；U=234 不动；**0705 residual** 真手机 OS 卡仍 GAP/todo（非 open 库存行）。

---

## 升裁 H4·批1 · host-integration I（Bit验证 · 2026-10-17 17:07 Asia/Shanghai）

> Wave H4 batch-1：**CM-2163 / CM-2164 / CM-2146 / CM-1703**。对照 [`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) **§4.0 左列**、§4.3 证据字段、gaps「H4 升 I 口径」。  
> **U/kernel-contract PASS=234 不动**；已 I-PASS 24 条（H0×3 / H1×3 / H2×14 / H3×4）不动；**不升 CM-1105 / 2109 / 2120**（NOT_READY OAuth）；**不升 CM-0806**；禁倒裁 U；禁 9223/chrome-profile/Cookie 副本。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `bash scripts/host_h4_smoke.sh`（artifacts 已落） | 0（先跑） | READY：2163/2164/2146/1703；NOT_READY：1105/2109/2120；`i_claimed=false` |

### §4.0 左列勾选

| CM | 左列（可升） | 勾选 | 右列命中？ |
|----|--------------|------|------------|
| 2163 | 真 Host FS `$file:` 读盘注入 | ✓ stdio MCP 子进程；`injected_bytes=278`；`chat_has_payload_marker=false`；`plain_refused=true`；9223 untouched | 否（非 in-process fake FS） |
| 2164 | 真 `write_to_file` → `/workspace/agent-tools/` | ✓ `result_path=…/h4-loopback-echo.txt`；path+sha256；chat 无 PAYLOAD；audit | 否 |
| 2146 | 真切用户浏览器会话 | ✓ `browser_session_switched=true`；app/user 异 profile + CDP 9500/9501（≠9223） | 否 |
| 1703 | 真出网 fallback | ✓ primary 403 → curl fallback 200；`credential_bypass=false`；auth-wall 401 | 否（非 mock WebHost / 非凭据旁路） |
| 1105/2109/2120 | 真 OAuth → Connected/Ready | ✗ `NOT_READY`；无 sandbox env；`stub_authenticate=false` | —（诚实拒升，未 stub） |

共享会话：`shared_cdp_9223=untouched`；2146 隔离 profile=`/tmp/h4-*-profile.*`；未碰 `/home/box/chrome-profile`；无 Cookie 副本。

### 逐条核验

- **CM-2163**：`host_h4_smoke.sh cm-2163`；Host FS `$file:` → 真 stdio MCP inject；chat 仅 ref；plain 拒。**I-PASS**。
- **CM-2164**：写盘 `/workspace/agent-tools/h4-loopback-echo.txt`；返回路径+sha256；chat 无 PAYLOAD。**I-PASS**。
- **CM-2146**：App vs User 双 throwaway Chrome + 私有 CDP；会话切换可观测；未碰 9223。**I-PASS**。
- **CM-1703**：403→curl 公共 200；auth-wall 无 credential bypass。**I-PASS**。
- **CM-1105 / 2109 / 2120**：**拒升**。artifacts `NOT_READY`（缺 `*_OAUTH_SANDBOX`）；未 stub Connected/Ready。GAP **保留**。

### 裁决（U 仍 PASS；host-integration **READY→I-PASS**）

| ID | U | host-integration | exit | 关键 assert | 裁决 |
|----|---|------------------|------|--------------|------|
| CM-2163 | **PASS** | **READY→I-PASS** | 0 | Host FS `$file:` stdio MCP inject；chat 仅 ref；plain 拒 | **I-PASS** |
| CM-2164 | **PASS** | **READY→I-PASS** | 0 | `write_to_file`→agent-tools；path+sha；无 PAYLOAD | **I-PASS** |
| CM-2146 | **PASS** | **READY→I-PASS** | 0 | App/User 异 profile+CDP；会话切换；≠9223 | **I-PASS** |
| CM-1703 | **PASS** | **READY→I-PASS** | 0 | 403→curl 200；`credential_bypass=false` | **I-PASS** |
| CM-1105 | **PASS** | **NOT_READY** | — | 无 Slack OAuth sandbox；未 stub | **仍 GAP** |
| CM-2109 | **PASS** | **NOT_READY** | — | 无 Finance OAuth sandbox；未 stub | **仍 GAP** |
| CM-2120 | **PASS** | **NOT_READY** | — | 无 Outlook OAuth sandbox；未 stub | **仍 GAP** |

### 证据指针

| CM | evidence_cmd | artifact |
|----|--------------|----------|
| CM-2163 | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2163` | `docs/qa/artifacts/cm-2163-mcp-file-expand/` |
| CM-2164 | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2164` | `docs/qa/artifacts/cm-2164-mcp-write-to-file/` |
| CM-2146 | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2146` | `docs/qa/artifacts/cm-2146-app-vs-user-browser/` |
| CM-1703 | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-1703` | `docs/qa/artifacts/cm-1703-fetch-public-fallback/` |
| CM-1105 | `bash …/host_h4_smoke.sh cm-1105` | `docs/qa/artifacts/cm-1105-slack-connect/`（NOT_READY） |
| CM-2109 | `bash …/host_h4_smoke.sh cm-2109` | `docs/qa/artifacts/cm-2109-finance-oauth/`（NOT_READY） |
| CM-2120 | `bash …/host_h4_smoke.sh cm-2120` | `docs/qa/artifacts/cm-2120-outlook-oauth/`（NOT_READY） |

**禁止项核对**：未倒裁 U；未动既有 24 条 I-PASS；未升/未删 0806；未以 stub OAuth 冒充 Connected；共享 9223/chrome-profile/Cookie **未碰**。  
**计数（H4 本批）**：I-PASS **24→28**（+2163/2164/2146/1703）；open 仍含 OAuth×3 + 0806 + H5 九项（见下批合并）。

---

## 升裁 H5·批1 · host-integration I（Bit验证 · 2026-10-17 17:07 Asia/Shanghai）

> Wave H5 batch-1：**CM-1601 / 1602 / 1603 / 2157 / 1807 / 2131 / 2101 / 2128 / 2103**。对照 [`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) **§6.0 左列**、§6.3 证据字段、gaps「H5 升 I 口径」。  
> **U=234 不动**；H0–H4 已升 I-PASS 不动；**不升 CM-0806**（NOT_READY residual）；禁倒裁 U；禁 9223/chrome-profile/Cookie 副本。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `bash scripts/host_h5_smoke.sh`（artifacts 已落） | 0（先跑） | 九 CM 均 `READY_FOR_I_REVIEW`；`i_claimed=false`；0806 residual `NOT_READY` |

### §6.0 左列勾选

| CM | 左列（可升） | 勾选 | 右列命中？ |
|----|--------------|------|------------|
| 1601 | 真 PNG magic `89504e47` 于 agent-tools | ✓ `h5-cm1601-generate.png`；magic `89504e470d0a1a0a`；10539 B | 否 |
| 1602 | 真 mp4 编码 + completion notify | ✓ ffmpeg mp4 12408 B；`video_complete_notified=true` | 否 |
| 1603 | 真抽帧 PNG | ✓ ffmpeg frame；magic `89504e47` | 否 |
| 2157 | Pillow chart PNG（非 matplotlib 假） | ✓ structured series→PNG；magic ok | 否 |
| 1807 | 真 `.pptx` PK zip under `/workspace` | ✓ magic `504b0304`；28409 B | 否 |
| 2131 | Host UI 卡 + 隔离打开云代理页 | ✓ card+page 帧；iso CDP 9401；`shared_9223_untouched=true` | 否 |
| 2101 | C′ pill 可见/toggle + LiveDisplay | ✓ HostUiShell `/api/host/*`；`rejected_B_cdp_page_js=true`；pill PNG | 否（非 B） |
| 2128 | end_turn 后 pill 像素 | ✓ `end_turn_left_pill=true`；LiveDisplay 帧 | 否 |
| 2103 | math + mermaid 真渲染帧 | ✓ `math_rendered`+`mermaid_rendered`；C′ 帧 | 否 |
| 0806 | Update 后登录态 | ✗ residual `NOT_READY`（共享会话禁拷 cookies） | —（GAP 保留） |

共享会话：九项 `shared_cdp_9223=untouched`；UI 隔离 `:80` / profile=`/tmp/h5-iso-profile.*`；未碰 `/home/box/chrome-profile`。

### 逐条核验

- **CM-1601 / 2157**：真 PNG 落盘 agent-tools；magic 现场复核 `89504e47`。**I-PASS**。
- **CM-1602 / 1603**：真 mp4 + 抽帧 PNG。**I-PASS**。
- **CM-1807**：python-pptx 真 PK zip。**I-PASS**。
- **CM-2131**：Host UI cursor-agent 卡 + 隔离 chrome 开 `cursor.com/agents/<id>`；未碰 9223。**I-PASS**。
- **CM-2101 / 2128**：C′ HostUiShell pill；拒 B（CDP page-JS）。**I-PASS**。
- **CM-2103**：math+mermaid SVG 真渲染帧。**I-PASS**。
- **CM-0806**：**拒升**。H5 residual NOT_READY；GAP 注保留。

### 裁决（U 仍 PASS；host-integration **READY→I-PASS**）

| ID | U | host-integration | exit | 关键 assert | 裁决 |
|----|---|------------------|------|--------------|------|
| CM-1601 | **PASS** | **READY→I-PASS** | 0 | PNG magic 89504e47 @ agent-tools | **I-PASS** |
| CM-1602 | **PASS** | **READY→I-PASS** | 0 | ffmpeg mp4 + completion notify | **I-PASS** |
| CM-1603 | **PASS** | **READY→I-PASS** | 0 | 抽帧 PNG magic ok | **I-PASS** |
| CM-2157 | **PASS** | **READY→I-PASS** | 0 | Pillow chart PNG | **I-PASS** |
| CM-1807 | **PASS** | **READY→I-PASS** | 0 | pptx PK `504b0304` | **I-PASS** |
| CM-2131 | **PASS** | **READY→I-PASS** | 0 | 卡+隔离开云代理页；≠9223 | **I-PASS** |
| CM-2101 | **PASS** | **READY→I-PASS** | 0 | C′ pill toggle + LiveDisplay | **I-PASS** |
| CM-2128 | **PASS** | **READY→I-PASS** | 0 | end_turn 后 pill 像素 | **I-PASS** |
| CM-2103 | **PASS** | **READY→I-PASS** | 0 | math+mermaid 真渲染帧 | **I-PASS** |
| CM-0806 | **PASS** | **NOT_READY / GAP** | — | 共享会话禁拷 cookies；未真 Update | **仍 GAP** |

### 证据指针

| CM | evidence_cmd | artifact |
|----|--------------|----------|
| CM-1601 | `bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1601` | `docs/qa/artifacts/cm-1601-generate-image/` |
| CM-1602 | `bash …/host_h5_smoke.sh cm-1602` | `docs/qa/artifacts/cm-1602-generate-video/` |
| CM-1603 | `bash …/host_h5_smoke.sh cm-1603` | `docs/qa/artifacts/cm-1603-watch-video/` |
| CM-2157 | `bash …/host_h5_smoke.sh cm-2157` | `docs/qa/artifacts/cm-2157-structured-chart/` |
| CM-1807 | `bash …/host_h5_smoke.sh cm-1807` | `docs/qa/artifacts/cm-1807-pptx/` |
| CM-2131 | `bash …/host_h5_smoke.sh cm-2131` | `docs/qa/artifacts/cm-2131-cursor-agent-card/` |
| CM-2101 | `bash …/host_h5_smoke.sh cm-2101` | `docs/qa/artifacts/cm-2101-react-pill/` |
| CM-2128 | `bash …/host_h5_smoke.sh cm-2128` | `docs/qa/artifacts/cm-2128-react-end-turn/` |
| CM-2103 | `bash …/host_h5_smoke.sh cm-2103` | `docs/qa/artifacts/cm-2103-math-mermaid/` |

**禁止项核对**：未倒裁 U；未删 0806/OAuth GAP 注；未以 mock magic / CDP-B / 共享 9223 冒充。  
**合并计数（H4·批1 + H5·批1）**：I-PASS **24→37**（+13）；open GAP **17→4**（**0806 / 1105 / 2109 / 2120**）；U=234 不动。

---

## 升裁 H3·批1 · host-integration I（Bit验证 · 2026-10-17 15:21 Asia/Shanghai）

> Wave H3 batch-1：**CM-2158 / CM-2174 / CM-0705 / CM-0411**。对照 [`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) **§5.0 左列**、§5.3 证据字段、gaps「H3 升 I 口径」。  
> **U/kernel-contract PASS=234 不动**；已 I-PASS 20 条（H0×3 / H1×3 / H2×14）不动；**不升 CM-0806**；禁倒裁 U；禁 9223/chrome-profile/Cookie 副本。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `moon check` | 0 | Finished. moon: no work to do |
| `moon test` | 0 | Total tests: **339**, passed: 339, failed: 0 |
| `bash scripts/host_h3_smoke.sh all` | 0 | 四 CM 均 `READY_FOR_I_REVIEW`；`i_claimed=false` |

### §5.0 左列勾选

| CM | 左列（可升） | 勾选 | 右列命中？ |
|----|--------------|------|------------|
| 2158 | Live Host 真 apt/npm + audit | ✓ 真 `npm install left-pad@1.3.0` 沙箱；pid=202362 exit=0；stdout `added 1 package`；stderr deprecated warn；non-Shell `direct-apt-api` REFUSED；audit span | 否（非 mock `shell:` / 非旁路） |
| 2174 | 双会话同盘异桌面 | ✓ A `:40` / B `:41`；B 写 `from-agent-b-…` → A 同内容；`not_single_mock_self_rw=true`；双 pid | 否 |
| 0705 | 真 OS 卡 **或** 诚实 platform_subset | ✓ 路径乙：`platform_subset=desktop_no_device_local_tools` + `platform_subset.md` 机读；桌面 tools=[]；`permission_card_shown=false`；**未**冒充真 OS 卡 | 否（非内存假卡） |
| 0411 | 真面板复制回执 + tool-read 拒 + wake 不泄 key | ✓ HostUiShell Live：`copied_url`/`copied_key:len=32`；tool-read `rejected`+`key=null`；wake `<webhook_event…>` 且全文无 key；LiveDisplay `:51` 帧 | 否（非仅 U 内存 secrets） |

共享会话：`shared_cdp_9223=untouched`；0411 隔离 CDP=9400 / profile=`/tmp/h3-iso-profile.*`；未碰 `/home/box/chrome-profile`；无 Cookie 副本。

### 逐条核验

- **CM-2158**：`shell.meta` cmd=`npm install --no-save --no-package-lock left-pad@1.3.0` cwd=`/tmp/h3-npm-sandbox.*` via=LiveHostShell；exit=0；独立复装确认 `node_modules/left-pad@1.3.0` 真树存在（smoke 后沙箱已卸，卸载回执在 artifacts）。**I-PASS**。
- **CM-2174**：`desktops.json` desktop_a=`:40` ≠ desktop_b=`:41`；`agent_a_read`==`agent_b_write`；session 双进程；contra 明示非单 mock 自写自读。**I-PASS**。
- **CM-0705**：**I-PASS（平台子集）**。声明诚实、可机读、与实现一致（桌面空列表、不假装手机卡）。**residual（另记）**：真 iOS/Android OS 权限对话框 + OS grant 仍 **GAP/todo**（缺真手机不整条拒升）。
- **CM-0411**：`host_ui_shell_live.py`→`/api/host/*`；五事件齐全；面板复制回执；assistant tool-read opaque 拒；wake 不泄 key；`webhook_panel.png` LiveDisplay。**I-PASS**。

### 裁决（U 仍 PASS；host-integration **READY→I-PASS**）

| ID | U | host-integration | exit | 关键 assert | 裁决 |
|----|---|------------------|------|--------------|------|
| CM-2158 | **PASS** | **READY→I-PASS** | 0 | Live npm 沙箱 left-pad；pid/exit=0；non-Shell 拒；audit | **I-PASS** |
| CM-2174 | **PASS** | **READY→I-PASS** | 0 | 双会话 `:40`/`:41` 同盘异桌面；A 见 B 写；非单 mock | **I-PASS** |
| CM-0705 | **PASS** | **READY→I-PASS（平台子集）** | 0 | `platform_subset.md`=`desktop_no_device_local_tools`；桌面空；无假 OS 卡 | **I-PASS（平台子集）** |
| CM-0411 | **PASS** | **READY→I-PASS** | 0 | Host 面板复制回执；tool-read 拒；wake 无 key | **I-PASS** |

### 0705 residual（单独成行）

| 项 | 状态 | 说明 |
|----|------|------|
| CM-0705 主升裁 | **I-PASS（平台子集）** | 桌面路径诚实子集；G-H3-5 满足 |
| **residual** 真手机 OS 权限卡 | **仍 GAP / todo** | 真 iOS/Android OS permission dialog + OS grant for `deviceLocalTools`；有手机机后再走路径甲升全量；**不**因缺真手机倒裁本条 I-PASS（平台子集） |

### 证据指针

| CM | evidence_cmd | artifact |
|----|--------------|----------|
| CM-2158 | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-2158` | `docs/qa/artifacts/cm-2158-package-install/` |
| CM-2174 | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-2174` | `docs/qa/artifacts/cm-2174-shared-box-fs/` |
| CM-0705 | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-0705` | `docs/qa/artifacts/cm-0705-device-local-tools/`（含 `platform_subset.md`） |
| CM-0411 | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-0411` | `docs/qa/artifacts/cm-0411-webhook-panel/` |

**禁止项核对**：未倒裁 U；未动既有 20 条 I-PASS；未升/未删 0806；共享 9223/chrome-profile/Cookie **未碰**；未以 mock stdout / 单 mock 自写自读 / 内存假卡 / 仅 U secrets 冒充。  
**计数**：I-PASS **20→24**（+2158/2174/0705/0411）；open GAP **21→17**；U=234 不动；0705 residual 真手机 OS 卡另记 GAP/todo。

---

## 升裁 H2·批3 · host-integration I（Bit验证 · 2026-10-17 15:12 Asia/Shanghai）

> Wave H2 batch-3：**CM-0204 / CM-0205 / CM-0206 / CM-1401 / CM-1405 / CM-1507 / CM-2178**。对照 [`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) **§3.0 左列 C′**、§3.2 HostUiEvent、§3.4 assert、gaps「H2 升 I 口径」、`/home/box/reference/app-ui.md`。  
> **U/kernel-contract PASS=234 不动**；已 I-PASS 13 条（H0×3 / H1×3 / H2 1901–1907×7）不动；**不升 CM-0806**；禁倒裁 U；禁 9223/chrome-profile/Cookie 副本。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `moon check` | 0 | `Finished. moon: no work to do` |
| `moon test` | 0 | **Total tests: 335, passed: 335, failed: 0**（对照自称 335 ✓） |
| `bash scripts/host_h2_smoke.sh batch3` | 0 | 7 条均 `status=READY_FOR_I_REVIEW`；全部 `check_*` 命中 want；无 `FAIL` 行；各 CM `frames_distinct=true` |
| `bash scripts/host_h2_smoke.sh all` | 0 | 14/14 `READY_FOR_I_REVIEW`（1901/1902/1907/1903–1906 无回归）；批3 帧 md5 与 batch3 单跑**逐字节相同**（确定性渲染，可复现） |

### §3.0 左列 C′ 勾选表（缺一则 GAP）

| 维度（左列 C′） | 裁决 | 证据路径 / 说明 |
|-----------------|------|-----------------|
| Live HostUiShell **方法**打开/推进 | **pass** | `host_ui_shell_live.py` `cmd_generic` → `POST /api/host/set_agent_hidden\|address_agent\|open_info_panel\|open_agent_settings\|set_agent_notify\|create_agent\|open_members_panel\|show_permission_guide\|follow_permission_guide`；1507 走 `open_settings`+`notify_anchor_visible`；`host_server.py` 推进 STATE（`rev` 递增），页面 `pollHost`→`applyHostState` 渲染；`isolation_meta.txt`：`ui_drive=HostUiShell_Live_adapter` |
| smoke 只经 Host `/api/host/*`——**禁止** CDP 页面 JS | **pass** | smoke/live/产物 **零** `Runtime.evaluate`；`probe_meta rejected_B_cdp_page_js=true`；CDP 9333 viewer-only，跑后已关 |
| 有 audit span | **pass** | `audit_spans.jsonl`：0204:3 / 0205:2 / 0206:4 / 1401:3 / 1405:2 / 1507:6 / 2178:2；tool=`host_ui:*`；`evidence.md` 按 span_id 引用 |
| phase/入口来自 Host→Kernel HostUiEvent | **pass** | 0204 `SidebarListChanged`×2+`AgentAddressed(hidden=true)`；0205 `InfoPanelOpened`+`SettingsOpened`；0206 `AgentNotifyToggleChanged`×2；1401 `AgentCreated`+`SidebarListChanged`+`MembersPanelVisible`；1405 `InfoPanelOpened`+`MembersPanelVisible`；1507 `SettingsAnchorVisible`(anchor_id)×3；2178 `PermissionGuideShown(pretends_connected=false)`+`SettingsOpened(via=permission-guide)`+`SettingsAnchorVisible(account)` |
| LiveDisplay 真帧（非合成 PNG） | **pass** | 18 帧全部 ffmpeg `x11grab` from `:99.0`；1280×800；2.2k–3.0k 色；sha256↔`.sha256` 18/18；`frame_origin=LiveDisplay`；非 `fixture-only/` |

### B 一票否决核对

| B 条件 | 命中？ | 说明 |
|--------|--------|------|
| 静态夹具 + CDP/页面 JS 直调 | **否** | 仅 Host HTTP API；页面 JS 只轮询 `/api/host/state` 渲染 |
| HostUiShell 仅内存事件、无真实 Host 面 | **否** | Host STATE（agents / infoPanel / notify / permissionGuide）+ DOM；帧内可见侧栏行增删、chat header、info pane、gear 子页、引导卡、Settings 锚点高亮 |
| fixture-only/ / 合成 PNG / 同图冒充 | **否** | 正规 `cm-*/`；CM 内帧 md5 两两不同；跨 CM 唯一一对相同见下 |

**帧 md5 全量（all 跑后 37 帧）**：CM 内两两不同 ✓。跨 CM 唯一碰撞：`cm-0205-info-panel/info_panel.png` ≡ `cm-1405-members-panel/info_single_agent.png`（md5 `f40adf7c…`）。核实为**独立捕获**：两次独立 Host/Chrome 进程（chrome_pid 183501 vs 185522）、相隔 14 s、各自 ffmpeg 日志与 span_id（`17e5bead…` vs `8355094b…`）；同一 API（`open_info_panel h2-throwaway-agent` 于全新 STATE）→ 同一确定性画面。batch3 首跑时两者 md5 不同（`f3496f75…` vs `f40adf7c…`），排除 `cp`。**不构成 B**；建议 smoke 加跨 CM 去重或帧内 nonce（非阻断）。

### 共享会话未触碰（跑前→跑后）

| 探针 | 跑前（15:05） | 跑后（15:10） |
|------|------|------|
| CDP 9223 监听 | yes（pid **86471**） | yes（同 pid） |
| `/home/box/chrome-profile` mtime | 1792219682 | **同** |
| Default/Cookies mtime | 1792219016 | **同** |
| Default/Login Data mtime | 1792213350 | **同** |
| 隔离 profile / CDP 9333 | — | `/tmp/h2-iso-profile.*` **0 残留**；9333 **未监听** |
| artifacts 内 Cookies/Login Data | — | **无** |

### 逐条核查

- **CM-0204**：`sidebar_before`（3 行，含 H2 Hidden Agent）→ `sidebar_hidden`（2 行；像素差仅侧栏第 3 行 bbox (30,244)-(141,258)）→ `addressed_hidden`（chat header「H2 Hidden Agent · hidden · not in sidebar · addressable」，侧栏仍 2 行；差 bbox 仅 header）。「仍可寻址」= **按 id** `address_agent h2-hidden-agent` 打开会话（`AgentAddressed hidden=true`，`activeChat=h2-hidden-agent`，`in_sidebar=false`）。Cmd-K / Hidden manager 路径**未证**（不要求，id 路径已足）。注：§3.2 契约名 `SidebarHiddenAgentAddressable` 实现为 `AgentAddressed(hidden=true)`，语义等价，名称漂移记 note。**I-PASS**。
- **CM-0205**：对照 app-ui.md「Per-agent info pane（separate from the global Settings）」：右侧独立 pane；header = 名称 + **⚙ 在 X 旁** + X ✓；live computer preview 在 Routines 之上 ✓；Channels（可连接）✓；Members ✓；⚙ 子页含 avatar/name/title/description/per-assistant notifications（见 0206 帧）✓；`settingsOpen=false`，打开全局 Settings 后 `infoPanel.open=false`，两帧 md5 不同 ✓。打开入口：页面 chat-name 点击与 ⌘⇧I 均接同一 `/api/host/open_info_panel` ✓。**非阻断 fidelity 缺口 G-UI-0205a**：app-ui 写 Members「in group chats」、Channels「when … available」为条件区；Host 在 1:1 pane 也渲染 Members 占位（文案「Members appear in group chats」，未造假成员）——这是 U 合同「五区恒有」（`info_panel_section_anchors().length()==5`）的直接投影，不倒裁 U；body 中「Agent settings (⚙)」为指向 header 齿轮的说明行。**I-PASS**（附 note）。
- **CM-0206**：Host STATE 真隔离：跑后 `host_ui_state.json.notify = {"h2-throwaway-agent": {"notify.sound": false, "notify.mentions-only": true}}`，demo-agent **无条目**（走默认）；打开 B 后 `infoPanel.notify` = 默认（sound=On / mentions-only=Off），A 的改动在 STATE 内持久。帧：A 默认 vs A 改后差集中于开关列；A 默认 vs B 默认在开关列 (x≥960, y390–600) **差 0 px**（仅名称/头像不同）；A 改后 vs B 默认 6923 px。三帧 md5 互异——非同一张图。gear 子页非全局 Settings（`settingsOpen=false`）。**I-PASS**。
- **CM-1401**：`before_create` 侧栏 2 行，STATE 无 `h2-created-agent` → `create_agent` 后侧栏第 3 行「H2 Created Agent」（`AgentCreated`+`SidebarListChanged`）→ `open_members_panel` 后 info pane Members 列 `H2 Created Agent (h2-created-agent)`（`MembersPanelVisible member_ids∋h2-created-agent`）。抛型 id，无生产助手。**I-PASS**。
- **CM-1405**：群聊 `h2-group` 的 info pane（header「Group h2-group」，chat badge「group chat」）内 Members 区列出 `h2-throwaway-agent` / `demo-agent`，与 `member_ids` 一致；`settingsOpen=false`（在 info pane，不在 Settings）；与 app-ui「Members in group chats」于 info pane 一致 ✓；单聊对照帧 Members 仅占位文案（见 G-UI-0205a）。**I-PASS**。
- **CM-1507**：见下「1507 详述」。**I-PASS**（附 note）。
- **CM-2178**：引导卡帧：「Permission missing · **Not connected**」+「user-Gmail needs authorization (connector-needs-auth)… Not connected yet.」+ 链接 `grokbot://app/v1/settings?id=account`；`follow_permission_guide` 后 Settings 打开并滚到 **account** 锚点（高亮，Settings header 已滚出视口），行内显示「user-Gmail · **Not connected · Needs auth**」。STATE `permissionGuide.connected=false`（前后），`status="Needs auth"`；事件 `PermissionGuideShown pretends_connected=false`、`SettingsOpened via=permission-guide`；全产物 grep `"connected": true` / `"pretends_connected": true` **0 命中**。未假装已连接 ✓。**I-PASS**。

### 1507 详述（底部锚点可证伪性）

| 帧 | md5 | 高亮外框 #7aa2ff ROI（实像素 x0,y0–x1,y1） | 高亮底色 #1c2433 px |
|----|-----|--------------------------------------------|---------------------|
| `auto-review.png` | `92b57077…` | (271,494)–(996,582) · 3244 px | 56285 |
| `auto-review-rules.png` | `99a6d2be…` | (271,575)–(996,663) · 3244 px | 56200 |
| `security-keys.png` | `75a4151f…` | (271,656)–(996,744) · 2576 px（右下被状态栏遮 ~1/3） | 50800 |

| 帧对 | 总差 px | 其中状态栏 ROI | 状态栏外 | 状态栏外 bbox | y<480 行差 | 滚动条列差 |
|------|---------|----------------|----------|---------------|------------|------------|
| auto-review ↔ rules | 118684 | 904（0.8%） | 117780 | (271,494)–(996,663) | **0** | **0** |
| rules ↔ security-keys | 118676 | 7101（6.0%） | 111575 | (271,575)–(996,744) | **0** | **0** |
| auto-review ↔ security-keys | 120798 | 6217（5.1%） | 114581 | (271,494)–(996,744) | **0** | **0** |

裁读：
1. **三帧滚动位置完全相同**（y<480 与滚动条列 0 差）——三锚点都是 General 末尾三行，`scrollIntoView(block:start)` 触底被夹紧；所以自称「底部锚点滚动幅度小」实为 **0**，三者**不能靠滚动区分**。滚动本身有证：三帧视口起于 Network debugger（Account…Hardware acceleration 已滚出），滚动条 thumb 在底部，对照 1901 无锚点帧（Account 在顶）。
2. **区分依据 = 高亮外框/底色落在目标锚点行 ROI**，三个 ROI 按 ~81 px 行距逐行下移、互不重叠，与 Settings 行 Auto-review / Auto-review rules / Security keys 一一对应；帧差 94–99% 在状态栏外。**不是**「只有状态栏写了锚点名」。
3. 满足本轮可证伪条件第二支：**HostUiEvent `SettingsAnchorVisible(anchor_id)` + 高亮元素在帧内目标区可见**（像素 ROI，§3.3 1902 assert 允许「DOM/无障碍名或像素 ROI 之一」）。第一支（Host 记 scrollTop / 目标 boundingRect）**未提供**。
4. 残余（非阻断，建议 MoonBit核补）：`SettingsAnchorVisible` 由 `host_server` 在渲染前发出，非页面 DOM 回执；建议页面渲染后回 POST `{anchor_id, scrollTop, boundingRect, highlighted:true}` 写入 STATE/事件，并在 smoke 断言 rect ⊂ viewport。分析留档 `docs/qa/artifacts/cm-1507-auto-review-deeplink/bitverify_1507_roi.txt`。

**→ 1507 I-PASS**。

### 裁决（U 仍 PASS；host-integration **READY→I-PASS**）

| ID | U | host-integration | exit | 关键 assert | 裁决 |
|----|---|------------------|------|-------------|------|
| CM-0204 | **PASS** | **READY→I-PASS** | 0 | hide 后侧栏无该行；按 id 寻址打开，header 显 hidden·addressable；audit×3 | **I-PASS** |
| CM-0205 | **PASS** | **READY→I-PASS** | 0 | info pane 五区（preview/Routines/Channels/Members/⚙）；≠全局 Settings；对齐 app-ui（note G-UI-0205a） | **I-PASS** |
| CM-0206 | **PASS** | **READY→I-PASS** | 0 | A sound off / mentions-only on 存于 STATE.notify[A]；B 无条目=默认；开关列像素对照 | **I-PASS** |
| CM-1401 | **PASS** | **READY→I-PASS** | 0 | 创建前无→侧栏新行→Members 含新 id；AgentCreated/MembersPanelVisible | **I-PASS** |
| CM-1405 | **PASS** | **READY→I-PASS** | 0 | 群聊 info pane Members 列与 member_ids 一致；settingsOpen=false；对齐 app-ui | **I-PASS** |
| CM-1507 | **PASS** | **READY→I-PASS** | 0 | 三锚点 SettingsAnchorVisible + 高亮 ROI 逐行对应；滚动同位（触底）不作区分依据 | **I-PASS** |
| CM-2178 | **PASS** | **READY→I-PASS** | 0 | 引导卡 Not connected → Settings account 锚点；connected 恒 false；无 pretends_connected | **I-PASS** |

### 证据表（§3.4）

| CM | evidence_cmd | artifact | assert 结果 | env |
|----|--------------|----------|-------------|-----|
| CM-0204 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-0204` | `docs/qa/artifacts/cm-0204-hidden-agent/` | **成立（C′）** | 隔离 Xvfb `:99` + Host `host_server.py`（127.0.0.1:8765）+ viewer CDP 9333；9223 未碰 |
| CM-0205 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-0205` | `docs/qa/artifacts/cm-0205-info-panel/` | **成立（C′）** + note G-UI-0205a | 同上 |
| CM-0206 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-0206` | `docs/qa/artifacts/cm-0206-notify-toggles/` | **成立（C′）** | 同上 |
| CM-1401 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1401` | `docs/qa/artifacts/cm-1401-create-agent-sidebar/` | **成立（C′）** | 同上；抛型 `h2-created-agent` |
| CM-1405 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1405` | `docs/qa/artifacts/cm-1405-members-panel/` | **成立（C′）** | 同上 |
| CM-1507 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1507` | `docs/qa/artifacts/cm-1507-auto-review-deeplink/`（+`bitverify_1507_roi.txt`） | **成立（C′）** 高亮 ROI；无 scrollTop/rect（note） | 同上 |
| CM-2178 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-2178` | `docs/qa/artifacts/cm-2178-permission-guide-settings/` | **成立（C′）** | 同上；未真连 user-Gmail |

**非阻断 note（不挡 I，交 MoonBit核）**：G-UI-0205a（1:1 pane Members/Channels 条件渲染 vs U 五区恒有）；1507 页面→Host 锚点回执（scrollTop/boundingRect）；0204 事件名对齐 §3.2 `SidebarHiddenAgentAddressable`；smoke 跨 CM 帧去重/nonce。  
**禁止项核对**：未倒裁 U；未动 13 条已 I-PASS；未升 0806；共享 9223/chrome-profile/Cookie **未碰**；未以合成 PNG 冒充；未给 B；未改业务代码（仅 docs + 1507 分析留档）。  
**计数**：I-PASS **13→20**（+0204/0205/0206/1401/1405/1507/2178）；open GAP **28→21**；U=234 不动。

---

## 升裁 H2·批2 · host-integration I（Bit验证 · 2026-10-17 14:54 Asia/Shanghai）

> Wave H2 batch-2：**CM-1903 / CM-1904 / CM-1905 / CM-1906**。对照 [`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) **§3.0 左列 C′**、§3.4 assert、gaps「H2 升 I 口径」。  
> **U/kernel-contract PASS=234 不动**；已 I-PASS（1901/1902/1907 与 H0/H1）不动；**不升 CM-0806**；禁倒裁 U；禁 9223/chrome-profile/Cookie 副本。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `moon check` | 0 | `Finished. moon: no work to do` |
| `moon test` | 0 | **Total tests: 328, passed: 328, failed: 0**（对照自称 328 ✓） |
| `bash scripts/host_h2_smoke.sh batch2` | 0 | 1903/1904/1905/1906 均 `status=READY_FOR_I_REVIEW`；驱动=`host_ui_shell_live.py`→`/api/host/*` |

### §3.0 左列 C′ 勾选表（缺一则 GAP）

| 维度（左列 C′） | 裁决 | 证据路径 / 说明 |
|-----------------|------|-----------------|
| Live HostUiShell **方法**打开/推进 | **pass** | `host_ui_shell_live.py` → `POST /api/host/request_update_computer\|confirm_update_computer_step\|cancel_update_computer\|open_reset_computer\|set_local_execution\|try_machine_call\|notify_anchor_visible`；`isolation_meta.txt`：`ui_drive=HostUiShell_Live_adapter` |
| smoke 只经 Host `/api/host/*`——**禁止** CDP 页面 JS | **pass** | smoke/live **零** `Runtime.evaluate`；`probe_meta rejected_B_cdp_page_js=true`；CDP 9333 viewer-only |
| 有 audit span | **pass** | 各目录 `audit_spans.jsonl`（1903:3 / 1904:1 / 1905:2 / 1906:4；tool=`host_ui:*`） |
| phase/入口来自 Host→Kernel HostUiEvent | **pass** | 1903 `UpdateComputerPhaseChanged`×3；1904 `SettingsOpened`+`SettingsAnchorVisible`；1905 `LocalExecutionGateChanged`；1906 `SettingsAnchorVisible`×双锚点 |
| LiveDisplay 真帧（非合成 PNG） | **pass** | ffmpeg `x11grab` @`:99`；1280×800；~2.8k–3.7k 色；sha↔`.sha256`；`frame_origin=LiveDisplay`；`section_3_0=C_prime`；非 `fixture-only/` |

### B 一票否决核对

| B 条件 | 命中？ | 说明 |
|--------|--------|------|
| 静态夹具 + CDP/页面 JS 直调 | **否** | 仅 Host HTTP API；无页面 JS 突变 |
| HostUiShell 仅内存事件、无真实 Host 面 | **否** | Host 进程 STATE+DOM；帧内可见两步 Update / Reset / gate / Updates vs Computer |
| fixture-only/ / 合成 PNG | **否** | 正规 `cm-190*-*/`；x11grab 真帧 |

### 共享会话未触碰（跑前→跑后）

| 探针 | 跑前 | 跑后 |
|------|------|------|
| CDP 9223 监听 | yes（pid **86471**） | yes（同 pid） |
| `/home/box/chrome-profile` mtime | 1792219682 | **同** |
| Default/Cookies mtime | 1792219016 | **同** |
| Default/Login Data mtime | 1792213350 | **同** |
| 隔离 profile | — | `/tmp/h2-iso-profile.*` **已删**；CDP **9333** 关闭 |
| artifacts 内 Cookies/Login Data | — | **无** |

### 裁决（U 仍 PASS；host-integration **READY→I-PASS**）

| ID | U | host-integration | exit | 关键 assert | 裁决 |
|----|---|------------------|------|--------------|------|
| CM-1903 | **PASS** | **READY→I-PASS** | 0 | `request_update`→`confirm_step`→`cancel`；phase=prompted→awaiting-second-confirm→cancelled；`not_reset`；两步帧独立（Δ5630 px）；completed=false；audit×3 | **I-PASS** |
| CM-1904 | **PASS** | **READY→I-PASS** | 0 | `open_reset_computer`；Reset UI 可达；`reset_preferred=false`；未执行破坏性 Reset；与 1903 帧 Δ149679 px | **I-PASS** |
| CM-1905 | **PASS** | **READY→I-PASS** | 0 | gate off 后 `try_machine_call desk-1` **真拒**（`rejected=true`）；`gate_log.json`+`rejected_local_off`；`LocalExecutionGateChanged`；双帧 | **I-PASS** |
| CM-1906 | **PASS** | **READY→I-PASS** | 0 | Updates tab（update-channel）vs update-computer 双帧可区分（Δ357564 px）；`SettingsAnchorVisible`×2；audit×4 | **I-PASS** |

### 证据表（§3.4）

| CM | evidence_cmd | artifact | assert 结果 | env |
|----|--------------|----------|-------------|-----|
| CM-1903 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1903` | `docs/qa/artifacts/cm-1903-update-computer/` | **成立（C′）** 两步 Update≠Reset | 隔离 Xvfb `:99` + Host `host_server.py`；9223 未碰 |
| CM-1904 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1904` | `docs/qa/artifacts/cm-1904-reset-computer/` | **成立（C′）** Reset 可达且非首选 | 同上；无 confirm/execute reset |
| CM-1905 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1905` | `docs/qa/artifacts/cm-1905-local-execution/` | **成立（C′）** 真拒+gate_log | 同上 |
| CM-1906 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1906` | `docs/qa/artifacts/cm-1906-updates-vs-update-computer/` | **成立（C′）** 双帧可区分 | 同上 |

**禁止项核对**：未倒裁 U；未动 H0/H1/1901/1902/1907；未升 0806；共享 9223/chrome-profile/Cookie **未碰**；未以合成 PNG 冒充；未给 B。  
**计数**：I-PASS **9→13**（+1903/1904/1905/1906）；open GAP **32→28**；U=234 不动。

---
## 升裁 H2·C′复核 · host-integration I（Bit验证 · 2026-10-17 14:46 Asia/Shanghai）

> Wave H2 优先三项 **CM-1901 / CM-1902 / CM-1907** 重做后升 I 复核。对照 [`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) **§3.0 左列 C′** 与上次「升裁 H2」拒升理由。  
> **U/kernel-contract PASS=234 不动**；H0/H1 I-PASS 不动；**不升 CM-0806**；禁倒裁 U。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `moon check` | 0 | `Finished. moon: ran 7 tasks, now up to date` |
| `moon test` | 0 | **Total tests: 320, passed: 320, failed: 0**（对照自称 320 ✓） |
| `bash scripts/host_h2_smoke.sh cm-1901` | 0 | `frames=3/3 status=READY_FOR_I_REVIEW`；驱动=`host_ui_shell_live.py`→`/api/host/open_settings` |
| `bash scripts/host_h2_smoke.sh cm-1902` | 0 | `frames=3/3 status=READY_FOR_I_REVIEW`；`notify_anchor_visible`×3 |
| `bash scripts/host_h2_smoke.sh cm-1907` | 0 | `phase=cancelled status=READY_FOR_I_REVIEW`；独立 context_menu 帧 |

### §3.0 左列 C′ 勾选表（缺一则 GAP）

| 维度（左列 C′） | 裁决 | 证据路径 / 说明 |
|-----------------|------|-----------------|
| Live HostUiShell **方法**打开/推进（非仅内存 push_event 无 Host 面） | **pass** | `scripts/host_ui_shell_live.py` → `POST /api/host/open_settings\|request_delete_agent\|cancel_delete_agent\|open_sidebar_context_menu\|notify_anchor_visible`；`scripts/host_ui_surface/host_server.py` 推进 STATE；页面 `pollHost`→`applyHostState` 真面；artifacts `host_ui_state.json` / `isolation_meta.txt`（`ui_drive=HostUiShell_Live_adapter`） |
| smoke 只经 HostAbi / `run_h2_probe` / Host `/api/host/*`——**禁止** CDP 调 `window.__bitbotHostUi` | **pass** | `host_h2_smoke.sh` **零** `Runtime.evaluate` / 页面 JS 直调；仅 `live_shell`→`/api/host/*`；`probe_meta.txt`：`rejected_B_cdp_page_js=true`；CDP 9333 标注 viewer-only |
| 有 audit span | **pass** | 各目录 `audit_spans.jsonl` + `host_ui_audit.json`（1901:3 / 1902:6 / 1907:3 spans；tool=`host_ui:*`） |
| phase/入口来自 Host→Kernel HostUiEvent | **pass** | `host_ui_events.json`：1901 `SettingsOpened`×3；1902 `SettingsOpened`+`SettingsAnchorVisible`；1907 `SidebarContextMenuOpened` + `DeleteAgentPhaseChanged` requested→awaiting-confirm→cancelled |
| LiveDisplay 真帧（非合成 PNG） | **pass** | ffmpeg `x11grab` @隔离 display；1280×800；~2k 色；sha 与 `.sha256` 侧车一致；`frame_origin=LiveDisplay`；非 `fixture-only/` |
| 1907：独立 context_menu 帧（md5≠awaiting）；phase 链；completed=false；无 cp 伪造 | **pass** | `context_menu.md5=02bed74b…` ≠ `awaiting=3c2cab2e…`（差 727554 px）；`cancelled=4b3bae9a…`；`probe_meta context_menu_independent=true`；`completed=false`；三帧分次 `record_frame`（无 cp） |

### B 一票否决核对

| B 条件 | 命中？ | 说明 |
|--------|--------|------|
| 静态夹具 + CDP/页面 JS 直调 | **否** | 上次拒升主因已消除；smoke 无 CDP 突变；Host 进程 HTTP API 驱动 |
| HostUiShell 仅内存事件、无真实 Host 面 | **否** | Host 进程 STATE+DOM 推进；非仅 MoonBit `push_event` 无面（kernel `HostUiShell::live` 仍为 U/吸收层；I 驱动面=Host `/api/host/*`） |
| fixture-only/ / 演示壳冒充 / 合成 PNG | **否** | 正规 `cm-190*-*/`；x11grab 真帧；非合成 |

**总判**：上次 B（CDP 直调静态壳）已改 → **§3.0 左列全过** → 三条 **GAP→I-PASS**。

### 共享会话未触碰（跑前→跑后）

| 探针 | 跑前 | 跑后 |
|------|------|------|
| CDP 9223 监听 | yes（pid **86471**） | yes（同 pid alive） |
| `/home/box/chrome-profile` mtime | 1792218785 | **同** |
| Default/Cookies mtime | 1792219016 | **同** |
| Default/Login Data mtime | 1792213350 | **同** |
| 隔离 profile | — | `/tmp/h2-iso-profile.*` **已删**；CDP **9333** 关闭 |
| artifacts 内 Cookies/Login Data | — | **无** |
| 旧 `cdp_*.json` | — | **残留**（14:37 上次 B 跑；本轮 smoke **未再写入**；不计入驱动证据） |

### 裁决（U 仍 PASS；host-integration **GAP→I-PASS**）

| ID | U | host-integration | exit | 关键 assert | 裁决 |
|----|---|------------------|------|--------------|------|
| CM-1901 | **PASS** | **GAP→I-PASS** | 0 | `open_settings`×3（sidebar/shortcut/palette）；`SettingsOpened`×3；audit×3；三帧 1280×800 ~2.1k 色；帧间差 ~1.4–1.6k px；`i_claimed=false` | **I-PASS** |
| CM-1902 | **PASS** | **GAP→I-PASS** | 0 | theme/timezone/update-computer 经 HostUiShell；`SettingsAnchorVisible`；帧间差 5万–16万 px；audit×6 | **I-PASS** |
| CM-1907 | **PASS** | **GAP→I-PASS** | 0 | context_menu→awaiting-confirm→cancelled；md5 独立；completed=false；无 cp | **I-PASS** |

### 证据表（§3.3）

| CM | evidence_cmd | artifact | assert 结果 | env |
|----|--------------|----------|-------------|-----|
| CM-1901 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1901` | `docs/qa/artifacts/cm-1901-settings-entry/`（`entry_*.png`+sha / `evidence.json` / `audit_spans.jsonl` / `host_ui_events.json`） | **成立（C′）** | 隔离 Xvfb + Host `host_server.py` + viewer CDP 9333；9223 未碰 |
| CM-1902 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1902` | `docs/qa/artifacts/cm-1902-settings-anchor/` | **成立（C′）** | 同上 |
| CM-1907 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1907` | `docs/qa/artifacts/cm-1907-delete-agent/` | **成立（C′）** | 同上；抛型 `h2-throwaway-agent` |

**禁止项核对**：未倒裁 U；未动 H0/H1；未升 0806；共享 9223/chrome-profile/Cookie **未碰**；未以合成 PNG 冒充；未给 B 面子分（左列逐项实检）。  
**计数**：I-PASS **9**（+1901/1902/1907）；open GAP **32**；U=234 不动。

---

## 升裁 H2 · host-integration I（Bit验证 · 2026-10-17 14:38 Asia/Shanghai）

> Wave H2 优先三项：**CM-1901 / CM-1902 / CM-1907**。硬口径见上文「H2 升 I 口径」与 [`host-integration-interface-gaps.md`](../host-integration-interface-gaps.md) §3.0–3.3。  
> **U/kernel-contract PASS=234 不动**；H0/H1 I-PASS 不动；**不升 CM-0806**；禁倒裁 U。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `moon check` | 0 | `Finished. moon: ran 7 tasks, now up to date` |
| `moon test` | 0 | **Total tests: 319, passed: 319, failed: 0**（对照自称 319/319 ✓） |
| `bash scripts/host_h2_smoke.sh cm-1901` | 0 | `frames=3/3 status=READY_FOR_I_REVIEW` |
| `bash scripts/host_h2_smoke.sh cm-1902` | 0 | `frames=3/3 status=READY_FOR_I_REVIEW` |
| `bash scripts/host_h2_smoke.sh cm-1907` | 0 | `phase=cancelled status=READY_FOR_I_REVIEW` |

### C′ / B 判定（表面）

| 问 | 结论 | 依据 |
|----|------|------|
| `scripts/host_ui_surface/index.html` 是否为 Bit Bot Live **HostUiShell** 产品面？ | **否 → 属 B / 未达 C′** | 静态 HTML+内联 JS 演示壳；`python3 -m http.server` 投喂 throwaway Chrome；**无** Kernel→Effect→Host FFI→`HostUiShell` Live 通路 |
| `box_host` Live `HostUiShell` 是否驱动该面？ | **否** | `box_host/host_ui_shell.mbt`：`HostUiShell::live()` 仅内存 `push_event`；`open_settings` / `request_delete_agent` **不**打开任何 UI；MoonBit 代码树 **零引用** `host_ui_surface` / `bitbotOpenSettings`（仅 README 旁注路径） |
| smoke 实际驱动方式 | CDP 剧本 | `host_h2_smoke.sh` 对隔离 CDP 做 `Runtime.evaluate`：`bitbotOpenSettings` / `bitbotScrollAnchor` / `bitbotRequestDelete` / `bitbotCancelDelete` — **绕过** HostUiShell |
| 帧是否 LiveDisplay 真帧？ | **是（x11grab）** | ffmpeg `Input #0, x11grab, from ':99.0'`；1280×800；非单色（~2k 色）；sha 与 `.sha256` 侧车一致；非 ImageMagick 合成 |
| 文档口径 | C′ 拒 B | `host-integration-interface-gaps.md` §3.0：`HostUiShell` Live = **产品 Host 面，非 fixture**；B=「剧本假窗 / stub / 合成 PNG / fixture-only」**永不得升 I**；`gaps.md`「H2 升 I 口径」证据面=「Live HostUiShell 驱动的可交互 Host 面 + LiveDisplay 真帧」；`host-ui-contract.md` §0：I=「非剧本假窗」 |

**总判**：表面自称 C′，实为 **B 类剧本假窗（静态 HTML 模拟 Settings/删除对话框）**；帧虽为隔离 display 真 x11grab，**未达 C′**（无真实 HostUiShell 契约接到运行时设置状态机 / delete 确认流）。→ **三条一律拒升 I，留 GAP**。打回实现方：补 **产品 Host 进程** 上 Live `HostUiShell`（G-UI-1）真驱动 Settings/侧栏 Delete，再点升裁。

### 共享会话未触碰（跑前→跑后）

| 探针 | 跑前 | 跑后 |
|------|------|------|
| CDP 9223 监听 | yes（pid **86471**） | yes（同 pid alive） |
| `/home/box/chrome-profile` mtime | 1792218785 | **同** |
| Default/Cookies mtime | 1792219016 | **同** |
| Default/Login Data mtime | 1792213350 | **同** |
| 隔离 profile | — | `/tmp/h2-iso-profile.*` **已删**；CDP **9333** 关闭 |
| artifacts 内 Cookies/Login Data | — | **无** |

### 裁决（U 仍 PASS；host-integration **仍 GAP**）

| ID | U | host-integration | exit | 关键 assert | 裁决 |
|----|---|------------------|------|--------------|------|
| CM-1901 | **PASS** | **仍 GAP** | 0 | CDP 三入口 `settingsOpen=true`（sidebar/shortcut/palette）；`cdp_neg_gear=true`；三帧 1280×800、~2k 色、sha 侧车匹配、display=**:99**；帧间差 ~1.4–1.6k 像素（非三张克隆） | **GAP（拒升）** — 表面属 B / 未达 C′；§3.3 缺 `evidence.json`（仅 `evidence.md`）次要 |
| CM-1902 | **PASS** | **仍 GAP** | 0 | 锚点 CDP `anchor=theme|timezone|update-computer`；未知 id → `anchor=null`（不假成功）；三帧差异大（5万–16万像素） | **GAP（拒升）** — 同上；深链消费在 JS `scrollToAnchor`，非 HostUiShell |
| CM-1907 | **PASS** | **仍 GAP** | 0 | CDP：`deletePhase=awaiting-confirm`→`cancelled`；`probe_meta completed=false`；cancelled 帧与 awaiting 差 72 万像素；**可证伪 Cancel-only（HTML JS 态）** | **GAP（拒升）** — Cancel 态未接到 `HostUiShell`/`DeleteAgentPhase` 运行时；`context_menu.png`≡`awaiting_confirm.png`（脚本 cp，无独立右键菜单帧） |

### 证据表（§3.3 字段）

| CM | evidence_cmd | artifact | assert 结果 | env |
|----|--------------|----------|-------------|-----|
| CM-1901 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1901` | `docs/qa/artifacts/cm-1901-settings-entry/`（`entry_*.png`+sha / `cdp_*.json` / `frames_meta.txt` / `isolation_meta.txt`） | **表面 assert 可过，C′ 不成立**：LiveDisplay@:99 真帧 + 三入口 CDP；但驱动面=静态 HTML，非 Live HostUiShell | 隔离 Xvfb :99 + box-chrome CDP 9333 + mktemp profile；USER_IANA=Asia/Shanghai；9223 未碰 |
| CM-1902 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1902` | `docs/qa/artifacts/cm-1902-settings-anchor/`（`theme/timezone/update-computer.png` + `cdp_unknown_anchor.json`） | **表面 assert 可过，C′ 不成立**：锚点可见 + 未知 id 不假成功；非 HostUiShell 深链消费 | 同上 |
| CM-1907 | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1907` | `docs/qa/artifacts/cm-1907-delete-agent/`（`awaiting_confirm.png` / `cancelled.png` + `cdp_*_delete.json`） | **表面 Cancel-only 可证伪，C′ 不成立**：phase 在 HTML `window.__bitbotHostUi`，非 `box_host` 状态机 | 同上；抛型 `h2-throwaway-agent` |

**禁止项核对**：未倒裁 U；未动 H0/H1 I-PASS；未升 0806；共享 9223 / chrome-profile / Cookie **未碰**；未以合成 PNG 冒充帧（帧本身真，表面属 B）。  
**计数**：I-PASS **6**（无待复核）；open GAP **35**（1901/1902/1907 仍 open）；U=234 不动。

---

## H1 复核·共享会话规则（Bit验证 · 2026-10-17 14:24 Asia/Shanghai）

> 项目负责人 Bitbot 新增**升 I 规则**（自本时起生效，并入 roadmap §3「升 I 最低条」执行口径）：
> **任何触碰用户共享已登录浏览器会话（CDP `127.0.0.1:9223` / `/home/box/chrome-profile`）或复制 Cookie/凭据的证据，一律不收为 I 证据。**
> U/kernel-contract **PASS=234** 不动；H0 不动；其他 CM 不动。

| ID | 原裁 | 复核后 | 原因 | 解除条件 |
|----|------|--------|------|----------|
| CM-0605 | I-PASS | **I-PASS（维持）** | 只读 `ffmpeg x11grab :1`；未连 CDP、未读 profile/Cookie、未 click | — |
| CM-0802 | I-PASS | **I-PASS 待复核**（→14:29 **I-PASS**） | 证据进程为用户共享会话 chrome（pid 86471，`--user-data-dir=/home/box/chrome-profile`，`--remote-debugging-port=9223`）；脚本 `find_box_chrome_pid` 回退探 9223 | MoonBit核 用**隔离临时 profile**（如 `mktemp -d`）+ **独立 CDP 端口**经 `/usr/local/bin/box-chrome` 重跑；全程不连 9223、不读写 `/home/box/chrome-profile`、不复制 Cookie；lockfile pid 对应该隔离进程且存活 |
| CM-2160 | I-PASS | **I-PASS 待复核**（→14:29 **I-PASS**） | 经 9223 `/json/new`、`/json/list` 操作/读取用户共享会话，并在用户 profile 中开 example.com 标签页 | 同上：隔离临时 profile + 独立端口重跑导航 `https://example.com`，以该隔离实例的 CDP 证实 url/title + 导航后真帧；不碰 9223/chrome-profile，不复制 Cookie |
| CM-0806 | GAP | **GAP（维持）** | 另注：现有 `cm-0806-session-jar/Cookies.before\|after` 为用户 profile Cookie 副本，**按新规则不收**（亦不计「部分证据」）；副本由 MoonBit核 处理，本轮不删 | 真 Update Computer 流程 + 不复制 Cookie 的合规证据 |

计数：I-PASS **6**（其中**待复核 2**：CM-0802 / CM-2160）；GAP **35**；未放回 GAP。→ **已被下方 14:29 复核结论解除待复核**。

## H1 复核结论·隔离重跑（Bit验证 · 2026-10-17 14:29 Asia/Shanghai）

> 对 CM-0802 / CM-2160 隔离重跑证据做独立复核。升 I 硬规则不变：触碰 CDP **9223** / `/home/box/chrome-profile` 或复制 Cookie/凭据的证据一律不收。U=234 / H0 / 0605 / 0806 不动。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `moon check` | 0 | `Finished. moon: no work to do` |
| `moon test` | 0 | **Total tests: 311, passed: 311, failed: 0** |
| `bash scripts/host_h1_smoke.sh cm-0802` | 0 | `pid=109805 refused=5/5 status=READY_FOR_I_REVIEW`（隔离） |
| `bash scripts/host_h1_smoke.sh cm-2160` | 0 | `method=cdp_put_json_new title=Example_Domain status=READY_FOR_I_REVIEW`（隔离） |

### 脚本审读（`scripts/host_h1_smoke.sh`）

- CM-0802 / CM-2160 经 `iso_start`：`mktemp -d /tmp/h1-iso-profile.XXXXXX` + 端口 **9333–9399**（永非 9223）+ 私有 Xvfb `:99+`；`SAND_COOKIE_SEED_PATH=/nonexistent`。
- CDP / 抓帧仅对 `ISO_PORT` / `ISO_DISPLAY`；`iso_stop` 只杀 argv 含临时目录的进程并 `rm -rf` 临时 profile。
- 全局 `CHROME_PROFILE_DIR`/`COOKIE_CANDIDATES` 仅 CM-0806 `find_cookie_jar` 使用；本轮未跑 0806。
- 默认 `all` 仍含 0605（只读 `:1`）与 0806；单跑 `cm-0802`/`cm-2160` 不碰 9223、不碰 `/home/box/chrome-profile`、不复制 Cookie。

### 共享会话未触碰（跑前→跑后）

| 探针 | 跑前 | 跑后 |
|------|------|------|
| CDP 9223 监听 | yes | yes |
| 共享 chrome pid 86471 | alive | alive |
| `/home/box/chrome-profile` mtime | 1792218370 (14:26:10) | **同** |
| Default/Cookies mtime | 1792217903 | **同** |
| Default/Login Data mtime | 1792213350 | **同** |
| CDP 9333（跑后） | — | **关闭** |
| artifacts 内 Cookies/Login Data 等 | — | **无**（sweep clean） |

### 裁决

| ID | 原裁 | 复核后 | 关键 assert |
|----|------|--------|--------------|
| CM-0802 | I-PASS 待复核 | **I-PASS** | lockfile pid=**109805**（≠86471）；profile=`/tmp/h1-iso-profile.evbJEp`（已删）；cdp=**9333**（已关）；DISPLAY=**:99**；`lineage=ok`（`--class=box-chrome` + `--sand-box-chrome-launcher` + port 9333）；`bare_refusal` **5/5** REFUSED、0 进程启动、marker 未写；cleanup `temp_dir_removed=yes` `shared_cdp_9223_listening=yes` |
| CM-2160 | I-PASS 待复核 | **I-PASS** | `nav_method=cdp_put_json_new` 对 **9333**；`PUT /json/new?https://example.com` → url=`https://example.com/` title=`Example Domain`；帧 1280×800、1008 色、sha=`a7018046…032c`、`frame_display=:99`（非 :1）；profile=`/tmp/h1-iso-profile.wP3A0l`（已删）；9333 已关；9223/86471 未触 |
| CM-0605 | I-PASS | **I-PASS（维持，未重跑）** | — |
| CM-0806 | GAP | **GAP（维持，不升）** | — |

计数：I-PASS **6**（**无待复核**）；open GAP **35**；U=234 不动。

---

## 升裁 H1 · host-integration I（Bit验证 · 2026-10-17 14:21 Asia/Shanghai）

> Wave H1 真屏/Desktop：仅处理 **CM-0605 / CM-0802 / CM-2160 / CM-0806**。U/kernel-contract **PASS=234** 不动；H0 I-PASS（0607/0608/2175）不动；其余 host-integration GAP 不动。
> 脚本审读：`scripts/host_h1_smoke.sh` 无 rm 配置/无杀用户浏览器；`kill` 仅在**同一进程内由本脚本启动的** chrome 上触发（单 CM 调用时不可达）。副作用：覆写 `/tmp/box-chrome.lock`；CM-2160 在 `:1` 主 box-chrome 中**新开** example.com 标签页（非破坏）。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `moon check` | 0 | `Finished. moon: no work to do` |
| `moon test` | 0 | **Total tests: 309, passed: 309, failed: 0**（对照自称 309/309 ✓） |
| `bash scripts/host_h1_smoke.sh cm-0605` ×2 | 0 / 0 | `bytes=83297` `status=READY_FOR_I_REVIEW`；两次 sha 均 `77633c82…dfd06`（桌面静止）；独立 ffmpeg 抓帧同 sha |
| `bash scripts/host_h1_smoke.sh cm-0802` | 0 | `pid=86471 status=READY_FOR_I_REVIEW` |
| `bash scripts/host_h1_smoke.sh cm-2160` | 0 | `url_seen=yes status=READY_FOR_I_REVIEW`（`cdp_navigate_rc=22` → box-chrome 带 URL 回退） |
| `bash scripts/host_h1_smoke.sh cm-0806` | 0 | `status=NEEDS_REVIEW`；`update_computer_ui=not_automated` |

### 裁决（U 仍 PASS）

| ID | U | host-integration | 说明 |
|----|---|------------------|------|
| CM-0605 | **PASS** | **GAP→I-PASS** | 真 `:1` x11grab 帧 1920×1200（= xdpyinfo）；1018 色、主色占比 0.913（非单色）；肉眼为真 Chrome 页面；sha 与文件一致；脚本无 xdotool/click/CDP Input → 未 click |
| CM-0802 | **PASS** | **GAP→I-PASS**（14:29 隔离复核通过，待复核已解除） | lockfile `pid=86471` 存活（`kill -0`）；cmdline `--class=box-chrome --user-data-dir=/home/box/chrome-profile --remote-debugging-port=9223`；同时刻启动 wrapper `box-bounded-log --run /tmp/chrome:1.log … DISPLAY=:1`；启动器 `/usr/local/bin/box-chrome` |
| CM-2160 | **PASS** | **GAP→I-PASS**（14:29 隔离复核通过，待复核已解除） | 真导航：CDP `/json/list` page 由 2→3 个 `https://example.com/`（title=`Example Domain`，已加载）；`curl https://example.com` → 200；导航后帧 1920×1200、1020 色，与 0605 帧差 15856 像素（新标签页） |
| CM-0806 | **PASS** | **仍 GAP** | 部分证据：jar 稳定性（**14:24 复核：Cookies 副本按新规则不收**）（Cookies sha 前后一致 `56b7c592…25f0`）；但 `lifecycle_step=existing_chrome_left_running_rehash_only`，**未**发生真 Update Computer → 代理证据，不足以升 I |

### 证据表

| CM | evidence_cmd | artifact | assert 结果 | env |
|----|--------------|----------|-------------|-----|
| CM-0605 | `bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0605` | `docs/qa/artifacts/cm-0605-screenshot/`（`live_display.png` / `.sha256` / `probe_meta.txt` / `display_meta.txt` / `ffmpeg.log`） | **成立**：`frame_origin=LiveDisplay` `display=:1` `png_magic=ok` `read_only=true` `clicked=false`；PIL size=(1920,1200)、unique_colors=1018、top1=0.913；sha256=`77633c82265bd9e151080a215ed28d8be1f413027fa0e600068ee7cec38dfd06` = 文件；X11 sock `/tmp/.X11-unix/X1` 存在；独立重抓像素全等 | box · DISPLAY=:1 (Xvfb 1920x1200) · Asia/Shanghai · hosted-anyrun |
| CM-0802 | `bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0802` | `docs/qa/artifacts/cm-0802-box-chrome/`（`box-chrome.lock` / `ps_box_chrome.txt` / `policy.txt` / `probe_meta.txt`） | **成立**：`^pid=[0-9]+` = 86471（非 `mock-box-chrome`）；进程存活；`lineage=ok`（`--class=box-chrome`）；`box_chrome_present=yes`。注：lockfile 由探针写入（内容已对照活进程核实）；「拒裸 Chrome」以 lineage 断言实现（无 box-chrome 标识 → `lineage=suspect`/NEEDS_REVIEW），未做负向启动测 | box · DISPLAY=:1 · CDP 127.0.0.1:9223 |
| CM-2160 | `bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-2160` | `docs/qa/artifacts/cm-2160-navigate/`（`post_navigate_frame.png` / `.sha256` / `cdp_list.json` / `nav_meta.txt` / `probe_meta.txt`） | **成立**：`url_seen_in_cdp=yes`；`png_magic=ok`；frame sha256=`4650de5b2b722ecd04274a60704f03292676dad5bff6cf5cb0484fc5240f545a` = 文件；HTTP 200。注：导航路径为 box-chrome URL 参数（CDP `/json/new` GET rc=22），CDP 仅用于校验 | box · DISPLAY=:1 · 公网出网 |
| CM-0806 | `bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0806` | `docs/qa/artifacts/cm-0806-session-jar/`（`jar_before.txt` / `jar_after.txt` / `probe_meta.txt`） | **不成立（I）；Cookies 副本证据按共享会话规则不收**：仅 `jar_intact_across_probe=yes`；`update_computer_ui_automated=false` → 保留 GAP | box · `/home/box/chrome-profile/Default/Cookies` |

**禁止项核对**：两帧均为真 x11grab，非占位魔数/非 HostAbi::mock；无 stub 冒充。未倒裁 U；未动 H0；未升其他 CM。
**隐私提示**（14:24 已升级为规则：复制 Cookie 证据不收）：`cm-0806-session-jar/Cookies.before|after` 为真实 Cookie DB 副本，建议勿入版本库/对外共享。

---

## 升裁 H0 · host-integration I（Bit验证 · 2026-10-17 14:13 Asia/Shanghai）

> Wave H0 探针绿线：仅升 **CM-0607 / CM-0608 / CM-2175**。U/kernel-contract **PASS=234** 不动；**CM-0605 及其他 host-integration 仍 GAP**，勿删。

### Q-SMOKE 实测

| 命令 | exit | 摘要 |
|------|------|------|
| `moon check` | 0 | `Finished. moon: no work to do` |
| `moon test` | 0 | **Total tests: 303, passed: 303, failed: 0**（对照自称 303/303 ✓） |
| `bash scripts/host_h0_smoke.sh cm-0607` | 0 | 真 `/usr/local/bin/box-doctor`；artifacts + `/tmp/box-doctor-h0.log` |
| `bash scripts/host_h0_smoke.sh cm-0608` | 0 | `runtime=hosted-anyrun`；equiv=`/proc/1/cgroup(container-or-pod)` |
| `bash scripts/host_h0_smoke.sh cm-2175` | 0 | `TZ=Asia/Shanghai date` → `CST` / `+08:00` |

### 裁决（U 仍 PASS；host-integration GAP→I-PASS）

| ID | U | host-integration | 说明 |
|----|---|------------------|------|
| CM-0607 | **PASS** | **GAP→I-PASS** | 真 box-doctor 11 checks / 0 failed；parsable `PASS overall`；非 mock FS |
| CM-0608 | **PASS** | **GAP→I-PASS** | 真读 `/proc/1/cgroup`（`pod-…`）+ hostname `grok-bot-vm-*` → **hosted-anyrun**（无 `/.dockerenv`，等价探针成立） |
| CM-2175 | **PASS** | **GAP→I-PASS** | 真 `TZ=Asia/Shanghai date` → `Sat Oct 17 14:13:44 CST 2026` + `+08:00` |
| CM-0605 及其他 | **PASS**(U) | **仍 GAP** | 本波未升；勿删 GAP 行 |

### 证据表

| CM | evidence_cmd | artifact | assert 结果 | env |
|----|--------------|----------|-------------|-----|
| CM-0607 | `bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-0607` | `docs/qa/artifacts/cm-0607-box-doctor/`（`box-doctor.stdout.txt` / `box-doctor.parsable.log` / `/tmp/box-doctor-h0.log`） | **成立**：`SUMMARY: 11 checks, 0 failed`；`PASS box-doctor-bin` / `PASS overall`；doctor_bin=`/usr/local/bin/box-doctor` | box · USER_IANA=Asia/Shanghai · hosted-anyrun |
| CM-0608 | `bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-0608` | `docs/qa/artifacts/cm-0608-env-detect/`（`env_diagnostic.txt` / `cgroup_snip.txt` / `hostname.txt`） | **成立**：cgroup=`0::/system.slice/pod-…`；`dockerenv_present=equiv`；`runtime=hosted-anyrun` | box · hostname=grok-bot-vm-2186801 |
| CM-2175 | `bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-2175` | `docs/qa/artifacts/cm-2175-box-clock/`（`date.txt` / `date_output.txt`） | **成立**：含 **CST** 与 **+08:00**；IANA=Asia/Shanghai | box · TZ=Asia/Shanghai |

**禁止项核对**：artifacts 抽样无占位 PNG / stub / mock FS 冒充 I（evidence note 仅声明 *not* HostAbi::mock）。脚本 exit 全 0；未倒裁 U；未升其他 CM。

---

## A/B/C 重裁（Bit验证）

| 批 | ID | 裁决 | 证据类型 | 证据（新测名） |
|----|----|------|----------|----------------|
| A | CM-0105 | **PASS** | U | `ui_protocol/acceptance_p0_test.mbt`::acceptance_CM-0105_widget_card_and_choice_user_message — Wi... |
| A | CM-0106 | **PASS** | U | `ui_protocol/acceptance_p0_test.mbt`::acceptance_CM-0106_mock_fs_exists_ok_hallucinated_rejected ... |
| A | CM-0111 | **PASS** | U | `ui_protocol/acceptance_p0_test.mbt`::acceptance_CM-0111_reject_unknown_deeplink_and_bare_url — 裸... |
| A | CM-0305 | **PASS** | U | `memory/acceptance_memory_test.mbt`::acceptance_CM-0305_unsupported_scope_classification — 错 scop... |
| A | CM-0306 | **PASS** | U | `security/acceptance_sec_test.mbt`::acceptance_CM-0306_kefa_memory_blocks_external_send_effect — ... |
| A | CM-1501 | **PASS** | U | `security/acceptance_sec_test.mbt`::acceptance_CM-1501_no_explicit_request_draft_only — 无明示→Draft... |
| A | CM-1504 | **PASS** | U | `security/acceptance_sec_test.mbt`::acceptance_CM-1504_fence_qingfasong_no_external_send_effect —... |
| B | CM-0402 | **PASS** | U | `routines/acceptance_cron_tz_test.mbt`::acceptance_CM-0402_iana_timezone_and_CRON_TZ_override — 用... |
| B | CM-0602 | **PASS** | U | `box_host/host_abi_test.mbt`::acceptance_CM-0602_image_read_inline_visible (+acceptance_cm0602_re... |
| B | CM-0605 | **PASS** | U | **kernel-contract PASS** `box_host/host_abi_test.mbt`::acceptance_CM-0605_screenshot_frame_evidence (has_frame/read_only/未 click)；**host-integration GAP**（真实 :1 画面属 Host FFI/I，WASM 单测不可达） |
| C | CM-1006 | **PASS** | U | `connectors/mail/acceptance_send_on_behalf_test.mbt`::acceptance_CM-1006_send_on_behalf_pick_acco... |
| C | CM-0801 | **PASS** | U | `agents/computer_use/acceptance_cm0801_test.mbt`::acceptance_CM-0801_named_bypass_rejected — ViaShell 拒 xdotool/Playwright/CDP；ViaComputerUse 允许。覆盖验收。 |
| C | CM-0803 | **PASS** | U | `agents/computer_use/acceptance_cm0803_test.mbt`::acceptance_CM-0803_signin_secret_no_plaintext — SecretRequest/UserForm 无明文密码；ChatPlain 拒。覆盖验收。 |
| C | CM-1701 | **PASS** | U | `tools/acceptance_web_test.mbt`::acceptance_CM-1701_summary_url_current_year — snippet+URL；normalize 注入当前年。覆盖验收。 |
| C | CM-1702 | **PASS** | U | `tools/acceptance_web_test.mbt`::acceptance_CM-1702_auth_page_fails_clearly (+web_fetch) — 200 正文；/login→401/auth 明确失败。覆盖验收。 |

A：7/7 PASS（新测名）。B：3/3 PASS（0605=kernel-contract；host-integration 另 GAP）。C：1/5 PASS。
全量见下表；**P0 矩阵收口 117/117 PASS**（kernel-contract；真屏 host-integration 仍 GAP 跟踪，不阻塞 P0 收口）。

## 裁决计数

| 裁决 | 全量 | 其中 P0 |
|------|------|--------|
| PASS | 234 | 119 |
| FAIL | 0 | 0 |
| GAP | 0 | 0 |
| BLOCKED | 0 | 0 |


## CM-0605 拍板（Bit验证 · 2026-10-17 11:39 Asia/Shanghai）

**选 A**（与 ADR Host/WASM 边界一致）：

| 切片 | 裁决 | 证据 |
|------|------|------|
| **CM-0605 kernel-contract** | **PASS** (U) | `box_host/host_abi_test.mbt`::acceptance_CM-0605_screenshot_frame_evidence — PNG 帧写入 `/workspace`、`ScreenshotResult.has_frame`、`read_only`、`clicked=false`、`ImageContent.visible` |
| **CM-0605 host-integration** | **GAP** | 真实 `:1` 画面 / Host FFI 不在 WASM 内核单测可达范围；待 Host 集成验收（I）另开证据，不阻塞内核契约 PASS |

矩阵主行 **CM-0605** 记为 **PASS**（口径=kernel-contract）。host-integration 在 gaps 跟踪为 **GAP**，升 I 前不得删 GAP。

拒绝 B（整项挂到真 Host FFI）——会把可达的内核契约长期锁死在 FAIL。


## 升裁 CM-0404 / 0902 / 1004（Bit验证 · 2026-10-17 11:40 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-0404 | **PASS** | U | `routines/acceptance_cron_extra_test.mbt`::acceptance_CM-0404_exception_requires_explicit / acceptance_CM-0404_explicit_exception_required — 例外需明示；有界 cron |
| CM-0902 | **PASS** | U | `tools/acceptance_cm0902_schema_test.mbt`::acceptance_CM-0902_schema_required_and_write_to_file + dynamic_test schema_positive — schema 正向/缺必填；write_to_file 落盘 |
| CM-1004 | **PASS** | U | `connectors/mail/acceptance_cm1004_attach_test.mbt`::acceptance_CM-1004_thread_attachment_openable — thread_id 自搜索；附件可开 |

三件由 FAIL→**PASS**。Q-SMOKE 实测见下节（期望 92 绿）。0801/0803/1701/1702 仍 FAIL。












## 升裁 BB 批 CM-2110/2117/2149/2151/2153/2157（Bit验证 · 2026-10-17 14:08 Asia/Shanghai）

| ID | 裁决 | 类 | 优先级 | 证据（新测名） |
|----|------|----|--------|----------------|
| CM-2110 | **PASS** | U | P2 | `skills/acceptance_cm2110_test.mbt`::acceptance_CM-2110_slides_executor_skill_distinct_from_slides — slides-executor≠slides（名/路径/SKILL 体）；任务前须 Read SKILL；未读拒跑 |
| CM-2117 | **PASS** | U | P2 | `ui_protocol/acceptance_cm2117_test.mbt`::acceptance_CM-2117_product_recommend_line_format_with_link_price — 固定 `- [name](url) — price`；多商品一行一条；空表/坏链拒 |
| CM-2149 | **PASS** | U | P2 | `agents/teammates/acceptance_cm2149_test.mbt`::acceptance_CM-2149_cross_agent_complaint_diplomatic_paraphrase — 抱怨外交转述；SendToAgent 无 awful/stupid；CM-2141 ask-first 仍绿 |
| CM-2151 | **PASS** | U | P2 | `memory/acceptance_cm2151_test.mbt`::acceptance_CM-2151_set_user_attribute_job_persists — SetUserAttribute(job) 持久；跨 session 可读回；空 key/value 拒 |
| CM-2153 | **PASS** | U | P2 | `skills/acceptance_cm2153_test.mbt`::acceptance_CM-2153_live_meeting_chat_send_exception — live+skill 允许→DirectSend 非草稿卡；非 live / skill 不允许→DraftCard |
| CM-2157 | **PASS** | U | P2 | **kernel-contract** `tools/media/acceptance_cm2157_test.mbt`::acceptance_CM-2157_structured_chart_file_deliverable — StructuredChart→`/workspace` 落盘+deliverable AttachmentRef；**host-integration GAP**（真图渲染/编码属 Host/I） |

六项 P2 FAIL→**PASS**（2157 仿 M–AA：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **296/296**（Total tests: 296, passed: 296, failed: 0）；BB 相关包单独复测全绿（skills+ui_protocol+teammates+memory+channels+tools/media 合计 94）。**P2 FAIL 收口 / 裁决 PASS=234 FAIL=0**（host-integration GAP 跟踪另列，索引主裁决 GAP=0）。P0 收口句不动（仍 117/117）。勿改 AA/Z/Y/X/W/V/U/T/S/R/Q/P/O/N/M 已 PASS。

## 升裁 AA 批 CM-1602/1803/1804/1805/1806/1808/2106/2109（Bit验证 · 2026-10-17 14:03 Asia/Shanghai）

| ID | 裁决 | 类 | 优先级 | 证据（新测名） |
|----|------|----|--------|----------------|
| CM-1602 | **PASS** | U | P2 | **kernel-contract** `tools/media/acceptance_cm1602_test.mbt`::acceptance_CM-1602_generate_video_queue_and_notify — enqueue→Queued；complete→Completed+notifiable；空 prompt 拒；**host-integration GAP**（真文生视频/编码属 Host/I） |
| CM-1803 | **PASS** | U | P2 | `skills/acceptance_cm1803_test.mbt`::acceptance_CM-1803_shopping_retail_playbooks_dispatch — Target/BestBuy/Costco dispatch 可用；Resy 非零售拒 |
| CM-1804 | **PASS** | U | P2 | `skills/acceptance_cm1804_test.mbt`::acceptance_CM-1804_flight_accommodation_rideshare_skill_hit — flight/accommodation/rideshare SKILL 触发命中；非旅行语拒 |
| CM-1805 | **PASS** | U | P2 | `skills/acceptance_cm1805_test.mbt`::acceptance_CM-1805_food_ordering_restaurant_playbooks — Resy/OpenTable/DoorDash playbooks dispatch；Target 非点餐拒 |
| CM-1806 | **PASS** | U | P2 | `skills/acceptance_cm1806_test.mbt`::acceptance_CM-1806_job_search_linkedin_readonly_flow — LinkedIn 只读搜索可跑通；apply/message 拒 |
| CM-1808 | **PASS** | U | P2 | `skills/acceptance_cm1808_test.mbt`::acceptance_CM-1808_learn_from_demonstration_skill_draft — 演示沉淀为 SKILL.md 草稿；空 steps 拒；validate_skill_md 过 |
| CM-2106 | **PASS** | U | P2 | `routines/acceptance_cm2106_test.mbt`::acceptance_CM-2106_trigger_microsoft_teams_wakes_routine — 匹配 Teams 事件唤醒例程；跨租户/kind 不醒；registry deliver |
| CM-2109 | **PASS** | U | P2 | **kernel-contract** `connectors/acceptance_cm2109_test.mbt`::acceptance_CM-2109_user_finance_connector_needs_auth — NeedsAuth 不可调；authenticate→Ready 可用；stub 工具；**host-integration GAP**（真 OAuth 属 Host/I；工具全集 TBD） |

八项 P2 FAIL→**PASS**（1602/2109 仿 M–Z：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **290/290**（Total tests: 290, passed: 290, failed: 0）；AA 相关包单独复测全绿（tools/media 2、skills 24、routines 26、connectors 27）。P0 收口句不动（仍 117/117）。勿改 Z/Y/X/W/V/U/T/S/R/Q/P/O/N/M 已 PASS。

## 升裁 Z 批 CM-0206/0907/0910/1009/1107/1403/1405/1406（Bit验证 · 2026-10-17 13:58 Asia/Shanghai）

| ID | 裁决 | 类 | 优先级 | 证据（新测名） |
|----|------|----|--------|----------------|
| CM-0206 | **PASS** | U | P2 | **kernel-contract** `ui_protocol/acceptance_cm0206_test.mbt`::acceptance_CM-0206_per_assistant_notification_settings — 助手级 desktop/sound/mentions_only 开关隔离；profile entries；**host-integration GAP**（真 Host UI 属 I） |
| CM-0907 | **PASS** | U | P2 | `connectors/acceptance_cm0907_test.mbt`::acceptance_CM-0907_x_twitter_mcp_surface_dynamic_tools — user-X GetDynamicTools 列出 posts/bookmarks/chat；鉴权后读路径可测 |
| CM-0910 | **PASS** | U | P2 | `connectors/acceptance_cm0910_test.mbt`::acceptance_CM-0910_public_x_search_namespace_readonly — 命名空间 `x` 无鉴权；search_posts 等只读；写工具拒 |
| CM-1009 | **PASS** | U | P2 | `connectors/mail/acceptance_cm1009_test.mbt`::acceptance_CM-1009_unsolicited_mail_unsubscribe_reject_multi — 冷邮单收件人+退订 Allowed；多收件人/缺退订 Rejected；卡发送拒冷触达 |
| CM-1107 | **PASS** | U | P2 | `channels/acceptance_cm1107_test.mbt`::acceptance_CM-1107_microsoft_teams_channel_scope — tenant/team 作用域；跨租户出站拒；routine trigger 匹配 |
| CM-1403 | **PASS** | U | P2 | `agents/teammates/acceptance_cm1403_test.mbt`::acceptance_CM-1403_teammate_sections_message_isolation — 分区 post/list 隔离；未知分区拒 |
| CM-1405 | **PASS** | U | P2 | **kernel-contract** `agents/teammates/acceptance_cm1405_test.mbt`::acceptance_CM-1405_members_panel_matches_app_ui — Members anchor=app-ui；info panel has_members；**host-integration GAP**（真 Host UI 属 I） |
| CM-1406 | **PASS** | U | P2 | `skills/acceptance_cm1406_test.mbt`::acceptance_CM-1406_export_bot_template_no_secrets — shareable-template；manifest 无 secrets；拒 team-copy |

八项 P2 FAIL→**PASS**（0206/1405 仿 M–Y：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **282/282**（Total tests: 282, passed: 282, failed: 0）；Z 相关包单独复测全绿（ui_protocol 31、connectors 26、connectors/mail 16、channels 13、agents/teammates 7、skills 19）。P0 收口句不动（仍 117/117）。勿改 Y/X/W/V/U/T/S/R/Q/P/O/N/M 已 PASS。

## 升裁 Y 批 CM-2163/2164/2174/2175/0409/0506/0608/0705（Bit验证 · 2026-10-17 13:52 Asia/Shanghai）

| ID | 裁决 | 类 | 优先级 | 证据（新测名） |
|----|------|----|--------|----------------|
| CM-2163 | **PASS** | U | P1 | **kernel-contract** `tools/acceptance_cm2163_2164_test.mbt`::acceptance_CM-2163_mcp_file_arg_expand_no_chat_bloat — `$file:` 从 Host FS 注入；chat 仅 ref、无 LARGE_PAYLOAD；plain 拒；**host-integration GAP**（真 Host FFI/MCP 属 I） |
| CM-2164 | **PASS** | U | P1 | **kernel-contract** `tools/acceptance_cm2163_2164_test.mbt`::acceptance_CM-2164_mcp_write_to_file_returns_path — 大结果落 `/workspace/agent-tools/`；返回路径不含 body；chat 无 PAYLOAD；**host-integration GAP**（真写盘/MCP 属 I） |
| CM-2174 | **PASS** | U | P1 | **kernel-contract** `box_host/acceptance_cm2174_test.mbt`::acceptance_CM-2174_cross_agent_shared_box_fs_charter — shared_fs+distinct_desktops；A 见 B 写；异 HostAbi mock 不串盘；**host-integration GAP**（真跨代理同 box 属 Host/I） |
| CM-2175 | **PASS** | U | P1 | **kernel-contract** `box_host/acceptance_cm2175_test.mbt`::acceptance_CM-2175_box_clock_aligns_user_timezone — Asia/Shanghai/CST；aligns；错区 Err；effects `date:`；**host-integration GAP**（真 `date` 属 Host/I） |
| CM-0409 | **PASS** | U | P2 | `routines/acceptance_cm0409_test.mbt`::acceptance_CM-0409_event_trigger_teams_linear_sentry_pagerduty — Teams/Linear/Sentry/PagerDuty 形状 Ready；空 event_kind Invalid；未连接→ShowAutoCard |
| CM-0506 | **PASS** | U | P2 | `skills/acceptance_cm0506_test.mbt`::acceptance_CM-0506_skill_authoring_produces_valid_skill_md — meta+produce 合规 frontmatter；空 name/desc 拒；无 frontmatter 拒 |
| CM-0608 | **PASS** | U | P2 | **kernel-contract** `box_host/acceptance_cm0608_test.mbt`::acceptance_CM-0608_docker_vs_anyrun_env_detect — local-docker/hosted-anyrun/bare 诊断正确；HostAbi 记 effect；**host-integration GAP**（真 `/.dockerenv` 探测属 Host/I） |
| CM-0705 | **PASS** | U | P2 | **kernel-contract** `box_host/acceptance_cm0705_test.mbt`::acceptance_CM-0705_device_local_tools_needs_permission_card — 桌面无工具；iOS needs_permission→审批卡；ready Ok；denied 无卡；**host-integration GAP**（真手机 OS 权限属 Host/I） |

八项（4×P1 GAP→PASS + 4×P2 FAIL→PASS；Host/MCP/真设备仿 M–X：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **274/274**（Total tests: 274, passed: 274, failed: 0）；Y 相关包单独复测全绿（tools 18、box_host 24、routines 25、skills 18）。P0 收口句不动（仍 117/117）。勿改 X/W/V/U/T/S/R/Q/P/O/N/M 已 PASS。

## 升裁 X 批 CM-2167/2168/2172/2173/2178（Bit验证 · 2026-10-17 13:43 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-2167 | **PASS** | U | `skills/acceptance_cm2167_test.mbt`::acceptance_CM-2167_skill_ref_stable_id_source_path — SkillRef id+source+path；managed/user/plugin 稳定；is_stable |
| CM-2168 | **PASS** | U | `channels/acceptance_cm2168_test.mbt`::acceptance_CM-2168_channel_speak_as_user_not_third_person — SpeakAsUser 通过；第三人称/handle/display 拒 |
| CM-2172 | **PASS** | U | `security/acceptance_cm2172_test.mbt`::acceptance_CM-2172_teammate_outbound_permission_gate_reuse — 无授权→DraftOnly 闸门复用；bypass→UnauthorizedBypass；明示仍经 ApprovalGate 非 auto-Allow |
| CM-2173 | **PASS** | U | `stores/acceptance_cm2173_test.mbt`::acceptance_CM-2173_store_read_write_via_ordinary_file_tools — 普通 Read/Write；未授权/非 store path 拒；与 StoreMountTable 对齐 |
| CM-2178 | **PASS** | U | **kernel-contract** `ui_protocol/acceptance_cm2178_test.mbt`::acceptance_CM-2178_missing_permission_guide_settings_not_pretend — guide→Settings deeplink；pretends_connected=false；假装已连接拒；HostSettingsUiMock；**host-integration GAP**（真 Settings 页属 Host/I） |

五项 FAIL→**PASS**（2178 仿 M–W：kernel-contract PASS + host-integration GAP）。本批未交 **2163/2164/2174/2175** 仍 GAP/未标 PASS。Q-SMOKE 开裁实测 **266/266**（Total tests: 266, passed: 266, failed: 0）；X 相关包单独复测全绿（skills 17、channels 12、security 29、stores 4、ui_protocol 30）。P0 收口句不动（仍 117/117）。勿改 W/V/U/T/S/R/Q/P/O/N/M 已 PASS。

## 升裁 W 批 CM-2148/2150/2155/2156/2158/2161/2165/2166（Bit验证 · 2026-10-17 13:38 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-2148 | **PASS** | U | `agents/cloud/acceptance_cm2148_test.mbt`::acceptance_CM-2148_cloud_artifact_path_no_opt_cursor_direct — 禁 /opt/cursor/artifacts 直附；无 URL→Err；官方 URL 或 workspace `/workspace/cloud-agent-artifacts/<bc>/…` 投递 |
| CM-2150 | **PASS** | U | `runtime/acceptance_cm2150_test.mbt`::acceptance_CM-2150_read_transcript_includes_tool_calls — Own/Child/OtherAssistant ReadTranscript 含 ToolCall；text-only audit Err |
| CM-2155 | **PASS** | U | `routines/acceptance_cm2155_test.mbt`::acceptance_CM-2155_origin_trigger_event_subset_only — 仅 pr-opened/pushed/merged/comment；ci/review/issue-opened/workflow_run 拒 |
| CM-2156 | **PASS** | U | `runtime/acceptance_cm2156_test.mbt`::acceptance_CM-2156_short_concrete_style_guide_sampleable — sample_style_guide_check 可测；empty/fluff/vague/too_long 拒；docs/style-guide-short-concrete.md |
| CM-2158 | **PASS** | U | **kernel-contract** `box_host/acceptance_cm2158_test.mbt`::acceptance_CM-2158_box_package_install_via_shell — apt/npm 经 Shell；拒 non-Shell；HostAbi mock effects 含 shell:；**host-integration GAP**（真 apt/npm 安装属 Host/I） |
| CM-2161 | **PASS** | U | `agents/task/acceptance_cm2161_test.mbt`::acceptance_CM-2161_parallel_multi_subagent_handles_running — 同 turn ≥2 handle 均 Running；单 prompt Err |
| CM-2165 | **PASS** | U | `routines/acceptance_cm2165_test.mbt`::acceptance_CM-2165_routine_silent_ok_no_send_to_user — silent_ok+quiet→StaySilent；always_notify 仍投递 |
| CM-2166 | **PASS** | U | `routines/acceptance_cm2166_test.mbt`::acceptance_CM-2166_routine_break_silence_when_notable — failure/approval/decision/notable→SendToUser；quiet 不可 assert break |

八项 FAIL→**PASS**（2158 仿 M–V：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **261/261**（Total tests: 261, passed: 261, failed: 0）；W 相关包单独复测全绿（agents/cloud+runtime+routines+box_host+agents/task 合计 106）。P0 收口句不动（仍 117/117）。勿改 V/U/T/S/R/Q/P/O/N/M 已 PASS。

## 升裁 V 批 CM-2131/2132/2135/2136/2141/2144/2145/2146（Bit验证 · 2026-10-17 13:33 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-2131 | **PASS** | U | **kernel-contract** `ui_protocol/acceptance_cm2131_test.mbt`::acceptance_CM-2131_cursor_agent_card_opens_cloud — type=cursor-agent+bcId；can_open_cloud；open_cloud→cursor.com/agents/<bcId>；空 bcId Err；**host-integration GAP**（真卡打开属 Host/I） |
| CM-2132 | **PASS** | U | `connectors/acceptance_cm2132_test.mbt`::acceptance_CM-2132_x_public_rate_limit_window — ns=x；30/min·1000/day UTC；超额 Refused+remaining；新 UTC 日重置 |
| CM-2135 | **PASS** | U | `skills/acceptance_cm2135_test.mbt`::acceptance_CM-2135_user_private_workflows_not_kernel_must_deliver — WeChat 运行时可见；NativeMustDeliverP0 不含；try_write_user_workflow_as_native 拒；≠CM-2118 |
| CM-2136 | **PASS** | U | `agents/task/acceptance_cm2136_test.mbt`::acceptance_CM-2136_task_resume_preserves_context — resume=id→Running；prompt/prior_summary/inbox 保留；可再 complete；未知 id Err |
| CM-2141 | **PASS** | U | `agents/teammates/acceptance_cm2141_test.mbt`::acceptance_CM-2141_send_to_agent_fanout_ask_first — 未明示多目标→MustAskUserFirst 且不投递；明示→扇出 3；单收件人不强制先问 |
| CM-2144 | **PASS** | U | `security/acceptance_cm2144_test.mbt`::acceptance_CM-2144_standing_permission_revoke_immediate — grant 可直发；revoke 后 is_active=false；下一封 NeedReconfirm |
| CM-2145 | **PASS** | U | `memory/acceptance_cm2145_test.mbt`::acceptance_CM-2145_memory_api_authoritative_not_box_file — MemoryApi 写 profile 权威；BoxOrdinaryFile 拒；盒写不覆盖 recall |
| CM-2146 | **PASS** | U | **kernel-contract** `connectors/acceptance_cm2146_test.mbt`::acceptance_CM-2146_connector_app_vs_user_identity_browser — App+UserRequired→SwitchToSignedInBrowser；UserBrowser 可 Proceed；AppSufficient 不切；**host-integration GAP**（真浏览器会话属 Host/I） |

八项 FAIL→**PASS**（2131/2146 仿 M–U：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **253/253**（Total tests: 253, passed: 253, failed: 0）；V 相关包单独复测全绿（ui_protocol/connectors/skills/agents/task/teammates/security/memory 合计 122）。P0 收口句不动（仍 117/117）。勿改 U/T/S/R/Q/P/O/N/M 已 PASS。

## 升裁 U 批 CM-2108/2111/2116/2118/2119/2120/2125/2128（Bit验证 · 2026-10-17 13:26 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-2108 | **PASS** | U | `connectors/acceptance_cm2108_test.mbt`::acceptance_CM-2108_get_plugin_metadata_and_skills — get_plugin 返回 id+skills（≥1）；未知插件 Err(unknown) |
| CM-2111 | **PASS** | U | `skills/acceptance_cm2111_test.mbt`::acceptance_CM-2111_site_playbooks_catalog_loader_map — family=22；enum_matches_loader；Airbnb/Expedia/Doordash 单站可映射 |
| CM-2116 | **PASS** | U | `security/acceptance_cm2116_2125_test.mbt`::acceptance_CM-2116_copyright_policy_summarize_not_verbatim — Refuse(Copyright)+ABSTRACT_FIXTURE 摘要；无 SUBSTANTIAL_COPYRIGHTED_CHUNK |
| CM-2118 | **PASS** | U | `skills/acceptance_cm2118_test.mbt`::acceptance_CM-2118_user_workflows_visible_not_matrix_contract — 运行时可见 aihot-scout 等；MatrixMustDeliverContract 不含用户私有 workflows；NG003 |
| CM-2119 | **PASS** | U | `stores/acceptance_cm2119_test.mbt`::acceptance_CM-2119_store_authorized_mount_unauthorized_absent — 未授权 path absent；authorize 后 `/cursor/stores/<id>` 可读 |
| CM-2120 | **PASS** | U | **kernel-contract** `connectors/mail/acceptance_cm2120_test.mbt`::acceptance_CM-2120_outlook_connector_auth_then_draft_send — NeedsAuth 拒 draft/send；mock authenticate→Ready 后 draft+send；**host-integration GAP**（真 OAuth 属 Host/I） |
| CM-2125 | **PASS** | U | `security/acceptance_cm2116_2125_test.mbt`::acceptance_CM-2125_copyright_chapter_verbatim_refuse_summary — chapter 请求 refuse_verbatim∧is_chapter_request；摘要替代；与 2116 章标志可区分 |
| CM-2128 | **PASS** | U | **kernel-contract** `ui_protocol/acceptance_cm2128_test.mbt`::acceptance_CM-2128_react_outbound_end_turn_pill_no_body — thank-you→React end_turn；pill 可见；body 可省略；**host-integration GAP**（真 pill 像素属 Host/I） |

八项 FAIL→**PASS**（2120/2128 仿 M–T：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **245/245**（Total tests: 245, passed: 245, failed: 0）；U 相关包单独复测全绿（connectors 21、skills 15、security 27、stores 3、mail 15、ui_protocol 28）。P0 收口句不动（仍 117/117）。勿改 T/S/R/Q/P/O/N/M 已 PASS。

## 升裁 T 批 CM-2005/2006/2101/2102/2103/2104/2105/2107（Bit验证 · 2026-10-17 13:20 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-2005 | **PASS** | U | `skills/acceptance_cm2005_test.mbt`::acceptance_CM-2005_voice_call_relay_summary_on_end — voice:call 仅回 voice 地址；非 voice/省略拒；relay 文本；end→voice-calls/*.json+app_summary；结束后拒 voice 回 |
| CM-2006 | **PASS** | U | `connectors/mail/acceptance_cm2006_test.mbt`::acceptance_CM-2006_claim_inbox_ask_local_part_no_default — 无 inbox→AskLocalPart；suggested_default=None；无选定 claim 拒；rnd-auto 拒；选定+确认后 claim |
| CM-2101 | **PASS** | U | **kernel-contract** `ui_protocol/acceptance_cm2101_test.mbt`::acceptance_CM-2101_react_to_message_pill_toggle — react→pill visible/active；同 emoji toggle 取消；换 emoji 再可见；**host-integration GAP**（真消息 pill 像素属 Host/I） |
| CM-2102 | **PASS** | U | `ui_protocol/acceptance_cm2102_test.mbt`::acceptance_CM-2102_widget_multiselect_danger_dismiss — multiSelect；danger 样式；dismissOnMoveOn；as_multiselect_lines 每行一值（非逗号拼接） |
| CM-2103 | **PASS** | U | **kernel-contract** `ui_protocol/acceptance_cm2103_test.mbt`::acceptance_CM-2103_markdown_math_and_mermaid — \( \)/$$ + ```mermaid 解析；unclosed Err；**host-integration GAP**（真公式/图画渲染属 Host/I） |
| CM-2104 | **PASS** | U | `runtime/acceptance_cm2104_test.mbt`::acceptance_CM-2104_parallel_readonly_tools_same_turn — WebSearch+Read 同回合一并行批；双 WebSearch 可并行；Shell 拒并行；classify ReadOnly/Mutating |
| CM-2105 | **PASS** | U | `routines/acceptance_cm2105_test.mbt`::acceptance_CM-2105_flexible_cron_early_late_window — early=15/late=20 边界内落窗；±越界拒；plan_daily_at_hour flexible ±15 |
| CM-2107 | **PASS** | U | `connectors/acceptance_cm2107_test.mbt`::acceptance_CM-2107_uninstall_plugin_namespace_gone — install→ns Ready+catalog；uninstall→Unavailable；remove_namespace 后 discover 空 |

八项 FAIL→**PASS**（2101/2103 仿 M–S：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **237/237**（Total tests: 237, passed: 237, failed: 0）；T 相关包单独复测全绿（skills/mail/ui_protocol/runtime/routines/connectors 合计 119）。P0 收口句不动（仍 117/117）。勿改 S/R/Q/P/O/N/M 已 PASS。

## 升裁 S 批 CM-1601/1603/1703/1801/1807/1809/1810/2004（Bit验证 · 2026-10-17 12:58 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-1601 | **PASS** | U | **kernel-contract** `tools/media/acceptance_cm1601_test.mbt`::acceptance_CM-1601_generate_image_artifact_deliverable — GenerateImage→/workspace 落盘+mime；deliver_generated_image→AttachmentRef.validate；空 prompt Err；**host-integration GAP**（真扩散/Host 出图属 Host/I） |
| CM-1603 | **PASS** | U | **kernel-contract** `agents/task/acceptance_cm1603_test.mbt`::acceptance_CM-1603_watch_video_answer_from_frames — extract frames→answer grounded in frames；parent summary=answer；空 path Err；**host-integration GAP**（真视频解码属 Host/I） |
| CM-1703 | **PASS** | U | **kernel-contract** `tools/acceptance_cm1703_test.mbt`::acceptance_CM-1703_fetch_fail_public_fallback_no_cred_bypass — 403→browser/curl 公共回退；credential_bypass=false；/login 401 禁回退；**host-integration GAP**（真浏览器/curl 出网属 Host/I） |
| CM-1801 | **PASS** | U | `skills/acceptance_cm1801_test.mbt`::acceptance_CM-1801_scheduling_no_connector_fallback — Ready→ConnectorOk；Unavailable/NeedsAuth/NeedsGrant/Loading→Fallback(degrade∧¬hard_fail)+no-connector-fallback/browser；空 title Invalid |
| CM-1807 | **PASS** | U | **kernel-contract** `skills/acceptance_cm1807_test.mbt`::acceptance_CM-1807_slides_pptx_openable — generate_pptx→/workspace/*.pptx；magic PK；openable；空 title Err；**host-integration GAP**（真 PPTX 打开属 Host/I） |
| CM-1809 | **PASS** | U | `skills/acceptance_cm1809_test.mbt`::acceptance_CM-1809_no_connector_fallback_path_not_hard_fail — usable→UseConnector；否则 BrowserDegrade/CurlDegrade；plan_without_connector 非 hard-fail |
| CM-1810 | **PASS** | U | `skills/acceptance_cm1810_test.mbt`::acceptance_CM-1810_code_changes_with_source_control — NativeOrigin→cursor-origin+trigger；GithubMirror 拒 origin trigger；machine 无明示 Err；箱外 path Err |
| CM-2004 | **PASS** | U | `agents/teammates/acceptance_cm2004_test.mbt`::acceptance_CM-2004_room_cue_triggers_group_chat_discipline — [room] cue→group-chat-turns；forbids_private_assumptions；无私假设；无 cue 不触发 |

八项 FAIL→**PASS**（1601/1603/1703/1807 仿 M–R：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **229/229**（Total tests: 229, passed: 229, failed: 0）；S 相关包单独复测全绿（tools/media 1、agents/task 9、tools 40、skills 12、agents/teammates 4）。P0 收口句不动（仍 117/117）。勿改 R/Q/P/O/N/M 已 PASS。

## 升裁 R 批 CM-1205/1303/1305/1306/1401/1402/1404/1507（Bit验证 · 2026-10-17 12:51 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-1205 | **PASS** | U | `agents/task/acceptance_cm1205_test.mbt`::acceptance_CM-1205_message_subagent_arrives_status_queryable — message 入 inbox；check/query_status 可查；终态拒 message；空 body Err |
| CM-1303 | **PASS** | U | `agents/cloud/acceptance_cm1303_test.mbt`::acceptance_CM-1303_origin_cloud_aligns_cursor_origin_mcp — namespace=cursor-origin≠github；PR/checks 工具面；get_pull_request+checks_read 可测 |
| CM-1305 | **PASS** | U | `skills/acceptance_cm1305_test.mbt`::acceptance_CM-1305_source_control_no_origin_trigger_on_mirror — NativeOrigin→cursor-origin；GithubMirror/GithubNative 拒 register_origin_trigger |
| CM-1306 | **PASS** | U | `agents/cloud/acceptance_cm1306_test.mbt`::acceptance_CM-1306_cloud_agent_autoreview_same_action_card — HighRisk Block；同动作 retry→RaiseApprovalCard；改写/base64 不抬卡 |
| CM-1401 | **PASS** | U | **kernel-contract** `agents/teammates/acceptance_cm1401_test.mbt`::acceptance_CM-1401_create_agent_appears_in_members — CreateAgent→in_members∧in_sidebar；重复 id Err；**host-integration GAP**（真侧栏/Members 面板属 Host/I） |
| CM-1402 | **PASS** | U | `agents/teammates/acceptance_cm1402_test.mbt`::acceptance_CM-1402_send_to_agent_delivery_loop_detect — delivered_to 到达；A↔B/自送 loop Err+has_loop |
| CM-1404 | **PASS** | U | `agents/teammates/acceptance_cm1404_test.mbt`::acceptance_CM-1404_room_turn_no_private_assumptions — [room] cue；私聊假设短语拒；is_room∧¬is_private_dm |
| CM-1507 | **PASS** | U | **kernel-contract** `ui_protocol/acceptance_cm1507_test.mbt`::acceptance_CM-1507_auto_review_settings_deeplink_anchors — grokbot:// auto-review/rules/security-keys 双射；OpenSettingsIntent 可开；未知 id Err；**host-integration GAP**（真屏锚点滚动属 Host/I） |

八项 FAIL→**PASS**（1401/1507 仿 M–Q：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **221/221**（Total tests: 221, passed: 221, failed: 0）；R 相关包单独复测全绿（agents/task 8、agents/cloud 9、skills 8、agents/teammates 3、ui_protocol 24）。P0 收口句不动（仍 117/117）。勿改 Q/P/O/N/M 已 PASS。

## 升裁 Q 批 CM-0909/1007/1008/1010/1103/1105/1203/1204（Bit验证 · 2026-10-17 12:44 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-0909 | **PASS** | U | `agents/cloud/acceptance_cm0909_test.mbt`::acceptance_CM-0909_cursor_origin_distinct_from_github_mirror — namespace cursor-origin≠cursor-github；mirror seed 拒；native repo/PR/checks_read 可测 |
| CM-1007 | **PASS** | U | `connectors/mail/acceptance_cm1007_test.mbt`::acceptance_CM-1007_mailbox_create_draft_no_send — create_draft 不发送；attach_via_upload=/workspace；仅 user_pressed_send 才 sent |
| CM-1008 | **PASS** | U | `connectors/mail/acceptance_cm1008_test.mbt`::acceptance_CM-1008_plus_tag_address_routine_filter — To/Cc header 可见 +tag；routine 仅匹配 tag（拒 local/错 tag/无 tag） |
| CM-1010 | **PASS** | U | `skills/acceptance_cm1010_test.mbt`::acceptance_CM-1010_send_on_behalf_tone_samples — 首次代写先 offer samples；pick register；draft 按语域（formal 拒 informal） |
| CM-1103 | **PASS** | U | `channels/acceptance_cm1103_test.mbt`::acceptance_CM-1103_personal_slack_owner_dm_only — owner DM SentDm；共享频道/线程 RefusedSharedChannel+share hint；非 owner DM 拒 |
| CM-1105 | **PASS** | U | **kernel-contract** `channels/acceptance_cm1105_test.mbt`::acceptance_CM-1105_setup_slack_connect_flow — connect_tool→Connected；guide_details→complete_from_details；未开 Details 不可 complete；**host-integration GAP**（真 Slack OAuth/Details 面板属 Host/I） |
| CM-1203 | **PASS** | U | `agents/task/acceptance_cm1203_test.mbt`::acceptance_CM-1203_task_knowledge_work_dispatch_summary — knowledgeWork 派发；Completed+summary 回收；空 material Err |
| CM-1204 | **PASS** | U | `agents/task/acceptance_cm1204_test.mbt`::acceptance_CM-1204_task_video_watch_path_in_conclusion_out — video_path 入；conclusion 出且含路径；空 path Err |

八项 FAIL→**PASS**（1105 仿 M/N/O/P：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **213/213**（Total tests: 213, passed: 213, failed: 0）；Q 相关包单独复测全绿（agents/cloud 7、connectors/mail 13、skills 7、channels 11、agents/task 7）。P0 收口句不动（仍 117/117）。勿改 P/O/N/M 已 PASS。

## 升裁 P 批 CM-0505/0507/0607/0609/0706/0802/0805/0904（Bit验证 · 2026-10-17 12:40 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-0505 | **PASS** | U | `skills/acceptance_cm0505_test.mbt`::acceptance_CM-0505_update_skill_next_trigger_new_body — update_skill 后 next_trigger_body/resolve 用 NEW_BODY；旧正文消失；managed 不可写 |
| CM-0507 | **PASS** | U | `agents/computer_use/acceptance_cm0507_test.mbt`::acceptance_CM-0507_site_playbook_snippet_to_computer_use — match→Read first；snippet 进 child_task；`dispatch_site_playbook_snippet` 子任务含 snippet |
| CM-0607 | **PASS** | U | **kernel-contract** `box_host/acceptance_cm0607_test.mbt`::acceptance_CM-0607_box_doctor_pass_fail_parsable — PASS/FAIL/SUMMARY 可解析；failures_reportable；log=/tmp/box-doctor.log；**host-integration GAP**（真 Host 探针属 Host/I） |
| CM-0609 | **PASS** | U | `stores/acceptance_cm0609_test.mbt`::acceptance_CM-0609_agent_store_authorized_mount — authorize 后 /cursor/stores/<id> 可读；未授权 path_exists=false / mount=None |
| CM-0706 | **PASS** | U | `runtime/acceptance_cm0706_test.mbt`::acceptance_CM-0706_sent_from_machine_default — 携带 machineId 更新默认；未指定用最近消息机；显式 id 优先 |
| CM-0802 | **PASS** | U | **kernel-contract** `agents/computer_use/acceptance_cm0802_test.mbt`::acceptance_CM-0802_box_chrome_launcher_not_bare — 文档化 box-chrome 路径；BareChrome 拒；lockfile pid=/status= 可诊断；**host-integration GAP**（真浏览器进程属 Host/I） |
| CM-0805 | **PASS** | U | `agents/computer_use/acceptance_cm0805_test.mbt`::acceptance_CM-0805_request_box_help_handoff_is_ask — handoff 即 ask（is_ask∧¬pre_asked）；禁「要交棒吗」预问 |
| CM-0904 | **PASS** | U | `connectors/acceptance_cm0904_test.mbt`::acceptance_CM-0904_install_plugin_namespace_ready — InstallPlugin/add-connector 后 namespace Ready 且 usable |

八项 FAIL→**PASS**（0607/0802 仿 M/N/O：kernel-contract PASS + host-integration GAP）。Q-SMOKE 开裁实测 **205/205**（Total tests: 205, passed: 205, failed: 0）；P 相关包单独复测全绿（skills 6、computer_use 8、box_host 19、stores 2、runtime 38、connectors 2、ui_protocol 23）。整仓随后被并发 `connectors/mail` CM-1008/plus_tag 改动打断（非本批、未改业务）。P0 收口句不动（仍 117/117）。勿改 O/N/M 已 PASS。

## 升裁 O 批 CM-0408/0410/0411/0412/0414/0417/0502/0503（Bit验证 · 2026-10-17 12:35 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-0408 | **PASS** | U | `routines/acceptance_cm0408_0412_test.mbt`::acceptance_CM-0408_origin_event_native_repo_only — validate_origin_listener：Native+pr Ok；Mirror 拒；CI 无 pr→Err；CI+pr Ok |
| CM-0410 | **PASS** | U | 同文件::acceptance_CM-0410_mail_inbox_wake_headers_only — mail_inbox_wake 仅 headers；payload 不含 body；+tag 过滤；体经 `@mail.read_thread` |
| CM-0411 | **PASS** | U | **kernel-contract** 同文件::acceptance_CM-0411_webhook_trigger_key_opaque — wake 含 `<webhook_event>`；assistant_tool_read_key→Err；wake 不泄 key；**host-integration GAP**（真面板复制 URL/key 属 Host/I） |
| CM-0412 | **PASS** | U | 同文件::acceptance_CM-0412_group_listeners_any_path_same_prompt — Slack/Github/Cron/Webhook 任一路径同 prompt；未列路径不唤醒；allows_cron |
| CM-0414 | **PASS** | U | `routines/acceptance_cm0414_test.mbt`::acceptance_CM-0414_terminal_state_auto_delete — Open 保留；Merged/Closed/timed-watch 到期后 routine 消失 |
| CM-0417 | **PASS** | U | `runtime/acceptance_cm0417_test.mbt`::acceptance_CM-0417_automation_status_no_prompt_body — 提醒含 id+folder、无 prompt 正文；store.get 取全文 |
| CM-0502 | **PASS** | U | `skills/acceptance_cm0502_0503_test.mbt`::acceptance_CM-0502_user_skills_load_with_priority — 用户技能可加载；`User > Plugin > Managed`；同名 User 覆盖 Managed |
| CM-0503 | **PASS** | U | 同文件::acceptance_CM-0503_plugin_skills_appear_after_install — PluginRegistry.install 后 catalog 出现 slides-quickstart；resolve→Plugin |

八项 FAIL→**PASS**（0411 仿 M/N：kernel-contract PASS + host-integration GAP）。Q-SMOKE **197/197**（Total tests: 197, passed: 197, failed: 0）。P0 收口句不动（仍 117/117）。勿改 N/M 已 PASS。

## 升裁 N 批 CM-0107/0110/0112/0202/0204/0205/0302/0303（Bit验证 · 2026-10-17 12:34 Asia/Shanghai）

| ID | 裁决 | 类 | 证据（新测名） |
|----|------|----|----------------|
| CM-0107 | **PASS** | U | `runtime/acceptance_cm0107_test.mbt`::acceptance_CM-0107_voice_memo_spoken_sentences — 静默至首条 memo；markdown/编号列表拒；口述完整句 voice_memo=true |
| CM-0110 | **PASS** | U | `channels/acceptance_cm0110_test.mbt`::acceptance_CM-0110_inbound_reaction_no_forced_reply — 反应唤醒默认定 WakeNoReply；useful 时 ActWhenUseful 仍不强制回复 |
| CM-0112 | **PASS** | U | `runtime/acceptance_cm0112_test.mbt`::acceptance_CM-0112_todowrite_multistep_checklist — ≥3 步可见 todo；mark_todo_done→status=done |
| CM-0202 | **PASS** | U | `ui_protocol/acceptance_cm0202_test.mbt`::acceptance_CM-0202_update_avatar_preview_reject_invalid — 合法路径可预览；scheme/非图/缺失/穿越拒 |
| CM-0204 | **PASS** | U | **kernel-contract** `ui_protocol/acceptance_cm0204_test.mbt`::acceptance_CM-0204_hidden_agent_not_in_main_sidebar — hidden 不进 main_sidebar 仍 addressable；**host-integration GAP**（真侧边栏像素属 Host/I） |
| CM-0205 | **PASS** | U | **kernel-contract** `ui_protocol/acceptance_cm0205_test.mbt`::acceptance_CM-0205_per_agent_info_panel_fields — 五锚点与 app-ui 对齐；残缺面板拒开；**host-integration GAP**（真屏属 Host/I） |
| CM-0302 | **PASS** | U | `memory/acceptance_cm0302_test.mbt`::acceptance_CM-0302_journal_range_query_no_profile_pollute — query_range 按日命中；journal 不污染 profile |
| CM-0303 | **PASS** | U | `memory/acceptance_cm0303_test.mbt`::acceptance_CM-0303_shared_memory_scope_isolation — 同 scope 可读；cross_scope_read 越权 Err；scopes_isolated |

八项 FAIL→**PASS**（0204/0205 仿 M 批：kernel-contract PASS + host-integration GAP）。Q-SMOKE **197/197**（Total tests: 197, passed: 197, failed: 0）。P0 收口句不动（仍 117/117）。

## 升裁 M 批 CM-1901/1902/1907/1904/1906（Bit验证 · 2026-10-17 12:25 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-1901 | **PASS** | U | kernel-contract `ui_protocol/...`::acceptance_CM-1901_settings_entry_closed_set；host-integration GAP |
| CM-1902 | **PASS** | U | kernel-contract `...`::acceptance_CM-1902_settings_anchor_deeplink_bijection；host-integration GAP |
| CM-1907 | **PASS** | U | kernel-contract `...`::acceptance_CM-1907_delete_agent_confirm_not_settings；host-integration GAP |
| CM-1904 | **PASS** | U | kernel-contract `...`::acceptance_CM-1904_reset_computer_not_preferred；host-integration GAP |
| CM-1906 | **PASS** | U | kernel-contract `...`::acceptance_CM-1906_update_channel_ne_update_computer；host-integration GAP |

五项 **GAP→PASS**（kernel-contract；真屏 host-integration 仍 GAP）。

**P0 矩阵收口 117/117**（含 1901/1902/1907；真屏 I 仍 GAP）。Q-SMOKE **181/181**（Total tests: 181, passed: 181, failed: 0）。

## 升裁 L 批 CM-0806/1903/1905/2002/2160/2171/2176/2177（Bit验证 · 2026-10-17 12:23 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-0806 | **PASS** | U | kernel-contract `box_host/...`::acceptance_CM-0806_login_persist_after_update；host-integration GAP |
| CM-1903 | **PASS** | U | kernel-contract `...`::acceptance_CM-1903_update_computer_two_step_prefer_guide；host-integration GAP |
| CM-1905 | **PASS** | U | kernel-contract `...`::acceptance_CM-1905_local_execution_off_rejects_machine；host-integration GAP |
| CM-2002 | **PASS** | U | `runtime/acceptance_cm2002_test.mbt`::acceptance_CM-2002_language_follow_zh_ask_zh_answer |
| CM-2160 | **PASS** | U | kernel-contract `agents/computer_use/...`::acceptance_CM-2160_browser_navigate_public_reachable；host-integration GAP |
| CM-2171 | **PASS** | U | `connectors/commerce/acceptance_cm2171_test.mbt`::acceptance_CM-2171_credential_entry_secure_form_no_log |
| CM-2176 | **PASS** | U | `security/acceptance_cm2176_2177_test.mbt`::acceptance_CM-2176_task_description_not_permission |
| CM-2177 | **PASS** | U | `security/acceptance_cm2176_2177_test.mbt`::acceptance_CM-2177_executor_draft_reported_to_parent |

八项 FAIL→**PASS**（Host 项仿 CM-0605：kernel-contract PASS + host-integration GAP）。Q-SMOKE **176/176**（Total tests: 181, passed: 181, failed: 0）。

## 升裁 K 批 CM-2142/2147/2152/2154/2159/2162/2169/2170（Bit验证 · 2026-10-17 12:19 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-2142 | **PASS** | U | `connectors/mail/acceptance_cm2142_test.mbt`::acceptance_CM-2142_draft_card_send_verbatim_once |
| CM-2147 | **PASS** | U | `tools/acceptance_cm2147_test.mbt`::acceptance_CM-2147_no_homemade_connect_url |
| CM-2152 | **PASS** | U | `runtime/acceptance_cm2152_2154_test.mbt`::acceptance_CM-2152_first_turn_with_description_start |
| CM-2154 | **PASS** | U | `runtime/acceptance_cm2152_2154_test.mbt`::acceptance_CM-2154_inbound_agent_not_user_question |
| CM-2159 | **PASS** | U | `box_host/acceptance_cm2159_test.mbt`::acceptance_CM-2159_working_directory_param_effective |
| CM-2162 | **PASS** | U | `security/acceptance_cm2162_2169_2170_test.mbt`::acceptance_CM-2162_child_approval_bubbles_to_parent |
| CM-2169 | **PASS** | U | `security/acceptance_cm2162_2169_2170_test.mbt`::acceptance_CM-2169_agent_inbox_no_unauthorized_send |
| CM-2170 | **PASS** | U | `security/acceptance_cm2162_2169_2170_test.mbt`::acceptance_CM-2170_safer_path_not_bypass_rewrite |

八项 FAIL→**PASS**。Q-SMOKE **168/168**（Total tests: 181, passed: 181, failed: 0）。

## 升裁 J 批 CM-2129/2133/2134/2137/2138/2139/2140/2143（Bit验证 · 2026-10-17 12:13 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-2129 | **PASS** | U | `security/acceptance_cm2129_2143_test.mbt`::acceptance_CM-2129_credential_request_fill_no_plaintext |
| CM-2133 | **PASS** | U | `agents/task/acceptance_cm2133_test.mbt`::acceptance_CM-2133_no_busy_loop_check_subagent |
| CM-2134 | **PASS** | U | `tools/acceptance_cm2134_test.mbt`::acceptance_CM-2134_needs_grant_refuse_then_grant_flow |
| CM-2137 | **PASS** | U | `ui_protocol/acceptance_cm2137_test.mbt`::acceptance_CM-2137_inbound_attachment_ref_readable |
| CM-2138 | **PASS** | U | `runtime/acceptance_cm2138_2140_test.mbt`::acceptance_CM-2138_multi_effect_batch_ge2 |
| CM-2139 | **PASS** | U | `runtime/acceptance_cm2138_2140_test.mbt`::acceptance_CM-2139_reversible_autonomy_no_ask |
| CM-2140 | **PASS** | U | `runtime/acceptance_cm2138_2140_test.mbt`::acceptance_CM-2140_no_fabricated_facts_admit_gap |
| CM-2143 | **PASS** | U | `security/acceptance_cm2129_2143_test.mbt`::acceptance_CM-2143_refused_send_no_channel_bypass |

八项 FAIL→**PASS**。Q-SMOKE **160/160**（Total tests: 181, passed: 181, failed: 0）。

## 升裁 I 批 CM-2113/2114/2115/2121/2122/2123/2124/2126（Bit验证 · 2026-10-17 12:08 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-2113 | **PASS** | U | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2113_child_sex_illegal_stop |
| CM-2114 | **PASS** | U | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2114_weapons_dual_use_bio_refuse |
| CM-2115 | **PASS** | U | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2115_crime_assistance_short_refuse |
| CM-2121 | **PASS** | U | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2121_offensive_cyber_refuse_no_detail |
| CM-2122 | **PASS** | U | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2122_child_sex_refuse_illegal_stop |
| CM-2123 | **PASS** | U | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2123_weapons_bio_refuse |
| CM-2124 | **PASS** | U | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2124_crime_help_refuse |
| CM-2126 | **PASS** | U | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2126_self_harm_care_988_no_methods |

八项 FAIL→**PASS**。Q-SMOKE **152/152**（Total tests: 181, passed: 181, failed: 0）。CM-2112 仍绿（未回归）。

## 升裁 H 批 CM-2001/2007/2008/1605/1802/2127/2130/2112（Bit验证 · 2026-10-17 12:06 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-2001 | **PASS** | U | `runtime/acceptance_cm2001_2007_2008_test.mbt`::acceptance_CM-2001_user_timezone_report |
| CM-2007 | **PASS** | U | `runtime/acceptance_cm2001_2007_2008_test.mbt`::acceptance_CM-2007_automation_status_uses_latest_timestamp |
| CM-2008 | **PASS** | U | `runtime/acceptance_cm2001_2007_2008_test.mbt`::acceptance_CM-2008_identity_product_name_only |
| CM-1605 | **PASS** | U | `box_host/acceptance_cm1605_test.mbt`::acceptance_CM-1605_inline_image_understandable |
| CM-1802 | **PASS** | U | `connectors/commerce/acceptance_cm1802_test.mbt`::acceptance_CM-1802_purchases_require_explicit_user |
| CM-2127 | **PASS** | U | `connectors/mail/acceptance_cm2127_test.mbt`::acceptance_CM-2127_inbound_mail_no_auto_reply |
| CM-2130 | **PASS** | U | `security/acceptance_cm2112_2130_test.mbt`::acceptance_CM-2130_list_credentials_no_secret_plaintext |
| CM-2112 | **PASS** | U | `security/acceptance_cm2112_2130_test.mbt`::acceptance_CM-2112_offensive_cyber_short_refuse |

八项 FAIL→**PASS**。Q-SMOKE **144/144**（Total tests: 181, passed: 181, failed: 0）。

## 升裁 G 批 CM-0201/0203/0301/0804/1202/0906/1604/0908（Bit验证 · 2026-10-17 12:02 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-0201 | **PASS** | U | `ui_protocol/acceptance_cm0201_0203_test.mbt`::acceptance_CM-0201_update_agent_profile_reflects |
| CM-0203 | **PASS** | U | `ui_protocol/acceptance_cm0201_0203_test.mbt`::acceptance_CM-0203_sidebar_visibility_delete_confirm |
| CM-0301 | **PASS** | U | `memory/acceptance_cm0301_test.mbt`::acceptance_CM-0301_profile_update_recall_across_sessions |
| CM-0804 | **PASS** | U | `ui_protocol/acceptance_cm0804_test.mbt`::acceptance_CM-0804_user_form_snapshot_no_blind_retry |
| CM-1202 | **PASS** | U | `agents/computer_use/acceptance_cm1202_test.mbt`::acceptance_CM-1202_computer_use_task_outcome_only |
| CM-0906 | **PASS** | U | `connectors/mail/acceptance_cm0906_test.mbt`::acceptance_CM-0906_gmail_mcp_draft_search_read |
| CM-1604 | **PASS** | U | `connectors/mail/acceptance_cm1604_test.mbt`::acceptance_CM-1604_email_attachment_upload_path_contract |
| CM-0908 | **PASS** | U | `agents/cloud/acceptance_cm0908_test.mbt`::acceptance_CM-0908_github_mcp_pr_list_get_comment |

八项 FAIL→**PASS**（无 CM-0903）。Q-SMOKE **136/136**（Total tests: 181, passed: 181, failed: 0）。

## 升裁 F 批 CM-0101/0108/0109/2003/0406/0407/0415/0416（Bit验证 · 2026-10-17 11:57 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-0101 | **PASS** | U | `runtime/acceptance_cm0101_test.mbt`::acceptance_CM-0101_send_to_user_text_delivery |
| CM-0108 | **PASS** | U | `runtime/acceptance_cm0108_test.mbt`::acceptance_CM-0108_channel_target_inbound_reply |
| CM-0109 | **PASS** | U | `runtime/acceptance_cm0109_test.mbt`::acceptance_CM-0109_thread_reply_stays_in_thread |
| CM-2003 | **PASS** | U | `runtime/acceptance_cm2003_test.mbt`::acceptance_CM-2003_hidden_inbound_cue_not_spoken |
| CM-0406 | **PASS** | U | `routines/acceptance_cm0406_test.mbt`::acceptance_CM-0406_slack_event_trigger_shape |
| CM-0407 | **PASS** | U | `routines/acceptance_cm0407_test.mbt`::acceptance_CM-0407_github_event_trigger_pr_babysit |
| CM-0415 | **PASS** | U | `routines/acceptance_cm0415_test.mbt`::acceptance_CM-0415_routine_create_confirm_card_no_retry_on_deny |
| CM-0416 | **PASS** | U | `routines/acceptance_cm0416_test.mbt`::acceptance_CM-0416_delivery_destination_line |

八项 FAIL→**PASS**（MoonBit核交稿）。Q-SMOKE **128/128**（Total tests: 176, passed: 176, failed: 0）。

## 升裁 E 批 CM-0701/0702/0703/0704/0501/0504/1505/1506（Bit验证 · 2026-10-17 11:52 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-0701 | **PASS** | U | `box_host/acceptance_cm070x_test.mbt`::acceptance_CM-0701_list_machines_full_set |
| CM-0702 | **PASS** | U | `box_host/acceptance_cm070x_test.mbt`::acceptance_CM-0702_machine_id_requires_approval |
| CM-0703 | **PASS** | U | `box_host/acceptance_cm070x_test.mbt`::acceptance_CM-0703_copy_to_box_binary_uploads |
| CM-0704 | **PASS** | U | `box_host/acceptance_cm070x_test.mbt`::acceptance_CM-0704_copy_from_box_path_and_overwrite |
| CM-0501 | **PASS** | U | `skills/acceptance_cm050x_test.mbt`::acceptance_CM-0501_managed_skills_catalog_readable |
| CM-0504 | **PASS** | U | `skills/acceptance_cm050x_test.mbt`::acceptance_CM-0504_ondemand_skill_read_no_preload |
| CM-1505 | **PASS** | U | `runtime/acceptance_cm1505_1506_test.mbt`::acceptance_CM-1505_autoreview_block_notice_exception |
| CM-1506 | **PASS** | U | `runtime/acceptance_cm1505_1506_test.mbt`::acceptance_CM-1506_credential_exfiltration_blocked |

八项 FAIL→**PASS**（MoonBit核交稿）。Q-SMOKE **120/120**（Total tests: 168, passed: 168, failed: 0）。

## 升裁 D 批 CM-1101/1102/1104/1106/1301/1302/1304/1502/1503（Bit验证 · 2026-10-17 11:51 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-1101 | **PASS** | U | `channels/acceptance_cm110x_test.mbt`::acceptance_CM-1101_omit_channel_stays_in_chat |
| CM-1102 | **PASS** | U | `channels/acceptance_cm110x_test.mbt`::acceptance_CM-1102_slack_thread_dm_toplevel |
| CM-1104 | **PASS** | U | `channels/acceptance_cm110x_test.mbt`::acceptance_CM-1104_channel_degrades_no_bare_widget |
| CM-1106 | **PASS** | U | `ui_protocol/acceptance_cm1106_test.mbt`::acceptance_CM-1106_secret_request_no_plaintext |
| CM-1301 | **PASS** | U | `agents/cloud/acceptance_cm130x_test.mbt`::acceptance_CM-1301_1302_cloud_agent_lifecycle |
| CM-1302 | **PASS** | U | 同上（Succeeded≠Failed） |
| CM-1304 | **PASS** | U | `agents/cloud/acceptance_cm130x_test.mbt`::acceptance_CM-1304_pr_comment_and_diff_mock |
| CM-1502 | **PASS** | U | `runtime/acceptance_cm1502_1503_test.mbt`::acceptance_CM-1502_autoreview_blocks_high_risk |
| CM-1503 | **PASS** | U | `runtime/acceptance_cm1502_1503_test.mbt`::acceptance_CM-1503_smart_mode_same_action_only |

九项（八条请求；1301/1302 同测）FAIL→**PASS**。Q-SMOKE **112/112**（Total tests: 160, passed: 160, failed: 0）。

## 升裁 C 批 CM-0801/0803/1701/1702（Bit验证 · 2026-10-17 11:44 Asia/Shanghai）

| ID | 裁决 | 证据类型 | 证据（新测名） |
|----|------|----------|----------------|
| CM-0801 | **PASS** | U | `agents/computer_use/acceptance_cm0801_test.mbt`::acceptance_CM-0801_named_bypass_rejected |
| CM-0803 | **PASS** | U | `agents/computer_use/acceptance_cm0803_test.mbt`::acceptance_CM-0803_signin_secret_no_plaintext |
| CM-1701 | **PASS** | U | `tools/acceptance_web_test.mbt`::acceptance_CM-1701_summary_url_current_year |
| CM-1702 | **PASS** | U | `tools/acceptance_web_test.mbt`::acceptance_CM-1702_auth_page_fails_clearly |

四件 FAIL→**PASS**。Q-SMOKE **96/96**（Total tests: 152, passed: 152, failed: 0）。

## Q-SMOKE

| ID | 判定 | 证据 |
|----|------|------|
| Q-SMOKE | **PASS** | Total tests: 144, passed: 144, failed: 0 |

> 绿线以冒烟实测为准。CM-0605 已按 ADR 拆分（见下节）。

## P0 摘要（按前缀）

| 前缀 | P0 | PASS | FAIL | GAP |
|------|----|------|------|-----|
| CM-01xx | 9 | 6 | 3 | 0 |
| CM-02xx | 2 | 0 | 2 | 0 |
| CM-03xx | 4 | 3 | 1 | 0 |
| CM-04xx | 10 | 5 | 5 | 0 |
| CM-05xx | 2 | 0 | 2 | 0 |
| CM-06xx | 6 | 6 | 0 | 0 |
| CM-07xx | 4 | 0 | 4 | 0 |
| CM-08xx | 4 | 0 | 4 | 0 |
| CM-09xx | 6 | 3 | 3 | 0 |
| CM-10xx | 6 | 5 | 1 | 0 |
| CM-11xx | 4 | 0 | 4 | 0 |
| CM-12xx | 5 | 4 | 1 | 0 |
| CM-13xx | 3 | 0 | 3 | 0 |
| CM-15xx | 6 | 2 | 4 | 0 |
| CM-16xx | 2 | 0 | 2 | 0 |
| CM-17xx | 2 | 0 | 2 | 0 |
| CM-18xx | 1 | 0 | 1 | 0 |
| CM-19xx | 5 | 0 | 2 | 3 |
| CM-20xx | 5 | 0 | 5 | 0 |
| CM-21xx | 31 | 0 | 31 | 0 |

P0 合计 **117** · PASS **117** · FAIL **0** · GAP **0**（口径=kernel-contract；真屏 I 仍 GAP）。

## P0 打回清单（FAIL）

| ID | 架构短号 | 能力 | 模块 | 缺什么（含新测名） | 打回给 |
|----|----------|------|------|------------------|--------|

## 打回角色

| 给谁 | 要求 |
|------|------|
| MoonBit核 | **立刻**修 `routines/cron_phase.mbt` Result 双重包装救 Q-SMOKE；另补 FAIL：0801 具名旁路、0803 secret/transcript、1701 摘要+当前年、1702 认证页、0404 例外测、0902 schema、0904 Install、1004 附件 |
| 能力对标 | 同步 A 全 7 + B 全 3 + CM-1006 PASS；勿用旧测名理解 A |
| Bitbot | 催编译绿；按 FAIL 排期 |

## P0 全表

| ID | 架构短号 | 能力 | 模块 | 裁决 | 证据 | 打回给 |
|----|----------|------|------|------|------|--------|
| CM-0101 | TURN-01 · D-TURN | SendToUser 文本投递 | ``ui_protocol/message`` | **PASS** | `runtime/acceptance_cm0101_test.mbt`::acceptance_CM-0101_send_to_user_text_delivery — SendToUser Text/Markdown；首条 confirm/clarify。覆盖验收。| MoonBit核 |
| CM-0102 | TURN-02 · D-TURN | 首条确认语义 | ``runtime/turn + ui_protocol`` | **PASS** | `runtime/acceptance_turn_test.mbt`::acceptance_CM-0102_user_ack_hidden_agent_no_ack | MoonBit核 |
| CM-0103 | TURN-03 · D-TURN | 里程碑进度更新 | ``runtime/turn + ui_protocol`` | **PASS** | `runtime/acceptance_turn_test.mbt`::acceptance_CM-0103_two_milestones_then_final | MoonBit核 |
| CM-0104 | TURN-04 · D-TURN | end_turn 语义 | ``runtime/turn`` | **PASS** | `runtime/acceptance_turn_test.mbt`::acceptance_CM-0104_end_turn_stops_user_delivery | MoonBit核 |
| CM-0105 | COMM-03 · D-COMM | widget 决策卡 | ``ui_protocol/widget`` | **PASS** | `ui_protocol/acceptance_p0_test.mbt`::acceptance_CM-0105_widget_card_and_choice_user_message — Wi... | MoonBit核 |
| CM-0106 | FILE-02 · D-FILE | 附件投递 attachment | ``ui_protocol/attachment`` | **PASS** | `ui_protocol/acceptance_p0_test.mbt`::acceptance_CM-0106_mock_fs_exists_ok_hallucinated_rejected ... | MoonBit核 |
| CM-0108 | CHAN-01 · D-CHAN | 频道目标 channel target | ``ui_protocol + channels`` | **PASS** | `runtime/acceptance_cm0108_test.mbt`::acceptance_CM-0108_channel_target_inbound_reply — inbound 回原地址；省略 channel 不外泄。覆盖验收。| MoonBit核 |
| CM-0109 | TURN-06 · D-TURN | 线程 thread 投递 | ``channels/slack`` | **PASS** | `runtime/acceptance_cm0109_test.mbt`::acceptance_CM-0109_thread_reply_stays_in_thread — slack:C:ts 解析；回复进同线程。覆盖验收。| MoonBit核 |
| CM-0111 | COMM-01/COMM-02 · D-COMM | 链接与 markdown 纪律 | ``ui_protocol/message`` | **PASS** | `ui_protocol/acceptance_p0_test.mbt`::acceptance_CM-0111_reject_unknown_deeplink_and_bare_url — 裸... | MoonBit核 |
| CM-0201 | PROF-01 · D-PROF | UpdateAgentProfile 名称/标题/描述 | ``memory/profile + ui_protocol`` | **PASS** | `ui_protocol/acceptance_cm0201_0203_test.mbt`::acceptance_CM-0201_update_agent_profile_reflects — 改后侧边栏+信息面板即时反映。覆盖验收。| MoonBit核 |
| CM-0203 | PROF-03 · D-PROF | 侧边栏可见性 sidebar | ``ui_protocol + Host`` | **PASS** | `ui_protocol/acceptance_cm0201_0203_test.mbt`::acceptance_CM-0203_sidebar_visibility_delete_confirm — 新建入侧边栏；删除需确认且清 transcript。覆盖验收。| Bit架构+MoonBit核 |
| CM-0301 | MEM-01/MEM-06 · D-MEM | Memory profile 层 | ``memory/profile`` | **PASS** | `memory/acceptance_cm0301_test.mbt`::acceptance_CM-0301_profile_update_recall_across_sessions — Update 后跨会话 Recall 可得。覆盖验收。| MoonBit核 |
| CM-0304 | MEM-04 · D-MEM | Recall 工具 | ``memory/recall`` | **PASS** | `memory/acceptance_memory_test.mbt`::acceptance_CM-0304_recall_prefix_and_limit | MoonBit核 |
| CM-0305 | MEM-05 · D-MEM | Update Memory 工具 | ``memory/recall`` | **PASS** | `memory/acceptance_memory_test.mbt`::acceptance_CM-0305_unsupported_scope_classification — 错 scop... | MoonBit核 |
| CM-0306 | D-MEM | 记忆不驱动不可逆动作 | ``security + memory`` | **PASS** | `security/acceptance_sec_test.mbt`::acceptance_CM-0306_kefa_memory_blocks_external_send_effect — ... | MoonBit核 |
| CM-0401 | RTN-03 · D-RTN | UpdateRoutine create/get/update | ``routines/lifecycle`` | **PASS** | `routines/lifecycle_test.mbt`::acceptance_cm0401_create_get_update | MoonBit核 |
| CM-0402 | RTN-01 · D-RTN | Cron 调度（用户时区） | ``routines/cron`` | **PASS** | `routines/acceptance_cron_tz_test.mbt`::acceptance_CM-0402_iana_timezone_and_CRON_TZ_override — 用... | MoonBit核 |
| CM-0403 | D-RTN | Flexible timing / 分钟相位 | ``routines/cron`` | **PASS** | `routines/acceptance_cron_extra_test.mbt`::acceptance_CM-0403_flexible_phase_and_no_blind_step | MoonBit核 |
| CM-0404 | D-RTN | 工作日/安静时段默认 | ``routines/cron`` | **PASS** | `routines/acceptance_cron_extra_test.mbt`::acceptance_CM-0404_exception_requires_explicit + acceptance_CM-0404_explicit_exception_required (+loose_daily) — 有界 cron；无明示例外→Err；明示→更宽 cron。覆盖验收全文。 | MoonBit核 |
| CM-0405 | D-RTN | 最短间隔 5 分钟 | ``routines/cron`` | **PASS** | `routines/acceptance_cron_extra_test.mbt`::acceptance_CM-0405_min_interval_5_minutes | MoonBit核 |
| CM-0406 | RTN-02 · D-RTN | 事件触发 Slack | ``routines/events`` | **PASS** | `routines/acceptance_cm0406_test.mbt`::acceptance_CM-0406_slack_event_trigger_shape — 监听形状校验；未 invite 提示 /invite。覆盖验收。| MoonBit核 |
| CM-0407 | D-RTN | 事件触发 GitHub | ``routines/events`` | **PASS** | `routines/acceptance_cm0407_test.mbt`::acceptance_CM-0407_github_event_trigger_pr_babysit — PR babysit 默认包；Merged/Closed 自删。覆盖验收。| MoonBit核 |
| CM-0413 | RTN-06 · D-RTN | pause / resume | ``routines/lifecycle`` | **PASS** | `routines/lifecycle_test.mbt`::acceptance_cm0413_pause_resume | MoonBit核 |
| CM-0415 | D-RTN | 创建确认卡 | ``routines/lifecycle + security`` | **PASS** | `routines/acceptance_cm0415_test.mbt`::acceptance_CM-0415_routine_create_confirm_card_no_retry_on_deny — 拒绝不重试同写；结果回填。覆盖验收。| MoonBit核 |
| CM-0416 | D-RTN | 投递目的地行 | ``routines/lifecycle`` | **PASS** | `routines/acceptance_cm0416_test.mbt`::acceptance_CM-0416_delivery_destination_line — 严格按 Destination 行；拒擅自群发。覆盖验收。| MoonBit核 |
| CM-0501 | SKILL-01 · D-SKILL | Managed skills 目录 | ``skills/catalog`` | **PASS** | `skills/acceptance_cm050x_test.mbt`::acceptance_CM-0501_managed_skills_catalog_readable — 列出 managed 名；SKILL.md 可读。覆盖验收。| MoonBit核 |
| CM-0504 | SKILL-04 · D-SKILL | 按需 Read 技能 | ``skills/runner`` | **PASS** | `skills/acceptance_cm050x_test.mbt`::acceptance_CM-0504_ondemand_skill_read_no_preload — 匹配才 Read；无关不进上下文。覆盖验收。| MoonBit核 |
| CM-0601 | BOX-01 · D-BOX | Shell（box） | ``tools/box`` | **PASS** | `box_host/host_abi_test.mbt`::acceptance_cm0601_shell_box_and_machine | MoonBit核 |
| CM-0602 | FILE-08/BOX-02 · D-FILE/D-BOX | Read（box） | ``tools/box`` | **PASS** | `box_host/host_abi_test.mbt`::acceptance_CM-0602_image_read_inline_visible (+acceptance_cm0602_re... | MoonBit核 |
| CM-0603 | BOX-03/BOX-04/MEM-06 · D-BOX/D-MEM | 文件系统持久化 | ``tools/box + Host`` | **PASS** | `box_host/host_abi_test.mbt`::acceptance_cm0603_fs_persists | Bit架构+MoonBit核 |
| CM-0604 | BOX-06/BOX-08 · D-BOX | AwaitShell | ``tools/box`` | **PASS** | `box_host/host_abi_test.mbt`::acceptance_cm0604_await_no_kill_fire_and_forget | MoonBit核 |
| CM-0605 | FILE-03/DESK-02 · D-FILE/D-DESK | Screenshot | ``tools/desktop`` | **PASS** | **kernel-contract PASS** `box_host/host_abi_test.mbt`::acceptance_CM-0605_screenshot_frame_evidence (has_frame/read_only/未 click)；**host-integration GAP**（真实 :1 画面属 Host FFI/I，WASM 单测不可达） | MoonBit核 |
| CM-0606 | DESK-06/DESK-07 · D-DESK | 共享 box / 独立桌面 | ``tools/desktop + Host`` | **PASS** | `box_host/host_abi_test.mbt`::acceptance_cm0606_shared_fs_distinct_desktops | Bit架构+MoonBit核 |
| CM-0701 | MACH-01 · D-MACH | ListMachines | ``tools/machines`` | **PASS** | `box_host/acceptance_cm070x_test.mbt`::acceptance_CM-0701_list_machines_full_set — list 全集含 id/label/kind/status。覆盖验收。| MoonBit核 |
| CM-0702 | MACH-02/MACH-03 · D-MACH | machineId 路由 Shell/Read | ``tools/machines + security`` | **PASS** | `box_host/acceptance_cm070x_test.mbt`::acceptance_CM-0702_machine_id_requires_approval — 无审批不执行；审批后 Shell/Read 成功。覆盖验收。| MoonBit核 |
| CM-0703 | MACH-04 · D-MACH | CopyToBox | ``tools/machines`` | **PASS** | `box_host/acceptance_cm070x_test.mbt`::acceptance_CM-0703_copy_to_box_binary_uploads — 二进制完整；默认 /workspace/uploads。覆盖验收。| MoonBit核 |
| CM-0704 | MACH-05 · D-MACH | CopyFromBox | ``tools/machines`` | **PASS** | `box_host/acceptance_cm070x_test.mbt`::acceptance_CM-0704_copy_from_box_path_and_overwrite — 落盘路径正确；Allow|Refuse 覆盖策略。覆盖验收。| MoonBit核 |
| CM-0801 | DESK-01 · D-DESK | computerUse 子代理 | ``agents/computer_use`` | **PASS** | `agents/computer_use/acceptance_cm0801_test.mbt`::acceptance_CM-0801_named_bypass_rejected — ViaShell 拒 xdotool/Playwright/CDP；ViaComputerUse 允许。覆盖验收。 | MoonBit核 |
| CM-0803 | DESK-04/DESK-05 · D-DESK | sign-in 技能流 | ``skills + connectors/commerce + security`` | **PASS** | `agents/computer_use/acceptance_cm0803_test.mbt`::acceptance_CM-0803_signin_secret_no_plaintext — SecretRequest/UserForm 无明文密码；ChatPlain 拒。覆盖验收。 | MoonBit核 |
| CM-0804 | COMM-04/BUY-01 · D-COMM/D-BUY | RequestUserForm / in-chat-forms | ``ui_protocol + skills`` | **PASS** | `ui_protocol/acceptance_cm0804_test.mbt`::acceptance_CM-0804_user_form_snapshot_no_blind_retry — 目标由 snapshot；失败不盲重试同表。覆盖验收。| MoonBit核 |
| CM-0806 | D-DESK | 登录态持久 | ``Host + tools/box`` | **PASS** | **kernel-contract PASS** `box_host/acceptance_cm0806_1903_1905_test.mbt`::acceptance_CM-0806_login_persist_after_update — Update 后 cookie/登录仍在；**host-integration GAP**（真 Host UI/实例属 I）| Bit架构+MoonBit核 |
| CM-0901 | MCP-01 · D-MCP | GetDynamicTools | ``connectors/mcp + tools/dynamic`` | **PASS** | `tools/acceptance_mcp_test.mbt`::acceptance_CM-0901_discover_then_full_description | MoonBit核 |
| CM-0902 | FILE-07/MCP-02 · D-FILE/D-MCP | CallDynamicTool | ``tools/dynamic`` | **PASS** | `tools/acceptance_cm0902_schema_test.mbt`::acceptance_CM-0902_schema_required_and_write_to_file + `tools/dynamic_test.mbt`::acceptance_CM-0902_schema_positive_and_write_to_file — 缺必填拒；齐 schema Ok；write_to_file→/workspace/agent-tools/。覆盖验收。 | MoonBit核 |
| CM-0903 | MCP-03 · D-MCP | Authenticate / needsAuth | ``connectors/mcp + security`` | **PASS** | `tools/acceptance_mcp_test.mbt`::acceptance_CM-0905_namespace_status_blocks_unusable (needsAuth) | MoonBit核 |
| CM-0905 | MCP-05 · D-MCP | namespaceStatus 处理 | ``connectors/mcp`` | **PASS** | `tools/acceptance_mcp_test.mbt`::acceptance_CM-0905_namespace_status_blocks_unusable | MoonBit核 |
| CM-0906 | D-MCP | Gmail MCP 面 | ``connectors/mail`` | **PASS** | `connectors/mail/acceptance_cm0906_test.mbt`::acceptance_CM-0906_gmail_mcp_draft_search_read — 草稿+搜索+读线程。覆盖验收。| MoonBit核 |
| CM-0908 | D-MCP | cursor-github MCP 面 | ``agents/cloud + connectors/mcp`` | **PASS** | `agents/cloud/acceptance_cm0908_test.mbt`::acceptance_CM-0908_github_mcp_pr_list_get_comment — list/get PR + 评论可测。覆盖验收。| MoonBit核 |
| CM-1001 | MAIL-01 · D-MAIL | ListEmailInboxes | ``connectors/mail`` | **PASS** | `connectors/mail/acceptance_mail_test.mbt`::acceptance_CM-1001_list_inboxes_empty_then_claimed | MoonBit核 |
| CM-1002 | MAIL-02 · D-MAIL | CheckEmailInboxAvailability | ``connectors/mail`` | **PASS** | `connectors/mail/acceptance_mail_test.mbt`::acceptance_CM-1002_check_availability | MoonBit核 |
| CM-1003 | MAIL-02 · D-MAIL | ClaimEmailInbox | ``connectors/mail + security`` | **PASS** | `connectors/mail/acceptance_mail_test.mbt`::acceptance_CM-1003_claim_requires_user_selection | MoonBit核 |
| CM-1004 | D-MAIL | SearchEmailThreads / ReadEmailThread | ``connectors/mail`` | **PASS** | `connectors/mail/acceptance_cm1004_attach_test.mbt`::acceptance_CM-1004_thread_attachment_openable (+search_and_read_thread) — search→thread_id；/workspace 附件 openable；open_attachment；非 openable 拒。覆盖验收。 | MoonBit核 |
| CM-1005 | CHAN-05/MAIL-05 · D-CHAN/D-MAIL | DraftExternalMessage（email） | ``connectors/mail + ui_protocol`` | **PASS** | `connectors/mail/acceptance_mail_test.mbt`::acceptance_CM-1005_draft_card_send_only_on_press | MoonBit核 |
| CM-1006 | MAIL-03 · D-MAIL | 用户 Gmail/Outlook 代发 | ``connectors/mail + send-on-behalf`` | **PASS** | `connectors/mail/acceptance_send_on_behalf_test.mbt`::acceptance_CM-1006_send_on_behalf_pick_acco... | MoonBit核 |
| CM-1101 | CHAN-03 · D-CHAN | Channels skill / 入站 [inbound] | ``channels/inbound`` | **PASS** | `channels/acceptance_cm110x_test.mbt`::acceptance_CM-1101_omit_channel_stays_in_chat — omit hint→Chat；外部 slack/email 标 external。覆盖验收。| MoonBit核 |
| CM-1102 | CHAN-02 · D-CHAN | Slack 地址模型 | ``channels/slack`` | **PASS** | `channels/acceptance_cm110x_test.mbt`::acceptance_CM-1102_slack_thread_dm_toplevel — C:ts→Thread；U/D→Dm；bare C→TopLevel。覆盖验收。| MoonBit核 |
| CM-1104 | D-CHAN | 渠道降级（无 widget） | ``channels + ui_protocol`` | **PASS** | `channels/acceptance_cm110x_test.mbt`::acceptance_CM-1104_channel_degrades_no_bare_widget — external Widget→Text/link；chat 可留 Widget。覆盖验收。| MoonBit核 |
| CM-1106 | D-CHAN | secret-request 凭证收集 | ``ui_protocol + security`` | **PASS** | `ui_protocol/acceptance_cm1106_test.mbt`::acceptance_CM-1106_secret_request_no_plaintext — vault handle；transcript 无明文；paste token 拒。覆盖验收。| MoonBit核 |
| CM-1201 | AGENT-01 · D-AGENT | Task executor 子代理 | ``agents/task`` | **PASS** | `agents/task/acceptance_task_test.mbt`::acceptance_CM-1201_executor_dispatch_no_user_send | MoonBit核 |
| CM-1202 | DESK-01/AGENT-02 · D-DESK/D-AGENT | Task computerUse | ``agents/computer_use`` | **PASS** | `agents/computer_use/acceptance_cm1202_test.mbt`::acceptance_CM-1202_computer_use_task_outcome_only — 只收 outcome；结构化报告。覆盖验收。| MoonBit核 |
| CM-1206 | D-AGENT | Check 子代理状态 | ``agents/task + runtime`` | **PASS** | `agents/task/acceptance_task_test.mbt`::acceptance_CM-1206_check_status | MoonBit核 |
| CM-1207 | AGENT-06 · D-AGENT | Stop 子代理 | ``agents/task`` | **PASS** | `agents/task/acceptance_task_test.mbt`::acceptance_CM-1207_stop_no_side_effects | MoonBit核 |
| CM-1208 | TURN-08/AGENT-09 · D-TURN/D-AGENT | WakeParent | ``agents + runtime`` | **PASS** | `agents/task/acceptance_task_test.mbt`::acceptance_CM-1208_wake_parent_with_summary | MoonBit核 |
| CM-1301 | CLOUD-01 · D-CLOUD | CloudAgent 启动 | ``agents/cloud`` | **PASS** | `agents/cloud/acceptance_cm130x_test.mbt`::acceptance_CM-1301_1302_cloud_agent_lifecycle — launch→bcId+cursor.com/agents 链接；状态可查。覆盖验收。| MoonBit核 |
| CM-1302 | CLOUD-04 · D-CLOUD | CloudAgent 状态/日志 | ``agents/cloud`` | **PASS** | `agents/cloud/acceptance_cm130x_test.mbt`::acceptance_CM-1301_1302_cloud_agent_lifecycle — Succeeded≠Failed 可区分。覆盖验收。| MoonBit核 |
| CM-1304 | CLOUD-03 · D-CLOUD | GitHub 集成 | ``agents/cloud`` | **PASS** | `agents/cloud/acceptance_cm130x_test.mbt`::acceptance_CM-1304_pr_comment_and_diff_mock — MockGithub create_pr_comment + read_pr_diff。覆盖验收。| MoonBit核 |
| CM-1501 | SEC-05/BUY-04/PERM-01 · D-SEC/D-BUY/D-PERM | 不可逆动作闸门 | ``security/approval`` | **PASS** | `security/acceptance_sec_test.mbt`::acceptance_CM-1501_no_explicit_request_draft_only — 无明示→Draft... | MoonBit核 |
| CM-1502 | BOX-09/MCP-08/SEC-03 · D-BOX/D-MCP/D-SEC | Auto-review | ``security/autoreview`` | **PASS** | `runtime/acceptance_cm1502_1503_test.mbt`::acceptance_CM-1502_autoreview_blocks_high_risk — Destructive/irr Shell/CloudAgent → Deny|NeedUser + reason。覆盖验收。| MoonBit核 |
| CM-1503 | SEC-04 · D-SEC | smart mode 同动作重试 | ``security/autoreview`` | **PASS** | `runtime/acceptance_cm1502_1503_test.mbt`::acceptance_CM-1503_smart_mode_same_action_only — 同 fingerprint Allow；rewrite/bypass Deny。覆盖验收。| MoonBit核 |
| CM-1504 | SEC-01/SEC-02 · D-SEC | Untrusted content fences | ``security/fence`` | **PASS** | `security/acceptance_sec_test.mbt`::acceptance_CM-1504_fence_qingfasong_no_external_send_effect —... | MoonBit核 |
| CM-1505 | D-SEC/D-PERM | Auto-review 块通知例外 | ``security/fence`` | **PASS** | `runtime/acceptance_cm1505_1506_test.mbt`::acceptance_CM-1505_autoreview_block_notice_exception — 己方 FollowHostRetry；外部伪造 IgnoreAsData。覆盖验收。| MoonBit核 |
| CM-1506 | SEC-07 · D-SEC | 禁止凭证外泄 | ``security`` | **PASS** | `runtime/acceptance_cm1505_1506_test.mbt`::acceptance_CM-1506_credential_exfiltration_blocked — token/cookie/私钥旁路 Blocked。覆盖验收。| MoonBit核 |
| CM-1604 | MAIL-07 · D-MAIL | ReadEmailAttachment / UploadFile | ``tools + connectors`` | **PASS** | `connectors/mail/acceptance_cm1604_test.mbt`::acceptance_CM-1604_email_attachment_upload_path_contract — 大文件不截断；/workspace 路径契约。覆盖验收。| MoonBit核 |
| CM-1605 | FILE-03 · D-FILE | inline 图片理解 | ``tools/box`` | **PASS** | `box_host/acceptance_cm1605_test.mbt`::acceptance_CM-1605_inline_image_understandable — 截图/用户图可描述。覆盖验收。| MoonBit核 |
| CM-1701 | D-FILE(tools/web) | WebSearch | ``tools/web`` | **PASS** | `tools/acceptance_web_test.mbt`::acceptance_CM-1701_summary_url_current_year — snippet+URL；normalize 注入当前年。覆盖验收。 | MoonBit核 |
| CM-1702 | D-FILE(tools/web) | WebFetch | ``tools/web`` | **PASS** | `tools/acceptance_web_test.mbt`::acceptance_CM-1702_auth_page_fails_clearly (+web_fetch) — 200 正文；/login→401/auth 明确失败。覆盖验收。 | MoonBit核 |
| CM-1802 | BUY-02/BUY-04 · D-BUY | purchases 购买 | ``connectors/commerce + security`` | **PASS** | `connectors/commerce/acceptance_cm1802_test.mbt`::acceptance_CM-1802_purchases_require_explicit_user — 无明示不付款；支付需用户在场；凭证不进 transcript。覆盖验收。| MoonBit核（垂直） |
| CM-1901 | D-PROF(Host UI) | Settings 入口 | ``Host UI`` | **PASS** | **kernel-contract PASS** `ui_protocol/acceptance_cm1901_1902_1907_test.mbt`::acceptance_CM-1901_settings_entry_closed_set — 仅三入口；禁齿轮假路径；**host-integration I-PASS**（升裁 H2·C′复核）| Bit架构+MoonBit核 |
| CM-1902 | D-PROF(Host UI) | Settings tabs 与锚点 | ``Host UI`` | **PASS** | **kernel-contract PASS** `ui_protocol/acceptance_cm1901_1902_1907_test.mbt`::acceptance_CM-1902_settings_anchor_deeplink_bijection — 27 锚点双射深链；**host-integration I-PASS**（升裁 H2·C′复核）| Bit架构+MoonBit核 |
| CM-1903 | D-PROF(Host UI) | Update Bot's Computer | ``Host + tools/box`` | **PASS** | **kernel-contract PASS** `box_host/acceptance_cm0806_1903_1905_test.mbt`::acceptance_CM-1903_update_computer_two_step_prefer_guide — 两步确认；指引优先于 Reset；**host-integration I-PASS**（升裁 H2·批2）| Bit架构+MoonBit核 |
| CM-1905 | D-PROF(Host UI) | local-execution 设置 | ``Host + tools/machines`` | **PASS** | **kernel-contract PASS** `box_host/acceptance_cm0806_1903_1905_test.mbt`::acceptance_CM-1905_local_execution_off_rejects_machine — 关闭后 machine 调用被拒；**host-integration I-PASS**（升裁 H2·批2）| Bit架构+MoonBit核 |
| CM-1907 | D-PROF(Host UI) | 删除助手 | ``Host UI`` | **PASS** | **kernel-contract PASS** `ui_protocol/acceptance_cm1901_1902_1907_test.mbt`::acceptance_CM-1907_delete_agent_confirm_not_settings — 侧栏右键+确认；非 Settings；**host-integration I-PASS**（升裁 H2·C′复核）| Bit架构+MoonBit核 |
| CM-2001 | TIME-01/TIME-02/TIME-03 · D-TIME | 用户时区报告 | ``core/time + runtime`` | **PASS** | `runtime/acceptance_cm2001_2007_2008_test.mbt`::acceptance_CM-2001_user_timezone_report — UTC Z 先转换再展示；带 Asia/Shanghai 标签。覆盖验收。| MoonBit核 |
| CM-2002 | COMM-06 · D-COMM | 语言跟随 | ``runtime + Host UI`` | **PASS** | `runtime/acceptance_cm2002_test.mbt`::acceptance_CM-2002_language_follow_zh_ask_zh_answer — 中文询问中文答。覆盖验收。| Bit架构+MoonBit核 |
| CM-2003 | CHAN-03 · D-CHAN | 隐藏 cue [inbound] | ``channels/inbound + runtime`` | **PASS** | `runtime/acceptance_cm2003_test.mbt`::acceptance_CM-2003_hidden_inbound_cue_not_spoken — strip cue；should_user_ack=false；不朗读 cue。覆盖验收。| MoonBit核 |
| CM-2007 | D-TIME/D-TURN | 系统提醒 automation_status / timestamp | ``runtime`` | **PASS** | `runtime/acceptance_cm2001_2007_2008_test.mbt`::acceptance_CM-2007_automation_status_uses_latest_timestamp — routine 相位用最新 timestamp。覆盖验收。| MoonBit核 |
| CM-2008 | D-TIME/D-TURN | 身份自称 Grok Bot→Bit Bot | ``runtime + prompt`` | **PASS** | `runtime/acceptance_cm2001_2007_2008_test.mbt`::acceptance_CM-2008_identity_product_name_only — 询问模型只答 Bit Bot。覆盖验收。| MoonBit核 |
| CM-2112 | D-补遗 | 策略引擎：offensive_cyber | ``security/policy`` | **PASS** | `security/acceptance_cm2112_2130_test.mbt`::acceptance_CM-2112_offensive_cyber_short_refuse — 短拒无步骤/无 PoC。覆盖验收。| MoonBit核 |
| CM-2113 | D-补遗 | 策略引擎：child_sex | ``security/policy`` | **PASS** | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2113_child_sex_illegal_stop — illegal + terminal_stop。覆盖验收。| MoonBit核 |
| CM-2114 | D-补遗 | 策略引擎：武器与 dual_use_bio | ``security/policy`` | **PASS** | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2114_weapons_dual_use_bio_refuse — 拒武器化/dual_use_bio。覆盖验收。| MoonBit核 |
| CM-2115 | D-补遗 | 策略引擎：犯罪协助 | ``security/policy`` | **PASS** | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2115_crime_assistance_short_refuse — 短拒。覆盖验收。| MoonBit核 |
| CM-2121 | D-补遗 | 策略：offensive_cyber 拒 | ``security/policy`` | **PASS** | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2121_offensive_cyber_refuse_no_detail — 短拒无利用细节。覆盖验收。| MoonBit核 |
| CM-2122 | D-补遗 | 策略：child_sex 拒 | ``security/policy`` | **PASS** | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2122_child_sex_refuse_illegal_stop — illegal + stop。覆盖验收。| MoonBit核 |
| CM-2123 | D-补遗 | 策略：武器/双用途生物拒 | ``security/policy`` | **PASS** | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2123_weapons_bio_refuse — 拒武器化/病原增强。覆盖验收。| MoonBit核 |
| CM-2124 | D-补遗 | 策略：犯罪协助拒 | ``security/policy`` | **PASS** | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2124_crime_help_refuse — 拒犯罪帮助。覆盖验收。| MoonBit核 |
| CM-2126 | D-补遗 | 策略：self_harm 关怀 | ``security/policy`` | **PASS** | `security/acceptance_cm2113_2126_test.mbt`::acceptance_CM-2126_self_harm_care_988_no_methods — 关怀+988；无 methods。覆盖验收。| MoonBit核 |
| CM-2127 | D-补遗 | 入站邮件不自动回复 | ``connectors/mail`` | **PASS** | `connectors/mail/acceptance_cm2127_test.mbt`::acceptance_CM-2127_inbound_mail_no_auto_reply — 摘要/草稿；无自动发往原发件人。覆盖验收。| MoonBit核 |
| CM-2129 | D-补遗 | credential-request 填充 | ``ui_protocol + security`` | **PASS** | `security/acceptance_cm2129_2143_test.mbt`::acceptance_CM-2129_credential_request_fill_no_plaintext — 命中填充成功；无明文回传。覆盖验收。| MoonBit核 |
| CM-2130 | D-补遗 | ListCredentials | ``connectors + security`` | **PASS** | `security/acceptance_cm2112_2130_test.mbt`::acceptance_CM-2130_list_credentials_no_secret_plaintext — List 仅元数据；无密钥明文。覆盖验收。| MoonBit核 |
| CM-2133 | TURN-08 · D-TURN | 禁止空转轮询子代理 | ``runtime + agents`` | **PASS** | `agents/task/acceptance_cm2133_test.mbt`::acceptance_CM-2133_no_busy_loop_check_subagent — 完成唤醒；拒 busy-loop Check。覆盖验收。| MoonBit核 |
| CM-2134 | MCP-05 · D-MCP | needsGrant 状态 | ``connectors/mcp`` | **PASS** | `tools/acceptance_cm2134_test.mbt`::acceptance_CM-2134_needs_grant_refuse_then_grant_flow — NeedsGrant 拒；授予后恢复。覆盖验收。| MoonBit核 |
| CM-2137 | FILE-01 · D-FILE | 入站附件 AttachmentRef | ``ui_protocol + tools`` | **PASS** | `ui_protocol/acceptance_cm2137_test.mbt`::acceptance_CM-2137_inbound_attachment_ref_readable — AttachmentRef 可读。覆盖验收。| MoonBit核 |
| CM-2138 | TURN-10 · D-TURN | 多 Effect 批出 | ``runtime/turn`` | **PASS** | `runtime/acceptance_cm2138_2140_test.mbt`::acceptance_CM-2138_multi_effect_batch_ge2 — Effect[]≥2。覆盖验收。| MoonBit核 |
| CM-2139 | D-补遗 | 可逆默认自主 | ``runtime/autonomy`` | **PASS** | `runtime/acceptance_cm2138_2140_test.mbt`::acceptance_CM-2139_reversible_autonomy_no_ask — 授权内可逆不问直接做。覆盖验收。| MoonBit核 |
| CM-2140 | D-补遗 | 禁止捏造事实 | ``runtime/honesty`` | **PASS** | `runtime/acceptance_cm2138_2140_test.mbt`::acceptance_CM-2140_no_fabricated_facts_admit_gap — 明说缺失+真实路径。覆盖验收。| MoonBit核 |
| CM-2142 | D-补遗 | 草稿卡「发送」精确重发 | ``connectors/mail + security`` | **PASS** | `connectors/mail/acceptance_cm2142_test.mbt`::acceptance_CM-2142_draft_card_send_verbatim_once — 原样发送一次；拒改字。覆盖验收。| MoonBit核 |
| CM-2143 | SEC-06/PERM-04 · D-SEC/D-PERM | 拒发终态不可旁路 | ``security/approval`` | **PASS** | `security/acceptance_cm2129_2143_test.mbt`::acceptance_CM-2143_refused_send_no_channel_bypass — 拒发不换通道旁路。覆盖验收。| MoonBit核 |
| CM-2147 | D-补遗 | 禁止自写连接 URL | ``connectors/mcp`` | **PASS** | `tools/acceptance_cm2147_test.mbt`::acceptance_CM-2147_no_homemade_connect_url — 仅官方 Install/Authenticate；拒自造 URL。覆盖验收。| MoonBit核 |
| CM-2152 | PROF-04 · D-PROF | 首启有描述直接开工 | ``runtime/onboarding`` | **PASS** | `runtime/acceptance_cm2152_2154_test.mbt`::acceptance_CM-2152_first_turn_with_description_start — description 非空短宣告并开工。覆盖验收。| MoonBit核 |
| CM-2154 | D-补遗 | InboundKind Agent 分流 | ``runtime/inbound`` | **PASS** | `runtime/acceptance_cm2152_2154_test.mbt`::acceptance_CM-2154_inbound_agent_not_user_question — [agent] 不当作用户提问。覆盖验收。| MoonBit核 |
| CM-2159 | BOX-07 · D-BOX | 工作目录 | ``tools/box`` | **PASS** | `box_host/acceptance_cm2159_test.mbt`::acceptance_CM-2159_working_directory_param_effective — working_directory 生效为 cwd。覆盖验收。| MoonBit核 |
| CM-2160 | DESK-03 · D-DESK | 浏览器导航 | ``agents/computer_use`` | **PASS** | **kernel-contract PASS** `agents/computer_use/acceptance_cm2160_test.mbt`::acceptance_CM-2160_browser_navigate_public_reachable — 公开页可达（mock）；**host-integration GAP**（真屏浏览属 I）| MoonBit核 |
| CM-2162 | AGENT-10 · D-AGENT | 子代理审批冒泡 | ``security`+`agents`` | **PASS** | `security/acceptance_cm2162_2169_2170_test.mbt`::acceptance_CM-2162_child_approval_bubbles_to_parent — 父可见 ApprovalCard。覆盖验收。| MoonBit核 |
| CM-2169 | MAIL-08 · D-MAIL | 不可从 Agent Inbox 擅自发 | ``security`` | **PASS** | `security/acceptance_cm2162_2169_2170_test.mbt`::acceptance_CM-2169_agent_inbox_no_unauthorized_send — 只回报父级草稿。覆盖验收。| MoonBit核 |
| CM-2170 | SEC-08 · D-SEC | 安全适配非绕过 | ``docs+security`` | **PASS** | `security/acceptance_cm2162_2169_2170_test.mbt`::acceptance_CM-2170_safer_path_not_bypass_rewrite — 正当降权 ≠ 改命令绕过。覆盖验收。| MoonBit核 |
| CM-2171 | BUY-03 · D-BUY | 凭证录入 | ``commerce+security`` | **PASS** | `connectors/commerce/acceptance_cm2171_test.mbt`::acceptance_CM-2171_credential_entry_secure_form_no_log — 安全表单；不明文落日志。覆盖验收。| MoonBit核 |
| CM-2176 | PERM-02 · D-PERM | 任务描述≠许可 | ``security`` | **PASS** | `security/acceptance_cm2176_2177_test.mbt`::acceptance_CM-2176_task_description_not_permission — 拆解/记忆不算批准。覆盖验收。| MoonBit核 |
| CM-2177 | PERM-03 · D-PERM | 草稿回报父级 | ``agents+mail`` | **PASS** | `security/acceptance_cm2176_2177_test.mbt`::acceptance_CM-2177_executor_draft_reported_to_parent — 最终消息含全文草稿。覆盖验收。| MoonBit核 |

## 非 P0 摘要

P1+P2 共 117：PASS=117 FAIL=0 GAP=0（含 host-integration 跟踪：BB 批 2157 + AA 批 1602/2109 + S/Y/M–Z Host 切片；索引表主裁决 GAP=0）。**P2 FAIL 收口完毕。**

## 全量对照附录

| ID | 架构短号 | 优先级 | 矩阵状态 | 裁决 | 模块 |
|----|----------|--------|----------|------|------|
| CM-0101 | TURN-01 · D-TURN | P0 | in_progress | **PASS** | ``ui_protocol/message`` |
| CM-0102 | TURN-02 · D-TURN | P0 | in_progress | **PASS** | ``runtime/turn + ui_protocol`` |
| CM-0103 | TURN-03 · D-TURN | P0 | in_progress | **PASS** | ``runtime/turn + ui_protocol`` |
| CM-0104 | TURN-04 · D-TURN | P0 | in_progress | **PASS** | ``runtime/turn`` |
| CM-0105 | COMM-03 · D-COMM | P0 | in_progress | **PASS** | ``ui_protocol/widget`` |
| CM-0106 | FILE-02 · D-FILE | P0 | in_progress | **PASS** | ``ui_protocol/attachment`` |
| CM-0107 | TURN-05 · D-TURN | P1 | todo | **PASS** | ``ui_protocol/message + skills/voice`` |
| CM-0108 | CHAN-01 · D-CHAN | P0 | in_progress | **PASS** | ``ui_protocol + channels`` |
| CM-0109 | TURN-06 · D-TURN | P0 | in_progress | **PASS** | ``channels/slack`` |
| CM-0110 | D-TURN/D-COMM | P1 | todo | **PASS** | ``channels/inbound`` |
| CM-0111 | COMM-01/COMM-02 · D-COMM | P0 | in_progress | **PASS** | ``ui_protocol/message`` |
| CM-0112 | TURN-09 · D-TURN | P1 | todo | **PASS** | ``runtime/todo`` |
| CM-0201 | PROF-01 · D-PROF | P0 | todo | **PASS** | ``memory/profile + ui_protocol`` |
| CM-0202 | PROF-02 · D-PROF | P1 | todo | **PASS** | ``memory/profile + ui_protocol`` |
| CM-0203 | PROF-03 · D-PROF | P0 | todo | **PASS** | ``ui_protocol + Host`` |
| CM-0204 | D-PROF | P1 | todo | **PASS** | ``agents + Host`` |
| CM-0205 | D-PROF | P1 | todo | **PASS** | ``Host UI + ui_protocol`` |
| CM-0206 | D-PROF | P2 | todo | **PASS** | ``Host UI + memory/profile`` |
| CM-0301 | MEM-01/MEM-06 · D-MEM | P0 | todo | **PASS** | ``memory/profile`` |
| CM-0302 | MEM-02 · D-MEM | P1 | todo | **PASS** | ``memory/journal`` |
| CM-0303 | MEM-03 · D-MEM | P1 | todo | **PASS** | ``memory/shared`` |
| CM-0304 | MEM-04 · D-MEM | P0 | in_progress | **PASS** | ``memory/recall`` |
| CM-0305 | MEM-05 · D-MEM | P0 | in_progress | **PASS** | ``memory/recall`` |
| CM-0306 | D-MEM | P0 | in_progress | **PASS** | ``security + memory`` |
| CM-0401 | RTN-03 · D-RTN | P0 | in_progress | **PASS** | ``routines/lifecycle`` |
| CM-0402 | RTN-01 · D-RTN | P0 | in_progress | **PASS** | ``routines/cron`` |
| CM-0403 | D-RTN | P0 | in_progress | **PASS** | ``routines/cron`` |
| CM-0404 | D-RTN | P0 | in_progress | **PASS** | ``routines/cron`` |
| CM-0405 | D-RTN | P0 | in_progress | **PASS** | ``routines/cron`` |
| CM-0406 | RTN-02 · D-RTN | P0 | todo | **PASS** | ``routines/events`` |
| CM-0407 | D-RTN | P0 | todo | **PASS** | ``routines/events`` |
| CM-0408 | D-RTN | P1 | todo | **PASS** | ``routines/events`` |
| CM-0409 | D-RTN | P2 | todo | **PASS** | ``routines/events`` |
| CM-0410 | D-RTN | P1 | todo | **PASS** | ``routines/events + connectors/mail`` |
| CM-0411 | D-RTN | P1 | todo | **PASS** | ``routines/events`` |
| CM-0412 | D-RTN | P1 | todo | **PASS** | ``routines/events`` |
| CM-0413 | RTN-06 · D-RTN | P0 | in_progress | **PASS** | ``routines/lifecycle`` |
| CM-0414 | RTN-06 · D-RTN | P1 | todo | **PASS** | ``routines/lifecycle`` |
| CM-0415 | D-RTN | P0 | todo | **PASS** | ``routines/lifecycle + security`` |
| CM-0416 | D-RTN | P0 | todo | **PASS** | ``routines/lifecycle`` |
| CM-0417 | D-RTN | P1 | todo | **PASS** | ``routines + runtime`` |
| CM-0501 | SKILL-01 · D-SKILL | P0 | todo | **PASS** | ``skills/catalog`` |
| CM-0502 | SKILL-02 · D-SKILL | P1 | todo | **PASS** | ``skills/catalog`` |
| CM-0503 | SKILL-03 · D-SKILL | P1 | todo | **PASS** | ``skills/catalog + connectors`` |
| CM-0504 | SKILL-04 · D-SKILL | P0 | todo | **PASS** | ``skills/runner`` |
| CM-0505 | D-SKILL | P1 | todo | **PASS** | ``skills/catalog`` |
| CM-0506 | D-SKILL | P2 | todo | **PASS** | ``skills + managed skill`` |
| CM-0507 | D-SKILL | P1 | todo | **PASS** | ``skills/catalog + agents/computer_use`` |
| CM-0601 | BOX-01 · D-BOX | P0 | in_progress | **PASS** | ``tools/box`` |
| CM-0602 | FILE-08/BOX-02 · D-FILE/D-BOX | P0 | in_progress | **PASS** | ``tools/box`` |
| CM-0603 | BOX-03/BOX-04/MEM-06 · D-BOX/D-MEM | P0 | in_progress | **PASS** | ``tools/box + Host`` |
| CM-0604 | BOX-06/BOX-08 · D-BOX | P0 | in_progress | **PASS** | ``tools/box`` |
| CM-0605 | FILE-03/DESK-02 · D-FILE/D-DESK | P0 | in_progress | **PASS** | ``tools/desktop`` |
| CM-0606 | DESK-06/DESK-07 · D-DESK | P0 | in_progress | **PASS** | ``tools/desktop + Host`` |
| CM-0607 | D-BOX | P1 | todo | **PASS** | ``tools/box + Host`` |
| CM-0608 | D-BOX | P2 | todo | **PASS** | ``tools/box`` |
| CM-0609 | STORE-01 · D-STORE | P1 | todo | **PASS** | ``stores`` |
| CM-0701 | MACH-01 · D-MACH | P0 | todo | **PASS** | ``tools/machines`` |
| CM-0702 | MACH-02/MACH-03 · D-MACH | P0 | todo | **PASS** | ``tools/machines + security`` |
| CM-0703 | MACH-04 · D-MACH | P0 | todo | **PASS** | ``tools/machines`` |
| CM-0704 | MACH-05 · D-MACH | P0 | todo | **PASS** | ``tools/machines`` |
| CM-0705 | MACH-06 · D-MACH | P2 | todo | **PASS** | ``tools/machines`` |
| CM-0706 | MACH-07 · D-MACH | P1 | todo | **PASS** | ``tools/machines + runtime`` |
| CM-0801 | DESK-01 · D-DESK | P0 | in_progress | **PASS** | ``agents/computer_use`` |
| CM-0802 | D-DESK | P1 | todo | **PASS** | ``agents/computer_use + Host`` |
| CM-0803 | DESK-04/DESK-05 · D-DESK | P0 | in_progress | **PASS** | ``skills + connectors/commerce + security`` |
| CM-0804 | COMM-04/BUY-01 · D-COMM/D-BUY | P0 | todo | **PASS** | ``ui_protocol + skills`` |
| CM-0805 | D-DESK | P1 | todo | **PASS** | ``agents/computer_use + ui_protocol`` |
| CM-0806 | D-DESK | P0 | todo | **PASS** | ``Host + tools/box`` |
| CM-0901 | MCP-01 · D-MCP | P0 | in_progress | **PASS** | ``connectors/mcp + tools/dynamic`` |
| CM-0902 | FILE-07/MCP-02 · D-FILE/D-MCP | P0 | in_progress | **PASS** | ``tools/dynamic`` |
| CM-0903 | MCP-03 · D-MCP | P0 | in_progress | **PASS** | ``connectors/mcp + security`` |
| CM-0904 | MCP-04 · D-MCP | P1 | todo | **PASS** | ``connectors/mcp + skills`` |
| CM-0905 | MCP-05 · D-MCP | P0 | in_progress | **PASS** | ``connectors/mcp`` |
| CM-0906 | D-MCP | P0 | todo | **PASS** | ``connectors/mail`` |
| CM-0907 | D-MCP | P2 | todo | **PASS** | ``connectors/mcp`` |
| CM-0908 | D-MCP | P0 | todo | **PASS** | ``agents/cloud + connectors/mcp`` |
| CM-0909 | D-MCP | P1 | todo | **PASS** | ``agents/cloud + connectors/mcp`` |
| CM-0910 | D-MCP | P2 | todo | **PASS** | ``connectors/mcp + tools/web`` |
| CM-1001 | MAIL-01 · D-MAIL | P0 | in_progress | **PASS** | ``connectors/mail`` |
| CM-1002 | MAIL-02 · D-MAIL | P0 | in_progress | **PASS** | ``connectors/mail`` |
| CM-1003 | MAIL-02 · D-MAIL | P0 | in_progress | **PASS** | ``connectors/mail + security`` |
| CM-1004 | D-MAIL | P0 | in_progress | **PASS** | ``connectors/mail`` |
| CM-1005 | CHAN-05/MAIL-05 · D-CHAN/D-MAIL | P0 | in_progress | **PASS** | ``connectors/mail + ui_protocol`` |
| CM-1006 | MAIL-03 · D-MAIL | P0 | in_progress | **PASS** | ``connectors/mail + send-on-behalf`` |
| CM-1007 | MAIL-06 · D-MAIL | P1 | todo | **PASS** | ``connectors/mail`` |
| CM-1008 | D-MAIL | P1 | todo | **PASS** | ``connectors/mail`` |
| CM-1009 | D-MAIL | P2 | todo | **PASS** | ``connectors/mail`` |
| CM-1010 | D-MAIL | P1 | todo | **PASS** | ``skills/send-on-behalf`` |
| CM-1101 | CHAN-03 · D-CHAN | P0 | todo | **PASS** | ``channels/inbound`` |
| CM-1102 | CHAN-02 · D-CHAN | P0 | todo | **PASS** | ``channels/slack`` |
| CM-1103 | D-CHAN | P1 | todo | **PASS** | ``channels/slack`` |
| CM-1104 | D-CHAN | P0 | todo | **PASS** | ``channels + ui_protocol`` |
| CM-1105 | D-CHAN | P1 | todo | **PASS** | ``channels/slack`` |
| CM-1106 | D-CHAN | P0 | todo | **PASS** | ``ui_protocol + security`` |
| CM-1107 | D-CHAN | P2 | todo | **PASS** | ``channels`` |
| CM-1201 | AGENT-01 · D-AGENT | P0 | in_progress | **PASS** | ``agents/task`` |
| CM-1202 | DESK-01/AGENT-02 · D-DESK/D-AGENT | P0 | todo | **PASS** | ``agents/computer_use`` |
| CM-1203 | AGENT-03 · D-AGENT | P1 | todo | **PASS** | ``agents/task`` |
| CM-1204 | AGENT-04/AGENT-05 · D-AGENT | P1 | todo | **PASS** | ``agents/task + tools/media`` |
| CM-1205 | D-AGENT | P1 | todo | **PASS** | ``agents/task`` |
| CM-1206 | D-AGENT | P0 | in_progress | **PASS** | ``agents/task + runtime`` |
| CM-1207 | AGENT-06 · D-AGENT | P0 | in_progress | **PASS** | ``agents/task`` |
| CM-1208 | TURN-08/AGENT-09 · D-TURN/D-AGENT | P0 | in_progress | **PASS** | ``agents + runtime`` |
| CM-1301 | CLOUD-01 · D-CLOUD | P0 | todo | **PASS** | ``agents/cloud`` |
| CM-1302 | CLOUD-04 · D-CLOUD | P0 | todo | **PASS** | ``agents/cloud`` |
| CM-1303 | CLOUD-02 · D-CLOUD | P1 | todo | **PASS** | ``agents/cloud`` |
| CM-1304 | CLOUD-03 · D-CLOUD | P0 | todo | **PASS** | ``agents/cloud`` |
| CM-1305 | D-CLOUD | P1 | todo | **PASS** | ``skills + agents/cloud`` |
| CM-1306 | CLOUD-05 · D-CLOUD | P1 | todo | **PASS** | ``security/autoreview + agents/cloud`` |
| CM-1401 | TEAM-02 · D-TEAM | P1 | todo | **PASS** | ``agents/teammates`` |
| CM-1402 | TEAM-01 · D-TEAM | P1 | todo | **PASS** | ``agents/teammates`` |
| CM-1403 | TEAM-03 · D-TEAM | P2 | todo | **PASS** | ``agents/teammates`` |
| CM-1404 | D-TEAM | P1 | todo | **PASS** | ``agents/teammates + skills`` |
| CM-1405 | D-TEAM | P2 | todo | **PASS** | ``Host UI + agents/teammates`` |
| CM-1406 | D-TEAM | P2 | todo | **PASS** | ``skills`` |
| CM-1501 | SEC-05/BUY-04/PERM-01 · D-SEC/D-BUY/D-PERM | P0 | in_progress | **PASS** | ``security/approval`` |
| CM-1502 | BOX-09/MCP-08/SEC-03 · D-BOX/D-MCP/D-SEC | P0 | in_progress | **PASS** | ``security/autoreview`` |
| CM-1503 | SEC-04 · D-SEC | P0 | in_progress | **PASS** | ``security/autoreview`` |
| CM-1504 | SEC-01/SEC-02 · D-SEC | P0 | in_progress | **PASS** | ``security/fence`` |
| CM-1505 | D-SEC/D-PERM | P0 | in_progress | **PASS** | ``security/fence`` |
| CM-1506 | SEC-07 · D-SEC | P0 | in_progress | **PASS** | ``security`` |
| CM-1507 | D-SEC/D-PERM | P1 | todo | **PASS** | ``Host UI + security`` |
| CM-1601 | FILE-05 · D-FILE | P1 | todo | **PASS** | ``tools/media + ui_protocol`` |
| CM-1602 | FILE-06 · D-FILE | P2 | todo | **PASS** | ``tools/media`` |
| CM-1603 | D-FILE | P1 | todo | **PASS** | ``agents/task + tools/media`` |
| CM-1604 | MAIL-07 · D-MAIL | P0 | todo | **PASS** | ``tools + connectors`` |
| CM-1605 | FILE-03 · D-FILE | P0 | todo | **PASS** | ``tools/box`` |
| CM-1701 | D-FILE(tools/web) | P0 | in_progress | **PASS** | ``tools/web`` |
| CM-1702 | D-FILE(tools/web) | P0 | in_progress | **PASS** | ``tools/web`` |
| CM-1703 | D-FILE(tools/web) | P1 | todo | **PASS** | ``tools/web + agents/computer_use`` |
| CM-1801 | D-SKILL/D-BUY | P1 | todo | **PASS** | ``skills + connectors`` |
| CM-1802 | BUY-02/BUY-04 · D-BUY | P0 | todo | **PASS** | ``connectors/commerce + security`` |
| CM-1803 | D-SKILL/D-BUY | P2 | todo | **PASS** | ``skills`` |
| CM-1804 | D-SKILL/D-BUY | P2 | todo | **PASS** | ``skills`` |
| CM-1805 | D-SKILL/D-BUY | P2 | todo | **PASS** | ``skills`` |
| CM-1806 | D-SKILL/D-BUY | P2 | todo | **PASS** | ``skills`` |
| CM-1807 | D-SKILL/D-BUY | P1 | todo | **PASS** | ``skills`` |
| CM-1808 | D-SKILL/D-BUY | P2 | todo | **PASS** | ``skills`` |
| CM-1809 | D-SKILL/D-BUY | P1 | todo | **PASS** | ``skills + agents/computer_use`` |
| CM-1810 | D-SKILL/D-BUY | P1 | todo | **PASS** | ``skills + tools/box`` |
| CM-1901 | D-PROF(Host UI) | P0 | todo | **PASS** | ``Host UI`` |
| CM-1902 | D-PROF(Host UI) | P0 | todo | **PASS** | ``Host UI`` |
| CM-1903 | D-PROF(Host UI) | P0 | todo | **PASS** | ``Host + tools/box`` |
| CM-1904 | D-PROF(Host UI) | P1 | todo | **PASS** | ``Host`` |
| CM-1905 | D-PROF(Host UI) | P0 | todo | **PASS** | ``Host + tools/machines`` |
| CM-1906 | D-PROF(Host UI) | P1 | todo | **PASS** | ``Host UI`` |
| CM-1907 | D-PROF(Host UI) | P0 | todo | **PASS** | ``Host UI`` |
| CM-2001 | TIME-01/TIME-02/TIME-03 · D-TIME | P0 | todo | **PASS** | ``core/time + runtime`` |
| CM-2002 | COMM-06 · D-COMM | P0 | todo | **PASS** | ``runtime + Host UI`` |
| CM-2003 | CHAN-03 · D-CHAN | P0 | in_progress | **PASS** | ``channels/inbound + runtime`` |
| CM-2004 | D-TIME/D-TURN | P1 | todo | **PASS** | ``agents/teammates`` |
| CM-2005 | D-TIME/D-TURN | P1 | todo | **PASS** | ``skills/voice + channels`` |
| CM-2006 | PROF-04 · D-PROF | P1 | todo | **PASS** | ``connectors/mail`` |
| CM-2007 | D-TIME/D-TURN | P0 | todo | **PASS** | ``runtime`` |
| CM-2008 | D-TIME/D-TURN | P0 | todo | **PASS** | ``runtime + prompt`` |
| CM-2101 | TURN-07 · D-TURN | P1 | todo | **PASS** | ``ui_protocol`` |
| CM-2102 | COMM-03 · D-COMM | P1 | todo | **PASS** | ``ui_protocol`` |
| CM-2103 | COMM-01 · D-COMM | P1 | todo | **PASS** | ``ui_protocol`` |
| CM-2104 | D-补遗 | P1 | todo | **PASS** | ``runtime/turn`` |
| CM-2105 | D-补遗 | P1 | todo | **PASS** | ``routines`` |
| CM-2106 | D-补遗 | P2 | todo | **PASS** | ``routines`` |
| CM-2107 | D-补遗 | P1 | todo | **PASS** | ``connectors/plugins`` |
| CM-2108 | D-补遗 | P1 | todo | **PASS** | ``connectors/plugins`` |
| CM-2109 | D-补遗 | P2 | todo | **PASS** | ``connectors`` |
| CM-2110 | D-补遗 | P2 | todo | **PASS** | ``skills`` |
| CM-2111 | D-补遗 | P1 | todo | **PASS** | ``skills/site-playbooks`` |
| CM-2112 | D-补遗 | P0 | todo | **PASS** | ``security/policy`` |
| CM-2113 | D-补遗 | P0 | todo | **PASS** | ``security/policy`` |
| CM-2114 | D-补遗 | P0 | todo | **PASS** | ``security/policy`` |
| CM-2115 | D-补遗 | P0 | todo | **PASS** | ``security/policy`` |
| CM-2116 | D-补遗 | P1 | todo | **PASS** | ``security/policy`` |
| CM-2117 | D-补遗 | P2 | todo | **PASS** | ``ui_protocol`` |
| CM-2118 | D-补遗 | P1 | todo | **PASS** | ``skills/user` + non-goals` |
| CM-2119 | STORE-01/STORE-03 · D-STORE | P1 | todo | **PASS** | ``stores`` |
| CM-2120 | MAIL-04 · D-MAIL | P1 | todo | **PASS** | ``connectors/mail`` |
| CM-2121 | D-补遗 | P0 | todo | **PASS** | ``security/policy`` |
| CM-2122 | D-补遗 | P0 | todo | **PASS** | ``security/policy`` |
| CM-2123 | D-补遗 | P0 | todo | **PASS** | ``security/policy`` |
| CM-2124 | D-补遗 | P0 | todo | **PASS** | ``security/policy`` |
| CM-2125 | D-补遗 | P1 | todo | **PASS** | ``security/policy`` |
| CM-2126 | D-补遗 | P0 | todo | **PASS** | ``security/policy`` |
| CM-2127 | D-补遗 | P0 | todo | **PASS** | ``connectors/mail`` |
| CM-2128 | TURN-07 · D-TURN | P1 | todo | **PASS** | ``ui_protocol`` |
| CM-2129 | D-补遗 | P0 | todo | **PASS** | ``ui_protocol + security`` |
| CM-2130 | D-补遗 | P0 | todo | **PASS** | ``connectors + security`` |
| CM-2131 | D-补遗 | P1 | todo | **PASS** | ``ui_protocol + agents/cloud`` |
| CM-2132 | D-补遗 | P1 | todo | **PASS** | ``connectors/mcp`` |
| CM-2133 | TURN-08 · D-TURN | P0 | todo | **PASS** | ``runtime + agents`` |
| CM-2134 | MCP-05 · D-MCP | P0 | todo | **PASS** | ``connectors/mcp`` |
| CM-2135 | D-补遗 | P1 | todo | **PASS** | ``skills/catalog`` |
| CM-2136 | AGENT-07 · D-AGENT | P1 | todo | **PASS** | ``agents/task`` |
| CM-2137 | FILE-01 · D-FILE | P0 | todo | **PASS** | ``ui_protocol + tools`` |
| CM-2138 | TURN-10 · D-TURN | P0 | todo | **PASS** | ``runtime/turn`` |
| CM-2139 | D-补遗 | P0 | todo | **PASS** | ``runtime/autonomy`` |
| CM-2140 | D-补遗 | P0 | todo | **PASS** | ``runtime/honesty`` |
| CM-2141 | D-补遗 | P1 | todo | **PASS** | ``agents/teammates`` |
| CM-2142 | D-补遗 | P0 | todo | **PASS** | ``connectors/mail + security`` |
| CM-2143 | SEC-06/PERM-04 · D-SEC/D-PERM | P0 | todo | **PASS** | ``security/approval`` |
| CM-2144 | D-补遗 | P1 | todo | **PASS** | ``security/approval`` |
| CM-2145 | D-补遗 | P1 | todo | **PASS** | ``memory`` |
| CM-2146 | D-补遗 | P1 | todo | **PASS** | ``connectors + security`` |
| CM-2147 | D-补遗 | P0 | todo | **PASS** | ``connectors/mcp`` |
| CM-2148 | D-补遗 | P1 | todo | **PASS** | ``agents/cloud`` |
| CM-2149 | D-补遗 | P2 | todo | **PASS** | ``agents/teammates`` |
| CM-2150 | D-补遗 | P1 | todo | **PASS** | ``runtime`` |
| CM-2151 | D-补遗 | P2 | todo | **PASS** | ``memory/profile`` |
| CM-2152 | PROF-04 · D-PROF | P0 | todo | **PASS** | ``runtime/onboarding`` |
| CM-2153 | D-补遗 | P2 | todo | **PASS** | ``skills + channels`` |
| CM-2154 | D-补遗 | P0 | in_progress | **PASS** | ``runtime/inbound`` |
| CM-2155 | D-补遗 | P1 | todo | **PASS** | ``routines/events`` |
| CM-2156 | COMM-05 · D-COMM | P1 | todo | **PASS** | ``docs+runtime 策略`` |
| CM-2157 | FILE-04 · D-FILE | P2 | todo | **PASS** | ``tools/media`` |
| CM-2158 | BOX-05 · D-BOX | P1 | todo | **PASS** | ``tools/box`` |
| CM-2159 | BOX-07 · D-BOX | P0 | todo | **PASS** | ``tools/box`` |
| CM-2160 | DESK-03 · D-DESK | P0 | todo | **PASS** | ``agents/computer_use`` |
| CM-2161 | AGENT-08 · D-AGENT | P1 | todo | **PASS** | ``runtime`+`agents`` |
| CM-2162 | AGENT-10 · D-AGENT | P0 | todo | **PASS** | ``security`+`agents`` |
| CM-2163 | MCP-06 · D-MCP | P1 | todo | **PASS** | ``Host+mcp`` |
| CM-2164 | MCP-07 · D-MCP | P1 | todo | **PASS** | ``Host+mcp`` |
| CM-2165 | RTN-04 · D-RTN | P1 | todo | **PASS** | ``routines`+`runtime`` |
| CM-2166 | RTN-05 · D-RTN | P1 | todo | **PASS** | ``routines`` |
| CM-2167 | SKILL-05 · D-SKILL | P1 | todo | **PASS** | ``skills`` |
| CM-2168 | CHAN-04 · D-CHAN | P1 | todo | **PASS** | ``channels`` |
| CM-2169 | MAIL-08 · D-MAIL | P0 | todo | **PASS** | ``security`` |
| CM-2170 | SEC-08 · D-SEC | P0 | todo | **PASS** | ``docs+security`` |
| CM-2171 | BUY-03 · D-BUY | P0 | todo | **PASS** | ``commerce+security`` |
| CM-2172 | TEAM-04 · D-TEAM | P1 | todo | **PASS** | ``security`` |
| CM-2173 | STORE-02 · D-STORE | P1 | todo | **PASS** | ``stores`+tools`` |
| CM-2174 | STORE-04 · D-STORE | P1 | todo | **PASS** | ``Host`` |
| CM-2175 | TIME-04 · D-TIME | P1 | todo | **PASS** | ``Host`` |
| CM-2176 | PERM-02 · D-PERM | P0 | todo | **PASS** | ``security`` |
| CM-2177 | PERM-03 · D-PERM | P0 | todo | **PASS** | ``agents+mail`` |
| CM-2178 | PERM-05 · D-PERM | P1 | todo | **PASS** | ``ui_protocol`` |

## 关闭条件

1. 先救回 Q-SMOKE（现红）。
2. FAIL→PASS：补齐验收原文；证据列只写当前 acceptance_* 测名。
3. A 批禁止再用旧测名打回。

