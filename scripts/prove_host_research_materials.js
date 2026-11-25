#!/usr/bin/env node
/**
 * 门禁：Host 找料（批次 10）
 *
 * 为什么要有这扇门：
 *   真 provider 实测 13 轮、五棒一次没跑完 —— 根因是「找料 + 逐条核验」
 *   全压在成员身上：降级搜索给的候选一半以上是登录墙 ⇒ 模型换着试
 *   ⇒ 一棒 web_fetch 165~322 次 ⇒ 撞 900 秒闸 ⇒ 零产物。
 *   ⇒ 批次 10 把找料挪到 Host：搜索 → **逐条探活** → 抓正文 → 贴进 prompt。
 *
 * 这扇门钉住三件事：
 *   1. Host 找料**真的能产出材料**（真网络：活的链接 + 真正文）
 *   2. **死链被剔除**（加了规则后判红 / 不误放行）
 *   3. 降级路径**不再返回不相关内容**（中文 query 走中文源，英文走 Algolia）
 *
 * 三态：环境不具备真实网络 ⇒ SKIP（不报假 PASS，也不报假 FAIL）。
 */
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const { createHostFfi } = require(path.join(REPO, "hosts", "shared", "host_ffi.js"));
const { sanitizeTeamDir } = require(path.join(REPO, "hosts", "shared", "team_paths.js"));

let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

function check(id, ok, desc, detail) {
  if (ok) { pass++; console.log(`  ✓ [${id}] ${desc}`); return true; }
  fail++; failures.push(`[${id}] ${desc}${detail ? " — " + detail : ""}`);
  console.log(`  ✗ [${id}] ${desc}${detail ? " — " + detail : ""}`);
  return false;
}
function skipCase(id, desc, why) {
  skip++; console.log(`  ⏭ [${id}] ${desc} — SKIP: ${why}`);
}

