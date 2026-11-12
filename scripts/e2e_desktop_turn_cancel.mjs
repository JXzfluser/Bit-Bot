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
      // CN-05e 用：正文里的 [[gap:NNN]] 让这一条请求一边吐字一边跑几秒。
      // 带 gap 的那一条会被桩跳过上面的 8s 整体延迟（见 openai_compat_stub.js 那段注释），
      // 否则「按停止」发生在第一个字节之前，那半句根本还没吐出来 —— §8.121 实测 stop_ms=11。
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
        /* CN-05e 要观察「停在半句」这件事，必须让增量真的流到屏幕 —— 这里**不再**写
           BITBOT_LLM_STREAM=0，用产品默认（host_ffi.js:5880：只有显式 "0" 才关流式）。
           其余几步的回合不带 [[gap]]，仍由桩的 8s 整体延迟撑住「回合在跑」这个观察点。 */
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

    /* ---------- 5) CN-05 从输入框走的那一次「停止」：四个来源各怎么说（KP-08 尾账 #64）
       上面 2) 直接调 window.bitbot.turn，绕过了 runUserTurn —— 也就是它从来没起过乐观命令，
       台账里根本没有这一笔，「按了停止之后屏幕怎么说」这件事到今天没被量过。
       这一条走真链路：填输入框 → 点发送（渲染端 begin 出一条 cm- 命令、那一行立刻上屏）
       → 回合在跑时按停止 → 同时读 ①那一行的 data-send ②台账里那条的 state
       ③回执 JSON 里有没有「这次是被用户停下来的」这件事 ④assistant 侧有没有一行说停了。
       判据钉的是关系：停止不能改「送达」的口径（那一行仍按送达证据判），
       但「停止」本身必须是屏幕上看得到的一件事，不能和「模型答完了」共用同一个形状。 */
    const cm5 = await win.evaluate(async () => {
      const inp = document.getElementById("text");
      inp.value = "停止验证：说满八秒再停";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      const before = document.querySelectorAll("#log .msg.user[data-client-mid]").length;
      window.__cn5 = { sendAt: Date.now() };
      document.getElementById("send").click();
      for (let i = 0; i < 240; i++) {
        const rows = document.querySelectorAll("#log .msg.user[data-client-mid]");
        if (rows.length > before) {
          window.__cn5.rowAt = Date.now();
          return rows[rows.length - 1].dataset.clientMid;
        }
        await new Promise((x) => setTimeout(x, 25));
      }
      return "";
    });
    if (!cm5) {
      bad("CN-05a 输入框那条没能在台账里起出乐观命令（后面的观察全部无从谈起）");
    } else {
      const shown = await win
        .waitForFunction(() => !document.getElementById("turn-cancel").hidden, null, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      shown ? ok("CN-05a 走输入框的回合也在跑，停止按钮同样显形（不是只有 bitbot.turn 那条路）")
        : bad("CN-05a 走输入框的回合没有可按的停止按钮");
      const stopAt = Date.now();
      if (shown) await win.click("#turn-cancel");
      const settled = await win
        .waitForFunction(
          (cm) => {
            const c = window.__bitbotSendLedger && window.__bitbotSendLedger.get(cm);
            return !!c && c.state !== "pending";
          },
          cm5,
          { timeout: 60000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!settled) {
        bad("CN-05b 按下停止后台账那条一直停在 pending", JSON.stringify(cm5));
      } else {
        const m = await win.evaluate((cm) => {
          const el = document.querySelector('#log .msg.user[data-client-mid="' + cm + '"]');
          const c = window.__bitbotSendLedger.get(cm);
          let rj = null;
          try { rj = JSON.parse(document.getElementById("json-out").textContent || "null"); } catch (_) { rj = null; }
          const texts = Array.from(document.querySelectorAll("#log .msg.assistant"))
            .filter((x) => getComputedStyle(x).display !== "none")
            .map((x) => ((x.querySelector(".body") || {}).textContent || "").trim());
          return {
            rowSend: el ? el.dataset.send || "" : "（界面上没有那一行）",
            rowMid: el ? el.dataset.mid || "" : "",
            ledger: c ? { state: c.state, entry_id: c.entry_id || "", code: c.code || "" } : null,
            receipt: rj && typeof rj === "object"
              ? {
                  keys: Object.keys(rj).filter((k) => /cancel/i.test(k)).map((k) => k + "=" + String(rj[k])),
                  has: Object.keys(rj).some((k) => /cancel/i.test(k)),
                  ok: rj.ok,
                  errCode: rj.error_code || "",
                  echo: rj.echo_entry_id || "",
                  stored_user: (rj.stored_ids || {}).user || "",
                }
              : { keys: [], has: false, ok: null, echo: "", stored_user: "" },
            stopLine: texts.filter((t) => /已停止|已取消|Cancelled|canceled|cancelled/i.test(t)).slice(-1)[0] || "",
            lastAssistant: texts.filter((t) => t && !/已停止|已取消/.test(t)).slice(-1)[0] || "",
            rowLead: window.__cn5 && window.__cn5.rowAt ? window.__cn5.rowAt - window.__cn5.sendAt : 0,
          };
        }, cm5);
        const stopToFinalMs = Date.now() - stopAt;
        // 机器可读的一行：矩阵的「可感面」只认这个 token，不认散文（G-40 那次假红的教训）。
        console.log("CN05_METRICS lead_ms=" + m.rowLead + " stop_ms=" + stopToFinalMs);
        /* ①+② 停止不改送达口径：那一行说什么，必须和台账说的一样，且台账仍按送达证据判。 */
        m.ledger && m.rowSend === m.ledger.state
          ? ok("CN-05b 屏幕那一行的 data-send（" + m.rowSend + "）= 台账 state（" + m.ledger.state +
              "）—— 停止没把两轴拧成一轴【量出来：发出→上屏 " + m.rowLead +
              "ms，按下停止→落终态 " + stopToFinalMs + "ms（含 250ms 轮询粒度）】")
          : bad("CN-05b 屏幕与台账不一致", JSON.stringify(m));
        m.ledger && (m.ledger.state === "durable" || m.ledger.state === "unmatched")
          && m.receipt.echo && m.rowMid && m.receipt.echo === m.rowMid
          ? ok("CN-05b 台账按送达证据判（回执 echo=" + m.receipt.echo + " 与界面上那条 " + m.rowMid + " 对得上）")
          : bad("CN-05b 停止那次的终态不是从送达证据来的", JSON.stringify({ ledger: m.ledger, receipt: m.receipt, rowMid: m.rowMid }));
        /* ③ 「被用户停止」必须是回执里的一件事实，而不是让渲染端去猜。 */
        m.receipt.has
          ? ok("CN-05c Host 回执带了停止这件事：" + JSON.stringify(m.receipt.keys))
          : bad("CN-05c Host 回执里没有任何「这次是被用户停下来的」标记（界面只能靠猜，用户看不出这是停了还是答完了）",
              JSON.stringify({ 回执键: m.receipt.keys, ok: m.receipt.ok, 错误码: m.receipt.errCode, 那一行: m.rowSend, 台账: m.ledger && m.ledger.state, 屏上最后一行非停止文案: m.lastAssistant.slice(0, 60) }));
        /* ④ 屏幕上必须看得见「停了」这件事。 */
        m.stopLine
          ? ok("CN-05d 界面看得见停止这件事：" + m.stopLine.slice(0, 60))
          : bad("CN-05d 按了停止，屏幕上没有任何一行说它停了（用户看到的是回合凭空结束）",
              JSON.stringify({ 屏上最后一行: m.lastAssistant.slice(0, 60), 那一行: m.rowSend, 台账: m.ledger && m.ledger.state }));
        await win.screenshot({ path: path.join(os.tmpdir(), "bb-turn-cancel-ledger.png") });

        /* ---------- 6) CN-05-NC 负向对照：不按停止、让它自己答完的那一次 ----------
           先说清这一刀切在哪：想复刻「Host 不带 cancelled」的旧形状，得从页面里截住
           window.bitbot.turn —— 实测截不住（Proxy 覆盖后 __ncRan=0：contextBridge 递进来的
           那个对象在页面上不可写）。所以这里用**同一套判据跑第二种真场景**做对照：
           一次正常答完的回合。CN-05c/CN-05d 认的是「被用户停止」这件事，不是「回合结束了」；
           正常那一次必须当场说不出 cancelled、也画不出「已取消」，否则那两条就是恒真。
           送达那根轴不靠这条对照 —— 它由 G-121 的 OP-01..05 带负向对照守着。 */
        const nc = await win.evaluate(async (first) => {
          const saidStop = () =>
            Array.from(document.querySelectorAll("#log .msg.assistant"))
              .filter((x) => getComputedStyle(x).display !== "none")
              .map((x) => ((x.querySelector(".body") || {}).textContent || "").trim())
              .filter((t) => /已停止|已取消|cancelled/i.test(t)).length;
          const inp = document.getElementById("text");
          inp.value = "对照：这一条不按停止，等它答完";
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          const before = document.querySelectorAll("#log .msg.user[data-client-mid]").length;
          const saidBefore = saidStop();
          document.getElementById("send").click();
          let cm = "";
          for (let i = 0; i < 240; i++) {
            const rows = document.querySelectorAll("#log .msg.user[data-client-mid]");
            if (rows.length > before) { cm = rows[rows.length - 1].dataset.clientMid; break; }
            await new Promise((x) => setTimeout(x, 25));
          }
          if (!cm || cm === first) return { skipped: "没起出对照那条乐观命令" };
          const settled = await new Promise(async (res) => {
            for (let i = 0; i < 240; i++) {
              const c = window.__bitbotSendLedger.get(cm);
              if (c && c.state !== "pending") return res(true);
              await new Promise((x) => setTimeout(x, 250));
            }
            res(false);
          });
          if (!settled) return { skipped: "对照那条一直停在 pending" };
          let rj = null;
          try { rj = JSON.parse(document.getElementById("json-out").textContent || "null"); } catch (_) { rj = null; }
          const el = document.querySelector('#log .msg.user[data-client-mid="' + cm + '"]');
          const c = window.__bitbotSendLedger.get(cm);
          return {
            rowSend: el ? el.dataset.send || "" : "",
            state: c ? c.state : "",
            hasCancel: !!(rj && Object.keys(rj).some((k) => /cancel/i.test(k) && rj[k] === true)),
            newStopLines: saidStop() - saidBefore,
          };
        }, cm5);
        if (nc.skipped) {
          bad("CN-05-NC 负向对照没跑起来：" + nc.skipped);
        } else {
          !nc.hasCancel && nc.newStopLines === 0
            ? ok("CN-05-NC 正常答完那一次：回执里没有 cancelled、屏上没多「已取消」行（" +
                 nc.newStopLines + "）—— CN-05c/05d 认的是停止这件事，不是任何一次回合结束")
            : bad("CN-05-NC 对照没翻假：不按停止也报出了停止这件事", JSON.stringify(nc));
          nc.state === "durable" && nc.rowSend === nc.state
            ? ok("CN-05-NC 同一条判据在正常回合上仍然成立（那一行 " + nc.rowSend + " = 台账 " + nc.state +
                 "）—— 两轴拆开后没有把成功的那一路弄坏")
            : bad("CN-05-NC 正常回合被改坏了", JSON.stringify(nc));
        }
      }
    }

    /* ---------- 7) CN-05e 停在「正在吐字」的中间：那半句必须三面都在（KP-08 尾账 #67，§8.121④2）
       这一步是 §8.121 的落地：以前按停止时，屏幕上的半句会凭空消失 —— 内核在取消抢跑赢的那一侧
       交回空串（run_moon_turn.js:453-474 + runtime/agent_loop.mbt:961-969 不 append），Host 是唯一
               还留着增量的地方，所以修复扣在 Host（main.js latchTurnPartialIfStreaming），落库/回执/重画三条路共用同一份文本。
       观察前提由 e2e_desktop_stream_typing 先证明（ST-01..04：真开机、真流式、屏上字数在涨）。
       判据钉三面同真：① 屏幕上那半句还在、且不是一条悬着的流式假气泡 ② Host 回执带着它
       ③ sessions.json 里有它。任何一面单独绿都不算 —— 少哪一面，用户看到的都是「话说到一半没了」。 */
    const cm5e = await win.evaluate(async () => {
      const inp = document.getElementById("text");
      inp.value =
        "停止验证：一个字一个字吐出来 [[gap:260]] " +
        "半句也要留在屏上这一段要足够长一些好让停止落在中间而不是开头";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      const before = document.querySelectorAll("#log .msg.user[data-client-mid]").length;
      document.getElementById("send").click();
      for (let i = 0; i < 240; i++) {
        const rows = document.querySelectorAll("#log .msg.user[data-client-mid]");
        if (rows.length > before) return rows[rows.length - 1].dataset.clientMid || "";
        await new Promise((x) => setTimeout(x, 25));
      }
      return "";
    });
    if (!cm5e) {
      bad("CN-05e 这一条没起出乐观命令（三面观察无从谈起）");
    } else {
      const streaming = await win
        .waitForFunction(
          () => {
            const el = document.querySelector('#log .msg.assistant[data-streaming="1"] .body');
            return !!el && String(el.textContent || "").replace(/\s+/g, " ").trim().length >= 12;
          },
          null,
          { timeout: 25000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!streaming) {
        bad("CN-05e 屏幕上从没出现过 ≥12 字的流式气泡：半句还没吐出来就谈不到「停在中间」" +
            "（前置门 e2e_desktop_stream_typing 的 ST-04 若同时红，是流式链路出了问题）");
      } else {
        const halfSeen = await win.evaluate(() => {
          const el = document.querySelector('#log .msg.assistant[data-streaming="1"] .body');
          return String((el && el.textContent) || "").replace(/\s+/g, " ").trim();
        });
        await win.click("#turn-cancel");
        const settledE = await win
          .waitForFunction(
            (cm) => {
              const c = window.__bitbotSendLedger && window.__bitbotSendLedger.get(cm);
              return !!c && c.state !== "pending";
            },
            cm5e,
            { timeout: 60000 },
          )
          .then(() => true)
          .catch(() => false);
        if (!settledE) {
          bad("CN-05e 按了停止但台账没落终态");
        } else {
          const faces = await win.evaluate((cm) => {
            let rj = null;
            try { rj = JSON.parse(document.getElementById("json-out").textContent || "null"); } catch (_) { rj = null; }
            /* 只看**这一轮之后**的 assistant 行：#log 里还留着前面几轮（CN-05/NC）的答复，
               它们的开头和桩回执同出一句（"Bit Bot stub reply: …"），整屏扫一遍会让
               「半句还在不在」这条判据在前一轮的旧行上误判成绿 —— 实测 screen=47 vs 库里 16 就是这么来的。 */
            const anchor = document.querySelector('#log .msg.user[data-client-mid="' + cm + '"]');
            const rows = [];
            for (let n = anchor ? anchor.nextElementSibling : null; n; n = n.nextElementSibling) {
              if (n.classList && n.classList.contains("msg") && n.classList.contains("assistant")) {
                rows.push({
                  streaming: String(n.dataset.streaming || ""),
                  txt: String((n.querySelector(".body") || {}).textContent || "").replace(/\s+/g, " ").trim(),
                });
              }
            }
            const el = document.querySelector('#log .msg.user[data-client-mid="' + cm + '"]');
            return {
              rowSend: el ? el.dataset.send || "" : "",
              state: (window.__bitbotSendLedger.get(cm) || {}).state || "",
              receiptCancelled: !!(rj && rj.cancelled === true),
              receiptPartialFlag: rj && typeof rj === "object" ? Number(rj.cancelled_partial || 0) : 0,
              receiptAssistant: (() => {
                const ms = (rj && Array.isArray(rj.messages) ? rj.messages : [])
                  .filter((m) => m && m.role === "assistant")
                  .map((m) => String(m.text || "").replace(/\s+/g, " ").trim());
                return ms.length ? ms[ms.length - 1] : "";
              })(),
              screenRows: rows,
              streamLeft: rows.filter((r) => r.streaming === "1").length,
              streamLeftDoc: document.querySelectorAll('#log .msg.assistant[data-streaming="1"]').length,
            };
          }, cm5e);
          /* 库里那一条：用乐观 id 认会话（KP-08 T3-04 之后 Host 采纳的就是这个 id），
             不靠「取最后一个会话」猜——门禁同时开着别的会话时会猜错。 */
          let storeAssistant = "";
          let storeErr = "";
          try {
            const j = JSON.parse(fs.readFileSync(SESS, "utf8"));
            const s = (j.sessions || []).find((x) =>
              (x.messages || []).some((m) => m && m.id === cm5e));
            const ms = (s && s.messages) || [];
            /* 只看**这一条用户消息之后**的 assistant 行。取「会话里最后一条 assistant」是错的：
               取消那一轮不落 assistant 时，最后一条是**上一轮**答完的那句，
               判据会在别人的消息上误判成绿（负向对照实测 store=35 字 = 对照那一条）。 */
            let idx = -1;
            for (let i = ms.length - 1; i >= 0; i--) {
              if (ms[i] && ms[i].id === cm5e) { idx = i; break; }
            }
            for (let i = idx + 1; i < ms.length; i++) {
              if (ms[i] && ms[i].role === "assistant") {
                storeAssistant = String(ms[i].text || "").replace(/\s+/g, " ").trim();
                break;
              }
            }
            if (!s) storeErr = "会话里找不到 id=" + cm5e;
            else if (idx < 0) storeErr = "库里找不到这一条用户消息 id=" + cm5e;
          } catch (e) {
            storeErr = String((e && e.message) || e);
          }
          const startsWithHalf = (x) =>
            x.length >= 12 && (x === halfSeen || halfSeen.startsWith(x) || x.startsWith(halfSeen));
          const screenHalf = faces.screenRows
            .filter((r) => r.streaming !== "1" && startsWithHalf(r.txt))
            .map((r) => r.txt);
          console.log(
            "CN05E_METRICS half_len=" + halfSeen.length +
            " screen=" + (screenHalf[0] || "").length +
            " receipt=" + faces.receiptAssistant.length +
            " store=" + storeAssistant.length +
            " stream_left=" + faces.streamLeft +
            " stream_left_doc=" + faces.streamLeftDoc +
            " partial_flag=" + faces.receiptPartialFlag,
          );
          screenHalf.length >= 1 && faces.streamLeft === 0 && faces.streamLeftDoc === 0
            ? ok("CN-05e① 屏上那半句还在，且收在一条正常消息行里（" + screenHalf[0].length +
                " 字，悬着的流式气泡 " + faces.streamLeft + " 条）—— 停止=停在这半句之后")
            : bad("CN-05e① 停止把那半句从屏幕上弄没了（用户看到的是话凭空断掉）", JSON.stringify({
                吐到停时: halfSeen.slice(0, 40),
                屏上助手行: faces.screenRows,
              }));
          startsWithHalf(faces.receiptAssistant) || faces.receiptPartialFlag === 1
            ? ok("CN-05e② Host 回执带着这半句（messages 末条 " + faces.receiptAssistant.length +
                " 字，cancelled_partial=" + faces.receiptPartialFlag + "）")
            : bad("CN-05e② 回执里没有那半句", JSON.stringify({
                receiptAssistant: faces.receiptAssistant.slice(0, 40),
                half: halfSeen.slice(0, 40),
              }));
          startsWithHalf(storeAssistant)
            ? ok("CN-05e③ sessions.json 里有它（" + storeAssistant.length + " 字）—— 刷新后不会消失")
            : bad("CN-05e③ 库里没落那半句", JSON.stringify({
                store: storeAssistant.slice(0, 40),
                half: halfSeen.slice(0, 40),
                err: storeErr,
              }));
          /* 三面同源：屏上/回执/库里必须是同一句话，不能各自拼一份。 */
          const sameSource =
            screenHalf.length >= 1 &&
            startsWithHalf(faces.receiptAssistant) &&
            startsWithHalf(storeAssistant) &&
            (storeAssistant === screenHalf[0] ||
              storeAssistant.startsWith(screenHalf[0].slice(0, 12)));
          sameSource
            ? ok("CN-05e④ 三面同源（屏上 = 回执 = 库里，同一份文本而不是三份猜测）")
            : bad("CN-05e④ 三面不同源", JSON.stringify({
                屏: (screenHalf[0] || "").slice(0, 30),
                回执: faces.receiptAssistant.slice(0, 30),
                库: storeAssistant.slice(0, 30),
              }));
          /* 停止不改送达（#64 那两根轴仍然成立）—— 这一轮加了流式，必须重新确认没把成功那侧弄坏。 */
          faces.state === "durable" && faces.rowSend === faces.state
            ? ok("CN-05e⑤ 打开流式后，停止那一次的送达口径没被改坏（那一行 " + faces.rowSend + " = 台账）")
            : bad("CN-05e⑤ 流式打开后台账/屏幕对不上", JSON.stringify(faces));
          await win.screenshot({ path: path.join(os.tmpdir(), "bb-turn-cancel-half.png") });
        }
      }
    }

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
