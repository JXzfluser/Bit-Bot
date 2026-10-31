// GP-185 凭证屏真开机截图：走用户真实路径（侧栏「设置」→ 内核 open settings → 点「凭证」页签），
// 不手改 DOM 样式。临时 user-data-dir + NO_SECRET_SYNC：不碰用户的 .env.local 与真数据。
// 用法：node scripts/shot_settings_credentials.mjs [before|after]
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const which = process.argv[2] === "before" ? "before" : "after";
const OUT = path.join(REPO, "artifacts", `gp185-credentials-${which}.png`);
const OUT_DARK = path.join(REPO, "artifacts", `gp185-credentials-${which}-dark.png`);

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");
const ud = electronUserDataDir("gp185-shot");
/* 中途抛错也要清临时目录（playwright 在进程退出时会带走 app） */
process.on("exit", () => { try { fs.rmSync(ud, { recursive: true, force: true }); } catch {} });
/* 切主题会写进 data/desktop/settings.json（dev 数据根 = 仓库 data/），那是用户看得见
   的状态。本脚本按原样还原，不留「跑个截图把用户调成深色」的副作用。 */
const SETTINGS = path.join(REPO, "data/desktop/settings.json");
const settingsBackup = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
const settingsFile = path.join(ud, "gp185-settings.bak");
if (settingsBackup) fs.writeFileSync(settingsFile, settingsBackup);
process.on("exit", () => {
  try {
    if (settingsBackup) fs.writeFileSync(SETTINGS, settingsBackup);
    fs.rmSync(settingsFile, { force: true });
  } catch {}
});
const app = await _electron.launch({
  executablePath: resolveElectronBinary(DESKTOP),
  args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
  cwd: REPO,
  env: electronLaunchEnv(gateAppEnv(REPO)),
});
const win = await app.firstWindow();
await win.setViewportSize({ width: 1440, height: 900 });
await win.waitForSelector("#account-avatar-btn", { timeout: 20000 });

/* 真路径：头像 → 账户弹层「设置」→ 内核意图渲染面板 → 点「凭证」页签
   （#sidebar-settings-btn 在 body.grok-ui 下是 display:none，点它不是用户路径） */
await win.click("#account-avatar-btn");
await win.waitForSelector("#ap-settings", { state: "visible", timeout: 20000 });
await win.click("#ap-settings");
await win.waitForFunction(
  () => {
    const p = document.getElementById("settings-panel");
    return !!p && getComputedStyle(p).display !== "none";
  },
  { timeout: 30000 }
);
await win.click('#settings-tabs .settings-tab-btn[data-stab="credentials"]');
await win.waitForSelector("#secrets-panel", { state: "visible", timeout: 10000 });
/* 主题显式定成浅色，别跟着上次跑的状态走（否则 before/after 两张图不同主题没法比） */
await win.click('#settings-tabs .settings-tab-btn[data-stab="general"]');
await win.click('[data-appearance="light"]');
await win.waitForTimeout(400);
await win.click('#settings-tabs .settings-tab-btn[data-stab="credentials"]');
await win.waitForTimeout(2500);

