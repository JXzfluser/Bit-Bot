/*
 * event_log.js — T1-02 事件日志适配器（SQLite，node:sqlite，零原生依赖）。
 *
 * 契约真源是 docs/events.md：表结构、seq 语义、幂等规则在那里定义了一次，
 * 这个文件只做「把那份 DDL 建起来 + 按那套语义读写」，不再另立一套字段。
 *
 * 为什么现在只有骨架：T1-02 的完成定义是「可建库 / 开库 / 迁移；零原生依赖；
 * 在 Node 上跑通」。双写（T1-03）、actor 单写者（T1-06）、subscribe 游标 API
 * （T1-09）都各自有任务，不该提前塞进来——它们要改的是调用点，不是这张表。
 *
 * 三条不能省的机制（缺一条，后面的 T1 全都盖在沙子上）：
 *   1. seq 由数据库分配（AUTOINCREMENT），调用方传不进来 → 客户端存的光标
 *      不会因为删行而指向另一条事件（docs/events.md §3「不复用」）。
 *   2. idem_key 的部分唯一索引就是去重本身：重复投递撞约束，读回原 seq，
 *      而不是再追加一行（AC-T1-2「重复投递 = 0」）。
 *   3. 库版本比这份代码新 → 拒绝打开并报错，绝不猜着读（不变量 I7）。
 */

"use strict";

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (err) {
  // Node < 22.5 没有 node:sqlite。宁可在这里说清楚，也不要让调用点拿到
  // undefined 之后在 `new undefined(...)` 处炸成一句看不懂的话。
  throw new Error(
    "event_log 需要内置 SQLite（node:sqlite）。当前 Node " +
      process.version +
      " 没有这个模块 — 请用 Node ≥ 22.5。（本适配器刻意不依赖 better-sqlite3 " +
      "这类原生扩展：打包产物里多一个 .node，就要多一套各平台的预编译与签名。）",
  );
}

const fs = require("fs");
const path = require("path");

/** 当前代码支持的日志版本 = 迁移条数。 */
const LOG_VERSION = 1;

const SCHEMA_V1 = `
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE migrations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  turn_id    TEXT,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  actor      TEXT NOT NULL,
  ts         INTEGER NOT NULL,
  idem_key   TEXT
);
CREATE INDEX events_session_seq ON events (session_id, seq);
CREATE UNIQUE INDEX events_idem ON events (idem_key) WHERE idem_key IS NOT NULL;

CREATE TABLE effects (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  turn_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  target       TEXT NOT NULL,
  approval     TEXT NOT NULL,
  idem_key     TEXT UNIQUE,
  deadline_ms  INTEGER,
  status       TEXT NOT NULL,
  result       TEXT
);
CREATE INDEX effects_session ON effects (session_id, turn_id);
`;

/** 只向前：迁移表按 id 升序应用，每条在自己的事务里跑。 */
const MIGRATIONS = [{ id: 1, name: "init_v1", sql: SCHEMA_V1 }];

/** delta 是「在途缓冲」，不是状态：落库就等于把逐 token 的历史永久写进日志
 *  （docs/events.md §5、需求 §3.4 的规则）。适配器直接拒绝，而不是指望调用方自律。 */
const NEVER_PERSISTED = new Set(["delta"]);

function isUniqueViolation(err) {
  if (!err) return false;
  if (Number(err.errcode) === 2067) return true; // SQLITE_CONSTRAINT_UNIQUE
  return /UNIQUE constraint failed/i.test(String(err && err.message));
}

function readLogVersion(db) {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'log_version'").get();
    return row ? Number(row.value) : 0;
  } catch (_e) {
    return 0; // 还没有 meta 表 → 全新库
  }
}

/**
 * 打开（必要时创建）一个会话日志库。
 * @param {{file:string, actor:string, busyTimeoutMs?:number, now?:()=>number}} opts
 *   actor 是这台机器/这个客户端的写入身份（docs/events.md §6），每条事件都盖上它。
 * @returns {{file:string, actor:string, append:Function, readAfter:Function,
 *            lastSeq:Function, sessionLastSeq:Function, count:Function,
 *            logVersion:number, close:Function}}
 */
