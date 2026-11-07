#!/usr/bin/env node
/* prove_avatar_contrast.js — 头像那一排必须「一套配色 + 白字读得清」。
 *
 * 为什么需要这道理：用户第一眼说的是「显示的图标感觉也奇怪」。当时的头像是
 *   ① 六个随机几何字形（四瓣花/气泡/六边形/星芒/圆环/菱形）
 *   ② 五组随机圆角（blob-*）
 *   ③ 十个高饱和采样色直接上屏
 * 三条叠在一起，一排头像像五个人拼的。改法是「品牌 mark / 单字 + 正圆 + 统一色调」，
 * 其中「统一色调」这一步会**压低亮度**，而压低亮度是在拿白字的可读性换整齐 ——
 * 所以要有一条尺子盯着这个交换有没有换过头。
 *
 * 判据（都可复算，不是「看起来还行」）：
 *   AC-01 头像容器是正圆（.sess-avatar / .strip-av 的 border-radius 都是 50%）
 *   AC-02 随机字形与随机圆角已经删干净（AVATAR_GLYPHS / blob-* 0 处）
 *   AC-03 上屏的十个色，白字对比度最低 ≥ 4.5:1（WCAG AA，正文级；
 *         15px/600 不算 large text，只能用 4.5 这档）
 *   AC-04 负向对照：**未 toned 的采样原色**跑同一个对比度判定，必须至少有一个 < 4.5
 *         —— 否则说明「压亮度」这一步根本没起作用，AC-03 的绿是白来的
 *   AC-05 十个色都要被 avatarColorFor 真的用到（哈希覆盖整张表，不是只用前三个）
 *
 * 跑法：node scripts/prove_avatar_contrast.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const DESKTOP = path.join(ROOT, "hosts/desktop");
const PALETTE = path.join(DESKTOP, "avatar_palette.js");
const HTML = path.join(DESKTOP, "index.html");
const CSS = path.join(DESKTOP, "ui_chrome.css");

let PASS = 0;
let FAIL = 0;
const ok = (msg) => { PASS++; console.log("  ✓ " + msg); };
const bad = (msg, extra) => {
  FAIL++;
  console.log("  ✗ " + msg + (extra !== undefined ? " — " + JSON.stringify(extra) : ""));
};

/* ---------------- WCAG 2.x 相对亮度与对比度 ---------------- */
function srgbToLin(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const h = String(hex).replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}
function contrastOnWhite(hex) {
  const l1 = 1.0; // 白
  const l2 = luminance(hex);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** 去注释：css 只去 /* *\/，js/html 额外去 // 行注释与以 * 开头的续行。
 *  只做这一件事 —— 判据问的是「代码里还有没有这个标识」，注释里的历史说明
 *  必须允许存在，否则没人敢在代码旁边写「为什么删」。 */
function stripComments(src, kind) {
  let out = String(src || "").replace(/\/\*[\s\S]*?\*\//g, " ");
  if (kind !== "css") {
    out = out
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !(t.startsWith("//") || t.startsWith("*"));
      })
      .join("\n");
  }
  return out;
}

