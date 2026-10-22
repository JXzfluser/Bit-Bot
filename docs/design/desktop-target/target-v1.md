# Bit Bot Desktop — Target v1（Grok 启发 · Bit Bot 自有）

> 状态：Phase 0 合同（先于任何生产 UI 改动）。
> 上游输入：`docs/grok-desktop-parity/spec.md`（行为规格）、`gaps.md`、`m37-scan.md`、`grok-bot-ui-research.md`（布局观察，非像素标准）。
> 本文件定义「做成什么样算完成」；`layout-contract.md` 定义几何；`copy-contract.md` 定义文案；`i18n-allowlist.json` 定义豁免。

## 1. 定位与边界

- **Grok-inspired，Bit Bot-owned**：借鉴 Grok 的布局原则（三区结构、克制的浅色面、消息流居中窄栏），但所有资产、文案、信息架构归 Bit Bot 自有。**不安装、不登录、不抓取、不反编译 Grok Bot；不宣称像素一致（NG-001 依旧成立：复刻行为与协议，不做像素皮肤）。**
- 单一执行者：本轮 shell 与文案只允许一个 agent 修改，禁止并行分支改同一文件。
- 本地提交、逐区迁移、每区前后截图；不 push。

## 2. 目标结构（一句话）

一个 grid：**sidebar | main | optional rail**（+ 全局 header 行）。右侧面板只有一个状态源：
`panel = none | bot | conv | computer | tools`。默认：sidebar 展开、rail 关闭、无调试面、无空 rail。

几何数值（280 / 760 / 340 / ~56）与误差带（≤2px）见 `layout-contract.md`。

## 3. 文案目标

- 所有可见文案（文本节点、placeholder、title、aria-label、tooltip、动态字符串）**唯一来源** = i18n 表 + `t()`。
- zh-CN / zh-TW / en 三语键集合完整一致；zh 界面 0 个未在 allowlist 的英文句；en 界面 0 个汉字。
- 错误码走映射表；未知错误呈现为可展开诊断区（原始信息不混进主句）。
- 禁止的"修法"：CSS 隐藏英文、清空文案、全局 DOM 文本替换、只修静态 HTML 不修动态字符串。细则见 `copy-contract.md`。

## 4. 调试面治理目标

产品默认界面 0 个调试面。调试面分两类处置：

1. **归位为产品功能**：Computer 预览 → rail(`computer`)；试连大脑/国内渠道 → 设置→凭证；账户/Hidden Bots/Connect apps/Marketplace/Settings → sidebar 底部；审批队列/自动复核规则/群聊管理 → 各自产品面。
2. **收入 dev-mode**（默认关闭，经 设置→开发选项 或启动参数开启，界面上有明确"开发模式"标记）：raw JSON 转储、kernel/ADR/effects 气泡、`details.lab`、`#probe-*`、example.com 抓取/打开、`#tool-device`、stub 回合按钮。

验收：默认渲染 DOM 中调试面选择器 0 命中；开启 dev-mode 后同一选择器命中且可见。细则见 `layout-contract.md` §6 与 `audit.md` 处置表。

## 5. 验收门（真实渲染）

全部通过 Playwright `_electron.launch`（1440x900 与 1280x800 两档视口、6 个面板态、全部 settings tab、主要模态）执行；静态 regex 探针（`scripts/prove_m*.js`）降级为 lint，不算验收。门清单（编号 D-L/D-C/D-D/D-R）定义在 `layout-contract.md` §7，截图产物进 `docs/design/desktop-target/reference/`，前后对比与误差写进 `report.md`。

## 6. 非目标

- 不做像素级 Grok 复刻、不引入外部设计资产。
- 不改动 IPC 通道名、store 路径、元素 id、事件名（迁移只动布局与文案，行为合同 `ipc-contract.md` 保持）。
- 不在本轮做 iOS/Android。
- 不 push 远端；分支 `cursor/desktop-layout-target-v1` 本地提交。

## 7. 诚实残留口径

缺 MoonBit 工具链、缺 X 环境、系统弹框不可自动化等，按仓库既有口径如实标注 skip/residual，不许伪造 PASS。渲染门若因环境不可用而 skip，必须在 `report.md` 中逐项列明原因。
