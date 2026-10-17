# Bit Bot 冒烟清单（Smoke）

> 最低绿线（CHARTER）：`moon check && moon test && moon run cmd/main`  
> 环境：box · 模块 `bitbot/bitbot` · `preferred_target = wasm`  
> 最近实测：2026-10-17 11:21 Asia/Shanghai · check/test/run 绿 · `Total tests: 22, passed: 22`

## 0. 前置

```bash
export PATH="$HOME/.moon/bin:$PATH"
cd /workspace/bitbot
moon version
```

期望：版本 ≥ `0.1.20261012`。否则 **BLOCKED**（工具链），不要继续标业务 PASS。

## 1. 命令表

| 步骤 | 命令 | 期望信号 | 失败解读 |
|------|------|----------|----------|
| 1. check | `moon check` | exit 0；可出现 `Finished. moon: no work to do` | 编译/类型错误 → **FAIL**；moon 不存在 → **BLOCKED** |
| 2. test | `moon test` | exit 0 | 断言失败 → **FAIL**；仅有 `Warning: no test entry found` + `Total tests: 0` → 脚手架可绿，但**不得**记任何能力 unit-PASS |
| 3. run | `moon run cmd/main`（或 `moon run ./cmd/main`） | exit 0；stdout 含启动输出 | 运行时崩溃 / 非 0 → **FAIL** |

一键：

```bash
cd /workspace/bitbot && moon check && moon test && moon run cmd/main
```

## 2. 基线实测记录

| 命令 | exit | 关键输出摘要 | 时刻 (Asia/Shanghai) |
|------|------|----------------|----------------------|
| `moon check` | 0 | `Finished. moon: ran 4 tasks, now up to date` | 2026-10-17 11:17 |
| `moon test` | 0 | `Total tests: 2, passed: 2, failed: 0.`（`ui_protocol`） | 2026-10-17 11:17 |
| `moon run cmd/main` | 0 | `Hello` | 2026-10-17 11:17 |
| N 批升裁（Bit验证） | — | `moon check`+`moon test` → **197/197**（Total tests: 197, passed: 197, failed: 0） | 2026-10-17 12:34 |
| O 批升裁（Bit验证） | — | `moon check`+`moon test` → **197/197**（Total tests: 197, passed: 197, failed: 0） | 2026-10-17 12:35 |
| P 批升裁（Bit验证） | — | `moon check`+`moon test` → **205/205**（Total tests: 205, passed: 205, failed: 0） | 2026-10-17 12:40 |
| Q 批升裁（Bit验证） | — | `moon check`+`moon test` → **213/213**（Total tests: 213, passed: 213, failed: 0） | 2026-10-17 12:44 |
| R 批升裁（Bit验证） | — | `moon check`+`moon test` → **221/221**（Total tests: 221, passed: 221, failed: 0） | 2026-10-17 12:51 Asia/Shanghai |
| S 批升裁（Bit验证） | — | `moon check`+`moon test` → **229/229**（Total tests: 229, passed: 229, failed: 0） | 2026-10-17 12:58 Asia/Shanghai |
| T 批升裁（Bit验证） | — | `moon check`+`moon test` → **237/237**（Total tests: 237, passed: 237, failed: 0） | 2026-10-17 13:20 Asia/Shanghai |
| U 批升裁（Bit验证） | — | `moon check`+`moon test` → **245/245**（Total tests: 245, passed: 245, failed: 0） | 2026-10-17 13:26 Asia/Shanghai |
| V 批升裁（Bit验证） | — | `moon check`+`moon test` → **253/253**（Total tests: 253, passed: 253, failed: 0） | 2026-10-17 13:33 Asia/Shanghai |
| W 批升裁（Bit验证） | — | `moon check`+`moon test` → **261/261**（Total tests: 261, passed: 261, failed: 0） | 2026-10-17 13:38 Asia/Shanghai |
| X 批升裁（Bit验证） | — | `moon check`+`moon test` → **266/266**（Total tests: 266, passed: 266, failed: 0） | 2026-10-17 13:43 Asia/Shanghai |
| Y 批升裁（Bit验证） | — | `moon check`+`moon test` → **274/274**（Total tests: 274, passed: 274, failed: 0） | 2026-10-17 13:52 Asia/Shanghai |
| Z 批升裁（Bit验证） | — | `moon check`+`moon test` → **282/282**（Total tests: 282, passed: 282, failed: 0） | 2026-10-17 13:58 Asia/Shanghai |
| AA 批升裁（Bit验证） | — | `moon check`+`moon test` → **290/290**（Total tests: 290, passed: 290, failed: 0） | 2026-10-17 14:03 Asia/Shanghai |
| BB 批升裁（Bit验证） | — | `moon check`+`moon test` → **296/296**（Total tests: 296, passed: 296, failed: 0） | 2026-10-17 14:08 Asia/Shanghai |
| H0 host-integration I（Bit验证） | — | `moon check`+`moon test` → **303/303**；`bash scripts/host_h0_smoke.sh` 三 CM exit0 → CM-0607/0608/2175 **I-PASS** | 2026-10-17 14:13 Asia/Shanghai |
| H1 host-integration I（Bit验证） | — | `moon check`+`moon test` → **309/309**；`bash scripts/host_h1_smoke.sh` 四 CM exit0 → CM-0605/0802/2160 **I-PASS**；CM-0806 仍 GAP | 2026-10-17 14:21 Asia/Shanghai |
| H1 隔离复核 0802/2160（Bit验证） | — | `moon check`+`moon test` → **311/311**；`host_h1_smoke.sh cm-0802`/`cm-2160` exit0 → **I-PASS（解除待复核）**；未碰 9223/chrome-profile；0806 仍 GAP | 2026-10-17 14:29 Asia/Shanghai |
| H2 host-integration I（Bit验证） | — | `moon check`+`moon test` → **319/319**；`host_h2_smoke.sh` cm-1901/1902/1907 exit0 → **拒升 I（表面属 B / 未达 C′，仍 GAP）**；H0/H1 I-PASS 维持；0806 仍 GAP | 2026-10-17 14:38 Asia/Shanghai |
| H2 C′复核 1901/1902/1907（Bit验证） | — | `moon check`+`moon test` → **320/320**；`host_h2_smoke.sh` cm-1901/1902/1907 exit0 → **I-PASS×3**（Live HostUiShell→`/api/host/*`；禁 CDP 页面 JS）；0806 仍 GAP | 2026-10-17 14:46 Asia/Shanghai |
| H2·批2 1903–1906（Bit验证） | — | `moon check`+`moon test` → **328/328**；`host_h2_smoke.sh batch2` exit0 → CM-1903/1904/1905/1906 **I-PASS×4**；I-PASS 9→13；GAP 32→28；U=234；0806 仍 GAP | 2026-10-17 14:54 Asia/Shanghai |
| H2·批3 0204/0205/0206/1401/1405/1507/2178（Bit验证） | — | `moon check`+`moon test` → **335/335**；`host_h2_smoke.sh batch3` exit0 + `all` 14/14 exit0 → **I-PASS×7**；I-PASS 13→20；GAP 28→21；U=234；0806 仍 GAP；1507 底部锚点靠高亮 ROI 区分（滚动触底同位，note） | 2026-10-17 15:12 Asia/Shanghai |
| H3·批1 2158/2174/0705/0411（Bit验证） | — | `moon check`+`moon test` → **339/339**；`host_h3_smoke.sh all` exit0 → CM-2158/2174/0705/0411 **I-PASS×4**（0705=平台子集）；I-PASS 20→24；GAP 21→17；U=234；0806 仍 GAP；0705 residual 真手机 OS 卡仍 GAP | 2026-10-17 15:21 Asia/Shanghai |


