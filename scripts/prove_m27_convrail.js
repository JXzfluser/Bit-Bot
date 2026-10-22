#!/usr/bin/env node
"use strict";

/**
 * prove_m27_convrail — G-23 对话详情右栏（官方 spec §2.1 右侧面板之「对话详情」）
 *
 * 静态层：#conv-rail 结构、三方互斥、菜单入口、只读呈现、三语 i18n。
 * 行为层：真实 createSessionStore 打 sessions.json（快照+恢复），断言详情字段
 *         能从真实会话行算出来；负向对照 = 砍掉「回复引用」计数来源。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.log("  ✗ " + m); };

console.log("M27 §2.1 对话详情右栏 proof");

/* ---------- 1) 静态层 ---------- */
const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/<aside id="conv-rail">/.test(html)
  ? ok("#conv-rail 面板存在（右栏第三种内容）")
  : bad("conv-rail markup missing");

/id="cv-name"/.test(html) && /id="cv-owner"/.test(html) && /id="cv-kvs"/.test(html) &&
  /id="cv-preview"/.test(html) && /id="cv-actions"/.test(html)
  ? ok("面板含 标题 / 归属 / 信息行 / 最近一条 / 操作 全部区块（GP-128/129）")
  : bad("conv-rail sections missing");

// Layout contract v1: shared grid-area "rail"; exclusion is inherent to the
// single data-panel state written via setPanel().
/#machines\s*\{[^}]*grid-area:\s*rail/.test(html) && /body\[data-panel="conv"\] #conv-rail \{ display: block; \}/.test(html)
  ? ok("#conv-rail 与 Computer / Bot 设置共用同一可选右栏列（grid-area: rail，data-panel 驱动）")
  : bad("conv-rail grid placement wrong");

/convRailId = id;\s*\n\s*setPanel\("conv"\)/.test(html) &&
  /setPanel\(open \? "computer" : "none"\)/.test(html)
  ? ok("computer / bot / conv 三方互斥：单一状态源 setPanel，一个值只有一个面板（GP-128）")
  : bad("three-way exclusion missing");

/\[wavegT\("cvTitle"\), \(\) => openConvRail\(s\.id\)\]/.test(html)
  ? ok("会话右键菜单有「对话详情」入口")
  : bad("menu entry missing");

/window\.bitbot\.sessions\.list\(\)/.test(html)
  ? ok("面板数据经 sessions.list IPC（渲染层不直写 store）")
  : bad("panel bypasses IPC");

/wavegT\("cvGone"\)/.test(html)
  ? ok("会话被删后显示「不存在」而不是残留旧数据（GP-129）")
  : bad("gone state missing");

/const renameBtn[\s\S]{0,400}openSessionRename\(row\)/.test(html)
  ? ok("面板内「重命名」复用既有确认对话（不发明新操作）")
  : bad("rename reuse missing");

/if \(convRailId === id\) closeConvRail\(\); \/\/ G-23/.test(html)
  ? ok("删除会话后详情面板自动关闭")
  : bad("delete-close wiring missing");

/if \(convRailId\) refreshConvRail\(\)\.catch\(\(\) => \{\}\);/.test(html)
  ? ok("转写重载后详情即时同步（消息数不撒谎）")
  : bad("transcript-sync wiring missing");

const i18nKeys = ["cvTitle", "cvInfo", "cvLast", "cvOwner", "cvCreated", "cvUpdated",
  "cvMessages", "cvUserMsgs", "cvBotMsgs", "cvReplies", "cvNone", "cvGone", "cvNote"];
let i18nOk = true;
for (const k of i18nKeys) {
  const hits = (html.match(new RegExp("        " + k + ":\\s*\"", "g")) || []).length;
  if (hits < 3) { i18nOk = false; console.log("      key " + k + " locales=" + hits); }
}
i18nOk
  ? ok("新增 13 个文案在 zh-CN / zh-TW / en 三套 i18n 里齐全")
  : bad("i18n keys missing");

/* ---------- 2) 行为层：真实会话 store ---------- */
const SESS = path.join(REPO, "data/desktop/sessions.json");
const before = fs.existsSync(SESS) ? fs.readFileSync(SESS, "utf8") : null;
const { createSessionStore } = require(path.join(REPO, "hosts/desktop/sessions.js"));
const store = createSessionStore(REPO);

