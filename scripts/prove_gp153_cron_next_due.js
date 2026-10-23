#!/usr/bin/env node
"use strict";

/**
 * prove_gp153_cron_next_due — 场景验收（自媒体博主日更）· Host 侧排程真因
 *
 * 用户说法：「每天早上9点把审核通过的稿子发到我的邮箱」。
 * 内核侧的中文解析已经能产出 cron=`0 9 * * *`（desktop_turn 测试
 * desktop_turn_cn_routine_phrasings 已绿），但 Host 的 nextDueFromCron 只认
 * @now/@hourly/@weekly 和「星斜 N」的每 N 分钟形式，**任何 5 字段 cron 都掉进
 * 「now + 24 小时」的兜底**，而且完全不看用户在设置里选的时区。
 * 结果：说好的「每天 09:00」实际会在任意钟点触发 —— 这是「看起来修了」，
 * 本文件先把契约写成测试（先红），修完必须全绿。
 *
 * 断言对象是落盘的 data/routines/host-routines.json 与 next_due 本身，
 * 不是函数内部实现。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 220) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp153-"));
const ffi = createHostFfi(root);
const routinesPath = path.join(root, "data", "routines", "host-routines.json");

/** 用 IANA 时区把 ISO 时刻拆成本地墙钟（不引第三方库）。 */
function wallClock(iso, tz) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, weekday: "short",
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date(iso))) p[part.type] = part.value;
  return {
    hour: Number(p.hour === "24" ? "0" : p.hour),
    minute: Number(p.minute),
    day: Number(p.day),
    weekday: p.weekday, // Mon/Tue/…
  };
}

async function schedule(id, cron, prompt) {
  const results = await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: id + "|" + cron + "|" + (prompt || "日更稿件") }],
    { sessionId: "gp153" },
  );
  return (results || []).find((r) => r && r.kind === "routine_schedule");
}

const rows = () => {
  try {
    const j = JSON.parse(fs.readFileSync(routinesPath, "utf8"));
    return Array.isArray(j) ? j : j.routines || [];
  } catch { return []; }
};

