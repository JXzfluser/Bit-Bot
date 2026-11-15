#!/usr/bin/env node
"use strict";
/**
 * prove_i18n_render.js —— Copy contract 的**渲染门**(IR-01..IR-05)
 *
 * 合同 §4 的口径原文:「对**渲染后 DOM** 收集 textContent / placeholder /
 * title / aria-label …」，「**en 模式下的任何汉字**」算违规。
 *
 * 所以这条门不看源码,看**真渲染出来**的页面:
 *   IR-01 en 模式下,渲染后 DOM 的可见文本里 **0 个汉字**
 *   IR-02 加载过程 **0 个 pageerror**(TDZ 之类会在这里露出来)
 *   IR-03 负向对照:注入一处中文 ⇒ IR-01 必须抓得到(判据不是恒绿)
 *   IR-04 切回 zh-CN,中文回来了(证明 sweep 两头都通,不是只清一次)
 *   IR-05 负向对照:注入一处 pageerror ⇒ IR-02 必须抓得到
 *
 * 为什么用 headless Chromium 而不是 Electron:这个门要的是**渲染后 DOM**,
 * 而 Electron 在 CI 上装不动。Chromium 用仓库已有的 playwright-core 依赖
 * (hosts/desktop/package.json 的 devDependencies 里就有)。
 *
 * 跑法:node scripts/prove_i18n_render.js
 * 浏览器拿不到时:**rc=2 = SKIP**(仓库对「需要外部条件」用 rc=2 的约定,
 * 例如 prove_production_provider.js)。SKIP 不等于 PASS —— 报告里必须写明没跑。
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HTML = path.join(REPO, "hosts/desktop/index.html");
const CJK = /[一-鿿㐀-䶿]/;

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const skip = (m) => console.log("  · SKIP " + m + "（没验到，不算通过）");

/* ── 找 playwright-core ─────────────────────────────────────────────────── */
function loadPlaywright() {
  const cands = [
    path.join(REPO, "hosts/desktop/node_modules/playwright-core"),
    path.join(REPO, "node_modules/playwright-core"),
  ];
  if (process.env.PLAYWRIGHT_CORE_PATH) cands.unshift(process.env.PLAYWRIGHT_CORE_PATH);
  for (const c of cands) {
    try { return require(c); } catch (_) { /* 试下一个 */ }
  }
  return null;
}

