/* e2e_desktop_live_team.mjs — 真 provider 下的「一键成队」五棒流水线（批次 6）
 *
 * 为什么单独一个脚本：creator_pipeline 覆盖的是**面板 / 排程 / 审批 / 邮件**一整套
 * 交互，链路长、跟「五棒真跑」无关的失败会淹没真正要看的东西。本脚本只做一件事：
 *
 *   在真实 Electron 里点「一键成队」⇒ 真 provider 跑完五棒 ⇒ 交出**最真实的
 *   使用体验证据**：每一棒的耗时、每一棒的验收结论、产物正文长什么样、
 *   产物里的**链接是不是真的能打开**。
 *
 * 为什么要单独看链接：stub 交的是固定夹具，链接永远是那两条示例 URL ⇒ 永远绿。
 * 真模型交出来的链接可能是**编的** —— 契约只数 URL 形态、不验真伪。
 * ⇒ 这里抽前若干条真的去抓一遍：能打开 / 404 / 连不上，分别计数。
 * 这一条**不是 PASS 条件**（外网会抖），是给产品判断用的**实测数据**。
 *
 * 跑法（要真 provider 的 key）：
 *   BITBOT_LLM_PROVIDER=minimax \
 *   BITBOT_LLM_MINIMAX_API_KEY=<key> \
 *   ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_live_team.mjs
 *
 * 没有 key ⇒ 诚实 SKIP（exit 0），不伪造 PASS。
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, hasDisplay } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
/* playwright-core 装在 hosts/desktop 下 ⇒ 用它的 package.json 当解析根。 */
const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");
const ELECTRON = resolveElectronBinary(DESKTOP);
const UD = electronUserDataDir("live-team");

/* 数据根隔离：口径与 creator_pipeline 相同（内核 cwd = dirname(DATA_ROOT)，
   所以隔离根必须是某个根的直接子目录，且要软链 cmd/ 与 moon.mod）。 */
const GATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-live-team-"));
try { fs.symlinkSync(path.join(REPO, "cmd"), path.join(GATE_ROOT, "cmd"), "dir"); } catch { /* 已存在 */ }
const DATA = path.join(GATE_ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
for (const name of fs.existsSync(path.join(REPO, "data")) ? fs.readdirSync(path.join(REPO, "data")) : []) {
  if (name === "tmp" || name.startsWith("import-backup-")) continue;
  fs.cpSync(path.join(REPO, "data", name), path.join(DATA, name), { recursive: true });
}
process.on("exit", () => { try { fs.rmSync(GATE_ROOT, { recursive: true, force: true }); } catch { /* ignore */ } });
const D = (...p) => path.join(DATA, ...p);
const ROOMS = D("desktop/rooms.json");
const BOTS = D("desktop/bots.json");
const TZ = process.env.BITBOT_LIVE_TZ || "Asia/Shanghai";

let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 400) : "")); };
const note = (m) => console.log("  · " + m);

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
const listFiles = (dir, ext) => {
  try { return fs.readdirSync(dir).filter((f) => !ext || f.endsWith(ext)); } catch { return []; }
};

/* provider 配好了吗？ */
function providerReady() {
  const prov = String(process.env.BITBOT_LLM_PROVIDER || "").trim().toLowerCase();
  const key = prov === "minimax"
    ? String(process.env.BITBOT_LLM_MINIMAX_API_KEY || "").trim()
    : String(process.env.BITBOT_LLM_API_KEY || "").trim();
  return Boolean(prov && key);
}

