# Copy Contract v1 — 中英文混排治理

> 口径：界面语言 = 设置→语言（zh-CN / zh-TW / en）。合同断言的是「渲染后 DOM 的可见文本」，不是源码。

## 1. 单一来源

- 唯一字典：`WAVEG_I18N`（zh-CN/zh-TW/en 三段，键集合 MUST 完全一致）。
- 唯一取词函数：`t(key, params)`（现 `wavegT` 更名或包一层同名导出；模板插值 `{{name}}`）。MUST：渲染器内 0 处绕过 `t()` 的可见文案硬编码（含 `textContent="…"`、`innerHTML="…"`、`placeholder=`、`title=`、`aria-label=`、`alert()`、`confirm()` 拼接句）。
- 静态 HTML 初始文案 MUST 只作为 zh-CN 回退种子：每个带文案的元素必须有 `data-i18n`/`data-i18n-ph`/`data-i18n-title`/`data-i18n-aria`，boot 时由语言扫描统一刷新（en 界面下不得残留任何静态中文）。
- 动态串走模板键：`t("wfCount", {count})` 一类；MUST 不存在「中文前缀 + 变量」的字符串加法拼句（lint：`textContent = "中文…` 0 命中）。

## 2. 键命名与完整性

- 命名：`区域.元素.用途` 小驼峰段（例 `composer.placeholder.room`、`settings.tab.credentials`、`rail.bot.notify`）。旧键保留兼容别名须标注 `legacy:true`，迁移完成后删除。
- 三语完整性由渲染门 D-C-03 断言：解析字典三段键集合做三方 diff，输出 0 缺失。

## 3. 错误与诊断文案

- 已知错误码（`too_many_attachments`、`bot_not_found`、`avatar_too_large`、`preview_unavailable`、`scheme_not_allowed` 等）→ 错误码→三语文案映射表；界面主句只显示映射后的本地文案。
- 未知错误：主句 = 「出现未处理的错误（{区域}）」+ 可展开「诊断详情」区，原始 message/堆栈放该区（允许英文原文，属技术数据，不计入混排违规；展开前不占主界面）。
- MUST：错误主句中不内联 raw code（code 只出现在诊断区与 `data-code` 属性）。

## 4. 可见文本扫描口径（渲染门 D-C）

对渲染后 DOM 收集：`textContent`（排除 script/style）、`placeholder`、`title`、`aria-label`、按钮 value、toast 文本。分类：

- **违规**：zh 模式下未列入 `i18n-allowlist.json` 的整句英文；en 模式下的任何汉字。
- **豁免**：allowlist 内条目（品牌、协议名、IPC id、路径、模型 id、错误码、env 名、URL）；豁免是**逐项**的（text + where + reason），禁止模式性放行（如"所有等宽字体都放行"）。
- 数字、标点、单字母徽标不计违规。

## 5. 禁止的修法（任一命中即评审 FAIL）

1. CSS 隐藏英文文本（`display:none` 掉未翻译节点）。
2. 清空/删除可见文案来"消除"混排。
3. 全局 DOM 文本替换补丁（运行时 regex 扫 body 换词）。
4. 只修静态 HTML、留 JS 动态串不管（反之亦然）。
5. 往字典塞 zh 文案冒充 en。

## 6. 迁移次序

1. 字典补全 + `t()` 落地（先让"唯一来源"成立）。
2. 静态 HTML 挂 `data-i18n` 属性 + boot 扫描扩展（title/aria）。
3. JS 动态串逐域替换（composer→rail→settings→sidebar→cards）。
4. 错误码映射 + 诊断区。
5. 渲染门全量扫描，残留入 allowlist 或修复；`report.md` 记录每轮修复统计（违规数 before→after）。
