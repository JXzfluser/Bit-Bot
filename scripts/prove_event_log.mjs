/* prove_event_log.mjs — T1-02 事件日志适配器门禁
 *
 * 需求（docs/next-target-requirements.md T1-02）的完成定义是「可建库/开库/迁移；
 * 零原生依赖；Node 上跑通」。这句话里有三个可以断死的点，逐条断：
 *
 *   EL-01 建库 + 迁移：新文件打开后 meta / migrations 真的有行
 *   EL-02 WAL 真的生效（不是被文件系统悄悄退化掉）
 *   EL-03 seq 由库分配、全局严格递增，会话内可查最后游标
 *   EL-04 同 idem_key 重复投递只落一行（AC-T1-2 的那「重复投递 = 0」）
 *   EL-05 delta 被适配器拒绝落库（在途缓冲不是状态）
 *   EL-06 任意 seq 续订：只回 > from 的、按序、会话内稠密（T1-09 的地基）
 *   EL-07 重开不丢 + kill -9 不丢已提交事务（AC-T1-2 的后半句）
 *   EL-08 seq 不复用：删掉最大行后，下一条不会回收那个号
 *   EL-09 库版本比代码新 → 拒绝打开并说清原因（不变量 I7）
 *   EL-10 零原生依赖：模块只 require node 内置件（没有 .node，就不必为
 *          每个平台预编译 + 签名，打包门禁 PA-* 才有意义）
 *
 * 跑在哪个 Node 上会打印在开头：同一份代码在 22 与 25 上都要绿，
 * 因为开发机、CI runner 和用户机的 Node 不是同一个。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
const ok = (id, msg) => { console.log(`ok ${id} — ${msg}`); pass += 1; };
const bad = (id, msg) => { console.log(`FAIL ${id} — ${msg}`); fail += 1; };

console.log(`== 运行时 == node ${process.version} @ ${process.execPath}`);

const { LOG_VERSION, openEventLog } = require("../hosts/shared/event_log.js");
const { DatabaseSync } = require("node:sqlite");
/** 绕过适配器直接看库（验证「库自己是什么样」时，不能让被测代码替它说话）。 */
const raw = (file, run) => {
  const d = new DatabaseSync(file);
  try {
    return run(d);
  } finally {
    d.close();
  }
};
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-eventlog-"));
const DB = path.join(stage, "log", "events.db");

function expectThrow(fn, pattern, id) {
  try {
    fn();
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (!pattern.test(msg)) { bad(id, `抛错了但原因不对：${msg}`); return null; }
    return msg;
  }
  bad(id, "本该抛错，却没有");
  return null;
}

