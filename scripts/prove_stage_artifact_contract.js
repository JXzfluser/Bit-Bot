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
/* "urls" 模式：只跑 X 段（URL 计数的变异对照用）。 */

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
      expect_file: true,
      rules: { min_chars: 120, min_items: 2 },
    },
    {
      match: { name: "脚本撰写" },
      path: "/workspace/content-team/03-drafts/{date}.md",
      expect_file: true,
      rules: { min_chars: 120 },
    },
  ],
};

/* 通道 B 的契约：成员**没有写文件的工具** ⇒ 成员交正文，Host 按契约代写落盘。
   dir/file 是相对**团队共享目录**（<dataRoot>/workspace/<团队名>/）的。 */
const CONTRACT_REPLY = {
  stages: [
    {
      match: { name: "脚本撰写" },
      dir: "03-draft",
      file: "{date}-draft.md",
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

function mkSurface(roomDef, bots, runtimeDeps) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stage-contract-")));
  const dir = path.join(root, "data", "desktop");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bots.json"), JSON.stringify(bots || BOTS));
  fs.writeFileSync(path.join(dir, "rooms.json"), JSON.stringify({ version: 1, rooms: [roomDef] }));
  const surface = createProductSurface(root);
  /* 运行时依赖（批次 8：链接可达性核验）走**真产品那条路** ——
     surface.setRoomRuntimeDeps —— 与真跑一致，不另开一条旁路。 */
  if (runtimeDeps) surface.setRoomRuntimeDeps(runtimeDeps);
  return { surface, root };
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
  const roomDef = Object.assign({}, ROOM, {
    /* 契约来源：opts.contract（任务级）> roomContract（房间级，默认用 CONTRACT）
       > 成员记录里那份。opts.roomContract=null ⇒ 房间**不带**契约（真实产品路径：
       建团时把契约落进成员记录就够了，不需要房间再带一份）。 */
    contract: opts.roomContract !== undefined
      ? opts.roomContract
      : (opts.contract || CONTRACT),
    transcript: [],
  });
  const { surface, root } = mkSurface(roomDef, opts.bots, opts.runtimeDeps);
  const calls = [];
  const r = await dispatchRoomTurn({
    surface,
    roomId: ROOM.id,
    text: opts.task || "帮我定一个题：园区光伏值不值得做，受众是制造业园区的能源负责人",
    deps: {
      runResponderTurn: async (botId, prompt, ctx) => {
        calls.push({ bot_id: botId, prompt: String(prompt || "") });
        /* botSeq：让门禁能**逐棒指定交什么**（批次 9 的回路端到端测试需要：
           第一棒交 brief、第二棒交稿，才能验「审校的改后稿覆盖第二棒的稿」）。 */
        if (opts.botSeq && opts.botSeq[botId]) {
          return { ok: true, text: String(opts.botSeq[botId].text || "") };
        }
        if (botId === "b1") {
          if (writeFiles) writeArtifact(root, CONTRACT.stages[0].path, BRIEF_BODY);
          /* 交接标记两种情况都带：负例里如果没有交接，"下游不接力"就成恒绿断言。 */
          return { ok: true, text: (writeFiles ? "已写入 /workspace/content-team/02-briefs/" : "") + NARRATION_B1 + "【交给】脚本撰写" };
        }
        if (botId === "b2") {
          if (writeFiles) writeArtifact(root, CONTRACT.stages[1].path, DRAFT_BODY);
          /* replyBody：成员直接把**正文**交上来（通道 B 的正常形态）。 */
          const body = opts.replyBody ? String(opts.replyBody) : "";
          return { ok: true, text: (writeFiles ? "已写入 /workspace/content-team/03-drafts/" : "") + (body || NARRATION_B2) };
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
 * E. 通道 B：成员交正文，Host 代写落盘（成员**没有**写文件的工具）
 * ══════════════════════════════════════════════════════════════════════════ */
async function sectionEPositive() {
  console.log("── E1. 通道 B 正例（成员交正文 ⇒ Host 代写落盘）──");
  const c = await runRelay({ writeFiles: false, contract: CONTRACT_REPLY, replyBody: DRAFT_BODY });

  const sr = (c.fr && c.fr.stage_results) || [];
  const last = sr[sr.length - 1] || {};
  check("SE-01", !!last.artifact_path && fs.existsSync(last.artifact_path),
    "SE-01 Host 把成员交的正文**代写成了交付文件**（文件真的在磁盘上）",
    JSON.stringify(sr.map((s) => s.artifact_path)));

  check("SE-02", last.artifact_path && last.artifact_path.indexOf("/workspace/") >= 0,
    "SE-02 落盘位置在**团队共享目录**下（路径是 Host 算的，不是模型给的）",
    String(last.artifact_path || ""));

  if (last.artifact_path && fs.existsSync(last.artifact_path)) {
    const onDisk = fs.readFileSync(last.artifact_path, "utf8");
    check("SE-03", onDisk === DRAFT_BODY,
      "SE-03 文件内容 = 成员交上来的正文（逐字节一致）",
      JSON.stringify({ disk: onDisk.slice(0, 80), expected: DRAFT_BODY.slice(0, 80) }));
  } else {
    check("SE-03", false, "SE-03 文件内容 = 成员交上来的正文（逐字节一致）", "文件不存在，没法比");
  }

  check("SE-04", c.artifact.indexOf("你有没有算过，园区屋顶那一片光伏") >= 0,
    "SE-04 产物正文里有成员的正文（最后一棒为权威交付）", c.artifact.slice(0, 160));

  check("SE-05", c.fr && c.fr.deliverable && fs.existsSync(c.fr.deliverable.path),
    "SE-05 汇总产物也落盘了", JSON.stringify(c.fr && c.fr.deliverable));
  return c;
}

async function sectionENegative() {
  console.log("── E2. 通道 B 负例（只交转述 ⇒ 驳回、产物不落盘）──");
  const c = await runRelay({ writeFiles: false, contract: CONTRACT_REPLY, replyBody: NARRATION_B2 });

  const sr = (c.fr && c.fr.stage_results) || [];
  const last = sr[sr.length - 1] || {};
  check("SE-06", last.rejected === true && last.code === "narration_only",
    "SE-06 正文只有转述 ⇒ 这一棒被驳回（code=narration_only）", JSON.stringify(sr));

  check("SE-07", String(last.reason || "").indexOf("只交了转述") >= 0,
    "SE-07 驳回理由点名「只交了转述」", String(last.reason || ""));

  check("SE-08", !(c.fr && c.fr.deliverable) && c.files.length === 0,
    "SE-08 **产物不落盘**（不留半个状态）",
    JSON.stringify({ deliverable: c.fr && c.fr.deliverable, files: c.files }));

  const teamFiles = [];
  const teamDir = path.join(c.root, "data", "workspace");
  if (fs.existsSync(teamDir)) {
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".md")) teamFiles.push(p);
      }
    };
    walk(teamDir);
  }
  check("SE-09", teamFiles.length === 0,
    "SE-09 团队共享目录里也没落下半个交付文件", JSON.stringify(teamFiles));
  return c;
}

/* ══════════════════════════════════════════════════════════════════════════
 * F. 真实产品路径：契约在**成员记录**里 ⇒ 接力自动按契约验收
 *    （建团时从模板角色的【固定交付】落进来 ⇒ 接力时不用再传任何参数）
 * ══════════════════════════════════════════════════════════════════════════ */
const BOTS_WITH_CONTRACT = {
  version: 1,
  primary_id: "b1",
  bots: [
    Object.assign({}, BOTS.bots[0]),
    Object.assign({}, BOTS.bots[1], {
      deliverable: { dir: "03-draft", file: "{date}-draft.md", rules: { min_chars: 120 } },
    }),
    Object.assign({}, BOTS.bots[2]),
  ],
};

async function sectionF() {
  console.log("── F. 真实产品路径（契约在成员记录里）+ 模板两份真相 ──");

  /* F-01/F-02：模板侧 —— 角色带结构化契约，且两份真相逐字一致。 */
  const tplFile = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "data", "desktop", "bot-templates.json"), "utf8"));
  const media = (tplFile.templates || []).find((t) => t.id === "media-content-team");
  const roles = (media && media.roles) || [];
  check("SF-01", roles.length === 5 && roles.every((r) => r.deliverable && r.deliverable.dir && r.deliverable.file && r.deliverable.rules),
    "SF-01 模板的五个角色都带**结构化交付契约**（dir + file + rules）",
    JSON.stringify(roles.map((r) => [r.name, r.deliverable && r.deliverable.dir])));

  const oldWay = roles.filter((r) => /只汇报|并只汇报/.test(String(r.prompt || "")));
  check("SF-02", oldWay.length === 0,
    "SF-02 角色 prompt 里不再要求「只汇报文件路径」（旧口径必须消失：汇报不是交付）",
    JSON.stringify(oldWay.map((r) => r.name)));

  const newWay = roles.filter((r) => /正文完整写在回复里/.test(String(r.prompt || "")));
  check("SF-03", newWay.length === roles.length,
    "SF-03 每个角色都被要求「把正文完整写在回复里」（Host 会替你落盘）",
    JSON.stringify(roles.map((r) => [r.name, /正文完整写在回复里/.test(String(r.prompt || ""))])));

  const seedSrc = fs.readFileSync(path.resolve(__dirname, "..", "hosts", "shared", "host_ffi.js"), "utf8");
  let seedSame = true;
  for (const r of roles) {
    const a = seedSrc.indexOf("name: `" + r.name + "`");
    const ps = seedSrc.indexOf("prompt:", a);
    const lb = seedSrc.indexOf("`", ps);
    const le = seedSrc.indexOf("`,\n", lb);
    const lit = seedSrc.slice(lb + 1, le);
    if (lit !== r.prompt) { seedSame = false; break; }
  }
  check("SF-04", seedSame,
    "SF-04 模板的**两份真相**（host_ffi 种子 ↔ bot-templates.json）逐字一致（不能各写一份）");

  /* F-05/F-06：成员记录带契约 ⇒ 接力自动验收（正例）。 */
  const c = await runRelay({
    writeFiles: false,
    bots: BOTS_WITH_CONTRACT,
    replyBody: DRAFT_BODY,
    roomContract: null,
    task: "帮我定一个题：园区光伏值不值得做，受众是制造业园区的能源负责人",
  });
  const sr = (c.fr && c.fr.stage_results) || [];
  const last = sr[sr.length - 1] || {};
  check("SF-05", !!last.artifact_path && fs.existsSync(last.artifact_path),
    "SF-05 成员记录里带契约 ⇒ 这一棒**自动**被验收并代写落盘（不用传任何参数）",
    JSON.stringify(sr.map((s) => [s.bot_id, s.pass, s.artifact_path])));

  check("SF-06", last.artifact_path && last.artifact_path.indexOf("/workspace/" + ROOM.title + "/03-draft/") >= 0,
    "SF-06 落盘位置 = 团队共享目录 03-draft/ 下（契约里的 dir 说了算）",
    String(last.artifact_path || ""));

  check("SF-07", c.artifact.indexOf("你有没有算过，园区屋顶那一片光伏") >= 0,
    "SF-07 产物正文 = 成员交上来的正文", c.artifact.slice(0, 140));

  /* F-08：同一份契约，成员只交转述 ⇒ 驳回、产物不落盘。 */
  const c2 = await runRelay({
    writeFiles: false,
    bots: BOTS_WITH_CONTRACT,
    replyBody: "",
    roomContract: null,
    task: "帮我定一个题：园区光伏值不值得做，受众是制造业园区的能源负责人",
  });
  const sr2 = (c2.fr && c2.fr.stage_results) || [];
  const last2 = sr2[sr2.length - 1] || {};
  check("SF-08", last2.rejected === true && !(c2.fr && c2.fr.deliverable) && c2.files.length === 0,
    "SF-08 同一份契约：只交转述 ⇒ 驳回 + 产物不落盘",
    JSON.stringify({ sr2, deliverable: c2.fr && c2.fr.deliverable, files: c2.files }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * G. 复盘三件套：整轮用时 / 每棒用时 / 返工次数 —— 落进 Task 实体
 * ══════════════════════════════════════════════════════════════════════════ */
async function sectionG() {
  console.log("── G. 复盘数据（耗时 · 每棒用时 · 返工次数）落 Task 实体 ──");

  const { surface, root } = mkSurface(Object.assign({}, ROOM, { contract: null, transcript: [] }));
  const taskText = "帮我定一个题：园区光伏值不值得做，受众是制造业园区的能源负责人";
  const deps = {
    runResponderTurn: async (botId) => {
      if (botId === "b2") return { ok: true, text: DRAFT_BODY };
      return { ok: true, text: NARRATION_B1 + "【交给】脚本撰写" };
    },
  };
  /* 同一个投递 id（messageId）⇒ 同一个任务号 ⇒ 第二轮就是**返工**
     （口径：同一 task_sig 的执行轮次 − 1；新的一次投递是**新任务**，不是返工）。 */
  const msgId = "room-msg-rework-test";
  await dispatchRoomTurn({ surface, roomId: ROOM.id, text: taskText, messageId: msgId, deps });
  const tasksPath = path.join(root, "data", "desktop", "tasks.json");
  const readTasks = () => {
    try { return JSON.parse(fs.readFileSync(tasksPath, "utf8")); } catch (_) { return { tasks: [] }; }
  };
  const rec = (readTasks().tasks || [])[0] || {};

  check("SG-01", rec && rec.state === "done",
    "SG-01 跑完之后 Task 实体在（state=done）", JSON.stringify(rec).slice(0, 200));

  check("SG-02", Number(rec.duration_ms || 0) > 0,
    "SG-02 整轮用时落进实体（duration_ms > 0）", String(rec.duration_ms));

  const stg = Array.isArray(rec.stages) ? rec.stages : [];
  check("SG-03", stg.length === 2 && stg.every((x) => typeof x.duration_ms === "number" && x.pass === true),
    "SG-03 每一棒的用时与验收结论都在实体里", JSON.stringify(stg));

  check("SG-04", Number(rec.rework_count || 0) === 0,
    "SG-04 第一轮跑完：返工 0 次", String(rec.rework_count));

  /* 同一批任务再跑一遍 ⇒ 返工 1 次（口径：同一 task_sig 的执行轮次 − 1）。 */
  /* 返工在产品里的真路径 = **改向后重跑**：沿用原 message_id（同一个任务号）+
     force:true（真的重跑，而不是被幂等挡掉）。 */
  await surface.orchestrateRoom({
    room: ROOM.id, task: taskText, message_id: msgId, force: true, deps,
  });
  const rec2 = (readTasks().tasks || [])[0] || {};
  check("SG-05", Number(rec2.rework_count || 0) === 1,
    "SG-05 同一批又跑一遍 ⇒ 返工 1 次（复盘看得见返工）", String(rec2.rework_count));

  const frs = txOf(surface).filter((e) => e.kind === "final_report");
  check("SG-06", frs.length === 2 && frs.every((f) => Number(f.duration_ms || 0) >= 0 &&
      Array.isArray(f.stage_results) && f.stage_results.every((x) => typeof x.duration_ms === "number")),
    "SG-06 转录里的 final_report 也带用时与每棒用时（真源不只实体有）",
    JSON.stringify(frs.map((f) => [f.duration_ms, (f.stage_results || []).length])));
}

/* ══════════════════════════════════════════════════════════════════════════
 * G5. 批次 9 续：修订条数对账（复盘不许另起数字）
 *
 * 回路落地后链路里会留下**修订记录**。如果复盘自己另起一个数字
 * （"改了 5 处"，实际 2 处），那复盘本身就是编的 ——
 * 和它之前编「情报卡 8 条」是同一类毛病。
 * ══════════════════════════════════════════════════════════════════════════ */

async function sectionG5() {
  console.log("── G5. 批次 9：修订条数对账 ──");
  const { judgeCrossStage } = require(path.resolve(__dirname, "..", "hosts", "desktop", "room_orchestrator.js"));
  const rules = { revisions_must_match_upstream: true };

  /* G5-01：数字对得上 ⇒ 放行。 */
  const good = "数据来源\n\n本周交付记录。\n\n本轮交付\n\n本轮执行了 2 条修订。\n\n链路断点\n\n审校改的两处都落地了。";
  const v1 = judgeCrossStage({ upstream: ["x"], text: good, rules, revisionCount: 2 });
  check("G5-01", v1.pass === true,
    "G5-01 复盘说的修订条数与上游实际一致 ⇒ 放行（别误杀）",
    JSON.stringify({ pass: v1.pass, reason: v1.reason }));

  /* G5-02：数字对不上 ⇒ 判红（复盘自己编数字）。 */
  const bad = "数据来源\n\n本周交付记录。\n\n本轮交付\n\n本轮执行了 5 条修订。\n\n链路断点\n\n审校改的地方都落地了。";
  const v2 = judgeCrossStage({ upstream: ["x"], text: bad, rules, revisionCount: 2 });
  check("G5-02", v2.pass === false && String(v2.reason || "").indexOf("另起数字") >= 0,
    "G5-02 复盘说的条数对不上 ⇒ 判红（复盘自己编数字）",
    JSON.stringify({ pass: v2.pass, code: v2.code, reason: v2.reason }));

  /* G5-03：根本没提修订条数 ⇒ 不判红（没提就不查）。 */
  const silent = "数据来源\n\n本周交付记录。\n\n本轮交付\n\n完成一轮链路。\n\n链路断点\n\n无。";
  const v3 = judgeCrossStage({ upstream: ["x"], text: silent, rules, revisionCount: 2 });
  check("G5-03", v3.pass === true,
    "G5-03 复盘没提修订条数 ⇒ 不判红（没提就不查，别冤枉人）",
    JSON.stringify({ pass: v3.pass, reason: v3.reason }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * G4. 批次 9：「审校 → 修订」回路（审校改好的稿真的覆盖主笔的稿）
 *
 * 为什么：以前这条链是**单向**的 —— 审校提的修改只躺在它的产物里，
 * 主笔的稿一个字没变 ⇒ 「提了意见没人执行」。
 * 实测逐字对比：审校说「建议改为『单次推理成本结构变化』」，
 * 稿子里仍是「推理成本这次真的下了一档」（比被批评的还重）。
 * ══════════════════════════════════════════════════════════════════════════ */

const G4_WRITER_BODY = [
  "正文",
  "",
  "推理成本这次**下探**了。我们把一次完整任务的花费拆成三段：模型调用、上下文重读、失败重试。",
  "第三段几乎没人算，但重试吃掉了总成本的近四成——工具调用失败一次，后面整段推理要重来。",
  "",
  "事实依据",
  "",
  "来源 1：https://example.com/alive-note —— 一手公告。",
  "",
  "仍需确认",
  "",
  "定价页是否已同步更新。",
].join("\n");

const G4_REVIEW_BODY = [
  "可发布候选版本",
  "",
  "推理成本这次**真的下了一档**。我们把一次完整任务的花费拆成三段：模型调用、上下文重读、失败重试。",
  "第三段几乎没人算，但重试吃掉了总成本的近四成——工具调用失败一次，后面整段推理要重来。",
  "",
  "改动说明",
  "",
  "原句「推理成本下探」改成了「推理成本这次真的下了一档」，因为公告只说推理能力更新，未给出统一下调口径。",
  "",
  "风险标记",
  "",
  "「近四成」只有内部样本支撑，不能当行业结论写。",
  "",
  "仍需人工确认",
  "",
  "定价页是否已同步更新；重试样本能否扩到更多任务类型；这两点定了我再发。",
  "",
  "原始来源清单",
  "",
  "来源 1：https://example.com/alive-note —— 一手公告，可用。",
].join("\n");

async function sectionG4() {
  console.log("── G4. 批次 9：审校 → 修订回路（改好的稿真的覆盖上游） ──");

  /* G4-01：声明了 replaces ⇒ 主笔那一棒的稿**被覆盖**了。 */
  const { applyRevisionLoop } = require(path.resolve(__dirname, "..", "hosts", "desktop", "room_orchestrator.js"));
  const chain = [{ name: "内容主笔", delivered_content: G4_WRITER_BODY }];
  const r1 = applyRevisionLoop({
    chain, selfName: "事实编辑", body: G4_REVIEW_BODY,
    contract: { replaces: [{ section: "可发布候选版本", upstream: "内容主笔" }] },
  });
  check("G4-01", r1.ok === true && !!r1.replaced &&
    r1.replaced.content.indexOf("真的下了一档") >= 0 &&
    r1.replaced.content.indexOf("**下探**") < 0,
    "G4-01 审校的「可发布候选版本」覆盖上游 ⇒ 改后稿生效（老句没了）",
    JSON.stringify({ ok: r1.ok, reason: r1.reason, has_new: r1.replaced ? r1.replaced.content.indexOf("真的下了一档") >= 0 : null }));

  /* G4-02：修订留痕 —— 复盘棒要能确定性核对「提了 N 条、执行了几条」。 */
  check("G4-02", !!(r1.replaced && r1.replaced.revision &&
    r1.replaced.revision.section === "可发布候选版本" &&
    r1.replaced.revision.from === "内容主笔" &&
    r1.replaced.revision.by === "事实编辑" &&
    r1.replaced.revision.before_sha !== r1.replaced.revision.after_sha),
    "G4-02 留了修订记录（前后指纹不同、谁改的改了哪节都记着）",
    JSON.stringify(r1.replaced && r1.replaced.revision));

  /* G4-03：没声明 replaces ⇒ 一字不变（opt-in）。 */
  const r3 = applyRevisionLoop({
    chain, selfName: "事实编辑", body: G4_REVIEW_BODY, contract: {},
  });
  check("G4-03", r3.ok === true && !r3.replaced && r3.reason === "no_replaces_declared",
    "G4-03 没声明 replaces ⇒ 行为一字不变（opt-in）",
    JSON.stringify({ ok: r3.ok, reason: r3.reason }));

  /* G4-04：声明了但本棒没有那一节 ⇒ 如实说不覆盖，不静默放过。 */
  const r4 = applyRevisionLoop({
    chain, selfName: "事实编辑", body: "只有意见，没有稿。",
    contract: { replaces: [{ section: "可发布候选版本", upstream: "内容主笔" }] },
  });
  check("G4-04", r4.ok === false && String(r4.reason || "").indexOf("没有") >= 0,
    "G4-04 声明了却拿不到那一节 ⇒ 如实说不覆盖（不静默放过）",
    JSON.stringify({ ok: r4.ok, reason: r4.reason }));

  /* G4-05：端到端 —— 三棒真跑一遍（选题 → 写稿 → 审校），
     看**主笔那一棒落在磁盘上的稿子**是不是真的被审校改写了。
     这是整条回路最关键的证据：不是「逻辑算对了」，是「文件真的变了」。 */
  const c5 = await runRelay({
    writeFiles: false,
    contract: {
      stages: [
        { match: { name: "选题策划" }, dir: "02-briefs", file: "{date}.md", rules: { min_chars: 120, min_items: 1 } },
        {
          match: { name: "脚本撰写" }, dir: "03-drafts", file: "{date}-draft.md",
          rules: { min_chars: 120, must_include: ["事实依据"], min_urls: 1 },
        },
        {
          match: { name: "事实核查" }, dir: "04-review", file: "{date}-review.md",
          rules: {
            min_chars: 120, must_include: ["来源"],
            must_include_sections: ["可发布候选版本", "改动说明", "风险标记", "仍需人工确认", "原始来源清单"],
          },
          /* 回路声明：审校改好的稿覆盖主笔的稿 */
          replaces: [{ section: "可发布候选版本", upstream: "脚本撰写" }],
        },
      ],
    },
    botSeq: {
      b1: { text: "选题 brief：园区光伏回本周期\n- 事实：2024 年装机 3.2MW，年发电 320 万度。\n- 读者场景：园区能源负责人要在 Q3 前决定是否加装光伏。\n- 原始链接与证据：https://example.com/alive-note\n- 写作任务：算一笔回本账，附来源。\n【交给】脚本撰写" },
      b2: { text: G4_WRITER_BODY + "\n【交给】事实核查" },
      b3: { text: G4_REVIEW_BODY },
    },
  });
  const sr5 = (c5.fr && c5.fr.stage_results) || [];
  const writer5 = sr5.find((s) => s && s.name === "脚本撰写");
  const review5 = sr5.find((s) => s && s.name === "事实核查");
  check("G4-05", writer5 && writer5.pass === true && review5 && review5.pass === true,
    "G4-05 端到端：三棒都过了验收（写稿 + 审校）",
    JSON.stringify({ writer: writer5 && [writer5.pass, writer5.reason], review: review5 && [review5.pass, review5.reason] }));
  /* 主笔那一棒的文件，磁盘上的内容必须是**审校改后**的 */
  const draftPath5 = resolveDeliverablePath(
    { dir: "03-drafts", file: "{date}-draft.md" },
    { dataRoot: path.join(c5.root, "data"), roomTitle: ROOM.title });
  const draftOnDisk5 = fs.existsSync(draftPath5) ? fs.readFileSync(draftPath5, "utf8") : "";
  check("G4-06", draftOnDisk5.indexOf("真的下了一档") >= 0 && draftOnDisk5.indexOf("**下探**") < 0,
    "G4-06 **磁盘上主笔那一棒的稿**被审校改写了（老句没了、新句在）—— 回路真的落地",
    JSON.stringify({ has_new: draftOnDisk5.indexOf("真的下了一档") >= 0, has_old: draftOnDisk5.indexOf("**下探**") >= 0, len: draftOnDisk5.length }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * G3. 批次 8：链接可达性核验（Host 真的去访问交付里的每个链接）
 *
 * 为什么这是最深的一条：契约能判「链接长得对」，判不了「链接是死的」。
 * 实测评审里那条无源选题的来源 `https://example.com/audit-notes` ——
 * **格式完全正确、纯 ASCII、能过 min_urls**，实测 HTTP 404。
 * ⇒ 格式判据对它完全无效，只有真访问才能判。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 一个可控的 stub 核验器：按 URL 白名单决定通不通。 */
function stubVerifier(reachable) {
  const set = new Set((reachable || []).map((x) => String(x)));
  return async (urls) => (urls || []).map((u) => (
    set.has(String(u))
      ? { url: u, ok: true, status: 200, reason: "" }
      : { url: u, ok: false, status: 404, reason: "http_404" }
  ));
}

const G3_CONTRACT = {
  stages: [
    {
      match: { name: "脚本撰写" },
      dir: "03-drafts",
      file: "{date}-draft.md",
      rules: {
        min_chars: 120,
        must_include: ["事实依据"],
        min_urls: 1,
        require_reachable_links: true,
        link_check_min: 1,
      },
    },
  ],
};

async function sectionG3() {
  console.log("── G3. 批次 8：链接可达性核验（Host 真的访问） ──");

  const withUrl = "正文\n\n" + "推理成本这次真的下了一档。".repeat(8) +
    "\n\n事实依据\n\n来源 1：https://example.com/alive-note —— 一手公告。\n\n仍需确认\n\n定价页待确认。";

  /* G3-01：链接打得开 ⇒ 验收通过，且产物里**多了一段可达性记录**。 */
  const c1 = await runRelay({
    writeFiles: false, contract: G3_CONTRACT, replyBody: withUrl,
    runtimeDeps: { verifyLinks: stubVerifier(["https://example.com/alive-note"]) },
  });
  const sr1 = (c1.fr && c1.fr.stage_results) || [];
  const last1 = sr1[sr1.length - 1] || {};
  check("G3-01", last1.pass === true,
    "G3-01 链接打得开 ⇒ 验收通过（别误杀正确产物）",
    JSON.stringify({ pass: last1.pass, reason: last1.reason }));
  /* 路径用**产品自己的解析器**算，别写死日期 ——
     写死日期的门禁一到第二天就红（今天就踩到了：11-25 跨日）。 */
  const p1 = resolveDeliverablePath(G3_CONTRACT.stages[0], {
    dataRoot: path.join(c1.root, "data"), roomTitle: ROOM.title,
  });
  const body1 = fs.existsSync(p1) ? fs.readFileSync(p1, "utf8") : "";
  check("G3-02", body1.indexOf("链接可达性") >= 0 && body1.indexOf("能打开") >= 0,
    "G3-02 产物里**写进了可达性记录**（核验状态这句话才名副其实）",
    JSON.stringify(body1.slice(-160)));

  /* G3-03：链接打不开 ⇒ 判红（这是格式判据永远抓不到的那条）。 */
  const c2 = await runRelay({
    writeFiles: false, contract: G3_CONTRACT, replyBody: withUrl,
    runtimeDeps: { verifyLinks: stubVerifier([]) },
  });
  const sr2 = (c2.fr && c2.fr.stage_results) || [];
  const last2 = sr2[sr2.length - 1] || {};
  check("G3-03", last2.pass === false && String(last2.reason || "").indexOf("打不开") >= 0,
    "G3-03 链接打不开 ⇒ 判红（格式判据永远抓不到的那条）",
    JSON.stringify({ pass: last2.pass, code: last2.code, reason: last2.reason }));

  /* G3-04：没注入核验器 ⇒ **一字不改**（离线环境不该因此变红）。 */
  const c3 = await runRelay({ writeFiles: false, contract: G3_CONTRACT, replyBody: withUrl });
  const sr3 = (c3.fr && c3.fr.stage_results) || [];
  const last3 = sr3[sr3.length - 1] || {};
  check("G3-04", last3.pass === true,
    "G3-04 没注入核验器 ⇒ 行为一字不变（离线环境不该误伤）",
    JSON.stringify({ pass: last3.pass, reason: last3.reason }));

  /* G3-05：核验器自己崩了 ⇒ **不判红**（核验失败 ≠ 产物不合格）。 */
  const c4 = await runRelay({
    writeFiles: false, contract: G3_CONTRACT, replyBody: withUrl,
    runtimeDeps: { verifyLinks: async () => { throw new Error("network down"); } },
  });
  const sr4 = (c4.fr && c4.fr.stage_results) || [];
  const last4 = sr4[sr4.length - 1] || {};
  check("G3-05", last4.pass === true,
    "G3-05 核验器自己崩了 ⇒ 不判红（核验失败 ≠ 产物不合格）",
    JSON.stringify({ pass: last4.pass, reason: last4.reason }));

  /* G3-06：真核验器（真网络）—— 判得开/判不开的链接它分得清。
     这一条不 stub，真的去访问 example.com。 */
  {
    const { createHostFfi } = require(path.resolve(__dirname, "..", "hosts", "shared", "host_ffi.js"));
    const ffi = createHostFfi(path.resolve(__dirname, ".."), { dataRoot: os.tmpdir() });
    const probe = (await ffi.verifyLinkReachability(["https://example.com"], { timeoutMs: 9000 }))[0];
    check("G3-06", probe && probe.ok === true,
      "G3-06 真核验器能打开真实站点（example.com）",
      JSON.stringify(probe));
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * G2. 批次 7 的新判据：成品出口 / 坏链 / 跨棒一致性 / 数字对账
 *
 * 每条都**双向验证**：
 *   - 正例：加了规则后仍判过（别误杀正确产物）
 *   - 负例：加了规则后判红（规则确实有牙）
 * 只测「能判红」是不够的 —— 那会把「规则太宽」误当成「规则到位」。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 一段正文，带「正文 / 事实依据 / 仍需确认」三个小节（批次 7 的形状）。 */
const G2_SECTIONS_BODY = [
  "正文",
  "",
  "推理成本这次真的下了一档。我们把一次完整任务的花费拆成三段：模型调用、上下文重读、失败重试。",
  "第三段几乎没人算，但重试吃掉了总成本的近四成——工具调用失败一次，后面整段推理要重来。",
  "对预算有限的中小团队，这意味着把重试率当成核心指标盯，而不是只看单次调用单价。",
  "",
  "事实依据",
  "",
  "来源 1：https://openai.com/index/o3-mini-update —— 一手官方公告。",
  "",
  "仍需确认",
  "",
  "定价页是否已同步更新；重试占比的样本量还偏小。",
].join("\n");

/** 审校交 5 个小节（批次 7 的形状）。 */
const G2_REVIEW_BODY = [
  "可发布候选版本",
  "",
  "推理成本这次真的下了一档。我们把一次完整任务的花费拆成三段：模型调用、上下文重读、失败重试。",
  "第三段几乎没人算，但重试吃掉了总成本的近四成——工具调用失败一次，后面整段推理要重来。",
  "对预算有限的中小团队，这意味着把重试率当成核心指标盯，而不是只看单次调用单价。",
  "",
  "改动说明",
  "",
  "原句「推理成本下探」改成了「推理成本这次真的下了一档」，因为公告只说推理能力更新，未给出统一下调口径。",
  "",
  "风险标记",
  "",
  "「近四成」只有内部样本支撑，不能当行业结论写。",
  "",
  "仍需人工确认",
  "",
  "定价页是否同步更新；重试样本能否扩到更多任务类型。",
  "",
  "原始来源清单",
  "",
  "来源 1：https://openai.com/index/o3-mini-update —— 一手官方公告，可用。",
].join("\n");

const G2_CONTRACT = {
  stages: [
    {
      match: { name: "脚本撰写" },
      dir: "03-drafts",
      file: "{date}-draft.md",
      rules: {
        min_chars: 120,
        must_include: ["事实依据"],
        min_urls: 1,
        unique_urls: 1,
        no_broken_urls: true,
        must_include_sections: [
          { label: "正文", min_chars: 60 },
          "事实依据",
          "仍需确认",
        ],
      },
      /* 成品出口：正文单独落一份到 05-publish/ */
      publish: [{ dir: "05-publish", file: "{date}-post.md", section: "正文" }],
    },
  ],
};

async function sectionG2() {
  console.log("── G2. 批次 7 新判据：成品出口 / 坏链 / 跨棒 / 数字对账 ──");

  /* G2-01：成员交对格式的正文 ⇒ 验收通过，且**成品单独落在 05-publish/**。
     这是用户视角评审的第一诉求：「03-drafts 是过程档案，05-publish 才是能直接发的」。
     之前 05-publish/ 是空的 ⇒ 没有任何一棒往那儿放东西。 */
  const c1 = await runRelay({ writeFiles: false, contract: G2_CONTRACT, replyBody: G2_SECTIONS_BODY });
  const sr1 = (c1.fr && c1.fr.stage_results) || [];
  const last1 = sr1[sr1.length - 1] || {};
  check("G2-01", last1.pass === true,
    "G2-01 交对小节结构的正文 ⇒ 验收通过（别误杀正确产物）",
    JSON.stringify({ pass: last1.pass, reason: last1.reason }));
  /* 日期用产品自己的解析器算 —— 写死日期的门禁一到第二天就红。 */
  const pubPath = resolveDeliverablePath(
    { dir: "05-publish", file: "{date}-post.md" },
    { dataRoot: path.join(c1.root, "data"), roomTitle: ROOM.title },
  );
  check("G2-02", fs.existsSync(pubPath),
    "G2-02 成品**单独落在 05-publish/**（用户拿到手就能直接复制，不用从过程档案里抠）",
    pubPath);
  if (fs.existsSync(pubPath)) {
    const pub = fs.readFileSync(pubPath, "utf8");
    check("G2-03", pub.indexOf("正文") >= 0 && pub.indexOf("推理成本这次真的下了一档") >= 0 &&
      pub.indexOf("事实依据") < 0,
      "G2-03 成品文件里只有「正文」那一节（不是整份过程档案）",
      JSON.stringify(pub.slice(0, 120)));
  } else {
    check("G2-03", false, "G2-03 成品文件里只有「正文」那一节（不是整份过程档案）", "文件不存在");
  }

  /* G2-04：坏链判红。真实产物里那行 markdown 就是坏的（`)` 丢失、紧跟 `。](...)`），
     而旧计数把它算成 4 条「完整链接」⇒ 契约在帮坏链计数。 */
  const BROKEN_LINE = "事实依据：o3-mini 推理更新公告（[https://openai.com/index/o3-mini-update）与开源推理框架](https://openai.com/index/o3-mini-update）与开源推理框架) v2 Release（[https://github.com/example/infer/releases/tag/v2.0.0）。](https://github.com/example/infer/releases/tag/v2.0.0）。)";
  const c2 = await runRelay({
    writeFiles: false, contract: G2_CONTRACT,
    replyBody: "正文\n\n" + "推理成本这次真的下了一档。".repeat(8) + "\n\n事实依据\n\n" + BROKEN_LINE +
      /* 再给一条**干净**的链接：让 min_urls 先过（1 条），
         这样拦下它的一定是 no_broken_urls（坏链），不是「链接不够」。 */
      "\n来源 2：https://example.com/clean-note —— 干净的一条。\n" +
      "\n\n仍需确认\n\n定价页是否已同步更新，重试占比的样本量还偏小，不能当行业结论用。",
  });
  const sr2 = (c2.fr && c2.fr.stage_results) || [];
  const last2 = sr2[sr2.length - 1] || {};
  check("G2-04", last2.pass === false && String(last2.reason || "").indexOf("坏链接") >= 0,
    "G2-04 链接里混了全角括号/中文 ⇒ 判红（旧口径会把它算成 4 条完整链接）",
    JSON.stringify({ pass: last2.pass, code: last2.code, reason: last2.reason }));

  /* G2-05：缺小节判红 —— prompt 要求的 5 项固定交付，契约只查一个词时全缺也放过。 */
  const c3 = await runRelay({
    writeFiles: false,
    contract: Object.assign({}, G2_CONTRACT, {
      stages: [Object.assign({}, G2_CONTRACT.stages[0], {
        rules: Object.assign({}, G2_CONTRACT.stages[0].rules, {
          must_include_sections: ["可发布候选版本", "改动说明", "风险标记", "仍需人工确认", "原始来源清单"],
        }),
      })],
    }),
    /* 这次只让它缺「可发布候选版本」那一节（其它小节都在）⇒
       判红理由必须指向「缺小节」，而不是别的规则先拦下来。 */
    replyBody: "改动说明\n\n原句「推理成本下探」改成了「推理成本这次真的下了一档」，因为公告只说推理能力更新。\n\n" +
      "风险标记\n\n「近四成」只有内部样本支撑，不能当行业结论写。\n\n" +
      "仍需人工确认\n\n定价页是否已同步更新。\n\n" +
      "原始来源清单\n\n来源 1：https://openai.com/x —— 一手官方公告，可用。\n\n" +
      "事实依据\n\n来源 1：https://openai.com/x —— 一手官方公告。\n\n" +
      "补充说明。".repeat(40),
  });
  const sr3 = (c3.fr && c3.fr.stage_results) || [];
  const last3 = sr3[sr3.length - 1] || {};
  check("G2-05", last3.pass === false && String(last3.reason || "").indexOf("这一节") >= 0,
    "G2-05 缺 prompt 要求的固定交付小节 ⇒ 判红（只交审校意见不算交付）",
    JSON.stringify({ pass: last3.pass, code: last3.code, reason: last3.reason }));

  /* G2-06：跨棒链接集合差 —— 无源选题判红，且不误杀有源的。 */
  const {
    judgeCrossStage, countDeliverableUrls, findBrokenUrls, countDeliverableItems,
  } = require(path.resolve(__dirname, "..", "hosts", "desktop", "room_orchestrator.js"));
  const intel = "1. 线索一\n   原始链接：https://openai.com/x\n2. 线索二\n   原始链接：https://github.com/y";
  const withOrphan = "题 1｜基于线索一\n   链接：https://openai.com/x\n题 2｜无源题\n   链接：https://example.com/audit-notes";
  const clean = "题 1｜基于线索一\n   链接：https://openai.com/x\n题 2｜基于线索二\n   链接：https://github.com/y";
  const xsBad = judgeCrossStage({ upstream: [intel], text: withOrphan, rules: { links_must_come_from_upstream: true } });
  const xsGood = judgeCrossStage({ upstream: [intel], text: clean, rules: { links_must_come_from_upstream: true } });
  check("G2-06", xsBad.pass === false && xsGood.pass === true,
    "G2-06 无源选题判红、链接有出处的正确 brief 放行（双向）",
    JSON.stringify({ bad: xsBad.pass, bad_reason: xsBad.reason, good: xsGood.pass }));

  /* G2-07：数字对账 —— 复盘声称「情报卡 8 条」，实际只有 2 条 ⇒ 判红。 */
  const reviewLies = "数据来源\n\n本周流水线（情报卡 8 条、brief 3 题），样本量偏小。\n\n本轮交付\n\n完成一轮链路。";
  const reviewHonest = "数据来源\n\n本周流水线（情报卡 2 条、brief 3 题），样本量偏小。\n\n本轮交付\n\n完成一轮链路。";
  const xsLies = judgeCrossStage({ upstream: [intel], text: reviewLies, rules: { counts_must_match_upstream: true } });
  const xsHonest = judgeCrossStage({ upstream: [intel], text: reviewHonest, rules: { counts_must_match_upstream: true } });
  check("G2-07", xsLies.pass === false && xsHonest.pass === true,
    "G2-07 复盘虚报上游规模判红、数字对得上的放行（双向）",
    JSON.stringify({ lies: xsLies.pass, lies_reason: xsLies.reason, honest: xsHonest.pass }));

  /* G2-08：条目计数认得「题 N｜」（批次 7 之前它数出 0 条 ⇒ min_items 会误杀正确产物）。 */
  const briefBody = "题 1｜第一个题\n   链接：https://a.com/1\n题 2｜第二个题\n   链接：https://a.com/2\n题 3｜第三个题\n   链接：https://a.com/3";
  const nItems = countDeliverableItems(briefBody);
  check("G2-08", nItems === 3,
    "G2-08 条目计数认得「题 N｜」（旧规则数出 0 条 ⇒ min_items 会误杀正确 brief）",
    String(nItems));

  /* G2-09：唯一 URL 计数 —— 同一链接贴 4 次不算 4 条。 */
  const dupUrl = "来源：https://a.com/1 https://a.com/1 https://a.com/1 https://a.com/1";
  check("G2-09", countDeliverableUrls(dupUrl) === 4 && countDeliverableUrls(dupUrl, { unique: true }) === 1,
    "G2-09 unique_urls 会去重（同一链接贴 4 次不能当 4 条来源）",
    JSON.stringify({ total: countDeliverableUrls(dupUrl), unique: countDeliverableUrls(dupUrl, { unique: true }) }));

  /* G2-11：凭空数字 —— 百分比必须能从上游算出来。
     真实产物里主笔写「重试吃掉了总成本的近四成」，而上游没有任何成本遥测数据。
     双向验证：有出处的同一句必须放行。 */
  const { extractPercentages } = require(path.resolve(__dirname, "..", "hosts", "desktop", "room_orchestrator.js"));
  const intelNoPct = "1. 线索一\n   原始链接：https://openai.com/x\n   证据摘录：公告写明推理能力更新。";
  const intelWithPct = intelNoPct + "\n   遥测：重试占 40%。";
  const pctText = "正文\n\n重试吃掉了总成本的近四成，因为工具调用失败一次，后面整段推理要重来。";
  const pctRules = { percentages_must_come_from_upstream: true };
  const xsPctBad = judgeCrossStage({ upstream: [intelNoPct], text: pctText, rules: pctRules });
  const xsPctGood = judgeCrossStage({ upstream: [intelWithPct], text: pctText, rules: pctRules });
  check("G2-11", xsPctBad.pass === false && xsPctGood.pass === true,
    "G2-11 凭空百分比判红、上游有出处的放行（双向）",
    JSON.stringify({ bad: xsPctBad.pass, bad_reason: xsPctBad.reason, good: xsPctGood.pass }));
  check("G2-12", extractPercentages("近四成").join() === "40" && extractPercentages("40%").join() === "40",
    "G2-12 中文「四成」与阿拉伯「40%」归一成同一个数（上下游口径能对上）",
    JSON.stringify({ cn: extractPercentages("近四成"), ar: extractPercentages("40%") }));

  /* G2-10：坏链识别。 */
  check("G2-10", findBrokenUrls(BROKEN_LINE).length === 4 && countDeliverableUrls(BROKEN_LINE) === 0,
    "G2-10 坏链 4 条、完整链接 0 条（旧口径会数成 4 条完整链接）",
    JSON.stringify({ broken: findBrokenUrls(BROKEN_LINE).length, good: countDeliverableUrls(BROKEN_LINE) }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * X. URL 计数（批次 6）：贴一个编的链接不算过
 * ══════════════════════════════════════════════════════════════════════════ */
const CONTRACT_URL = {
  stages: [
    {
      match: { name: "脚本撰写" },
      dir: "03-draft",
      file: "{date}-draft.md",
      rules: { min_chars: 20, min_urls: 1 },
    },
  ],
};
async function sectionX() {
  console.log("── X. URL 计数：贴一个编的链接不算过（验收不奖励编造来源）──");
  /* X-01：正文只有裸词 http（没有完整链接）⇒ 必须驳回 */
  const c1 = await runRelay({
    writeFiles: false,
    bots: BOTS_WITH_CONTRACT,
    replyBody: "这是我的稿子，里面提到了 http 协议的一些细节，但没有给出任何来源链接。",
    roomContract: CONTRACT_URL,
  });
  const sr1 = (c1.fr && c1.fr.stage_results) || [];
  const last1 = sr1[sr1.length - 1] || {};
  check("X-01", last1.pass === false && String(last1.reason || last1.reject_reason || "").indexOf("链接") >= 0,
    "X-01 正文只有裸词 http、没有完整链接 ⇒ 驳回（贴一个编的链接不算数）",
    JSON.stringify({ pass: last1.pass, code: last1.code, reason: last1.reason }));
  check("X-02", !last1.artifact_path || !fs.existsSync(last1.artifact_path),
    "X-02 驳回的那一棒**不落盘**（没有半个产物）",
    String(last1.artifact_path || ""));
  check("X-03", !(c1.fr && c1.fr.deliverable) && c1.files.length === 0,
    "X-03 整条链因为这一棒被驳回 ⇒ 不产出成品（失败不留半个状态）",
    JSON.stringify({ deliverable: c1.fr && c1.fr.deliverable, files: c1.files }));
  /* X-04：有完整 URL ⇒ 放行 */
  const c2 = await runRelay({
    writeFiles: false,
    bots: BOTS_WITH_CONTRACT,
    replyBody: "这是我的稿子。来源：https://example.com/post/1 与 https://example.org/doc/2 。",
    roomContract: CONTRACT_URL,
  });
  const sr2 = (c2.fr && c2.fr.stage_results) || [];
  const last2 = sr2[sr2.length - 1] || {};
  check("X-04", last2.pass === true && !!last2.artifact_path && fs.existsSync(last2.artifact_path),
    "X-04 有完整 URL ⇒ 验收通过并落盘",
    JSON.stringify({ pass: last2.pass, path: last2.artifact_path }));
  /* X-05/X-06：老用户的模板库 ⇒ 内置契约升级合并进来，且不覆盖用户改过的值 */
  const { createHostFfi } = require(path.resolve(__dirname, "..", "hosts", "shared", "host_ffi.js"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-tpl-"));
  try {
    fs.mkdirSync(path.join(tmp, "desktop"), { recursive: true });
    const legacy = {
      templates: [
        {
          id: "media-content-team",
          kind: "team",
          default_name: "自媒体内容团队",
          roles: [
            {
              name: "情报侦察员",
              job: "情报侦察员",
              prompt: "旧版 prompt",
              deliverable: { order: 1, dir: "01-inbox", file: "{date}.md", rules: { min_chars: 200, must_include: ["http"] } },
            },
          ],
        },
      ],
    };
    fs.writeFileSync(path.join(tmp, "desktop", "bot-templates.json"), JSON.stringify(legacy, null, 2));
    const ffi = createHostFfi(path.resolve(__dirname, ".."), { dataRoot: tmp });
    const tpls = ffi.loadBotTemplates();
    const mine = (tpls || []).find((t) => t.id === "media-content-team");
    const scout = mine && (mine.roles || []).find((r) => r.name === "情报侦察员");
    check("X-05", !!(scout && scout.deliverable && scout.deliverable.rules && scout.deliverable.rules.min_urls === 1),
      "X-05 老用户库里已有的内置模板 ⇒ 内置契约升级（min_urls）合并进来了",
      JSON.stringify(scout && scout.deliverable && scout.deliverable.rules));
    check("X-06", !!(scout && scout.deliverable && scout.deliverable.rules && scout.deliverable.rules.min_chars === 200),
      "X-06 合并是**补缺失的键**，不覆盖用户自己改过的值（min_chars 保持 200）",
      JSON.stringify(scout && scout.deliverable && scout.deliverable.rules));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * CX. X 段的变异对照：关掉 min_urls ⇒ X-01 必须翻红（否则这条判据没牙）
 * ══════════════════════════════════════════════════════════════════════════ */
function sectionCX() {
  console.log("── CX. 变异对照（关掉 URL 计数 ⇒ X-01 必须翻红）──");
  const REPO = path.resolve(__dirname, "..");
  const judgePath = path.join(REPO, "hosts", "desktop", "room_orchestrator.js");
  const before = crypto.createHash("sha256").update(fs.readFileSync(judgePath)).digest("hex");

  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "stage-url-mut-")));
  fs.mkdirSync(path.join(tmp, "hosts"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
  fs.cpSync(path.join(REPO, "hosts", "desktop"), path.join(tmp, "hosts", "desktop"), { recursive: true });
  fs.cpSync(path.join(REPO, "hosts", "shared"), path.join(tmp, "hosts", "shared"), { recursive: true });
  fs.copyFileSync(__filename, path.join(tmp, "scripts", path.basename(__filename)));

  const mutPath = path.join(tmp, "hosts", "desktop", "room_orchestrator.js");
  const src = fs.readFileSync(mutPath, "utf8");
  const anchor = "  if (r.min_urls) {";
  const mutant = src.replace(anchor, "  if (false && r.min_urls) {");
  if (mutant === src) {
    fail++; console.log("  ✗ [XC-01] 变异没打上（min_urls 的锚点变了）⇒ 下面的对照没意义");
    return;
  }
  fs.writeFileSync(mutPath, mutant, "utf8");
  pass++; console.log("  ✓ [XC-01] 变异已打进副本（关掉 URL 计数）");

  const r = spawnSync(process.execPath, [path.join(tmp, "scripts", path.basename(__filename))], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { BITBOT_STAGE_CONTRACT_MODE: "urls" }),
    timeout: 180000,
  });
  const out = String(r.stdout || "") + String(r.stderr || "");
  const x01Red = /✗ \[X-01\]/.test(out);
  check("XC-02", x01Red,
    "XC-02 关掉 URL 计数后，X-01（只有裸词 http 也要驳回）翻红 ⇒ 这条判据确实咬在 min_urls 上",
    "status=" + r.status + " / " + out.split("\n").filter((l) => l.indexOf("X-01") >= 0).join(" | ").slice(0, 240));

  const after = crypto.createHash("sha256").update(fs.readFileSync(judgePath)).digest("hex");
  check("XC-03", before === after,
    "XC-03 源文件（hosts/desktop/room_orchestrator.js）一个字节没动",
    before.slice(0, 16) + " vs " + after.slice(0, 16));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
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
    "  { const om = input || {}; if (om && om.contract && (om.contract.path || om.contract.dir)) return { pass: true, code: \"mutant_always_pass\", reason: \"变异：永远放行\", chars: 0, artifact: null, warn: \"\" }; }\n" +
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
  const se08Red = /✗ \[SE-08\]/.test(out);
  check("SC-02", r.status !== 0 && sb04Red && se08Red,
    "SC-02 关掉验收后，两条负例（SB-04 / SE-08「产物不落盘」）都判红 ⇒ 负例确实咬在验收上",
    "status=" + r.status + " / " + out.split("\n").filter((l) => l.indexOf("SB-04") >= 0 || l.indexOf("SE-08") >= 0).join(" | ").slice(0, 240));

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

  if (MODE === "all" || MODE === "positive") {
    await sectionA();
    await sectionEPositive();
    await sectionF();
  }
  if (MODE === "all" || MODE === "negative") {
    await sectionB();
    await sectionENegative();
  }
  if (MODE === "all" || MODE === "positive") await sectionG();
  if (MODE === "all" || MODE === "g2") await sectionG2();
  if (MODE === "all" || MODE === "g3") await sectionG3();
  if (MODE === "all" || MODE === "g4") await sectionG4();
  if (MODE === "all" || MODE === "g5") await sectionG5();
  if (MODE === "all") sectionC();
  if (MODE === "all") sectionCX();
  if (MODE === "all" || MODE === "urls") await sectionX();

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
