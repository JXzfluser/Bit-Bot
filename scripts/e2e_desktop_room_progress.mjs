/* e2e_desktop_room_progress.mjs — KP-01「群进度死线」到底接活没有（真渲染 + 真回合）
 *
 * 这条门禁存在的理由：main.js 的 roomRuntime.onProgress 一直在广播
 * `bitbot:room-turn-progress`，但 preload 里**没有对应通道**、渲染侧**没有 handler** ——
 * 也就是说群里 @ 一个 Bot 干活时，名字旁边永远只有一句静态「工作中…」，整段沉默
 * 到回复落地。静态判据能证明接线接上了，证明不了「真 Electron 里进度帧真的推到了
 * 渲染进程、Bot 名字旁真的出现了当前步」。
 *
 * 覆盖（验收门逐条）：
 *   P1 真 Electron 冷启动（main + preload + index.html）就绪；
 *   P2 preload 暴露 rooms.onRoomTurnProgress（订阅得到，不是死通道）；
 *   P3 产品 IPC 建 2 Bot + 2 人群（和创建对话框同一条 bots.op）；
 *   P4 群里 @A 发一句活 → 渲染进程收到 **≥1 条进度帧**（注入对照摘掉广播必须翻红）；
 *   P5 每帧带 bot_id/room_id 且匹配本群被点名的 Bot（进度是推来的、按 Bot 分的，不是猜的）；
 *   P6 「工作中」卡的名字旁出现当前步（rw-text 不再是「工作中…」，而是协议标签）——可感面；
 *   P7 帧序列里有 start（真效果开始，不是只有一张静态卡）。
 *
 * 纪律：独立 user-data-dir；数据根用**仓库 data/**（与 e2e_desktop_room_orchestration
 * 同口径——空临时根会让内核几百毫秒就崩，走不到「回合在跑」这个观察点）；
 * rooms/sessions/bots 跑前快照、跑后还原；跑完关进程。
 *
 * 注入对照：BITBOT_ROOM_PROGRESS_MAIN 指向一份「摘掉广播行」的 main.js 副本时，
 * P4/P5/P6/P7 必须翻红（渲染进程一条帧都收不到）。由 G-115 驱动，副本跑完即删。
 *
 * 缺 electron / display / moon 时诚实 SKIP（exit 0 + SKIP 计数），不伪造 PASS。
 * 用法：node scripts/e2e_desktop_room_progress.mjs
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync, spawn } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, hasDisplay } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");

/* ---- 进程清理必须**按路径限定**（2026-11-22 补）------------------------------
 * 原来这里按**名字**清：`pkill -9 -f "electron/dist/electron"` /
 * `pkill -9 -f "openai_compat_stub.js"`。
 * `-f` 匹配的是**整条命令行**，而同一台机器上可能有**另一个 checkout（worktree）
 * 正在跑门禁** ⇒ 它的 electron / stub 一样命中 ⇒ 跨 worktree 互杀。
 * 症状很有迷惑性：被杀的那扇门报
 *   「Target page, context or browser has been closed」
 * 看着像自己的应用崩了，其实是别人清的。
 * 现在只清**自己这份 checkout** 的进程。 */
const ELECTRON_BIN_PATH = path.join(DESKTOP, "node_modules/electron/dist/electron");
const STUB_BIN_PATH = path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js");
const killOnlyMine = (absPath) => {
  const pattern = absPath.replace(/[.]/g, "[.]");
  try { execSync("pkill -9 -f " + JSON.stringify(pattern), { stdio: "ignore" }); } catch { /* 没有就没事 */ }
};
const ELECTRON = resolveElectronBinary(DESKTOP);
// 注入对照入口：默认跑真 main.js；G-115 把「摘掉广播行」的副本路径塞进来。
const MAIN = process.env.BITBOT_ROOM_PROGRESS_MAIN || path.join(DESKTOP, "main.js");
const ROOMS = path.join(REPO, "data/desktop/rooms.json");
const SESSIONS = path.join(REPO, "data/desktop/sessions.json");
const BOTS = path.join(REPO, "data/desktop/bots.json");
const SHOT_DIR = process.env.KP01_SHOT_DIR || path.join(os.tmpdir(), "bb-room-progress");

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d === undefined || d === null ? "" : " — " + String(d).slice(0, 400))); };

