/* e2e_android_turn.mjs — 安卓「手机发消息 → 桌面大脑回话」这条真链路的门禁
 *
 * 为什么值得单独钉住：APK 里没有模型密钥，也不该有。手机唯一的产品路径是
 * POST Desktop 的 /v1/turn（ADR 0002 共享大脑 / ADR 0008 必须带 bearer）。
 * 这条链路一旦断，手机上看到的不是「功能降级」，而是整个产品走不通 ——
 * 而它在 CI 里最容易假绿：服务器起得来、请求发得出去、HTTP 200 都算「通」，
 * 只有把内核真的跑起来，才会发现手机被登记成一台不存在的机器。
 *
 * 实测的两个真问题（本门禁先复现，再修）：
 *   AND-03/04 Host 把远端机器 id 拼成 `android-inbound` / `ios-inbound`，
 *            而内核注册表里只有 desk-1 / phone-ios / phone-android
 *            （box_host/machines.mbt:87）。id 对不上 → 这台手机在内核里不存在。
 *   AND-05   因为 id 对不上，手机上点「Device tools」拿到 0 个工具：
 *            deviceLocalTools on android/android-inbound: 0
 *            deviceLocalTools on android/phone-android:   3 | camera=ready…
 *
 * AND-01/02 鉴权必须在内核之前：没带 / 带错 bearer → 401，且内核一次都没被唤起
 *            （不是「先跑再拒」，那等于给未鉴权的请求烧 CPU）。
 * AND-06   APK 发的 JSON 字段必须就是服务端认的字段 —— 两端各改各的时，
 *            编译不报错，只有真请求才炸。
 * AND-07   「凭证」面板必须能填 BITBOT_TURN_TOKEN：ADR 0008 之后不带 token
 *            永远 401，如果 UI 里只有配对地址，那用户在手机上没有任何自救入口。
 * AND-08   失败不许写成「(empty assistant — model credential stays on Desktop)」
 *            这种既有兜底又甩锅的话术；内核/Host 报什么就显示什么。
 * AND-09~12 「手机到底在不在线」必须是 Host 记下来的事实，而不是内核 seed() 的
 *            固定答案：过了鉴权的回合才记账（AND-12 401 不记账），证据过 TTL
 *            就是离线但要看得见最后出现时间（AND-11），从没说过的手机不许被点亮
 *            （AND-10）。桌面上的「多端花名册」读的就是这份回包。
 *
 * 跑法（不需要真机，也不需要 emulator）：
 *   node scripts/e2e_android_turn.mjs
 * 需要 moon（内核）在 PATH 上；缺 moon / 缺 Android 源码时诚实 SKIP，不假绿。
 */
import path from "path";
import fs from "fs";
import os from "os";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { spawnSync } from "child_process";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const ANDROID_SRC = path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host");

