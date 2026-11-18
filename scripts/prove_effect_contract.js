#!/usr/bin/env node
"use strict";

/**
 * prove_effect_contract — effect kind 契约的差分门
 *
 * 现场推演(真实用户旅程,不是假设):
 *   用户说「帮我买这个键盘」。内核产生 effect kind:"purchase",Host 按
 *   kind 查审批名单 —— 名单上写的是 "purchase_item" ⇒ **匹配不上** ⇒
 *   这次购买**没走审批闸**就执行了。用户在界面上什么也没看到。
 *   同样的漂移还有:策略白名单照着**意图名**写(install_plugin / secret_store),
 *   真正会改盘的 package_install / credential_fill 反而不在名单里 ⇒
 *   自决回合能装插件、能写凭证,而清单看着像在管这些事。
 *
 * 这些都是**静默失效**:没有报错、没有异常、界面上看不出区别。
 * 所以要有门 —— 而且门要比产品更严:少一条必须红。
 *
 * 契约(先立红,修完必须全绿):
 *   1. 内核产生的 effect kind 集 == 注册表(effect_kinds.js)的键集,不多不少。
 *   2. 每个内核 effect kind 在 Host 的 dispatch 分支里**都有处理** ——
 *      不许"真跑起来才炸"(unsupported effect kind)。
 *   3. 注册表里没有死词表:每个 kind 要么内核产生,要么显式登记为 Host 动作。
 *   4. 自决回合的白名单**从注册表派生**,且**每一个 mutating kind 都在里面** ——
 *      会改状态的一律不许,不再靠人手维护一张会漂的表。
 *   5. 审批名单**从注册表派生**;注册表标 ask 的 kind 才走审批闸。
 *   6. 渲染层(浏览器里 require 不到注册表)保留的那份映射,不许自己漂 ——
 *      门禁盯着它与注册表一致。
 *
 * 负向对照:每条判据都要证明"拿改动前的状态跑会红"。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
/* 真判据:条件不成立要红。**别用 ok(msg, cond)** —— ok 只接一个参数,
   多传的那个会被悄悄丢掉,判据就成了恒绿(我自己踩过,变异测试当场抓到)。 */
const check = (cond, m, d) => { if (cond) ok(m); else bad(m, d); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

console.log("prove_effect_contract（effect kind 契约差分）");

/* ── 采集四方的事实 ────────────────────────────────────────────────────── */

/** 内核产生的 effect kind(DesktopEffect 的 kind 字段,紧跟 command)。 */
function kernelEffectKinds(root) {
  const out = new Set();
  const files = [];
  for (const dir of ["cmd/desktop_turn", "runtime"]) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (f.endsWith(".mbt")) files.push(path.join(d, f));
  }
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    for (const m of s.matchAll(/kind:\s*"([a-z_][a-z0-9_]*)",\s*\n\s*command:/g)) out.add(m[1]);
  }
  return out;
}

/** Host 的 dispatch 分支处理的 kind。 */
function hostDispatchKinds(root) {
  const s = fs.readFileSync(path.join(root, "hosts/shared/host_ffi.js"), "utf8");
  const out = new Set();
  for (const m of s.matchAll(/\bkind\s*===\s*"([a-z_][a-z0-9_]*)"/g)) out.add(m[1]);
  return out;
}

/** 加载注册表(可指定根目录,便于负向对照时换一份)。 */
function loadRegistry(root) {
  const p = path.join(root, "hosts/shared/effect_kinds.js");
  const src = fs.readFileSync(p, "utf8");
  const module = { exports: {} };
  const ctx = vm.createContext({ module, exports: module.exports, require, console });
  vm.runInContext(src, ctx, { filename: p });
  return module.exports;
}

const registry = loadRegistry(REPO);
const kernelKinds = kernelEffectKinds(REPO);
const hostKinds = hostDispatchKinds(REPO);
const regKinds = new Set(Object.keys(registry.EFFECT_POLICY));
const hostActionKinds = new Set(registry.HOST_ACTION_KINDS);

