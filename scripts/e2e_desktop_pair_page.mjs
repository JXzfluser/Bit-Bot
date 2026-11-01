/* e2e_desktop_pair_page.mjs — 配对落地页 /pair 的真 HTTP 门禁（PP-01..PP-10）
 *
 * 上一波（G-67）把配对搬进了「账户 → 移动端远程控制」，但留下一条半真：
 * 弹窗里那颗按钮叫**复制配对链接**，复制出去的却是 `http://192.168.x.x:18765` ——
 * 粘到微信 / 手机浏览器里打开，得到的是 `unknown_cn_inbound_route` 的 JSON 404，
 * 而且那份 404 里的 routes 清单连 /v1/pair/* 都没列（过期清单会教用户走错路）。
 * 一个「链接」点开不是页面，就不该叫链接。
 *
 * 这一波只补这一屏：入站服务加一个**只读**落地页（GET /pair，GET / 同页），
 * 告诉拿到这条 URL 的人「这是哪台桌面、手机下一步该干什么、现在能不能连」。
 *
 * 安全口径（钉死，别越界）：
 *   - 落地页**不是第二个 redeem 面**：没有表单、不 fetch /v1/pair/redeem。
 *     谁在浏览器里输 6 位码，令牌就会落到那个浏览器里 —— 那不是配对的客户端，
 *     是白送一个 bearer。配对动作仍然只在手机 App 里做。
 *   - 落地页不含 64 位令牌、不含配对码原文。它未鉴权、局域网里谁都敲得开，
 *     泄露面与 /v1/pair/discover 同级（hostname + 端口），不许再高。
 *   - 不引用任何外部资源：内网地址和主机名不许顺带发给第三方。
 *
 * 断言：
 *   PP-01 GET /pair → 200 + text/html（不是 JSON 404）
 *   PP-02 页面说清「这是哪台桌面 + 手机下一步干什么」：主机名、端口、「连接 Desktop」
 *   PP-03 页面不含 64 位配对令牌；生成配对码之后也不含那 6 位数字
 *   PP-04 页面不是第二个 redeem 面：无 <form>、无指向 redeem 的脚本
 *   PP-05 局域网没放开时如实写「只有桌面自己这台机器能连」，不假装能连
 *   PP-06 GET / 也回同一页（复制链接粘进浏览器不再 404）
 *   PP-07 未知路由的 404 清单已含 /pair、/v1/pair/discover、/v1/pair/redeem
 *   PP-08 弹窗里复制到的确实是 /pair 链接，且与 pairing.state() 的 pair_page_url 一致
 *   PP-09 页面无外部资源引用（src/href 不指向 http(s)://）
 *   PP-10 页面带头：noindex（公网隧道下不交给搜索引擎）、no-store、nosniff、CSP 只放内联样式
 *
 * 跑法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_pair_page.mjs
 * 缺 electron / 缺显示环境时诚实 SKIP（SKIP ≠ PASS）。
 *
 * ── 修复前红（HEAD 0556e7a 产品代码的真实输出，PASS=1 FAIL=10）───────────────
 *   唯一那条绿是「收尾自清」，不是断言。现场：
 *   ✗ PP-01 GET /pair 不是页面 — {"status":404,"type":"application/json; charset=utf-8",
 *       "head":"{\"ok\":false,\"error\":\"unknown_cn_inbound_route\",\"routes\":[…]}"}
 *   ✗ PP-02 页面信息不全 — missing ["ack-agent-sandbox-set-2clqt","41795","连接 Desktop"]
 *   ✗ PP-06 GET / 不是落地页 — 同一个 JSON 404
 *   ✗ PP-07 404 清单过期 — missing ["/pair","/v1/pair/discover","/v1/pair/redeem"]
 *   ✗ PP-08 复制到的不是配对页面链接 — clip "http://25.4.80.50:41795"、pair_page_url ""
 *   ✗ PP-03 / 04 / 09 / 10 因页面不存在而未跑（红得各自说话，不合成一条异常）
 * ── 修复后绿 ──────────────────────────────────────────────────────────
 *   e2e_desktop_pair_page: PASS=11 FAIL=0 SKIP=0
 *   （/pair 与 / 都回 200 text/html；未放开时写「只在桌面自己这台机器上开着」；
 *     弹窗那颗按钮复制的是 http://<lan-ip>:<port>/pair，与 pairing.state() 一致）
 */
