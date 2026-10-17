# 03 — 能力 ID → 模块映射

> Reference。主责 = 拥有类型与状态机的包；协作 = 必依赖但不拥有。

图例：`●` 主责 · `○` 协作

| 能力 ID 前缀 / 项 | 主责模块 | 协作 | 备注 |
|-------------------|----------|------|------|
| TURN-01..10 | `runtime` | `ui_protocol` | TURN-01/05/06/07 主责可视为 ui；回合编排仍 runtime |
| TURN-01,05,06,07 | `ui_protocol` ● | `runtime` ○ | 投递形态 |
| TURN-02,03,04,08,09,10 | `runtime` ● | `ui_protocol` ○ | |
| COMM-* | `ui_protocol` ● | `memory/profile` ○ | COMM-06 协作 memory |
| FILE-01..02 | `ui_protocol` ● | `tools` ○ | |
| FILE-03..08 | `tools/media` 或 `tools/box` ● | `ui_protocol` ○ | FILE-03→desktop |
| BOX-* | `tools/box` ● | `security` ○ | BOX-09→security |
| DESK-01,03..06 | `agents/computer_use` ● | `tools/desktop` ○ | |
| DESK-02,07 | `tools/desktop` ● | Host ○ | |
| MACH-* | `tools/machines` ● | `security` ○ | MACH-03 审批 |
| AGENT-01..05,08 | `agents/task` 等 ● | `runtime` ○ | |
| AGENT-06,07,09,10 | `agents` ● | `security`,`runtime` ○ | |
| MCP-* | `connectors/mcp` ● | `tools/dynamic`,`security` ○ | |
| CLOUD-* | `agents/cloud` ● | `connectors`,`security` ○ | |
| MEM-* | `memory` ● | `stores` ○ | |
| RTN-* | `routines` ● | `runtime`,`security` ○ | |
| SKILL-* | `skills` ● | `stores`,`connectors` ○ | |
| CHAN-* | `channels` ● | `ui_protocol`,`security` ○ | |
| MAIL-* | `connectors/mail` ● | `security`,`ui_protocol` ○ | |
| SEC-* | `security` ● | `runtime` ○ | 横切 |
| BUY-* | `connectors/commerce` ● | `ui_protocol`,`security` ○ | BUY-01→ui |
| TEAM-* | `agents/teammates` ● | `security` ○ | |
| PROF-* | `memory/profile` ● | `ui_protocol` ○ | |
| STORE-* | `stores` ● | Host,`tools` ○ | |
| TIME-* | `core/time` ● | `runtime`,`ui_protocol` ○ | |
| PERM-* | `security` ● | `ui_protocol`,mail,channels ○ | |

## 1:N 说明

- 多数 TURN/COMM 为 **1 能力 : 2 模块**（协议 + 编排）。  
- SEC/PERM 横切：主责 `security`，各外发面必须调用 Gate。  
- 禁止「能力无主责」；新增 ID 必须先填本表再写代码。

## 按包聚合（主责计数约）

| 模块 | 主责能力（约） |
|------|----------------|
| runtime | TURN 编排类 ~6 + 协作多 |
| ui_protocol | COMM + 投递类 ~12 |
| tools/* | BOX+MACH+FILE 工具 ~25 |
| agents/* | AGENT+DESK+CLOUD+TEAM ~25 |
| connectors/* | MCP+MAIL+BUY ~20 |
| memory+skills+routines+stores | ~25 |
| security | SEC+PERM ~13 |
| channels | CHAN ~5 |
| core | TIME ~4 |
