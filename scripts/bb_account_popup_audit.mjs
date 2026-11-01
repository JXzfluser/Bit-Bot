/* bb_account_popup_audit.mjs — 左侧底部账户弹层（#account-popup）功能落点实测审计。
 *
 * 用户诉求：「左侧底部点开的那个弹框，功能要全部整理并进行对齐」。
 * 这个脚本不做断言、不改代码，只做一件事：起**真** Electron 桌面端，逐一点
 * 10 个 .ap-item + #ab-sessions-btn，记录「用户实际看到什么」。
 *
 * 为什么每项要跑两遍：
 *   gate = 门禁环境（scripts/electron_env.mjs 的 gateAppEnv）
 *   real = 尽量贴近 bash scripts/start-desktop.sh 的真实环境
 *          （只保留 BITBOT_NO_SECRET_SYNC=1 / BITBOT_DESKTOP_AUTOSTART=0）
 *   上一轮在 gate 里看到 ops/settings-refused-*.json，怀疑是隔离环境造成的
 *   假象。两遍对照就能分辨：宿主拒绝是硬编码的 entry 白名单（CM-1901），
 *   还是环境差异。
 *
 * 「可见」的判定：本任务原样规定用 `offsetParent !== null`。但 .bb-modal 是
 * `position: fixed`，fixed 元素的 offsetParent 恒为 null —— 只用它会**系统性
 * 漏掉所有弹层**，把"打开了设置"误判成"无反应"。所以这里主判据用
 * 「几何 + 计算样式」：rect>2px、display!=none、visibility visible、opacity>0。
 * 同时**仍然**记录 offsetParent!==null 的差集（字段 offAdded），两把尺子并列，
 * 结论以 rect 为准、offAdded 作为对照证据。
 *
 * 安全线：
 *   - ap-signout：读码确认处理函数只有 accountPlaceholder()（addMsg + 收弹层），
 *     不退出登录、不清凭据 → 可以点。判定同时附上代码事实。
 *   - 不发消息、不提交任何凭证、不保存用户设置（每项测完 Escape + 走各自的
 *     close 按钮，绝不点"保存"）。
 *   - user-data-dir 用独立临时目录，跑完删；.env.local 靠 NO_SECRET_SYNC 保护。
 *   - real 模式会拉起 routine daemon（app 自身行为）；脚本记录启动前的 daemon
 *     PID 集合，只清理**本次新增**的那些，绝不碰用户原有的。
 *
 * 用法：node scripts/bb_account_popup_audit.mjs [gate|real|both]
 * 产物：/tmp/bb_ap/<mode>/<item>.png + /tmp/bb_ap/<mode>/results.json
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const MAIN_JS = path.join(DESKTOP, "main.js");
const ELECTRON = resolveElectronBinary(DESKTOP);

const OUT_ROOT = "/tmp/bb_ap";
const MODE = process.argv[2] || "both";
const MODES = MODE === "gate" ? ["gate"] : MODE === "real" ? ["real"] : ["gate", "real"];

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

/* 弹层项按 DOM 顺序；ab-sessions-btn 在账户弹层之外，单独测。
   ap-update 已下线（版本更新只在「设置 → 更新」）；ap-mobile 并进了
   ap-remote 打开的「移动端远程控制」弹窗 —— 两者都不在清单里。 */
const ITEMS = [
  { key: "ap-usage", label: "每周用量", inPopup: true },
  { key: "ap-remote", label: "移动端远程控制", inPopup: true },
  { key: "ap-support", label: "支持", inPopup: true },
  { key: "ap-settings", label: "设置", inPopup: true },
  { key: "ap-connect", label: "连接应用", inPopup: true },
  { key: "ap-market", label: "模板市场", inPopup: true },
  { key: "ap-add-account", label: "添加账户", inPopup: true },
  { key: "ap-signout", label: "退出登录", inPopup: true },
  { key: "ab-sessions-btn", label: "账户条·会话图标", inPopup: false },
];