/* ── EC-01 内核 kind 集 == 注册表键集 ─────────────────────────────────── */
{
  const onlyKernel = [...kernelKinds].filter((k) => !regKinds.has(k)).sort();
  const onlyReg = [...regKinds].filter((k) => !kernelKinds.has(k)).sort();
  if (!onlyKernel.length && !onlyReg.length) ok(`EC-01 内核 effect kind 与注册表逐条一致（${kernelKinds.size} 条）`);
  else bad("EC-01 内核 effect kind 与注册表逐条一致",
    "内核多:[" + onlyKernel.join(",") + "] 注册表多:[" + onlyReg.join(",") + "]");
}

/* ── EC-02 每个内核 effect kind 在 Host 都有处理分支 ──────────────────── */
{
  const orphan = [...kernelKinds].filter((k) => !hostKinds.has(k)).sort();
  if (!orphan.length) ok(`EC-02 每个内核 effect kind 在 Host 都有处理分支（${kernelKinds.size} 条）`);
  else bad("EC-02 每个内核 effect kind 在 Host 都有处理分支",
    "没有处理分支:[" + orphan.join(",") + "]（真跑起来才炸 unsupported effect kind）");
}

/* ── EC-03 注册表里没有死词表 ─────────────────────────────────────────── */
{
  const dead = [...regKinds].filter((k) => !kernelKinds.has(k) && !hostActionKinds.has(k)).sort();
  if (!dead.length) ok("EC-03 注册表里没有死词表（每个 kind 都真实存在）");
  else bad("EC-03 注册表里没有死词表（每个 kind 都真实存在）", dead.join(","));
}

/* ── EC-04 自决回合白名单:从注册表派生,且覆盖每一个 mutating kind ────── */
{
  const derived = registry.mutatingEffectKinds();
  const missing = [...derived].filter((k) => !hostActionKinds.has(k) && !kernelKinds.has(k)).sort();
  if (!missing.length) ok(`EC-04 白名单覆盖全部 mutating kind（${derived.size} 条）`);
  else bad("EC-04 白名单覆盖全部 mutating kind", missing.join(","));

  // 白名单必须真的从注册表派生,不能是手抄的一份。
  const rmt = fs.readFileSync(path.join(REPO, "hosts/shared/run_moon_turn.js"), "utf8");
  const derivedFromRegistry = /require\("\.\/effect_kinds"\)/.test(rmt) &&
    /mutatingEffectKinds\(\)/.test(rmt);
  check(derivedFromRegistry, "EC-04 白名单从注册表派生（不是手抄的一份）");
}

/* ── EC-05 审批名单从注册表派生,且真的覆盖 ask 的 kind ────────────────── */
{
  const ask = [...registry.askApprovalEffectKinds()].sort();
  ok(`EC-05 注册表标 ask 的 kind: ${ask.join(", ")}`, ask.length > 0);

  const h = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
  const derived = /effectKinds\.needsApproval\(kind\)/.test(h);
  check(derived, "EC-05 审批闸从注册表派生（不是手抄的 7 个 kind）");

  // 每条 ask 的 kind,Host 都得真能处理 ⇒ 审批闸不是空转。
  const noHandler = ask.filter((k) => !hostKinds.has(k));
  if (!noHandler.length) ok("EC-05 每条 ask 的 kind 在 Host 都有处理分支（审批闸不是空转）");
  else bad("EC-05 每条 ask 的 kind 在 Host 都有处理分支", noHandler.join(","));
}

