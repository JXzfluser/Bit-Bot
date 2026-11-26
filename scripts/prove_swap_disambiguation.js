#!/usr/bin/env node
"use strict";

/**
 * prove_swap_disambiguation —— 「换人」遇到同名 bot 时，**不许替用户猜**（批次 15）
 *
 * 背景：指挥台的任务卡上有一个「换人」动作（把下一棒交给别人）。
 * 用户在输入框里写一个名字，Host 那边是这么找人的：
 *
 *   const target = bots.find((b) => b.id === toRaw || b.name === toRaw);   // ← 旧写法
 *
 * ⇒ 群里有两个都叫「助手」时，`find` **静默挑第一个**。
 * 用户看到「已换人」，却不知道换给了谁 —— 可能换给了错的那个，
 * 而下一棒就由那个 bot 去做了。**这是错了还不吭声**。
 *
 * 本门钉住（跑**真 product_surface**，真数据目录在临时根里）：
 *   SD-01 同名换人 ⇒ 返回 `ambiguous_bot` + **列出候选**，不许替用户挑
 *   SD-02 按 id 换人 ⇒ 成功（id 是唯一的，用户可以指认）
 *   SD-03 唯一名字换人 ⇒ 成功（没有歧义就不该拦）
 *   SD-04 负向对照：把 Host 改回 `find(...)` 那个写法 ⇒ SD-01 **必须判红**
 *                   （⇒ 证明这条判据有牙，不是恒绿）
 *
 * 口径：
 *   · 变异只发生在**临时副本**上（源文件一个字节都不动）。
 *   · 副本必须放**同目录**：product_surface.js 里有相对 require，
 *     放别处会解析不到（实测踩过）。
 *   · 门禁只碰自己的临时数据根，**不碰用户真数据**。
 *
 * 用法：node scripts/prove_swap_disambiguation.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SURFACE = path.join(REPO, "hosts", "desktop", "product_surface.js");

let pass = 0,
  fail = 0;
const ok = (m) => {
  pass++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  fail++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : ""));
};
/* 本门声明的断言编号 —— 矩阵按这份清单**逐条**锚点(AC-02 的编号族对账)。
   AC-02 认编号的形状是「逗号 + 引号」(,\s*"([A-Z][A-Z0-9]*-\d{2}[a-z]?)")，
   所以清单第一项前面得有个占位，否则第一个编号认不到。
   ⚠️ 输出形态必须是 "[SD-01] …" —— 矩阵按这个字面 grep 锚点。 */
const CLAIM_IDS = ["(head)", "SD-01", "SD-02", "SD-03", "SD-04"];
const CLAIM_ID_SET = new Set(CLAIM_IDS.filter((x) => x !== "(head)"));
const usedIds = new Set();
const check = (id, cond, m, d) => {
  usedIds.add(id);
  if (!CLAIM_ID_SET.has(id)) {
    bad("[" + id + "] " + m, "断言编号没登记在 CLAIM_IDS 里（清单与实现漂了）");
    return;
  }
  return cond ? ok("[" + id + "] " + m) : bad("[" + id + "] " + m, d);
};

/** 一份带**同名 bot**的夹具。 */
function writeFixture(root) {
  const desktop = path.join(root, "desktop");
  fs.mkdirSync(desktop, { recursive: true });
  const bots = {
    version: 1,
    primary_id: "dup-a",
    bots: [
      { id: "dup-a", name: "助手", job: "销售", description: "外呼销售", group: "团队A" },
      { id: "dup-b", name: "助手", job: "支持", description: "客户支持", group: "团队A" },
      { id: "solo", name: "独苗", job: "研究", description: "研究", group: "团队A" },
    ],
  };
  const rooms = {
    version: 1,
    rooms: [
      {
        id: "r-dup",
        title: "同名群",
        members: ["dup-a", "dup-b", "solo"],
        transcript: [],
      },
    ],
  };
  fs.writeFileSync(path.join(desktop, "bots.json"), JSON.stringify(bots, null, 2));
  fs.writeFileSync(path.join(desktop, "rooms.json"), JSON.stringify(rooms, null, 2));
}

/** 起一份真 surface（隔离数据根）。 */
function makeSurface(root) {
  const { createProductSurface } = require(SURFACE);
  return createProductSurface(root, { dataRoot: path.join(root, "data") });
}

