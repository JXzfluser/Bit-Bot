# Bit Bot Desktop — Target v2（侧栏底部固定入口 + 单一模型入口 + 产品级去诊断化）

基线：`cursor/desktop-layout-target-v1`（v1 布局 / 文案 / 调试面治理合同，见
`layout-contract.md` / `copy-contract.md` / `target-v1.md`）。本波是二次改造，直接提交到
`cursor/desktop-layout-target-v1`，不新建分支。渲染门沿用真实 Electron + xvfb + Playwright；
`prove_*.js` 仍为源码级 lint。诚实性口径同 v1：缺依赖 honest SKIP，绝不伪造 PASS。

## 1. 本波修复的 7 个问题

1. Header 模型区拥挤：多通道 chip（DeepSeek / 通义千问·无 key / Kimi·无 key / 凭证）压平。
2. 设置-通用暴露原始诊断行（`entry=sidebar·account=button …`）。
3. 语言行重复值“跟随系统 · 跟随系统”。
4. Bot 时区默认 UTC。
5. 隐私模式显示英文（`Privacy Mode: unavailable · managed by account · training=disabled_by_default`）。
6. 模板市场顶部 `templates × 6 · data/desktop/bot-templates.json` 调试串；卡片仍英文。
7. 连接应用 / 模板市场应固定在侧栏底部，点击打开。

## 2. 侧栏底部固定入口合同

`#sidebar-footer` 内 DOM 顺序固定：
Hidden Bots（仅 `hidden.length>0` 时可见）→ Connect apps → Template marketplace → Settings → account-bar。

- 每个条目是“点击打开右侧 Sheet/Modal”的触发器，侧栏内不得内联表单。
- 三张 Sheet（模型 / 模板市场 / 连接应用）统一 `class="bb-modal bb-modal--right"`：右侧贴边、满高、
  左圆角、滑入动画；Esc、点遮罩、点关闭按钮都能关闭，关闭后焦点回到触发器。
- Settings 作为可见的侧栏底部行（不再塞进账户弹层，避免重复入口）；打开即 `bbSheetOpened` 入栈。
- 单一状态源 `window.__bbSheetStack` + 全局 `keydown(Escape)` 关栈顶；`BB_SHEET_CLOSE` 集中映射关闭函数。

## 3. 模型入口合同

- Header 只保留一个入口：`#model-picker > #model-entry.mp-btn`，文案为「当前模型名 · 状态」
  （例 `DeepSeek · 已连接`；无 active 时 `未配置模型`）。彻底删除逐通道 chip 与“无 key”压平串。
- 点击打开「模型」Sheet：当前摘要 + 按供应商分组（DeepSeek / 通义千问 / Kimi·Moonshot /
  自定义 OpenAI 兼容），显示 已连接 / 未配置；未配置可填 Key、保存、测试、清除（Key 永不回显明文）；
  「设为当前模型」走既有 `switch model <id>` 内核短语 + `llmCatalog`，header 即时更新。
- 与 设置→凭证 共用 `secrets` / `llmCatalog` 数据源，双向同步；不破坏模型切换 / 默认模型 / 无 key 空态。

## 4. 产品级去诊断化合同（设置）

- 产品态（`body[data-devmode]≠"on"`）下设置-通用不得出现原始诊断串：`entry=`、`account=`、
  `*_masked`、内部枚举、`data/`、`.json`、`× N`、`unavailable`、`disabled_by_default`、`training=`、
  `key=`、`secret=`、`env.local`、`bot-templates`。这些仅在 dev-mode 显示（`renderSettingsPanel` /
  残留位块由 `devModeOn()` 分支包裹）。
- 「开发选项」行与 label 带 `data-lab`，dev off 时按治理 CSS `body:not([data-devmode="on"]) [data-lab]{display:none}` 隐藏。
- 语言行只显示一个值（复用既有 `followSystem` 键，杜绝“跟随系统 · 跟随系统”）。
- 隐私行完全中文（`隐私模式：…`），内部枚举只留在 `dataset`（非可见）。
- 自动审批规则列表用可读中文标签，原始 `pattern → decision` 移入 `title`（悬浮/高级信息折叠）。

## 5. 时区合同

- Bot Timezone 默认 = 系统时区，不再硬编码 UTC。优先级：`BITBOT_TZ` →
  `Intl.DateTimeFormat().resolvedOptions().timeZone` → `process.env.TZ` → `UTC`（仅当系统确实报 UTC）。
- 迁移：只把“从未显式选择、且值为遗留 `UTC`/null”的旧 store 重新播种为系统时区；
  用户显式选过的 UTC（`timezone_explicit===true`）永不覆盖。
- 主进程在无 `BITBOT_TZ` 时按系统时区补种 `process.env.BITBOT_TZ`，驱动 routine daemon。

## 6. 模板市场本地化合同

- 顶部不再打印 `templates × N · <path>`；空/加载/错误态均中文。
- 卡片按当前语言显示 name/job/description：渲染层保留一张“按模板 id 键、值仅 name/job/desc”的
  显示层本地化映射 `TPL_COPY`（zh_cn / zh_tw，lang key 用下划线避免与 i18n 字典锚点冲突）。
- 后端 id / job / description 语义不改（`data/desktop/bot-templates.json` 与 Host 目录仍是唯一真相）；
  “创建”打开既有 Bot 创建流程并按当前语言预填 name/职责/描述。
- 结构不变式：渲染层不得写死后端模板目录对象（`default_name` / 英文 job/description）。本地化仅为
  显示映射，`prove_m24` 的 GP-116 断言据此放宽为“禁止后端模板结构 / 英文元数据嵌入”，而非禁止 id 字符串。

## 7. i18n 合同

- 全部新文案走 `t(key)`；zh-CN / zh-TW / en 三套字典键完全对齐（D-C-03：本次后 464 键 ×3）。
- 品牌 / 技术标识（DeepSeek、Moonshot、OpenAI 兼容、IANA 时区、API/Key、端口等）按
  `i18n-allowlist.json` 豁免；zh-CN 产品可见文案无未豁免英文。

## 8. 验收门（真实渲染）

新增门禁脚本 `scripts/e2e_desktop_shell_v2.mjs`（失败非零退出），真实 Electron + Playwright，
1440x900 与 1280x800 各跑一次，每次覆盖 zh-CN 与 zh-TW；断言编号前缀 `S-*`：
`S-HEADER / S-MODEL / S-SIDEBAR / S-CLEAN / S-LANG / S-PRIV / S-TZ / S-MK / S-DEV`；
并归档截图（设置-通用、模型 Sheet、模板市场、侧栏底部）到 `reference/shell-v2-*`。

运行：

```
node --check scripts/e2e_desktop_shell_v2.mjs
xvfb-run -a node scripts/e2e_desktop_shell_v2.mjs
```

既有门必须继续全绿：`e2e_desktop_layout_target.mjs`、`e2e_grok_desktop_boot.mjs`、
`smoke_grok_desktop_parity.sh`、`validate_proto_geometry.js`、`prove_m20/m24/m40/m41/m43/m44`。
