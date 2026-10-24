# Bit Bot 文档索引

阅读顺序（新成员 / MoonBit核）：

1. [CHARTER.md](CHARTER.md) — 使命与硬性约束  
2. [architecture.md](architecture.md) — 总体架构入口  
3. [modules.md](modules.md) — 包目录约定入口  
4. [interfaces.md](interfaces.md) — 核心接口入口  
4b. [host-ui-contract.md](host-ui-contract.md) — Host UI（CM-1901/1902/1907）  
5. [01-capability-inventory.md](01-capability-inventory.md) — 全量能力原子清单  
6. [capability-matrix.md](capability-matrix.md) — 对标验收合同（`CAP-*`，167 项，能力对标维护）  
7. [ROADMAP.md](ROADMAP.md) — M0–M7 里程碑  

深挖（实现期）：

| # | 文件 | 类型 | 摘要 |
|---|------|------|------|
| 00 | [00-vision-and-non-negotiables.md](00-vision-and-non-negotiables.md) | explanation | 愿景与不可妥协项 |
| 01 | [01-capability-inventory.md](01-capability-inventory.md) | reference | 能力 ID 全表 |
| 02 | [02-module-map.md](02-module-map.md) | reference | 模块边界与依赖图 |
| 03 | [03-capability-to-module.md](03-capability-to-module.md) | reference | 能力→模块映射 |
| 04 | [04-interface-contracts.md](04-interface-contracts.md) | reference | 接口类型草图 |
| 05 | [05-runtime-turn-lifecycle.md](05-runtime-turn-lifecycle.md) | explanation | 回合生命周期 |
| 06 | [06-evolution-roadmap.md](06-evolution-roadmap.md) | explanation | Phase 0–5 与 ROADMAP 对照 |
| 07 | [07-directory-conventions.md](07-directory-conventions.md) | reference | 仓库命名与测试约定 |

ADR：

- [adr/0001-full-parity-over-demo.md](adr/0001-full-parity-over-demo.md)
- [adr/0002-wasm-host-boundary.md](adr/0002-wasm-host-boundary.md)
- [adr/0003-package-naming-box-host-and-cloud.md](adr/0003-package-naming-box-host-and-cloud.md)

验收：`qa/` 由 Bit验证维护；本目录架构文档不写入测试结果。

Diátaxis：总览用 explanation；清单/契约用 reference。中文为主，关键名词保留英文。

Host-integration（内核收口后）：

- [host-integration-roadmap.md](host-integration-roadmap.md)
- [host-integration-interface-gaps.md](host-integration-interface-gaps.md)

Agent core & 多智能体（2026-10-24）：

- [agent-core/README.md](agent-core/README.md) — 现状、主流差距、P0–P3 优先级、波次计划、文档清单
