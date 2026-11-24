#!/usr/bin/env node
"use strict";
/**
 * prove_llm_provider_catalog.js — PC-01..PC-12 模型供应商目录（批次 6）
 *
 * 起点是**两件真事**：
 *
 *   1. MiniMax 要能被选上。内置目录里加 minimax（base=https://api.minimax.chat/v1，
 *      model=MiniMax-M3.1-Flash），但 `providers.json` 是**用户数据**——第一次启动
 *      落盘之后用户改过它 ⇒ 只在「文件不存在」时才写种子的老写法 ⇒ 新加的
 *      provider **老用户永远看不到**，界面里根本没有 MiniMax ⇒ 用户以为「不支持」。
 *      ⇒ 修法：内置目录**保证在场**（用户自己的同名条目优先）。
 *
 *   2. 换 provider 时请求不能发去别的厂商。active.json 里存着「用户上次选中的
 *      那个 provider 的 base_url/model」。老写法不看 provider_id 就直接用 ⇒
 *      用户上次选 deepseek、这次用环境变量切到 minimax，请求却发到了
 *      **deepseek 的端点**（还拿着 minimax 的 key）⇒ 401/404，或者更糟：请求
 *      发给了别的厂商。⇒ 修法：provider 对不上时 active 的 base_url/model 一律不算数。
 *
 * 这一门钉四件事：
 *   A. 内置 provider 在场（MiniMax 在目录里，且老用户的 providers.json 也会补齐）；
 *   B. active 配置**不跨 provider 串台**（对得上才生效，对不上就各用各的）；
 *   C. `switch model <id>` 是自由字符串（目录里有即可切，内核不校验 provider id）；
 *   D. 负向对照（变异）：把「内置合并」短路掉、或把「active 串台」放回去，
 *      对应断言**必须翻红** —— 否则门自己就是恒真的。
 *
 * 跑法：node scripts/prove_llm_provider_catalog.js
 * 隔离：所有写盘都在 tmp 目录（BITBOT_DATA_ROOT / opts.dataRoot）⇒ 用户真数据一个字节不动。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const { createHostFfi } = require(path.join(REPO, "hosts/shared/host_ffi.js"));

let PASS = 0;
let FAIL = 0;
const ok = (id, m) => { PASS++; console.log("  ✓ [" + id + "] " + m); };
const bad = (id, m) => { FAIL++; console.log("  ✗ [" + id + "] " + m); };

/* ---------- 隔离根 ---------- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-pc-"));
const USER_DATA = path.join(REPO, "data");

function fingerprint(root) {
  const out = {};
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(abs, r);
      else {
        try {
          const st = fs.statSync(abs);
          out[r] = st.size + ":" + st.mtimeMs;
        } catch (_) { /* ignore */ }
      }
    }
  };
  walk(root, "");
  return out;
}
const FP_BEFORE = fingerprint(USER_DATA);

function writeProviders(dir, providers, defaultProvider) {
  fs.mkdirSync(path.join(dir, "llm"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "llm", "providers.json"),
    JSON.stringify({ version: 1, default_provider: defaultProvider || "deepseek", providers }, null, 2),
  );
}
function writeActive(dir, obj) {
  fs.mkdirSync(path.join(dir, "llm"), { recursive: true });
  fs.writeFileSync(path.join(dir, "llm", "active.json"), JSON.stringify(obj, null, 2));
}

