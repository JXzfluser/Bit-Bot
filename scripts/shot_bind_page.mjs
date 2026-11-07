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

const app = await _electron.launch({
  executablePath: ELECTRON,
  args: [
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
