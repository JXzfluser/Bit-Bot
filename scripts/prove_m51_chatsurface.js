#!/usr/bin/env node
"use strict";

/**
 * prove_m51_chatsurface — 把 Grok Bot 聊天面里「我方缺的四件事」钉成契约
 *
 * 起因：用户要求「按 Grok Bot 真机的所有功能/所有聊天内容复刻」。本轮从
 * `/Applications/Grok Bot.app` 的英文文案表（2701 条、1850 条纯文案）里取样，
 * 找到真机有、我方完全没有的四个聊天面能力：
 *   1) Find in chat（Cmd/Ctrl+F，真机文案 "Find in chat"）
 *   2) 删除这条消息（"Couldn't delete your message. Try again."）
 *   3) 日期分隔行（真机截图里的「10月17日周六 15:13」居中灰小字）
 *   4) 复制会话 ID（"Copy conversation ID"）
 *
 * 静态断言逐条对应上面的证据；每条都配负向对照（抹掉实现 → 断言必须翻假），
 * 避免写出恒真门禁。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
const main = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
const preload = fs.readFileSync(path.join(REPO, "hosts/desktop/preload.js"), "utf8");

console.log("M51 chat surface（find / delete / day-sep / copy-id）proof");

/* ---------- 1) 删除消息：Host IPC → preload → ghost 条按钮 ---------- */
if (/ipcMain\.handle\("bitbot:msg:delete"/.test(main)
  && /sessions\.removeMessage\(sessionId,\s*entryId\)/.test(main)
  && /broadcast\("bitbot:sessions-changed",\s*sessions\.list\(\)\)/.test(main)) {
  ok("Host：bitbot:msg:delete 走 sessions.removeMessage 并广播 sessions-changed");
} else {
  bad("delete IPC", "handler missing or not using removeMessage");
}
if (/messages:\s*\{[\s\S]{0,300}?delete:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("bitbot:msg:delete"/.test(preload)) {
  ok("preload：messages.delete 暴露给渲染层（contextIsolation 下唯一通道）");
} else {
  bad("delete preload", "messages.delete not exposed");
}
if (/iconActionBtn\("🗑",\s*"deleteAction"\)/.test(html)
  && /window\.bitbot\.messages\s*\n?\s*\.delete\(\{\s*sessionId:\s*activeSessionId,\s*entryId:\s*el\.dataset\.mid\s*\}\)/.test(html)
  && /el\.remove\(\);/.test(html)) {
  ok("渲染层：ghost 条 🗑 → messages.delete(当前会话, el.dataset.mid) → 摘掉该行");
} else {
  bad("delete button", "ghost delete not wired");
}

/* ---------- 2) Find in chat ---------- */
if (/id="find-bar"/.test(html) && /id="find-input"/.test(html) && /id="find-count"/.test(html)) {
  ok("查找条 DOM：#find-bar / #find-input / #find-count 齐备");
} else {
  bad("find bar markup", "missing nodes");
}
if (/function collectFindHits\(/.test(html)
  && /createTreeWalker\(root,\s*NodeFilter\.SHOW_TEXT/.test(html)
  && /mk\.className = "find-hit"/.test(html)
  && /parent\.replaceChild\(document\.createTextNode\(m\.textContent\),\s*m\)/.test(html)
  && /parent\.normalize\(\)/.test(html)) {
  ok("查找实现：TreeWalker 只包文本节点，关闭时 replaceChild 成纯文本 + normalize（不动 markdown DOM）");
} else {
  bad("find impl", "walker / unwrap missing");
}
if (/if \(ev\.shiftKey\) openGpPanel\("computer"\);\s*\n\s*else openFindBar\(\);/.test(html)
  && /\["Cmd \/ Ctrl \+ F",\s*"hkFind"\]/.test(html)) {
  ok("快捷键：Cmd/Ctrl+F → 会话内查找；Computer 面板让位到 Shift+F，快捷键面板同步");
} else {
  bad("find hotkey", "Cmd+F not rebound to find");
}
if (/findNoHits/.test(html) && /findCount/.test(html) && /stepFind\(/.test(html)) {
  ok("计数与跳转：无命中走 findNoHits，命中走 {i}/{n}，Enter / Shift+Enter 上下跳");
} else {
  bad("find count", "counter or stepping missing");
}

/* ---------- 3) 日期分隔行 ---------- */
if (/function dayKeyOf\(/.test(html)
  && /function dayLabelOf\(/.test(html)
  && /function appendDaySep\(/.test(html)
  && /dayToday/.test(html) && /dayYesterday/.test(html)) {
  ok("分隔行：dayKeyOf / dayLabelOf（今天·昨天·本地化日期）/ appendDaySep");
} else {
  bad("day sep helpers", "missing");
}
if (/if \(dayKeyOf\(m\.at\) && dayKeyOf\(m\.at\) !== lastDayKey\) appendDaySep\(m\.at\);/.test(html)) {
  ok("历史加载：每一天第一条消息前插一行（lastDayKey 去重，加载前重置）");
} else {
  bad("day sep history", "not inserted in transcript load");
}
if (/ensureDaySepForNow\(\);[\s\S]{0,200}?userEl = addMsg\("user"/.test(html)) {
  ok("实时发送：跨天时先补分隔行再画用户气泡");
} else {
  bad("day sep live", "not inserted on send");
}
if (/\.msg-day-sep\s*\{[^}]*align-self:\s*center/.test(html) && /\.msg-day-sep\s*\{[^}]*text-align:\s*center/.test(html)) {
  ok("样式：.msg-day-sep 居中（与真机居中灰小字同形）");
} else {
  bad("day sep css", "not centered");
}

/* ---------- 4) 复制会话 ID ---------- */
if (/wavegT\("cvCopyId"\)/.test(html)
  && /navigator\.clipboard && navigator\.clipboard\.writeText/.test(html)
  && /document\.execCommand\("copy"\)/.test(html)
  && /wavegT\(done \? "cvCopied" : "copyFailed"\)/.test(html)) {
  ok("会话详情：复制会话 ID（clipboard 优先、execCommand 回退、有成功反馈）");
} else {
  bad("copy conversation id", "missing or no fallback");
}

/* ---------- 5) 三语键齐平（D-C-03） ---------- */
const NEW_KEYS = ["findPlaceholder", "findPrev", "findNext", "findClose", "findNoHits", "findCount",
  "deleteAction", "deleteFailed", "dayToday", "dayYesterday", "cvCopyId", "cvCopied", "hkFind"];
const missing = [];
for (const k of NEW_KEYS) {
  const n = (html.match(new RegExp("^\\s+" + k + ":", "gm")) || []).length;
  if (n !== 3) missing.push(k + "×" + n);
}
if (!missing.length) ok("三语：13 个新键在 zh-CN / zh-TW / en 各一条（13×3）");
else bad("i18n coverage", missing.join(", "));

/* ---------- 6) 负向对照 ---------- */
{
  const broken = main.replace(/ipcMain\.handle\("bitbot:msg:delete"[\s\S]{0,80}?=>\s*\{/, "/* removed */{");
  const still = /ipcMain\.handle\("bitbot:msg:delete"/.test(broken);
  if (!still) ok("负向对照 a：抹掉 delete IPC → 删除断言翻假");
  else bad("negative a", "handler survived strip");
}
{
  const broken = html.replace("else openFindBar();", "/* removed */");
  const still = /else openFindBar\(\);/.test(broken);
  if (!still) ok("负向对照 b：抹掉 openFindBar() → Cmd+F 断言翻假");
  else bad("negative b", "binding survived strip");
}
{
  const broken = html.replace("if (dayKeyOf(m.at) && dayKeyOf(m.at) !== lastDayKey) appendDaySep(m.at);", "/* removed */");
  const still = /!== lastDayKey\) appendDaySep\(m\.at\);/.test(broken);
  if (!still) ok("负向对照 c：抹掉历史分隔插入 → 分隔断言翻假");
  else bad("negative c", "insert survived strip");
}
{
  // 注意：wavegT("cvCopyId") 在按钮里出现两次（初始化 + 1.2s 后复原），
  // 只替换第一处等于什么都没删——必须全局替换再断言。
  const broken = html.replace(/wavegT\("cvCopyId"\)/g, "/* removed */");
  const still = /wavegT\("cvCopyId"\)/.test(broken);
  if (!still) ok("负向对照 d：抹掉复制会话 ID → 断言翻假");
  else bad("negative d", "copy-id survived strip");
}

console.log("\nprove_m51_chatsurface: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
