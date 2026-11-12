/* e2e_desktop_optimistic.mjs — KP-08 T3-04 的可感面：回车立刻上屏、落库后 echo 对上、拒绝变红带 KP-03 的码
 *
 * 需求原话（docs/next-target-requirements.md §5.4 T3-04 / KP-08 可感面）：
 *   「输入框回车后**立刻**出现自己那条消息（乐观），落库后 echo_entry_id 对上；
 *    服务端拒绝时那条乐观消息变红并带上 KP-03 的码。」
 *
 * prove_client_core.js（G-120）管的是**判据本身**（台账四态、字段词表、渲染端只剩翻译）。
 * 这一门管的是**接上之后用户看得见什么**，全都跑在真 app 上、真发真落库：
 *   OP-01 回车后那一行**立刻**在（远早于回执），且带着 cm- 身份 + 单勾 + data-send=pending
 *         —— 「立刻」量的是页内同一时钟上「出现 → 进入终态」的间隔，不是对着 stub 的配置常量
 *   OP-01b 同一判据在「关掉采纳」那一趟也成立（两条独立分支都被盯着，防止只抓到一条路径）
 *   OP-01c 【判据自证】把「等回执才画 + ✓✓」「没有 cm- 身份」两种假形状喂给同一条判据，
 *         它必须给假 —— 否则 OP-01 可能是恒真的空断言
 *   OP-02 落库后对账：那一行的 data-mid == 台账 entry_id == 回执 echo == **库里那一行的 id**
 *         （库里那条的 id 就是渲染端铸的那个 —— 不是按位置猜的最后一条）
 *   OP-03 上游 500 → 那一行变红、勾变 ! 、旁边一行话带上 KP-03 闭集里的 canonical code
 *   OP-03b 同一屏上「已送达」和「被拒绝」两行互不污染：绿的那条不因后一条翻红
 *   OP-04 屏幕上每一行的 data-send == 台账里那条命令的 state（逐行比，两趟都比）
 *   OP-05 【真 app 负向对照】BITBOT_ADOPT_CLIENT_ID=0（Host 不采纳渲染端身份）→
 *         落库 id 和界面上那条对不上 → 必须是 unmatched，**不许**亮成已送达。
 *         同一条判据在开/关两趟给出不同答案（无 vs ≥1），说明它不是恒真；
 *         并把「老判据（拿到一个 id 就算送达）」的取值一并打出来 —— 它这一趟会算错。
 *   OP-06 库里 user 行的 id 唯一（采纳的机制不会把两条消息并成同一条）
 *   OP-07 T3-06 的死线在真 app 上有两条相反的结局：全程静默那条先在死线之后被屏上判成
 *         「没等到回执」（勾变 !、带 unknown 类、有小字），迟到的回执再把它纠正成已送达，
 *         台账记 corrected_at_ms + 一笔「距最后一次证据 Nms > limit」异常，屏上小字换成「迟了多久」
 *   OP-07b 持续吐字那条（stub 每片间隔 700ms）跑过同一个死线却一次都没被判 ——
 *         这条自己要求 durMs > limit，否则判据是空的
 *   OP-07c 【判据自证】四种假时间线（从没判过 / 判了但屏上没换画法 / 长回合没跑过死线 /
 *         长回合被误判）喂给同两条判据，必须全给假
 *   OP-07d 那张按秒的表「有东西在等才开、等完自己关」：开机不开、回合中开着、全部落定后关掉
 *
 * stub 的三个钩子都只在 BITBOT_STUB_LATENCY_FROM_TEXT=1 下生效：[[lat:NNN]] 首字延迟、
 *   [[gap:NNN]] 流式每片间隔（造「一直在吐字」的回合）、含 FAIL_MARKER 的请求直接 500。
 *
 * 纪律：isolatedRepoRoot（夹具写进临时根的 data/desktop，绝不碰用户 data/）+
 *       独立 user-data-dir + BITBOT_NO_SECRET_SYNC=1；跑完关进程、清临时根。
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import {
  electronLaunchEnv,
  electronUserDataDir,
  gateAppEnv,
  hasDisplay,
  isolatedRepoRoot,
  killGateProcs,
} from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const requirePw = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = requirePw("playwright-core");

let PASS = 0;
let FAIL = 0;
const ok = (m, d) => { PASS++; console.log("  ✓ " + m + (d ? " · " + d : "")); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };
const note = (m) => console.log("  · " + m);

function honestSkip(reason) {
  console.log("e2e_desktop_optimistic: SKIP — " + reason);
  console.log("e2e_desktop_optimistic: PASS=0 FAIL=0 SKIP=1（SKIP ≠ PASS）");
  process.exit(0);
}
if (!fs.existsSync(ELECTRON)) honestSkip("electron dist missing");
if (!hasDisplay()) honestSkip("no DISPLAY and no xvfb-run");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeoutMs, stepMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (_) {}
    await sleep(stepMs || 120);
  }
  return null;
}

const DAY = "2026-11-05T09:00:00.000Z";
const bots = [{
  id: "op121-bot",
  name: "OP121乐观Bot",
  job: "验收",
  description: "KP-08 T3-04 端到端夹具",
  avatar: "",
  hidden: false,
  pinned: true,
  created_at: DAY,
  updated_at: DAY,
  group: "",
}];
const sessions = [{
  id: "op121-sess",
  title: "OP121乐观会话",
  created_at: DAY,
  updated_at: DAY,
  messages: [{ id: "op121-old", role: "user", text: "很久以前的一条", at: DAY }],
}];

const rootOf = (tag) =>
  isolatedRepoRoot(REPO, "optimistic-" + tag, {
    "bots.json": { version: 1, primary_id: bots[0].id, bots },
    "sessions.json": { version: 1, active_id: sessions[0].id, sessions },
  });
const roots = [];

const STUB_PORT = 8831;
const FAIL_MARKER = "[[op121-fail]]";
let stub = null;
function startStub() {
  stub = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BITBOT_STUB_PORT: String(STUB_PORT),
      BITBOT_STUB_LATENCY_FROM_TEXT: "1",
      // 只让带这个标记的那一条请求 500：同一次启动里既能跑成功回合也能跑被拒回合
      BITBOT_STUB_FAIL_CONTAINS: FAIL_MARKER,
    },
  });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout")), 10000);
    stub.stdout.on("data", (d) => { if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(); } });
    stub.stderr.on("data", (d) => note("[stub] " + String(d).trim().slice(0, 120)));
    stub.on("error", rej);
  });
}

/* 读库按「趟」读：每趟各用自己那份临时根。两趟共用一份 data/desktop 时，上一趟的常驻
   内核还会占着库（T1-07 的锁），下一趟的回合会以一条莫名其妙的失败收场，
   测的就不是「采纳与否」了。 */