(async () => {
  console.log("e2e_desktop_live_team — 真 provider 五棒流水线");
  if (!providerReady()) {
    SKIP++;
    console.log("  · SKIP 没有配真 provider 的 key（BITBOT_LLM_PROVIDER + 对应的 *_API_KEY）—— 不伪造 PASS");
    console.log("e2e_desktop_live_team: PASS=0 FAIL=0 SKIP=1");
    process.exit(0);
  }
  if (!hasDisplay()) {
    SKIP++;
    console.log("  · SKIP 没有 DISPLAY（需要 xvfb）—— 不伪造 PASS");
    console.log("e2e_desktop_live_team: PASS=0 FAIL=0 SKIP=1");
    process.exit(0);
  }

  let app = null;
  try {
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
      cwd: REPO,
      env: electronLaunchEnv({
        DISPLAY: process.env.DISPLAY || "",
        PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
        MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
        BITBOT_REPO_ROOT: REPO,
        BITBOT_DATA_ROOT: DATA,
        BITBOT_NO_SECRET_SYNC: "1",
        BITBOT_DESKTOP_AUTOSTART: "0",
        TZ,
        BITBOT_LLM_STREAM: "0",
        /* 五棒串行、每棒可能多轮 ⇒ 房间回合的时限要放大 */
        BITBOT_ROOM_RESPONDER_TIMEOUT_MS: process.env.BITBOT_ROOM_RESPONDER_TIMEOUT_MS || "600000",
      }),
      timeout: 120000,
    });
    const win = await app.firstWindow({ timeout: 90000 });
    await win.waitForSelector("#composer #text", { timeout: 90000 });
    ok("真 Electron 冷启动就绪（Bot 时区 " + TZ + "）");

    /* ---- 点「一键成队」：自媒体内容团队模板 ---- */
    await win.evaluate(() => { const g = document.getElementById("mk-grid"); if (g) g.innerHTML = ""; });
    await win.click("#account-avatar-btn").catch(() => {});
    await win.waitForSelector("#ap-market", { state: "visible", timeout: 15000 }).catch(() => {});
    await win.click("#ap-market").catch(() => {});
    const card = await win
      .waitForSelector('#mk-grid .ca-card[data-template-id="media-content-team"] button', { timeout: 30000 })
      .catch(() => null);
    if (!card) {
      bad("模板市场里没有「自媒体内容团队」这张卡", "模板目录为空");
      throw new Error("no template card");
    }
    ok("模板市场里有「自媒体内容团队」");
    /* 点击**不许**把错误吞掉 —— 上一版 `.catch(()=>{})` 把「被遮挡 / 元素已替换」
       这类真错误藏成了「点了但没反应」，白等十分钟。 */
    try {
      await win.click('#mk-grid .ca-card[data-template-id="media-content-team"] button', { timeout: 15000 });
      ok("点了「一键成队」");
    } catch (e) {
      bad("点「一键成队」失败", (e && e.message) || String(e));
      /* 退一步：直接触发 DOM 事件（有些浮层会挡住 Playwright 的命中测试）。 */
      const fired = await win.evaluate(() => {
        const b = document.querySelector('#mk-grid .ca-card[data-template-id="media-content-team"] button');
        if (!b) return false;
        b.click();
        return true;
      }).catch(() => false);
      fired ? ok("退一步用 DOM 事件触发「一键成队」") : bad("连 DOM 事件都触发不了");
    }

    /* 点击之后先诊断：建团到底有没有动起来（bot 记录 / 群 / 界面提示）。 */
    await new Promise((r) => setTimeout(r, 4000));
    const diag = {
      bots: (readJson(BOTS, { bots: [] }).bots || []).length,
      rooms: (readJson(ROOMS, { rooms: [] }).rooms || []).map((r) => String(r.title || "")),
      toast: await win.evaluate(() => {
        const t = document.querySelector("#toast, .toast, #cmd-toast");
        return t ? String(t.textContent || "").slice(0, 120) : "";
      }).catch(() => ""),
      cardBtn: await win.evaluate(() => {
        const b = document.querySelector('#mk-grid .ca-card[data-template-id="media-content-team"] button');
        return b ? { text: String(b.textContent || "").slice(0, 40), disabled: !!b.disabled } : null;
      }).catch(() => null),
    };
    console.log("  · 点击后诊断：" + JSON.stringify(diag));

    /* ---- 等五棒跑完（final_report 落盘即流水线结束） ---- */
    let room = null, tx = [], report = null;
    const t0 = Date.now();
    /* 等 25 分钟：房间回合的总闸现在默认 15 分钟（真 provider 五棒要这么久）。 */
    for (let i = 0; i < 6000; i += 1) {
      const rooms = readJson(ROOMS, { rooms: [] });
      const list = Array.isArray(rooms.rooms) ? rooms.rooms : [];
      room = list.find((r) => r && String(r.title || "").indexOf("自媒体内容团队") >= 0) || null;
      if (room) {
        tx = Array.isArray(room.transcript) ? room.transcript : [];
        report = tx.filter((e) => e && e.kind === "final_report").pop() || null;
        if (report) break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    const wall = Date.now() - t0;
    if (!room) { bad("一键成队之后连群都没建起来"); throw new Error("no room"); }
    ok("一键成队把团队建起来了（群名=" + String(room.title || "") + "，成员 " +
      (Array.isArray(room.members) ? room.members.length : 0) + " 个）");
    if (!report) {
      bad("五棒没跑完（等不到 final_report，已等 " + Math.round(wall / 1000) + "s）",
        JSON.stringify(tx.map((e) => e && [e.kind, String(e.error || "").slice(0, 60)])).slice(0, 500));
      throw new Error("no final_report");
    }
    ok("第一件事**真跑完了**（整轮墙钟 " + Math.round(wall / 1000) + "s）");

    /* ---- 先把证据 dump 出来（隔离根在 exit 时会被删） ---- */
    try {
      fs.mkdirSync("/tmp/live_dump", { recursive: true });
      const turns = listFiles(D("llm/turns"), ".json");
      for (const f of turns) {
        try { fs.copyFileSync(path.join(D("llm/turns"), f), path.join("/tmp/live_dump", f)); } catch { /* ignore */ }
      }
      fs.writeFileSync("/tmp/live_dump/rooms.json", JSON.stringify(readJson(ROOMS, {}), null, 2));
      const tr = (room && room.transcript) || [];
      fs.writeFileSync("/tmp/live_dump/transcript.txt",
        tr.map((e) => "[" + (e && e.kind) + "] " + String((e && (e.text || e.error || e.summary)) || "").slice(0, 400)).join("\n"));
      console.log("  · 证据已 dump 到 /tmp/live_dump（turns " + turns.length + " 份）");
    } catch (e) {
      console.log("  · dump 失败：" + String((e && e.message) || e).slice(0, 120));
    }

    /* ---- 每一棒的结论 ---- */
    const stages = report.stage_results || [];
    const allPass = stages.length >= 5 && stages.every((x) => x && x.pass === true);
    console.log("  · 每棒结论：" + JSON.stringify(stages.map((x) => ({
      棒: x && x.name, 过: x && x.pass, ms: Number((x && x.duration_ms) || 0),
      文件: x && x.artifact_path ? String(x.artifact_path).split("/").slice(-2).join("/") : "",
      原因: x && (x.reason || x.code || ""),
    }))));
    allPass
      ? ok("五棒**每一棒都过了验收**（" + stages.length + " 棒）")
      : bad("五棒没全过验收",
            JSON.stringify(stages.map((x) => [x && x.name, x && x.pass, x && (x.reason || x.code)])).slice(0, 500));

    const totalMs = stages.reduce((a, x) => a + Number((x && x.duration_ms) || 0), 0);
    ok("每棒耗时都记着（共 " + totalMs + "ms；墙钟 " + wall + "ms）");

    /* ---- 五个交付文件真落盘 ---- */
    const files = stages.map((s) => s && s.artifact_path).filter(Boolean);
    const exist = files.filter((f) => fs.existsSync(f));
    exist.length >= 5
      ? ok("五个交付文件真落盘（" + exist.map((f) => String(f).split("/").slice(-2).join("/")).join(", ") + "）")
      : bad("交付文件没落全（" + exist.length + "/" + files.length + "）",
            JSON.stringify(files.map((f) => String(f).split("/").slice(-2).join("/"))));

    /* ---- 产物正文 = 成果本身 ---- */
    const dv = report.deliverable;
    let body = "";
    if (dv && dv.path && fs.existsSync(dv.path)) body = fs.readFileSync(dv.path, "utf8");
    body.length > 200
      ? ok("产物正文是**成果本身**（" + body.length + " 字符，不是「已完成」那种汇报）")
      : bad("产物正文不是成果本身", body.slice(0, 200) || "(没落盘)");

    /* ---- 链接实测：模型交出来的链接是不是真的 ---- */
    const urls = [];
    const seen = new Set();
    for (const f of exist) {
      let t = "";
      try { t = fs.readFileSync(f, "utf8"); } catch { /* ignore */ }
      for (const m of String(t).match(/https?:\/\/[^\s)\]}"'<>，。；：、]+/g) || []) {
        if (!seen.has(m)) { seen.add(m); urls.push(m); }
      }
    }
    const sample = urls.slice(0, 8);
    const probe = [];
    for (const u of sample) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 9000);
        const resp = await fetch(u, { method: "GET", redirect: "follow", signal: ctl.signal,
          headers: { "User-Agent": "BitBot-live-probe/1.0" } });
        clearTimeout(timer);
        probe.push({ url: u, status: resp.status, ok: resp.ok });
      } catch (e) {
        probe.push({ url: u, status: 0, ok: false, err: String((e && e.message) || e).slice(0, 50) });
      }
    }
    const alive = probe.filter((x) => x.ok).length;
    const dead = probe.filter((x) => !x.ok && x.status >= 400).length;
    const unreach = probe.filter((x) => !x.ok && x.status === 0).length;
    console.log("  · 链接实测：产物里共 " + urls.length + " 条链接，抽 " + sample.length + " 条去抓 ⇒ " +
      "可访问 " + alive + " · 4xx/5xx " + dead + " · 连不上 " + unreach);
    for (const pr of probe) {
      console.log("      " + (pr.ok ? "✓ " : "✗ ") + pr.status + " " + pr.url.slice(0, 110) +
        (pr.err ? "  (" + pr.err + ")" : ""));
    }
    console.log("  · 实测数据：" + JSON.stringify({
      棒数: stages.length, 全过: allPass, 每棒ms: stages.map((x) => Number((x && x.duration_ms) || 0)),
      整轮墙钟ms: wall, 链接总数: urls.length, 抽查: probe.length, 可访问: alive, 打不开: dead,
    }));

    /* ---- key 不许落盘 ---- */
    let leak = "";
    for (const dir of [D("llm/turns"), D("llm"), D("desktop"), D("workspace")]) {
      for (const f of listFiles(dir, "")) {
        let t = "";
        try { t = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
        if (t.match(/sk-(cp|api)-[A-Za-z0-9_-]{20,}/)) { leak = path.join(dir, f); break; }
      }
      if (leak) break;
    }
    leak ? bad("落盘文件里出现了 key 明文：" + leak) : ok("落盘文件里没有 key 明文");

    /* ---- 产物正文抽一段出来看看（人话） ---- */
    console.log("  · 产物正文前 600 字：");
    console.log("      " + String(body).slice(0, 600).split("\n").join("\n      "));
  } catch (e) {
    bad("脚本异常", (e && (e.stack || e.message)) || String(e));
  } finally {
    try { if (app) await app.close(); } catch { /* ignore */ }
  }
  console.log("e2e_desktop_live_team: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
})();
