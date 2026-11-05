"use strict";

/**
 * GP-99/100/101/102 — Host-side secret vault (official Grok spec §8.3).
 *
 * The renderer never handles the value beyond the <input type="password"> it
 * was typed into: it hands the plaintext to this module over IPC, gets back a
 * handle + a `****last4` mask, and shows `[REDACTED]` in the transcript.
 *
 * Two destinations, both Host-owned:
 *   data/secrets/vault.json  name → { value_enc, masked, updated_at }  (mode 0600)
 *   hosts/desktop/.env.local optional, only when the caller passes env_key
 *
 * The value is AES-256-GCM encrypted at rest with a Host-generated key
 * (data/secrets/vault.key, mode 0600), so GP-102's "grep data/ finds no
 * plaintext" holds even for the vault file itself. `resolve()` is the only
 * decrypting reader and never crosses IPC.
 *
 * Honest shape: `status()` returns masks only — never the value, not even to
 * the main process's own UI. `submit()` returns the handle; a caller that tries
 * to read `.value` off the response gets undefined by construction.
 *
 * ---------------------------------------------------------------------------
 * R-A3-6h — 可注入的密钥保护器（protector）
 * ---------------------------------------------------------------------------
 * 历史现状：`vault.key` 是**明文** 32 字节密钥，和 `vault.json` 并排躺在磁盘
 * 上（都是 0600）。0600 只挡住同机其他用户，挡不住「本机已被完全控制」。
 * 这里加一层**可选**保护器，让密钥本身也以密文落盘：
 *
 *   opts.protector = {
 *     available: true,
 *     id: "os-keychain",                    // Electron safeStorage / 测试假件
 *     protect(plainKeyHex) -> Buffer,       // 落盘字节（可以是密文）
 *     unprotect(bytes) -> plainKeyHex,      // 还原成 64 字符 hex
 *   }
 *
 * 三条硬约束：
 *   1. 没传 protector（或 available=false）⇒ **行为与历史完全一致**：明文
 *      `vault.key` 0600。既有门禁/既有调用不受影响。
 *   2. 传了可用 protector ⇒ 只落 `vault.key.protected`（0600），不再写明文；
 *      磁盘上若已有旧明文 `vault.key`，构造 vault 时**自动迁移**：读明文 →
 *      protector 保护 → 写 `.protected` → 回读校验 → 删除旧明文。校验不过
 *      就不删，宁可多留一份明文也不让旧密文变成永久不可读。
 *   3. `unprotect` 抛错（换机器 / 钥匙串条目被删）⇒ **绝不静默生成新密钥**。
 *      那会把所有旧密文变成永久不可读的垃圾，而用户会以为只是「又要重填一次」。
 *      这里改成：`resolve()` 返回 null（区别于「没有这个条目」的空串 ""），
 *      `submit()` 返回 `{ok:false, code:"vault_key_unavailable"}`，并通过
 *      `keyStatus()` / `inspectKeyStorage()` 如实报告。是否让用户重填、是否
 *      提示「钥匙串条目丢了」，由调用方决定。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const secretProtocol = require("./secret_protocol");

/**
 * 明确的失败标识：密钥在，但解不开（钥匙串不可用 / 条目被删 / 换机器）。
 * 调用方用这个 code 区分「没配置」和「配了但密钥丢了」——这两种情况的
 * 用户提示必须不同，否则会误导用户重填、覆盖掉唯一还能恢复的密文。
 */
const VAULT_KEY_UNAVAILABLE = "vault_key_unavailable";

class VaultKeyUnavailableError extends Error {
  constructor(message, cause) {
    super(message || "vault key unavailable");
    this.name = "VaultKeyUnavailableError";
    this.code = VAULT_KEY_UNAVAILABLE;
    if (cause) this.cause = cause;
  }
}

function isVaultKeyUnavailable(err) {
  return Boolean(
    err && (err.code === VAULT_KEY_UNAVAILABLE || err instanceof VaultKeyUnavailableError),
  );
}

function messageOf(err) {
  return String((err && err.message) || err);
}

