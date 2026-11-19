/*
 * probe_parity_ruler_cost.mjs — 把 §8.162 边界④那条「尺一次读全量事件，大日志成本未量」量成数字。
 *
 * 这是取数工具，不是门禁（无 PASS/FAIL）：它只回答「1000 / 2000 / 4000 条事件时，
 * auditSurfaces 一次要多久，时间花在哪一段」。
 *
 * 事件由**真产品写口**产生（`createSessionStore().create()`），不是手搓夹具 —— 手搓事件
 * 曾在 §8.161 把 reducer 打死过，且折出来的面不真实，量出的成本也不算数。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");
process.env.BITBOT_EVENT_DUAL_WRITE = "1";

const { createSessionStore } = require(path.join(repoRoot, "hosts/desktop/sessions.js"));
const parity = require(path.join(repoRoot, "hosts/shared/surface_parity.js"));
const { foldEvents } = require(path.join(repoRoot, "hosts/shared/event_mirror.js"));
const { openEventLog } = require(path.join(repoRoot, "hosts/shared/event_log.js"));
const { dbFilePath } = require(path.join(repoRoot, "hosts/shared/event_read_model.js"));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-ruler-cost-"));
const store = createSessionStore(repoRoot, { dataRoot: root });
const db = dbFilePath(root);

const ms = (fn) => {
  const t = process.hrtime.bigint();
  const v = fn();
  return [Number(process.hrtime.bigint() - t) / 1e6, v];
};

/** 把一次 auditSurfaces 拆成四段分别计时：读日志 / 折叠 / 读旁路 JSON / 逐实体比较。 */
function breakdown() {
  const handle = openEventLog({ file: db, actor: "cost-probe" });
  const [readMs, rows] = ms(() => handle.readAfter({ fromSeq: 0, limit: 100000 }));
  handle.close();
  const [foldMs, folded] = ms(() => foldEvents(rows));
  const [jsonMs, jsonSides] = ms(() =>
    parity.SURFACES.map((def) => {
      const p = path.join(root, def.file);
      try {
        return fs.readFileSync(p, "utf8");
      } catch (_e) {
        return "";
      }
    }),
  );
  const [auditMs] = ms(() => parity.auditSurfaces({ dataRoot: root }));
  return { events: rows.length, readMs, foldMs, jsonMs, auditMs, jsonBytes: jsonSides.reduce((n, s) => n + s.length, 0), foldKeys: Object.keys(folded.sessions || {}).length };
}

console.log(`dataRoot=${root}`);
console.log("每次 create 派 3 条事件（created/order/activated，见 §8.155），故事件数≈3×会话数。");

const checkpoints = (process.argv[2] || "200,500,1000,2000").split(",").map(Number);
let created = 0;
const table = [];
for (const target of checkpoints) {
  const [buildMs] = ms(() => {
    for (let i = created; i < target; i += 1) store.create(`成本探针 会话 ${i}`);
    created = target;
  });
  const b = breakdown();
  table.push({ sessions: target, buildMs, ...b });
  console.log(
    `会话 ${String(target).padStart(4)} / 事件 ${String(b.events).padStart(5)} | ` +
      `readAfter ${b.readMs.toFixed(1)}ms | fold ${b.foldMs.toFixed(1)}ms | ` +
      `旁路JSON读 ${b.jsonMs.toFixed(1)}ms(${b.jsonBytes} B) | ` +
      `auditSurfaces 整次 ${b.auditMs.toFixed(1)}ms | 造数据 ${buildMs.toFixed(0)}ms`,
  );
}

/* 形状用 log-log 斜率报，不用线性外推：首尾两点算 (ms 比) / (事件比) 的指数。
   上一版这里印的是「每千条事件 ≈ X ms」的线性斜率，而同一次跑的数据自己就是超线性的
   （事件×2 → 时间×6.5），拿线性斜率去外推 10 万条等于用错模型读数 —— 已作废，改成报指数。*/
const shape = (t) => {
  const k = t.findIndex((x) => x.events > 0);
  if (k < 0 || t.length < 2) return null;
  const a = t[k];
  const z = t[t.length - 1];
  if (a.events === z.events) return null;
  return Math.log(z.auditMs / a.auditMs) / Math.log(z.events / a.events);
};
const expo = shape(table);
console.log(
  `形状（log-log 斜率，用本表首尾两点）：auditSurfaces ≈ 事件数^${expo === null ? "NaN" : expo.toFixed(2)}` +
    `（1.0=线性，2.0=平方）。线性外推在超线性数据上不成立，所以这里不报「每千条多少毫秒」。`,
);

/* 产品热路径：`event_read_model.readSurfaces` 带 lastSeq 缓存，量三态 ——
   冷读（全量折）/ 命中缓存（不折但要深拷贝整份状态交给 read-modify-write 调用方）/
   写一次之后再读（缓存必然失效）。第三态就是用户每点一次要付的钱。 */
const readModel = require(path.join(repoRoot, "hosts/shared/event_read_model.js"));
process.env.BITBOT_EVENT_READ = "1";
const [coldMs, cold] = ms(() => readModel.readSurfaces(root, { env: process.env }));
const [hitMs, hit] = ms(() => readModel.readSurfaces(root, { env: process.env }));
store.create("热路径探针 触发一次写");
const [postMs, post] = ms(() => readModel.readSurfaces(root, { env: process.env }));
console.log(
  `产品读热路径（readSurfaces，会话 ${created} / 事件 ${breakdown().events}）：` +
    `冷读 ${coldMs.toFixed(1)}ms(ok=${cold.ok}) | 缓存命中 ${hitMs.toFixed(1)}ms(cached=${hit.cached}) | ` +
    `写后再读 ${postMs.toFixed(1)}ms(cached=${post.cached})`,
);
const [cloneMs] = ms(() => JSON.parse(JSON.stringify(post.sessions)));
console.log(
  `   命中路径花在哪，当场量：整份 sessions 深拷贝实测 ${cloneMs.toFixed(1)}ms，` +
    `对上缓存命中那 ${hitMs.toFixed(1)}ms —— 差额 ${Math.max(0, hitMs - cloneMs).toFixed(1)}ms 才是别的开销。` +
    `写后那 ${postMs.toFixed(1)}ms 含全量重折（#82 要治的就是这一格）。`,
);
readModel.closeAll();

const again = breakdown();
console.log(`同一库连跑第二次：auditSurfaces ${again.auditMs.toFixed(1)}ms（事件 ${again.events}）—— 尺每次调用都重新开库+全量读，没有复用句柄。`);
fs.rmSync(root, { recursive: true, force: true });
