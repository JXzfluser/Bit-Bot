/* e2e_desktop_stream_typing.mjs — 「打字效果」真的在屏幕上发生过吗（§8.121④ 前置账第 1 步，KP-08 尾账 #67）
 *
 * 这条门存在的理由（不是补装饰，是补一只眼睛）：
 *   §8.121 要修「按下停止后那半句话不见了」，它的判据必须能说清**停止前屏幕上到底有没有字**。
 *   真跑 `e2e_desktop_turn_cancel` 时实测：把这一档原本写死的 `BITBOT_LLM_STREAM:"0"` 翻成产品默认
 *   （host_ffi.js:5880 `!== "0"` 即开流式）、再给桩加逐片停 `[[gap:420]]`，25s 内屏幕上仍然
 *   没有一条 `[data-streaming="1"]` 且 ≥4 字的行 —— 也就是说**全仓没有任何一档观察过流式增量**
 *   （`prove_room_ux_render.mjs:242` 只数过 `[data-streaming]` 的条数）。判据无法证伪就不能落地，
 *   所以先把这只眼睛单独做成一档门：它同时回答「那 0 字气泡是 Host 没请求 stream，还是内核那侧
 *   没把增量交回 handler」。
 *
 * 覆盖（ST-01 是 HTTP 体级别的证人，ST-02..04 是屏幕上的事，ST-05/06 是收尾与落库一致性）：
 *   1) ST-01 桩自己记账的 request body 里 `stream: true`（Host 真的按产品默认请求了流式）；
 *   2) ST-02 渲染进程收到 ≥3 个 `phase:"delta"` 片段（增量确实跨到了渲染层）；
 *   3) ST-03 首个与末个 delta 之间有真实时间跨度（一次性整块交付在这条必红 —— 这是「流」与「块」的分界）；
 *   4) ST-04 屏幕上那条 `[data-streaming="1"]` 气泡的字数在两次采样之间**增长**（用户看得见的打字效果）；
 *   5) ST-05 回合结束后没有悬着的流式气泡，最终那行有字（吐完要收口，不能留个永远的打字点）；
 *   6) ST-06 屏幕最终文本 == `sessions.json` 里那条 assistant（增量的总和没在半路掉队）。
 *
 * 负向对照：NEG_CONTROL=1 时把 Host 环境改成 `BITBOT_LLM_STREAM=0`（产品里关掉流式的形状）。
 * 那时 ST-01..04 必须翻红 —— 否则这几条断言是恒真的装饰品。
 *
 * 纪律：独立 user-data-dir；桩只监听 127.0.0.1；跑完关进程；仓库 data/desktop/sessions.json 跑前快照、跑后还原。
 */
import path from "path";
import fs from "fs";
import os from "os";
import net from "net";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const NEG = process.env.NEG_CONTROL === "1";
const SESS = path.join(REPO, "data/desktop/sessions.json");
const sessionsBefore = fs.existsSync(SESS) ? fs.readFileSync(SESS) : null;
const RECORD = path.join(os.tmpdir(), "bb-stream-typing-stub-" + process.pid + ".jsonl");
const GAP_MS = 140;

const freePort = () =>
  new Promise((res, rej) => {
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

function startStub(port) {
  try { fs.writeFileSync(RECORD, ""); } catch (_) { /* 记账失败如实报，不假造 */ }
  const proc = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BITBOT_STUB_PORT: String(port),
      BITBOT_STUB_RECORD: RECORD,
      // 让正文里的 [[gap:NNN]] 生效：造一个「一直在吐字」的真回合。默认关，不影响别的门。
      BITBOT_STUB_LATENCY_FROM_TEXT: "1",
    },
  });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout")), 10000);
    proc.stdout.on("data", (d) => {
      if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(proc); }
    });
    proc.on("error", rej);
  });
}

