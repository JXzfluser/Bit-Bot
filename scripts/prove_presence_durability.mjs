/* prove_presence_durability.mjs — 「多端在线」那份证据能不能扛住并发与崩溃
 *
 * 在线状态唯一的真相来源是 data/machines/presence.json（hosts/shared/machine_presence.js）。
 * 桌面面板上「Pixel 在线（37 秒前有回合）」这句话，全部建立在这个文件没坏、
 * 没被覆盖上。每一次过了鉴权的回合都要「读文件 → 改 → 写文件」：
 *   - 跨进程并发（多开实例、命令行 host、CI 里的门禁）时，两个读-改-写同时跑，
 *     后写的把先写的那行整个覆盖掉 —— 表现为「手机明明在说话，花名册却离线」，
 *     随机复现、最难查；
 *   - fs.writeFileSync 先截断再写，中间有一个「文件是空的 / 半截 JSON」的窗口。
 *     崩溃或断电正好落在这里，readPresence 走 catch 返回 {}，
 *     于是**所有**设备一起变离线（一份证据坏，全体真相没）。
 * 同一进程里是同步读-改-写，不会自己覆盖自己；本门禁验的是跨进程与崩溃窗口。
 *
 * 不读源码猜，直接把并发打到磁盘上：
 *   PD-01 12 个进程并发各记一台机器 → 12 条都必须在，一条都不许被覆盖掉
 *   PD-02 并发写期间，读者每一次读都要拿到可 parse 的完整 JSON（不许空窗、不许半截）
 *   PD-03 文件已经被写坏时，下一次记录要能重建，而不是继续叠加坏数据
 *   PD-04 记证据不许改内核花名册：不新增机器、不动 id/kind（回归护栏）
 *   PD-05 拿锁进程被杀掉后，下一次回合要能把锁夺回来（否则设备永久钉在离线）
 *   PD-06 「慢但还活着」的持锁者不许被抢锁 —— 只看时间年龄会在高负载下偷走
 *          正在写的进程的锁，两个进程同时读-改-写 = 丢证据，而且两边都以为自己成功
 *   PD-07 释放锁只能释放自己的锁 —— 被判定为死的进程醒来时，不许把新主人的
 *          锁删掉（那等于把第三个进程放进同一个临界区）
 *
 * 跑法：node scripts/prove_presence_durability.mjs（纯 Node，不需要 Electron / moon）
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const MODULE = path.join(REPO, "hosts/shared/machine_presence.js");
const presence = require(MODULE);

let PASS = 0,
  FAIL = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : ""));
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-presence-"));
const file = presence.presenceFile(root);
const done = () => {
  console.log("prove_presence_durability: PASS=" + PASS + " FAIL=" + FAIL);
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_e) {
    /* 临时目录清不掉不影响红绿 */
  }
  process.exit(FAIL ? 1 : 0);
};

function readRaw() {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (_e) {
    return "";
  }
}

function rows() {
  try {
    return JSON.parse(readRaw()).machines || {};
  } catch (_e) {
    return null;
  }
}

const RECORD_CODE =
  "const p=require(process.argv[1]);" +
  "const r=p.recordMachinePresence(process.argv[2]," +
  "{machineId:process.argv[3],machineKind:'android',source:'pid'});" +
  "if(!r.ok){console.error(String(r.error||'fail'));process.exit(2);}";

/** 真的并发：一次性 spawn 全部子进程，再等它们退出（spawnSync 循环是串行的，测不出覆盖）。 */
function recordConcurrently(machineIds) {
  return new Promise((resolve) => {
    const kids = machineIds.map((id) =>
      spawn(process.execPath, ["-e", RECORD_CODE, MODULE, root, id], { stdio: ["ignore", "ignore", "pipe"] }),
    );
    const errs = [];
    let left = kids.length;
    kids.forEach((k, i) => {
      k.stderr.on("data", (b) => errs.push("#" + i + " " + String(b).trim()));
      k.on("exit", (code) => {
        if (code !== 0) errs.push("#" + i + " exit=" + code);
        if (--left === 0) resolve(errs);
      });
    });
  });
}

