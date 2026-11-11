/* e2e_desktop_sidebar_diff.mjs — KP-07 可感面：一条长回复流式写入时，侧栏不整列闪动、滚动不跳
 *
 * 需求原话（docs/grok-desktop-parity/kernel-mechanism-parity.md:144-146）：
 *   「sessions-changed 不再 sessions.list() 全量重发，改发 {surface, entity_id,
 *    changed_fields}；… 一条长回复流式写入时，侧栏不再整列闪动、滚动位置不跳。」
 *
 * 这一门断的是**用户看得见的那一半**，纯计算的形状由 prove_broadcast_diff.js 管：
 *   KD-01 一次真回合里，侧栏 Bot 行**一个 DOM 节点都没被摘掉**（ MutationObserver 数 removed 的 .agent-item），
 *         且原有行逐个还是当初那个节点（WeakMap 身份标记逐个对上）——防「一拆一建」把数量瞒过去
 *   KD-02 滚动位置不动（#agents 是唯一的滚动列，清空重画会把 scrollTop 拉回 0）
 *   KD-03 会话弹层同理：行不重建，且被改那一行的预览**真的换新值**（不是靠"不更新"骗过 KD-01）
 *   KD-04 收到的广播是 diff（mode=surface/rev 齐、changed 只点名该点的那一行），不是整份
 *   KD-05 diff 的字节数 < 同一份 store 上**实测到的整份广播字节数**（拿 KD-08 关 diff 那一趟的真数，
 *         不是手搓的近似量级）
 *   KD-06 reload 之后（渲染端缓存没了）来一条 diff → 必须自愈成整份重画，改名照样上屏
 *   KD-07 结构性大改（一次建 3 个会话）→ 行数与真值一致，不吞行
 *   KD-08 【负向对照，真 app】把 BITBOT_BROADCAST_DIFF=0 再跑一遍同样的回合 →
 *         广播必须退回整份（KD-08a/b：这一趟一条 diff 都不该有）。翻不了红说明断言是空的。
 *         KD-08c 如实记老路径的整份字节数，KD-05 的比价就用这份真数。
 *         为什么这一趟侧栏不闪、scrollTop 也不动：闪不闪还取决于渲染端有没有复用节点
 *         （那是第二条机制，由 KD-10c 的注入负责）；而老路径同步「清空 + 立刻重建」，
 *         空布局那一帧不会交给合成器，80ms 采样间滚动早就恢复了 —— 实测两趟滚动都待在 180。
 *   KD-09 「换组」这种结构性改动：diff 只点名那一行，渲染端**用本地缓存重画**（零次取整份 IPC），
 *         组头与行数都对得上真值 —— 证明兜底重画不是偷偷回去读盘。
 *   KD-10 非广播的重画路径（refreshBots 整份刷新 / refreshSessions）同样不拆列；
 *         KD-10c 是渲染层的负向对照：页内把 paintBots 换回 KP-07 之前的「清空 + 逐行新建」，
 *         同一条判据必须立刻翻红 —— 侧栏不闪有两条机制（广播发 diff、重画复用节点），
 *         总闸只管前一条，后一条只能这样验。
 *
 * 纪律：isolatedRepoRoot（夹具写进临时根的 data/desktop，绝不碰用户 data/）+
 *       独立 user-data-dir + BITBOT_NO_SECRET_SYNC=1；跑完关进程、清临时根。
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import {
  electronLaunchEnv,
  electronUserDataDir,
  gateAppEnv,
  hasDisplay,
  isolatedRepoRoot,
  killGateProcs,
} from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const requirePw = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = requirePw("playwright-core");

let PASS = 0;
let FAIL = 0;
const ok = (m, d) => { PASS++; console.log("  ✓ " + m + (d ? " · " + d : "")); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const note = (m) => console.log("  · " + m);

function honestSkip(reason) {
  console.log("e2e_desktop_sidebar_diff: SKIP — " + reason);
  console.log("e2e_desktop_sidebar_diff: PASS=0 FAIL=0 SKIP=1（SKIP ≠ PASS）");
  process.exit(0);
}
if (!fs.existsSync(ELECTRON)) honestSkip("electron dist missing");
if (!hasDisplay()) honestSkip("no DISPLAY and no xvfb-run");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeoutMs, stepMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (_) { /* retry */ }
    await sleep(stepMs || 400);
  }
  return false;
}

/* ---------- 夹具：让侧栏真的溢出 + 会话多到能看出 diff 划算 ---------- */