let PASS = 0,
  FAIL = 0,
  SKIP = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : ""));
};
const skip = (m) => {
  SKIP++;
  console.log("  - SKIP " + m);
};
const done = () => {
  console.log("e2e_android_turn: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

/* ---------- 前置：内核 + 源码在不在 ---------- */
const moonProbe = spawnSync("moon", ["version"], { encoding: "utf8" });
const hasMoon = moonProbe.status === 0;
if (!hasMoon) {
  skip("moon 不在 PATH（缺内核，跑不了真回合）");
  done();
}
if (!fs.existsSync(path.join(ANDROID_SRC, "TurnBridge.kt"))) {
  skip("Android 源码缺失");
  done();
}

const TURN_TOKEN = "gate-android-turn-token-0f3a";

/* ---------- 隔离仓库根：内核照跑，数据写到临时目录 ---------- */
const isoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-e2e-android-"));
fs.symlinkSync(path.join(REPO, "cmd"), path.join(isoRoot, "cmd"), "dir");
for (const d of ["data/desktop", "data/host", "data/journal"]) {
  fs.mkdirSync(path.join(isoRoot, d), { recursive: true });
}

const { createCnInboundServer } = require(path.join(REPO, "hosts/shared/cn_inbound_server.js"));
const { createProductOnTurn } = require(path.join(REPO, "hosts/shared/cn_inbound_product_on_turn.js"));
const { createTurnRunner } = require(path.join(REPO, "hosts/shared/run_moon_turn.js"));
const presenceMod = require(path.join(REPO, "hosts/shared/machine_presence.js"));

const realOnTurn = createProductOnTurn(isoRoot);

/*
 * NEG_CONTROL=1 —— 尺子的负向对照（证明本门禁不是恒真装饰）：
 *   1) 退回旧写法 machineId = `${machineKind}-inbound`（内核注册表里没这台机器）
 *      → AND-03/04/05 必须翻红；
 *   2) 把 presence 合并改成「全部点亮」（假装所有设备在线）
 *      → AND-10/11 必须翻红。
 * 这两处正是本轮修复前后的真实差异，红得有价值，不是为反而反。
 */
const NEG = process.env.NEG_CONTROL === "1";
let productOnTurn;
if (NEG) {
  const legacy = createTurnRunner(isoRoot);
  productOnTurn = async (prompt, meta) => {
    const machineKind = (meta && meta.machine_kind) || "desktop";
    return legacy.runTurn(String(prompt || ""), {
      sessionId: (meta && meta.session_id) || "cn-neg",
      machineId: machineKind === "desktop" ? "desk-1" : `${machineKind}-inbound`,
      machineKind,
      channel: "",
      approved: false,
    });
  };
  const realMerge = presenceMod.mergePresenceIntoMachines;
  presenceMod.mergePresenceIntoMachines = (root, machines, opts) => {
    const out = realMerge(root, machines, opts);
    return {
      online: out.machines.map((m) => m.id),
      machines: out.machines.map((m) => ({
        ...m,
        status: "connected",
        last_seen: m.last_seen || new Date().toISOString(),
        presence_evidence: "seen_within_ttl",
      })),
    };
  };
  console.log("e2e_android_turn: NEG_CONTROL=1（退回旧机器 id + 全点亮 presence，断言必须翻红）");
} else {
  productOnTurn = realOnTurn;
}

const wakes = [];
const onTurn = async (prompt, meta) => {
  wakes.push({ prompt: String(prompt || ""), meta: meta || {} });
  return productOnTurn(prompt, meta);
};

const server = createCnInboundServer({
  repoRoot: isoRoot,
  port: 0,
  host: "127.0.0.1",
  turnToken: TURN_TOKEN,
  onTurn,
});

/** 完全按 APK（TurnBridge.runTurnHttp）的姿势发：同样的路径、字段、Bearer。 */
let PORT = 0;
function postTurn({ token, body }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        method: "POST",
        path: "/v1/turn",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": payload.length,
        },
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
            /* 保留原文给断言报错用 */
          }
          resolve({ status: res.statusCode, text: out, json });
        });
      },
    );
    if (token) req.setHeader("Authorization", "Bearer " + token);
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** Host 回执里那台被内核认下的机器：command = `kind|hostId|rows…` */
function hostMachineId(json, kind) {
  const hrs = (json && json.host_results) || [];
  const hit = hrs.find((h) => h && h.kind === kind);
  if (!hit) return null;
  const parts = String(hit.command || "").split("|");
  return parts[1] || null;
}

/** device_tools_list 的 stdout 里带着真实 machine_id 和工具表 */
function deviceToolsPayload(json) {
  const hrs = (json && json.host_results) || [];
  const hit = hrs.find((h) => h && h.kind === "device_tools_list");
  if (!hit) return null;
  try {
    return JSON.parse(hit.stdout || "null");
  } catch {
    return null;
  }
}

/** machines_list 的 Host 回包里的花名册行（在线状态的唯一可见来源）。 */
function machineRowsFromResponse(json) {
  const hrs = (json && json.host_results) || [];
  const hit = hrs.find((h) => h && h.kind === "machines_list");
  if (!hit) return [];
  try {
    const p = JSON.parse(hit.stdout || "{}");
    return Array.isArray(p.machines) ? p.machines : [];
  } catch {
    return [];
  }
}

const presencePath = () => path.join(isoRoot, "data", "machines", "presence.json");
function readPresence() {
  try {
    return JSON.parse(fs.readFileSync(presencePath(), "utf8")).machines || {};
  } catch {
    return {};
  }
}
function writePresence(root, machines) {
  const p = path.join(root, "data", "machines", "presence.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ updated_at: new Date().toISOString(), machines }, null, 2));
}
function assistantOf(json) {
  const msgs = (json && json.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i] && msgs[i].role === "assistant" && String(msgs[i].text || "").trim()) {
      return String(msgs[i].text);
    }
  }
  return "";
}