/* ---------- PD-01 并发不丢证据 ---------- */
const N = 12;
const ids = Array.from({ length: N }, (_, i) => "phone-test-" + String(i).padStart(2, "0"));
const childErrs = await recordConcurrently(ids);
const store = rows();
if (!store) {
  bad("PD-01 并发写完之后文件不是合法 JSON", readRaw().slice(0, 160));
  done();
}
const missing = ids.filter((id) => !store[id]);
if (missing.length) {
  bad(
    "PD-01 并发回合把证据覆盖掉了（读-改-写不是原子的，后写整行盖掉先写）",
    "剩 " + (N - missing.length) + "/" + N + " 条，丢：" + missing.slice(0, 6).join(",") + (childErrs.length ? " · 子进程报错：" + childErrs[0] : ""),
  );
} else {
  ok("PD-01 " + N + " 个进程并发各记一台机器，证据一条没丢（" + N + "/" + N + "）");
}

/* ---------- PD-02 并发写期间，读者不许看到空窗或半截 JSON ---------- */
const STORM_MS = 2500;
const stormCode =
  "const p=require(process.argv[1]);" +
  "const end=Date.now()+" +
  STORM_MS +
  ";" +
  "while(Date.now()<end){p.recordMachinePresence(process.argv[2],{machineId:'phone-storm',machineKind:'android',source:'storm'});" +
  "if(process.argv[3]==='exit'){process.exit(0);}}";
const readerCode =
  "const fs=require('fs');const p=require(process.argv[2]);const f=process.argv[1];" +
  "let torn=0,empty=0,reads=0,best=0;const end=Date.now()+" +
  (STORM_MS - 500) +
  ";" +
  "while(Date.now()<end){try{const s=fs.readFileSync(f,'utf8');reads++;" +
  "if(!s.trim()){empty++;}else{try{const m=JSON.parse(s).machines||{};" +
  "const t=Number((m['phone-storm']&&m['phone-storm'].turns)||0);if(t>best)best=t;}" +
  "catch(e){torn++;}}}" +
  "catch(e){if(e.code!=='ENOENT')torn++;}}" +
  "console.log(JSON.stringify({reads:reads,torn:torn,empty:empty,bestTurns:best}));";

const writer = spawn(process.execPath, ["-e", stormCode, MODULE, root, "no"], { stdio: "ignore" });
const probe = spawnSync(process.execPath, ["-e", readerCode, file, MODULE], { encoding: "utf8", timeout: 30000 });
await new Promise((r) => writer.once("exit", r));

const probeOut = String(probe.stdout || "");
const pReads = Number((probeOut.match(/"reads":(\d+)/) || [])[1] || 0);
const pTorn = Number((probeOut.match(/"torn":(\d+)/) || [])[1] || 0);
const pEmpty = Number((probeOut.match(/"empty":(\d+)/) || [])[1] || 0);
const bestTurns = Number((probeOut.match(/"bestTurns":(\d+)/) || [])[1] || 0);
if (pReads < 20) {
  bad("PD-02 读者没读到足够次数，这条不算验过", JSON.stringify({ probeOut: probeOut.slice(0, 120), err: String(probe.stderr || "").slice(0, 140) }));
} else if (bestTurns < 2) {
  bad("PD-02 写者没真的在并发写（读者没看到回合数在涨），这条不算验过", JSON.stringify({ bestTurns, writerExit: writer.exitCode }));
} else if (pTorn > 0) {
  bad("PD-02 并发写期间读到过半截 JSON（一次坏读=全体显示离线）", "torn=" + pTorn + "/" + pReads + " · storm 最多到 " + bestTurns + " 回合");
} else if (pEmpty > 0) {
  bad("PD-02 并发写期间读到过空文件（先截断再写的窗口）", "empty=" + pEmpty + "/" + pReads + " · storm 最多到 " + bestTurns + " 回合");
} else {
  ok("PD-02 storm 期间读者读 " + pReads + " 次（回合数一路涨到 " + bestTurns + "），没有一次是空窗或半截 JSON");
}

