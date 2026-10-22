## 附录 B：动态中文串渲染点清单（波次 M46 输入；行号基于当前工作区 index.html）

口径：字典区之后的行内含 CJK 字符、非注释、且向上 4 行内命中 DOM sink 关键字（textContent/innerHTML/title/placeholder/mkMsg/gpStatus/toast/banner…）。

| 行号 | 片段 | 关联 sink |
|---|---|---|
| 10758 | `if (res && res.ok) gpStatus("waveg-settings-status", "Appearance → " + mode + "（nativeTheme.themeSou` | if (res && res.ok) gpStatus("waveg-setti |
| 10775 | `if (res && res.ok) gpStatus("waveg-settings-status", "Local execution → " + mode + "（Host 执行前判定已生效）"` | if (res && res.ok) gpStatus("waveg-setti |
| 10797 | `if (res && res.ok) gpStatus("waveg-settings-status", "Timezone → " + tz + "（daemon 经 BITBOT_TZ 生效）")` | if (res && res.ok) gpStatus("waveg-setti |
| 10813 | `"Route traffic 开关已持久化=on（真实代理生效为 residual：本机未起代理）" :` | gpStatus("waveg-settings-status", !cur ? |
| 10814 | `"Route traffic 开关已持久化=off");` | gpStatus("waveg-settings-status", !cur ? |
| 10827 | `if (res && res.ok) gpStatus("waveg-settings-status", "规则已写入：" + pattern + " → " + decision);` | if (res && res.ok) gpStatus("waveg-setti |
| 10828 | `else gpStatus("waveg-settings-status", "规则写入失败：" + (res && res.error ? res.error : "unknown"));` | else gpStatus("waveg-settings-status", " |
| 11043 | `if (meta) meta.textContent = "Host 真实帧 · " + String(res.frame_path &#124;&#124; "").split("/").slice(-1)[0] + ` | if (meta) meta.textContent = "Host 真实帧 · |
| 11047 | `? "无帧（诚实 residual：" + res.residual + "）。有 DISPLAY 且 Bot 运行 computer-use 任务时自动出现真帧。"` | if (meta) meta.textContent = "Host 真实帧 · |
| 11048 | `: "无帧（residual：" + (res && res.error ? res.error : "unknown") + "）";` | ? |
| 11051 | `if (meta) meta.textContent = "帧轮询：3s（当前无可用帧）";` | if (meta) meta.textContent = "帧轮询：3s（当前无 |
| 11140 | `status.textContent = "已提交 · 进入内核闸门";` | status.textContent = "已提交 · 进入内核闸门"; |
| 11145 | `status.textContent = "已丢弃（无出站；草稿保留在 Host 供审计）";` | status.textContent = "已丢弃（无出站；草稿保留在 Host |
| 11177 | `else gpStatus("gp-group-status", "最多 6 个 Bot（GP-50）");` | else gpStatus("gp-group-status", "最多 6 个 |
| 11200 | `o.textContent = "暂无群组";` | o.textContent = "暂无群组"; |
| 11210 | `if (status) status.textContent = "至少选择 2 个 Bot（GP-50：2–6）";` | if (status) status.textContent = "至少选择 2 |
| 11215 | `const title = (titleEl && titleEl.value.trim()) &#124;&#124; "群聊 " + new Date().toISOString().slice(5, 10);` | ? |
| 11221 | `? "群组已建（intent=" + res.intent + "）：" + title` | status.textContent = |
| 11222 | `: "创建失败：" + (res && res.error ? res.error : "kernel 未识别");` | status.textContent = |
| 11233 | `if (status) status.textContent = "选择群组并输入消息";` | if (status) status.textContent = "选择群组并输 |
| 11238 | `if (status) status.textContent = "已发送 → kernel RoomTurn 路由（@Name 定向 / @everyone 全体 / 无 @ 自行决定）";` | if (status) status.textContent = "已发送 →  |
| 11259 | `title: needsInput ? "Bit Bot 需要你的确认" : "Bit Bot 完成任务",` | ? |
| 11260 | `body: needsInput ? "审批等待处理" : String((r.assistant && r.assistant[0] && r.assistant[0].text) &#124;&#124; r.tex` | ? |
| 11331 | `已接入的所有绑定；文案走 WAVEG_I18N，三语齐全。用 bb-modal / bb-sheet 复用` | ? |
| 11332 | `既有对话框层。DOM 建，不用 innerHTML，避免 GP-93 纪律破口。 */` | 既有对话框层。DOM 建，不用 innerHTML，避免 GP-93 纪律破口。 |
| 11431 | `addMsg("assistant", "Always allow 规则命中：" + (payload && payload.kind ? payload.kind : "?") + " → 同类操作` | ? |
| 11537 | `runUserTurn("reply via dingtalk:cid-desktop :: Bit Bot 钉钉消息", {` | ? |
| 11545 | `runUserTurn("reply via feishu:oc_desktop :: Bit Bot 飞书消息", {` | ? |
| 11553 | `runUserTurn("reply via wecom:BitBotUser :: Bit Bot 企微消息", {` | ? |
| 11627 | `t += " · 入站:" + cn.inbound.port;` | ? |
| 11798 | `return "附件被拒绝: " + code;` | ? |
| 11873 | `div.textContent = skillsCache && skillsCache.error ? "技能列表不可用: " + skillsCache.error : "无匹配技能";` | div.textContent = skillsCache && skillsC |
| 11929 | `addMsg("assistant", "语音输入不可用：无麦克风 API（residual，不伪造转写）");` | ? |
| 11949 | `addMsg("assistant", "录音为空，未提交");` | ? |
| 11954 | `addMsg("assistant", "录音已存 " + r.wav_path + (r.residual ? "（" + r.residual + "，转写需你在下方补文字）" : ""));` | ? |
| 11960 | `addMsg("assistant", "录音失败: " + ((r && (r.error &#124;&#124; r.residual)) &#124;&#124; "unknown"));` | ? |
| 11967 | `addMsg("assistant", "麦克风被拒绝: " + (e && e.name));` | ? |
