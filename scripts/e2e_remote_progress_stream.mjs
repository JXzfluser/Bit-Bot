/**
 * e2e_remote_progress_stream.mjs — 路线 A · W2 收口门（A1-3 / A1-4 的服务端侧）
 *
 * 起**真的桌面 Electron app**（不是进程内拼一个假 server），让手机：
 *   1) 用配对流程真拿到的那把凭证订阅 `GET /v1/events`（SSE）；
 *   2) 再 `POST /v1/turn` 发一个真回合；
 *   3) 在这一轮里就该看见 `turn_started → progress… → turn_ended`，seq 有序；
 *   4) 中途拔连接、带 `Last-Event-ID` 重连后**不重复、不缺失**（AC-T1-9）；
 *   5) 订阅某个 session 时**不许看到别的 session** 的事件。
 *
 * 为什么这条门必须起真 app：`prove_cn_events_sse.js` / `prove_cn_turn_events.js`
 * 是在 Node 里把 `createCnInboundServer` 与 `turn_event_emitter` 单独接起来测的 ——
 * 那种接法**绕过了桌面 main.js 的接线**，于是两件事它都测不出来（本轮实测踩到）：
 *   · 手机订阅用的凭证。路由当时只认设备密钥签名，而配对 `/v1/pair/redeem` 回给手机的
 *     是共享 bearer `turn_token`（`cn_inbound_server.js:791-838`），手机手里根本没有
 *     设备私钥 ⇒ 真机一连就 401，两条 Node 门全绿也看不见。
 *   · 手机发起的回合不落 `progress`。桌面的 `onTurn`（main.js:4165-4210）只 emit
 *     `turn_started`/`turn_ended`，`runner.runTurn` 没传 `onProgress`（桌面本地回合才有，
 *     main.js:3707-3717）⇒ 「手机看得见进度」这句话对手机发起的回合并不成立。
 * 这两条都在下面 RP-02 / RP-03 上先红后绿，原文进 report.md。
 *
 * 跑法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_remote_progress_stream.mjs
 * 缺 electron / 缺显示环境时诚实 SKIP（SKIP ≠ PASS）。
 *
 * 铁律：不改任何既有响应体。RP-07 反向钉这一条 —— 它把 `/v1/turn` 的字段集合
 * 与本轮之前记下的形状对账，多一个少一个都红。
 */
import http from "http";
import net from "net";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import {
  electronLaunchEnv,
  electronUserDataDir,
  isolatedRepoRoot,
  gateAppEnv,
  hasDisplay,
  countAppMains,
  killGateProcs,
} from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);

let PASS = 0;
let FAIL = 0;
let SKIP = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : ""));
};
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_remote_progress_stream: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_remote_progress_stream: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_remote_progress_stream: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_remote_progress_stream: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

/* 端口固定：RP-05 要在同一台 app 上重连，端口换了「重连」就没意义了。 */
async function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}
const PORT = await pickFreePort();
const STUB_PORT = await pickFreePort();

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "remote-progress", {
  "bots.json": {
    bots: [{ id: "b1", name: "派单助手", job: "派单调度", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW }],
    primary: "b1",
  },
  "settings.json": { notify: {}, dev_mode: true },
  "sessions.json": { sessions: [] },
});
const UD = electronUserDataDir("remote-progress");

/** 真 app 起来时**把双写开关打开** —— 这条门量的是「开了之后手机端到底看不看得见」，
 *  开关默认关是部署侧的策略（report.md §8.61.4），不是这里要重复证明的东西。
 *
 *  provider 用仓里现成的 OpenAI 兼容 stub（GP-96 / DW-Live 同款），**不是**死端口：
 *  手机这一轮必须真的 fan-out 出 effect 边界，`progress` 才有东西可落 —— 之前把它
 *  指到 127.0.0.1:9，回合零 effect、零 progress，RP-04 是在测「桩没配好」而不是测产品。
 *  这证明的是工具/进度链路，不是模型质量（stub 头注释里的同一句话）。 */
