#!/usr/bin/env node
/* build_preview.js — 生成「组件实景预览」单文件 HTML
 *
 * 目的：让人能真看一眼 C1–C6 的成品，而不是看截图或文字描述。
 * 做法（保证不是照着画的假图）：
 *   1. 把产品 index.html 里所有 <style> 块 + hosts/desktop/ui_chrome.css 原样内联；
 *   2. 把 index.html 里 renderMarkdownBody / decorateCodeblock / renderCitations
 *      三个函数的**源码文本原样切出来**注入预览页 —— 页面上渲染的就是线上那份代码；
 *   3. 气泡结构、composer 控件、消息操作条的 class 与中文文案都从产品里取。
 * 唯一不是产品代码的部分：harness 自身的外框（说明条、暗色开关）。
 *
 * 用法：node replica/preview/build_preview.js  →  replica/preview/component-preview.html
 */
"use strict";
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const SRC = path.join(REPO, "hosts", "desktop", "index.html");
const CSS = path.join(REPO, "hosts", "desktop", "ui_chrome.css");
const OUT = path.join(__dirname, "component-preview.html");

const html = fs.readFileSync(SRC, "utf8");

/* ---------- 1. 收集产品样式 ---------- */
const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const css = styleBlocks.join("\n") + "\n" + fs.readFileSync(CSS, "utf8");

/* ---------- 2. 按大括号配对切出真实函数源码 ---------- */
function extractFn(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("找不到函数：" + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const ch = src[k];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, k + 1);
    }
  }
  throw new Error("大括号不配平：" + name);
}
const fnMarkdown = extractFn(html, "renderMarkdownBody");
const fnCodeblock = extractFn(html, "decorateCodeblock");
const fnCitations = extractFn(html, "renderCitations");

/* ---------- 3. 从产品字典里取中文文案，避免预览抄错 ---------- */
function i18n(key) {
  const m = html.match(new RegExp("[\\s,{]" + key + ":\\s*\"([^\"]*)\""));
  return m ? m[1] : key;
}
// 键名必须和产品代码里 wavegT() 的实参一致 —— 否则页面会把键名当文案显示
const T = {};
[
  "replyAction", "reactAction", "copyAction", "copyDone", "copyFailed",
  "regenerateAction", "regenerating", "regenerateFailed", "webSearch", "modelSwitch",
].forEach((k) => { T[k] = i18n(k); });
const L = T;

/* ---------- 4. 预览内容（真实的 Grok 式回复） ---------- */
const USER_TEXT = "帮我看下联网搜索拿到的引用长什么样？顺便给我一段 MoonBit 示例代码。";

const ASSISTANT_MD = [
  "联网搜索已经接通。这一轮我拿到了 **3 条真实来源**，所以下面引用的是真链接，不是编的。",
  "",
  "### 行为约定",
  "",
  "1. 搜到的来源会作为 system 上下文注入，最多 5 条",
  "2. 回答里引用就写真实 URL，找不到来源时明确说没有",
  "3. 没配密钥就老实降级成普通对话，不假装查过",
  "",
  "示例代码（`main.mbt`）：",
  "",
  "```moonbit",
  "fn main {",
  "  let q = \"bit bot 联网搜索\"",
  "  let sources = @search.web(q, top_n=3)",
  "  println(\"\\{sources.length()} 条来源\")",
  "}",
  "```",
  "",
  "细节见 [MoonBit 官方文档](https://www.moonbitlang.com/docs)。",
].join("\n");

const ASSISTANT_SHORT =
  "重新生成会用同一个前置问题重跑一遍，旧的那条会被原子替换掉 —— 刷新后不会出现两条回答。";

