#!/usr/bin/env node
"use strict";

/**
 * prove_stage_artifact_contract — 产物契约：成员交上来的必须是「成果本身」（G-140）
 *
 * 这条门守的是**批次 1 的核心命题**（2026-11-23 截图实证）：
 *
 *   团队模板的角色 prompt 里**早就写死了**【固定交付】与【验收】——
 *   「写入 /workspace/content-team/01-inbox/YYYY-MM-DD.md，每次最多 8 条。每条包含：
 *     事实或平台线索、来源平台、原始链接、证据摘录…完成后**只汇报文件路径、条数和
 *     未完成原因**。」
 *   ⇒ 也就是说：**产物本来就是那个文件**；成员按 prompt 只汇报「路径+条数」，
 *     而**那句汇报恰恰是对成果的转述**。
 *   而 Host 侧**不认这个契约**：buildRelayPrompt 第 3 条虽然写着「交付时直接给成果
 *     本身，不要只写『已完成』」——**指令对了，但没有强制**；Host 拿成员的汇报文本
 *     当交付，下限只有 MIN_DELIVERABLE_CHARS=20 字符，于是照样落盘。
 *   实测：群里「收齐 3/3」「产物已落盘」全绿，产物却只有 882 字节的转述，
 *     而且两棒成员交的话**一字不差**（没在干各自的活）。
 *
 * ⇒ 本门钉住改完之后必须成立的四件事：
 *   A. 正例：有交付契约时，**产物正文 = 成员写下的那个文件的正文**（不是那句汇报）；
 *   B. 负例：成员只交转述 ⇒ 这一棒**不算交付**（驳回）⇒ **下游不接力** ⇒
 *      **产物不落盘**（不留半个状态）⇒ 群里说清是哪棒、为什么；
 *   C. 变异对照：把验收关掉（产品**副本**，源文件一个字节不动）⇒ B 必须翻绿，
 *      否则 B 那几条断言就是恒绿、没牙；
 *   D. 隔离：用户真实数据目录一个字节都没动。
 *
 * 契约是**声明式**的（不解析自然语言）：角色 prompt 里的散文给人看，
 * Host 认的是字段（path / rules）；两者必须由**同一处模板**生成，
 * 否则又是一份第二真相。
 *
 * 用法：
 *   node scripts/prove_stage_artifact_contract.js
 *   BITBOT_STAGE_CONTRACT_MODE=negative node scripts/prove_stage_artifact_contract.js  # 只跑负例（变异对照用）
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { createProductSurface } = require("../hosts/desktop/product_surface");
const { dispatchRoomTurn } = require("../hosts/shared/room_dispatch");
const { resolveDeliverablePath } = require("../hosts/desktop/room_orchestrator");

/* 与 prove_room_relay 同口径：这条门测的是**串行接力**（auto_route 契约）下的验收。
 * 团队模式（并行分工）由 scripts/e2e_desktop_room_orchestration.mjs 守着。 */
process.env.BITBOT_ROOM_TEAM_MODE = "0";

const MODE = String(process.env.BITBOT_STAGE_CONTRACT_MODE || "all");

let pass = 0, fail = 0;
const ok = (id, m) => { pass++; console.log("  ✓ [" + id + "] " + m); };
/* 真判据：条件不成立要红。别用 ok(msg, cond) —— 多传的参数会被悄悄丢掉，
   判据就成了恒绿（变异测试当场抓到过）。 */
const check = (id, cond, m, d) => { if (cond) ok(id, m); else { fail++; console.log("  ✗ [" + id + "] " + m + (d ? " — " + String(d).slice(0, 320) : "")); } };

const BOTS = {
  version: 1,
  primary_id: "b1",
  bots: [
    { id: "b1", name: "选题策划", job: "选题", description: "负责选题与受众分析，判断什么题值得做", hidden: false },
    { id: "b2", name: "脚本撰写", job: "脚本", description: "把选题写成短视频口播脚本，控制节奏与时长", hidden: false },
    { id: "b3", name: "事实核查", job: "核查", description: "核对数据与引用，标注不确定的说法", hidden: false },
  ],
};

