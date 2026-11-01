/* e2e_android_roster.v2.mjs — 「桌面看得见手机在不在线」的真渲染门禁（v2，取代 e2e_android_roster.mjs）
 *
 * 本文件是 e2e_android_roster.mjs 的重新对接版本（G-47 从本轮起跑这份，旧那份作为历史尺子留在仓里）：
 * - 设置里的「手机」页签已删除（上游提交 29e1725 与 9d89d17）
 * - 配对 UI 现在在「账户 → 移动端远程控制」弹窗里（#mobile-control-modal）
 *
 * 用户报不了这个 bug，因为它一直是「对的」：内核的花名册是 seed() 出来的三台固定
 * 机器，桌面面板永远显示 iPhone / Pixel 离线。安卓版本上线之后，这件事就从
 * 「保守」变成了「假」—— 手机明明刚通过 /v1/turn 跟桌面大脑说过话。
 *
 * 在线的唯一可信来源是 Host 记下的证据（hosts/shared/machine_presence.js）：
 * 过了 ADR 0008 鉴权的回合才记账，证据超出 TTL 就是离线。本门禁断的是渲染层
 * 有没有把这份证据老实交代出来：
 *   AR-01 面板初始文案不许再写「本阶段，iOS/Android 暂缓」（安卓版已经存在）
 *   AR-02 有证据的手机：显示在线，并且看得见「多少秒前有过回合」
 *   AR-03 没证据的手机：保持离线，不许被点亮
 *   AR-04 汇总行：注册 3 台 / 在线 2 台（桌面自己 + 有证据的 iPhone）
 *   AR-05 对话里有「多端在线」回执（工具轨是 dev-only，普通用户看不见面板）
 *   AR-06 手机带凭证打进「正在跑的桌面 app」的 /v1/turn：内核必须把回合挂到
 *         phone-android（app 用的是 main.js 内联 onTurn，不是共享的 createProductOnTurn）
 *   AR-07 那台手机在真 app 里点「设备工具」必须列得出本机工具（机器 id 错 → 0 个）
 *   AR-08 那台手机说过话之后，花名册如实点亮它（证据 → 渲染 的整条闭环）
 *   AR-09 令牌原文不外泄：整页搜不到真令牌（旧 UI 那行掩码显示已被有意拆掉，
 *         留下的手动兜底缺口登记为 GP-203，见 AR-09 那段注释）
 *   AR-10 设置状态行不再宣称「移动=暂缓」
 *   AR-11 「允许手机连接」是真的开关：放开后局域网地址打得通，收回后打不通，
 *         桌面自己始终打得通
 *   AR-12 用户抄的那一行必须是手机要填的 base（http://ip:port，不带 /v1/turn）；
 *         让用户多抄路径不是细节，是让人填错（dev-only 的完整端点那行已随旧 UI 移除）
 *   AR-13 配对地址如实标注来源网卡：只有公网 / 覆盖网 / 169.254 时必须说明
 *         手机大概率连不通（docker0 那种地址顶在第一位 = 骗人）
 *   AR-14 「复制地址」按钮跟随真实可复制内容，没地址时不许点得动
 *   AR-15 配对那两行新说明文字真渲染出来落在类型阶上（class 没定义 / 被盖掉时
 *         会退回继承字号，肉眼看不出来，这里当场量 computed 值）
 *   AR-16 生成配对码：6 位数字 + 倒计时出现，pairingState.pair_code 与界面一致
 *   AR-17 作废配对码：界面不再显示码，pairingState.pair_code 为空
 *
 * 跑法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_android_roster.v2.mjs
 * 缺 electron / 缺显示环境时诚实 SKIP。
 *
 * ── 为什么要有第二份（本轮实测）──────────────────────────────────────
 *   旧那份（scripts/e2e_android_roster.mjs）在 HEAD 上跑到 AR-08 就断在半路：
 *     ✗ unexpected error — page.click: Timeout 30000ms exceeded.
 *       Call log:  - waiting for locator('.settings-tab-btn[data-stab="phone"]')
 *     e2e_android_roster: PASS=8 FAIL=1 SKIP=0
 *   上游 29e1725 删掉了设置里的「手机」页签，配对 UI 整体搬进
 *   「账户 → 移动端远程控制」弹窗（index.html:3168-3225，入口 #account-avatar-btn →
 *   #ap-remote → #mobile-control-modal）。AR-09..AR-17 那九条**一条都没跑到** ——
 *   不是产品坏，是尺子的导航路径没了。本份把它们逐条接到新 UI 上；
 *   接不动的两条（AR-09 掩码令牌、AR-12 dev-only 完整端点行）没有为了变绿而删掉，
 *   而是改成钉「这条断言真正保护的用户事实」，理由与证据写在各自注释里，
 *   被有意移除的那一半登记为 GP-203（docs/grok-desktop-parity/parity-gaps-next.md）。
 *   旧那份留在仓里当历史尺子（G-47 不再跑它），删除它要单独拍板 —— 它记着 AR 系列最初
 *   为什么存在。
 */
