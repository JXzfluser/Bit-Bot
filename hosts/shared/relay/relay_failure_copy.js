"use strict";
/**
 * relay_failure_copy.js — 把「盒子连不上 relay」说成人话（A3-8 / §5⑫）
 *
 * 起点是真机启动日志里的一行：
 *
 *   [relay-box] reverse failed: transport endpoint=127.0.0.1:18765
 *
 * 三个毛病，都会把现场带到错的地方：
 *  1. 只给 `transport` 四个字，分不清「relay 没起 / 端口没放通 / DNS 不通 / 曾经连上又被踢」；
 *  2. `endpoint=127.0.0.1:18765` 在 reverse 下**只是展示字段、从不被连接**，
 *     真正连不上的是 relay 的 host:port。照这行去查，会去 ping 一个刚才还回 200 的端口；
 *  3. 每 2s 一条、永不收敛，日志被刷爆，真正有用的那行反而被淹掉。
 *
 * 这里只做两件纯函数的事，**不碰协议、不碰重连节奏**（不做指数退避是刻意设计：
 * relay 还没起来时要能快速恢复，见 relay_box_client.js 文件头）。
 *
 *  - describeFailure：错误码 → 中文原因 + 该查什么；
 *  - createFailureLog：同一类连续失败收敛成一条（首次详报、之后每隔 N 次一行汇总、
 *    恢复时清账并报一条「已恢复」），但**绝不把第一次失败吞掉**。
 */

const REASON_HINT = {
  "not-configured": "配置没写全（host / port / box_id / box_token 缺项），或入站端口没起来",
  denied: "中转不认这把凭证：检查 box_token 与 relay 的 BITBOT_RELAY_SECRET 是不是同一套",
  badreg: "中转拒了登记：检查 box_id 与登记格式",
  badcmd: "中转回了看不懂的应答：两边版本可能不一致",
  bad_config: "登记地址格式不合法（应为 host:port）",
  transport: "网络层没连通",
};

/** errno → 人话 + 下一步。未知 errno 也不许退化成「未知错误」就完事。 */
const CODE_HINT = {
  ECONNREFUSED: "目标拒绝连接 —— relay 进程没起，或 18766 端口没监听",
  ETIMEDOUT: "连接/握手超时 —— 安全组、端口映射或路由没放通 18766",
  EHOSTUNREACH: "主机不可达 —— relay 地址写错，或这台机器到不了那个网段",
  ENETUNREACH: "网络不可达 —— 检查本机网络与路由",
  ENOTFOUND: "域名解析不了 —— relay 的 host 写错或 DNS 不通",
  EAI_AGAIN: "域名解析临时失败 —— 稍后重试或改用 IP",
  ECONNRESET: "连接被重置 —— 曾连上又断开（relay 重启 / NAT 映射过期 / 控制通道被切）",
  EPIPE: "连接已断 —— relay 重启或链路被中间设备切断",
  EACCES: "本机不允许这个连接 —— 检查防火墙/沙箱策略",
};

/**
 * 单条失败 → 一段可直接写进日志的中文。
 * @param {string} reason  REASON_* 取值（不变，门禁靠它分类）
 * @param {object|null} detail relay_box_client 给的结构化细节
 * @param {object} [ctx] { endpoint, endpointIsDisplayOnly }
 */