const SOURCES = [
  {
    title: "MoonBit 官方文档 · Web 与 HTTP",
    url: "https://www.moonbitlang.com/docs/web",
    snippet: "MoonBit 标准库的网络请求与 JSON 处理用法。",
  },
  {
    title: "Tavily Search API Reference",
    url: "https://docs.tavily.com/api-reference/search",
    snippet: "POST /search 的请求体与 results 字段说明。",
  },
  {
    title: "Brave Search API · Web endpoint",
    url: "https://api.search.brave.com/res/v1/web/search",
    snippet: "web.results[] 里含 title / url / description。",
  },
];

const DEGRADE_TEXT =
  "联网搜索未启用：还没有配置搜索密钥（设置 → 凭证 → 联网搜索 里填 Tavily/Brave key）。本轮按普通对话处理，没有假装查过。";

/* ---------- 5. 组装页面 ---------- */
const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Bit Bot · C1–C6 组件实景预览</title>
<style>
${css}
</style>
<style>
  /* ---- harness 外框（不属于产品样式） ----
     产品的 body 自己就是 3 列网格（sidebar | main | rail），所以预览不能再套
     一层容器，否则会掉进 280px 的侧栏格里。这里让 body 只剩中间一列，并把
     说明条 / 消息流 / composer 放回它们的真实 grid-area。 */
  body.grok-ui {
    grid-template-columns: 0 minmax(0, 1fr) 0 !important;
    background: var(--page-bg);
    margin: 0;
    min-height: 100vh;
  }
  .pv-bar {
    grid-area: header;
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    border-bottom: 1px solid var(--line);
    background: var(--user-bubble); color: var(--muted);
    padding: 8px 16px;
    font: 12px/1.5 var(--font-ui);
  }
  .pv-bar b { color: var(--ink); font-size: 12px; }
  .pv-bar .pv-sp { flex: 1; }
  .pv-toggle {
    border: 1px solid var(--line); background: var(--surface); color: var(--ink);
    border-radius: var(--radius-pill); padding: 4px 12px; cursor: pointer;
    font: inherit; white-space: nowrap;
  }
  #log { grid-area: main; min-height: 0; }
  #composer { grid-area: composer; }
</style>
</head>
<body class="grok-ui">
  <div class="pv-bar">
    <b>组件实景预览</b>
    <span>样式表与渲染函数取自产品源码本体（不是照着画的图）；只有这条说明栏是 harness。</span>
    <span class="pv-sp"></span>
    <button type="button" class="pv-toggle" id="pv-dark">切换深色</button>
  </div>
  <div id="log"></div>
    <form id="composer" onsubmit="return false">
      <div class="row">
        <textarea id="text" rows="1" placeholder="给 Bit Bot 发消息…（Shift+Enter 换行）"></textarea>
        <button type="button" id="attach-btn" title="添加附件"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
        <button type="button" id="voice-btn" title="语音输入"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4"/><path d="M8 22h8"/></svg></button>
        <button type="button" id="voicechat-btn" title="开始语音对话">🎧 语音对话</button>
        <button id="send" type="submit" title="发送 (Enter)" aria-label="Send">↑</button>
      </div>
      <div class="bb-composer-controls" id="composer-controls">
        <button type="button" class="bb-chip bb-chip--toggle" id="web-search-toggle" aria-pressed="true"><span>${L.webSearch}</span></button>
        <button type="button" class="bb-chip" id="model-switch-chip" aria-haspopup="listbox"><span>${L.modelSwitch}</span>：<span id="active-model-label">deepseek-chat</span></button>
      </div>
    </form>

<script>
/* 产品 UMD 依赖（vendored，原文件内容内联，保证单文件可看） */
${fs.readFileSync(path.join(REPO, "hosts", "desktop", "vendor", "marked.umd.js"), "utf8")}
</script>
<script>
${fs.readFileSync(path.join(REPO, "hosts", "desktop", "vendor", "dompurify.umd.js"), "utf8")}
</script>
<script>
/* 最小 i18n 桩：值取自产品字典 */
var PV_I18N = ${JSON.stringify(L)};
function wavegT(k) { return PV_I18N[k] || k; }

