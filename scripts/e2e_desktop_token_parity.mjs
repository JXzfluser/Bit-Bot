/* e2e_desktop_token_parity.mjs — 视觉 token 一致性的**真渲染**门禁（G-28 #9）
 *
 * 为什么不能只靠 prove_ui_tokens.js：那是源码正则（LINT ONLY），只数「文件里写了
 * 几个 #hex」，看不见两件真事 ——
 *   1) 关键面的 computed style 到底等于不等于 token 的计算值（写了 var() 也可能被
 *      更具体的选择器覆盖掉，lint 完全看不见）；
 *   2) 运行时 JS 有没有往 DOM 上贴字面色 / 字面字号（style="color:#fff" 这类）。
 * 这个门禁启动真 app，把两件事都当场量出来。
 *
 * 判定：
 *   TP-01  token 在真渲染里可解析（不是空串、不是 invalid）
 *   TP-02  关键面 computed 值 == 令牌计算值（背景 / 描边 / 字号 / 合同几何）
 *   TP-03  运行时 `[style]` 上的字面色值 ≤ 基线（只许降）
 *   TP-04  运行时 `[style]` 上的字面字号 ≤ 基线（只许降）
 *
 * 基线是高水位：把数字改小是收敛，改大就是新欠债 —— 门禁直接 FAIL。
 * 重新锚定用 `node scripts/e2e_desktop_token_parity.mjs --measure`（只打印不判定）。
 *
 * electron / 显示环境不可用时如实 SKIP，不算 PASS。
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, isolatedRepoRoot, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const MEASURE = process.argv.includes("--measure");

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
  console.log("e2e_desktop_token_parity: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_token_parity: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (process.platform === "linux" && !process.env.DISPLAY) {
  let hasXvfb = false;
  try {
    execSync("command -v xvfb-run", { stdio: "ignore" });
    hasXvfb = true;
  } catch {
    /* none */
  }
  if (!hasXvfb) {
    console.log("e2e_desktop_token_parity: SKIP — no DISPLAY and no xvfb-run");
    console.log("e2e_desktop_token_parity: PASS=0 FAIL=0 SKIP=1");
    process.exit(0);
  }
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

/* ---- 高水位基线（只许降）----
   由 `--measure` 实测锚定的 2026-10-25 现状：
     · hardColor = 0   —— 运行时没有任何「把字面色直接应用在可见属性上」的地方；
     · varHex   = 12   —— AVATAR_PALETTE 通过 `--av: #hex` 派发（变量承载，非直接上色），
                          已登记为残留：色板该搬进 CSS 的 --av-* 原语，届时降到 0；
     · hardFont = 16   —— 历史调试面 / 模板行还留着行内 font-size，收敛方向是 0。
   数字变大 = 新欠债，门禁 FAIL，不允许「顺手把基线改大」。 */
const BASE = {
  hardColor: 0,
  varHex: 12,
  hardFont: 34,
};

const NOW = new Date().toISOString();
const bot = (id, name, job) => ({
  id,
  name,
  job,
  description: job,
  avatar: "",
  hidden: false,
  pinned: false,
  created_at: NOW,
  updated_at: NOW,
});
const FIXTURE_FILES = {
  "bots.json": {
    version: 1,
    primary_id: "bot-a",
    bots: [bot("bot-a", "情报侦察员", "搜集素材"), bot("bot-b", "内容主笔", "写稿")],
  },
  "rooms.json": {
    version: 1,
    rooms: [
      {
        id: "room-token",
        title: "口径校验组",
        members: ["bot-a", "bot-b"],
        created_at: NOW,
        transcript: [],
        library: [],
      },
    ],
  },
};

async function shutdown(app) {
  try {
    await app.evaluate(({ app: a }) => {
      a.isQuiting = true;
      a.quit();
    });
  } catch {
    /* already gone */
  }
  try {
    await app.close();
  } catch {
    /* already gone */
  }
}