/* ---------- PD-03 坏文件要能重建 ---------- */
fs.writeFileSync(file, '{"updated_at":"2026-01-01T00:00:00.000Z","machines":{"phone-broken":{"id":"phone-broken"');
const repair = spawnSync(process.execPath, ["-e", RECORD_CODE, MODULE, root, "phone-android"], { encoding: "utf8", timeout: 30000 });
const after = rows();
if (repair.status !== 0) bad("PD-03 文件坏了之后记录就再也写不进去", "exit=" + repair.status + " " + String(repair.stderr || "").slice(0, 120));
else if (!after) bad("PD-03 坏文件没被重建，仍然是非法 JSON", readRaw().slice(0, 120));
else if (!after["phone-android"]) bad("PD-03 重建后新证据没记上", JSON.stringify(Object.keys(after).slice(0, 8)));
else ok("PD-03 文件被写坏之后，下一次回合能重建它并记上新证据");

/* ---------- PD-04 证据不改花名册 ---------- */
const seedMachines = [
  { id: "desk-1", kind: "desktop", status: "offline" },
  { id: "phone-ios", kind: "ios", status: "offline" },
  { id: "phone-android", kind: "android", status: "offline" },
  { id: "ghost", kind: "unknown", status: "offline" },
];
const merged = presence.mergePresenceIntoMachines(root, seedMachines, { now: Date.now() });
const idsOut = merged.machines.map((m) => m.id).sort().join(",");
if (idsOut !== seedMachines.map((m) => m.id).sort().join(",")) {
  bad("PD-04 合并证据时改了机器清单（不该新增也不该删）", idsOut);
} else {
  const hit = merged.machines.find((m) => m.id === "phone-android");
  const untouched = merged.machines.find((m) => m.id === "ghost");
  if (!hit || hit.status !== "connected" || hit.kind !== "android") {
    bad("PD-04 有证据的机器没被如实标注", JSON.stringify(hit));
  } else if (!untouched || Object.prototype.hasOwnProperty.call(untouched, "last_seen")) {
    bad("PD-04 没证据的机器被动到了", JSON.stringify(untouched));
  } else {
    ok("PD-04 只标注有证据的行，不新增机器、不动 id/kind");
  }
}

/* ---------- PD-05 卡死的锁不许把设备永久钉成离线 ---------- */
const lockDir = file + ".lock";
fs.mkdirSync(lockDir, { recursive: true });
// 把锁的 mtime 推到「超过 stale 阈值」，等价于上一个进程拿着锁就被 kill 了
const old = new Date(Date.now() - 60000);
fs.utimesSync(lockDir, old, old);
const stuck = spawnSync(process.execPath, ["-e", RECORD_CODE, MODULE, root, "phone-stuck"], {
  encoding: "utf8",
  timeout: 20000,
});
const stuckRows = rows();
const leftovers = (() => {
  try {
    return fs.readdirSync(path.dirname(file)).filter((f) => /\.tmp$|\.lock$/.test(f));
  } catch (_e) {
    return [" readdir 失败 "];
  }
})();
if (stuck.status !== 0) {
  bad("PD-05 锁没在死进程手里被夺回来 —— 设备会被永久钉成离线", "exit=" + stuck.status + " " + String(stuck.stderr || "").slice(0, 140));
} else if (!stuckRows || !stuckRows["phone-stuck"]) {
  bad("PD-05 夺锁之后新证据没记上", JSON.stringify(stuckRows && Object.keys(stuckRows).slice(0, 8)));
} else if (leftovers.length) {
  bad("PD-05 跑完之后目录里留着锁/临时文件（下一次回合要先扫一遍才能写）", leftovers.join(","));
} else {
  ok("PD-05 拿锁进程被杀掉后，下一次回合能把锁夺回来继续记账，且不留临时文件");
}

