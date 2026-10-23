#!/usr/bin/env node
"use strict";

/**
 * GP-93/94/95「Markdown/链接纪律」proof — runs without Electron (smoke G-19).
 *
 * Official Grok spec §5.6 (mirrored as docs/grok-desktop-parity/spec.md G-13)
 * demands: 链接可点击打开 / 在系统浏览器打开 / 悬停预览不自动导航 / 输入凭证
 * 或批准外部操作前检查目标. A pretty <a> tag would be a UI shell, so this
 * probe drives the real layers:
 *
 *   provider reply with a bare URL
 *     → kernel linkify + CM-0111 deliver (real `moon run cmd/desktop_turn`)
 *     → shared policy module (hosts/desktop/link_discipline.js) turns the
 *        delivered markdown into DOM nodes via a fake DOM — the SAME file the
 *        renderer loads as window.__bitbotLinks and main.js requires for its
 *        open route, so there is no second implementation to be green about
 *     → createLinkOpen (hosts/desktop/link_open.js) with a spy openExternal:
 *        scheme gate, audit row, refusal trace in data/desktop/links.jsonl.
 *
 * Honesty checks: javascript:/data:/file:/mailto:/whitespace URLs must be
 * refused AND leave an audit row (a blocked attempt that vanishes proves
 * nothing); non-link text must never become HTML (no innerHTML injection);
 * the renderer must not gain navigation ability from an anchor.
 *
 * Usage: node scripts/prove_gp93_links.js   (exit 0 = all assertions green)
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const STUB_PORT = Number(process.env.BITBOT_G19_STUB_PORT || 8796);
const AUDIT = path.join(REPO, "data/desktop/gp19-probe-links.jsonl");
const BARE_URL = "https://example.com/docs?g=19#x";
const MD_URL = "https://status.example.org/a/b";
const PROVIDER_REPLY =
  "文档在 " + BARE_URL + " ，仪表盘见 [状态页](" + MD_URL + ") 。";

let PASS = 0;
let FAIL = 0;
const ok = (name) => {
  PASS++;
  console.log("  ✓ " + name);
};
const bad = (name, detail) => {
  FAIL++;
  console.log("  ✗ " + name + (detail ? " — " + String(detail).slice(0, 200) : ""));
};

/* Minimal DOM stand-in: only what applyLinkBody touches. Crucially there is no
 * innerHTML setter here at all — if the policy tried to use it, this probe
 * would fail rather than silently pass. */
function makeDom() {
  function node(text) {
    return {
      nodeName: "#text",
      textContent: String(text),
      get outerHTML() {
        throw new Error("text node must not be serializable as HTML");
      },
    };
  }
  function el(tag) {
    const attrs = {};
    return {
      nodeName: String(tag).toUpperCase(),
      className: "",
      childNodes: [],
      textContent: "",
      appendChild(c) {
        this.childNodes.push(c);
        if (c.nodeName === "#text") this.textContent += c.textContent;
        return c;
      },
      removeChild(c) {
        this.childNodes = this.childNodes.filter((x) => x !== c);
        return c;
      },
      setAttribute(k, v) {
        attrs[k] = String(v);
      },
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
      },
      set innerHTML(_v) {
        throw new Error("policy module must never use innerHTML");
      },
    };
  }
  return {
    root: el("div"),
    createElement: el,
    createTextNode: node,
  };
}

function flatten(container) {
  let text = "";
  const tags = [];
  for (const c of container.childNodes) {
    if (c.nodeName === "#text") text += c.textContent;
    else {
      tags.push({ tag: c.nodeName, href: c.getAttribute("href"), rel: c.getAttribute("rel"), label: c.textContent });
      text += c.textContent;
    }
  }
  return { text, tags };
}

