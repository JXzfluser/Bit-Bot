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

  console.log("\nprove_gp153_cron_next_due: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
})();