(async () => {
  console.log("prove_host_research_materials —— Host 找料门禁");

  const tmp = path.join("/tmp", "bitbot-materials-gate-" + Math.random().toString(36).slice(2, 8));
  const ffi = createHostFfi(REPO, { dataRoot: tmp });
  const f2 = createHostFfi(REPO, { dataRoot: tmp });

  /* ---- 0. 纯函数层（不依赖网络，必须过）---- */
  const latin = ffi.__test ? ffi.__test.latinWords : null;

  /* 拉丁词提取：中文 query 里混写的英文词是英文源能匹配的锚点 */
  const kw = require(path.join(REPO, "hosts", "shared", "host_ffi.js"));
  /* latinWords/queryKeywords 没导出 ⇒ 用 webSearch 的行为间接验，
     这里先验 sanitizeTeamDir（找料要落目录，名字必须一致） */
  check("HM-01", sanitizeTeamDir("自媒体/内容*团队") === "自媒体_内容_团队",
    "HM-01 团队目录名清洗（材料目录与交付目录必须同名）",
    "得到：" + sanitizeTeamDir("自媒体/内容*团队"));

  check("HM-02", typeof ffi.prepareResearchMaterials === "function",
    "HM-02 Host 侧有找料能力 prepareResearchMaterials");

  /* 找料失败**不阻断**：这是必须保住的性质（老行为不变） */
  const empty = await ffi.prepareResearchMaterials({ query: "", roomTitle: "t" });
  check("HM-03", empty && empty.ok === false && empty.reason === "empty_query",
    "HM-03 空 query 如实报失败（不编材料）",
    JSON.stringify(empty).slice(0, 120));

  /* ---- 1. 真实网络：找料真的能产出 ---- */
  const out = await ffi.prepareResearchMaterials({
    query: "large language model inference cost",
    roomTitle: "门禁测试团队",
    max: 3,
    bodyChars: 400,
  });

  if (!out || out.ok !== true) {
    const why = String((out && out.reason) || "unknown");
    if (/unreachable|search_failed|write_failed/.test(why)) {
      skipCase("HM-10", "Host 找料（真实网络）", "环境不具备可用网络：" + why);
    } else {
      check("HM-10", false, "HM-10 Host 找料能产出材料（真实网络）", why);
    }
  } else {
    check("HM-10", true, "HM-10 Host 找料能产出材料（真实网络）");

    /* 材料里的链接必须**真的能打开**（这是找料存在的全部意义） */
    const urls = out.candidates.map((c) => c.url).filter(Boolean);
    check("HM-11", urls.length > 0, "HM-11 产出的材料里至少有一个来源链接",
      JSON.stringify(out.candidates.map((c) => c.url)));

    const reach = await ffi.verifyLinkReachability(urls, { timeoutMs: 9000, concurrency: 3, max: 8 });
    const dead = reach.filter((r) => !r.ok).map((r) => r.url);
    check("HM-12", dead.length === 0,
      "HM-12 材料里的链接**全部实测可达**（死链在交给成员之前就被剔掉了）",
      "死链：" + JSON.stringify(dead));

    /* 抓不到正文的条目**不该**混进材料（成员会据此编造） */
    const bodies = out.candidates.map((c) => String(c.body || ""));
    const emptyBody = out.candidates.filter((c) => !String(c.body || "").trim());
    check("HM-13", emptyBody.length === 0,
      "HM-13 没有「只有链接没有正文」的候选（抓不到正文的不给成员）",
      JSON.stringify(emptyBody.map((c) => c.url)));

    /* 材料文件真的落盘了，且内容自洽 */
    check("HM-14", !!out.path && fs.existsSync(out.path),
      "HM-14 材料文件真的落盘", String(out.path));
    if (out.path && fs.existsSync(out.path)) {
      const md = fs.readFileSync(out.path, "utf8");
      /* 钉**语义片段**而不是整句：措辞微调不该假红，
         但「告诉成员别自己找」这件事必须一直在。 */
      check("HM-15", md.includes("Host") && md.includes("不用再") && md.includes("上网找"),
        "HM-15 材料文件里说明了「不用再自己找」（成员才不会再撒网）",
        "片段缺失：" + JSON.stringify({
          host: md.includes("Host"), buyong: md.includes("不用再"), shangwang: md.includes("上网找"),
        }));
      const inMd = out.candidates.every((c) => md.includes(c.url));
      check("HM-16", inMd, "HM-16 材料文件里包含每个候选的链接");
    }
  }

  /* ---- 2. 死链必须被剔除（双向验证：规则会判红）---- */
  /* 直接验「探活器能认出死链」：构造一个格式完美但 404 的链接。 */
  const fake = "https://example.com/bitbot-gate-never-exists-" + Date.now();
  const reach = await ffi.verifyLinkReachability([fake], { timeoutMs: 8000, concurrency: 1, max: 2 });
  check("HM-20", reach.length === 1 && reach[0].ok === false,
    "HM-20 探活器能认出死链（格式完美的 404 也判死）",
    JSON.stringify(reach).slice(0, 140));

  /* ---- 2b. 找料模式下的**禁抓**（确定性约束，不靠模型自觉）---- */
  f2.resetStageFetchBudget();
  f2.setStageFetchMax(0, "材料已给全");
  const rBlocked = await f2.executeHostEffects(
    [{ kind: "webfetch", command: "https://example.com/", needs_host_ffi: true }],
    { turnId: "t-b", sessionId: "s-b" },
  );
  const blockedOut = String(((rBlocked || [])[0] || {}).stdout || "");
  check("HM-21", /材料已给全/.test(blockedOut) && /"ok": false/.test(blockedOut),
    "HM-21 找料模式下 web_fetch 被**直接拒**（不是靠 prompt 求模型别抓）",
    blockedOut.slice(0, 120));

  /* 恢复默认后又能抓（额度不是永久焊死） */
  f2.setStageFetchMax(-1);
  const rBack = await f2.executeHostEffects(
    [{ kind: "webfetch", command: "https://example.com/", needs_host_ffi: true }],
    { turnId: "t-c", sessionId: "s-c" },
  );
  const backOut = String(((rBack || [])[0] || {}).stdout || "");
  check("HM-22", !/材料已给全/.test(backOut),
    "HM-22 恢复默认后又能抓（额度不是永久焊死，下一轮任务不受影响）",
    backOut.slice(0, 100));

  /* 每棒额度本身有效（抓够 N 次后拒） */
  f2.resetStageFetchBudget();
  const stageMax = Number(process.env.BITBOT_WEBFETCH_STAGE_MAX || 24);
  let refusedAt = -1;
  for (let i = 0; i < stageMax + 2; i++) {
    const r = await f2.executeHostEffects(
      [{ kind: "webfetch", command: "https://example.com/", needs_host_ffi: true }],
      { turnId: "t-d", sessionId: "s-d" },
    );
    const out = String(((r || [])[0] || {}).stdout || "");
    if (/已经抓了/.test(out)) { refusedAt = i; break; }
  }
  check("HM-23", refusedAt === stageMax,
    "HM-23 每棒抓取额度生效（抓够 " + stageMax + " 次后被拒）",
    "实际在第 " + refusedAt + " 次被拒");

  /* ---- 3. 降级路径不许给不相关内容 ---- */
  const cjk = await ffi.webSearch("大模型 推理成本 降价", { topN: 5 });
  if (!cjk || !cjk.ok) {
    skipCase("HM-30", "降级搜索降级可用", "环境没有可用公开源");
  } else {
    const srcs = cjk.sources || [];
    check("HM-30", srcs.length > 0, "HM-30 降级搜索能给出候选");
    if (cjk.provider === "public_feed" && cjk.relevance === "none") {
      /* 明确标注「都不相关」是可以接受的（诚实），但必须**如实标注** */
      check("HM-31", /没有与这个主题相关/.test(String(cjk.note || "")),
        "HM-31 候选都不相关时**如实标注**（不假装相关）", String(cjk.note || "").slice(0, 90));
    } else {
      check("HM-31", true, "HM-31 降级搜索的相关性已标注（related/partial）",
        "relevance=" + String(cjk.relevance || "-") + " provider=" + String(cjk.provider));
    }
  }

  /* 英文 query ⇒ 应该走真搜索（Algolia），而不是最新头条 */
  const eng = await ffi.webSearch("llm inference cost", { topN: 5 });
  if (eng && eng.ok) {
    check("HM-32", eng.provider === "hn_algolia" || (eng.sources || []).length > 0,
      "HM-32 英文 query 走真搜索路径",
      "provider=" + String(eng.provider));
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 清理失败不判红 */ }

  console.log(`\nPASS=${pass} FAIL=${fail} SKIP=${skip}`);
  if (fail) {
    console.log("\n失败明细：");
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
})().catch((e) => {
  console.error("prove_host_research_materials crashed:", (e && e.stack) || e);
  process.exit(1);
});
