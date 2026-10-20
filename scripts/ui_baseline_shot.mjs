#!/usr/bin/env node
"use strict";
/**
 * M20 baseline UI capture: launch the real Electron app under Xvfb, seed a few
 * Grok-like conversation rows + sidebar sessions, and screenshot the viewport
 * so we can compare pixel-level against the Grok Bot reference. Dev-only.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { _electron } = require(path.join(process.cwd(), "hosts/desktop/node_modules/playwright-core"));

const REPO = process.cwd();
const electronBinary = path.join(REPO, "hosts/desktop/node_modules/electron/dist/electron");
const OUT = process.env.OUT || "/tmp/bitbot-ui-baseline.png";

function liveDisplay() {
  return process.env.DISPLAY || ":99";
}

async function main() {
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [path.join(REPO, "hosts/desktop/main.js"), "--no-sandbox", "--disable-gpu"],
    cwd: REPO,
    env: { ...process.env, DISPLAY: liveDisplay() },
    timeout: 60000,
  });
  const win = await app.firstWindow({ timeout: 60000 });
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  await win.setViewportSize({ width: 1280, height: 800 });

  // Seed a Grok-like transcript straight into the DOM (no LLM needed) so the
  // screenshot shows bubbles, avatar, composer, sidebar exactly as shipped.
  await win.evaluate(() => {
    const log = document.getElementById("log");
    if (!log) return;
    const rows = [
      ["user", "帮我把这份 PR 合并到 main"],
      ["assistant", "云端代理已在跑：Import Bitbot workspace snapshot。完成后会开 PR，我再把链接给你。"],
      ["assistant", "GitHub 授权已生效，正在确认推送代理状态。"],
    ];
    for (const [role, text] of rows) {
      const el = document.createElement("div");
      el.className = "msg " + role;
      el.innerHTML = '<div class="role"></div><div class="body"></div>';
      el.querySelector(".role").textContent = role;
      el.querySelector(".body").textContent = text;
      log.appendChild(el);
    }
    log.scrollTop = log.scrollHeight;
  });
  await win.waitForTimeout(500);
  await win.screenshot({ path: OUT });
  console.log("captured", OUT);

  // Also capture the Connect apps modal (Grok-parity card grid).
  await win.evaluate(() => {
    const b = document.getElementById("connect-apps-btn");
    if (b) b.click();
  });
  await win.waitForTimeout(1200);
  const OUT2 = OUT.replace(/\.png$/, "-apps.png");
  await win.screenshot({ path: OUT2 });
  console.log("captured", OUT2);

  // dump structural facts for the gap analysis
  const facts = await win.evaluate(() => {
    const q = (s) => !!document.querySelector(s);
    const cs = (s, p) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[p] : null; };
    return {
      hasSidebar: q("#agents") || q("aside") || q(".sidebar"),
      hasComposer: q("#composer"),
      hasSend: q("#send"),
      hasMic: q("#mic") || q(".mic") || q("[aria-label*=语音]"),
      msgRadius: cs(".msg .body", "borderRadius"),
      msgBg: cs(".msg.assistant .body", "backgroundColor"),
      userBg: cs(".msg.user .body", "backgroundColor"),
      bodyFont: getComputedStyle(document.body).fontFamily,
      bg: getComputedStyle(document.body).backgroundColor,
    };
  });
  console.log(JSON.stringify(facts, null, 2));

  app.isQuiting = true;
  await app.evaluate(({ app: a }) => { a.isQuiting = true; a.quit(); }).catch(() => {});
  await app.close().catch(() => {});
}
main().catch((e) => { console.error(e); process.exit(1); });