const storePath = (root, n) => path.join(root, "data/desktop", n);
const readStore = (root, n) => { try { return JSON.parse(fs.readFileSync(storePath(root, n), "utf8")); } catch { return null; } };
/** 库里 role=user 的行（含 id）—— 门拿它对账「界面上那条」和「落库那条」是不是同一条。 */
const userRows = (root) => {
  const s = (readStore(root, "sessions.json") || {}).sessions || [];
  const out = [];
  for (const sess of s) for (const m of (sess.messages || [])) if (m && m.role === "user") out.push({ id: String(m.id || ""), text: String(m.text || "") });
  return out;
};
/** 「立刻」这一条判据本身（两趟共用，OP-01c 拿假形状自证它不是恒真）：
 *  出现时必须是 pending + 单勾 + 不带 cm- 身份不算，且进入终态必须晚于出现。 */
function optimisticPaint(a, leadMs) {
  if (!a) return "无快照";
  if (!/^cm-[0-9a-z]{16}$/.test(String(a.cm || ""))) return "出现时没有渲染端铸的身份（" + a.cm + "）";
  if (a.send !== "pending") return "出现时 data-send=" + a.send + "（不是 pending，等于一出现就宣布送达）";
  if (a.check !== "✓" || a.read || a.failed) return "出现时勾「" + a.check + "」read=" + a.read + " failed=" + a.failed;
  if (!(a.appearMs >= 0)) return "没有量到「点发送 → 出现」";
  if (!(leadMs > 0)) return "进入终态不比出现晚（leadMs=" + leadMs + "）";
  return "";
}
/** KP-03 尾账（OP-03c）：码得是 Host 回执里带来的，不是渲染端拿上游原文猜出来的。
 *  「Host 没发码」有两种长相：台账里没有码（屏上那个是归一化现读的），或码落进兜底
 *   unknown_failure（说明那条上游串没被收编）。两种都算不过。 */
function hostFailureCode(code, note, codes) {
  const list = codes || [];
  if (!code) return "台账里没有码，屏上那个是渲染端从原文归一化出来的（Host 没发码）";
  if (list.indexOf(code) < 0) return "台账 code=" + code + " 不在 KP-03 闭集里";
  if (code === "unknown_failure") return "台账 code=unknown_failure，Host 落进兜底，那条上游串没被收编";
  const found = [];
  const re = /（([a-z0-9_]+)）/g;
  let m;
  while ((m = re.exec(String(note || "")))) found.push(m[1]);
  const canonical = found.filter((c) => list.indexOf(c) >= 0);
  if (!canonical.length) return "屏上那行话没带闭集里的码：" + JSON.stringify(String(note || "").slice(0, 60));
  if (canonical.some((c) => c !== code)) return "屏上码 " + canonical.join(",") + " ≠ 台账码 " + code + "（两个来源不同源）";
  return "";
}

/** 页内观察器：记每一行本页发出过的用户消息「出现时」和「现在」的状态。 */
const INSTRUMENT = () => {
  const snap = (el, phase, clickAt) => ({
    phase,
    at: Date.now(),
    appearMs: clickAt ? Date.now() - clickAt : -1,
    cm: el.dataset.clientMid || "",
    send: el.dataset.send || "",
    mid: el.dataset.mid || "",
    storedOnly: el.dataset.storedOnly || "",
    check: ((el.querySelector(".msg-status .ms-check") || {}).textContent || "").trim(),
    read: !!el.querySelector(".msg-status .ms-check.read"),
    failed: el.classList.contains("msg-send-failed"),
    unknown: el.classList.contains("msg-send-unknown"),
    note: ((el.querySelector(".msg-send-note") || {}).textContent || "").trim(),
    text: ((el.querySelector(".body") || {}).textContent || "").trim().slice(0, 46),
  });
  window.__op = { snaps: [], snap, clickAt: 0, seen: {} };
  const obs = new MutationObserver((mrs) => {
    for (const m of mrs) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains("user") && n.dataset && n.dataset.clientMid && !window.__op.seen[n.dataset.clientMid]) {
          window.__op.seen[n.dataset.clientMid] = true;
          window.__op.snaps.push(snap(n, "appear", window.__op.clickAt));
        }
      }
    }
  });
  obs.observe(document.getElementById("log"), { childList: true, subtree: true });
};

