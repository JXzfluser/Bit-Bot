// 按钮体系一致性 computed-style 审计（真渲染）
import { createRequire } from "node:module";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const DESKTOP = path.join(REPO, "hosts", "desktop");
const mainJs = path.join(DESKTOP, "main.js");
const require = createRequire(path.join(DESKTOP, "noop.js"));
const { _electron } = require("playwright-core");
import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, isolatedRepoRoot, gateAppEnv } from "./electron_env.mjs";
import fs from "node:fs";

const executablePath = resolveElectronBinary(DESKTOP);
const root = isolatedRepoRoot(REPO, "btn-audit", {
  "sessions.json": { version: 1, active_id: "", sessions: [] },
  "bots.json": { version: 1, primary_id: "agent-bit", bots: [] },
  "rooms.json": { version: 1, rooms: [] },
});

const app = await _electron.launch({
  executablePath,
  args: [mainJs, "--no-sandbox", "--disable-gpu", "--user-data-dir=" + electronUserDataDir("btn-audit")],
  cwd: REPO,
  env: electronLaunchEnv(gateAppEnv(root)),
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(2500);

const report = await win.evaluate(() => {
  const gs = (el) => getComputedStyle(el);
  const out = { btnSm: [], primary: [], danger: [], leftovers: [], chips: [], chipViolations: [], approval: [] };

  for (const el of document.querySelectorAll(".bb-btn-sm")) {
    const s = gs(el);
    out.btnSm.push({ id: el.id || el.textContent.trim().slice(0, 10), pad: s.padding, r: s.borderRadius, fs: s.fontSize, bg: s.backgroundColor, border: s.borderWidth + " " + s.borderColor });
  }
  for (const el of document.querySelectorAll(".bb-btn.bb-btn-primary:not(.bb-btn-sm)")) {
    const s = gs(el);
    out.primary.push({ id: el.id || el.textContent.trim().slice(0, 10), pad: s.padding, r: s.borderRadius, bg: s.backgroundColor });
  }
  // 无 class 且带视觉内联样式的按钮（应归零）
  for (const el of document.querySelectorAll("button:not([class])")) {
    const st = el.getAttribute("style") || "";
    if (/background|border|padding/.test(st)) out.leftovers.push({ id: el.id, style: st.slice(0, 60) });
  }
  // chip 家族（选项/过滤语义）：形状唯一；按钮型 chip 必须带 data-* 选项属性
  for (const el of document.querySelectorAll(".gp-chip, .ca-chip")) {
    const s = gs(el);
    out.chips.push({ tag: el.tagName, pad: s.padding, r: s.borderRadius, fs: s.fontSize });
    if (el.tagName === "BUTTON") {
      const hasData = [...el.attributes].some((a) => a.name.startsWith("data-"));
      if (!hasData) out.chipViolations.push({ id: el.id || "(dynamic)", text: el.textContent.trim().slice(0, 12) });
    }
  }
  // 审批卡三按钮走 bb-btn 体系
  for (const id of ["approve-btn", "allow-always-btn", "deny-btn"]) {
    const el = document.getElementById(id);
    if (el) out.approval.push({ id, hasBtn: el.classList.contains("bb-btn") });
  }
  return out;
});

// 断言 1：bb-btn-sm 形态全等
const variants = new Set(report.btnSm.map(b => `${b.pad}|${b.r}|${b.fs}|${b.bg}`));
console.log(`bb-btn-sm count=${report.btnSm.length} distinct-forms=${variants.size}`);
if (variants.size > 1) for (const v of variants) console.log("  variant:", v);

// 断言 2：无 class 内联按钮 = 0
// 断言（GP 按钮审计）：形状（padding/radius/字号）必须全局只有一种；
// 底色按功能类分：surface 白 / primary accent(浅色主题=黑) / danger 两变体。
const shapes = new Set(report.btnSm.map(b => `${b.pad}|${b.r}|${b.fs}`));
console.log(`bb-btn-sm count=${report.btnSm.length} distinct-shapes=${shapes.size} distinct-bgs=${variants.size}`);
const bgGroups = [...new Set(report.btnSm.map(b => b.bg))];
for (const bg of bgGroups) {
  const g = report.btnSm.filter(b => b.bg === bg);
  const s = new Set(g.map(b => `${b.pad}|${b.r}|${b.fs}`));
  console.log(`  bg=${bg} n=${g.length} shapes=${s.size}${s.size > 1 ? " ← 不一致!" : ""}`);
}
// chip 预算：静态 11（gp-tab/appearance/devmode/locexec，带 data-*）+ ca-chip 6
// + 动态选择器 3（bot 屏选 / 建群成员选）+ 渲染时机余量。超预算 = 有人新加了
// 动作型 gp-chip —— 动作按钮应该用 .bb-btn.bb-btn-sm。
const CHIP_BUDGET = 20;
const chipButtons = report.chips.filter((c) => c.tag === "BUTTON").length;
const ok = shapes.size === 1 && report.leftovers.length === 0
  && chipButtons <= CHIP_BUDGET
  && report.approval.every((a) => a.hasBtn);
console.log(`unclassed styled buttons: ${report.leftovers.length}`);
console.log(`chips: n=${report.chips.length} buttons=${chipButtons} (budget ${CHIP_BUDGET}) distinct-forms=${new Set(report.chips.map((c) => c.pad + "|" + c.r + "|" + c.fs)).size}`);
if (report.chipViolations.length) console.log("  chip without data-* (must be a selector/picker):", JSON.stringify(report.chipViolations));
console.log(`approval bb-btn: ${report.approval.map((a) => a.id + "=" + a.hasBtn).join(", ")}`);
console.log(ok ? "AUDIT PASS" : "AUDIT FAIL");
process.exit(0);