const SURFACES = [
  "settings-panel",
  "connect-apps-modal",
  "marketplace-modal",
  "model-modal",
  "mobile-control-modal",
  "account-popup",
  "sessions-popup",
  "sb-bots-rooms",
  "sb-more",
];

const log = (...a) => console.log(...a);

function daemonPids() {
  try {
    return new Set(
      execFileSync("/bin/pgrep", ["-f", "host_routine_daemon.sh"], { encoding: "utf8" })
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

/* ---------- 浏览器侧探针（一次 evaluate 拿全一项需要的数据） ---------- */

function probeFn() {
  const firstCls = (el) => {
    const c = typeof el.className === "string" ? el.className.trim() : "";
    if (!c) return "(nocc)";
    const t = c.split(/\s+/)[0];
    return t.length > 48 ? t.slice(0, 48) : t;
  };
  const keyOf = (el) => (el.id ? "#" + el.id + "." : ".") + firstCls(el);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return false;
    if (cs.visibility === "hidden" || cs.visibility === "collapse") return false;
    if (parseFloat(cs.opacity || "1") === 0) return false;
    // 视口外的（弹层被推到屏幕外）不算用户能看到
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    return true;
  };
  const keys = () => {
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      if (visible(el)) out.push(keyOf(el));
      if (el.offsetParent !== null && visible(el)) out.push("OFF::" + keyOf(el));
    }
    return out;
  };
  const state = (id) => {
    const el = document.getElementById(id);
    if (!el) return { missing: true };
    const cs = getComputedStyle(el);
    return {
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      hiddenAttr: el.hasAttribute("hidden"),
      rect: (() => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      })(),
      visuallyVisible: visible(el),
    };
  };
  const lastMsg = () => {
    const l = document.getElementById("log");
    if (!l || !l.lastElementChild) return null;
    const el = l.lastElementChild;
    const r = el.getBoundingClientRect();
    return {
      cls: el.className,
      text: (el.textContent || "").replace(/\s+/g, " ").trim(),
      userVisible: visible(el) && !/\bdebug-only\b/.test(el.className),
      top: Math.round(r.top),
    };
  };
  return {
    keys,
    state,
    lastMsg,
    snap: () => ({
      added: [],
      removed: [],
      offAdded: [],
      logTail: lastMsg(),
      popupHidden: !!document.getElementById("account-popup")?.hasAttribute("hidden"),
      ariaExpanded: document.getElementById("account-avatar-btn")?.getAttribute("aria-expanded"),
      overflowX:
        document.documentElement.scrollWidth > window.innerWidth + 1
          ? { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }
          : null,
      surfaces: Object.fromEntries(
        [
          "settings-panel",
          "connect-apps-modal",
          "marketplace-modal",
          "model-modal",
          "mobile-control-modal",
          "account-popup",
          "sessions-popup",
          "sb-bots-rooms",
          "sb-more",
        ].map((id) => [id, state(id)])
      ),
      advChecked: !!document.getElementById("grok-adv-toggle")?.checked,
      sessionRows: document.querySelectorAll("#sessions-popup .sess-row").length,
      settingsMeta: (() => {
        const m = document.getElementById("settings-meta");
        return m ? (m.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300) : null;
      })(),
      // 「设置暂时无法打开」这行到底能不能被用户看见？grok-ui 皮肤里
      // #settings-meta 是 display:none !important（ui_chrome.css:1388），
      // 所以内核的拒绝回执在真机上是**静默**的。这里把计算样式一起记下来。
      settingsMetaComputed: (() => {
        const m = document.getElementById("settings-meta");
        if (!m) return null;
        const cs = getComputedStyle(m);
        const r = m.getBoundingClientRect();
        return { display: cs.display, visibility: cs.visibility, h: Math.round(r.height), text: (m.textContent || "").trim().slice(0, 120) };
      })(),
      activeTab: (() => {
        const t = document.querySelector(".settings-tab-btn[aria-current='true'], .settings-tab-btn.active, .settings-tab-btn.sel");
        return t ? t.textContent.trim() : null;
      })(),
      sendDisabled: !!document.getElementById("send")?.disabled,
      viewport: [window.innerWidth, window.innerHeight],
    }),
  };
}