/* ---------- PD-06 「慢但还活着」的持锁者不许被抢锁 ---------- *
 * 旧实现只看锁目录的年龄（>5s 就当作死锁抢过来）。高负载下（整条矩阵在跑的时候）
 * 一个正在读-改-写的进程完全可能超过 5 秒还没写完，于是第二个进程抢锁进临界区，
 * 两边同时读同一份旧内容再各自整行写回 —— 证据丢了，而两个进程都以为成功。
 * 227e4ed 那轮矩阵里 PD-01 就是这样偶发丢 2/12 条、且子进程零报错。
 */
const root6 = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-presence-live-"));
const file6 = presence.presenceFile(root6);
const HOLD_MS = 6000; // 必须大于 LOCK_STALE_MS(5000)，才能证明「只看年龄」会误判
const HOLDER_CODE =
  "const p=require(process.argv[1]);const fs=require('fs');const path=require('path');" +
  "const f=p.presenceFile(process.argv[2]);" +
  "fs.mkdirSync(path.dirname(f),{recursive:true});" +
  "let ac=0,rel=0;" +
  "p.withPresenceLock(f,function(){ac=Date.now();" +
  "require('child_process').spawnSync('sleep',[String(Number(process.argv[3])/1000)]);});" +
  "rel=Date.now();" +
  "process.stdout.write(JSON.stringify({acquired_at:ac,released_at:rel}));";
const WAITER_CODE =
  "const p=require(process.argv[1]);const fs=require('fs');const path=require('path');" +
  "const f=p.presenceFile(process.argv[2]);" +
  "fs.mkdirSync(path.dirname(f),{recursive:true});" +
  "const st=Date.now();let ac=0;" +
  "p.withPresenceLock(f,function(){ac=Date.now();});" +
  "process.stdout.write(JSON.stringify({started_at:st,acquired_at:ac}));";

const holder = (() => {
  const h = spawn(process.execPath, ["-e", HOLDER_CODE, MODULE, root6, String(HOLD_MS)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  h.stdout.on("data", (b) => (out += String(b)));
  h.stderr.on("data", (b) => (out += "[err]" + String(b)));
  return new Promise((res) => h.on("exit", (code) => res({ code, out })));
})();
await new Promise((r) => setTimeout(r, 400));
const waiter = await new Promise((res) => {
  const w = spawn(process.execPath, ["-e", WAITER_CODE, MODULE, root6], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BITBOT_PRESENCE_LOCK_MS: "20000" },
  });
  let out = "";
  w.stdout.on("data", (b) => (out += String(b)));
  w.stderr.on("data", (b) => (out += "[err]" + String(b)));
  w.on("exit", (code) => res({ code, out }));
});
const h6 = await holder;
const ho = (() => { try { return JSON.parse(h6.out); } catch { return null; } })();
const wo = (() => { try { return JSON.parse(waiter.out); } catch { return null; } })();
const leftover6 = (() => {
  try { return fs.readdirSync(path.dirname(file6)).filter((f) => /\.lock$|\.tmp$/.test(f)); } catch (_e) { return ["readdir 失败"]; }
})();
if (!ho || !wo) {
  bad("PD-06 夹具没跑出可比的时间戳（这条不算验过）", JSON.stringify({ holder: h6.out.slice(0, 160), waiter: waiter.out.slice(0, 160) }));
} else if (h6.code !== 0 || waiter.code !== 0) {
  bad("PD-06 持锁/等锁的进程非零退出（等锁的那个大概是超时放弃了记账）", JSON.stringify({ holderExit: h6.code, waiterExit: waiter.code, waiter: waiter.out.slice(0, 160) }));
} else if (ho.released_at - ho.acquired_at < HOLD_MS - 500) {
  bad("PD-06 夹具本身没锁住那么久（这条不算验过）", JSON.stringify(ho));
} else if (wo.acquired_at < ho.released_at) {
  bad(
    "PD-06 活着的持锁者被抢走了锁：两个进程同时进临界区 = 高负载下丢证据",
    "等待方 " + wo.acquired_at + " 就进来了，持有方 " + ho.released_at + " 才出来（早了 " + (ho.released_at - wo.acquired_at) + "ms）",
  );
} else if (leftover6.length) {
  bad("PD-06 跑完还留着锁/临时文件", leftover6.join(","));
} else {
  ok("PD-06 活着的持锁者没被抢锁：等待方 " + (wo.acquired_at - ho.released_at) + "ms 之后才进临界区（互斥成立）");
}

