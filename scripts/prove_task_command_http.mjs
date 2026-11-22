#!/usr/bin/env node
/* prove_task_command_http.mjs — P1 批 4:手机端「指挥」(插话 / 改向 / 刹停 / 换人)
 *
 * 方案:docs/design/p1-task-axis-and-mobile-command.md
 *   §3.2.1 新增路由的契约(逐条写死) · §3.2.2 聚合逻辑只留一份
 *   §3.2.3 刹停的跨实例问题(必须单独解决) · §3.2.4 改向的「立刻重跑」
 *   §4「批 4 · 手机端「指挥」」
 *
 * 这一门钉的是**手机端真的能指挥这台机器上的团队** —— 而且是**真 HTTP**。
 *
 * 五条判据(方案 §4 批 4 的验收):
 *   · 断言 ①(TC-20) 插话:真起一轮 → 手机端 POST /steer ⇒ **共享板**里出现该条
 *     且群里转录出现 task_state/steered;
 *   · 断言 ③(TC-21) 改向:POST /replan ⇒ 转录出现 task_state/replanned、Task 实体更新,
 *     而且**真的重跑了**(新的一轮 bot_reply 真的出现了);
 *   · 断言 ⑤(TC-22) 刹停:**真跑一轮**(不是 stub)再真取消 ⇒ {"ok":true,"cancelled":1},
 *     且那张卡从「在跑」掉出去;
 *   · 跨实例(TC-22/TC-23) 注入的是**同一个 surface 实例** ⇒ HTTP 侧发出的取消
 *     命中桌面主进程那份「在跑的任务表」;
 *   · 负向(TC-24..TC-28) 不带设备签名 ⇒ 401 且**不产生任何 effect**
 *     (钉「没有状态」,不只是看错误文案)。
 *
 * 变异对照(判据必须**有牙**,只改副本、源文件一个字节不动):
 *   ①(TC-40) HTTP 侧换成另一套聚合 ⇒ 清单一致性断言必须判红;
 *   ②(TC-41) 不起服务只测函数 ⇒ 「真起服务」断言必须判红;
 *   ③(TC-42) 把设备签名校验去掉/改错 ⇒ 未签名请求必须被判红**且不产生 effect**。
 *
 * 数据隔离:门禁**只**用临时目录当数据根(BITBOT_DATA_ROOT 等价的隔离根),
 * 用户真实的 data/desktop/{rooms,tasks}.json 一个字节都不碰(TC-50 盯着)。
 * 端口随机(先确认可绑再起)⇒ 门禁可重入。
 *
 * 用法:
 *   node scripts/prove_task_command_http.mjs
 *   BITBOT_TASK_COMMAND_SKIP_INJ=1 node scripts/prove_task_command_http.mjs  # 只跑主断言
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const SELF = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);
const RUN_INJECTIONS = process.env.BITBOT_TASK_COMMAND_SKIP_INJ !== "1";

let PASS = 0;
let FAIL = 0;
let SKIP = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (id, m, d) => {
  FAIL++;
  console.log("  ✗ [" + id + "] " + m + (d ? " — " + String(d).slice(0, 400) : ""));
};
const skip = (id, m, why) => { SKIP++; console.log("  · [" + id + "] SKIP " + m + " — " + why); };

/* 本门声明的断言编号 —— 矩阵按这份清单**逐条**锚点(AC-02 的编号族对账)。
   清单与实现漂了就红:check() 逐条核对「用的编号在不在清单里」,
   收尾再核对「清单里的每个编号都真的被用到了」。 */
