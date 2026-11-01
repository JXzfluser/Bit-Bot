#!/usr/bin/env node
"use strict";

/**
 * prove_m34_account_actions — Wave M34「账户弹层入口全部真落地」
 *
 * 静态层：
 *   1) ap-usage / ap-add-account 通过 open settings anchor=... 短语进入对应的
 *      设置 tab（usage / profile 锚点在 SETTINGS_ANCHOR_TAB 里已注册）；
 *   1b) 手机这件事只有一个入口：账户弹层里没有 ap-mobile（获取移动版），
 *       移动版的现状与下一步写在 ap-remote 打开的「移动端远程控制」弹窗里，
 *       和配对码放在一起；anchor=pairing / tab=Phone 这类旧深链必须被那个弹窗
 *       接住 —— 它们指向的「设置 → 手机」页签已经不存在，静默落到「常规」
 *       等于点了没反应；
 *   2) ap-support / ap-signout 走 accountPlaceholder → addMsg，
 *      不再是空 click handler；文案中文化。
 *   3) 每个 handler 都会关闭 popup（.hidden = true），不会让菜单挡在设置页上。
 *
 * 负向对照：把 ap-usage 的 anchor=usage 短语替换成 "no-op" 后，第 1 项断言
 *          应变红（说明该断言不是恒真，是锚定在真实短语上的）。
 *          把 pairing 深链的接住逻辑抹掉、或把弹窗里的「装好怎么连」文案删掉，
 *          第 1b 项的落地 / 文案断言同样应变红。
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

/* ---------- 1b) 手机：一个入口，落点接得住 ---------- */
/* 三件事必须同时成立，缺一条用户就会撞上「点了没反应」：
   a) 账户弹层里不再单列「获取移动版」—— 它和「移动端远程控制」说的是同一件事；
   b) 被并过去的内容真的写进了那个弹窗（装哪份 + 怎么连），不是删完就没了；
   c) anchor=pairing / tab=Phone 这些旧深链被弹窗接住，而不是落到「常规」。
   有界窗口 [\s\S]{0,400} 是必须的：不封顶的正则会越过对象末尾撞上别处同名短语，
   断言就恒真了。 */
const noMobileRow = !/id="ap-mobile"/.test(html) && /id="ap-remote"/.test(html);

/* 文案断言必须锚定「元素内文」，不能锚定 mcAppNote 这个键名：
   键名在三语字典里各出现一次（zh / zh-TW / en），裸键名 + 有界窗口会撞到
   相邻语言版本里的同一句话 —— 断言于是恒真，抹掉中文文案也照样绿。
   这正是第一版负向对照假红的原因。 */
const mcAppBody = (src) => {
  const m = /data-i18n="mcAppNote">([\s\S]*?)<\/p>/.exec(src);
  return m ? m[1] : "";
};
const mcAppCopyOk = (src) => {
  const body = mcAppBody(src);
  return /安装包/.test(body) && /应用商店/.test(body) && /连接 Desktop/.test(body);
};

const appBlock = /id="mc-app-block"[\s\S]{0,400}?data-i18n="mcAppTitle"[\s\S]{0,700}?data-i18n="mcAppNote"/.test(html);
const appCopy = mcAppCopyOk(html);
const deepLinkCaught = /if \(anchor === "pairing"[\s\S]{0,400}openMobileControl\(/.test(html);
if (noMobileRow && appBlock && appCopy && deepLinkCaught) {
  ok("手机：账户弹层只留「移动端远程控制」一个入口；装哪份 / 怎么连写在弹窗里；anchor=pairing 落到弹窗而不是空页签");
} else {
  bad("mobile landing", JSON.stringify({
    noMobileRow, appBlock, appCopy, deepLinkCaught,
  }));
}

/* 锚点表里不该再有指向页签的 pairing：那个页签不存在，留着就是一张通往空地的地图。 */
!/SETTINGS_ANCHOR_TAB = \{[\s\S]{0,900}?"pairing":\s*"phone"/.test(html)
  ? ok("SETTINGS_ANCHOR_TAB 不再把 pairing 指到不存在的「手机」页签")
  : bad("anchor registry", "pairing 仍映射到 phone");

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

// 把 pairing 深链的接住逻辑改坏（anchor 比较写错一个字符），第 1b 项的落地断言应变红。
// 先确认这次 replace 真的动到了文件：短语一旦改名而 replace 落空，
// 「断言翻假」会变成恒真——那就不叫负向对照了。
const brokenDeepLink = html.replace('if (anchor === "pairing"', 'if (anchor === "pairing-x"');
if (brokenDeepLink === html) {
  bad("negative control mobile", "pairing 深链的接住逻辑找不到，对照失效");
} else if (!/if \(anchor === "pairing"[\s\S]{0,400}openMobileControl\(/.test(brokenDeepLink)) {
  ok("负向对照：抹掉 pairing 深链的接住逻辑 → 落地断言翻假（非恒真）");
} else {
  bad("negative control mobile", "deep-link assertion survives strip");
}

// 把「装好怎么连」那段正文字抹空（只剩一个空的 <p>），文案断言应变红。
// replace 的目标与 mcAppCopyOk 读的是同一个元素内文，两边口径必须一致。
const brokenCopy = html.replace(
  /(data-i18n="mcAppNote">)[\s\S]*?(<\/p>)/,
  "$1$2"
);
if (brokenCopy === html) {
  bad("negative control mc copy", "找不到 mcAppNote 元素，对照失效");
} else if (!mcAppCopyOk(brokenCopy)) {
  ok("负向对照：抹掉「怎么连」文案 → 文案断言翻假（非恒真）");
} else {
  bad("negative control mc copy", "copy assertion survives strip");
}

console.log("\nprove_m34_account_actions: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