/** 兼容两种入口：createSecretVault(root, opts) 与 createSecretVault({...opts, root})。 */
function normalizeArgs(rootOrOpts, maybeOpts) {
  if (rootOrOpts && typeof rootOrOpts === "object") {
    const merged = Object.assign({}, rootOrOpts, maybeOpts || {});
    const root = merged.root || merged.repoRoot || process.cwd();
    return { root: path.resolve(root), opts: merged };
  }
  return { root: path.resolve(rootOrOpts), opts: maybeOpts || {} };
}

/** 只有「声称可用」且两个方法都在的 protector 才改路径；其余一律当没传。 */
function usableProtector(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.available !== true) return null;
  if (typeof candidate.protect !== "function") return null;
  if (typeof candidate.unprotect !== "function") return null;
  return candidate;
}

function resolvePaths(root, opts) {
  /* The vault holds user secrets -> OS user-data dir when packaged. */
  const dataRoot = opts.dataRoot ? path.resolve(opts.dataRoot) : path.join(root, "data");
  const defaultVaultPath = path.join(dataRoot, "secrets", "vault.json");
  // Test/probe hook: redirect the whole store so a probe never touches real data.
  const file = opts.vaultPath ? String(opts.vaultPath) : defaultVaultPath;

  // Key lives beside the vault (same directory, same 0600 discipline), so a
  // probe that redirects the vault also gets an isolated throwaway key.
  const declaredKey = opts.keyPath
    ? String(opts.keyPath)
    : path.join(path.dirname(file), "vault.key");

  // 调用方显式给了 *.protected 也认，但绝不叠成 .protected.protected。
  const alreadyProtected = /\.protected$/.test(declaredKey);
  const plainKeyFile = alreadyProtected
    ? declaredKey.slice(0, -".protected".length)
    : declaredKey;
  const protectedKeyFile = alreadyProtected ? declaredKey : declaredKey + ".protected";

  const protector = usableProtector(opts.protector);
  return {
    root,
    file,
    protector,
    plainKeyFile,
    protectedKeyFile,
    // 实际生效的密钥文件：接了保护器就是 .protected，否则沿用明文口径。
    keyFile: protector ? protectedKeyFile : plainKeyFile,
  };
}

function writeSecretFile(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, data, { mode: 0o600 });
  try {
    fs.chmodSync(target, 0o600);
  } catch (_) {
    /* best effort on filesystems without POSIX modes (Windows) */
  }
}

/** 64 字符 hex ⇔ 32 字节。任何别的形状都当「密钥没拿到」。 */
function decodeKeyHex(hex) {
  const s = String(hex == null ? "" : hex).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(s)) return null;
  const b = Buffer.from(s, "hex");
  return b.length === 32 ? b : null;
}

/**
 * 只读探针：如实说出「密钥有没有离开磁盘」。
 *   mode             "os-keychain"（接了保护器）| "file"（明文口径）
 *   keyFile          实际生效的密钥文件
 *   migrated         true = 已只剩受保护密钥（首次生成或由旧明文迁移而来）
 *   plaintextOnDisk  磁盘上此刻是否还有明文 `vault.key`
 * 注意：这里只做 stat，不解密、不生成、不改任何文件。
 */
function inspectKeyStorage(rootOrOpts, maybeOpts) {
  const { root, opts } = normalizeArgs(rootOrOpts, maybeOpts);
  return describeKeyStorage(resolvePaths(root, opts));
}

function describeKeyStorage(p) {
  const plaintextOnDisk = fs.existsSync(p.plainKeyFile);
  const protectedExists = fs.existsSync(p.protectedKeyFile);
  return {
    mode: p.protector ? String(p.protector.id || "os-keychain") : "file",
    keyFile: p.protector ? p.protectedKeyFile : p.plainKeyFile,
    migrated: Boolean(p.protector && protectedExists && !plaintextOnDisk),
    plaintextOnDisk,
  };
}

/**
 * 给 Electron 用的工厂。**不 require electron**，纯 Node 下也能 require 本模块。
 * 工厂本身永不抛：safeStorage 缺失 / 后端坏掉 ⇒ available=false，调用方据此
 * 回落到明文口径（至少不会把桌面拖死）。
 * 单次 protect/unprotect 失败则抛 VaultKeyUnavailableError —— 那必须让 vault
 * 知道「这把锁现在打不开」，而不是写一份坏密文或悄悄造一把新钥匙。
 */