const DAY = "2026-11-11T09:00:00.000Z";
const bots = [];
for (let i = 0; i < 14; i++) {
  bots.push({
    id: "kp07-bot-" + i,
    name: "KP07侧栏Bot " + i,
    job: "验收",
    description: "KP-07 diff 广播夹具",
    avatar: "",
    hidden: false,
    pinned: false,
    created_at: DAY,
    updated_at: new Date(Date.parse(DAY) - i * 60000).toISOString(),
    group: i < 4 ? "" : "验收组",
  });
}
const sessions = [];
for (let i = 0; i < 26; i++) {
  sessions.push({
    id: "kp07-sess-" + i,
    title: "KP07会话 " + i,
    created_at: DAY,
    updated_at: new Date(Date.parse(DAY) - i * 90000).toISOString(),
    messages: [
      { id: "msg-u" + i, role: "user", text: "第 " + i + " 条的旧问题", at: DAY },
      { id: "msg-a" + i, role: "assistant", text: "第 " + i + " 条的旧回答", at: DAY },
    ],
  });
}
// 每个 Bot 一个 DM 会话，侧栏次要行才有的可显（渲染层按 "<名> · DM" 关联）
for (const b of bots) {
  sessions.push({
    id: "kp07-dm-" + b.id,
    title: b.name + " · DM",
    created_at: DAY,
    updated_at: b.updated_at,
    messages: [{ id: "dm-u-" + b.id, role: "user", text: "旧的一条消息 " + b.name, at: DAY }],
  });
}
bots[0].pinned = true;

const root = isolatedRepoRoot(REPO, "sidebar-diff", {
  "bots.json": { version: 1, primary_id: bots[0].id, bots },
  "sessions.json": { version: 1, active_id: sessions[0].id, sessions },
});

const STUB_PORT = Number(process.env.KP07_STUB_PORT || 8821);
let stub = null;
function startStub() {
  stub = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BITBOT_STUB_PORT: String(STUB_PORT), BITBOT_STUB_LATENCY_FROM_TEXT: "1" },
  });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout")), 10000);
    stub.stdout.on("data", (d) => { if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(); } });
    stub.stderr.on("data", (d) => note("[stub] " + String(d).trim().slice(0, 120)));
    stub.on("error", rej);
  });
}

