# ADR 0005 — 纠偏：MoonBit 内核 + Desktop 宿主（非 Python 产品脑）

- 状态：Accepted  
- 日期：2026-10-17（Asia/Shanghai）  
- 决策者：Bitbot（响应用户：一开始就要求 MoonBit；现阶段至少应有 Desktop）

## 走错了哪里（时间线）

| 拐点 | 发生了什么 | 为何偏离 |
|------|------------|----------|
| **拐点 A** | H0–H5 把 `scripts/host_ui_surface/`（浏览器冒烟页）当成「可看的产品」 | 验收 Host UI（C′）被误当成 Desktop 交付物 |
| **拐点 B** | H6 用 ADR 0004 把剩余 193 项标成 I-PASS（kernel-sufficient） | 优化**矩阵绿灯**，而不是交付**可安装的 Desktop 端** |
| **拐点 C** | `scripts/bitbot_runtime/`（Python + Ollama）做成聊天主路径 | Host 临时脑替代了 MoonBit turn；违反「MoonBit 是主实现」的体感与 CHARTER 精神 |

**没有走错的部分**：内核 `.mbt` / U=234 / `preferred_target=wasm` / ADR 0002「副作用在 Host」边界本身正确。错在把 **Host 验收壳** 与 **Python 运行时** 抬成了产品主路径。

## 纠偏决策

1. **产品主路径**：Desktop 窗口宿主 + **MoonBit 内核**（wasm 或 native）编排 turn/审批/投递。  
2. **Host（可含少量胶水）**：只做窗口、Shell/FS/网络/LLM FFI，**不得**再实现独立 LocalBrain 回合机作为默认产品脑。  
3. **现阶段最低交付**：可启动的 **Desktop 端**（本机窗口），加载 Bit Bot UI，回合经 MoonBit。  
4. Python `bitbot_runtime` 降级为可选 Host FFI 适配 / 开发辅助，不在 README 里冒充「MoonBit 产品」。

## 后果

- 新增 `desktop/`（Electron 或等价）作为 Desktop 宿主工程。  
- `cmd` / MoonBit 侧提供可被宿主调用的 boot + turn JSON 边界（逐步收紧）。  
- 文档与 ROADMAP 显式区分：矩阵 I 库存 ≠ Desktop 产品里程碑。
