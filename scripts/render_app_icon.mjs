/* render_app_icon.mjs — 从 icon.svg 渲染出桌面需要的全部位图尺寸
 *
 * 为什么不用 ImageMagick / rsvg：这台机器都没有，但项目自带 Electron + playwright-core，
 * 用它渲染 SVG 是同一套浏览器引擎，所见即桌面所见（不会出现"SVG 好看、ICO 糊"）。
 *
 * 用法：node scripts/render_app_icon.mjs [path/to/icon.svg]
 * 产出直接覆盖 hosts/desktop/build/icon.png 与 build/icons/*.png。
 */
import path from "path";
import fs from "fs";
import os from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const BUILD = path.join(REPO, "hosts/desktop/build");
const ELECTRON = resolveElectronBinary(path.join(REPO, "hosts/desktop"));
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

const svgPath = path.resolve(process.argv[2] || path.join(BUILD, "icon.svg"));
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

let app = null;
try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-icon-"));
  const html = path.join(tmp, "preview.html");
  // SVG 必须内联：用 <img src="file://…"> 时 file→file 的本地加载被拦，
  // 截出来是一整张白图（而且文件只有几 KB，看着像"扁平设计压得好"，其实是空的）。
  const svg = fs.readFileSync(svgPath, "utf8");
  fs.writeFileSync(html, [
    "<!doctype html><meta charset=utf-8>",
    "<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}",
    "svg{display:block;width:100vw;height:100vh}</style>",
    svg,
  ].join(""));

  app = await _electron.launch({
    executablePath: ELECTRON,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    cwd: REPO,
    env: electronLaunchEnv({}),
    timeout: 60000,
  });
  const page = await app.firstWindow({ timeout: 30000 });
  await page.goto("file://" + html, { waitUntil: "load" });

  fs.mkdirSync(path.join(BUILD, "icons"), { recursive: true });
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const out = path.join(BUILD, "icons", `${size}x${size}.png`);
    await page.screenshot({ path: out, omitBackground: true });
    if (size === 1024) fs.copyFileSync(out, path.join(BUILD, "icon.png"));
    console.log(`  ✓ ${size}x${size}.png  ${fs.statSync(out).size} bytes`);
  }
  /* ---- macOS .icns：iconutil 只吃 .iconset 的标准命名 ---- */
  if (process.platform === "darwin") {
    const set = path.join(tmp, "app.iconset");
    fs.mkdirSync(set, { recursive: true });
    const pairs = [
      ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
      ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
      ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
      ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
      ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
    ];
    for (const [name, size] of pairs) {
      fs.copyFileSync(path.join(BUILD, "icons", `${size}x${size}.png`), path.join(set, name));
    }
    execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(BUILD, "icon.icns")]);
    console.log(`  ✓ icon.icns  ${fs.statSync(path.join(BUILD, "icon.icns")).size} bytes`);
  } else {
    console.log("  ⊘ 非 macOS，跳过 icon.icns");
  }

  /* ---- Windows .ico：Vista+ 允许直接装 PNG，没必要手写 BMP ---- */
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const blobs = icoSizes.map((size) => ({
    size,
    buf: fs.readFileSync(path.join(BUILD, "icons", `${size}x${size}.png`)),
  }));
  const ico = Buffer.alloc(6);
  ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(blobs.length, 4);
  let offset = 6 + 16 * blobs.length;
  const dirs = [];
  for (const b of blobs) {
    const e = Buffer.alloc(16);
    e[0] = b.size >= 256 ? 0 : b.size;   // 256 在 ICO 目录里用 0 表示
    e[1] = b.size >= 256 ? 0 : b.size;
    e.writeUInt16LE(1, 4);               // planes
    e.writeUInt16LE(32, 6);              // 32bpp
    e.writeUInt32LE(b.buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += b.buf.length;
    dirs.push(e);
  }
  fs.writeFileSync(path.join(BUILD, "icon.ico"), Buffer.concat([ico, ...dirs, ...blobs.map((b) => b.buf)]));
  console.log(`  ✓ icon.ico   ${fs.statSync(path.join(BUILD, "icon.ico")).size} bytes`);

  console.log(`\n图标全部产物已写入 ${BUILD}`);
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  console.error("render_app_icon fatal:", (e && e.stack) || e);
  process.exitCode = 1;
} finally {
  if (app) { try { await app.close(); } catch (_) {} }
}
