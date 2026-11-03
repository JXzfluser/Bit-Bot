"use strict";
/**
 * prove_cn_connection_strategy.js — A3-3 连接策略门禁（红 → 绿）
 *
 * 验收（路线 A · W4 · A3-3 · AC-T4-5）：客户端「直连优先、失败自动回落中转」，
 * 界面能显示连接方式（直连/中转）与延迟。本门把这段纯逻辑抽成可重复门禁：
 *
 *   - 直连候选按序探测，任一可达即用直连（mode=direct），且**不**去碰中转；
 *   - 直连全不可达时回落中转（mode=relay），directTried 留下真实失败记录；
 *   - 多候选按优先级逐个试，前一个挂、后一个通就选后一个；
 *   - 全不可达且无中转 → ok:false / mode:none（诚实离线，绝不假装直连）；
 *   - describeMode 回「直连/中转 · Nms」给界面用。
 *
 * 设计铁律「先红后绿」：红态下模块不存在，本门干净 FAIL 汇总（非 require 崩溃）。
 * EV-3 是「变异敏感」断言：若有人去掉回落逻辑，EV-3 会从 relay 变 none 而转红——
 * 这正是本门要钉死的「失败必须回落」行为，不是可选项。
 *
 * 跑法：node scripts/prove_cn_connection_strategy.js
 * 用真实 socket（live listener + 已关闭端口）跑，不依赖 Docker / 显示环境。
 */
const net = require("net");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const MOD = path.join(REPO, "hosts", "shared", "connection_strategy.js");

