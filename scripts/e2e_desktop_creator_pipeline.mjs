/* e2e_desktop_creator_pipeline.mjs — GP-155 场景验收：自媒体博主的日更流水线
 *
 * 用户给的原话场景：「我是自媒体博主，我要多个 Bot 做不同的事——热点新闻搜集、
 * 内容编辑、稿件审核；审核通过之后每天定时发文，并且每天定时把内容推送到我的邮箱。」
 *
 * 这一条不测组件、不测函数，只测**用户在真实 Electron 里能不能走通**：
 *
 *   P1 产品 IPC 建 3 个分工 Bot（搜集 / 编辑 / 审核）+ 1 个 3 人群。
 *   P2 群里 @三人布置任务 → 真内核 + 本地 stub provider 跑完 → 群里有成稿回执。
 *   P3 群资料面板：成员 3 行 + 「最多 6 位成员」如实提示 + 「暂无定时任务」空态。
 *   P4 在面板里用中文加「每天早上9点把审核通过的稿子发到 news@example.com」：
 *      必须真的落 store（cron=0 9 * * *、room_id=本群），且 next_due 的**墙钟**
 *      就是 09:00（按 Bot 时区，TZ=Asia/Shanghai）；面板同一条显示 09:00。
 *   P5 「每2分钟…」必须被如实拒绝（GP-138 继承）：不入 store、留 refuse 证据。
 *   P6 到期触发：把 next_due 推到过去再 tick —— 只准备好草稿并挂待批准，
 *      data/mail/sends/ 必须一个文件都不新增（不假装已发，GP-108）。
 *   P7 批准之后才真发：待批准里出现「定时任务」来源的 mail_send，
 *      批准后 data/mail/sends/send-*.json 真出现，内容带收件人和稿件正文。
 *   P8 卫生：本轮新落的行里没有内核/Host 调试串。
 *   P9 面板的「暂停 / 继续」真能按（GP-158）：点一下 store 里 enabled 翻下去、
 *      面板显示「已暂停」、而且 cron 一个字符都不许变；再点回来必须重新排上
 *      下一次（按了继续却永远不再跑，等于开关是装饰）。
 *   P10 面板的「删除」两下才删（GP-161）：第一下只武装成「确认删除」且 store 不动，
 *      超过确认窗口自己退回；两下之后行真的消失、面板回到空态、留底工件带齐
 *      cron/原话/归属群，而这条任务的历史草稿一份不少（删任务 ≠ 毁档案）。
 *      结果话术必须落在常驻的 #ri-rail-status 上——表单收起时 ri-form-msg 是隐藏的。
 *
 * 缺 electron / xvfb / moon 时诚实 SKIP（exit 0 + SKIP 计数），不伪造 PASS。
 * 用法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_creator_pipeline.mjs
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const D = (...p) => path.join(REPO, "data", ...p);
const ROOMS = D("desktop/rooms.json");
const SESSIONS = D("desktop/sessions.json");
const BOTS = D("desktop/bots.json");
const ROUTINES = D("routines/host-routines.json");
const ROUTINE_DIR = D("routines");
const DRAFT_DIR = D("routines/drafts");
const SEND_DIR = D("mail/sends");
const TZ = process.env.GP155_TZ || "Asia/Shanghai";
const MAIL_TO = "news@example.com";

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d === undefined || d === null ? "" : " — " + String(d).slice(0, 400)));
};
function honestSkip(reason) {
  console.log("e2e_desktop_creator_pipeline: SKIP — " + reason);
  console.log("e2e_desktop_creator_pipeline: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!fs.existsSync(ELECTRON)) honestSkip("electron dist missing (" + ELECTRON + ")");
try { execSync("command -v xvfb-run", { stdio: "ignore" }); }
catch { if (!process.env.DISPLAY) honestSkip("no DISPLAY and no xvfb-run"); }
let moonOk = false;
try { execSync("moon --version", { stdio: "ignore" }); moonOk = true; }
catch {
  const local = path.join(os.homedir(), ".moon/bin/moon");
  if (fs.existsSync(local)) {
    try { execSync('PATH="' + path.dirname(local) + ':$PATH" moon --version', { stdio: "ignore" }); moonOk = true; }
    catch { /* below */ }
  }
}
if (!moonOk) honestSkip("moon toolchain unavailable → 真回合无法验证（诚实 residual，不伪造 PASS）");

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const STUB_PORT = Number(process.env.GP155_STUB_PORT || 8803);
const NEWS = { name: "GP155News", job: "热点新闻搜集", desc: "只负责搜集当天热点，给出来源清单" };
const EDIT = { name: "GP155Editor", job: "内容编辑", desc: "把选题写成成稿，控制字数和小标题" };
const REVW = { name: "GP155Review", job: "稿件审核", desc: "检查事实与合规，给出通过/打回结论" };
const ROOM_TITLE = "GP155 日更流水线";
const ROUTINE_TEXT = `每天早上9点把审核通过的稿子发到 ${MAIL_TO}`;
const FORBIDDEN = ["已计划", "Host 效果", "BITBOT_LLM_", "LocalBrain", "收到，正在用 MoonBit"];

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
};
const roomRow = (id) => (readJson(ROOMS, { rooms: [] }).rooms || []).find((r) => r && r.id === id) || null;
const routineRows = () => {
  const j = readJson(ROUTINES, []);
  return Array.isArray(j) ? j : j.routines || [];
};
const listFiles = (dir, ext) => {
  try { return fs.readdirSync(dir).filter((f) => !ext || f.endsWith(ext)); } catch { return []; }
};
/** 用 IANA 时区把 ISO 时刻拆成本地墙钟（不引第三方库）。 */
function wallClock(iso, tz) {
  const p = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(iso))) p[part.type] = part.value;
  return { hour: Number(p.hour === "24" ? "0" : p.hour), minute: Number(p.minute), day: Number(p.day), month: Number(p.month) };
}

