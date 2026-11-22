#!/usr/bin/env node
/* prove_task_view_http.mjs — P1 批 3:共享聚合 + 手机端「看」(GET /v1/tasks)
 *
 * 方案:docs/design/p1-task-axis-and-mobile-command.md
 *   §3.2.1 新增路由的契约(逐条写死) · §3.2.2 聚合逻辑只留一份(不许平行数据源)
 *   §4「批 3 · 抽出共享聚合 + 手机端「看」」
 *
 * 这一门钉的是**一条契约**:手机上看到的任务清单,必须与桌面指挥台看到的
 * **逐条一致** —— 不是「差不多」,是同一条、同一顺序、同一批字段。
 * 一旦两边分叉(桌面在跑、手机上看不到),用户就不知道该信谁,而且没人会发现。
 *
 * 三条判据的分工:
 *   · 断言 ①(TV-14) 清单逐条一致 —— 真起入站服务、真打 HTTP,拿回来的清单
 *     与桌面指挥台用**同一份 fixture** 算出来的清单逐条比(条数/顺序/每条字段)。
 *   · 断言 ③(TV-18) **必须真起一个入站服务再打 HTTP** —— 只测函数不算数。
 *     证据是「响应的对端端口 == 服务自己说在监听的端口」+ 原始 body 文本 +
 *     HTTP 层头 + 一个「连关着的端口必须失败」的对照。
 *   · 负向对照(变异) —— 判据必须**有牙**:把产品副本改坏(源文件一个字节不动),
 *     同一把尺必须判红:
 *       ①(TV-20) HTTP 侧换成另一套聚合(桌面侧不变)⇒ 断言 ① 必须红。
 *       ②(TV-21) 不起服务、只测函数 ⇒ 断言 ③ 必须红。
 *
 * 数据隔离:门禁**只**用临时目录当数据根(BITBOT_DATA_ROOT + repoRoot=TMP),
 * 用户真实的 data/desktop/{rooms,tasks}.json 一个字节都不碰(TV-19 盯着)。
 * 端口随机(先确认可绑再起),不写死 ⇒ 门禁可重入。
 *
 * 用法:
 *   node scripts/prove_task_view_http.mjs
 *   BITBOT_TASK_VIEW_SKIP_INJ=1 node scripts/prove_task_view_http.mjs  # 只跑主断言
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
const RUN_INJECTIONS = process.env.BITBOT_TASK_VIEW_SKIP_INJ !== "1";

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
   AC-02 认编号的形状是「逗号 + 引号」(,\s*"([A-Z][A-Z0-9]*-\d{2}[a-z]?)"),
   所以清单第一项前面得有个占位,否则第一个编号认不到。
   这份清单**不是装饰**:check() 逐条核对「用的编号在不在清单里」,
   收尾再核对「清单里的每个编号都真的被用到了」—— 清单与实现漂了就红。 */
const CLAIM_IDS = ["(head)", "TV-01", "TV-02", "TV-03", "TV-04", "TV-10", "TV-11", "TV-12", "TV-13", "TV-14", "TV-15", "TV-16", "TV-17", "TV-18", "TV-19", "TV-20", "TV-21"];
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
  console.log("\nprove_task_view_http: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(code);
};

/* ── 产品源码 ─────────────────────────────────────────────────────────────── */
const SHARED = path.join(REPO, "hosts", "shared");
const TASK_VIEW = path.join(SHARED, "task_view.js");
const INBOUND = path.join(SHARED, "cn_inbound_server.js");
const INDEX_HTML = path.join(REPO, "hosts", "desktop", "index.html");
const readIf = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

/* ── 真 HTTP 往返(带传输层证据)────────────────────────────────────────────
 * viaNetwork / peerPort / rawBody 这三样只有**真的走了一次 socket**才有:
 * 直接调函数拿到的对象里根本没有它们 ⇒ 变异对照②(只测函数)会被这一段抓住。
 */
function httpGetJson(port, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method: "GET", headers: headers || {} },
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

/* ── 夹具:同一份 rooms + tasks,两个面各读各的 ────────────────────────────
 * 夹具刻意覆盖:① 一个群里两段 bot_reply(并行)+ 一行 final_report;
 * ② 一个 confirm_request(要你拍板);③ 一段没有 task_sig 的 bot_reply(从转录推「在跑」);
 * ④ Task 实体里有一条**转录已滚出**的批次(只有实体有)⇒ 桌面会补一张「仅记录」卡;
 * ⑤ Task 实体里有一条与转录**同一个 task_sig** 的记录(实体状态优先于转录推导)。
 * 全部 task_sig 都是 `<room_id>|<message_id>` 的真形状(含 `|`)。
 */