function honestSkip(reason) {
  console.log("e2e_desktop_room_progress: SKIP — " + reason);
  console.log("e2e_desktop_room_progress: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!fs.existsSync(ELECTRON)) honestSkip("electron dist missing (" + ELECTRON + ")");
if (!hasDisplay()) honestSkip("no DISPLAY and no xvfb-run");
let moonOk = false;
try { execSync("moon --version", { stdio: "ignore" }); moonOk = true; }
catch {
  const localBin = process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon");
  if (fs.existsSync(localBin)) {
    try { execSync('PATH="' + path.join(os.homedir(), ".moon/bin") + ':$PATH" moon --version', { stdio: "ignore" }); moonOk = true; }
    catch { /* below */ }
  }
}
if (!moonOk) honestSkip("moon toolchain unavailable → 真回合无法验证（诚实 residual，不伪造 PASS）");

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const STUB_PORT = Number(process.env.KP01_STUB_PORT || 8811);
const A = { name: "KP01Alpha", job: "KP01JOBALPHA 进度验证", desc: "KP01DESCA 只回一句话" };
const B = { name: "KP01Beta", job: "KP01JOBBETA 陪跑成员", desc: "KP01DESCB 凑满两人群" };
const ROOM_TITLE = "KP01 进度验收群";

function startStub() {
  const proc = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BITBOT_STUB_PORT: String(STUB_PORT),
      // 故意慢：llm_chat 效果的 start 帧在 provider 调用**之前**发，慢一点才有窗口
      // 观察到「名字旁出现当前步」这件事（不慢的话回合在第一次轮询前就收线了）。
      BITBOT_STUB_DELAY_MS: "3000",
      BITBOT_STUB_REPLY_MATCH: JSON.stringify({ "进度": "收到，这是一句用于验证群进度的回执。" }),
    },
  });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout")), 10000);
    proc.stdout.on("data", (d) => { if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(proc); } });
    proc.stderr.on("data", (d) => console.log("[stub] " + String(d).trim().slice(0, 200)));
    proc.on("error", rej);
  });
}

const readRooms = () => { try { return JSON.parse(fs.readFileSync(ROOMS, "utf8")); } catch { return { rooms: [] }; } };
const txOf = (id) => (((readRooms().rooms || []).find((r) => r && r.id === id) || {}).transcript) || [];
const reportsOf = (id) => txOf(id).filter((e) => e && e.kind === "final_report");

