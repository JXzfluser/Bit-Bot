/* import_json_to_events.mjs — T1-05 导入：把遗留的 JSON 三张面带进事件库（幂等）
 *
 * 用法：
 *   node scripts/import_json_to_events.mjs [--dataRoot <dir>] [--dry]
 *   缺省 dataRoot = <repo>/data
 *
 * 机制（docs/events.md §8 的导入清单）：
 *   - 对每个存在的面文件（sessions.json / rooms.json / pending-approvals.jsonl），
 *     diffSurface(def, null, 文件文本) 从 BASELINE 起算出导入事件——
 *     「prevText=null = 从空折叠」与 EVENT_ONLY 的播种共用同一语义。
 *   - 幂等：每条导入事件带 idem_key = json-import:<basename>:<sha1(文件全文)>:<序号>。
 *     同一份文件重跑 → 键全部撞唯一索引 → 读回原 seq、0 新增。
 *     文件后来变过 → 哈希变了 → 新键 → 作为增量补进（不删除旧账）。
 *   - dry 模式只报告会导入多少条，不落库。
 *
 * 这就是「停写 JSON」的登机梯：先跑本脚本，再开 BITBOT_EVENT_ONLY=1。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const dataRoot = path.resolve(argOf("--dataRoot") || path.join(ROOT, "data"));
const dry = args.includes("--dry");

const eventMirror = require("../hosts/shared/event_mirror.js");
const { openEventLog } = require("../hosts/shared/event_log.js");

const SURFACES = [
  { basename: "sessions.json", rel: "desktop/sessions.json", pick: (folded) => folded.sessions },
  { basename: "rooms.json", rel: "desktop/rooms.json", pick: (folded) => folded.rooms },
  { basename: "pending-approvals.jsonl", rel: "desktop/pending-approvals.jsonl", pick: (folded) => folded.approvals },
];

const dbFile = path.join(dataRoot, "events", "desktop-events.sqlite");
if (!fs.existsSync(dbFile)) {
  console.error(`import_json_to_events: 事件库不存在（${path.relative(ROOT, dbFile)}）。`);
  console.error("EVENT_ONLY 需要先有库；导入脚本不建库——开一次双写（BITBOT_EVENT_DUAL_WRITE=1）或先建库再导入。");
  process.exit(2);
}

const log = openEventLog({ file: dbFile, actor: "json-import", busyTimeoutMs: 5000 });
let totalNew = 0;
let totalDup = 0;

for (const s of SURFACES) {
  const file = path.join(dataRoot, s.rel);
  if (!fs.existsSync(file)) {
    console.log(`· ${s.basename}: 不存在，跳过`);
    continue;
  }
  const text = fs.readFileSync(file, "utf8");
  const def = eventMirror.surfaceOf(s.basename);
  if (!def) {
    console.error(`· ${s.basename}: 不在镜像面里（SURFACE_BY_BASENAME 变了？）`);
    continue;
  }
  const { events, problems } = eventMirror.diffSurface(def, null, text);
  if (problems.length) {
    console.error(`· ${s.basename}: ${problems.length} 处变化没人认领（导入中止这一面）：${problems[0]}`);
    continue;
  }
  const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
  let added = 0;
  let dup = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (dry) {
      added++;
      continue;
    }
    const res = log.append({
      sessionId: e.sessionId,
      kind: e.kind,
      payload: e.payload,
      idemKey: `json-import:${s.basename}:${hash}:${i}`,
    });
    if (res.duplicated) dup++;
    else added++;
  }
  totalNew += added;
  totalDup += dup;
  console.log(`· ${s.basename}: ${events.length} 条事件 → 新增 ${added}，重复 ${dup}${dry ? "（dry）" : ""}`);
}

log.close();
console.log(`\nimport_json_to_events: 新增 ${totalNew}，重复 ${totalDup}${dry ? "（dry run，未落库）" : ""} @ ${path.relative(ROOT, dbFile)}`);
process.exit(0);
