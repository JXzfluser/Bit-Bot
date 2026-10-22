#!/usr/bin/env node
"use strict";

/**
 * M24 §2.1 主窗口结构 proof — the sidebar/window skeleton Grok shows, pinned to
 * things that can actually be observed (DOM order, Host stores, real effects).
 *
 * Why each assertion exists:
 *
 *   GP-116 six entries in the left column — Bot list, group list, Hidden Bots,
 *          Connect apps, Marketplace, Settings — and the Marketplace catalog
 *          comes from the Host's `bot_templates_list` effect, not a hardcoded
 *          array in the renderer.
 *   GP-117 the Bot list is ordered by *real* activity: an old pinned Bot still
 *          wins, a Bot whose turn just ran moves to the top, and an unknown id
 *          never invents a row.
 *   GP-118 Hidden Bots sits in the sidebar-footer at the very BOTTOM of
 *          #agents, after both lists — not wedged between them.
 *   GP-119 #log is the one message stream (group turns land there too) and the
 *          two right rails toggle independently without collapsing the center.
 *
 * Usage: node scripts/prove_m24_window.js   (exit 0 = all green)
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HTML_PATH = path.join(REPO, "hosts/desktop/index.html");
const MAIN_PATH = path.join(REPO, "hosts/desktop/main.js");
const PRELOAD_PATH = path.join(REPO, "hosts/desktop/preload.js");
const CLI = path.join(REPO, "hosts/cli_host/run_turn.js");
const BOTS = path.join(REPO, "data/desktop/bots.json");
const ROOMS = path.join(REPO, "data/desktop/rooms.json");
const TEMPLATES = path.join(REPO, "data/desktop/bot-templates.json");

let PASS = 0;
let FAIL = 0;
const ok = (n) => {
  PASS++;
  console.log("  ✓ " + n);
};
const bad = (n, d) => {
  FAIL++;
  console.log("  ✗ " + n + (d ? " — " + String(d).slice(0, 240) : ""));
};

const readText = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (_) {
    return "";
  }
};
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    return null;
  }
};
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
};

/** One real turn through the same Host the Desktop app uses (no Electron). */
function turn(text) {
  const run = spawnSync(process.execPath, [CLI, "--session-id", "m24-probe", text], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 180000,
    env: Object.assign({}, process.env, { BITBOT_PROBE: "1" }),
  });
  const out = String(run.stdout || "");
  let json = null;
  try {
    json = JSON.parse(out.trim().split("\n").filter(Boolean).pop());
  } catch (_) {
    json = null;
  }
  return { out, json, stderr: String(run.stderr || ""), code: run.status };
}

