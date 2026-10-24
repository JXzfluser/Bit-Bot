/* prove_w0_no_visual_change.mjs — 证明 W0 收敛「视觉零变化」，而不是声称它
 *
 * 背景：W0 把 ui_chrome.css 里 5 个重复调色块的 115 个硬编码色值抽成
 * `--p-lt-*` / `--p-dk-*` 原语 + 同 selector 的 var() 映射（0a），
 * 再把 body.grok-ui 的第二套 token 家族（--ui- 系列、--text-ink、--g- 系列）折到规范 token（0b）。
 * 0a 必须是**逐字节零变化**，0b 允许极小灰移（#1a1a1a→#141414 这类），但必须被量化。
 *
 * 做法（不动源码，运行时注入生成物 /tmp/w0a.css、/tmp/w0b.css）：
 *   基线 → 注入 0a → 注入 0a+0b，每步采「全部可见元素的 resolved 计算样式指纹」
 *   + 全窗截图字节比对。指纹差异逐条打印，截图不同则保留两张图供肉眼复核。
 *
 * 纪律：独立临时 user-data-dir、BITBOT_NO_SECRET_SYNC=1、不发消息/不改设置、跑完关进程。
 * Usage: node scripts/prove_w0_no_visual_change.mjs
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const W0A = fs.readFileSync("/tmp/w0a.css", "utf8");
const W0B = fs.readFileSync("/tmp/w0b.css", "utf8");
const SHOT_DIR = "/tmp/w0_proof";

const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

const PROPS = ["backgroundColor", "color", "borderTopColor", "boxShadow", "borderRadius", "backgroundImage", "outlineColor"];

// 心跳写文件：后台跑时 stdout 会被管道缓冲，卡在哪一步必须能随时看见。
const LOG_FILE = "/tmp/w0_proof.log";
fs.writeFileSync(LOG_FILE, "");
function log(...args) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${args.join(" ")}`;
  fs.appendFileSync(LOG_FILE, line + "\n");
  process.stdout.write(line + "\n");
}

// 任一步骤最多等这么久，超时即明确失败而不是无限挂起。
function step(label, promise, ms = 25000) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 超时 ${ms}ms`)), ms)),
  ]);
}

async function settle(win) {
  await win.waitForTimeout(240);
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function forceTheme(win, mode) {
  await win.evaluate((m) => {
    const b = document.body;
    b.classList.remove("force-dark", "force-light");
    if (m !== "system") b.classList.add("force-" + m);
  }, mode);
  await settle(win);
}

// 指纹：key 用「tag:nth-of-type 路径」而不是全局序号 —— 活宿主会在两次采样之间插入
// 会话行/日志气泡，序号 key 会让后面的元素集体错位成「元素消失」（上一版就是这么废的）。
async function fingerprint(win) {
  return win.evaluate((props) => {
    const out = {};
    const pathOf = (el) => {
      const seg = [];
      for (let n = el; n && n.nodeType === 1 && n.tagName !== "HTML"; n = n.parentElement) {
        let idx = 1;
        for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) idx++;
        seg.unshift(`${n.tagName}:${idx}${n.id ? "#" + n.id : ""}`);
      }
      return seg.join(">");
    };
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === "none" || cs.visibility === "hidden" || r.width === 0 || r.height === 0) continue;
      out[pathOf(el)] = props.map((p) => cs[p]).join("|");
    }
    return out;
  }, PROPS);
}

// 等 DOM 静置：连续两次采样的元素集合相同才算稳，避免把宿主自己的异步渲染当成样式差异。
async function quiesce(win, maxTries = 14) {
  let prev = null;
  for (let i = 0; i < maxTries; i++) {
    const fp = await fingerprint(win);
    const keys = Object.keys(fp).sort().join("\n");
    if (prev !== null && prev === keys) return fp;
    prev = keys;
    await win.waitForTimeout(220);
  }
  return fingerprint(win);
}

function diffFingerprints(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs = [];
  for (const k of keys) {
    if (a[k] !== b[k]) diffs.push({ key: k, before: a[k] ?? "(元素消失)", after: b[k] ?? "(元素消失)" });
  }
  return diffs;
}

function parseRgb(s) {
  const m = String(s).match(/[\d.]+/g);
  if (!m) return null;
  return m.slice(0, 3).map(Number);
}

(async () => {
  fs.rmSync(SHOT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  if (!fs.existsSync(ELECTRON)) { console.error("electron dist missing"); process.exit(1); }

  const ud = electronUserDataDir("w0-proof");
  const env = electronLaunchEnv(gateAppEnv(REPO, { BITBOT_NO_SECRET_SYNC: "1", BITBOT_DESKTOP_AUTOSTART: "0" }));
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO, env, timeout: 60000,
  });
  let exitCode = 0;
  try {
    const win = await app.firstWindow({ timeout: 60000 });
    await win.setViewportSize({ width: 1040, height: 760 }).catch(() => {});

    const stage = async (name, css) => {
      await step(`inject:${name}`, win.evaluate((text) => {
        document.getElementById("w0-proof-style")?.remove();
        if (text) {
          const s = document.createElement("style");
          s.id = "w0-proof-style";
          s.textContent = text;
          document.head.appendChild(s);
        }
      }, css || ""));
      await settle(win);
      const fp = await step(`fingerprint:${name}`, quiesce(win));
      const buf = await step(`screenshot:${name}`, win.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) }));
      log(`  stage ${name}: ${Object.keys(fp).length} 元素 / ${buf.length} 字节`);
      return { name, fp, buf };
    };

    for (const theme of ["light", "dark"]) {
      await step(`clear-style:${theme}`, win.evaluate((text) => {
        document.getElementById("w0-proof-style")?.remove();
        void text;
      }, ""));
      await forceTheme(win, theme);
      log(`======== 主题 ${theme} ======`);
      const suffix = "";
      // 活宿主计时器（如启动横幅 #banner 自动隐藏）会让单个元素在两次采样之间消失，
      // 产生「单侧 (元素消失)」的伪差异。只重采 (base, 0a) 这一对：若差异在重采后
      // 仍在（含真实消失，比如改样式导致 display:none），照旧判红。
      let base, a, da;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const s = attempt === 1 ? suffix : `${suffix}r${attempt}`;
        base = await stage(`00-base${s}`, "");
        a = await stage(`0a${s}`, W0A);
        da = diffFingerprints(base.fp, a.fp);
        const transient = da.length > 0 && da.every((d) => d.before === "(元素消失)" || d.after === "(元素消失)");
        if (da.length === 0 || !transient) break;
        log(`   0a 差异全部是单侧元素消失（活宿主计时器噪声），第 ${attempt} 次重采样`);
      }
      const b = await stage(`0ab${suffix}`, W0A + "\n" + W0B);
      const db = diffFingerprints(base.fp, b.fp);
      log(`元素指纹条目 ${Object.keys(base.fp).length} 条`);
      log(`0a（纯去重）差异：${da.length} 条 ${da.length === 0 ? "✓ 逐元素零变化" : "✗ 见下"}`);
      da.slice(0, 12).forEach((d) => log("   ", d.key, "\n      before", d.before, "\n      after ", d.after));

      log(`0b（折第二套家族）差异：${db.length} 条`);
      const deltas = [];
      for (const d of db) {
        const bi = d.before.split("|"), ai = d.after.split("|");
        for (let p = 0; p < PROPS.length; p++) {
          if (bi[p] !== ai[p]) {
            const B = parseRgb(bi[p]), A = parseRgb(ai[p]);
            const cd = B && A ? Math.max(...B.map((v, k) => Math.abs(v - A[k]))) : null;
            if (cd !== null) deltas.push(cd);
          }
        }
      }
      db.slice(0, 6).forEach((d) => log("   ", d.key, "\n      before", d.before, "\n      after ", d.after));
      if (deltas.length) log(`   色差通道最大偏移 ${Math.max(...deltas)} / 255，涉及 ${deltas.length} 个属性值`);

            const sameA = base.buf.equals(a.buf), sameB = base.buf.equals(b.buf);
      // 活宿主有光标闪烁、计时器与异步会话行，截图字节不同 ≠ 样式变化；判决只看 resolved 计算样式。
      log(`截图字节比对（仅供肉眼复核，不作判决）：0a ${sameA ? "一致" : "有差异"} | 0b ${sameB ? "一致" : "有差异"}`);
      if (da.length) { exitCode = 1; log("   ✗ 0a 的 resolved 计算样式出现差异 → 原语映射不等价，不能落地"); }
    }
    log(`\n图与结论目录：${SHOT_DIR}`);
  } finally {
    await app.close().catch(() => {});
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
  }
  process.exit(exitCode);
})();
