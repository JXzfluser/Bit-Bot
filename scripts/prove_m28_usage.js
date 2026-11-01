#!/usr/bin/env node
"use strict";

/**
 * prove_m28_usage — G-24 Usage & Billing 接真回合（官方 spec §7.1）
 *
 * 静态层：executeLlmChat 的 usage 提取（流式/非流式）、main.js usage→recordUsage
 *         接线、面板 per-row 渲染 + 三语 i18n、stub 上报 usage。
 * 行为层：进程内起一个 OpenAI 兼容 stub（带/不带 usage 两种），走真实
 *         executeHostEffects(llm_chat)，断言 usage 事件与 chats.jsonl artifact；
 *         再打真实 recordUsage/weekView（合并、周滚动、totals）。
 * 负向对照：砍掉非流式 usage 提取 → tokens_reported 翻假（断言变红）。
 *           store/artifact/chats.jsonl/env 在 finally 全部恢复，双跑幂等。
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.log("  ✗ " + m); };

console.log("M28 §7.1 Usage & Billing proof");

/* ---------- 1) 静态层 ---------- */
const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
const ffiJs = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
const stubJs = fs.readFileSync(path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js"), "utf8");

/for \(const r of rows\) \{/.test(html) && /usageTokensUnreported/.test(html) &&
  /* 面板文案曾经是 `unreported ? " (" + wavegT(...)`，后来那句前缀括号被去掉
     （产品文案调整），断言还钉着旧字面量 —— 于是「代码对、门禁红」。
     这里只钉「未上报时用这句如实文案」这个契约，不再钉格式。 */
  /unreported\s*\?\s*wavegT\("usageTokensUnreported"\)/.test(html)
  ? ok("面板 per-provider/model 行渲染 + 未上报 tokens 如实标注（GP-131）")
  : bad("panel per-row rendering missing");

/usageTokensUnreported: "tokens 未上报",/.test(html) &&
  /usageTokensUnreported: "tokens 未上報",/.test(html) &&
  /usageTokensUnreported: "tokens not reported",/.test(html)
  ? ok("usageTokensUnreported 文案在 zh-CN / zh-TW / en 三套 i18n 齐全")
  : bad("i18n key missing in some locale");

/chunk\.phase === "usage"/.test(mainJs) && /surface\.recordUsage\(/.test(mainJs)
  ? ok("main.js 把 usage 事件写进 surface.recordUsage（真实 llm-usage.json）")
  : bad("main.js usage wiring missing");

/* 流式 usage 现在由 SSE 累加器返回的 meta 承载（agentLoopFfi.consumeSseDataLine），
   不再是旧的手写 chunk 对象；非流式仍是顶层 res.json.usage。两边都只在第一次
   拿到时落 streamUsage，且都必须走到 phase:"usage" 事件。 */
/stream_options: \{ include_usage: true \}/.test(ffiJs) &&
  /meta && meta\.usage && !usage/.test(ffiJs) &&
  /res\.json\.usage && !streamUsage/.test(ffiJs) &&
  /phase: "usage"/.test(ffiJs)
  ? ok("executeLlmChat 双路径提取 usage（流式最终 chunk / 非流式顶层）并 emit usage 事件（GP-130）")
  : bad("host_ffi usage extraction missing");

/usage: \{ prompt_tokens: 11, completion_tokens: 7 \}/.test(stubJs) &&
  /choices: \[\],\s*\n\s*usage: \{ prompt_tokens: 11, completion_tokens: 7 \}/.test(stubJs)
  ? ok("stub 非流式顶层与流式最终 chunk 都上报 usage（E2E 走真实链路）")
  : bad("stub usage missing");

/* ---------- 2) 行为层：真实 executeLlmChat → usage 事件/artifact ---------- */
const CHATS = path.join(REPO, "data/llm/chats.jsonl");
const TURNS_DIR = path.join(REPO, "data/llm/turns");
const USAGE_STORE = path.join(REPO, "data/desktop/llm-usage.json");

const chatsBefore = fs.existsSync(CHATS) ? fs.readFileSync(CHATS, "utf8") : null;
const turnsBefore = fs.existsSync(TURNS_DIR) ? fs.readdirSync(TURNS_DIR) : [];
const usageBefore = fs.existsSync(USAGE_STORE) ? fs.readFileSync(USAGE_STORE, "utf8") : null;
const envBefore = {
  base: process.env.BITBOT_LLM_BASE_URL,
  key: process.env.BITBOT_LLM_API_KEY,
  model: process.env.BITBOT_LLM_MODEL,
  stream: process.env.BITBOT_LLM_STREAM,
};

function makeStub(withUsage) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const j = JSON.parse(body || "{}");
        const reply = "M28 usage stub reply";
        if (j.stream) {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write("data: " + JSON.stringify({
            object: "chat.completion.chunk",
            choices: [{ delta: { content: reply }, finish_reason: null }],
          }) + "\n\n");
          res.write("data: " + JSON.stringify({
            object: "chat.completion.chunk",
            choices: [{ delta: {}, finish_reason: "stop" }],
          }) + "\n\n");
          if (withUsage) {
            res.write("data: " + JSON.stringify({
              object: "chat.completion.chunk",
              choices: [],
              usage: { prompt_tokens: 21, completion_tokens: 13 },
            }) + "\n\n");
          }
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }
        const out = {
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        };
        if (withUsage) out.usage = { prompt_tokens: 123, completion_tokens: 45 };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const sharedPath = require.resolve(path.join(REPO, "hosts/shared/host_ffi.js"));
let ffi = require(sharedPath).createHostFfi(REPO);

async function runLlmChat(port) {
  process.env.BITBOT_LLM_BASE_URL = "http://127.0.0.1:" + port + "/v1";
  process.env.BITBOT_LLM_API_KEY = "m28-probe-key";
  process.env.BITBOT_LLM_MODEL = "m28-probe-model";
  process.env.BITBOT_LLM_STREAM = "0";
  const events = [];
  ffi.setLlmStreamHandler((c) => { if (c && c.phase === "usage") events.push(c); });
  const results = await ffi.executeHostEffects(
    [{ kind: "llm_chat", command: "M28 usage probe turn" }],
    { approved: true },
  );
  return { events, result: results[0] };
}

function lastChatRow() {
  const lines = fs.readFileSync(CHATS, "utf8").trim().split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

(async () => {
  try {
    // --- 上报了 usage 的 stub ---
    const s1 = await makeStub(true);
    try {
      const r1 = await runLlmChat(s1.port);
      r1.result && r1.result.ok
        ? ok("真实 llm_chat 走通本地 stub（ok=true）")
        : bad("llm_chat failed: " + JSON.stringify(r1.result && r1.result.error));
      const ev = r1.events.find((e) => e.provider_id && e.tokens_reported === true);
      ev && ev.prompt_tokens === 123 && ev.completion_tokens === 45
        ? ok("usage 事件带真实 tokens（prompt=123, completion=45, tokens_reported=true）")
        : bad("usage event wrong: " + JSON.stringify(r1.events));
      const row = lastChatRow();
      row.usage && row.usage.reported === true && row.usage.prompt_tokens === 123
        ? ok("chats.jsonl artifact 落盘 usage（reported=true, prompt=123）")
        : bad("artifact usage wrong: " + JSON.stringify(row.usage));
    } finally { s1.server.close(); }

    // --- 不上报 usage 的 stub：requests 真记，tokens 不伪造 ---
    const s2 = await makeStub(false);
    try {
      const r2 = await runLlmChat(s2.port);
      const ev = r2.events.find((e) => e.tokens_reported === false);
      ev && ev.prompt_tokens === 0
        ? ok("provider 未上报 → usage 事件 tokens_reported=false 且 tokens=0（不伪造）")
        : bad("unreported case wrong: " + JSON.stringify(r2.events));
      const row = lastChatRow();
      row.usage && row.usage.reported === false
        ? ok("artifact 如实记录 usage.reported=false")
        : bad("artifact unreported wrong: " + JSON.stringify(row.usage));
    } finally { s2.server.close(); }

    /* ---------- 3) store 层：recordUsage / weekView ---------- */
    // 先清成空 store 再记账：smoke 里更早的 E2E 块也会真写 llm-usage.json
    // （那正是链路已接通的证明），totals 断言必须从已知零点出发。
    fs.writeFileSync(USAGE_STORE, JSON.stringify({ version: 1, week: "", rows: [] }, null, 2));
    const surface = require(path.join(REPO, "hosts/desktop/product_surface.js")).createProductSurface(REPO);
    const wk = (at) => {
      const d = new Date(at);
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return d.getUTCFullYear() + "-W" + String(Math.ceil(((d - ys) / 86400000 + 1) / 7)).padStart(2, "0");
    };
    const now = new Date().toISOString();
    surface.recordUsage({ provider: "p-a", model: "m-1", prompt_tokens: 10, completion_tokens: 5, at: now });
    surface.recordUsage({ provider: "p-a", model: "m-1", prompt_tokens: 20, completion_tokens: 8, at: now });
    surface.recordUsage({ provider: "p-b", model: "m-2", prompt_tokens: 1, completion_tokens: 2, at: now });
    const view = surface.weekView();
    const rowA = (view.rows || []).find((r) => r.provider === "p-a");
    const rowB = (view.rows || []).find((r) => r.provider === "p-b");
    rowA && rowA.requests === 2 && rowA.prompt_tokens === 30 && rowA.completion_tokens === 13
      ? ok("recordUsage 同 provider/model 累加（requests=2, prompt=30, completion=13）")
      : bad("recordUsage merge wrong: " + JSON.stringify(rowA));
    rowB && rowB.requests === 1
      ? ok("不同 provider 分行记录，互不覆盖")
      : bad("per-provider rows wrong");
    view.totals && view.totals.requests === 3
      ? ok("weekView totals 汇总真实行（requests=3）")
      : bad("weekView totals wrong: " + JSON.stringify(view.totals));

    /* ---------- 4) 负向对照：砍掉非流式 usage 提取 → tokens_reported 翻假 ---------- */
    const marker = "if (res.json && res.json.usage && !streamUsage) {";
    const broken = ffiJs.replace(marker, "if (false) { // sabotaged");
    if (broken !== ffiJs) {
      fs.writeFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), broken);
      delete require.cache[sharedPath];
      const ffi2 = require(sharedPath).createHostFfi(REPO);
      const s3 = await makeStub(true);
      try {
        process.env.BITBOT_LLM_BASE_URL = "http://127.0.0.1:" + s3.port + "/v1";
        process.env.BITBOT_LLM_API_KEY = "m28-probe-key";
        process.env.BITBOT_LLM_MODEL = "m28-probe-model";
        process.env.BITBOT_LLM_STREAM = "0";
        const events = [];
        ffi2.setLlmStreamHandler((c) => { if (c && c.phase === "usage") events.push(c); });
        await ffi2.executeHostEffects([{ kind: "llm_chat", command: "M28 negative control" }], { approved: true });
        const ev = events.find((e) => e.tokens_reported === false);
        ev
          ? ok("负向对照：禁用提取后 tokens_reported 翻假（断言会抓到）")
          : bad("negative control did not flip tokens_reported");
      } finally { s3.server.close(); }
    } else {
      bad("negative control marker not found in host_ffi.js");
    }

    console.log("\nprove_m28_usage: PASS=" + pass + " FAIL=" + fail);
    process.exit(fail ? 1 : 0);
  } catch (err) {
    console.error("probe crashed:", err);
    process.exit(1);
  }
})().finally(() => {});

/* ---------- 恢复（无论成败） ---------- */
process.on("exit", (code) => {
  try {
    fs.writeFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), ffiJs);
  } catch (_) {}
  try {
    if (chatsBefore === null) { if (fs.existsSync(CHATS)) fs.unlinkSync(CHATS); }
    else fs.writeFileSync(CHATS, chatsBefore);
  } catch (_) {}
  try {
    const nowList = fs.existsSync(TURNS_DIR) ? fs.readdirSync(TURNS_DIR) : [];
    for (const f of nowList) if (!turnsBefore.includes(f)) fs.unlinkSync(path.join(TURNS_DIR, f));
  } catch (_) {}
  try {
    if (usageBefore === null) { if (fs.existsSync(USAGE_STORE)) fs.unlinkSync(USAGE_STORE); }
    else fs.writeFileSync(USAGE_STORE, usageBefore);
  } catch (_) {}
  try {
    if (envBefore.base === undefined) delete process.env.BITBOT_LLM_BASE_URL; else process.env.BITBOT_LLM_BASE_URL = envBefore.base;
    if (envBefore.key === undefined) delete process.env.BITBOT_LLM_API_KEY; else process.env.BITBOT_LLM_API_KEY = envBefore.key;
    if (envBefore.model === undefined) delete process.env.BITBOT_LLM_MODEL; else process.env.BITBOT_LLM_MODEL = envBefore.model;
    if (envBefore.stream === undefined) delete process.env.BITBOT_LLM_STREAM; else process.env.BITBOT_LLM_STREAM = envBefore.stream;
  } catch (_) {}
});
