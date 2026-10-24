# 账户弹层（#account-popup）功能落点审计

- 审计对象：侧栏底部头像（`#account-avatar-btn`）点开的 `#account-popup` 共 10 项，外加账户条上的 `#ab-sessions-btn`。
- 审计方式：起**真** Electron 桌面端（1040×760、`body.force-light`、独立临时 user-data-dir），逐项真实鼠标点击，
  对比点击前后「可见元素集合」差集 + `#log` 尾条 + 各 surface 计算样式 + 截图。**不改任何源码**。
- 脚本：`scripts/bb_account_popup_audit.mjs`（`node scripts/bb_account_popup_audit.mjs [gate|real|both]`）。
  产物：`/tmp/bb_ap/<mode>/<item>.png`（22 张）、`/tmp/bb_ap/<mode>/results.json`、`/tmp/bb_ap/summary.json`。
- 环境跑了**两遍对照**：
  - `gate` = `gateAppEnv(REPO, {BITBOT_NO_SECRET_SYNC:1, BITBOT_DESKTOP_AUTOSTART:0})`（照抄 `e2e_grok_desktop_spec.mjs:53`）。
  - `real` = 只带 `BITBOT_NO_SECRET_SYNC=1 / BITBOT_DESKTOP_AUTOSTART=0` + `PATH=~/.moon/bin:$PATH`，其余不加（贴近 `start-desktop.sh`）。
  - 关键环境事实：`gateAppEnv(REPO, …)` 把 `BITBOT_REPO_ROOT` 指回**真仓库**，两种模式的 `data/` 落点完全相同；
    两者唯一差别是 `BITBOT_ROUTINE_DAEMON_AUTOSTART`。**两轮 11 项结果逐字节一致 → 「refused」不是隔离环境假象。**
- 可见性判据说明：任务规定的 `offsetParent !== null` 会**系统性漏掉所有 `position:fixed` 弹层**
  （`.bb-modal` 就是 fixed，`ui_chrome.css:261`），所以主判据改用「几何 + 计算样式」
  （rect>2px、`display!=none`、`visibility:visible`、`opacity>0`、在视口内），
  `offsetParent` 口径同时记录在 `offAdded_*` 字段。两种口径给出的结论一致。

## 判定表

`sb-bots-rooms` 是常驻基线（`ui_chrome.css:1166` 无条件 `display:block !important`），不计入「新增可见」。

| 项 | 隔离环境结果 | 真实环境结果 | 用户可见落点 | 判定 |
| --- | --- | --- | --- | --- |
| `ap-manage` 管理 Bot / 应用 | `#grok-adv-toggle` 变 checked，**新增可见元素 = 0**，弹层**不收起** | 同左 | 无反应（只有 hover 高亮） | **无效需修** |
| `ap-settings` 设置 | 打开 `#settings-panel`，tab=通用，`open-*.json`（entry 合法） | 同左 | 打开「设置 → 通用」 | 正常 |
| `ap-connect` 连接应用 | 打开 `#connect-apps-modal`（含搜索/分类/钉钉飞书企微卡） | 同左 | 打开「连接应用」Sheet | 正常 |
| `ap-market` 模板市场 | 打开 `#marketplace-modal`（`.ca-card` 模板网格） | 同左 | 打开「模板市场」Sheet | 正常 |
| `ap-update` 发现新版本 | 打开 `#settings-panel` 但**停在通用**，`settings-refused-*.json`（entry=account） | 同左 | 打开设置·**错标签页**、零反馈 | **落点错 + 无效需修** |
| `ap-usage` 每周用量 | 同上，`anchor=usage` 从未生效 | 同左 | 打开设置·**错标签页**、零反馈 | **落点错 + 无效需修** |
| `ap-mobile` 获取移动版 | 新增可见 = 0，`#log` 追加一条助手气泡 | 同左 | 只往对话里追加一条占位消息 | **占位待接** |
| `ap-support` 支持 | 同上 | 同左 | 只追加一条占位消息 | **占位待接** |
| `ap-add-account` 添加账户 | 打开设置·停在通用，`settings-refused-*.json`（`anchor=profile` 也不在白名单） | 同左 | 打开设置·**错标签页**、零反馈 | **落点错 + 无效需修** |
| `ap-signout` 退出登录 | 新增可见 = 0，`#log` 追加「本地单账户版本暂不支持登出…」 | 同左 | 只追加一条占位消息 | **占位待接**（读码：不会真登出，见下） |
| `#ab-sessions-btn` 会话图标 | 打开 `#sessions-popup`，`#session-list` 24 行分组会话 | 同左 | 打开会话弹层 | 正常 |

## 关键证据

内核拒绝是**硬编码 entry 白名单**，与环境无关：`hosts/shared/host_ffi.js:5025` 只允许
`sidebar-account-button | keyboard-shortcut | command-palette`，而渲染层三项都发 `entry=account`
（`index.html:9637-9641`）。`executeSettingsOpen` 命中 `:5976` 分支 → 写 `settings-refused-*.json` 并返回 `refused:true`。

本轮（real 模式）落盘的工件原文：

```
settings-refused-mvmb371q.json  entry=account anchor=update-status  CM-1901: unknown Settings entry
settings-refused-mvmb39xx.json  entry=account anchor=usage          CM-1901: unknown Settings entry
settings-refused-mvmb3ind.json  entry=account anchor=profile        CM-1901: unknown Settings entry
open-mvmb2y7l.json              entry=sidebar-account-button ok panel_open=true tab=General   ← ap-settings
```