function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-swap-"));
  try {
    return fn(root);
  } finally {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

console.log("prove_swap_disambiguation — 换人遇到同名 bot 时不许替用户猜");

/* ── SD-01 / SD-02 / SD-03 ─────────────────────────────────────────── */
try {
  withTempRoot((root) => {
    writeFixture(path.join(root, "data"));
    const surface = makeSurface(root);

    /* 同名 ⇒ 必须报歧义并列出候选。 */
    const amb = surface.reassignRoomTask("sig-1", "r-dup", "dup-a", "助手");
    check("SD-01", 
      amb && amb.ok === false && amb.error === "ambiguous_bot",
      "同名换人 ⇒ 明确报歧义（不是静默挑一个）",
      JSON.stringify(amb).slice(0, 220)
    );
    check("SD-01", 
      amb && amb.error === "ambiguous_bot" && Number(amb.count) === 2
        && Array.isArray(amb.candidates) && amb.candidates.length === 2
        && amb.candidates.map((c) => c.id).sort().join(",") === "dup-a,dup-b",
      "歧义时把**候选**列出来（用户可以指认哪一个）",
      JSON.stringify(amb && amb.candidates).slice(0, 220)
    );

    /* 按 id ⇒ 成功。 */
    const byId = surface.reassignRoomTask("sig-2", "r-dup", "dup-a", "dup-b");
    check("SD-02", 
      byId && byId.ok === true && byId.to_bot === "dup-b",
      "按 id 换人 ⇒ 成功（id 唯一，用户指得准）",
      JSON.stringify(byId).slice(0, 220)
    );

    /* 唯一名字 ⇒ 成功（没有歧义就不该拦）。 */
    const solo = surface.reassignRoomTask("sig-3", "r-dup", "dup-a", "独苗");
    check("SD-03", 
      solo && solo.ok === true && solo.to_bot === "solo",
      "唯一名字换人 ⇒ 成功（没歧义就不拦）",
      JSON.stringify(solo).slice(0, 220)
    );
  });
} catch (e) {
  bad("门禁崩了", String((e && e.stack) || e).slice(0, 300));
}

/* ── SD-04 负向对照：把 Host 改回 find(...) 那个写法 ⇒ 必须判红 ──────── */
{
  const src = fs.readFileSync(SURFACE, "utf8");
  /* 把「同名命中多个就报歧义」那一整块，换回旧的一行 find。 */
  const reBlock =
    /const byId = bots\.filter\(\(b\) => String\(b\.id \|\| ""\) === toRaw\);[\s\S]*?if \(!target\) return \{ ok: false, error: "bot_not_found", bot: toRaw \};/;
  if (!reBlock.test(src)) {
    bad("[SD-04] 负向对照跑不起来（注入点找不到：源码结构变了）");
  } else {
    const mutated = src.replace(
      reBlock,
      'const target = bots.find((b) => b.id === toRaw || b.name === toRaw);\n' +
        '    if (!target) return { ok: false, error: "bot_not_found", bot: toRaw };'
    );
    /* 变异副本放**同目录**（product_surface.js 里有相对 require）。 */
    const tmpDir = path.dirname(SURFACE);
    const tmpFile = path.join(tmpDir, ".negative_control_swap_disambiguation." + process.pid + ".js");
    try {
      fs.writeFileSync(tmpFile, mutated, "utf8");
      withTempRoot((root) => {
        writeFixture(path.join(root, "data"));
        const { createProductSurface } = require(tmpFile);
        const surface = createProductSurface(root, { dataRoot: path.join(root, "data") });
        const r = surface.reassignRoomTask("sig-1", "r-dup", "dup-a", "助手");
        /* 旧写法会「成功」并挑第一个 ⇒ 判据（必须报歧义）就红了。 */
        const stillAmbiguous = !!(r && r.ok === false && r.error === "ambiguous_bot");
        check("SD-04", 
          stillAmbiguous === false,
          "负向对照有牙：换回 find(...) 的旧写法 ⇒ 同名换人又变成「静默挑第一个」⇒ 判红",
          JSON.stringify(r).slice(0, 200)
        );
      });
    } catch (e) {
      bad("[SD-04] 负向对照跑不起来", String((e && e.message) || e).slice(0, 200));
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

console.log(`\nprove_swap_disambiguation: PASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