const CLAIM_IDS = [
  "(head)", "TC-01", "TC-02", "TC-03", "TC-04", "TC-05",
  "TC-10", "TC-11", "TC-12", "TC-13",
  "TC-20", "TC-21", "TC-22", "TC-23", "TC-24", "TC-25", "TC-26", "TC-27", "TC-28", "TC-29", "TC-30",
  "TC-40", "TC-41", "TC-42", "TC-50",
];
const CLAIM_ID_SET = new Set(CLAIM_IDS.filter((x) => x !== "(head)"));
const usedIds = new Set();
const check = (id, cond, m, d) => {
  usedIds.add(id);
  if (!CLAIM_ID_SET.has(id)) {
    bad(id, "断言编号没登记在 CLAIM_IDS 里(清单与实现漂了)", m);
    return;
  }
  return cond ? ok("[" + id + "] " + m) : bad(id, m, d);
};
const done = (code) => {
  console.log("\nprove_task_command_http: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(code);
};

/* ── 产品源码 ─────────────────────────────────────────────────────────────── */
const SHARED = path.join(REPO, "hosts", "shared");
const INBOUND = path.join(SHARED, "cn_inbound_server.js");
const TASK_VIEW = path.join(SHARED, "task_view.js");
const MAIN = path.join(REPO, "hosts", "desktop", "main.js");
const readIf = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

/* ── 真 HTTP 往返 ───────────────────────────────────────────────────────── */
function httpRaw(port, method, urlPath, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const body = bodyStr === undefined || bodyStr === null ? "" : String(bodyStr);
    const h = Object.assign({}, headers || {});
    if (body) {
      h["content-type"] = h["content-type"] || "application/json";
      h["content-length"] = String(Buffer.byteLength(body));
    }
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method, headers: h },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* 非 JSON 就是非 JSON */ }
          resolve({
            viaNetwork: true,
            statusCode: res.statusCode,
            headers: res.headers,
            rawBody: raw,
            json,
            peerPort: req.socket && req.socket.remotePort,
            peerAddress: req.socket && req.socket.remoteAddress,
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** 找一个**现在**能绑的随机端口(先确认可绑,再关掉交给服务去绑)。 */
function pickBindablePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 夹具 ─────────────────────────────────────────────────────────────────
 * 一个群、两��成员。task_sig 的形状是 `<room_id>|<message_id>`(真形状,带 `|`)
 * ⇒ 手机端必须 encodeURIComponent 之后才能寻址(§3.2.1)。
 */
const ROOM_ID = "r-cmd";
const BOTS = {
  version: 1, primary_id: "b1",
  bots: [
    { id: "b1", name: "Alice", job: "research", description: "找资料", hidden: false },
    { id: "b2", name: "Bob", job: "write", description: "写稿子", hidden: false },
    { id: "b3", name: "Carol", job: "other", description: "不在这个群里", hidden: false },
  ],
};
const ROOMS = {
  version: 1,
  rooms: [{ id: ROOM_ID, title: "内容团队", members: ["b1", "b2"], created_at: "2026-11-21T10:00:00.000Z", transcript: [] }],
};

function makeSandbox(label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-task-cmd-" + label + "-"));
  fs.mkdirSync(path.join(tmp, "data", "desktop"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "data", "host"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "data", "desktop", "rooms.json"), JSON.stringify(ROOMS, null, 2));
  fs.writeFileSync(path.join(tmp, "data", "desktop", "bots.json"), JSON.stringify(BOTS, null, 2));
  fs.writeFileSync(path.join(tmp, "data", "desktop", "tasks.json"), JSON.stringify({ version: 1, tasks: [] }, null, 2));
  return tmp;
}

/** 用户真实数据目录的指纹(这两个目录是本门**有可能**碰到的全部)。 */
function userDataFingerprint() {
  const out = [];
  for (const rel of ["data/desktop", "data/host"]) {
    const abs = path.join(REPO, rel);
    let names = [];
    try { names = fs.readdirSync(abs).sort(); } catch { names = []; }
    for (const n of names) {
      const f = path.join(abs, n);
      let h = "";
      try { h = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"); } catch { h = "unreadable"; }
      out.push(rel + "/" + n + ":" + h);
    }
  }
  return out.join("\n");
}

/* ══════════════════════════════════════════════════════════════════════════
 * A. 静态断言:契约逐条写死在源码里
 * ══════════════════════════════════════════════════════════════════════════ */
console.log("── A. 静态:路由契约 / 鉴权 / 注入 / 错误码 ──");
{
  const srv = readIf(INBOUND);
  const tv = readIf(TASK_VIEW);
  const main = readIf(MAIN);

  check("TC-01", /require\("\.\/task_view"\)/.test(srv),
    "TC-01 入站服务 require(\"./task_view\")(寻址契约与聚合只有一份)");
  check("TC-01", /taskView\.matchTaskSigRoute\(p\)/.test(srv),
    "TC-01 四条路由的寻址**委派**给共享模块(不许另抄一份正则)");
  check("TC-01", /steer\|replan\|cancel\|swap/.test(tv),
    "TC-01 共享模块里的路由正则认这四个动作");
  for (const act of ["steer", "replan", "cancel", "swap"]) {
    check("TC-01", srv.indexOf('action === "' + act + '"') >= 0,
      "TC-01 路由实现了 " + act);
  }

  check("TC-02", /verifyDeviceTurn\(deviceStoreNow\(\), req, raw, \{ nonceStore \}\)/.test(srv),
    "TC-02 控制面走设备签名鉴权(与 /v1/approvals、/v1/tasks 同构)");
  check("TC-02", /device_id: auth\.device_id/.test(srv),
    "TC-02 回执带上设备 id(与 §3.2.1 的形状一致)");

  check("TC-03", /const surface = opts\.surface \|\| createProductSurfaceRef/.test(srv),
    "TC-03 入站服务接受**注入的 surface**,没有注入才回落 createProductSurfaceRef");
  check("TC-03", /createCnInboundServer\(\{[\s\S]{0,400}?\bsurface,/.test(main),
    "TC-03 桌面主进程创建入站服务时把**同一份 surface** 注进去了(§3.2.3 (a))");

  /* 错误码:产品已有的码,一个不许自造。 */
  for (const code of ["task_sig_required", "room_id_required", "text_required", "task_required",
    "from_bot_required", "to_bot_required", "same_bot", "bot_not_found", "bot_not_in_room",
    "room_not_found", "no_running_task"]) {
    check("TC-04", srv.indexOf('"' + code + '"') >= 0 || srv.indexOf(code) >= 0,
      "TC-04 错误码 " + code + " 是产品自己的码(如实回,不编)");
  }
  check("TC-04", /function taskCommandStatus\(code\)/.test(srv),
    "TC-04 错误码 → HTTP 状态的映射在源码里写死(参数缺失 400 / 找不到 404 / 业务失败 409)");

  check("TC-05", /orchestrateRoom\(\{[\s\S]{0,200}?force: true/.test(srv),
    "TC-05 改向的「立刻重跑」在 HTTP 侧(§3.2.4:fire-and-forget 调 orchestrateRoom)");
  check("TC-05", /restarted\s*[:=]\s*true/.test(srv),
    "TC-05 回执写明 restarted(界面不说谎:有人重跑了)");
}

/* ══════════════════════════════════════════════════════════════════════════
 * B. 真起入站服务 + 真 HTTP
 * ══════════════════════════════════════════════════════════════════════════ */
console.log("── B. 真起入站服务 + 真 HTTP ──");
const TMP = makeSandbox("main");
const userBefore = userDataFingerprint();
let server = null;
let serverStatus = null;
let device = null;
let deviceKeys = null;
let taskView = null;
let surface = null;
let bearerToken = "task-cmd-bearer-" + "c".repeat(40);
let turns = 0;

try {
  deviceKeys = require(path.join(SHARED, "device_keys.js"));
  taskView = require(TASK_VIEW);
  const { createCnInboundServer } = require(INBOUND);
  const { createProductSurface } = require(path.join(REPO, "hosts", "desktop", "product_surface.js"));

  /* 登记一台设备(只有公钥进登记表;私钥留在门禁这边)。 */
  device = deviceKeys.generateDeviceKey({ kind: "android", name: "批 4 门禁" });
  const devicesPath = path.join(TMP, "data", "host", "devices.json");
  deviceKeys.saveDevices(devicesPath, {
    version: 1,
    devices: [{
      id: device.id, name: device.name, kind: device.kind,
      public_key_pem: device.public_key_pem,
      created_at: new Date().toISOString(), revoked_at: null,
    }],
  });

  /* 端口:随机 + **先确认可绑**(固定端口 ⇒ 门禁不可重入)。 */
  const port = await pickBindablePort();
  check("TC-29", port > 0, "TC-29 端口是随机的且事前确认可绑(" + port + ")");

  /* **桌面那一份 surface**(§3.2.3 (a)):入站服务与「桌面」共用同一实例。
     门禁里它扮演的就是「桌面主进程那份 surface」——
     刹停要命中的是它内存里那张「在跑的任务表」。 */
  surface = createProductSurface(TMP, { dataRoot: path.join(TMP, "data") });
  const fastRunner = async (botId) => {
    turns += 1;
    return { ok: true, text: "[" + botId + "] 第 " + turns + " 棒" };
  };
  surface.setRoomRuntimeDeps({ runResponderTurn: fastRunner });

  server = createCnInboundServer({
    repoRoot: TMP,
    port,
    host: "127.0.0.1",
    devicesPath,
    turnToken: bearerToken,
    surface, /* ← 注入同一份实例 */
  });
  serverStatus = await server.start();
  check("TC-29", serverStatus && serverStatus.listening === true && serverStatus.port === port,
    "TC-29 入站服务真的在监听(127.0.0.1:" + (serverStatus && serverStatus.port) + ")",
    JSON.stringify(serverStatus));

  /* 设备签名头(每次换 nonce —— nonce 复用会被服务端拒)。
     签的是**请求体的字节**(与手机端 DeviceIdentity.requestHeaders 同一套口径)。 */
  const deviceHeadersFor = (bodyStr) => {
    const ts = String(Date.now());
    const nonce = "n-" + crypto.randomBytes(8).toString("hex");
    const buf = Buffer.from(String(bodyStr == null ? "" : bodyStr), "utf8");
    const sig = deviceKeys.signTurn(device.private_key_pem, device.id, ts, nonce, buf);
    return {
      "x-bitbot-device": device.id,
      "x-bitbot-timestamp": ts,
      "x-bitbot-nonce": nonce,
      "x-bitbot-signature": sig,
    };
  };
  const postSigned = (urlPath, bodyObj, extra) => {
    const bodyStr = JSON.stringify(bodyObj == null ? {} : bodyObj);
    const headers = Object.assign({}, deviceHeadersFor(bodyStr), extra || {});
    return httpRaw(serverStatus.port, "POST", urlPath, headers, bodyStr);
  };
  const getSigned = (urlPath, extra) =>
    httpRaw(serverStatus.port, "GET", urlPath, Object.assign({}, deviceHeadersFor(""), extra || {}), "");

  const readRooms = () => {
    const st = surface.roomsStoreStatus();
    const doc = (st && st.rooms) || {};
    const list = Array.isArray(doc.rooms) ? doc.rooms : [];
    return list.find((r) => r.id === ROOM_ID) || { id: ROOM_ID, transcript: [] };
  };
  const txRows = () => (readRooms().transcript || []);
  const boardPath = path.join(TMP, "data", "agents", "sections", ROOM_ID + ".json");
  const boardMessages = () => {
    try {
      const d = JSON.parse(fs.readFileSync(boardPath, "utf8"));
      return Array.isArray(d.messages) ? d.messages : [];
    } catch { return []; }
  };

  /* ── 真起一轮(不是 stub 数据:走产品的 orchestrateRoom)───────────────── */
  const SIG = ROOM_ID + "|msg-1";
  const run1 = await surface.orchestrateRoom({
    room: ROOM_ID, task: "整理热点稿", to: "b1,b2",
    message_id: "msg-1", deps: { runResponderTurn: fastRunner },
  });
  check("TC-10", run1 && run1.ok === true && run1.total === 2 && run1.returned === 2,
    "TC-10 真起一轮:两个成员各跑一棒,收齐 2/2", JSON.stringify(run1 && { ok: run1.ok, total: run1.total, returned: run1.returned }));
  check("TC-10", txRows().filter((e) => e && e.kind === "bot_reply").length === 2,
    "TC-10 群里落了 2 条 bot_reply");
  check("TC-10", txRows().some((e) => e && e.kind === "final_report" && e.task_sig === SIG),
    "TC-10 群里落了 final_report,且**带 task_sig**");
  check("TC-10", (surface.listTasks() || []).some((r) => String(r.id) === SIG),
    "TC-10 Task 实体落了一条同号记录");

  /* ── GET /v1/tasks:手机上先看得见 ── */
  const listRes = await getSigned("/v1/tasks");
  check("TC-11", listRes.statusCode === 200, "TC-11 GET /v1/tasks ⇒ 200", listRes.rawBody);
  const items = (listRes.json && listRes.json.tasks) || [];
  check("TC-11", items.length > 0, "TC-11 清单非空(否则「什么都没有」也能过)", String(items.length));
  const mine = items.find((x) => String(x.task_sig || "") === SIG);
  check("TC-11", !!mine, "TC-11 清单里有刚刚那一批(" + SIG + ")", JSON.stringify(items.map((x) => x.task_sig)));
  check("TC-11", mine && mine.can && mine.can.steer === true && mine.can.replan === true,
    "TC-11 can.steer / can.replan 由服务端算出来(有 task_sig 就能点)", JSON.stringify(mine && mine.can));
  check("TC-11", mine && mine.can && mine.can.swap === true,
    "TC-11 can.swap:成员行有 bot_id ⇒ 可换人", JSON.stringify(mine && mine.can));

  /* ── 清单与桌面指挥台**逐条一致**(同一份聚合,不许分叉)── */
  const roomsNow = surface.roomsStoreStatus().rooms.rooms || [];
  const recordsNow = surface.listTasks() || [];
  const desktopList = taskView.aggregate(roomsNow, recordsNow);
  check("TC-12", desktopList.length === items.length,
    "TC-12 条数一致(HTTP " + items.length + " / 桌面 " + desktopList.length + ")");
  for (let i = 0; i < Math.max(items.length, desktopList.length); i++) {
    const h = items[i] || {};
    const d = desktopList[i] || {};
    check("TC-12", String(h.task_sig || "") === String(d.task_sig || ""),
      "TC-12 第" + (i + 1) + "条 task_sig 一致", h.task_sig + " vs " + d.task_sig);
    check("TC-12", String(h.state || "") === String(d.state || ""),
      "TC-12 第" + (i + 1) + "条 state 一致", h.state + " vs " + d.state);
    check("TC-12", String(h.bucket || "") === String(d.bucket || ""),
      "TC-12 第" + (i + 1) + "条 bucket 一致", h.bucket + " vs " + d.bucket);
  }
  /* 批 3.5 的不变量在 HTTP 面上也必须成立:同一个 task_sig 只有一张卡。 */
  const sigCount = {};
  for (const t of desktopList) {
    const k = String(t.task_sig || "");
    sigCount[k] = (sigCount[k] || 0) + 1;
  }
  check("TC-13", (sigCount[SIG] || 0) === 1,
    "TC-13 同一个 task_sig 只有**一张**卡(批 3.5 的不变量)", JSON.stringify(sigCount));
  const card = desktopList.find((t) => String(t.task_sig || "") === SIG);
  check("TC-13", card && String(card.state || "") === "done",
    "TC-13 那张卡的 state 取自 Task 实体(不是空串)", JSON.stringify(card && { state: card.state, bucket: card.bucket }));

  /* ── 断言 ①:插话 ────────────────────────────────────────────────────── */
  {
    const before = { tx: txRows().length, board: boardMessages().length };
    const res = await postSigned("/v1/tasks/" + encodeURIComponent(SIG) + "/steer",
      { room_id: ROOM_ID, text: "先看数据再下结论" });
    check("TC-20", res.statusCode === 200, "TC-20 POST /steer ⇒ 200", res.rawBody);
    check("TC-20", res.json && res.json.ok === true && res.json.action === "steer",
      "TC-20 回执形状对(ok + action)", res.rawBody);
    check("TC-20", res.json && res.json.scope === "next_hop" && res.json.current_turn_sees === false,
      "TC-20 回执如实带着诚实边界(下一棒看得见、当前这轮看不见)", res.rawBody);
    const steered = txRows().find((e) => e && e.kind === "task_state" && e.state === "steered"
      && String(e.text || "").indexOf("先看数据再下结论") >= 0);
    check("TC-20", !!steered, "TC-20 群里转录出现了 task_state/steered", JSON.stringify(txRows().slice(-3)));
    check("TC-20", steered && String(steered.task_sig || "") === SIG,
      "TC-20 那条 steered 行带着 task_sig(知道是哪一批)", JSON.stringify(steered && steered.task_sig));
    const board = boardMessages();
    check("TC-20", board.length > before.board && board.some((m) => String(m.body || "").indexOf("先看数据再下结论") >= 0),
      "TC-20 **共享板**里出现该条(下一棒真的看得见)", JSON.stringify(board.slice(-2)));
  }

  /* ── 断言 ③:改向(转录/Task 状态确实更新 + 真的重跑了)───────────────── */
  {
    const beforeReplies = txRows().filter((e) => e && e.kind === "bot_reply").length;
    const recBefore = (surface.listTasks() || []).find((r) => String(r.id) === SIG) || {};
    const res = await postSigned("/v1/tasks/" + encodeURIComponent(SIG) + "/replan",
      { room_id: ROOM_ID, task: "Alice 改写成交付稿" });
    check("TC-21", res.statusCode === 200, "TC-21 POST /replan ⇒ 200", res.rawBody);
    check("TC-21", res.json && res.json.ok === true && res.json.restarted === true,
      "TC-21 回执写明 restarted", res.rawBody);
    const replanned = txRows().find((e) => e && e.kind === "task_state" && e.state === "replanned");
    check("TC-21", !!replanned, "TC-21 转录出现 task_state/replanned", JSON.stringify(txRows().slice(-4)));
    const recAfter = (surface.listTasks() || []).find((r) => String(r.id) === SIG) || {};
    check("TC-21", String(recAfter.task || "") === "Alice 改写成交付稿",
      "TC-21 Task 实体的目标确实更新了", JSON.stringify({ before: recBefore.task, after: recAfter.task }));
    /* 真的重跑了:重跑是 fire-and-forget ⇒ 等它落盘(有界等待)。
       窗口给得宽(机器忙的时候机器上别的门也在跑)—— 但**有界**:等不到就是红,
       绝不无限等。 */
    let after = beforeReplies;
    for (let i = 0; i < 150; i++) {
      after = txRows().filter((e) => e && e.kind === "bot_reply").length;
      if (after > beforeReplies) break;
      await sleep(100);
    }
    check("TC-21", after > beforeReplies,
      "TC-21 **真的重跑了**:重跑那一轮真的落下了新的 bot_reply(" + beforeReplies + " → " + after + ")",
      JSON.stringify(txRows().slice(-4)));
  }

  /* ── 换人 ───────────────────────────────────────────────────────────── */
  {
    const res = await postSigned("/v1/tasks/" + encodeURIComponent(SIG) + "/swap",
      { room_id: ROOM_ID, from_bot: "b1", to_bot: "b2" });
    check("TC-23", res.statusCode === 200, "TC-23 POST /swap ⇒ 200", res.rawBody);
    check("TC-23", res.json && res.json.ok === true && res.json.from_bot === "b1" && res.json.to_bot === "b2",
      "TC-23 回执说清「谁换成谁」", res.rawBody);
    check("TC-23", res.json && res.json.scope === "next_hop",
      "TC-23 回执如实带着诚实边界(换的是下一棒)", res.rawBody);
    check("TC-23", txRows().some((e) => e && e.kind === "task_state" && e.state === "reassigned"
      && String(e.from_bot || "") === "b1" && String(e.to_bot || "") === "b2"),
      "TC-23 转录出现 task_state/reassigned", JSON.stringify(txRows().slice(-3)));
    /* 负向:换成不在群里的人 ⇒ 409 bot_not_in_room(不假装换成了) */
    const bad = await postSigned("/v1/tasks/" + encodeURIComponent(SIG) + "/swap",
      { room_id: ROOM_ID, from_bot: "b1", to_bot: "b3" });
    check("TC-25", bad.statusCode === 409 && bad.json && bad.json.error === "bot_not_in_room",
      "TC-25 负向:换成不在群里的人 ⇒ 409 bot_not_in_room", bad.rawBody);
    check("TC-25", bad.json && bad.json.ok === false,
      "TC-25 负向:回执明确说没成功(不假装换成了)", bad.rawBody);
  }

  /* ── 断言 ⑤:刹停(**真跑一轮**再真取消)──────────────────────────────── */
  {
    const SIG2 = ROOM_ID + "|msg-2";
    let slowTurns = 0;
    const slowRunner = async (botId, prompt, ctx) => {
      slowTurns += 1;
      await sleep(1200);
      if (ctx && typeof ctx.isCancelled === "function" && ctx.isCancelled()) {
        throw new Error("cancelled_by_user_stop");
      }
      return { ok: true, text: "[慢跑] " + botId };
    };
    /* 起一轮**真的在跑**的(不是 stub 数据):编排进行中 ⇒ 那张「在跑的任务表」里有它。 */
    const running = surface.orchestrateRoom({
      room: ROOM_ID, task: "慢活儿", to: "b1",
      message_id: "msg-2", deps: { runResponderTurn: slowRunner },
    });
    let isRunning = false;
    let memberStarted = false;
    /* 等两件事都成立:**在跑**（surface 的「在跑的任务表」里有它）**且**
       **成员回合真的开始了**（runner 已被调用）。
       —— 两件事的先后不固定（scope 先登记、回合后起），所以要一起等，
          只等其中一件会偶发地判错(机器忙的时候更明显)。 */
    for (let i = 0; i < 150; i++) {
      isRunning = surface.taskIsRunning(SIG2);
      memberStarted = slowTurns > 0;
      if (isRunning && memberStarted) break;
      await sleep(50);
    }
    check("TC-22", isRunning,
      "TC-22 那一轮**真的在跑**(桌面那份 surface 的「在跑的任务表」里有它)");
    check("TC-22", memberStarted, "TC-22 成员回合真的在执行(不是 stub 数据)", String(slowTurns));

    const res = await postSigned("/v1/tasks/" + encodeURIComponent(SIG2) + "/cancel",
      { room_id: ROOM_ID, reason: "user_stop" });
    check("TC-22", res.statusCode === 200, "TC-22 POST /cancel ⇒ 200", res.rawBody);
    check("TC-22", res.json && res.json.ok === true && res.json.cancelled === 1,
      "TC-22 回执就是 {\"ok\":true,\"cancelled\":1}(真取消,不是 stub)", res.rawBody);
    check("TC-22", surface.taskIsRunning(SIG2) === false,
      "TC-22 取消之后那一轮**不在跑**了");

    /* 负向:对不在跑的任务再点 ⇒ 409 no_running_task(不假装停掉了什么) */
    const again = await postSigned("/v1/tasks/" + encodeURIComponent(SIG2) + "/cancel",
      { room_id: ROOM_ID });
    check("TC-24", again.statusCode === 409 && again.json && again.json.error === "no_running_task",
      "TC-24 负向:对不在跑的任务再点 ⇒ 409 no_running_task", again.rawBody);

    /* 那张卡从「在跑」掉出去(Task 实体的状态变了 ⇒ 桶不再是 working)。 */
    await Promise.race([running, sleep(8000)]);
    await sleep(200);
    const rec = (surface.listTasks() || []).find((r) => String(r.id) === SIG2) || {};
    /* 诚实:实体里的最终 state 由**那一轮收尾的 final_report** 决定 ——
       刹停之后,那一轮仍会写一条 partial 的 final_report ⇒ 实体的 state 落成
       "done"(把先前的 "cancelled" 覆盖掉)。这是**既有行为**(桌面那条 IPC 路一样),
       批 4 不改四动作的语义 ⇒ 这里只断言「已收口」,并把覆盖这件事如实记在报告里。
       真正可审计的落点是群里那条 task_state/cancelled(下一条断言钉它)。 */
    check("TC-22", ["cancelled", "done"].includes(String(rec.state || "")),
      "TC-22 Task 实体的状态是「已收口」(cancelled/done)", JSON.stringify({ id: rec.id, state: rec.state }));
    const listAfter = taskView.aggregate(surface.roomsStoreStatus().rooms.rooms || [], surface.listTasks() || []);
    const card2 = listAfter.find((t) => String(t.task_sig || "") === SIG2);
    check("TC-22", card2 && card2.bucket !== "working",
      "TC-22 那张卡从「在跑」掉出去了(bucket=" + (card2 && card2.bucket) + ")",
      JSON.stringify(card2 && { bucket: card2.bucket, state: card2.state }));
    check("TC-22", txRows().some((e) => e && e.kind === "task_state" && e.state === "cancelled"
      && String(e.task_sig || "") === SIG2),
      "TC-22 群里落了 task_state/cancelled(可审计)", JSON.stringify(txRows().slice(-3)));
  }

  /* ── 负向:参数缺失(错误码如实回)───────────────────────────────────── */
  {
    const noText = await postSigned("/v1/tasks/" + encodeURIComponent(SIG) + "/steer", { room_id: ROOM_ID });
    check("TC-26", noText.statusCode === 400 && noText.json && noText.json.error === "text_required",
      "TC-26 空话 ⇒ 400 text_required", noText.rawBody);
    const noTask = await postSigned("/v1/tasks/" + encodeURIComponent(SIG) + "/replan", { room_id: ROOM_ID });
    check("TC-26", noTask.statusCode === 400 && noTask.json && noTask.json.error === "task_required",
      "TC-26 空目标 ⇒ 400 task_required", noTask.rawBody);
    const noRoom = await postSigned("/v1/tasks/" + encodeURIComponent(SIG) + "/steer", { text: "x" });
    check("TC-26", noRoom.statusCode === 400 && noRoom.json && noRoom.json.error === "room_id_required",
      "TC-26 没有群号 ⇒ 400 room_id_required(写不了可审计的转录行就不许写)", noRoom.rawBody);
  }

  /* ── 负向:**不带设备签名** ⇒ 401 且**不产生任何 effect** ────────────── */
  {
    const before = {
      tx: JSON.stringify(txRows()),
      board: JSON.stringify(boardMessages()),
      tasks: JSON.stringify(surface.listTasks() || []),
    };
    const unsigned = await httpRaw(serverStatus.port, "POST",
      "/v1/tasks/" + encodeURIComponent(SIG) + "/steer",
      { "content-type": "application/json" },
      JSON.stringify({ room_id: ROOM_ID, text: "未签名的插话" }));
    check("TC-27", unsigned.statusCode === 401,
      "TC-27 不带设备签名 ⇒ 401(控制面只认设备签名)", String(unsigned.statusCode));
    check("TC-27", unsigned.json && unsigned.json.ok === false
      && !!unsigned.json.error_description && !!unsigned.json.next_step,
      "TC-27 401 回执带 error_description / next_step(不裸返回 code)", unsigned.rawBody);
    const after = {
      tx: JSON.stringify(txRows()),
      board: JSON.stringify(boardMessages()),
      tasks: JSON.stringify(surface.listTasks() || []),
    };
    check("TC-27", after.tx === before.tx,
      "TC-27 未签名请求**没有产生任何转录行**(钉「没有状态」,不只是看错误文案)");
    check("TC-27", after.board === before.board,
      "TC-27 未签名请求**没有写共享板**");
    check("TC-27", after.tasks === before.tasks,
      "TC-27 未签名请求**没有改 Task 实体**");

    /* 只带共享 bearer ⇒ 401(控制面不回落共享令牌)。 */
    const bearerOnly = await httpRaw(serverStatus.port, "POST",
      "/v1/tasks/" + encodeURIComponent(SIG) + "/steer",
      { "content-type": "application/json", authorization: "Bearer " + bearerToken },
      JSON.stringify({ room_id: ROOM_ID, text: "只带 bearer 的插话" }));
    check("TC-28", bearerOnly.statusCode === 401,
      "TC-28 只带 bearer ⇒ 401(不回落共享令牌)", String(bearerOnly.statusCode));
    check("TC-28", JSON.stringify(txRows()) === before.tx,
      "TC-28 只带 bearer 的请求同样**没有产生任何 effect**");
  }

  /* ── task_sig 的寻址契约(含 `|` ⇒ 必须 encodeURIComponent)──────────── */
  {
    const enc = encodeURIComponent(SIG);
    check("TC-30", enc.indexOf("%7C") >= 0, "TC-30 task_sig 里的 `|` 被编码成 %7C", enc);
    const hit = await postSigned("/v1/tasks/" + enc + "/steer", { room_id: ROOM_ID, text: "编码后的插话" });
    check("TC-30", hit.statusCode === 200, "TC-30 编码后的路径能命中路由", hit.rawBody);
    check("TC-30", hit.json && String(hit.json.task_sig || "") === SIG,
      "TC-30 服务端解出来的 task_sig 与原值**一字不差**", hit.rawBody);
    /* 解不开的百分号编码 ⇒ 解码回空串 ⇒ 如实回 task_sig_required(不半解、不崩)。 */
    const broken = await postSigned("/v1/tasks/%E0%A4%A/steer", { room_id: ROOM_ID, text: "x" });
    check("TC-30", broken.statusCode === 400 && broken.json && broken.json.error === "task_sig_required",
      "TC-30 畸形编码 ⇒ 400 task_sig_required(不半解)", broken.rawBody);
    const deep = await postSigned("/v1/tasks/" + enc + "/steer/extra", { room_id: ROOM_ID, text: "x" });
    check("TC-30", deep.statusCode === 404, "TC-30 反向:多带一段路径 ⇒ 404", String(deep.statusCode));
    /* 裸 `|` 的路径服务端也认(解出来是同一个 task_sig)—— 这是服务端的宽容,
       **不是**「可以不编码」:`|` 不是 URL 路径的合法字符,中间任何一层代理
       都可能拒它 ⇒ 手机端**必须** encodeURIComponent(§3.2.1)。 */
    const rawPipe = await postSigned("/v1/tasks/" + SIG + "/steer", { room_id: ROOM_ID, text: "裸竖线" });
    check("TC-30", rawPipe.statusCode === 200 && rawPipe.json && String(rawPipe.json.task_sig || "") === SIG,
      "TC-30 裸 `|` 的路径服务端也解得出同一个 task_sig(宽容;客户端仍必须编码)", rawPipe.rawBody);
  }

  /* ── 断言 ③(真 HTTP 往返的传输层证据)───────────────────────────────── */
  {
    const res = await getSigned("/v1/tasks");
    check("TC-29", res.viaNetwork === true, "TC-29 清单是走网络拿到的(有 socket 往返)");
    check("TC-29", typeof res.rawBody === "string" && res.rawBody.length > 0,
      "TC-29 回执是一段**原始 HTTP body 文本**(直接调函数拿到的是对象)");
    check("TC-29", !!(res.headers && res.headers["content-length"]) &&
      String(res.headers["content-type"] || "").includes("application/json"),
      "TC-29 回执带 HTTP 层的头(content-length / content-type)");
    check("TC-29", res.peerPort === serverStatus.port && res.peerAddress === "127.0.0.1",
      "TC-29 响应的对端就是**服务自己在监听的那个端口**(" + res.peerPort + ")",
      JSON.stringify({ peerPort: res.peerPort, serverPort: serverStatus.port }));
    const deadPort = await pickBindablePort();
    let deadFailed = false;
    try { await httpRaw(deadPort, "GET", "/v1/tasks", {}, ""); } catch (e) { deadFailed = true; }
    check("TC-29", deadFailed, "TC-29 对照:连一个没人监听的端口**必须失败**(门禁不会把「拿不到」当通过)");
  }
} catch (e) {
  bad("TC-29", "门禁自己的运行时炸了(这不是产品缺陷,是门坏了)", (e && e.stack) || e);
} finally {
  if (server) { try { await server.stop(); } catch { /* 收尾 */ } }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 收尾 */ }
}

/* ── 隔离:用户真实数据目录一个字节没动 ── */
check("TC-50", userDataFingerprint() === userBefore,
  "TC-50 用户真实数据目录(data/desktop、data/host)一个字节没动(门禁跑在隔离数据根里)");

/* ══════════════════════════════════════════════════════════════════════════
 * C. 变异对照:判据必须**有牙**
 * ══════════════════════════════════════════════════════════════════════════ */
console.log("── C. 变异对照(判据有没有牙)──");

/** 造一个「产品副本」:hosts/shared 真复制,hosts/desktop 软链(desktop 不用改)。 */
function makeProductCopy(label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-task-cmd-mut-" + label + "-"));
  fs.mkdirSync(path.join(tmp, "hosts"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
  fs.cpSync(SHARED, path.join(tmp, "hosts", "shared"), { recursive: true });
  fs.symlinkSync(path.join(REPO, "hosts", "desktop"), path.join(tmp, "hosts", "desktop"), "dir");
  fs.copyFileSync(SELF, path.join(tmp, "scripts", "prove_task_command_http.mjs"));
  return tmp;
}

function runMutated(dir, label) {
  const r = spawnSync(process.execPath, [path.join(dir, "scripts", "prove_task_command_http.mjs")], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { BITBOT_TASK_COMMAND_SKIP_INJ: "1" }),
    timeout: 240000,
  });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const failedIds = new Set();
  for (const m of out.matchAll(/✗ \[([A-Z]+-\d+)\]/g)) failedIds.add(m[1]);
  console.log("    · " + label + " ⇒ rc=" + r.status + " 红断言: " +
    (failedIds.size ? [...failedIds].join(",") : "（无 —— 判据没牙！）"));
  return { rc: r.status, out, failedIds };
}

if (!RUN_INJECTIONS) {
  console.log("  · 变异对照已按 BITBOT_TASK_COMMAND_SKIP_INJ=1 跳过");
  done(FAIL ? 1 : 0);
} else {
  /* ① 聚合逻辑改一份:HTTP 侧不读 Task 实体 ⇒ 手机与桌面显示不同。 */
  {
    const dir = makeProductCopy("inj1");
    const victim = path.join(dir, "hosts", "shared", "cn_inbound_server.js");
    let src = fs.readFileSync(victim, "utf8");
    const before = src;
    src = src.replace(
      "const tasks = taskView.aggregate(rooms, records);",
      "const tasks = taskView.aggregate(rooms, []); /* 变异:HTTP 侧不读 Task 实体 ⇒ 另一套真相 */",
    );
    if (src === before) {
      bad("TC-40", "变异①没打上(产品源码形状变了 ⇒ 变异对照失效)", "找不到注入点");
    } else {
      fs.writeFileSync(victim, src);
      const r = runMutated(dir, "① HTTP 侧换成另一套聚合(不读 Task 实体)");
      check("TC-40", r.rc !== 0, "TC-40 变异①:门禁必须判红(rc≠0)", String(r.rc));
      check("TC-40", r.failedIds.has("TC-12"),
        "TC-40 变异①:红的必须是清单一致性那条(TC-12)", [...r.failedIds].join(","));
      check("TC-40", !r.failedIds.has("TC-29"),
        "TC-40 变异①:传输层那条(TC-29)不该红 —— 红的确实是「两边分叉」", [...r.failedIds].join(","));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ② 不起服务只测函数:把「真 HTTP 往返」换成直接调函数 ⇒ 「真起服务」必须判红。 */
  {
    const dir = makeProductCopy("inj2");
    const victim = path.join(dir, "scripts", "prove_task_command_http.mjs");
    let src = fs.readFileSync(victim, "utf8");
    const before = src;
    const seam = "    const res = await getSigned(\"/v1/tasks\");";
    if (!src.includes(seam)) {
      bad("TC-41", "变异②没打上(门禁源码形状变了 ⇒ 变异对照失效)", "找不到注入点");
    } else {
      src = src.replace(seam, [
        "    /* 变异:不起服务,只测函数 —— 直接调共享聚合,不经过 HTTP。 */",
        "    const directItems = taskView.aggregate(surface.roomsStoreStatus().rooms.rooms || [], surface.listTasks() || [])",
        "      .map((t) => taskView.toTaskListItem(t, { updated_at: \"\" }));",
        "    const res = { viaNetwork: false, statusCode: 200, headers: { \"content-type\": \"application/json\" },",
        "      rawBody: JSON.stringify({ ok: true, device_id: \"direct\", count: directItems.length, tasks: directItems }),",
        "      json: { ok: true, device_id: \"direct\", count: directItems.length, tasks: directItems }, peerPort: null, peerAddress: null };",
      ].join("\n"));
      fs.writeFileSync(victim, src);
      const r = runMutated(dir, "② 不起服务、只测函数");
      check("TC-41", r.rc !== 0, "TC-41 变异②:门禁必须判红(rc≠0)", String(r.rc));
      check("TC-41", r.failedIds.has("TC-29"),
        "TC-41 变异②:红的必须是「必须真起服务 + 真 HTTP」那条(TC-29)", [...r.failedIds].join(","));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ③ 把设备签名校验去掉 ⇒ 未签名请求必须被判红**且不产生 effect**。 */
  {
    const dir = makeProductCopy("inj3");
    const victim = path.join(dir, "hosts", "shared", "cn_inbound_server.js");
    let src = fs.readFileSync(victim, "utf8");
    const before = src;
    const anchor = "const cmdRoute = taskView.matchTaskSigRoute(p);";
    const at = src.indexOf(anchor);
    if (at < 0) {
      bad("TC-42", "变异③没打上(产品源码形状变了 ⇒ 变异对照失效)", "找不到注入点");
    } else {
      const head = src.slice(0, at);
      let tail = src.slice(at);
      const gate = "if (!auth.ok) {";
      const gi = tail.indexOf(gate);
      if (gi < 0) {
        bad("TC-42", "变异③没打上(产品源码形状变了 ⇒ 变异对照失效)", "找不到鉴权判断");
      } else {
        tail = tail.slice(0, gi) + "if (false) { /* 变异:去掉设备签名校验 */" + tail.slice(gi + gate.length);
        fs.writeFileSync(victim, head + tail);
        const r = runMutated(dir, "③ 去掉设备签名校验");
        check("TC-42", r.rc !== 0, "TC-42 变异③:门禁必须判红(rc≠0)", String(r.rc));
        check("TC-42", r.failedIds.has("TC-27"),
          "TC-42 变异③:红的必须是「未签名 ⇒ 401 且无 effect」那条(TC-27)", [...r.failedIds].join(","));
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ── 编号清单不许有悬空项 ── */
for (const id of CLAIM_ID_SET) {
  if (!usedIds.has(id)) {
    FAIL++;
    console.log("  ✗ CLAIM_IDS 里声明了 " + id + " 但门里没有任何一条断言用它(悬空锚点)");
  }
}

done(FAIL ? 1 : 0);