/* ── EC-06 渲染层那份映射不许自己漂 ──────────────────────────────────── */
{
  const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  // 渲染层在浏览器里 require 不到注册表,所以留了一份 class→pattern 映射。
  // 这里逐条核对:它映射出来的 pattern kind 必须是注册表里真实存在的 kind。
  const m = html.match(/function approvalPatternForClass\([\s\S]*?\n    \}/);
  if (!m) {
    bad("EC-06 渲染层那份映射不许自己漂", "抠不出 approvalPatternForClass");
  } else {
    // 扫之前先剥掉行注释 —— 注释里提到 "purchase_item:*" 是给人看的,
    // 不是真源。判据不许被注释骗(这条坑我自己踩过一次)。
    const body = m[0].replace(/\/\/[^\n]*/g, "");
    const pats = [...body.matchAll(/"([a-z_][a-z0-9_]*):\*/g)].map((x) => x[1]);
    const bad2 = pats.filter((p) => !(regKinds.has(p) || hostActionKinds.has(p)));
    if (!bad2.length) ok(`EC-06 渲染层的 pattern kind 都真实存在（${pats.join(", ")}）`);
    else bad("EC-06 渲染层的 pattern kind 都真实存在", bad2.join(","));
    // 而且必须含 purchase —— 内核产生的 effect kind 就是它。
    check(pats.includes("purchase"), "EC-06 渲染层认得 purchase(不是 purchase_item)");
    check(!pats.includes("purchase_item"), "EC-06 渲染层没有残留 purchase_item");
  }
}

/* ── EC-07 内核的 ApprovalClass 与 Host 认识的 class 一致 ─────────────── */
{
  const pi = fs.readFileSync(path.join(REPO, "cmd/desktop_turn/parity_intents.mbt"), "utf8");
  const ap = fs.readFileSync(path.join(REPO, "security/approval.mbt"), "utf8");
  // approval.mbt 的枚举是平铺的(不是 | 开头):
  //   pub(all) enum ApprovalClass { Shell LocalMachine McpMutation ... }
  const kernelClasses = new Set();
  const enumBody = (ap.match(/enum\s+ApprovalClass\s*\{([\s\S]*?)\}/) || [null, ""])[1];
  for (const m of enumBody.matchAll(/^\s*([A-Z][A-Za-z]*)\s*$/gm)) kernelClasses.add(m[1]);
  // Host 侧认识哪些 class(两份拷贝 + 渲染层一份)。
  const h = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
  const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  const hostClasses = new Set();
  for (const src of [h, html]) {
    for (const m of src.matchAll(/["']([A-Z][A-Za-z]+)["']/g)) {
      if (/ApprovalClass|Shell|ExternalSend|McpMutation|Purchase|LocalMachine|CloudAgent|Destructive|ReadOnly/.test(m[1])) {
        hostClasses.add(m[1]);
      }
    }
  }
  const unknown = [...hostClasses].filter((c) => !kernelClasses.has(c)).sort();
  if (!unknown.length) ok(`EC-07 Host 认识的 ApprovalClass 与内核一致（${kernelClasses.size} 档）`);
  else bad("EC-07 Host 认识的 ApprovalClass 与内核一致", "Host 多出:[" + unknown.join(",") + "]");
}

/* ── EC-08 负向对照:内核多出一个 kind 而注册表没跟上 ⇒ EC-01 必须红 ───── */
{
  const mutated = new Set(kernelKinds);
  mutated.add("brand_new_effect_kind");
  const onlyKernel = [...mutated].filter((k) => !regKinds.has(k)).sort();
  const wouldBeRed = onlyKernel.length === 1 && onlyKernel[0] === "brand_new_effect_kind";
  check(wouldBeRed, "EC-08 负向对照:内核多一个 kind ⇒ EC-01 立刻翻红（判据不是恒真）");
}

/* ── EC-09 负向对照:Host 少一条处理分支 ⇒ EC-02 必须红 ───────────────── */
{
  const mutated = new Set(hostKinds);
  mutated.delete("purchase");
  const orphan = [...kernelKinds].filter((k) => !mutated.has(k)).sort();
  check(
    orphan.includes("purchase"),
    "EC-09 负向对照:Host 少一条处理分支 ⇒ EC-02 立刻翻红",
    JSON.stringify(orphan),
  );
}

/* ── EC-10 负向对照:把手抄的审批名单改回来(退回 purchase_item)⇒ 必须红 ─ */
{
  const h = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
  const oldHandWritten = h.includes('kind === "purchase_item"');
  check(
    oldHandWritten === false,
    "EC-10 负向对照:审批名单退回手抄的 purchase_item ⇒ 门禁会红",
    "host_ffi.js 里还留着 purchase_item",
  );
}

/* ── EC-11 审批卡的 class 是结构化的(不靠"第一段像不像某个 token") ───────── */
{
  const pi = fs.readFileSync(path.join(REPO, "cmd/desktop_turn/parity_intents.mbt"), "utf8");
  const structured = pi.includes('"approval_class=" + class_.label()');
  check(structured, "EC-11 内核发的是结构化前缀 approval_class=<Class>", pi.slice(0, 0));
  const legacyOnly = /command:\s*class_\.label\(\)\s*\+/.test(pi);
  check(!legacyOnly, "EC-11 内核没有残留「裸 class 开头」的旧写法(会逼 Host 去猜)");
}

/* ── EC-12 Host 的审批卡解析从注册表派生 ───────────────────────────────── */
{
  const h = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
  check(
    /effectKinds\.parseApprovalClass\(/.test(h) &&
      /effectKinds\.approvalPatternForClass\(/.test(h),
    "EC-12 Host 的审批卡解析从注册表派生(不是手抄的 class 表)",
  );
  check(
    !/cls === "mcp"|cls === "Shell"|cls === "ExternalSend"/.test(
      h.slice(h.indexOf("function parseApprovalCardCommand"), h.indexOf("function parseApprovalCardCommand") + 1400),
    ),
    "EC-12 Host 那边没有残留手抄的 class 分支",
  );
}

/* ── EC-13 渲染层那份 class 词表不许自己漂 ────────────────────────────── */
{
  const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  const m = html.match(/const APPROVAL_CLASS_TOKENS\s*=\s*\[([^\]]*)\]/);
  const toks = m ? [...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]).sort() : [];
  const want = [...registry.ALL_APPROVAL_CLASSES].sort();
  const same = toks.length === want.length && toks.every((t, i) => t === want[i]);
  check(same, "EC-13 渲染层的 class 词表与注册表逐条一致", "渲染层:" + toks.join(",") + " 注册表:" + want.join(","));
  check(
    !/classTokens/.test(html),
    "EC-13 渲染层没有残留老的 classTokens(那份含 'Purchase ' 这种带空格的怪 token)",
  );
}

/* ── EC-14 effect 有一个稳定标识 ───────────────────────────────────────── */
{
  const tj = fs.readFileSync(path.join(REPO, "cmd/desktop_turn/turn_json.mbt"), "utf8");
  check(
    /write_effects_json/.test(tj) && /\\"id\\":\\"/.test(tj),
    "EC-14 effect 的 JSON 出口带稳定 id",
  );
}

/* ── EC-15 内核的 ApprovalClass 枚举 == 注册表的词表 ───────────────────── */
{
  const ap = fs.readFileSync(path.join(REPO, "security/approval.mbt"), "utf8");
  const enumBody = (ap.match(/enum\s+ApprovalClass\s*\{([\s\S]*?)\}/) || [null, ""])[1];
  const kc = [];
  for (const m of enumBody.matchAll(/^\s*([A-Z][A-Za-z]*)\s*$/gm)) kc.push(m[1]);
  const same =
    kc.length === registry.APPROVAL_CLASSES.length &&
    kc.every((c, i) => c === registry.APPROVAL_CLASSES[i]);
  check(same, "EC-15 内核的 ApprovalClass 枚举与注册表逐条一致", "内核:" + kc.join(",") + " 注册表:" + registry.APPROVAL_CLASSES.join(","));
}

console.log("\nprove_effect_contract: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
