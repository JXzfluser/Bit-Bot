/* e2e_desktop_packaged.mjs — GP-172：装出来的 App 在「没有源码树」的机器上能起、能扫
 *
 * 为什么需要这一门（不是补充，是补最外一层）：
 *   之前所有 Electron 门禁都是 `electron hosts/desktop/main.js` —— 跑在**源码树里**，
 *   __dirname 可写、moon 在 PATH、scripts/ 就在旁边。用户拿到的却是
 *   electron-builder 打出来的 app.asar：只读、没有 moon、没有 scripts/。
 *   2026-10-29 第一次真跑 linux-unpacked 时，App 直接抛：
 *
 *     Uncaught Exception: Error: ENOENT, desktop/.env.local not found in
 *     .../resources/app.asar
 *        at upsertDesktopEnvLocal (…/app.asar/desktop/main.js:485)
 *        at syncInjectedSecretsToEnvLocal (…/app.asar/desktop/main.js:440)
 *
 *   —— 主进程在 require 阶段就炸了，窗口根本不会出现。原因有两条叠加：
 *     ① DESKTOP_ENV_LOCAL 写的是 path.join(__dirname, ".env.local")，
 *        在包里就是 asar 内的只读路径；
 *     ② main.js 自己给 BITBOT_CONTENT_MODERATION 填的默认值 "1" 落在
 *        ALLOWED_SECRET_KEYS 里，被「云端注入了密钥」这条逻辑当成用户密钥去落盘。
 *   换句话说：**开发机上一路绿的门禁，覆盖不到用户第一次双击图标的那条路。**
 *
 * 本门只认打包产物（BITBOT_PACKAGED_BIN 或默认 dist/linux-unpacked/bitbot-desktop）：
 *   P-00 装机布局成立：app.asar 在、内核二进制在、源码/scripts 不在
 *   P-01 进程活着且没有 Uncaught Exception / FATAL
 *   P-02 在 userData 下自己跑 routine_tick（desktop-sweep.jsonl ≥2 行，带 handoff_retry）
 *   P-03 注入的密钥落进 userData 的 .env.local（0600），且**包内没有** .env.local
 *   P-04 app.asar 字节不变（App 没有往自己的安装目录里写东西）
 *   P-05 SIGTERM 后退出，且退出后不再产生新 tick
 *
 * 诚实边界：本门在 Linux + xvfb 下跑；Windows/macOS 的安装包与真机安装未验（残留）。
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import net from "net";
import { spawn, spawnSync, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "hosts/desktop/package.json"));
const { chromium } = require("playwright-core");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
/** electron-builder 的 --dir 产物：按平台给默认路径（可用 BITBOT_PACKAGED_BIN 覆盖）。 */
function defaultPackagedBin() {
  if (process.platform === "darwin") {
    const arch = process.arch === "arm64" ? "mac-arm64" : "mac";
    return path.join(REPO, "hosts/desktop/dist", arch, "bitbot-desktop.app/Contents/MacOS/bitbot-desktop");
  }
  if (process.platform === "win32") {
    return path.join(REPO, "hosts/desktop/dist/win-unpacked/bitbot-desktop.exe");
  }
  return path.join(REPO, "hosts/desktop/dist/linux-unpacked/bitbot-desktop");
}
const BIN = process.env.BITBOT_PACKAGED_BIN || defaultPackagedBin();
/** mac 的资源在 <App>.app/Contents/Resources，linux/win 在 <dir>/resources。 */
const UNPACKED = path.dirname(BIN);
const RESOURCES = process.platform === "darwin"
  ? path.join(path.dirname(UNPACKED), "Resources")
  : path.join(UNPACKED, "resources");
const ASAR = path.join(RESOURCES, "app.asar");
const KERNEL = path.join(RESOURCES, "kernel/bin", process.platform === "win32" ? "desktop_turn.exe" : "desktop_turn");

