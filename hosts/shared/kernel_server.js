"use strict";

/**
 * T1-07 —— 常驻内核进程：一次 spawn，多回合复用。
 *
 * 取代的是「每个回合 spawn 一次 `moon run cmd/desktop_turn`」：群聊一轮 3 个 Bot
 * 就是 3 个进程，再加回合内的 `--apply-host-results` 回灌还要第 4 个。内核本身没有
 * 跨回合的可变状态（回合上下文全走 argv），所以进程可以留着。
 *
 * 行协议（与 cmd/desktop_turn/serve_protocol.mbt 一一对应）：
 *   请求 = `id ␟ argv[0] ␟ argv[1] ␟ …\n`
 *   响应 = `id ␟ <回合 JSON 单行>\n`
 * `argv[0]` 是程序名占位：内核取用户文本时会跳过第 0 位（和 spawn 时
 * `@env.args()` 带着程序名保持一致），所以这里由本模块统一补上，调用方只管传
 * 「本来要交给 spawn 的那个 args 数组」。
 *
 * 一个内核进程一次只做一个回合（native 循环是单线程的），所以并发靠**池**：
 * 最多 `size` 个常驻进程，满了就排队。池的意义是「不再按回合数 spawn」，
 * 不是「比 spawn 更快」。
 *
 * 崩溃：进程退出（或被超时 SIGKILL）时，在途的那条请求如实失败，并带上
 * `kernel_in_flight`（回合身份 + 原始 argv），槽位从池里摘掉；下一个请求会重新
 * 起一个进程。重启不是「悄悄再来一次」—— 中断的回合必须有名字。
 */

const { spawn } = require("child_process");
const path = require("path");

const US = "\u001f";
const FFI_PREFIX = "BITBOT_FFI ";
const LOOP_PREFIX = "BITBOT_LOOP ";

/**
 * 与内核 `decode_serve_token` 严格互逆：先按 encodeHostArg 的规矩转义
 * `\` / `\n` / `\t`，再把裸的 `\u001f` 写成 6 个字符 —— 内核是**先按裸分隔符
 * 切分、后解转义**，所以裸分隔符只可能是字段边界。
 */
function encodeServeToken(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\u001f/g, "\\u001f");
}

function buildServeRequest(id, argv) {
  return [String(id)].concat((argv || []).map(encodeServeToken)).join(US);
}

/** 一行响应 → `{id, json}`；没有裸分隔符就不是响应帧。 */
function decodeServeFrame(line) {
  const i = line.indexOf(US);
  if (i < 0) return null;
  return { id: line.slice(0, i), json: line.slice(i + 1) };
}

/**
 * @param {{
 *   kernelExe: string,
 *   prefix?: string[],             spawn 时排在 --serve 之前的参数（moon run 那一串）
 *   cwd?: string,
 *   env?: object | () => object,
 *   size?: number,                 常驻池上限
 *   argv0?: string,                请求里的程序名占位
 *   onCrash?: (info) => void,      崩溃时收到在途回合的标记
 * }} options
 */
