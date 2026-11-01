"use strict";

/**
 * electron-builder afterPack hook: prune the Electron framework's bundled
 * locales down to the app's `electronLanguages` whitelist.
 *
 * Why a hook is needed: on macOS app-builder-lib's `electronLanguages` support
 * deletes `Contents/Resources/*.lproj`, which are empty placeholders. The real
 * payload lives in `Electron Framework.framework/Versions/A/Resources/*.lproj`
 * (measured: 54 dirs / ~41 MB of `locale.pak`).
 */

const fs = require("fs");
const path = require("path");

function dirSizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSizeBytes(p) : fs.statSync(p).size;
  }
  return total;
}

// Electron names macOS locale bundles with underscores and no region for US
// English, so `en-US` -> keep `en.lproj`, `zh-CN` -> keep `zh_CN.lproj`.
function keepNames(locale) {
  const [lang, region] = String(locale).split(/[-_]/);
  const names = [lang.toLowerCase()];
  if (region) names.push(`${lang.toLowerCase()}_${region.toUpperCase()}`);
  return names;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const requested = context.packager.platformSpecificBuildOptions.electronLanguages ||
    context.packager.config.electronLanguages;
  const locales = [].concat(requested || []);
  if (!locales.length) return;

  const appName = context.packager.appInfo.productFilename;
  const resourcesDir = path.join(
    context.appOutDir,
    `${appName}.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources`,
  );
  if (!fs.existsSync(resourcesDir)) return;

  const keep = new Set(locales.flatMap(keepNames));
  // base.lproj carries the fallback strings Chrome uses when a locale is absent.
  keep.add("base");

  let freed = 0;
  let removed = 0;
  for (const entry of fs.readdirSync(resourcesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".lproj")) continue;
    const name = entry.name.slice(0, -".lproj".length);
    if (keep.has(name)) continue;
    const dir = path.join(resourcesDir, entry.name);
    freed += dirSizeBytes(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    removed += 1;
  }

  const mb = (freed / 1024 / 1024).toFixed(1);
  console.log(`[afterPack] locales kept ${[...keep].join(", ")} — dropped ${removed} bundles, ${mb} MB freed`);
};