let PASS = 0,
  FAIL = 0,
  SKIP = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 400) : ""));
};
const done = () => {
  console.log("e2e_desktop_packaged: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

/**
 * DISPLAY 设了不等于能用。容器/CI 里常见 `DISPLAY=:1`，但 :1 的 Xvfb 早就
 * 退了（只剩 /tmp/.X11-unix/X10x 之类僵尸 socket）。此时直接信 DISPLAY，会看到
 * Chromium 的 "Missing X server or $DISPLAY" 然后 SIGSEGV —— 看起来像「产品启动
 * 就崩」，实际是尺子环境坏了（2026-10-29 在 pack-desktop.sh 里踩到：宿主有
 * DISPLAY=:1，脚本于是跳过 xvfb-run，门就假红）。
 */
function displayUsable() {
  if (process.platform !== "linux") return true;
  if (!process.env.DISPLAY) return false;
  try {
    execFileSync("xdpyinfo", ["-display", process.env.DISPLAY], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      /* 没装 xdpyinfo：退化成「socket 在不在」。 */
      const n = /^:(\d+)/.exec(process.env.DISPLAY);
      return Boolean(n) && fs.existsSync("/tmp/.X11-unix/X" + n[1]);
    }
    return false;
  }
}

if (!fs.existsSync(BIN)) {
  /* 不假装 SKIP：没有打包产物就没验过「装好的 App」，这是缺证据，不是通过。 */
  bad("P-00 打包产物存在", BIN + " 不存在；先跑 BITBOT_PACK_TARGET=dir bash scripts/pack-desktop.sh");
  done();
}
if (!displayUsable()) {
  if (process.env.BITBOT_XVFB_WRAPPED) {
    /* 已经在 xvfb-run 里还是连不上：这是尺子坏了，不能悄悄 SKIP。 */
    bad("P-00 xvfb-run 里的 DISPLAY 不可用", "DISPLAY=" + (process.env.DISPLAY || "(unset)"));
    done();
  }
  /* 有 xvfb-run 就在虚拟显示里重跑自己，别让「宿主 DISPLAY 是死的」变成假红。 */
  const hasXvfb =
    process.platform === "linux" &&
    spawnSync("sh", ["-c", "command -v xvfb-run"], { stdio: "ignore" }).status === 0;
  if (hasXvfb && !process.env.BITBOT_XVFB_WRAPPED) {
    console.log(
      "e2e_desktop_packaged: DISPLAY=" + (process.env.DISPLAY || "(unset)") + " 连不上，改用 xvfb-run 重跑",
    );
    const r = spawnSync(
      "xvfb-run",
      ["-a", process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: "inherit", env: { ...process.env, BITBOT_XVFB_WRAPPED: "1" } },
    );
    process.exit(r.status === null ? 1 : r.status);
  }
  console.log("e2e_desktop_packaged: SKIP — 没有可用的 DISPLAY（也没有 xvfb-run）");
  console.log("e2e_desktop_packaged: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
function readLines(p) {
  try {
    return fs
      .readFileSync(p, "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(120);
  }
  return null;
}

/** 找一个空闲端口给 CDP 用（固定端口会被上一次崩溃的运行占住）。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** 等 DevTools HTTP 端点真的应答（/json/version 返回 200），不是只看端口。 */
async function waitForCdp(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/json/version");
      if (r.ok) return await r.json();
    } catch (_) {
      /* 还没起来 */
    }
    await sleep(150);
  }
  return null;
}

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-packaged-"));
const UD = path.join(WORK, "ud");
fs.mkdirSync(UD, { recursive: true });
const SWEEP_LOG = path.join(UD, "data", "routines", "desktop-sweep.jsonl");
const TICK = path.join(UD, "data", "routines", "last-tick.json");
const ENV_LOCAL = path.join(UD, ".env.local");
const SWEEP_MS = 250;
const INJECTED_KEY = "sk-packaged-probe-1234";

let child = null;
let out = "";

(async () => {
  try {
    /* ---------- P-00 装机布局 ---------- */
    const layoutProblems = [];
    if (!fs.existsSync(ASAR)) layoutProblems.push("resources/app.asar 缺失");
    if (!fs.existsSync(KERNEL)) layoutProblems.push("resources/kernel/bin/desktop_turn 缺失");
    for (const forbidden of ["moon.mod", "cmd", "scripts"]) {
      if (fs.existsSync(path.join(RESOURCES, forbidden))) {
        layoutProblems.push("包里出现了不该有的 " + forbidden);
      }
    }
    if (layoutProblems.length) {
      bad("P-00 装机布局：asar + 内核在、源码/scripts 不在", layoutProblems.join("; "));
    } else {
      ok("P-00 装机布局：app.asar + 内核二进制在，moon.mod/cmd/scripts 不在包里");
    }

    const asarBefore = fs.existsSync(ASAR) ? sha256(ASAR) : "";
    /* 只留「用户机器上会有」的环境：不继承本仓的 BITBOT_*（尤其
       BITBOT_REPO_ROOT / BITBOT_NO_SECRET_SYNC），但要保留 X 的
       DISPLAY/XAUTHORITY —— 用白名单会漏掉 XAUTHORITY，Electron 连不上
       X 会以 SIGSEGV 退出，看起来像产品崩了（2026-10-29 实测踩过一次）。 */
    const baseEnv = { ...process.env };
    for (const k of Object.keys(baseEnv)) {
      if (k.startsWith("BITBOT_")) delete baseEnv[k];
    }
    delete baseEnv.ELECTRON_RUN_AS_NODE;
    delete baseEnv.NODE_OPTIONS;
    const loopEnv = Object.assign(baseEnv, {
      PATH: "/usr/bin:/bin",
      HOME: path.join(WORK, "home"),
      XDG_CONFIG_HOME: path.join(WORK, "config"),
      TMPDIR: path.join(WORK, "tmp"),
      BITBOT_ROUTINE_DAEMON_AUTOSTART: "0",
      BITBOT_DESKTOP_AUTOSTART: "0",
      BITBOT_DESKTOP_SWEEP_MS: String(SWEEP_MS),
      BITBOT_LLM_API_KEY: INJECTED_KEY,
      BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
      BITBOT_LLM_MODEL: "gate-no-call",
      BITBOT_LLM_STREAM: "0",
    });
    for (const d of [loopEnv.HOME, loopEnv.XDG_CONFIG_HOME, loopEnv.TMPDIR]) {
      fs.mkdirSync(d, { recursive: true });
    }

    const CDP = await freePort();
    child = spawn(BIN, [
      "--no-sandbox",
      "--disable-gpu",
      "--user-data-dir=" + UD,
      "--remote-debugging-port=" + CDP,
    ], {
      cwd: UNPACKED,
      env: loopEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (d) => {
      out += String(d);
      if (out.length > 400000) out = out.slice(-200000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);

    /* ---------- P-01 主进程真活着 ---------- */
    await sleep(5000);
    const crashed = /Uncaught Exception|A JavaScript error occurred|FATAL:/.test(out);
    const alive = child.exitCode === null && child.signalCode === null;
    if (crashed) {
      const first = out.split("\n").find((l) => /Uncaught Exception|A JavaScript error|FATAL:/.test(l));
      bad("P-01 主进程没有未捕获异常", first || out.slice(0, 300));
    } else if (!alive) {
      /* 光说 signal=SIGSEGV 没法定位：把进程自己吐的最后几行带出来。 */
      const tail = out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(-8)
        .join(" | ");
      bad(
        "P-01 主进程仍在运行",
        "exitCode=" + child.exitCode + " signal=" + child.signalCode + (tail ? " 输出尾部：" + tail : " 输出为空"),
      );
    } else {
      ok("P-01 主进程活着，启动日志里没有 Uncaught Exception / FATAL");
    }

    /* ---------- P-02 自己扫 routine ---------- */
    const rows = await waitFor(() => {
      const r = readLines(SWEEP_LOG);
      /* 只认真正跑完的轮次：single-flight 撞上的那一轮会如实写
         skipped_in_flight:true（没调内核，也就没有 handoff_retry），
         把它当失败是尺子的错。 */
      const done = r.filter((x) => x && x.mode === "desktop_sweep" && x.tick_ok === true);
      return done.length >= 2 ? done : null;
    }, 15000);
    if (!rows) {
      bad(
        "P-02 userData 下自己跑 routine_tick（desktop-sweep.jsonl 至少 2 轮完成）",
        "rows=" + readLines(SWEEP_LOG).length,
      );
    } else {
      const missingRetry = rows.filter((r) => !r.handoff_retry || r.handoff_retry.ok !== true);
      if (missingRetry.length) {
        bad("P-02 每轮带 handoff_retry 且 ok:true", JSON.stringify(missingRetry[0]).slice(0, 300));
      } else {
        ok("P-02 装机 App 自己扫 routine（" + rows.length + " 轮完成，均带 handoff_retry ok）");
      }
    }
    const tick = (() => {
      try {
        return JSON.parse(fs.readFileSync(TICK, "utf8"));
      } catch (_) {
        return null;
      }
    })();
    if (!tick || tick.daemon !== false || tick.long_lived !== false) {
      bad("P-02 last-tick 由进程内 sweep 写入（daemon=false long_lived=false）", JSON.stringify(tick || null).slice(0, 240));
    } else {
      ok("P-02 last-tick: desktop_sweep 写入，daemon=false long_lived=false");
    }

    /* ---------- P-03 密钥落进 userData，而不是包里 ---------- */
    const bundleEnvAnywhere = [
      path.join(RESOURCES, ".env.local"),
      path.join(RESOURCES, "app.asar.unpacked/.env.local"),
      path.join(UNPACKED, ".env.local"),
    ].find((p) => fs.existsSync(p));
    if (bundleEnvAnywhere) {
      bad("P-03 安装目录里没有 .env.local", bundleEnvAnywhere);
    } else {
      let text = "";
      try {
        text = fs.readFileSync(ENV_LOCAL, "utf8");
      } catch (_) {
        text = "";
      }
      const mode = (() => {
        try {
          return fs.statSync(ENV_LOCAL).mode & 0o777;
        } catch (_) {
          return null;
        }
      })();
      if (!text.includes("BITBOT_LLM_API_KEY=" + INJECTED_KEY)) {
        bad("P-03 注入的密钥落到 userData/.env.local", ENV_LOCAL + " 内容=" + text.slice(0, 160));
      } else if (mode !== 0o600) {
        bad("P-03 .env.local 权限 0600", "mode=" + (mode === null ? "missing" : mode.toString(8)));
      } else {
        ok("P-03 密钥落在 userData/.env.local（0600），安装目录里没有 .env.local");
      }
    }

    /* ---------- P-04 App 没有写自己的安装目录 ---------- */
    if (!asarBefore) {
      bad("P-04 app.asar 在运行前后字节一致", "安装不完整：找不到 " + ASAR);
    } else if (sha256(ASAR) !== asarBefore) {
      bad("P-04 app.asar 在运行前后字节一致", asarBefore.slice(0, 12) + " → " + sha256(ASAR).slice(0, 12));
    } else {
      ok("P-04 app.asar 运行前后字节一致（没往安装目录写）");
    }

    /* ---------- P-06 真实 UI 首次配置：保存 key 不能顺手关掉审核门 ----------
       用户路径：账户胶囊 → 设置 → 凭证 → 填 key → 「保存并热加载」。
       2026-10-29 实测（装机包）：这一步会把 `.env.local` 写成
       BITBOT_CONTENT_MODERATION=0 —— 因为 `secrets.status()` 只对
       `_POST/_MODEL/_BASE_URL/...` 回读 value，漏了 `_MODERATION`，复选框
       永远从「未勾选」开始，而保存又强制提交 0。默认开启的审核门就这样被
       一次「填个 key」静默关掉了。 */
    {
      let pw = null;
      try {
        /* 等 CDP 端点真的应答，而不是「端口进程起来了」；P-01 已经睡了 5s，
           这里再给 20s 兜底。连不上就是门失败，不静默跳过。 */
        const version = await waitForCdp(CDP, 20000);
        if (!version) throw new Error("CDP 未就绪：127.0.0.1:" + CDP);
        pw = await chromium.connectOverCDP("http://127.0.0.1:" + CDP, { timeout: 15000 });
        const page = pw.contexts()[0].pages()[0];
        await page.waitForSelector("#composer #text", { timeout: 30000 });
        await page.click("#account-avatar-btn");
        await page.click("#ap-settings");
        await page.click('.settings-tab-btn[data-stab="credentials"]');
        await page.waitForSelector("#sec-save", { state: "visible", timeout: 10000 });
        const modBefore = await page.isChecked("#sec-moderation");
        await page.fill("#sec-llm-key", "sk-ui-saved-2468");
        await page.click("#sec-save");
        await waitFor(() => {
          try {
            return fs.readFileSync(ENV_LOCAL, "utf8").includes("sk-ui-saved-2468");
          } catch (_) {
            return false;
          }
        }, 15000);
        await sleep(500);
        const modAfter = await page.isChecked("#sec-moderation");
        const statusPath = await page.evaluate(async () => {
          try {
            const st = await window.bitbot.secrets.status();
            return st && st.path ? String(st.path) : "";
          } catch (_) {
            return "";
          }
        });
        const text = (() => {
          try {
            return fs.readFileSync(ENV_LOCAL, "utf8");
          } catch (_) {
            return "";
          }
        })();
        const problems = [];
        if (!/^BITBOT_CONTENT_MODERATION=1$/m.test(text)) {
          problems.push("保存后审核门不是 1（实际 " + (/^BITBOT_CONTENT_MODERATION=(.*)$/m.exec(text) || [, "缺失"])[1] + "）");
        }
        if (!modAfter) problems.push("保存后复选框未勾选（勾选前=" + modBefore + "）");
        if (statusPath !== ENV_LOCAL) problems.push("status.path 不是 userData：" + statusPath);
        if (problems.length) {
          bad("P-06 真实 UI 配置 key 不会静默关掉内容审核门", problems.join("; "));
        } else {
          ok("P-06 账户胶囊→设置→凭证→保存：key 落盘，审核门仍为 1，status.path 指向 userData");
        }
      } catch (err) {
        bad("P-06 真实 UI 首次配置", (err && err.message ? err.message : String(err)).slice(0, 300));
      } finally {
        try {
          if (pw) await pw.close();
        } catch (_) {
          /* ignore */
        }
      }
    }

    /* ---------- P-05 退出后不再 tick ---------- */
    const before = readLines(SWEEP_LOG).length;
    const beforeTick = (() => {
      try {
        return JSON.parse(fs.readFileSync(TICK, "utf8")).at;
      } catch (_) {
        return null;
      }
    })();
    try {
      child.kill("SIGTERM");
    } catch (_) {
      /* already gone */
    }
    const exited = await waitFor(
      () => child.exitCode !== null || child.signalCode !== null,
      15000,
    );
    if (!exited) {
      bad("P-05 SIGTERM 后 15s 内退出", "pid=" + child.pid);
    } else {
      await sleep(SWEEP_MS * 6);
      const after = readLines(SWEEP_LOG).length;
      const afterTick = (() => {
        try {
          return JSON.parse(fs.readFileSync(TICK, "utf8")).at;
        } catch (_) {
          return null;
        }
      })();
      if (after !== before || (afterTick && afterTick !== beforeTick)) {
        bad("P-05 退出后不再产生新 tick", "rows " + before + "→" + after + " tick " + beforeTick + "→" + afterTick);
      } else {
        ok("P-05 退出后不再产生新 tick（rows=" + after + "）");
      }
    }
  } catch (err) {
    bad("门禁执行异常", err && err.stack ? err.stack : String(err));
  } finally {
    try {
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    } catch (_) {
      /* ignore */
    }
    if (process.env.BITBOT_GATE_KEEP === "1") {
      console.log("  · 保留现场 " + WORK);
    } else {
      try {
        fs.rmSync(WORK, { recursive: true, force: true });
      } catch (_) {
        /* ignore */
      }
    }
    done();
  }
})();