function startStub() {
  const proc = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BITBOT_STUB_PORT: String(STUB_PORT),
      BITBOT_STUB_LATENCY_MS: "400",
      BITBOT_STUB_REPLY: "远程进度门：收到。",
      /* 第一回合走**真工具调用**（web_fetch 打这个 stub 自己的 healthz，不依赖外网）：
         手机上要的「几十秒里看得见中间更新」靠的是真效果边界，不是聊天回执。
         脚本用完之后 stub 自动回纯文本 —— 后面那几回合正好当「纯聊天也要有进度」的对照。 */
      BITBOT_STUB_MODE: "toolcall",
      BITBOT_STUB_TOOL_SCRIPT: JSON.stringify([
        { tool_calls: [{ id: "c1", name: "web_fetch", arguments: { url: "http://127.0.0.1:" + STUB_PORT + "/v1/healthz" } }] },
        { content: "远程进度门：抓到了。" },
      ]),
    },
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("stub boot timeout (10s)")), 10000);
    proc.stdout.on("data", (d) => {
      if (String(d).includes("[stub-llm]")) {
        clearTimeout(t);
        resolve(proc);
      }
    });
    proc.on("error", reject);
  });
}

function launch() {
  return _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
    cwd: REPO,
    env: electronLaunchEnv(
      gateAppEnv(root, {
        BITBOT_EVENT_DUAL_WRITE: "1",
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
        BITBOT_LLM_API_KEY: "rp-stub-key",
        BITBOT_LLM_MODEL: "rp-stub",
        BITBOT_LLM_STREAM: "0",
        BITBOT_CN_INBOUND_PORT: String(PORT),
      }),
    ),
  });
}

/* ---------------- SSE 客户端（手机侧该做的事，用 Node 现做一遍） ------------- */

/** 解析 SSE：只认 `id:` / `event:` / `data:` 三种行，注释行（`: ping`）忽略。 */
function parseFrames(buf) {
  const out = [];
  for (const block of buf.split("\n\n")) {
    if (!block.trim()) continue;
    const f = { id: null, event: null, data: null };
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) f.id = Number(line.slice(3).trim());
      else if (line.startsWith("event:")) f.event = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        const raw = line.slice(5).trim();
        try {
          f.data = JSON.parse(raw);
        } catch {
          f.data = raw;
        }
      }
    }
    if (f.data !== null) out.push(f);
  }
  return out;
}

/**
 * 打开一条订阅。headers 决定用什么凭证（RP-02 用配对的 bearer，RP-06 带 session_id）。
 * onFrame 每来一帧回调一次；stopWhen 返回 true 时**当场拔连接**（RP-05 用）。
 */
function openStream(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const headers = Object.assign({ Accept: "text/event-stream" }, o.headers || {});
    const req = http.request(
      { host: "127.0.0.1", port: PORT, method: "GET", path: o.path || "/v1/events?from_seq=0", headers },
      (res) => {
        let buf = "";
        let seen = 0;
        const frames = [];
        const result = {
          status: res.statusCode,
          contentType: res.headers["content-type"] || "",
          body: "",
          frames,
          aborted: false,
          ended: false,
        };
        const finish = () => {
          try {
            req.destroy();
          } catch (_) {}
          resolve(result);
        };
        res.on("data", (c) => {
          buf += c.toString("utf8");
          if (res.statusCode !== 200) {
            result.body = buf;
            if (result.body.length > 400) finish();
            return;
          }
          const parsed = parseFrames(buf);
          if (parsed.length > seen) {
            for (let i = seen; i < parsed.length; i++) frames.push(parsed[i]);
            seen = parsed.length;
            if (o.onFrame) o.onFrame(parsed[parsed.length - 1], frames);
            if (o.stopWhen && o.stopWhen(frames)) {
              result.aborted = true;
              finish();
              return;
            }
          }
        });
        res.on("end", () => {
          result.ended = true;
          finish();
        });
        res.on("error", () => finish());
        setTimeout(finish, o.ms || 30000);
      },
    );
    req.on("error", (e) => resolve({ status: 0, contentType: "", body: "error:" + (e && e.message), frames: [], aborted: false, ended: false }));
    req.end();
  });
}

