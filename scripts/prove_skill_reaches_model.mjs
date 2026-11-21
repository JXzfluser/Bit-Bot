#!/usr/bin/env node
/**
 * KP-10「skill 必须进模型」proof — 不依赖 Electron。
 *
 * 对标的验收信号（docs/grok-desktop-parity/kernel-mechanism-parity.md KP-10）是：
 * 磁盘上的 SKILL.md 正文随回合进内核上下文，模型真的看见它 —— 「已有 Skills 功能」
 * 在功能清单上长得像已落地，实际的洞是**一个字都没进过模型**。所以这条门逐层查：
 *
 *   agent-tools/skills/<dir>/SKILL.md
 *   → Host collectSkillSeeds（name≤64 / description≤1024 / disable_model_invocation）
 *   → argv `--seed-skill name::description::body`（和 --seed-memory 同一条显式通道）
 *   → 内核 parse_skill_seeds（再判一次上限；flag 不许混进用户原文）
 *   → 内核把 skills 随每一次 llm_chat 请求交回
 *   → Host llmSkillBlock 拼进 system（有界 / 脱敏 / 标注：技能是数据，不是指令）
 *   → provider 请求体（echo-all stub 证明真上了 HTTP，不是我们自己的日志）
 *
 * 诚实检查：被 disable_model_invocation 关掉、name/description 不合格的技能不许出现
 * 在请求体里；磁盘上没有技能时回合照常成功（不许把「读不到」演成失败）；
 * 两个**反向夹具**必须判红 —— 摘掉 Host 拼装、或摘掉 argv 通道，正文都不该再出现。
 *
 * 数据全在 mkdtemp 里（不写进用户看得见的 data/）；内核用预编译二进制，
 * 这样隔离的 dataRoot 不要求 cwd 是 moon 工程根。
 *
 * Usage: node scripts/prove_skill_reaches_model.mjs   (exit 0 = all assertions green)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0;
let fail = 0;
const ok = (id, msg) => {
  console.log(`ok ${id} — ${msg}`);
  pass += 1;
};
const bad = (id, msg) => {
  console.log(`FAIL ${id} — ${msg}`);
  fail += 1;
};

const RUN = Date.now().toString(36) + "-" + process.pid;
const MARK = "KP10-BODY-" + RUN;
const HIDDEN = "KP10-HIDDEN-" + RUN;
const TOOLONG = "KP10-TOOLONG-" + RUN;
const BADNAME = "KP10-BADNAME-" + RUN;
const NOUSER = "KP10-NOUSER-" + RUN;
const BADENV = "KP10-BADENV-" + RUN;
const STUB_PORT = Number(process.env.BITBOT_KP10_STUB_PORT || 8811);
const SKILL_TEXT = "KP10 点名做一次：按刚才那条技能回答";
// 片2：用户明确点名某条技能时，连 disable_model_invocation 的那条也要进这一回合。
const NAME_HIDDEN_TEXT = "用 kp10-hidden 这条技能做一次";

/* ---- 内核二进制：env 优先；否则**每次**增量 build --------------------------
   第一版这里写的是「已存在就直接用」，结果拿到一个不含本次内核改动的陈旧
   desktop_turn.exe —— SK-05/06 判红、而两个反向夹具「判红」看起来全绿，
   也就是整条门其实在测一个旧内核。增量 build 在 up-to-date 时只要几秒，
   没有理由省。 */
function resolveKernelBin() {
  const fromEnv = process.env.BITBOT_KERNEL_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const profile = process.env.BITBOT_KERNEL_BUILD || "release";
  const dir = path.join(ROOT, "_build", "native", profile, "build", "cmd", "desktop_turn");
  const resolve = () =>
    ["desktop_turn", "desktop_turn.exe"]
      .map((n) => path.join(dir, n))
      .find((p) => fs.existsSync(p));
  const args = ["build", "cmd/desktop_turn", "--target", "native"];
  if (profile === "release") args.push("--release");
  const built = spawnSync(process.env.MOON_BIN || "moon", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 420000,
  });
  const bin = resolve();
  if (!bin) {
    bad("SK-00 内核二进制", "构建后仍找不到 " + dir + "：" + String(built.stderr || built.stdout || "").slice(0, 300));
    return null;
  }
  if (built.status !== 0) {
    bad("SK-00 内核构建失败", String(built.stderr || built.stdout || "").slice(0, 400));
    return null;
  }
  return bin;
}

