#!/usr/bin/env node
"use strict";

/**
 * prove_mention_disambiguation —— @ 点名遇到同名 bot 时，**不许替用户猜**（批次 15）
 *
 * 背景：群里 @ 一个人，是「让谁干活」最直接的口子。Host 那边原来这么找人：
 *
 *   const target = members.find((m) => m.name === name || m.id === name);   // ← 旧写法
 *
 * ⇒ 群里有两个都叫「助手」时，`find` **静默挑第一个**。
 * 用户 @ 了「助手」，跑出来的是**另一个**助手干的 —— 错了还不吭声。
 * 而且前端那边更早一步就坏了：候选列表按**名字**去重 ⇒ 第二个同名 bot
 * 根本不会出现在下拉里 ⇒ 用户连 @ 都 @ 不到他（前端那半边在 prove_bot_identity.js
 * 的 BI-10 里钉着：候选里两个都在、插进去的是「名字（后缀）」）。
 *
 * 本门钉住（跑**真 product_surface**，数据根在临时目录里）：
 *   MD-01 同名点名 "@助手" ⇒ **报歧义**（ambiguous_mentions），不许静默挑一个
 *   MD-02 消歧写法 "@助手（销售）" ⇒ 精确命中那一个（按职责）
 *   MD-03 消歧写法 "@助手（团队B）" ⇒ 按**分组**也能命中
 *   MD-04 唯一名字 "@独苗" ⇒ 正常点名（没歧义就不该拦）
 *   MD-05 "@everyone" ⇒ 全员（既有语义没被改坏）
 *   MD-06 负向对照：把 Host 改回 find(...) 那个写法 ⇒ MD-01 **必须判红**
 *                   （⇒ 证明这条判据有牙，不是恒绿）
 *
 * 口径：
 *   · 变异只发生在**临时副本**上（源文件一个字节都不动）。
 *   · 副本必须放**同目录**：product_surface.js 里有相对 require（实测踩过）。
 *   · 门禁只碰自己的临时数据根，**不碰用户真数据**。
 *
 * 用法：node scripts/prove_mention_disambiguation.js
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
   ⚠️ 输出形态必须是 "[MD-01] …" —— 矩阵按这个字面 grep 锚点。 */
const CLAIM_IDS = ["(head)", "MD-01", "MD-02", "MD-03", "MD-04", "MD-05", "MD-06"];
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

/** 一份带**同名 bot**的夹具：两个同名同组、一个同名不同组、一个独苗。 */
function writeFixture(root) {
  const desktop = path.join(root, "desktop");
  fs.mkdirSync(desktop, { recursive: true });
  const bots = {
    version: 1,
    primary_id: "dup-a",
    bots: [
      { id: "dup-a", name: "助手", job: "销售", description: "外呼销售", group: "团队A" },
      { id: "dup-b", name: "助手", job: "支持", description: "客户支持", group: "团队A" },
      { id: "grp-c", name: "助手", job: "杂务", description: "杂活", group: "团队B" },
      { id: "solo", name: "独苗", job: "研究", description: "研究", group: "团队A" },
    ],
  };
  const rooms = {
    version: 1,
    rooms: [
      {
        id: "r-dup",
        title: "同名群",
        members: ["dup-a", "dup-b", "grp-c", "solo"],
        transcript: [],
      },
    ],
  };
  fs.writeFileSync(path.join(desktop, "bots.json"), JSON.stringify(bots, null, 2));
  fs.writeFileSync(path.join(desktop, "rooms.json"), JSON.stringify(rooms, null, 2));
}

/** 起一份真 surface（隔离数据根）。 */
function makeSurface(root, surfaceFile) {
  const { createProductSurface } = require(surfaceFile || SURFACE);
  return createProductSurface(root, { dataRoot: path.join(root, "data") });
}

function withTempRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-mention-"));
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

/** 发一句话，看 Host 把谁当成了负责人。 */
function turn(surface, text) {
  const res = surface.roomTurn("r-dup", text);
  const e = (res && res.transcript_entry) || {};
  return {
    ok: !!(res && res.ok),
    policy: String(e.responder_policy || ""),
    responders: Array.isArray(e.responders) ? e.responders.slice() : [],
    ambiguous: Array.isArray(e.ambiguous_mentions) ? e.ambiguous_mentions.slice() : [],
    unknown: Array.isArray(e.unknown_mentions) ? e.unknown_mentions.slice() : [],
  };
}

console.log("prove_mention_disambiguation — @ 点名遇到同名 bot 时不许替用户猜");