try {
  /* ---- EL-01 建库 + 迁移 ---- */
  let log = openEventLog({ file: DB, actor: "machine-test" });
  const metaRows = raw(DB, (d) => d.prepare("SELECT key, value FROM meta ORDER BY key").all());
  const mig = raw(DB, (d) => d.prepare("SELECT id, name FROM migrations ORDER BY id").all());
  const tables = raw(DB, (d) => d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name));
  if (metaRows.some((r) => r.key === "log_version" && r.value === String(LOG_VERSION)) &&
      mig.length === 1 && mig[0].name === "init_v1" &&
      ["events", "effects", "meta", "migrations"].every((t) => tables.includes(t))) {
    ok("EL-01", `建库 + 迁移完成：log_version=${LOG_VERSION}，migrations=${mig.map((m) => m.name).join(",")}，表 ${tables.join("/")}`);
  } else {
    bad("EL-01", `库结构不对：meta=${JSON.stringify(metaRows)} migrations=${JSON.stringify(mig)} tables=${tables.join(",")}`);
  }

  /* ---- EL-02 WAL ---- */
  const mode = raw(DB, (d) => d.prepare("PRAGMA journal_mode").get().journal_mode);
  if (String(mode).toLowerCase() === "wal") ok("EL-02", `journal_mode=${mode}（WAL 落盘，-wal 文件存在：${fs.existsSync(DB + "-wal")}）`);
  else bad("EL-02", `journal_mode=${mode}，不是 wal`);

  /* ---- EL-03 append / seq ---- */
  const a1 = log.append({ sessionId: "s-a", kind: "session_created", payload: { title: "甲" }, idemKey: "c1:001" });
  const a2 = log.append({ sessionId: "s-b", kind: "turn_started", turnId: "t-1", payload: { input: "你好" }, idemKey: "c1:002" });
  const a3 = log.append({ sessionId: "s-a", kind: "message_committed", turnId: "t-1", payload: { role: "assistant", text: "在" }, idemKey: "c1:003" });
  const seqs = [a1.seq, a2.seq, a3.seq];
  const strictlyUp = seqs.every((s, i) => i === 0 || s > seqs[i - 1]) && seqs.every((s) => Number.isInteger(s) && s > 0);
  if (strictlyUp && log.count() === 3 && log.lastSeq() === a3.seq && log.sessionLastSeq("s-a") === a3.seq) {
    ok("EL-03", `seq 由库分配且全局递增：${seqs.join(" < ")}；会话游标 s-a=${log.sessionLastSeq("s-a")}，s-b=${log.sessionLastSeq("s-b")}`);
  } else {
    bad("EL-03", `seq 不对：${JSON.stringify(seqs)} count=${log.count()} last=${log.lastSeq()}`);
  }

  /* ---- EL-04 幂等 ---- */
  const dup = log.append({ sessionId: "s-a", kind: "session_created", payload: { title: "甲" }, idemKey: "c1:001" });
  if (dup.seq === a1.seq && dup.duplicated === true && log.count() === 3) {
    ok("EL-04", `重复投递读回原 seq=${dup.seq}（duplicated=${dup.duplicated}），库里仍是 ${log.count()} 行`);
  } else {
    bad("EL-04", `重复投递产生了新状态：seq=${dup.seq}（原 ${a1.seq}）duplicated=${dup.duplicated} count=${log.count()}`);
  }

  /* ---- EL-05 delta 不落库 ---- */
  const whyDelta = expectThrow(
    () => log.append({ sessionId: "s-a", kind: "delta", payload: { text: "半句" } }),
    /delta 不落库/,
    "EL-05",
  );
  if (whyDelta && log.count() === 3) ok("EL-05", "delta 被适配器拒绝且没有留下半行");

  /* ---- EL-06 任意 seq 续订 ---- */
  const tail = log.readAfter({ fromSeq: a1.seq });
  const sA = log.readAfter({ sessionId: "s-a", fromSeq: 0 });
  const ordered = tail.every((r, i) => i === 0 || r.seq > tail[i - 1].seq);
  if (tail.length === 2 && tail[0].seq === a2.seq && ordered &&
      sA.length === 2 && sA.map((r) => r.seq).join(",") === `${a1.seq},${a3.seq}`) {
    ok("EL-06", `续订 from_seq=${a1.seq} 得到 ${tail.map((r) => `${r.seq}:${r.kind}`).join(", ")}；s-a 全量 ${sA.map((r) => r.seq).join(",")} 稠密有序`);
  } else {
    bad("EL-06", `续订结果不对：tail=${JSON.stringify(tail.map((r) => r.seq))} s-a=${JSON.stringify(sA.map((r) => r.seq))}`);
  }

  /* ---- EL-07 重开不丢 / kill -9 不丢 ---- */
  log.close();
  log = openEventLog({ file: DB, actor: "machine-test" });
  const reopened = log.count();
  log.close();
  // 子进程 append 后立刻 SIGKILL 自己：不给 close() 的机会。已提交事务必须在
  // 下次打开时还在——这就是 AC-T1-2「kill -9 后重启，在途回合状态正确」的地基。
  const childSrc = `
    const m = require(${JSON.stringify(path.join(ROOT, "hosts/shared/event_log.js"))});
    const log = m.openEventLog({ file: ${JSON.stringify(DB)}, actor: "machine-crash" });
    log.append({ sessionId: "s-crash", kind: "turn_started", turnId: "t-crash", payload: { input: "半途" }, idemKey: "crash:1" });
    process.kill(process.pid, "SIGKILL");
  `;
  const child = spawnSync(process.execPath, ["-e", childSrc], { encoding: "utf8" });
  const killed = child.signal === "SIGKILL" || child.status === null || String(child.stderr || "").includes("SIGKILL");
  log = openEventLog({ file: DB, actor: "machine-test" });
  const afterCrash = log.readAfter({ sessionId: "s-crash", fromSeq: 0 });
  if (reopened !== 3) {
    bad("EL-07", `重开后行数 ${reopened}，应为 3`);
  } else if (afterCrash.length !== 1 || afterCrash[0].kind !== "turn_started") {
    bad("EL-07", `kill -9（signal=${child.signal} status=${child.status}）后那条已提交事件读不回来：${JSON.stringify(afterCrash.map((r) => r.seq))}${child.stderr ? " stderr=" + String(child.stderr).slice(0, 200) : ""}`);
  } else if (!killed) {
    bad("EL-07", `子进程没有真的被 SIGKILL（status=${child.status}），这条不算证完`);
  } else {
    ok("EL-07", `干净重开 ${reopened} 行；SIGKILL 子进程追加的 seq=${afterCrash[0].seq} 重开后可读（actor=${afterCrash[0].actor}）`);
  }

  /* ---- EL-08 seq 不复用 ---- */
  const before = log.lastSeq();
  {
    raw(DB, (d) => d.exec("DELETE FROM events WHERE seq = (SELECT MAX(seq) FROM events);"));
  }
  const next = log.append({ sessionId: "s-a", kind: "presence_changed", payload: { online: true }, idemKey: "c1:009" });
  if (next.seq > before) ok("EL-08", `删掉最大行（${before}）后新 seq=${next.seq}，号没有被回收（AUTOINCREMENT 生效）`);
  else bad("EL-08", `seq 被复用了：删掉 ${before} 后拿到 ${next.seq}`);
  log.close();

  /* ---- EL-09 新版本库拒绝打开 ---- */
  const future = path.join(stage, "future", "events.db");
  fs.mkdirSync(path.dirname(future), { recursive: true });
  raw(future, (d) => {
    d.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    d.prepare("INSERT INTO meta (key, value) VALUES ('log_version', ?)").run(String(LOG_VERSION + 7));
  });
  const whyVersion = expectThrow(
    () => openEventLog({ file: future, actor: "machine-test" }),
    /拒绝打开/,
    "EL-09",
  );
  if (whyVersion) ok("EL-09", `log_version=${LOG_VERSION + 7} 的库被拒绝：${whyVersion.slice(0, 96)}…`);

  /* ---- EL-10 零原生依赖 ---- */
  const src = fs.readFileSync(path.join(ROOT, "hosts/shared/event_log.js"), "utf8");
  const imports = [...src.matchAll(/require\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const builtins = new Set(["fs", "path", "node:fs", "node:path", "node:sqlite", "sqlite"]);
  const externals = imports.filter((m) => !m.startsWith("node:") && !builtins.has(m) && !m.startsWith("."));
  if (externals.length === 0 && imports.some((m) => m === "node:sqlite")) {
    ok("EL-10", `只依赖内置件：${imports.filter((m, i, a) => a.indexOf(m) === i).join(", ")}（无 .node 扩展，跨平台无需预编译）`);
  } else {
    bad("EL-10", `出现了外部依赖：${JSON.stringify(externals)}（全部 require: ${JSON.stringify(imports)}）`);
  }
} catch (e) {
  bad("EL-00", `门禁自身抛错：${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

console.log(`\n== 汇总 == pass ${pass} / fail ${fail}`);
if (fail > 0) {
  console.log("门禁不过：事件日志适配器的建库/幂等/续订/崩溃恢复有不合格项。");
  process.exit(1);
}
