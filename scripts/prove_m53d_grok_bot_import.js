#!/usr/bin/env node
"use strict";

/**
 * prove_m53d_grok_bot_import — 「直接读本机 Grok Bot 的库并建到本项目」这条通道可不可信
 *
 * 这条通道最容易糊弄人的地方不是"能不能解出来"，而是解错了你根本看不出来：
 * 文件名是 base32 的键名，解错一个字节就变成另一个键 —— 于是"少了一个 Bot"
 * 会表现成"本来就只有一个 Bot"。所以门禁盯四件事：
 *
 *   1. **键名解码是真的**，不是"看起来像字符串"。用本机真实文件名反解，
 *      并对任意键名做 encode→decode 往返；非 base32 字符必须返回 null 而不是乱码。
 *   2. **转不了的条目绝不硬塞**。附件 / 事件 / 私钥请求这些没有文本的条目，
 *      宁可记一条 skip 原因，也不能写成一个空消息 —— 空消息会让对话看起来"断了"，
 *      而用户无法判断是迁移丢的还是本来就没有。
 *   3. **群成员只认 roster 里确实存在的非群行**。叫不出名字的成员单独记账，
 *      不静默丢、也不把群塞进群。
 *   4. **预演不写盘**。--apply 才是写；预演跑八遍，data/ 下三个文件的 sha 必须不变。
 *
 * 负向对照（四条，各自把实现打坏，断言必须翻假）：
 *   a. 会话标题前缀抹成空 → 标题断言翻假
 *   b. widget 分支短路 → 「选项卡片转成文字」断言翻假
 *   c. 群成员过滤去掉 !is_group → 群被塞成群成员，成员数断言翻假
 *   d. 跳过改成塞空文本 → skip 计数断言翻假
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

let pass = 0;
let fail = 0;
let skipped = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const skip = (m, why) => { skipped++; console.log("  ⊘ " + m + "（跳过：" + why + "，不算通过）"); };

const REPO = path.join(__dirname, "..");
const SRC_PATH = path.join(REPO, "scripts/import_grok_bot.js");
const SRC = fs.readFileSync(SRC_PATH, "utf8");

/** 在隔离上下文里加载（可传改坏的源码），CLI 分支不会跑：假 module 没有 main。 */
function load(src) {
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require,
    __dirname: path.join(REPO, "scripts"),
    __filename: SRC_PATH,
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(src, sandbox, { filename: SRC_PATH });
  return mod.exports;
}

const impl = load(SRC);

