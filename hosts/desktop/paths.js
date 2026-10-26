"use strict";
/**
 * Bit Bot Desktop — path resolution.
 *
 * Three roots matter and they must not be conflated:
 *
 *   REPO_ROOT  — the MoonBit *code* tree (moon.mod + cmd/ + package dirs).
 *                `moon run cmd/desktop_turn` executes from here.
 *   DATA_ROOT  — where sessions/rooms/memory/routines live. This is user
 *                data, so in a packaged app it belongs under the OS
 *                user-data dir, NOT inside the app bundle (an asar is
 *                read-only, and an app bundle gets replaced on upgrade).
 *   KERNEL_BIN — the `moon` executable. Packaged apps ship their own copy
 *                instead of depending on a developer PATH.
 *
 * History / bug this file exists to fix:
 *   - `resolveRepoRoot()` used to probe for `moon.mod.json`, but MoonBit's
 *     module file is `moon.mod`. The probe could therefore never match, so
 *     the only working fallback was a hard-coded developer path
 *     (`/Users/zfl/Downloads/bitbot`) — a packaged build had no chance of
 *     finding its kernel. See hosts/desktop/main.js for the old inline
 *     version, which this module replaces.
 *   - data used to be written to `<repo>/data/...`, which means a packaged
 *     build wrote into its own bundle and lost everything on upgrade.
 */

const fs = require("fs");
const path = require("path");

/** MoonBit's module file is `moon.mod`. `moon.mod.json` is accepted too so a
 *  migrated/legacy checkout still resolves, but it is NOT what we ship. */
const MOON_MODULE_MARKERS = ["moon.mod", "moon.mod.json"];

/** A directory is a MoonBit project when it carries a module file, or the
 *  product entry point we actually shell out to. */
function looksLikeMoonProject(dir) {
  if (!dir) return false;
  try {
    for (const marker of MOON_MODULE_MARKERS) {
      if (fs.existsSync(path.join(dir, marker))) return true;
    }
    return fs.existsSync(path.join(dir, "cmd", "desktop_turn", "main.mbt"));
  } catch (_) {
    return false;
  }
}

/**
 * Resolve the MoonBit code root.
 *
 * Probe order (first match wins):
 *   1. $BITBOT_REPO_ROOT              — explicit override, always wins.
 *   2. opts.kernelRoot                — the kernel we staged into the app's
 *                                       resources (packaged builds).
 *   3. <dirname>/../..                 — dev layout: hosts/desktop -> repo.
 *   4. upward walk from <dirname>     — a checkout nested at any depth.
 *
 * Returns `null` when nothing matches. We do NOT guess: a wrong root makes
 * `moon` exit 255 with an unreadable "failed to resolve path cmd/desktop_turn"
 * and leaves the app writing data into the wrong place. A null lets the
 * caller report the actual problem.
 */
function resolveRepoRoot(opts = {}) {
  const env = opts.env || process.env;
  const startDir = opts.dirname || __dirname;
  const candidates = [];
  const push = (p) => {
    if (!p) return;
    try {
      candidates.push(path.resolve(p));
    } catch (_) { /* ignore unresolvable probe */ }
  };

  push(env.BITBOT_REPO_ROOT);
  push(opts.kernelRoot);
  push(path.resolve(startDir, "../.."));

  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const candidate of candidates) {
    if (looksLikeMoonProject(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve the data root.
 *
 * Packaged  -> <userData>/data   (survives upgrades, writable, OS-managed)
 * Dev       -> <repo>/data       (unchanged from the historical layout)
 */
function resolveDataRoot(opts = {}) {
  const repoRoot = opts.repoRoot || null;
  const userDataDir = opts.userDataDir || null;
  if (opts.packaged && userDataDir) return path.join(userDataDir, "data");
  if (repoRoot) return path.join(repoRoot, "data");
  if (userDataDir) return path.join(userDataDir, "data");
  return null;
}

/**
 * Locate the `moon` executable.
 *
 * Packaged builds ship one under <resources>/kernel/bin. Dev builds use
 * whatever is on PATH. The returned value is meant to be exported as
 * MOON_BIN so hosts/shared/run_moon_turn.js picks it up.
 */
function resolveMoonBin(opts = {}) {
  const env = opts.env || process.env;
  if (env.MOON_BIN && fs.existsSync(env.MOON_BIN)) return env.MOON_BIN;

  const roots = [];
  if (opts.resourcesPath) roots.push(opts.resourcesPath);
  if (opts.kernelRoot) roots.push(path.join(opts.kernelRoot, ".."));
  for (const root of roots) {
    for (const rel of [
      path.join("kernel", "bin", "moon"),
      path.join("kernel", "bin", "moon.exe"),
      path.join("bin", "moon"),
      path.join("bin", "moon.exe"),
    ]) {
      const candidate = path.join(root, rel);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch (_) { /* ignore */ }
    }
  }
  return null;
}

/**
 * Locate the compiled kernel binary shipped inside the app bundle.
 *
 * `moon build --target native` produces a self-contained executable that
 * speaks the same argv tail and the same BITBOT_FFI line protocol as
 * `moon run cmd/desktop_turn --target native -- ...`, so a packaged app no
 * longer needs a MoonBit toolchain (or the kernel source tree) on the
 * target machine.
 *
 * Returns null when no bundled binary exists -> the host falls back to
 * `moon run` against a source checkout.
 */
function resolveKernelBin(opts = {}) {
  const env = opts.env || process.env;
  if (env.BITBOT_KERNEL_BIN && fs.existsSync(env.BITBOT_KERNEL_BIN)) {
    return env.BITBOT_KERNEL_BIN;
  }
  const roots = [];
  if (opts.resourcesPath) roots.push(opts.resourcesPath);
  if (opts.kernelRoot) roots.push(path.join(opts.kernelRoot, ".."));
  for (const root of roots) {
    for (const rel of [
      path.join("kernel", "bin", "desktop_turn"),
      path.join("kernel", "bin", "desktop_turn.exe"),
      path.join("bin", "desktop_turn"),
      path.join("bin", "desktop_turn.exe"),
    ]) {
      const candidate = path.join(root, rel);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch (_) { /* ignore */ }
    }
  }
  return null;
}

/**
 * Human-readable reason why the kernel could not be located. Shown in the UI
 * and logged, instead of letting `moon` fail with exit 255.
 */
function describeMissingKernel(opts = {}) {
  const env = opts.env || process.env;
  if (env.BITBOT_REPO_ROOT) {
    return `BITBOT_REPO_ROOT=${env.BITBOT_REPO_ROOT} does not look like a MoonBit project ` +
      `(expected moon.mod or cmd/desktop_turn/main.mbt).`;
  }
  return "MoonBit kernel not found. Set BITBOT_REPO_ROOT to a MoonBit checkout, " +
    "or install a build that ships the kernel in its resources.";
}

module.exports = {
  MOON_MODULE_MARKERS,
  looksLikeMoonProject,
  resolveRepoRoot,
  resolveDataRoot,
  resolveMoonBin,
  resolveKernelBin,
  describeMissingKernel,
};
