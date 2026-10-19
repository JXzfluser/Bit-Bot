# Bit Bot Charter

## Mission
用 MoonBit 高质量、完整复刻 Grok Bot **全部原生能力**（含内置与隐藏行为）。  
仓库：`/workspace/bitbot` · 模块：`bitbot/bitbot`

## Non‑negotiables
1. **一条能力都不能少** — 以 `capability-matrix.md` 为合同；缺项即缺陷。
2. **不做简易 Demo** — 可运行骨架必须可演进到全量；禁止用 stub 冒充完成。
3. **独立不间断** — 不等待人工确认门；阻塞时自行选型并记录决策。
4. **可证伪验收** — 每项能力有验收标准；`Bit验证` 对照打缺口。

## Team
| 角色 | 职责 | 主交付 |
|------|------|--------|
| Bitbot（负责人） | 统筹、拆解、整合、拍板 | 整体进度与集成 |
| Bit架构 | 模块边界与接口 | `docs/architecture.md` 等 |
| 能力对标 | 能力枚举与映射 | `docs/capability-matrix.md` |
| MoonBit核 | MoonBit 实现 | 各包 `.mbt` + 测试 |
| Bit验证 | 验收与缺口 | `docs/qa/` |

## Runtime shape（目标）
- **Kernel**：turn loop、tool registry、approval gate、untrusted fence（**MoonBit**）
- **Delivery**：SendToUser 语义（text/widget/attachment/voice/reaction/thread）
- **Persistence**：memory / routines / skills / profile
- **Hosts（multi-end 是基本交付，非可选）**：`MachineKind::Desktop | Ios | Android` 同 HostAbi 面；Desktop 窗口为现阶段产品宿主，iOS/Android 可 stub 但架构必须真实多端；副作用仅 Host FFI
- **Connectors**：MCP/plugin auth + dynamic tools
- **Agents**：subagents、teammates、cloud agents、channels
- **Vertical skills**：mail, meetings, shopping, … 按矩阵挂载

## Product path
- **是**：`hosts/desktop` + `cmd/desktop_turn`（open_turn → policy → deliver）
- **不是**：Python `bitbot_runtime` LocalBrain / `deploy_local.sh` 冒充产品脑

## Toolchain
- MoonBit ≥ 0.1.20261012（`~/.moon/bin`）
- `moon check && moon test && moon run cmd/main` 为最低绿线
- `preferred_target = wasm`

## Status cadence
每完成一个可合并里程碑：更新 `docs/scaffold-status.md` 与矩阵中的状态列。
