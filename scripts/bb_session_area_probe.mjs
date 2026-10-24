/* bb_session_area_probe.mjs — 实测侧栏「会话列表区」几何（W3-3c 的取数）
 *
 * 为什么要单独探：bb-real-spec 的 sessionRow 走的是聊天列 .sess-row，
 * Grok 的 sessionRow 是侧栏 .sand-agent-item。两侧同名不同物 —— W3 必须先看
 * 我方侧栏这块（#sb-bots-rooms / .bot-group-head / .sb-bot-row）现在长什么样，
 * 否则「对齐行高/间距」会改错一个区。
 *
 * 纪律：独立临时 user-data-dir、BITBOT_NO_SECRET_SYNC=1、只 hover 不点击、不改设置。
 * 用法：node scripts/bb_session_area_probe.mjs
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

const OVERLAY = fs.readFileSync("/tmp/w0_probe_overlay.css", "utf8");
const OUT = "/tmp/bb_session_area.json";

const PROBE = () => {
  const num = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: num(r.left), top: num(r.top), width: num(r.width), height: num(r.height), bottom: num(r.bottom) };
  };
  const style = (el, props) => {
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = cs[p];
    return o;
  };
  const COLOR = ["backgroundColor", "color", "borderRadius", "boxShadow", "borderTopWidth", "borderTopColor", "padding", "margin", "gap", "display", "flexDirection", "overflow"];
  const TYPE = ["fontSize", "fontWeight", "lineHeight", "letterSpacing", "color", "textTransform"];

  const res = { sidebar: null, adv: null, groupHeads: [], rows: [], pitch: null, gap: null, notes: [] };

  const aside = document.getElementById("agents");
  if (aside) {
    res.sidebar = { ...box(aside), ...style(aside, COLOR), ...style(aside, ["width"]), };
  }

  const adv = document.getElementById("sb-bots-rooms");
  if (adv) {
    res.adv = { open: adv.open, ...box(adv), ...style(adv, COLOR) };
    const sum = adv.querySelector("summary");
    if (sum) res.adv.summary = { ...box(sum), ...style(sum, COLOR), ...style(sum, TYPE), text: sum.textContent.trim().slice(0, 40) };
  }

  // 分组标题：Grok 的 section header 是 30px 带内缩的一行
  for (const h of document.querySelectorAll("#agents .bot-group-head, #agents .panel-title, .bot-group-head")) {
    if (!h.isConnected) continue;
    const inner = h.querySelector("span");
    res.groupHeads.push({ cls: String(h.className).trim(), ...box(h), ...style(h, COLOR), ...style(h, TYPE), textSpan: inner ? { ...box(inner), ...style(inner, TYPE) } : null, text: h.textContent.trim().slice(0, 24) });
  }

  // 侧栏行：机器人在 grok 皮肤下重排进 .sess-list，取第一个有 ≥2 个同尺寸子节点的列表
  const lists = [...document.querySelectorAll("#agents .sess-list, #agents > div, #agents .bot-list, .sb-bot-list")];
  let best = null;
  for (const l of lists) {
    const kids = [...l.children].filter((k) => k.getBoundingClientRect().height > 12);
    if (kids.length >= 2) {
      const heights = kids.map((k) => Math.round(k.getBoundingClientRect().height));
      const modal = heights.sort((a, b) => heights.filter((x) => x === a).length - heights.filter((x) => x === b).length).pop();
      const n = heights.filter((x) => x === modal).length;
      if (!best || n > best.n) best = { list: l, n, count: kids.length };
    }
  }
  if (best) {
    const kids = [...best.list.children].filter((k) => k.getBoundingClientRect().height > 12);
    res.listHost = { sel: best.list.id ? "#" + best.list.id : String(best.list.className).trim(), count: best.count, uniform: best.n, ...box(best.list), ...style(best.list, ["gap", "padding", "margin", "display", "flexDirection", "backgroundColor", "overflow"]) };
    res.rows = kids.slice(0, 4).map((k) => {
      const own = k.matches(".sess-row, .bot-item, .sb-bot-row") ? [k] : [k];
      const target = k.matches(".sess-row") ? k : k.querySelector(".sess-row") || k;
      return { tag: target.tagName, cls: String(target.className).trim().slice(0, 60), ...box(target), ...style(target, COLOR), ...style(target, TYPE), ownRow: own.length === 1 && target === k, text: target.textContent.trim().replace(/\s+/g, " ").slice(0, 40) };
    });
    if (kids.length >= 2) {
      const a = kids[0].getBoundingClientRect();
      const b = kids[1].getBoundingClientRect();
      res.pitch = Math.round((b.top - a.top) * 100) / 100;
      res.gap = Math.round((b.top - a.bottom) * 100) / 100;
      res.rowHeights = kids.slice(0, 8).map((k) => Math.round(k.getBoundingClientRect().height * 100) / 100);
    }
  } else {
    res.notes.push("侧栏未找到 ≥2 同尺寸行的列表：会话区在该皮肤下可能不渲染在 #agents 内");
  }
  return res;
};

(async () => {
  const ud = electronUserDataDir("bb-sess-area");
  const env = electronLaunchEnv(gateAppEnv(REPO, { BITBOT_NO_SECRET_SYNC: "1", BITBOT_DESKTOP_AUTOSTART: "0" }));
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO, env, timeout: 60000,
  });
  try {
    const win = await app.firstWindow({ timeout: 60000 });
    await win.setViewportSize({ width: 1040, height: 760 }).catch(() => {});
    await win.waitForTimeout(1200);
    await win.evaluate((b) => { document.body.classList.remove("force-dark"); document.body.classList.add("force-light"); }, null);
    await win.addStyleTag({ content: OVERLAY });
    await win.waitForTimeout(400);
    const r = await win.evaluate(PROBE);
    fs.writeFileSync(OUT, JSON.stringify(r, null, 2));
    console.log(JSON.stringify(r, null, 1).slice(0, 2600));
    console.log("\n完整结果：", OUT);
  } finally {
    await app.close().catch(() => {});
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
  }
})();