/* ---------- A. 内置 provider 在场 ---------- */
{
  const dir = path.join(TMP, "a-empty");
  fs.mkdirSync(dir, { recursive: true });
  const ffi = createHostFfi(REPO, { dataRoot: dir });
  const cat = ffi.listLlmCatalog();
  const mm = (cat.providers || []).find((p) => p.id === "minimax");
  if (!mm) {
    bad("PC-01", "内置目录里没有 minimax ⇒ 用户在界面里根本选不到 MiniMax");
  } else {
    ok("PC-01", "内置目录里有 MiniMax：" + mm.label + "（base=" + mm.base_url + " model=" + mm.model + "）");
    if (mm.base_url !== "https://api.minimax.chat/v1") {
      bad("PC-01b", "MiniMax 的 base_url 不对：" + mm.base_url + "（国内端是 api.minimax.chat；api.minimaxi.chat 是国际端，密钥不通用）");
    } else {
      ok("PC-01b", "MiniMax base_url 是国内端 api.minimax.chat/v1");
    }
    if (!/MiniMax-M3/.test(mm.model || "")) {
      bad("PC-01c", "MiniMax 默认模型不对：" + mm.model);
    } else {
      ok("PC-01c", "MiniMax 默认模型是可用的 MiniMax-M3 系列：" + mm.model);
    }
    if (mm.key_env !== "BITBOT_LLM_MINIMAX_API_KEY") {
      bad("PC-01d", "MiniMax 的密钥环境变量名不对：" + mm.key_env);
    } else {
      ok("PC-01d", "MiniMax 密钥走 BITBOT_LLM_MINIMAX_API_KEY（不串到全局那组）");
    }
  }
}

/* 老用户的 providers.json（只有 deepseek）⇒ 合并后 minimax 仍在 */
{
  const dir = path.join(TMP, "a-legacy");
  fs.mkdirSync(dir, { recursive: true });
  writeProviders(dir, [{ id: "deepseek", label: "DeepSeek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", env_key: "BITBOT_LLM_API_KEY" }], "deepseek");
  const ffi = createHostFfi(REPO, { dataRoot: dir });
  const cat = ffi.listLlmCatalog();
  const ids = (cat.providers || []).map((p) => p.id);
  if (ids.includes("minimax")) {
    ok("PC-02", "老用户的 providers.json（只有 deepseek）合并后 minimax 也在场 ⇒ 老用户也看得到 MiniMax");
  } else {
    bad("PC-02", "老用户的 providers.json 合并后 minimax 不在场 ⇒ 新加的 provider 老用户看不到（" + ids.join(",") + "）");
  }
  const ds = (cat.providers || []).find((p) => p.id === "deepseek");
  if (ds && ds.label === "DeepSeek") {
    ok("PC-02b", "用户自己的条目没被内置目录覆盖（同名条目用户优先）");
  } else {
    bad("PC-02b", "合并把用户自己的条目覆盖了：" + JSON.stringify(ds));
  }
}

/* 用户自己改过的同名条目 ⇒ 以用户的为准 */
{
  const dir = path.join(TMP, "a-user-wins");
  fs.mkdirSync(dir, { recursive: true });
  writeProviders(dir, [{ id: "minimax", label: "我的 MiniMax", base_url: "https://my.proxy/v1", model: "my-model", env_key: "MY_MINIMAX_KEY" }], "minimax");
  const ffi = createHostFfi(REPO, { dataRoot: dir });
  const cat = ffi.listLlmCatalog();
  const mm = (cat.providers || []).find((p) => p.id === "minimax");
  if (mm && mm.base_url === "https://my.proxy/v1" && mm.key_env === "MY_MINIMAX_KEY") {
    ok("PC-03", "用户改过的同名 provider 以用户的为准（没被内置目录盖掉）");
  } else {
    bad("PC-03", "用户改过的同名 provider 被内置目录盖掉了：" + JSON.stringify(mm));
  }
}

