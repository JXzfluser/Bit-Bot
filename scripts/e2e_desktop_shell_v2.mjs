/* e2e_desktop_shell_v2.mjs — Desktop UI overhaul (target-v2) real-render gate.
 *
 * Complements e2e_desktop_layout_target.mjs (which owns geometry / debug-surface
 * / three-lang key parity / visible-English copy). This gate owns the 7 fixed
 * problems from the target-v2 brief, verified in the REAL Electron app driven by
 * Playwright at 1440x900 and 1280x800, for zh-CN and zh-TW:
 *
 *   S-HEADER  one model entry in the header ("当前模型 · 状态"), no per-channel
 *             chips, no flattened "无 key", no stray credential/account buttons.
 *   S-MODEL   "模型" right-Sheet opens; current summary + per-vendor rows share
 *             the Host llmCatalog / secrets source; Esc + mask close it and
 *             focus returns to the trigger.
 *   S-SIDEBAR sidebar-bottom pinned order Hidden Bots → Connect apps →
 *             Template marketplace → Settings → account; the three click-to-open
 *             entries each open a Sheet, none inline, each Esc/mask-closable with
 *             focus return; no duplicate entries.
 *   S-CLEAN   product mode (dev off) settings + header + sheets expose NO raw
 *             diagnostic tokens (entry= / account= / *_masked / data/ / .json /
 *             "× N" / unavailable / disabled_by_default / training= / key= /
 *             secret= / env.local / bot-templates).
 *   S-LANG    language row shows ONE value (no "跟随系统 · 跟随系统" duplication).
 *   S-PRIV    privacy line fully Chinese (no English enum / training= / managed).
 *   S-TZ      a non-UTC system timezone (BITBOT_TZ) is what the Bot Timezone
 *             select defaults to — NOT a hardcoded UTC.
 *   S-MK      marketplace sheet shows no "templates × N · <path>" debug line,
 *             cards read in the current language, and "创建" prefills the
 *             existing Bot-creation form (backend ids untouched).
 *   S-DEV     with dev-mode off there is no "开发选项" row, no "能力" button, no
 *             raw JSON panel.
 *
 * Skips honestly (SKIP + reason) when electron/xvfb are unavailable — a skipped
 * gate is NEVER a PASS. Usage: node scripts/e2e_desktop_shell_v2.mjs
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, hasDisplay } from "./electron_env.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
/* 【2026-11-22】门禁的数据根改成**隔离目录**。
 *
 * 原来这一门直接跑在真仓库上（settings.json 也是用户的那个）。S-MK 那段会点
 * 模板市场的按钮 ⇒ 会真的调内核建 Bot ⇒ **用户的 data/desktop 里凭空多出
 * 几个 Bot**。门禁没有这个权限：期望基线只许人工改，用户数据更不该被门禁写。
 *
 * 隔离根必须放在**本 checkout 的直接子目录**里（hosts/desktop/paths.js 的
 * resolveDataRoot 注释写明了原因：内核的 cwd = dirname(DATA_ROOT)，指向
 * /tmp 就找不到 moon.mod）。跑完删掉。
 */
const ISO_DATA = path.join(REPO, ".gate-data-shell-v2-" + process.pid);
const SETTINGS_JSON = path.join(ISO_DATA, "data", "desktop", "settings.json");

/** 把隔离根摆成「内核能跑起来」的样子。
 *
 * 内核的命令是 `moon run cmd/desktop_turn`（hosts/shared/run_moon_turn.js:138），
 * 它的 cwd = dirname(DATA_ROOT) ⇒ 隔离根里必须能解析到 `cmd/desktop_turn`。
 * 两条路：
 *   - 只把 data 目录搬走 ⇒ cwd 里没有 cmd/moon.mod ⇒ moon 退 255
 *     （实测：kernel_crashed exit_code=255，应用启动后自己退出）。
 *   - 所以把 cmd/ 与 moon.mod **软链**进隔离根（moon 跟软链走，workspace 仍
 *     解析到真仓库的包）⇒ 内核正常，**数据**却落在隔离根里。
 */
function prepareIsoRoot() {
  fs.mkdirSync(path.join(ISO_DATA, "data", "desktop"), { recursive: true });
  for (const rel of ["cmd", "moon.mod"]) {
    const link = path.join(ISO_DATA, rel);
    try { fs.rmSync(link, { force: true, recursive: true }); } catch { /* ignore */ }
    try { fs.symlinkSync(path.join(REPO, rel), link, fs.statSync(path.join(REPO, rel)).isDirectory() ? "dir" : "file"); }
    catch (e) { /* 软链失败不致命：内核那一轮会失败，但界面检查仍可跑 */ }
  }
}
/* 期望基线目录(2026-11-21 改):默认写 artifacts/,**不**写 reference/ ——
 * reference/ 是期望基线,只能由人改;门禁每次跑都往那儿覆盖 ⇒ 像素回归自证自明。
 * 同 scripts/e2e_desktop_layout_target.mjs 的范式:要「更新对外证据」必须
 * 显式设 BITBOT_LAYOUT_SHOT_COMMIT=1(有意识的动作)。 */