/* ── 找 Chromium 可执行文件 ─────────────────────────────────────────────── */
function findChromium(pw) {
  const envs = [process.env.BITBOT_CHROMIUM, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE];
  for (const e of envs) if (e && fs.existsSync(e)) return e;
  if (pw) {
    try {
      const p = pw.chromium.executablePath();
      if (p && fs.existsSync(p)) return p;
    } catch (_) { /* 没装浏览器 */ }
  }
  // playwright 的浏览器缓存目录(名字带版本号,glob 一下)
  const roots = [
    path.join(process.env.HOME || "", ".cache/ms-playwright"),
    path.join(REPO, "node_modules/playwright-core/.local-browsers"),
  ];
  for (const root of roots) {
    try {
      const dirs = fs.readdirSync(root).filter((d) => d.startsWith("chromium-"));
      for (const d of dirs) {
        for (const rel of ["chrome-linux64/chrome", "chrome-win/chrome.exe", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
          const p = path.join(root, d, rel);
          if (fs.existsSync(p)) return p;
        }
      }
    } catch (_) { /* 没有这个目录 */ }
  }
  return null;
}

(async () => {
  console.log("prove_i18n_render (渲染后 DOM 的 i18n 体检)");
  const pw = loadPlaywright();
  if (!pw) {
    skip("没有 playwright-core —— 渲染门没跑（CI 上先 npm i playwright-core）");
    console.log("\nprove_i18n_render: SKIP(没有 playwright-core)");
    process.exit(2);
  }
  const exe = findChromium(pw);
  if (!exe) {
    skip("没有 Chromium —— 渲染门没跑（npx playwright install chromium）");
    console.log("\nprove_i18n_render: SKIP(没有 Chromium)");
    process.exit(2);
  }

  const browser = await pw.chromium.launch({
    executablePath: exe,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e).split("\n")[0]));

  await page.goto("file://" + HTML, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const collect = () => page.evaluate(() => {
    const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
    const hits = [];
    const seen = new Set();
    const add = (kind, el, v) => {
      const s = String(v == null ? "" : v).trim();
      if (!s) return;
      if (!/[一-鿿㐀-䶿]/.test(s)) return;
      const key = kind + "|" + (el.id || "") + "|" + (el.className || "") + "|" + s;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push(kind + " <" + el.tagName.toLowerCase() +
        (el.id ? " id=" + el.id : "") + "> " + s.slice(0, 60));
    };
    document.querySelectorAll("*").forEach((el) => {
      if (skipTags.has(el.tagName)) return;
      const kids = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (kids.length) add("text", el, kids.map((n) => n.textContent).join(" ").trim());
      for (const attr of ["placeholder", "title", "aria-label"]) {
        if (el.hasAttribute && el.hasAttribute(attr)) add(attr, el, el.getAttribute(attr));
      }
    });
    const title = document.title;
    if (/[一-鿿㐀-䶿]/.test(title)) hits.unshift("title " + title);
    return hits;
  });

  /* ── 切英文 ── */
  const switched = await page.evaluate(() => {
    if (typeof wavegLangApply !== "function") return false;
    wavegLangApply("en");
    return true;
  });
  await page.waitForTimeout(500);

  if (!switched) {
    bad("能切到 en（wavegLangApply 存在）");
  } else {
    const enHits = await collect();
    if (!enHits.length) ok("IR-01 en 模式下渲染后 DOM 里 0 个汉字（合同 §4 的口径）");
    else bad("IR-01 en 模式下渲染后 DOM 里 0 个汉字", enHits.slice(0, 6).join(" | "));
  }

  /* ── IR-02 pageerror ── */
  if (!pageErrors.length) ok("IR-02 加载过程 0 个 pageerror");
  else bad("IR-02 加载过程 0 个 pageerror", [...new Set(pageErrors)].slice(0, 4).join(" | "));

  /* ── IR-03 负向对照:注入一处中文,IR-01 必须抓得到 ── */
  const injected = await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "__i18n_probe__";
    d.textContent = "临时中文探针";
    document.body.appendChild(d);
    return true;
  });
  const afterInject = await collect();
  const caught = afterInject.some((h) => h.indexOf("临时中文探针") >= 0);
  await page.evaluate(() => {
    const d = document.getElementById("__i18n_probe__");
    if (d) d.remove();
  });
  if (injected && caught) ok("IR-03 负向对照：注入一处中文 ⇒ 扫描抓得到（判据不是恒绿）");
  else bad("IR-03 负向对照：注入一处中文 ⇒ 扫描抓得到（判据不是恒绿）", "注入后没被抓到");

  /* ── IR-04 切回 zh-CN,中文要回来 ── */
  await page.evaluate(() => { if (typeof wavegLangApply === "function") wavegLangApply("zh-CN"); });
  await page.waitForTimeout(400);
  const zhHits = await collect();
  if (zhHits.length) ok(`IR-04 切回 zh-CN 后中文回来了（${zhHits.length} 处中文可见）`);
  else bad("IR-04 切回 zh-CN 后中文回来了", "切回去后一处中文都没有 —— sweep 可能把界面清空了");

  /* ── IR-05 负向对照:注入一处 pageerror ⇒ IR-02 必须抓得到 ── */
  const errProbe = await page.evaluate(() => {
    setTimeout(() => { throw new Error("__i18n_probe_error__"); }, 0);
    return true;
  });
  await page.waitForTimeout(300);
  if (errProbe && pageErrors.some((e) => e.indexOf("__i18n_probe_error__") >= 0)) {
    ok("IR-05 负向对照：注入一处 pageerror ⇒ 捕获得到（判据不是恒绿）");
  } else {
    bad("IR-05 负向对照：注入一处 pageerror ⇒ 捕获得到（判据不是恒绿）", "注入后没被捕获");
  }

  await browser.close();
  console.log(`\nprove_i18n_render: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e && (e.stack || e.message) || e);
  process.exit(1);
});