/* ---------- 开跑 ---------- */
server
  .start()
  .then(async (st) => {
    PORT = st.port;
    console.log("e2e_android_turn: Desktop 大脑在 127.0.0.1:" + PORT);

    /* AND-01 不带 Authorization：401，而且内核一次都没被唤起 */
    {
      const before = wakes.length;
      const r = await postTurn({ body: { text: "ListMachines", machine_kind: "android", session_id: "android-app" } });
      const woke = wakes.length - before;
      if (r.status === 401 && woke === 0) ok("AND-01 无 bearer → HTTP 401 且内核未唤起");
      else bad("AND-01 无 bearer → 401 + 不唤起内核", "status=" + r.status + " wakes+" + woke + " " + r.text.slice(0, 120));
    }

    /* AND-02 带错 token：401 invalid_token，同样不许先跑内核 */
    {
      const before = wakes.length;
      const r = await postTurn({ token: "wrong-token", body: { text: "ListMachines", machine_kind: "android", session_id: "android-app" } });
      const woke = wakes.length - before;
      if (r.status === 401 && r.json && r.json.error === "invalid_token" && woke === 0) {
        ok("AND-02 错 token → 401 invalid_token 且内核未唤起");
      } else {
        bad("AND-02 错 token → 401 invalid_token", "status=" + r.status + " err=" + (r.json && r.json.error) + " wakes+" + woke);
      }
    }

    /* AND-03 带对 token 的安卓回合：200 + 有 assistant + 内核认下的机器是 phone-android */
    {
      const r = await postTurn({ token: TURN_TOKEN, body: { text: "ListMachines", machine_kind: "android", session_id: "android-app" } });
      const hostId = hostMachineId(r.json, "machines_list");
      if (r.status !== 200 || !r.json || r.json.ok !== true) {
        bad("AND-03 安卓 ListMachines 走通 200", "status=" + r.status + " " + r.text.slice(0, 200));
      } else if (!assistantOf(r.json)) {
        bad("AND-03 安卓 ListMachines 有 assistant 回复", "messages=" + JSON.stringify((r.json.messages || []).map((m) => m && m.role)));
      } else if (hostId !== "phone-android") {
        bad(
          "AND-03 内核认下的机器是 phone-android（不是 android-inbound）",
          "host_id=" + hostId + " — 这台机器不在内核注册表里（box_host/machines.mbt 只有 desk-1/phone-ios/phone-android），手机上任何按机器 id 的动作都会落到一台不存在的设备",
        );
      } else {
        ok("AND-03 安卓 ListMachines → 200 + assistant + phone-android");
      }
    }

    /* AND-04 iOS 同理：phone-ios */
    {
      const r = await postTurn({ token: TURN_TOKEN, body: { text: "ListMachines", machine_kind: "ios", session_id: "ios-app" } });
      const hostId = hostMachineId(r.json, "machines_list");
      if (r.status === 200 && hostId === "phone-ios") ok("AND-04 iOS 回合 → phone-ios");
      else bad("AND-04 iOS 回合内核机器 id 应为 phone-ios", "host_id=" + hostId);
    }

    /* AND-05 手机上点「Device tools」必须真的列出本机工具，而不是 0 个 */
    {
      const r = await postTurn({ token: TURN_TOKEN, body: { text: "device tools", machine_kind: "android", session_id: "android-app" } });
      const p = deviceToolsPayload(r.json);
      const tools = (p && p.tools) || [];
      if (r.status !== 200) {
        bad("AND-05 device tools HTTP 200", "status=" + r.status);
      } else if (!p || tools.length === 0) {
        bad("AND-05 安卓设备工具非空（camera/microphone/notifications）", "machine_id=" + (p && p.machine_id) + " tools=" + JSON.stringify(tools));
      } else if (p.machine_id !== "phone-android") {
        bad("AND-05 设备工具挂在正确的手机上", "machine_id=" + p.machine_id);
      } else {
        ok("AND-05 安卓设备工具列到真机器上的 " + tools.length + " 个工具");
      }
    }

    /* AND-09 过了鉴权的安卓回合 = 这台手机真的存在过的证据，Host 必须记下来 */
    {
      const p = readPresence(isoRoot);
      const row = p["phone-android"];
      if (!row || !row.last_seen || row.source !== "v1_turn") {
        bad("AND-09 鉴权过的 /v1/turn 写入多端在线凭据", "presence=" + JSON.stringify(row || null));
      } else {
        ok("AND-09 手机说过话 → presence.json 有 phone-android 证据");
      }
    }

    /* AND-10/11 桌面问花名册时：证据在 TTL 内才算在线，过期的不许点亮 */
    {
      // 夹具：phone-ios 的证据是 2 小时前（离线），phone-android 的证据抹掉（从没说过话）。
      writePresence(isoRoot, {
        "phone-ios": { id: "phone-ios", kind: "ios", last_seen: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), source: "v1_turn", turns: 3 },
      });
      const r = await postTurn({ token: TURN_TOKEN, body: { text: "ListMachines", machine_kind: "desktop", session_id: "desk-chat" } });
      const rows = machineRowsFromResponse(r.json);
      const ios = rows.find((m) => m.id === "phone-ios") || {};
      const android = rows.find((m) => m.id === "phone-android") || {};
      if (String(ios.status || "").toLowerCase() === "connected") {
        bad("AND-11 过期证据不许显示在线", "phone-ios.status=" + ios.status + " last_seen=" + ios.last_seen);
      } else if (!ios.last_seen || ios.presence_evidence !== "stale") {
        bad("AND-11 过期机器要看得见「什么时候最后出现过」", "row=" + JSON.stringify(ios));
      } else if (String(android.status || "").toLowerCase() === "connected" || android.last_seen) {
        bad("AND-10 没有任何证据的手机不许被点亮", "row=" + JSON.stringify(android));
      } else {
        ok("AND-10/11 在线状态只认 Host 证据：过期→离线且带时间戳，无证据→不点亮");
      }
    }

    /* AND-12 401 不记账：否则任何扫端口的人都能点亮花名册 */
    {
      const before = JSON.stringify(readPresence(isoRoot));
      await postTurn({ body: { text: "ListMachines", machine_kind: "android", session_id: "attacker" } });
      const after = JSON.stringify(readPresence(isoRoot));
      if (before === after) ok("AND-12 未鉴权请求不写在线凭据");
      else bad("AND-12 未鉴权请求不该产生在线证据", "presence 被改了");
    }

    /* AND-06 APK 发的字段 == 服务端认的字段（两端漂移只有真请求才炸） */
    {
      const kt = fs.readFileSync(path.join(ANDROID_SRC, "TurnBridge.kt"), "utf8");
      const js = fs.readFileSync(path.join(REPO, "hosts/shared/cn_inbound_server.js"), "utf8");
      const sentKeys = ["text", "machine_kind", "session_id"].filter((key) =>
        new RegExp('put\\("' + key + '"').test(kt),
      );
      const bearerSent = /Authorization"\s*,\s*"Bearer /.test(kt) || /setRequestProperty\("Authorization", "Bearer/.test(kt);
      const serverAccepts =
        /payload\.machine_kind|\(payload\.machine_kind\b/.test(js) &&
        /payload\.session_id|payload\.sessionId/.test(js) &&
        /payload\.text/.test(js);
      if (sentKeys.length === 3 && bearerSent && serverAccepts) ok("AND-06 APK↔Host 线路契约一致（3 字段 + Bearer）");
      else bad("AND-06 APK↔Host 线路契约", "sent=" + sentKeys.join(",") + " bearer=" + bearerSent + " serverAccepts=" + serverAccepts);
    }

    /* AND-07 「凭证」面板必须能填 turn token：否则 401 之后用户在手机上无路可走 */
    {
      const main = fs.readFileSync(path.join(ANDROID_SRC, "MainActivity.kt"), "utf8");
      const sheet = main.slice(main.indexOf("if (showCredentials)"));
      const bindsToken = /setTurnToken\(/.test(sheet) && /tokenDraft/.test(sheet);
      if (bindsToken) ok("AND-07 「凭证」面板可填 BITBOT_TURN_TOKEN");
      else bad("AND-07 「凭证」面板缺 turn token 输入", "sheet 里 setTurnToken=" + /setTurnToken\(/.test(sheet) + " tokenDraft=" + /tokenDraft/.test(sheet));
    }

    /* AND-08 失败不许被兜底话术盖住 */
    {
      const main = fs.readFileSync(path.join(ANDROID_SRC, "MainActivity.kt"), "utf8");
      if (/empty assistant — model credential stays on Desktop/.test(main)) {
        bad("AND-08 失败必须显示内核/Host 的真实原因，不能写死「(empty assistant — model credential stays on Desktop)」");
      } else {
        ok("AND-08 失败回执走真实错误，没有写死的甩锅文案");
      }
    }
  })
  .catch((err) => {
    bad("e2e_android_turn 运行异常", err && err.stack ? err.stack : err);
  })
  .finally(() => {
    try {
      server.stop && server.stop();
    } catch {
      /* http server 关闭失败不影响结论 */
    }
    try {
      fs.rmSync(isoRoot, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
    done();
  });