(async () => {
  console.log("e2e_desktop_room_progress — 群进度死线真链（KP-01）");
  console.log("  · main 入口：" + MAIN);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  // 先按前缀清掉上一轮遗留夹具（finally 没跑到时），保证真·新建、标题不命中旧群。
  const sweepFixtures = () => {
    let swept = { bots: 0, rooms: 0 };
    try {
      const bs = JSON.parse(fs.readFileSync(BOTS, "utf8"));
      const keep = (bs.bots || []).filter((b) => !(b && /^KP01/.test(String(b.name || ""))));
      swept.bots = (bs.bots || []).length - keep.length;
      if (swept.bots) { bs.bots = keep; fs.writeFileSync(BOTS, JSON.stringify(bs, null, 2)); }
    } catch { /* 首次运行没有 bots.json */ }
    try {
      const rs = JSON.parse(fs.readFileSync(ROOMS, "utf8"));
      const keep = (rs.rooms || []).filter((r) => !(r && String(r.title || "").startsWith(ROOM_TITLE)));
      swept.rooms = (rs.rooms || []).length - keep.length;
      if (swept.rooms) { rs.rooms = keep; fs.writeFileSync(ROOMS, JSON.stringify(rs, null, 2)); }
    } catch { /* 首次运行没有 rooms.json */ }
    return swept;
  };
  const swept = sweepFixtures();
  if (swept.bots || swept.rooms) console.log("  · 清掉上一轮遗留夹具：" + JSON.stringify(swept));
  const roomsBefore = fs.existsSync(ROOMS) ? fs.readFileSync(ROOMS) : null;
  const sessionsBefore = fs.existsSync(SESSIONS) ? fs.readFileSync(SESSIONS) : null;
  const botsBefore = fs.existsSync(BOTS) ? fs.readFileSync(BOTS) : null;
  let stub = null, app = null, roomId = "";
  try {
    stub = await startStub();
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [MAIN, "--no-sandbox", "--disable-gpu", "--user-data-dir=" + electronUserDataDir("room-progress")],
      cwd: REPO,
      env: electronLaunchEnv({
        DISPLAY: process.env.DISPLAY || "",
        PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
        MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
        BITBOT_REPO_ROOT: REPO,
        BITBOT_NO_SECRET_SYNC: "1",
        BITBOT_DESKTOP_AUTOSTART: "0",
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
        BITBOT_LLM_API_KEY: "e2e-stub-key",
        BITBOT_LLM_MODEL: "e2e-stub",
        BITBOT_LLM_STREAM: "0",
        BITBOT_ROOM_RESPONDER_TIMEOUT_MS: process.env.BITBOT_ROOM_RESPONDER_TIMEOUT_MS || "150000",
      }),
      timeout: 90000,
    });
    const win = await app.firstWindow({ timeout: 60000 });
    await win.waitForSelector("#composer #text", { timeout: 60000 });
    ok("P1 真 Electron 冷启动（main + preload + index.html）就绪");

    /* ---------- P2: preload 真暴露了这条通道 ---------- */
    const channelType = await win.evaluate(() =>
      typeof (window.bitbot && window.bitbot.rooms && window.bitbot.rooms.onRoomTurnProgress));
    channelType === "function"
      ? ok("P2 preload 暴露 rooms.onRoomTurnProgress（订阅得到，不是死通道）")
      : bad("P2 preload 没有 onRoomTurnProgress 通道", "typeof=" + channelType);

    /* ---------- P3: 产品 IPC 建 2 Bot + 2 人群 ---------- */
    const seeded = await win.evaluate(async ([a, b, title]) => {
      const enc = (s) => String(s || "").replace(/ +/g, "+");
      const encTitle = (s) => String(s || "").replace(/\+/g, "%2B").replace(/\s+/g, "+").trim();
      const mk = async (o) => {
        const r = await window.bitbot.bots.op({
          phrase: "create bot " + enc(o.name) + " job=" + enc(o.job) + " description=" + enc(o.desc),
        });
        const bot = (r && r.host_payload && r.host_payload.bot) || null;
        return { ok: !!(r && r.ok) && !!bot, id: bot ? bot.id : "" };
      };
      const ba = await mk(a);
      const bb = await mk(b);
      let room = { ok: false, id: "", members: 0 };
      if (ba.id && bb.id) {
        const rr = await window.bitbot.bots.op({
          phrase: "create group chat bots=" + [ba.id, bb.id].join(",") + " title=" + encTitle(title),
        });
        const view = await window.bitbot.rooms.list();
        const payload = (view && view.rooms) || {};
        const list = Array.isArray(payload) ? payload : payload.rooms || [];
        const hit = list.find((x) => x && x.title === title);
        room = { ok: !!(rr && rr.ok) && !!hit, id: hit ? hit.id : "", members: hit ? (hit.members || []).length : 0 };
      }
      return { ba, bb, room };
    }, [A, B, ROOM_TITLE]).catch((e) => ({ crashed: String((e && e.message) || e) }));
    if (!seeded || seeded.crashed) { bad("P3 seed crashed", seeded && seeded.crashed); throw new Error("no room — abort"); }
    seeded.ba.ok && seeded.bb.ok && seeded.room.ok && seeded.room.id && seeded.room.members === 2
      ? ok("P3 产品 IPC 建 2 Bot + 2 人群（" + seeded.room.id + "）")
      : bad("P3 create bots/room", JSON.stringify(seeded).slice(0, 400));
    roomId = seeded.room.id || "";
    if (!roomId) throw new Error("no room — abort");
    const botA = seeded.ba.id;

    // 打开群（composerRoom 对准它），working 卡与进度帧才有落点。
    await win.evaluate(() => refreshSidebarRooms());
    await win.waitForSelector('#room-list .agent-item[data-room-id="' + roomId + '"]', { timeout: 30000 });
    await win.click('#room-list .agent-item[data-room-id="' + roomId + '"]');
    await win.waitForFunction(() => {
      const b = document.getElementById("room-banner");
      return b && b.style.display !== "none";
    }, null, { timeout: 20000 });

    // 订阅进度帧（在发送之前挂上，一帧都不漏）。
    await win.evaluate(() => {
      window.__roomFrames = [];
      window.bitbot.rooms.onRoomTurnProgress((ev) => { window.__roomFrames.push(ev); });
    });

    /* ---------- P4: @A 发一句活 → 渲染进程收到 ≥1 条进度帧 ---------- */
    await win.waitForFunction(() => { const b = document.getElementById("send"); return b && !b.disabled; }, null, { timeout: 90000 }).catch(() => {});
    await win.fill("#composer #text", "@" + A.name + " 说一句进度验证的话");
    await win.press("#composer #text", "Enter");
    const gotFrame = await win
      .waitForFunction(() => Array.isArray(window.__roomFrames) && window.__roomFrames.length >= 1, null, { timeout: 60000 })
      .then(() => true).catch(() => false);
    const earlyCount = await win.evaluate(() => (window.__roomFrames || []).length);
    gotFrame && earlyCount >= 1
      ? ok("P4 群里 @A 干活，渲染进程收到进度帧（进度是推给 UI 的，不是 UI 猜的）")
      : bad("P4 没有收到任何群进度帧（死线没接活）", "frames=" + earlyCount);

    /* ---------- P6: 名字旁出现当前步（可感面）——趁回合还在跑时取 ---------- */
    const rowText = await win.evaluate(() => {
      const el = document.querySelector('#log .msg.room-working .rw-text');
      return el ? (el.textContent || "") : "";
    });
    rowText && /·/.test(rowText) && !/工作中|working/i.test(rowText)
      ? ok("P6 Bot 名字旁出现当前步：「" + rowText.slice(0, 60) + "」（不再是静态「工作中…」）")
      : bad("P6 名字旁没有当前步（还是静态工作中或空）", JSON.stringify(rowText));
    await win.screenshot({ path: path.join(SHOT_DIR, "kp01-room-progress.png") }).catch(() => {});

    // 等回合收线（final_report 落盘），再读完整帧序列——start/done/host_continuing
    // 都要收齐，打印出来的才是「收到的帧序列」而不是第一帧的快照。
    for (let i = 0; i < 120; i++) { if (reportsOf(roomId).length >= 1) break; await new Promise((r) => setTimeout(r, 500)); }
    const frames = await win.evaluate(() => window.__roomFrames || []);

    /* ---------- P5: 每帧按 Bot/群分，匹配被点名的 A ---------- */
    const tagged = frames.filter((f) => f && f.room_id === roomId && f.bot_id === botA);
    frames.length > 0 && tagged.length === frames.length
      ? ok("P5 每帧都带 room_id/bot_id 且匹配本群被点名的 A（" + tagged.length + "/" + frames.length + "，按 Bot 分进度）")
      : bad("P5 进度帧没有正确的 bot_id/room_id", JSON.stringify(frames.slice(0, 3)).slice(0, 400));

    /* ---------- P7: 帧序列里有 start（真效果开始）---------- */
    const phases = frames.map((f) => f && f.phase).filter(Boolean);
    phases.includes("start")
      ? ok("P7 帧序列含 start（真效果开始）：" + phases.join(" → "))
      : bad("P7 帧序列没有 start", JSON.stringify(phases));

    // 可感面命令输出：把收到的帧序列原样打印（phase/kind/category/bot）。
    console.log("  · 进度帧序列（共 " + frames.length + " 帧）：");
    for (const f of frames.slice(0, 12)) {
      console.log("    " + [f.phase, f.kind, f.category, f.label_key, "bot=" + String(f.bot_id || "").slice(0, 12)]
        .filter(Boolean).join(" | "));
    }
  } catch (e) {
    bad("gate crashed", (e && e.stack ? e.stack : String(e)).slice(0, 500));
  } finally {
    if (app) {
      try {
        await app.evaluate(({ app: electronApp }) => { electronApp.isQuiting = true; electronApp.quit(); });
        await Promise.race([app.close(), new Promise((_, rej) => setTimeout(() => rej(new Error("close timeout")), 15000))]);
      } catch { killOnlyMine(ELECTRON_BIN_PATH); }
    }
    if (stub) { try { stub.kill("SIGKILL"); } catch { /* ignore */ } }
    killOnlyMine(STUB_BIN_PATH);
    if (roomId) {
      const key = roomId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "room";
      try { fs.rmSync(path.join(REPO, "data/desktop/room-deliverables", key), { recursive: true, force: true }); } catch { /* ignore */ }
    }
    if (roomsBefore) fs.writeFileSync(ROOMS, roomsBefore); else fs.rmSync(ROOMS, { force: true });
    if (sessionsBefore) fs.writeFileSync(SESSIONS, sessionsBefore); else if (fs.existsSync(SESSIONS)) fs.rmSync(SESSIONS, { force: true });
    if (botsBefore) fs.writeFileSync(BOTS, botsBefore);
  }
  console.log("\ne2e_desktop_room_progress: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=0");
  process.exit(FAIL > 0 ? 1 : 0);
})().catch((e) => {
  console.error("e2e_desktop_room_progress fatal:", e && e.message ? e.message : e);
  process.exit(1);
});