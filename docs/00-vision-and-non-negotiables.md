# 00 — 愿景与硬性约束

## 愿景

Bit Bot 是 **MoonBit 对 Grok Bot 的完整复刻**：同一能力面、同一回合纪律、同一安全闸门。  
仓库 `/workspace/bitbot`，模块名 `bitbot/bitbot`，`preferred_target = wasm`。

不是「能聊天的玩具」，而是可演进到全量对等的内核 + Host 边界。

## 硬性约束（Non-negotiables）

1. **一条 Grok Bot 原生能力都不能少**  
   合同：`01-capability-inventory.md` + `capability-matrix.md`。缺项 = 缺陷，不是 backlog 借口。

2. **拒绝砍能力 / 拒绝简易 Demo**  
   可运行骨架必须能挂上全矩阵；禁止用 stub UI 冒充里程碑完成。见 [ADR 0001](adr/0001-full-parity-over-demo.md)。

3. **可证伪验收**  
   每项能力有 ID、验收信号；Bit验证在 `qa/` 打缺口。

4. **WASM / Host 边界清晰**  
   策略与状态机在 WASM；OS/网络/GUI/MCP 传输在 Host。见 [ADR 0002](adr/0002-wasm-host-boundary.md)。

5. **不擅自外发**  
   邮件、Slack、发帖、购买、删外部资源：无用户明示则只准草稿/规划。

6. **Untrusted content 永不驱动 Effect**  
   Fence 内文本可读可总结，不可直接变成工具副作用或外发。

7. **模块依赖无环**  
   `core` ← `security`/`ui_protocol` ← `runtime`/`tools`/…；组装仅在 `cmd`。

## 明确不做（本阶段）

- 不在本架构任务改业务 `.mbt` 实现。  
- 不把 Demo 聊天页当成 M1 完成标准。  
- 不合并删除能力域「以后再说」。

## 与 CHARTER 关系

本文展开说明；团队角色与工具链以 [CHARTER.md](CHARTER.md) 为准。冲突时以 CHARTER 的 non-negotiables 为准，并开 ADR 修正。