/* ── MD-01 .. MD-05 ─────────────────────────────────────────────────── */
try {
  withTempRoot((root) => {
    writeFixture(path.join(root, "data"));
    const surface = makeSurface(root);

    /* 同名 ⇒ 报歧义，不静默挑第一个。 */
    const amb = turn(surface, "@助手 干活");
    check(
      "MD-01",
      amb.ambiguous.indexOf("助手") >= 0,
      "同名点名 ⇒ 明确报歧义（不是静默挑一个）",
      JSON.stringify(amb)
    );
    check(
      "MD-01",
      amb.policy !== "mentioned_only" || amb.responders.length !== 1,
      "同名点名 ⇒ **没有**把某一个人当成负责人",
      JSON.stringify(amb)
    );

    /* 消歧写法（按职责）⇒ 精确命中。 */
    const byJob = turn(surface, "@助手（销售） 干活");
    check(
      "MD-02",
      byJob.policy === "mentioned_only" && byJob.responders.join(",") === "dup-a" && byJob.ambiguous.length === 0,
      "消歧写法「名字（职责）」⇒ 精确命中那一个",
      JSON.stringify(byJob)
    );

    /* 消歧写法（按分组）⇒ 也认。 */
    const byGroup = turn(surface, "@助手（团队B） 干活");
    check(
      "MD-03",
      byGroup.policy === "mentioned_only" && byGroup.responders.join(",") === "grp-c" && byGroup.ambiguous.length === 0,
      "消歧写法「名字（分组）」⇒ 也认（职责撞了就退到分组）",
      JSON.stringify(byGroup)
    );

    /* 唯一名字 ⇒ 正常点名（没歧义就不该拦）。 */
    const solo = turn(surface, "@独苗 干活");
    check(
      "MD-04",
      solo.policy === "mentioned_only" && solo.responders.join(",") === "solo" && solo.ambiguous.length === 0,
      "唯一名字点名 ⇒ 正常（没歧义就不拦）",
      JSON.stringify(solo)
    );

    /* @everyone ⇒ 全员（既有语义没被改坏）。 */
    const all = turn(surface, "@everyone 干活");
    check(
      "MD-05",
      all.policy === "all" && all.responders.length === 4,
      "@everyone ⇒ 全员（既有语义没被改坏）",
      JSON.stringify(all)
    );
  });
} catch (e) {
  bad("门禁崩了", String((e && e.stack) || e).slice(0, 300));
}

/* ── MD-06 负向对照：把 Host 改回 find(...) 那个写法 ⇒ 必须判红 ──────── */
{
  const src = fs.readFileSync(SURFACE, "utf8");
  const target =
    "} else if (sameName.length > 1) {\n" +
    "          /* 同名 ⇒ 报歧义，不替用户挑（原来是 find ⇒ 静默挑第一个）。 */\n" +
    '          ambiguousMentions.push(String(name).slice(0, 40));\n' +
    "          consumed = name.length;";
  if (src.indexOf(target) < 0) {
    bad("[MD-06] 负向对照跑不起来（注入点找不到：源码结构变了）");
  } else {
    const mutated = src.replace(
      target,
      "} else if (sameName.length > 1) {\n" +
        "          target = sameName[0];\n" +
        "          consumed = name.length;"
    );
    if (mutated === src) {
      bad("[MD-06] 负向对照跑不起来（替换没命中：源码形态变了）");
    } else {
      /* 变异副本放**同目录**（product_surface.js 里有相对 require）。 */
      const tmpFile = path.join(path.dirname(SURFACE), ".negative_control_mention_disambiguation." + process.pid + ".js");
      try {
        fs.writeFileSync(tmpFile, mutated, "utf8");
        withTempRoot((root) => {
          writeFixture(path.join(root, "data"));
          const surface = makeSurface(root, tmpFile);
          const r = turn(surface, "@助手 干活");
          /* 旧写法会「成功」并挑第一个 ⇒ 判据（必须报歧义）就红了。 */
          check(
            "MD-06",
            r.ambiguous.indexOf("助手") < 0,
            "负向对照有牙：换回 find(...) 的旧写法 ⇒ 同名点名又变成「静默挑第一个」⇒ 判红",
            JSON.stringify(r)
          );
        });
      } catch (e) {
        bad("[MD-06] 负向对照跑不起来", String((e && e.message) || e).slice(0, 200));
      } finally {
        try {
          fs.unlinkSync(tmpFile);
        } catch (_) {
          /* ignore */
        }
      }
    }
  }
}

/* 清单与实现要对得上：每个声明的编号都真的被用到过。 */
for (const id of CLAIM_ID_SET) {
  if (!usedIds.has(id)) bad("[" + id + "] 这个编号在清单里，但一次都没用 ⇒ 清单与实现漂了");
}

console.log(`\nprove_mention_disambiguation: PASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