function startStub() {
  const { spawn } = require("child_process");
  const proc = spawn(
    process.execPath,
    [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")],
    {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BITBOT_STUB_PORT: String(STUB_PORT),
        BITBOT_STUB_ECHO_ALL: "1",
        BITBOT_STUB_ECHO_WIDTH: "1600",
      },
    },
  );
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout")), 10000);
    proc.stdout.on("data", (d) => { if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(proc); } });
    proc.stderr.on("data", (d) => console.log("[stub] " + String(d).trim().slice(0, 200)));
    proc.on("error", rej);
  });
}

(async () => {
  console.log("e2e_desktop_creator_pipeline — 自媒体日更真链（GP-155）");
  /* ---- 夹具清场 + 快照（只清自己前缀；运行期新落的文件按名单回收） ---- */
  const sweep = () => {
    let swept = { bots: 0, rooms: 0 };
    try {
      const bs = readJson(BOTS, { bots: [] });
      const keep = (bs.bots || []).filter((b) => !(b && /^GP155/.test(String(b.name || ""))));
      swept.bots = (bs.bots || []).length - keep.length;
      if (swept.bots) { bs.bots = keep; fs.writeFileSync(BOTS, JSON.stringify(bs, null, 2)); }
    } catch { /* 首次运行没有 bots.json */ }
    try {
      const rs = readJson(ROOMS, { rooms: [] });
      const keep = (rs.rooms || []).filter((r) => !(r && String(r.title || "").startsWith(ROOM_TITLE)));
      swept.rooms = (rs.rooms || []).length - keep.length;
      if (swept.rooms) { rs.rooms = keep; fs.writeFileSync(ROOMS, JSON.stringify(rs, null, 2)); }
    } catch { /* 首次运行没有 rooms.json */ }
    return swept;
  };
  const swept = sweep();
  if (swept.bots || swept.rooms) console.log("  · 清掉上一轮遗留夹具：" + JSON.stringify(swept));
  const snap = {
    rooms: fs.existsSync(ROOMS) ? fs.readFileSync(ROOMS) : null,
    sessions: fs.existsSync(SESSIONS) ? fs.readFileSync(SESSIONS) : null,
    bots: fs.existsSync(BOTS) ? fs.readFileSync(BOTS) : null,
    routines: fs.existsSync(ROUTINES) ? fs.readFileSync(ROUTINES) : null,
    routineFiles: new Set(listFiles(ROUTINE_DIR, ".json")),
    draftFiles: new Set(listFiles(DRAFT_DIR, ".json")),
    sendFiles: new Set(listFiles(SEND_DIR, ".json")),
  };
  const restore = () => {
    // 只回收本轮新增的文件，旧的一律不碰（历史行不重写、用户数据不清理）。
    for (const [dir, before] of [[DRAFT_DIR, snap.draftFiles], [SEND_DIR, snap.sendFiles]]) {
      for (const f of listFiles(dir, ".json")) {
        if (!before.has(f)) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* keep */ } }
      }
    }
    for (const f of listFiles(ROUTINE_DIR, ".json")) {
      if (!snap.routineFiles.has(f) && /^(fire-|refuse-)/i.test(f)) {
        try { fs.rmSync(path.join(ROUTINE_DIR, f), { force: true }); } catch { /* keep */ }
      }
    }
    const put = (p, buf) => { buf === null ? fs.rmSync(p, { force: true }) : fs.writeFileSync(p, buf); };
    put(ROOMS, snap.rooms); put(SESSIONS, snap.sessions); put(BOTS, snap.bots); put(ROUTINES, snap.routines);
  };

  let stub = null, app = null;
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
        // 排程必须按可验证的时区算，不能跟着沙箱的 UTC 漂走。
        TZ,
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
    ok("真 Electron 冷启动（main + preload + index.html）就绪，Bot 时区 " + TZ);

    /* ---------- P1: 三个分工 Bot + 一个群 ---------- */
    const seeded = await win.evaluate(async ([a, b, c, title]) => {
      const enc = (s) => String(s || "").replace(/ +/g, "+");
      const encTitle = (s) => String(s || "").replace(/\+/g, "%2B").replace(/\s+/g, "+").trim();
      const mk = async (o) => {
        const r = await window.bitbot.bots.op({
          phrase: "create bot " + enc(o.name) + " job=" + enc(o.job) + " description=" + enc(o.desc),
        });
        const bot = (r && r.host_payload && r.host_payload.bot) || null;
        return { ok: !!(r && r.ok) && !!bot, id: bot ? bot.id : "", job: bot ? bot.job : "", err: (r && r.error) || "" };
      };
      const ba = await mk(a), bb = await mk(b), bc = await mk(c);
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
    }, [NEWS, EDIT, REVW, ROOM_TITLE]).catch((e) => ({ crashed: String((e && e.message) || e) }));
    if (!seeded || seeded.crashed) { bad("seed crashed", seeded && seeded.crashed); throw new Error("abort"); }
    const jobs = [seeded.ba, seeded.bb, seeded.bc].map((x) => x.job);
    seeded.ba.ok && seeded.bb.ok && seeded.bc.ok &&
      new Set([seeded.ba.id, seeded.bb.id, seeded.bc.id]).size === 3 &&
      jobs.join("|").includes("搜集") && jobs.join("|").includes("编辑") && jobs.join("|").includes("审核")
      ? ok("P1 三个分工 Bot 建好（搜集 / 编辑 / 审核：" + jobs.join(" · ") + "）")
      : bad("P1 bots.op create", JSON.stringify(seeded).slice(0, 400));
    const roomId = seeded.room.id || "";
    if (!roomId) { bad("P1 建群失败", JSON.stringify(seeded.room)); throw new Error("no room — abort"); }
    ok("P1 群建成，成员 " + seeded.room.members + "（" + roomId + "）");

    /* ---------- P2: 群里 @三人布置任务 → 有成稿回执 ---------- */
    await win.evaluate(() => refreshSidebarRooms());
    await win.waitForSelector('#room-list .agent-item[data-room-id="' + roomId + '"]', { timeout: 30000 });
    await win.click('#room-list .agent-item[data-room-id="' + roomId + '"]');
    await win.waitForFunction(() => {
      const b = document.getElementById("room-banner");
      return b && b.style.display !== "none";
    }, null, { timeout: 30000 });
    const ids = [seeded.ba.id, seeded.bb.id, seeded.bc.id];
    const reportsBefore = ((roomRow(roomId) || {}).transcript || []).filter((e) => e && e.kind === "final_report").length;
    const orch = await win.evaluate(async ([rid, botIds]) => {
      const at = botIds.map((i) => "@" + i).join(" ");
      const r = await window.bitbot.rooms.orchestrate({
        room_id: rid,
        text: at + " 先搜集今天最热的两条 AI 新闻，编成 300 字稿件，最后由审核给出通过或打回。",
      });
      return { ok: Boolean(r && r.ok), error: (r && r.error) || "" };
    }, [roomId, ids]).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    const gotReport = await win.waitForFunction(
      (want) => document.querySelectorAll("#log .msg.room-report").length > want,
      reportsBefore, { timeout: 180000 }).then(() => true).catch(() => false);
    gotReport && orch.ok
      ? ok("P2 一次布置、三个 Bot 分工跑完并出成稿回执（群转录有 final_report）")
      : bad("P2 群协作未跑通", JSON.stringify({ orch, gotReport }));

    /* ---------- P3: 群资料面板（成员 / 上限 / 定时任务空态） ---------- */
    await win.click("#room-banner-info");
    await win.waitForFunction(() => document.body.dataset.panel === "room", null, { timeout: 15000 });
    const rail = await win.evaluate(() => ({
      members: document.querySelectorAll("#ri-member-list .ri-member").length,
      limit: (document.getElementById("ri-limit-note") || {}).innerText || "",
      empty: (document.getElementById("ri-routine-list") || {}).innerText || "",
      addVisible: !!document.getElementById("ri-routine-add") &&
        document.getElementById("ri-routine-add").offsetWidth > 0,
    }));
    rail.members === 3 && /6/.test(rail.limit) && /暂无|沒有|没有/.test(rail.empty) && rail.addVisible
      ? ok("P3 群资料显示 3 位成员 + 「最多 6 位」如实上限 + 「暂无定时任务」空态 + 添加入口")
      : bad("P3 群资料面板", JSON.stringify(rail).slice(0, 300));

    /* ---------- P4: 中文排程原话 → 落 store + 墙钟 09:00 + 面板同步 ---------- */
    await win.click("#ri-routine-add");
    await win.waitForFunction(() => document.body.dataset.roomForm === "open", null, { timeout: 10000 });
    await win.fill("#ri-text", ROUTINE_TEXT);
    await win.click("#ri-form-save");
    await win.waitForFunction(() => document.querySelectorAll("#ri-routine-list .ri-item").length > 0,
      null, { timeout: 60000 }).catch(() => {});
    const rows4 = routineRows().filter((r) => r && String(r.room_id || "") === roomId);
    const routine = rows4[0] || null;
    const wc = routine && routine.next_due ? wallClock(routine.next_due, TZ) : null;
    routine && routine.cron === "0 9 * * *" && wc && wc.hour === 9 && wc.minute === 0
      ? ok("P4 「每天早上9点…」建成 cron=" + routine.cron +
        "，next_due 墙钟 " + String(wc.hour).padStart(2, "0") + ":" + String(wc.minute).padStart(2, "0") +
        "（" + TZ + "），room_id 跟着本群")
      : bad("P4 中文排程没落成 09:00", JSON.stringify({ rows: rows4.map((r) => ({ cron: r.cron, next_due: r.next_due, room_id: r.room_id, err: r.schedule_error })) }).slice(0, 500));
    const panelText4 = await win.evaluate(() => ({
      items: document.querySelectorAll("#ri-routine-list .ri-item").length,
      text: (document.getElementById("ri-routine-list") || {}).innerText || "",
      form: (document.getElementById("ri-form-msg") || {}).innerText || "",
    }));
    panelText4.items >= 1 && /09:00/.test(panelText4.text)
      ? ok("P4 面板同条任务显示下次触发 09:00（用户看得见排程，而不是只看到「已创建」）")
      : bad("P4 面板未显示 09:00", JSON.stringify(panelText4).slice(0, 400));
    const routineId = routine ? String(routine.id) : "";

    /* ---------- P5: 过密排程如实拒绝，且不入库（走 UI，和用户点的一模一样） ---------- */
    const rowsBefore5 = routineRows().length;
    await win.evaluate(() => setRoomFormOpen(true)).catch(() => {});
    await win.fill("#ri-text", "每2分钟把稿件提醒我一次");
    await win.click("#ri-form-save");
    await win.waitForFunction(() => {
      const el = document.getElementById("ri-form-msg");
      const s = String((el && el.innerText) || "").trim();
      // 「正在安排…」是进行中的占位，不能拿它当结果：等到终局文案为止。
      return s.length > 0 && !/正在安排|处理中|…$|\.\.\.$/.test(s);
    }, null, { timeout: 40000 }).catch(() => {});
    const refused5 = await win.evaluate(() => ({
      msg: (document.getElementById("ri-form-msg") || {}).innerText || "",
      items: document.querySelectorAll("#ri-routine-list .ri-item").length,
    }));
    const refuseFiles = listFiles(ROUTINE_DIR, ".json").filter((f) => /^refuse-/i.test(f));
    rowsBefore5 === routineRows().length && refused5.items === 1 &&
      /太密|至少|5 分钟|五分钟|间隔/.test(refused5.msg)
      ? ok("P5 「每2分钟…」被如实拒绝并且说清了原因：" + refused5.msg.slice(0, 60).replace(/\n/g, " ") +
        "（未入库，拒绝证据 " + refuseFiles.length + " 份）")
      : bad("P5 过密排程本该被拒且讲清原因", JSON.stringify({ refused5, before: rowsBefore5, now: routineRows().length }).slice(0, 400));

    /* ---------- P6: 到期触发只备草稿 + 挂待批准，绝不自动发 ---------- */
    if (!routineId) { bad("P6 无定时任务可触发", "P4 未落盘"); }
    else {
      const rj = readJson(ROUTINES, []);
      const arr = Array.isArray(rj) ? rj : rj.routines || [];
      const hit = arr.find((r) => r && r.id === routineId);
      if (hit) {
        hit.next_due = new Date(Date.now() - 60000).toISOString();
        fs.writeFileSync(ROUTINES, JSON.stringify(Array.isArray(rj) ? arr : rj, null, 2));
      }
      const sendsBefore = new Set(listFiles(SEND_DIR, ".json"));
      const draftsBefore = new Set(listFiles(DRAFT_DIR, ".json"));
      const ticked = await win.evaluate(async () => {
        const r = await window.bitbot.turn("tick routines", {});
        return { ok: Boolean(r && r.ok), error: (r && r.error) || "" };
      }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
      await new Promise((r) => setTimeout(r, 3000));
      // 只看本群这条任务的草稿（store 里可能还有别的测试遗留行，别把它们算进来）。
      const newDrafts = listFiles(DRAFT_DIR, ".json").filter(
        (f) => !draftsBefore.has(f) && f.startsWith("routine-" + routineId + "-"),
      );
      const newSends = listFiles(SEND_DIR, ".json").filter((f) => !sendsBefore.has(f));
      const pending = await win.evaluate(() => window.bitbot.approvals.listPending());
      const mine = ((pending && pending.pending) || []).filter((it) => {
        if (!it || it.kind !== "mail_send" || it.status !== "pending") return false;
        if (!String(it.command || "").includes(MAIL_TO)) return false;
        return Number(Date.parse(it.requested_at || "")) >= Date.now() - 120000;
      });
      const draftRow = newDrafts.length ? readJson(path.join(DRAFT_DIR, newDrafts[0]), {}) : {};
      newDrafts.length >= 1 && draftRow.requires_approval === true && newSends.length === 0
        ? ok("P6 到期只备好草稿（requires_approval=true），未批准前 0 封外发（GP-108 守住）")
        : bad("P6 到期触发行为不符", JSON.stringify({ ticked, newDrafts, draftRow, newSends }).slice(0, 500));
      mine.length >= 1
        ? ok("P6 定时触发进了待批准队列（用户点得到，而不是只在磁盘上留个文件）")
        : bad("P6 到期只落草稿文件，没有任何待批准入口 —— 走不到「批准后才发」",
          JSON.stringify({ pending: ((pending && pending.pending) || []).slice(-3) }).slice(0, 500));

      /* 队列那一行得是人看得懂的，不是协议串（GP-156 同一条链路的可见面） */
      await win.evaluate(() => refreshApprovalQueue());
      await new Promise((r) => setTimeout(r, 800));
      const queueRow = await win.evaluate(() => {
        const box = document.getElementById("approval-queue");
        return box ? String(box.innerText || "") : "";
      });
      /发送邮件|傳送郵件|Send email/.test(queueRow) && queueRow.includes(MAIL_TO) &&
        !queueRow.includes("mail_send") && !queueRow.includes("gmail|")
        ? ok("P6 审批队列行给人看的是「发送邮件 · 发给 news@example.com」，不是 kind/命令原文")
        : bad("P6 审批队列仍在吐协议串", JSON.stringify(queueRow.slice(0, 180)));

      /* ---------- P7: 批准之后真发，落 data/mail/sends/ ---------- */
      const target = mine[0] || null;
      if (!target) bad("P7 无待批准项可放行", "依赖 P6");
      else {
        await win.evaluate((id) => window.bitbot.approvals.decide(id, "allow_once"), target.id);
        const res = await win.evaluate((it) => window.bitbot.approvals.runAllowed({
          kind: it.kind, command: it.command, bot_id: "agent-bit",
        }), target).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
        const sendsNow = listFiles(SEND_DIR, ".json").filter((f) => !sendsBefore.has(f));
        const sent = sendsNow.length ? readJson(path.join(SEND_DIR, sendsNow[0]), {}) : {};
        const raw = sendsNow.length ? fs.readFileSync(path.join(SEND_DIR, sendsNow[0]), "utf8") : "";
        res && res.ok && sendsNow.length >= 1 && raw.includes(MAIL_TO) && String(sent.to || "").includes(MAIL_TO)
          ? ok("P7 批准后真的发出：data/mail/sends/" + sendsNow[0] + "（收件人 " + MAIL_TO + "）")
          : bad("P7 批准后没有真发", JSON.stringify({ res, sendsNow, sent }).slice(0, 500));
      }

      /* ---------- P8: 卫生 —— 本轮新行不吐调试串 ---------- */
      const tx = (roomRow(roomId) || {}).transcript || [];
      const fresh = tx.slice(-12).map((e) => String((e && (e.text || e.content || e.summary)) || "")).join("\n");
      const dirty = FORBIDDEN.filter((s) => fresh.includes(s));
      dirty.length === 0
        ? ok("P8 群转录尾部 " + Math.min(12, tx.length) + " 行无内核/Host 调试串")
        : bad("P8 转录漏调试串", JSON.stringify(dirty));

      /* ---------- P9: 面板上的「暂停 / 继续」真能按（GP-158） ---------- */
      const toggleSel = "#ri-routine-list .ri-item .ri-toggle";
      const rowNow = () => {
        const rj = readJson(ROUTINES, []);
        const arr = Array.isArray(rj) ? rj : rj.routines || [];
        return arr.find((r) => r && r.id === routineId) || null;
      };
      const snapP9 = rowNow();
      const cronBefore = snapP9 ? String(snapP9.cron) : "";
      await win.waitForSelector(toggleSel, { timeout: 15000 }).catch(() => {});
      const labelBefore = await win.evaluate(
        (sel) => { const b = document.querySelector(sel); return b ? String(b.innerText || "").trim() : ""; },
        toggleSel,
      );
      await win.click(toggleSel).catch(() => {});
      let paused = null;
      for (let i = 0; i < 40 && !(paused && paused.enabled === false); i += 1) {
        paused = rowNow();
        await new Promise((r) => setTimeout(r, 250));
      }
      const panelP9 = await win.evaluate(() => ({
        text: (document.getElementById("ri-routine-list") || {}).innerText || "",
        label: (() => { const b = document.querySelector("#ri-routine-list .ri-item .ri-toggle"); return b ? String(b.innerText || "").trim() : ""; })(),
        msg: (document.getElementById("ri-form-msg") || {}).innerText || "",
      }));
      paused && paused.enabled === false && /已暂停/.test(panelP9.text) && paused.cron === cronBefore
        ? ok("P9 按「" + labelBefore + "」真的停了：store enabled=false、面板显示「已暂停」、cron 仍是 " + paused.cron)
        : bad("P9 面板的暂停按钮没有真的管住这条任务", JSON.stringify({ labelBefore, row: paused && { e: paused.enabled, cron: paused.cron }, panel: panelP9 }).slice(0, 500));
      const labelPaused = panelP9.label;
      await win.click(toggleSel).catch(() => {});
      let resumed = null;
      for (let i = 0; i < 40 && !(resumed && resumed.enabled === true); i += 1) {
        resumed = rowNow();
        await new Promise((r) => setTimeout(r, 250));
      }
      const wcP9 = resumed && resumed.next_due ? wallClock(resumed.next_due, TZ) : null;
      resumed && resumed.enabled === true && resumed.lifecycle === "active" &&
        resumed.cron === cronBefore && resumed.next_due && Date.parse(resumed.next_due) > Date.now()
        ? ok("P9 按「" + labelPaused + "」恢复回 active，并重新排上下一次（" +
          String(wcP9.hour).padStart(2, "0") + ":" + String(wcP9.minute).padStart(2, "0") + " " + TZ + "）")
        : bad("P9 恢复后没有重新可运行", JSON.stringify({ labelPaused, row: resumed && { e: resumed.enabled, l: resumed.lifecycle, n: resumed.next_due, c: resumed.cron } }).slice(0, 500));

      /* ---------- P10: 面板上的「删除」两下才删，且删了不毁历史（GP-161） ---------- */
      const removeSel = "#ri-routine-list .ri-item .ri-remove";
      const draftsNow = () => listFiles(DRAFT_DIR, ".json").filter(
        (f) => f.startsWith("routine-" + routineId + "-") && f.endsWith(".json")).length;
      const removeArts = () => listFiles(ROUTINE_DIR, ".json").filter((f) => /^remove-/.test(f));
      const btnState = () => win.evaluate((sel) => {
        const b = document.querySelector(sel);
        return {
          label: b ? String(b.innerText || "").trim() : "",
          armed: !!b && b.classList.contains("ri-remove-armed"),
          items: document.querySelectorAll("#ri-routine-list .ri-item").length,
          list: (document.getElementById("ri-routine-list") || {}).innerText || "",
          status: (document.getElementById("ri-rail-status") || {}).innerText || "",
        };
      }, removeSel).catch(() => ({ label: "", armed: false, items: -1, list: "", status: "" }));
      await win.waitForSelector(removeSel, { timeout: 15000 }).catch(() => {});
      const artsBeforeR = removeArts().length;
      const draftsBeforeR = draftsNow();
      const st0 = await btnState();
      await win.click(removeSel).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      const st1 = await btnState();
      const rowAfter1 = rowNow();
      const stillRowText = rowAfter1 ? String(rowAfter1.prompt || "") : "";
      st1.armed && rowAfter1 !== null && /确认|確認|Confirm/i.test(st1.label) &&
        !/确认|確認|Confirm/.test(st0.label) && stillRowText.includes(MAIL_TO)
        ? ok("P10 第一下只是武装：按钮「" + st0.label + "」→「" + st1.label + "」，store 里这条还在（单点不删）")
        : bad("P10 单点即删，或武装态没有在界面上显示", JSON.stringify({ st0, st1, row: rowAfter1 && { e: rowAfter1.enabled, c: rowAfter1.cron } }).slice(0, 400));
      /* 武装窗口到期必须自己退回「删除」：不然下次顺手一点就是一条日更没了 */
      await new Promise((r) => setTimeout(r, 4600));
      const st2 = await btnState();
      st2.armed === false && rowNow() !== null && /删除|刪除|Delete/.test(st2.label) &&
        !/确认|確認|Confirm/.test(st2.label)
        ? ok("P10 只点一下、等超过确认窗口：按钮自己退回「" + st2.label + "」，任务原样还在")
        : bad("P10 武装状态没有超时退回（迟早误删一条日更）", JSON.stringify({ st2, row: rowNow() && rowNow().id }).slice(0, 300));
      await win.click(removeSel).catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      await win.click(removeSel).catch(() => {});
      let gone = rowNow();
      for (let i = 0; i < 40 && gone !== null; i += 1) {
        gone = rowNow();
        await new Promise((r) => setTimeout(r, 250));
      }
      const st3 = await btnState();
      const artsAfterR = removeArts();
      const removeMine = artsAfterR.filter((f) => f.startsWith("remove-" + routineId + "-"));
      const art = removeMine.length ? readJson(path.join(ROUTINE_DIR, removeMine[0]), {}) : {};
      gone === null && st3.items === 0 && /暂无|沒有|没有|No scheduled/.test(st3.list)
        ? ok("P10 两下之后真的删掉了：store 里这条没了，面板回到「暂无定时任务」空态（不是隐藏）")
        : bad("P10 确认删除没有真的生效", JSON.stringify({ row: gone && { e: gone.enabled, c: gone.cron }, st3 }).slice(0, 400));
      const draftsAfterR = draftsNow();
      artsAfterR.length === artsBeforeR + 1 && removeMine.length === 1 &&
        art.cron === "0 9 * * *" && String(art.prompt || "").includes(MAIL_TO) &&
        art.room_id === roomId && draftsAfterR === draftsBeforeR && draftsAfterR >= 1
        ? ok("P10 删除留底 " + removeMine[0] + "（cron/prompt/room_id 齐，能照着重建）；这条任务的历史草稿 " +
          draftsAfterR + " 份一份没动（删任务不毁档案）")
        : bad("P10 删除没有留底，或者顺手清了历史", JSON.stringify({
          added: artsAfterR.length - artsBeforeR, removeMine, art: { cron: art.cron, prompt: art.prompt, room_id: art.room_id },
          drafts: [draftsBeforeR, draftsAfterR],
        }).slice(0, 400));
      /已删除|已刪|deleted/i.test(st3.status) && /保留|keep/i.test(st3.status)
        ? ok("P10 面板把结果说给人看了：「" + st3.status.trim().replace(/\s+/g, " ").slice(0, 70) + "」")
        : bad("P10 删除结果只改了数据，界面上没有回执（表单收起时 ri-form-msg 是隐藏的，那不算看得见）",
          JSON.stringify({ status: st3.status }).slice(0, 300));
    }
  } catch (e) {
    bad("gate block", (e && e.stack || String(e)).split("\n").slice(0, 3).join(" | "));
  }
  // 结果先落盘再收尾：关窗卡住也不能让已经跑出来的断言丢掉。
  console.log("e2e_desktop_creator_pipeline: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=0");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    if (app) {
      await Promise.race([app.close().catch(() => {}), sleep(20000)]);
      try { const p = app.process(); if (p) p.kill("SIGKILL"); } catch { /* already gone */ }
    }
  } catch { /* ignore */ }
  try { if (stub) stub.kill("SIGKILL"); } catch { /* ignore */ }
  await sleep(1500);
  try {
    // 本轮挂进队列的待批准项不能留给下一轮：按 source=routine 回收自己那条。
    const pendPath = D("desktop/pending-approvals.jsonl");
    if (fs.existsSync(pendPath)) {
      const kept = fs.readFileSync(pendPath, "utf8").split("\n").filter((l) => {
        if (!l.trim()) return true;
        try { const j = JSON.parse(l); return !(j && j.source === "routine"); } catch { return true; }
      });
      fs.writeFileSync(pendPath, kept.join("\n"));
    }
  } catch { /* 保留现场，不因此判失败 */ }
  restore();
  process.exit(FAIL ? 1 : 0);
})();
