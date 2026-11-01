# Contributing

## 分支与提交

- 开发只在功能分支（当前 `cursor/next-target-v1`）提交与推送；**不直接向 `main` 推送**。
- `main` 只接受经过评审的合并。
- 提交信息写「为什么」，不是「改了什么」；一次提交一件事，便于回滚与复盘。

## 环境

```bash
curl -fsSL https://cli.moonbitlang.com/install/unix.sh | bash
export PATH="$HOME/.moon/bin:$PATH"
npm ci --prefix hosts/desktop
```

## 改动前

1. 先确认问题能复现：写一条会失败的测试 / 门禁断言。
2. 再改实现，让同一条断言转绿。**「修复前红、修复后绿」两次输出都要留在 PR 描述里。**
3. 不许用 `display:none`、永远为真的断言、跳过门禁来「变绿」。SKIP 永远不是 PASS。

## 提交前必须跑

```bash
export PATH="$HOME/.moon/bin:$PATH"
moon check
moon fmt --check
moon test --target native
moon test --target wasm
```

前端 / 桌面临界区改动还要跑：

```bash
node scripts/prove_capability_matrix.mjs
node scripts/prove_contract_layer.mjs
node scripts/prove_readiness_ledger.mjs
node scripts/prove_ui_tokens.js
xvfb-run -a node scripts/e2e_desktop_layout_target.mjs     # 含 480/700/900 窄视口
xvfb-run -a bash scripts/smoke_grok_desktop_parity.sh      # 全量矩阵
```

## 契约纪律

- **内核 JSON / IPC / store 契约只许加可选字段**，不改既有字段语义；改动要同步
  `docs/capability-matrix.md` 的证据格并保证 `prove_capability_matrix` 绿。
- 新能力有实现、有测试但没接生产路径时，它属于**契约层**：
  用 `node scripts/prove_contract_layer.mjs --list` 更新 `docs/qa/contract-layer.md`，
  不要把它写成「已交付」。
- 能力矩阵的 `PASS` 只代表「实现 + 测试证据」。如果它同时被产品路径点名，
  在证据格里写 `product Host \`<入口>\``，否则完成度账本不会把它算进「用户可达」。
- 完成度账本的数字由脚本计算；**只改文档数字不改代码会被 RD2 打红**。

## 前端 / UI

- 颜色、间距、圆角、字号优先用 `ui_chrome.css` 的 token；不要在 `index.html` 新增字面 hex。
- `!important`、行内 `style`、`[style*=]` 补丁是棘轮指标，只许降：
  `node scripts/prove_ui_tokens.js` 会告诉你当前水位。
- 布局只有一个 grid（`body`）+ 一个面板状态源（`body.dataset.panel`）。
  新增面板走 `setPanel()`，不要加第 4 列或 `*-open` class 穷举。
- 窄视口（≤900px）是单列，rail 是覆盖抽屉；改布局必须同时跑 `D-L-13`。

## 文档

- 用户向：`docs/user/`（快速上手 / FAQ / 故障排查）。
- 架构与决策：`docs/`、`docs/adr/`。
- 验收与账本：`docs/qa/`。
- 报告是**只增不删**的历史记录：改 `docs/design/desktop-target/report.md` 只能追加，
  `prove_report_history_intact.mjs` 会检查小节编号与段落是否被删。

## 安全

- 绝不提交 `.env.local`、API Key、token、真实聊天/用户数据。
- 发现安全问题按 [SECURITY.md](SECURITY.md) 走私密渠道。