function openEventLog(opts = {}) {
  const file = String(opts.file || "");
  const actor = String(opts.actor || "");
  if (!file) throw new Error("openEventLog: 需要 file");
  if (!actor) throw new Error("openEventLog: 需要 actor（谁写的这条日志）");
  const now = opts.now || (() => Date.now());

  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);

  // WAL：读不阻塞写，崩溃后 -wal 里的已提交事务在下次打开时自动回放。
  // synchronous=NORMAL 是 WAL 下的推荐档：提交不每次 fsync，但崩溃不丢已提交数据。
  // busy_timeout 必须给：常驻内核（T1-07）与 Host 会在同一库上并发，
  // 没有它，SQLITE_BUSY 直接抛进调用点。
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`PRAGMA busy_timeout = ${Number(opts.busyTimeoutMs) > 0 ? Number(opts.busyTimeoutMs) : 5000};`);

  const journalMode = String(db.prepare("PRAGMA journal_mode").get().journal_mode);
  if (journalMode.toLowerCase() !== "wal") {
    // 挂在网络盘 / 只读目录上时 WAL 会静默退化成 delete 模式。这时候
    // 「崩溃不丢」的承诺不再成立，必须当场说，不能让 T1-06 盖在上面。
    throw new Error(`openEventLog: journal_mode 退化为 ${journalMode}，需要 WAL（${file}）`);
  }

  const version = readLogVersion(db);
  if (version > LOG_VERSION) {
    db.close();
    throw new Error(
      `openEventLog: 库的 log_version=${version} 比这份代码（${LOG_VERSION}）新，拒绝打开。` +
        "升级代码，不要猜格式（不变量 I7）。",
    );
  }

  for (const m of MIGRATIONS) {
    if (m.id <= version) continue;
    db.exec("BEGIN;");
    try {
      db.exec(m.sql);
      db
        .prepare("INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)")
        .run(m.id, m.name, now());
      db
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('log_version', ?) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(String(m.id));
      db
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('instance_id', ?) " +
            "ON CONFLICT(key) DO NOTHING",
        )
        .run(actor);
      db.exec("COMMIT;");
    } catch (err) {
      try { db.exec("ROLLBACK;"); } catch (_r) { /* 事务已断 */ }
      db.close();
      throw new Error(`openEventLog: 迁移 ${m.name} 失败：${err && err.message ? err.message : err}`);
    }
  }

  const insertStmt = db.prepare(
    "INSERT INTO events (session_id, turn_id, kind, payload, actor, ts, idem_key) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const findByIdem = db.prepare("SELECT seq FROM events WHERE idem_key = ?");
  const readAfterStmt = db.prepare(
    "SELECT seq, session_id, turn_id, kind, payload, actor, ts, idem_key FROM events " +
      "WHERE seq > ? ORDER BY seq ASC LIMIT ?",
  );
  const readSessionAfterStmt = db.prepare(
    "SELECT seq, session_id, turn_id, kind, payload, actor, ts, idem_key FROM events " +
      "WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
  );
  const maxSeqStmt = db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events");
  const sessionMaxStmt = db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE session_id = ?");
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM events");

  /**
   * 追加一条事件；带 idem_key 且已存在时不重复落库，返回原 seq。
   * @param {{sessionId:string, kind:string, payload:object, turnId?:string,
   *          idemKey?:string, ts?:number}} entry
   * @returns {{seq:number, duplicated:boolean}}
   */
  function append(entry = {}) {
    const sessionId = String(entry.sessionId || "");
    const kind = String(entry.kind || "");
    if (!sessionId) throw new Error("append: 需要 sessionId");
    if (!kind) throw new Error("append: 需要 kind");
    if (NEVER_PERSISTED.has(kind)) {
      throw new Error(`append: ${kind} 不落库（只在途，docs/events.md §5）`);
    }
    const idemKey = entry.idemKey == null ? null : String(entry.idemKey);
    if (idemKey !== null) {
      const hit = findByIdem.get(idemKey);
      if (hit) return { seq: Number(hit.seq), duplicated: true };
    }
    const payload = JSON.stringify(entry.payload === undefined ? {} : entry.payload);
    const ts = Number(entry.ts != null ? entry.ts : now());
    try {
      const info = insertStmt.run(sessionId, entry.turnId == null ? null : String(entry.turnId), kind, payload, actor, ts, idemKey);
      return { seq: Number(info.lastInsertRowid), duplicated: false };
    } catch (err) {
      // 上面那次 SELECT 与 INSERT 之间不是原子的：同 idem_key 的并发写会撞
      // events_idem。撞了就读回原 seq——这正是「重复投递 = 0」要的语义。
      if (idemKey !== null && isUniqueViolation(err)) {
        const hit = findByIdem.get(idemKey);
        if (hit) return { seq: Number(hit.seq), duplicated: true };
      }
      throw err;
    }
  }

  /**
   * 从任意 seq 续订（一次读）。fromSeq=0 就是全量。
   * @param {{sessionId?:string, fromSeq?:number, limit?:number}} [q]
   */
  function readAfter(q = {}) {
    const fromSeq = Number(q.fromSeq || 0);
    const limit = Number(q.limit > 0 ? q.limit : 1000);
    const rows = q.sessionId
      ? readSessionAfterStmt.all(String(q.sessionId), fromSeq, limit)
      : readAfterStmt.all(fromSeq, limit);
    return rows.map((r) => ({
      seq: Number(r.seq),
      sessionId: r.session_id,
      turnId: r.turn_id,
      kind: r.kind,
      payload: r.payload,
      actor: r.actor,
      ts: Number(r.ts),
      idemKey: r.idem_key,
    }));
  }

  return {
    file,
    actor,
    logVersion: LOG_VERSION,
    append,
    readAfter,
    lastSeq: () => Number(maxSeqStmt.get().seq),
    sessionLastSeq: (sessionId) => Number(sessionMaxStmt.get(String(sessionId)).seq),
    count: () => Number(countStmt.get().n),
    close: () => db.close(),
  };
}

module.exports = {
  LOG_VERSION,
  MIGRATIONS,
  NEVER_PERSISTED,
  openEventLog,
};
