#!/usr/bin/env node
"use strict";

/**
 * prove_gp135_skill_sources — GP-135（§6.3）Skill 三来源与 `/` 菜单 / Connect apps
 *
 * Host list_skills 现在枚举三个来源并按 SkillSource 优先级去重：
 *   Managed（内核 ManagedCatalog seed）< Plugin（已安装 Connect app）< User（agent-tools/skills）
 * 每条带 source / priority；插件技能带 plugin_id；同名保留高优先级并记 also_in。
 * renderer：`/` 菜单按来源分组；无匹配时给出「去连接应用安装带技能的插件」引导；
 * Connect apps 面板列出「技能（按来源）」。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

const REPO = path.resolve(__dirname, "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp135-"));

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
const skillsRoot = path.join(root, "agent-tools", "skills");
write(
  path.join(skillsRoot, "learned-x", "SKILL.md"),
  "---\nname: learned-x\ndescription: Learned from a demo turn.\n---\n\nBody\n"
);
write(
  path.join(root, "data", "connectors", "mcp-namespaces", "catalog.json"),
  JSON.stringify({ installed_plugins: ["plugin-slides", "plugin-calendar"] }, null, 2)
);

const ffi = createHostFfi(root);

async function listSkills(cmd) {
  const res = await ffi.executeHostEffects([{ kind: "list_skills", command: cmd || "q=" }]);
  const hit = (res || []).find((r) => r && r.kind === "list_skills");
  if (!hit) throw new Error("no list_skills result");
  let payload = {};
  try { payload = JSON.parse(hit.stdout || "{}"); } catch (_) { payload = {}; }
  return { hit, payload };
}

(async () => {
  console.log("prove_gp135_skill_sources — Skill 三来源（GP-135）");

  const { hit, payload } = await listSkills("");
  if (hit.ok && payload.mode === "host_list_skills" && payload.pretend_listing === false) {
    ok("list_skills 走 Host 目录且不 pretend_listing");
  } else {
    bad("list_skills mode/pretend_listing", JSON.stringify(payload).slice(0, 200));
  }
  if (payload.path && fs.existsSync(payload.path)) ok("清单落盘且路径存在");
  else bad("清单未落盘", payload.path);

  const counts = payload.source_counts || {};
  const wantCounts = { managed: 3, user: 1, plugin: 2 };
  if (counts.managed === wantCounts.managed && counts.user === wantCounts.user && counts.plugin === wantCounts.plugin) {
    ok(`source_counts managed/user/plugin = ${counts.managed}/${counts.user}/${counts.plugin}`);
  } else {
    bad("source_counts", JSON.stringify(counts) + " want " + JSON.stringify(wantCounts));
  }

  const skills = payload.skills || [];
  if (skills.length === 6) ok("总数 6（3 managed + 2 plugin + 1 user）");
  else bad("skills length", skills.length + " — " + skills.map((s) => s.name).join(","));

  const slide = skills.find((s) => s.name === "slides-quickstart");
  if (slide && slide.source === "plugin" && slide.plugin_id === "plugin-slides") {
    ok("插件技能带 source=plugin + plugin_id");
  } else {
    bad("插件技能标记", JSON.stringify(slide));
  }
  const learned = skills.find((s) => s.name === "learned-x");
  if (learned && learned.source === "user" && learned.priority === 3) {
    ok("用户/学习技能 source=user, priority=3");
  } else {
    bad("用户技能标记", JSON.stringify(learned));
  }
  const routine = skills.find((s) => s.name === "routines");
  if (routine && routine.source === "managed" && routine.priority === 1) {
    ok("托管技能 source=managed, priority=1");
  } else {
    bad("托管技能标记", JSON.stringify(routine));
  }

  // 同名冲突：用户技能优先于 Managed，且记录 also_in。
  write(
    path.join(skillsRoot, "routines", "SKILL.md"),
    "---\nname: routines\ndescription: My own routines skill.\n---\n\nBody\n"
  );
  const second = (await listSkills("")).payload;
  const merged = (second.skills || []).find((s) => s.name === "routines");
  if (
    merged &&
    merged.source === "user" &&
    Array.isArray(merged.also_in) &&
    merged.also_in.includes("managed")
  ) {
    ok("同名去重：User 覆盖 Managed，并记 also_in=managed");
  } else {
    bad("同名去重", JSON.stringify(merged));
  }
  if (second.source_counts.managed === 2 && second.source_counts.user === 2) {
    ok("去重后 source_counts 随高优先级迁移（managed 2 / user 2）");
  } else {
    bad("去重后 source_counts", JSON.stringify(second.source_counts));
  }

  const filtered = (await listSkills("q=calendar")).payload;
  if (
    filtered.count === 1 &&
    filtered.skills[0] &&
    filtered.skills[0].name === "calendar-sync" &&
    filtered.skills[0].source === "plugin"
  ) {
    ok("查询 q=calendar 命中插件技能 calendar-sync");
  } else {
    bad("查询过滤", JSON.stringify(filtered.skills));
  }
  const none = (await listSkills("q=zzz-none")).payload;
  if (none.count === 0) ok("查询无命中返回空（不伪造技能）");
  else bad("无命中应为空", JSON.stringify(none.skills));

  // renderer 接线（源码级；真渲染由 Electron boot 门覆盖）。
  const html = fs.readFileSync(path.join(REPO, "hosts", "desktop", "index.html"), "utf8");
  const checks = [
    ["`/` 菜单按来源分组", html.includes('const SKILL_SOURCE_LABEL = { user: t("caSkillUser")') && html.includes('caSkillUser: "我的 / 学习"')],
    ["无匹配 → 去连接应用引导", html.includes("去「连接应用」安装带技能的插件")],
    ["Connect apps 技能区（按来源）", html.includes('id="ca-skills"') && html.includes("renderConnectAppsSkills")],
  ];
  for (const [name, good] of checks) good ? ok(name) : bad(name);

  console.log(`\nprove_gp135_skill_sources: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("prove_gp135_skill_sources crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
