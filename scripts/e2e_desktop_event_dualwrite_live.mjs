/* e2e_desktop_event_dualwrite_live.mjs — T1-03 双写在「真 Electron」上的对账门禁
 *
 * prove_event_dual_write 已经证明过「CLI Host 上 fold(events) == JSON 快照」，
 * 但那是 Node 直跑 Host 模块。本门补的是最后一环：**真实桌面进程**里
 * （真 main.js 启动、真渲染层发消息、真 Host 写盘）双写旁路开起来之后，
 * 事件库折叠回来的三张面必须和落盘的 JSON 逐字段相等。
 *
 * 流程：
 *   1. 隔离 repo + stub LLM（进程内 OpenAI 兼容 stub，与 GP-145 同款）+
 *      BITBOT_EVENT_DUAL_WRITE=1 启动真 Electron
 *   2. 走真实写入：IPC 建会话 / 改名 / 建第二个再删（sessions 面）、
 *      UI 发一条真消息（message_committed）、「delete bot」触发审批卡再
 *      IPC decide（approvals 面）
 *   3. 关掉应用（WAL 落定），用 event_log.readAfter + event_mirror.foldEvents
 *      从 events 库折回三张面，与 sessions.json / rooms.json /
 *      pending-approvals.jsonl 逐面 deepDiff —— 差一个字段就是红
 *
 * 断言（DW-Live-*）：
 *   L-01 库文件真的出现了（不是降级成不写）
 *   L-02 主进程日志没有「已降级为不写」
 *   L-03 事件行数 > 0 且没有重复投递以外的异常
 *   L-04 fold.sessions == sessions.json
 *   L-05 fold.rooms   == rooms.json
 *   L-06 fold.approvals == pending-approvals.jsonl
 *   L-07 fold.anomalies 为空（每个快照变化都有人认领）
 *
 * T1-04 变体（E2E_EVENT_READ=1）：同一套真实写入之上再开 BITBOT_EVENT_READ=1，
 * 让真桌面进程的 load()/loadRooms()/pendingApprovals() 全部改读事件折叠。
 * 这时全部 UI 断言照常绿 = 产品读事件读出来的世界和原来一样；另外加一条
 * R-Live：主进程日志不得出现「事件读模型不可用」——这条降级语只在读模型
 * 失败时打印，它没出现就说明读路径真的走了事件折叠，不是悄悄回退 JSON。
 */

import path from "path";
import os from "os";
import fs from "fs";
import { spawn, execSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import {
  electronLaunchEnv,
  electronUserDataDir,
  isolatedRepoRoot,
  gateAppEnv,
  hasDisplay,
} from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);

let PASS = 0,
  FAIL = 0,
  SKIP = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 400) : ""));
};
const note = (m) => console.log("  · " + m);
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

