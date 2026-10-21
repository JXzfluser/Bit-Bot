#!/usr/bin/env node
"use strict";

/**
 * prove_m31_reactions — G-27 消息反应（官方 spec §5.1 composer「消息反应 (React)」）
 *
 * 静态层：hover 反应按钮 + 6 emoji picker、chips 渲染/点击撤销、transcript
 *        重载带回 reactions、IPC + preload 接线、reactAction 三语。
 * 行为层：真实 createSessionStore react——加反应计数、同 emoji 再加、撤销减到 0
 *        删键、未知消息/会话拒绝、非空校验；重载后 get(id) 读到同一 reactions。
 * 负向对照：砍掉 react 的 save(state) → 计数不落盘（断言变红）。
 * store 在 exit handler 恢复，双跑幂等。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.log("  ✗ " + m); };

console.log("M31 §5.1 消息反应 proof");

/* ---------- 1) 静态层 ---------- */
const htmlPath = path.join(REPO, "hosts/desktop/index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
const preloadJs = fs.readFileSync(path.join(REPO, "hosts/desktop/preload.js"), "utf8");
const sessionsJs = fs.readFileSync(path.join(REPO, "hosts/desktop/sessions.js"), "utf8");

/const rct = document\.createElement\("button"\);/.test(html) &&
  /"👍", "❤️", "😂", "🎉", "😮", "😢"/.test(html) &&
  /reaction-picker/.test(html)
  ? ok("hover「反应」按钮 + 6 emoji picker（与 Reply 同一条 msg-actions）")
  : bad("react affordance missing");

/function renderReactions/.test(html) && /reaction-chip/.test(html) &&
  /toggleMessageReaction\(el, emo, false\)/.test(html)
  ? ok("chips 从 store 行渲染，点击 chip 走同一 IPC 撤销一个反应")
  : bad("reaction chips missing");

/reactions: m\.reactions \|\| null,/.test(html)
  ? ok("transcript 重载把 reactions 传给 addMsg（重载不丢反应）")
  : bad("transcript reactions passthrough missing");

/bitbot:sessions:react/.test(mainJs) &&
  /react: \(sessionId, messageId, emoji, on\)/.test(preloadJs)
  ? ok("IPC bitbot:sessions:react + preload sessions.react 已暴露")
  : bad("react IPC missing");

/reactAction: "反应",/.test(html) && /reactAction: "反應",/.test(html) &&
  /reactAction: "React",/.test(html)
  ? ok("reactAction 文案在 zh-CN / zh-TW / en 三套 i18n 齐全")
  : bad("i18n key missing");

function react() {
  return /function react\(sessionId, messageId, emoji, on\)/.test(sessionsJs);
}
react() ? ok("sessions.react 落在 sessions store（单一事实源）") : bad("store react missing");

/* ---------- 2) 行为层：真实 store ---------- */
const SESS = path.join(REPO, "data/desktop/sessions.json");
const sessBefore = fs.existsSync(SESS) ? fs.readFileSync(SESS) : null;
const sjPath = path.join(REPO, "hosts/desktop/sessions.js");
const sjBefore = fs.readFileSync(sjPath, "utf8");

const store = require(path.join(REPO, "hosts/desktop/sessions.js")).createSessionStore(REPO);

process.on("exit", () => {
  try {
    if (sessBefore === null) fs.rmSync(SESS, { force: true });
    else fs.writeFileSync(SESS, sessBefore);
  } catch (_) {}
  // 负向对照会改写源码——源码恢复必须在这里（M29/M30 同款教训：exit handler
  // 一定要在 IIFE 之前注册，且覆盖所有被 sabotage 的文件）。
  try { fs.writeFileSync(sjPath, sjBefore); } catch (_) {}
});

(async () => {
  try {
    const created = store.create("M31 反应探针");
    const sid = created.session.id;
    const appended = store.appendMessages(sid, [
      { role: "user", text: "M31 反应探针消息" },
      { role: "assistant", text: "M31 反应探针回复" },
    ]);
    const msgs = appended.session.messages;
    const mid = msgs[1].id;
    Boolean(mid) ? ok("消息带稳定 id（GP-14 同源）") : bad("message id missing");

    const r1 = store.react(sid, mid, "👍", true);
    r1.ok && r1.reactions["👍"] === 1
      ? ok("加反应 → 计数 1")
      : bad("react on wrong: " + JSON.stringify(r1));
    const r2 = store.react(sid, mid, "👍", true);
    r2.ok && r2.reactions["👍"] === 2
      ? ok("同 emoji 再加 → 计数 2（per-emoji 计数器）")
      : bad("react accumulate wrong: " + JSON.stringify(r2));
    const r3 = store.react(sid, mid, "❤️", true);
    r3.ok && r3.reactions["👍"] === 2 && r3.reactions["❤️"] === 1
      ? ok("不同 emoji 分键互不覆盖")
      : bad("multi emoji wrong: " + JSON.stringify(r3));
    const r4 = store.react(sid, mid, "👍", false);
    r4.ok && r4.reactions["👍"] === 1
      ? ok("撤销 → 计数回落 1")
      : bad("react off wrong: " + JSON.stringify(r4));
    store.react(sid, mid, "👍", false);
    const r5 = store.react(sid, mid, "👍", false);
    r5.ok && !("👍" in r5.reactions)
      ? ok("减到 0 → 键删除（不残留 0 假计数）")
      : bad("zero cleanup wrong: " + JSON.stringify(r5));
    const unknown = store.react(sid, "msg-nope", "👍", true);
    unknown.ok === false && unknown.error === "message_not_found"
      ? ok("未知消息 message_not_found（不造反应）")
      : bad("unknown message wrong: " + JSON.stringify(unknown));
    const unknownSess = store.react("sess-nope", mid, "👍", true);
    unknownSess.ok === false && unknownSess.error === "session_not_found"
      ? ok("未知会话 session_not_found（不造反应）")
      : bad("unknown session wrong: " + JSON.stringify(unknownSess));
    const invalid = store.react(sid, mid, "", true);
    invalid.ok === false && invalid.error === "invalid_reaction"
      ? ok("空 emoji invalid_reaction")
      : bad("empty emoji accepted");

    store.react(sid, mid, "🎉", true);
    const reloaded = store.get(sid);
    const reMsg = (reloaded.session.messages || []).find((m) => m.id === mid);
    reMsg && reMsg.reactions && reMsg.reactions["🎉"] === 1
      ? ok("重载 get(id) 读到同一 reactions（渲染层重载安全）")
      : bad("reload mismatch: " + JSON.stringify(reMsg && reMsg.reactions));

    /* ---------- 3) 负向对照：砍掉 save(state) → 不落盘 ---------- */
    const marker = "    if (next > 0) hit.reactions[emo] = next;\n    else delete hit.reactions[emo];\n    save(state);";
    const broken = sjBefore.replace(marker, "    if (next > 0) hit.reactions[emo] = next;\n    else delete hit.reactions[emo];");
    if (broken !== sjBefore) {
      fs.writeFileSync(sjPath, broken);
      delete require.cache[require.resolve(sjPath)];
      const store2 = require(sjPath).createSessionStore(REPO);
      const c2 = store2.create("M31 负向对照");
      const a2 = store2.appendMessages(c2.session.id, [{ role: "user", text: "负向" }]);
      const m2 = a2.session.messages[0].id;
      store2.react(c2.session.id, m2, "👍", true);
      const re2 = store2.get(c2.session.id);
      const msg2 = (re2.session.messages || []).find((x) => x.id === m2);
      !(msg2 && msg2.reactions && msg2.reactions["👍"])
        ? ok("负向对照：禁用 save 后反应不落盘（断言会红）")
        : bad("negative control did not break persistence");
    } else {
      bad("negative control marker not found in sessions.js");
    }

    console.log("\nprove_m31_reactions: PASS=" + pass + " FAIL=" + fail);
    process.exit(fail ? 1 : 0);
  } catch (err) {
    console.error("probe crashed:", err);
    process.exit(1);
  }
})();