/* ---------- B. active 不跨 provider 串台 ---------- */
{
  const dir = path.join(TMP, "b-cross");
  fs.mkdirSync(dir, { recursive: true });
  /* 用户上次选的是 deepseek（active.base_url = deepseek 的端点） */
  writeActive(dir, { provider_id: "deepseek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", api_key: "dk" });

  const prevProvider = process.env.BITBOT_LLM_PROVIDER;
  const prevBase = process.env.BITBOT_LLM_BASE_URL;
  const prevModel = process.env.BITBOT_LLM_MODEL;
  const prevKey = process.env.BITBOT_LLM_API_KEY;
  delete process.env.BITBOT_LLM_BASE_URL;
  delete process.env.BITBOT_LLM_MODEL;
  delete process.env.BITBOT_LLM_API_KEY;
  process.env.BITBOT_LLM_PROVIDER = "minimax";
  try {
    const ffi = createHostFfi(REPO, { dataRoot: dir });
    const cfg = ffi.resolveLlmConfig();
    if (cfg.provider_id === "minimax" && cfg.base_url === "https://api.minimax.chat/v1" && /MiniMax/.test(cfg.model)) {
      ok("PC-04", "切到 minimax 时没有串台到 deepseek 的端点（base=" + cfg.base_url + " model=" + cfg.model + "）");
    } else {
      bad("PC-04", "切到 minimax 时 active 的 deepseek 配置串台了：" + JSON.stringify({ p: cfg.provider_id, b: cfg.base_url, m: cfg.model }));
    }
  } finally {
    if (prevProvider === undefined) delete process.env.BITBOT_LLM_PROVIDER; else process.env.BITBOT_LLM_PROVIDER = prevProvider;
    if (prevBase === undefined) delete process.env.BITBOT_LLM_BASE_URL; else process.env.BITBOT_LLM_BASE_URL = prevBase;
    if (prevModel === undefined) delete process.env.BITBOT_LLM_MODEL; else process.env.BITBOT_LLM_MODEL = prevModel;
    if (prevKey === undefined) delete process.env.BITBOT_LLM_API_KEY; else process.env.BITBOT_LLM_API_KEY = prevKey;
  }
}
{
  /* provider 对得上 ⇒ active 的 base_url/model 生效（用户在界面里选的就是它） */
  const dir = path.join(TMP, "b-same");
  fs.mkdirSync(dir, { recursive: true });
  writeActive(dir, { provider_id: "minimax", base_url: "https://my.proxy/v1", model: "picked-model", api_key: "mk" });
  const ffi = createHostFfi(REPO, { dataRoot: dir });
  const cfg = ffi.resolveLlmConfig();
  if (cfg.provider_id === "minimax" && cfg.base_url === "https://my.proxy/v1" && cfg.model === "picked-model") {
    ok("PC-05", "provider 对得上时 active 的 base_url/model 生效（用户选的还是它）");
  } else {
    bad("PC-05", "provider 对得上时 active 没生效：" + JSON.stringify({ p: cfg.provider_id, b: cfg.base_url, m: cfg.model }));
  }
}

/* ---------- C. 自由字符串切换 ---------- */
{
  const kernel = fs.readFileSync(path.join(REPO, "cmd/desktop_turn/parity_intents.mbt"), "utf8");
  const ui = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  /* 内核把 `switch model <id>` 的 id 原样透传给 Host ⇒ 不校验 provider id */
  const passthrough = /low\.has_prefix\("switch model "\)[\s\S]{0,200}"model=" \+ trimmed\[13:\]/.test(kernel);
  if (passthrough) {
    ok("PC-07", "内核把 switch model <id> 的 id 原样透传（不校验 provider id ⇒ 目录里有即可切）");
  } else {
    bad("PC-07", "内核不再原样透传 switch model 的 id ⇒ 用户自定义模型切不动了");
  }
  if (/switch model " \+ (p\.id|id)/.test(ui)) {
    ok("PC-07b", "UI 用目录里的 provider id 去切（目录里有 minimax 就有这一项）");
  } else {
    bad("PC-07b", "UI 不用目录里的 provider id 切换");
  }
}