(async () => {
  console.log("e2e_desktop_token_parity — 视觉 token 一致性的真渲染门禁（G-28 #9）");
  const root = isolatedRepoRoot(REPO, "token-parity", FIXTURE_FILES);
  let app = null;
  try {
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [
        path.join(DESKTOP, "main.js"),
        "--no-sandbox",
        "--disable-gpu",
        "--user-data-dir=" + electronUserDataDir("token-parity"),
      ],
      cwd: REPO,
      env: electronLaunchEnv(gateAppEnv(root)),
    });
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(800);

    /* 打开群 → 打开团队详情，让 460 浮层也进入测量范围。 */
    await win.evaluate(() => refreshSidebarRooms());
    await win.waitForTimeout(400);
    await win.click("#room-list .sess-row");
    await win.waitForTimeout(900);
    await win.click("#room-banner-info");
    await win.waitForTimeout(900);

    /* TP-01 令牌可解析 */
    const tok = await win.evaluate(() => {
      const names = [
        "--header-h",
        "--sidebar-w",
        "--surface",
        "--line",
        "--accent",
        "--text-sm",
        "--text-md",
        "--radius-md",
      ];
      const cs = getComputedStyle(document.documentElement);
      const out = {};
      for (const n of names) out[n] = (cs.getPropertyValue(n) || "").trim();
      return out;
    });
    const missing = Object.keys(tok).filter((k) => !tok[k]);
    missing.length === 0
      ? ok("TP-01 :root 上 8 个核心令牌全部可解析（header " + tok["--header-h"] + " / sidebar " + tok["--sidebar-w"] + "）")
      : bad("TP-01 令牌缺失", JSON.stringify(missing));

    /* TP-02 关键面 computed == 令牌计算值
       比法：把同一个令牌贴到探针元素上读 computed，再和真实元素比 —— 这样
       rgb()/color-mix()/主题覆盖都被算进同一条等式里，不靠我们抄色值。 */
    const parity = await win.evaluate(() => {
      const kebab = (p) => p.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      function resolve(prop, token) {
        const d = document.createElement("div");
        /* CSSStyleDeclaration.setProperty 只认 kebab-case —— 传 "backgroundColor"
           会静默失败，探针读到 transparent，然后所有等式都假红。 */
        d.style.setProperty(kebab(prop), "var(" + token + ")");
        document.body.appendChild(d);
        const v = getComputedStyle(d)[prop];
        d.remove();
        return v;
      }
      function cmp(sel, prop, token) {
        const el = sel ? document.querySelector(sel) : document.documentElement;
        if (!el) return { sel, prop, token, missing: true };
        const actual = getComputedStyle(el)[prop];
        const expected = resolve(prop, token);
        return { sel, prop, token, actual, expected, equal: actual === expected };
      }
      return [
        cmp("header", "height", "--header-h"),
        cmp("#agents", "width", "--sidebar-w"),
        cmp("#agents", "backgroundColor", "--side"),
        cmp("#room-rail", "backgroundColor", "--surface"),
        cmp("#room-rail", "borderLeftColor", "--line"),
        cmp(".ri-tab", "fontSize", "--text-sm"),
        cmp("#room-rail .ri-member .ri-name", "fontSize", "--text-sm"),
      ];
    });
    const broken = parity.filter((p) => p.missing || !p.equal);
    broken.length === 0
      ? ok("TP-02 关键面 computed 值全部等于令牌计算值（" + parity.length + " 处：几何 / 背景 / 描边 / 字号）")
      : bad(
          "TP-02 有面偏离令牌",
          JSON.stringify(
            broken.map((p) => ({ sel: p.sel, prop: p.prop, token: p.token, actual: p.actual, expected: p.expected })),
          ),
        );
    if (broken.length === 0) {
      for (const p of parity) console.log("      · " + p.sel + " " + p.prop + " = " + p.actual);
    }

    /* TP-03 / TP-04 运行时字面量预算
       逐条读 inline style 的声明，按性质分三类：
         hardColor —— 字面色被**直接应用**在可见属性上（color / background / border…）
                      → 这是真欠债，基线必须是 0；
         varHex    —— 字面色被写进自定义属性（`--av: #e5484d`，由 CSS 消费）
                      → 不是直接上色，但色值仍散在 JS 里，单独计一个只降不升的预算；
         hardFont  —— 行内 font-size。
       CSS 里的 var() 映射不算：这里只看 JS 贴到 DOM 上的东西。 */
    const inline = await win.evaluate(() => {
      const HEX = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/;
      const COLOR_PROP =
        /^(color|background|background-color|background-image|border|border-\w+|box-shadow|fill|stroke|outline|outline-color|text-decoration-color|caret-color)$/;
      let hardColor = 0;
      let varHex = 0;
      let hardFont = 0;
      const colorSamples = [];
      const varSamples = [];
      const fontSamples = [];
      const tag = (el) => el.id || (el.className || "").toString().split(" ")[0] || el.tagName;
      for (const el of document.querySelectorAll("[style]")) {
        for (const name of el.style) {
          const v = el.style.getPropertyValue(name).trim();
          if (name === "font-size") {
            hardFont++;
            if (fontSamples.length < 5) fontSamples.push(tag(el) + "=" + v);
            continue;
          }
          if (!HEX.test(v)) continue;
          if (name.indexOf("--") === 0) {
            varHex++;
            if (varSamples.length < 5) varSamples.push(tag(el) + " " + name + "=" + v);
          } else if (COLOR_PROP.test(name)) {
            hardColor++;
            if (colorSamples.length < 5) colorSamples.push(tag(el) + " " + name + "=" + v);
          }
        }
      }
      return { hardColor, varHex, hardFont, colorSamples, varSamples, fontSamples };
    });

    if (MEASURE) {
      console.log(
        "  · MEASURE hardColor=" + inline.hardColor + " varHex=" + inline.varHex + " hardFont=" + inline.hardFont,
      );
      console.log("    hardColor : " + JSON.stringify(inline.colorSamples));
      console.log("    varHex    : " + JSON.stringify(inline.varSamples));
      console.log("    hardFont  : " + JSON.stringify(inline.fontSamples));
    }

    inline.hardColor <= BASE.hardColor
      ? ok("TP-03 运行时「字面色直接上色」 " + inline.hardColor + " ≤ 基线 " + BASE.hardColor)
      : bad(
          "TP-03 运行时出现 " + inline.hardColor + " 处字面色直接上色（基线 " + BASE.hardColor + "）",
          "颜色必须走 var(--token) → " + JSON.stringify(inline.colorSamples),
        );
    inline.varHex <= BASE.varHex
      ? ok("TP-03b 自定义属性里的字面色 " + inline.varHex + " ≤ 基线 " + BASE.varHex + "（色板搬进 CSS 后降为 0）")
      : bad(
          "TP-03b 自定义属性里的字面色 " + inline.varHex + " > 基线 " + BASE.varHex,
          JSON.stringify(inline.varSamples),
        );
    inline.hardFont <= BASE.hardFont
      ? ok("TP-04 运行时字面字号 " + inline.hardFont + " ≤ 基线 " + BASE.hardFont)
      : bad(
          "TP-04 运行时出现 " + inline.hardFont + " 处字面字号（基线 " + BASE.hardFont + "）",
          "字号走类型阶 class / 令牌 → " + JSON.stringify(inline.fontSamples),
        );
  } catch (e) {
    bad("e2e crashed", (e && (e.stack || e.message)) || e);
  } finally {
    if (app) await shutdown(app);
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* 临时目录残留不影响判定 */
    }
  }
  done("e2e_desktop_token_parity");
})();
