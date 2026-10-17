# Bit Bot 基线缺口 / 回归报告

- **日期**: 2026-10-17 Asia/Shanghai
- **作者**: Bit验证
- **性质**: 矩阵落地前的基线快照（非正式 `gaps.md`；矩阵出现后升级合并）

## 裁决摘要

| ID | 项 | 判定 | 证据 |
|----|----|------|------|
| G-SMOKE-01 | CHARTER 一键 `moon check && moon test && moon run cmd/main` | **PASS**（11:17 复测） | 见 `smoke.md` §2 |
| G-SMOKE-02 | `ui_protocol` 可选字段语法回归窗口 | **FAIL→已恢复** | 曾 check=255；现 String? + 2 tests PASS |
| G-MATRIX-01 | `docs/capability-matrix.md` | **BLOCKED/GAP** | 文件不存在 → 正式 `gaps.md` 仍阻塞 |
| G-ARCH-01 | `docs/architecture.md` | 文档 **存在**；交叉引用多项缺失 | 见下「文档悬空」 |
| G-IMPL-01 | architecture 分层目录多为空 | **GAP** | `agents` `box_host` `channels` `cloud` `connectors` `memory` `routines` `runtime` `security` `skills` `src` `tools` 等 0 文件 |
| G-IMPL-02 | 根库公开 API | **GAP** | `bitbot.mbt` 注释占位 |
| G-DELIV-01 | Delivery / ui_protocol 全量 | **GAP**（局部雏形） | 仅类型+2 单测；无 widget/voice/thread 行为对照 |
| G-CI-01 | CI check+test | **GAP** | 仅 Copilot setup workflow |

## 打回

| 给谁 | 要求 |
|------|------|
| MoonBit核 | 保持 `moon check`/`moon test` 绿；新增包不得再引入非法 `field?` 语法；`derive(Show)` 已弃用信号需按告警演进 |
| 能力对标 | **立即**产出 `docs/capability-matrix.md`（阻塞正式 gaps） |
| Bit架构 | 补齐或收回 architecture 悬空链接（ADR、`01-capability-inventory`、`interfaces.md` 等） |
| Bitbot | 禁止用冒烟绿线宣称原生能力完成 |

## 下一步（Bit验证）

1. 矩阵首版落地 → 当日写出 `docs/qa/gaps.md`（逐行 C/U/I/B）。
2. 每次 `ui_protocol` 或新包合并后复跑 smoke，更新实测表。
3. 拒绝「差不多」：无矩阵行绑定证据的能力一律 GAP。