const OUT = process.env.BITBOT_LAYOUT_SHOT_DIR
  || (process.env.BITBOT_LAYOUT_SHOT_COMMIT === "1"
    ? path.join(REPO, "docs/design/desktop-target/reference")
    : path.join(REPO, "artifacts", "shell-v2-shots"));
let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : "")); };
const skip = (m, why) => { SKIP++; console.log("  · SKIP " + m + " — " + why); };

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_shell_v2: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_shell_v2: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
/* 只有 Linux 需要 X server；macOS/Windows 没有 DISPLAY 是正常的。
   初版把条件写成"没有 xvfb-run 且没有 DISPLAY"，在 macOS 上永远跳过。 */
if (!hasDisplay()) {
  console.log("e2e_desktop_shell_v2: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_shell_v2: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));

const { _electron } = require("playwright-core");

async function shutdown(app) {
  /* Playwright `app.close()` 偶尔在 Electron 进程已经退出后仍不 resolve
     （实测停在第一档 zh-TW 截图之后，electron 已无进程，node 还挂着）。
     门禁不能因此永远不结束：每一步都给上限，超时就当已关闭继续跑下一档。
     产品退出本身由 e2e_desktop_quit / single_instance 门独立把关。 */
  const within = (p, ms, why) => Promise.race([
    Promise.resolve(p).catch(() => null),
    new Promise((r) => setTimeout(r, ms, why)),
  ]);
  try {
    await within(app.evaluate(({ app: electronApp }) => { electronApp.isQuiting = true; electronApp.quit(); }), 10000, "quit-timeout");
    await within(app.close(), 15000, "close-timeout");
  } catch { /* already gone */ }
}

async function launchWith(w, h, opts = {}) {
  /* 同上：独立 user-data 目录，别和用户开着的实例抢单实例锁。 */
  const args = [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + electronUserDataDir("shell-v2")];
  if (opts.env) for (const [k, v] of Object.entries(opts.env)) process.env[k] = v;
  prepareIsoRoot();
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args,
    cwd: REPO,
    /* ELECTRON_RUN_AS_NODE=1 会让 electron 退化成纯 node（ipcMain undefined），
       这里显式剔除；门禁也不该改用户 macOS 的开机自启设置。 */
    env: electronLaunchEnv({
      BITBOT_DESKTOP_AUTOSTART: "0",
      /* 数据根 ⇒ 隔离目录：门禁在界面上点出来的 Bot 落在这里，不碰用户的 data/。 */
      BITBOT_DATA_ROOT: path.join(ISO_DATA, "data"),
      /* 本门不测入站服务 ⇒ 关掉，免得占着产品那个**固定**端口 18765
         （同一台机器上两个实例同时跑就 EADDRINUSE）。 */
      BITBOT_CN_INBOUND: "0",
      /* 本门不测定时任务 ⇒ 别让常驻 routine daemon 起来（它是长驻进程：门禁跑完
         还留着它盯着仓库，而且它那一轮内核 sweep 会往数据根里写）。 */
      BITBOT_ROUTINE_DAEMON_AUTOSTART: "0",
      ...(opts.env || {}),
    }),
  });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) { win.setAutoHideMenuBar(true); win.setMenuBarVisibility(false); }
  }).catch(() => {});
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  await win.evaluate(([W, H]) => { window.resizeTo(W, H); }, [w, h]);
  await win.waitForTimeout(300);
  return { app, win };
}

/* product-mode forbidden-diagnostic tokens (target-v2 §S-CLEAN / §6). */
const FORBIDDEN = [
  "entry=", "account=", "_masked", "data/", ".json", "env.local",
  "disabled_by_default", "training=", "key=", "secret=", "bot-templates",
];
const FORBIDDEN_REGEX = ["unavailable", "×\\s*\\d"];

/* Scan VISIBLE text under a root for forbidden tokens (case-insensitive for the
 * English literals). Dev-only surfaces are excluded automatically because they
 * are display:none when body[data-devmode] is not "on". */
