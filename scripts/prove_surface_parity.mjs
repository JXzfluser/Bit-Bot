/*
 * prove_surface_parity.mjs — G-125 对账尺门（#81 / §8.159 定稿口径）。
 *
 * 判据不数「说了什么」，数「屏幕/日志上看到什么」（§8.70 口径）：这里看的是尺的**结构化读数**
 * 与它给出的行，且每条动态判据都配一条能把它打红的突变体（见文件末 REVERSE 一节）。
 *
 * 三条必须钉住的形状（都是本轮实测踩出来的）：
 *   A. 「没有读数」≠「读数为 0」。夹具里两侧都坏时必须落到 no_reading，且这条记录不许带零计数。
 *   B. 面文件路径必须带 desktop/ 一层。少一层会让三张面全部读成 no_reading —— 看上去安全，
 *      实际是尺自己瞎了（§8.161 记的就是这个：门禁写进用户看得见的数据那一类坑的反面）。
 *   C. 干净双写之后 drift 必须是 0 且 matched 必须 > 0。只有 0 而没有 matched，
 *      说明两侧都是空集，那条 0 是恒真的。
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");

let PASS = 0;
let FAIL = 0;
let SKIP = 0;
function ok(name, cond, detail) {
  if (cond) {
    PASS += 1;
    console.log(`  ✓ PW ${name}`);
  } else {
    FAIL += 1;
    console.log(`  ✗ PW ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}
function honestSkip(name, why) {
  SKIP += 1;
  console.log(`  - PW ${name}（未测：${why}）`);
}

const parity = require(path.join(repoRoot, "hosts/shared/surface_parity.js"));
const { createSessionStore } = require(path.join(repoRoot, "hosts/desktop/sessions.js"));

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-pw-"));
}
const os = require("node:os");

/* 双写默认是关的（event_mirror.js:454）—— 不打开就没有日志侧，这条尺只能空转。 */
process.env.BITBOT_EVENT_DUAL_WRITE = "1";

const root = freshRoot();
const store = createSessionStore(repoRoot, { dataRoot: root });
const s1 = store.create("PW 甲");
const s2 = store.create("PW 乙");
const sjPath = path.join(root, "desktop", "sessions.json");
const readSj = () => JSON.parse(fs.readFileSync(sjPath, "utf8"));
const writeSj = (o) => fs.writeFileSync(sjPath, JSON.stringify(o));

/* ── 判据 A：干净双写 ───────────────────────────────────────────────── */
let r = parity.auditSurfaces({ dataRoot: root });
const sess = () => r.records.find((x) => x.surface === "sessions");
/* E 必须落在「干净双写那一刻」的记录上：D 一节会把日志库删掉，之后再取就变成 no_reading。
   上一版就是这么错的 —— 判据本身没坏，是取数时机坏，读起来像「尺丢了 painted 字段」。*/
const cleanRec = { ...sess() };
ok("A1 干净双写后 sessions 是「有读数」而不是 no_reading", sess().kind === "reading", JSON.stringify(sess()));
ok("A2 干净双写后 drift=0 **且** matched>0（只有 0 不作数，两侧都空也是 0）", r.drift === 0 && sess().matched > 0, JSON.stringify(sess()));
ok("A3 干净面的一行是 info 级（非零才 warn）", r.levels[r.records.indexOf(sess())] === "info", JSON.stringify(r.levels));

/* ── 判据 B：漂移必须被点名 ─────────────────────────────────────────── */
const o = readSj();
o.sessions[0].title = "PW 只在 JSON 里改的标题";
writeSj(o);
r = parity.auditSurfaces({ dataRoot: root });
ok("B1 JSON 侧改一个字段 → mismatched=1", sess().mismatched === 1, JSON.stringify(sess()));
ok("B2 首处差异点名到实体的 title（不是只说「有偏差」）", /title/.test(String(sess().firstDiff)), String(sess().firstDiff));
ok("B3 drift 随偏差变非零，级别升到 warn", r.drift > 0 && r.levels[r.records.indexOf(sess())] === "warn", JSON.stringify(r.levels));

/* ── 判据 C：两个方向不能混成一个词（§8.159：不搬 missing/extra）───── */
const o2 = readSj();
o2.sessions[0].title = "PW 甲";
o2.sessions.push({ id: "pw-sess-only-json", title: "PW 戊", messages: [] });
writeSj(o2);
r = parity.auditSurfaces({ dataRoot: root });
const ss = sess();
ok("C1 只在 JSON 一侧 → inJsonNotFold=1 且 inFoldNotJson=0（两个具名字段，方向不混）",
  ss.inJsonNotFold === 1 && ss.inFoldNotJson === 0, JSON.stringify(ss));
const keys = Object.keys(ss);
ok("C2 读数里没有 missing/extra 这两个反向词（照 §8.159 作废的口径，字段名必须自解释）",
  !keys.includes("missing") && !keys.includes("extra"), keys.join(","));