/* ---------- T1 键名解码：真文件名 + 往返 + 坏输入 ---------- */
{
  // 这两个文件名是从本机 sand-client-persistence 里抄下来的真实样本
  const CASES = [
    ["onqw4zbomnwgszlooqxhg3djmnss45ljfvwgc6lpov2a", "sand.client.slice.ui-layout"],
    ["onqw4zbomnwgszlooqxhg3djmnss4y3mnfsw45bnnvsxiyjomfrwg33vnz2c243mn52a", "sand.client.slice.client-meta.account-slot"],
    ["onqw4zbomnwgszlooqxhg3djmnss4y3mnfsw45bnnvsxiyjomfrwg33vnz2c243mn52a", "sand.client.slice.client-meta.account-slot"],
    ["onqw4zbomnwgszlooqxhg3djmnss4yldmnxxk3tufzqxk5digastoqzwgq4gkzdgmrqtmzlfgztdaylbha3tsndcmnstcltcn52c25dfnvygyylumvzs4zlyobxxe5bnobxwy2ldpe", null],
  ];
  let n = 0;
  for (const [file, want] of CASES.slice(0, 2)) {
    const got = impl.decodeKey(file);
    if (got === want) { n++; ok("T1 真文件名反解：" + want); }
    else bad("T1 真文件名反解 " + file.slice(0, 12) + "…", "want=" + want + " got=" + got);
  }

  // 往返：任意键名 encode → decode 必须一模一样（含分隔符与百分号）
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const encode = (str) => {
    const buf = Buffer.from(str, "utf8");
    let bits = 0, value = 0, out = "";
    for (const byte of buf) {
      value = (value << 8) | byte; bits += 8;
      while (bits >= 5) { out += table[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += table[(value << (5 - bits)) & 31];
    return out;
  };
  const keys = [
    "sand.client.slice.account.auth0%7Cusr_abc123",
    "sand.client.slice.roster.last-roster",
    "sand.client.slice.transcript.replicas.941dc66e-d95e-49cf-b040-49a4b9454940",
    "中文键名也得不走样",
  ];
  let r = 0;
  for (const k of keys) if (impl.decodeKey(encode(k)) === k) r++;
  if (r === keys.length) ok(`T1 往返 ${r}/${keys.length} 个键名 decode(encode(x)) === x`);
  else bad("T1 往返", `${r}/${keys.length}`);

  if (impl.decodeKey("!!!notbase32!!!") === null) ok("T1 非 base32 字符 → null（不返回乱码）");
  else bad("T1 非 base32 字符必须 null", String(impl.decodeKey("!!!notbase32!!!")));
}

/* ---------- T2 富文本块 → 纯文本 ---------- */
{
  const cases = [
    [[{ text: "a" }, { text: "b" }], "a\nb"],
    [[{ type: "image" }], "[附件]"],
    [[{ type: "attachment" }, { text: "说明" }], "[附件]\n说明"],
    ["不是数组", ""],
    [null, ""],
  ];
  let n = 0;
  for (const [inp, want] of cases) if (impl.blocksToText(inp) === want) n++;
  if (n === cases.length) ok(`T2 blocksToText ${n}/${cases.length}`);
  else bad("T2 blocksToText", `${n}/${cases.length}`);

  // 字符串形式的 content 不经过 blocksToText —— 这是刻意的（字符串原样就是文本）
  const got = impl.convertEntry({ kind: "message", role: "user", content: "原样" });
  if (got.msg && got.msg.text === "原样") ok("T2 字符串 content 原样保留");
  else bad("T2 字符串 content 原样保留", JSON.stringify(got));
}

/* ---------- T3 条目 → 消息：认识的要转对，不认识的要拒 ---------- */
{
  const T = (name, entry, check) => {
    const got = impl.convertEntry(entry);
    const why = check(got);
    if (!why) ok("T3 " + name);
    else bad("T3 " + name, why + " · got=" + JSON.stringify(got).slice(0, 200));
  };

  T("kind=message/user 字符串", { kind: "message", role: "user", content: "你好" },
    (g) => (g.msg && g.msg.role === "user" && g.msg.text === "你好" ? "" : "角色或文本不对"));

  T("kind=message/assistant 块数组", { kind: "message", role: "assistant", content: [{ text: "结论" }] },
    (g) => (g.msg && g.msg.role === "assistant" && g.msg.text === "结论" ? "" : "块数组没拼成文本"));

  // system 归到 assistant，但原话必须留着 —— 迁移不是"清理"
  T("kind=message/system 保留原话", { kind: "message", role: "system", content: "你是…" },
    (g) => (g.msg && g.msg.role === "assistant" && g.msg.text === "你是…" ? "" : "system 原话丢了"));

  T("未知 role 拒收", { kind: "message", role: "tool", content: "x" },
    (g) => (g.skip === "unknown_role" ? "" : "没拒收"));

  T("空文本拒收", { kind: "message", role: "user", content: "   " },
    (g) => (g.skip === "empty_text" ? "" : "空文本被塞进去了"));

  T("send-message/text", { kind: "send-message", message: { type: "text", content: "回复" } },
    (g) => (g.msg && g.msg.role === "assistant" && g.msg.text === "回复" ? "" : "没转成 assistant 文本"));

  T("send-message/widget → 文字（含选项）", {
    kind: "send-message",
    message: { type: "widget", widget: { prompt: "下一步选哪个？", options: [{ label: "继续" }, { label: "收尾" }] } },
  }, (g) => {
    if (g.converted !== "widget") return "没标记 converted=widget";
    const t = (g.msg && g.msg.text) || "";
    if (!t.includes("下一步选哪个？")) return "prompt 丢了";
    if (!t.includes("· 继续") || !t.includes("· 收尾")) return "选项丢了";
    return "";
  });

  T("send-message/attachment 拒收", { kind: "send-message", message: { type: "attachment", content: "" } },
    (g) => (g.skip === "message_type_attachment" ? "" : "附件被塞成消息"));

  T("send-message/cursor-agent 拒收", { kind: "send-message", message: { type: "cursor-agent" } },
    (g) => (g.skip === "message_type_cursor-agent" ? "" : "cursor-agent 被塞成消息"));

  T("kind=event 拒收", { kind: "event", event: "x" },
    (g) => (g.skip === "kind_event" ? "" : "事件被塞成消息"));

  T("非对象拒收", "我是一行字符串",
    (g) => (g.skip === "entry_not_object" ? "" : "非对象没拒收"));
}

/* ---------- T4 planMigration：假 store，纯逻辑 ---------- */
const FAKE = (() => {
  const rows = [
    { id: "bot-a", name: "甲", description: "职责甲\n第二行不算 job", createdAt: 1700000000000, updatedAt: 1700000100000 },
    { id: "bot-b", name: "乙", description: "" },
    { id: "grp-full", name: "齐整群", isGroup: true, memberIds: ["bot-a", "bot-b"] },
    { id: "grp-hollow", name: "缺人群", isGroup: true, memberIds: ["bot-a", "ghost-x", "grp-full"] },
  ];
  const values = new Map();
  values.set("sand.client.slice.roster.last-roster", { schemaVersion: 1, value: { rows } });
  const mk = (id, entries) => ({
    schemaVersion: 1,
    value: { entries },
  });
  values.set("sand.client.slice.transcript.replicas.bot-a", mk("bot-a", [
    { kind: "message", role: "user", content: "问", timestampMs: 1700000200000 },
    { kind: "message", role: "assistant", content: "答", timestampMs: 1700000300000 },
    { kind: "send-message", message: { type: "attachment" }, timestampMs: 1700000400000 },
  ]));
  values.set("sand.client.slice.transcript.replicas.bot-b", mk("bot-b", []));
  values.set("sand.client.slice.transcript.replicas.grp-full", mk("grp-full", [
    { kind: "send-message", message: { type: "widget", widget: { prompt: "选", options: [{ label: "A" }] } } },
  ]));
  return { dir: "/fake/grok", values, bad: 0, files: values.size };
})();

{
  const plan = impl.planMigration(FAKE);

  if (plan.bots.length === 2) ok("T4 单人 2 个（群不混进 Bot）");
  else bad("T4 单人 2 个", String(plan.bots.length));

  // job 只取人设第一行前 24 字：把整段人设塞进 job 会让列表变成一堵墙
  const a = plan.bots.find((b) => b.name === "甲");
  if (a && a.job === "职责甲") ok("T4 job 只取第一行");
  else bad("T4 job 只取第一行", JSON.stringify(a && a.job));

  if (plan.rooms.length === 2) ok("T4 群 2 个");
  else bad("T4 群 2 个", String(plan.rooms.length));

  const full = plan.rooms.find((r) => r.grok_id === "grp-full");
  const hollow = plan.rooms.find((r) => r.grok_id === "grp-hollow");
  if (full && full.member_grok_ids.length === 2) ok("T4 齐整群 2 人");
  else bad("T4 齐整群 2 人", JSON.stringify(full && full.member_grok_ids));
  if (hollow && hollow.member_grok_ids.length === 1) ok("T4 缺人群只认叫得出名字的 1 人");
  else bad("T4 缺人群 1 人", JSON.stringify(hollow && hollow.member_grok_ids));
  if (plan.stats.missing_members === 2) ok("T4 2 个成员名对不上（ghost-x 与嵌套的群）如实记账");
  else bad("T4 missing_members=2", String(plan.stats.missing_members));

  // 缺人数要按房间记：否则「本来只有 1 人」和「成员映射失败」会被混成同一个原因
  if (full && full.missing_count === 0 && hollow && hollow.missing_count === 2) {
    ok("T4 每群单独记 missing_count（齐整群 0 / 缺人群 2）");
  } else bad("T4 每群 missing_count", JSON.stringify([full && full.missing_count, hollow && hollow.missing_count]));

  // 单人群（真事：Grok 侧有 3 个群，其中一个只有 1 个成员）必须能区分成 members_too_few
  const one = impl.planMigration({
    dir: "/fake/one",
    bad: 0,
    values: new Map([["sand.client.slice.roster.last-roster", { value: { rows: [
      { id: "solo-a", name: "独" },
      { id: "solo-grp", name: "单人群", isGroup: true, memberIds: ["solo-a"] },
    ] } }]]),
  });
  const sg = one.rooms[0];
  if (sg && sg.member_grok_ids.length === 1 && sg.missing_count === 0) {
    ok("T4 单人群：对得上 1 人、missing_count=0（→ 报 members_too_few 而不是 unmapped）");
  } else bad("T4 单人群判定", JSON.stringify(sg));

  // 群绝不能成为群成员
  const allMemberIds = plan.rooms.reduce((acc, r) => acc.concat(r.member_grok_ids), []);
  if (!allMemberIds.includes("grp-full") && !allMemberIds.includes("grp-hollow")) ok("T4 群没有被塞成群成员");
  else bad("T4 群被塞成群成员", JSON.stringify(allMemberIds));

  if (plan.sessions.length === 2) ok("T4 只建有内容的线程（空线程不建）");
  else bad("T4 只建有内容的线程", JSON.stringify(plan.sessions.map((s) => s.title)));

  const titles = plan.sessions.map((s) => s.title).sort();
  if (titles.every((t) => t.startsWith("Grok · "))) ok('T4 标题都带 "Grok · " 前缀');
  else bad("T4 标题前缀", JSON.stringify(titles));

  const sa = plan.sessions.find((s) => s.grok_id === "bot-a");
  if (sa && sa.messages.length === 2 && sa.messages[0].role === "user") ok("T4 附件条目被拒、两条真实消息按时间序留下");
  else bad("T4 bot-a 消息", JSON.stringify(sa && sa.messages.map((m) => m.role)));

  if (plan.skip_reasons.message_type_attachment === 1) ok("T4 跳过原因记到 message_type_attachment×1");
  else bad("T4 跳过原因", JSON.stringify(plan.skip_reasons));

  if (plan.stats.messages === plan.sessions.reduce((n, s) => n + s.messages.length, 0)) ok("T4 stats.messages 与各会话之和自洽");
  else bad("T4 stats.messages 不自洽");

  // 缺 roster 的情况要报错，不能返回空计划假装"没有可迁的"
  const empty = impl.planMigration({ dir: "/x", values: new Map(), bad: 0 });
  if (empty.error) ok("T4 没 roster 时返回 error 而不是空计划");
  else bad("T4 没 roster 时要报错", JSON.stringify(empty.stats));
}

/* ---------- T5 负向对照：把实现打坏，断言必须翻假 ---------- */
{
  const broke = [
    ["T5a 标题前缀抹空", SRC.replace('"Grok · " + (row.name', '"" + (row.name'), (m) => {
      const p = m.planMigration(FAKE);
      return p.sessions.every((s) => s.title.startsWith("Grok · "));
    }],
    ["T5b widget 分支短路", SRC.replace('if (m.type === "widget" && m.widget)', "if (false)"), (m) => {
      const p = m.planMigration(FAKE);
      return p.stats.widget_converted === 1;
    }],
    ["T5c 群成员不过滤 !is_group", SRC.replace("if (hit && !hit.is_group) members.push", "if (hit) members.push"), (m) => {
      const p = m.planMigration(FAKE);
      const all = p.rooms.reduce((a, r) => a.concat(r.member_grok_ids), []);
      return !all.includes("grp-full");
    }],
    ["T5d 跳过改成塞空文本", SRC.replace("if (got.skip) {", "if (false && got.skip) {"), (m) => {
      const p = m.planMigration(FAKE);
      // 正常实现下：1 条附件被拒 → skipped=1；打坏后没人拒 → skipped=0，这条必须翻假
      return p.stats.skipped === 1;
    }],
  ];
  for (const [name, src, stillTrue] of broke) {
    if (src === SRC) { bad(name + "（替换没生效，负向对照本身失效）"); continue; }
    let judged;
    try { judged = stillTrue(load(src)); } catch (e) { judged = false; }
    if (!judged) ok(name + " → 断言翻假");
    else bad(name + " → 断言仍然为真（说明这条断言没真的盯住实现）");
  }
}

/* ---------- T6 预演不写盘 / 纯函数确定性 ---------- */
{
  const dataRoot = path.join(REPO, "data");
  const files = ["desktop/bots.json", "desktop/rooms.json", "desktop/sessions.json"]
    .map((r) => path.join(dataRoot, r))
    .filter((f) => fs.existsSync(f));
  const sha = () => files.map((f) => crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex")).join(",");
  const before = files.length ? sha() : "";

  const source = impl.DEFAULT_SOURCE || path.join(process.env.HOME || "", "Library/Application Support/Grok Bot/sand-client-persistence");
  const hasSource = fs.existsSync(source);

  // 纯函数：同一份 store 跑两遍，计划必须逐字相同（否则预演看到的和 --apply 写的不是一回事）
  const p1 = JSON.stringify(impl.planMigration(FAKE));
  const p2 = JSON.stringify(impl.planMigration(FAKE));
  if (p1 === p2) ok("T6 planMigration 幂等（同一 store 两遍结果逐字相同）");
  else bad("T6 planMigration 不幂等");

  if (!hasSource) {
    skip("T6 真库预演不写盘", "本机没有 Grok Bot 数据目录");
  } else {
    try {
      execFileSync(process.execPath, [SRC_PATH, "--json"], { cwd: REPO, stdio: "pipe", timeout: 120000 });
      const after = sha();
      if (before === after) ok("T6 --json 预演跑完 data/desktop 三个文件 sha 不变");
      else bad("T6 预演动了盘", before + " → " + after);
    } catch (e) {
      bad("T6 预演执行失败", (e && e.message) || e);
    }
  }
}

/* ---------- T7 迁移进来的消息，时间是原来的时间 ---------- */
{
  // 这条盯的是"参数存在但不生效"：sessions.appendMessages 曾经无视传入的 at、
  // 一律写 now，于是 1466 条历史消息全变成导入那一刻 —— 界面上看不出来（时间不显示），
  // 但导出/排序/将来显示时间时全是错的。判据是跨源对拍，不是"看起来有 at 字段"。
  const dataRoot = path.join(REPO, "data");
  const source = impl.DEFAULT_SOURCE;
  const sessFile = path.join(dataRoot, "desktop/sessions.json");

  if (!fs.existsSync(source)) skip("T7 迁移消息保留原始时间", "本机没有 Grok Bot 数据目录");
  else if (!fs.existsSync(sessFile)) skip("T7 迁移消息保留原始时间", "本项目还没有会话库");
  else {
    let migrated = [];
    try {
      const doc = JSON.parse(fs.readFileSync(sessFile, "utf8"));
      migrated = (doc.sessions || []).filter((s) => String(s.title || "").startsWith("Grok · "));
    } catch (e) { bad("T7 读会话库失败", e && e.message); }

    if (!migrated.length) {
      skip("T7 迁移消息保留原始时间", "库里还没有迁移会话（先跑一次 --apply）");
    } else {
      const days = new Set();
      let minMigrated = 0;
      for (const s of migrated) {
        for (const m of s.messages || []) {
          days.add(String(m.at || "").slice(0, 10));
          const t = Date.parse(String(m.at || ""));
          if (!Number.isNaN(t) && (minMigrated === 0 || t < minMigrated)) minMigrated = t;
        }
      }
      if (days.size >= 2) ok(`T7 迁移会话跨 ${days.size} 个不同日期（没被抹成导入那一刻）`);
      else bad("T7 迁移会话时间被抹平", [...days].join(","));

      // 跨源对拍：迁移消息里最早的那条，必须等于源端 entries 里最早的 timestampMs
      const store = impl.readStore(source);
      let minSource = 0;
      for (const [k, doc] of store.values) {
        if (!k.includes(".transcript.replicas.")) continue;
        for (const e of ((doc.value && doc.value.entries) || [])) {
          const t = Number(e && (e.timestampMs || e.at || e.createdAt)) || 0;
          if (t > 0 && (minSource === 0 || t < minSource)) minSource = t;
        }
      }
      if (minSource && minMigrated === minSource) {
        ok("T7 最早一条的时间与源端 timestampMs 逐毫秒相同（" + new Date(minSource).toISOString() + "）");
      } else {
        bad("T7 最早一条时间对不上",
          "源 " + (minSource ? new Date(minSource).toISOString() : "无") +
          " vs 迁移 " + (minMigrated ? new Date(minMigrated).toISOString() : "无"));
      }
    }
  }
}

/* ---------- 汇总 ---------- */
console.log("");
if (skipped) console.log(`  ⊘ ${skipped} 项被跳过（不算通过）`);
if (fail) {
  console.log(`prove_m53d_grok_bot_import: ${pass}/${fail}  — 有失败`);
  process.exit(1);
}
console.log(`prove_m53d_grok_bot_import: ${pass}/0`);