import path from "path";
import fs from "fs";
import net from "net";
import os from "os";
import http from "http";
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
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : ""));
};
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_pair_page: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_pair_page: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_pair_page: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_pair_page: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "pairpage", {
  "bots.json": {
    bots: [{ id: "b1", name: "配对助手", job: "配对", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW }],
    primary: "b1",
  },
  "settings.json": { notify: {} },
  "sessions.json": { sessions: [] },
});

/* 端口：先问内核要一个空闲口，别和真实实例抢 18765。
   抢到了也不谎报 —— 起不来就是 listening=false，PP-01 会红得明白。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
const PORT = await freePort();

let launchSeq = 0;
function launch(w, h) {
  return _electron.launch({
    executablePath: ELECTRON,
    args: [
      path.join(DESKTOP, "main.js"),
      "--no-sandbox",
      "--disable-gpu",
      "--user-data-dir=" + electronUserDataDir("pairpage-" + ++launchSeq),
    ],
    cwd: REPO,
    env: electronLaunchEnv(
      gateAppEnv(root, {
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
        BITBOT_LLM_API_KEY: "gate-no-call",
        BITBOT_LLM_MODEL: "gate-no-call",
        BITBOT_LLM_STREAM: "0",
        BITBOT_CN_INBOUND_PORT: String(PORT),
      }),
    ),
  });
}

async function openWindow(w, h) {
  const app = await launch(w, h);
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    for (const x of BrowserWindow.getAllWindows()) {
      x.setAutoHideMenuBar(true);
      x.setMenuBarVisibility(false);
    }
  }).catch(() => {});
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  await win.evaluate(([W, H]) => window.resizeTo(W, H), [w, h]);
  await win.waitForTimeout(300);
  return { app, win };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: p, timeout: 4000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          type: String(res.headers["content-type"] || ""),
          headers: res.headers,
          body,
        }),
      );
    });
    req.on("error", (e) => resolve({ status: 0, type: "", headers: {}, body: String(e && e.message) }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, type: "", headers: {}, body: "timeout" });
    });
  });
}

async function waitListening(win) {
  for (let i = 0; i < 30; i++) {
    const st = await win.evaluate(() => window.bitbot.pairing.state()).catch(() => null);
    if (st && st.ok && st.listening && st.port) return st;
    await sleep(500);
  }
  return null;
}

async function waitLanOpen(win) {
  for (let i = 0; i < 30; i++) {
    const st = await win.evaluate(() => window.bitbot.pairing.state());
    if (st && st.ok && st.lan_open) return st;
    await sleep(500);
  }
  return await win.evaluate(() => window.bitbot.pairing.state());
}

function shutdown(app) {
  if (!app) return Promise.resolve();
  const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), sleep(ms)]);
  return within(
    app.evaluate(({ app: electronApp }) => {
      electronApp.isQuiting = true;
      electronApp.quit();
    }).then(() => within(app.close(), 12000)),
    20000,
  );
}

let app = null;
try {
  const opened = await openWindow(1280, 800);
  app = opened.app;
  const win = opened.win;

  const st0 = await waitListening(win);
  if (!st0) {
    bad("PP-00 入站服务没起来（后面每条都无从量起）", "pairing.state().listening 始终 false，端口 " + PORT);
    for (let i = 1; i <= 10; i++) bad("PP-0" + i + " 前置失败，未跑（不算绿）");
    await shutdown(app);
    app = null;
    done("e2e_desktop_pair_page");
  }

  const host = os.hostname();

  /* ---------- PP-01 /pair 是页面，不是 JSON 404 ---------- */
  const r1 = await httpGet("/pair");
  if (r1.status === 200 && /text\/html/i.test(r1.type)) {
    ok("PP-01 GET /pair → 200 text/html（复制链接点开是页面，不是 unknown_cn_inbound_route）");
  } else {
    bad("PP-01 GET /pair 不是页面", JSON.stringify({ status: r1.status, type: r1.type, head: r1.body.slice(0, 160) }));
  }

  /* ---------- PP-02 说清是哪台桌面、下一步干什么 ---------- */
  const miss2 = [host, String(PORT), "连接 Desktop"].filter((s) => !r1.body.includes(s));
  if (r1.status === 200 && !miss2.length) {
    ok("PP-02 页面写明主机名 / 端口 / 手机下一步（「" + host + " · :" + PORT + " · 连接 Desktop」）");
  } else {
    bad("PP-02 页面信息不全", JSON.stringify({ missing: miss2, status: r1.status }));
  }

  /* ---------- PP-05 没放开局域网时不许假装能连 ---------- */
  const lanOffSaysSo = /只在桌面自己|只有桌面自己|没放开局域网|局域网没放开/.test(r1.body);
  if (r1.status === 200 && lanOffSaysSo) {
    ok("PP-05 局域网未放开时页面如实说明（不给一个「看起来能连」的地址）");
  } else {
    bad("PP-05 局域网未放开，页面却没说实话", JSON.stringify({ lan_open: st0.lan_open, snippet: r1.body.slice(0, 200) }));
  }

  /* ---------- PP-03 不含长期凭证 / 短码 ---------- */
  const tok = await win.evaluate(() => window.bitbot.pairing.token()).catch(() => null);
  const tokenValue = tok && tok.ok ? String(tok.token || "") : "";
  const issued = await win.evaluate(() => window.bitbot.pairing.code({ action: "issue" })).catch(() => null);
  const codeValue = issued && issued.ok ? String(issued.code || "") : "";
  const r3 = await httpGet("/pair");
  const leak64 = /[0-9a-f]{64}/i.test(r3.body);
  if (r3.status === 200 && !leak64 && !(tokenValue && r3.body.includes(tokenValue)) && !(codeValue && r3.body.includes(codeValue))) {
    ok("PP-03 页面不含 64 位令牌，也不含刚生成的配对码（" + (codeValue || "—") + "）");
  } else {
    bad("PP-03 页面不含凭证（先要存在）", JSON.stringify({ status: r3.status, leak64, hasToken: Boolean(tokenValue && r3.body.includes(tokenValue)), hasCode: Boolean(codeValue && r3.body.includes(codeValue)) }));
  }

  /* ---------- PP-04 不是第二个 redeem 面 ---------- */
  const hasForm = /<form[\s>]/i.test(r3.body);
  const hasRedeem = /redeem/i.test(r3.body);
  if (r3.status === 200 && !hasForm && !hasRedeem) {
    ok("PP-04 页面无表单、不碰 /v1/pair/redeem（配对动作只在手机 App 里做，令牌不进浏览器）");
  } else {
    bad("PP-04 页面不许变成 redeem 面（先要存在）", JSON.stringify({ status: r3.status, hasForm, hasRedeem }));
  }

  /* ---------- PP-06 GET / 同页 ---------- */
  const r6 = await httpGet("/");
  if (r6.status === 200 && /text\/html/i.test(r6.type) && r6.body.includes("连接 Desktop")) {
    ok("PP-06 GET / 也回落地页（只粘到裸地址也不撞 404）");
  } else {
    bad("PP-06 GET / 不是落地页", JSON.stringify({ status: r6.status, type: r6.type, head: r6.body.slice(0, 120) }));
  }

  /* ---------- PP-07 404 清单不再过期 ---------- */
  const r7 = await httpGet("/no-such-route");
  const want = ["/pair", "/v1/pair/discover", "/v1/pair/redeem"];
  const miss7 = want.filter((s) => !r7.body.includes(s));
  if (r7.status === 404 && !miss7.length) {
    ok("PP-07 未知路由的 404 清单列出了 /pair 与两条配对端点（不再教用户走错路）");
  } else {
    bad("PP-07 404 清单过期", JSON.stringify({ status: r7.status, missing: miss7, head: r7.body.slice(0, 200) }));
  }

  /* ---------- PP-09 不引外部资源 ---------- */
  const ext = (r3.body.match(/(?:src|href)\s*=\s*["']https?:\/\//gi) || []).length;
  if (r3.status === 200 && ext === 0) {
    ok("PP-09 页面无外部资源引用（主机名和内网地址不会顺带发给第三方）");
  } else {
    bad("PP-09 页面不许引外部资源（先要存在）", JSON.stringify({ status: r3.status, count: ext }));
  }

  /* ---------- PP-10 公网隧道下不把自己交给搜索引擎 ---------- */
  const hh = r3.headers || {};
  const headMiss = [];
  if (!/noindex/i.test(String(hh["x-robots-tag"] || ""))) headMiss.push("x-robots-tag:noindex");
  if (!/no-store/i.test(String(hh["cache-control"] || ""))) headMiss.push("cache-control:no-store");
  if (String(hh["x-content-type-options"] || "").toLowerCase() !== "nosniff") headMiss.push("x-content-type-options:nosniff");
  if (!/default-src\s*'none'/.test(String(hh["content-security-policy"] || ""))) headMiss.push("csp:default-src 'none'");
  if (r3.status === 200 && !headMiss.length) {
    ok("PP-10 页面带 noindex / no-store / nosniff / CSP（走 cloudflared 公网隧道时也不被索引、不被缓存）");
  } else {
    bad("PP-10 页面缺安全头（先要存在）", JSON.stringify({ status: r3.status, missing: headMiss, got: Object.keys(hh) }));
  }

  /* ---------- PP-08 弹窗复制到的确实是这条链接 ---------- */
  /* 「点得到」和「复制对了」是两个病，各自说话，别合成一条 unexpected error。 */
  try {
    await win.evaluate(() => window.bitbot.pairing.setLan(true)).catch(() => {});
    const stLan = await waitLanOpen(win);
    await win.click("#account-avatar-btn");
    await win.waitForSelector("#ap-remote", { state: "visible", timeout: 8000 });
    await win.click("#ap-remote");
    await win.waitForTimeout(400);
    await win.click("#mc-copy-url-btn");
    await win.waitForTimeout(400);
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText()).catch(() => "");
    const pageUrl = String((stLan && stLan.pair_page_url) || "");
    if (clip && pageUrl && clip === pageUrl && clip.endsWith("/pair")) {
      ok("PP-08 弹窗「复制配对链接」复制的是 /pair 页面：" + clip);
    } else {
      bad("PP-08 复制到的不是配对页面链接", JSON.stringify({ clip: clip.slice(0, 120), pair_page_url: pageUrl, lan_open: stLan && stLan.lan_open }));
    }
    await win.keyboard.press("Escape").catch(() => {});
    await win.waitForTimeout(200);
  } catch (e) {
    bad("PP-08 弹窗这条路走不到（入口 / 按钮 / 剪贴板任一环节）", String((e && e.message) || e).split("\n")[0].slice(0, 200));
  }

  await shutdown(app);
  app = null;
} catch (err) {
  bad("unexpected error — " + String((err && err.message) || err).split("\n")[0].slice(0, 200));
  if (app) {
    await shutdown(app).catch(() => {});
    app = null;
  }
}

const left = countAppMains(root);
if (left === 0) ok("收尾：门禁实例全清（0 个残留 main）");
else bad("收尾：还有 " + left + " 个门禁实例没退");
killGateProcs("pairpage");

done("e2e_desktop_pair_page");
