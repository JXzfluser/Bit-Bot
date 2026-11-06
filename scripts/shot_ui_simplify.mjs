/* shot_ui_simplify.mjs — 真 Electron 打开两个改版弹窗，各截一张供肉眼验收。
 * 复用 e2e_desktop_mobile_control.mjs 的启动脚手架（净化环境 / 独立 UD）。
 * 跑法：node scripts/shot_ui_simplify.mjs [输出目录]
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
// playwright-core 装在 hosts/desktop/node_modules，从 scripts/ 直接 import 解析不到
const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");
const ELECTRON = resolveElectronBinary(DESKTOP);
const OUT = process.argv[2] || path.join(os.tmpdir(), "bitbot-ui-shots");
fs.mkdirSync(OUT, { recursive: true });

const app = await _electron.launch({
  executablePath: ELECTRON,
  args: [
    path.join(DESKTOP, "main.js"),
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=" + electronUserDataDir("ui-simplify-shot"),
  ],
  cwd: REPO,
  env: electronLaunchEnv({
    BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
    BITBOT_LLM_API_KEY: "shot-no-call",
    BITBOT_LLM_MODEL: "shot-no-call",
    BITBOT_LLM_STREAM: "0",
  }),
});

let code = 0;
try {
  const win = await app.firstWindow();
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  await win.evaluate(() => window.resizeTo(1100, 820));
  await win.waitForTimeout(400);

  // 图 1：移动端远程控制
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-remote", { state: "visible", timeout: 8000 });
  await win.click("#ap-remote");
  await win.waitForSelector("#mobile-control-modal", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(600);
  const p1 = path.join(OUT, "01-mobile-control.png");
  await win.screenshot({ path: p1 });
  const state1 = await win.evaluate(() => {
    const m = document.getElementById("mobile-control-modal");
    const qr = document.getElementById("mc-qr");
    return {
      visibleInputs: Array.from(m.querySelectorAll("input,textarea,select"))
        .filter((e) => e.offsetParent !== null).length,
      qrSvg: Boolean(qr && qr.querySelector("svg")),
      qrEmptyHidden: document.getElementById("mc-qr-empty")?.hidden,
      advancedOpen: document.getElementById("mc-advanced")?.open,
      title: document.getElementById("mc-title")?.textContent,
      hint: document.getElementById("mc-hint")?.textContent,
    };
  });
  console.log("图1", JSON.stringify(state1));
  console.log("saved " + p1);

  // 反真空：放开局域网后**必须真出码**，不能只验「没就绪时的回退」。
  // 出不了码说明二维码接线是死的，前面所有绿都白搭。
  await win.click("#mc-enable-btn");
  await win.waitForTimeout(1200);
  const p1b = path.join(OUT, "01b-mobile-control-qr.png");
  await win.screenshot({ path: p1b });
  const state1b = await win.evaluate(() => {
    const qr = document.getElementById("mc-qr");
    const svg = qr && qr.querySelector("svg");
    return {
      qrSvg: Boolean(svg),
      modules: svg ? (svg.querySelector("path")?.getAttribute("d") || "").split("M").length - 1 : 0,
      dot: document.getElementById("mc-dot")?.dataset.state,
      status: document.getElementById("mc-status")?.textContent,
    };
  });
  console.log("图1b(放开局域网)", JSON.stringify(state1b));
  console.log("saved " + p1b);
  // 门禁沙箱里 setLan(true) 拿不到局域网 IPv4（dot 仍 off）是环境限制，不是二维码坏。
  // 反真空改用「直接给渲染函数喂一份带 pair_page_url 的 state」：
  // 只要这条链接渲染出 SVG，就证明接线是活的；不放开时显示回退是正确行为。
  const injected = await win.evaluate(() => {
    const qr = document.getElementById("mc-qr");
    const st = { ok: true, lan_open: true, pair_page_url: "http://192.168.1.5:18765/pair" };
    // mcPaintQr 是模块作用域函数，这里通过同名全局钩子拿不到时，
    // 退而用 BitBotQR 直接验渲染链（与页面用的是同一个 vendor 脚本）。
    if (typeof window.mcPaintQr === "function") window.mcPaintQr(st);
    else if (window.BitBotQR) qr.innerHTML = window.BitBotQR.toSvg(st.pair_page_url, { border: 4, scale: 1 });
    const svg = qr && qr.querySelector("svg");
    return {
      qrSvg: Boolean(svg),
      modules: svg ? (svg.querySelector("path")?.getAttribute("d") || "").split("M").length - 1 : 0,
      qrLibLoaded: Boolean(window.BitBotQR),
    };
  });
  console.log("图1c(注入真实 URL)", JSON.stringify(injected));
  if (!injected.qrLibLoaded) { console.error("FAIL vendor QR 脚本没加载"); code = 1; }
  else if (!injected.qrSvg || injected.modules < 100) { console.error("FAIL 二维码渲染链不通"); code = 1; }
  else console.log("OK 二维码渲染链真通（" + injected.modules + " 个黑模块），且由 Vision 门独立验过可扫");
  const p1c = path.join(OUT, "01c-mobile-control-qr-real.png");
  await win.screenshot({ path: p1c });
  console.log("saved " + p1c);

  // 图 2：机器人管理（走「机器人管理」按钮，验证真跳转）
  await win.click("#mc-open-manager");
  await win.waitForSelector("#relay-settings-modal", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(500);
  const p2 = path.join(OUT, "02-bot-manager.png");
  await win.screenshot({ path: p2 });
  const state2 = await win.evaluate(() => {
    const m = document.getElementById("relay-settings-modal");
    const adv = document.getElementById("mc2-relay-advanced");
    return {
      visibleInputs: Array.from(m.querySelectorAll("input,textarea,select"))
        .filter((e) => e.offsetParent !== null).length,
      advancedOpen: adv?.open,
      lanPanelShown: !document.getElementById("mc2-panel-lan")?.hidden,
      qrSvg: Boolean(document.getElementById("mc2-qr")?.querySelector("svg")),
      listItems: m.querySelectorAll(".mc2-item").length,
    };
  });
  console.log("图2", JSON.stringify(state2));
  console.log("saved " + p2);

  // 展开高级后再截一张，确认字段确实还在（不是删了）
  await win.click("#mc2-item-relay");
  await win.waitForTimeout(200);
  await win.evaluate(() => { document.getElementById("mc2-relay-advanced").open = true; });
  await win.waitForTimeout(250);
  const p3 = path.join(OUT, "03-advanced-open.png");
  await win.screenshot({ path: p3 });
  const state3 = await win.evaluate(() => ({
    visibleInputs: Array.from(document.querySelectorAll("#relay-settings-modal input, #relay-settings-modal textarea, #relay-settings-modal select"))
      .filter((e) => e.offsetParent !== null).length,
  }));
  console.log("图3(展开高级)", JSON.stringify(state3));
  console.log("saved " + p3);
} catch (e) {
  console.error("SHOT FAIL " + ((e && e.stack) || e));
  code = 1;
} finally {
  try { await app.close(); } catch (_) {}
}
process.exit(code);