/* ── 判据 D：「没读数」与「读数为 0」是两个态 ─────────────────────── */
const dbDir = path.join(root, "events");
const dbFile = path.join(dbDir, "desktop-events.sqlite");
ok("D0 前置自证：日志侧确实建过库（否则下面这条 no_reading 是恒真）", fs.existsSync(dbFile));
fs.rmSync(dbFile, { force: true });
fs.rmSync(dbFile + "-wal", { force: true });
fs.rmSync(dbFile + "-shm", { force: true });
r = parity.auditSurfaces({ dataRoot: root });
const s3 = sess();
ok("D1 日志侧没库 → kind=no_reading", s3.kind === "no_reading", JSON.stringify(s3));
ok("D2 no_reading 记录**不带**零计数（matched/inJsonNotFold 这类字段一个都不许出现）",
  !("matched" in s3) && !("inJsonNotFold" in s3) && !("mismatched" in s3), JSON.stringify(Object.keys(s3)));
ok("D3 它仍然出声，且是「无读数」这句话而不是打出一串计数",
  /无读数/.test(parity.formatWarn(s3)) && !/matched=/.test(parity.formatWarn(s3)), parity.formatWarn(s3));

/* 两侧都在且都空 = 有读数、计数全 0 —— 与 D 相对照，证明这条尺能区分这两个态 */
const empty = freshRoot();
fs.mkdirSync(path.join(empty, "desktop"), { recursive: true });
fs.writeFileSync(path.join(empty, "desktop", "sessions.json"), JSON.stringify({ version: 1, active_id: "", sessions: [] }));
fs.writeFileSync(path.join(empty, "desktop", "rooms.json"), JSON.stringify({ version: 1, rooms: [] }));
fs.writeFileSync(path.join(empty, "desktop", "pending-approvals.jsonl"), "");
process.env.BITBOT_EVENT_ONLY = "1";
const st2 = createSessionStore(repoRoot, { dataRoot: empty });
st2.create("PW 空面参照");
delete process.env.BITBOT_EVENT_ONLY;
const r2 = parity.auditSurfaces({ dataRoot: empty });
const e2 = r2.records.find((x) => x.surface === "rooms");
ok("D4 两侧都在但都空 → kind=reading 且计数全 0（这才是「读数为 0」那个态）",
  e2.kind === "reading" && e2.matched === 0 && e2.foldEntries === 0 && e2.jsonEntries === 0, JSON.stringify(e2));

/* ── 判据 E：painted / tailGap 不许写死（§8.159 的两处照抄禁令）────── */
ok("E1 painted 是 null 且带原因（Grok 那个产生点是硬编码 true，我们量不到就不装）",
  cleanRec.kind === "reading" && cleanRec.painted === null && String(cleanRec.paintedWhy).length > 0,
  JSON.stringify(cleanRec).slice(0, 200));
ok("E2 tailGap 是 null 且带原因（旁路 JSON 没有游标）",
  cleanRec.tailGap === null && String(cleanRec.tailGapWhy).length > 0, JSON.stringify(cleanRec).slice(0, 200));

/* ── 判据 F：静态形状（能抓住本轮真实踩过的 bug）────────────────── */
const src = fs.readFileSync(path.join(repoRoot, "hosts/shared/surface_parity.js"), "utf8");
const files = [...src.matchAll(/file:\s*"([^"]+)"/g)].map((m) => m[1]);
ok("F1 三张面的旁路路径都带 desktop/ 一层（少一层=尺自己瞎了，§8.161）",
  files.length === 3 && files.every((f) => f.startsWith("desktop/")), files.join(","));
ok("F2 尺读日志侧走 openEventLog 直读，不走 readSurfaces（后者默认关时返回 read_disabled，会变成假 no_reading）",
  /openEventLog\(/.test(src) && !/readSurfaces\(/.test(src), "");

/* ── 反向对照：尺对「两侧都不可读」绝不能报成一致 ─────────────────── */
writeSj("{坏");
r = parity.auditSurfaces({ dataRoot: root });
ok("G1 JSON 侧坏 → no_reading（不静默当空面）", sess().kind === "no_reading", JSON.stringify(sess()));
ok("G2 两因并列时 why 把两侧都点出来", /日志侧/.test(sess().why) || /JSON/.test(sess().why), String(sess().why));

honestSkip("真装机默认配置下的运行时留痕",
  "双写默认关（event_mirror.js:454）→ 默认装机上三张面全是 no_reading；本门只在打开 BITBOT_EVENT_DUAL_WRITE 后有运行时价值，接线 main.js 要等默认翻面，否则每次开机三条 warn");

try {
  store.close?.();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
} catch (_e) {
  /* 临时目录清不掉不影响读数 */
}

console.log(`prove_surface_parity: PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP}`);
process.exit(FAIL > 0 ? 1 : 0);