function createSafeStorageProtector(safeStorage) {
  let available = false;
  try {
    available = Boolean(
      safeStorage &&
        typeof safeStorage.isEncryptionAvailable === "function" &&
        safeStorage.isEncryptionAvailable(),
    );
  } catch (_) {
    available = false; /* Linux 无 keyring / 后端异常：按不可用处理，不抛 */
  }

  return {
    id: "os-keychain",
    available,
    protect(plainKeyHex) {
      if (!available) throw new VaultKeyUnavailableError("os keychain not available");
      let out;
      try {
        out = safeStorage.encryptString(String(plainKeyHex));
      } catch (e) {
        throw new VaultKeyUnavailableError(
          "safeStorage.encryptString failed: " + messageOf(e),
          e,
        );
      }
      if (!Buffer.isBuffer(out) || out.length === 0) {
        throw new VaultKeyUnavailableError("safeStorage.encryptString returned no bytes");
      }
      return out;
    },
    unprotect(bytes) {
      if (!available) throw new VaultKeyUnavailableError("os keychain not available");
      try {
        return String(safeStorage.decryptString(Buffer.from(bytes)));
      } catch (e) {
        throw new VaultKeyUnavailableError(
          "safeStorage.decryptString failed: " + messageOf(e),
          e,
        );
      }
    },
  };
}