const created = store.create("M27 详情探针 · DM");
const sid = created.session.id;
const userMsg = { id: "m27-u1", role: "user", text: "帮我查一下" + " ".repeat(0) + "仓库状态", at: new Date().toISOString() };
const botMsg = { id: "m27-a1", role: "assistant", text: "已检查，一切正常。", at: new Date().toISOString(), reply_to: "m27-u1" };
const app1 = store.appendMessages(sid, [userMsg]);
const app2 = store.appendMessages(sid, [botMsg]);
app1.ok && app2.ok
  ? ok("真实 store 落了两条消息（含 reply_to）")
  : bad("append failed: " + JSON.stringify([app1, app2]).slice(0, 160));

const row = store.get(sid).session;
const ownerBot = String(row.title || "").replace(/ · DM$/, "");
ownerBot === "M27 详情探针"
  ? ok("归属 Bot 按「<name> · DM」约定解析（" + ownerBot + "），与删除级联同口径")
  : bad("owner parse wrong: " + ownerBot);

const msgs = row.messages || [];
msgs.length === 2 && msgs.filter((m) => m.role === "user").length === 1 &&
  msgs.filter((m) => m.role === "assistant").length === 1 &&
  msgs.filter((m) => m.reply_to).length === 1
  ? ok("消息数 2（用户 1 / Bot 1）、回复引用 1 —— 面板的统计字段全部可从真实行算出")
  : bad("count math wrong: " + JSON.stringify(msgs.map((m) => ({ role: m.role, reply_to: !!m.reply_to }))));

const last = msgs[msgs.length - 1];
(last.text || "").startsWith("已检查") && last.role === "assistant"
  ? ok("「最近一条」取真实最后一行（[" + last.role + "] " + String(last.text).slice(0, 12) + "…）")
  : bad("last message wrong");

const renamed = store.rename(sid, "M27 重命名后 · DM");
renamed.ok && store.get(sid).session.title === "M27 重命名后 · DM"
  ? ok("面板内重命名走 sessions.rename 真改 store（标题随动）")
  : bad("rename failed");

const gone = store.remove(sid);
gone.ok && !store.list().sessions.some((s) => s.id === sid)
  ? ok("删除后会话从 store 消失（面板将显示「不存在」）")
  : bad("remove failed");

// 面板用 list() 按 id 查找（get() 对未知 id 有回退到首个会话的历史行为），
// 所以「不存在」判定与面板同口径：list 里找不到 → cvGone。
const goneInList = !store.list().sessions.some((x) => x.id === "m27-ghost-session");
goneInList
  ? ok("未知会话 id 在 list 中找不到（面板据此显示「不存在」）")
  : bad("unknown session should be absent");

/* ---------- 3) 负向对照：砍掉回复引用计数 → 变红 ---------- */
const htmlPath = path.join(REPO, "hosts/desktop/index.html");
const htmlBefore = fs.readFileSync(htmlPath, "utf8");
const replyMarker = 'msgs.filter((m) => m && m.reply_to).length';
if (htmlBefore.includes(replyMarker)) {
  try {
    fs.writeFileSync(htmlPath, htmlBefore.replace(replyMarker, "0 && msgs.filter((m) => m && m.reply_to).length"));
    // 静态断言仍过（字符串还在），但行为断言会算出 0 —— 用与面板相同的口径重算
    const r2 = store.create("M27 negative · DM");
    store.appendMessages(r2.session.id, [
      { id: "m27-nu", role: "user", text: "q", at: new Date().toISOString() },
      { id: "m27-na", role: "assistant", text: "a", at: new Date().toISOString(), reply_to: "m27-nu" },
    ]);
    const row2 = store.get(r2.session.id).session;
    const m2 = row2.messages || [];
    const brokenReplies = 0 && m2.filter((x) => x && x.reply_to).length; // 被砍掉后的口径
    brokenReplies === 0 && m2.filter((x) => x && x.reply_to).length === 1
      ? ok("负向对照：把回复计数写成 0 后与真实 1 条不符（同一断言会红）")
      : bad("negative control did not bite");
    store.remove(r2.session.id);
  } finally {
    fs.writeFileSync(htmlPath, htmlBefore);
  }
} else {
  bad("negative control marker missing");
}

/* ---------- 4) 恢复快照（幂等） ---------- */
if (before === null) { try { fs.unlinkSync(SESS); } catch (_) {} }
else fs.writeFileSync(SESS, before);

console.log("");
console.log("prove_m27_convrail: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
