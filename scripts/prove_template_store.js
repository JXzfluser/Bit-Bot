#!/usr/bin/env node
/* prove_template_store.js — 「我加的模板怎么都不见了」不许再发生。
 *
 * 三个真实的来路，都在本仓发生过：
 *
 *  ① 门禁删用户库。scripts/smoke_grok_desktop_parity.sh 的 G-11 块原本是
 *     `rm -f data/desktop/bot-templates.json`，删完再由 Host 首读种入六条内置
 *     模板。每跑一次全量 smoke，用户手写的模板就没了 —— 而 smoke 是「跑门禁」，
 *     不是「重置产品」。同一段末尾还有一条按名字删 Bot 的清理
 *     （Chiefy/Scouty/Sage/Ghost），Sage 恰好是 talent-scout 的默认名。
 *
 *  ② 读者把团队模板丢掉。host_ffi 的 loadBotTemplates 过滤条件是
 *     `t.id && t.job && t.description`。团队模板（kind:"team"）带的是
 *     roles + rules，往往没有 job/description —— 文件里明明写着，读出来却没它。
 *     这种「库对、看不见」比删库更难查，因为文件看着好好的。
 *
 *  ③ 没有临时数据根可用。host_ffi 的 DATA_ROOT 只能由 opts 传，CLI Host 永远
 *     落在 <repo>/data，所以「验首读种入」只能拿真库开刀 —— 于是有了 ①。
 *     现在 $BITBOT_DATA_ROOT 指向 <repo>/data-gp02 这样的同级目录，
 *     dirname 仍是仓库，内核 cwd 不变，`moon run` 照样找得到 cmd/main。
 *
 * 判据都带注入对照：把旧实现喂回去，必须判红。
 *
 * 跑法：node scripts/prove_template_store.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const STORE = path.join(ROOT, "data/desktop/bot-templates.json");
const BOTS = path.join(ROOT, "data/desktop/bots.json");
const HOST_FFI = path.join(ROOT, "hosts/shared/host_ffi.js");
const SMOKE = path.join(ROOT, "scripts/smoke_grok_desktop_parity.sh");
const TEAM_PROFILE = path.join(ROOT, "data/workspace/自媒体内容团队/00-profile");

let PASS = 0;
let FAIL = 0;
const ok = (id, msg) => {
  PASS++;
  console.log("  ✓ " + id + " " + msg);
};
const bad = (id, msg, extra) => {
  FAIL++;
  console.log("  ✗ " + id + " " + msg + (extra !== undefined ? " — " + JSON.stringify(extra) : ""));
};
const skip = (id, msg) => console.log("  · " + id + " SKIP " + msg + "（没验到，不算通过）");

const read = (p) => fs.readFileSync(p, "utf8");
const sha = (p) => {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch (_) {
    return null;
  }
};

/** 只扫代码，不扫注释 —— 注释里写着「原来这里有 rm -f」不算违规，
 *  但真正执行到的那行必须没有。整行注释直接丢，行尾注释保留（更严）。 */
function dropCommentLines(src) {
  const out = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("#")) continue;
    out.push(line);
  }
  return out.join("\n");
}

/* ---------- 1) 门禁不许删用户库 ---------- */

