#!/usr/bin/env node
"use strict";
/* prove_checklist_freshness.js — 真机清单不许说反话（CF-01..CF-12 + INJ-CF + INJ-CF_12 + INJ-CF-EXEMPT）
 *
 * 要证的一件事：**验收清单里的「否定断言」和代码事实不冲突**。
 *
 * 为什么需要这道门：本轮收口连续抓到三次同型的病 —— RBI-06 用「替换字符串再查字符串」
 * 的恒真对照、AB-21 被 KDoc 里的说明文字撑绿、RS-09 的锚点命中的是我自己写的注释。
 * 三次都是**门自己的错**，比产品错更常见。
 *
 * 而文档有同一个病的镜像：**代码已经做完，文档还写着「没做」**。
 * 真机清单就是这么烂掉的 —— 它写着「配对必须先在同一个 Wi-Fi」「SSE 不走隧道」
 * 「APK 不用重打」，而 A3-17 / A3-18 / R-A3-5b 早就把这些做了。
 * 后果不是「少一条验收」，是**现场会照着错的边界去验**：把已经能用的当必坏、
 * 把必须重打的包当成现成的，跑一天得出一个假结论。
 *
 * 判据方向（和通常的「文档里有某词」相反）：
 *   文档出现否定断言 ∧ 代码里其实有 → 红。
 * 反过来「文档里出现了正确的能力名」只是**辅助**锚点（CF-07..CF-10），
 * 单靠它挡不住陈旧，只能说明这一页还活着。
 *
 * 豁免区（明说，免得被当成后门）：
 *   - 以 `>` 开头的引用块  —— 历史注记天然要说「早期写的是…」
 *   - `~~删除线~~` 里的内容 —— 显式作废
 * 这两处允许出现旧说法；正文不允许。要写「以前如何」，请放进引用块。
 *
 * 诚实边界：
 *   - 这是**词面**检查，不是语义检查。它挡的是「明明做完了还写着没做」这一类
 *     具体陈旧说法，不是「任何一句和代码不符的话」。
 *   - 它不检查清单是否**完整**（漏了某条验收项它看不出来），只检查**说反**。
 *   - 它不跑 Android、不碰真机；真机十条仍是 R-A3-8a 的残留。
 *
 * 跑法：node scripts/prove_checklist_freshness.js
 */
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
/* 允许指向别的清单文件，用来做「改前必须红」的回归验证：
 *   BITBOT_CHECKLIST_DOC=<旧版本.md> node scripts/prove_checklist_freshness.js
 * 代码事实永远取自当前工作区 —— 这样「旧文档 vs 新代码」的冲突才测得出来。 */
const DOC = process.env.BITBOT_CHECKLIST_DOC
  ? path.resolve(process.env.BITBOT_CHECKLIST_DOC)
  : path.join(REPO, "docs/design/desktop-target/real-device-checklist.md");

const KT_LINK = path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/LinkStatus.kt");
const KT_BOOT = path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/RelayBootstrap.kt");
const KT_STATS = path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/ConnectionStats.kt");
const KT_PAIR = path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/DesktopPairing.kt");
const KT_EVENT = path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/EventStreamClient.kt");
const MAINJS = path.join(REPO, "hosts/desktop/main.js");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