function diffKeys(before, after) {
  const b = new Set(before), a = new Set(after);
  const uniq = (arr) => [...new Set(arr)];
  return {
    added: uniq(after.filter((k) => !k.startsWith("OFF::") && !b.has(k))).slice(0, 15),
    removed: uniq(before.filter((k) => !k.startsWith("OFF::") && !a.has(k))).slice(0, 15),
    offAdded: uniq(after.filter((k) => k.startsWith("OFF::") && !b.has(k))).slice(0, 15),
  };
}

/* ---------- 一轮完整测量（一个环境模式） ---------- */

async function runMode(mode) {
  const outDir = path.join(OUT_ROOT, mode);
  fs.mkdirSync(outDir, { recursive: true });
  const ud = electronUserDataDir("ap-audit-" + mode);
  const pidsBefore = daemonPids();

  let env;
  if (mode === "gate") {
    env = electronLaunchEnv(gateAppEnv(REPO, { BITBOT_NO_SECRET_SYNC: "1", BITBOT_DESKTOP_AUTOSTART: "0" }));
  } else {
    // 尽量贴近 start-desktop.sh：它只做两件事 —— PATH=~/.moon/bin:$PATH，然后
    // npm start（= electron .，不带任何 BITBOT_* 变量）。这里除任务指定的
    // NO_SECRET_SYNC / DESKTOP_AUTOSTART 外**不加任何**其它变量，包括
    // ROUTINE_DAEMON_AUTOSTART —— 真实用户会拉起 daemon，门禁不该假装不会。
    // 副作用由脚本末尾的 PID 差分回收（只杀本次新增的，绝不动用户原有的）。
    env = electronLaunchEnv({ BITBOT_NO_SECRET_SYNC: "1", BITBOT_DESKTOP_AUTOSTART: "0" });
    const moon = path.join(os.homedir() || "", ".moon/bin");
    if (fs.existsSync(moon)) env.PATH = moon + ":" + (env.PATH || "");
  }

  log(`\n===== MODE=${mode} =====`);
  log(`  electron=${ELECTRON}`);
  log(`  user-data-dir=${ud}`);
  log(`  env keys: BITBOT_REPO_ROOT=${env.BITBOT_REPO_ROOT || "(unset → 真仓库)"} NO_SECRET_SYNC=${env.BITBOT_NO_SECRET_SYNC} DAEMON=${env.BITBOT_ROUTINE_DAEMON_AUTOSTART || "(unset)"}`);

  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [MAIN_JS, "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO,
    env,
  });
  const results = { mode, launched_at: new Date().toISOString(), items: {}, notes: [] };
  try {
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 40000 });
    await win.evaluate(() => window.resizeTo(1040, 760)).catch(() => {});
    await win.waitForTimeout(600);
    await win.evaluate(() => {
      document.body.classList.remove("force-dark");
      document.body.classList.add("force-light");
    });
    await win.waitForTimeout(700);
    await win.evaluate(`window.__probe = (${probeFn.toString()})()`);
    const snap = () => win.evaluate(() => window.__probe.snap());
    const keys = () => win.evaluate(() => window.__probe.keys());
    const st = (id) => win.evaluate((i) => window.__probe.state(i), id);

    /* 复位到干净初始态：Escape 收起最上层 sheet，再兜底隐藏弹层/面板。 */
    async function reset() {
      await win.evaluate(() => {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        document.getElementById("account-popup")?.setAttribute("hidden", "");
        document.getElementById("sessions-popup")?.setAttribute("hidden", "");
        for (const id of ["settings-panel", "connect-apps-modal", "marketplace-modal", "model-modal", "mobile-control-modal"]) {
          const m = document.getElementById(id);
          if (m) m.style.display = "none";
        }
        const t = document.getElementById("grok-adv-toggle");
        if (t && t.checked) {
          t.checked = false;
          t.dispatchEvent(new Event("change", { bubbles: true }));
        }
        document.getElementById("ab-sessions-btn")?.setAttribute("aria-expanded", "false");
        document.getElementById("account-avatar-btn")?.setAttribute("aria-expanded", "false");
      });
      await win.waitForTimeout(350);
      const open = await win.evaluate(() =>
        ["settings-panel", "connect-apps-modal", "marketplace-modal", "model-modal", "mobile-control-modal", "account-popup", "sessions-popup"]
          .filter((id) => {
            const e = document.getElementById(id);
            if (!e) return false;
            const cs = getComputedStyle(e);
            return cs.display !== "none" && !e.hasAttribute("hidden");
          })
      );
      return open;
    }

    // 初始态必须干净，否则后面所有差集都不可信
    results.notes.push("boot reset open-surfaces=" + JSON.stringify(await reset()));

    for (const item of ITEMS) {
      const rec = { label: item.label };
      const still = await reset();
      rec.reset_before = still;
      const itemOpStart = Date.now() - 200; // 只算这一项点下去之后写的工件

      // 1) 基线：账户弹层已展开（ab-sessions-btn 不需要）
      if (item.inPopup) {
        await win.evaluate(() => document.getElementById("account-avatar-btn")?.click());
        await win.waitForTimeout(350);
        rec.popup_open_before_click = await st("account-popup");
      }
      const beforeKeys = await keys();

      // 2) 真实鼠标点击（用户路径）；失败则退化为 DOM click 并记录
      let clickVia = "mouse";
      try {
        await win.click("#" + item.key, { timeout: 5000 });
      } catch (e) {
        clickVia = "dom-click(fallback)";
        rec.click_error = String(e && e.message).split("\n")[0].slice(0, 160);
        await win.evaluate((id) => document.getElementById(id)?.click(), item.key);
      }
      rec.click_via = clickVia;

      // 3) 点击后 1.5s：截图 + 快照（任务规定的时点）
      await win.waitForTimeout(1500);
      await win.screenshot({ path: path.join(outDir, item.key + ".png") }).catch((e) => {
        rec.shot_error = String(e && e.message).slice(0, 120);
      });
      const at1500 = await snap();
      at1500.keys = await keys();
      rec.at_1500 = at1500;

      // 4) 再等到回合稳定（内核 turn 可能 >1.5s），最多 +9s
      let settled = null;
      for (let i = 0; i < 9; i++) {
        await win.waitForTimeout(1000);
        const s = await snap();
        if (!s.sendDisabled && s.logTail && s.logTail.text) {
          settled = s;
          break;
        }
        settled = s;
      }
      settled.keys = await keys();
      rec.settled = settled;
      if (await win.evaluate(() => document.getElementById("send")?.disabled)) {
        rec.still_running_after_9s = true;
      }

      const d15 = diffKeys(beforeKeys, at1500.keys);
      const dS = diffKeys(beforeKeys, settled.keys);
      rec.added_1500 = d15.added;
      rec.removed_1500 = d15.removed;
      rec.offAdded_1500 = d15.offAdded;
      rec.added_settled = dS.added;
      rec.removed_settled = dS.removed;
      rec.offAdded_settled = dS.offAdded;

      // 5) 关键 surface 在稳定后的状态
      rec.surfaces_settled = settled.surfaces;
      rec.advChecked_settled = settled.advChecked;
      rec.popupHidden_settled = settled.popupHidden;
      rec.logTail_settled = settled.logTail;
      rec.logTail_1500 = at1500.logTail;
      rec.settingsMeta_settled = settled.settingsMeta;
      rec.settingsMetaComputed_settled = settled.settingsMetaComputed;
      rec.activeTab_settled = settled.activeTab;
      rec.sessionRows_settled = settled.sessionRows;
      rec.overflowX_settled = settled.overflowX;
      rec.viewport = settled.viewport;

      // 6) 该项是否新写了 refused 工件（gate/real 都看 data/settings/ops mtime）
      rec.new_op_artifacts = opsWrittenSince(itemOpStart);
      rec.new_op_refused = opsWrittenSince(itemOpStart).some((x) => /refused|bad-anchor/.test(x.n));

      results.items[item.key] = rec;
      log(`\n--- ${item.key} (${item.label}) via=${clickVia} ---`);
      log(`  +1.5s 新增可见: ${JSON.stringify(d15.added)}`);
      log(`  settled 新增可见: ${JSON.stringify(dS.added)}`);
      log(`  offsetParent 口径新增: ${JSON.stringify(dS.offAdded)}`);
      log(`  #log 尾: ${(settled.logTail?.text || "").slice(0, 180)}  [userVisible=${settled.logTail?.userVisible}]`);
      log(`  弹层收起=${settled.popupHidden} · 横向溢出=${JSON.stringify(settled.overflowX)}`);
      log(`  surfaces(可见): ${JSON.stringify(Object.fromEntries(Object.entries(settled.surfaces).map(([k, v]) => [k, v.visuallyVisible])))}`);
      log(`  advChecked=${settled.advChecked} settingsMeta="${settled.settingsMeta || ""}" sessionRows=${settled.sessionRows}`);
      log(`  本轮新 op 工件: ${JSON.stringify(rec.new_op_artifacts).slice(0, 300)}`);
      await reset();
    }

    fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2) + "\n");
    log(`\n[MODE ${mode}] results → ${path.join(outDir, "results.json")}`);
  } catch (e) {
    results.crash = String((e && e.stack) || e).split("\n").slice(0, 6).join(" | ");
    log("  CRASH: " + results.crash);
    fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2) + "\n");
  } finally {
    try {
      await app.evaluate(({ app: ea }) => {
        ea.isQuiting = true;
        ea.quit();
      });
      await app.close();
    } catch {
      /* already gone */
    }
    // 只杀本次新增的 daemon
    for (const p of [...daemonPids()].filter((p) => !pidsBefore.has(p))) {
      try {
        execFileSync("/bin/kill", [p]);
        log("  killed stray daemon pid " + p);
      } catch {
        /* ignore */
      }
    }
    fs.rmSync(ud, { recursive: true, force: true });
  }
  return results;
}