`anchor=profile` 是第二重错：`SETTINGS_ANCHORS`（`host_ffi.js:5030-5059`）里根本没有 `profile`，
只有 `account`；即使把 entry 改对，`ap-add-account` 还会撞 `settings-bad-anchor-*`。

**拒绝回执在真机上完全看不见**：`renderSettingsPanel` 把回执写进 `#settings-meta`
（`index.html:3114-3120`），但 `ui_chrome.css:1388` 有 `body.grok-ui #settings-meta { display: none !important; }`。
实测 `settingsMetaComputed = {display:"none", h:0, text:"设置暂时无法打开"}`（gate/real 一致）。
所以用户按下「发现新版本」看到的是：设置面板弹开在**通用**页，没有任何一句解释。

`#log` 尾条的性质（决定"用户是否看到"）：

- `ap-settings/ap-update/ap-usage/ap-add-account` 尾条是
  `deliverysettings_open: ops/…json`，class 含 `debug-only` → `userVisible=false`（默认不渲染，Alt+D 才显示）。
  上一轮把它读成"内核拒绝了、用户侧没反应"，方向对，但**可见性判断错了**：面板确实弹了，只是弹错页。
- `ap-mobile/ap-support/ap-signout` 尾条是普通 assistant 气泡 → `userVisible=true`，会永久留在 transcript 里。
- 所有项 `overflowX = null`（1040×760 下无横向溢出），弹层 10 项完整可见不裁切（`/tmp/bb_ap/gate/ap-manage.png`）。

`ap-manage` 为什么是死控件：它只翻 `#grok-adv-toggle`（`index.html:2716-2721`），
而 CSS 里 `:has(#grok-adv-toggle:checked)` 能影响的两组元素已被后写规则全部锁死——
`#sb-more / #agents-lab / #hidden-bots-lab` 两种状态都是 `display:none !important`
（`ui_chrome.css:1122-1127`），`#sb-bots-rooms` 无条件 `display:block !important`（`:1166`）。
实测 `advChecked=true` 时新增可见元素仍为 `[]`。另外它是**唯一不收起弹层**的项
（`popupHidden=false`），点完弹层还杵在原地。

`ap-signout` 安全结论（因此才敢点）：`index.html:9663-9666` 的处理函数体只有
`accountPlaceholder("本地单账户版本暂不支持登出；如需清空请从设置 → 凭证删除密钥。")`，
`accountPlaceholder` = `addMsg` + `setAccountPopup(false)`（`:9653-9656`）；
全仓再无第二个 `ap-signout` 绑定，不触碰 `secret_vault` / `settings` → 不会登出、不清凭据。
未提交任何凭证、未打开外部授权页、未点任何「保存」。

## 整理建议

**必须先修（真坏的）**

1. `ap-update / ap-usage / ap-add-account` 的 `entry=account` 全部改成白名单里的
   `sidebar-account-button`（`index.html:9638-9640`）；`ap-add-account` 的 `anchor=profile` 改 `account`。
   这三项现在是"看起来能用、其实落到错误标签页"。
2. 拒绝路径必须有用户可见反馈：`renderSettingsPanel` 的 refused 分支要么不弹面板、
   要么在面板里给一条**看得见**的行（`#settings-meta` 在 grok-ui 下是 `display:none`，等于静默失败）。
   面板都不该在拒绝时打开——现在是"报错也弹窗"。
3. `ap-manage` 要么给它一个真实落点（例如展开 `#sb-more` 或直接等价于「连接应用 + 模板市场 + 已隐藏 Bot」的管理页），
   要么从弹层里删掉。当前它是纯死键，而且点完不收弹层，行为与其它 9 项不一致。

**该合并 / 该去掉**

4. `ap-connect` 与 `ap-market` 与 `ap-manage` 语义重叠（"管理 Bot / 应用" = 后两者之和）。
   建议弹层只留「连接应用」「模板市场」两项真能打开 Sheet 的入口，删掉 `ap-manage`。
5. `ap-settings` 与账户条上的 `#ab-settings-btn`、以及 `ap-update/ap-usage` 想去的设置页，
   现在是三个入口两套实现（一个走 DOM `click()` 转发，一个走内核 `open settings` 短语）。
   建议统一走内核短语（保留 CM-1901 的 entry 审计），把 `ap-settings` 的转发点击也改成
   `open settings entry=sidebar-account-button`，避免"同一个设置入口两种真值路径"。
6. `ap-mobile / ap-support / ap-signout` 三项都是"往 transcript 里塞一句占位话"。
   产品上这属于把未实现功能摆在一级菜单里，且每点一次就多一条永久消息（污染会话）。
   建议：整组收进「支持」二级页或直接从弹层移除；确实要保留的，改用 toast/一次性提示，不写进 `#log`。
7. `ap-signout` 在"本地单账户版本"下语义就是空的（`ap-add-account` 同理）。
   在真正支持多账户之前，这两项应该整对隐藏，而不是各留一句"暂不支持"。

**保留、无需动**

8. `ap-settings / ap-connect / ap-market / #ab-sessions-btn` 四项实测正常，落点与文案一致。
   `#ab-sessions-btn` 的会话弹层（24 行分组）功能完好，只是位置在账户条图标里 —— 与 G-28 的 Grok 对标一致，别动。
