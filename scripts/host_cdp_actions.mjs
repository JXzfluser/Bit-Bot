#!/usr/bin/env node
/**
 * CDP action helper for Host computer_use (private debugging port only).
 * Never connects to shared CDP 9223.
 *
 * Usage:
 *   node scripts/host_cdp_actions.mjs --port 51234 --actions 'click:120,80|type:hello|scroll:0,400'
 */
"use strict";

const SHARED_CDP_PORT = 9223;

function parseArgs(argv) {
  const out = { port: 0, actions: "", timeoutMs: 8000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" && i + 1 < argv.length) out.port = Number(argv[++i]);
    else if (a === "--actions" && i + 1 < argv.length) out.actions = String(argv[++i]);
    else if (a === "--timeout-ms" && i + 1 < argv.length)
      out.timeoutMs = Number(argv[++i]);
  }
  return out;
}

async function httpJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function cdpClient(wsUrl) {
  let id = 0;
  let socket;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    socket = new WebSocket(wsUrl);
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", (e) => reject(e.error || e));
    socket.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data || ""));
      } catch {
        return;
      }
      if (msg && msg.id != null && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  });

  async function send(method, params = {}) {
    await ready;
    const msgId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject });
      socket.send(JSON.stringify({ id: msgId, method, params }));
      setTimeout(() => {
        if (pending.has(msgId)) {
          pending.delete(msgId);
          reject(new Error(`CDP timeout for ${method}`));
        }
      }, 5000);
    });
  }

  function close() {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }

  return { send, close, ready };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.port || args.port === SHARED_CDP_PORT) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "refused missing/shared CDP port",
        shared_cdp_port: SHARED_CDP_PORT,
      }),
    );
    process.exit(2);
  }
  const list = await httpJson(`http://127.0.0.1:${args.port}/json/list`);
  const page = (Array.isArray(list) ? list : []).find(
    (t) => t && t.type === "page" && t.webSocketDebuggerUrl,
  );
  if (!page) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "no page target",
        targets: Array.isArray(list) ? list.length : 0,
      }),
    );
    process.exit(1);
  }
  const client = cdpClient(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Input.enable").catch(() => null);

  const results = [];
  const steps = String(args.actions || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const step of steps) {
    const colon = step.indexOf(":");
    const kind = colon >= 0 ? step.slice(0, colon) : step;
    const rest = colon >= 0 ? step.slice(colon + 1) : "";
    const k = String(kind || "").toLowerCase();
    try {
      if (k === "click") {
        const [xs, ys] = rest.split(",");
        const x = Number(xs);
        const y = Number(ys);
        await client.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        await client.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        results.push({ step, ok: true, kind: "click", x, y });
      } else if (k === "type" || k === "type_text") {
        const text = rest;
        await client.send("Input.insertText", { text });
        results.push({ step, ok: true, kind: "type", chars: text.length });
      } else if (k === "scroll") {
        const [dxs, dys] = rest.split(",");
        const deltaX = Number(dxs || 0);
        const deltaY = Number(dys || 0);
        await client.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: 20,
          y: 20,
          deltaX,
          deltaY,
        });
        results.push({ step, ok: true, kind: "scroll", deltaX, deltaY });
      } else if (k === "evaluate" || k === "js") {
        const expr = rest || "document.title";
        const r = await client.send("Runtime.evaluate", {
          expression: expr,
          returnByValue: true,
        });
        results.push({
          step,
          ok: true,
          kind: "evaluate",
          value: r && r.result ? r.result.value : null,
        });
      } else {
        results.push({ step, ok: false, error: `unknown action ${k}` });
      }
    } catch (err) {
      results.push({ step, ok: false, error: err.message || String(err) });
    }
  }

  let title = null;
  try {
    const r = await client.send("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    title = r && r.result ? r.result.value : null;
  } catch {
    /* ignore */
  }

  client.close();
  console.log(
    JSON.stringify({
      ok: results.every((r) => r.ok),
      port: args.port,
      shared_cdp_untouched: true,
      title,
      actions: results,
    }),
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify({ ok: false, error: err.message || String(err) }),
  );
  process.exit(1);
});