function main() {
  console.log("M24 §2.1 主窗口结构 proof");
  const html = readText(HTML_PATH);
  if (!html) {
    bad("index.html", "missing");
    return finish();
  }

  /* ---------- GP-116/118: sidebar DOM order ---------- */
  const agentsStart = html.indexOf('<aside id="agents">');
  const agentsEnd = html.indexOf("</aside>", agentsStart);
  agentsStart >= 0 && agentsEnd > agentsStart
    ? ok("#agents 是真实侧边栏容器（<aside> 可定位）")
    : bad("#agents", "aside not found");
  const agents = html.slice(agentsStart, agentsEnd);

  const orderIds = ["bot-list", "room-list", "session-list", "sidebar-footer"];
  const idx = orderIds.map((id) => agents.indexOf('id="' + id + '"'));
  idx.every((i) => i >= 0) && idx.every((v, i) => i === 0 || v > idx[i - 1])
    ? ok("侧边栏顺序 = Bot 列表 → 群组列表 → 会话列表 → 尾部区块（GP-116/118）")
    : bad("sidebar order", JSON.stringify(orderIds.map((id, i) => [id, idx[i]])));

  // GP-118: the footer block must be the LAST thing in #agents. Walk the div
  // depth starting *inside* the footer's own opening tag, so inner wrappers
  // don't look like the end of the block.
  const footerAt = agents.indexOf('<div id="sidebar-footer"');
  let depth = 0;
  let i = footerAt >= 0 ? agents.indexOf(">", footerAt) + 1 : agents.length;
  let footerEnd = -1;
  depth = 1;
  while (i < agents.length) {
    const open = agents.indexOf("<div", i);
    const close = agents.indexOf("</div>", i);
    if (close < 0) break;
    if (open >= 0 && open < close) {
      depth++;
      i = open + 4;
    } else {
      depth--;
      i = close + 6;
      if (depth === 0) {
        footerEnd = i;
        break;
      }
    }
  }
  const afterFooter = footerEnd > 0 ? agents.slice(footerEnd) : "";
  footerAt >= 0 && footerEnd > 0 && !/id="/.test(afterFooter)
    ? ok("#sidebar-footer 位于侧边栏最末尾（其后没有别的块）")
    : bad("sidebar footer position", "another block follows the footer");

  const footerIds = ["hidden-bots-lab", "connect-apps-btn", "marketplace-btn", "sidebar-settings-btn"];
  const fidx = footerIds.map((id) => agents.indexOf('id="' + id + '"'));
  fidx.every((i) => i >= 0) && fidx.every((v, i) => i === 0 || v > fidx[i - 1])
    ? ok("尾部区块顺序 = Hidden Bots → Connect apps → Marketplace → Settings（账号弹层内）")
    : bad("footer order", JSON.stringify(footerIds.map((id, i) => [id, fidx[i]])));

  /id="hidden-bots-count"/.test(agents) && /hiddenCount\.textContent = String\(hidden\.length\)/.test(html)
    ? ok("隐藏数量徽标由 bots.list() 的 hidden 长度驱动（不是常量）")
    : bad("hidden badge", "count not driven by hidden list");

  // The six entries must all exist: no "Marketplace" text without a control.
  ["#bot-list", "#room-list", "#hidden-bots-lab", "#connect-apps-btn", "#marketplace-btn", "#sidebar-settings-btn"]
    .every((sel) => html.includes('id="' + sel.slice(1) + '"'))
    ? ok("六类入口都在 DOM 中（Bot / 群组 / Hidden / Connect apps / Marketplace / Settings）")
    : bad("six entries", "one of them is missing");

  /* ---------- i18n coverage for the new entries ---------- */
  const localeStarts = ["zh-CN", "zh-TW", "en"].map((k) => {
    const quoted = html.indexOf('"' + k + '": {');
    return quoted >= 0 ? quoted : html.indexOf("\n      " + k + ": {");
  });
  const keys = ["rooms", "marketplace", "mkTitle", "mkHint", "mkEmpty", "mkCreate", "roomEmpty", "roomMembers"];
  const spans = localeStarts.map((s, i) => {
    const next = i + 1 < localeStarts.length ? localeStarts[i + 1] : html.length;
    return html.slice(s, next);
  });
  const missing = [];
  keys.forEach((k) => {
    spans.forEach((sp, i) => {
      if (!new RegExp("\\n\\s*" + k + ":\\s*\"").test(sp)) missing.push(["zh-CN", "zh-TW", "en"][i] + ":" + k);
    });
  });
  missing.length === 0
    ? ok("新增侧边栏文案在 zh-CN / zh-TW / en 三套 i18n 里齐全（不会渲染成原始 key）")
    : bad("i18n keys", missing.join(", "));

  /* ---------- GP-116: Marketplace reads the Host catalog ---------- */
  /async function refreshMarketplace\(\)/.test(html) && /window\.bitbot\.templates\.list\(\)/.test(html)
    ? ok("Marketplace 面板调用 Host templates.list()（真目录）")
    : bad("marketplace source", "templates.list not used");
  !/sales-outbound|talent-scout|paid-media|expense-manager|bug-reproduction|chief-of-staff/.test(html)
    ? ok("渲染层没有写死模板数组（模板 id 只出现在 Host 目录里）")
    : bad("hardcoded templates", "renderer contains template ids");

  const tplFile = readJson(TEMPLATES) || {};
  const tplRows = Array.isArray(tplFile) ? tplFile : tplFile.templates || [];
  const tplOut = turn("list bot templates");
  const tplPayload = (() => {
    const hr = ((tplOut.json && tplOut.json.host_results) || []).find(
      (h) => h && h.kind === "bot_templates_list" && h.ok,
    );
    if (!hr) return null;
    try {
      return JSON.parse(hr.stdout || "{}");
    } catch (_) {
      return null;
    }
  })();
  const hostTpls = (tplPayload && Array.isArray(tplPayload.templates) && tplPayload.templates) || [];
  hostTpls.length >= 6
    ? ok("Host bot_templates_list 返回真实目录（" + hostTpls.length + " 个模板）")
    : bad("host templates", JSON.stringify(tplPayload).slice(0, 200));
  const sameIds =
    hostTpls.length === tplRows.length &&
    hostTpls.every((t) => tplRows.some((r) => r && r.id === t.id));
  sameIds
    ? ok("Marketplace 读到的模板集合 = data/desktop/bot-templates.json（无第二份真相）")
    : bad("template drift", "host catalog ≠ bot-templates.json");

  /* ---------- one-click create from a template really creates a Bot ---------- */
  const botsSnap = readText(BOTS);
  try {
    const created = turn("create bot from template bug-reproduction name=ProbeRepro");
    const hr = ((created.json && created.json.host_results) || []).find(
      (h) => h && h.kind === "bot_create_from_template",
    );
    let p = {};
    try {
      p = JSON.parse((hr && hr.stdout) || "{}");
    } catch (_) {
      p = {};
    }
    const bot = p.bot || null;
    bot && bot.name === "ProbeRepro" && /bug/i.test(String(bot.job || ""))
      ? ok("Marketplace 一键创建 → Host 真建 Bot，job/description 来自模板")
      : bad("create from template", JSON.stringify(p).slice(0, 200));
    const onDisk = (readJson(BOTS) || {}).bots || [];
    onDisk.some((b) => b && b.name === "ProbeRepro")
      ? ok("新建的 Bot 真的落进 data/desktop/bots.json")
      : bad("template bot persist", "not in bots.json");
  } finally {
    if (botsSnap) fs.writeFileSync(BOTS, botsSnap);
  }

  /* ---------- GP-117: activity ordering is real ---------- */
  const botsForSurface = readJson(BOTS) || { version: 1, primary_id: "agent-bit", bots: [] };
  const surfaceSrc = readText(path.join(REPO, "hosts/desktop/product_surface.js"));
  /function touchBotActivity\(botId\)/.test(surfaceSrc) &&
  /bot\.updated_at = nowIso\(\)/.test(surfaceSrc)
    ? ok("product_surface 提供 touchBotActivity，写入真实 updated_at")
    : bad("touchBotActivity", "missing");

  const { createProductSurface } = require(path.join(REPO, "hosts/desktop/product_surface.js"));
  const surface = createProductSurface(REPO);
  const mkBot = (name, ts) => {
    const r = surface.createBot({ name, job: "probe", description: "m24 ordering probe" });
    if (!r || !r.ok) return null;
    const data = readJson(BOTS) || { bots: [] };
    const row = (data.bots || []).find((b) => b.id === r.bot.id);
    row.updated_at = ts;
    row.pinned = false;
    writeJson(BOTS, data);
    return r.bot.id;
  };
  const idsToDrop = [];
  try {
    const oldId = mkBot("ProbeOld", "2020-01-01T00:00:00.000Z");
    const newId = mkBot("ProbeNew", "2020-01-02T00:00:00.000Z");
    idsToDrop.push(oldId, newId);
    const before = surface.listViews().bots.map((b) => b.id);
    before.indexOf(newId) < before.indexOf(oldId)
      ? ok("默认排序 = updated_at 降序（较新的 Bot 在前）")
      : bad("default order", before.slice(0, 6).join(","));

    surface.touchBotActivity(oldId);
    const after = surface.listViews().bots.map((b) => b.id);
    after.indexOf(oldId) < after.indexOf(newId)
      ? ok("给旧 Bot 跑一轮 → 它跳到新 Bot 之前（活动排序是真数据）")
      : bad("activity reorder", after.slice(0, 6).join(","));

    surface.botsPin(oldId, true);
    const pinned = surface.listViews().bots;
    pinned[0] && pinned[0].id === oldId && pinned[0].pinned === true
      ? ok("置顶 Bot 固定在第一位，即使刚刚它被排序挤下去过")
      : bad("pinned first", JSON.stringify(pinned[0] || {}).slice(0, 160));

    // A really old pinned Bot still wins over a hot one.
    const data = readJson(BOTS) || { bots: [] };
    (data.bots || []).forEach((b) => {
      if (b.id === oldId) b.updated_at = "2019-01-01T00:00:00.000Z";
    });
    writeJson(BOTS, data);
    surface.touchBotActivity(newId);
    const stillPinned = surface.listViews().bots;
    const pinnedCount = stillPinned.filter((b) => b.pinned).length;
    const blockIsPinned = stillPinned.slice(0, pinnedCount).every((b) => b.pinned);
    const oldPos = stillPinned.findIndex((b) => b.id === oldId);
    const newPos = stillPinned.findIndex((b) => b.id === newId);
    blockIsPinned && oldPos >= 0 && oldPos < pinnedCount && newPos >= pinnedCount
      ? ok("很旧但置顶的 Bot 仍然排在所有未置顶 Bot 之前（pinned 优先于 updated_at）")
      : bad(
          "pinned beats activity",
          "pinned=" + pinnedCount + " oldPos=" + oldPos + " newPos=" + newPos +
            " order=" + stillPinned.slice(0, 5).map((b) => b.id).join(","),
        );

    const countBefore = (readJson(BOTS) || {}).bots.length;
    const unknown = surface.touchBotActivity("bot-does-not-exist");
    const countAfter = (readJson(BOTS) || {}).bots.length;
    unknown && unknown.ok === false && unknown.error === "bot_not_found" && countAfter === countBefore
      ? ok("未知 bot id 被拒绝且不会凭空造行（bot_not_found）")
      : bad("unknown bot", JSON.stringify(unknown));
  } finally {
    // drop probe bots through the real delete path, then restore the store.
    for (const id of idsToDrop) {
      try {
        if (id) surface.botsDelete(id);
      } catch (_) {
        /* ignore */
      }
    }
    if (botsSnap) fs.writeFileSync(BOTS, botsSnap);
    else writeJson(BOTS, botsForSurface);
  }

  /surface\.touchBotActivity\(touchedId\)/.test(readText(MAIN_PATH))
    ? ok("main.js 在 bitbot:turn 里记录活动（不是只靠 UI 点击）")
    : bad("turn wiring", "touchBotActivity not called from the turn handler");
  /broadcast\("bitbot:bots-changed"/.test(readText(MAIN_PATH)) &&
  /onBotsChanged: \(cb\)/.test(readText(PRELOAD_PATH)) &&
  /window\.bitbot\.onBotsChanged/.test(html)
    ? ok("回合结束后 Host 广播 bots-changed，渲染层重排侧栏（无需手动刷新）")
    : bad("bots-changed broadcast", "main/preload/renderer not wired end to end");

  /* ---------- GP-116: group list comes from rooms.json ---------- */
  const roomsSnap = readText(ROOMS);
  try {
    const data = readJson(BOTS) || { bots: [] };
    const visible = (data.bots || []).filter((b) => b && !b.hidden).map((b) => b.id).slice(0, 2);
    if (visible.length < 2) {
      bad("group list", "need two visible bots to create a room");
    } else {
      const created = surface.roomCreate(visible.join(","), "Probe group");
      created && created.ok ? ok("Host 真实创建群组（返回 room id）") : bad("room create", JSON.stringify(created));
      const rooms = (surface.loadRooms().rooms || []).filter((r) => r.title === "Probe group");
      rooms.length === 1 && (rooms[0].members || []).length === 2
        ? ok("群组落进 data/desktop/rooms.json 且成员 = 2 个真实 Bot（侧栏 #room-list 的数据源）")
        : bad("room persist", JSON.stringify(rooms).slice(0, 160));
      const t = surface.roomTurn(rooms[0].id, "@everyone probe ping", new Date().toISOString());
      t && t.ok && t.transcript_entry && t.transcript_entry.responder_policy === "all"
        ? ok("群组回合按 @everyone 路由（transcript 由 Host 生成）")
        : bad("room turn", JSON.stringify(t).slice(0, 160));
      /function refreshSidebarRooms\(\)/.test(html) && /window\.bitbot\.rooms\.list\(\)/.test(html)
        ? ok("侧栏群组列表读 rooms.list()（不在渲染层自建第二份状态）")
        : bad("sidebar rooms source", "rooms.list not used");
      /dataset\.roomId = rm\.id/.test(html)
        ? ok("群组行带 data-room-id，可点开进入该群聊回合")
        : bad("room row id", "missing dataset.roomId");
    }
  } finally {
    if (roomsSnap) fs.writeFileSync(ROOMS, roomsSnap);
    else writeJson(ROOMS, { version: 1, rooms: [] });
  }

  /* ---------- GP-119: one message stream, independent rails ---------- */
  /function sendRoomMessage\(\)[\s\S]{0,600}runUserTurn\("room "/.test(html)
    ? ok("群聊消息走同一条 runUserTurn → #log，不另开窗口")
    : bad("room stream", "room message bypasses the shared transcript");
  (html.match(/id="log"/g) || []).length === 1
    ? ok("只有一个消息流容器 #log")
    : bad("single stream", (html.match(/id="log"/g) || []).length + " #log containers");
  const chrome = fs.readFileSync(path.join(REPO, "hosts/desktop/ui_chrome.css"), "utf8");
  // Layout contract v1 (§1/§3): single 3-column grid; rail width switches
  // with body[data-panel]; sidebar stays 280, rail 340. The old 4-column
  // (0fr placeholder) rules must be gone.
  /--sidebar-w:\s*280px/.test(chrome) &&
  /--rail-w:\s*340px/.test(chrome) &&
  /grid-template-columns:\s*var\(--sidebar-w\) minmax\(0, 1fr\) var\(--panel-w\)/.test(html) &&
  /body\[data-panel="tools"\]/.test(html) &&
  !/grid-template-columns:\s*var\(--sidebar-w\) 1fr 0fr 0fr/.test(html)
    ? ok("单 grid：sidebar|main|rail 三列，rail 宽由 data-panel 切换（280/340，旧 4 列 0fr 已退役）")
    : bad("rails", "contract-v1 single-grid layout missing");

  finish();
}

function finish() {
  console.log("\nprove_m24_window: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
}

main();
