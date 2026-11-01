/* prove_kernel_resident.mjs — T1-07 常驻内核进程门禁
 *
 * 需求原文（docs/next-target-requirements.md）：
 *   T1-07 | 内核常驻进程（行协议复用），替代每轮 spawn | — | 1d |
 *           群聊 3 Bot 进程创建 = 0；崩溃自动重启并标记在途回合
 *
 * 「替代每轮 spawn」是可以数出来的，所以这里全部数给你看：
 *   KR-01 内核真的会服务：--serve 起来，一行请求换一行响应
 *   KR-02 常驻模式 3 回合 = 1 次进程创建（Host 自己数的 spawn = 0）
 *   KR-03 反向对照（同一份代码关掉常驻）：3 回合 = 6 次 spawn —— 数出来的
 *          是「常驻省掉了什么」，不是「计数器坏了」
 *   KR-04 群聊 3 Bot 走真实扇出：预热一轮填满池，稳态那一轮进程创建 = 0（AC 原句）。
 *          回话内容不在这里断言 —— 本机没配供应商密钥时回合会如实失败，
 *          这条门量的是「三条回合都在同一批常驻进程上跑完」
 *   KR-05 崩溃自动重启，且在途回合被标记到具体的 turn（reject 的 error + Host 的
 *          onCrash 回调两处都点名，不是悄悄重试）
 *   KR-06 旧内核二进制不认 --serve → 如实报「这个内核不会服务」，不静默挂死
 *   KR-07 常驻不改变语义：同一份 argv，两条路产出的回合 JSON 归一后相同
 *   KR-08 池上限与排队：4 个并发压 2 个槽位，全部落回结果，不多起进程
 *   KR-09 关停干净：stop() 之后**本门禁起过的**内核一个都不留（别人家的进程另行报告）
 *   KR-10 桌面宿主确实默认打开这条路径（结构锚点：默认值写在 runner 创建之前，
 *          退出两级钩子都在，且有 BITBOT_KERNEL_RESIDENT=0 的回退口）
 *   KR-11 常驻模式下 CLI 宿主一轮之后要把终端还回来：`node hosts/cli_host/run_turn.js`
 *          打完那一行 JSON 必须自己退出、且不留常驻内核 —— 桌面已把常驻设成默认，
 *          任何继承这份环境的一次性 CLI（含 routines daemon 每轮真的敲的那行）
 *          不关池就永远不退。反向对照：现做一个「故意不关池」的同型进程，必须卡住
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
const ok = (id, msg) => { console.log(`ok ${id} — ${msg}`); pass += 1; };
const bad = (id, msg) => { console.log(`FAIL ${id} — ${msg}`); fail += 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROFILE = process.env.BITBOT_KERNEL_BUILD || "release";
const BIN_DIR = path.join(ROOT, "_build", "native", PROFILE, "build", "cmd", "desktop_turn");
const BIN = ["desktop_turn", "desktop_turn.exe"]
  .map((n) => path.join(BIN_DIR, n))
  .find((p) => fs.existsSync(p));

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-kr-"));
process.env.BITBOT_NO_SECRET_SYNC = "1";

/** 回合 JSON 里会变的字段抹掉，只比语义。 */
function normalize(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return "__NOTJSON__:" + String(text).slice(0, 160);
  }
  const drop = ["turn_id", "at", "created_at", "updated_at", "task_sig", "session_id"];
  const scrub = (o) => {
    if (Array.isArray(o)) return o.map(scrub);
    if (o && typeof o === "object") {
      const out = {};
      for (const k of Object.keys(o)) out[k] = drop.includes(k) ? "<volatile>" : scrub(o[k]);
      return out;
    }
    if (typeof o === "string") return o.replace(/\b[0-9a-f]{8,}\b/g, "<id>");
    return o;
  };
  return JSON.stringify(scrub(d));
}