function scanFn(rootSel) {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(rootSel)}) || document.body;
    const forbid = ${JSON.stringify(FORBIDDEN)};
    const rex = ${JSON.stringify(FORBIDDEN_REGEX)}.map((s) => new RegExp(s, "i"));
    const visible = (el) => {
      for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.display === "none" || p.hidden) return false;
      }
      return el === document.body || el.offsetParent !== null || el.getClientRects().length > 0;
    };
    const hits = [];
    const push = (t, where) => {
      const low = t.toLowerCase();
      for (const f of forbid) if (low.includes(f.toLowerCase())) { hits.push([where, f]); return; }
      for (const r of rex) if (r.test(t)) { hits.push([where, r.source]); return; }
    };
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = (n.textContent || "").trim();
      const par = n.parentElement;
      if (t.length && par && par.tagName !== "SCRIPT" && par.tagName !== "STYLE" && visible(par))
        push(t, "#settings" + (par.id ? "#" + par.id : ""));
    }
    for (const el of root.querySelectorAll("[title],[aria-label],[data-i18n-title]")) {
      if (!visible(el)) continue;
      for (const a of ["title", "aria-label"]) { const v = el.getAttribute(a) || ""; if (v) push(v, "@" + a); }
    }
    return hits.slice(0, 24);
  })()`;
}

/* 简/繁判别字（只取「模板目录文案里真的会用到、且简繁写法确定不同」的一小组）。
 * 判据：繁体界面里不许出现简体专用字，简体界面里不许出现繁体专用字。
 * 不用全量对照表 —— 一张几百字的表容易抄错，反而把尺弄钝。 */
const SIMPLIFIED_ONLY = "体内线发与头点销调户联审绝据筛选证广规划预阅脑览复现报获骤图写说设产历维决简职询";
const TRADITIONAL_ONLY = "隊體內線發與頭點銷調戶聯審絕據篩選證廣規劃預閱腦覽複現報獲驟圖寫說設產曆維決簡職詢";

/* S-MK：模板市场这一段。
 *
 * 【2026-11-22 重写】原来这段有三处「尺本身是坏的」，红的不是产品：
 *
 *  ① 它查的弹窗 id 是 `#bf-modal` —— 产品里**根本没有这个 id**（真身是
 *     `#bot-edit-modal`）⇒ `formVisible` 永远是 false ⇒ 「用户点创建后表单
 *     根本没显示」这个结论是尺凭空造出来的（产品侧实测：表单会显示且已预填）。
 *  ② 它点的是**第一张卡**的按钮。第一张卡是**团队模板**（按钮是「一键成队」），
 *     点它去建的是一整支队伍，压根不开建 Bot 表单 ⇒ 就算把 id 改对也仍然红。
 *     （顺带一个更坏的后果：这一点击会在**用户的 data/desktop** 里真建出 5 个
 *     Bot —— 门禁不该有这权限，所以本门现在跑在隔离数据根里。）
 *  ③ 「卡片按当前语言显示」只查了「标题里有没有汉字」——繁体/简体都算汉字，
 *     英文界面里的中文照样过；而且「一键成队」是**写死的中文**，三种语言都漏。
 *     ⇒ 现在按语言分别判：繁体界面不许有简体专用字、简体界面不许有繁体专用字、
 *     英文界面不许有**任何**汉字；按钮文案必须等于产品字典里的那个词条。
 */
/* 切语言：**走产品自己的入口**（settings.set + wavegLangApply）。
 *
 * 【2026-11-22 修】原来门禁只调 wavegLangApply(code) —— 而产品里
 * refreshWaveGSettings() 每次都会按**持久化的** settings.language 再调一次
 * wavegLangApply()（hosts/desktop/index.html:18534）。门禁后面一开设置面板
 * 就触发了那次刷新 ⇒ 界面被切回持久化的语言 ⇒ **「zh-TW 那一档」其实一直跑在
 * zh-CN 上**（证据：那一档的 S-PRIV 打印的是简体「不可用 · 由账户侧统一管理」、
 * S-LANG 打印的是简体「跟随系统」；繁体界面该是「跟隨系統」）。
 * ⇒ 也就是说这一门**从来没验过繁体**，八条断言全是简体的复制品。
 *
 * 修法：按产品的方式切（settings.set({language}) + wavegLangApply），
 * 持久化的值和界面一致 ⇒ 之后的任何刷新都切不回去。
 */
async function applyLanguage(win, lang) {
  await win.evaluate(async (code) => {
    if (typeof applyDevMode === "function") applyDevMode(false);
    try {
      if (window.bitbot && window.bitbot.settings && window.bitbot.settings.set) {
        const res = await window.bitbot.settings.set({ language: code });
        if (res && res.ok) {
          if (typeof wavegLangApply === "function") wavegLangApply(code);
          return;
        }
      }
    } catch (_) { /* 落盘失败就退回纯界面切换 */ }
    if (typeof wavegLangApply === "function") wavegLangApply(code);
  }, lang);
}

