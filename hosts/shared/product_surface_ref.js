"use strict";

/**
 * The product surface — located the same way the Host FFI locates it.
 *
 * 开发态:hosts/shared/ → ../desktop/product_surface
 * 另一种开发布局:../../hosts/desktop/product_surface
 * 打包态(平铺):shared/ → ../product_surface
 *
 * 为什么不直接在 host_ffi.js 里再抄一份:三路查找已经在那里了。
 * 这里单开一个模块,是为了**入站服务**(cn_inbound_server.js)也能拿到 surface
 * —— 跨端审批队列就住在 surface 里(pending-approvals.jsonl)。
 */

let _cached = null;
let _looked = false;

function createProductSurfaceRef(repoRoot, dataRoot) {
  if (_looked) return _cached;
  _looked = true;
  const mod = (() => {
    try {
      return require("../desktop/product_surface");
    } catch {
      try {
        return require("../../hosts/desktop/product_surface");
      } catch {
        try {
          return require("../product_surface");
        } catch {
          return null;
        }
      }
    }
  })();
  if (!mod || typeof mod.createProductSurface !== "function") {
    _cached = null;
    return null;
  }
  try {
    _cached = mod.createProductSurface(repoRoot, dataRoot ? { dataRoot } : undefined);
  } catch (_) {
    _cached = null;
  }
  return _cached;
}

module.exports = { createProductSurfaceRef };
