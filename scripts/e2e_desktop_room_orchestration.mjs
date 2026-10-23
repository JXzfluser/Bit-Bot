/* e2e_desktop_room_orchestration.mjs — GP-143/144/145/146 真链验收
 *
 * 「Bot 私聊 + 群 Bot 协作」的用户可见闭环：真 Electron + 真 MoonBit 内核 +
 * 真 HTTP provider（本地 OpenAI 兼容 stub，不依赖任何外部服务）。
 *
 *   S1 产品 IPC 建 3 个不同职责 Bot + 1 个 3 人群（和创建对话框同一条 bots.op）。
 *   S2 群里 @A @B 发任务 → ≥2 张「工作中」卡 → stub 只对 B 的人设请求返 500 →
 *      如实 1/2 partial（UI 卡与 rooms.json 都写「未收齐」，不写「已全部收齐」）。
 *   S3 @A @C 发任务 → 2/2 收齐；A 的回执只带 A 的人设、不含 C 的人设（上下文不串）。
 *   S4 @A 单独发任务 → 1/1 收齐、无 partial 样式（点名只跑被点的那个）。
 *   S5 退出群再点开 → DOM 卡片数必须与 rooms.json 逐类相等（状态不漂移）。
 *   S6 旧式无 kind 的历史行 → 照样渲染成用户行，不崩。
 *   S7 转录卫生：人读字段里没有内核/Host 调试串、没有 token 形状串。
 *   S8 Bot 私聊：问 A「你的职责是什么」→ 回执带 Host 注入的人设标记（简介：…），
 *      不含 B/C 的人设；群回合不落进 sessions.json（DM 会话不被污染）。
 *   S9 幂等：同一条群任务再走 IPC → deduped，final_report 不重复落盘。
 *   S10 细节面：转录逐字段有界；失败卡在产品面说人话（本地化），磁盘仍留可审计原因。
 *   S11 幂等经 composer：不闪「工作中」卡，幂等说明卡在整表重绘后仍在（不一闪就没）。
 *   S12 点名不在群里的人：Host 记 unknown_mentions 并按未点名处理，界面如实告知。
 *   S13 rooms.json 坏掉：转录与侧栏如实报「读不到」（不演成空群/没有群），恢复后
 *       按原文件重建卡片；坏存储上的运行被拒绝且绝不落空目录覆盖历史。
 *   S14 群被移出目录（成员掉到 2 人以下被丢弃的等价场景）：渲染层收到目录事件后
 *       必须自动退出群聊，不留「看着像群、其实群已不存在」的空壳会话。
 *
 * 缺 electron / xvfb / moon 时诚实 SKIP（exit 0 + SKIP 计数），不伪造 PASS。
 * 用法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_room_orchestration.mjs
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync, spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = path.join(DESKTOP, "node_modules/electron/dist/electron");
const ROOMS = path.join(REPO, "data/desktop/rooms.json");
const SESSIONS = path.join(REPO, "data/desktop/sessions.json");
// 证据目录：默认写进 reference/（.png 约定上不入仓），可用 GP145_SHOT_DIR 覆盖。
const SHOT_DIR = process.env.GP145_SHOT_DIR || path.join(REPO, "docs/design/desktop-target/reference");
let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d === undefined || d === null ? "" : " — " + String(d).slice(0, 400))); };

function honestSkip(reason) {
  console.log("e2e_desktop_room_orchestration: SKIP — " + reason);
  console.log("e2e_desktop_room_orchestration: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!fs.existsSync(ELECTRON)) honestSkip("electron dist missing (" + ELECTRON + ")");
try { execSync("command -v xvfb-run", { stdio: "ignore" }); }
catch { if (!process.env.DISPLAY) honestSkip("no DISPLAY and no xvfb-run"); }
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

const STUB_PORT = Number(process.env.GP145_STUB_PORT || 8801);
const A = { name: "GP145Alpha", job: "GP145JOBALPHA 市场调研", desc: "GP145DESCA 只收集证据" };
const B = { name: "GP145Fail", job: "GP145JOBFAIL 长文写作", desc: "GP145DESCB 草稿需审批" };
const C = { name: "GP145Gamma", job: "GP145JOBGAMMA 数据核对", desc: "GP145DESCC 只做核对" };
const ROOM_TITLE = "GP145 协作验收群";

function startStub() {
  const proc = spawn(
    process.execPath,
    [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")],
    {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BITBOT_STUB_PORT: String(STUB_PORT),
        // echo-all：provider 回执里带上整条 message stack，人设是否真进载荷可直接看
        BITBOT_STUB_ECHO_ALL: "1",
        BITBOT_STUB_ECHO_WIDTH: "1400",
        // 只对带 B 人设的请求返 500 → 群里必须如实降级成 partial
        BITBOT_STUB_FAIL_CONTAINS: "名字：" + B.name,
      },
    },
  );
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout")), 10000);
    proc.stdout.on("data", (d) => {
      if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(proc); }
    });
    proc.stderr.on("data", (d) => console.log("[stub] " + String(d).trim().slice(0, 200)));
    proc.on("error", rej);
  });
}

const readRooms = () => {
  try { return JSON.parse(fs.readFileSync(ROOMS, "utf8")); } catch { return { rooms: [] }; }
};
const roomRow = (id) => (readRooms().rooms || []).find((r) => r && r.id === id) || null;
const txOf = (id) => ((roomRow(id) || {}).transcript) || [];
const rowsOf = (id, kind) => txOf(id).filter((e) => e && e.kind === kind);
const reportsOf = (id) => txOf(id).filter((e) => e && e.kind === "final_report");
const lastReport = (id) => { const l = reportsOf(id); return l[l.length - 1] || null; };

/** 等最后一张 final_report 变成这一轮的（比数数量稳：轮次序号 = reports.length）。 */
async function waitForReportCount(id, want, rounds = 240) {
  for (let i = 0; i < rounds; i++) {
    if (reportsOf(id).length >= want) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const DOM_COUNTS = () => ({
  user: document.querySelectorAll("#log .msg.room-user").length,
  reply: document.querySelectorAll("#log .msg.room-reply").length,
  error: document.querySelectorAll("#log .msg.room-error").length,
  report: document.querySelectorAll("#log .msg.room-report").length,
  working: document.querySelectorAll("#log .msg.room-working").length,
});

(async () => {
  console.log("e2e_desktop_room_orchestration — 群 Bot 协作真链（GP-143/144/145/146）");
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  // 上一轮被中断时可能把 GP145 夹具留在运行期文件里（finally 没跑到）。这里先按
  // 前缀清掉自己的夹具，保证每次都是真·新建、标题查找不会命中上一轮的群；快照在
  // 清理之后取，所以 finally 恢复出来的也是干净状态。
  const sweepFixtures = () => {
    const botsPath = path.join(REPO, "data/desktop/bots.json");
    let swept = { bots: 0, rooms: 0 };
    try {
      const bs = JSON.parse(fs.readFileSync(botsPath, "utf8"));
      const keep = (bs.bots || []).filter((b) => !(b && /^GP145/.test(String(b.name || ""))));
      swept.bots = (bs.bots || []).length - keep.length;
      if (swept.bots) { bs.bots = keep; fs.writeFileSync(botsPath, JSON.stringify(bs, null, 2)); }
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
  const botsBefore = fs.existsSync(path.join(REPO, "data/desktop/bots.json"))
    ? fs.readFileSync(path.join(REPO, "data/desktop/bots.json")) : null;
  let stub = null, app = null;
  const evidence = { started_at: new Date().toISOString(), env: { stub_port: STUB_PORT, moon: "real kernel + local stub provider" } };
  try {
    stub = await startStub();
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu"],
      cwd: REPO,
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || "",
        PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
        MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
        BITBOT_REPO_ROOT: REPO,
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
        BITBOT_LLM_API_KEY: "e2e-stub-key",
        BITBOT_LLM_MODEL: "e2e-stub",
        BITBOT_LLM_STREAM: "0",
        BITBOT_ROOM_RESPONDER_TIMEOUT_MS: process.env.BITBOT_ROOM_RESPONDER_TIMEOUT_MS || "150000",
      },
      timeout: 90000,
    });
    const win = await app.firstWindow({ timeout: 60000 });
    await win.waitForSelector("#composer #text", { timeout: 60000 });
    ok("真 Electron 冷启动（main + preload + index.html）就绪");

    /* ---------- S1: 产品 IPC 建 3 Bot + 1 群 ---------- */
    const seeded = await win.evaluate(async ([a, b, c, title]) => {
      // 与创建对话框完全一致的编码合同（空格→+，title= 到行尾）
      const enc = (s) => String(s || "").replace(/ +/g, "+");
      const encTitle = (s) => String(s || "").replace(/\+/g, "%2B").replace(/\s+/g, "+").trim();
      const mk = async (o) => {
        const r = await window.bitbot.bots.op({
          phrase: "create bot " + enc(o.name) + " job=" + enc(o.job) + " description=" + enc(o.desc),
        });
        const bot = (r && r.host_payload && r.host_payload.bot) || null;
        return { ok: !!(r && r.ok) && !!bot, id: bot ? bot.id : "", name: bot ? bot.name : "",
          job: bot ? bot.job : "", desc: bot ? bot.description : "", err: (r && r.error) || "" };
      };
      const ba = await mk(a);
      const bb = await mk(b);
      const bc = await mk(c);
      let room = { ok: false, id: "", members: 0, err: "" };
      if (ba.id && bb.id && bc.id) {
        const rr = await window.bitbot.bots.op({
          phrase: "create group chat bots=" + [ba.id, bb.id, bc.id].join(",") + " title=" + encTitle(title),
        });
        const view = await window.bitbot.rooms.list();
        const payload = (view && view.rooms) || {};
        const list = Array.isArray(payload) ? payload : payload.rooms || [];
        const hit = list.find((x) => x && x.title === title);
        room = { ok: !!(rr && rr.ok) && !!hit, id: hit ? hit.id : "", members: hit ? (hit.members || []).length : 0, err: (rr && rr.error) || "" };
      }
      return { ba, bb, bc, room };
    }, [A, B, C, ROOM_TITLE]).catch((e) => ({ crashed: String((e && e.message) || e) }));
    if (!seeded || seeded.crashed) {
      bad("seed crashed", seeded && seeded.crashed);
      throw new Error("no room to test — abort");
    }
    seeded.ba.ok && seeded.bb.ok && seeded.bc.ok &&
      new Set([seeded.ba.id, seeded.bb.id, seeded.bc.id]).size === 3
      ? ok("产品 IPC 建 3 个不同职责 Bot（" + [seeded.ba.id, seeded.bb.id, seeded.bc.id].join(" / ") + "）")
      : bad("bots.op create", JSON.stringify(seeded ?? null).slice(0, 400));
    // 建 Bot 时 job/description 是否被 Host 如实落盘（后续人设注入的真相来源）
    seeded.ba.job === A.job && seeded.bc.desc === C.desc
      ? ok("bots.json 如实存下 job/description（渲染与人设用同一份）")
      : bad("bot fields", JSON.stringify({ got: seeded.ba.job, desc: seeded.bc.desc }));
    seeded.room.ok && seeded.room.id && seeded.room.members === 3
      ? ok("产品 IPC 建群成功，成员 3（" + seeded.room.id + "）")
      : bad("create group chat", JSON.stringify(seeded.room));
    const roomId = seeded.room.id || "";
    if (!roomId) throw new Error("no room to test — abort");
    evidence.room_id = roomId;
    evidence.bot_ids = { A: seeded.ba.id, B: seeded.bb.id, C: seeded.bc.id };

    const openRoom = async () => {
      await win.evaluate(() => refreshSidebarRooms());
      await win.waitForSelector('#room-list .agent-item[data-room-id="' + roomId + '"]', { timeout: 30000 });
      await win.click('#room-list .agent-item[data-room-id="' + roomId + '"]');
      await win.waitForFunction(() => {
        const b = document.getElementById("room-banner");
        return b && b.style.display !== "none";
      }, null, { timeout: 20000 });
    };
    await openRoom();
    /** 上一轮 IPC 收线（发送钮重新可用）再发下一条，避免并发发送被静默吞掉。 */
    const sendText = async (t) => {
      await win.waitForFunction(() => {
        const b = document.getElementById("send");
        return b && !b.disabled;
      }, null, { timeout: 90000 }).catch(() => {});
      await win.fill("#composer #text", t);
      await win.press("#composer #text", "Enter");
    };
    await win.screenshot({ path: path.join(SHOT_DIR, "gp145-1-room-empty.png") });

    /* ---------- S2: @A @B → 真 partial（1/2） ---------- */
    const task1 = "@" + A.name + " @" + B.name + " 一起给出本季竞品结论与一段长文草稿";
    await sendText(task1);
    const gotWorking = await win
      .waitForFunction(() => document.querySelectorAll("#log .msg.room-working").length >= 2, null, { timeout: 20000 })
      .then(() => true).catch(() => false);
    const workingCount = gotWorking ? await win.evaluate(DOM_COUNTS).then((d) => d.working) : 0;
    gotWorking && workingCount >= 2
      ? ok("运行中按被点名 responder 各一张「工作中」卡（不等回合结束就画出来）")
      : bad("in-flight working cards", "count=" + workingCount);
    await win.screenshot({ path: path.join(SHOT_DIR, "gp145-2-room-working.png") });

    const got1 = await waitForReportCount(roomId, 1);
    const rep1 = lastReport(roomId);
    if (!got1 || !rep1) {
      bad("final_report never persisted", "rooms.json has no final_report for " + roomId);
    } else {
      const secs = rep1.sections || [];
      const sA = secs.find((s) => s && s.name === A.name);
      const sB = secs.find((s) => s && s.name === B.name);
      rep1.total === 2 && rep1.returned === 1 && rep1.partial === true
        ? ok("真链 partial：total=2 / returned=1 / partial=true（B 的 provider 真返 500）")
        : bad("partial aggregation", JSON.stringify({ total: rep1.total, returned: rep1.returned, partial: rep1.partial, secs: secs.map((s) => ({ n: s.name, ok: s.ok })) }));
      sA && sA.ok === true && String(sA.summary).includes("简介：" + A.desc) && String(sA.summary).includes("职责：" + A.job)
        ? ok("A 的回执里带 A 自己的名字/职责/简介 → Host 人设真进 provider 载荷")
        : bad("A persona in reply", JSON.stringify(sA ?? null).slice(0, 300));
      sA && !String(sA.summary).includes(B.desc) && !String(sA.summary).includes(C.desc)
        ? ok("A 的回执不含 B/C 的人设串 → 每回合只带自己的上下文")
        : bad("cross persona leak", String(sA && sA.summary).slice(0, 300));
      sB && sB.ok === false && String(sB.summary).trim() && !String(sB.summary).includes(B.desc)
        ? ok("B 如实失败：section.ok=false 且带失败原因，没有被编造成正文回执")
        : bad("B honest failure", JSON.stringify(sB ?? null).slice(0, 300));
      evidence.s2 = { final_report: rep1 };
    }
    const errs1 = rowsOf(roomId, "bot_reply_error");
    const replies1 = rowsOf(roomId, "bot_reply");
    replies1.length === 1 && replies1[0].speaker === seeded.ba.id && replies1[0].bot_id === seeded.ba.id
      ? ok("rooms.json：成功侧 1 条 bot_reply，speaker=bot_id（真实成员 id，不是显示名）")
      : bad("bot_reply rows", JSON.stringify(replies1).slice(0, 300));
    errs1.length === 1 && errs1[0].bot_id === seeded.bb.id && errs1[0].error
      ? ok("rooms.json：失败侧 1 条 bot_reply_error，错误原因原样保留（不吞错）")
      : bad("bot_reply_error rows", JSON.stringify(errs1).slice(0, 300));
    txOf(roomId).filter((e) => e && e.kind === "user").length === 1 &&
      txOf(roomId).filter((e) => !e || !e.kind).length === 0
      ? ok("群 transcript 只有 1 条 kind=user 用户行（单一写入点，内核不双写）")
      : bad("single user write", JSON.stringify(txOf(roomId).map((e) => e && e.kind)));

    await win.waitForFunction(() => document.querySelectorAll("#log .msg.room-report").length >= 1, null, { timeout: 30000 }).catch(() => {});
    const card1 = await win.evaluate(() => {
      const els = Array.from(document.querySelectorAll("#log .msg.room-report"));
      const last = els[els.length - 1];
      if (!last) return null;
      return {
        cls: last.className,
        count: ((last.querySelector(".rr-count") || {}).textContent || ""),
        head: ((last.querySelector(".rr-head") || {}).textContent || ""),
        bad: Array.from(last.querySelectorAll(".rr-sec.bad")).map((x) => (x.textContent || "")),
        errCards: Array.from(document.querySelectorAll("#log .msg.room-error .body")).map((x) => (x.textContent || "")),
        replyCards: document.querySelectorAll("#log .msg.room-reply").length,
      };
    });
    card1 && /1\/2/.test(card1.count) && /room-partial/.test(card1.cls)
      ? ok("UI 汇总卡显示 1/2 且带 partial 样式")
      : bad("UI partial card", JSON.stringify(card1).slice(0, 400));
    card1 && /未收齐/.test(card1.head) && !/已全部收齐/.test(card1.head)
      ? ok("partial 卡文案是「未收齐」，绝不写「已全部收齐」")
      : bad("partial copy", JSON.stringify(card1 && card1.head));
    card1 && card1.bad.length >= 1 && /GP145Fail/.test(card1.bad[0])
      ? ok("汇总卡里点名失败的那个 Bot（partial 可追责到具体成员）")
      : bad("partial section naming", JSON.stringify(card1 && card1.bad).slice(0, 300));
    card1 && card1.errCards.length >= 1 && /GP145Fail/.test(card1.errCards[0])
      ? ok("UI 失败卡点名失败的 Bot（bot_reply_error 用户可见）")
      : bad("UI error card", JSON.stringify(card1 && card1.errCards).slice(0, 300));
    await win.screenshot({ path: path.join(SHOT_DIR, "gp145-3-room-partial.png") });

    /* ---------- S3: @A @C → 2/2 收齐 + 人设互不串 ---------- */
    const task2 = "@" + A.name + " @" + C.name + " 分别给出自己的职责范围";
    await sendText(task2);
    const got2 = await waitForReportCount(roomId, 2);
    const rep2 = lastReport(roomId);
    const s2A = rep2 && (rep2.sections || []).find((s) => s && s.name === A.name);
    const s2C = rep2 && (rep2.sections || []).find((s) => s && s.name === C.name);
    got2 && rep2.total === 2 && rep2.returned === 2 && rep2.partial === false
      ? ok("多轮隔离：@A @C → 2/2 收齐、partial=false")
      : bad("two-responder run", JSON.stringify(rep2 ?? { total: rep2.total, returned: rep2.returned, partial: rep2.partial }));
    s2A && String(s2A.summary).includes("简介：" + A.desc) && !String(s2A.summary).includes("简介：" + C.desc) &&
      s2C && String(s2C.summary).includes("简介：" + C.desc) && !String(s2C.summary).includes("简介：" + A.desc)
      ? ok("同群两个 responder 各自只带自己的人设 → 上下文严格隔离")
      : bad("persona isolation", JSON.stringify({ a: String(s2A && s2A.summary).slice(0, 160), c: String(s2C && s2C.summary).slice(0, 160) }));
    const card2 = await win.evaluate(() => {
      const els = Array.from(document.querySelectorAll("#log .msg.room-report"));
      const last = els[els.length - 1];
      return last ? { cls: last.className, head: ((last.querySelector(".rr-head") || {}).textContent || "") } : null;
    });
    card2 && /2\/2/.test(card2.head) && !/room-partial/.test(card2.cls) && /已全部收齐/.test(card2.head)
      ? ok("UI 第二轮汇总卡 2/2、无 partial 样式、文案「已全部收齐」")
      : bad("complete card", JSON.stringify(card2));
    await win.screenshot({ path: path.join(SHOT_DIR, "gp145-4-room-complete.png") });

    /* ---------- S4: @A 单独 → 1/1（mentioned_only 只跑被点的） ---------- */
    const task3 = "@" + A.name + " 只做竞品结论这一件事";
    await sendText(task3);
    const got3 = await waitForReportCount(roomId, 3);
    const rep3 = lastReport(roomId);
    got3 && rep3.total === 1 && rep3.returned === 1 && rep3.partial === false &&
      (rep3.responders || []).length === 1 && rep3.responders[0] === seeded.ba.id
      ? ok("点名单播：@A → responders 只有 A，1/1 收齐")
      : bad("mention-only run", JSON.stringify(rep3 ?? { responders: rep3.responders, total: rep3.total, returned: rep3.returned, partial: rep3.partial }));
    const userRows = txOf(roomId).filter((e) => e && e.kind === "user");
    userRows.length === 3 && (userRows[0].responder_policy === "mentioned_only") &&
      (userRows[2].responders || []).length === 1
      ? ok("用户行如实带 responder_policy/responders（路由决策是可回读的产品数据）")
      : bad("user row routing", JSON.stringify(userRows.map((r) => ({ p: r.responder_policy, n: (r.responders || []).length }))));
    const working3 = await win.evaluate(DOM_COUNTS).then((d) => d.working);
    working3 === 0
      ? ok("收线后清理「工作中」卡（状态不与 rooms.json 漂移）")
      : bad("working cards not cleared", "count=" + working3);

    /* ---------- S5: 退出再点开 → DOM 与 rooms.json 逐类相等 ---------- */
    await win.evaluate(() => document.getElementById("room-banner-exit").click());
    await win.waitForFunction(() => document.querySelectorAll("#log .room-thread").length === 0, null, { timeout: 10000 }).catch(() => {});
    await openRoom();
    await win.waitForFunction(() => document.querySelectorAll("#log .msg.room-report").length >= 3, null, { timeout: 25000 }).catch(() => {});
    const dom5 = await win.evaluate(DOM_COUNTS);
    const dur5 = {
      user: rowsOf(roomId, "user").length + txOf(roomId).filter((e) => e && !e.kind).length,
      reply: rowsOf(roomId, "bot_reply").length,
      error: rowsOf(roomId, "bot_reply_error").length,
      report: rowsOf(roomId, "final_report").length,
    };
    dom5.user === dur5.user && dom5.reply === dur5.reply && dom5.error === dur5.error && dom5.report === dur5.report
      ? ok("重开群聊：卡片逐类与 rooms.json 完全一致（" + JSON.stringify(dur5) + "）")
      : bad("reload cards vs durable", JSON.stringify({ dom: dom5, durable: dur5 }));
    evidence.s5 = { dom: dom5, durable: dur5 };
    await win.screenshot({ path: path.join(SHOT_DIR, "gp145-5-room-reload.png") });

    /* ---------- S6: 旧式无 kind 的历史行 ---------- */
    {
      const st = readRooms();
      const row = (st.rooms || []).find((r) => r && r.id === roomId);
      if (!row) { bad("legacy row", "room row vanished"); }
      else {
        row.transcript.unshift({
          room_id: roomId,
          text: "旧式无kind历史行 的历史行",
          responders: [seeded.ba.id],
          at: "2026-01-01T00:00:00.000Z",
        });
        fs.writeFileSync(ROOMS, JSON.stringify(st, null, 2));
        await win.evaluate(() => document.getElementById("room-banner-exit").click());
        await openRoom();
        await win.waitForFunction(
          () => (document.getElementById("log").textContent || "").includes("旧式无kind历史行"),
          null, { timeout: 20000 }).catch(() => {});
        const legacy = await win.evaluate(() => ({
          shown: (document.getElementById("log").textContent || "").includes("旧式无kind历史行"),
          msgs: document.querySelectorAll("#log .msg").length,
        }));
        legacy.shown && legacy.msgs > 0
          ? ok("旧 transcript（无 kind）兼容渲染成用户行，不崩、不丢")
          : bad("legacy transcript", JSON.stringify(legacy));
      }
    }

    /* ---------- S7: 转录卫生 ---------- */
    {
      const humanText = txOf(roomId)
        .map((e) => [e.text, e.error, e.task, e.task_title, e.name,
          ...(Array.isArray(e.sections) ? e.sections.map((s) => s && (s.name + "|" + s.summary)) : [])]
          .filter(Boolean).join(" "))
        .join(" ||| ");
      const dirty = humanText.match(/(entry=|account=|masked=|token_refused|needs_host_ffi|Host FFI|moon run cmd\/|booting MoonBit|data\/desktop\/|data\/llm\/|\/Users\/|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,})/);
      !dirty ? ok("群 transcript 的人读字段无密钥/内部路径/调试串") : bad("transcript hygiene", String(dirty && dirty[0]));
      const shape = txOf(roomId).join ? JSON.stringify(txOf(roomId)) : "";
      !/(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|e2e-stub-key)/.test(shape)
        ? ok("整份 transcript（含字段名）无任何密钥形状串")
        : bad("secret shape in transcript", shape.slice(0, 300));
      // 只看群线程里真正可见的文字：调试行在 DM 侧本来就带 .debug-only（CSS 隐藏），
      // 这里不能把群线程外的历史 DM 行算成群的可见状态。
      const vis = await win.evaluate(() => {
        const t = document.querySelector("#log .room-thread");
        if (!t) return { found: false, text: "" };
        const cards = Array.from(t.querySelectorAll(".msg")).filter((el) => !el.classList.contains("debug-only"));
        return { found: true, text: cards.map((el) => el.innerText || "").join("\n") };
      });
      vis.found && vis.text.length > 0 && !/Host FFI|moon run|needs_host_ffi|__bb|entry=|account=|masked=|data\/desktop\/|ADR 0002/.test(vis.text)
        ? ok("产品态群线程（可见文字，含卡片正文）看不到调试串/内部路径")
        : bad("visible debug strings", JSON.stringify(vis).slice(0, 400));
    }

    /* ---------- S8: Bot 私聊人设 + 群回合不污染 DM 会话 ---------- */
    {
      const dmSessionTitle = A.name + " · DM";
      await win.evaluate(async (botId) => {
        const view = await window.bitbot.bots.list();
        const b = ((view && view.bots) || []).find((x) => x && x.id === botId);
        if (b) selectBotForChat(b);
        return !!b;
      }, seeded.ba.id);
      await win.waitForFunction(
        () => {
          const i = document.querySelector("#composer #text");
          return i && !/群/.test(i.placeholder || "");
        },
        null, { timeout: 20000 }).catch(() => {});
      const dmPlaceholder = await win.evaluate(() => (document.querySelector("#composer #text") || {}).placeholder || "");
      const stillInRoom = await win.evaluate(() => document.querySelectorAll("#log .room-thread").length > 0);
      !/群/.test(dmPlaceholder) && !stillInRoom
        ? ok("点开 Bot 私聊即退出群 composer（占位文案回到私聊、群线程移除）")
        : bad("DM composer state", JSON.stringify({ ph: dmPlaceholder, stillInRoom }));
      await sendText("你的职责是什么？");
      let dmText = "";
      for (let i = 0; i < 240; i++) {
        dmText = await win.evaluate(() => (document.getElementById("log").textContent || ""));
        if (dmText.includes("简介：")) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      // 「简介：<desc>」只可能来自 Host 注入的 system prompt：selectBotForChat 的
      // 本地提示行只写「职责：<job>」，所以这条断言不是自己证明自己。
      dmText.includes("简介：" + A.desc) && dmText.includes("名字：" + A.name) && dmText.includes("职责：" + A.job)
        ? ok("Bot 私聊回合的 provider 载荷带 A 的名字/职责/简介（按 activeBotId 现读 bots.json）")
        : bad("DM persona", dmText.slice(0, 300));
      !dmText.includes("简介：" + B.desc) && !dmText.includes("简介：" + C.desc)
        ? ok("A 的私聊回合不含 B/C 的人设 → 私聊上下文不串")
        : bad("DM persona leak", dmText.slice(0, 300));
      await win.screenshot({ path: path.join(SHOT_DIR, "gp145-6-dm-persona.png") });
      const st = fs.existsSync(SESSIONS) ? JSON.parse(fs.readFileSync(SESSIONS, "utf8")) : { sessions: [] };
      const dm = (st.sessions || []).find((s) => s && s.title === dmSessionTitle) || null;
      const dump = JSON.stringify((dm && dm.messages) || []);
      dm && !dump.includes(task1) && !dump.includes(task2) && !dump.includes(task3) && !/"final_report"/.test(dump)
        ? ok("群任务与 final_report 都没进 A 的 DM 会话（两路消息面互不污染）")
        : bad("room rows leaked to DM session", dump.slice(0, 300));
      const allSessions = JSON.stringify(st.sessions || []);
      !/"kind":"(bot_reply|bot_reply_error|final_report)"/.test(allSessions)
        ? ok("sessions.json 里没有群卡片行（群卡片只归 rooms.json 一处真相）")
        : bad("room cards in sessions", allSessions.slice(0, 300));
      evidence.s8 = { dm_session_title: dmSessionTitle, dm_messages: (dm && dm.messages) || [] };
    }

    /* ---------- S9: 幂等（同任务再走 IPC 不重复落盘） ---------- */
    {
      const before = reportsOf(roomId).length;
      const res = await win.evaluate(async ([rid, task]) => {
        const r = await window.bitbot.rooms.orchestrate({ room_id: rid, text: task });
        return { ok: !!(r && r.ok), deduped: !!(r && r.deduped), returned: r && r.returned, total: r && r.total, error: (r && r.error) || "" };
      }, [roomId, task3]);
      const after = reportsOf(roomId).length;
      res.deduped && after === before
        ? ok("幂等：重发同任务 → deduped 且 final_report 不重复落盘（" + before + " 张）")
        : bad("idempotency over IPC", JSON.stringify({ res, before, after }));
    }

    /* ---------- S10: 有界字段 / 本地化失败原因 / 汇报带路由语义 ---------- */
    {
      await openRoom();
      const all = txOf(roomId);
      const over = {
        text: all.filter((e) => e && e.kind === "bot_reply" && String(e.text || "").length > 4001).length,
        error: all.filter((e) => e && e.kind === "bot_reply_error" && String(e.error || "").length > 201).length,
        summary: all.filter((e) => e && e.kind === "final_report" &&
          (e.sections || []).some((s) => String((s && s.summary) || "").length > 241)).length,
        task: all.filter((e) => e && e.kind === "final_report" && String(e.task || "").length > 241).length,
      };
      Object.values(over).every((n) => n === 0)
        ? ok("共享转录逐字段有界（正文 ≤4001 / 原因 ≤201 / 摘要与任务 ≤241）")
        : bad("bounded transcript", JSON.stringify(over));
      const reports = all.filter((e) => e && e.kind === "final_report");
      reports.length > 0 && reports.every((e) => !!e.responder_policy)
        ? ok("每张汇报卡都持久带 responder_policy（重开窗口仍能说明这次谁该答）")
        : bad("final_report policy missing", JSON.stringify(reports.map((r) => r.responder_policy)));
      // 产品面说人话，磁盘留原因：两边缺任何一边都不算诚实。
      const cardText = await win.evaluate(() => {
        const el = document.querySelector("#log .msg.room-error .body");
        return el ? (el.innerText || "") : "";
      });
      const durableReason = String((all.find((e) => e && e.kind === "bot_reply_error") || {}).error || "");
      /模型或服务返回失败/.test(cardText) && !/stub provider failure/.test(cardText)
        ? ok("失败卡用本地化文案，不把上游原文摊在产品面")
        : bad("localized failure copy", JSON.stringify(cardText).slice(0, 300));
      /stub provider failure/.test(durableReason)
        ? ok("磁盘上的失败原因仍然保留（可审计），只是不进产品面")
        : bad("durable reason lost", JSON.stringify(durableReason).slice(0, 200));
    }

    /* ---------- S11: 同任务经 composer 重发 → 不闪运行态、说明卡不被重绘吞掉 ---------- */
    {
      await openRoom();
      await win.evaluate(() => {
        window.__gp145WorkingAdded = 0;
        if (window.__gp145Obs) window.__gp145Obs.disconnect();
        const box = document.querySelector("#log .room-thread");
        if (!box) return;
        window.__gp145Obs = new MutationObserver((muts) => {
          for (const mu of muts) {
            for (const n of mu.addedNodes) {
              if (n && n.classList && n.classList.contains("room-working")) window.__gp145WorkingAdded += 1;
            }
          }
        });
        window.__gp145Obs.observe(box, { childList: true, subtree: true });
      });
      const before11 = reportsOf(roomId).length;
      await sendText(task3);
      await win.waitForFunction(
        () => document.querySelectorAll("#log .msg.room-deduped").length >= 1, null, { timeout: 25000 }).catch(() => {});
      const seen11 = await win.evaluate(() => ({
        workingAdded: typeof window.__gp145WorkingAdded === "number" ? window.__gp145WorkingAdded : -1,
        notes: Array.from(document.querySelectorAll("#log .msg.room-deduped .body")).map((e) => e.innerText || ""),
        reports: document.querySelectorAll("#log .msg.room-report").length,
      }));
      const after11 = reportsOf(roomId).length;
      seen11.workingAdded === 0 && after11 === before11
        ? ok("同任务重发：不闪「工作中」卡、不新增汇报（运行态与真相同步）")
        : bad("dedupe through composer", JSON.stringify({ seen11, before11, after11 }));
      /已经汇报过/.test(seen11.notes.join("|"))
        ? ok("幂等说明卡在整表重绘后仍在（拒绝/说明卡不能一闪就没）")
        : bad("outcome card swallowed by re-render", JSON.stringify(seen11).slice(0, 300));
      await win.screenshot({ path: path.join(SHOT_DIR, "gp145-7-room-deduped.png") });
    }

    /* ---------- S12: 点名不在群里的人 —— 不假装定向成功 ---------- */
    {
      const ghostTask = "@GhostNotInRoom 请说明你的职责";
      const before12 = reportsOf(roomId).length;
      await sendText(ghostTask);
      await waitForReportCount(roomId, before12 + 1);
      const users = rowsOf(roomId, "user");
      const last = users[users.length - 1] || {};
      const note12 = await win.evaluate(() => {
        const els = Array.from(document.querySelectorAll("#log .room-mention-note"));
        return els.length ? (els[els.length - 1].innerText || "") : "";
      });
      Array.isArray(last.unknown_mentions) && last.unknown_mentions[0] === "GhostNotInRoom" &&
        last.responder_policy === "bot_discretion"
        ? ok("Host 记下未命中的点名并按「未点名」处理（不伪造定向给谁）")
        : bad("unknown mention durable", JSON.stringify({ u: last.unknown_mentions, p: last.responder_policy }));
      /GhostNotInRoom/.test(note12) && /不在本群成员里/.test(note12)
        ? ok("界面把「点名未命中」如实告诉用户（不静默改成全员应答）")
        : bad("unknown mention notice", JSON.stringify(note12).slice(0, 300));
      await win.screenshot({ path: path.join(SHOT_DIR, "gp145-8-unknown-mention.png") });
    }

    /* ---------- S13: 读不到群记录时，不能说「还没有消息」 ---------- */
    {
      const backup = fs.readFileSync(ROOMS);
      // 崩溃前的画面就是「用户已看到的历史」。注意 DOM 计数可以高于持久行数：
      // 拒绝/幂等说明卡（room-error / room-deduped）本来就只活在会话面里，
      // 所以恢复合同要和「崩溃前的画面」比，而不是和 rooms.json 比。
      const beforeDom = await win.evaluate(DOM_COUNTS);
      // 坏 JSON：Host 现在如实报 ok:false（loadRooms 的静默空回落只留给旧调用点）。
      // 空态与读取失败必须区分开，否则一次存储故障在用户眼里就成了「我们的历史没了」。
      fs.writeFileSync(ROOMS, String(backup).slice(0, Math.floor(backup.length / 2)) + "\n{\"broken\"", { encoding: "utf8" });
      await win.evaluate(() => refreshSidebarRooms());
      await new Promise((r) => setTimeout(r, 500));
      const readFail = await win.evaluate(() => ({
        text: (document.querySelector("#log .room-thread") || {}).innerText || "",
        msgs: document.querySelectorAll("#log .msg").length,
      }));
      fs.writeFileSync(ROOMS, backup);
      await win.screenshot({ path: path.join(SHOT_DIR, "gp145-9-store-readfail.png") });
      const durR = {
        user: rowsOf(roomId, "user").length + txOf(roomId).filter((e) => e && !e.kind).length,
        reply: rowsOf(roomId, "bot_reply").length,
        error: rowsOf(roomId, "bot_reply_error").length,
        report: rowsOf(roomId, "final_report").length,
      };
      await win.evaluate(() => refreshSidebarRooms());
      await win.waitForFunction(
        (want) => document.querySelectorAll("#log .msg.room-report").length >= want,
        durR.report, { timeout: 25000 }).catch(() => {});
      const restored = await win.evaluate(DOM_COUNTS);
      await win.screenshot({ path: path.join(SHOT_DIR, "gp145-9-store-recovered.png") });
      /读取|失败/.test(readFail.text) && !/还没有任何消息/.test(readFail.text)
        ? ok("存储读取失败如实报「读不到」，不伪装成空群（旧行不会在崩溃时凭空变没）")
        : bad("read-failure honesty", JSON.stringify(readFail).slice(0, 400));
      const same = ["user", "reply", "error", "report"].every((k) => restored[k] === beforeDom[k]);
      same && restored.reply >= durR.reply && restored.report >= durR.report
        ? ok("崩溃前画面 == 恢复后画面（" + JSON.stringify(beforeDom) + " → 持久 " +
          JSON.stringify({ reply: durR.reply, report: durR.report }) + "，一次存储故障不丢可见历史）")
        : bad("rebuild after store recovery", JSON.stringify({ before: beforeDom, dom: restored, durable: durR }));

      /* 目录侧栏 + 写侧：坏存储既不能说「没有群」，也不能被一次运行覆盖成空目录。 */
      const corrupt2 = String(backup).slice(0, 60) + "\n{\"broken\":true";
      fs.writeFileSync(ROOMS, corrupt2, { encoding: "utf8" });
      const ipcThrew = await win.evaluate(async (task) => {
        try {
          const r = await window.bitbot.rooms.orchestrate({ room_id: "__probe__", text: task });
          return { threw: false, ok: Boolean(r && r.ok), error: (r && r.error) || "" };
        } catch (e) {
          return { threw: true, error: String((e && e.message) || e).slice(0, 120) };
        }
      }, "存储故障探针任务").catch(() => ({ threw: true, error: "evaluate crashed" }));
      await win.evaluate(() => refreshSidebarRooms());
      await new Promise((r) => setTimeout(r, 800));
      const sidebar = await win.evaluate(() => ({
        readfail: (document.querySelector("#room-list .room-list-readfail") || {}).innerText || "",
        items: document.querySelectorAll("#room-list .agent-item[data-room-id]").length,
      }));
      const stillCorrupt = fs.readFileSync(ROOMS, "utf8");
      fs.writeFileSync(ROOMS, backup, { encoding: "utf8" });
      await win.evaluate(() => document.getElementById("room-banner-exit").click());
      await new Promise((r) => setTimeout(r, 300));
      await openRoom();
      await new Promise((r) => setTimeout(r, 700));
      const sidebarBack = await win.evaluate(() =>
        document.querySelectorAll("#room-list .agent-item[data-room-id]").length);
      /读不到|unreadable/.test(sidebar.readfail) && sidebar.items === 0
        ? ok("侧栏把存储故障说成「读不到」，不演成「一个群都没有」")
        : bad("sidebar hid store failure", JSON.stringify(sidebar).slice(0, 300));
      (ipcThrew.threw || ipcThrew.ok === false) && stillCorrupt.includes("broken") &&
        txOf(roomId).filter((e) => e && e.text === "存储故障探针任务").length === 0
        ? ok("坏存储上的运行被拒绝且没落任何行（不覆盖、不假装跑完）")
        : bad("write-side fail closed", JSON.stringify({ ipcThrew, tail: stillCorrupt.slice(-24) }));
      sidebarBack >= 1
        ? ok("恢复后侧栏重新列得出群（" + sidebarBack + " 个），历史不是被重写出来的")
        : bad("sidebar did not recover", String(sidebarBack));
    }

    /* ---------- S14: 群在目录里消失时必须退出，不留空壳会话 ---------- */
    {
      const backup = fs.readFileSync(ROOMS);
      const other = {
        id: "room-ghost-sibling", title: "Ghost Sibling",
        members: [evidence.bot_ids.A, evidence.bot_ids.B], created_at: "s14",
        transcript: [{ kind: "user", room_id: "room-ghost-sibling", speaker: "user", text: "占位", at: "2026-10-23T00:00:00.000Z" }],
      };
      const data = JSON.parse(String(backup));
      data.rooms.push(other);
      fs.writeFileSync(ROOMS, JSON.stringify(data, null, 2), { encoding: "utf8" });
      await openRoom();               // 当前群重新打开（composer 对准它）
      const beforeExit = await win.evaluate(() => ({
        banner: getComputedStyle(document.getElementById("room-banner")).display,
        cards: document.querySelectorAll("#log .msg").length,
      }));
      // 外部把「我正在看的那个群」从目录里删掉（成员掉到 2 人以下被丢弃的等价场景），
      // sibling 群留着：只有真跑完的编排才会广播目录变化，渲染层要据此发现
      // 「我正在看的那个群已经不存在了」。
      const dropped = JSON.parse(String(backup));
      dropped.rooms = (dropped.rooms || []).concat([other]).filter((r) => r && r.id !== roomId);
      fs.writeFileSync(ROOMS, JSON.stringify(dropped, null, 2), { encoding: "utf8" });
      const orch14 = await win.evaluate(async () => {
        // 走一次 sibling 群的真实编排：只有真跑完的编排才会广播目录变化，
        // 渲染层必须据此发现「我正在看的那个群已经不在目录里了」。
        try {
          const r = await window.bitbot.rooms.orchestrate({
            room_id: "room-ghost-sibling", text: "目录变化探针（当前群已被移出）", to: [],
          });
          return { threw: false, ok: Boolean(r && r.ok), error: (r && r.error) || "" };
        } catch (e) { return { threw: true, error: String((e && e.message) || e).slice(0, 160) }; }
      }).catch((e) => ({ threw: true, error: "evaluate crashed " + String((e && e.message) || e).slice(0, 120) }));
      await win.waitForFunction(() =>
        document.getElementById("room-banner").style.display === "none",
        null, { timeout: 45000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      const afterExit = await win.evaluate(() => ({
        banner: getComputedStyle(document.getElementById("room-banner")).display,
        inline: document.getElementById("room-banner").style.display,
        thread: Boolean(document.querySelector("#log .room-thread")),
        ph: (document.querySelector("#composer #text") || {}).placeholder || "",
      }));
      fs.writeFileSync(ROOMS, backup, { encoding: "utf8" });
      beforeExit.banner !== "none" && beforeExit.cards > 0
        ? ok("S14 前置：当前群确实在会话中（banner 可见 + " + beforeExit.cards + " 张卡）")
        : bad("S14 precondition", JSON.stringify(beforeExit));
      afterExit.banner === "none" && afterExit.thread === false && !/群聊/.test(afterExit.ph)
        ? ok("群被移出目录后自动退出（不留空壳会话，占位回到私聊）")
        : bad("phantom room session", JSON.stringify({ orch: orch14, after: afterExit }));
    }

    /* ---------- IPC 面守卫：坏输入如实拒绝，且不留下任何卡片行 ---------- */
    {
      const res = await win.evaluate(async ([rid]) => {
        const a = await window.bitbot.rooms.orchestrate({ room_id: rid, text: "" });
        const b = await window.bitbot.rooms.orchestrate({ room_id: "room-does-not-exist", text: "guard check" });
        return { empty: { ok: !!(a && a.ok), error: (a && a.error) || "" }, ghost: { ok: !!(b && b.ok), error: (b && b.error) || "" } };
      }, [roomId]);
      res.empty.ok === false && res.empty.error === "room_and_text_required"
        ? ok("空任务 → IPC 如实拒绝（room_and_text_required）")
        : bad("empty task guard", JSON.stringify(res.empty));
      res.ghost.ok === false && res.ghost.error === "room_not_found"
        ? ok("不存在的群 → IPC 如实拒绝（room_not_found）")
        : bad("ghost room guard", JSON.stringify(res.ghost));
      const txAfter = txOf(roomId).filter((e) => e && e.text === "guard check").length;
      txAfter === 0 ? ok("被拒绝的协作不写卡片行（不留下假装在跑的痕）") : bad("refused run wrote rows", String(txAfter));
    }

    evidence.transcript = txOf(roomId);
    evidence.finished_at = new Date().toISOString();
  } catch (e) {
    bad("gate crashed", (e && e.stack ? e.stack : String(e)).slice(0, 500));
  } finally {
    if (app) {
      // 外壳关窗是隐藏到托盘，直接 close 会永远等不到退出：走真实 quit 路径。
      try {
        await app.evaluate(({ app: electronApp }) => { electronApp.isQuiting = true; electronApp.quit(); });
        await Promise.race([app.close(), new Promise((_, rej) => setTimeout(() => rej(new Error("close timeout")), 15000))]);
      } catch { try { execSync('pkill -9 -f "electron/dist/electron"', { stdio: "ignore" }); } catch { /* ignore */ } }
    }
    if (stub) { try { stub.kill("SIGKILL"); } catch { /* ignore */ } }
    try { execSync('pkill -9 -f "electron/dist/electron"', { stdio: "ignore" }); } catch { /* ignore */ }
    try { execSync('pkill -9 -f "openai_compat_stub.js"', { stdio: "ignore" }); } catch { /* ignore */ }
    try {
      fs.writeFileSync(path.join(SHOT_DIR, "gp145-rooms-evidence.json"), JSON.stringify(evidence, null, 2));
    } catch { /* ignore */ }
    // 验收跑完恢复运行期文件，不把测试数据留在工作树里
    if (roomsBefore) fs.writeFileSync(ROOMS, roomsBefore); else fs.rmSync(ROOMS, { force: true });
    if (sessionsBefore) fs.writeFileSync(SESSIONS, sessionsBefore); else if (fs.existsSync(SESSIONS)) fs.rmSync(SESSIONS, { force: true });
    if (botsBefore) fs.writeFileSync(path.join(REPO, "data/desktop/bots.json"), botsBefore);
  }
  console.log("\ne2e_desktop_room_orchestration: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=0");
  console.log("evidence: " + path.join(SHOT_DIR, "gp145-1-room-empty.png") + " … gp145-8-unknown-mention.png + gp145-rooms-evidence.json");
  process.exit(FAIL > 0 ? 1 : 0);
})();
