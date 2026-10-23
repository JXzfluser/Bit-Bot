/* electron_bin.mjs — 解析 Electron 可执行文件路径（跨平台单一真源）。
 *
 * 背景：多个 e2e 脚本把路径写死成 `node_modules/electron/dist/electron`，
 * 那是 Linux/Windows 的布局。macOS 的 electron 包装出来是
 * `dist/Electron.app/Contents/MacOS/Electron`，于是这些门禁在 mac 上全部
 * 打印「SKIP — electron dist missing」——dist 明明在，只是找错了地方。
 * 一个 SKIP 永远不等于 PASS，所以这类假跳过必须修掉。
 *
 * 以 electron 包自己写的 path.txt 为准（安装器就按它落盘），再退回常见布局。
 */
import fs from "fs";
import path from "path";

export function resolveElectronBinary(desktopDir) {
  const pkgDir = path.join(desktopDir, "node_modules/electron");
  const dist = path.join(pkgDir, "dist");
  const candidates = [];
  try {
    const rel = fs.readFileSync(path.join(pkgDir, "path.txt"), "utf8").trim();
    if (rel) candidates.push(path.join(dist, rel));
  } catch (_) {
    /* path.txt 缺失就走下面的常见布局 */
  }
  candidates.push(
    path.join(dist, "electron"),
    path.join(dist, "electron.exe"),
    path.join(dist, "Electron.app/Contents/MacOS/Electron"),
  );
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {
      /* ignore */
    }
  }
  return candidates[0];
}
