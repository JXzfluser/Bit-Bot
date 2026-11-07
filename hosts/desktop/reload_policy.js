"use strict";

const fs = require("fs");
const path = require("path");

/**
 * ⌘R 到底该「重载界面」还是「重启进程」？
 *
 * 界面（index.html）是启动那一刻读进内存的，`reload` 就够。但 `product_surface.js`
 * 这类**主进程模块**是 `require` 进来的，缓存跟着进程走 —— 只有重启才会重新读盘。
 *
 * 用户已经踩过一次：改完群编排，他按 ⌘R 重载，界面文案确实变了（新的），可实际行为
 * 还是旧的（全员开路 + 群综合），于是又问「为什么还是这样」。那不是产品没改，是
 * 他重载的只有一半。所以这里把判断做在菜单里：代码变了就整进程重启，没变才只是重载。
 *
 * 只看 `.js`：`.html` 变了重载就够，不该为了改样式把进程重启一遍。
 */
function codeStamp(dirs) {
  let newest = 0;
  for (const dir of dirs || []) {
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const f of files) {
      if (!/\.js$/.test(f)) continue;
      try {
        newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs);
      } catch (_) {
        /* 读不到就跳过：一个文件的时间戳不能挡住重载 */
      }
    }
  }
  return newest;
}

/**
 * bootStamp 是进程启动那一刻的 codeStamp()。现在的时间戳比它新 = 磁盘上的代码
 * 已经不是这个进程在跑的那份。
 */
function reloadDecision(bootStamp, dirs) {
  const boot = Number(bootStamp || 0);
  const now = codeStamp(dirs);
  return {
    action: now > boot ? "restart" : "reload",
    boot,
    now,
  };
}

module.exports = { codeStamp, reloadDecision };