{
  const src = read(SMOKE);
  const code = dropCommentLines(src);
  const judgeGate = (text) => {
    const i = text.indexOf('== G-11 Bot 模板目录');
    if (i < 0) return { ok: false, why: "找不到 G-11 块" };
    const j = text.indexOf("== G-12", i);
    const block = text.slice(i, j < 0 ? text.length : j);
    if (/rm\s+-f\s+[^\n]*data\/desktop\/bot-templates\.json/.test(block)) {
      return { ok: false, why: "G-11 仍在 rm 真实模板库" };
    }
    if (!/BITBOT_DATA_ROOT/.test(block)) {
      return { ok: false, why: "G-11 没有把数据根指到临时目录（用户库照样被写）" };
    }
    if (!/sha256|shasum/.test(block)) {
      return { ok: false, why: "G-11 收尾没有证明真实库未被改动" };
    }
    if (/d\.bots\s*=\s*d\.bots\.filter\(\s*x\s*=>\s*!\s*\[\s*'Chiefy'/.test(block)) {
      return { ok: false, why: "G-11 仍在按名字从真实 bots.json 删 Bot" };
    }
    return { ok: true, why: "临时数据根 + sha256 收尾，用户库只读" };
  };

  const r = judgeGate(code);
  if (r.ok) ok("TS-01", "G-11 不碰用户库：" + r.why);
  else bad("TS-01", "G-11 会改动用户库：" + r.why);

  // 注入对照：把修复前那两种写法喂回去，都必须判红。
  //  （A）直接 rm 真实库；（B）数据根指到临时目录、却仍按名字从真实 bots.json 删 Bot。
  const injectedA = '== G-11 Bot 模板目录\nrm -f data/desktop/bot-templates.json\nj=$(turn_json "list bot templates")\n';
  const injectedB =
    "== G-11 Bot 模板目录\nj=$(BITBOT_DATA_ROOT=/tmp/x turn_json \"list bot templates\")\n" +
    "shasum -a 256 data/desktop/bot-templates.json\n" +
    "node -e \"d.bots=d.bots.filter(x=>!['Chiefy','Scouty','Sage','Ghost'].includes(x.name))\"\n";
  const a = judgeGate(injectedA);
  const b = judgeGate(injectedB);
  if (a.ok || b.ok) {
    bad("TS-01b", "注入对照失效：旧实现仍判绿", { rm: a.ok, delByName: b.ok });
  } else {
    ok("TS-01b", "注入对照：rm 真库 / 按名字删 Bot 两种旧写法都判红");
  }
}

/* ---------- 2) 读者不许丢团队模板 ---------- */

{
  const src = read(HOST_FFI);
  const judgeFilter = (text) => {
    const i = text.indexOf("function loadBotTemplates()");
    if (i < 0) return { ok: false, why: "找不到 loadBotTemplates" };
    const block = text.slice(i, i + 1400);
    // 旧条件：job 与 description 同时为硬门槛
    if (/t\.id\s*&&\s*t\.job\s*&&\s*t\.description/.test(block)) {
      return { ok: false, why: "过滤仍要求 job+description —— 团队模板(roles/rules)会被静默丢掉" };
    }
    if (!/Array\.isArray\(t\.roles\)/.test(block)) {
      return { ok: false, why: "没有把 roles 当成一条合法模板" };
    }
    if (!/kept\.length\s*\?/.test(block)) {
      return { ok: false, why: "一条都没留下时没回落 seed（会把目录读成空）" };
    }
    return { ok: true, why: "只要求 id，团队模板(roles)单独放行，全丢才回落 seed" };
  };

  const r = judgeFilter(src);
  if (r.ok) ok("TS-02", "loadBotTemplates：" + r.why);
  else bad("TS-02", "loadBotTemplates 会吞模板：" + r.why);

  const old = 'const kept = list.filter((t) => t && t.id && t.job && t.description);\n      return kept;';
  if (judgeFilter(old).ok) bad("TS-02b", "注入对照失效：旧 filter 仍判绿");
  else ok("TS-02b", "注入对照：退回 t.id && t.job && t.description → 判红");
}

/* ---------- 3) 行为验证：真的跑一遍 Host（临时数据根） ---------- */

{
  /* 临时数据根必须是**仓库的直接子目录**：host_ffi 把内核 cwd 取成
     dirname(DATA_ROOT)，`moon run cmd/desktop_turn` 才找得到包。放到 /tmp 下
     内核就起不来了（实测 exit 255 / failed to resolve path cmd/desktop_turn）。
     这条约束本身就是 TS-05 要钉住的东西。 */
  const tmp = path.join(ROOT, ".tpl-probe-" + process.pid);
  const tplShaBefore = sha(STORE);
  const botsShaBefore = sha(BOTS);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
    const dir = path.join(tmp, "desktop");
    fs.mkdirSync(dir, { recursive: true });
    const custom = {
      templates: [
        { id: "custom-note", default_name: "笔记", job: "笔记整理", description: "把散落的材料整理成一篇。" },
        // 团队模板：有 roles、没有 job/description —— 这正是旧 filter 会吞掉的形状
        { id: "custom-team", kind: "team", category: "自媒体", default_name: "自定义小队", roles: [{ name: "A", description: "a", prompt: "p" }] },
      ],
    };
    fs.writeFileSync(path.join(dir, "bot-templates.json"), JSON.stringify(custom, null, 2));

    const out = execFileSync("node", ["hosts/cli_host/run_turn.js", "list bot templates"], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { BITBOT_DATA_ROOT: tmp }),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const line = out.split("\n").filter((l) => l.trim().startsWith("{")).pop() || "{}";
    const j = JSON.parse(line);
    const hit = (j.host_results || []).find((h) => h && h.kind === "bot_templates_list");
    const payload = hit ? JSON.parse(hit.stdout || "{}") : {};
    const ids = (payload.templates || []).map((t) => t.id);

    // 判据一：用户写的两条都在，且没有被 seed 顶掉（有文件时不该混进六条内置）
    const keepBoth = ids.includes("custom-note") && ids.includes("custom-team");
    const noSeed = !ids.includes("sales-outbound");
    if (keepBoth && noSeed) {
      ok("TS-03", "临时库里两条自定义模板原样读出，seed 没有覆盖用户库（" + ids.join(", ") + "）");
    } else {
      bad("TS-03", "自定义模板没读全或被 seed 覆盖", { ids });
    }

    // 判据二：负向对照 —— 同一份输入喂给旧过滤器，团队那条必须消失
    const oldFiltered = (custom.templates || []).filter((t) => t && t.id && t.job && t.description).map((t) => t.id);
    if (!oldFiltered.includes("custom-team") && keepBoth) {
      ok("TS-03b", "注入对照：同一份文件用旧 filter 读 → custom-team 消失（" + oldFiltered.join(", ") + "），新实现留住了它");
    } else {
      bad("TS-03b", "注入对照失效：旧 filter 也能读到团队模板", { oldFiltered });
    }
  } catch (e) {
    bad("TS-03", "跑 Host 失败：" + (e && e.message));
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
    if (sha(STORE) !== tplShaBefore || sha(BOTS) !== botsShaBefore) {
      bad("TS-03c", "本次自检改动了真实库 —— 自检本身就不许写用户数据");
    } else {
      ok("TS-03c", "自检全程没碰真实库（bot-templates.json / bots.json 的 sha256 未变）");
    }
  }
}

/* ---------- 4) 自媒体团队模板在位，且角色数对得上真实团队 ---------- */

{
  if (!fs.existsSync(STORE)) {
    skip("TS-04", "没有模板库文件");
  } else {
    let list = [];
    try {
      const raw = JSON.parse(read(STORE));
      list = Array.isArray(raw) ? raw : raw.templates || [];
    } catch (_) {
      /* 下面按空处理 */
    }
    const team = list.find((t) => t && t.kind === "team" && Array.isArray(t.roles) && t.roles.length);
    if (!team) {
      bad("TS-04", "模板库里没有任何团队模板（一键成队点了会报「缺少角色定义」）");
    } else {
      // 角色数以磁盘上真实团队的岗位 Prompt 为准，不写死
      let realRoles = 0;
      try {
        realRoles = fs
          .readdirSync(TEAM_PROFILE)
          .filter((f) => f.endsWith(".md") && !["ROLES.md", "COLLAB-RULES.md", "voice.md"].includes(f)).length;
      } catch (_) {
        realRoles = 0;
      }
      const names = team.roles.map((r) => r.name).join(" → ");
      if (realRoles && team.roles.length !== realRoles) {
        bad("TS-04", "团队模板角色数与真实团队不一致", { tpl: team.roles.length, real: realRoles });
      } else {
        ok("TS-04", "团队模板《" + (team.default_name || team.id) + "》在库，" + team.roles.length + " 个岗位：" + names);
      }
      // 每个角色都得有完整 Prompt，否则「一键成队」建出来的 Bot 只有一句话
      const thin = team.roles.filter((r) => !r.prompt || String(r.prompt).trim().length < 80).map((r) => r.name);
      if (thin.length) bad("TS-04b", "这些角色没有完整岗位 Prompt（建队后交付会变空）", thin);
      else ok("TS-04b", "每个岗位都带完整 Prompt 与协作规则（rules 非空：" + Boolean(team.rules && team.rules.trim()) + "）");
    }
  }
}

console.log("\nprove_template_store: PASS=" + PASS + " FAIL=" + FAIL);
process.exit(FAIL ? 1 : 0);