/* ---------------- 1) 把 avatar_palette.js 真跑起来，拿上屏色 ---------------- */
const paletteSrc = fs.readFileSync(PALETTE, "utf8");
const sandbox = { window: {} };
/* 文件本体是 IIFE + window.avatarColorFor，直接当脚本执行即可（不 eval 字符串） */
vm.createContext(sandbox);
vm.runInContext(paletteSrc, sandbox, { filename: PALETTE });
if (typeof sandbox.window.avatarColorFor !== "function") {
  bad("AC-00", "avatar_palette.js 没有导出 window.avatarColorFor");
  console.log("\nprove_avatar_contrast: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(1);
}
const colorFor = sandbox.window.avatarColorFor;

/* 哈希覆盖：扫足够多的种子，收集所有出现过的颜色（应等于整张表） */
const used = new Map(); // color -> 首个种子
for (let i = 0; i < 500; i++) {
  const c = colorFor("seed-" + i);
  if (!used.has(c)) used.set(c, "seed-" + i);
}
const shown = Array.from(used.keys());

/* 采样原色：从源码里按顺序取（=== 未 toned 的那份，做负向对照用） */
const raw = (paletteSrc.match(/#[0-9a-fA-F]{6}/g) || []).slice(0, 10);

/* ---------------- 2) 判据 ---------------- */
const html = fs.readFileSync(HTML, "utf8");
const css = fs.readFileSync(CSS, "utf8");

{
  const sess = /\.sess-avatar\s*\{[^}]*border-radius:\s*50%\s*;/.test(css);
  const strip = /\.strip-av\s*\{[^}]*border-radius:\s*50%\s*;/.test(css);
  sess && strip
    ? ok("AC-01 头像容器是正圆（.sess-avatar / .strip-av 都 50%）")
    : bad("AC-01 头像容器不是正圆", { sess, strip });
}

{
  /* 只扫代码，不扫注释：删掉旧实现的同时会留一段「为什么删」的说明，
     那段说明里必然写着 AVATAR_GLYPHS / blob-1..4。第一版直接 grep 整份文件，
     于是把自己的注释当成了残留（和 prove_app_identity ID-10 同一个坑）。 */
  const htmlCode = stripComments(html, "js");
  const cssCode = stripComments(css, "css");
  const glyphs = /AVATAR_GLYPHS/.test(htmlCode);
  const blobCss = /\.blob-\d/.test(cssCode);
  const blobJs = /avatarBlobClass/.test(htmlCode);
  !glyphs && !blobCss && !blobJs
    ? ok("AC-02 随机字形与随机圆角已删干净（代码里 AVATAR_GLYPHS / .blob-N / avatarBlobClass 全 0 处）")
    : bad("AC-02 还留着随机字形/圆角", { glyphs, blobCss, blobJs });
}

{
  if (shown.length !== 10) {
    bad("AC-05 avatarColorFor 只用到 " + shown.length + " 个色（表里 10 个）", shown);
  } else {
    ok("AC-05 十个色都被 avatarColorFor 用到（500 个种子覆盖整张表）");
  }
}

{
  const rows = shown.map((c) => ({ c, ratio: Number(contrastOnWhite(c).toFixed(2)) }))
    .sort((a, b) => a.ratio - b.ratio);
  const worst = rows[0];
  if (!worst) {
    bad("AC-03 没取到上屏色");
  } else if (worst.ratio >= 4.5) {
    ok("AC-03 白字对比度最低 " + worst.ratio + ":1（" + worst.c + "，门槛 4.5:1）");
  } else {
    bad("AC-03 白字读不清：最低 " + worst.ratio + ":1（" + worst.c + "）", rows.slice(0, 4));
  }

  /* 负向对照：未 toned 的原色跑同一个判定 —— 必须至少一个不达标，
     否则「压亮度」这步等于没做，AC-03 的绿不能算数。 */
  const rawRows = raw.map((c) => ({ c, ratio: Number(contrastOnWhite(c).toFixed(2)) }))
    .sort((a, b) => a.ratio - b.ratio);
  const rawWorst = rawRows[0];
  if (!rawWorst) {
    bad("AC-04 没取到采样原色（负向对照跑不了）");
  } else if (rawWorst.ratio >= 4.5) {
    bad("AC-04 负向对照失效：未 toned 的原色最低也有 " + rawWorst.ratio + ":1，"
      + "说明 tone() 没在做可读性这件事，AC-03 不能算它挣来的");
  } else {
    ok("AC-04 负向对照：未 toned 的 " + rawWorst.c + " 只有 " + rawWorst.ratio
      + ":1（tone() 确实把这个亏补回来了）");
  }
}

/* ---------------- 3) 渠道图标（一个字母的方形牌子）同样要读得清 ---------------- */
{
  /* 这四个是 .bm-ic-* 的底色，里面是 12px/700 的白字。12px 不算 large text，
     只能用 4.5:1 这档 —— 原来直接用品牌色，最低只有 2.86:1（微信那块）。 */
  const cssCode = stripComments(css, "css");
  const found = {};
  const re = /\.bm-ic-([a-z]+)\s*\{[^}]*background:\s*(#[0-9a-fA-F]{6})/g;
  let m;
  while ((m = re.exec(cssCode))) found[m[1]] = m[2].toLowerCase();
  const need = ["dingtalk", "feishu", "wecom", "wechat"];
  const missing = need.filter((k) => !found[k]);
  if (missing.length) {
    bad("AC-06 找不到渠道图标底色：" + missing.join(", "));
  } else {
    const rows = need
      .map((k) => ({ k, c: found[k], ratio: Number(contrastOnWhite(found[k]).toFixed(2)) }))
      .sort((a, b) => a.ratio - b.ratio);
    rows[0].ratio >= 4.5
      ? ok("AC-06 四个渠道图标白字最低 " + rows[0].ratio + ":1（" + rows[0].k + " " + rows[0].c + "）")
      : bad("AC-06 渠道图标白字读不清", rows);
  }

  /* 负向对照：换成改动前的品牌原色，同一判定必须至少有一个不达标。 */
  const rawBrand = ["#2f7cf6", "#3370ff", "#2f9e6f", "#17b04a"];
  const rawRows = rawBrand
    .map((c) => ({ c, ratio: Number(contrastOnWhite(c).toFixed(2)) }))
    .sort((a, b) => a.ratio - b.ratio);
  if (rawRows[0].ratio >= 4.5) {
    bad("AC-06b 负向对照失效：品牌原色最低也有 " + rawRows[0].ratio + ":1（判据与事实脱节）");
  } else {
    ok("AC-06b 负向对照：品牌原色最低只有 " + rawRows[0].ratio + ":1（" + rawRows[0].c
      + "），压亮度确实是为这一步");
  }
}

console.log("\nprove_avatar_contrast: PASS=" + PASS + " FAIL=" + FAIL + "（AC-06 与 AC-03 同一把尺）");
process.exit(FAIL ? 1 : 0);