### 回归窗口（同日更早）

约 11:16–11:17：`ui_protocol/types.mbt` 曾用非法可选字段语法（`transcript?` / `channel_hint?`），`moon check` exit **255**（4 errors）。随后实现方改为 `String?` 标签字段后恢复。**不得**用旧「脚手架 0 tests PASS」记录掩盖该窗口。

**Smoke 总评（CHARTER 一键绿线）**：PASS  
**能力语义**：仅 `ui_protocol` 有 2 条单测；根库仍为模板；多数 architecture 模块目录空。**不得**把 Q-SMOKE PASS 记成 Delivery 全量 PASS。

## 3. 演进规则

1. MoonBit核每合并一个能力包：在本文件「扩展冒烟」追加包级 `moon check` / `moon test` 路径。  
2. **已生效**：仓库现有 ≥1 条真实单测。此后若 `Total tests` 回落到 0，或 `moon check` 非 0 → **FAIL**（回归）。  
3. 集成脚本落地后挂到 `docs/qa/scripts/`，并在此表增加一行；失败同等阻塞。  
4. 每次改 smoke 命令或期望：更新「基线实测记录」日期与输出摘要（禁止只改文档不跑）。

## 4. 扩展冒烟（占位，随矩阵填充）

| ID | 触发条件 | 命令/入口 | 状态 |
|----|----------|-----------|------|
| S-KERN | Q-KERN 有测试 | `moon test` 过滤/包路径 TBD | 未建 |
| S-DELIV | ui_protocol 包存在 | TBD | 未建 |
| S-PERS | memory/routines 包存在 | TBD | 未建 |
| S-HOST | host 协议测试存在 | TBD | 未建 |
| S-H0 | Wave H0 I 烟测 | `bash scripts/host_h0_smoke.sh`（cm-0607/0608/2175） | **绿** · 2026-10-17 14:13 Asia/Shanghai · Bit验证 I-PASS |
| S-H1 | Wave H1 I 烟测 | `bash scripts/host_h1_smoke.sh`（cm-0605/0802/2160/0806） | **绿（3/4 I-PASS，无待复核）** · 2026-10-17 14:29 Asia/Shanghai · 0802/2160 隔离复核通过；CM-0806 仍 GAP |
| S-H2 | Wave H2 I 烟测 | `bash scripts/host_h2_smoke.sh`（`all` = 14 项；`batch2` = 1903–1906；`batch3` = 0204/0205/0206/1401/1405/1507/2178） | **绿 · 14/14 I-PASS** · 2026-10-17 15:12 Asia/Shanghai · C′ Live HostUiShell→`/api/host/*`；LiveDisplay `:99`；9223/chrome-profile 未碰 |
| S-H3 | Wave H3 I 烟测 | `bash scripts/host_h3_smoke.sh`（`cm-2158|cm-2174|cm-0705|cm-0411|all`） | **绿 · 4/4 I-PASS** · 2026-10-17 15:21 Asia/Shanghai · 2158 Live npm；2174 双会话 `:40`/`:41`；0705 平台子集（residual 真手机 OS 卡）；0411 Host 面板 opaque；9223/chrome-profile 未碰 |

## 5. 与 gaps 的关系

- 本文件只保证**仓库可构建可跑**。  
- 能力级缺口一律写 `docs/qa/gaps.md`（见 `acceptance-plan.md`）。  
- 冒烟红 = 全队 P0，优先于新功能。