const storePath = (n) => path.join(root, "data/desktop", n);
const readStore = (n) => { try { return JSON.parse(fs.readFileSync(storePath(n), "utf8")); } catch { return null; } };
const lastText = (sid) => {
  const s = (readStore("sessions.json") || { sessions: [] }).sessions.find((x) => x.id === sid);
  const msgs = (s && s.messages) || [];
  return msgs.length ? String(msgs[msgs.length - 1].text || "") : "";
};
const previewOf = (sid) => {
  const s = (readStore("sessions.json") || { sessions: [] }).sessions.find((x) => x.id === sid);
  const msgs = ((s && s.messages) || []).map((m) => String(m.text || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return msgs.length ? msgs[msgs.length - 1].slice(0, 40) : "";
};

/** 一次真回合 + 观察者；diffOn=false 时同一套断言必须翻红（KD-08）。 */
async function runPass(diffOn) {
  const ud = electronUserDataDir("sidebar-diff-" + (diffOn ? "on" : "off"));
  const env = electronLaunchEnv(
    gateAppEnv(root, {
      BITBOT_BROADCAST_DIFF: diffOn ? "1" : "0",
      BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
      BITBOT_LLM_API_KEY: "kp07-stub-key",
      BITBOT_LLM_MODEL: "kp07-stub",
      BITBOT_EVENT_DUAL_WRITE: "0",
    }),
  );
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO,
    env,
    timeout: 120000,
  });
  const win = await app.firstWindow({ timeout: 60000 });
  await win.waitForSelector("#composer #text", { timeout: 60000 });
  await win.setViewportSize({ width: 1280, height: 420 }); // 侧栏非空即溢出，才谈得上"滚动不跳"
  // 侧栏默认折叠成头像条（G-28 #2）：折叠时 .agent-item 全在 DOM 里但不可见，
  // 先把分节展开，后面的节点身份/滚动断言量的才是用户真看得见的那一列。
  await win.evaluate(() => {
    const sec = document.getElementById("sb-bots-rooms");
    if (sec) sec.classList.remove("collapsed");
  });
  await win.waitForSelector("#bot-list .agent-item", { timeout: 60000 });

  // 观察者：数被摘掉/新建的行，记广播，记 scrollTop 轨迹
  await win.evaluate(() => {
    window.__kd = { rec: [], botRemoved: 0, botCreated: 0, sessRemoved: 0, sessCreated: 0, scroll: [] };
    const count = (list, delta) => {
      for (const n of list) {
        if (n.nodeType === 1 && n.classList && n.classList.contains("agent-item")) delta();
      }
    };
    // 两张面分开数：一列闪动不能替另一列背数（以前合在一起，Bot 侧的整列重画
    // 会把会话弹层的"没动"也一起染红，反过来也会互相掩盖）。
    for (const [sel, key] of [["#bot-list", "bot"], ["#session-list", "sess"]]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      new MutationObserver((mrs) => {
        for (const m of mrs) {
          count(m.removedNodes, () => { window.__kd[key + "Removed"]++; });
          count(m.addedNodes, () => { window.__kd[key + "Created"]++; });
        }
      }).observe(el, { childList: true });
    }
    if (window.bitbot.onBotsChanged) {
      window.bitbot.onBotsChanged((p) => {
        window.__kd.rec.push({ surface: "bots", mode: p && p.mode, rev: p && p.rev, bytes: JSON.stringify(p || {}).length, changed: (p && p.changed) || null });
      });
    }
    if (window.bitbot.onSessionsChanged) {
      window.bitbot.onSessionsChanged((p) => {
        window.__kd.rec.push({ surface: "sessions", mode: p && p.mode, rev: p && p.rev, bytes: JSON.stringify(p || {}).length, changed: (p && p.changed) || null });
      });
    }
    const ag = document.getElementById("agents");
    ag.scrollTop = 180;
    // 取整份的 IPC 次数：KD-01/09 要用它证明「界面更新没有偷偷回去读一份全量」
    window.__kd.reads = 0;
    if (window.bitbot && window.bitbot.surface && window.bitbot.surface.read) {
      const origRead = window.bitbot.surface.read;
      window.bitbot.surface.read = function () {
        window.__kd.reads++;
        return origRead.apply(this, arguments);
      };
    }
    window.__kd.scrollTimer = setInterval(() => {
      window.__kd.scroll.push(Math.round(ag.scrollTop));
      window.__kd.scrollBytes = ag.scrollHeight + "/" + ag.clientHeight;
    }, 80);
    // 给行打身份标记，回合结束再核对（节点身份 = 有没有被重建）
    window.__kd.tokens = new WeakMap();
    document.querySelectorAll("#bot-list .agent-item, #session-list .agent-item").forEach((el, i) => window.__kd.tokens.set(el, i));
    window.__kd.snapshotRows = Array.from(document.querySelectorAll("#bot-list .agent-item")).map((el) => ({
      tok: window.__kd.tokens.get(el),
      id: el.dataset.agentId,
      meta: ((el.querySelector(".meta") || {}).textContent || "").trim(),
    }));
  });

  const scrollStart = await win.evaluate(() => Math.round(document.getElementById("agents").scrollTop));
  // 弹层先打开一次，让 #session-list 真的被渲染（它在账户条弹层里，平时不画）
  await win.evaluate(() => {
    const btn = document.getElementById("ab-sessions-btn");
    if (btn) btn.click();
  });
  await win.waitForSelector("#sessions-popup #session-list .agent-item", { timeout: 30000 }).catch(() => {});
  await win.evaluate(() => {
    const rows = document.querySelectorAll("#session-list .agent-item");
    rows.forEach((el, i) => window.__kd.tokens.set(el, "s" + i));
    window.__kd.snapshotSessRows = Array.from(rows).map((el) => ({
      tok: window.__kd.tokens.get(el),
      id: el.dataset.sessionId,
      meta: ((el.querySelector(".meta") || {}).textContent || "").trim(),
      name: ((el.querySelector(".name") || {}).textContent || "").trim(),
    }));
  });
  await win.evaluate(() => document.getElementById("agents").scrollTo(0, 180));

  const targetBot = bots[0].name;
  const marker = "KP07流式验收 " + (diffOn ? "on" : "off");
  const sent = await (async () => {
    // 走进真发送路径：先点该 Bot 的行进私聊，再填输入框、点发送
    const clicked = await win
      .evaluate((nm) => {
        const row = Array.from(document.querySelectorAll("#bot-list .agent-item")).find(
          (el) => (((el.querySelector(".name") || {}).textContent || "")).includes(nm),
        );
        if (!row) return "";
        row.click();
        return row.dataset.agentId || "";
      }, targetBot)
      .catch(() => "");
    if (!clicked) return false;
    await sleep(1200);
    await win.evaluate((txt) => {
      const inp = document.getElementById("text");
      inp.value = txt;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }, marker + " [[lat:900]] 请把这句原样回一遍，越详细越好，用来把侧栏预览改掉");
    await win.click("#send", { timeout: 20000 });
    return true;
  })();
  if (!sent) {
    bad("KD-00 进不了私聊/发不出消息（" + (diffOn ? "diff 开" : "diff 关") + "）");
  } else {
    ok("KD-00 真发送：点 Bot 行 → 填输入框 → 点发送（" + (diffOn ? "diff 开" : "diff 关，负向对照") + "）");
  }

  // 等这一轮真的落库（最后一条消息文本变掉）
  const dmId = "kp07-dm-" + bots[0].id;
  const beforeLast = lastText(dmId);
  const landed = await waitUntil(() => lastText(dmId) !== beforeLast, 90000, 500);
  if (!landed) bad("KD-00b 回合没落库，后面几条断言无从判起（" + (diffOn ? "on" : "off") + "）");

  await sleep(2500); // 让收尾广播都到齐
  const out = await win.evaluate(() => {
    clearInterval(window.__kd.scrollTimer);
    const ag = document.getElementById("agents");
    const rows = Array.from(document.querySelectorAll("#bot-list .agent-item"));
    const sess = Array.from(document.querySelectorAll("#session-list .agent-item"));
    return {
      rec: window.__kd.rec,
      reads: window.__kd.reads,
      botRemoved: window.__kd.botRemoved,
      botCreated: window.__kd.botCreated,
      sessRemoved: window.__kd.sessRemoved,
      sessCreated: window.__kd.sessCreated,
      scrollMin: Math.min.apply(null, window.__kd.scroll.concat([ag.scrollTop])),
      scrollMax: Math.max.apply(null, window.__kd.scroll.concat([ag.scrollTop])),
      scrollEnd: Math.round(ag.scrollTop),
      scrollSize: ag.scrollHeight + "/" + ag.clientHeight,
      botRows: rows.map((el) => ({
        tok: window.__kd.tokens.get(el),
        id: el.dataset.agentId,
        meta: ((el.querySelector(".meta") || {}).textContent || "").trim(),
      })),
      snapshot: window.__kd.snapshotRows,
      sessRows: sess.map((el) => ({
        tok: window.__kd.tokens.get(el),
        id: el.dataset.sessionId,
        meta: ((el.querySelector(".meta") || {}).textContent || "").trim(),
        name: ((el.querySelector(".name") || {}).textContent || "").trim(),
      })),
      snapshotSess: window.__kd.snapshotSessRows,
    };
  });

  await app.evaluate(({ app: a }) => { a.isQuiting = true; a.quit(); }).catch(() => {});
  await Promise.race([app.close(), sleep(15000)]).catch(() => {});
  killGateProcs(ud);
  fs.rmSync(ud, { recursive: true, force: true });

  return { out, dmId, marker, landed, scrollStart };
}