/* 房间自带交付契约（建团时带上契约 ⇒ 群里每一棒都知道自己该交什么、交到哪）。
 * 路径沿用角色 prompt 的 /workspace 口径；Host 把它解析到 <dataRoot>/workspace/。 */
const CONTRACT = {
  stages: [
    {
      match: { name: "选题策划" },
      path: "/workspace/content-team/02-briefs/{date}.md",
      rules: { min_chars: 120, min_items: 2 },
    },
    {
      match: { name: "脚本撰写" },
      path: "/workspace/content-team/03-drafts/{date}.md",
      rules: { min_chars: 120 },
    },
  ],
};

const ROOM = {
  id: "room-contract",
  title: "自媒体内容团队",
  members: ["b1", "b2", "b3"],
  contract: CONTRACT,
  created_at: "t",
  transcript: [],
};

const BRIEF_BODY = [
  "# 选题 brief：园区光伏",
  "",
  "- 事实：园区 2024 年光伏装机 3.2MW（来源：园区年报，第 12 页）",
  "- 读者场景：制造业园区能源负责人要在 Q3 前决定是否加装光伏",
  "- 主角度：算一笔账——回本周期对现金流紧张的园区意味着什么",
  "- 信息缺口：电价构成未核；需查当地工商业电价文件",
  "- 内容形式：3 分钟口播短视频",
  "- 写作任务：给主笔一条硬约束：所有数字必须能回到年报或电价文件",
].join("\n");

const DRAFT_BODY = [
  "# 口播稿：园区光伏",
  "",
  "你有没有算过，园区屋顶那一片光伏，多久能回本？我算了一个数：按 2024 年园区年报里的 3.2MW 装机，如果年发电 320 万度、电价 0.6 元，三年回本——但前提是电价构成和你拿到的是同一份文件。",
  "",
  "这里必须说清楚两件事：第一，3.2MW 是 2024 年的装机数，今年有没有新增，要再核；第二，回本周期对现金流紧张的园区是致命的，所以我们今天只讲「怎么核」，不讲「该不该装」。",
  "",
  "事实依据：园区 2024 年年报第 12 页（装机 3.2MW）；当地工商业电价文件（待核）。",
  "仍需确认：2025 年新增装机；实际执行电价与上网电价口径。",
].join("\n");

/* 负例里成员交的话：照抄实测截图里的原话 —— 纯转述，一个字成果都没有。 */
const NARRATION_B1 = "已看过上一棒：情报线索已看过一遍，园区光伏这条最值得做。";
const NARRATION_B2 = "已看过上一棒：选题 brief 已看过一遍，可以开写。";

function mkSurface(roomDef) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stage-contract-")));
  const dir = path.join(root, "data", "desktop");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bots.json"), JSON.stringify(BOTS));
  fs.writeFileSync(path.join(dir, "rooms.json"), JSON.stringify({ version: 1, rooms: [roomDef] }));
  return { surface: createProductSurface(root), root };
}

const txOf = (surface, id = ROOM.id) =>
  (surface.loadRooms().rooms.find((r) => r.id === id) || {}).transcript || [];

/** 某个交付文件在磁盘上的绝对路径（用产品自己的解析器，避免门禁抄一份日期逻辑）。 */
function artifactPath(root, spec) {
  return resolveDeliverablePath(spec, { dataRoot: path.join(root, "data") });
}

function writeArtifact(root, spec, body) {
  const p = artifactPath(root, spec);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
  return p;
}