/** 点发送并等那一行出现（带 cm- 身份）。T3-06 要的是「出现之后」的时间线，不预设终态。 */
async function clickAndAppear(win, text) {
  const before = await win.evaluate(() => window.__op.snaps.length);
  await win.evaluate((t) => {
    window.__op.clickAt = Date.now();
    const inp = document.getElementById("text");
    inp.value = t;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await win.click("#send", { timeout: 20000 });
  return await waitUntil(async () => {
    const a = await win.evaluate((i) => window.__op.snaps[i] || null, before);
    return a;
  }, 8000, 25);
}

/** 发一条并等它进入台账终态；返回 {appear, final, ledger}。 */
async function sendAndWait(win, text, timeoutMs) {
  const appear = await clickAndAppear(win, text);
  if (!appear) return { error: "回车后 8s 内界面上没有出现带 cm- 身份的那一行" };
  /* 「立刻」的判据不能对着 stub 的配置常量比（那会自证）—— 对着同一页时钟里**这一条
     真正进入终态的时刻**比：出现必须早于回执，差值是量出来的。stub 的 1600ms 首字延迟
     只在说明里作参照。 */
  const settled = await waitUntil(async () => {
    const done = await win.evaluate((cm) => {
      const c = window.__bitbotSendLedger.get(cm);
      return c && c.state !== "pending" ? { state: c.state, at: Date.now() } : null;
    }, appear.cm);
    return done;
  }, timeoutMs || 90000, 250);
  if (!settled) return { error: "台账里那条命令 " + (timeoutMs || 90000) + "ms 还停在 pending（" + appear.cm + "）", appear };
  const fin = await win.evaluate((cm) => {
    const el = document.querySelector('#log .msg.user[data-client-mid="' + cm + '"]');
    const c = window.__bitbotSendLedger.get(cm);
    return {
      final: el ? window.__op.snap(el, "final", 0) : null,
      ledger: c ? { state: c.state, entry_id: c.entry_id || "", code: c.code || "", anomalies: (c.anomalies || []).slice(0, 2) } : null,
    };
  }, appear.cm);
  return { appear, final: fin.final, ledger: fin.ledger, state: settled.state, settledAt: settled.at, leadMs: settled.at - appear.at };
}

/** 页内时间线：每 250ms 记一次「那一行现在长什么样 + 台账现在怎么说」。
 *  结束条件是「过了死线而且已经落回终态」—— 静默那条要连纠正的那一刻一起记下来。 */
const TIMELINE = (a) =>
  new Promise((res) => {
    const limit = window.__bitbotSendLiveness.limit_ms;
    const t0 = Date.now();
    const out = [];
    const iv = setInterval(() => {
      const el = document.querySelector('#log .msg.user[data-client-mid="' + a.cm + '"]');
      const c = window.__bitbotSendLedger.get(a.cm);
      const dt = Date.now() - t0;
      out.push({
        dt,
        send: el ? String(el.dataset.send || "") : "",
        check: el ? (((el.querySelector(".msg-status .ms-check") || {}).textContent || "").trim()) : "",
        note: el ? (((el.querySelector(".msg-send-note") || {}).textContent || "").trim()) : "",
        unknown: el ? el.classList.contains("msg-send-unknown") : false,
        read: el ? !!el.querySelector(".msg-status .ms-check.read") : false,
        state: c ? c.state : "",
        // 证据面：alive 相对发出推后了多少。静默期该是 0，吐字期该一路涨。
        aliveGap: c ? Math.round(Number(c.alive_at_ms) - Number(c.sent_at_ms)) : -1,
        armed: window.__bitbotSendLiveness.armed(),
      });
      const back = c && (c.state === "durable" || c.state === "rejected" || c.state === "unmatched");
      if ((dt > limit + 2000 && back) || dt > limit + 45000) {
        clearInterval(iv);
        res(out);
      }
    }, 250);
  });

/** 跑一条「过死线」的回合：出现 → 时间线 → 终态。返回门侧要的全部测量。 */
async function oneLiveTurn(win, text, label) {
  const appear = await clickAndAppear(win, text);
  if (!appear) return { label, error: "那一行没出现（" + text.slice(0, 24) + "）" };
  const timeline = await win.evaluate(TIMELINE, { cm: appear.cm });
  const dump = await win.evaluate((cm) => {
    const el = document.querySelector('#log .msg.user[data-client-mid="' + cm + '"]');
    const c = window.__bitbotSendLedger.get(cm);
    return {
      final: el ? window.__op.snap(el, "final", 0) : null,
      ledger: c
        ? {
            state: c.state,
            entry_id: String(c.entry_id || ""),
            sent_at_ms: Number(c.sent_at_ms),
            alive_at_ms: Number(c.alive_at_ms),
            expired_at_ms: Number(c.expired_at_ms || 0),
            settled_at_ms: Number(c.settled_at_ms || 0),
            corrected_at_ms: Number(c.corrected_at_ms || 0),
            anomalies: (c.anomalies || []).slice(0, 4),
          }
        : null,
    };
  }, appear.cm);
  const c = dump.ledger;
  return {
    label,
    appear,
    timeline,
    final: dump.final,
    ledger: c,
    // 这一条从发出到落终态的真实时长（同一页时钟，两个台账字段之差）——
    // 「跑过了死线没有」看这个，不看 stub 的配置常量。
    durMs: c ? Math.round(c.settled_at_ms - c.sent_at_ms) : -1,
    aliveMax: c ? Math.round(c.alive_at_ms - c.sent_at_ms) : -1,
  };
}

/** T3-06 判据①：静默 → 死线后判成没回执 → 迟到的回执把它纠正回来。 */
function silentThenLateReason(t, limit) {
  if (!t) return "无数据";
  if (t.error) return t.error;
  const tl = t.timeline || [];
  if (!tl.length) return "没时间线样本";
  const iExp = tl.findIndex((s) => s.state === "expired");
  if (iExp < 0) return "静默超过 " + limit + "ms 也没判成 expired（那张按秒的表没问或没判）";
  if (tl.slice(0, iExp).some((s) => s.state !== "pending"))
    return "expired 之前先出现过别的状态：" + tl.slice(0, iExp).map((s) => s.state).join("/");
  if (!(tl[iExp].dt >= limit)) return "expired 出现在死线之前（dt=" + tl[iExp].dt + "ms < " + limit + "ms）";
  if (!(tl[iExp].dt <= limit + 4000))
    return "expired 拖到死线后 " + (tl[iExp].dt - limit) + "ms 才上屏（表不是按秒在问）";
  if (!(tl[iExp].check === "!" && tl[iExp].unknown && tl[iExp].note))
    return "判成 expired 时屏上没换画法：勾「" + tl[iExp].check + "」unknown=" + tl[iExp].unknown +
      " 小字=" + JSON.stringify(tl[iExp].note);
  if (tl.slice(0, iExp).some((s) => s.aliveGap > limit / 2))
    return "静默期里 alive_at_ms 被推到距发出 " + tl[iExp].aliveGap + "ms 以上：这条一直在收证据，" +
      "那它判 expired 就不是「没证据」那一种（真正的断线长这样：只有开局那一次派发确认，几十毫秒）";
  const c = t.ledger;
  if (!c) return "台账取不到";
  if (!(c.settled_at_ms - c.alive_at_ms > limit))
    return "回执并不是「距最后一次证据超过死线」才到的（距最后证据 " +
      Math.round(c.settled_at_ms - c.alive_at_ms) + "ms ≤ " + limit + "ms）—— 这一条证的不是迟到";
  if (c.state !== "durable") return "迟到的回执到了却没落回 durable：" + c.state;
  if (!(c.corrected_at_ms > 0)) return "没有 corrected_at_ms：纠正没记账（屏幕上改了，台账说自己没改过）";
  const re = new RegExp("距最后一次证据 \\d+ms > " + limit + "ms");
  if (!c.anomalies.some((x) => re.test(x)))
    return "异常里没写「距最后一次证据 Nms > " + limit + "ms」：" + JSON.stringify(c.anomalies);
  if (!(t.final && t.final.send === "durable" && t.final.read && t.final.check === "✓✓"))
    return "纠正后屏上不是绿色 ✓✓：" + JSON.stringify(t.final && { send: t.final.send, check: t.final.check, read: t.final.read });
  const expNote = tl[iExp].note;
  if (!(t.final.note && /\d/.test(t.final.note) && t.final.note !== expNote))
    return "纠正后那行小字没换成「迟到了多久」：expired 时=" + JSON.stringify(expNote) +
      "，现在=" + JSON.stringify(t.final.note);
  if (tl.slice(iExp).some((s) => s.state === "pending"))
    return "纠正之后又回到 pending：屏幕上那条从「没等到回执」变回了转圈";
  return "";
}

/** T3-06 判据②：一直在吐字的长回合 —— 跑过了死线，却一次都没被判成没回执。 */
function trickleReason(t, limit) {
  if (!t) return "无数据";
  if (t.error) return t.error;
  const tl = t.timeline || [];
  if (!tl.length) return "没时间线样本";
  const hit = tl.find((s) => s.state === "expired");
  if (hit) return "一直在吐字那条仍在 " + hit.dt + "ms 被判 expired（证据没把死线推后）";
  if (!(t.durMs > limit))
    return "这一回合只跑了 " + t.durMs + "ms ≤ 死线 " + limit + "ms —— 测不到长回合，断言是空的";
  if (!tl.some((s) => s.aliveGap > 0))
    return "整段时间 alive_at_ms 没动过：流式片段没进台账（note 那条线没接上）";
  const c = t.ledger;
  if (!c) return "台账取不到";
  if (c.state !== "durable") return "长回合最终不是 durable：" + c.state;
  if (c.anomalies.some((x) => /回执超时/.test(x)))
    return "长回合记了一笔回执超时：" + JSON.stringify(c.anomalies);
  if (c.corrected_at_ms > 0) return "没判过 expired 却记了纠正：corrected_at_ms=" + c.corrected_at_ms;
  if (!(t.final && t.final.send === "durable" && t.final.check === "✓✓"))
    return "长回合屏上不是 ✓✓：" + JSON.stringify(t.final && { send: t.final.send, check: t.final.check });
  if (t.final.note) return "没被纠正过却留下了小字：" + JSON.stringify(t.final.note);
  return "";
}

/** 一趟真 app：adopt=1 跑「成功回合 + 被拒回合」，adopt=0 跑「身份对不上」。 */
async function pass(tag, adopt, opts) {
  const o = opts || {};
  const root = rootOf(tag);
  roots.push(root);
  const ud = electronUserDataDir("optimistic-" + tag);
  const env = electronLaunchEnv(
    gateAppEnv(root, {
      BITBOT_ADOPT_CLIENT_ID: adopt,
      BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
      BITBOT_LLM_API_KEY: "op121-stub-key",
      BITBOT_LLM_MODEL: "op121-stub",
      BITBOT_EVENT_DUAL_WRITE: "0",
    }),
  );
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO,
    env,
    timeout: 120000,
  });
  const out = { tag, adopt, root, boot: { coreReady: false, hasLedger: false }, turns: [], codes: [] };
  try {
    const win = await app.firstWindow({ timeout: 60000 });
    await win.waitForSelector("#composer #text", { timeout: 60000 });
    // 侧栏默认折叠成头像条（G-28 #2）：折叠时 .agent-item 在 DOM 里但不可见，
    // 先展开再等 —— 否则 waitForSelector 会一直等一个「看得见」的条件（KD 同口径）。
    await win.evaluate(() => {
      const sec = document.getElementById("sb-bots-rooms");
      if (sec) sec.classList.remove("collapsed");
    });
    await win.waitForSelector("#bot-list .agent-item", { timeout: 60000 });
    out.boot = await win.evaluate(() => ({
      coreReady: !!window.__bitbotClientCoreReady,
      hasLedger: !!window.__bitbotSendLedger,
      states: Object.keys(window.__bitbotClientCore.CMD_STATE || {}),
    }));
    const opened = await win.evaluate((nm) => {
      const rows = Array.from(document.querySelectorAll("#bot-list .agent-item"));
      const row = rows.find(
        (el) => (((el.querySelector(".name") || {}).textContent || "")).includes(nm),
      );
      if (!row) return { ok: false, names: rows.map((el) => ((el.querySelector(".name") || {}).textContent || "").trim()) };
      row.click();
      return { ok: true };
    }, bots[0].name);
    if (!opened.ok) { out.error = "进不去 OP121 那条私聊（侧栏 Bot 行：" + (opened.names || []).join(" / ") + "）"; return out; }
    await sleep(1200);
    await win.evaluate(INSTRUMENT);
    if (o.live) {
      /* T3-06：同一趟里跑两条都过死线的回合 —— 一条全程静默后迟迟到账（必须先在屏上
         判成没回执、再被纠正回来），一条持续吐字（必须一次都不被判）。 */
      out.live = {
        boot: await win.evaluate(() => ({
          limit: window.__bitbotSendLiveness.limit_ms,
          tick: window.__bitbotSendLiveness.tick_ms,
          armedBoot: window.__bitbotSendLiveness.armed(),
        })),
        turns: [],
      };
      out.live.turns.push(await oneLiveTurn(win, "T306静默迟到 [[lat:14000]] 请把这句原样回一遍", "静默迟到"));
      /* 持续吐字那条要真的跑过死线：stub 每片之间停 1200ms（事件循环里的定时器，
         实测片头到达 +23ms / +1224ms / +2426ms…，不是攒到最后一起到），
         片数 = 回执字数 / 8 —— 正文写长一点，回执才够长（25 片 ≈ 21s > 死线），
         否则这条测不到长回合。 */
      out.live.turns.push(await oneLiveTurn(
        win,
        "T306持续吐字 [[gap:1200]] 请把下面这段原样回一遍不要停：" + "吐字不停这条就不能被死线判掉".repeat(12),
        "持续吐字",
      ));
      await sleep(1600);
      out.live.armedEnd = await win.evaluate(() => window.__bitbotSendLiveness.armed());
      out.live.armedDuring = (out.live.turns[1].timeline || []).some((s) => s.armed);
    } else {
      out.turns.push({ name: "成功回合", r: await sendAndWait(win, "OP121乐观验收 [[lat:1600]] 请把这句原样回一遍", 90000) });
      /* 关掉采纳那一趟只跑成功回合：被拒回合会先落入 rejected 终态（终态不可翻回，
         这是台账的规矩），会把要证的 unmatched 遮住，还会白等一整个回合。 */
      if (adopt !== "0") {
        out.turns.push({ name: "被拒回合", r: await sendAndWait(win, "OP121 " + FAIL_MARKER + " 这条要被供应商拒绝", 90000) });
      }
    }
    out.rowsOnScreen = await win.evaluate(() =>
      Array.from(document.querySelectorAll("#log .msg.user[data-client-mid]")).map((el) => {
        const s = window.__op.snap(el, "sweep", 0);
        const c = window.__bitbotSendLedger.get(s.cm);
        s.led = c ? c.state : "";
        s.ledEntry = c ? String(c.entry_id || "") : "";
        return s;
      })
    );
    out.codes = await win.evaluate(() => (window.__bitbotFailure && window.__bitbotFailure.CODES) || []);
  } finally {
    await app.evaluate(({ app: a }) => { a.isQuiting = true; a.quit(); }).catch(() => {});
    await Promise.race([app.close(), sleep(15000)]).catch(() => {});
    killGateProcs(ud);
    fs.rmSync(ud, { recursive: true, force: true });
  }
  return out;
}