(async () => {
  // 用户在「设置 → 一般 → Bot 时区」里选的就是这个：
  const TZ = "Asia/Shanghai";
  const settingsPath = path.join(root, "data", "desktop", "settings.json");
  const setTz = (tz) => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ timezone: tz }));
  };
  try { setTz(TZ); } catch (e) { bad("无法准备临时 settings.json", e); }

  // 1) 每天 09:00：next_due 的墙钟必须是 9:00（而不是「创建时刻 + 24h」）
  const r1 = await schedule("gp153-daily9", "0 9 * * *", "每天早上9点把审核通过的稿子发到我的邮箱");
  const row1 = rows().find((r) => r.id === "gp153-daily9");
  if (!r1 || !r1.ok || !row1) {
    bad("0 9 * * * 没建成定时任务", JSON.stringify(r1 && { ok: r1.ok, error: r1.error, stderr: r1.stderr }).slice(0,300));
  } else {
    const w = wallClock(row1.next_due, TZ);
    const ahead = (Date.parse(row1.next_due) - Date.now()) / 3600000;
    w.hour === 9 && w.minute === 0 && ahead > 0 && ahead <= 24.5
      ? ok("`0 9 * * *` → next_due 落在 " + TZ + " 的 09:00（" + row1.next_due + "，" + ahead.toFixed(1) + "h 后）")
      : bad("`0 9 * * *` 没落在 09:00", JSON.stringify({ next_due: row1.next_due, 墙钟: w, 距now小时: +ahead.toFixed(2), 时区: TZ }));
    row1.cron === "0 9 * * *"
      ? ok("cron 原文按用户排程落盘（没被改写成 @daily 之类）")
      : bad("cron 被改写", row1.cron);
  }

  // 2) 工作日 18:00：既要 18:00，也必须落在周一~周五
  const r2 = await schedule("gp153-weekday", "0 18 * * 1-5");
  const row2 = rows().find((r) => r.id === "gp153-weekday");
  if (!r2 || !r2.ok || !row2) {
    bad("0 18 * * 1-5 没建成定时任务", JSON.stringify(r2 && r2.error));
  } else {
    const w = wallClock(row2.next_due, TZ);
    const weekend = w.weekday === "Sat" || w.weekday === "Sun";
    w.hour === 18 && w.minute === 0 && !weekend
      ? ok("`0 18 * * 1-5` → 下一个工作日 18:00（" + w.weekday + " " + row2.next_due + "）")
      : bad("`0 18 * * 1-5` 没落在工作日 18:00", JSON.stringify({ next_due: row2.next_due, 墙钟: w }));
  }

  // 3) 每 30 分钟：仍然要贴齐 30 分钟刻度（既有能力不许被改坏）
  const r3 = await schedule("gp153-30m", "*/30 * * * *", "每30分钟搜集一次热点新闻");
  const row3 = rows().find((r) => r.id === "gp153-30m");
  if (!r3 || !r3.ok || !row3) {
    bad("*/30 * * * * 没建成定时任务", JSON.stringify(r3 && r3.error));
  } else {
    const w = wallClock(row3.next_due, TZ);
    const ahead = (Date.parse(row3.next_due) - Date.now()) / 60000;
    w.minute % 30 === 0 && ahead > 0 && ahead <= 30.5
      ? ok("`*/30 * * * *` → 30 分钟刻度内触发（" + ahead.toFixed(1) + " 分后）")
      : bad("`*/30 * * * *` 刻度不对", JSON.stringify({ next_due: row3.next_due, 墙钟: w, 距now分: +ahead.toFixed(1) }));
  }

  // 4) 时区真的被读：换一个时区排同一句 09:00，UTC 时刻必须不同
  const r4 = await schedule("gp153-tz", "0 9 * * *");
  try { setTz("America/Los_Angeles"); } catch (_) {}
  const r5 = await schedule("gp153-tz-la", "0 9 * * *");
  const a = rows().find((x) => x.id === "gp153-tz");
  const b = rows().find((x) => x.id === "gp153-tz-la");
  if (!a || !b) {
    bad("时区对照用例没建成", JSON.stringify({ a: Boolean(a), b: Boolean(b) }));
  } else {
    const wa = wallClock(a.next_due, "Asia/Shanghai");
    const wb = wallClock(b.next_due, "America/Los_Angeles");
    const sameInstant = a.next_due === b.next_due;
    wa.hour === 9 && wb.hour === 9 && !sameInstant
      ? ok("同一句「0 9 * * *」在两个时区各自落在本地 09:00（UTC 时刻不同，说明真看了设置）")
      : bad("排程没跟随时区设置", JSON.stringify({ shanghai: a.next_due, 本地: wa, la: b.next_due, 本地LA: wb }));
  }

  // 5) 回归护栏：GP-138 的 5 分钟下限不能被新解析绕过去
  const r6 = await schedule("gp153-too-often", "*/1 * * * *");
  const row6 = rows().find((r) => r.id === "gp153-too-often");
  r6 && r6.ok === false && String(r6.error).includes("interval_too_short") && !row6
    ? ok("每 1 分钟仍被拒（interval_too_short），且不落盘")
    : bad("5 分钟下限被绕过", JSON.stringify({ ok: r6 && r6.ok, error: r6 && r6.error, 落盘: Boolean(row6) }));

  // 6) 负向对照（证明断言非恒真）：把排程退回「now + 24h」，09:00 断言必须翻假
  {
    const naive = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const w = wallClock(naive, TZ);
    const naiveWouldPass = w.hour === 9 && w.minute === 0;
    naiveWouldPass
      ? bad("负向对照失效：now+24h 恰好落在 09:00，本轮 09:00 断言无区分度（换时段重跑）")
      : ok("负向对照：now+24h 兜底落在 " + String(w.hour).padStart(2, "0") + ":" + String(w.minute).padStart(2, "0") + "，断言能区分「真排程」与「假排程」");
  }

  // 7) 诚实拒绝：解析不了的 cron 不再偷偷写一个「24 小时后」
  const r7 = await schedule("gp153-bogus", "99 99 99 99 99");
  const row7 = rows().find((r) => r.id === "gp153-bogus");
  r7 && r7.ok === false && String(r7.error).includes("cron_unsupported") && !row7
    ? ok("无法解析的 cron 被如实拒绝（cron_unsupported），且不落盘")
    : bad("无法解析的 cron 被假装排好了", JSON.stringify({ ok: r7 && r7.ok, error: r7 && r7.error, 落盘: Boolean(row7) }));

  // 8) 永不触发的排程（2 月 30 日）也要拒绝，不能落一个假 next_due
  const r8 = await schedule("gp153-feb30", "0 0 30 2 *");
  const row8 = rows().find((r) => r.id === "gp153-feb30");
  r8 && r8.ok === false && !row8
    ? ok("未来 400 天内无触发时刻被拒绝（" + String(r8.error) + "），不落盘")
    : bad("不可能的排程被落盘", JSON.stringify({ ok: r8 && r8.ok, error: r8 && r8.error, next_due: row8 && row8.next_due }));

  // 9) 内核 CM-0402 认可的两种写法：@every 与 CRON_TZ= 前缀
  const r9 = await schedule("gp153-every", "@every 30m", "每 30 分钟汇总一次热点");
  const row9 = rows().find((r) => r.id === "gp153-every");
  const ahead9 = row9 ? (Date.parse(row9.next_due) - Date.now()) / 60000 : -1;
  r9 && r9.ok && row9 && ahead9 > 29 && ahead9 <= 30.5
    ? ok("`@every 30m` → 30 分钟后触发（" + ahead9.toFixed(1) + " 分）")
    : bad("`@every 30m` 没按间隔排程", JSON.stringify({ ok: r9 && r9.ok, error: r9 && r9.error, 分: +ahead9.toFixed(1) }));

  try { setTz("Asia/Shanghai"); } catch (_) {}
  const r10 = await schedule("gp153-crontz", "CRON_TZ=America/Los_Angeles 0 9 * * *");
  const row10 = rows().find((r) => r.id === "gp153-crontz");
  if (!r10 || !r10.ok || !row10) {
    bad("CRON_TZ= 前缀被拒绝（内核 CM-0402 认可它）", JSON.stringify({ ok: r10 && r10.ok, error: r10 && r10.error, stderr: r10 && r10.stderr }));
  } else {
    const w10 = wallClock(row10.next_due, "America/Los_Angeles");
    const w10sh = wallClock(row10.next_due, "Asia/Shanghai");
    w10.hour === 9 && w10.minute === 0 && w10sh.hour !== 9
      ? ok("CRON_TZ= 前缀按表达式自己的时区排程（洛杉矶 09:00，非上海 09:00）")
      : bad("CRON_TZ= 前缀没生效", JSON.stringify({ next_due: row10.next_due, LA: w10, SH: w10sh }));
  }

  console.log("\nprove_gp153_cron_next_due: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
})();