/* ---------- PD-07 释放锁只能释放自己的锁 ---------- *
 * 被误判为死锁的那个进程醒来时，锁目录已经是新主人的了。这时候无条件 rmdir
 * 等于把第三个进程放进同一个临界区 —— 抢锁事故会连锁。所以锁里必须有身份，
 * 释放时必须能分辨「这把锁还是不是我的」。
 */
const root7 = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-presence-own-"));
const file7 = presence.presenceFile(root7);
const lock7 = file7 + ".lock";
const OWNER_CODE =
  "const p=require(process.argv[1]);const fs=require('fs');const path=require('path');" +
  "const f=p.presenceFile(process.argv[2]);const lock=f+'.lock';" +
  "fs.mkdirSync(path.dirname(f),{recursive:true});" +
  "let sawOwner=false;" +
  "p.withPresenceLock(f,function(){const op=path.join(lock,'owner.json');" +
  "if(fs.existsSync(op)){sawOwner=true;" +
  "fs.writeFileSync(op,JSON.stringify({pid:process.pid+1000000,host:require('os').hostname()," +
  "token:'someone-else',started_at:new Date().toISOString()}));}});" +
  "process.stdout.write(JSON.stringify({owner_file:sawOwner}));";
const own = spawnSync(process.execPath, ["-e", OWNER_CODE, MODULE, root7], {
  encoding: "utf8",
  timeout: 30000,
});
const oo = (() => { try { return JSON.parse(own.stdout || ""); } catch { return null; } })();
const lockStillThere = (() => { try { return fs.statSync(lock7).isDirectory(); } catch (_e) { return false; } })();
if (own.status !== 0) {
  bad("PD-07 夹具进程非零退出（这条不算验过）", "exit=" + own.status + " " + String(own.stderr || "").slice(0, 160));
} else if (!oo) {
  bad("PD-07 夹具没给出 owner 信息（这条不算验过）", String(own.stdout || "").slice(0, 160));
} else if (!oo.owner_file) {
  bad("PD-07 锁里没有持有者身份文件，释放时无法分辨是不是自己的锁", "预期 <lock>/owner.json 存在");
} else if (lockStillThere) {
  ok("PD-07 别人的锁没被删：身份不匹配时释放只撤销自己的临界区，不动新主人的锁");
} else {
  bad("PD-07 醒来把新主人的锁 rmdir 了（连锁抢锁：第三个进程能同时进临界区）", "owner.json 已被改成别人，锁目录却没了");
}
try {
  fs.rmSync(lock7, { recursive: true, force: true });
} catch (_e) {
  /* 本来就没有 */
}
try {
  fs.rmSync(root6, { recursive: true, force: true });
  fs.rmSync(root7, { recursive: true, force: true });
} catch (_e) {
  /* 临时目录清不掉不影响红绿 */
}

console.log(
  "prove_presence_durability: 残留（诚实）— 只验到「同一台机器上多进程并发 + 崩溃窗口」这一层；" +
    "跨机器时钟漂移、只读文件系统、Windows 文件锁语义未覆盖。",
);
done();