function postTurn(body, bearer) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        method: "POST",
        path: "/v1/turn",
        headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": payload.length },
      },
      (res) => {
        let out = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(out);
          } catch {
            /* 原文留给断言 */
          }
          resolve({ status: res.statusCode, text: out, json });
        });
      },
    );
    if (bearer) req.setHeader("Authorization", "Bearer " + bearer);
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const readToken = () => {
  const f = path.join(root, "data", "host", "turn-token");
  return fs.existsSync(f) ? String(fs.readFileSync(f, "utf8")).trim() : "";
};

const kindSeq = (frames) => frames.map((f) => (f.data && f.data.kind) || f.event || "?") .join("→");
const seqsOf = (frames) => frames.map((f) => (f.data && Number(f.data.seq)) ?? f.id);

let app = null;
let stub = null;
/* 主进程日志：红的时候没有它就是猜。只在内存里留着，失败详情里截相关行。 */
let mainLog = "";

(async () => {
  try {
    stub = await startStub();
    app = await launch();
    try {
      app.process().stdout.on("data", (d) => (mainLog += String(d)));
      app.process().stderr.on("data", (d) => (mainLog += String(d)));
    } catch (_) { /* 拿不到日志不影响断言，只是红的时候少了线索 */ }
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await sleep(1200);

    const token = readToken();

    /* ---------- RP-01 没有凭证的订阅必须被拒（事件里带的是用户干了什么） ---------- */
    {
      const r = await openStream({ path: "/v1/events?from_seq=0", ms: 4000 });
      if (r.status === 401) ok("RP-01 无凭证 GET /v1/events → 401（事件流不裸奔）");
      else bad("RP-01 无凭证订阅应 401", "status=" + r.status + " " + String(r.body).slice(0, 120));
    }

    /* ---------- RP-02 真配对手机那把 bearer 必须订得到（这条此前是红的） ---------- */
    if (!token) {
      bad("RP-02 磁盘上没有配对令牌，无法验「手机那把凭证订得到事件」", path.join(root, "data", "host", "turn-token"));
    } else {
      const r = await openStream({
        path: "/v1/events?from_seq=0",
        headers: { Authorization: "Bearer " + token },
        ms: 3500,
      });
      if (r.status === 200 && /text\/event-stream/.test(r.contentType)) {
        ok("RP-02 配对手机用的那把 bearer（/v1/pair/redeem 回发的 turn_token）订得到事件流 → 200 " + r.contentType);
      } else if (r.status === 401) {
        bad("RP-02 手机那把凭证订不到事件流：401（路由只认设备密钥签名，而配对回发的是共享 bearer —— 真机一连就死在这）", "body=" + String(r.body).slice(0, 160));
      } else {
        bad("RP-02 bearer 订阅应 200/SSE", "status=" + r.status + " ct=" + r.contentType + " body=" + String(r.body).slice(0, 160));
      }
    }

    /* ---------- RP-03/04 手机发的这一轮，进度要真的进流 ---------- */
    const phone = { bearer: token, frames: [], done: false };
    let stream = null;
    if (token) {
      const sess = "rp-phone-A";
      const streamP = openStream({
        path: "/v1/events?from_seq=0",
        headers: { Authorization: "Bearer " + token },
        ms: 26000,
        onFrame: (f) => phone.frames.push(f),
        stopWhen: (fs2) => fs2.some((f) => f.data && f.data.kind === "turn_ended" && f.data.sessionId === sess),
      });
      const turnP = postTurn(
        // 这一句要**真的动手**（web_fetch），才量得出「手机看得见中间过程」；
        // 纯聊天那一类另开 RP-08 做对照（零 effect 的回合也必须上屏，否则手机是空屏）。
        { text: "用 web_fetch 抓 http://127.0.0.1:" + STUB_PORT + "/v1/healthz，然后回一句抓到了什么", session_id: sess, machine_kind: "android" },
        token,
      );
      stream = await streamP;
      const turn = await turnP;
      const mine = phone.frames.filter((f) => f.data && f.data.sessionId === sess);
      const kinds = mine.map((f) => f.data.kind);
      const effects = ((turn.json && turn.json.host_results) || []).length;

      if (turn.status !== 200) {
        bad("RP-03 前置：手机 POST /v1/turn 应 200", "status=" + turn.status + " " + String(turn.text).slice(0, 200));
      } else if (turn.json && turn.json.ok !== true) {
        // 回合本身失败时，"流里没有 progress" 是果不是因 —— 先报因。
        bad("RP-03 前置：手机这一轮没跑成（ok=false）", String(turn.text).slice(0, 300));
      } else if (!kinds.includes("turn_started")) {
        bad("RP-03 手机发起的回合要落 turn_started", kindSeq(mine));
      } else if (!kinds.includes("turn_ended")) {
        bad("RP-03 手机发起的回合要落 turn_ended（手机端据此收尾）", kindSeq(mine));
      } else {
        const si = kinds.indexOf("turn_started");
        const ei = kinds.indexOf("turn_ended");
        const asc = seqsOf(mine).every((v, i, a) => i === 0 || v > a[i - 1]);
        if (si >= ei || ei - si < 2 || !asc) {
          bad("RP-03 三类事件要按顺序、seq 严格递增", JSON.stringify({ kinds, seqs: seqsOf(mine) }));
        } else {
          ok("RP-03 手机这一轮的流里 " + mine.length + " 帧：" + kindSeq(mine) + "（seq " + seqsOf(mine)[0] + "→" + seqsOf(mine)[seqsOf(mine).length - 1] + " 严格递增）");
        }
        const progressRows = kinds.filter((k) => k === "progress").length;
        const categories = mine
          .filter((f) => f.data && f.data.kind === "progress")
          .map((f) => (f.data.payload && f.data.payload.row && f.data.payload.row.category) || "?");
        if (progressRows === 0) {
          bad("RP-04 回合里一个 progress 都没有 ⇒ 手机上这几十分钟是空屏（桌面 onTurn 没把 onProgress 接进事件桥）", JSON.stringify({ effects, turn: String(turn.text).slice(0, 1600), log: mainLog.split("\n").filter((l) => /progress|effect|kernel|llm/i.test(l)).slice(-6).join(" | ").slice(0, 300) }));
        } else if (effects > 0 && progressRows < effects) {
          bad("RP-04 每个 effect 边界都要上屏", JSON.stringify({ progressRows, effects }));
        } else if (!categories.includes("tool_activity")) {
          // 这一条才是 AC 的实质：手机看到的不能只是「模型在打字」，要看到真的动手了。
          bad("RP-04 进度里没有任何一条工具活动（§5.7 六类里最该看得见的一类）", JSON.stringify({ categories, effects }));
        } else {
          ok("RP-04 进度真的进流了：progress " + progressRows + " 帧 / 该回合 effect " + effects + " 条，类别 " +
            JSON.stringify([...new Set(categories)]) + (progressRows >= 3 ? "（≥3 次更新，AC 的「几十秒里看得见」成立）" : ""));
        }
      }
    } else {
      bad("RP-03 手机发起的回合要落 turn_started", "没有配对令牌");
      bad("RP-04 进度要进流", "没有配对令牌");
    }

    /* ---------- RP-05 拔连接 + Last-Event-ID 续订：不重复、不缺失（AC-T1-9） ---------- */
    {
      const sess = "rp-phone-C";
      // 先跑一整轮，把事件落到库里
      const t = await postTurn({ text: "记住 favorite_language=zh；列出 machines", session_id: sess, machine_kind: "android" }, token);
      const full = await openStream({
        path: "/v1/events?from_seq=0",
        headers: { Authorization: "Bearer " + token },
        ms: 6000,
        stopWhen: (frames) => frames.some((f) => f.data && f.data.kind === "turn_ended" && f.data.sessionId === sess),
      });
      const all = full.frames.filter((f) => f.data && f.data.sessionId === sess);
      if (t.status !== 200 || all.length < 3) {
        bad("RP-05 前置：要有一整轮可续订的事件", JSON.stringify({ status: t.status, got: all.length }));
      } else {
        const cut = Math.max(1, Math.floor(all.length / 2));
        const head = all.slice(0, cut);
        const lastId = head[head.length - 1].data.seq;
        // 半程就拔连接（模拟手机切后台 / 掉网），再带 Last-Event-ID 重连
        const drop = await openStream({
          path: "/v1/events?from_seq=0",
          headers: { Authorization: "Bearer " + token },
          ms: 6000,
          stopWhen: (frames) => frames.filter((f) => f.data && f.data.sessionId === sess).length >= cut,
        });
        if (!drop.aborted) bad("RP-05 前半程没拔成连接，续订对照不成立", JSON.stringify({ frames: drop.frames.length }));
        const resume = await openStream({
          path: "/v1/events?from_seq=0",
          headers: { Authorization: "Bearer " + token, "Last-Event-ID": String(lastId) },
          ms: 6000,
          stopWhen: (frames) => frames.some((f) => f.data && f.data.kind === "turn_ended" && f.data.sessionId === sess),
        });
        const tailFrames = resume.frames.filter((f) => f.data && f.data.sessionId === sess);
        const merged = head.concat(tailFrames).map((f) => f.data.seq);
        const dedup = new Set(merged);
        const expected = all.map((f) => f.data.seq);
        const missing = expected.filter((s) => !dedup.has(s));
        const dup = merged.length - dedup.size;
        const asc = merged.every((v, i, a) => i === 0 || v > a[i - 1]);
        if (!tailFrames.length) {
          bad("RP-05 带 Last-Event-ID 重连后没拿到后半程", "lastId=" + lastId + " frames=" + resume.frames.length);
        } else if (tailFrames[0].data.seq !== lastId + 1) {
          bad("RP-05 重连后首帧应当正好接上（不缺失）", JSON.stringify({ lastId, first: tailFrames[0].data.seq }));
        } else if (dup > 0 || missing.length > 0 || !asc) {
          bad("RP-05 续订后不许有重复/缺失/乱序", JSON.stringify({ dup, missing, asc, merged }));
        } else {
          ok("RP-05 断线续订：半程拔断（前 " + head.length + " 帧到 seq=" + lastId + "），带 Last-Event-ID 重连从 seq=" +
            tailFrames[0].data.seq + " 接上，合并 " + merged.length + " 帧 == 整轮 " + expected.length + " 帧，重复 0 / 缺失 0 / 严格递增");
        }
      }
    }

    /* ---------- RP-06 订阅一个 session 不许看到别的 session（多设备同机是常态） ---------- */
    {
      const sessOther = "rp-phone-B";
      await postTurn({ text: "列出 routines", session_id: sessOther, machine_kind: "ios" }, token);
      const plain = await openStream({ path: "/v1/events?from_seq=0", headers: { Authorization: "Bearer " + token }, ms: 5000 });
      const filt = await openStream({
        path: "/v1/events?from_seq=0&session_id=" + encodeURIComponent(sessOther),
        headers: { Authorization: "Bearer " + token },
        ms: 5000,
      });
      const plainSessions = new Set(plain.frames.map((f) => f.data && f.data.sessionId));
      const filtSessions = new Set(filt.frames.map((f) => f.data && f.data.sessionId));
      if (filt.status !== 200) {
        bad("RP-06 带 session_id 的订阅应 200", "status=" + filt.status);
      } else if (filtSessions.size > 1 || (filtSessions.size === 1 && !filtSessions.has(sessOther))) {
        bad("RP-06 指定 session 的流里混进了别的 session", JSON.stringify({ requested: sessOther, inStream: [...filtSessions] }));
      } else if (plainSessions.size < 2) {
        bad("RP-06 对照没立住：不带 session_id 的流里只看到一个 session，无法证明过滤在起作用", JSON.stringify([...plainSessions]));
      } else {
        ok("RP-06 session 隔离：不带 session_id 时流里有 " + plainSessions.size + " 个 session（" +
          [...plainSessions].join(",") + "），带 session_id=" + sessOther + " 时只剩 " + filtFramesLabel(filt) + " 帧且全是这一个 session");
      }
    }

    /* ---------- RP-07 既有响应体不许变：/v1/turn 的字段集合逐条对账 ---------- */
    {
      const EXPECTED = [
        "brain",
        "device_id",
        "error",
        "host_results",
        "machine_kind",
        "messages",
        "ok",
        "pretend_turn",
        "session_id",
        "stdout",
      ];
      const t = await postTurn({ text: "ListMachines", session_id: "rp-phone-D", machine_kind: "android" }, token);
      const got = Object.keys(t.json || {}).sort();
      if (t.status !== 200) bad("RP-07 前置：/v1/turn 应 200", "status=" + t.status);
      else if (got.join(",") !== EXPECTED.join(",")) {
        bad("RP-07 /v1/turn 的响应体形状变了（A1-1/A1-2 只许加路由，不许动既有契约）", JSON.stringify({ expected: EXPECTED, got, added: got.filter((k) => !EXPECTED.includes(k)), removed: EXPECTED.filter((k) => !got.includes(k)) }));
      } else {
        ok("RP-07 /v1/turn 响应体一字未变：" + got.length + " 个字段与本轮之前记下的形状逐条相同（只加路由没动契约）");
      }
    }

    /* ---------- RP-08 对照：零 effect 的纯聊天回合也要有进度（不是只有工具回合才看得见） ---------- */
    {
      const sess = "rp-phone-E";
      const streamP = openStream({
        path: "/v1/events?from_seq=0&session_id=" + encodeURIComponent(sess),
        headers: { Authorization: "Bearer " + token },
        ms: 20000,
        stopWhen: (frames) => frames.some((f) => f.data && f.data.kind === "turn_ended" && f.data.sessionId === sess),
      });
      const turnP = postTurn({ text: "随便聊一句，不用工具", session_id: sess, machine_kind: "android" }, token);
      const s = await streamP;
      const t = await turnP;
      const mine = s.frames.filter((f) => f.data && f.data.sessionId === sess);
      const cats = mine
        .filter((f) => f.data && f.data.kind === "progress")
        .map((f) => (f.data.payload && f.data.payload.row && f.data.payload.row.category) || "?");
      if (t.status !== 200 || (t.json && t.json.ok !== true)) {
        bad("RP-08 前置：纯聊天回合没跑成", String(t.text).slice(0, 200));
      } else if (cats.length < 2) {
        bad("RP-08 零 effect 的回合在手机上还是空屏（模型跳没发进度）", JSON.stringify({ frames: mine.length, cats }));
      } else if (!cats.includes("model_reply")) {
        bad("RP-08 纯聊天的进度里应该有 model_reply 类", JSON.stringify(cats));
      } else {
        ok("RP-08 对照成立：零 effect 的纯聊天也有 " + cats.length + " 条进度（" + JSON.stringify([...new Set(cats)]) + "）——不是只有动了工具的回合才看得见");
      }
    }

    done("e2e_remote_progress_stream");
  } catch (err) {
    bad("unexpected error", err && (err.stack || err.message));
    done("e2e_remote_progress_stream");
  } finally {
    if (app) await app.close().catch(() => {});
    if (stub) {
      try {
        stub.kill();
      } catch (_) {}
    }
    await sleep(500);
    const left = countAppMains(UD);
    if (left > 0) killGateProcs(UD);
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
  }
})();

function filtFramesLabel(r) {
  return String(r.frames.length);
}