/* ---------- D. 负向对照（变异）：判据必须有牙 ---------- */
{
  /* D1：把「内置目录合并」短路成「只认用户文件」 ⇒ PC-02 必须翻红 */
  const src = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
  const anchor = 'for (const def of DEFAULT_LLM_PROVIDERS) {';
  if (!src.includes(anchor)) {
    bad("PC-08", "找不到内置目录合并的锚点（变异对照做不了 ⇒ 判据可能没牙）");
  } else {
    const mutant = src.replace(anchor, "for (const def of []) {");
    if (mutant === src) {
      bad("PC-08", "变异没生效（源码没变）");
    } else {
      const dir = path.join(TMP, "d-mutant");
      fs.mkdirSync(dir, { recursive: true });
      writeProviders(dir, [{ id: "deepseek", label: "DeepSeek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", env_key: "BITBOT_LLM_API_KEY" }], "deepseek");
      /* 把变异体放进 hosts/shared 同一目录（相对 require 路径才成立），跑完即删 */
      const tmpFile = path.join(REPO, "hosts/shared", ".tmp_pc_mutant_" + process.pid + ".js");
      try {
        fs.writeFileSync(tmpFile, mutant, "utf8");
        const { createHostFfi: mutantFfi } = require(tmpFile);
        const cat = mutantFfi(REPO, { dataRoot: dir }).listLlmCatalog();
        const ids = (cat.providers || []).map((p) => p.id);
        if (!ids.includes("minimax")) {
          ok("PC-08", "变异对照：短路内置合并后 minimax 消失 ⇒ PC-02 的判据有牙");
        } else {
          bad("PC-08", "短路内置合并后 minimax 仍在 ⇒ PC-02 是恒真的");
        }
      } catch (e) {
        bad("PC-08", "变异体跑不起来（源文件一个字节都没动）：" + String(e && e.message).slice(0, 160));
      } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
      }
    }
  }
}
{
  /* D2：把「active 不串台」放回去（无条件用 active.base_url） ⇒ PC-04 必须翻红 */
  const src = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
  const anchor = "const activeMatches =";
  if (!src.includes(anchor)) {
    bad("PC-09", "找不到 activeMatches 的锚点（变异对照做不了）");
  } else {
    const mutant = src.replace(
      /const activeMatches =[\s\S]*?;/,
      "const activeMatches = true;",
    );
    if (mutant === src) {
      bad("PC-09", "变异没生效（源码没变）");
    } else {
      const dir = path.join(TMP, "d-mutant2");
      fs.mkdirSync(dir, { recursive: true });
      writeActive(dir, { provider_id: "deepseek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", api_key: "dk" });
      const tmpFile = path.join(REPO, "hosts/shared", ".tmp_pc_mutant2_" + process.pid + ".js");
      const prevProvider = process.env.BITBOT_LLM_PROVIDER;
      const prevBase = process.env.BITBOT_LLM_BASE_URL;
      const prevModel = process.env.BITBOT_LLM_MODEL;
      delete process.env.BITBOT_LLM_BASE_URL;
      delete process.env.BITBOT_LLM_MODEL;
      process.env.BITBOT_LLM_PROVIDER = "minimax";
      try {
        fs.writeFileSync(tmpFile, mutant, "utf8");
        const { createHostFfi: mutantFfi } = require(tmpFile);
        const cfg = mutantFfi(REPO, { dataRoot: dir }).resolveLlmConfig();
        if (cfg.base_url === "https://api.deepseek.com/v1") {
          ok("PC-09", "变异对照：放回 active 串台后请求确实发去 deepseek ⇒ PC-04 的判据有牙");
        } else {
          bad("PC-09", "变异没造成串台 ⇒ PC-04 的判据可能没牙（base=" + cfg.base_url + "）");
        }
      } catch (e) {
        bad("PC-09", "变异体跑不起来：" + String(e && e.message).slice(0, 160));
      } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
        if (prevProvider === undefined) delete process.env.BITBOT_LLM_PROVIDER; else process.env.BITBOT_LLM_PROVIDER = prevProvider;
        if (prevBase === undefined) delete process.env.BITBOT_LLM_BASE_URL; else process.env.BITBOT_LLM_BASE_URL = prevBase;
        if (prevModel === undefined) delete process.env.BITBOT_LLM_MODEL; else process.env.BITBOT_LLM_MODEL = prevModel;
      }
    }
  }
}