async function main() {
  fs.rmSync(AUDIT, { force: true });
  let stub = null;
  try {
    /* ---- 1) shared policy module: rendering + scheme gate (no Electron) ---- */
    const links = require(path.join(REPO, "hosts/desktop/link_discipline.js"));
    if (!links || typeof links.applyLinkBody !== "function") {
      bad("GP-93 policy module 加载", "link_discipline.js 未导出 applyLinkBody");
      throw new Error("policy module missing");
    }
    ok("GP-93 政策模块加载（renderer 与 main 共用同一份 hosts/desktop/link_discipline.js）");

    const dom = makeDom();
    const applied = links.applyLinkBody(dom.root, PROVIDER_REPLY, {
      createElement: dom.createElement,
      createTextNode: dom.createTextNode,
    });
    const flat = flatten(dom.root);
    const byHref = {};
    for (const t of flat.tags) byHref[t.href] = t;
    flat.tags.length === 2 && byHref[BARE_URL] && byHref[MD_URL]
      ? ok("GP-93 kernel 侧链接经政策模块变成 2 个 <a>（裸 URL + [label](url) 各一，href 逐字一致）")
      : bad("GP-93 anchor build", JSON.stringify(flat.tags).slice(0, 260));
    applied.links.length === 2 &&
      applied.links.find((l) => l.url === MD_URL).label === "状态页" &&
      applied.links.find((l) => l.url === BARE_URL).hostname === "example.com"
      ? ok("GP-93/95 解析出 label（状态页）与 hostname（example.com）供悬停卡使用")
      : bad("GP-93 link metadata", JSON.stringify(applied.links).slice(0, 240));
    // 文本内容不得丢失任何非链接字符（外壳式实现常把整段换成链接）
    flat.text.includes("文档在 ") && flat.text.includes(" ，仪表盘见 ") && flat.text.includes(" 。")
      ? ok("GP-93 链接外的正文一字不少（不是把消息替换成链接）")
      : bad("GP-93 text preservation", JSON.stringify(flat.text).slice(0, 200));

    const hostile = makeDom();
    const hostileParsed = links.linkBodyToDom(
      '坏链接 [点我](javascript:alert(1)) 与 <img src=x onerror=alert("1")> 原文，' +
        "还有 [邮件](mailto:a@b.c) 与 [本地](file:///etc/passwd) 与 [数据](data:text/html,<b>)。",
    );
    hostileParsed.links.length === 0
      ? ok("GP-93 javascript:/mailto:/file:/data: 一律不可点（0 个链接，无 scheme 绕过）")
      : bad("GP-93 scheme refusal in body", JSON.stringify(hostileParsed.links).slice(0, 240));
    links.applyLinkBody(hostile.root, '坏链接 [点我](javascript:alert(1)) 与 <img src=x onerror=alert("1")> 原文', {
      createElement: hostile.createElement,
      createTextNode: hostile.createTextNode,
    });
    const hostileFlat = flatten(hostile.root);
    hostileFlat.tags.length === 0 &&
      hostileFlat.text.includes("[点我](javascript:alert(1))") &&
      hostileFlat.text.includes('<img src=x onerror=alert("1")>')
      ? ok("GP-93 不可打开的内容原样留成文字（不静默删、不解析 HTML，DOM 里 0 个元素）")
      : bad("GP-93 fail-closed text", JSON.stringify(hostileFlat).slice(0, 260));

    /* ---- 2) scheme policy table (the gate main.js uses) ---- */
    const gate = [
      ["https://ok.example/x", true],
      ["http://ok.example/x", true],
      ["HTTPS://OK.EXAMPLE/x", true],
      ["javascript:alert(1)", false],
      ["JavaScript:alert(1)", false],
      ["data:text/html;base64,PHN2Zz4=", false],
      ["file:///etc/passwd", false],
      ["mailto:someone@example.com", false],
      ["intent://scan/#Intent", false],
      ["java\u0009script:alert(1)", false],
      ["https://ok.example/a b", false],
      ["", false],
      ["   ", false],
      ["not a url at all", false],
    ];
    let gateBad = [];
    for (const [u, want] of gate) {
      const got = links.parseExternalUrl(u);
      if (Boolean(got.ok) !== want) gateBad.push(u + "→" + got.ok + "(" + got.error + ")");
    }
    gateBad.length === 0
      ? ok("GP-94 scheme 门表 14 例全对（含大写 HTTPS、tab 混淆、空白 URL、空串、无 scheme）")
      : bad("GP-94 scheme gate", gateBad.join(" | ").slice(0, 300));
    const hostCase = links.parseExternalUrl("HTTPS://EXAMPLE.COM/Path");
    hostCase.ok && hostCase.hostname === "example.com" && hostCase.url === "https://example.com/Path"
      ? ok("GP-94 host 大小写规范化后按 WHATWG 结果放行（path 大小写保留，不虚构）")
      : bad("GP-94 host normalize", JSON.stringify(hostCase).slice(0, 200));

    /* ---- 3) real open route + audit trail (link_open.js, main.js 用的同一个) ---- */
    const opened = [];
    const { createLinkOpen } = require(path.join(REPO, "hosts/desktop/link_open.js"));
    const route = createLinkOpen({
      repoRoot: REPO,
      auditPath: AUDIT,
      openExternal: async (url) => {
        opened.push(url);
        return { ok: true };
      },
    });
    const goodRes = await route.open(BARE_URL, { source: "probe", sessionId: "sess-gp19probe" });
    goodRes.ok === true && goodRes.decision === "open_external" && goodRes.url === BARE_URL &&
      goodRes.hostname === "example.com" && opened.length === 1
      ? ok("GP-94 放行路径：校验通过 → 真实调用 openExternal（spy 收到逐字 URL）")
      : bad("GP-94 open path", JSON.stringify({ goodRes, opened }).slice(0, 260));
    const badRes = await route.open("javascript:alert(document.cookie)", { source: "probe-refuse" });
    badRes.ok === false && badRes.opened === false && badRes.decision === "refused" &&
      badRes.error === "scheme_not_allowed" && opened.length === 1
      ? ok("GP-94 拦截路径：javascript: refused 且 openExternal 未被调用（不是只藏起来）")
      : bad("GP-94 refuse path", JSON.stringify({ badRes, opened: opened.length }).slice(0, 240));
    await route.open("file:///etc/passwd", { source: "probe-refuse-file" });
    await route.open("https://ok.example/a b", { source: "probe-refuse-space" });
    const rows = fs
      .readFileSync(AUDIT, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    rows.length === 4 &&
      rows.filter((r) => r.decision === "refused").length === 3 &&
      rows.every((r) => r.at && r.href !== undefined) &&
      rows[0].session_id === "sess-gp19probe"
      ? ok("GP-94 审计留痕 4 行（1 放行 + 3 拦截），含 scheme/host/session/原因——检查目标有凭据")
      : bad("GP-94 audit rows", JSON.stringify(rows.map((r) => [r.decision, r.error])).slice(0, 260));
    rows.every((r) => r.opened === (r.decision === "open_external"))
      ? ok("GP-94 opened 字段只反映真实 openExternal 成功（拦截行不会写 opened:true）")
      : bad("GP-94 opened honesty", JSON.stringify(rows.map((r) => r.opened)).slice(0, 200));

    /* ---- 4) real kernel turn: provider bare URL survives CM-0111 ---- */
    stub = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BITBOT_STUB_PORT: String(STUB_PORT), BITBOT_STUB_REPLY: PROVIDER_REPLY },
    });
    const stubUp = await new Promise((res) => {
      const t = setTimeout(() => res(false), 8000);
      stub.stdout.on("data", (d) => {
        if (String(d).includes("[stub-llm]")) {
          clearTimeout(t);
          res(true);
        }
      });
      stub.on("error", () => {
        clearTimeout(t);
        res(false);
      });
    });
    if (!stubUp) {
      bad("GP-93 stub 启动", "openai_compat_stub.js 未在 8s 内就绪");
      throw new Error("stub unavailable");
    }
    Object.assign(process.env, {
      BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
      BITBOT_LLM_API_KEY: "gp19-probe-key",
      BITBOT_LLM_MODEL: "gp19-probe",
      BITBOT_LLM_STREAM: "0",
      BITBOT_STUB_REPLY: PROVIDER_REPLY,
    });
    const { createTurnRunner } = require(path.join(REPO, "hosts/shared/run_moon_turn.js"));
    const runner = createTurnRunner(REPO);
    const r = await runner.runTurn("GP19-PROBE 给我文档链接", {
      sessionId: "sess-gp19probe",
      machineId: "desk-1",
      machineKind: "desktop",
    });
    const delivered = (r.messages || []).map((m) => m.text).join("\n");
    r.ok === true && delivered.includes("[" + BARE_URL + "](" + BARE_URL + ")") &&
      delivered.includes("[状态页](" + MD_URL + ")")
      ? ok("GP-93 真实 kernel 回合：provider 裸 URL 已规范化为 markdown 并成功投递（CM-0111 放行）")
      : bad("GP-93 kernel deliver", JSON.stringify({ ok: r.ok, error: r.error, delivered: delivered.slice(0, 220) }));
    // 裸 URL 必须在渲染前就不存在（否则 deliver_text 会整条拒绝 → 用户看不到链接）
    // JS 里 [^]] 会被解析成"任意字符"类，必须写 [^\]] —— 否则剥链接的
    // 断言自己先失效（这条曾经假绿）。
    !/https?:\/\//.test(delivered.replace(/\[[^\]]*\]\([^)]*\)/g, ""))
      ? ok("GP-93 投递文本里不存在裸 URL（markdown 化在 CM-0111 之前完成，非事后补救）")
      : bad("GP-93 bare url leaked", delivered.slice(0, 240));

    /* ---- 5) shipped wiring: renderer / main / preload / package ---- */
    const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
    const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
    const preload = fs.readFileSync(path.join(REPO, "hosts/desktop/preload.js"), "utf8");
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "hosts/desktop/package.json"), "utf8"));

    const rendererWire =
      /src="\.\/link_discipline\.js"/.test(html) &&
      /applyLinkBodyTo\(\s*(?:el\.querySelector\("\.body"\)|bodyEl)\s*,\s*(?:text|fenceText)\s*\)/.test(html) &&
      /window\.__bitbotLinks/.test(html) &&
      /closest\("a\.msg-link"\)/.test(html) &&
      /e\.preventDefault\(\)/.test(html) &&
      /window\.bitbot\.links[\s\S]{0,80}\.open\(\{ url, source: "renderer-link"/.test(html) &&
      /id="link-preview"/.test(html) &&
      /showLinkPreview/.test(html) &&
      /linkOpenHint/.test(html);
    rendererWire
      ? ok("GP-93/94/95 renderer：正文经共享政策模块渲染 + 点击 preventDefault → IPC + 悬停卡 DOM 在位")
      : bad("GP-93/94/95 renderer wiring", "one of the wiring markers missing");
    // 消息正文绝不允许走 innerHTML（只有外壳 div 自身的骨架是静态字面量）
    // 消息正文只能走政策模块：既不能 innerHTML，也不能退回 textContent
    //（退回就等于链接又变成死文字）。政策模块自身也不得含 innerHTML。
    const policySrc = fs.readFileSync(path.join(REPO, "hosts/desktop/link_discipline.js"), "utf8");
    const policyClean = !/\.innerHTML\s*=/.test(policySrc);
    // 流式 delta 期间仍写 textContent（增量纯文本，成本最低且安全）；
    // 回合结束（phase=end）与 addMsg 必须切到政策模块，否则链接永远是死文字。
    const bodyViaPolicy =
      /applyLinkBodyTo\(\s*(?:el\.querySelector\("\.body"\)|bodyEl)\s*,\s*(?:text|fenceText)\s*\)/.test(html) &&
      /applyLinkBodyTo\(streamEl\.querySelector\("\.body"\), chunk\.partial\)/.test(html) &&
      !/\.body"\)\.innerHTML\s*=/.test(html) &&
      policyClean;
    bodyViaPolicy
      ? ok("GP-93 正文渲染唯一入口是政策模块（无 innerHTML 注入面，也不会退回死文字）")
      : bad("GP-93 body render path", JSON.stringify({ bodyViaPolicy, policyClean }));

    const mainWire =
      /createLinkOpen\(\{/.test(mainJs) &&
      /ipcMain\.handle\("bitbot:links:open"/.test(mainJs) &&
      /shell\.openExternal\(url\)/.test(mainJs) &&
      /setWindowOpenHandler/.test(mainJs) &&
      /return \{ action: "deny" \}/.test(mainJs) &&
      /will-navigate/.test(mainJs) &&
      /event\.preventDefault\(\)/.test(mainJs) &&
      /scheme_not_allowed|links\.open\(url/.test(mainJs);
    mainWire
      ? ok("GP-94 main：IPC + shell.openExternal + setWindowOpenHandler deny + will-navigate 拦截全在位")
      : bad("GP-94 main wiring", JSON.stringify({ has: [
          /createLinkOpen\(\{/.test(mainJs),
          /shell\.openExternal\(url\)/.test(mainJs),
          /setWindowOpenHandler/.test(mainJs),
          /will-navigate/.test(mainJs),
        ] }));

    const preloadWire =
      /bitbot:links:open/.test(preload) && /links: \{/.test(preload) &&
      /open: \(payload\) => ipcRenderer\.invoke\("bitbot:links:open"/.test(preload);
    preloadWire
      ? ok("GP-94 preload：只暴露 links.open 白名单通道（renderer 拿不到 shell）")
      : bad("GP-94 preload wiring", "links.open missing");

    const files = (pkg.build && pkg.build.files) || [];
    files.includes("link_discipline.js") && files.includes("link_open.js")
      ? ok("GP-93/94 打包清单含两个新模块（打进 asar，打包版不会缺文件）")
      : bad("GP-93 packaging", JSON.stringify(files).slice(0, 240));

    const i18n = ["linkOpenHint:", "linkBlocked:", "linkRefused:", "linkOpenFailed:"].every(
      (k) => (html.match(new RegExp(k, "g")) || []).length >= 3,
    );
    i18n
      ? ok("GP-94/95 三语文案齐备（提示/拦截/打开失败各 ≥3 处）")
      : bad("GP-94/95 i18n", "link keys not present in all languages");

    const spec = fs.readFileSync(path.join(REPO, "docs/grok-desktop-parity/spec.md"), "utf8");
    /GP-93/.test(spec) && /GP-94/.test(spec) && /GP-95/.test(spec) && /§5\.6/.test(spec)
      ? ok("规格先行：G-13（官方 §5.6）GP-93/94/95 行已落 spec.md，验收信号可脚本断言")
      : bad("GP-93 spec row", "G-13 rows missing");
  } catch (e) {
    bad("GP-93 探针异常", e.stack || e.message);
  } finally {
    if (stub) {
      try {
        stub.kill("SIGKILL");
      } catch (_) {}
    }
    for (const k of [
      "BITBOT_LLM_BASE_URL",
      "BITBOT_LLM_API_KEY",
      "BITBOT_LLM_MODEL",
      "BITBOT_LLM_STREAM",
      "BITBOT_STUB_REPLY",
    ])
      delete process.env[k];
    fs.rmSync(AUDIT, { force: true });
  }

  console.log(`prove_gp93_links: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[gp19] failed:", e && e.stack ? e.stack : e);
  process.exit(1);
});
