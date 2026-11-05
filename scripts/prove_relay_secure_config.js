#!/usr/bin/env node
"use strict";
/* prove_relay_secure_config.js — A3-12 门禁（RS-01..RS-11）
 *
 * 要证的一件事：**两把 relay token 不再以明文躺在 data/desktop/relay.json 里**，
 * 而且旧的手写明文配置继续能读（向后兼容是硬要求）。
 *
 * 复用仓库已有的 hosts/desktop/secret_vault.js（AES-256-GCM + 0600），
 * 不另造加密。安全格式里 relay.json 只留 *_token_ref，明文由 vault.resolve() 取回。
 *
 * 反真空三处：RS-01（旧格式确实读得出，不是「什么都回 null」）、
 * RS-04（resolve 出来的值与签发值逐字相同，不是编的）、
 * RS-08（假 vault 恒回空串时必须回 null，而不是拿空 token 硬凑一个「配好了」）。
 *
 * 跑法：node scripts/prove_relay_secure_config.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SECRETS = require(path.join(REPO, "hosts/shared/relay/relay_secrets.js"));
const CONFIG = require(path.join(REPO, "hosts/shared/relay/relay_config.js"));
const KEYS = require(path.join(REPO, "hosts/shared/relay/relay_keys.js"));
const { createSecretVault } = require(path.join(REPO, "hosts/desktop/secret_vault.js"));
const MAINJS = path.join(REPO, "hosts/desktop/main.js");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

async function main() {
  const SECRET = "secure-config-secret";
  const boxToken = KEYS.issueRelayCredential(SECRET, "desktop-secure", "box");
  const clientToken = KEYS.issueRelayCredential(SECRET, "phone-secure", "client");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-securecfg-"));
  const cfgFile = path.join(tmp, "relay.json");
  const vaultFile = path.join(tmp, "vault.json");
  const keyFile = path.join(tmp, "vault.key");
  const vault = createSecretVault(tmp, { vaultPath: vaultFile, keyPath: keyFile });
  const full = {
    host: "relay.example.com", port: 18766, box_id: "box-secure",
    box_token: boxToken, client_token: clientToken, mode: "reverse",
  };
  const load = (extra) => SECRETS.loadRelayConfigSecure(Object.assign({
    file: cfgFile, env: {}, vault,
  }, extra || {}));

  /* RS-01 反真空正控：旧的手写明文格式继续能读（向后兼容）。 */
  {
    fs.writeFileSync(cfgFile, JSON.stringify(full));
    const cfg = load();
    if (!cfg) bad("RS-01 旧明文格式读不出来了（真机清单里的老配置会全废）", fs.readFileSync(cfgFile, "utf8"));
    else if (cfg.boxToken !== boxToken || cfg.clientToken !== clientToken) {
      bad("RS-01 旧格式读出来的两把钥匙不对", JSON.stringify(Object.keys(cfg)));
    } else if (cfg.mode !== "reverse") {
      bad("RS-01 旧格式的 mode 丢了", cfg.mode);
    } else {
      ok("RS-01 正控：旧明文 relay.json 继续读得出（五栏齐、mode=reverse，向后兼容）");
    }
  }

  /* RS-02 安全写入：文件里查无明文、mode 0600。 */
  let writeResult = null;
  {
    writeResult = SECRETS.writeRelayConfigSecure({ file: cfgFile, cfg: full, vault });
    const text = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf8") : "";
    const mode = fs.statSync(cfgFile).mode & 0o777;
    if (!writeResult.ok) {
      bad("RS-02 安全写入失败", JSON.stringify(writeResult));
    } else if (text.includes(boxToken) || text.includes(clientToken)) {
      bad("RS-02 relay.json 里仍能看到明文 token", text.slice(0, 200));
    } else if (mode !== 0o600) {
      bad("RS-02 relay.json 权限不是 0600", mode.toString(8));
    } else if (!text.includes(SECRETS.BOX_TOKEN_NAME) || !text.includes(SECRETS.CLIENT_TOKEN_NAME)) {
      bad("RS-02 安全格式里没有 token 引用", text.slice(0, 200));
    } else {
      ok("RS-02 安全写入：relay.json 只留 *_token_ref、查无两把明文，文件 mode=0600");
    }
  }

  /* RS-03 vault 自身也查无明文（grep data/ 口径）。 */
  {
    const store = fs.existsSync(vaultFile) ? fs.readFileSync(vaultFile, "utf8") : "";
    const key = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8") : "";
    const all = store + key;
    const vmode = fs.statSync(vaultFile).mode & 0o777;
    if (!store) bad("RS-03 vault 文件没写出来");
    else if (all.includes(boxToken) || all.includes(clientToken)) {
      bad("RS-03 vault 里出现了明文 token（加密没生效）");
    } else if (vmode !== 0o600) {
      bad("RS-03 vault 权限不是 0600", vmode.toString(8));
    } else {
      ok("RS-03 vault.json / vault.key 查无明文且 mode=0600（AES-256-GCM 生效）");
    }
  }

  /* RS-04 resolve 正确：读回来的值与签发值逐字相同。 */
  {
    const cfg = load();
    if (!cfg) bad("RS-04 安全格式读不出来（等于没配）", fs.readFileSync(cfgFile, "utf8"));
    else if (cfg.boxToken !== boxToken) bad("RS-04 box_token resolve 不对");
    else if (cfg.clientToken !== clientToken) bad("RS-04 client_token resolve 不对");
    else if (cfg.host !== full.host || cfg.port !== full.port || cfg.boxId !== full.box_id) {
      bad("RS-04 非敏感字段读错了", JSON.stringify(cfg));
    } else {
      ok("RS-04 安全格式 → resolve 回两把钥匙，与签发值逐字相同，host/port/boxId 不变");
    }
  }

  /* RS-05 回执四栏仍正好四栏、不含 box_token。 */
  {
    const h = CONFIG.toHandoff(load());
    const keys = Object.keys(h || {}).sort().join(",");
    if (keys !== "box_id,client_token,host,port") {
      bad("RS-05 toHandoff 不是正好四栏", keys || "(空)");
    } else if (JSON.stringify(h).includes(boxToken)) {
      bad("RS-05 四栏里夹带了 box_token（桌面的登记权外泄）");
    } else if (h.client_token !== clientToken) {
      bad("RS-05 client_token 没下发（手机会连不上中转）");
    } else {
      ok("RS-05 回执四栏仍是 host/port/box_id/client_token（client_token 必须下发，box_token 绝不外泄）");
    }
  }

  /* RS-06 权限被改宽要能看出来，但不拒绝读（可用性优先）。 */
  {
    fs.chmodSync(cfgFile, 0o644);
    const info = SECRETS.inspectRelayConfigFile({ file: cfgFile });
    const cfg = load();
    if (info.secure || info.warnings.length === 0) {
      bad("RS-06 权限被改成 644 却没报出来", JSON.stringify(info));
    } else if (!cfg) {
      bad("RS-06 权限宽了就不给读了（现场会突然 NOBOX，降级过度）");
    } else {
      ok("RS-06 权限 644 时明确告警（" + info.warnings[0] + "），但仍照常读，不连坐可用性");
    }
    fs.chmodSync(cfgFile, 0o600);
  }

  /* RS-07 半套 / 坏 JSON 一律回 null（既有口径不许被安全格式改坏）。 */
  {
    fs.writeFileSync(cfgFile, JSON.stringify({ host: "127.0.0.1", port: 18766 }));
    const half = load();
    fs.writeFileSync(cfgFile, "{ not json");
    const broken = load();
    if (half !== null || broken !== null) {
      bad("RS-07 半套/坏 JSON 没回 null", JSON.stringify({ half, broken }));
    } else {
      ok("RS-07 半套与坏 JSON 一律回 null（沿用 A3-7「缺一栏就当没配」口径）");
    }
  }

  /* RS-08 注入对照：假 vault 恒回空串时必须回 null，不许拿空 token 硬凑「配好了」。 */
  {
    SECRETS.writeRelayConfigSecure({ file: cfgFile, cfg: full, vault });
    const blind = {
      submit: () => ({ ok: true, handle: "sec-blind" }),
      resolve: () => "",
    };
    const got = SECRETS.loadRelayConfigSecure({ file: cfgFile, env: {}, vault: blind });
    const noVault = SECRETS.loadRelayConfigSecure({ file: cfgFile, env: {}, vault: null });
    if (got !== null || noVault !== null) {
      bad("RS-08 拿不到凭证却仍返回了「配好了」（真空通过）", JSON.stringify({ got, noVault }));
    } else {
      ok("RS-08 注入对照：vault 取不到凭证 / 干脆没 vault 时一律回 null，不编默认 token");
    }
  }

  /* RS-09 静态 join：模块绿 ≠ 产品会用（A3-7 RB-09 的教训）。 */
  {
    const src = fs.readFileSync(MAINJS, "utf8");
    // A3-16 把回执四栏从「一行 loadCurrentRelayConfig() 直塞 toHandoff」
    // 改成了「先拿 cfg → 地址自检 → 过了才 toHandoff，不过就 return null」，
    // 原来那条整行锚点必然失配。这里**不删约束、改锚点形状**：
    // 顺带修掉一个老毛病 —— `const cfg = loadCurrentRelayConfig();` 原来是
    // 全文字符串匹配，A3-16 之后 handoff 里也长出同样一行，于是登记那处
    // 就算哪天不接也照样绿。改成按函数体切片，各查各的。
    // 判之前先剥注释：这里已经栽过一次「注释撑绿」—— `createSecretVault(REPO_ROOT)`
    // 这个 needle 之所以还能命中，是因为**我在 main.js 的注释里写了这句话**，
    // 而真正的调用早就变成了 `createSecretVault(REPO_ROOT, { protector: ... })`。
    // 注释和被注释的代码长得一模一样，不剥就是把判据建在自己的说明文字上。
    const srcCode = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const bodyOf = (name) => {
      const i = src.indexOf("function " + name);
      if (i < 0) return "";
      const j = src.indexOf("\n}\n", i); // 顶层函数收尾（行首花括号）
      return j > i ? src.slice(i, j) : src.slice(i, i + 2400);
    };
    const handoffBody = bodyOf("currentRelayHandoff");
    const registerBody = bodyOf("syncRelayBoxRegistration");
    const anchors = [
      [srcCode, 'require("./shared/relay/relay_secrets")', "没 require relay_secrets 模块"],
      // R-A3-6h：vault 现在两个入口都接钥匙串（relayVaultNow 惰性），所以锚点从
      // 「有个无参构造」改成「构造时带了 protector」—— 约束更强，不是放松。
      [srcCode, "createSecretVault(REPO_ROOT, {", "没创建 vault 实例"],
      [srcCode, "protector: resolveVaultProtector()", "vault 没接钥匙串保护器"],
      [srcCode, "function loadCurrentRelayConfig()", "没有统一安全读口"],
      [srcCode, "relaySecretsMod.loadRelayConfigSecure({ repoRoot: REPO_ROOT, vault: relayVaultNow() })", "读口没接 secure load"],
      [handoffBody, "loadCurrentRelayConfig()", "回执四栏没走安全读口"],
      [handoffBody, "relayConfigMod.toHandoff(", "回执四栏没经 toHandoff 折成四栏"],
      [registerBody, "loadCurrentRelayConfig()", "登记没走安全读口"],
      [srcCode, "load: () => loadCurrentRelayConfig(),", "配置观察器没走安全读口"],
    ];
    const missing = anchors.filter(([s, needle]) => !s.includes(needle)).map(([, , why]) => why);
    if (missing.length) bad("RS-09 桌面接线缺了 " + missing.length + " 处：" + missing.join("；"));
    else if (!handoffBody) bad("RS-09 切不出 currentRelayHandoff 函数体（锚点失效，不是绿）");
    else ok("RS-09 八处接线都在：require / vault / 统一读口 / 三处调用 / 回执四栏 / 登记");
  }

  /* RS-10 既有门的关键锚点一字未动（改 main.js 最怕连坐）。 */
  {
    const src = fs.readFileSync(MAINJS, "utf8");
    const q0 = src.indexOf('app.on("before-quit"');
    const q1 = src.indexOf('app.on("will-quit"');
    const quitBlock = q0 >= 0 && q1 > q0 ? src.slice(q0, q1) : "";
    const anchors = [
      [src, "relayHandoff: () => currentRelayHandoff(),", "RB-09 四栏接线"],
      [src, "const started = await cnInbound.start();", "RB-09 拿住 started"],
      [src, "syncRelayBoxRegistration(started)", "RB-09 登记接 started"],
      [src, "mode: cfg.mode,", "RV-12 mode 传入"],
      [src, "startRelayConfigWatch(started);", "RH-10 观察器启动"],
      [quitBlock, "relayBox.stop()", "RB-09 退出停心跳"],
      [quitBlock, "stopRelayConfigWatch();", "RH-10 退出停观察器"],
    ];
    const missing = anchors.filter(([s, needle]) => !s.includes(needle)).map(([, , why]) => why);
    if (missing.length) bad("RS-10 既有静态锚点被撞掉了 " + missing.length + " 处：" + missing.join("；"));
    else ok("RS-10 RB-09 / RV-12 / RH-10 的七处既有锚点一字未动");
  }

  /* RS-11 环境变量兜底仍在（没配置文件时不能突然不认 BITBOT_RELAY_*）。 */
  {
    const gone = path.join(tmp, "no-such-relay.json");
    const fromEnv = SECRETS.loadRelayConfigSecure({
      file: gone, vault, env: {
        BITBOT_RELAY_HOST: "env.example.com", BITBOT_RELAY_PORT: "18766",
        BITBOT_RELAY_BOX_ID: "box-env",
        BITBOT_RELAY_BOX_TOKEN: boxToken, BITBOT_RELAY_CLIENT_TOKEN: clientToken,
      },
    });
    if (!fromEnv || fromEnv.host !== "env.example.com") {
      bad("RS-11 环境变量兜底失效（运维逃生口被改坏）", JSON.stringify(fromEnv));
    } else {
      ok("RS-11 没配置文件时仍从 BITBOT_RELAY_* 兜底读得到");
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("prove_relay_secure_config: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 门禁自身异常：" + ((e && e.stack) || e));
  console.log("prove_relay_secure_config: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(1);
});
