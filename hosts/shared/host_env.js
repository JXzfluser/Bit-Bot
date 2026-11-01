"use strict";

/**
 * GP-185 — `.env.local` 的解析只有这一份。
 *
 * 这条逻辑原来有三个副本：桌面主进程（`parseEnvFile` / `loadEnvLocalFiles`）、
 * mobile_host（`loadEnvLocalFiles`）、入站 onTurn（`loadEnvLocal`）。三份的
 * 引号剥离、`#` 注释、`KEY=VALUE` 切分都一样，差别只在「跳过哪些键 / 打不打日志」。
 * 各写一份的代价不是今天的 bug，而是明天的漂移：某一端学会处理 `export KEY=…`
 * 或行尾注释时，另外两端不会跟着变，且没有任何单端口径的门会红。
 *
 * 这里只做纯解析 + 一个可配置的装载器；Electron / 手机 / 入站都复用它。
 * 不碰密钥策略：跳过什么键、是否覆盖 process.env，由调用方决定。
 */

const fs = require("fs");
const path = require("path");

/** 解析一个 .env 文件的 KEY=VALUE 行。文件不存在 → 空对象。 */
function parseEnvFile(file) {
  const out = {};
  if (!file || !fs.existsSync(file)) return out;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

/**
 * @param {string[]} files 按顺序尝试的文件
 * @param {object} [opts]
 * @param {boolean} [opts.overwrite] true 时文件值覆盖 process.env
 * @param {(key:string, value:string) => boolean} [opts.skip] 返回 true 的键不写入
 * @param {(file:string, map:object, applied:number) => void} [opts.onFile]
 * @param {(err:Error, file:string) => void} [opts.onError]
 * @returns {{loaded: {file:string, applied:number}[], errors: {file:string, message:string}[]}}
 */
function loadEnvFiles(files, opts = {}) {
  const { overwrite = false, skip, onFile, onError } = opts;
  const loaded = [];
  const errors = [];
  for (const file of files || []) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      const map = parseEnvFile(file);
      let applied = 0;
      for (const [k, v] of Object.entries(map)) {
        if (skip && skip(k, v)) continue;
        if (overwrite || process.env[k] === undefined) {
          process.env[k] = v;
          applied++;
        }
      }
      loaded.push({ file, applied });
      if (onFile) onFile(file, map, applied);
    } catch (err) {
      errors.push({ file, message: (err && err.message) || String(err) });
      if (onError) onError(err, file);
    }
  }
  return { loaded, errors };
}

/**
 * 历史布局的两个位置：`hosts/desktop/.env.local`、仓库根 `.env.local`。
 * 装机后 `.env.local` 在 userData —— 那是调用方的 extraFiles，不在这里猜。
 */
function loadEnvLocalFiles(opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot || path.join(__dirname, "..", ".."));
  const files = [
    path.join(repoRoot, "hosts/desktop/.env.local"),
    path.join(repoRoot, ".env.local"),
    ...(opts.extraFiles || []),
  ];
  return loadEnvFiles(files, opts);
}

module.exports = { parseEnvFile, loadEnvFiles, loadEnvLocalFiles };