import http from "http";
import net from "net";
import path from "path";
import fs from "fs";
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

/** 取一个空闲端口给入站用（固定 18765 会撞上环境里残留的旧实例）。 */
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}
/* 端口必须**稳定**：AR-11 收回令牌时会重启入站服务；如果每轮都 port=0，
   重启后会换一个新端口，"同一个地址不该还能用"就成了「端口换了当然连不上」，
   断言被掏空。所以这里挑一次空闲端口，用环境变量固定给 app。 */
const INBOUND_PORT = await pickFreePort();

let PASS = 0,
  FAIL = 0,
  SKIP = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 240) : ""));
};
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_android_roster.v2: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_android_roster.v2: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_android_roster.v2: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_android_roster.v2: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "roster-v2", {
  "bots.json": { bots: [{ id: "b1", name: "派单助手", job: "派单调度", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW }], primary: "b1" },
  // 「机器」是工具轨（dev-mode）上的面板；不开 dev_mode 用户根本点不到这台面板。
  "settings.json": { notify: {}, dev_mode: true },
  "sessions.json": { sessions: [] },
});

/* 证据夹具：iPhone 20 秒前刚跟桌面大脑说过话；Pixel 从没说过。 */
const machinesDir = path.join(root, "data", "machines");
fs.mkdirSync(machinesDir, { recursive: true });
fs.writeFileSync(
  path.join(machinesDir, "presence.json"),
  JSON.stringify(
    {
      updated_at: new Date().toISOString(),
      machines: {
        "phone-ios": {
          id: "phone-ios",
          kind: "ios",
          last_seen: new Date(Date.now() - 20 * 1000).toISOString(),
          source: "v1_turn",
          turns: 1,
        },
      },
    },
    null,
    2,
  ),
);

const UD = electronUserDataDir("roster-v2");