function countServeProcs() {
  if (!BIN) return { count: 0, pids: [], error: "no bin" };
  const r = spawnSync("pgrep", ["-f", BIN + " --serve"], { encoding: "utf8" });
  if (r.error) return { count: 0, pids: [], error: r.error.message };
  const pids = String(r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return { count: pids.length, pids };
}

const { createKernelServer, buildServeRequest, encodeServeToken } = require(
  path.join(ROOT, "hosts/shared/kernel_server.js")
);
const { createTurnRunner } = require(path.join(ROOT, "hosts/shared/run_moon_turn.js"));

const US = String.fromCharCode(0x1f);
const TEXTS = ["ListMachines", "remember favorite_color=green", "list connectors"];

async function main() {
  console.log("== 运行时 == node " + process.version + "；profile=" + PROFILE);
  if (!BIN) {
    bad("KR-00", "找不到内核二进制（" + BIN_DIR + "）—— 先跑 moon build --target native" +
      (PROFILE === "release" ? " --release" : ""));
    return;
  }
  ok("KR-00", "内核二进制就位：" + path.relative(ROOT, BIN));

  /* ---- KR-01 裸进程证明协议：不让 Host 替内核说话 ---- */
  {
    const line = buildServeRequest("p1", ["desktop_turn", "ListMachines"]);
    const r = spawnSync(BIN, ["--serve"], {
      cwd: DATA,
      input: line + "\n",
      encoding: "utf8",
      timeout: 30000,
    });
    const out = String(r.stdout || "").split("\n").filter(Boolean);
    const framed = out.filter((l) => l.indexOf(US) > 0);
    const ready = String(r.stderr || "").indexOf("serve=ready") >= 0;
    if (framed.length === 1 && framed[0].indexOf("p1" + US + "{") === 0 && ready && r.status === 0) {
      ok("KR-01", "--serve：一行请求换一行带 id 的响应，stderr 报 serve=ready，stdin 关闭后进程自己收摊（exit 0）");
    } else {
      bad("KR-01", "协议没立住：" + JSON.stringify({ status: r.status, out: out.slice(0, 2),
        stderr: String(r.stderr || "").slice(0, 200) }));
    }
  }
  /* ---- 同一份三句话，分别在「常驻」和「每轮 spawn」两条路上跑 ---- */
  const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 24);
  async function runSeries(tag, resident, texts, dataRoot) {
    const prev = process.env.BITBOT_KERNEL_RESIDENT;
    if (resident) process.env.BITBOT_KERNEL_RESIDENT = "1";
    else delete process.env.BITBOT_KERNEL_RESIDENT;
    const runner = createTurnRunner(ROOT, { dataRoot, kernelBin: BIN });
    const results = [];
    for (const text of texts) {
      let r;
      try {
        r = await runner.runTurn(text, {
          botId: "kr-bot",
          sessionId: "kr-" + tag,
          turnId: "kr-" + tag + "-" + slug(text),
          timeoutMs: 45000,
        });
      } catch (e) {
        r = { ok: false, threw: true, error: String((e && e.message) || e) };
      }
      results.push({ text, r });
    }
    const info = {
      localSpawns: runner.localSpawns(),
      stats: runner.kernelStats(),
      flag: runner.resident(),
      crashes: runner.kernelCrashes(),
      results,
    };
    await runner.stopKernel();
    if (prev === undefined) delete process.env.BITBOT_KERNEL_RESIDENT;
    else process.env.BITBOT_KERNEL_RESIDENT = prev;
    return info;
  }
  const sig = (r) => normalize(
    JSON.stringify({
      ok: r.ok,
      intent: r.intent,
      text: r.text,
      intents: r.intents,
      effects: r.effects,
      continued: Boolean(r.host_continued),
      ops: (r.loop_trace && r.loop_trace.kernel_ops) || null,
    })
  );

  /* ---- KR-02 常驻：3 回合 = 1 次进程创建，Host 自己一次 spawn 都没做 ---- */
  let residentRun;
  {
    residentRun = await runSeries("res", true, TEXTS, path.join(DATA, "ws-res"));
    const pids = residentRun.results.map((x) => x.r.loop_trace && x.r.loop_trace.kernel_pid);
    const samePid = new Set(pids.filter(Boolean)).size === 1;
    const reqs = residentRun.stats ? residentRun.stats.requests : -1;
    if (
      residentRun.flag === true &&
      residentRun.localSpawns === 0 &&
      residentRun.stats &&
      residentRun.stats.spawns === 1 &&
      samePid &&
      residentRun.results.every((x) => x.r.ok !== false)
    ) {
      ok("KR-02", "常驻 3 回合：Host 侧 spawn=" + residentRun.localSpawns +
        "，池侧进程创建=" + residentRun.stats.spawns + "，请求=" + reqs +
        "，全程同一个 pid=" + pids[0] + "（回合都 ok）");
    } else {
      bad("KR-02", JSON.stringify({
        flag: residentRun.flag, localSpawns: residentRun.localSpawns,
        stats: residentRun.stats && { spawns: residentRun.stats.spawns, requests: residentRun.stats.requests },
        pids, errs: residentRun.results.map((x) => x.r.error).filter(Boolean),
      }));
    }
  }

  /* ---- KR-03 反向对照：同一份代码关掉常驻，进程创建立刻回到 N 次 ---- */
  let legacyRun;
  {
    legacyRun = await runSeries("leg", false, TEXTS, path.join(DATA, "ws-leg"));
    if (
      legacyRun.flag === false &&
      legacyRun.stats === null &&
      legacyRun.localSpawns >= TEXTS.length
    ) {
      ok("KR-03", "反向对照（常驻关闭）：3 回合 = " + legacyRun.localSpawns +
        " 次 spawn、常驻池=null —— KR-02 的 0 是省出来的，不是数不出来");
    } else {
      bad("KR-03", JSON.stringify({
        flag: legacyRun.flag, stats: legacyRun.stats,
        localSpawns: legacyRun.localSpawns, need: TEXTS.length,
      }));
    }
  }
  /* ---- KR-07 语义不变：同一句话，常驻前后产出同一份回合结果 ---- */
  {
    const diff = [];
    for (let i = 0; i < TEXTS.length; i++) {
      const a = sig(residentRun.results[i].r);
      const b = sig(legacyRun.results[i].r);
      if (a !== b) diff.push({ text: TEXTS[i], resident: a.slice(0, 300), legacy: b.slice(0, 300) });
    }
    if (diff.length === 0) {
      ok("KR-07", "同一批 " + TEXTS.length + " 句话：常驻与每轮 spawn 的归一结果逐条相同（换进程不换语义）");
    } else {
      bad("KR-07", "有 " + diff.length + " 条结果不一致：" + JSON.stringify(diff[0]));
    }
  }

  /* ---- KR-04 群聊 3 Bot 一轮：AC 原句「进程创建 = 0」（预热后的稳态） ---- */
  {
    const roomRoot = path.join(DATA, "room");
    const dir = path.join(roomRoot, "data", "desktop");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "bots.json"), JSON.stringify({
      version: 1, primary_id: "g1",
      bots: [
        { id: "g1", name: "Alpha", job: "research", description: "d", hidden: false },
        { id: "g2", name: "Bravo", job: "write", description: "d", hidden: false },
        { id: "g3", name: "Charlie", job: "review", description: "d", hidden: false },
      ],
    }));
    fs.writeFileSync(path.join(dir, "rooms.json"), JSON.stringify({
      version: 1,
      rooms: [{ id: "room-kr", title: "KR Room", members: ["g1", "g2", "g3"], created_at: "t", transcript: [] }],
    }));
    process.env.BITBOT_KERNEL_RESIDENT = "1";
    const runner = createTurnRunner(ROOT, { dataRoot: path.join(DATA, "ws-room"), kernelBin: BIN });
    const surface = require(path.join(ROOT, "hosts/desktop/product_surface.js")).createProductSurface(roomRoot);
    // 每个应答回合走的是**产品那条扇出路径**（orchestrateRoom → runResponderTurn），
    // 这里只是把内核侧的痕迹记下来，供断言「这三条回合真的在同一个池里跑完」。
    let traces = [];
    const runResponderTurn = (botId, prompt, ctx) => runner.runTurn(prompt, {
      botId,
      sessionId: "kr-room-" + botId,
      turnId: "kr-room-" + botId,
      timeoutMs: 45000,
      channel: (ctx && ctx.channel) || undefined,
    }).then((r) => {
      traces.push({
        bot_id: botId, ok: r.ok, error: r.error || "",
        resident: Boolean(r.loop_trace && r.loop_trace.resident),
        pid: (r.loop_trace && r.loop_trace.kernel_pid) || null,
        ops: ((r.loop_trace && r.loop_trace.kernel_ops) || []).length,
      });
      return r;
    });
    const fanout = (label) => {
      traces = [];
      const base = { spawn: runner.localSpawns(), proc: runner.kernelStats().spawns, req: runner.kernelStats().requests };
      return surface.orchestrateRoom({
        room: "room-kr", task: "各自用一句话介绍自己负责的部分 " + label, to: "g1,g2,g3", force: true,
        deps: { runResponderTurn, timeoutMs: 45000 },
      }).then((out) => {
        const st = runner.kernelStats();
        return { out, traces: traces.slice(),
          spawnDelta: runner.localSpawns() - base.spawn,
          procDelta: st.spawns - base.proc,
          reqDelta: st.requests - base.req,
          pids: st.pids.slice() };
      });
    };
    // 第一轮是预热：池从空到有，3 个并发必然要起 3 个进程 —— AC 说的「进程创建 = 0」
    // 量的是填满之后的稳态，所以把第一轮和第二轮分开数，不拿第一轮充数。
    const warm = await fanout("warm");
    const measured = await fanout("measured");
    const poolPids = new Set(measured.pids);
    const allResident = measured.traces.length === 3 &&
      measured.traces.every((t) => t.resident === true && poolPids.has(t.pid) && t.ops >= 3);
    if (
      warm.out.ok === true && warm.out.total === 3 &&
      measured.out.ok === true && measured.out.total === 3 &&
      measured.spawnDelta === 0 && measured.procDelta === 0 &&
      measured.reqDelta === 3 && allResident
    ) {
      const replies = measured.out.returned + "/" + measured.out.total;
      const modelNote = measured.out.returned === 0
        ? "（回话全失败是因为本机没配供应商密钥：" + String(measured.traces[0].error).slice(0, 40) + "…，" +
          "但三条回合确实跑到了内核并回齐 op 序列，进程数这条量到的就是 0）"
        : "";
      ok("KR-04", "群聊 3 Bot 稳态一轮：进程创建=" + measured.procDelta + "、Host spawn=" +
        measured.spawnDelta + "、请求=" + measured.reqDelta + " 条全部由同一批 pid 服务（" +
        measured.pids.join(",") + "），returned=" + replies + modelNote);
    } else {
      bad("KR-04", JSON.stringify({
        warm: { procDelta: warm.procDelta, total: warm.out.total, returned: warm.out.returned, error: warm.out.error },
        measured: { spawnDelta: measured.spawnDelta, procDelta: measured.procDelta,
          reqDelta: measured.reqDelta, total: measured.out.total, returned: measured.out.returned,
          error: measured.out.error, pids: measured.pids },
        allResident, traces: measured.traces,
      }));
    }
    await runner.stopKernel();
    delete process.env.BITBOT_KERNEL_RESIDENT;
  }
  /* ---- KR-05 崩溃自动重启，且在途回合被标记到具体的 turn ---- */
  {
    let crashSeen = null;
    const srv = createKernelServer({
      kernelExe: BIN,
      cwd: DATA,
      size: 1,
      // Host 侧的「标记在途回合」必须能从回调里读到，不只是藏在 reject 的 error 上。
      onCrash: (info) => { crashSeen = info; },
    });
    let ffiPid = null;
    const ffiArrived = new Promise((resolve) => {
      const hook = async () => {
        if (!ffiPid) {
          ffiPid = srv.stats().slots.filter((s) => s.busy).map((s) => s.pid)[0];
          resolve();
        }
        return new Promise(() => {}); // 永不回灌：内核正卡在等 stdin，此刻杀它最干净
      };
      srv._hook = hook;
    });
    const victimTurn = "kr05-in-flight";
    const pending = srv.request(
      ["--turn-id", victimTurn, "--bot-id", "kr-bot", "随便聊两句"],
      { turnId: victimTurn, onFfi: srv._hook, timeoutMs: 60000 },
    ).then(
      (r) => ({ resolved: true, pid: r.pid }),
      (e) => ({
        resolved: false, reason: e.kernel_reason, pid: e.kernel_pid,
        restarted: e.kernel_restarted, in_flight: e.kernel_in_flight,
        spawns_at_crash: e.kernel_spawns, message: e.message,
      }),
    );
    await ffiArrived;
    const spawnsBefore = srv.stats().spawns;
    if (!ffiPid) throw new Error("KR-05 找不到在途进程");
    process.kill(ffiPid, "SIGKILL");
    const crash = await pending;
    const after = await srv.request(["ListMachines"], { onFfi: async () => ({}) });
    const st = srv.stats();
    if (
      crash.resolved === false &&
      crash.reason === "crashed" &&
      crash.in_flight &&
      crash.in_flight.turn_id === victimTurn &&
      crash.in_flight.request_id &&
      Array.isArray(crash.in_flight.argv) &&
      st.restarts >= 1 &&
      crashSeen &&
      crashSeen.in_flight &&
      crashSeen.in_flight.turn_id === victimTurn &&
      crashSeen.pid === ffiPid &&
      after.resident === true &&
      after.pid !== ffiPid &&
      st.spawns === spawnsBefore + 1
    ) {
      ok("KR-05", "杀掉在途进程 pid=" + ffiPid + "：该回合如实失败（reason=" + crash.reason +
        ", turn=" + crash.in_flight.turn_id + "），Host 回调同样点名到 pid=" + crashSeen.pid +
        " 的这条回合，重启计数=" + st.restarts +
        "，下一回合由新 pid=" + after.pid + " 正常完成（进程创建 " + spawnsBefore + "→" + st.spawns + "）");
    } else {
      bad("KR-05", JSON.stringify({ crash, crashSeen, spawnsBefore, stats: st, afterPid: after.pid }));
    }
    await srv.stop();
  }

  /* ---- KR-06 旧内核不认 --serve：如实报「这个内核不会服务」，不挂死 ---- */
  {
    const fake = path.join(DATA, "legacy_kernel.sh");
    fs.writeFileSync(
      fake,
      ["#!/bin/sh", "echo '{\"v\":1,\"ok\":true,\"note\":\"legacy one-shot\"}'", "exit 0", ""].join("\n"),
      { mode: 0o755 },
    );
    const srv = createKernelServer({ kernelExe: fake, cwd: DATA, size: 1 });
    const t0 = Date.now();
    let got = null;
    try {
      await srv.request(["ListMachines"], { onFfi: async () => ({}), timeoutMs: 15000 });
      got = "resolved";
    } catch (e) {
      got = e.kernel_reason || e.message;
    }
    const ms = Date.now() - t0;
    if (got === "not_serving" && ms < 10000) {
      ok("KR-06", "喂给它一个不认 --serve 的旧内核：" + got + "（" + ms + "ms 内如实失败，没有静默挂死；" +
        "和 KR-05 的 crashed 是两种结论 —— 一个换二进制，一个查崩溃）");
    } else {
      bad("KR-06", "期望 kernel_reason=not_serving，实得 " + JSON.stringify({ got, ms }));
    }
    await srv.stop();
  }
  /* ---- KR-08 池上限与排队：4 个并发压 2 个槽位，全落回且不多起进程 ---- */
  {
    const srv = createKernelServer({ kernelExe: BIN, cwd: DATA, size: 2 });
    const jobs = [1, 2, 3, 4].map((i) => srv.request(
      ["--bot-id", "kr" + i, "ListMachines"],
      { onFfi: async () => ({}), turnId: "kr08-" + i, timeoutMs: 60000 },
    ));
    const settled = await Promise.allSettled(jobs);
    const st = srv.stats();
    const okCount = settled.filter((s) => s.status === "fulfilled").length;
    const pids = new Set(settled.filter((s) => s.status === "fulfilled").map((s) => s.value.pid));
    if (okCount === 4 && st.spawns <= 2 && st.queued === 0 && pids.size <= 2 && st.resident >= 1) {
      ok("KR-08", "4 并发 / 池上限 2：全部落回=" + okCount + "/4，进程创建=" + st.spawns +
        "，实际 pid 只有 " + pids.size + " 个（" + [...pids].join(",") + "），排队已清空（queued=" + st.queued + "）");
    } else {
      bad("KR-08", JSON.stringify({ okCount, spawns: st.spawns, queued: st.queued, resident: st.resident,
        pids: [...pids], errs: settled.filter((s) => s.status === "rejected").map((r) => String(r.reason.message)) }));
    }

    /* ---- KR-09 关停干净：stop() 之后自己起过的内核一个都不留 ---- */
    const mine = srv.stats().pids.slice();
    const foreign = countServeProcs().pids
      .map(Number)
      .filter((p) => !mine.some((m) => Number(m) === p));
    await srv.stop();
    await sleep(400);
    const aliveMine = mine.filter((pid) => {
      try { process.kill(Number(pid), 0); return true; } catch { return false; }
    });
    const afterStop = countServeProcs();
    if (mine.length >= 1 && aliveMine.length === 0) {
      ok("KR-09", "stop() 前本门禁持有 " + mine.length + " 个常驻内核（" + mine.join(",") +
        "），stop() 后全部退出；pgrep 全盘残留=" + afterStop.count +
        (foreign.length ? "（" + foreign.join(",") + " 是别人家的进程，不计在本门禁账上）" : ""));
    } else {
      bad("KR-09", JSON.stringify({ mine, aliveMine, afterStop: afterStop.pids }));
    }
  }

  /* ---- KR-10 桌面宿主的默认值真的接得上（结构锚点，不是开机实测） ----
     KR-02/04 证的是「开了开关之后 AC 成立」；这一条证的是「桌面宿主自己会把开关
     打开，而且打开的时机在 runner 被创建之前」—— run_moon_turn.js 是在
     createTurnRunner() 里读这个环境变量的，写在后面就等于没写。
     反向对照同一条里现做：把赋值挪到调用之后，检查器必须翻红，否则锚点恒真。 */
  {
    const mainSrc = fs.readFileSync(path.join(ROOT, "hosts/desktop/main.js"), "utf8");
    const order = (src) => {
      const setIdx = src.indexOf('process.env.BITBOT_KERNEL_RESIDENT = "1"');
      const useIdx = src.indexOf("createTurnRunner(REPO_ROOT");
      if (setIdx < 0) return "no_default";
      if (useIdx < 0) return "no_runner_call";
      return setIdx < useIdx ? "ok" : "too_late";
    };
    const syntheticLate =
      'const runner = createTurnRunner(REPO_ROOT, {});\nprocess.env.BITBOT_KERNEL_RESIDENT = "1";';
    const quitHooks =
      /before-quit[\s\S]{0,400}stopResidentKernel\(\)/.test(mainSrc) &&
      /will-quit[\s\S]{0,900}killResidentKernel\(\)/.test(mainSrc);
    const optOut = mainSrc.indexOf("BITBOT_KERNEL_RESIDENT=0") >= 0;
    if (order(mainSrc) === "ok" && order(syntheticLate) === "too_late" && quitHooks && optOut) {
      ok("KR-10", "桌面宿主默认常驻：默认值写在 createTurnRunner 之前（同一检查器把「写在之后」的样本判成 too_late），" +
        "before-quit/will-quit 都挂了关停钩子，退出可 BITBOT_KERNEL_RESIDENT=0 回老行为");
    } else {
      bad("KR-10", JSON.stringify({
        real: order(mainSrc), synthetic: order(syntheticLate), quitHooks, optOut,
      }));
    }
  }

  /* ---- KR-11 一次性 CLI 在常驻模式下必须把终端还回来 ----
     W1 收口数出来的进程泄漏（report.md §8.58.4 / GP-204）真因在这里：桌面把常驻
     设成默认（hosts/desktop/main.js:55），凡是继承这份环境的一次性 CLI
     —— 包括 scripts/host_routine_daemon.sh 每一轮真的敲的那行
     `node hosts/cli_host/run_turn.js "tick routines"` —— 打完 JSON 之后不关池，
     进程就永远不退：外层（daemon 循环 / 门禁 timeout）一被杀，就留下
     「node run_turn.js + moon --serve」两级孤儿。
     这条断的是用户看得见的一件事：敲下去，终端要回来，且不留看不见的内核。 */
  {
    const CLI = path.join(ROOT, "hosts/cli_host/run_turn.js");
    async function spawnWait(cmd, cmdArgs, { killAfterMs, env }) {
      const t0 = Date.now();
      const p = spawn(cmd, cmdArgs, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      p.stdout.on("data", (c) => { out += c.toString(); });
      p.stderr.on("data", (c) => { err += c.toString(); });
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        try { p.kill("SIGKILL"); } catch (_) {}
      }, killAfterMs);
      const st = await new Promise((resolve) => {
        p.once("exit", (code, signal) => resolve({ code, signal }));
      });
      clearTimeout(timer);
      return { ms: Date.now() - t0, killed, code: st.code, signal: st.signal, out, err, pid: p.pid };
    }
    const cliEnv = Object.assign({}, process.env, {
      BITBOT_KERNEL_RESIDENT: "1",
      BITBOT_KERNEL_BIN: BIN,
      BITBOT_NO_SECRET_SYNC: "1",
    });
    const serveBefore = countServeProcs();
    /* 起的是真 CLI 进程，它按自己的默认解析数据根（仓库 data/）—— 用的是
       ListMachines 这种只读意图，历史行只多不删，和门禁平时跑 CLI 的做法一致。 */
    const cli = await spawnWait(process.execPath, [CLI, "ListMachines"], {
      killAfterMs: 45000,
      env: cliEnv,
    });
    await sleep(600);
    const serveAfter = countServeProcs();
    let cliJson = null;
    try {
      cliJson = JSON.parse(String(cli.out).trim().split("\n").pop());
    } catch (_) {}

    /* 反向对照：同一段代码、同一个池，只把「关池」那一步删掉 —— 它必须卡住。
       没有这一半，上面的绿无法区分「CLI 真的会收尾」和「这里压根等不到挂死」。 */
    const noStop = path.join(DATA, "kr11-no-stop.js");
    fs.writeFileSync(noStop, [
      '"use strict";',
      "process.env.BITBOT_KERNEL_RESIDENT = \"1\";",
      "const { createTurnRunner } = require(" + JSON.stringify(path.join(ROOT, "hosts/shared/run_moon_turn.js")) + ");",
      "const runner = createTurnRunner(" + JSON.stringify(ROOT) + ", {",
      "  dataRoot: " + JSON.stringify(path.join(DATA, "ws-kr11")) + ",",
      "  kernelBin: " + JSON.stringify(BIN) + ",",
      "});",
      "runner.runTurn(\"ListMachines\", { sessionId: \"kr11-control\", turnId: \"kr11-control\", timeoutMs: 30000 })",
      "  .then((r) => { process.stdout.write(\"CONTROL_TURN_DONE ok=\" + (r.ok !== false) + \"\\n\"); })",
      "  .catch((e) => { process.stdout.write(\"CONTROL_TURN_DONE err=\" + String((e && e.message) || e) + \"\\n\"); });",
      "",
    ].join("\n"));
    const ctl = await spawnWait(process.execPath, [noStop], { killAfterMs: 12000, env: cliEnv });
    await sleep(300);
    const ctlLeft = countServeProcs();
    const ctlPrintedDone = ctl.out.indexOf("CONTROL_TURN_DONE") >= 0;

    if (cli.killed) {
      bad("KR-11", "CLI 宿主开常驻后没退出：跑到 " + cli.ms + "ms 上限被 SIGKILL（常驻池没关）。" +
        "那一轮其实已经打完 —— stdout " + cli.out.length + " 字节、回合 " +
        (cliJson && cliJson.ok === true ? "ok=true" : "没 ok") + "，卡的是退出。" +
        "用户看到的就是一条不返回的命令行，daemon 每轮 sweep 也卡在这里" +
        "（同型反向对照本次也照出：不关池的进程 " + ctl.ms + "ms 仍活着、" +
        "回合已完成=" + ctlPrintedDone + "）");
    } else if (cli.code !== 0 || !cliJson || cliJson.ok !== true) {
      bad("KR-11", "CLI 自己退了（" + cli.ms + "ms，exit=" + cli.code + " signal=" + cli.signal +
        "）但这一轮没成：" + JSON.stringify({
          out: String(cli.out).slice(0, 200), err: String(cli.err).slice(0, 200),
        }));
    } else if (serveAfter.count > serveBefore.count) {
      bad("KR-11", "CLI 退了（" + cli.ms + "ms）但把常驻内核留下来了：serve 进程 " +
        serveBefore.count + "→" + serveAfter.count + "（" + serveAfter.pids.join(",") + "）");
    } else if (!ctl.killed || !ctlPrintedDone) {
      bad("KR-11", "反向对照没立住：那个故意不关池的同型进程 " + ctl.ms + "ms 就退了（回合完成=" +
        ctlPrintedDone + "）—— 说明「不关池就永远不退」这个前提在这台机器上不成立，" +
        "上面那条 CLI 退出因此也证明不了什么，不能算绿");
    } else {
      ok("KR-11", "CLI 宿主开常驻跑完一轮：" + cli.ms + "ms 自己退出（exit 0、回合 ok=true、" +
        "stdout " + cli.out.length + " 字节一行 JSON），serve 进程 " + serveBefore.count + "→" +
        serveAfter.count + " 零残留；反向对照（同型进程删掉关池那一步）" + ctl.ms +
        "ms 时回合已打完仍不退，被本门禁 SIGKILL —— 绿色是量出来的");
    }
    if (ctlLeft.count > serveBefore.count) {
      console.log("  · 注：SIGKILL 反向对照后仍有 " + ctlLeft.count + " 个 serve 进程（" +
        ctlLeft.pids.join(",") + "）—— 对照进程是被强杀的，内核靠管道 EOF 收摊需要一点时间；" +
        "不计在 CLI 账上，KR-09 已单独量过关停干净");
    }
  }
}

const cleanup = () => {
  if (fail === 0) {
    try { fs.rmSync(DATA, { recursive: true, force: true }); return; } catch (_) {}
  }
  console.log("（现场保留在 " + DATA + "）");
};

await main().catch(async (e) => {
  bad("KR-!!", "门禁自身异常：" + ((e && e.stack) || e));
});
cleanup();
console.log("\n== KR summary: pass=" + pass + " fail=" + fail + " ==");
if (fail !== 0) {
  console.log("常驻内核未达标 —— 桌面宿主已默认常驻，撤回：启动前设 BITBOT_KERNEL_RESIDENT=0");
  process.exit(1);
}
console.log("T1-07 达成：群聊 3 Bot 一轮零进程创建，崩溃自动重启并点名在途回合");
process.exit(0);