/* ---- data/settings/ops 工件监听（判断"被内核拒绝"是不是真的发生） ---- */
const OPS_DIR = path.join(REPO, "data/settings/ops");
let opStart = 0;
function markOpsStart() {
  opStart = Date.now() - 500;
}
function opsWrittenSince(t) {
  try {
    return fs
      .readdirSync(OPS_DIR)
      .map((n) => {
        const f = path.join(OPS_DIR, n);
        const st = fs.statSync(f);
        return { n, m: Math.round(st.mtimeMs), size: st.size };
      })
      .filter((x) => x.m > t)
      .slice(0, 8);
  } catch {
    return [];
  }
}

(async () => {
  if (!fs.existsSync(ELECTRON)) {
    log("electron dist missing: " + ELECTRON);
    process.exit(2);
  }
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const all = {};
  for (const m of MODES) {
    markOpsStart();
    all[m] = await runMode(m);
  }
  fs.writeFileSync(path.join(OUT_ROOT, "summary.json"), JSON.stringify(all, null, 2) + "\n");

  // 控制台判定表
  log("\n\n===== 判定表（settled 时点） =====");
  const head = ["item", "surface-opened", "log-tail-userVisible", "refused-artifact"];
  log(head.join(" | "));
  for (const [m, r] of Object.entries(all)) {
    for (const k of ITEMS.map((i) => i.key)) {
      const rec = (r.items || {})[k];
      if (!rec) continue;
      const opened = Object.entries(rec.surfaces_settled || {})
        .filter(([id, v]) => v.visuallyVisible && !["account-popup"].includes(id))
        .map(([id]) => id);
      const refused = (rec.new_op_artifacts || []).some((x) => /refused|bad-anchor/.test(x.n));
      log(
        [m, k, opened.join(",") || "-", String(rec.logTail_settled?.userVisible), refused ? "YES" : "no"].join(" | ")
      );
    }
  }
  log("\nDONE");
  process.exit(0);
})().catch((e) => {
  console.error("audit crashed:", e && e.stack ? e.stack : e);
  process.exit(1);
});