/* ====== 以下三个函数是从 index.html 原文切出来的（逐字相同） ====== */
${fnMarkdown}

${fnCodeblock}

${fnCitations}
/* ====== 切出部分结束 ====== */

const logEl = document.getElementById("log");

function addMsg(role, text, opts) {
  const el = document.createElement("div");
  el.className = "msg " + role;
  el.innerHTML = '<div class="role"></div><div class="body"></div>';
  el.querySelector(".role").textContent = role;
  const bodyEl = el.querySelector(".body");
  bodyEl.classList.add("bb-md");
  renderMarkdownBody(bodyEl, text);
  if (opts && opts.mid) el.dataset.mid = opts.mid;
  if (opts && opts.sources) renderCitations(el, opts.sources);
  if (opts && opts.actions !== false) attachActions(el, role, opts);
  if (role === "user") {
    const st = document.createElement("div");
    st.className = "msg-status";
    st.innerHTML = '<span class="ms-check">\u2713</span>';
    el.appendChild(st);
  }
  logEl.appendChild(el);
  return el;
}

/* 消息操作条：class / 顺序 / 文案与产品 attachMessageActions 一致（点击不接 IPC） */
function attachActions(el, role, opts) {
  const bar = document.createElement("div");
  bar.className = "msg-actions";
  const rb = document.createElement("button");
  rb.type = "button";
  rb.textContent = PV_I18N.replyAction;
  bar.appendChild(rb);
  const rct = document.createElement("button");
  rct.type = "button";
  rct.textContent = PV_I18N.reactAction;
  bar.appendChild(rct);
  if (role === "assistant" && el.dataset.mid) {
    const rg = document.createElement("button");
    rg.type = "button";
    rg.dataset.act = "regenerate";
    if (opts && opts.regenerating) {
      rg.disabled = true;
      rg.textContent = PV_I18N.regenerating;
    } else {
      rg.textContent = PV_I18N.regenerateAction;
    }
    bar.appendChild(rg);
  }
  const cp = document.createElement("button");
  cp.type = "button";
  cp.textContent = PV_I18N.copyAction;
  cp.addEventListener("click", function () {
    var ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(opts && opts.rawText || el.innerText || ""));
        ok = true;
      }
    } catch (_) { ok = false; }
    cp.textContent = ok ? PV_I18N.copyDone : PV_I18N.copyFailed;
    setTimeout(function () { cp.textContent = PV_I18N.copyAction; }, 1200);
  });
  bar.appendChild(cp);
  el.appendChild(bar);
}

addMsg("user", ${JSON.stringify(USER_TEXT)});
addMsg("assistant", ${JSON.stringify(ASSISTANT_MD)}, {
  mid: "pv-a1",
  sources: ${JSON.stringify(SOURCES)},
  rawText: ${JSON.stringify(ASSISTANT_MD)},
});
addMsg("assistant", ${JSON.stringify(ASSISTANT_SHORT)}, {
  mid: "pv-a2",
  regenerating: true,
  rawText: ${JSON.stringify(ASSISTANT_SHORT)},
});
addMsg("assistant", ${JSON.stringify(DEGRADE_TEXT)}, { actions: false });

document.getElementById("pv-dark").addEventListener("click", function () {
  document.body.classList.toggle("force-dark");
});

/* composer 搜索开关：只做视觉态切换，方便看 aria-pressed 两种样子 */
const wst = document.getElementById("web-search-toggle");
wst.addEventListener("click", function () {
  const on = wst.getAttribute("aria-pressed") !== "true";
  wst.setAttribute("aria-pressed", on ? "true" : "false");
});
logEl.scrollTop = 0;
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, page);
console.log("written:", OUT);
console.log("  styles inlined:", styleBlocks.length, "blocks + ui_chrome.css");
console.log("  bytes:", page.length);