function createKernelServer(options = {}) {
  const kernelExe = options.kernelExe;
  if (!kernelExe) throw new Error("kernel_server: kernelExe is required");
  const prefix = options.prefix || [];
  const cwd = options.cwd;
  const resolveEnv =
    typeof options.env === "function"
      ? options.env
      : () => options.env || process.env;
  const size = Math.max(
    1,
    Number(options.size || process.env.BITBOT_KERNEL_RESIDENT_SIZE || 4),
  );
  const argv0 =
    options.argv0 || path.basename(String(kernelExe).split(/[\\/]/).pop());
  const onCrash = typeof options.onCrash === "function" ? options.onCrash : null;

  const slots = [];
  const waiters = [];
  let seq = 0;
  let spawns = 0;
  let restarts = 0;
  let stopping = false;

  function settle(slot, err, value) {
    const req = slot.req;
    if (!req) return;
    slot.req = null;
    if (req.timer) clearTimeout(req.timer);
    release(slot);
    if (err) req.reject(err);
    else req.resolve(value);
  }

  /**
   * 回合结束 = 槽位可以给别人。**同步**交接：排队的人拿到的是同一个进程，
   * 不再 spawn。slot 已经死了（崩溃/超时被摘掉）就不许再往外发。
   */
  function release(slot) {
    if (stopping || slot.dead) {
      slot.busy = false;
      return;
    }
    const w = waiters.shift();
    if (w) {
      slot.busy = true;
      w.resolve(slot);
      return;
    }
    slot.busy = false;
  }

  function inFlightOf(slot) {
    const req = slot.req;
    if (!req) return null;
    return {
      request_id: req.id,
      turn_id: req.turnId || "",
      argv: req.argv,
      started_at: req.startedAt,
      waited_ms: Date.now() - req.startedAt,
    };
  }

  function crashError(slot, reason, code, signal) {
    const inFlight = inFlightOf(slot);
    const err = new Error(
      "kernel_" +
        reason +
        " (pid=" +
        slot.pid +
        (inFlight
          ? " in_flight=" +
            inFlight.request_id +
            (inFlight.turn_id ? " turn=" + inFlight.turn_id : "")
          : "") +
        ")",
    );
    err.kernel_reason = reason;
    err.kernel_pid = slot.pid;
    err.kernel_exit_code = code === undefined ? null : code;
    err.kernel_signal = signal || "";
    err.kernel_restarted = true;
    err.kernel_in_flight = inFlight;
    err.kernel_spawns = spawns;
    err.kernel_restarts = restarts;
    if (onCrash && inFlight) {
      try {
        onCrash({
          pid: slot.pid,
          reason,
          code,
          signal,
          in_flight: inFlight,
          restarts,
          stderr_tail: slot.stderr.slice(-2000),
        });
      } catch (_) {
        /* 崩溃记录不许把 Host 一起带下去 */
      }
    }
    return err;
  }

  function dropSlot(slot) {
    slot.dead = true;
    slot.busy = false;
    const i = slots.indexOf(slot);
    if (i >= 0) slots.splice(i, 1);
    // 排队的人等的就是「有一个能用的槽位」：就地补一个，不必等它自己排到。
    const w = waiters.shift();
    if (w && !stopping) {
      try {
        const fresh = makeSlot();
        fresh.busy = true;
        w.resolve(fresh);
      } catch (err) {
        w.reject(err);
      }
    }
  }

  function takeStdoutLine(slot, line) {
    const req = slot.req;
    if (line.startsWith(FFI_PREFIX)) {
      if (!req) {
        slot.orphans.push(line);
        return;
      }
      const payload = line.slice(FFI_PREFIX.length);
      req.chain = req.chain.then(async () => {
        let res;
        try {
          res = await req.onFfi(JSON.parse(payload));
        } catch (err) {
          res = {
            content: "",
            calls: [],
            output: "",
            verdict: "deny",
            error: String((err && err.message) || err),
          };
        }
        const stdin = slot.proc.stdin;
        if (stdin && !stdin.destroyed && !slot.dead && slot.req === req) {
          stdin.write(JSON.stringify(res) + "\n");
        }
      });
      return;
    }
    const frame = decodeServeFrame(line);
    if (!frame) {
      // 既不是 FFI 也不是响应帧：计下来给诊断看，绝不当成结果。
      slot.noise.push(line);
      return;
    }
    if (!req) {
      slot.orphans.push(line);
      return;
    }
    if (frame.id !== req.id) {
      /* 帧对不上 = 这个进程的节奏和 Host 不一致了（多半是有请求写进去却没结算，
         比如超时后进程还活着）。留着它只会把下一条也搞乱，直接摘掉。 */
      const err = Object.assign(
        new Error(
          "kernel_frame_mismatch (want=" + req.id + " got=" + frame.id + ")",
        ),
        {
          kernel_reason: "frame_mismatch",
          kernel_pid: slot.pid,
          kernel_in_flight: inFlightOf(slot),
          kernel_restarted: true,
        },
      );
      restarts += 1;
      dropSlot(slot);
      settle(slot, err);
      if (slot.proc) slot.proc.kill("SIGKILL");
      return;
    }
    settle(slot, null, {
      stdout: frame.json + "\n",
      stderr: slot.stderr,
      entry: req.entry,
      kernelOps: req.kernelOps,
      pid: slot.pid,
      resident: true,
      noise: slot.noise.length,
      orphans: slot.orphans.length,
    });
  }

  function onStdoutChunk(slot, chunk) {
    slot.buf += chunk.toString();
    let nl = slot.buf.indexOf("\n");
    while (nl >= 0) {
      const line = slot.buf.slice(0, nl).replace(/\r$/, "");
      slot.buf = slot.buf.slice(nl + 1);
      takeStdoutLine(slot, line);
      nl = slot.buf.indexOf("\n");
    }
  }

  function onStderrChunk(slot, chunk) {
    const text = chunk.toString();
    slot.stderr += text;
    if (slot.stderr.length > 200000) slot.stderr = slot.stderr.slice(-100000);
    slot.errBuf += text;
    let nl = slot.errBuf.indexOf("\n");
    while (nl >= 0) {
      const line = slot.errBuf.slice(0, nl).replace(/\r$/, "").trim();
      slot.errBuf = slot.errBuf.slice(nl + 1);
      nl = slot.errBuf.indexOf("\n");
      const req = slot.req;
      if (!req || !line.startsWith(LOOP_PREFIX)) continue;
      if (line === LOOP_PREFIX + "entry=AgentLoop::run") req.entry = true;
      else if (line.startsWith(LOOP_PREFIX + "op=")) {
        req.kernelOps.push(line.slice((LOOP_PREFIX + "op=").length).trim());
      }
      if (req.onLoop) {
        try {
          req.onLoop(line);
        } catch (_) {
          /* 投影不许打断回合 */
        }
      }
    }
  }

  function makeSlot() {
    if (stopping) throw new Error("kernel_server is stopping");
    const proc = spawn(String(kernelExe), prefix.concat(["--serve"]), {
      cwd,
      env: resolveEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    spawns += 1;
    const slot = {
      proc,
      pid: proc.pid,
      req: null,
      busy: false,
      buf: "",
      errBuf: "",
      stderr: "",
      noise: [],
      orphans: [],
      dead: false,
    };
    slots.push(slot);
    proc.stdout.on("data", (chunk) => onStdoutChunk(slot, chunk));
    proc.stderr.on("data", (chunk) => onStderrChunk(slot, chunk));
    proc.on("error", (err) => {
      if (slot.dead) return;
      err.kernel_reason = "spawn_error";
      err.kernel_pid = slot.pid;
      err.kernel_in_flight = inFlightOf(slot);
      err.kernel_restarted = false;
      settle(slot, err);
      dropSlot(slot);
    });
    proc.on("close", (code, signal) => {
      if (slot.dead) return;
      // 有回合在途 = 崩溃；空闲时退出 = 关停（stop() 关 stdin 后内核自己收摊）。
      const hadTurn = Boolean(slot.req);
      if (hadTurn) restarts += 1;
      /* 旧内核二进制不认 --serve：它把这一行当普通参数跑了一轮，输出的 JSON
         没有响应帧的前缀，然后正常退出。这必须报成「这个内核不会服务」而不是
         「内核崩了」—— 两者的处置方式完全不同（换二进制 vs 查崩溃）。
         判断放在 `close` 而不是 `exit`：exit 时 stdout 可能还没读完，那行没有帧
         前缀的 JSON 还在管道里，就会被当成「没有噪音」→ 误报成 crashed。 */
      const unframed = slot.noise.some((l) => l.startsWith("{") && l.endsWith("}"));
      const reason =
        hadTurn && code === 0 && signal === null && unframed
          ? "not_serving"
          : "crashed";
      const err = hadTurn ? crashError(slot, reason, code, signal) : null;
      dropSlot(slot);
      if (err) settle(slot, err);
    });
    return slot;
  }

  /**
   * 取一个槽位。**同步**占用（busy 立刻置真）—— 只在 `await` 之后才标记的话，
   * 同一批并发请求会在各自的微任务里都看到「这个槽位还空着」，然后把两条请求
   * 写进同一个进程（实测：`kernel_frame_mismatch want=k7 got=k4`）。
   */
  function acquire() {
    for (const s of slots) {
      if (!s.dead && !s.busy) {
        s.busy = true;
        return Promise.resolve(s);
      }
    }
    if (slots.length < size) {
      try {
        const fresh = makeSlot();
        fresh.busy = true;
        return Promise.resolve(fresh);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
  }

  /**
   * 一个回合。返回形状与 run_moon_turn.js 的 `pumpMoonFfi` 对齐，调用方可以在
   * 常驻 / 每轮直起两种模式之间无痛切换。
   *
   * @param {string[]} argv 本要交给 spawn 的那个 args 数组（不含程序名）
   * @param {{ onFfi: Function, onLoop?: Function, timeoutMs?: number, turnId?: string }} hooks
   */
  async function request(argv, hooks = {}) {
    if (stopping) throw new Error("kernel_server is stopping");
    const slot = await acquire();
    const id = "k" + ++seq;
    const timeoutMs = hooks.timeoutMs || 180000;
    const req = {
      id,
      argv,
      turnId: hooks.turnId || "",
      onFfi: typeof hooks.onFfi === "function" ? hooks.onFfi : async () => ({}),
      onLoop: typeof hooks.onLoop === "function" ? hooks.onLoop : null,
      startedAt: Date.now(),
      chain: Promise.resolve(),
      entry: false,
      kernelOps: [],
      timer: null,
    };
    slot.req = req;
    slot.noise = [];
    slot.orphans = [];
    const settled = new Promise((resolve, reject) => {
      req.resolve = resolve;
      req.reject = reject;
    });
    req.timer = setTimeout(() => {
      restarts += 1;
      const err = crashError(slot, "timeout", null, "");
      /* 超时的进程不能再交给下一个人：它可能正卡在同一个地方。
         先摘槽位（排队的人由此拿到一个新进程），再结算、再 SIGKILL。 */
      dropSlot(slot);
      settle(slot, err);
      if (slot.proc) slot.proc.kill("SIGKILL");
    }, timeoutMs);
    const line = buildServeRequest(id, [argv0].concat(argv || []));
    try {
      slot.proc.stdin.write(line + "\n");
    } catch (err) {
      const e = Object.assign(
        new Error(
          "kernel_write_failed: " + (err && err.message ? err.message : err),
        ),
        { kernel_reason: "write_failed", kernel_pid: slot.pid },
      );
      dropSlot(slot);
      settle(slot, e);
    }
    return settled;
  }

  function stats() {
    return {
      spawns,
      restarts,
      resident: slots.length,
      busy: slots.filter((s) => s.busy).length,
      queued: waiters.length,
      size,
      pids: slots.map((s) => s.pid),
      // 谁在做回合：崩溃重启的证明要指名到进程，只给个数说不清「在途」是谁。
      slots: slots.map((s) => ({
        pid: s.pid,
        busy: Boolean(s.busy),
        request_id: s.req ? s.req.id : "",
      })),
      requests: seq,
      noise: slots.reduce((n, s) => n + s.noise.length, 0),
      orphans: slots.reduce((n, s) => n + s.orphans.length, 0),
    };
  }

  /** 关 stdin 让内核自己退出（native 循环见 EOF 即收摊），不做 SIGKILL。 */
  async function stop() {
    stopping = true;
    const pending = slots.slice();
    slots.length = 0;
    for (const s of pending) {
      s.dead = true;
      settle(
        s,
        Object.assign(new Error("kernel_server_stopping"), {
          kernel_reason: "stopping",
          kernel_pid: s.pid,
          kernel_in_flight: inFlightOf(s),
        }),
      );
      if (s.proc && s.proc.stdin && !s.proc.stdin.destroyed) s.proc.stdin.end();
    }
    for (const w of waiters.splice(0)) {
      // 排队的人拿到的是 reject —— resolve(null) 会让它下一句 `slot.req =` 炸掉。
      w.reject(new Error("kernel_server is stopping"));
    }
    await Promise.all(
      pending.map(
        (s) =>
          new Promise((resolve) => {
            if (!s.proc || s.proc.exitCode !== null || s.proc.signalCode) return resolve();
            s.proc.once("exit", () => resolve());
            s.proc.once("close", () => resolve());
          }),
      ),
    );
    return stats();
  }

  return { request, stats, stop, size };
}

module.exports = {
  createKernelServer,
  encodeServeToken,
  buildServeRequest,
  decodeServeFrame,
  SERVE_FIELD_SEP: US,
};
