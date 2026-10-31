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

/* T1-04 读切换的加载走同一个手法：event_read_model 也在 shared/，直接相对
   require 会在打包态打到包外。它内部对 event_log/event_mirror 的 require
   不需要这条防御——它们和它一起待在 shared/ 里，相对关系在两种布局下都成立。 */
function loadEventReadModel() {
  try {
    return require("../shared/event_read_model");
  } catch (_devMiss) {
    return require("./shared/event_read_model");
  }
}

module.exports = { loadEventMirror, loadEventReadModel };
