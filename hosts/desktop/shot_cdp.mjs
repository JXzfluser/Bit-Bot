#!/usr/bin/env node
"use strict";

/**
 * Grok-parity UI screenshot driver (dev tool; connects ONLY to the private
 * debugging port this repo's own Electron instance opens).
 *
 * Drives the REAL renderer over CDP: types into #text, submits the real form
 * (runUserTurn → MoonBit kernel → Host FFI), clicks real controls, and
 * captures viewport pixels (what the user sees).
 *
 * Usage:
 *   node hosts/desktop/shot_cdp.mjs --port 9223 --seq /tmp/shots/seq.json --out /tmp/shots/out
 */

import fs from "node:fs";
import path from "node:path";

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}
const PORT = Number(arg("--port", 9223));
const SEQ = arg("--seq", "");
const OUT = arg("--out", "/tmp/bitbot-shots");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!SEQ) throw new Error("--seq required");
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", (e) => rej(new Error("ws error")));
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id != null && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { res, rej });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evl = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("renderer: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };
  const shot = async (label) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    const file = path.join(OUT, label + ".png");
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    console.log("[shot]", file);
  };
  const type = (text) =>
    evl(`(() => {
      const t = document.getElementById("text");
      t.focus(); t.value = ${JSON.stringify(text)};
      const form = t.closest("form");
      form.requestSubmit();
      return true; })()`);
  const click = (sel) =>
    evl(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) throw new Error("no element " + ${JSON.stringify(sel)});
      el.scrollIntoView({block:"center"}); el.click(); return true; })()`);
  const scrollToTop = () =>
    evl(`(() => { document.getElementById('log').scrollTop = 0; return true; })()`);
  const scrollLog = (px) =>
    evl(`(() => { const l=document.getElementById('log'); l.scrollTop=${px}; return true; })()`);

  fs.mkdirSync(OUT, { recursive: true });
  const seq = JSON.parse(fs.readFileSync(SEQ, "utf8"));
  for (const scene of seq) {
    for (const step of scene.steps || []) {
      if (step.sleep) await sleep(Number(step.sleep));
      else if (step.type) await type(step.type);
      else if (step.click) await click(step.click);
      else if (step.evl) await evl(step.evl);
      else if (step.scroll_top) await scrollToTop();
      else if (step.scroll_log != null) await scrollLog(step.scroll_log);
      else throw new Error("unknown step " + JSON.stringify(step));
      await sleep(Number(step.after_ms || 400));
    }
    await sleep(Number(scene.wait_ms || 1200));
    await shot(scene.label);
  }
  console.log("[shot] done ->", OUT);
  ws.close();
}

main().catch((e) => {
  console.error("[shot] failed:", e.message);
  process.exit(1);
});
