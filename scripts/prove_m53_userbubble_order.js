#!/usr/bin/env node
"use strict";

/**
 * prove_m53_userbubble_order — 群里的「我说的话」整行被涂黑（CSS 同权重先后）
 *
 * 现象：浅色模式下，群里自己发的那条消息连「我 · 时间」的身份行、勾、复制按钮
 * 一起被涂成深色块 —— 深灰小字压在近黑底上，几乎看不见；而私聊里是对的。
 *
 * 原因不是配色，是**两条选择器同权重、后写的那条赢**：
 *   - `body.grok-ui .msg.room-user { background: transparent }`（群气泡：外壳透明，
 *     气泡落到 .body 上，好让身份行排在气泡外面）—— (0,3,1)
 *   - `body.grok-ui .msg.user { background: var(--user-bubble) }`（私聊气泡的
 *     尺寸/配色，位置更靠后）—— 也是 (0,3,1)
 * 同权重看先后 → 后面那条把外壳又涂黑了；`.body` 同理会掉回 transparent，
 * 于是「气泡」变成整行。
 *
 * 修法不是调顺序（下次再加一条同权重的规则又会翻），而是**把权重拉开**：
 * 群气泡的选择器带上 `.user`（→ (0,4,1)），谁是后来的都盖不住它。
 *
 * 契约（都要有负向对照，否则等于没断言）：
 *   1. 群气泡的外壳规则同时带 `.user` 与 `.room-user`，且类数严格大于
 *      后面那条 `.msg.user`；
 *   2. 气泡本体（.body）的规则同理，且外壳是 transparent、本体才是 --user-bubble；
 *   3. 私聊那条 `.msg.user` 的配色仍然在（不是靠删掉它来「修好」）。
 */

const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const REPO = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(REPO, "hosts/desktop/ui_chrome.css"), "utf8");

/** 数一个选择器里的类数（`.a.b` → 2）。带 :not() 的按里面也算（保守：两边同样处理）。 */
const classes = (sel) => (String(sel).match(/\./g) || []).length;

const shellSel = "body.grok-ui .msg.user.room-user";
const bodySel = "body.grok-ui .msg.user.room-user .body";
const dmSel = "body.grok-ui .msg.user";

/** 取某条规则的大括号内容（第一条匹配）。 */
function ruleBody(src, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = src.match(new RegExp(esc + "\\s*\\{([\\s\\S]*?)\\}", "m"));
  return m ? m[1] : null;
}

/* T1 群气泡外壳：带 .user，且权重严格大于私聊那条 */
{
  const shell = ruleBody(CSS, shellSel);
  const greater = classes(shellSel) > classes(dmSel);
  shell && greater && /background:\s*transparent/.test(shell)
    ? ok("T1 群气泡外壳规则权重 " + classes(shellSel) + " > 私聊 " + classes(dmSel) + "，且外壳透明")
    : bad("T1 群气泡外壳没压过私聊那条", JSON.stringify({ found: !!shell, shell: classes(shellSel), dm: classes(dmSel) }));
}

/* T2 气泡本体：背景才是深色，且带 .user */
{
  const body = ruleBody(CSS, bodySel);
  const shell = ruleBody(CSS, shellSel) || "";
  body && classes(bodySel) > classes(dmSel) &&
    /background:\s*var\(--user-bubble\)/.test(body) &&
    /color:\s*var\(--on-fill\)/.test(body) &&
    !/background:\s*var\(--user-bubble\)/.test(shell)
    ? ok("T2 深色只落在 .body 上（" + classes(bodySel) + " > " + classes(dmSel) + "），外壳不吃配色")
    : bad("T2 气泡本体规则不对", JSON.stringify({ found: !!body, c: classes(bodySel) }));
}

/* T3 私聊那条没被删（不是靠删掉它来「修好」）。同一个选择器在文件里出现多次，
   要扫全部，不能只看第一条（第一条只管 padding）。 */
{
  const esc = dmSel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies = Array.from(CSS.matchAll(new RegExp(esc + "\\s*\\{([\\s\\S]*?)\\}", "gm"))).map((m) => m[1]);
  const hasBubble = bodies.some((b) => /background:\s*var\(--user-bubble\)/.test(b));
  hasBubble && bodies.length >= 2
    ? ok("T3 私聊气泡的配色规则仍在（修的是群气泡，不是把私聊改坏）")
    : bad("T3 私聊气泡规则被误删", JSON.stringify({ n: bodies.length }));
}

/* T4 勾的颜色跟着落到气泡外：白底上用 --muted，不是 on-fill 的浅色 */
{
  const has = /body\.grok-ui \.msg\.user\.room-user \.msg-status \{\s*color:\s*var\(--muted\)/.test(CSS);
  has ? ok("T4 气泡外的 ✓ 用 --muted（深气泡里那套浅色挪到白底就看不见了）")
    : bad("T4 勾的颜色没跟着改");
}

/* T5 负向对照：把 `.user` 从群气泡选择器里抹掉 → 权重回到同分，T1/T2 翻假 */
{
  const broken = CSS.replace(/body\.grok-ui \.msg\.user\.room-user/g, "body.grok-ui .msg.room-user");
  const shell = ruleBody(broken, "body.grok-ui .msg.room-user");
  const stillGreater = classes("body.grok-ui .msg.room-user") > classes(dmSel);
  shell && !stillGreater
    ? ok("T5 负向对照：抹掉 .user → 权重退回 " + classes("body.grok-ui .msg.room-user") +
        "（与私聊同分），T1 翻假（非恒真）")
    : bad("T5 负向对照恒真", JSON.stringify({ shell: !!shell, greater: stillGreater }));
}

console.log("\nprove_m53_userbubble_order: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