/* 负向对照的统一口径：cond 是「机制关掉后仍然成立」——那说明这条断言没牙，判红；
 * 机制关掉就翻红（cond 为假）才是我们要的。机制有两种：广播层的总闸
 * （BITBOT_BROADCAST_DIFF=0，KD-08）与渲染层的 keyed 复用（页内注入老画法，KD-10c）。 */
const expect = (diffOn, name, cond, detail) => {
  if (diffOn) cond ? ok(name, detail) : bad(name, detail);
  else cond ? bad(name + "（负向对照：机制关掉它仍然成立 → 这条断言是空的）", detail)
            : ok(name + "（负向对照：机制关掉就翻红，断言有牙）", detail);
};

(async () => {
  try {
    try {
      await startStub();
      ok("S1 stub 起来（首字延迟由 [[lat:900]] 控制，回合会真的落库）");
    } catch (e) {
      honestSkip("stub cannot start: " + (e && e.message));
    }

  /* 负向对照先跑一趟：除了证明 KD-01/02 有牙，它还交出「关 diff 时整份广播实际多大」，
     KD-05 的比价用这份真数，不用手搓的近似量级。 */
  const off = await runPass(false);
  const o = off.out;
  const main = await runPass(true);
  const r = main.out;

  /* KD-01 一次回合里侧栏 Bot 行一个节点都没被摘掉，且原有行还是原节点 */
  expect(true, "KD-01a 一条长回复的回合里，侧栏 #bot-list 的 .agent-item 没有被摘掉任何一个（不整列闪动）",
    r.botRemoved === 0 && r.botCreated === 0, "removed=" + r.botRemoved + " created=" + r.botCreated + " reads=" + r.reads);
  const botTok = new Map((r.snapshot || []).map((x) => [x.id, x.tok]));
  const botKept = r.botRows.filter((x) => botTok.has(x.id));
  expect(true, "KD-01b 原有 Bot 行逐个仍是当初那个 DOM 节点（WeakMap 身份标记对上，防一拆一建蒙过计数）",
    botTok.size > 0 && botKept.length === botTok.size && botKept.every((x) => x.tok === botTok.get(x.id)),
    "原 " + botTok.size + " 行，身份对上 " + botKept.filter((x) => x.tok === botTok.get(x.id)).length + " 行");

  /* KD-02 scrollTop 全程不动 */
  const s0 = Number.isFinite(main.scrollStart) ? main.scrollStart : 180;
  expect(true, "KD-02 滚动位置不跳：#agents 的 scrollTop 全程待在原位",
    r.scrollMin >= s0 - 4 && r.scrollMax <= s0 + 4,
    "start=" + s0 + " min=" + r.scrollMin + " max=" + r.scrollMax + " size=" + r.scrollSize);

  /* KD-03 会话弹层：行不重建 + 被改那行真的换新值 */
  const sessSnap = new Map((r.snapshotSess || []).map((x) => [x.id, x]));
  const changedSess = r.sessRows.filter((x) => sessSnap.has(x.id));
  const identityKept = changedSess.every((x) => x.tok === sessSnap.get(x.id).tok);
  const dmPreview = previewOf(main.dmId);
  const dmRow = r.sessRows.find((x) => x.id === main.dmId);
  expect(true, "KD-03a 会话弹层的行同样是原节点，且一次回合里摘掉/新建都是 0",
    identityKept && r.sessRemoved === 0 && r.sessCreated === 0,
    "rows=" + changedSess.length + "/" + r.sessRows.length + " removed=" + r.sessRemoved + " created=" + r.sessCreated);
  expect(true, "KD-03b 被改那行的预览换新值 == store 真值（不是靠不更新蒙过 KD-01）",
    !!dmRow && dmRow.meta !== (sessSnap.get(main.dmId) || {}).meta && dmRow.meta === dmPreview,
    "界面=" + JSON.stringify((dmRow || {}).meta) + " 真值=" + JSON.stringify(dmPreview));

  /* KD-04 广播是 diff，且只点名该点的那一行 */
  const botsRec = r.rec.filter((x) => x.surface === "bots");
  const sessRec = r.rec.filter((x) => x.surface === "sessions");
  const diffed = botsRec.filter((x) => x.mode === "diff");
  const named = diffed.every((x) => Array.isArray(x.changed) && x.changed.every((c) => c.entity_id && c.changed_fields));
  expect(true, "KD-04a 这一轮收到的 Bot 广播是 diff（{surface, entity_id, changed_fields} 齐），不是整份",
    botsRec.length > 0 && diffed.length > 0 && named,
    "bots 广播 " + botsRec.length + " 条，其中 diff " + diffed.length + " 条");
  const touch = diffed.find((x) => x.changed.some((c) => c.entity_id === bots[0].id));
  expect(true, "KD-04b diff 点名的就是这一轮真正动过的那个 Bot", !!touch,
    touch ? JSON.stringify(touch.changed.map((c) => c.entity_id)) : "点名记录里没有该 Bot");
  expect(true, "KD-04c 会话面同样走 diff（同一把尺子，两条面都收口）",
    sessRec.length > 0 && sessRec.filter((x) => x.mode === "diff").length > 0,
    "sessions 广播 " + sessRec.length + " 条，diff " + sessRec.filter((x) => x.mode === "diff").length + " 条");
  expect(true, "KD-04d 每条 diff 都带单调 rev（渲染端靠它发现跳号并自愈）",
    botsRec.concat(sessRec).every((x) => Number.isFinite(x.rev) || x.mode === "full"),
    "rev 序列=" + r.rec.map((x) => x.surface[0] + x.rev).join(","));

  /* KD-05 划算：同一份 store 上，diff 的实际字节 < 整份广播的实际字节 */
  const offFull = o.rec.filter((x) => x.surface === "sessions" && x.mode === "full");
  const realFullBytes = offFull.length ? Math.min.apply(null, offFull.map((x) => x.bytes)) : 0;
  const diffs = sessRec.filter((x) => x.mode === "diff");
  const smallest = diffs.length ? Math.min.apply(null, diffs.map((x) => x.bytes)) : 0;
  expect(true, "KD-05 真 store 上 diff 广播的字节数远小于整份（整份量级取自 KD-08 那一趟关 diff 的实测）",
    smallest > 0 && realFullBytes > 0 && smallest * 4 < realFullBytes,
    "diff=" + smallest + "B vs 实测整份=" + realFullBytes + "B（" + (realFullBytes ? (realFullBytes / Math.max(smallest, 1)).toFixed(1) : "?") + "×）");

  /* KD-01c 这一轮渲染端一次都没为了画侧栏回去取整份 */
  expect(true, "KD-01c 回合全程渲染端没有发起过取整份 IPC（侧栏更新全靠手上的基线 + diff）",
    r.reads === 0, "surface.read 调用次数=" + r.reads);

  /* KD-08 负向对照（广播层）：把总闸 BITBOT_BROADCAST_DIFF=0 关掉再跑同一个回合，
   * 广播必须退回整份 —— 这是闸真正管的那一层，所以负对照就量在这一层。
   * 为什么这里不量滚动：老路径是同步的「清空 + 立刻重建」，中间那一帧空布局不会交给
   * 合成器，滚动位置在两次采样（80ms）之间就被恢复了 —— 实测两趟 scrollTop 都待在 180，
   * 拿滚动当负对照只会得到一条空断言；KD-02 因此只证正向。渲染层那条机制的负对照在
   * KD-10c（页内把 paintBots 换回老画法）。 */
  expect(false, "KD-08a 关掉 BITBOT_BROADCAST_DIFF 后，会话广播回到整份（这一趟一条 diff 都不该有）",
    o.rec.filter((x) => x.surface === "sessions" && x.mode === "diff").length > 0,
    "diff关: sessions 广播 " + o.rec.filter((x) => x.surface === "sessions").length + " 条，diff "
      + o.rec.filter((x) => x.surface === "sessions" && x.mode === "diff").length + " 条");
  expect(false, "KD-08b 关掉总闸后 Bot 广播同样回到整份（闸是对称的，不是只堵一条面）",
    o.rec.filter((x) => x.surface === "bots" && x.mode === "diff").length > 0,
    "diff关: bots 广播 " + o.rec.filter((x) => x.surface === "bots").length + " 条，diff "
      + o.rec.filter((x) => x.surface === "bots" && x.mode === "diff").length + " 条");
  const offSessFull = o.rec.filter((x) => x.surface === "sessions" && x.mode === "full");
  ok("KD-08c 老路径那趟的量级如实记在这里：整份广播 " + offSessFull.length + " 条 ×"
    + (offSessFull[0] ? offSessFull[0].bytes : 0) + "B（开 diff 同一回合的最小一条是 "
    + (sessRec.filter((x) => x.mode === "diff").length
      ? Math.min.apply(null, sessRec.filter((x) => x.mode === "diff").map((x) => x.bytes))
      : 0) + "B），回合里侧栏摘掉 " + o.botRemoved + " 行 Bot / " + o.sessRemoved + " 行会话");

  /* KD-06 reload 后来一条 diff → 自愈成整份，改名照样上屏 */
  const ud2 = electronUserDataDir("sidebar-diff-resync");
  const env2 = electronLaunchEnv(
    gateAppEnv(root, {
      BITBOT_BROADCAST_DIFF: "1",
      BITBOT_EVENT_DUAL_WRITE: "0",
    }),
  );
  const app2 = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud2],
    cwd: REPO,
    env: env2,
    timeout: 120000,
  });
  const win2 = await app2.firstWindow({ timeout: 60000 });
  await win2.waitForSelector("#bot-list .agent-item", { timeout: 60000, state: "attached" });
  await win2.evaluate(() => {
    const sec = document.getElementById("sb-bots-rooms");
    if (sec) sec.classList.remove("collapsed"); // 同上：折叠态下行在 DOM 里但看不见
  });
  await win2.waitForSelector("#bot-list .agent-item", { timeout: 60000 });
  // 先让主进程发一次 diff（此时渲染端刚 reload，缓存里没有基线）→ 必须自愈
  await win2.evaluate(() => {
    const btn = document.getElementById("ab-sessions-btn");
    if (btn) btn.click();
  });
  await win2.waitForSelector("#sessions-popup #session-list .agent-item", { timeout: 30000 }).catch(() => {});
  const renamed = await win2.evaluate(async () => {
    const sid = "kp07-sess-3";
    const r = await window.bitbot.sessions.rename(sid, "KP07改名自愈");
    await new Promise((res) => setTimeout(res, 2500));
    const el = document.querySelector('#session-list .agent-item[data-session-id="' + sid + '"] .name');
    return { ipc: !!(r && r.ok), onScreen: ((el || {}).textContent || "").trim() };
  }).catch((e) => ({ ipc: false, onScreen: "eval failed: " + e.message }));
  expect(true, "KD-06 渲染端错过广播（reload）后，收到 diff 必须自愈：改名照样上屏",
    renamed.ipc && renamed.onScreen === "KP07改名自愈",
    "ipc=" + renamed.ipc + " 屏幕=" + JSON.stringify(renamed.onScreen));

  /* KD-07 结构性大改：一次建 3 个会话，行数与真值一致，不吞行 */
  const structural = await win2.evaluate(async () => {
    for (let i = 0; i < 3; i++) await window.bitbot.sessions.create("KP07批量" + i);
    await new Promise((res) => setTimeout(res, 2500));
    return document.querySelectorAll("#session-list .agent-item").length;
  }).catch(() => -1);
  const truth = ((readStore("sessions.json") || {}).sessions || []).length;
  expect(true, "KD-07 连建 3 个会话（走 churn/整份兜底）后，弹层行数 == store 真值，不吞行",
    structural === truth, "界面 " + structural + " 行 vs 真值 " + truth + " 行");

  /* KD-09 结构性改动（换组）：diff 只点名那一行，重画用本地缓存，一次 IPC 都不回读 */
  const kd9 = await win2.evaluate(async () => {
    const box = document.getElementById("bot-list");
    let removed = 0;
    const obs = new MutationObserver((mrs) => {
      for (const m of mrs) {
        for (const n of m.removedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains("agent-item")) removed++;
        }
      }
    });
    obs.observe(box, { childList: true });
    let reads = 0;
    const origRead = window.bitbot.surface.read;
    window.bitbot.surface.read = function () { reads++; return origRead.apply(this, arguments); };
    const headOf = (el) => {
      let p = el ? el.previousElementSibling : null;
      while (p && !(p.classList && p.classList.contains("bot-group-head"))) p = p.previousElementSibling;
      return p ? String(p.dataset.groupName || "") : "";
    };
    const id = "kp07-bot-5";
    const r = await window.bitbot.bots.setGroup(id, "KP09新组");
    await new Promise((res) => setTimeout(res, 2500));
    obs.disconnect();
    window.bitbot.surface.read = origRead;
    const el = document.querySelector('#bot-list .agent-item[data-agent-id="' + id + '"]');
    return {
      ipc: !!(r && r.ok),
      reads,
      removed,
      head: headOf(el),
      heads: Array.from(document.querySelectorAll("#bot-list .bot-group-head")).map((h) => h.dataset.groupName),
      rows: document.querySelectorAll("#bot-list .agent-item").length,
    };
  }).catch((e) => ({ ipc: false, reads: -1, removed: -1, head: "eval failed: " + String(e && e.message).slice(0, 80), heads: [], rows: -1 }));
  const botsTruth = ((readStore("bots.json") || {}).bots || []).filter((b) => !b.hidden).length;
  expect(true, "KD-09a 换组只让那一行重画（本地缓存兜底），全程零次取整份 IPC",
    kd9.ipc && kd9.reads === 0, "setGroup ipc=" + kd9.ipc + " surface.read=" + kd9.reads);
  expect(true, "KD-09b 换组后该行的组头 == store 真值，其余行一个不少",
    kd9.head === "KP09新组" && kd9.rows === botsTruth,
    "组头=" + JSON.stringify(kd9.head) + " 界面 " + kd9.rows + " 行 vs 真值 " + botsTruth + " 行（组头列表 " + JSON.stringify(kd9.heads) + "）");

  /* ---------- KD-10 「非广播」的重画路径 + 画层机制的注入式负向对照 ----------
   * 广播改成 diff 只堵住了一条路；侧栏还有几条整份刷新路径（refreshBots 全量重读、
   * refreshSessions、打开弹层、Bot 信息面板），它们都会调 paint*。取证时正是这几条
   * 让 KD-01 一直翻红（一次回合摘掉 135 行），所以这一格量的是「重画 ≠ 拆掉重建」。
   * 负向对照用注入：把 paintBots 换回 KP-07 之前的形状（清空 + 逐行新建），同一条
   * 判据必须立刻翻红 —— 量的就是这个机制，不是界面碰巧没动。 */
  const kd10 = await win2.evaluate(async () => {
    const tok = new WeakMap();
    let n = 0;
    const mark = (sel) =>
      Array.from(document.querySelectorAll(sel + " .agent-item")).map((el) => {
        if (!tok.has(el)) tok.set(el, "t" + ++n);
        return { id: String(el.dataset.agentId || el.dataset.sessionId || ""), t: tok.get(el) };
      });
    const watch = (sel) => {
      const st = { removed: 0, created: 0 };
      const obs = new MutationObserver((mrs) => {
        for (const m of mrs) {
          for (const x of m.removedNodes) if (x.nodeType === 1 && x.classList.contains("agent-item")) st.removed++;
          for (const x of m.addedNodes) if (x.nodeType === 1 && x.classList.contains("agent-item")) st.created++;
        }
      });
      obs.observe(document.querySelector(sel), { childList: true });
      return { st, obs };
    };
    const keptOf = (before, after) =>
      after.filter((x) => before.some((y) => y.id === x.id && y.t === x.t)).length;
    const settle = () => new Promise((res) => setTimeout(res, 500));

    // 正向 1：Bot 侧栏走 app 自己的全量刷新（读一份 + 画）
    const b0 = mark("#bot-list");
    const wb = watch("#bot-list");
    await refreshBots();
    await settle();
    wb.obs.disconnect();
    const b1 = mark("#bot-list");

    // 正向 2：会话弹层走 refreshSessions（内部是 renderSessionList → paintSessionList）
    const s0 = mark("#session-list");
    const wsm = watch("#session-list");
    await refreshSessions();
    await settle();
    wsm.obs.disconnect();
    const s1 = mark("#session-list");

    // 负向：摘掉 keyed 复用 —— 这就是 KP-07 之前 paintBots 的形状
    const realPaint = paintBots;
    paintBots = function (view, botLast) {
      const box = document.getElementById("bot-list");
      if (!box) return;
      const last = botLast || {};
      botRowById.clear();
      box.innerHTML = "";
      const groups = new Map();
      const flat = [];
      for (const b of (view && view.bots) || []) {
        const g = typeof b.group === "string" ? b.group.trim() : "";
        if (g) {
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(b);
        } else flat.push(b);
      }
      const put = (b) => {
        const el = botRow(b, false, last[b.id]);
        botRowById.set(String(b.id), { el, bot: b, bucket: "visible" });
        box.appendChild(el);
      };
      for (const b of flat) put(b);
      for (const [g, list] of groups) {
        const head = document.createElement("div");
        head.className = "bot-group-head";
        head.dataset.groupName = g;
        const label = document.createElement("span");
        label.textContent = g;
        const cnt = document.createElement("span");
        cnt.className = "cnt";
        cnt.textContent = String(list.length);
        head.appendChild(label);
        head.appendChild(cnt);
        box.appendChild(head);
        for (const b of list) put(b);
      }
    };
    const b2 = mark("#bot-list");
    const wi = watch("#bot-list");
    await refreshBots();
    await settle();
    wi.obs.disconnect();
    const b3 = mark("#bot-list");
    const injectedKept = keptOf(b2, b3);
    paintBots = realPaint; // 恢复真画法，别把后面的断言带脏
    await refreshBots();
    await settle();
    return {
      botRemoved: wb.st.removed,
      botCreated: wb.st.created,
      botKept: keptOf(b0, b1),
      botTotal: b1.length,
      sessRemoved: wsm.st.removed,
      sessKept: keptOf(s0, s1),
      sessTotal: s1.length,
      injRemoved: wi.st.removed,
      injCreated: wi.st.created,
      injKept: injectedKept,
      injTotal: b2.length,
    };
  }).catch((e) => ({ error: String((e && e.stack) || e).slice(0, 200) }));

  expect(true, "KD-10a 非广播路径（refreshBots 整份刷新）也不整列拆建：一次全量重画摘掉的行 == 0",
    !kd10.error && kd10.botRemoved === 0 && kd10.botCreated === 0,
    "removed=" + kd10.botRemoved + " created=" + kd10.botCreated + " 身份保住 " + kd10.botKept + "/" + kd10.botTotal + " 行" + (kd10.error || ""));
  expect(true, "KD-10b 会话弹层的整份刷新同样复用节点",
    !kd10.error && kd10.sessRemoved === 0 && kd10.sessKept === kd10.sessTotal && kd10.sessTotal > 0,
    "removed=" + kd10.sessRemoved + " 身份保住 " + kd10.sessKept + "/" + kd10.sessTotal + " 行");
  expect(false, "KD-10c 把渲染端的 keyed 复用摘掉（paintBots 换回「清空 + 逐行新建」）后，同一条判据必须翻红",
    !kd10.error && kd10.injRemoved === 0 && kd10.injKept === kd10.injTotal,
    "注入老画法: removed=" + kd10.injRemoved + " created=" + kd10.injCreated + " 身份保住 " + kd10.injKept + "/" + kd10.injTotal + " 行");

  await app2.evaluate(({ app: a }) => { a.isQuiting = true; a.quit(); }).catch(() => {});
  await Promise.race([app2.close(), sleep(15000)]).catch(() => {});
  killGateProcs(ud2);
  fs.rmSync(ud2, { recursive: true, force: true });

  note("判据自证：真 app 上 23 条判据 + 1 条 stub 起停（KD-00 真发送 ×开/关两趟、KD-01a/b/c 节点身份+零回读、KD-02 滚动、"
    + "KD-03a/b 会话弹层、KD-04a-d 广播形状、KD-05 实测比价、KD-06 自愈、KD-07 行数、KD-09a/b 换组、"
    + "KD-10a/b 非广播重画路径），其中 KD-08a/b 为广播层负向对照（关总闸必须回到整份）、"
    + "KD-10c 为渲染层负向对照（页内摘掉 keyed 复用必须翻红）、KD-08c 如实记录老路径的整份字节数；"
    + "两趟回合都真发真落库，不是把界面 mock 成期望形状");
  } catch (e) {
    bad("门自身异常", (e && e.stack ? String(e.stack).slice(0, 400) : String(e)));
  } finally {
    if (stub) { try { stub.kill(); } catch (_) {} }
    fs.rmSync(root, { recursive: true, force: true });
    console.log(`e2e_desktop_sidebar_diff: PASS=${PASS} FAIL=${FAIL} SKIP=0`);
    process.exit(FAIL === 0 ? 0 : 1);
  }
})();