/* ---- 磁盘上的技能夹具（一个合格 + 三种该被挡在外面的） ---- */
function writeSkills(skillsRoot) {
  fs.mkdirSync(path.join(skillsRoot, "kp10-demo"), { recursive: true });
  fs.writeFileSync(
    path.join(skillsRoot, "kp10-demo", "SKILL.md"),
    [
      "---",
      "name: kp10-demo",
      "description: 只在被点名时生效的对照技能",
      "---",
      "被点名时第一个字写成「叮」，正文标记：" + MARK + "。",
      "",
    ].join("\n"),
  );
  fs.mkdirSync(path.join(skillsRoot, "kp10-hidden"), { recursive: true });
  fs.writeFileSync(
    path.join(skillsRoot, "kp10-hidden", "SKILL.md"),
    [
      "---",
      "name: kp10-hidden",
      "description: 只能由用户点名执行、不进模型的技能",
      "disable_model_invocation: true",
      "---",
      "这条正文不该进模型：" + HIDDEN + "。",
      "",
    ].join("\n"),
  );
  fs.mkdirSync(path.join(skillsRoot, "kp10-toolong"), { recursive: true });
  fs.writeFileSync(
    path.join(skillsRoot, "kp10-toolong", "SKILL.md"),
    [
      "---",
      "name: kp10-toolong",
      "description: " + "长".repeat(1025),
      "---",
      "描述不合格，正文也不该进模型：" + TOOLONG + "。",
      "",
    ].join("\n"),
  );
  fs.mkdirSync(path.join(skillsRoot, "kp10-badname"), { recursive: true });
  fs.writeFileSync(
    path.join(skillsRoot, "kp10-badname", "SKILL.md"),
    [
      "---",
      "name: " + "名".repeat(65),
      "description: 名字不合格",
      "---",
      "名字超过 64 字，正文不该进模型：" + BADNAME + "。",
      "",
    ].join("\n"),
  );
  // 片2 的两条新形状：用户不能点名（但照样自动进模型）、environments 写法不合格。
  fs.mkdirSync(path.join(skillsRoot, "kp10-nouser"), { recursive: true });
  fs.writeFileSync(
    path.join(skillsRoot, "kp10-nouser", "SKILL.md"),
    [
      "---",
      "name: kp10-nouser",
      "description: 只能自动进模型、不许用户点名",
      "disable_user_invocation: true",
      "---",
      "这条不许被点名：" + NOUSER + "。",
      "",
    ].join("\n"),
  );
  fs.mkdirSync(path.join(skillsRoot, "kp10-badenv"), { recursive: true });
  fs.writeFileSync(
    path.join(skillsRoot, "kp10-badenv", "SKILL.md"),
    [
      "---",
      "name: kp10-badenv",
      "description: environments 写成空列表",
      "environments: []",
      "---",
      "写法不合格的 environments，正文不该进模型：" + BADENV + "。",
      "",
    ].join("\n"),
  );
}

/* ---- 反向夹具：hosts/shared 全软链，只把「入口文件 + 被打补丁的那份」落成文件 ----
   入口必须是**真文件**：Node 在加载软链模块时用的是 realpath，于是软链进夹具的
   run_moon_turn.js 会把 __dirname 算成仓库那侧，`require("./host_ffi.js")` 就绕回
   未打补丁的真源 —— 第一版栽在这儿，SK-10 的摘除根本没生效，
   「对照判红」那条断言其实是恒真的。 */
const FARM_ENTRIES = ["run_moon_turn.js", "agent_loop_product_wire.js", "host_ffi.js"];
function sharedFarm(patches) {
  const farm = fs.mkdtempSync(path.join(os.tmpdir(), "kp10-farm-"));
  const shared = path.join(farm, "hosts", "shared");
  fs.mkdirSync(shared, { recursive: true });
  const materialize = new Set([...FARM_ENTRIES, ...Object.keys(patches)]);
  for (const f of fs.readdirSync(path.join(ROOT, "hosts", "shared"))) {
    const src = path.join(ROOT, "hosts", "shared", f);
    if (!fs.statSync(src).isFile()) continue;
    if (materialize.has(f) && patches[f]) continue;
    if (materialize.has(f)) {
      fs.copyFileSync(src, path.join(shared, f));
      continue;
    }
    fs.symlinkSync(src, path.join(shared, f));
  }
  for (const [f, plist] of Object.entries(patches)) {
    let src = fs.readFileSync(path.join(ROOT, "hosts", "shared", f), "utf8");
    for (const p of plist) {
      const next = src.replace(p.from, p.to);
      if (next === src) return null;
      src = next;
    }
    fs.writeFileSync(path.join(shared, f), src);
  }
  return farm;
}