(async () => {
  try {
    await startStub();
    ok("S1 stub 起来（[[lat:1600]] 控制首字延迟；含 " + FAIL_MARKER + " 的请求必 500）");

    const A = await pass("adopt-on", "1");
    if (A.error) bad("OP-00b 第一趟（采纳开着）没能进入发送路径", A.error);
    const t1 = A.turns[0] && A.turns[0].r;
    const t2 = A.turns[1] && A.turns[1].r;

    ok("OP-00a 真 app 装上核心并起出台账", "coreReady=" + A.boot.coreReady + " hasLedger=" + A.boot.hasLedger + " 终态 " + (A.boot.states || []).length + " 种：" + (A.boot.states || []).join("/"));

    /* OP-01 立刻上屏 */
    if (!t1 || t1.error) bad("OP-01 回车后那一行立刻出现（成功回合）", (t1 && t1.error) || "无数据");
    else {
      const a = t1.appear;
      const why = optimisticPaint(a, t1.leadMs);
      ok("OP-01 回车后那一行立刻出现（成功回合）",
        "点发送 → 该行出现 " + a.appearMs + "ms、data-client-mid=" + a.cm +
        "、出现时 data-send=" + a.send + " 勾「" + a.check + "」；同一页时钟上，这一条进入终态在出现之后 " +
        t1.leadMs + "ms（参照：stub 首字延迟 1600ms）→ " + (why ? "不成立：" + why : "成立：出现早于回执，且出现时只声明 pending"));
      if (why) bad("OP-01 可感面不成立", why + " ｜ " + JSON.stringify(a));
    }

    /* OP-01c 判据自证：把「等回执才画」的形状喂给同一条判据，它必须给假 */
    {
      const fakeLate = { cm: "cm-0000000000000000", send: "durable", check: "✓✓", read: true, failed: false, appearMs: 1610 };
      const lateWhy = optimisticPaint(fakeLate, 0);
      const fakeNoId = { cm: "", send: "pending", check: "✓", read: false, failed: false, appearMs: 40 };
      const noIdWhy = optimisticPaint(fakeNoId, 1500);
      if (lateWhy && noIdWhy) {
        ok("OP-01c 【判据自证】同一条 OP-01 判据对假形状给假", "「回执后才画 + ✓✓」→ " + lateWhy + "；「没有渲染端身份」→ " + noIdWhy);
      } else {
        bad("OP-01c 判据可能是空的：假形状也被它放过", "回执后才画给=" + (lateWhy || "放过") + "、无身份给=" + (noIdWhy || "放过"));
      }
    }

    /* OP-02 echo 对账（不是位置） */
    if (!t1 || !t1.final || !t1.ledger) bad("OP-02 落库后 echo_entry_id 对上", "拿不到终态快照");
    else {
      const storeIds = new Set(userRows(A.root).map((r) => r.id));
      const same = t1.appear.cm === t1.final.cm && t1.final.cm === t1.ledger.entry_id && t1.final.mid === t1.ledger.entry_id;
      const inStore = storeIds.has(t1.final.cm);
      const green = t1.final.send === "durable" && t1.final.read && t1.final.check === "✓✓";
      ok("OP-02 落库后 echo_entry_id 对上（成功回合）",
        "界面 data-mid=" + t1.final.mid + " == 台账 entry_id=" + t1.ledger.entry_id + " == 回车前铸的 " + t1.appear.cm +
        "；库里 " + storeIds.size + " 行 user 含这一条=" + inStore + "；屏上 " + t1.final.check + (t1.final.read ? "(绿)" : ""));
      if (!(same && inStore && green && t1.ledger.state === "durable"))
        bad("OP-02 对账断了", JSON.stringify({ cm: t1.appear.cm, mid: t1.final.mid, entry: t1.ledger.entry_id, state: t1.ledger.state, inStore, green }));
    }

    /* OP-03 拒绝变红 + KP-03 码 */
    if (!t2 || !t2.final || !t2.ledger) bad("OP-03 服务端拒绝 → 那一行变红并带上 KP-03 的码", (t2 && t2.error) || "无数据");
    else {
      const codeRe = /（([a-z0-9_]+)）/g;
      const found = [];
      let mm;
      while ((mm = codeRe.exec(t2.final.note))) found.push(mm[1]);
      const canonical = found.filter((c) => (A.codes || []).indexOf(c) >= 0);
      const red = t2.final.failed && t2.final.send === "rejected" && t2.final.check === "!";
      ok("OP-03 服务端拒绝 → 那一行变红并带上 KP-03 的码",
        "台账 state=" + t2.ledger.state + " code=" + (t2.ledger.code || "（回执没带码，由原文归一化）") +
        "；那一行 class msg-send-failed=" + t2.final.failed + " 勾「" + t2.final.check + "」；旁边那行话：" + (t2.final.note.slice(0, 90) || "（空）") +
        " → 码在闭集里的有 " + canonical.join(",") + "（闭集 " + (A.codes || []).length + " 项）");
      if (!(red && t2.ledger.state === "rejected" && canonical.length))
        bad("OP-03 拒绝面不成立", JSON.stringify({ state: t2.ledger.state, code: t2.ledger.code, red, note: t2.final.note, found }));
    }

    /* OP-03c KP-03 尾账：上游 500 的码要由 Host 产出，不能让渲染端拿原文猜出兜底码 */
    {
      const ledCode = t2 && t2.ledger ? t2.ledger.code : "";
      const noteText = t2 && t2.final ? t2.final.note : "";
      const why = hostFailureCode(ledCode, noteText, A.codes);
      /* 自证：两种「Host 没发码」的假形状必须都被这判据判假，否则这条是恒真。 */
      const passed = [
        { code: "unknown_failure", note: "发送失败（unknown_failure）" },
        { code: "", note: "发送失败：上游 HTTP 500，没有码" },
      ].filter((f) => !hostFailureCode(f.code, f.note, A.codes));
      if (!t2 || !t2.ledger || !t2.final) bad("OP-03c Host 侧把上游 HTTP 失败映射成闭集里的码（不再落兜底）", "缺前置数据（OP-03 那一趟没跑成）");
      else if (why) bad("OP-03c 上游失败的码不是 Host 产出的", why + " · 台账 code=" + JSON.stringify(ledCode));
      else if (passed.length) bad("OP-03c 的判据是空的", passed.length + "/2 个「Host 没发码」的假形状被放过：" + passed.map((f) => f.code || "（空码）").join("、"));
      else
        ok("OP-03c Host 侧把上游 HTTP 失败映射成闭集里的码（不再落兜底）",
          "台账 code=" + ledCode + "（Host 回执带的）；屏上那行话：" + noteText.slice(0, 60) +
          "；判据自证：把码换成兜底 / 换成空串，2/2 都给判假");
    }

    /* OP-03b 同屏两个结局互不污染 */
    if (!t1 || !t1.final || !t2 || !t2.final) bad("OP-03b 同一屏上「已送达」不因后一条被拒而翻红", "缺前置数据");
    else {
      const still = (A.rowsOnScreen || []).find((r) => r.cm === t1.appear.cm);
      ok("OP-03b 同一屏上两行结局各自独立", "上一条仍是 " + (still ? still.send + "/勾「" + still.check + "」/绿=" + still.read : "?") + "，这一条是 " + t2.final.send);
      if (!(still && still.send === "durable" && still.read && !still.failed))
        bad("OP-03b 后一条的拒绝污染了前一行的状态", JSON.stringify(still));
    }

    /* OP-04 屏幕 == 台账（逐行，两趟都比） */
    const checkSweep = (label, rows) => {
      const drift = (rows || []).filter((r) => !r.send || r.send !== r.led);
      const notSettled = (rows || []).filter((r) => r.led === "pending");
      if (drift.length) bad("OP-04 " + label + "：屏幕那一行的状态位和台账不是同一个", drift.map((d) => d.cm + "→屏" + d.send + "/台账" + d.led).join("、"));
      else ok("OP-04 " + label + "：屏幕上每一行的 data-send 都等于台账里那条命令的 state",
        (rows || []).length + " 行（" + (rows || []).map((r) => r.send).join("/") + "），还没落终态的 " + notSettled.length + " 行");
    };
    checkSweep("采纳开着那一趟", A.rowsOnScreen);

    const B = await pass("adopt-off", "0");
    if (B.error) bad("OP-00c 第二趟（关掉采纳）没能进入发送路径", B.error);
    const t3 = B.turns[0] && B.turns[0].r;
    /* OP-01b 关掉采纳那一趟的出现也是乐观的：同一条判据在两条独立分支上都成立，
       谁把「画那一行」挪进回执处理，两趟会一起翻红，而不是只抓到一条路径。 */
    if (t3 && t3.appear) {
      const whyB = optimisticPaint(t3.appear, t3.leadMs);
      if (whyB) bad("OP-01b 关掉采纳那一趟的出现不再乐观", whyB + " ｜ " + JSON.stringify(t3.appear));
      else ok("OP-01b 关掉采纳那一趟的出现同样是乐观的", "出现 " + t3.appear.appearMs + "ms、进入终态在之后 " + t3.leadMs + "ms（判据与 OP-01 同一条）");
    } else bad("OP-01b 关掉采纳那一趟没量到出现时刻", (t3 && t3.error) || "缺数据");
    checkSweep("关掉采纳那一趟", B.rowsOnScreen);

    /* OP-05 真 app 负向对照 */
    if (!t3 || !t3.final || !t3.ledger) bad("OP-05 Host 不采纳身份时必须判 unmatched，不许亮成已送达", (t3 && t3.error) || "无数据");
    else {
      const honest = t3.ledger.state === "unmatched" && t3.final.send === "unmatched" && !t3.final.read && t3.final.check !== "✓✓";
      const oldJudgeSaysDelivered = !!t3.final.mid; // 位置/有 id 就算送达的老写法
      ok("OP-05 【负向对照】摘掉「Host 采纳身份」后那一行判成 unmatched",
        "界面上 " + t3.final.cm + " → 台账 " + t3.ledger.state + "（entry_id=" + (t3.ledger.entry_id || "无") + "）· 屏上 data-send=" + t3.final.send +
        " 勾「" + t3.final.check + "」· 提示：" + (t3.final.note.slice(0, 40) || "（空）") +
        "；台账记的那笔异常：" + JSON.stringify(t3.ledger.anomalies || []) +
        "；**老判据**（拿到一个落库 id 就算送达）在这一趟会算成「已送达」=" + oldJudgeSaysDelivered + " —— 这就是它错在哪");
      if (!honest) bad("OP-05 对照没翻红：关掉采纳后屏幕仍声称已送达", JSON.stringify({ state: t3.ledger.state, send: t3.final.send, read: t3.final.read, check: t3.final.check, anomalies: t3.ledger.anomalies, note: t3.final.note.slice(0, 120) }));
      const durableA = t1 && t1.ledger ? t1.ledger.state : "无";
      if (!(durableA === "durable" && t3.ledger.state === "unmatched"))
        bad("OP-05 判据在开/关两趟给出同一答案 → 断言可能是空的", "开=" + durableA + " 关=" + t3.ledger.state);
      else ok("OP-05b 同一条判据在两趟给出不同答案", "采纳开=" + durableA + "、采纳关=" + t3.ledger.state);
    }

    /* OP-06 库里 id 唯一（采纳的机制不会把两条消息并成同一条） */
    for (const p of [["采纳开着那一趟", A], ["关掉采纳那一趟", B]]) {
      const ids = userRows(p[1].root).map((r) => r.id);
      const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
      const adopted = ids.filter((x) => /^cm-[0-9a-z]{16}$/.test(x)).length;
      ok("OP-06 " + p[0] + "：落库 user 行 id 唯一", "共 " + ids.length + " 行（含夹具旧行），重复 id " + dupes.length + " 个，其中 cm- 形状（= 渲染端铸的身份被 Host 采纳）" + adopted + " 条");
      if (dupes.length) bad("OP-06 " + p[0] + "：库里出现重复 id（两条消息并成一条）", dupes.join(","));
      if (p[1].adopt === "1" && adopted < 2) bad("OP-06 采纳开着却没把渲染端身份采纳成库行 id", "user 行 id：" + ids.join(" / ") + "（应有 2 条 cm-）");
      if (p[1].adopt === "0" && adopted > 0) bad("OP-06 关掉采纳后库里仍有 cm- id（开关没起作用）", ids.join(" / "));
    }

    /* OP-07 T3-06：断线与慢回合同在一台台账上的两条结局，全在真 app 上量 */
    const C = await pass("liveness", "1", { live: true });
    if (C.error) bad("OP-00d 第三趟（活性死线）没能进入发送路径", C.error);
    const L = C.live || {};
    const limit = L.boot ? Number(L.boot.limit) : 0;
    const ls = (L.turns || [])[0] || null;
    const lt = (L.turns || [])[1] || null;
    const fmt = (t) => {
      if (!t) return "无数据";
      const iExp = (t.timeline || []).findIndex((s) => s.state === "expired");
      return "出现→落终态 " + t.durMs + "ms、证据把 alive 推到距发出 +" + t.aliveMax + "ms、" +
        (iExp >= 0 ? "第 " + t.timeline[iExp].dt + "ms 判成没回执（小字「" + t.timeline[iExp].note + "」）" : "全程没被判过没回执") +
        "，纠正记账 " + (t.ledger && t.ledger.corrected_at_ms ? "有" : "无");
    };
    if (!(limit > 0)) {
      bad("OP-07 页面没报出活性死线的上限（limit_ms）", "拿到 " + limit + " —— 判据无从对齐");
    } else {
      const why1 = silentThenLateReason(ls, limit);
      if (why1) bad("OP-07 静默那条没走出「死线判过期 → 迟到回执纠正」", why1 + " ｜ " + fmt(ls));
      else
        ok("OP-07 静默 " + limit + "ms 后屏上判成没回执，迟到的回执又把它纠正成已送达并留痕",
          fmt(ls) + "；异常原文：" + JSON.stringify((ls.ledger.anomalies || []).slice(0, 1)) +
          "；纠正后那行小字：" + JSON.stringify(ls.final.note) + "（死线取页面自报的 " + limit + "ms，门不抄常量）");
      const why2 = trickleReason(lt, limit);
      if (why2) bad("OP-07b 持续吐字的长回合仍被死线判成没回执（或这条压根没跑过死线）", why2 + " ｜ " + fmt(lt));
      else
        ok("OP-07b 持续吐字的长回合跑过死线却没被判：证据把 deadline 一路推后",
          fmt(lt) + "；样本 " + (lt.timeline || []).length + " 个、其中 alive 动过 " +
          (lt.timeline || []).filter((s) => s.aliveGap > 0).length + " 个");
      /* OP-07c 判据自证：四种「看起来一样但其实不对」的时间线喂给同两条判据，必须全给假 */
      const pend = { dt: 200, state: "pending", check: "✓", unknown: false, read: false, note: "", aliveGap: 0 };
      const fakes = [
        { nm: "从没判过 expired（那张表没跑）", fn: silentThenLateReason, t: {
          timeline: [pend, { dt: limit + 3000, state: "durable", check: "✓✓", read: true, note: "", aliveGap: 0 }],
          ledger: { state: "durable", corrected_at_ms: 0, anomalies: [], sent_at_ms: 0, alive_at_ms: 0, settled_at_ms: limit + 3000 },
          final: { send: "durable", read: true, check: "✓✓", note: "" }, durMs: limit + 3000 } },
        { nm: "判成 expired 时屏上画法没变", fn: silentThenLateReason, t: {
          timeline: [pend, { dt: limit + 800, state: "expired", check: "✓", unknown: false, note: "", aliveGap: 0 }],
          ledger: { state: "expired", corrected_at_ms: 0, anomalies: [], sent_at_ms: 0, alive_at_ms: 0, settled_at_ms: 0 },
          final: { send: "expired", read: false, check: "✓", note: "" }, durMs: limit + 800 } },
        { nm: "长回合其实没跑过死线（自证为空的那种）", fn: trickleReason, t: {
          timeline: [{ dt: 100, state: "pending", check: "✓", unknown: false, read: false, note: "", aliveGap: 900 }],
          ledger: { state: "durable", corrected_at_ms: 0, anomalies: [], sent_at_ms: 0, alive_at_ms: 900, settled_at_ms: 500 },
          final: { send: "durable", read: true, check: "✓✓", note: "" }, durMs: 500 } },
        { nm: "长回合仍被判了一次 expired", fn: trickleReason, t: {
          timeline: [pend, { dt: limit + 500, state: "expired", check: "!", unknown: true, note: "等太久", aliveGap: 4000 }],
          ledger: { state: "durable", corrected_at_ms: 0, anomalies: ["回执超时：距最后一次证据 10500ms > 10000ms"], sent_at_ms: 0, alive_at_ms: 4000, settled_at_ms: limit + 2000 },
          final: { send: "durable", read: true, check: "✓✓", note: "" }, durMs: limit + 2000 } },
      ];
      const loose = fakes.filter((f) => !f.fn(f.t, limit));
      if (loose.length) bad("OP-07c 判据可能是空的", loose.map((f) => f.nm).join("、") + " 被放过");
      else ok("OP-07c 【判据自证】同两条判据对四种假时间线全给假",
        fakes.map((f) => f.nm + "→「" + String(f.fn(f.t, limit)).slice(0, 26) + "」").join(" ｜ "));
      const disarm = L.boot && L.boot.armedBoot === false && L.armedEnd === false && L.armedDuring === true;
      if (!disarm)
        bad("OP-07d 那张按秒的表没做到「有东西在等才开、等完自己关」",
          "开机时开着=" + (L.boot && L.boot.armedBoot) + "、回合中间开着=" + L.armedDuring + "、结束后开着=" + L.armedEnd);
      else ok("OP-07d 按秒的表只在有东西在等时开着",
        "开机=" + L.boot.armedBoot + " → 长回合中=" + L.armedDuring + " → 全部落定后=" + L.armedEnd +
        "（上限 " + limit + "ms、每 " + L.boot.tick + "ms 问一次）");
    }

    note("判据自证：真 app 三趟、共 " +
      ((A.rowsOnScreen || []).length + (B.rowsOnScreen || []).length + (C.rowsOnScreen || []).length) + " 行本页发出的消息逐行对台账；" +
      "OP-01 的「立刻」不是对着 stub 的配置常量说的，是页内同一时钟量出的两个时刻之差：" +
      "点发送 → 该行出现 " + (t1 && t1.appear ? t1.appear.appearMs + "ms" : "未测到") + "，该行出现 → 进入终态 " + (t1 && t1.leadMs ? t1.leadMs + "ms" : "未测到") + "（出现必须早于回执）；" +
      "OP-02 的三方相等是「界面上那条 == 台账那条 == 库里那行」，不是「末尾第 n 条」；" +
      "OP-03 的码要在 failure_codes.js 的闭集里数到才算；OP-03c 进一步要求那个码是 Host 回执带来的（不是渲染端归一化，也不能落 unknown_failure 兜底），且屏上与台账同源；OP-05 为真 app 负向对照（关掉采纳必须翻红，且开关两趟答案不同）；" +
      "OP-07/07b 管 T3-06 的两条相反结局，死线的上限取页面自报的 limit_ms、每条都用台账里量出的 settled−alive / settled−sent 对账，不对着 stub 的配置常量比。" +
      "三趟启动、共 " + (A.turns.length + B.turns.length + ((C.live && C.live.turns) || []).length) + " 个回合全部真发真落库（写进临时根的 data/desktop，不碰用户数据），不是把界面 mock 成期望形状。");
  } catch (e) {
    bad("门自身异常", (e && e.stack ? String(e.stack).slice(0, 400) : String(e)));
  } finally {
    if (stub) { try { stub.kill(); } catch (_) {} }
    for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch (_) {} }
    console.log(`e2e_desktop_optimistic: PASS=${PASS} FAIL=${FAIL} SKIP=0`);
    process.exit(FAIL === 0 ? 0 : 1);
  }
})();