const read = (p) => fs.readFileSync(p, "utf8");
/** 判前剥注释 —— 这轮栽过两次（AB-21 被 KDoc 撑绿、RS-09 被我自己的注释撑绿）。 */
const stripJsComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/* ---------------------------------------------------------------- 代码事实 */
function collectFacts() {
  const link = fs.existsSync(KT_LINK) ? read(KT_LINK) : "";
  const boot = fs.existsSync(KT_BOOT) ? read(KT_BOOT) : "";
  const stats = fs.existsSync(KT_STATS) ? read(KT_STATS) : "";
  const pair = fs.existsSync(KT_PAIR) ? read(KT_PAIR) : "";
  const event = fs.existsSync(KT_EVENT) ? read(KT_EVENT) : "";
  const main = stripJsComments(read(MAINJS));

  return {
    // R-A3-5b：事件流真的走隧道（不是「有 TunnelHttp」就算，要看 EventStream 用了它）
    sseOverTunnel: event.includes("TunnelHttp.openEventStream(") && event.includes("readViaRelay("),
    // A3-17：探活（presence）与凭证（auth）是两个维度
    presenceAuth: /enum class Presence\b/.test(link) && /enum class Auth\b/.test(link),
    // R-A3-6c：统计带分母，0 样本时自己说人话
    statsDenominator: stats.includes("还没有连接样本") && /fun record(Relay|Direct)?\b/.test(stats),
    // A3-18：跨网配对串 + 走隧道的 redeem
    relayPairing:
      boot.includes('SCHEME = "bitbot-relay://v1"') && pair.includes("fun completePairingViaRelay("),
    // A3-17/A3-18 动了 Android 侧 ⇒ 旧 APK 不含这些能力
    androidChanged:
      fs.existsSync(KT_LINK) && fs.existsSync(KT_BOOT) && pair.includes("fun redeemCodeViaRelay("),
    // R-A3-6h：中转那份 vault 也接了 protector
    keychain: main.includes("protector: resolveVaultProtector()"),
    // A3-11：改 relay.json 不用重启 app
    hotReload: main.includes("relay.json 变了"),
  };
}