function deliverableFiles(root) {
  const dir = path.join(root, "data", "desktop", "room-deliverables");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * 跑一次接力。
 * @param writeFiles true = 成员真的把交付文件写出来（正例）；false = 只交汇报（负例）。
 */
async function runRelay(opts) {
  const writeFiles = !!opts.writeFiles;
  const roomDef = Object.assign({}, ROOM, { transcript: [] });
  const { surface, root } = mkSurface(roomDef);
  const calls = [];
  const r = await dispatchRoomTurn({
    surface,
    roomId: ROOM.id,
    text: opts.task || "帮我定一个题：园区光伏值不值得做，受众是制造业园区的能源负责人",
    deps: {
      runResponderTurn: async (botId, prompt, ctx) => {
        calls.push({ bot_id: botId, prompt: String(prompt || "") });
        if (botId === "b1") {
          if (writeFiles) writeArtifact(root, CONTRACT.stages[0].path, BRIEF_BODY);
          /* 交接标记两种情况都带：负例里如果没有交接，"下游不接力"就成恒绿断言。 */
          return { ok: true, text: (writeFiles ? "已写入 /workspace/content-team/02-briefs/" : "") + NARRATION_B1 + "【交给】脚本撰写" };
        }
        if (botId === "b2") {
          if (writeFiles) writeArtifact(root, CONTRACT.stages[1].path, DRAFT_BODY);
          return { ok: true, text: (writeFiles ? "已写入 /workspace/content-team/03-drafts/" : "") + NARRATION_B2 };
        }
        return { ok: true, text: "（核查完成）" };
      },
    },
  });
  const tx = txOf(surface);
  const fr = tx.find((e) => e.kind === "final_report") || null;
  const sys = tx.filter((e) => e.kind === "system").map((e) => String(e.text || "")).join("\n");
  let artifact = "";
  if (fr && fr.deliverable && fr.deliverable.path && fs.existsSync(fr.deliverable.path)) {
    artifact = fs.readFileSync(fr.deliverable.path, "utf8");
  }
  return { surface, root, calls, r, tx, fr, sys, artifact, files: deliverableFiles(root) };
}

/* ══════════════════════════════════════════════════════════════════════════
 * A. 正例：产物正文 = 成员写下的那个文件的正文
 * ══════════════════════════════════════════════════════════════════════════ */
async function sectionA() {
  console.log("── A. 正例（有交付契约 ⇒ 产物来自文件，不是汇报）──");
  const c = await runRelay({ writeFiles: true });

  check("SA-01", c.calls.length === 2 && c.calls[0].bot_id === "b1" && c.calls[1].bot_id === "b2",
    "SA-01 串行接力跑了两棒：选题策划 → 脚本撰写", JSON.stringify(c.calls.map((x) => x.bot_id)));

  const briefPath = artifactPath(c.root, CONTRACT.stages[0].path);
  const draftPath = artifactPath(c.root, CONTRACT.stages[1].path);
  check("SA-02", fs.existsSync(briefPath) && fs.existsSync(draftPath),
    "SA-02 两份交付文件都在磁盘上（成员确实把东西写出来了）", JSON.stringify({ briefPath, draftPath }));

  check("SA-03", !!(c.fr && c.fr.deliverable && c.fr.deliverable.path && fs.existsSync(c.fr.deliverable.path)),
    "SA-03 产物落盘了（final_report.deliverable 指向真文件）", JSON.stringify(c.fr && c.fr.deliverable));

  check("SA-04", c.artifact.indexOf("读者场景：制造业园区能源负责人") >= 0,
    "SA-04 产物正文里有**第一棒文件**的内容（不是那句汇报）",
    c.artifact.slice(0, 160));

  check("SA-05", c.artifact.indexOf("你有没有算过，园区屋顶那一片光伏") >= 0,
    "SA-05 产物正文里有**第二棒文件**的内容（权威交付 = 最后一棒的文件）",
    c.artifact.slice(0, 160));

  check("SA-06", c.artifact.indexOf("已看过上一棒") < 0 && c.artifact.indexOf("已写入") < 0,
    "SA-06 产物正文里**没有**任何转述句（汇报不进产物）", c.artifact.slice(0, 200));

  const sr = (c.fr && c.fr.stage_results) || [];
  check("SA-07", sr.length === 2 && sr.every((s) => s.pass === true),
    "SA-07 final_report.stage_results 两棒都通过验收", JSON.stringify(sr));
  check("SA-08", sr.length === 2 && sr.every((s) => !!s.artifact_path && fs.existsSync(s.artifact_path)),
    "SA-08 每一棒的验收都记下了交付文件路径", JSON.stringify(sr.map((s) => s.artifact_path)));

  /* 按**字符**比：中文一个字符三个字节，拿字节数比字符数会把正确的产物判成不合格。 */
  const fileChars =
    (fs.existsSync(briefPath) ? fs.readFileSync(briefPath, "utf8").trim().length : 0) +
    (fs.existsSync(draftPath) ? fs.readFileSync(draftPath, "utf8").trim().length : 0);
  check("SA-09", c.artifact.length >= Math.floor(fileChars * 0.8),
    "SA-09 产物体量对得上文件体量（产物不是那两句话）",
    JSON.stringify({ artifactChars: c.artifact.length, fileChars }));

  check("SA-10", c.sys.indexOf("未通过验收") < 0,
    "SA-10 正例里没有「未通过验收」的提示（不误伤）", c.sys.slice(0, 200));

  return c;
}

/* ══════════════════════════════════════════════════════════════════════════
 * B. 负例：只交转述 ⇒ 驳回 / 下游不接力 / 产物不落盘
 * ══════════════════════════════════════════════════════════════════════════ */
async function sectionB() {
  console.log("── B. 负例（只交转述 ⇒ 这一棒不算交付）──");
  const c = await runRelay({ writeFiles: false });

  const sr = (c.fr && c.fr.stage_results) || [];
  const first = sr[0] || {};
  check("SB-01", first.rejected === true && first.code === "no_deliverable_file",
    "SB-01 第一棒被驳回（没交出约定的交付文件）", JSON.stringify(sr));

  check("SB-02", String(first.reason || "").indexOf("没有交出约定的交付文件") >= 0,
    "SB-02 驳回理由说清了缺什么", String(first.reason || ""));

  check("SB-03", c.calls.length === 1,
    "SB-03 **下游不接力**：脚本撰写那一棒根本没跑", JSON.stringify(c.calls.map((x) => x.bot_id)));

  check("SB-04", !(c.fr && c.fr.deliverable) && c.files.length === 0,
    "SB-04 **产物不落盘**（不留半个状态）",
    JSON.stringify({ deliverable: c.fr && c.fr.deliverable, files: c.files }));

  check("SB-05", c.sys.indexOf("未通过验收") >= 0,
    "SB-05 群里说清了为什么没产物（哪棒、为什么）", c.sys.slice(0, 240));

  const secs = (c.fr && c.fr.sections) || [];
  check("SB-06", secs.length === 1 && secs[0].ok === false && secs[0].rejected === true,
    "SB-06 汇总卡里那一棒不算交付（ok=false / rejected=true）", JSON.stringify(secs));

  check("SB-07", String((secs[0] && secs[0].summary) || "").indexOf("未通过验收") >= 0 ||
    String((secs[0] && secs[0].summary) || "").indexOf("没有交出") >= 0,
    "SB-07 汇总卡上看得见驳回理由（不是一句「no reply」）", String(secs[0] && secs[0].summary));

  return c;
}

/* ══════════════════════════════════════════════════════════════════════════
 * C. 变异对照：把验收关掉 ⇒ 负例必须翻绿（否则负例没牙）
 *    —— 只改**副本**，源文件一个字节不动。
 * ══════════════════════════════════════════════════════════════════════════ */
function sectionC() {
  console.log("── C. 变异对照（关掉验收 ⇒ 负例必须翻红，证明它有牙）──");
  const REPO = path.resolve(__dirname, "..");
  const judgePath = path.join(REPO, "hosts", "desktop", "room_orchestrator.js");
  const before = crypto.createHash("sha256").update(fs.readFileSync(judgePath)).digest("hex");

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stage-contract-mut-")));
  fs.mkdirSync(path.join(tmp, "hosts"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
  fs.cpSync(path.join(REPO, "hosts", "desktop"), path.join(tmp, "hosts", "desktop"), { recursive: true });
  fs.cpSync(path.join(REPO, "hosts", "shared"), path.join(tmp, "hosts", "shared"), { recursive: true });
  fs.copyFileSync(__filename, path.join(tmp, "scripts", path.basename(__filename)));

  const mutPath = path.join(tmp, "hosts", "desktop", "room_orchestrator.js");
  const src = fs.readFileSync(mutPath, "utf8");
  const anchor = "function judgeStage(input) {\n  const o = input || {};";
  const mutant = src.replace(anchor,
    "function judgeStage(input) {\n" +
    "  { const om = input || {}; if (om && om.contract && om.contract.path) return { pass: true, code: \"mutant_always_pass\", reason: \"变异：永远放行\", chars: 0, artifact: null, warn: \"\" }; }\n" +
    "  const o = input || {};");
  if (mutant === src) {
    fail++; console.log("  ✗ [SC-01] 变异没打上（judgeStage 的锚点变了）⇒ 下面的对照没意义");
    return;
  }
  fs.writeFileSync(mutPath, mutant, "utf8");
  pass++; console.log("  ✓ [SC-01] 变异已打进副本（judgeStage 遇契约就永远放行）");

  const r = spawnSync(process.execPath, [path.join(tmp, "scripts", path.basename(__filename))], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { BITBOT_STAGE_CONTRACT_MODE: "negative" }),
    timeout: 180000,
  });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const sb04Red = /✗ \[SB-04\]/.test(out);
  check("SC-02", r.status !== 0 && sb04Red,
    "SC-02 关掉验收后，负例的 SB-04（产物不落盘）判红 ⇒ 负例确实咬在验收上",
    "status=" + r.status + " / " + out.split("\n").filter((l) => l.indexOf("SB-04") >= 0).join(" | ").slice(0, 240));

  const after = crypto.createHash("sha256").update(fs.readFileSync(judgePath)).digest("hex");
  check("SC-03", before === after,
    "SC-03 源文件（hosts/desktop/room_orchestrator.js）一个字节没动",
    before + " vs " + after);

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ══════════════════════════════════════════════════════════════════════════
 * D. 隔离：用户真实数据目录一个字节都没动
 * ══════════════════════════════════════════════════════════════════════════ */
function userDataFingerprint() {
  const base = path.resolve(__dirname, "..", "data");
  const out = [];
  const walk = (d, depth) => {
    if (depth > 3) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile()) {
        try {
          const st = fs.statSync(p);
          out.push(p + ":" + st.size + ":" + Math.floor(st.mtimeMs));
        } catch (_) { /* ignore */ }
      }
    }
  };
  walk(base, 0);
  return out.join("\n");
}

(async () => {
  console.log("prove_stage_artifact_contract — 产物契约：交上来的必须是成果本身（G-140）");
  const userBefore = userDataFingerprint();

  if (MODE === "all" || MODE === "positive") await sectionA();
  if (MODE === "all" || MODE === "negative") await sectionB();
  if (MODE === "all") sectionC();

  if (MODE === "all") {
    const userAfter = userDataFingerprint();
    check("SD-01", userBefore === userAfter,
      "SD-01 用户真实数据目录一个字节没动（门禁跑在临时隔离根里）");
  }

  console.log("PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("门禁自身崩了：", (e && e.stack) || e);
  console.log("PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