function describeFailure(reason, detail, ctx) {
  const d = detail || {};
  const parts = [];
  const base = REASON_HINT[reason] || "登记失败";
  parts.push(base);

  if (reason === "transport") {
    // 真正被连接的目标是 detail.target。绝不拿 endpoint 冒充失败点。
    const target = d.target || "relay";
    const code = String(d.code || "").toUpperCase();
    const hint = CODE_HINT[code] || "连接失败（relay 侧 errno 未上报）";
    parts.push(`目标 ${target}`);
    if (code) parts.push(`errno=${code}`);
    parts.push(hint);
    if (d.phase === "bound") parts.push("（此前已 BIND 成功，属于掉线重连，不是配置错）");
  } else if (d.target) {
    parts.push(`relay=${d.target}`);
  }

  // 纯函数自己也要截断：不能假设调用方一定先经过 detailOf 的 scrub ——
  // UI 以后会直接拿它渲染，门也会直接喂长错误串（FC-05 实测 500 字原样吐出）。
  if (d.message && reason === "transport") {
    parts.push(`原始信息：${String(d.message).split("\n")[0].slice(0, 160)}`);
  }

  // 明确点破那个最容易查错方向的字段，而不是悄悄不写 —— 不写也会有人去翻旧日志。
  if (ctx && ctx.endpointIsDisplayOnly && ctx.endpoint) {
    parts.push(`注：endpoint=${ctx.endpoint} 只是展示字段，reverse 下从不被连接，不用查它`);
  }
  return parts.join(" · ");
}

/**
 * 连续同类失败的日志收敛器。
 *
 * 判据必须锚「变化」：第一次必须详报；之后每 repeatEvery 次打一行汇总（带累计次数与
 * 持续秒数，不丢信息）；一旦 reason/target/code 变了立刻重新详报；恢复时清账。
 * 不许把「从未失败」和「收敛成功」混为一谈 —— 这两者都表现为「没有日志」。
 *
 * @param {object} opts { write(line), now(), repeatEvery }
 */
function createFailureLog(opts) {
  const write = (opts && opts.write) || (() => {});
  const now = (opts && opts.now) || (() => Date.now());
  const repeatEvery = Math.max(1, Number((opts && opts.repeatEvery) || 10));
  // 不许写死 2s：调用方可以改 reconnectMs，日志说「每次 2s 重试」而实际 8s 就是骗人。
  // 没传就不猜，直接不写这段（宁可少说，不可说错）。
  const reconnectMs = Number(opts && opts.reconnectMs);
  let sig = "";
  let count = 0;
  let firstAt = 0;
  let emitted = 0;
  let recovered = 0;

  function onFailure(reason, detail, ctx) {
    const d = detail || {};
    const nextSig = [reason, d.target || "", d.code || "", d.phase || ""].join("|");
    if (nextSig !== sig) {
      sig = nextSig;
      count = 0;
      firstAt = now();
    }
    count++;
    if (count === 1) {
      emitted++;
      write(`[relay-box] 登记失败：${describeFailure(reason, detail, ctx)}`);
      return { emitted: true, suppressed: 0 };
    }
    if (count % repeatEvery === 0) {
      emitted++;
      const secs = Math.max(0, Math.round((now() - firstAt) / 1000));
      const retryText = Number.isFinite(reconnectMs) && reconnectMs > 0
        ? `，每 ${(reconnectMs / 1000).toFixed(1).replace(/\.0$/, "")}s 重试`
        : "";
      write(`[relay-box] 仍在失败：同上原因已连续 ${count} 次 / ${secs}s（目标 ${d.target || "relay"}${retryText}）；原因不变不再逐条打印`);
      return { emitted: true, suppressed: count - 1 };
    }
    return { emitted: false, suppressed: count - 1 };
  }

  function onRecover(detail) {
    if (!sig) return { emitted: false };
    const n = count;
    const secs = Math.max(0, Math.round((now() - firstAt) / 1000));
    sig = "";
    count = 0;
    firstAt = 0;
    recovered++;
    emitted++;
    write(`[relay-box] 已恢复：${(detail && detail.target) || "relay"} 登记成功（此前失败 ${n} 次 / ${secs}s）`);
    return { emitted: true, wasFailing: n > 0 };
  }

  function stats() {
    return { currentStreak: count, emitted, recovered, suppressed: Math.max(0, count - emitted) };
  }

  return { onFailure, onRecover, stats };
}

module.exports = { describeFailure, createFailureLog, REASON_HINT, CODE_HINT };
