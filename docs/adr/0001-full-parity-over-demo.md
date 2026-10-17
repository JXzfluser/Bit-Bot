# ADR 0001 — 完整能力对等优先于 Demo

- 状态：Accepted  
- 日期：2026-10-17（Asia/Shanghai）  
- 决策者：Bit架构（对齐 CHARTER）

## 背景

团队可用极少代码做出「能对话」的 Demo。CHARTER 要求完整复刻 Grok Bot 原生能力，一条都不能少。

## 决策

**完整能力对等（parity）优先于可演示 Demo。**

- 里程碑必须以能力矩阵/清单的可勾选项验收。  
- 允许垂直切片（先打通 Turn+Gate+Shell），但切片必须落在真实模块边界上，且不删除其它域的占位契约。  
- 禁止用 stub 聊天冒充 M1/M2 完成。

## 后果

- 前期可见 UI 可能少于 Demo 导向项目；文档与类型表面先行。  
- ROADMAP/Phase 中「可验证产出」绑定能力 ID。  
- 若业务压力要求 Demo，须另开 ADR 说明临时范围，并设拆除期限；默认拒绝。

## 备选（未采纳）

1. 先做聊天 Demo 再补能力 — 易锁死错误架构。  
2. 砍域做 MVP — 违反 CHARTER non-negotiable #1。
