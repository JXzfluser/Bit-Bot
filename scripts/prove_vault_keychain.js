#!/usr/bin/env node
"use strict";
/* prove_vault_keychain.js — R-A3-6h 门禁（VK-01..VK-12）
 *
 * 要证的一件事：**vault 的 AES 密钥可以不再以明文躺在磁盘上**，
 * 而且「不接保护器」时的历史行为一字没变、旧明文密钥能安全迁移、
 * 钥匙串打不开时不会静默造新密钥把旧密文变成永久垃圾。
 *
 * 全程离线：保护器用假件（异或 + 假 safeStorage），**不 require electron**。
 *
 * 反真空三处：
 *   VK-01 不接保护器仍是明文 0600（证明「基线没被顺手改掉」）；
 *   VK-05 旧明文迁移后**旧密文仍能解开**（证明迁移不是把密钥换掉）；
 *   VK-07 unprotect 抛错时旧文件字节不变（证明没有偷偷重建密钥）。
 *
 * 跑法：node scripts/prove_vault_keychain.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const REPO = path.resolve(__dirname, "..");
const VAULT_PATH = path.join(REPO, "hosts/desktop/secret_vault.js");
const VAULT = require(VAULT_PATH);

const {
  createSecretVault,
  createSafeStorageProtector,
  inspectKeyStorage,
  VAULT_KEY_UNAVAILABLE,
} = VAULT;

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

/* ---------------- 假件：离线、可预测、不碰真钥匙串 ---------------- */
function xorBuf(buf, mask) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ mask;
  return out;
}

function fakeProtector(opts) {
  const o = opts || {};
  return {
    id: o.id || "os-keychain",
    available: o.available !== false,
    protect(hex) {
      if (o.protectThrows) throw new Error("protect boom");
      return xorBuf(Buffer.from(String(hex), "utf8"), o.mask || 0x5a);
    },
    unprotect(bytes) {
      if (o.unprotectThrows) throw new Error("keychain entry missing");
      return xorBuf(Buffer.from(bytes), o.mask || 0x5a).toString("utf8");
    },
  };
}

function mkTmp(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-vault-" + tag + "-"));
}

function pathsOf(dir) {
  return { vaultPath: path.join(dir, "vault.json"), keyPath: path.join(dir, "vault.key") };
}

function modeOf(file) {
  try { return fs.statSync(file).mode & 0o777; } catch (_) { return null; }
}

const HEX64 = /^[0-9a-f]{64}$/;