/* ---------------------------------------------------------------- 陈旧断言 */
/* 每条：id / 会出现在陈旧正文里的说法 / 它依赖的代码事实 / 事实长什么样 */
const CLAIMS = [
  {
    id: "CF-01",
    stale: /SSE[^\n]{0,16}(不走|没走|尚未走)[^\n]{0,8}隧道/,
    fact: "sseOverTunnel",
    what: "事件流已经走隧道（R-A3-5b）",
  },
  {
    id: "CF-02",
    stale: /(不用重打|不需要重打|不必重打|无需重打)/,
    fact: "androidChanged",
    what: "A3-17/A3-18 改了 Android 侧，APK 必须重打",
  },
  {
    id: "CF-03",
    stale: /(必须先在同一个\s*Wi-?Fi|配对本身不走\s*relay|先连同一\s*Wi-?Fi\s*配对)/i,
    fact: "relayPairing",
    what: "已经有跨网配对串（A3-18），配对不必先同网",
  },
  {
    id: "CF-04",
    stale: /(不是\s*OS\s*钥匙串|仍是明文\s*`?vault\.key)/,
    fact: "keychain",
    what: "两份 vault 都接了 protector（R-A3-6h）",
  },
  {
    id: "CF-05",
    /* 排除「不用 / 不必 / 无需 / 不需要」：文档说「不用重启」是**正确**的话，
     * 第一版正则把它当成陈旧断言误报了 —— 判据要分辨「要求重启」和「说不用重启」。 */
    stale: /(?<!不用)(?<!不必)(?<!无需)(?<!不需要)重启桌面\s*app/,
    fact: "hotReload",
    what: "A3-11 观察器 ≤2s 热生效，改配置不用重启",
  },
  {
    id: "CF-06",
    stale: /R-A3-6h[^\n]{0,24}(部分关闭|没做|未做|还没)/,
    fact: "keychain",
    what: "R-A3-6h 已关",
  },
];

/* 辅助锚点：页面得还「活着」，能提到当前能力名 */
const ANCHORS = [
  ["CF-07", /bitbot-relay:\/\/v1/, "没提跨网配对串（A3-18）—— 这一页跑不到那条能力"],
  ["CF-08", /探活/, "没提探活（A3-17）—— 现场会把「凭证被拒」误判成「离线」"],
  ["CF-09", /(分母|样本)/, "没提统计分母（R-A3-6c）—— 成功率又会变成没有分母的口号"],
  ["CF-10", /vault\.key\.protected/, "没提钥匙串落盘形态（R-A3-6h）—— R-A3-6h 的现场验收无从下手"],
];

/** 只留正文：剔掉 `>` 引用块与 `~~删除线~~`（历史注记区）。 */
function bodyOnly(md) {
  return md
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/~~[\s\S]*?~~/g, "");
}

/** 判据本体：返回命中的陈旧断言说明列表。空数组 = 干净。 */
function staleHits(mdText, facts) {
  const body = bodyOnly(mdText);
  const hits = [];
  for (const c of CLAIMS) {
    if (!facts[c.fact]) continue; // 代码里没有 ⇒ 文档说「没做」是对的
    const m = body.match(c.stale);
    if (m) hits.push({ id: c.id, text: m[0], what: c.what });
  }
  return hits;
}

/**
 * 文档里那条「怎么构建 APK」的命令，目录是不是真的存在、真的带 gradlew。
 *
 * 为什么要这条：我写这一节时第一版写的是 `cd hosts/android && ./gradlew`，
 * 而 gradle 根其实在 `hosts/android/BitBotHost` —— 照那句敲下去第一行就 command not found。
 * 「文档里的命令必须能跑」和「文档不许说反话」是同一件事的两面。
 */
function gradleRootCheck(mdText) {
  const lines = mdText.split("\n");
  const idx = lines.findIndex((l) => /\.\/gradlew\b/.test(l));
  if (idx < 0) return { found: false, ok: false, dir: "" };
  for (let i = idx; i >= 0; i--) {
    const m = lines[i].match(/cd\s+(hosts\/[^\s#]+)/);
    if (m) {
      const dir = m[1].replace(/\/+$/, "");
      const ok = fs.existsSync(path.join(REPO, dir, "gradlew"));
      return { found: true, ok, dir };
    }
  }
  return { found: false, ok: false, dir: "" };
}

function main() {
  console.log("real-device checklist freshness proof (CF-01..CF-12)");

  /* ============ 前提：这一页和它依赖的代码都在 ============ */
  if (!fs.existsSync(DOC)) {
    bad("CF-00 找不到验收清单", DOC);
    console.log("\nprove_checklist_freshness: PASS=" + PASS + " FAIL=" + FAIL);
    process.exit(1);
  }
  const doc = read(DOC);
  const facts = collectFacts();

  const missingCode = Object.entries(facts).filter(([, v]) => !v).map(([k]) => k);
  if (missingCode.length) {
    /* 代码事实缺失**不能**当成「文档是对的」——否则把 Android 目录删掉，这道门就自动绿了。
     * 这正是 RBI-06 栽过的坑：判据建立在「找不到东西」上，找不到就放行。 */
    bad("CF-00 代码事实取不全：" + missingCode.join("、"), "门不能靠「找不到代码」放行，先把事实源修好");
  } else {
    ok("CF-00 七项代码事实全部取到（事件流隧道 / 探活 / 统计分母 / 配对串 / Android 已改 / 钥匙串 / 热生效）");
  }

  /* ============ CF-01..CF-06 陈旧断言逐条 ============ */
  const hits = staleHits(doc, facts);
  for (const c of CLAIMS) {
    const hit = hits.find((h) => h.id === c.id);
    if (hit) bad(c.id + " 清单还在断言「" + hit.text + "」", "而代码里：" + c.what);
    else ok(c.id + " 没有与事实冲突的陈旧说法（" + c.what + "）");
  }

  /* ============ CF-07..CF-10 辅助锚点 ============ */
  for (const [id, re, why] of ANCHORS) {
    if (re.test(doc)) ok(id + " 页面提到了当前能力，没停在旧世代");
    else bad(id + " " + why);
  }

  /* ============ INJ-CF 负向对照：判据必须有牙 ============ */
  /* 每条注入一句**真实出现过的旧说法**，staleHits 必须把它抓出来。
   * 抓不到就说明那条判据是装饰 —— 和 RBI-06 第一版一模一样的问题。 */
  {
    const injections = [
      ["CF-01", "\n当前 SSE 不走隧道，必然回退到整轮模式。\n"],
      ["CF-02", "\nA3-6 构建的 APK 已含全部能力，不用重打。\n"],
      ["CF-03", "\n铁律：配对必须先在同一个 Wi-Fi 完成。\n"],
      ["CF-04", "\nvault 密钥文件仍在**本机磁盘**上，不是 OS 钥匙串。\n"],
      ["CF-05", "\n改完 relay.json 后请重启桌面 app 让配置生效。\n"],
      ["CF-06", "\nR-A3-6h 只是部分关闭。\n"],
    ];
    const blind = [];
    for (const [id, sentence] of injections) {
      const injected = doc + sentence;
      const got = staleHits(injected, facts).map((h) => h.id);
      if (!got.includes(id)) blind.push(id + "（注入「" + sentence.trim() + "」没被抓到）");
    }
    if (blind.length) bad("INJ-CF 注入对照失效：" + blind.join("；"), "这些判据是摆设");
    else ok("INJ-CF 六种旧说法逐一注入全部被抓到 —— 判据不是装饰");
  }

  /* ============ INJ-CF-EXEMPT 豁免区不是万能挡箭牌 ============ */
  /* 反过来也要证一次：同一句放进引用块 / 删除线时**不该新增**报红，
   * 否则文档就写不了历史，人会为了过门把历史整段删掉（那比留着更糟）。
   * 但只豁免这两种形态，正文照样要红 —— 上面 INJ-CF 已经证了正文会红。
   *
   * 判的是**增量**，不是绝对条数：基线本来就可能有别的命中，拿 0 去比等于
   * 让这条断言依赖于「文档此刻恰好全绿」—— 那它测的是文档，不是豁免机制。 */
  {
    const ids = (t) => staleHits(t, facts).map((h) => h.id).sort().join(",");
    const base = ids(doc);
    const q = ids(doc + "\n> 早期版本：SSE 不走隧道，必然回退。\n");
    const s = ids(doc + "\n~~A3-6 的 APK 不用重打~~\n");
    if (q === base && s === base) {
      ok("INJ-CF-EXEMPT 引用块 / 删除线的历史注记被正确豁免（文档能写「以前如何」）");
    } else {
      bad(
        "INJ-CF-EXEMPT 豁免区没有按预期生效",
        "基线 [" + base + "] / 引用块 [" + q + "] / 删除线 [" + s + "]"
      );
    }
  }

  /* ============ CF-12 文档里的构建命令必须真能跑 ============ */
  {
    const g = gradleRootCheck(doc);
    if (!g.found) {
      bad("CF-12 找不到 APK 构建命令（`./gradlew`）", "验收要重打包，却没给出可执行命令");
    } else if (!g.ok) {
      bad("CF-12 构建命令的目录不存在或不带 gradlew：" + g.dir, "照这句敲下去第一行就 command not found");
    } else {
      ok("CF-12 构建命令落在真工程根上（" + g.dir + " 有 gradlew）");
    }
    /* 负向对照：把目录改成它上一层（hosts/android），必须被判红。 */
    const wrong = doc.replace(/(cd\s+)hosts\/android\/BitBotHost/, "$1hosts/android");
    const g2 = gradleRootCheck(wrong);
    if (wrong !== doc && g2.ok) bad("INJ-CF_12 目录指错了（hosts/android）竟然也判绿", "这条判据没有牙");
    else if (wrong !== doc) ok("INJ-CF_12 目录指错一层立刻被判红 —— 判据读的是磁盘，不是字面量");
    else console.log("  · INJ-CF_12 跳过：文档里没有 hosts/android/BitBotHost 这个形状，无从注入");
  }

  /* ============ CF-11 清单自己不能把「结论」说成已有 ============ */
  /* ≥90% 跨网成功率到今天一次分母都没有。清单若把这条写成已达标，就是编结论。 */
  {
    const claimsDone = /(成功率[^\n]{0,10}(已达标|已达成|已验证通过))/.test(doc);
    if (claimsDone) bad("CF-11 清单把 ≥90% 跨网成功率写成了已有结论", "这条至今没有真机分母");
    else ok("CF-11 清单没有把「≥90% 跨网成功率」写成已达标（它仍是待验目标）");
  }

  console.log("\nprove_checklist_freshness: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
}

main();
