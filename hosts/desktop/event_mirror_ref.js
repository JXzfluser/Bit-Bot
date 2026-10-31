/* event_mirror_ref.js — 找到 event_mirror，两种布局都要找得到。

 * 为什么不是直接 require("../shared/event_mirror")：Box 的包是**平铺**的
 * （hosts/desktop/product_surface.js → <包>/product_surface.js，shared/ 在它旁边），
 * 那句在仓库里对、在包里就指到包外面去了。T1-03 接线第一天就是这样把整台 Box 的
 * product surface 打成 null 的（手机拉待批只拿到 503 approval_queue_unavailable，
 * 见 product_surface_ref.js 那个 catch）。
 *
 * 同一个手法在 host_ffi.js:26-30、product_surface_ref.js:23-33 已经用了很久：
 * 开发态一条、打包态一条，都不在 try/catch 外面留裸的相对路径。
 */
"use strict";

function loadEventMirror() {
  try {
    return require("../shared/event_mirror");
  } catch (_devMiss) {
    return require("./shared/event_mirror");
  }
}

module.exports = { loadEventMirror };
