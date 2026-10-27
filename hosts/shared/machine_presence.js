"use strict";

/**
 * 多端在线凭据（Host 侧唯一可信的来源）。
 *
 * 内核里的机器表是 seed() 出来的固定花名册（box_host/machines.mbt:87），
 * 它不知道此刻谁真的在说话 —— 知道这件事的只有 Host：手机每成功打一次
 * /v1/turn（ADR 0008 过了 bearer），就是一台设备真实存在的证据。
 *
 * 所以：
 *   - 只有**过了鉴权**的回合才记账（401 不记，否则任何路人扫端口都能点亮花名册）；
 *   - 「在线」= TTL 内有证据，不写「大概还开着」；过期就是过期；
 *   - 合并只标注有证据的行，不给内核凭空加机器。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/* 这份文件是「谁真的在线」的唯一证据来源，一次坏写就把所有设备一起钉成离线：
 *   - 读-改-写跨进程并发会互相覆盖（12 台并发实测丢 2 行）；
 *   - fs.writeFileSync 先截断再写，中间那段读者读到的是空文件 / 半截 JSON
 *     （实测 36 万次读里 33 万次撞在空窗上）。
 * 所以：先拿跨进程锁（mkdir 原子）再做读-改-写，落盘用 tmp + rename 换原子性。
 * 卡死的锁要能夺回来 —— 进程被杀不能把这台机器永久钉在离线。
 *
 * 夺锁的判据不能只看时间年龄：矩阵全量跑的时候（Electron + 内核编译抢 4 核），
 * 一个正在读-改-写的进程持有锁超过 5 秒是常态，此时按年龄抢锁 = 两个进程同时
 * 进临界区，后写的整行盖掉先写的，而两边都以为自己写成功了 —— PD-01 那次偶发
 * 丢 2/12 条、子进程零报错就是这么来的（PD-06 把它变成必现红）。
 * 所以：锁目录里写清持有者身份（pid / host / token），只有**证明持有者已经死了**
 * 才抢；释放时也只认自己的 token，别人的锁不碰（PD-07）。 */
const LOCK_TIMEOUT_MS = Number(process.env.BITBOT_PRESENCE_LOCK_MS || 3000);
const LOCK_STALE_MS = 5000;
/* 跨机持有者（共享盘 / NAS）验不了 pid，只能给一个远大于正常临界区的兜底窗口；
 * 兜底之前宁可等超时、宁可这一条证据不记，也不能两个人同时写。 */
const LOCK_CROSS_HOST_MS = LOCK_STALE_MS * 6;
const LOCK_RETRY_MS = 2;
let tmpSeq = 0;

/** pid 是否还活着（只用来判断同一台机器上的锁持有者是不是已经没了）。
 * EPERM = 进程存在但不归我，按「活着」处理 —— 宁可等，也不能抢活人的锁。 */
function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_e) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* 没有 SharedArrayBuffer 就忙等几毫秒（窗口本来就短） */
    }
  }
}

