/* 把本机导出的手机绑定页用真 Electron 渲染成图片，肉眼验收用。
 * 跑法：node scripts/shot_bind_page.mjs [输出目录]
 * 前置：先跑生成两份 HTML 的那一步（见 docs 8.90 / prove_bot_manager 的实现）。
 * 没有 HTML 就直接说没有，不画一张假图。 */
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
const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");
const ELECTRON = resolveElectronBinary(DESKTOP);
const OUT = process.argv[2] || path.join(os.tmpdir(), "bitbot-bind-shots");
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["/tmp/bind-page.html", "01-bind-form.png", "手机：绑定表单"],
  ["/tmp/bind-page-error.html", "02-bind-error.png", "手机：校验失败（不消费 token）"],
];

const missing = PAGES.filter(([f]) => !fs.existsSync(f));
if (missing.length) {
  console.error("缺 HTML：" + missing.map((m) => m[0]).join(", "));
  process.exit(1);
}

/* 必须给 Electron 一个真的 app 路径。
 * 第一版只传了 --no-sandbox 这类开关，没传 app —— Electron 就把**自己的默认欢迎页**
 * （「Electron v37… To run a local app…」那种窗口）开出来，脚本 goto 之后截图能成，
 * 但每次都会先闪一个默认窗口，跑完没关掉还会一直留在桌面上。
 * 这里现造一个最小的宿主 app：开一个空白窗，页面由 win.goto(file://…) 灌进去。 */
const APP_DIR = path.join(os.tmpdir(), "bitbot-bind-shot-app");
fs.mkdirSync(APP_DIR, { recursive: true });
fs.writeFileSync(
  path.join(APP_DIR, "package.json"),
  JSON.stringify({ name: "bitbot-bind-shot", version: "0.0.0", main: "main.js" }),
);
fs.writeFileSync(
  path.join(APP_DIR, "main.js"),
  [
    'const { app, BrowserWindow } = require("electron");',
    "let win = null;",
    "app.disableHardwareAcceleration();",
    "app.whenReady().then(() => {",
    "  win = new BrowserWindow({",
    "    width: 390, height: 844, show: true,",
    '    title: "bind-page-shot",',
    "    webPreferences: { contextIsolation: true, nodeIntegration: false },",
    "  });",
    "  win.setMenuBarVisibility(false);",
    '  win.loadURL("about:blank");',
    "});",
    'app.on("window-all-closed", () => app.quit());',
    "",
  ].join("\n"),
);

const app = await _electron.launch({
  executablePath: ELECTRON,
  args: [
    APP_DIR,
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=" + electronUserDataDir("bind-shot"),
  ],
  cwd: REPO,
  env: electronLaunchEnv({}),
});

let code = 0;
try {
  for (const [src, name, label] of PAGES) {
    const win = await app.firstWindow();
    await win.setViewportSize({ width: 390, height: 844 });
    await win.goto("file://" + src);
    await win.waitForTimeout(350);
    const info = await win.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input:not([type=hidden])"));
      return {
        title: document.querySelector("h1")?.textContent || "",
        inputs: inputs.map((i) => i.name),
        hasButton: Boolean(document.querySelector("button[type=submit]")),
        problems: Array.from(document.querySelectorAll("section.bad li")).map((li) => li.textContent),
      };
    });
    console.log(label, JSON.stringify(info));
    await win.screenshot({ path: path.join(OUT, name) });
    console.log("saved " + path.join(OUT, name));
  }
} catch (e) {
  console.error("SHOT FAIL " + ((e && e.stack) || e));
  code = 1;
} finally {
  try { await app.close(); } catch (_) {}
}
process.exit(code);