const NOW = "2026-11-21T12:00:00.000Z";
const FIXTURE_ROOMS = {
  version: 1,
  rooms: [
    {
      id: "r-done",
      title: "内容团队",
      members: ["t1", "t2"],
      transcript: [
        { kind: "bot_reply", room_id: "r-done", speaker: "t1", bot_id: "t1", name: "Alice", task_sig: "r-done|msg-1", text: "热点已收集", at: "2026-11-21T10:00:00.000Z" },
        { kind: "bot_reply", room_id: "r-done", speaker: "t2", bot_id: "t2", name: "Bob", task_sig: "r-done|msg-1", text: "初稿已成", at: "2026-11-21T10:01:00.000Z" },
        { kind: "final_report", room_id: "r-done", task: "整理热点稿", task_title: "整理热点稿", task_sig: "r-done|msg-1", responders: ["t1", "t2"], total: 2, returned: 2, partial: false, artifacts: [], at: "2026-11-21T10:10:00.000Z" },
      ],
    },
    {
      id: "r-ask",
      title: "待拍板群",
      members: ["t3"],
      transcript: [
        { kind: "confirm_request", room_id: "r-ask", speaker: "host", stage: "route", question: "该谁做?", candidates: ["t1"], task: "今天天气", task_sig: "r-ask|msg-2", at: "2026-11-21T11:00:00.000Z" },
      ],
    },
    {
      id: "r-run",
      title: "在跑群",
      members: ["t4"],
      transcript: [
        { kind: "bot_reply", room_id: "r-run", speaker: "t4", bot_id: "t4", name: "Carol", text: "正在写第一段…", at: "2026-11-21T12:00:00.000Z" },
      ],
    },
  ],
};
const FIXTURE_TASKS = {
  version: 1,
  tasks: [
    { id: "r-done|msg-1", room_id: "r-done", state: "done", task: "整理热点稿", title: "整理热点稿", total: 2, returned: 2, partial: false, created_at: "2026-11-21T10:00:00.000Z", updated_at: "2026-11-21T10:05:00.000Z" },
    { id: "r-gone|msg-9", room_id: "r-gone", state: "waiting", task: "转录已滚出的那批", title: "转录已滚出的那批", total: 1, returned: 0, partial: true, created_at: "2026-11-21T08:00:00.000Z", updated_at: "2026-11-21T09:00:00.000Z" },
  ],
};