function withPresenceLock(file, fn) {
  const lock = file + ".lock";
  const ownerFile = path.join(lock, "owner.json");
  const token = process.pid + "-" + Math.random().toString(36).slice(2, 10);
  const me = {
    pid: process.pid,
    host: os.hostname(),
    token,
    started_at: new Date().toISOString(),
  };
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      /* 锁拿到手第一件事是署名：没有署名的锁，释放时就无法证明还是我的。
       * 署名失败（只读盘之类）宁可放弃锁也不能无凭证地进临界区。 */
      try {
        fs.writeFileSync(ownerFile, JSON.stringify(me), { flag: "wx" });
        break;
      } catch (signErr) {
        try {
          fs.rmdirSync(lock);
        } catch (_e) {
          /* 已经没了 */
        }
        throw signErr;
      }
    } catch (err) {
      if (err && err.code !== "EEXIST") throw err;
    }
    /* 抢不到：先看清里面是谁，再决定等、还是证明他已经死了 */
    let owner = null;
    try {
      owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
    } catch (_e) {
      owner = null;
    }
    let age = -1;
    try {
      age = Date.now() - fs.statSync(lock).mtimeMs;
    } catch (_e) {
      /* 锁刚被释放，下一轮 mkdir 就能拿到 */
      if (Date.now() > deadline) throw new Error("presence_lock_timeout");
      sleepSync(LOCK_RETRY_MS);
      continue;
    }
    let reclaim = false;
    if (age > LOCK_STALE_MS) {
      if (!owner) {
        /* 老版本留下的锁 / 署名前就被 kill：没有任何身份可验，只能按年龄兜底 */
        reclaim = true;
      } else if (owner.host === os.hostname()) {
        /* 同一台机器：pid 可以直接验活。活着就不许抢，哪怕它慢 —— 抢了就是两个进程
         * 同时读-改-写，证据会静默丢失（PD-06 的红色就是这个）。 */
        reclaim = !pidAlive(Number(owner.pid));
      } else if (age > LOCK_CROSS_HOST_MS) {
        /* 别的机器：验不了 pid，给一个远大于临界区的兜底窗口，宁可超时也不并发写 */
        reclaim = true;
      }
    }
    if (reclaim) {
      try {
        fs.rmSync(ownerFile, { force: true });
        fs.rmdirSync(lock);
      } catch (_e) {
        /* 有人抢先夺走了，下一轮重新看 */
      }
    }
    if (Date.now() > deadline) throw new Error("presence_lock_timeout");
    sleepSync(LOCK_RETRY_MS);
  }
  try {
    return fn();
  } finally {
    /* 只释放自己的锁：如果我持有的这段时间里被别人判定为死锁抢走了，
     * 这时候 rmdir 删的是新主人的锁 —— 会把第三个进程放进同一个临界区。 */
    let mine = false;
    try {
      const cur = JSON.parse(fs.readFileSync(ownerFile, "utf8"));
      mine = cur && cur.token === token && cur.pid === process.pid;
    } catch (_e) {
      mine = false;
    }
    if (mine) {
      try {
        fs.rmSync(ownerFile, { force: true });
      } catch (_e) {
        /* 已经没了 */
      }
      try {
        fs.rmdirSync(lock);
      } catch (_e) {
        /* 锁目录已经不在了 */
      }
    }
  }
}

/** 原子落盘：写临时文件 + fsync + rename；rename 失败时退回「删了再换」。 */
function writeAtomic(file, text) {
  const tmp = file + "." + process.pid + "." + ++tmpSeq + ".tmp";
  let fd = null;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeFileSync(fd, text, "utf8");
    try {
      fs.fsyncSync(fd);
    } catch (_e) {
      /* 某些文件系统不支持 fsync：能落盘就行，不把这条路径搞红 */
    }
    fs.closeSync(fd);
    fd = null;
    try {
      fs.renameSync(tmp, file);
    } catch (err) {
      if (!err || (err.code !== "EPERM" && err.code !== "EEXIST" && err.code !== "ENOTEMPTY")) throw err;
      fs.rmSync(file, { force: true });
      fs.renameSync(tmp, file);
    }
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_e) {
        /* 已经关了 */
      }
    }
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    } catch (_e) {
      /* 临时文件没了就没了 */
    }
  }
}

function presenceFile(repoRoot) {
  return path.join(path.resolve(repoRoot), "data", "machines", "presence.json");
}