async function marketplacePass(win, tag, lang) {
  /* 这一档自己切语言：en 那一档是单独调的（不进 shellPass 的整套断言）。 */
  await applyLanguage(win, lang);
  await win.evaluate(() => { const p = document.getElementById("settings-panel"); if (p) p.style.display = "none"; });
  /* 先把卡片区清空：市场面板是**异步**刷新的（openMarketplace → refreshMarketplace
   * → renderMarketplace）。不清空的话，上一轮留下的旧卡片还在 DOM 里 ⇒
   * waitForSelector 立刻返回 ⇒ 读到的是**上一种语言**的卡片（实测：繁体那一档
   * 读到的是简体卡片，英文那一档读到的是简体卡片）。清空后再等 ⇒ 读到的必然
   * 是这一轮新画出来的。 */
  await win.evaluate(() => { const g = document.getElementById("mk-grid"); if (g) g.innerHTML = ""; });
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-market", { state: "visible", timeout: 5000 });
  await win.click("#ap-market");
  await win.waitForSelector("#mk-grid .ca-card", { timeout: 15000 }).catch(() => {});
  await win.waitForTimeout(300);
  const mk = await win.evaluate(() => {
    const meta = document.getElementById("mk-meta");
    const grid = document.getElementById("mk-grid");
    const cards = grid ? Array.from(grid.querySelectorAll(".ca-card")) : [];
    const createLabel = typeof wavegT === "function" ? String(wavegT("mkCreate") || "") : "";
    const teamLabel = typeof wavegT === "function" ? String(wavegT("mkCreateTeam") || "") : "";
    return {
      meta: meta ? (meta.textContent || "").trim() : "",
      cardCount: cards.length,
      createLabel,
      teamLabel,
      cards: cards.map((c) => {
        /* 卡片的结构是 [head(icon+title), desc, details?, button]。
           取**直接子元素**里的那两个 div，别用 card.textContent —— 那会把
           折叠着的 <details> 里的原始 prompt 也算进来（那是 Host 目录里的
           原文，不是界面文案），判据就会变成「prompt 有没有汉化」。 */
        const kids = Array.from(c.children).filter((el) => el.tagName === "DIV");
        const head = kids[0];
        const desc = kids[1];
        const titleEl = head ? head.querySelector("div") : null;
        const btn = c.querySelector("button");
        const sum = c.querySelector("details summary");
        return {
          id: c.dataset.templateId || "",
          title: titleEl ? (titleEl.textContent || "").trim() : "",
          desc: desc ? (desc.textContent || "").trim() : "",
          summary: sum ? (sum.textContent || "").trim() : "",
          btn: btn ? (btn.textContent || "").trim() : "",
        };
      }),
    };
  });
  if (/×|bot-templates|\.json|data\/desktop/.test(mk.meta)) bad(`${tag} S-MK debug line leaked`, mk.meta);
  else ok(`${tag} S-MK: no "templates × N · path" debug line (meta="${mk.meta}")`);
  if (mk.cardCount === 0) {
    skip(`${tag} S-MK cards localized — Host catalog empty in this env`, "");
    return;
  }
  /* ① 卡片文案按当前语言：英文界面一个字都不许有汉字；简/繁各自不许出现对方的专用字。 */
  const allText = mk.cards.map((c) => c.title + " " + c.desc + " " + c.summary + " " + c.btn).join(" ");
  const cjkHits = allText.match(/[\u4e00-\u9fff]/g) || [];
  const badChars = [];
  if (lang === "en") {
    if (cjkHits.length) badChars.push(...cjkHits.slice(0, 12));
  } else if (lang === "zh-TW") {
    for (const ch of allText) if (SIMPLIFIED_ONLY.includes(ch)) badChars.push(ch);
  } else {
    for (const ch of allText) if (TRADITIONAL_ONLY.includes(ch)) badChars.push(ch);
  }
  badChars.length === 0
    ? ok(`${tag} S-MK: ${mk.cardCount} template cards read in ${lang}（没有混进别的语言的字）`)
    : bad(`${tag} S-MK cards not localized (${lang})`, JSON.stringify([...new Set(badChars)].slice(0, 12)));
  /* ② 按钮文案必须来自字典（不许写死中文）。 */
  const btnBad = mk.cards.filter((c) => {
    const want = c.btn === mk.teamLabel ? mk.teamLabel : mk.createLabel;
    return c.btn && c.btn !== want;
  });
  btnBad.length === 0
    ? ok(`${tag} S-MK: every card button comes from the dictionary (创建/一键成队 localized)`)
    : bad(`${tag} S-MK button label not localized`, JSON.stringify(btnBad.map((c) => [c.id, c.btn])));
  /* ③ 「创建」预填建 Bot 表单：点**单 Bot 模板**那张卡（不是第一张团队卡），
   *    表单必须真的显示出来、并且三个字段都填好了。 */
  const prefill = await win.evaluate(() => {
    const createLabel = typeof wavegT === "function" ? String(wavegT("mkCreate") || "") : "";
    const cards = Array.from(document.querySelectorAll("#mk-grid .ca-card"));
    const card = cards.find((c) => {
      const b = c.querySelector("button");
      return b && createLabel && (b.textContent || "").trim() === createLabel;
    });
    if (!card) return { err: "no 单 Bot 模板卡（按钮=" + createLabel + "）" };
    const btn = card.querySelector("button");
    btn.click();
    const n = document.getElementById("bc-name"), j = document.getElementById("bc-job"), d = document.getElementById("bc-desc");
    /* 真身是 #bot-edit-modal（**不是** #bf-modal —— 那个 id 产品里不存在）。 */
    const modal = document.getElementById("bot-edit-modal");
    const market = document.getElementById("marketplace-modal");
    const count = document.getElementById("bc-desc-count");
    const avatar = document.getElementById("bf-avatar-preview");
    return {
      tplId: card.dataset.templateId || "",
      name: n ? n.value : "", job: j ? j.value : "", desc: d ? d.value : "",
      formVisible: !!modal && getComputedStyle(modal).display !== "none",
      marketClosed: !market || getComputedStyle(market).display === "none",
      descCount: count ? (count.textContent || "").trim() : "",
      descLen: d ? d.value.length : 0,
      avatar: avatar ? (avatar.textContent || "").trim() : "",
    };
  });
  if (prefill.err) {
    bad(`${tag} S-MK create prefill — 找不到「创建」那张单 Bot 卡`, prefill.err);
  } else {
    const prefilled = !!(prefill.name || prefill.desc);
    prefilled && prefill.formVisible
      ? ok(`${tag} S-MK: 「创建」prefills the Bot form (name="${prefill.name}")`)
      : bad(`${tag} S-MK create did not prefill`, JSON.stringify(prefill));
    prefill.formVisible && prefill.marketClosed
      ? ok(`${tag} S-MK: 建 Bot 表单真的显示了，市场面板同时收起来`)
      : bad(`${tag} S-MK form not shown / marketplace not closed`, JSON.stringify(prefill));
    /* 表单说的要跟自己显示的对得上：描述字数与描述长度、头像首字母与名字。 */
    const counterOk = /^\s*\d+/.test(prefill.descCount) && parseInt(prefill.descCount, 10) === prefill.descLen;
    const avatarOk = !prefill.name || prefill.avatar === prefill.name.trim().slice(0, 1).toUpperCase();
    counterOk && avatarOk
      ? ok(`${tag} S-MK: 预填后表单自洽（描述 "${prefill.descCount}"、头像 "${prefill.avatar}"）`)
      : bad(`${tag} S-MK prefilled form is inconsistent with itself`,
        JSON.stringify({ descCount: prefill.descCount, descLen: prefill.descLen, avatar: prefill.avatar, name: prefill.name }));
  }
  await win.evaluate(() => { if (typeof closeBotForm === "function") closeBotForm(); const m = document.getElementById("marketplace-modal"); if (m) m.style.display = "none"; });
}