function readStubRecords() {
  let lines = [];
  try {
    lines = fs.readFileSync(RECORD, "utf8").split("\n").filter(Boolean);
  } catch (_) {
    return [];
  }
  return lines.map((l) => {
    try { return JSON.parse(l); } catch (_) { return null; }
  }).filter(Boolean);
}

(async () => {
  const port = await freePort();
  const stub = await startStub(port);
  let app = null;
  try {
    const hostEnv = {
      DISPLAY: process.env.DISPLAY || "",
      PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
      MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
      BITBOT_REPO_ROOT: REPO,
      BITBOT_NO_SECRET_SYNC: "1",
      BITBOT_DESKTOP_AUTOSTART: "0",
      BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + port + "/v1",
      BITBOT_LLM_API_KEY: "e2e-stub-key",
      BITBOT_LLM_MODEL: "e2e-stub",
    };
    // 正常跑法**不写** BITBOT_LLM_STREAM —— 产品默认就是流式（host_ffi.js:5880）。
    // 负向对照才显式关成 "0"，用来证明 ST-01..04 认的是流式这件事。
    if (NEG) hostEnv.BITBOT_LLM_STREAM = "0";
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [
        path.join(DESKTOP, "main.js"),
        "--no-sandbox",
        "--disable-gpu",
        "--user-data-dir=" + electronUserDataDir("stream-typing"),
      ],
      cwd: REPO,
      env: electronLaunchEnv(hostEnv),
      timeout: 90000,
    });
    const win = await app.firstWindow({ timeout: 60000 });
    await win.waitForSelector("#composer #send", { timeout: 60000 });
    await win.waitForTimeout(500);

    const sessionId = await win.evaluate(async () => {
      const r = await window.bitbot.sessions.create("打字效果验证");
      return (r && r.session && r.session.id) || "";
    });
    sessionId ? ok("ST-00 真开机并建好会话（后面每一步都在这个真窗口里发生）")
      : bad("ST-00 会话没建起来，观察无从谈起");

    /* ---------- 走进这个会话（用户是点侧栏那一行进私聊面的） ----------
       这一步不是仪式感：index.html:22890 `canPaintStream = !composerRoom` —— 群聊面上
       流式增量照收但**故意不画**（那段注释写明了理由：空气泡会落在群 thread 外面）。
       第一版直接调 window.bitbot.turn 而没进会话，实测 9 片 delta 全到了渲染进程、
       文档里却一个 [data-streaming] 节点都没有（/tmp/st-run3.log），判据分不清
       「产品没画」和「门禁站在不该画的那一面」。所以现在按用户的走法先点侧栏那一行，
       并当场作证这一步真的在私聊面（ST-00b）。 */
    const opened = await win
      .waitForFunction(
        (sid) => !!document.querySelector('#session-list .agent-item[data-session-id="' + sid + '"]'),
        sessionId,
        { timeout: 30000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      bad("ST-00b 侧栏里没有刚建的会话行（进不去私聊面，后面的观察会站在错误的面上）");
    } else {
      await win.evaluate((sid) => {
        document
          .querySelector('#session-list .agent-item[data-session-id="' + sid + '"]')
          .click();
      }, sessionId);
      await win.waitForTimeout(900);
      const face = await win.evaluate(() => {
        const banner = document.getElementById("room-banner");
        const vis = banner && getComputedStyle(banner).display !== "none" && banner.offsetParent !== null;
        const active = Array.from(document.querySelectorAll("#session-list .agent-item"))
          .filter((x) => x.className.includes("active") || x.getAttribute("aria-selected") === "true")
          .map((x) => x.dataset.sessionId || "");
        return { roomVisible: !!vis, activeIds: active };
      });
      !face.roomVisible
        ? ok("ST-00b 现在站在私聊面（群横幅不可见）—— 打字气泡该画的那一面" +
            "（active 会话行=" + JSON.stringify(face.activeIds) + "）")
        : bad("ST-00b 仍在群面：这一面按设计不画流式气泡，判据必须换面重跑", JSON.stringify(face));
    }

    /* ---------- 装一只只读的眼睛：不改产品代码，另挂一个 llm-stream 监听 + 定时采样 DOM ----------
       preload.js:271 的 onLlmStream 每次调用都 ipcRenderer.on 一个新 handler，
       所以门禁可以并排收到同一批 chunk，而产品自己的渲染路径一点没被动过。 */
    await win.evaluate(({ sid, gap }) => {
      window.__st = { chunks: [], samples: [], done: null, busySeen: false, cm: "", sid };
      window.bitbot.onLlmStream((c) => {
        window.__st.chunks.push({
          t: Date.now(),
          phase: String((c && c.phase) || ""),
          text_len: String((c && c.text) || "").length,
          partial_len: String((c && c.partial) || "").length,
        });
      });
      window.__st.poll = setInterval(() => {
        const el = document.querySelector('#log .msg.assistant[data-streaming="1"] .body');
        // 也看整份文档：如果打字气泡其实落在了 #log 之外的容器（皮肤重构后线程面板搬家），
        // 只盯 #log 的尺子会把「产品在画」误判成「屏幕上什么都没有」。
        const anywhere = Array.from(document.querySelectorAll('[data-streaming="1"]')).map((n) => {
          const b = n.querySelector(".body");
          return {
            parent: (n.parentElement && n.parentElement.id) || (n.parentElement && n.parentElement.className) || "",
            cls: String(n.className || ""),
            chars: b ? String(b.textContent || "").replace(/\s+/g, " ").trim().length : -2,
          };
        });
        const busy = !document.getElementById("turn-cancel").hidden;
        if (busy) window.__st.busySeen = true;
        /* 结算信号用台账，不用「忙过之后再闲下来」：关掉流式的那一次整回合比一次采样还快，
           忙信号根本来不及被看见，用忙闲判结算会把正常结束的回合误报成「没结算」。
           走输入框必然起一条乐观命令（cm-…），它离开 pending 就是这一轮真结束了。 */
        if (!window.__st.done && !window.__st.cm && window.__st.userRowsBefore !== undefined) {
          const rows = document.querySelectorAll("#log .msg.user[data-client-mid]");
          if (rows.length > window.__st.userRowsBefore) {
            window.__st.cm = rows[rows.length - 1].dataset.clientMid || "";
          }
        }
        if (!window.__st.done && window.__st.cm && window.__bitbotSendLedger) {
          const c = window.__bitbotSendLedger.get(window.__st.cm);
          if (c && c.state && c.state !== "pending") {
            window.__st.done = { ok: c.state === "durable", state: c.state, at: Date.now(), via: "ledger" };
          }
        }
        window.__st.samples.push({
          t: Date.now(),
          len: el ? String(el.textContent || "").replace(/\s+/g, " ").trim().length : -1,
          anywhere,
          busy,
          logRows: document.querySelectorAll("#log .msg").length,
        });
      }, 60);
      // 从输入框走真链路（runUserTurn 才会把 muteLlmStream 归回 false、才会带会话上下文）
      const inp = document.getElementById("text");
      inp.value =
        "流式验证：请一个字一个字吐出来 [[gap:" + gap + "]] " +
        "打字效果要在屏幕上看得见这一段文字足够长一点";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      window.__st.userRowsBefore = document.querySelectorAll("#log .msg.user[data-client-mid]").length;
      document.getElementById("send").click();
    }, { sid: sessionId, gap: GAP_MS });

    const turned = await win
      .waitForFunction(() => window.__st && window.__st.done, null, { timeout: 120000 })
      .then(() => true)
      .catch(() => false);
    if (!turned) {
      bad("ST-00 回合没在 120s 内结算（后面全是空观察）");
    } else {
      const d = await win.evaluate(() => ({ done: window.__st.done, cm: window.__st.cm }));
      d.done && d.cm
        ? ok("ST-00c 结算信号来自乐观台账（cm " + String(d.cm).slice(0, 10) + " → " +
            (d.done.state || d.done.via) + "），不是靠抓忙闲信号的沿（整回合比一次采样还快时会漏）")
        : bad("ST-00c 结算信号没拿到台账证据", JSON.stringify(d));
    }
    await win.evaluate(() => { clearInterval(window.__st.poll); });

    const observed = await win.evaluate(() => {
      const st = window.__st;
      const rows = Array.from(document.querySelectorAll("#log .msg.assistant"));
      const last = rows[rows.length - 1];
      const body = last ? String((last.querySelector(".body") || {}).textContent || "") : "";
      return {
        chunks: st.chunks,
        samples: st.samples,
        done: st.done,
        hanging: document.querySelectorAll('#log .msg.assistant[data-streaming="1"]').length,
        lastRowStreaming: last ? String(last.dataset.streaming || "") : "",
        lastText: body.replace(/\s+/g, " ").trim(),
      };
    });
    const recs = readStubRecords();

    const deltas = observed.chunks.filter((c) => c.phase === "delta");
    const streamReqs = recs.filter((r) => r.stream === true);
    const anyReqs = recs.length;

    /* ---------- ST-01 HTTP 体级别：Host 有没有真的按流式去请求 provider ---------- */
    if (anyReqs === 0) {
      bad("ST-01 桩没收到任何请求（provider 那一枪没打响，后面全无从判断）", JSON.stringify({ recs }));
    } else if (streamReqs.length >= 1) {
      ok("ST-01 provider 请求带 stream:true（" + streamReqs.length + "/" + anyReqs + " 枪）—— Host 确实按产品默认请求了流式");
    } else {
      bad("ST-01 Host 没请求流式：所有 " + anyReqs + " 枪的 body 都是 stream=false",
        JSON.stringify(recs.map((r) => ({ url: r.url, stream: r.stream, msgs: (r.messages || []).length }))));
    }

    /* ---------- ST-02 增量跨到渲染层 ---------- */
    deltas.length >= 3
      ? ok("ST-02 渲染进程收到 " + deltas.length + " 个 phase:\"delta\"（增量真的送到了这一层）")
      : bad("ST-02 渲染进程几乎收不到增量：delta=" + deltas.length +
          "（chunk 直方图 " +
          JSON.stringify(observed.chunks.reduce((a, c) => { a[c.phase] = (a[c.phase] || 0) + 1; return a; }, {})) +
          "）—— 屏幕上一个字也不可能有");

    /* ---------- ST-03 「流」与「块」的分界：增量之间有真实时间跨度 ---------- */
    const spread = deltas.length >= 2 ? deltas[deltas.length - 1].t - deltas[0].t : -1;
    spread >= GAP_MS
      ? ok("ST-03 首末增量相隔 " + spread + "ms（≥ 一片的 " + GAP_MS + "ms）—— 不是一次性整块交付")
      : bad("ST-03 增量没有跨度（" + spread + "ms）：要么根本没增量，要么是块状交付被当成流",
          JSON.stringify(deltas.slice(0, 4)));

    /* ---------- ST-04 屏幕上看得见的打字效果：字数在两次采样之间增长 ---------- */
    const painted = observed.samples.filter((s) => s.len > 0);
    const growth = painted.length >= 2 ? painted[painted.length - 1].len - painted[0].len : 0;
    const distinct = new Set(painted.map((s) => s.len)).size;
    // 整份文档里出现过的流式节点：0 就是「产品从没造过气泡」，>0 且 len 也在长
    // 则是尺子的问题（气泡搬到了 #log 外面），两种红的成因完全不同。
    const anywhereSeen = observed.samples.flatMap((s) => s.anywhere || []);
    const anywhereMax = Math.max(0, ...observed.samples.map((s) => (s.anywhere || []).length));
    const anywhereCharsMax = Math.max(0, ...anywhereSeen.map((n) => Math.max(0, n.chars)));
    painted.length >= 2 && distinct >= 3 && growth >= 8
      ? ok("ST-04 气泡字数在增长：" + painted[0].len + " → " + painted[painted.length - 1].len +
          "（" + distinct + " 个不同长度、" + painted.length + " 次命中采样）")
      : bad("ST-04 屏幕上看不到打字效果：流式气泡采样 " + observed.samples.length +
          " 次，命中 " + painted.length + " 次，增长 " + growth + " 字；整份文档里 [data-streaming=\"1\"] " +
          "节点最多 " + anywhereMax + " 个、最长 " + anywhereCharsMax + " 字；#log 行数最多 " +
          Math.max(0, ...observed.samples.map((s) => s.logRows || 0)) + " 行",
          JSON.stringify({
            "采样前 6": observed.samples.slice(0, 6),
            "出现过流式节点的一次": observed.samples.find((s) => (s.anywhere || []).length > 0) || null,
          }));

    /* ---------- ST-05 收尾不悬着 ---------- */
    observed.hanging === 0 && observed.lastText.length > 0
      ? ok("ST-05 结束后没有悬着的流式气泡（[data-streaming=\"1\"] 剩 " + observed.hanging +
          " 条），最后一行有 " + observed.lastText.length + " 字")
      : bad("ST-05 收尾不对：悬着 " + observed.hanging + " 条、最后一行 " +
          observed.lastText.length + " 字（streaming=" + observed.lastRowStreaming + "）",
          JSON.stringify({ last: observed.lastText.slice(0, 80) }));

    /* ---------- ST-06 屏上 == 库里（增量拼起来的全文没掉队） ---------- */
    let stored = "";
    try {
      const j = JSON.parse(fs.readFileSync(SESS, "utf8"));
      const s = (j.sessions || []).find((x) => x && x.id === sessionId);
      const msgs = (s && s.messages) || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i] && msgs[i].role === "assistant") { stored = String(msgs[i].text || ""); break; }
      }
    } catch (e) {
      stored = "<读不到 sessions.json:" + String(e.message) + ">";
    }
    const norm = (x) => String(x || "").replace(/\s+/g, " ").trim();
    norm(stored).length > 0 && norm(stored) === norm(observed.lastText)
      ? ok("ST-06 屏幕那行与 sessions.json 里那条逐字一致（" + norm(stored).length + " 字）")
      : bad("ST-06 屏上与库里不一致", JSON.stringify({
          库: norm(stored).slice(0, 70),
          屏: norm(observed.lastText).slice(0, 70),
        }));

    /* 给矩阵锚点用的机器 token：ST-04 是这一档的命门，负向对照要求它必须翻红。 */
    console.log(
      "ST_METRICS mode=" + (NEG ? "neg" : "prod") +
      " reqs=" + anyReqs + " stream_reqs=" + streamReqs.length +
      " deltas=" + deltas.length + " spread_ms=" + spread +
      " painted=" + painted.length + " distinct=" + distinct + " growth=" + growth +
      " stream_nodes_max=" + anywhereMax + " stream_chars_max=" + anywhereCharsMax +
      " hanging=" + observed.hanging + " final_chars=" + norm(observed.lastText).length,
    );
    await win.screenshot({ path: path.join(os.tmpdir(), "bb-stream-typing.png") });
  } finally {
    if (app) await app.close();
    stub.kill();
    if (sessionsBefore) fs.writeFileSync(SESS, sessionsBefore);
    try { fs.rmSync(RECORD); } catch (_) { /* 临时记账文件删不掉不影响结论 */ }
  }
  console.log("\ne2e_desktop_stream_typing: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => {
  console.error("e2e_desktop_stream_typing fatal:", e && e.message ? e.message : e);
  process.exit(1);
});
