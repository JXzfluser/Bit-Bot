/* e2e_desktop_turn_cancel.mjs — KP-02「停止」到底能不能按到（真渲染 + 真回合）
 *
 * 这条门禁存在的理由：`#turn-cancel` 在 DOM 里一直有，但**从来没有人取消隐藏** ——
 * 也就是说「停止」这个动作在界面上根本不存在。CSS 早就写好了「回合进行中『取消』
 * 顶掉麦克风的位置」，白写着；静态判据（prove_m53b）能证明接线接上了，证明不了
 * 「忙闲信号真的到了渲染进程、按钮真的出现、点下去真的收得回」。
 *
 * 覆盖：
 *   1) 冷启动空闲：按钮藏着，且在布局里没有盒子（不是 0 尺寸幽灵）、麦克风在位；
 *   2) 起一个真回合（provider 是本地桩，故意慢 8s）→ 按钮出现、有真实尺寸、
 *      麦克风被顶掉（`#composer .row:has(#turn-cancel:not([hidden]))` 那条 CSS 生效）；
 *   3) 点它 → 回合结算、按钮自己收起（不会永远亮着）；
 *   4) 空闲时再点一次 → Host 如实回 had_active_turn:false，界面说「没有在执行的回合」，
 *      而不是假装成功停下了什么。
 *
 * 纪律：独立 user-data-dir；跑完关进程。
 * 数据根用**仓库 data/**（与本仓 e2e_desktop_room_orchestration 同口径）——
 * 第一版试过 BITBOT_DATA_ROOT 指向空临时目录，内核在空根上几百毫秒就崩
 * （kernel_crashed），根本走不到「回合在跑」这个观察点。会话文件跑前快照、跑后还原。
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

const SESS = path.join(REPO, "data/desktop/sessions.json");
const sessionsBefore = fs.existsSync(SESS) ? fs.readFileSync(SESS) : null;

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
  const proc = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BITBOT_STUB_PORT: String(port),
      // 故意慢：不慢的话回合可能在第一次轮询前就结束了，「按钮出现过」这件事
      // 永远观察不到（假绿）。2s 时第一版就栽在这里：按钮刚断言完就被回合收走。
      BITBOT_STUB_DELAY_MS: "8000",
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

(async () => {
  const port = await freePort();
  const stub = await startStub(port);
  let app = null;
  try {
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [
        path.join(DESKTOP, "main.js"),
        "--no-sandbox",
        "--disable-gpu",
        "--user-data-dir=" + electronUserDataDir("turn-cancel"),
      ],
      cwd: REPO,
      env: electronLaunchEnv({
        DISPLAY: process.env.DISPLAY || "",
        PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
        MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
        BITBOT_REPO_ROOT: REPO,
        BITBOT_NO_SECRET_SYNC: "1",
        BITBOT_DESKTOP_AUTOSTART: "0",
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + port + "/v1",
        BITBOT_LLM_API_KEY: "e2e-stub-key",
        BITBOT_LLM_MODEL: "e2e-stub",
        BITBOT_LLM_STREAM: "0",
      }),
      timeout: 90000,
    });
    const win = await app.firstWindow({ timeout: 60000 });
    // state:"attached" —— 这个按钮**本来就该是 hidden 的**，默认的「等到可见」会一直等
    await win.waitForSelector("#composer #turn-cancel", { state: "attached", timeout: 60000 });
    await win.waitForTimeout(600);

    const sessionId = await win.evaluate(async () => {
      const r = await window.bitbot.sessions.create("停止验证");
      return (r && r.session && r.session.id) || "";
    });

    /* ---------- 1) 空闲：按钮藏着，且没有盒子 ---------- */
    const idle = await win.evaluate(() => {
      const b = document.getElementById("turn-cancel");
      const r = b.getBoundingClientRect();
      const v = document.getElementById("voice-btn");
      return { hidden: b.hidden, w: r.width, h: r.height, voice: !!(v && v.offsetParent) };
    });
    idle.hidden && idle.w === 0 && idle.h === 0
      ? ok("冷启动空闲：停止按钮藏着且没有盒子（不是 0 尺寸幽灵）")
      : bad("idle state", JSON.stringify(idle));
    idle.voice
      ? ok("空闲时麦克风在位（停止按钮没抢它位置）")
      : bad("麦克风在空闲时不见了", JSON.stringify(idle));

    /* ---------- 2) 起一个真回合（桩慢 8s）→ 按钮显形 ---------- */
    await win.evaluate((sid) => {
      window.__turnDone = null;
      // 不 await：整条回合在后台跑，模拟用户按下回车之后的状态
      window.bitbot.turn("你好，随便说点什么", { sessionId: sid })
        .then((r) => { window.__turnDone = { ok: !!(r && r.ok), ended: true }; })
        .catch((e) => { window.__turnDone = { ok: false, ended: true, error: String((e && e.message) || e) }; });
    }, sessionId);
    const appeared = await win
      .waitForFunction(() => !document.getElementById("turn-cancel").hidden, null, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) {
      bad("回合在跑，但停止按钮没有出现（= 用户没有停止可点）");
    } else {
      const busy = await win.evaluate(() => {
        const b = document.getElementById("turn-cancel");
        const r = b.getBoundingClientRect();
        const v = document.getElementById("voice-btn");
        return { w: r.width, h: r.height, voiceGone: !v.offsetParent };
      });
      busy.w > 20 && busy.h > 16
        ? ok("回合在跑：停止按钮显形且有真实尺寸（" + Math.round(busy.w) + "×" + Math.round(busy.h) + "）")
        : bad("按钮显形了但没有尺寸", JSON.stringify(busy));
      busy.voiceGone
        ? ok("停止按钮顶掉了麦克风的位置（`:has(#turn-cancel:not([hidden]))` 那条 CSS 真生效）")
        : bad("麦克风还在，两个按钮会挤在一起", JSON.stringify(busy));
      await win.screenshot({ path: path.join(os.tmpdir(), "bb-turn-cancel-busy.png") });
      await win.click("#turn-cancel");
    }

    /* ---------- 3) 点完之后按钮自己收起 ---------- */
    const settled = await win
      .waitForFunction(
        () => window.__turnDone && window.__turnDone.ended && document.getElementById("turn-cancel").hidden,
        null,
        { timeout: 60000 },
      )
      .then(() => true)
      .catch(() => false);
    settled
      ? ok("按下停止后回合结算，按钮自己收起（不会永远亮着）")
      : bad("回合没结算或按钮没收起", JSON.stringify(await win.evaluate(() => ({
        done: window.__turnDone,
        hidden: document.getElementById("turn-cancel").hidden,
      }))));

    /* ---------- 4) 空闲时再点：如实说「没有在执行的回合」 ---------- */
    const receipt = await win.evaluate(async () => {
      const r = await window.bitbot.cancelTurn();
      const b = document.getElementById("turn-cancel");
      b.hidden = false; // 强制摆出来，模拟用户在这一刻还是点了
      b.click();
      await new Promise((x) => setTimeout(x, 400));
      const text = document.body.innerText || "";
      b.hidden = true;
      return { had: r && r.had_active_turn, said: /没有在执行的回合/.test(text) };
    });
    receipt.had === false
      ? ok("空闲时 Host 如实回 had_active_turn:false")
      : bad("空闲时回执不对", JSON.stringify(receipt));
    receipt.said
      ? ok("界面说「没有在执行的回合」，没有假装停下了什么")
      : bad("空按没有回执", JSON.stringify(receipt));

    await win.screenshot({ path: path.join(os.tmpdir(), "bb-turn-cancel-idle.png") });
  } finally {
    if (app) await app.close();
    stub.kill();
    // 还原会话文件（本次那一轮不留在仓库 data 里）
    if (sessionsBefore) fs.writeFileSync(SESS, sessionsBefore);
  }
  console.log("\ne2e_desktop_turn_cancel: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => {
  console.error("e2e_desktop_turn_cancel fatal:", e && e.message ? e.message : e);
  process.exit(1);
});