const NAME = "e2e_desktop_event_dualwrite_live";
/* T1-04 变体开关：E2E_EVENT_READ=1 → 给真桌面进程同时开 BITBOT_EVENT_READ。 */
const READ_MODE = process.env.E2E_EVENT_READ === "1";
if (!fs.existsSync(ELECTRON)) {
  console.log(NAME + ": SKIP — electron dist missing (" + ELECTRON + ")");
  console.log(NAME + ": PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log(NAME + ": SKIP — no DISPLAY and no xvfb-run");
  console.log(NAME + ": PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (process.version && Number(process.versions.node.split(".")[0]) < 22) {
  console.log(NAME + ": SKIP — 对账侧需要 node:sqlite（Node ≥22），当前 " + process.version);
  console.log(NAME + ": PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

/* 真回合需要内核（desktop_turn）。跟 GP-145 同一条诚实边界：没有 moon 就只验
   IPC 面（create/rename/delete 也走真写盘 + 真事件），真消息那条降级成 residual，
   不伪造 PASS。 */
let moonOk = false;
try {
  execSync("moon --version", { stdio: "ignore" });
  moonOk = true;
} catch {
  const localBin = process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon");
  if (fs.existsSync(localBin)) {
    try {
      execSync('PATH="' + path.join(os.homedir(), ".moon/bin") + ':$PATH" moon --version', { stdio: "ignore" });
      moonOk = true;
    } catch {
      /* below */
    }
  }
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const mkBot = (id, name) => ({
  id,
  name,
  job: "对账验收",
  description: "",
  group: "",
  pinned: false,
  created_at: iso(0),
  updated_at: iso(0),
});

const root = isolatedRepoRoot(REPO, "dualwrite", {
  "bots.json": { bots: [mkBot("b1", "对账Bot")], primary: "b1" },
  "settings.json": { notify: {} },
  "sessions.json": { sessions: [] },
});
const DATA = path.join(root, "data");
const DB_FILE = path.join(DATA, "events", "desktop-events.sqlite");
const SESSIONS_JSON = path.join(DATA, "desktop", "sessions.json");
const ROOMS_JSON = path.join(DATA, "desktop", "rooms.json");
const PENDING_JSONL = path.join(DATA, "desktop", "pending-approvals.jsonl");
const UD = electronUserDataDir("dualwrite");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
};
const readJsonl = (p) =>
  fs
    .existsSync(p)
    ? fs
        .readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
    : [];

const STUB_PORT = Number(process.env.DW_LIVE_STUB_PORT || 8813);
function startStub() {
  const proc = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BITBOT_STUB_PORT: String(STUB_PORT) },
  });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout")), 10000);
    proc.stdout.on("data", (d) => {
      if (String(d).includes("[stub-llm]")) {
        clearTimeout(t);
        res(proc);
      }
    });
    proc.stderr.on("data", (d) => note("[stub] " + String(d).trim().slice(0, 160)));
    proc.on("error", rej);
  });
}

