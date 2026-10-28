#!/usr/bin/env node
"use strict";

/**
 * prove_m34_account_actions — Wave M34「账户弹层入口全部真落地」
 *
 * 静态层：
 *   1) ap-usage / ap-add-account 通过 open settings anchor=... 短语进入对应的
 *      设置 tab（usage / profile 锚点在 SETTINGS_ANCHOR_TAB 里已注册）；
 *   1b) ap-mobile 不再是占位：文案 + 真的落到「凭证」页（anchor=security-keys），
 *       因为手机配对地址与令牌现在只有那一屏给得出来；
 *   2) ap-support / ap-signout 走 accountPlaceholder → addMsg，
 *      不再是空 click handler；文案中文化。
 *   3) 每个 handler 都会关闭 popup（.hidden = true），不会让菜单挡在设置页上。
 *
 * 负向对照：把 ap-usage 的 anchor=usage 短语替换成 "no-op" 后，第 1 项断言
 *          应变红（说明该断言不是恒真，是锚定在真实短语上的）。
 *          把 ap-mobile 的 anchor=security-keys 抹掉后，第 1b 项同样应变红。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M34 account-popup wiring proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* ---------- 1) 每项 → open settings anchor ---------- */
/* ap-update 已下线：版本更新只保留「设置 → 更新」一处入口，弹层不再有这一行。 */
const anchorPhrases = [
  ["ap-usage", "anchor=usage"],
  ["ap-add-account", "anchor=profile"],
];
let allAnchors = true;
for (const [id, phrase] of anchorPhrases) {
  const re = new RegExp('\\["' + id + '",\\s*"open settings[^"]*' + phrase);
  if (!re.test(html)) { allAnchors = false; bad("account anchor " + id, phrase + " missing"); }
}
if (allAnchors) ok("两项（用量 / 添加账户）通过 open settings anchor=… 进入真实 tab");

/* ---------- 1b) 锚点必须存在于 SETTINGS_ANCHOR_TAB ---------- */
if (/SETTINGS_ANCHOR_TAB = \{[\s\S]*?"update-status":\s*"updates"/.test(html)
  && /SETTINGS_ANCHOR_TAB = \{[\s\S]*?"usage":\s*"usage"/.test(html)
  && /SETTINGS_ANCHOR_TAB = \{[\s\S]*?"profile":\s*"general"/.test(html)) {
  ok("update-status / usage / profile 三个锚点在 SETTINGS_ANCHOR_TAB 已注册");
} else {
  bad("anchor registry", "one of the anchors is missing");
}

/* ---------- 1b) 移动版：文案 + 真的落到「凭证」页 ---------- */
const mobileRe = /getElementById\("ap-mobile"\)[\s\S]{0,900}anchor=security-keys[\s\S]{0,200}skipSession/;
const mobileCopy = /getElementById\("ap-mobile"\)[\s\S]{0,900}配对令牌[\s\S]{0,120}允许手机连接/;
if (mobileRe.test(html) && mobileCopy.test(html)) {
  ok("移动版：不再只报「内测」—— 说清配对令牌 / 允许手机连接，并落到凭证页");
} else {
  bad("mobile landing", JSON.stringify({ anchor: mobileRe.test(html), copy: mobileCopy.test(html) }));
}

/* ---------- 2) 两项 → 中文占位 callout（非静默 no-op） ---------- */
const placeholderIds = ["ap-support", "ap-signout"];
let allPlace = true;
for (const id of placeholderIds) {
  const re = new RegExp('getElementById\\("' + id + '"\\)[\\s\\S]{0,240}accountPlaceholder\\("[^"]*[\\u4e00-\\u9fa5]');
  if (!re.test(html)) { allPlace = false; bad("placeholder " + id, "no localized accountPlaceholder call"); }
}
if (allPlace) ok("支持 / 退出登录 两项：中文占位文案 + addMsg，不静默");

/* ---------- 3) 每个 handler 关闭 popup ---------- */
if (/setAccountPopup\(false\);[\s\S]{0,120}runUserTurn\(phrase/.test(html)
  && /accountPlaceholder = \(msg\) => \{[\s\S]{0,200}setAccountPopup\(false\)/.test(html)) {
  ok("handler 都收口：先关 popup 再走短语 / callout，菜单不会挡住设置页");
} else {
  bad("popup close", "one handler misses close");
}

/* ---------- 4) 负向对照 ---------- */
// 把 anchor=usage 短语替换成 "no-op"，第 1 项的 ap-usage 断言应变红。
const broken = html.replace('"open settings entry=account anchor=usage"', '"no-op"');
const survived = /\["ap-usage",\s*"open settings[^"]*anchor=usage/.test(broken);
if (!survived) ok("负向对照：抹掉 anchor=usage 短语 → 断言翻假（非恒真）");
else bad("negative control", "anchor=usage assertion survives strip");

// 把 ap-mobile 的 anchor=security-keys 换成 "no-op"，第 1b 项同样应变红。
const brokenMobile = html.replace(
  '"open settings entry=account anchor=security-keys"',
  '"no-op"',
);
if (!/getElementById\("ap-mobile"\)[\s\S]{0,900}anchor=security-keys/.test(brokenMobile)) {
  ok("负向对照：抹掉移动版 anchor=security-keys → 落地断言翻假（非恒真）");
} else {
  bad("negative control mobile", "mobile anchor assertion survives strip");
}

console.log("\nprove_m34_account_actions: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
