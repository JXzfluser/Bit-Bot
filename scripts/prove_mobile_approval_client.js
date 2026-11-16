#!/usr/bin/env node
"use strict";

/**
 * prove_mobile_approval_client —— 手机端「能批」的客户端,口径必须与服务端一致
 *
 * 现场:手机端只能**显示**审批卡(`approval_card` widget),**点不动**。
 * 用户用手机发指令、Bot 要外发 ⇒ 审批卡弹在手机上 ⇒ 人得跑到电脑前点。
 * ⇒ 手机场景断在这里(不是死锁:桌面/Box 上的人能批,但手机上不行)。
 *
 * iOS/Android 两侧的客户端是**手抄**端点与字段名的 —— 手抄的东西天然会漂。
 * 所以这道门把两边的抄写**钉在服务端源码的字面量上**:
 *   1. 端点路径:客户端拼的必须与服务端 `cn_inbound_server.js` 里的路由一致;
 *   2. 字段名:客户端读的每一个字段,服务端响应里必须真的有;
 *   3. 决定语义:allow_once / always / always+scope:wide / deny —— 三档对齐;
 *   4. 真跑一次 `GET /v1/approvals`(带设备签名)—— 证明端点与方法真的对。
 *
 * ⚠️ 诚实的边界:沙箱里**没有 Swift/Kotlin 编译器**,所以本门不能证明
 * 原生代码能编译。它保证的是「原生侧抄的端点与字段名没和服务端漂」。
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };
const check = (cond, m, d) => { if (cond) ok(m); else bad(m, d); };

const REPO = path.resolve(__dirname, "..");
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

/**
 * 剥掉注释行再抠字面量。
 *
 * 为什么必须:第一版没剥,正则抠到了**注释里**的 `{host}/v1/approvals`
 * ⇒ 门禁被文档文字骗过去(源码里其实写的是另一个样子)。
 * ⇒ 注释里的字面量**不算**代码里的字面量。
 */
const codeOnly = (src) =>
  String(src || "")
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t.startsWith("//")) return false;   // Swift /// 与 Kotlin //
      if (t.startsWith("*")) return false;    /* 块注释的续行 */
      if (t.startsWith("/*") || t.startsWith("*/")) return false;
      return true;
    })
    .join("\n");
// 负向段跑在**副本**上 ⇒ 源文件永不被改(理由见 DI 门禁的同一段注释)。
const IOS_SRC_DIR =
  process.env.BITBOT_IOS_SRC_DIR ||
  path.join(REPO, "hosts/ios/BitBotHost/Sources/BitBotHost");
