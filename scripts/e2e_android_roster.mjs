/* e2e_android_roster.mjs — 「桌面看得见手机在不在线」的真渲染门禁
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
 *   AR-09 凭证页给得出配对地址 + 令牌（默认掩码，点「显示」才给原文）
 *   AR-10 设置状态行不再宣称「移动=暂缓」
 *   AR-11 「允许手机连接」是真的开关：放开后局域网地址打得通，收回后打不通，
 *         桌面自己始终打得通
 *   AR-12 那一行给的是手机要填的配对地址（http://ip:port，不带 /v1/turn）；
 *         完整端点降到开发态单独一行 —— 让用户多抄路径不是细节，是让人填错
 *   AR-13 配对地址如实标注来源网卡：只有公网 / 覆盖网 / 169.254 时必须说明
 *         手机大概率连不通（docker0 那种地址顶在第一位 = 骗人）
 *   AR-14 「复制地址」按钮跟随真实可复制内容，没地址时不许点得动
 *   AR-15 配对那两行新说明文字真渲染出来落在类型阶上（class 没定义 / 被盖掉时
 *         会退回继承字号，肉眼看不出来，这里当场量 computed 值）
 *
 * 跑法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_android_roster.mjs
 * 缺 electron / 缺显示环境时诚实 SKIP。
 */
