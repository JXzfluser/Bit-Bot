# Bit Bot 文档索引

阅读顺序（新成员 / MoonBit核）：

1. [CHARTER.md](CHARTER.md) — 使命与硬性约束  
2. [architecture.md](architecture.md) — 总体架构入口  
3. [modules.md](modules.md) — 包目录约定入口  
4. [interfaces.md](interfaces.md) — 核心接口入口  
4b. [host-ui-contract.md](host-ui-contract.md) — Host UI（CM-1901/1902/1907）  
5. [01-capability-inventory.md](01-capability-inventory.md) — 全量能力原子清单  
6. [capability-matrix.md](capability-matrix.md) — 对标验收合同（`CM-*`，234 行，能力对标维护）  
7. [ROADMAP.md](ROADMAP.md) — M0–M7 里程碑  

深挖（实现期）：

| # | 文件 | 类型 | 摘要 |
|---|------|------|------|
| 00 | [00-vision-and-non-negotiables.md](00-vision-and-non-negotiables.md) | explanation | 愿景与不可妥协项 |
| 01 | [01-capability-inventory.md](01-capability-inventory.md) | reference | 能力 ID 全表 |
| 02 | [02-module-map.md](02-module-map.md) | reference | 模块边界与依赖图（由实际 `moon.pkg` 导出） |
| 03 | [03-capability-to-module.md](03-capability-to-module.md) | reference | 能力→模块映射 |
| 04 | [04-interface-contracts.md](04-interface-contracts.md) | reference | 接口类型草图 |
| 05 | [05-runtime-turn-lifecycle.md](05-runtime-turn-lifecycle.md) | explanation | 回合生命周期 |
| 06 | [06-evolution-roadmap.md](06-evolution-roadmap.md) | explanation | Phase 0–5 与 ROADMAP 对照 |
| 07 | [07-directory-conventions.md](07-directory-conventions.md) | reference | 仓库命名与测试约定 |

ADR（决策记录，各自独立成立，不互相引用）：

- [adr/0001-full-parity-over-demo.md](adr/0001-full-parity-over-demo.md) — 对等优先于演示
- [adr/0002-wasm-host-boundary.md](adr/0002-wasm-host-boundary.md) — 内核/Host 边界（**现行：native FFI**；WASM 已被取代）
- [adr/0003-package-naming-box-host-and-cloud.md](adr/0003-package-naming-box-host-and-cloud.md) — 包命名
- [adr/0004-full-matrix-i-closure.md](adr/0004-full-matrix-i-closure.md) — 全矩阵 I 收口
- [adr/0005-course-correct-moonbit-desktop.md](adr/0005-course-correct-moonbit-desktop.md) — MoonBit 桌面纠偏
- [adr/0008-remote-turn-auth-and-sandbox.md](adr/0008-remote-turn-auth-and-sandbox.md) — 远程回合鉴权与沙箱
- [adr/0010-product-tools-capability-layer.md](adr/0010-product-tools-capability-layer.md) — 产品工具能力层
- [adr/0011-agent-context-persistence.md](adr/0011-agent-context-persistence.md) — agent-context 持久化
- [adr/0012-tool-policy-authority.md](adr/0012-tool-policy-authority.md) — 工具策略权威
- [adr/0013-room-dispatch-and-delivery-idempotency.md](adr/0013-room-dispatch-and-delivery-idempotency.md) — 房间派投与投递幂等

选型调研：

- [quic-binding-spike.md](quic-binding-spike.md) — QUIC 绑定：napi 插件 vs Rust sidecar（结论：sidecar）

验收：`qa/` 由 Bit验证维护；本目录架构文档不写入测试结果。

> **注意**：[capability-matrix.md](capability-matrix.md) 的每一行 PASS 都必须有可机检的证据，
> 由 `scripts/prove_capability_matrix.mjs` 校验（证据文件与测试名必须真实存在）。
> 另有 [qa/contract-layer.md](qa/contract-layer.md) 记录**已实现且有证据、但未接入生产路径**
> 的契约层能力，由 `scripts/prove_contract_layer.mjs` 保持同步——别把「状态=PASS」读成「用户能用」。
>
> 群协作的**失败必须出声**：Host 侧有总时限（`BITBOT_ROOM_TURN_DEADLINE_MS`），
> 渲染层另有一道客户端兜底闸，超时会如实报超时并往群里落一条汇报；删 Bot
> 连带解散群时必须点名被解散的群。这几条由
> `scripts/prove_room_failure_surfaces.mjs` 钉住——「消息发出去了没人回、连
> 报错都没有」和「Bot 故意不理人」在屏幕上必须能区分开。

Diátaxis：总览用 explanation；清单/契约用 reference。中文为主，关键名词保留英文。

Host-integration（内核收口后）：

- [host-integration-roadmap.md](host-integration-roadmap.md)
- [host-integration-interface-gaps.md](host-integration-interface-gaps.md)

Agent core & 多智能体（2026-10-24）：

- [agent-core/README.md](agent-core/README.md) — 现状、主流差距、P0–P3 优先级、波次计划、文档清单