function createSecretVault(rootOrOpts, maybeOpts) {
  const { root, opts } = normalizeArgs(rootOrOpts, maybeOpts);
  const p = resolvePaths(root, opts);
  const protector = p.protector;
  const file = p.file;

  // 最近一次「密钥打不开」的原因，供 keyStatus() 如实回报（不含密钥本身）。
  let lastKeyError = null;
  let migratedInThisProcess = false;

  function loadPlainKey() {
    try {
      if (fs.existsSync(p.plainKeyFile)) {
        const k = fs.readFileSync(p.plainKeyFile);
        if (k.length === 32) return k;
      }
    } catch (_) {
      /* fall through and mint a fresh key */
    }
    const k = crypto.randomBytes(32);
    writeSecretFile(p.plainKeyFile, k);
    return k;
  }

  function readProtectedKey() {
    let raw;
    try {
      raw = fs.readFileSync(p.protectedKeyFile);
    } catch (e) {
      throw new VaultKeyUnavailableError(
        "vault.key.protected unreadable: " + messageOf(e),
        e,
      );
    }
    let hex;
    try {
      hex = protector.unprotect(raw);
    } catch (e) {
      // 换机器 / 钥匙串条目被删。绝不在这里造新密钥：旧密文只有这一把锁能开。
      throw new VaultKeyUnavailableError(
        "protector.unprotect failed: " + messageOf(e),
        e,
      );
    }
    const k = decodeKeyHex(hex);
    if (!k) {
      throw new VaultKeyUnavailableError(
        "protector.unprotect did not return a 32-byte hex key",
      );
    }
    return k;
  }

  /**
   * 旧明文 → 受保护。顺序刻意是「先写、再回读校验、最后删」：
   * 校验不过就抛错并**保留明文**，用户至少还能退回去手动救数据。
   */
  function migratePlainKey() {
    let k = null;
    try {
      const b = fs.readFileSync(p.plainKeyFile);
      if (b.length === 32) k = b;
    } catch (_) {
      return null;
    }
    if (!k) return null;

    let wrapped;
    try {
      wrapped = protector.protect(k.toString("hex"));
    } catch (e) {
      throw new VaultKeyUnavailableError(
        "protector.protect failed during migration: " + messageOf(e),
        e,
      );
    }
    if (!Buffer.isBuffer(wrapped) || wrapped.length === 0) {
      throw new VaultKeyUnavailableError(
        "protector.protect returned no bytes during migration",
      );
    }
    writeSecretFile(p.protectedKeyFile, wrapped);

    let back = null;
    try {
      back = protector.unprotect(fs.readFileSync(p.protectedKeyFile));
    } catch (_) {
      back = null;
    }
    const roundTrip = decodeKeyHex(back);
    if (!roundTrip || !roundTrip.equals(k)) {
      throw new VaultKeyUnavailableError(
        "migration round-trip failed; plaintext key kept on disk",
      );
    }

    try {
      fs.unlinkSync(p.plainKeyFile);
      migratedInThisProcess = true;
    } catch (_) {
      // 删不掉就留着：inspectKeyStorage().plaintextOnDisk 会如实报 true，
      // 但密钥本身已经可用，不因此拒绝服务。
    }
    return k;
  }

  function loadKey() {
    if (!protector) return loadPlainKey();

    if (fs.existsSync(p.protectedKeyFile)) {
      const k = readProtectedKey();
      // 迁移中途崩过（.protected 写完但旧明文还没删）：以 .protected 为准，
      // 只有明文与它逐字节相同时才删；不一致就保留并让探针继续报
      // plaintextOnDisk=true —— 绝不猜哪一份才是对的。
      try {
        if (fs.existsSync(p.plainKeyFile)) {
          const legacy = fs.readFileSync(p.plainKeyFile);
          if (legacy.length === 32 && legacy.equals(k)) {
            fs.unlinkSync(p.plainKeyFile);
            migratedInThisProcess = true;
          }
        }
      } catch (_) {
        /* 删不掉就留着，不影响服务 */
      }
      return k;
    }

    const migrated = migratePlainKey();
    if (migrated) return migrated;

    // 磁盘上根本没有密钥：首次生成。这里**只**在没有旧密文可救时才发生。
    const k = crypto.randomBytes(32);
    let wrapped;
    try {
      wrapped = protector.protect(k.toString("hex"));
    } catch (e) {
      throw new VaultKeyUnavailableError(
        "protector.protect failed: " + messageOf(e),
        e,
      );
    }
    if (!Buffer.isBuffer(wrapped) || wrapped.length === 0) {
      throw new VaultKeyUnavailableError("protector.protect returned no bytes");
    }
    writeSecretFile(p.protectedKeyFile, wrapped);
    return k;
  }

  // 加载即迁移：构造 vault 时就把旧明文收拾干净，而不是等第一次写入。
  // 只在「没有 .protected 但有明文」时做，避免用另一把钥匙覆盖正在用的密文。
  if (protector && !fs.existsSync(p.protectedKeyFile) && fs.existsSync(p.plainKeyFile)) {
    try {
      migratePlainKey();
    } catch (e) {
      if (isVaultKeyUnavailable(e)) lastKeyError = e;
      else throw e;
    }
  }

  /* AES-256-GCM: `iv.tag.ciphertext`, all base64. Nothing recoverable by grep. */
  function seal(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", loadKey(), iv);
    const enc = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    return [
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      enc.toString("base64"),
    ].join(".");
  }

  function decryptWith(key, sealed) {
    const parts = String(sealed || "").split(".");
    if (parts.length !== 3) return "";
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(parts[0], "base64"),
      );
      decipher.setAuthTag(Buffer.from(parts[1], "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[2], "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch (_) {
      // Wrong/lost key or tampered entry: report "no value", never garbage.
      return "";
    }
  }

  function load() {
    try {
      if (!fs.existsSync(file)) return { version: 1, entries: {} };
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!raw || typeof raw !== "object") return { version: 1, entries: {} };
      if (!raw.entries || typeof raw.entries !== "object") raw.entries = {};
      return raw;
    } catch (_) {
      return { version: 1, entries: {} };
    }
  }

  function save(state) {
    writeSecretFile(file, JSON.stringify(state, null, 2));
  }

  function newHandle() {
    return "sec-" + crypto.randomBytes(6).toString("hex");
  }

  /** Public view of one entry — mask only, never the plaintext. */
  function publicEntry(name, entry) {
    return {
      name,
      label: entry.label || name,
      handle: entry.handle,
      masked: entry.masked,
      env_key: entry.env_key || "",
      updated_at: entry.updated_at,
      // Explicit honesty: the renderer is never handed a value.
      value: null,
      plaintext_available: false,
    };
  }

  /** 密钥存储现状 + 最近一次失败原因（永远不会回密钥本身）。 */
  function keyStatus() {
    const info = describeKeyStorage(p);
    const out = Object.assign({ ok: true, migrated_this_process: migratedInThisProcess }, info);
    if (lastKeyError) {
      out.ok = false;
      out.code = VAULT_KEY_UNAVAILABLE;
      out.error = lastKeyError.message;
    }
    return out;
  }

  /**
   * submit({name,label,value,env_key}) -> {ok, handle, masked, name, errors}
   * Validation happens on the shared protocol so the probe asserts the same code.
   */
  function submit(payload) {
    const v = secretProtocol.validateSubmit(payload);
    if (!v.ok) {
      return {
        ok: false,
        refused: true,
        error: v.errors.join("; "),
        errors: v.errors,
        handle: "",
        masked: "",
        value_echoed: false,
      };
    }
    let valueEnc;
    try {
      // 先加密再动 state：密钥打不开时，vault.json 一个字节都不该改。
      valueEnc = seal(v.value);
    } catch (e) {
      if (!isVaultKeyUnavailable(e)) throw e;
      lastKeyError = e;
      return {
        ok: false,
        refused: true,
        code: VAULT_KEY_UNAVAILABLE,
        error: e.message,
        errors: [e.message],
        handle: "",
        masked: "",
        value_echoed: false,
      };
    }
    const state = load();
    const handle = newHandle();
    const entry = {
      handle,
      label: v.label,
      masked: secretProtocol.mask(v.value),
      env_key: v.env_key,
      // Sealed for Host use only (credential fill / provider call). Every read
      // surface in this file strips it; `resolve()` is the only opener.
      value_enc: valueEnc,
      updated_at: new Date().toISOString(),
    };
    state.entries[v.name] = entry;
    save(state);
    return {
      ok: true,
      name: v.name,
      handle,
      masked: entry.masked,
      env_key: v.env_key,
      mode: "host_secret_vault",
      // The transcript bubble is rendered from this constant, not the value.
      display: secretProtocol.REDACTED,
      value_echoed: false,
      pretend_secret_view: false,
    };
  }

  /** status() -> name → {handle, masked, env_key} for the Secrets panel. */
  function status() {
    const state = load();
    const entries = {};
    for (const [name, entry] of Object.entries(state.entries || {})) {
      entries[name] = publicEntry(name, entry || {});
    }
    return {
      ok: true,
      path: path.relative(root, file),
      entries,
      value_echoed: false,
      // 掩码不需要解密，所以密钥丢了也能显示；顺手告诉界面密钥的状态。
      key_storage: keyStatus(),
    };
  }

  /**
   * Host-only read for credential fill; never crosses the IPC boundary.
   * 返回值三态：
   *   "…"  正常解出
   *   ""   没有这个条目（或密文被改坏），沿用历史口径
   *   null 密钥打不开（protector.unprotect 失败）。**刻意不是 ""**：
   *        空串会让上层以为「没配」，null + keyStatus().code 才能提示
   *        「钥匙串条目丢了，别重填覆盖」。
   */
  function resolve(name) {
    const state = load();
    const entry = (state.entries || {})[String(name || "")];
    if (!entry) return "";
    // Legacy plaintext entries (pre-encryption) are migrated on first read.
    if (entry.value_enc) {
      let key;
      try {
        key = loadKey();
      } catch (e) {
        if (!isVaultKeyUnavailable(e)) throw e;
        lastKeyError = e;
        return null;
      }
      return decryptWith(key, entry.value_enc);
    }
    if (entry.value) return String(entry.value);
    return "";
  }

  function remove(name) {
    const state = load();
    const key = String(name || "");
    if (!state.entries || !state.entries[key]) {
      return { ok: false, error: "unknown secret", removed: false };
    }
    delete state.entries[key];
    save(state);
    return { ok: true, name: key, removed: true };
  }

  return { submit, status, resolve, remove, keyStatus, vaultPath: file, keyPath: p.keyFile };
}

module.exports = {
  createSecretVault,
  createSafeStorageProtector,
  inspectKeyStorage,
  VAULT_KEY_UNAVAILABLE,
  VaultKeyUnavailableError,
  isVaultKeyUnavailable,
};