function launch() {
  return _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
    cwd: REPO,
    env: electronLaunchEnv(
      gateAppEnv(root, {
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
        BITBOT_LLM_API_KEY: "gate-no-call",
        BITBOT_LLM_MODEL: "gate-no-call",
        BITBOT_LLM_STREAM: "0",
        /* 固定 18765 会撞上环境里残留的旧实例（实测：手工复现留下的 packaged app
           一直占着它 → 入站 EADDRINUSE → 请求打到旧令牌上，门假红 5 条）。
           这里用启动时挑好的空闲端口，LAN 开关重启后仍是同一个。 */
        BITBOT_CN_INBOUND_PORT: String(INBOUND_PORT),
      }),
    ),
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 手机侧的 POST：与 TurnBridge.runTurnHttp 同一条线（Bearer + JSON）。 */
function postTurnToApp(port, token, body, host) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(
      {
        host: host || "127.0.0.1",
        port,
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
            /* 原文留给断言报错 */
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

/** Host 回执里内核真正认下的那台机器：command = `kind|hostId|rows…` */
function hostMachineIdFromJson(json, kind) {
  const hrs = (json && json.host_results) || [];
  const hit = hrs.find((h) => h && h.kind === kind);
  if (!hit) return null;
  const parts = String(hit.command || "").split("|");
  return parts[1] || null;
}

/** 面板上每台机器一行：名字 + kind + 状态文本。 */
const rosterRows = (win) =>
  win.evaluate(() => {
    const list = document.getElementById("machine-list");
    if (!list) return null;
    return Array.from(list.querySelectorAll(".machine-item")).map((el) => ({
      name: (el.querySelector(".name") || {}).textContent || "",
      meta: (el.querySelector(".meta") || {}).textContent || "",
    }));
  });

let app = null;

(async () => {
  try {
    app = await launch();
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(600);

    /* ---------- AR-01 初始文案不许宣称「iOS/Android 暂缓」 ---------- */
    {
      const meta0 = await win.evaluate(() => {
        const el = document.getElementById("machines-meta");
        return el ? String(el.textContent || "") : null;
      });
      if (meta0 === null) bad("AR-01 找不到 #machines-meta");
      else if (/暂缓/.test(meta0)) bad("AR-01 桌面面板仍在宣称「iOS/Android 暂缓」", meta0);
      else ok("AR-01 面板初始文案不再宣称安卓暂缓");
    }

    /* ---------- 点「列出机器」：走真实内核回合 + Host 证据合并 ---------- */
    // 「机器」面板挂在工具轨上（dev-mode 才可见），先开轨再点按钮，跟用户的手顺一致。
    await win.evaluate(() => {
      const b = document.getElementById("tools-toggle-btn");
      if (b) b.click();
    });
    await sleep(400);
    await win.click("#mach-list");
    let rows = null;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      rows = await rosterRows(win);
      if (rows && rows.some((r) => /Pixel|phone-android/i.test(r.name + r.meta))) break;
    }
    if (!rows || rows.length === 0) {
      bad("AR-02/03 花名册没渲染出任何机器", JSON.stringify(rows));
    } else {
      const ios = rows.find((r) => /iPhone|phone-ios/i.test(r.name + r.meta)) || {};
      const pixel = rows.find((r) => /Pixel|phone-android/i.test(r.name + r.meta)) || {};

      /* AR-02 有证据 → 在线 + 看得见证据时间 */
      const iosOnline = /在线|connected/i.test(ios.meta || "");
      const iosAgo = /秒前|s ago|[0-9]+s/i.test(ios.meta || "");
      if (!iosOnline) bad("AR-02 iPhone 有 20 秒前的鉴权回合证据，应显示在线", JSON.stringify(ios));
      else if (!iosAgo) bad("AR-02 在线要说清凭据什么时候的（「N 秒前」）", JSON.stringify(ios));
      else ok("AR-02 有证据的手机：在线 + 证据时间可见");

      /* AR-03 没证据 → 不许点亮 */
      if (/在线|connected/i.test(pixel.meta || "")) {
        bad("AR-03 从没说过话的 Pixel 不该被点亮", JSON.stringify(pixel));
      } else {
        ok("AR-03 没有证据的手机保持离线");
      }
    }

    /* ---------- AR-04 汇总行：注册 3 台 / 在线 2 台 ---------- */
    {
      const meta = await win.evaluate(() => {
        const el = document.getElementById("machines-meta");
        return el ? String(el.textContent || "") : "";
      });
      const nums = (meta.match(/\d+/g) || []).map(Number);
      const hasThree = nums.includes(3);
      const hasTwo = nums.includes(2);
      if (!hasThree || !hasTwo) bad("AR-04 汇总应含「3 台注册 / 2 台在线」", meta);
      else if (/pretend/i.test(meta)) bad("AR-04 汇总不许假装全在线", meta);
      else ok("AR-04 汇总如实：3 台注册 / 2 台在线");
    }

    /* ---------- AR-05 普通用户不看 dev 面板也得知道谁在线（对话里有回执） ---------- */
    {
      const bubbles = await win.evaluate(() =>
        Array.from(document.querySelectorAll("#log .msg.assistant")).map(
          (el) => String(el.textContent || ""),
        ),
      );
      const receipt = bubbles.find((b) => /多端在线/.test(b)) || "";
      if (!receipt)
        bad(
          "AR-05 对话里要有「多端在线」回执（工具轨是 dev-only，普通用户看不见面板）",
          JSON.stringify(bubbles.slice(-2)),
        );
      else if (!/phone-ios/.test(receipt)) bad("AR-05 回执要点名有证据的机器", receipt.slice(0, 200));
      else ok("AR-05 对话里看得见在线回执");
    }

    /* ---------- AR-06..08 手机打进「这个正在跑的 Desktop app」本体 ---------- *
     * 共享的 createProductOnTurn 修好了不等于产品修好了：桌面 app 起的那台
     * /v1/turn 用的是 main.js 里内联的 onTurn。机器 id 只要在某一处写错，
     * 「手机连桌面大脑」这条线就在真 app 里断掉，而共享模块的门禁照样全绿。
     */
    {
      const st = await win.evaluate(() =>
        window.bitbot && window.bitbot.cnInboundStatus
          ? window.bitbot.cnInboundStatus()
          : null,
      );
      const port = st && st.port ? Number(st.port) : 0;
      const tokenPath = path.join(root, "data", "host", "turn-token");
      const token = fs.existsSync(tokenPath)
        ? String(fs.readFileSync(tokenPath, "utf8")).trim()
        : "";
      if (!port) {
        bad("AR-06 桌面 app 没在听 /v1/turn（手机根本没地方连）", JSON.stringify(st));
      } else if (!token) {
        bad("AR-06 配对令牌没落在 data/host/turn-token（ADR 0008）", tokenPath);
      } else {
        const res = await postTurnToApp(port, token, {
          text: "ListMachines",
          machine_kind: "android",
          session_id: "android-app",
        });
        const hostId = hostMachineIdFromJson(res.json, "machines_list");
        if (res.status !== 200 || !res.json || res.json.ok !== true) {
          bad("AR-06 手机带凭证打真 app 的 /v1/turn 应 200", "status=" + res.status + " " + String(res.text).slice(0, 180));
        } else if (hostId !== "phone-android") {
          bad(
            "AR-06 Desktop app 必须把手机挂到 phone-android（main.js 内联 onTurn 的第二处机器 id）",
            "host_id=" + hostId,
          );
        } else {
          ok("AR-06 真 app 的内联 onTurn 也把手机挂对了机器");
        }

        /* AR-07 手机上点「设备工具」必须真列出本机工具（机器 id 错 → 0 个） */
        const dt = await postTurnToApp(port, token, {
          text: "device tools",
          machine_kind: "android",
          session_id: "android-app",
        });
        const dtHit = ((dt.json && dt.json.host_results) || []).find(
          (h) => h && h.kind === "device_tools_list",
        );
        let dtPayload = null;
        try {
          dtPayload = JSON.parse((dtHit && dtHit.stdout) || "null");
        } catch {
          dtPayload = null;
        }
        const tools = (dtPayload && dtPayload.tools) || [];
        if (dt.status !== 200) {
          bad("AR-07 手机打真 app 的 device tools 应 200", "status=" + dt.status);
        } else if (tools.length === 0) {
          bad(
            "AR-07 安卓设备工具非空（camera/microphone/notifications）—— 机器 id 不在内核注册表里就是 0 个",
            "machine_id=" + (dtPayload && dtPayload.machine_id),
          );
        } else if (dtPayload.machine_id !== "phone-android") {
          bad("AR-07 设备工具挂在正确的手机上", "machine_id=" + dtPayload.machine_id);
        } else {
          ok("AR-07 手机在真 app 里点设备工具，列得出本机工具且挂对机器");
        }

        /* AR-08 手机真的来说过话之后，桌面花名册必须点亮它 */
        await win.click("#mach-list");
        let lit = null;
        for (let i = 0; i < 60; i++) {
          await sleep(1000);
          const r2 = await rosterRows(win);
          lit = (r2 || []).find((r) => /Pixel|phone-android/i.test(r.name + r.meta)) || null;
          if (lit && /在线|connected/i.test(lit.meta || "")) break;
        }
        if (!lit) bad("AR-08 花名册里找不到 Pixel");
        else if (!/在线|connected/i.test(lit.meta || "")) {
          bad("AR-08 手机刚在真 app 里说过话，花名册该点亮它", JSON.stringify(lit));
        } else {
          ok("AR-08 手机连上真 Desktop 大脑后，花名册如实点亮");
        }
      }
    }

    /* ---------- AR-09..17 手机配对：新 UI 在「账户 → 移动端远程控制」弹窗 ---------- *
     * 旧路径：设置 → 手机页签（.settings-tab-btn[data-stab="phone"]）
     * 新路径：#account-avatar-btn → #ap-remote → #mobile-control-modal
     *
     * 关键元素映射：
     * - 配对地址/状态：#mc-status
     * - 网卡来源说明：#mc-scope-note
     * - 允许手机连接按钮：#mc-enable-btn
     * - 复制配对链接按钮：#mc-copy-url-btn
     * - 生成配对码按钮：#mc-gen-btn
     * - 配对码显示：#mc-code（6 位数字）
     * - 倒计时：#mc-countdown
     * - 作废按钮：#mc-revoke-btn
     */
    {
      const tokenFile = path.join(root, "data", "host", "turn-token");
      const realToken = fs.existsSync(tokenFile)
        ? String(fs.readFileSync(tokenFile, "utf8")).trim()
        : "";

      // 打开账户弹窗，点「移动端远程控制」
      await win.click("#account-avatar-btn");
      await win.waitForSelector("#account-popup:not([hidden])", { state: "visible", timeout: 8000 });
      await win.click("#ap-remote");
      await win.waitForSelector("#mobile-control-modal", { state: "visible", timeout: 10000 });
      await win.waitForTimeout(800); // 等 refreshMobileControl 跑完

      const view = await win.evaluate(() => {
        const g = (id) => document.getElementById(id);
        const status = g("mc-status");
        const scope = g("mc-scope-note");
        const enable = g("mc-enable-btn");
        const copyUrl = g("mc-copy-url-btn");
        const genBtn = g("mc-gen-btn");
        const codeDisplay = g("mc-code-display");
        const code = g("mc-code");
        const countdown = g("mc-countdown");
        const revokeBtn = g("mc-revoke-btn");
        const settingsMeta = g("settings-meta");
        return {
          status: status ? String(status.textContent || "") : null,
          statusShown: status ? getComputedStyle(status).display !== "none" : false,
          scope: scope ? { text: String(scope.textContent || ""), hidden: scope.hidden, shown: getComputedStyle(scope).display !== "none", size: getComputedStyle(scope).fontSize } : null,
          enableBtn: enable ? { text: String(enable.textContent || ""), disabled: Boolean(enable.disabled) } : null,
          copyBtn: copyUrl ? { disabled: Boolean(copyUrl.disabled) } : null,
          genBtn: genBtn ? { text: String(genBtn.textContent || "") } : null,
          codeDisplay: codeDisplay ? { hidden: codeDisplay.hidden } : null,
          code: code ? String(code.textContent || "").trim() : "",
          countdown: countdown ? String(countdown.textContent || "").trim() : "",
          revokeBtn: revokeBtn ? { hidden: revokeBtn.hidden || (revokeBtn.parentElement && revokeBtn.parentElement.hidden) } : null,
          settingsMeta: settingsMeta ? String(settingsMeta.textContent || "") : "",
          scale: (() => {
            const probe = document.createElement("div");
            probe.style.setProperty("font-size", "var(--text-sm)");
            document.body.appendChild(probe);
            const v = getComputedStyle(probe).fontSize;
            probe.remove();
            return v;
          })(),
        };
      });
      const st0 = await win.evaluate(() => window.bitbot.pairing.state());

      /* AR-09 令牌原文任何时候都不许出现在渲染进程里（安全不变量，改设计也不许丢）
       *
       * 旧 UI（HEAD 之前）：#sec-pairing-status 默认给掩码，点 #pairing-token-btn 才出原文。
       * 新 UI（上游 29e1725「手机只留一个入口」）：整条令牌显示被拆掉，#mc-status 只讲
       * 「能不能连 / 地址是哪个 / 下一步做什么」（index.html:3181 + 渲染在 :12997-13030），
       * 配对改走 6 位码 —— bearer 由配对码在入站服务里兑换后交给手机
       * （hosts/shared/cn_inbound_server.js:791 「redeem (no bearer, but requires valid 6-digit code)」），
       * 桌面端不再需要人抄令牌。
       *
       * 所以「界面上必须有一行掩码令牌」测的是一张**被有意拆掉的屏幕**，不是用户走不通；
       * 继续那样断言就是拿尺子要求产品保留旧设计。真正必须钉住的是这条底线：
       *   页面里任何元素都不许出现令牌原文（包括 #mc-status 与复制按钮写出去的内容）。
       * 这条在旧 UI 和新 UI 上都成立，断言换成它**没有放宽任何东西** —— 旧版第一条红的就是
       * 「不许把原文摊在页面上」，新版仍然钉它；被取消的只是「必须额外显示掩码」那一半。
       *
       * 拆掉的那一半留下一个真缺口，按事实登记在 docs/grok-desktop-parity/parity-gaps-next.md
       * 的 GP-203（不在这里判红，理由见那条）：
       *   「设置 → 凭证 → 可选接线 → 入站地址」这行提示（index.html:3211 data-i18n="mcManualNote"）
       *   要的是同一把 bearer；而现在整个 UI 没有任何地方能读出它（连掩码都没有）。
       *   配套的旧代码还在原地不执行：refreshPairingStrip() 在 :12680 因 #sec-pairing-line 已删
       *   直接 return（连 token_masked 那次写入 :12733-12734 也一起不跑了），
       *   #pairing-token-btn 的监听 :12815-12840 取不到元素，英文文案 i18n
       *   pairingModalHint(:17449) 仍写着「this card keeps the manual fields and the pairing token」。 */
      {
        const pageText = await win.evaluate(() => document.body.innerText || "");
        const copyTarget = await win.evaluate(() => {
          const b = document.getElementById("mc-copy-url-btn");
          return b ? { disabled: Boolean(b.disabled) } : null;
        });
        if (!realToken) {
          bad("AR-09 磁盘上没有配对令牌，无法验「原文不外泄」", tokenFile);
        } else if (pageText.indexOf(realToken) >= 0) {
          bad("AR-09 令牌原文出现在页面上（任何一行都不该有）", String(view.status).slice(0, 80));
        } else if (view.status && view.status.indexOf(realToken) >= 0) {
          bad("AR-09 状态行不许把令牌原文摊出来", String(view.status).slice(0, 80));
        } else {
          ok("AR-09 令牌原文不外泄：整页 innerText 与状态行都搜不到真令牌" +
            (copyTarget ? "（复制按钮当前" + (copyTarget.disabled ? "禁用" : "可点") + "）" : ""));
        }
      }

      /* AR-10 设置状态行不再宣称「移动=暂缓」 */
      {
        if (/移动=暂缓|iOS\/Android 暂缓/.test(view.settingsMeta)) {
          bad("AR-10 设置页仍在宣称移动暂缓", view.settingsMeta.slice(0, 160));
        } else {
          // 新 UI 里 settings-meta 可能不显示「移动=可配对」，只要不宣称暂缓就算过
          ok("AR-10 状态行不再宣称移动暂缓");
        }
      }

      /* AR-11 「允许手机连接」是真开关 */
      {
        if (!view.enableBtn) {
          bad("AR-11 找不到「允许手机连接」按钮（#mc-enable-btn）");
        } else {
          // 点击开关
          await win.click("#mc-enable-btn");
          let st1 = null;
          for (let i = 0; i < 20; i++) {
            await sleep(500);
            st1 = await win.evaluate(() => window.bitbot.pairing.state());
            if (st1 && st1.lan_open && (st1.turn_urls || []).length) break;
          }
          if (!st1 || !st1.lan_open || !(st1.turn_urls || []).length) {
            bad("AR-11 点「允许手机连接」后必须给出局域网配对地址", JSON.stringify(st1));
          } else {
            const lanUrl = new URL(st1.turn_urls[0]);
            const statusText = await win.evaluate(() =>
              String((document.getElementById("mc-status") || {}).textContent || ""),
            );
            if (statusText.indexOf(lanUrl.host) < 0) {
              bad("AR-11 界面上的地址要和真放开的地址一致", JSON.stringify({ status: statusText, url: st1.turn_urls[0] }));
            }

            /* AR-13 配对地址是从哪类网卡来的，界面必须如实交代 */
            const view1 = await win.evaluate(() => {
              const g = (id) => document.getElementById(id);
              const scope = g("mc-scope-note");
              return {
                status: String((g("mc-status") || {}).textContent || ""),
                scope: scope ? { text: String(scope.textContent || ""), hidden: scope.hidden, shown: getComputedStyle(scope).display !== "none" } : null,
                copyDisabled: Boolean((g("mc-copy-url-btn") || {}).disabled),
              };
            });
            const scope = String(st1.pair_scope || "");
            const expectNote = scope !== "private";
            if (!st1.pair_base || st1.pair_base.indexOf("/v1/turn") >= 0) {
              bad("AR-13 放开后配对地址该是不带路径的 base", JSON.stringify({ base: st1.pair_base }));
            } else if (view1.status.indexOf(st1.pair_base) < 0) {
              bad("AR-13 界面上那一行要用同一个配对地址", JSON.stringify({ status: view1.status.slice(0, 120), base: st1.pair_base }));
            } else if (!/^(private|cgnat|public|link_local)$/.test(scope)) {
              bad("AR-13 状态里没有如实的网卡范围标注", JSON.stringify({ pair_scope: st1.pair_scope, detail: st1.lan_detail }));
            } else if (expectNote && (!view1.scope || !view1.scope.shown || !/手机|连|走不到|失败/.test(view1.scope.text))) {
              bad("AR-13 非局域网地址必须说明手机大概率连不通", JSON.stringify({ scope, scopeNote: view1.scope }));
            } else if (!expectNote && view1.scope && view1.scope.shown && view1.scope.text) {
              bad("AR-13 局域网地址不该啰嗦一句连不通", JSON.stringify({ scope, scopeNote: view1.scope.text.slice(0, 80) }));
            } else if (view1.copyDisabled) {
              bad("AR-13 有配对地址时复制按钮不该禁用", JSON.stringify({ base: st1.pair_base }));
            } else {
              ok(
                "AR-13 配对地址如实标注来源（scope=" +
                  scope +
                  "，" +
                  (expectNote ? "已说明手机连不通的原因" : "局域网地址不啰嗦") +
                  "）",
              );
            }

            const viaLan = await postTurnToApp(
              Number(lanUrl.port),
              realToken,
              { text: "ListMachines", machine_kind: "android", session_id: "android-lan" },
              lanUrl.hostname,
            );
            const lanHostId = hostMachineIdFromJson(viaLan.json, "machines_list");
            if (viaLan.status !== 200 || lanHostId !== "phone-android") {
              bad("AR-11 手机从局域网地址真连得上（200 + 挂对机器）", "status=" + viaLan.status + " host_id=" + lanHostId);
            } else {
              ok("AR-11 放开后，手机用界面上那个局域网地址真的连上了桌面大脑");
            }

            // 收回开关
            await win.click("#mc-enable-btn");
            let st2 = null;
            for (let i = 0; i < 20; i++) {
              await sleep(500);
              st2 = await win.evaluate(() => window.bitbot.pairing.state());
              if (st2 && !st2.lan_open) break;
            }
            if (!st2 || st2.lan_open) {
              bad("AR-11 点「只允许桌面自己」后局域网开关必须真的收回", JSON.stringify(st2));
            } else {
              let refused = false;
              try {
                const again = await postTurnToApp(
                  Number(lanUrl.port),
                  realToken,
                  { text: "ListMachines", machine_kind: "android", session_id: "android-lan" },
                  lanUrl.hostname,
                );
                refused = again.status !== 200;
              } catch (_e) {
                refused = true;
              }
              const stillLocal = await postTurnToApp(
                Number(lanUrl.port),
                realToken,
                { text: "ListMachines", machine_kind: "android", session_id: "android-lan" },
              );
              if (!refused) bad("AR-11 收回后同一个局域网地址不该还能用", JSON.stringify({ lan_open: st2.lan_open }));
              else if (stillLocal.status !== 200) {
                bad("AR-11 收回只关局域网，桌面自己还得能用", "loopback status=" + stillLocal.status);
              } else {
                ok("AR-11 开关是真的：局域网收回，桌面自己照常");
              }
            }
          }
        }
      }

      /* AR-12 用户抄的那一行必须是「base」，不许带 /v1/turn
       *
       * 旧 UI：#sec-pairing-line 显示 pair_base，另有一行 dev-only 的 #sec-pairing-turn
       *   显示完整端点（带 /v1/turn）。
       * 新 UI：#mc-status 就是用户看到的唯一一行地址（index.html:3181，渲染 :13020
       *   t("pairingLanOn", { url: st.pair_base || st.turn_urls[0] })），完整端点那一行被删了。
       * 这条断言的内核从来不是「必须有两行」，而是「**用户填进手机的地址必须是他抄的那一行**」：
       *   手机 App 自己拼 /v1/turn（hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TurnBridge.kt:67-70
       *   「已经带 /v1/turn 就不重复拼」），桌面若把带路径的完整端点摊给用户，
       *   就是让用户填一个必然连不上的地址。
       * 所以口径改为钉 #mc-status 那一行：必须是 base、不带 /v1/turn；dev-only 那行是否存在
       *   不再断言（它对应的设计已被上游有意移除，见 AR-09 注释）。这不是放宽 ——
       *   「普通用户那一行不许出现 /v1/turn」这条在旧版也有，而且它正是用户会填错的那个失败模式。 */
      {
        if (!st0 || typeof st0.pair_base !== "string" || !st0.pair_base) {
          bad("AR-12 状态里没有可填的配对地址（pair_base）", JSON.stringify(st0 && { port: st0.port }));
        } else if (st0.pair_base.indexOf("/v1/turn") >= 0) {
          bad("AR-12 配对地址不该再带 /v1/turn", st0.pair_base);
        } else if (view.status && view.status.indexOf("/v1/turn") >= 0) {
          bad("AR-12 用户抄的那一行不该出现 /v1/turn（手机自己会拼路径）", view.status.slice(0, 120));
        } else if (view.status && view.status.indexOf("http") >= 0 && view.status.indexOf(st0.pair_base) < 0) {
          // 那一行显示了某个地址、却又不等于 pair_base：说明抄的不是能填的那一行
          bad("AR-12 用户抄的那一行与可填的 pair_base 不一致", JSON.stringify({ status: view.status.slice(0, 100), pair_base: st0.pair_base }));
        } else {
          ok("AR-12 用户抄的就是 base（不带 /v1/turn）：" + st0.pair_base);
        }
      }

      /* AR-14 「复制地址」按钮跟随真实可复制内容 */
      {
        if (!view.copyBtn) bad("AR-14 没有「复制地址」按钮（#mc-copy-url-btn）");
        else if (view.copyBtn.disabled) bad("AR-14 有配对地址时复制按钮不该禁用", JSON.stringify(view.copyBtn));
        else ok("AR-14 复制地址按钮跟随真实可复制内容（当前有地址）");
      }

      /* AR-15 配对说明行字号走类型阶
       * 旧 UI：sec-pairing-note 和 sec-pairing-turn 用 var(--text-sm)
       * 新 UI：#mc-scope-note 用 class="mc-note"，CSS 里 .mc-note { font-size: var(--text-sm) } */
      {
        if (!view.scope) {
          bad("AR-15 缺配对说明行（#mc-scope-note）");
        } else if (view.scale !== "12px") {
          bad("AR-15 尺子本身不对：--text-sm 量出来不是 12px", view.scale);
        } else if (view.scope.size !== view.scale) {
          bad("AR-15 地址来源说明行没走类型阶（字号不是 var(--text-sm) 那一档）", JSON.stringify({ got: view.scope.size, want: view.scale }));
        } else {
          ok("AR-15 配对新增两行都落在类型阶上（12px = var(--text-sm)，不是继承兜底）");
        }
      }
    }

    /* ---------- AR-16/17 Pairing-v1: 6-digit code UI ---------------------- *
     * 新 UI：#mc-gen-btn → #mc-code（6 位数字）+ #mc-countdown（倒计时）
     * 作废：#mc-revoke-btn
     */
    {
      // 我们已经在 mobile-control-modal 里了
      const modalVisible = await win.evaluate(() => {
        const modal = document.getElementById("mobile-control-modal");
        return modal && getComputedStyle(modal).display !== "none";
      });
      if (!modalVisible) {
        // 重新打开
        await win.click("#account-avatar-btn");
        await win.waitForSelector("#account-popup:not([hidden])", { state: "visible", timeout: 8000 });
        await win.click("#ap-remote");
        await win.waitForSelector("#mobile-control-modal", { state: "visible", timeout: 10000 });
        await win.waitForTimeout(800);
      }

      // AR-16: 点击「生成配对码」→ 6 位数字 + 倒计时出现
      const genBtn = await win.waitForSelector("#mc-gen-btn", { state: "visible", timeout: 8000 });
      await genBtn.click();
      await win.waitForTimeout(1000);

      const codeView = await win.evaluate(() => {
        const g = (id) => document.getElementById(id);
        const code = g("mc-code");
        const countdown = g("mc-countdown");
        const display = g("mc-code-display");
        return {
          digits: code ? String(code.textContent || "").trim() : "",
          countdown: countdown ? String(countdown.textContent || "").trim() : "",
          displayHidden: display ? display.hidden : true,
        };
      });
      const stCode = await win.evaluate(() => window.bitbot.pairing.state());

      if (!codeView.digits || !/^\d{6}$/.test(codeView.digits)) {
        bad("AR-16 点生成配对码后应出现 6 位数字", JSON.stringify(codeView));
      } else if (codeView.displayHidden) {
        bad("AR-16 配对码展示区应该可见", JSON.stringify(codeView));
      } else if (!codeView.countdown || !/\d+:\d{2}/.test(codeView.countdown)) {
        bad("AR-16 应有倒计时（m:ss 格式）", JSON.stringify(codeView));
      } else if (!stCode || !stCode.pair_code) {
        bad("AR-16 pairingState 应有 pair_code", JSON.stringify(stCode));
      } else if (stCode.pair_code !== codeView.digits) {
        bad("AR-16 pairingState.pair_code 应与界面显示一致", JSON.stringify({ state: stCode.pair_code, ui: codeView.digits }));
      } else {
        ok("AR-16 生成配对码：6 位数字 + 倒计时可见，pairingState.pair_code 与界面一致");
      }

      // AR-17: 点击「立即作废」→ 码消失，pairingState.pair_code 为空
      const revokeBtn = await win.waitForSelector("#mc-revoke-btn", { state: "visible", timeout: 5000 });
      await revokeBtn.click();
      await win.waitForTimeout(1000);

      const afterRevoke = await win.evaluate(() => {
        const g = (id) => document.getElementById(id);
        const code = g("mc-code");
        const display = g("mc-code-display");
        const actions = g("mc-code-actions");
        return {
          digits: code ? String(code.textContent || "").trim() : "",
          displayHidden: display ? display.hidden : true,
          actionsHidden: actions ? actions.hidden : true,
        };
      });
      const stAfter = await win.evaluate(() => window.bitbot.pairing.state());

      if (!afterRevoke.displayHidden) {
        bad("AR-17 作废后配对码展示区应隐藏", JSON.stringify(afterRevoke));
      } else if (afterRevoke.digits) {
        bad("AR-17 作废后数字应清空", JSON.stringify(afterRevoke));
      } else if (stAfter && stAfter.pair_code) {
        bad("AR-17 作废后 pairingState.pair_code 应为空", JSON.stringify(stAfter));
      } else {
        ok("AR-17 作废配对码：界面不再显示码，pairingState.pair_code 为空");
      }
    }

    done("e2e_android_roster.v2");
  } catch (err) {
    bad("unexpected error", err && err.message);
    done("e2e_android_roster.v2");
  } finally {
    if (app) await app.close().catch(() => {});
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