/* 四把反向夹具，每把都摘掉链路上的一步，断言「那一步承重」。
   file 必须是 hosts/shared 下的真文件名 —— 夹具按文件物化，键名写错就等于没打补丁。 */
const CONTROLS = [
  {
    // 摘掉 Host 拼装：技能照样进内核，但请求里一个字都不出现
    label: "SK-10 摘掉 Host 拼装",
    file: "host_ffi.js",
    patches: [
      {
        from: "  function llmSkillBlock(skills) {\n    const rows = Array.isArray(skills) ? skills : [];",
        to: "  function llmSkillBlock(skills) {\n    const rows = []; // 夹具：注入点摘掉",
      },
    ],
    kind: "turn",
    marker: MARK,
  },
  {
    // 摘掉 argv 通道：内核根本收不到技能
    label: "SK-11 摘掉 argv 通道",
    file: "run_moon_turn.js",
    patches: [
      {
        from: "[...ffi.memorySeedArgs(ctx.botId), ...ffi.skillSeedArgs(text)]",
        to: "[...ffi.memorySeedArgs(ctx.botId)]",
      },
    ],
    kind: "turn",
    marker: MARK,
  },
  {
    // 摘掉「点名」那半：用户点名也不起作用，disable_model_invocation 就变成「装了但永远执行不了」
    label: "SK-15 摘掉点名通道",
    file: "host_ffi.js",
    patches: [
      {
        from: "    for (const s of namedSkillSeeds(userText)) push(s);",
        to: "    for (const s of []) push(s); // 夹具：点名通道摘掉",
      },
    ],
    kind: "named",
    marker: HIDDEN,
  },
  {
    // 让界面自己数一遍（片2 之前的形状）：屏幕上那个「进模型的条数」不再和注入同源
    label: "SK-16 界面自己数条数",
    file: "host_ffi.js",
    patches: [
      {
        from: "        model_count: seeds.length,",
        to: "        model_count: inventory.length, // 夹具：界面自己数",
      },
    ],
    kind: "listing",
    marker: "",
  },
  {
    // 让界面那句成品串自己数（片3 之前的形状）：屏上的「进模型」和注入那一步脱钩
    label: "SK-18 界面自己拼那句数",
    file: "host_ffi.js",
    patches: [
      {
        from: "        summary_text: skillSummaryText(invocable.length, seeds.length, modelSkipCount),",
        to: "        summary_text: skillSummaryText(invocable.length, invocable.length, 0), // 夹具：界面自己数",
      },
    ],
    kind: "summary",
    marker: "",
  },
];

function startStub() {
  const stub = spawn(process.execPath, [path.join(ROOT, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BITBOT_STUB_PORT: String(STUB_PORT),
      BITBOT_STUB_ECHO_ALL: "1",
      BITBOT_STUB_ECHO_WIDTH: "40000",
    },
  });
  const up = new Promise((res) => {
    const t = setTimeout(() => res(false), 10000);
    stub.stdout.on("data", (d) => {
      if (String(d).includes("[stub-llm]")) {
        clearTimeout(t);
        res(true);
      }
    });
    stub.on("error", () => {
      clearTimeout(t);
      res(false);
    });
  });
  return { stub, up };
}

