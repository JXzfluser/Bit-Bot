/*
 * probe_read_model_row_cap.mjs — 取证：读模型的「一次最多读 limit 行」把截断当成了完整。
 *
 * 要量的问题只有一个：`readSurfaces` 用 `readAfter({fromSeq, limit})` 取行，取满 limit
 * 之后**没有任何地方问「后面还有没有」**。如果日志比 limit 长，折叠出来的是「前 limit 行的
 * 效果」，却被当成「这张面的当前状态」返回 `ok:true`，还按真实 lastSeq 进缓存。
 * 这条不是理论：docs/events.md §3 说日志只追加、从不删行，而 A1-2 把回合流（progress 等）
 * 写进同一份库 —— 行数由对话量决定，不由会话数决定。
 *
 * 探针只做确定性形状（不赌时长）：
 *   P1 建 12 条会话 + 删掉其中 1 条（共 13 行），limit=5 读一次。
 *      如果读模型老实，必须 ok:false（读不全就不许宣布状态）；
 *      如果它把截断当完整，会 ok:true 且 12 条只剩 ≤5、被删的那条还在（= 复活）。
 *   P2 同一个 file 再放开 limit 读一次：缓存若已被截断状态污染（按真 lastSeq 命中），
 *      这一次会直接 cached:true，永远不再看盘 —— 这是「一次截断、永久失真」的那一步。
 *   P3 对照：全新进程槽位（closeAll）+ 不限行 → 应当 12 条且删除生效。
 *
 * 只读临时 dataRoot，不碰仓库 data/。测量工具，不是门（门在 prove_event_read_model.mjs）。
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { openEventLog } = require("../hosts/shared/event_log");
const readModel = require("../hosts/shared/event_read_model");

const env = { BITBOT_EVENT_READ: "1" };
const root = fs.mkdtempSync(path.join(os.tmpdir(), "rm-cap-"));
const file = path.join(root, "events", "desktop-events.sqlite");
fs.mkdirSync(path.dirname(file), { recursive: true });

const TOTAL = 12;
const DELETED = "sess-del0000001";
const h = openEventLog({ file, actor: "probe-cap" });
for (let i = 0; i < TOTAL; i++) {
  const id = i === 0 ? DELETED : `sess-${String(i).padStart(10, "0")}`;
  h.append({ sessionId: "system", kind: "session_created", payload: { surface: "sessions", session: { id, title: `会话 ${i}` } } });
  h.append({ sessionId: "system", kind: "entity_state_changed", payload: { surface: "sessions", entity_id: id, fields: { updated_at: i } } });
}
h.append({ sessionId: "system", kind: "entity_removed", payload: { surface: "sessions", entity_id: DELETED } });
const lastSeq = h.lastSeq();
h.close();
const rowsInDb = TOTAL * 2 + 1;

function titles(list) {
  return (list?.sessions?.sessions || []).map((s) => s.id).sort();
}

console.log(`库里事件行数=${rowsInDb}，会话 ${TOTAL} 条（其中 ${DELETED} 已被 entity_removed 删掉），lastSeq=${lastSeq}`);

readModel.closeAll();
const capped = readModel.readSurfaces(root, { env, file, limit: 5 });
console.log(`\n[P1] limit=5 → ok=${capped.ok} reason=${capped.reason ?? "-"} count=${capped.count ?? "-"} lastSeq=${capped.lastSeq ?? "-"} 面里会话数=${capped.ok ? capped.sessions.sessions.length : "-"}`);
if (capped.ok) {
  const ids = titles(capped);
  console.log(`     被删的那条还在吗：${ids.includes(DELETED) ? "在（= 删除事件落在 limit 之外，复活了）" : "不在"}`);
  console.log(`     丢了多少条会话：${TOTAL - 1 - ids.length}`);
}

const after = readModel.readSurfaces(root, { env, file });
console.log(`\n[P2] 同进程放开 limit 再读 → ok=${after.ok} cached=${after.cached === true} foldPath=${after.foldPath ?? "-"} count=${after.count ?? "-"} 面里会话数=${after.ok ? after.sessions.sessions.length : "-"}`);
if (after.ok) {
  console.log(`     被删的那条还在吗：${titles(after).includes(DELETED) ? "在（截断状态已被缓存钉住）" : "不在"}`);
}

readModel.closeAll();
const full = readModel.readSurfaces(root, { env, file });
console.log(`\n[P3] 清缓存 + 不限行 → ok=${full.ok} count=${full.count ?? "-"} 面里会话数=${full.ok ? full.sessions.sessions.length : "-"} 被删还在=${full.ok ? titles(full).includes(DELETED) : "-"}`);

const honest = capped.ok === false;
console.log(`\n读数结论：limit 截断时读模型${honest ? `拒绝宣布状态（reason=${capped.reason}）——已是诚实口径` : "把前 5 行当成整份日志（ok:true）——「读不全」被翻译成了「状态就是这样」"}。`);
fs.rmSync(root, { recursive: true, force: true });