async function main() {
  console.log("R-A3-6h vault keychain proof (VK-01..VK-12)");
  const tmpDirs = [];

  /* ============ VK-01 基线：不传 protector → 仍是明文 vault.key 0600 === */
  {
    const dir = mkTmp("base"); tmpDirs.push(dir);
    const p = pathsOf(dir);
    const vault = createSecretVault(dir, p);
    const sub = vault.submit({ name: "relay.box_token", label: "box", value: "base-secret" });
    const keyExists = fs.existsSync(p.keyPath);
    const keyBuf = keyExists ? fs.readFileSync(p.keyPath) : Buffer.alloc(0);
    const protectedExists = fs.existsSync(p.keyPath + ".protected");
    const info = inspectKeyStorage(Object.assign({ protector: null }, p));
    if (!sub.ok) bad("VK-01 基线写入失败", JSON.stringify(sub));
    else if (!keyExists) bad("VK-01 不传 protector 却没写出明文 vault.key（基线被改了）");
    else if (keyBuf.length !== 32) bad("VK-01 明文密钥不是 32 字节", keyBuf.length);
    else if (modeOf(p.keyPath) !== 0o600) bad("VK-01 明文密钥权限不是 0600", modeOf(p.keyPath));
    else if (protectedExists) bad("VK-01 没传 protector 却生成了 .protected");
    else if (vault.resolve("relay.box_token") !== "base-secret") bad("VK-01 基线 decrypt 失败");
    else if (info.mode !== "file" || info.plaintextOnDisk !== true) bad("VK-01 基线探针口径不对", JSON.stringify(info));
    else ok("VK-01 反真空基线：不传 protector 仍是明文 vault.key（32B / 0600 / 无 .protected），读写正常");
  }

  /* ============ VK-02 可用 protector → 只落 vault.key.protected 0600 ===== */
  {
    const dir = mkTmp("prot"); tmpDirs.push(dir);
    const p = pathsOf(dir);
    const vault = createSecretVault(dir, Object.assign({ protector: fakeProtector() }, p));
    const sub = vault.submit({ name: "relay.client_token", label: "phone", value: "prot-secret" });
    const protectedFile = p.keyPath + ".protected";
    if (!sub.ok) bad("VK-02 受保护写入失败", JSON.stringify(sub));
    else if (!fs.existsSync(protectedFile)) bad("VK-02 没有写出 vault.key.protected");
    else if (fs.existsSync(p.keyPath)) bad("VK-02 磁盘上仍有明文 vault.key（等于没接保护器）");
    else if (modeOf(protectedFile) !== 0o600) bad("VK-02 .protected 权限不是 0600", modeOf(protectedFile));
    else if (vault.resolve("relay.client_token") !== "prot-secret") bad("VK-02 受保护路径解密失败");
    else ok("VK-02 接了可用 protector：只落 vault.key.protected（0600），明文 vault.key 不存在，读写正常");
  }

  /* ============ VK-03 落盘文件里搜不到 32 字节 hex 密钥原串 ============== */
  {
    const dir = mkTmp("grep"); tmpDirs.push(dir);
    const p = pathsOf(dir);
    const prot = fakeProtector({ mask: 0x33 });
    const vault = createSecretVault(dir, Object.assign({ protector: prot }, p));
    vault.submit({ name: "k", label: "k", value: "grep-secret" });
    const protectedFile = p.keyPath + ".protected";
    const hexKey = prot.unprotect(fs.readFileSync(protectedFile));
    const protectedText = fs.readFileSync(protectedFile).toString("utf8");
    const vaultText = fs.readFileSync(p.vaultPath, "utf8");
    if (!HEX64.test(hexKey)) bad("VK-03 保护器没还原出 64 位 hex 密钥", hexKey.length);
    else if (protectedText.includes(hexKey)) bad("VK-03 .protected 里能直接搜到明文密钥");
    else if (vaultText.includes(hexKey)) bad("VK-03 vault.json 里出现密钥原串");
    else if (/[0-9a-f]{64}/.test(protectedText)) bad("VK-03 .protected 里仍有 64 位 hex 串（可能没真加密）", protectedText.slice(0, 80));
    else ok("VK-03 落盘字节里搜不到 32 字节 hex 密钥原串（.protected / vault.json 都没有）");
  }

  /* ============ VK-04 同一 protector 二次打开 → 能解回原值 ============== */
  {
    const dir = mkTmp("reopen"); tmpDirs.push(dir);
    const p = pathsOf(dir);
    const prot = fakeProtector({ mask: 0x77 });
    const a = createSecretVault(dir, Object.assign({ protector: prot }, p));
    a.submit({ name: "relay.box_token", label: "box", value: "reopen-batch-1" });
    const b = createSecretVault(dir, Object.assign({ protector: fakeProtector({ mask: 0x77 }) }, p));
    const got = b.resolve("relay.box_token");
    const again = b.submit({ name: "relay.client_token", label: "phone", value: "reopen-batch-2" });
    if (got !== "reopen-batch-1") bad("VK-04 二次打开解不回第一批密文", got);
    else if (!again.ok) bad("VK-04 二次打开写第二批失败", JSON.stringify(again));
    else if (b.resolve("relay.client_token") !== "reopen-batch-2") bad("VK-04 二次打开解不回第二批密文");
    else ok("VK-04 用同一个 protector 二次打开：旧密文与新增密文都能解回原值");
  }

  /* ============ VK-05 旧明文迁移：删旧文件、旧密文仍能解开（最关键） === */
  {
    const dir = mkTmp("migrate"); tmpDirs.push(dir);
    const p = pathsOf(dir);
    const prot = fakeProtector({ mask: 0x5a });

    // 先按历史口径造一份「旧的现场」：明文 key + 已有密文。
    const legacy = createSecretVault(dir, p);
    const before = legacy.submit({ name: "relay.box_token", label: "box", value: "legacy-value-42" });
    const legacyKey = fs.readFileSync(p.keyPath);
    const legacyVaultText = fs.readFileSync(p.vaultPath, "utf8");
    const legacyEnc = JSON.parse(legacyVaultText).entries["relay.box_token"].value_enc;

    // 接上保护器：构造即迁移（不看第一次写入的时机）。
    const migrated = createSecretVault(dir, Object.assign({ protector: prot }, p));
    const protectedFile = p.keyPath + ".protected";
    const info = inspectKeyStorage(Object.assign({ protector: prot }, p));
    const afterVaultText = fs.readFileSync(p.vaultPath, "utf8");
    const afterEnc = JSON.parse(afterVaultText).entries["relay.box_token"].value_enc;

    let keyFromProtected = "";
    try { keyFromProtected = prot.unprotect(fs.readFileSync(protectedFile)); } catch (_) { keyFromProtected = ""; }

    if (!before.ok) bad("VK-05 前置：旧口径写入失败", JSON.stringify(before));
    else if (fs.existsSync(p.keyPath)) bad("VK-05 迁移后旧明文 vault.key 还在（等于没接钥匙串）");
    else if (!fs.existsSync(protectedFile)) bad("VK-05 迁移后没有 vault.key.protected");
    else if (modeOf(protectedFile) !== 0o600) bad("VK-05 .protected 权限不是 0600", modeOf(protectedFile));
    else if (keyFromProtected !== legacyKey.toString("hex")) bad("VK-05 迁移换掉了密钥（旧密文会全废）");
    else if (afterEnc !== legacyEnc) bad("VK-05 迁移顺手重写了密文（不该动 vault.json）");
    else if (migrated.resolve("relay.box_token") !== "legacy-value-42") bad("VK-05 迁移后旧密文解不开", migrated.resolve("relay.box_token"));
    else if (info.mode !== "os-keychain" || info.migrated !== true || info.plaintextOnDisk !== false) {
      bad("VK-05 迁移后探针没有如实报告", JSON.stringify(info));
    } else ok("VK-05 旧明文 vault.key 自动迁移：换保护形式、旧文件删除、旧密文逐字解回（未重写密文）");
  }

  /* ============ VK-06 available=false → 回落明文路径且不报错 ============= */
  {
    const dir = mkTmp("fallback"); tmpDirs.push(dir);
    const p = pathsOf(dir);
    const off = fakeProtector({ available: false });
    let sub = null;
    let threw = null;
    try {
      const vault = createSecretVault(dir, Object.assign({ protector: off }, p));
      sub = vault.submit({ name: "relay.box_token", label: "box", value: "fallback-value" });
    } catch (e) {
      threw = e;
    }
    const info = inspectKeyStorage(Object.assign({ protector: off }, p));
    if (threw) bad("VK-06 available=false 竟然抛错", threw.message);
    else if (!sub || !sub.ok) bad("VK-06 available=false 没回落到明文写入", JSON.stringify(sub));
    else if (!fs.existsSync(p.keyPath)) bad("VK-06 available=false 时没有明文 vault.key");
    else if (fs.existsSync(p.keyPath + ".protected")) bad("VK-06 available=false 时仍写了 .protected");
    else if (modeOf(p.keyPath) !== 0o600) bad("VK-06 回落路径权限不是 0600", modeOf(p.keyPath));
    else if (info.mode !== "file" || info.plaintextOnDisk !== true) bad("VK-06 回落探针口径不对", JSON.stringify(info));
    else ok("VK-06 protector.available=false：不抛、回落明文 vault.key 0600，探针报 mode=file");
  }

  /* ============ VK-07 unprotect 抛错：明确失败、绝不覆盖旧文件 ========== */
  {
    const dir = mkTmp("lostkey"); tmpDirs.push(dir);
    const p = pathsOf(dir);
    const prot = fakeProtector({ mask: 0x5a });
    const first = createSecretVault(dir, Object.assign({ protector: prot }, p));
    first.submit({ name: "relay.client_token", label: "phone", value: "must-survive" });
    const protectedFile = p.keyPath + ".protected";
    const protectedBefore = fs.readFileSync(protectedFile);
    const vaultBefore = fs.readFileSync(p.vaultPath, "utf8");

    // 换机器 / 钥匙串条目被删：同一个 id，但解不开。
    const lost = fakeProtector({ mask: 0x5a, unprotectThrows: true });
    const broken = createSecretVault(dir, Object.assign({ protector: lost }, p));
    const got = broken.resolve("relay.client_token");
    const sub = broken.submit({ name: "relay.client_token", label: "phone", value: "must-not-write" });
    const protectedAfter = fs.readFileSync(protectedFile);
    const vaultAfter = fs.readFileSync(p.vaultPath, "utf8");
    const ks = broken.keyStatus();

    // 恢复：原保护器还在就能读回来 —— 证明上面没有把密钥重建掉。
    const recovered = createSecretVault(dir, Object.assign({ protector: prot }, p)).resolve("relay.client_token");

    if (got !== null) bad("VK-07 unprotect 抛错时 resolve 没有返回明确的 null", JSON.stringify(got));
    else if (sub.ok || sub.code !== VAULT_KEY_UNAVAILABLE) bad("VK-07 submit 没有回 vault_key_unavailable", JSON.stringify(sub));
    else if (!protectedAfter.equals(protectedBefore)) bad("VK-07 失败时改写了 .protected（静默重建了新密钥）");
    else if (vaultAfter !== vaultBefore) bad("VK-07 失败时改写了 vault.json", vaultAfter.slice(0, 120));
    else if (fs.existsSync(p.keyPath)) bad("VK-07 失败时生成了明文 vault.key");
    else if (!ks || ks.ok !== false || ks.code !== VAULT_KEY_UNAVAILABLE) bad("VK-07 keyStatus 没报可用状态", JSON.stringify(ks));
    else if (recovered !== "must-survive") bad("VK-07 恢复原保护器后读不回来（数据被毁了）", recovered);
    else ok("VK-07 unprotect 抛错 → resolve=null / submit=code:vault_key_unavailable，两份文件字节未变，换回原锁仍可解");
  }

  /* ============ VK-08 inspectKeyStorage 两种模式都如实报告 =============== */
  {
    const fileDir = mkTmp("inspect-file"); tmpDirs.push(fileDir);
    const fp = pathsOf(fileDir);
    createSecretVault(fileDir, fp).submit({ name: "k", label: "k", value: "v" });
    const fileInfo = inspectKeyStorage(fp);

    // 预置「明文 key + 已接保护器」但还没加载过的现场：必须说 plaintextOnDisk=true。
    const preDir = mkTmp("inspect-pre"); tmpDirs.push(preDir);
    const pp = pathsOf(preDir);
    createSecretVault(preDir, pp).submit({ name: "k", label: "k", value: "v" });
    const preInfo = inspectKeyStorage(Object.assign({ protector: fakeProtector() }, pp));

    const protDir = mkTmp("inspect-prot"); tmpDirs.push(protDir);
    const protPaths = pathsOf(protDir);
    const prot = fakeProtector();
    createSecretVault(protDir, Object.assign({ protector: prot }, protPaths))
      .submit({ name: "k", label: "k", value: "v" });
    const protInfo = inspectKeyStorage(Object.assign({ protector: prot }, protPaths));

    if (fileInfo.mode !== "file" || fileInfo.plaintextOnDisk !== true || fileInfo.migrated !== false) {
      bad("VK-08 明文模式报告不对", JSON.stringify(fileInfo));
    } else if (!/vault\.key$/.test(fileInfo.keyFile)) {
      bad("VK-08 明文模式 keyFile 不是 vault.key", fileInfo.keyFile);
    } else if (preInfo.mode !== "os-keychain" || preInfo.plaintextOnDisk !== true || preInfo.migrated !== false) {
      bad("VK-08 未迁移前应报 os-keychain + 明文仍在", JSON.stringify(preInfo));
    } else if (protInfo.mode !== "os-keychain" || protInfo.plaintextOnDisk !== false || protInfo.migrated !== true) {
      bad("VK-08 迁移后报告不对", JSON.stringify(protInfo));
    } else if (!/\.protected$/.test(protInfo.keyFile)) {
      bad("VK-08 迁移后 keyFile 不是 .protected", protInfo.keyFile);
    } else {
      ok("VK-08 探针如实：file/明文=true/未迁移；迁移前 os-keychain+明文=true；迁移后 os-keychain/明文=false/migrated=true");
    }
  }

  /* ============ VK-09 createSafeStorageProtector（假 safeStorage） ======= */
  {
    const unavailable = createSafeStorageProtector({
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error("should not be called"); },
      decryptString: () => { throw new Error("should not be called"); },
    });
    const brokenBackend = createSafeStorageProtector({
      isEncryptionAvailable() { throw new Error("no keyring"); },
    });
    const fake = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from("KC1:" + String(s), "utf8"),
      decryptString: (b) => String(Buffer.from(b).toString("utf8")).replace(/^KC1:/, ""),
    };
    const live = createSafeStorageProtector(fake);
    const hex = crypto.randomBytes(32).toString("hex");
    let roundTrip = "";
    let threw = false;
    try { roundTrip = live.unprotect(live.protect(hex)); } catch (_) { threw = true; }
    const wrapped = live.protect(hex);

    if (unavailable.available !== false) bad("VK-09 isEncryptionAvailable=false 时 available 不是 false");
    else if (brokenBackend.available !== false) bad("VK-09 后端抛错时居然没降级为不可用");
    else if (live.available !== true) bad("VK-09 可用后端时 available 不是 true");
    else if (!Buffer.isBuffer(wrapped) || wrapped.equals(Buffer.from(hex))) {
      bad("VK-09 protect 直接把明文 hex 原样返回（没包一层）");
    } else if (threw || roundTrip !== hex) bad("VK-09 protect/unprotect 往返不一致", roundTrip);
    else ok("VK-09 createSafeStorageProtector：后端不可用/抛错 → available=false；可用时 protect↔unprotect 往返一致");
  }

  /* ============ VK-10 静态锚点：算法没被换弱、没把密钥写进日志 ======== */
  {
    const src = fs.readFileSync(VAULT_PATH, "utf8");
    const weak = [
      /createCipheriv\(\s*["']aes-(?:128|192)-/i,
      /createCipheriv\(\s*["'](?:des|des-ede|rc4|bf-)/i,
      /["'](?:rc4|des-cbc|md5)["']/i,
      /createHash\(\s*["']md5["']/i,
    ].filter((re) => re.test(src));
    // 只看真正的日志调用行，且必须同行出现密钥类标识 —— 避免注释里提到 key 就误判。
    const logLeaks = src
      .split("\n")
      .filter((line) => /console\.(?:log|info|warn|error|debug)\s*\(/.test(line))
      .filter((line) => /\b(?:plainKeyHex|wrapped|keyBuf|loadKey\(\)|secretKey|vaultKey)\b/.test(line));
    const anchors = [
      [src.includes('"aes-256-gcm"'), "AES-256-GCM 算法标识不见了"],
      [/crypto\.randomBytes\(32\)/.test(src), "密钥生成不再是 randomBytes(32)"],
      [logLeaks.length === 0, "疑似把密钥写进日志：" + logLeaks.join(" | ").slice(0, 160)],
      [weak.length === 0, "出现弱算法标识"],
      [/createSecretVault/.test(src) && /inspectKeyStorage/.test(src), "导出的入口不见了"],
      [/createSafeStorageProtector/.test(src), "safeStorage 工厂不见了"],
    ];
    const failed = anchors.filter(([cond]) => !cond).map(([, why]) => why);
    if (failed.length) bad("VK-10 静态锚点失配：" + failed.join("；"));
    else ok("VK-10 静态锚点：仍是 aes-256-gcm + randomBytes(32)，无弱算法替换，无密钥进日志");
  }

  /* ============ VK-11 「不可用」的保护器必须被过滤掉，而不是让 vault 变砖 ====
   *
   * 为什么要这一条：`createSafeStorageProtector` 在**构造时**就把 available 定死，
   * 而 `isEncryptionAvailable()` 在 app ready 之前恒 false。如果不可用的保护器也往
   * createSecretVault 里塞，Linux 无 keyring / 提前构造两种情况下整份 vault 会直接不可读 ——
   * 「上了钥匙串」变成「上了就打不开」，比不上更坏。
   * 正确行为：过滤掉、回落明文口径，数据照常可读。 */
  {
    const dir = mkTmp("unavailable"); tmpDirs.push(dir);
    const p = pathsOf(dir);
    const dead = {
      id: "os-keychain",
      available: false,
      protect() { throw new Error("must not be called"); },
      unprotect() { throw new Error("must not be called"); },
    };
    const vault = createSecretVault(dir, Object.assign({}, p, { protector: dead }));
    const sub = vault.submit({ name: "relay.client_token", label: "client", value: "still-readable" });
    // 读回用 resolve（vault 的 API 是 submit/status/resolve/remove/keyStatus，没有 get）。
    const got = vault.resolve("relay.client_token");
    // 保护器不可用 ⇒ 必须回到明文 vault.key，且 .protected 一个字节都不该出现。
    const plain = fs.existsSync(p.keyPath);
    const prot = fs.existsSync(p.keyPath + ".protected");
    const info = inspectKeyStorage(Object.assign({ protector: dead }, p));
    if (!sub || sub.ok === false) bad("VK-11 保护器不可用时 vault 直接不可用（比不上钥匙串更坏）", JSON.stringify(sub));
    else if (got !== "still-readable") bad("VK-11 保护器不可用时读不回原值", String(got));
    else if (!plain) bad("VK-11 没有回落到明文 vault.key");
    else if (prot) bad("VK-11 保护器不可用却写出了 vault.key.protected");
    else if (info.mode !== "file") bad("VK-11 探针没如实报 file 口径", info.mode);
    else ok("VK-11 不可用的保护器被 usableProtector 过滤：回落明文 vault.key、数据照常读写、探针如实报 file");
  }

  /* ============ VK-12 静态锚点：桌面那两份 vault 都接了钥匙串 ============
   *
   * 现场口径：R-A3-6h 只把「桌面自己的密钥」接上了钥匙串，中转那两把 token 走的
   * 是模块顶层 `createSecretVault(REPO_ROOT)`（没传 protector）—— 锁了前门忘了后门。
   * 这条钉三件事：两处都传 protector、顶层不再无保护器构造、不可用的保护器不缓存。 */
  {
    // 先剥注释再判 —— 上面那段 KDoc 里就写着「之前这里是模块顶层直接
    // `createSecretVault(REPO_ROOT)`」，不剥的话锚点会被自己的说明文字撑红
    // （今天第三次踩：RBI-06 / AB-21 都是同一个病，注释和被注释的代码长得一样）。
    const mainSrc = fs
      .readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const anchors = [
      [/function relayVaultNow\(\)/.test(mainSrc), "中转 vault 没有惰性入口 relayVaultNow()"],
      [/createSecretVault\(REPO_ROOT, \{\s*\n\s*protector: resolveVaultProtector\(\)/.test(mainSrc),
        "中转 vault 没接 protector（锁了前门忘了后门）"],
      [/createSecretVault\(REPO_ROOT\)/.test(mainSrc) === false, "还有无保护器的 createSecretVault(REPO_ROOT) 顶层构造"],
      // 不可用的保护器不许缓存：否则 ready 之前问一次，整台机器永久退化成明文。
      [/secretVaultProtector\.available === true/.test(mainSrc), "resolveVaultProtector 会把「不可用」也缓存下来"],
      [mainSrc.includes("vault: relayVaultNow()"), "调用点没换成惰性入口"],
    ];
    const failed = anchors.filter(([cond]) => !cond).map(([, why]) => why);
    if (failed.length) bad("VK-12 静态锚点失配：" + failed.join("；"));
    else ok("VK-12 两份 vault 都接钥匙串：relayVaultNow 惰性 + protector 传入 + 无顶层无保护器构造 + 不可用不缓存");
  }

  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* 清理尽力而为 */ }
  }

  console.log("prove_vault_keychain: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ SETUP-FAIL：" + ((e && e.stack) || e));
  console.log("prove_vault_keychain: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(2);
});