async function main() {
  const BIN = resolveKernelBin();
  if (!BIN) {
    console.log("prove_skill_reaches_model: 中止（内核二进制不可用）");
    process.exitCode = 1;
    return;
  }
  ok("SK-00 内核二进制", BIN);

  // 隔离数据根：dataRoot=<tmp>/data/desktop ⇒ agent-tools=<tmp>/data/agent-tools（兄弟目录）
  const ROOTDIR = fs.mkdtempSync(path.join(os.tmpdir(), "kp10-"));
  const DATA = path.join(ROOTDIR, "data", "desktop");
  const SKILLS = path.join(ROOTDIR, "data", "agent-tools", "skills");
  fs.mkdirSync(DATA, { recursive: true });
  writeSkills(SKILLS);
  ok("SK-01 技能夹具", SKILLS + "（2 条自动进模型 + 4 条各有毛病）");

  const { stub, up } = startStub();
  if (!(await up)) {
    bad("SK-02 stub", "openai_compat_stub.js 未在 10s 内就绪");
    console.log("prove_skill_reaches_model: 中止");
    process.exitCode = 1;
    return;
  }
  Object.assign(process.env, {
    // GP-201 的教训：不钉 provider 就会被 data/llm/active.json 里的 qwen
    // scoped env 绕开 stub —— 钉 deepseek（它读的就是全局那组变量）。
    BITBOT_NO_SECRET_SYNC: "1",
    BITBOT_LLM_PROVIDER: "deepseek",
    BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
    BITBOT_LLM_API_KEY: "kp10-probe-key",
    BITBOT_LLM_MODEL: "kp10-probe",
    BITBOT_LLM_STREAM: "0",
  });

  const { createTurnRunner } = require(path.join(ROOT, "hosts/shared/run_moon_turn.js"));

  /** 跑一个真回合，返回「喂给 provider 的整条 message 栈」（stub 逐字回显）。 */
  async function probe(runner, sessionId, text) {
    const r = await runner.runTurn(text || SKILL_TEXT, {
      botId: "kp10-bot",
      sessionId,
      turnId: "kp10-" + sessionId,
      machineId: "kp10-machine",
      machineKind: "desktop",
      timeoutMs: 90000,
    });
    const joined = (r.messages || []).map((m) => String(m.text || "")).join(" ");
    return { r, echoed: JSON.stringify(joined) };
  }

  const runner = createTurnRunner(ROOT, { dataRoot: DATA, kernelBin: BIN });

  /** 走界面那一路（Host 的 list_skills effect），拿回它落盘的那份 artifact。 */
  async function listSkillsVia(ffi) {
    const res = await ffi.executeHostEffects([{ kind: "list_skills", command: "q=" }]);
    const hit = (res || []).find((r) => r && r.kind === "list_skills");
    try {
      return JSON.parse((hit && hit.stdout) || "{}");
    } catch (_) {
      return {};
    }
  }

  /* ---- SK-03：Host 读盘那侧的校验与过滤（不靠模型，纯函数判） ---- */
  const seeds = runner.ffi.collectSkillSeeds();
  const seedNames = (Array.isArray(seeds) ? seeds : []).map((s) => s && s.name).sort();
  JSON.stringify(seedNames) === JSON.stringify(["kp10-demo", "kp10-nouser"])
    ? ok("SK-03 collectSkillSeeds", "只收进 2 条：" + JSON.stringify(seedNames) + "（关掉/超限/写法不合格的 4 条被挡在外面）")
    : bad("SK-03 collectSkillSeeds", "期望 kp10-demo + kp10-nouser，实测 " + JSON.stringify(seedNames));

  /* ---- SK-04：正文真进 provider 请求体（内核收到 + 内核交回 + Host 拼进 system） ---- */
  {
    const { r, echoed } = await probe(runner, "sess-kp10-" + RUN);
    r && r.ok === true
      ? ok("SK-04 回合", "内核回合 ok=true，intent=" + r.intent + "，agent_loop=" + r.agent_loop)
      : bad("SK-04 回合", JSON.stringify(r && { ok: r.ok, error: r.error, agent_stop: r.agent_stop }).slice(0, 300));
    echoed.includes(MARK)
      ? ok("SK-05 SKILL.md 正文进 provider 请求体", "回显含 " + MARK + "（不是我们自己的日志，是 HTTP 里的那条 system）")
      : bad("SK-05 SKILL.md 正文进 provider 请求体", "回显里没有正文标记：" + echoed.slice(0, 300));
    echoed.includes("【技能 · kp10-demo")
      ? ok("SK-06 技能块形状", "system 里有「【技能 · kp10-demo」，且标了这是数据不是指令")
      : bad("SK-06 技能块形状", echoed.slice(0, 300));

    /* ---- SK-07：该被挡在外面的（关掉 / 超限 / 写法不合格）一条都不许出现 ---- */
    const leaked = [HIDDEN, TOOLONG, BADNAME, BADENV].filter((m) => echoed.includes(m));
    leaked.length === 0
      ? ok("SK-07 过滤", "disable_model_invocation / description>1024 / name>64 / environments 空列表的正文都不在请求里")
      : bad("SK-07 过滤", "泄漏：" + leaked.join(","));

    /* ---- SK-12：disable_user_invocation 只挡「用户点名」，不挡自动进模型 ---- */
    echoed.includes(NOUSER) && echoed.includes("【技能 · kp10-nouser")
      ? ok("SK-12 不许点名 ≠ 不许进模型", "kp10-nouser 的正文自动进了请求体")
      : bad("SK-12 不许点名 ≠ 不许进模型", echoed.slice(0, 300));

    /* ---- SK-08：flag 字节不许混进用户原文 ---- */
    const userRow = (r.messages || []).find((m) => m.role === "user");
    const pure = userRow && String(userRow.text).trim() === SKILL_TEXT;
    pure && !echoed.includes("--seed-skill")
      ? ok("SK-08 用户原文未被污染", "内核交回的 user 行逐字是「" + SKILL_TEXT + "」")
      : bad("SK-08 用户原文未被污染", JSON.stringify(userRow && userRow.text).slice(0, 240));
  }

  /* ---- SK-09：磁盘上没有技能 —— 回合照常成功，屏幕上不出现技能块 ---- */
  {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "kp10-empty-"));
    const emptyData = path.join(emptyDir, "data", "desktop");
    fs.mkdirSync(emptyData, { recursive: true });
    const emptyRunner = createTurnRunner(ROOT, { dataRoot: emptyData, kernelBin: BIN });
    const { r, echoed } = await probe(emptyRunner, "sess-kp10-empty-" + RUN);
    r && r.ok === true && !echoed.includes("【技能")
      ? ok("SK-09 无技能时", "回合 ok=true 且 system 里没有技能块（没有技能 ≠ 失败，也没有空壳技能块）")
      : bad("SK-09 无技能时", JSON.stringify({ ok: r && r.ok, error: r && r.error, has: echoed.includes("【技能") }).slice(0, 260));
  }

  /* ---- SK-13：用户点名 —— disable_model_invocation 的那条也随这一回合进模型 ---- */
  {
    const { echoed } = await probe(runner, "sess-kp10-named-" + RUN, NAME_HIDDEN_TEXT);
    echoed.includes(HIDDEN) && echoed.includes("【技能 · kp10-hidden")
      ? ok("SK-13 点名做一次", "点名「kp10-hidden」后它的正文进了请求体（可感面：对话里点名让它做一次）")
      : bad("SK-13 点名做一次", "点名后请求体里没有它的正文：" + echoed.slice(0, 300));
  }

  /* ---- SK-14：界面那份清单和注入用的是同一次分类（同屏两个数不许互相矛盾） ---- */
  {
    const payload = await listSkillsVia(runner.ffi);
    const row = (n) => (payload.skills || []).concat(payload.uninvocable || []).find((s) => s.name === n) || {};
    const want = {
      "kp10-demo": { model_ok: true, model_skip: "" },
      "kp10-hidden": { model_skip: "disable_model_invocation" },
      "kp10-toolong": { model_skip: "description" },
      "kp10-badname": { model_skip: "name" },
      "kp10-badenv": { model_skip: "environments" },
    };
    const wrong = [];
    for (const [n, exp] of Object.entries(want)) {
      const r = row(n);
      if (exp.model_ok !== undefined && r.model_ok !== exp.model_ok) wrong.push(n + ".model_ok=" + r.model_ok);
      if (r.model_skip !== exp.model_skip) wrong.push(n + ".model_skip=" + r.model_skip);
    }
    if (payload.model_count !== seeds.length) wrong.push("model_count=" + payload.model_count);
    if (JSON.stringify((payload.model_names || []).slice().sort()) !== JSON.stringify(seedNames))
      wrong.push("model_names=" + JSON.stringify(payload.model_names));
    if ((payload.skills || []).some((s) => s.name === "kp10-nouser")) wrong.push("kp10-nouser 仍可点名");
    if (!(payload.uninvocable || []).some((s) => s.name === "kp10-nouser" && s.reason === "disable_user_invocation"))
      wrong.push("kp10-nouser 没进 uninvocable");
    if (payload.count !== payload.invocable_count) wrong.push("count=" + payload.count + " invocable_count=" + payload.invocable_count);
    wrong.length === 0
      ? ok("SK-14 清单与注入同源", "界面上的 model_count/model_names 就是注入那一步的数（" + seeds.length + " 条），每条技能的 model_skip 与原因同源")
      : bad("SK-14 清单与注入同源", wrong.join(" / ") + " " + JSON.stringify({ count: payload.count, model_count: payload.model_count }).slice(0, 200));
  }

  /* ---- SK-17：屏上那句「可点名 / 本回合进模型」是 Host 一次拼好的成品串 ---- */
  {
    const payload = await listSkillsVia(runner.ffi);
    const skip = runner.ffi.skillInventory().filter((s) => s.model_ok === false).length;
    const m = /^可点名 (\d+) · 本回合进模型 (\d+)(?: · 另 (\d+) 条进不了模型)?$/.exec(
      String(payload.summary_text || ""),
    );
    const wrong = [];
    if (!m) wrong.push("summary_text=" + JSON.stringify(payload.summary_text));
    else {
      if (Number(m[1]) !== payload.invocable_count)
        wrong.push("可点名 " + m[1] + " != invocable_count " + payload.invocable_count);
      if (Number(m[2]) !== payload.model_count)
        wrong.push("进模型 " + m[2] + " != model_count " + payload.model_count);
      const tail = m[3] === undefined ? 0 : Number(m[3]);
      if (tail !== skip) wrong.push("另 " + tail + " != 分类器里 model_ok=false 的 " + skip);
    }
    wrong.length === 0
      ? ok("SK-17 屏上那句数同源", payload.summary_text + "（三个数分别取自 invocable_count / model_count / skillInventory）")
      : bad("SK-17 屏上那句数同源", wrong.join(" / "));
  }

  /* ---- SK-10 / SK-11 / SK-15 / SK-16：反向夹具必须判红（否则这条门是恒真的） ---- */
  for (const ctl of CONTROLS) {
    const farm = sharedFarm({ [ctl.file]: ctl.patches });
    if (!farm) {
      bad(ctl.label, "夹具建不出来（锚点没命中）——这条门的对照失效");
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kp10-ctl-"));
    const data = path.join(dir, "data", "desktop");
    fs.mkdirSync(data, { recursive: true });
    fs.cpSync(SKILLS, path.join(dir, "data", "agent-tools", "skills"), { recursive: true });
    const { createTurnRunner: makeFromFarm } = require(path.join(farm, "hosts", "shared", "run_moon_turn.js"));
    const control = makeFromFarm(ROOT, { dataRoot: data, kernelBin: BIN });
    if (ctl.kind === "listing") {
      const p = await listSkillsVia(control.ffi);
      const injected = control.ffi.collectSkillSeeds().length;
      p.model_count !== injected
        ? ok(ctl.label, "界面上的 model_count（" + p.model_count + "）与注入条数（" + injected + "）分家 ⇒ SK-14 那条是承重的")
        : bad(ctl.label, "界面自己数之后仍与注入相等 ⇒ SK-14 是恒真断言，不能当门");
      continue;
    }
    if (ctl.kind === "summary") {
      const p = await listSkillsVia(control.ffi);
      const injected = control.ffi.collectSkillSeeds().length;
      const m = /本回合进模型 (\d+)/.exec(String(p.summary_text || ""));
      m && Number(m[1]) !== injected
        ? ok(ctl.label, "那句「本回合进模型 " + m[1] + "」与注入条数（" + injected + "）分家 ⇒ SK-17 那条是承重的")
        : bad(ctl.label, "把那句改成界面自己数后仍与注入相等 ⇒ SK-17 是恒真断言，不能当门");
      continue;
    }
    const { echoed } = await probe(
      control,
      "sess-kp10-ctl-" + ctl.file + "-" + RUN + "-" + pass,
      ctl.kind === "named" ? NAME_HIDDEN_TEXT : SKILL_TEXT,
    );
    !echoed.includes(ctl.marker)
      ? ok(ctl.label, "请求体里「" + ctl.marker + "」消失（判红 1 条）——" + ctl.file + " 那一步是承重的")
      : bad(ctl.label, "摘掉那一步请求体里仍有标记 ⇒ 这条断言是恒真的，不能当门");
  }

  stub.kill("SIGTERM");
  console.log("");
  console.log("prove_skill_reaches_model: PASS=" + pass + " FAIL=" + fail);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("prove_skill_reaches_model crashed:", err);
  process.exitCode = 1;
});