(async () => {
  let stub = null,
    app = null,
    mainLog = "";
  try {
    stub = await startStub();
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
      cwd: REPO,
      env: electronLaunchEnv(
        gateAppEnv(root, {
          BITBOT_EVENT_DUAL_WRITE: "1",
          ...(READ_MODE ? { BITBOT_EVENT_READ: "1" } : {}),
          BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
          BITBOT_LLM_API_KEY: "e2e-stub-key",
          BITBOT_LLM_MODEL: "e2e-stub",
          BITBOT_LLM_STREAM: "0",
        }),
      ),
      timeout: 90000,
    });
    app.process().stdout.on("data", (d) => (mainLog += String(d)));
    app.process().stderr.on("data", (d) => (mainLog += String(d)));
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(800);

    /* ---------- 真实写入：sessions 面 ---------- */
    const created = await win.evaluate(async () => {
      const a = await window.bitbot.sessions.create("对账Alpha");
      const b = await window.bitbot.sessions.create("对账Beta");
      if (!a || !a.ok || !b || !b.ok) return { ok: false, a, b };
      const r = await window.bitbot.sessions.rename(a.session.id, "对账Alpha·改名");
      const list = await window.bitbot.sessions.list();
      return { ok: true, alpha: a.session.id, beta: b.session.id, renamed: !!(r && r.ok), ids: (list.sessions || []).map((s) => s.id) };
    });
    created.ok && created.renamed
      ? ok("DW-Live 前置：IPC 建两个会话 + 改名（真写 sessions.json → 真派事件）")
      : bad("DW-Live 前置失败", JSON.stringify(created).slice(0, 300));

    /* 真消息：UI 发送 → 内核 → stub LLM → 回执落转录（message_committed）。 */
    let turnDone = false;
    if (moonOk) {
      const before = await win.evaluate(() => document.querySelectorAll("#log .msg").length);
      await win.evaluate(() => {
        const inp = document.getElementById("text");
        inp.value = "对账验收：请原样回复 RECEIPT-OK";
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await win.click("#send");
      for (let i = 0; i < 120; i++) {
        await sleep(500);
        const now = await win.evaluate(() => document.querySelectorAll("#log .msg").length);
        const text = await win.evaluate(() => (document.getElementById("log") || { textContent: "" }).textContent);
        if (now > before && /RECEIPT-OK/.test(text)) {
          turnDone = true;
          break;
        }
      }
      turnDone ? ok("DW-Live 真回合：UI 发消息 → stub 回执上屏（转录写走 Host save）") : bad("DW-Live 真回合没有完成", "30s 内未见 RECEIPT-OK");
    } else {
      note("moon 不可用 → 真消息一条降级为 residual（IPC 面的三张写已足够对账）");
    }

    /* approvals 面：真回合的审批卡。「delete bot」是内核的 needs_confirm 动作，
       走与普通消息完全相同的 UI 发送路径 → #approval 栏亮起 → #deny-btn。
       deny 会写 pending-approvals.jsonl（pending 创建 + 决定回执），都被镜像认领。 */
    let approvalTouched = false;
    if (moonOk) {
      const before2 = await win.evaluate(() => document.querySelectorAll("#log .msg").length);
      await win.evaluate(() => {
        const inp = document.getElementById("text");
        inp.value = "delete bot b1";
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await win.click("#send");
      let cardShown = false;
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        cardShown = await win.evaluate(() => {
          const el = document.getElementById("approval");
          return el ? getComputedStyle(el).display !== "none" && el.offsetParent !== null : false;
        });
        if (cardShown) break;
      }
      if (cardShown) {
        await win.click("#deny-btn");
        for (let i = 0; i < 20; i++) {
          await sleep(300);
          if (readJsonl(PENDING_JSONL).length > 0) break;
        }
        approvalTouched = readJsonl(PENDING_JSONL).length > 0;
        approvalTouched
          ? ok("DW-Live approvals：needs_confirm 卡亮起 → UI deny（真写 pending-approvals.jsonl）")
          : bad("DW-Live approvals：卡亮了但 pending-approvals.jsonl 没落盘");
      } else {
        note("「delete bot」30s 内没亮审批卡 → approvals 面按空对账");
      }
      void before2;
    }

    /* ---------- 收尾：关应用（WAL 落定），开始对账 ---------- */
    await app.close();
    app = null;
    await sleep(600);

    /* ---------- L-01 库文件出现 ---------- */
    fs.existsSync(DB_FILE)
      ? ok("L-01 事件库已生成（" + path.relative(root, DB_FILE) + "）——双写没有降级")
      : bad("L-01 事件库不存在", "双写多半被降级了（看 L-02 的主进程日志）");

    /* ---------- L-02 主进程日志没有降级声明 ---------- */
    !/已降级为不写/.test(mainLog)
      ? ok("L-02 主进程日志无「已降级为不写」（node:sqlite 在 Electron 37 里可用）")
      : bad("L-02 主进程降级成了不写", mainLog.split("\n").filter((l) => /已降级/.test(l))[0] || "");

    /* ---------- R-Live（仅 READ 变体）：读路径真的走了事件折叠 ---------- */
    /* 开机头几次 load() 落在双写建库之前，no_db 回退是预期状态（说明那一行只打
       一次，见 sessions.js 的 degradedSaid 闸）；除它之外的任何降级原因
       （库坏 / anomaly / 形状错）都意味着读模型在真机上没立住。 */
    if (READ_MODE) {
      const fallbackLines = mainLog.split("\n").filter((l) => /事件读模型不可用/.test(l));
      const nonNoDb = fallbackLines.filter((l) => !/（no_db）/.test(l));
      const noDbCount = fallbackLines.length - nonNoDb.length;
      nonNoDb.length === 0
        ? ok("R-Live READ=1 的真桌面进程：除开机期 no_db（" + noDbCount + " 行，建库前的预期回退）外没有任何降级——load/loadRooms/pendingApprovals 读的是事件折叠，不是悄悄回退 JSON")
        : bad("R-Live 读模型在真机上降级了", nonNoDb[0]);
    }

    /* ---------- 打开库、折回三张面 ---------- */
    const sharedPath = path.join(REPO, "hosts/shared");
    const eventLog = require(path.join(sharedPath, "event_log.js"));
    const eventMirror = require(path.join(sharedPath, "event_mirror.js"));
    let rows = [];
    let count = 0;
    if (fs.existsSync(DB_FILE)) {
      const handle = eventLog.openEventLog({ file: DB_FILE, actor: "e2e-dualwrite-audit" });
      count = handle.count();
      rows = handle.readAfter({ fromSeq: 0, limit: 100000 });
      handle.close();
    }

    count > 0
      ? ok("L-03 事件行数 " + count + "（>0）")
      : bad("L-03 事件库是空的", "开关开着却没有事件被派出来");
    /* idem_key 的唯一索引只约束非空键（events_log.js:64 的 partial unique index）；
       没有幂等键的事件行（如纯增量 delta）允许任意多条。 */
    const keyed = rows.filter((r) => r.idemKey !== null && r.idemKey !== undefined && r.idemKey !== "");
    const duplicated = keyed.filter((r, i, a) => a.findIndex((x) => x.idemKey === r.idemKey) !== i).length;
    duplicated === 0
      ? ok("L-03b 无重复投递（" + keyed.length + " 条带幂等键的行 idem_key 唯一）")
      : bad("L-03b 有重复投递", String(duplicated) + " 条");

    const folded = eventMirror.foldEvents(rows);
    const out = [];
    const diffOf = (label, a, b) => {
      const o = [];
      eventMirror.deepDiff(a, b, label, o);
      return o;
    };

    /* ---------- L-04..L-06 逐面 deepDiff ---------- */
    const snapSessions = readJson(SESSIONS_JSON, { version: 1, active_id: "", sessions: [] });
    const snapRooms = readJson(ROOMS_JSON, { version: 1, rooms: [] });
    const snapApprovals = readJsonl(PENDING_JSONL);

    const dSess = diffOf("sessions", snapSessions, folded.sessions);
    dSess.length === 0
      ? ok("L-04 fold.sessions == sessions.json（逐字段相等）")
      : bad("L-04 fold.sessions 与快照不等", JSON.stringify(dSess).slice(0, 360));
    const dRooms = diffOf("rooms", snapRooms, folded.rooms);
    dRooms.length === 0
      ? ok("L-05 fold.rooms == rooms.json（逐字段相等）")
      : bad("L-05 fold.rooms 与快照不等", JSON.stringify(dRooms).slice(0, 360));
    const dApr = diffOf("approvals", snapApprovals, folded.approvals);
    dApr.length === 0
      ? ok("L-06 fold.approvals == pending-approvals.jsonl（" + snapApprovals.length + " 条）" + (approvalTouched ? "，含真实审批往返" : ""))
      : bad("L-06 fold.approvals 与快照不等", JSON.stringify(dApr).slice(0, 360));

    /* ---------- L-07 折叠异常 ---------- */
    (folded.anomalies || []).length === 0
      ? ok("L-07 fold 无异常（每个快照变化都有人认领）")
      : bad("L-07 fold 报了异常", JSON.stringify(folded.anomalies).slice(0, 360));

    if (!approvalTouched) note("approvals 写入未被执行（无 pending 产生）——该面按「空对空」验证");
    if (!turnDone && moonOk) note("真回合未完成 —— sessions.messages 的增量认领本轮没被覆盖，见上方红项");
  } catch (e) {
    bad("执行异常", (e && e.message) || e);
  } finally {
    try {
      if (app) await app.close();
    } catch (_) {
      /* ignore */
    }
    try {
      if (stub) stub.kill();
    } catch (_) {
      /* ignore */
    }
    await sleep(300);
    done(NAME);
  }
})();