const swift = read(path.join(IOS_SRC_DIR, "ApprovalClient.swift"));
const kotlin = read(path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/ApprovalClient.kt"));
const server = read(path.join(REPO, "hosts/shared/cn_inbound_server.js"));
// 决定词表的**真源**在桌面 product surface(approvalDecide 的入参校验),
// 不在 cn_inbound_server —— 门禁要落在真源上。
const surface = read(path.join(REPO, "hosts/desktop/product_surface.js"));

console.log("prove_mobile_approval_client（手机端审批客户端口径）");

check(swift.length > 0, "MA-1 iOS 侧有 ApprovalClient.swift");
check(kotlin.length > 0, "MA-1 Android 侧有 ApprovalClient.kt");
check(server.length > 0, "MA-1 服务端源码在");

// ---------------------------------------------------------------- 1. 端点路径
// 路径规整:去掉前导斜杠(两端拼法不同:iOS 用 appendingPathComponent,
// Android 用字符串拼接)⇒ 比的是**规整后**的形状,不是拼法。
const normPath = (s) => String(s || "").replace(/^\/+/, "");
check(server.indexOf('"/v1/approvals"') >= 0, "MA-2 服务端有 GET /v1/approvals 这条路由");
{
  // 服务端路由是写在正则里的:`/^\/v1\/approvals\/([^/]+)\/decide$/`
  const m = server.match(/\/v1\\\/approvals\\\/\(\[\^\/\]\+\)\\\/decide/);
  check(!!m, "MA-2 服务端有 POST /v1/approvals/<id>/decide 这条路由");
}
const swiftCode = codeOnly(swift);
const kotlinCode = codeOnly(kotlin);
const iosListPath = (swiftCode.match(/appendingPathComponent\("([^"]*approvals[^"]*)"\)/) || [])[1];
const ktListPath = (kotlinCode.match(/["']([^"']*approvals[^"']*)["']/) || [])[1];
check(normPath(iosListPath) === "v1/approvals", "MA-2 iOS 请求的是 v1/approvals",
  "抠出来:" + iosListPath);
check(normPath(ktListPath) === "v1/approvals", "MA-2 Android 请求的是 v1/approvals",
  "抠出来:" + ktListPath);
for (const [name, src] of [["iOS", swiftCode], ["Android", kotlinCode]]) {
  check(src.indexOf("decide") >= 0, "MA-2 " + name + " 客户端拼了 /decide 这一段(代码里,不是注释里)");
  check(
    src.indexOf("v1/approvals") >= 0 && src.indexOf("decide") >= 0,
    "MA-2 " + name + " 的 decide 路径与服务端同形",
  );
}

// ---------------------------------------------------------------- 2. 字段名
// 服务端列表响应里真的有哪些字段
const listBlock = (server.match(/const rows = pending\.map\([\s\S]{0,1200}?note:/m) || [""])[0];
check(listBlock.length > 0, "MA-3 抠到了服务端列表响应的构造块");
for (const f of ["id", "kind", "command", "source", "requested_at", "expires_at", "status"]) {
  check(listBlock.indexOf(f) >= 0, "MA-3 服务端列表响应真的有字段:" + f);
}
for (const [name, src] of [["iOS", swiftCode], ["Android", kotlinCode]]) {
  for (const f of ["id", "kind", "command", "source", "requested_at", "expires_at", "status"]) {
    check(src.indexOf('"' + f + '"') >= 0, "MA-3 " + name + " 读了字段:" + f);
  }
}
for (const f of ["persisted_pattern", "persisted_scope", "note"]) {
  check(server.indexOf(f) >= 0, "MA-4 服务端决定响应真的有字段:" + f);
}
for (const [name, src] of [["iOS", swiftCode], ["Android", kotlinCode]]) {
  for (const f of ["persisted_pattern", "persisted_scope", "note"]) {
    check(src.indexOf('"' + f + '"') >= 0, "MA-4 " + name + " 读了字段:" + f);
  }
}

// ---------------------------------------------------------------- 3. 决定语义
// 词表真源:服务端 product_surface.js 里那行 ["allow_once", "always", "deny"]
const srvVocab = (surface.match(/\["allow_once",\s*"always",\s*"deny"\]/) || [])[0];
check(!!srvVocab, "MA-5 抠到了服务端的决定词表真源", surface.indexOf("allow_once"));
const SERVER_VOCAB = ["allow_once", "always", "deny"];
for (const [name, src] of [["iOS", swiftCode], ["Android", kotlinCode]]) {
  // 客户端自己声明词表 ⇒ 门禁做**三方**比对(服务端 / iOS / Android),
  // 不是"客户端里出现过这个词就算数"。
  for (const w of SERVER_VOCAB) {
    check(
      src.indexOf('"' + w + '"') >= 0,
      "MA-5 " + name + " 的决定词表含:" + w,
    );
  }
  check(src.indexOf('"wide"') >= 0, "MA-5 " + name + " 宽授权要显式 scope:wide");
  check(
    /wide\s*&&\s*decision\s*==\s*"always"/.test(src),
    "MA-5 " + name + " 宽授权**只**在 always 时才生效(不给 deny/allow_once 开口子)",
  );
  // 词表里不许出现服务端不认的词
  const quoted = src.match(/"(allow_[a-z_]+|always|deny|wide)"/g) || [];
  const clientVocab = Array.from(new Set(quoted.map((q) => q.replace(/"/g, ""))));
  const unknown = clientVocab.filter(
    (w) => SERVER_VOCAB.indexOf(w) < 0 && w !== "wide",
  );
  check(unknown.length === 0, "MA-5 " + name + " 的词表里没有服务端不认的词",
    JSON.stringify(unknown));
}
check(server.indexOf("wide") >= 0, "MA-5 服务端认 scope:wide");

// ---------------------------------------------------------------- 4. 真跑一次端点
(async function runLive() {
  const { createCnInboundServer } = require("../hosts/shared/cn_inbound_server");
  const deviceKeys = require("../hosts/shared/device_keys");
  const dataRoot = path.join(REPO, ".ma-probe-" + process.pid);
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(dataRoot, "host"), { recursive: true });
  const device = deviceKeys.generateDeviceKey({ kind: "ios", name: "手机" });
  const devicesPath = path.join(dataRoot, "host", "devices.json");
  deviceKeys.saveDevices(devicesPath, {
    version: 1,
    devices: [
      {
        id: device.id,
        name: device.name,
        kind: device.kind,
        public_key_pem: device.public_key_pem,
        created_at: device.created_at,
        revoked_at: null,
      },
    ],
  });
  const server2 = createCnInboundServer({
    repoRoot: dataRoot,
    port: 0,
    devicesPath,
    onTurn: async () => ({ ok: true, messages: [], host_results: [], stdout: "" }),
  });
  const info = await server2.start();
  const port = Number(info.port);
  try {
    const body = Buffer.alloc(0);
    const ts = String(Date.now());
    const nonce = "ios-probe-nonce";
    const sig = deviceKeys.signTurn(device.private_key_pem, device.id, ts, nonce, body);
    const res = await new Promise((resolve) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/v1/approvals",
          method: "GET",
          headers: {
            accept: "application/json",
            "x-bitbot-device": device.id,
            "x-bitbot-timestamp": ts,
            "x-bitbot-nonce": nonce,
            "x-bitbot-signature": sig,
          },
        },
        (r) => {
          const c = [];
          r.on("data", (x) => c.push(x));
          r.on("end", () =>
            resolve({ status: r.statusCode, body: Buffer.concat(c).toString("utf8") }),
          );
        },
      );
      req.on("error", (e) => resolve({ status: 0, body: String(e.message) }));
      req.end();
    });
    check(res.status === 200, "MA-6 真跑:GET /v1/approvals 带设备签名 ⇒ 200",
      res.status + " " + String(res.body).slice(0, 200));
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch (_) { /* 下面判 */ }
    check(parsed && parsed.ok === true, "MA-6 响应 ok:true", String(res.body).slice(0, 160));
    check(parsed && Array.isArray(parsed.pending), "MA-6 响应含 pending 数组(客户端读它)",
      String(res.body).slice(0, 160));
    check(parsed && typeof parsed.count === "number", "MA-6 响应含 count",
      String(res.body).slice(0, 160));

    // 负向:没签名 ⇒ 401(证明这条路上确实过了鉴权)
    const res2 = await new Promise((resolve) => {
      const req = http.request(
        { hostname: "127.0.0.1", port, path: "/v1/approvals", method: "GET" },
        (r) => {
          r.resume();
          r.on("end", () => resolve({ status: r.statusCode }));
        },
      );
      req.on("error", () => resolve({ status: 0 }));
      req.end();
    });
    check(res2.status === 401, "MA-6 负向:不带签名 ⇒ 401(手机上必须带设备签名)",
      String(res2.status));
  } finally {
    try { await server2.stop(); } catch (_) { /* ignore */ }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
})().then(() => {
  // ---------------------------------------------------------------- 5. UI 真的接线了
  {
    const contentView = read(path.join(REPO, "hosts/ios/BitBotHost/Sources/BitBotHost/ContentView.swift"));
    const sheet = read(path.join(REPO, "hosts/ios/BitBotHost/Sources/BitBotHost/ApprovalSheet.swift"));
    const sheetsKt = read(path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/ui/Sheets.kt"));
    const mainKt = read(path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/MainActivity.kt"));
    const sheetKt = read(path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/ui/ApprovalSheet.kt"));

    // iOS:工具栏有「审批」按钮 + 面板真的被呈现
    check(codeOnly(contentView).indexOf('Button("审批")') >= 0, "MA-8 iOS 工具栏有「审批」入口");
    check(codeOnly(contentView).indexOf("ApprovalSheet()") >= 0, "MA-8 iOS 面板真的被呈现");
    check(contentView.indexOf("showApprovals") >= 0, "MA-8 iOS 有 showApprovals 状态");
    // 三个动作 + 宽授权二次确认
    for (const w of ["allowOnce", "always", "deny"]) {
      check(codeOnly(sheet).indexOf("." + w) >= 0, "MA-8 iOS 面板有动作:" + w);
    }
    check(
      sheet.indexOf("wideConfirm") >= 0 && sheet.indexOf("确认") >= 0,
      "MA-8 iOS 宽授权要**再确认一次**(它授权的是那台机器)",
    );

    // Android:菜单有「审批」入口 + 面板真的被呈现
    check(codeOnly(sheetsKt).indexOf("onApprovals") >= 0, "MA-8 Android 菜单接了 onApprovals");
    check(codeOnly(sheetsKt).indexOf('title = "审批"') >= 0, "MA-8 Android 菜单有「审批」这一行");
    check(codeOnly(mainKt).indexOf("showApprovals") >= 0, "MA-8 Android 有 showApprovals 状态");
    check(codeOnly(mainKt).indexOf("ApprovalSheet(") >= 0, "MA-8 Android 面板真的被呈现");
    for (const w of ["ALLOW_ONCE", "ALWAYS", "DENY"]) {
      check(codeOnly(sheetKt).indexOf(w) >= 0, "MA-8 Android 面板有动作:" + w);
    }
    check(
      sheetKt.indexOf("wideConfirm") >= 0 && sheetKt.indexOf("确认") >= 0,
      "MA-8 Android 宽授权要**再确认一次**",
    );
  }

  // ---------------------------------------------------------------- 6. 负向:抄错就红
  // ⚠️ 子进程必须跳过负向段,否则无限递归 ⇒ 进程互改源文件 ⇒ 文件被留在变异状态。
  if (process.argv.includes("--no-self-check")) {
    console.log("\nprove_mobile_approval_client: PASS=" + pass + " FAIL=" + fail);
    process.exit(fail ? 1 : 0);
  }
  {
    // 变异打在**副本**上(理由同 DI 门禁:源文件不能被改)。
    const os = require("os");
    const srcDir = path.join(REPO, "hosts/ios/BitBotHost/Sources/BitBotHost");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-mob-mut-"));
    for (const f of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, f), path.join(tmpDir, f));
    }
    const target = path.join(tmpDir, "ApprovalClient.swift");
    const orig = fs.readFileSync(target, "utf8");
    fs.writeFileSync(target, orig.replace('"requested_at"', '"requestedAt"'), "utf8");
    const { execFileSync } = require("child_process");
    let red = false, out = "";
    try {
      execFileSync(
        process.execPath,
        [path.join(REPO, "scripts", "prove_mobile_approval_client.js"), "--no-self-check"],
        {
          encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
          env: Object.assign({}, process.env, { BITBOT_IOS_SRC_DIR: tmpDir }),
        },
      );
    } catch (e) {
      red = true;
      out = String(e.stdout || "") + String(e.stderr || "");
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    check(red, "MA-7 负向:iOS 抄错字段名 ⇒ 本门必须红", out.slice(0, 200));
    check(out.indexOf("requested_at") >= 0, "MA-7 负向:红的原因正是那个字段名",
      out.slice(0, 200));
  }

  console.log("\nprove_mobile_approval_client: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
});
