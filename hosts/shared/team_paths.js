/**
 * 团队目录名清洗（**唯一一份**）。
 *
 * 为什么单独成文件：
 *   这份实现在两边都要用 ——
 *     · hosts/shared/host_ffi.js（批次 10 的 prepareResearchMaterials 落材料目录）
 *     · hosts/desktop/room_orchestrator.js（交付契约路径解析）
 *   放在 host_ffi 里会让 desktop 层 require 它 ⇒ 若 host_ffi 间接依赖 desktop，
 *   就成循环依赖（module.exports 尚未赋值时拿到 undefined）。
 *   放独立文件 ⇒ 两边都 require 它，零循环、单一真相。
 */
function sanitizeTeamDir(title) {
  return String(title || "team").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 48) || "team";
}

module.exports = { sanitizeTeamDir };