/** 建一份隔离的数据根(repoRoot 也在临时目录里 ⇒ 入站服务自己的日志/队列也落在临时目录)。 */
function makeSandbox(label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-task-view-" + label + "-"));
  fs.mkdirSync(path.join(tmp, "data", "desktop"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "data", "host"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "data", "desktop", "rooms.json"), JSON.stringify(FIXTURE_ROOMS, null, 2));
  fs.writeFileSync(path.join(tmp, "data", "desktop", "tasks.json"), JSON.stringify(FIXTURE_TASKS, null, 2));
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
 * A. 静态断言:唯一一份聚合、没有平行数据源
 * ══════════════════════════════════════════════════════════════════════════ */
console.log("── A. 静态:唯一一份聚合 + 没有平行数据源 ──");
{
  const tv = readIf(TASK_VIEW);
  check("TV-01", tv.length > 0, "TV-01 共享模块 hosts/shared/task_view.js 在位");
  check("TV-01", /function cmdMergeTaskRecords\s*\(/.test(tv) && /function aggregateCommandTasks\s*\(/.test(tv),
    "TV-01 聚合与合并两份实现都在共享模块里");
  check("TV-01", /module\.exports\s*=\s*API/.test(tv) && /globalThis\.__bitbotTaskView\s*=\s*API/.test(tv),
    "TV-01 同一个文件同时给 Node(require)与浏览器(window)用(UMD 形态)");

  const html = readIf(INDEX_HTML);
  check("TV-02", !/\bfunction\s+aggregateCommandTasks\b/.test(html),
    "TV-02 index.html 里不再有 aggregateCommandTasks 的本地函数定义");
  check("TV-02", !/\bfunction\s+cmdMergeTaskRecords\b/.test(html),
    "TV-02 index.html 里不再有 cmdMergeTaskRecords 的本地函数定义");
  check("TV-02", /__bitbotTaskView\.aggregate\s*\(/.test(html),
    "TV-02 渲染层改成委派 window.__bitbotTaskView.aggregate(...)");
  check("TV-02", /<script src="\.\.\/shared\/task_view\.js"><\/script>/.test(html),
    "TV-02 index.html 用 <script src=\"../shared/task_view.js\"> 加载它");
  check("TV-02", /document\.write\('<script src="\.\/shared\/task_view\.js">/.test(html),
    "TV-02 打包态兜底也在(照抄 client_core / untrusted_fence 那套 document.write)");

  const srv = readIf(INBOUND);
  check("TV-03", /require\("\.\/task_view"\)/.test(srv), "TV-03 入站服务 require(\"./task_view\")(同一份模块)");
  check("TV-03", /p === "\/v1\/tasks"/.test(srv), "TV-03 路由 GET /v1/tasks 在位");
  check("TV-03", /verifyDeviceTurn/.test(srv), "TV-03 路由走设备签名鉴权");

  // 路由块里不许出现第二个数据源(自己读盘 / 另一个 json 路径)。
  const routeStart = srv.indexOf('if (p === "/v1/tasks")');
  const routeEnd = srv.indexOf("\n      if (p === ", routeStart + 10);
  const routeBlock = routeStart >= 0 ? srv.slice(routeStart, routeEnd > 0 ? routeEnd : routeStart + 4000) : "";
  check("TV-04", routeBlock.length > 0, "TV-04 路由块可定位");
  check("TV-04", /surface\.roomsStoreStatus\(\)/.test(routeBlock) && /surface\.listTasks\(\)/.test(routeBlock),
    "TV-04 路由只经 surface 读 rooms/tasks(与桌面 IPC 同一条读法)");
  check("TV-04", !/readFileSync|rooms\.json|tasks\.json/.test(routeBlock),
    "TV-04 路由块里没有自己读盘/另开 json 路径 ⇒ 没有平行数据源");
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
let desktopList = null;
let recordsById = null;
let httpRes = null;
let bearerToken = "task-view-bearer-" + "b".repeat(40);

try {
  deviceKeys = require(path.join(SHARED, "device_keys.js"));
  taskView = require(TASK_VIEW);
  const { createCnInboundServer } = require(INBOUND);
  const { createProductSurface } = require(path.join(REPO, "hosts", "desktop", "product_surface.js"));

  /* 登记一台设备(只有公钥进登记表;私钥留在门禁这边)。 */
  device = deviceKeys.generateDeviceKey({ kind: "android", name: "批 3 门禁" });
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
  check("TV-10", port > 0, "TV-10 端口是随机的且事前确认可绑(" + port + ")");

  server = createCnInboundServer({
    repoRoot: TMP,
    port,
    host: "127.0.0.1",
    devicesPath,
    turnToken: bearerToken,
  });
  serverStatus = await server.start();
  check("TV-10", serverStatus && serverStatus.listening === true && serverStatus.port === port,
    "TV-10 入站服务真的在监听(127.0.0.1:" + (serverStatus && serverStatus.port) + ")",
    JSON.stringify(serverStatus));

  /* 桌面指挥台那一侧:同一个 surface、同一份 fixture、同一个聚合函数。
     桌面 IPC 的 bitbot:rooms:list / bitbot:tasks:list 走的就是这两条读法。 */
  surface = createProductSurface(TMP, { dataRoot: path.join(TMP, "data") });
  const roomsStatus = surface.roomsStoreStatus();
  const roomsDoc = (roomsStatus && roomsStatus.rooms) || {};
  const rooms = Array.isArray(roomsDoc.rooms) ? roomsDoc.rooms : [];
  const records = surface.listTasks() || [];
  recordsById = {};
  for (const r of records) if (r && r.id) recordsById[String(r.id)] = r;
  desktopList = taskView.aggregate(rooms, records);
  check("TV-14", Array.isArray(desktopList) && desktopList.length > 0,
    "TV-14 桌面指挥台用同一份 fixture 算出了非空清单(" + (desktopList ? desktopList.length : 0) + " 条)");

  /* 设备签名头(每次换 nonce —— nonce 复用会被服务端拒)。 */
  const deviceHeaders = () => {
    const ts = String(Date.now());
    const nonce = "n-" + crypto.randomBytes(8).toString("hex");
    const sig = deviceKeys.signTurn(device.private_key_pem, device.id, ts, nonce, Buffer.from(""));
    return {
      "x-bitbot-device": device.id,
      "x-bitbot-timestamp": ts,
      "x-bitbot-nonce": nonce,
      "x-bitbot-signature": sig,
    };
  };

  /* ── 鉴权三档(§3.2.1:只认设备签名,不回落共享 bearer)── */
  const noAuth = await httpGetJson(serverStatus.port, "/v1/tasks", {});
  check("TV-11", noAuth.statusCode === 401, "TV-11 不带任何凭证 ⇒ 401", String(noAuth.statusCode));
  check("TV-11", noAuth.json && noAuth.json.ok === false && !Array.isArray(noAuth.json.tasks),
    "TV-11 401 的回执里**没有**任何任务清单(不泄露)", noAuth.rawBody);
  check("TV-11", !!(noAuth.json && noAuth.json.error_description && noAuth.json.next_step),
    "TV-11 401 回执带 error_description / next_step(不裸返回 code)", noAuth.rawBody);

  const bearerOnly = await httpGetJson(serverStatus.port, "/v1/tasks", {
    Authorization: "Bearer " + bearerToken,
  });
  check("TV-13", bearerOnly.statusCode === 401,
    "TV-13 登记表非空时,只带 bearer ⇒ 401(控制面不回落共享令牌)", String(bearerOnly.statusCode));
  check("TV-13", bearerOnly.json && bearerOnly.json.ok === false && !Array.isArray(bearerOnly.json.tasks),
    "TV-13 bearer 拿不到清单", bearerOnly.rawBody);

  /* ── 真 HTTP 往返拿清单 ── */
  httpRes = await httpGetJson(serverStatus.port, "/v1/tasks", deviceHeaders());
  check("TV-12", httpRes.statusCode === 200, "TV-12 带设备签名 ⇒ 200", httpRes.rawBody);
  check("TV-12", httpRes.json && httpRes.json.ok === true && Array.isArray(httpRes.json.tasks),
    "TV-12 回执形状对(ok + tasks[])", httpRes.rawBody);

  /* ── 断言 ③:必须是**真 HTTP 往返**,不是直接调函数 ── */
  check("TV-18", httpRes.viaNetwork === true, "TV-18 清单是走网络拿到的(有 socket 往返)");
  check("TV-18", typeof httpRes.rawBody === "string" && httpRes.rawBody.length > 0,
    "TV-18 回执是一段**原始 HTTP body 文本**(直接调函数拿到的是对象)");
  check("TV-18", !!(httpRes.headers && httpRes.headers["content-length"]) &&
    String(httpRes.headers["content-type"] || "").includes("application/json"),
    "TV-18 回执带 HTTP 层的头(content-length / content-type)");
  check("TV-18", httpRes.peerPort === serverStatus.port && httpRes.peerAddress === "127.0.0.1",
    "TV-18 响应的对端就是**服务自己在监听的那个端口**(" + httpRes.peerPort + ")",
    JSON.stringify({ peerPort: httpRes.peerPort, serverPort: serverStatus.port }));
  /* 对照:连一个确定没人监听的端口必须失败 —— 证明门禁「拿不到就当过了」是不成立的。 */
  const deadPort = await pickBindablePort();
  let deadFailed = false;
  try {
    await httpGetJson(deadPort, "/v1/tasks", {});
  } catch (e) {
    deadFailed = true;
  }
  check("TV-18", deadFailed, "TV-18 对照:连一个没人监听的端口**必须失败**(门禁不会把「拿不到」当通过)");

  /* ── 断言 ①:清单逐条一致 ── */
  const items = (httpRes.json && httpRes.json.tasks) || [];
  check("TV-14", httpRes.json && httpRes.json.count === items.length,
    "TV-14 count 与 tasks 长度一致", JSON.stringify({ count: httpRes.json && httpRes.json.count, len: items.length }));
  check("TV-14", items.length === desktopList.length,
    "TV-14 条数一致(HTTP " + items.length + " / 桌面 " + desktopList.length + ")");
  check("TV-14", items.length > 0, "TV-14 夹具非空(否则「两条都空」也能过 —— 那是恒真)");
  const sigsHttp = items.map((x) => String(x.task_sig || ""));
  const sigsDesk = desktopList.map((x) => String(x.task_sig || ""));
  check("TV-14", JSON.stringify(sigsHttp) === JSON.stringify(sigsDesk),
    "TV-14 task_sig 集合与**顺序**都一致", JSON.stringify({ http: sigsHttp, desk: sigsDesk }));

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (let i = 0; i < Math.max(items.length, desktopList.length); i++) {
    const h = items[i] || {};
    const d = desktopList[i] || {};
    const label = "TV-14 第" + (i + 1) + "条";
    check("TV-14", String(h.task_sig || "") === String(d.task_sig || ""), label + " task_sig 一致", h.task_sig + " vs " + d.task_sig);
    check("TV-14", String(h.room_id || "") === String(d.room_id || ""), label + " room_id 一致");
    check("TV-14", String(h.room_title || "") === String(d.room_title || ""), label + " room_title 一致");
    check("TV-14", String(h.bucket || "") === String(d.bucket || ""), label + " bucket 一致", h.bucket + " vs " + d.bucket);
    check("TV-14", String(h.state || "") === String(d.state || ""), label + " state 一致", h.state + " vs " + d.state);
    check("TV-14", String(h.task || "") === String(d.task || ""), label + " task 一致");
    check("TV-14", eq(h.members || [], d.members || []), label + " members 一致(逐个、含顺序)",
      JSON.stringify(h.members) + " vs " + JSON.stringify(d.members));
    const hSteps = (h.steps || []).map((s) => [s.name, s.bot_id, s.ok, s.text, s.error, s.at]);
    const dSteps = (d.steps || []).map((s) => [s.name, s.bot_id, s.ok, s.text, s.error, s.at]);
    check("TV-14", eq(hSteps, dSteps), label + " steps 一致(谁干了什么)",
      JSON.stringify(hSteps) + " vs " + JSON.stringify(dSteps));
    const hNeed = h.needs_you ? [h.needs_you.question, h.needs_you.candidates, h.needs_you.at] : null;
    const dNeed = d.needs_you ? [d.needs_you.question, d.needs_you.candidates, d.needs_you.at] : null;
    check("TV-14", eq(hNeed, dNeed), label + " needs_you 一致(要你拍板的那句)",
      JSON.stringify(hNeed) + " vs " + JSON.stringify(dNeed));
    check("TV-14", Number(h.total || 0) === Number(d.total || 0) && Number(h.returned || 0) === Number(d.returned || 0),
      label + " total / returned 一致");
    check("TV-14", (h.partial === true) === (d.partial === true), label + " partial 一致");
    check("TV-14", String(h.at || "") === String(d.at || ""), label + " at 一致");
    check("TV-14", (h.running === true) === (String(d.bucket || "") === "working"),
      label + " running 与桶一致(在跑 = 从转录推,不是看 state)");
    const wantUpdated = String((recordsById[String(d.task_sig || "")] || {}).updated_at || "");
    check("TV-14", String(h.updated_at || "") === wantUpdated,
      label + " updated_at 与 Task 实体一致", h.updated_at + " vs " + wantUpdated);
    /* can.*:服务端算的,规则与桌面按钮同一套(刹停看桶+sig,换人看成员 bot_id)。 */
    const dSteps2 = d.steps || [];
    const hasBotId = dSteps2.some((s) => String((s || {}).bot_id || "") !== "");
    const can = h.can || {};
    check("TV-15", can.cancel === (String(d.bucket || "") === "working" && !!String(d.task_sig || "")),
      label + " can.cancel 与桌面同一套规则(在跑 + 有 task_sig)");
    check("TV-15", can.swap === hasBotId, label + " can.swap 与桌面同一套规则(成员行有 bot_id)");
    check("TV-15", can.steer === !!String(d.task_sig || "") && can.replan === !!String(d.task_sig || ""),
      label + " can.steer / can.replan 需要 task_sig(没有 sig 时 product_surface 会回 task_sig_required)");
    const wantTitle = String(d.task_title || d.task ||
      (dSteps2.length ? String((dSteps2[0] || {}).text || "") : "") || d.room_title || "");
    check("TV-14", String(h.title || "") === wantTitle, label + " title 与桌面卡片标题同一套取值", h.title + " vs " + wantTitle);
  }

  /* 桶分布也要一样(条数一样但分布不同 ⇒ 也是分叉)。 */
  const bucketHttp = items.map((x) => String(x.bucket || "")).sort();
  const bucketDesk = desktopList.map((x) => String(x.bucket || "")).sort();
  check("TV-14", eq(bucketHttp, bucketDesk), "TV-14 桶分布一致",
    JSON.stringify(bucketHttp) + " vs " + JSON.stringify(bucketDesk));

  /* ── task_sig 的寻址契约(§3.2.1:含 `|` ⇒ 必须 encodeURIComponent)── */
  const sigWithPipe = sigsDesk.find((s) => s.includes("|"));
  check("TV-16", !!sigWithPipe, "TV-16 夹具里有一条带 `|` 的 task_sig", String(sigWithPipe));
  const encoded = taskView.encodeTaskSig(sigWithPipe);
  const hit = taskView.matchTaskSigRoute("/v1/tasks/" + encoded + "/steer");
  check("TV-16", !!hit && hit.sig === sigWithPipe && hit.action === "steer",
    "TV-16 encodeURIComponent 之后仍能命中路由并还原出同一个 task_sig", JSON.stringify(hit));
  const rawHit = taskView.matchTaskSigRoute("/v1/tasks/" + sigWithPipe + "/steer/extra");
  check("TV-16", rawHit === null,
    "TV-16 反向:多带一段路径 ⇒ **匹配不上**(不猜、不截断)", JSON.stringify(rawHit));
  check("TV-16", taskView.decodeTaskSig("%E0%A4%A") === "",
    "TV-16 反向:畸形的百分号编码 ⇒ 解码回空串(不抛、不半解)");
  check("TV-16", items.every((x) => !String(x.task_sig || "").includes("%")),
    "TV-16 回执里的 task_sig 是**原样**(没被提前 encode 过)");

  /* ── 没有任务时:count 0 / tasks [] ,不编一条 ── */
  fs.writeFileSync(path.join(TMP, "data", "desktop", "rooms.json"),
    JSON.stringify({ version: 1, rooms: [] }, null, 2));
  fs.writeFileSync(path.join(TMP, "data", "desktop", "tasks.json"),
    JSON.stringify({ version: 1, tasks: [] }, null, 2));
  const emptyRes = await httpGetJson(serverStatus.port, "/v1/tasks", deviceHeaders());
  check("TV-17", emptyRes.statusCode === 200, "TV-17 没有任务时仍回 200", String(emptyRes.statusCode));
  check("TV-17", emptyRes.json && emptyRes.json.ok === true &&
    emptyRes.json.count === 0 && Array.isArray(emptyRes.json.tasks) && emptyRes.json.tasks.length === 0,
    "TV-17 没有任务 ⇒ {ok:true,count:0,tasks:[]} ,**不编**一条", emptyRes.rawBody);
} catch (e) {
  bad("TV-10", "门禁自己的运行时炸了(这不是产品缺陷,是门坏了)", (e && e.stack) || e);
} finally {
  if (server) { try { await server.stop(); } catch { /* 收尾 */ } }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 收尾 */ }
}

/* ── 隔离:用户真实数据目录一个字节没动 ── */
check("TV-19", userDataFingerprint() === userBefore,
  "TV-19 用户真实数据目录(data/desktop、data/host)一个字节没动(门禁跑在隔离数据根里)");


/* ══════════════════════════════════════════════════════════════════════════
 * C. 变异对照:判据必须**有牙**
 *    做法:把产品副本(只改副本,源文件一个字节都不动)复制进临时目录,
 *          用**同一把尺**(同一份门禁脚本)跑,要求红的必须是那一条断言。
 * ══════════════════════════════════════════════════════════════════════════ */
console.log("── C. 变异对照(判据有没有牙)──");

/** 造一个「产品副本」:hosts/shared 真复制,hosts/desktop 软链(desktop 不用改)。 */
function makeProductCopy(label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-task-view-mut-" + label + "-"));
  fs.mkdirSync(path.join(tmp, "hosts"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
  fs.cpSync(SHARED, path.join(tmp, "hosts", "shared"), { recursive: true });
  fs.symlinkSync(path.join(REPO, "hosts", "desktop"), path.join(tmp, "hosts", "desktop"), "dir");
  fs.copyFileSync(SELF, path.join(tmp, "scripts", "prove_task_view_http.mjs"));
  return tmp;
}

function runMutated(dir, label) {
  const r = spawnSync(process.execPath, [path.join(dir, "scripts", "prove_task_view_http.mjs")], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { BITBOT_TASK_VIEW_SKIP_INJ: "1" }),
    timeout: 180000,
  });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const failedIds = new Set();
  for (const m of out.matchAll(/✗ \[([A-Z]+-\d+)\]/g)) failedIds.add(m[1]);
  console.log("    · " + label + " ⇒ rc=" + r.status + " 红断言: " +
    (failedIds.size ? [...failedIds].join(",") : "（无 —— 判据没牙！）"));
  return { rc: r.status, out, failedIds };
}

if (!RUN_INJECTIONS) {
  console.log("  · 变异对照已按 BITBOT_TASK_VIEW_SKIP_INJ=1 跳过");
  done(FAIL ? 1 : 0);
} else {
  /* ① 聚合逻辑改一份:HTTP 侧不用共享聚合(自己算)⇒ 桌面与手机显示不同。 */
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
      bad("TV-20", "变异①没打上(产品源码形状变了 ⇒ 变异对照失效)", "找不到注入点");
    } else {
      fs.writeFileSync(victim, src);
      const r = runMutated(dir, "① HTTP 侧换成另一套聚合(不读 Task 实体)");
      check("TV-20", r.rc !== 0, "TV-20 变异①:门禁必须判红(rc≠0)", String(r.rc));
      check("TV-20", r.failedIds.has("TV-14"),
        "TV-20 变异①:红的必须是断言 ①(清单逐条一致)", [...r.failedIds].join(","));
      check("TV-20", !r.failedIds.has("TV-18"),
        "TV-20 变异①:传输层那条(TV-18)不该红 —— 红的确实是「两边分叉」", [...r.failedIds].join(","));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ② 不起服务只测函数:把「真 HTTP 往返」换成直接调函数 ⇒ 断言 ③ 必须判红。 */
  {
    const dir = makeProductCopy("inj2");
    const victim = path.join(dir, "scripts", "prove_task_view_http.mjs");
    let src = fs.readFileSync(victim, "utf8");
    const before = src;
    const seam = "  httpRes = await httpGetJson(serverStatus.port, \"/v1/tasks\", deviceHeaders());";
    if (!src.includes(seam)) {
      bad("TV-21", "变异②没打上(门禁源码形状变了 ⇒ 变异对照失效)", "找不到注入点");
    } else {
      src = src.replace(seam, [
        "  /* 变异:不起服务,只测函数 —— 直接调共享聚合,不经过 HTTP。 */",
        "  const directItems = desktopList.map((t) => taskView.toTaskListItem(t, { updated_at: String((recordsById[String(t.task_sig || \"\")] || {}).updated_at || \"\") }));",
        "  httpRes = { viaNetwork: false, statusCode: 200, headers: { \"content-type\": \"application/json\" },",
        "    rawBody: JSON.stringify({ ok: true, device_id: \"direct\", count: directItems.length, tasks: directItems }),",
        "    json: { ok: true, device_id: \"direct\", count: directItems.length, tasks: directItems }, peerPort: null, peerAddress: null };",
      ].join("\n"));
      fs.writeFileSync(victim, src);
      const r = runMutated(dir, "② 不起服务、只测函数");
      check("TV-21", r.rc !== 0, "TV-21 变异②:门禁必须判红(rc≠0)", String(r.rc));
      check("TV-21", r.failedIds.has("TV-18"),
        "TV-21 变异②:红的必须是断言 ③(必须真起服务 + 真 HTTP)", [...r.failedIds].join(","));
      check("TV-21", !r.failedIds.has("TV-14"),
        "TV-21 变异②:清单本身仍然一致 ⇒ 红的**只有**传输层那一条(判据没被别的红盖住)", [...r.failedIds].join(","));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}


/* ── 编号清单不许有悬空项(声明了却没人用 = 矩阵锚了个寂寞)── */
for (const id of CLAIM_ID_SET) {
  if (!usedIds.has(id)) {
    FAIL++;
    console.log("  ✗ CLAIM_IDS 里声明了 " + id + " 但门里没有任何一条断言用它(悬空锚点)");
  }
}

done(FAIL ? 1 : 0);
