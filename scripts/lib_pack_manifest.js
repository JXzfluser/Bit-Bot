/* lib_pack_manifest.js — 只有一份「electron-builder 清单怎么读」的实现。
 *
 * 背景：build.files 以前是扁平字符串数组，门禁就写 `files.includes("x.js")`。
 * 2026-10-29 打包布局改成「包内镜像 hosts/ 树」后，桌面模块挪进了
 * {from:".", to:"desktop", filter:[…]}，于是两道门（GP-93、M21）同时读成了
 * 「没打包」——清单形状一变，各自解读的门禁就一起说谎。这里把解读收在一处：
 * 门禁问的是「这个文件进包了吗、在包里的哪条路径」，不是「清单怎么写」。
 */
"use strict";

/** 把 build.files 归一成 [{to, patterns}]。
 * 顶层字符串由 electron-builder 的 defaultMatcher 处理：from = appDir，
 * to = asar 根，所以它的 to 记成空串。 */
function normalizedEntries(files) {
  const sets = [];
  for (const entry of files || []) {
    if (typeof entry === "string") sets.push({ to: "", patterns: [entry] });
    else if (entry && typeof entry === "object")
      sets.push({ to: entry.to || "", patterns: entry.filter || [] });
  }
  return sets;
}

/** name 打进包后的 asar 内路径；未显式包含则返回 null。
 * glob（vendor/**\/*）与取反（!**\/*.map）不算显式包含单个文件，不猜。 */
function asarPathOf(files, name) {
  for (const { to, patterns } of normalizedEntries(files)) {
    if (patterns.includes(name)) return to ? `${to}/${name}` : name;
  }
  return null;
}

/** 声明了某个包内目录（如 "shared"）的条目；用来断言「整目录随包发布」。 */
function fileSetFor(files, to) {
  return normalizedEntries(files).find((s) => s.to === to) || null;
}

module.exports = { normalizedEntries, asarPathOf, fileSetFor };