function readPresence(repoRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(presenceFile(repoRoot), "utf8"));
    const machines = raw && raw.machines ? raw.machines : {};
    const out = {};
    for (const [id, row] of Object.entries(machines)) {
      if (!id || !row || typeof row !== "object") continue;
      out[String(id)] = {
        id: String(id),
        kind: String(row.kind || ""),
        last_seen: String(row.last_seen || ""),
        source: String(row.source || ""),
        turns: Number(row.turns || 0),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function seenWithin(row, nowMs, ttlMs) {
  const at = Date.parse(row && row.last_seen ? row.last_seen : "");
  return Number.isFinite(at) && nowMs - at >= 0 && nowMs - at <= ttlMs;
}

/**
 * 一次过了鉴权的远端回合 = 这台机器在线的证据。
 * @param {string} repoRoot
 * @param {{machineId: string, machineKind: string, source?: string}} ev
 */
function recordMachinePresence(repoRoot, ev) {
  const id = String((ev && ev.machineId) || "").trim();
  if (!id) return { ok: false, error: "empty_machine_id" };
  const file = presenceFile(repoRoot);
  try {
    // 锁目录本身要有一个能放它的地方：先确保 data/machines 存在，
    // 否则第一次记账会在「拿锁」这一步就 ENOENT（目录还没建）。
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return withPresenceLock(file, () => {
      let store = {};
      try {
        store = JSON.parse(fs.readFileSync(file, "utf8")).machines || {};
      } catch {
        store = {};
      }
      const prev = store[id] || {};
      const at = new Date().toISOString();
      store[id] = {
        id,
        kind: String((ev && ev.machineKind) || prev.kind || ""),
        last_seen: at,
        source: String((ev && ev.source) || prev.source || "v1_turn"),
        turns: Number(prev.turns || 0) + 1,
      };
      writeAtomic(file, JSON.stringify({ updated_at: at, machines: store }, null, 2));
      return { ok: true, path: file, machine: store[id] };
    });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/**
 * 把证据并进内核花名册的 machines 行（可选新增字段 last_seen/presence_source）。
 * 不改 id、不改 kind、不新增机器。
 * @returns {{machines: Array<object>, online: string[]}}
 */
function mergePresenceIntoMachines(repoRoot, machines, opts = {}) {
  const nowMs = opts.now != null ? Number(opts.now) : Date.now();
  const ttlMs =
    opts.ttlMs != null
      ? Number(opts.ttlMs)
      : Number(process.env.BITBOT_PRESENCE_TTL_MS || DEFAULT_TTL_MS);
  const store = readPresence(repoRoot);
  const online = [];
  const rows = (Array.isArray(machines) ? machines : []).map((m) => {
    const row = { ...(m || {}) };
    const ev = store[row.id];
    if (!ev) return row;
    row.last_seen = ev.last_seen;
    row.presence_source = ev.source;
    if (seenWithin(ev, nowMs, ttlMs)) {
      row.status = "connected";
      row.presence_evidence = "seen_within_ttl";
      online.push(row.id);
    } else {
      row.presence_evidence = "stale";
    }
    return row;
  });
  return { machines: rows, online };
}

/** 给人看的一句话（桌面花名册 / 回执用）。 */
function presenceLine(repoRoot, opts = {}) {
  const nowMs = opts.now != null ? Number(opts.now) : Date.now();
  const ttlMs =
    opts.ttlMs != null ? Number(opts.ttlMs) : Number(process.env.BITBOT_PRESENCE_TTL_MS || DEFAULT_TTL_MS);
  const store = readPresence(repoRoot);
  const parts = [];
  for (const row of Object.values(store)) {
    const agoSec = Math.max(0, Math.round((nowMs - Date.parse(row.last_seen)) / 1000));
    if (seenWithin(row, nowMs, ttlMs)) parts.push(row.id + " 在线（" + agoSec + " 秒前有回合）");
    else parts.push(row.id + " 离线（最后证据 " + agoSec + " 秒前，超出 TTL）");
  }
  return parts.join("；");
}

module.exports = {
  DEFAULT_TTL_MS,
  presenceFile,
  readPresence,
  recordMachinePresence,
  mergePresenceIntoMachines,
  presenceLine,
  // 门禁要能直接验这两条底层能力（并发与崩溃窗口），不靠读源码猜。
  withPresenceLock,
  writeAtomic,
};
