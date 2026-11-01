# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)；
版本号与 Git tag 对应（当前仅 `desktop-v0.1.0`）。

## [Unreleased]

### Added

- 窄视口布局门 `D-L-13`：900 / 700 / 480 三档 × 6 面板态，断言单列、composer
  完整在视口内、rail 覆盖抽屉不挤主列、无横向滚动；已接入 CI 的 G-46 聚合。
- 产品完成度账本 `docs/qa/product-readiness.md` + `prove_readiness_ledger.mjs`：
  把 234 条 CM 分成用户可达 / 部分可达 / 仅测试可达 / 内核接线未点名四桶，计数机检。
- 用户文档：快速上手、FAQ、故障排查（`docs/user/`）。
- `prove_ui_tokens` 接入 moon-ci，并按实测下调 UI 债基线（只许降）。

### Fixed

- **窄窗口从未真正单列**：`ui_chrome.css` 的 `body.grok-ui` 覆盖了 `<900px`
  媒体查询的 areas，导致 480px 下 main 被挤到 452、rail 74、header 455。
  现在同时限定 `body, body.grok-ui`，rail 在窄屏改为覆盖抽屉。
- 契约层扫描把注释里的符号名当成生产消费者（`runtime/language.mbt` 被
  main.js 一句注释误判为已接线）；现已先剥离注释，并补登记 3 个真实契约层文件。
- Moon CI 三条红：`.mbti` 的 Int↔Int32 打印漂移、内核暂存路径写死 `desktop_turn`、
  AE-04 断言与工具名归一化语义矛盾。

### Changed

- 桌面端 Electron 33 → 37（内置 Node 22.21.1）。

## [0.1.0] - 2026-10-28

首个 `desktop-v0.1.0` 标签：桌面端可打包/可启动，内核 native 构建，
Grok 对等矩阵与真实 Electron 渲染门落地。详见该 tag 的提交历史与
`docs/design/desktop-target/report.md`。