let PASS = 0,
  FAIL = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : ""));
};
const done = () => {
  console.log("prove_cn_connection_strategy: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
};

let cs = null;
try {
  cs = require(MOD);
} catch (_) {
  cs = null;
}

const TIMEOUT = 400;

// 起一个真实可达的 TCP listener，返回 { port, srv }
function startLive() {
  return new Promise((resolve) => {
    const srv = net.createServer((s) => s.on("data", () => {}));
    srv.listen(0, "127.0.0.1", () => resolve({ port: srv.address().port, srv }));
  });
}

// 拿一个「确定关闭」的端口：绑 0 → 取端口 → 关闭；之后连它应得 ECONNREFUSED
function getClosedPort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

(async () => {
  const live = [];
  try {
    /* EV-1 模块存在且导出齐全 */
    if (!cs || typeof cs.resolveConnection !== "function") {
      bad("EV-1 connection_strategy 模块存在且导出 resolveConnection/describeMode/parseEndpoint", "红：模块未实现");
    } else if (typeof cs.describeMode !== "function" || typeof cs.parseEndpoint !== "function") {
      bad("EV-1 导出齐全（resolveConnection/describeMode/parseEndpoint）", "缺 describeMode 或 parseEndpoint");
    } else {
      ok("EV-1 connection_strategy 模块存在且导出 resolveConnection/describeMode/parseEndpoint");
    }

    if (!cs || typeof cs.resolveConnection !== "function") {
      bad("EV-2 直连可达选直连且不碰中转", "红：模块未实现");
      bad("EV-3 直连不可达回落中转", "红：模块未实现");
      bad("EV-4 多候选按优先级逐个试", "红：模块未实现");
      bad("EV-5 describeMode 回「直连/中转」+延迟", "红：模块未实现");
      bad("EV-6 全不可达且无中转→诚实离线（mode=none）", "红：模块未实现");
      done();
      return;
    }

    /* EV-2 直连可达 → 选直连，且 relayTried 为 null（没回落） */
    {
      const d = await startLive();
      const r = await startLive();
      live.push(d, r);
      const res = await cs.resolveConnection({
        directCandidates: ["127.0.0.1:" + d.port],
        relay: "127.0.0.1:" + r.port,
        timeoutMs: TIMEOUT,
      });
      if (!res || res.mode !== "direct" || res.endpoint !== "127.0.0.1:" + d.port)
        bad("EV-2 直连可达应选直连", JSON.stringify(res));
      else if (!(Number.isFinite(res.latencyMs) && res.latencyMs >= 0))
        bad("EV-2 直连应记录延迟", JSON.stringify(res));
      else if (res.relayTried)
        bad("EV-2 直连成功后不应再碰中转", "relayTried=" + JSON.stringify(res.relayTried));
      else ok("EV-2 直连可达选直连（mode=direct, latency=" + Math.round(res.latencyMs) + "ms，未回落）");
    }

    /* EV-3 直连不可达 + 中转可达 → 回落中转（变异敏感：去掉回落会变 none） */
    {
      const closed = await getClosedPort();
      const r = await startLive();
      live.push(r);
      const res = await cs.resolveConnection({
        directCandidates: ["127.0.0.1:" + closed],
        relay: "127.0.0.1:" + r.port,
        timeoutMs: TIMEOUT,
      });
      const directFailed = Array.isArray(res && res.directTried) && res.directTried.some((t) => t && t.ok === false);
      if (!res || res.mode !== "relay")
        bad("EV-3 直连不可达应回落中转（mode=relay）", JSON.stringify(res));
      else if (!directFailed)
        bad("EV-3 应留下直连失败记录（directTried.ok=false）", JSON.stringify(res && res.directTried));
      else if (!(res.relayTried && res.relayTried.ok))
        bad("EV-3 应记录中转成功", JSON.stringify(res && res.relayTried));
      else ok("EV-3 直连不可达回落中转（directTried 有失败 → relayTried.ok）");
    }

    /* EV-4 多候选：第一个挂、第二个通 → 选第二个直连 */
    {
      const closed = await getClosedPort();
      const good = await startLive();
      live.push(good);
      const res = await cs.resolveConnection({
        directCandidates: ["127.0.0.1:" + closed, "127.0.0.1:" + good.port],
        relay: null,
        timeoutMs: TIMEOUT,
      });
      if (!res || res.mode !== "direct" || res.endpoint !== "127.0.0.1:" + good.port)
        bad("EV-4 多候选应按优先级试到第二个", JSON.stringify(res));
      else if (!Array.isArray(res.directTried) || res.directTried.length < 2)
        bad("EV-4 directTried 应记录两次尝试", JSON.stringify(res && res.directTried));
      else ok("EV-4 多候选按优先级逐个试（第 1 个失败 → 第 2 个成功）");
    }

    /* EV-5 describeMode 回「直连/中转」+ 延迟（AC-T4-5 界面显示） */
    {
      const d = cs.describeMode && cs.describeMode({ mode: "direct", latencyMs: 12 }, "zh");
      const rl = cs.describeMode && cs.describeMode({ mode: "relay", latencyMs: 40 }, "zh");
      const en = cs.describeMode && cs.describeMode({ mode: "direct", latencyMs: 12 }, "en");
      const hasZh = typeof d === "string" && d.includes("直连") && /ms|毫秒/.test(d);
      const hasZhRelay = typeof rl === "string" && rl.includes("中转") && /ms|毫秒/.test(rl);
      const hasEn = typeof en === "string" && /Direct/i.test(en) && /ms/.test(en);
      if (!hasZh)
        bad("EV-5 describeMode(direct,zh) 应含「直连」+ 延迟", String(d));
      else if (!hasZhRelay)
        bad("EV-5 describeMode(relay,zh) 应含「中转」+ 延迟", String(rl));
      else if (!hasEn)
        bad("EV-5 describeMode(direct,en) 应含 Direct + ms", String(en));
      else ok("EV-5 describeMode 回「直连/中转 · Nms」（zh: " + d + " / " + rl + "；en: " + en + "）");
    }

    /* EV-6 全不可达且无中转 → 诚实离线，不造假 */
    {
      const c1 = await getClosedPort();
      const c2 = await getClosedPort();
      const res = await cs.resolveConnection({
        directCandidates: ["127.0.0.1:" + c1, "127.0.0.1:" + c2],
        relay: null,
        timeoutMs: TIMEOUT,
      });
      if (!res || res.ok !== false || res.mode !== "none")
        bad("EV-6 全不可达且无中转应回 ok:false/mode:none", JSON.stringify(res));
      else if (!Array.isArray(res.directTried) || res.directTried.length < 2)
        bad("EV-6 应记录所有直连尝试", JSON.stringify(res && res.directTried));
      else ok("EV-6 全不可达且无中转→诚实离线（ok:false, mode=none，试过 " + res.directTried.length + " 个候选）");
    }

    done();
  } catch (e) {
    bad("门禁内部异常", String((e && e.stack) || e).slice(0, 200));
    done();
  } finally {
    for (const l of live) {
      try {
        l.srv.close();
      } catch (_) {}
    }
  }
})();