/* 自证：截图里的形状确实是重排后的形状，而不是「拍到了别的屏」 */
const facts = await win.evaluate(() => {
  const sheet = document.querySelector("#settings-panel .bb-sheet");
  const zones = [...document.querySelectorAll('#secrets-panel > .st-card[id^="sec-zone-"]')].map((c) => ({
    id: c.id,
    h: Math.round(c.getBoundingClientRect().height),
  }));
  const fold = document.getElementById("sec-alt-channels");
  const foot = document.querySelector(".st-foot");
  const cs = foot ? getComputedStyle(foot) : null;
  return {
    visibleTab: document.querySelector("#settings-tabs .settings-tab-btn.active")?.dataset.stab,
    zones,
    metaLeak: (document.getElementById("settings-meta")?.textContent || "").trim().slice(0, 40),
    foldOpen: !!fold && fold.hasAttribute("open"),
    /* Chromium 130 的闭合 details 用 content-visibility 隐藏子树：offsetParent 与
       getBoundingClientRect 都照旧报尺寸，只有 checkVisibility 说实话。 */
    foldHiddenControls: fold
      ? [...fold.querySelectorAll("input,select")].filter((i) => !i.checkVisibility({ contentVisibilityAutoStateProperty: true })).length
      : -1,
    markBox: (() => {
      const r = document.querySelector(".st-adv-mark")?.getBoundingClientRect();
      return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
    })(),
    footPosition: cs ? cs.position : "none",
    /* 一屏之内要填几栏：这是「简洁」唯一能被量的口径 */
    firstScreenFields: (() => {
      const sheetBottom = document.querySelector("#settings-panel .bb-sheet").getBoundingClientRect().bottom;
      return [...document.querySelectorAll("#secrets-panel input, #secrets-panel select")]
        .filter((i) => i.checkVisibility({ contentVisibilityAutoStateProperty: true }))
        .filter((i) => { const r = i.getBoundingClientRect(); return r.top > 0 && r.bottom < sheetBottom - 70; })
        .map((i) => i.id);
    })(),
    panelScrollH: Math.round(document.getElementById("secrets-panel").scrollHeight),
    footVisible: !!foot && foot.getBoundingClientRect().height > 0,
    statusText: (document.getElementById("sec-status")?.textContent || "").trim().slice(0, 40),
    sheetBox: (() => {
      const r = sheet.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    overflowX: (() => {
      const bad = [];
      document.querySelectorAll("#secrets-panel *").forEach((el) => {
        const r = el.getBoundingClientRect();
        const pr = el.parentElement ? el.parentElement.getBoundingClientRect() : null;
        if (pr && r.right > pr.right + 1.5) bad.push(el.id || el.className);
      });
      return bad.slice(0, 6);
    })(),
  };
});
console.log(JSON.stringify(facts, null, 2));
/* 自证的最后一环：形状不对就非零退出，别把「拍到了」当成「拍对了」 */
const problems = [];
if (facts.visibleTab !== "credentials") problems.push("截图不在凭证页签：" + facts.visibleTab);
if (facts.zones.length !== 4) problems.push("分区卡数量 " + facts.zones.length + " ≠ 4");
if (facts.foldOpen) problems.push("折叠默认是开的");
if (facts.foldHiddenControls !== 3) problems.push("折叠里应有 3 个输入，实测 " + facts.foldHiddenControls);
if (facts.footPosition !== "sticky") problems.push("保存条不是 sticky：" + facts.footPosition);
if (!facts.footVisible) problems.push("保存条不可见");
if (facts.metaLeak) problems.push("产品态诊断行没留空：" + JSON.stringify(facts.metaLeak));
if (facts.overflowX.length) problems.push("横向溢出：" + facts.overflowX.join(","));
if (facts.markBox && facts.markBox.w <= 0) problems.push("折叠指示器没有尺寸（看不见 = 没有可点暗示）");

await win.locator("#settings-panel .bb-sheet").screenshot({ path: OUT });
/* before 模式只负责留下一张对照图（旧布局没有折叠，断言按 after 的形状写死会误报） */
if (which === "after") {
  await win.click("#sec-alt-channels > summary");
  await win.waitForTimeout(400);
  const afterOpen = await win.evaluate(() => {
    const f = document.getElementById("sec-alt-channels");
    return {
      open: f.open,
      shown: [...f.querySelectorAll("input,select")].filter((i) => i.checkVisibility({ contentVisibilityAutoStateProperty: true })).length,
    };
  });
  console.log("折叠点开：" + JSON.stringify(afterOpen));
  if (!afterOpen.open || afterOpen.shown !== 3) problems.push("折叠点不开或展开后栏数不对：" + JSON.stringify(afterOpen));
  await win.locator("#sec-alt-channels").screenshot({ path: path.join(REPO, "artifacts", `gp185-credentials-${which}-fold.png`) });
  await win.click("#sec-alt-channels > summary");
  await win.waitForTimeout(300);
}
/* 暗色：走通用页的真实主题芯片，不塞 class */
await win.click('#settings-tabs .settings-tab-btn[data-stab="general"]');
await win.click('[data-appearance="dark"]');
await win.waitForTimeout(600);
await win.click('#settings-tabs .settings-tab-btn[data-stab="credentials"]');
await win.waitForTimeout(800);
await win.locator("#settings-panel .bb-sheet").screenshot({ path: OUT_DARK });
console.log("shot: " + OUT + "\nshot: " + OUT_DARK);
console.log(problems.length ? "FAIL: " + problems.join(" ; ") : "PASS: 形状自证 9 条全过（页签/4 卡/折叠默认收+3 栏在内/点得开/sticky/诊断行留空/指示器有尺寸/无横向溢出）");

await app.close().catch(() => {});
fs.rmSync(ud, { recursive: true, force: true });
process.exit(problems.length ? 1 : 0);
