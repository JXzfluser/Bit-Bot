# ADR 0003 — box_host 与 cloud 包命名

- Status: Accepted
- Date: 2026-10-17 (Asia/Shanghai)

## Decision
1. **Retain top-level `box_host`** as the Host adapter (Shell/FS/Desktop/machine FFI). Kernel `tools` only models ToolCall/Effect DTOs; it must not absorb Host FFI.
2. **CloudAgent lives under `agents/cloud`**. Top-level `cloud/` is deprecated and must not receive new code.

## Consequences
- MoonBit核 / 实现：新代码进 `box_host` 与 `agents/cloud`。
- 能力矩阵模块列：Box/Desktop Host → `box_host`；CloudAgent → `agents/cloud`。