/* ---------- D2. UI 侧也要在（provider 支持最常见的半拉子） ---------- */
{
  const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  /* 后端目录里有 minimax，但界面下拉框里没有 ⇒ 用户根本选不到 ⇒
     「支持 MiniMax」只做了一半。这条门钉住「两处都在」。 */
  if (/<option[^>]*value="minimax"/.test(html)) {
    ok("PC-12", "设置页「服务商」下拉框里有 MiniMax（用户选得到）");
  } else {
    bad("PC-12", "设置页下拉框里没有 MiniMax ⇒ 后端支持了但用户选不到");
  }
  if (/minimax:\s*\{[\s\S]{0,400}?base:\s*"https:\/\/api\.minimax\.chat\/v1"/.test(html)) {
    ok("PC-13", "界面预置里 MiniMax 的端点/模型对得上后端目录");
  } else {
    bad("PC-13", "界面预置里没有 MiniMax（或端点对不上）");
  }
  /* provider 各自一把密钥 ⇒ 必须有**专用**密钥栏。
     没有它：用户在上面那把通用 Key 里粘了 MiniMax 的密钥、保存也成功，
     但 minimax 那一路的 env_key 仍是空的 ⇒ 界面说「还没配置密钥」。 */
  if (/sec-minimax-key/.test(html) && /BITBOT_LLM_MINIMAX_API_KEY/.test(html)) {
    ok("PC-14", "MiniMax 有专用密钥栏，写进 BITBOT_LLM_MINIMAX_API_KEY（不会粘在通用那把上）");
  } else {
    bad("PC-14", "MiniMax 缺专用密钥栏 ⇒ 用户粘了 key 也用不上");
  }
  if (/sec-minimax-mask/.test(html)) {
    ok("PC-15", "MiniMax 密钥栏有掩码状态（已配置/未配置的回显）");
  } else {
    bad("PC-15", "MiniMax 密钥栏没有掩码状态");
  }
  /* 三语文案齐全（Copy contract v1） */
  const langs = ["zh_cn", "zh_tw", "en"];
  const counts = langs.map(() => 0);
  for (const key of ["stProviderMiniMax", "providerMiniMaxLabel", "providerMiniMaxHint"]) {
    const re = new RegExp(key + ":", "g");
    const n = (html.match(re) || []).length;
    if (n < 3) {
      bad("PC-16", "文案「" + key + "」只在 " + n + " 处出现（zh_cn/zh_tw/en 三语必须齐全）");
      return;
    }
  }
  ok("PC-16", "MiniMax 的三语文案齐全（stProviderMiniMax / providerMiniMaxLabel / providerMiniMaxHint）");
}

/* ---------- E. 隔离 ---------- */
{
  const FP_AFTER = fingerprint(USER_DATA);
  const before = Object.keys(FP_BEFORE);
  const after = Object.keys(FP_AFTER);
  const changed = [];
  for (const k of before) if (FP_AFTER[k] !== FP_BEFORE[k]) changed.push(k);
  for (const k of after) if (!(k in FP_BEFORE)) changed.push(k + "(new)");
  if (!changed.length) {
    ok("PC-10", "用户真数据一个字节没动（" + before.length + " 个文件指纹前后一致）");
  } else {
    bad("PC-10", "门禁改写了用户真数据：" + changed.slice(0, 5).join(", "));
  }
}

/* ---------- F. 密钥不进目录 ---------- */
{
  const dir = path.join(TMP, "f-key");
  fs.mkdirSync(dir, { recursive: true });
  writeProviders(dir, [{ id: "minimax", label: "MiniMax", base_url: "https://api.minimax.chat/v1", model: "MiniMax-M3.1-Flash", env_key: "BITBOT_LLM_MINIMAX_API_KEY" }], "minimax");
  const ffi = createHostFfi(REPO, { dataRoot: dir });
  const cat = ffi.listLlmCatalog();
  const mm = (cat.providers || []).find((p) => p.id === "minimax");
  const raw = fs.readFileSync(path.join(dir, "llm", "providers.json"), "utf8");
  if (mm && !("api_key" in mm) && !/api_key"/.test(raw)) {
    ok("PC-11", "provider 目录里不落密钥（只有环境变量名）");
  } else {
    bad("PC-11", "provider 目录里落了密钥");
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }

console.log("\nprove_llm_provider_catalog PASS=" + PASS + " FAIL=" + FAIL);
process.exit(FAIL ? 1 : 0);