import http from "http";
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
  console.log("e2e_android_roster: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_android_roster: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_android_roster: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_android_roster: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "roster", {
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

const UD = electronUserDataDir("roster");

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
      else if (!iosAgo) bad("AR-02 在线要说清凭据是什么时候的（「N 秒前」）", JSON.stringify(ios));
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

    /* ---------- AR-09/AR-10 手机配对：地址与令牌必须在凭证这一屏拿得到 ---------- *
     * 手机连桌面大脑缺两样东西就走不通：一个它敲得到的地址，和那台的配对令牌。
     * 以前这两样只在 README 里（BITBOT_BIND_LAN 是环境变量，令牌躺在磁盘上）。
     * 这里按用户的手顺验：设置 → 凭证 → 看见状态与掩码令牌 → 点「显示配对令牌」
     * → 点「允许手机连接」→ 用界面上给出的局域网地址真打一发 /v1/turn →
     * 关掉开关后同一个地址再也连不上。
     */
    {
      const tokenFile = path.join(root, "data", "host", "turn-token");
      const realToken = fs.existsSync(tokenFile)
        ? String(fs.readFileSync(tokenFile, "utf8")).trim()
        : "";

      await win.click("#account-avatar-btn");
      await win.waitForSelector("#ap-settings", { state: "visible", timeout: 8000 });
      await win.click("#ap-settings");
      await win.waitForSelector("#settings-panel", { state: "visible", timeout: 10000 });
      await win.click('.settings-tab-btn[data-stab="credentials"]');
      await win.waitForTimeout(600);

      const view = await win.evaluate(() => {
        const g = (id) => document.getElementById(id);
        const lan = g("pairing-lan-btn");
        const copy = g("pairing-copy-url");
        const note = g("sec-pairing-note");
        const turn = g("sec-pairing-turn");
        return {
          line: g("sec-pairing-line") ? String(g("sec-pairing-line").textContent || "") : null,
          status: g("sec-pairing-status") ? String(g("sec-pairing-status").textContent || "") : null,
          lanBtn: lan ? { text: String(lan.textContent || ""), disabled: Boolean(lan.disabled) } : null,
          meta: g("settings-meta") ? String(g("settings-meta").textContent || "") : "",
          copyBtn: copy ? { disabled: Boolean(copy.disabled) } : null,
          note: note ? { text: String(note.textContent || ""), shown: getComputedStyle(note).display !== "none", size: getComputedStyle(note).fontSize } : null,
          turn: turn ? { text: String(turn.textContent || ""), shown: getComputedStyle(turn).display !== "none", size: getComputedStyle(turn).fontSize } : null,
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

      if (!view.line) bad("AR-09 凭证页没有手机配对这一行");
      else if (
        !/读取中|失败/.test(view.line) &&
        st0 &&
        st0.port &&
        view.line.indexOf("http://") >= 0 &&
        view.line.indexOf(":" + st0.port) > 0
      ) {
        ok("AR-09 凭证页给得出真实配对地址（端口从运行时来，不写死）");
      } else {
        bad("AR-09 配对地址没如实显示", JSON.stringify({ line: view.line, port: st0 && st0.port }));
      }

      /* AR-12 这一行给的是「手机要填的那个东西」：http://ip:port，不带 /v1/turn。
       * 路径由手机端自己补（hosts/android TurnBridge.turnEndpoint，JVM 单测钉住），
       * 让用户多抄一段路径不是细节，是让人填错。完整端点降到开发态那一行。 */
      if (!st0 || typeof st0.pair_base !== "string" || !st0.pair_base) {
        bad("AR-12 状态里没有可填的配对地址（pair_base）", JSON.stringify(st0 && { port: st0.port }));
      } else if (st0.pair_base.indexOf("/v1/turn") >= 0) {
        bad("AR-12 配对地址不该再带 /v1/turn", st0.pair_base);
      } else if (view.line.indexOf("/v1/turn") >= 0) {
        bad("AR-12 普通用户那一行不该出现 /v1/turn", view.line.slice(0, 120));
      } else if (!view.turn || !view.turn.shown || view.turn.text.indexOf("/v1/turn") < 0) {
        bad("AR-12 开发态要单独给得出完整端点", JSON.stringify(view.turn));
      } else if (view.turn.text.indexOf(st0.pair_base) < 0) {
        bad("AR-12 完整端点要和配对地址同一来源", JSON.stringify({ base: st0.pair_base, turn: view.turn.text }));
      } else {
        ok("AR-12 配对地址与完整端点分开了（用户填的没路径，开发态看得到）");
      }

      /* AR-15 那两行新增说明文字的字号必须落在类型阶上（和邻居同一档）。
       * 为什么值得钉：token 门禁只拦「行内贴字面值」，行内写 font:var(...) 简写
       * 仍会被计成一处字面字号（实测基线 34→36），所以改成 class；class 一旦没
       * 定义或被人用 !important 盖掉，浏览器就退回继承值 —— 肉眼看只是字小了一档，
       * 没人会当 bug 报。这里当场量出来。 */
      if (!view.turn || !view.note) bad("AR-15 缺配对说明行（note / turn）");
      else if (view.scale !== "12px") bad("AR-15 尺子本身不对：--text-sm 量出来不是 12px", view.scale);
      else if (view.turn.size !== view.scale) {
        bad("AR-15 开发态端点行没走类型阶（字号不是 var(--text-sm) 那一档）", JSON.stringify({ got: view.turn.size, want: view.scale }));
      } else if (view.note.size !== view.scale) {
        bad("AR-15 地址来源说明行没走类型阶（字号不是 var(--text-sm) 那一档）", JSON.stringify({ got: view.note.size, want: view.scale }));
      } else {
        ok("AR-15 配对新增两行都落在类型阶上（12px = var(--text-sm)，不是继承兜底）");
      }

      /* AR-14 有地址可复制时按钮才是可用的 */
      if (!view.copyBtn) bad("AR-14 没有「复制地址」按钮");
      else if (view.copyBtn.disabled) bad("AR-14 有配对地址时复制按钮不该禁用", JSON.stringify(view.copyBtn));
      else ok("AR-14 复制地址按钮跟随真实可复制内容（当前有地址）");

      if (!realToken) bad("AR-09 磁盘上没有配对令牌，无法验掩码", tokenFile);
      else if (!view.status || view.status.indexOf(realToken) >= 0) {
        bad("AR-09 默认状态不许把令牌原文摊在页面上", String(view.status).slice(0, 80));
      } else if (!/••••|…/.test(view.status)) {
        bad("AR-09 默认状态要给出可辨认的掩码令牌", String(view.status).slice(0, 80));
      } else {
        ok("AR-09 令牌默认只给掩码（原文要点「显示」）");
      }

      await win.click("#pairing-token-btn");
      await win.waitForTimeout(400);
      const revealed = await win.evaluate(() => {
        const box = document.getElementById("sec-pairing-token");
        return box
          ? { shown: getComputedStyle(box).display !== "none", text: String(box.textContent || "") }
          : null;
      });
      if (!revealed || !revealed.shown || revealed.text.trim() !== realToken) {
        bad(
          "AR-09 点「显示配对令牌」要拿得出磁盘上那份真令牌",
          JSON.stringify(revealed && { shown: revealed.shown, len: revealed.text.trim().length }),
        );
      } else {
        ok("AR-09 用户可以自己把令牌抄进手机");
      }

      if (/移动=暂缓|iOS\/Android 暂缓/.test(view.meta)) {
        bad("AR-10 设置页仍在宣称移动暂缓", view.meta.slice(0, 160));
      } else if (!/移动=可配对/.test(view.meta)) {
        bad("AR-10 状态行该如实交代移动端可配对", view.meta.slice(0, 160));
      } else {
        ok("AR-10 状态行不再宣称移动暂缓");
      }

      /* AR-11 放开 → 局域网地址真能用；收回 → 同一个地址连不上（开关不是装饰） */
      await win.click("#pairing-lan-btn");
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
        const line1 = await win.evaluate(() =>
          String((document.getElementById("sec-pairing-line") || {}).textContent || ""),
        );
        if (line1.indexOf(lanUrl.host) < 0) {
          bad("AR-11 界面上的地址要和真放开的地址一致", JSON.stringify({ line: line1, url: st1.turn_urls[0] }));
        }

        /* AR-13 配对地址是从哪类网卡来的，界面必须如实交代。
         * 这台机器上第一个候选地址未必是手机敲得到的：装过 Docker 的机器上它是
         * 172.17.0.1，云机上是公网地址，没 DHCP 时是 169.254.*。光把「一个像地址的
         * 东西」给用户，等于让他拿一定连不通的东西去试 —— 局域网地址不啰嗦，
         * 其他三类必须有一句说明。 */
        const view1 = await win.evaluate(() => {
          const g = (id) => document.getElementById(id);
          const note = g("sec-pairing-note");
          const turn = g("sec-pairing-turn");
          return {
            line: String((g("sec-pairing-line") || {}).textContent || ""),
            note: note ? { text: String(note.textContent || ""), shown: getComputedStyle(note).display !== "none" } : null,
            turn: turn ? { text: String(turn.textContent || ""), shown: getComputedStyle(turn).display !== "none" } : null,
            copyDisabled: Boolean((g("pairing-copy-url") || {}).disabled),
          };
        });
        const scope = String(st1.pair_scope || "");
        const expectNote = scope !== "private";
        if (!st1.pair_base || st1.pair_base.indexOf("/v1/turn") >= 0) {
          bad("AR-13 放开后配对地址该是不带路径的 base", JSON.stringify({ base: st1.pair_base }));
        } else if (view1.line.indexOf(st1.pair_base) < 0) {
          bad("AR-13 界面上那一行要用同一个配对地址", JSON.stringify({ line: view1.line.slice(0, 120), base: st1.pair_base }));
        } else if (!/^(private|cgnat|public|link_local)$/.test(scope)) {
          bad("AR-13 状态里没有如实的网卡范围标注", JSON.stringify({ pair_scope: st1.pair_scope, detail: st1.lan_detail }));
        } else if (expectNote && (!view1.note || !view1.note.shown || !/手机|连|走不到|失败/.test(view1.note.text))) {
          bad("AR-13 非局域网地址必须说明手机大概率连不通", JSON.stringify({ scope, note: view1.note }));
        } else if (!expectNote && view1.note && view1.note.shown && view1.note.text) {
          bad("AR-13 局域网地址不该啰嗦一句连不通", JSON.stringify({ scope, note: view1.note.text.slice(0, 80) }));
        } else if (!view1.turn || !view1.turn.shown) {
          bad("AR-13 开发态完整端点在放开后还要看得见", JSON.stringify(view1.turn));
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

        await win.click("#pairing-lan-btn");
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

    /* ---------- AR-16/17 Pairing-v1: 6-digit code UI ---------------------- *
     * 桌面面板上「生成配对码」按钮 → 6 位数字 + 倒计时出现；pairingState 的
     * pair_code 与界面显示一致。作废后界面不再显示码、pair_code 为空。
     */
    {
      // We should already be on the credentials tab from AR-09..11.
      // If not, navigate there.
      const settingsVisible = await win.evaluate(() => {
        const panel = document.getElementById("settings-panel");
        return panel && getComputedStyle(panel).display !== "none";
      });
      if (!settingsVisible) {
        await win.click("#account-avatar-btn");
        await win.waitForSelector("#ap-settings", { state: "visible", timeout: 8000 });
        await win.click("#ap-settings");
        await win.waitForSelector("#settings-panel", { state: "visible", timeout: 10000 });
        await win.click('.settings-tab-btn[data-stab="credentials"]');
        await win.waitForTimeout(600);
      }

      // AR-16: click "生成配对码" → 6 digits + countdown appear, pairingState.pair_code matches.
      const genBtn = await win.waitForSelector("#pairing-gen-btn", { state: "visible", timeout: 8000 });
      await genBtn.click();
      await win.waitForTimeout(800);

      const codeView = await win.evaluate(() => {
        const digits = document.getElementById("pairing-code-digits");
        const countdown = document.getElementById("pairing-code-countdown");
        const display = document.getElementById("pairing-code-display");
        return {
          digits: digits ? String(digits.textContent || "").trim() : "",
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

      // AR-17: click "立即作废" → code disappears, pairingState.pair_code is empty.
      const revokeBtn = await win.waitForSelector("#pairing-revoke-btn", { state: "visible", timeout: 5000 });
      await revokeBtn.click();
      await win.waitForTimeout(800);

      const afterRevoke = await win.evaluate(() => {
        const digits = document.getElementById("pairing-code-digits");
        const display = document.getElementById("pairing-code-display");
        const actions = document.getElementById("pairing-code-actions");
        return {
          digits: digits ? String(digits.textContent || "").trim() : "",
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

    done("e2e_android_roster");
  } catch (err) {
    bad("unexpected error", err && err.message);
    done("e2e_android_roster");
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