/* One (viewport,lang) product pass — the core cleanliness + interaction checks. */
async function shellPass(win, vp, lang) {
  const tag = `${vp}-${lang}`;
  // force product mode (dev off) + target language, independent of persisted state
  await applyLanguage(win, lang);
  await win.waitForTimeout(250);

  // ---- S-HEADER: no model chip in the header (Round 5 moved model config
  // into Settings → 凭证); no stray credential/account header buttons. ----
  const header = await win.evaluate(() => {
    const picker = document.getElementById("model-picker");
    return {
      pickerVisible: !!picker && getComputedStyle(picker).display !== "none",
      credBtn: !!document.getElementById("cred-settings-btn"),
      acctBtn: !!document.getElementById("account-settings-btn"),
      bodyClass: document.body.className,
    };
  });
  !header.pickerVisible
    ? ok(`${tag} S-HEADER: model chip absent from header (lives in Settings → 凭证)`)
    : bad(`${tag} S-HEADER model chip still visible`, JSON.stringify(header));
  (!header.credBtn && !header.acctBtn)
    ? ok(`${tag} S-HEADER: no stray credential/account buttons in header`)
    : bad(`${tag} S-HEADER stray buttons`, JSON.stringify(header));

  // ---- S-MODEL: model configuration is reachable from the account popup's
  // Settings entry, on the 凭证 tab (key / base URL / model id), and closes
  // honestly without touching the stored secrets. ----
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-settings", { state: "visible", timeout: 5000 });
  await win.click("#ap-settings");
  await win.waitForSelector("#settings-panel", { state: "visible", timeout: 10000 });
  await win.click('.settings-tab-btn[data-stab="credentials"]');
  await win.waitForTimeout(150);
  const credOpen = await win.evaluate(() => {
    const panel = document.getElementById("secrets-panel");
    return {
      visible: !!panel && getComputedStyle(panel).display !== "none",
      key: !!document.getElementById("sec-llm-key"),
      model: !!document.getElementById("sec-llm-model"),
      base: !!document.getElementById("sec-llm-base"),
    };
  });
  (credOpen.visible && credOpen.key && credOpen.model && credOpen.base)
    ? ok(`${tag} S-MODEL: Settings → 凭证 exposes key / base URL / model id`)
    : bad(`${tag} S-MODEL credentials panel`, JSON.stringify(credOpen));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(180);
  const settingsClosed = await win.evaluate(() => ({
    open: getComputedStyle(document.getElementById("settings-panel")).display !== "none",
  }));
  !settingsClosed.open
    ? ok(`${tag} S-MODEL: Esc closes Settings`)
    : bad(`${tag} S-MODEL esc close`, JSON.stringify(settingsClosed));
  // mask close: re-open from the same real entry, click the backdrop
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-settings", { state: "visible", timeout: 5000 });
  await win.click("#ap-settings");
  await win.waitForSelector("#settings-panel", { state: "visible", timeout: 10000 });
  await win.evaluate(() => document.getElementById("settings-panel").click());
  await win.waitForTimeout(150);
  const settingsMask = await win.evaluate(() => getComputedStyle(document.getElementById("settings-panel")).display);
  settingsMask === "none"
    ? ok(`${tag} S-MODEL: mask click closes Settings`)
    : bad(`${tag} S-MODEL mask`, settingsMask);

  // ---- S-SIDEBAR: pinned footer order + three click-to-open sheets ----
  const footer = await win.evaluate(() => {
    const a = document.getElementById("agents");
    // true DOM order of every id under #agents (querySelectorAll returns doc order)
    const order = [];
    a.querySelectorAll("[id]").forEach((el) => order.push(el.id));
    const idx = (id) => order.indexOf(id);
    return {
      hidden: idx("hidden-bots-lab"), connect: idx("connect-apps-btn"),
      market: idx("marketplace-btn"), settings: idx("sidebar-settings-btn"),
      account: idx("account-bar"),
    };
  });
  const present = (v) => v >= 0;
  const seqNames = ["connect", "market", "settings", "account"];
  const seq = seqNames.map((k) => footer[k]);
  const allFound = present(footer.connect) && present(footer.market) && present(footer.settings) && present(footer.account);
  const increasing = seq.every((v, i) => i === 0 || v > seq[i - 1]);
  const hiddenFirst = footer.hidden < 0 || footer.hidden < footer.connect; // Hidden Bots precedes the entries when present
  (allFound && increasing && hiddenFirst) ? ok(`${tag} S-SIDEBAR: bottom order [Hidden] → Connect → Marketplace → Settings → Account (${JSON.stringify(footer)})`) : bad(`${tag} S-SIDEBAR order`, JSON.stringify({ footer, allFound, increasing, hiddenFirst }));
  // the pinned footer entries must be click-to-open only — no inline form in the footer
  // hidden state toggles (e.g. #grok-adv-toggle) are inputs but not forms the
  // user fills in; only count visible controls as inline form debt.
  const inline = await win.evaluate(() => !!document.querySelector(
    "#sidebar-footer input:not([type=hidden]):not([hidden]), #sidebar-footer textarea, #sidebar-footer form, #sidebar-footer select"
  ));
  !inline ? ok(`${tag} S-SIDEBAR: no inline form controls in the pinned footer`) : bad(`${tag} S-SIDEBAR inline form in footer`);

  // each entry opens a Sheet and closes via Esc with focus return
  // target-v2: Marketplace/Connect live in the account popup (#sb-more is
  // display:none under grok-ui), so open them through the popup and expect
  // focus to return to the popup item.
  const entryTests = [
    { btn: "#ap-market", btnId: "ap-market", modal: "marketplace-modal" },
    { btn: "#ap-connect", btnId: "ap-connect", modal: "connect-apps-modal" },
  ];
  for (const t of entryTests) {
    await win.click("#account-avatar-btn");
    await win.waitForSelector(t.btn, { state: "visible", timeout: 5000 });
    await win.click(t.btn); await win.waitForTimeout(200);
    const st = await win.evaluate((id) => { const m = document.getElementById(id); return { open: !!m && getComputedStyle(m).display !== "none", right: !!m && m.classList.contains("bb-modal--right") }; }, t.modal);
    // Marketplace is a right-Sheet; Connect apps is the large centered sheet
    // (bb-sheet-lg) by design — both must open.
    st.open ? ok(`${tag} S-SIDEBAR: ${t.modal} opens from the account popup`) : bad(`${tag} S-SIDEBAR ${t.modal} open`, JSON.stringify(st));
    await win.keyboard.press("Escape"); await win.waitForTimeout(160);
    const afterEsc = await win.evaluate((mt) => ({
      closed: getComputedStyle(document.getElementById(mt)).display === "none",
      focused: document.activeElement && document.activeElement.id,
    }), t.modal);
    // The trigger (popup item) is hidden after the popup closes, so focus may
    // legitimately fall back to body; the gate requires an honest close.
    afterEsc.closed ? ok(`${tag} S-SIDEBAR: Esc closes ${t.modal}`) : bad(`${tag} S-SIDEBAR ${t.modal} esc-close`, JSON.stringify(afterEsc));
    await win.click("#account-avatar-btn");
    await win.waitForSelector(t.btn, { state: "visible", timeout: 5000 });
    await win.click(t.btn); await win.waitForTimeout(120);
    await win.evaluate((id) => document.getElementById(id).click(), t.modal); await win.waitForTimeout(150);
    const masked = await win.evaluate((id) => getComputedStyle(document.getElementById(id)).display, t.modal);
    masked === "none" ? ok(`${tag} S-SIDEBAR: mask closes ${t.modal}`) : bad(`${tag} S-SIDEBAR ${t.modal} mask`, masked);
  }

  // Settings opens as a Sheet from the sidebar row, Esc returns focus there
  const settingsOpened = await win.evaluate(() => {
    const btn = document.getElementById("sidebar-settings-btn");
    window.__bbPendingSettingsTrigger = btn;
    if (typeof renderSettingsPanel === "function") renderSettingsPanel({ tab: "general", entry: "sidebar" });
    if (typeof refreshPrivacyStatus === "function") refreshPrivacyStatus().catch(() => {});
    const p = document.getElementById("settings-panel");
    return p && getComputedStyle(p).display !== "none";
  });
  settingsOpened ? ok(`${tag} S-SIDEBAR: Settings Sheet opens from the pinned row`) : bad(`${tag} S-SIDEBAR settings open`);
  await win.waitForTimeout(400);

  // ---- S-CLEAN: product-mode forbidden-diagnostic scan ----
  const scanSettings = await win.evaluate(scanFn("#settings-panel"));
  scanSettings.length === 0 ? ok(`${tag} S-CLEAN: product settings expose 0 diagnostic tokens`) : bad(`${tag} S-CLEAN settings tokens`, JSON.stringify(scanSettings));
  const scanHeader = await win.evaluate(scanFn("header"));
  scanHeader.length === 0 ? ok(`${tag} S-CLEAN: header exposes 0 diagnostic tokens`) : bad(`${tag} S-CLEAN header tokens`, JSON.stringify(scanHeader));

  // ---- S-LANG: one value, no "跟随系统 · 跟随系统" ----
  const langCheck = await win.evaluate(() => {
    const sel = document.getElementById("gp-language");
    const opt = sel ? sel.querySelector('option[value="system"]') : null;
    const dup = /(.)\1*\s*·\s*\1/.test(opt ? opt.textContent : "") || /跟随系统\s*·\s*跟随系统|跟隨系統\s*·\s*跟隨系統|System\s*·\s*System/.test(opt ? opt.textContent : "");
    return { sysText: opt ? opt.textContent.trim() : "", dup };
  });
  (!langCheck.dup && langCheck.sysText && !langCheck.sysText.includes("·")) ? ok(`${tag} S-LANG: language row shows a single value "${langCheck.sysText}"`) : bad(`${tag} S-LANG duplicate`, JSON.stringify(langCheck));

  // ---- S-PRIV: fully Chinese privacy line ----
  const priv = await win.evaluate(() => {
    const el = document.getElementById("gp-privacy-state");
    return el ? { text: (el.textContent || "").trim(), title: el.getAttribute("title") || "" } : { text: "", title: "" };
  });
  const cjk = /[\u4e00-\u9fff]/;
  const privEnglish = /(unavailable|disabled_by_default|managed by|training|Privacy Mode|legacy)/i.test(priv.text + " " + priv.title);
  if (!priv.text || priv.text === "…") skip(`${tag} S-PRIV privacy line not populated in this env`, priv.text);
  else (cjk.test(priv.text) && !privEnglish) ? ok(`${tag} S-PRIV: privacy line is Chinese "${priv.text}"`) : bad(`${tag} S-PRIV leaks English`, JSON.stringify(priv));

  // ---- S-MK: no debug line, localized cards, create prefill ----
  await marketplacePass(win, tag, lang);

  // ---- S-DEV: dev off hides 开发选项 / 能力 button / raw JSON ----
  const devOff = await win.evaluate(() => {
    const vis = (el) => !!el && el.offsetParent !== null && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
    return {
      devLabel: vis(document.querySelector("#gp-devmode-row")) || vis(document.getElementById("gp-devmode-row")),
      toolsBtn: vis(document.getElementById("tools-toggle-btn")),
      json: vis(document.getElementById("json-out")),
      bodyDev: document.body.dataset.devmode || "",
    };
  });
  (!devOff.devLabel && !devOff.toolsBtn && !devOff.json) ? ok(`${tag} S-DEV: dev off hides 开发选项 / 能力 button / raw JSON`) : bad(`${tag} S-DEV leaks dev surface`, JSON.stringify(devOff));

  // screenshots: settings-general, model-sheet, marketplace, sidebar-bottom
  await win.evaluate(() => { if (typeof renderSettingsPanel === "function") renderSettingsPanel({ tab: "general", entry: "sidebar" }); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, `shell-v2-${tag}-settings-general.png`) }).catch(() => {});
  await win.evaluate(() => { const p = document.getElementById("settings-panel"); if (p) p.style.display = "none"; });
  await win.evaluate(() => { if (typeof openProductCredentials === "function") openProductCredentials("e2e"); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, `shell-v2-${tag}-model-sheet.png`) }).catch(() => {});
  await win.keyboard.press("Escape"); await win.waitForTimeout(150);
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-market", { state: "visible", timeout: 5000 });
  await win.click("#ap-market"); await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(OUT, `shell-v2-${tag}-marketplace.png`) }).catch(() => {});
  await win.keyboard.press("Escape"); await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, `shell-v2-${tag}-sidebar-bottom.png`), clip: { x: 0, y: 500, width: 300, height: 380 } }).catch(() => {});
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const combos = [["1440x900", 1440, 900], ["1280x800", 1280, 800]];

  try {
    for (const [vp, w, h] of combos) {
      let app, win;
      try { ({ app, win } = await launchWith(w, h)); }
      catch (e) { bad(`${vp} boot`, (e && e.message) || String(e)); continue; }
      try {
        for (const lang of ["zh-CN", "zh-TW"]) await shellPass(win, vp, lang);
        /* 英文那一档只为 S-MK 跑：模板市场在英文界面里**整屏中文**这件事，
           zh-CN / zh-TW 两档都看不出来（繁体字也是汉字），必须有 en 才抓得到。 */
        await marketplacePass(win, `${vp}-en`, "en");
      } catch (e) {
        bad(`${vp} pass`, (e && e.stack || String(e)).split("\n").slice(0, 3).join(" | "));
      }
      await shutdown(app).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
    }

    // ---- S-TZ: non-UTC system timezone is the default (fresh settings seed) ----
    /* 数据根已经隔离 ⇒ 这里删的是**隔离根**里的 settings.json（要一份全新的
       种子），用户的 data/desktop 既不用删也不用还原。 */
    try {
      if (fs.existsSync(SETTINGS_JSON)) fs.rmSync(SETTINGS_JSON, { force: true });
      process.env.BITBOT_TZ = "Asia/Shanghai";
      let app, win;
      try { ({ app, win } = await launchWith(1440, 900)); }
      catch (e) { bad("S-TZ boot", (e && e.message) || String(e)); }
      if (win) {
        await win.evaluate(() => { if (typeof applyDevMode === "function") applyDevMode(false); if (typeof refreshWaveGSettings === "function") refreshWaveGSettings().catch(() => {}); });
        await win.waitForTimeout(700);
        const tz = await win.evaluate(() => { const s = document.getElementById("gp-timezone"); return s ? s.value : ""; });
        if (!tz) skip("S-TZ timezone select not found", tz);
        else (tz !== "UTC" && /Asia\/Shanghai/.test(tz)) ? ok(`S-TZ: Bot Timezone defaults to system tz "${tz}" (not UTC)`) : bad("S-TZ default timezone", tz);
        await shutdown(app).catch(() => {});
      }
    } catch (e) {
      bad("S-TZ pass", (e && e.message) || String(e));
    } finally {
      delete process.env.BITBOT_TZ;
    }
  } finally {
    /* 隔离根用完即删：门禁不该在 checkout 里留下运行时状态。 */
    try { fs.rmSync(ISO_DATA, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log("\ne2e_desktop_shell_v2: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
})();
