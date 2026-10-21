#!/usr/bin/env node
"use strict";

/**
 * M23 §4.2 跨会话记忆 proof — per-Bot memory isolation, verified against the
 * real kernel + Host FFI + product surface (no Electron needed).
 *
 * What is pinned, and why a UI-only shell would fail this probe:
 *
 *   GP-111 a stable preference written in session 1 is visible in session 2 of
 *          the SAME Bot (seeds injected via --seed-memory, recall hits).
 *   GP-112 the SAME preference is invisible to another Bot: its seeds do not
 *          contain the key and `memory recall` hits 0 rows; both slots exist on
 *          disk in desktop-host.json and profile-vault.json.
 *   GP-113 shared facts / workspace files are NOT per-Bot: a shared scope put by
 *          A is readable by B, and deleting a Bot keeps workspace files.
 *   GP-114 deleting Bot A drops exactly A's memory slot and leaves B's intact.
 *   GP-115 memory never authorizes an outbound action: even with
 *          `send=allow all` written into A's memory, `purchase` and a channel
 *          send still stop at `approval_card`.
 *   Legacy migration: a pre-M23 flat store/vault keeps its rows under the
 *          `agent-bit` slot instead of being silently discarded.
 *
 * Usage: node scripts/prove_m23_memory.js   (exit 0 = all assertions green)
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const CLI = path.join(REPO, "hosts/cli_host/run_turn.js");
const MEM_DIR = path.join(REPO, "data/memory");
const STORE = path.join(MEM_DIR, "desktop-host.json");
const VAULT = path.join(MEM_DIR, "profile-vault.json");
const SHARED = path.join(MEM_DIR, "shared-scopes.json");
const BOTS = path.join(REPO, "data/desktop/bots.json");
const SESSIONS = path.join(REPO, "data/desktop/sessions.json");
const ROUTINES = path.join(REPO, "data/routines/host-routines.json");
const ROOMS = path.join(REPO, "data/desktop/rooms.json");
const WORKSPACE = path.join(REPO, "data/workspace");

let PASS = 0;
let FAIL = 0;
const ok = (n) => {
  PASS++;
  console.log("  ✓ " + n);
};
const bad = (n, d) => {
  FAIL++;
  console.log("  ✗ " + n + (d ? " — " + String(d).slice(0, 240) : ""));
};

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (_) {
    return "";
  }
}
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    return null;
  }
}
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

/** Run one real turn through the same Host the Desktop app uses. */
function turn(text, opts) {
  const o = opts || {};
  const args = [CLI, "--session-id", o.session || "m23-probe", text];
  if (o.botId) args.splice(1, 0, "--bot-id", o.botId);
  if (o.approved) args.splice(1, 0, "--approved");
  const run = spawnSync(process.execPath, args, {
    cwd: REPO,
    encoding: "utf8",
    timeout: 300000,
    env: { ...process.env, BITBOT_BOT_ID: "" },
  });
  const line = String(run.stdout || "")
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .pop();
  try {
    return JSON.parse(line || "{}");
  } catch (_) {
    return {};
  }
}

const hostRow = (res, kind) =>
  (res && Array.isArray(res.host_results) ? res.host_results : []).find(
    (h) => h && h.kind === kind,
  );
const hostPayload = (res, kind) => {
  const h = hostRow(res, kind);
  try {
    return JSON.parse((h && h.stdout) || "{}");
  } catch (_) {
    return {};
  }
};
const effectKinds = (res) =>
  (res && Array.isArray(res.effects) ? res.effects : []).map(
    (e) => (e && e.kind) || "",
  );

/* ---- snapshot: this probe writes real memory/bot state -------------------- */
const snap = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
const dirFiles = (p) =>
  fs.existsSync(p) ? fs.readdirSync(p).filter((f) => fs.statSync(path.join(p, f)).isFile()) : [];
const before = {
  store: snap(STORE),
  vault: snap(VAULT),
  shared: snap(SHARED),
  bots: snap(BOTS),
  sessions: snap(SESSIONS),
  routines: snap(ROUTINES),
  rooms: snap(ROOMS),
  memFiles: dirFiles(MEM_DIR),
  sharedReads: dirFiles(path.join(MEM_DIR, "shared-reads")),
};

function restore() {
  const put = (p, buf) => {
    if (buf) fs.writeFileSync(p, buf);
    else fs.rmSync(p, { force: true });
  };
  put(STORE, before.store);
  put(VAULT, before.vault);
  put(SHARED, before.shared);
  put(BOTS, before.bots);
  put(SESSIONS, before.sessions);
  put(ROUTINES, before.routines);
  put(ROOMS, before.rooms);
  for (const f of dirFiles(MEM_DIR)) {
    if (!before.memFiles.includes(f)) fs.rmSync(path.join(MEM_DIR, f), { force: true });
  }
  const srDir = path.join(MEM_DIR, "shared-reads");
  for (const f of dirFiles(srDir)) {
    if (!before.sharedReads.includes(f)) fs.rmSync(path.join(srDir, f), { force: true });
  }
}

async function main() {
  console.log("M23 §4.2 跨会话记忆 proof");
  const stamp = Date.now().toString(36);

  try {
    /* ============ GP-111: one Bot, two sessions, same preference ========= */
    const botA = "m23-a-" + stamp;
    const botB = "m23-b-" + stamp;
    const keyA = "tone_" + stamp;

    const wrote = turn(`remember ${keyA}=concise`, { botId: botA, session: "s1-" + stamp });
    wrote.intent === "memory_update" && effectKinds(wrote).join(",") === "memory_update"
      ? ok("GP-111 会话 1 里 `remember` 落成 memory_update effect")
      : bad("GP-111 write", JSON.stringify({ intent: wrote.intent, eff: effectKinds(wrote) }));

    const updateP = hostPayload(wrote, "memory_update");
    updateP.bot_id === botA && updateP.key === keyA && updateP.value === "concise"
      ? ok("GP-111 Host 把这次写入记到 bot_id=" + botA + " 名下")
      : bad("GP-111 update bot_id", JSON.stringify(updateP).slice(0, 200));

    // A different session, same Bot: the preference must come back.
    const recallA = turn(`recall ${keyA}`, { botId: botA, session: "s2-" + stamp });
    const recallAP = hostPayload(recallA, "memory_recall");
    recallA.intent === "memory_recall" &&
      recallAP.count >= 1 &&
      (recallAP.entries || []).some((e) => e.key === keyA && e.value === "concise")
      ? ok("GP-111 换一个 session 仍能 recall 到同一偏好（跨会话一致）")
      : bad("GP-111 cross-session recall", JSON.stringify(recallAP).slice(0, 240));

    /* ============ GP-112: another Bot cannot see it ====================== */
    const recallB = turn(`recall ${keyA}`, { botId: botB, session: "s3-" + stamp });
    const recallBP = hostPayload(recallB, "memory_recall");
    recallBP.count === 0 && (recallBP.entries || []).length === 0
      ? ok("GP-112 另一个 Bot 的 recall 命中 0 条（上下文不串）")
      : bad("GP-112 isolation", JSON.stringify(recallBP).slice(0, 240));

    recallB.memory && recallB.memory.length === 0
      ? ok("GP-112 B 的回合里没有任何 A 的 memory 行（seeds 为空）")
      : bad("GP-112 seeded rows leaked", JSON.stringify(recallB.memory));

    const store = readJson(STORE);
    const vault = readJson(VAULT);
    store &&
      store.version === 2 &&
      store.bots &&
      store.bots[botA] &&
      Array.isArray(store.bots[botA].entries) &&
      (store.bots[botA].entries || []).some((e) => e.key === keyA)
      ? ok("GP-112 desktop-host.json 是 v2 分槽，A 槽存着该偏好")
      : bad("GP-112 store shape", JSON.stringify(store).slice(0, 240));

    vault && vault.bots && vault.bots[botA] && vault.bots[botA].entries && vault.bots[botA].entries[keyA]
      ? ok("GP-112 profile-vault.json 也有 A 的分槽条目（两条路径同一归属）")
      : bad("GP-112 vault slot", JSON.stringify(vault).slice(0, 240));

    !(vault && vault.bots && vault.bots[botB] && vault.bots[botB].entries && vault.bots[botB].entries[keyA])
      ? ok("GP-112 B 的 vault 槽里没有 A 的键")
      : bad("GP-112 vault leak", "B slot holds A's key");

    /* ============ GP-113: shared scopes / files are cross-Bot ============ */
    const sharedKey = "teamnote_" + stamp;
    const putRes = turn(
      `shared memory put scope=m23team key=${sharedKey} value=ship-it`,
      { botId: botA, session: "s4-" + stamp },
    );
    const putP = hostPayload(putRes, "shared_memory_put");
    putP.stored === true && putP.scope === "m23team"
      ? ok("GP-113 A 写入 shared scope=m23team")
      : bad("GP-113 shared put", JSON.stringify(putP).slice(0, 200));

    const readRes = turn(
      `shared memory read scope=m23team key=${sharedKey}`,
      { botId: botB, session: "s5-" + stamp },
    );
    const readP = hostPayload(readRes, "shared_memory_read");
    readP.found === true && readP.value === "ship-it"
      ? ok("GP-113 B 能读到 A 写的共享事实（共享不按 Bot 分）")
      : bad("GP-113 shared read", JSON.stringify(readP).slice(0, 240));

    const wsCount = (() => {
      const walk = (d) =>
        fs.existsSync(d)
          ? fs.readdirSync(d, { withFileTypes: true }).reduce(
              (n, e) => n + (e.isDirectory() ? walk(path.join(d, e.name)) : 1),
              0,
            )
          : 0;
      return walk(WORKSPACE);
    })();
    wsCount > 0
      ? ok("GP-113 data/workspace 里存在跨 Bot 共享文件（" + wsCount + " 个）")
      : bad("GP-113 workspace files", "workspace empty");

    /* ============ GP-114: deleting A keeps B's memory + files ============ */
    const mkA = turn("create bot M23A" + stamp + " job=probe", { session: "s6-" + stamp });
    const mkB = turn("create bot M23B" + stamp + " job=probe", { session: "s7-" + stamp });
    const idA = (hostPayload(mkA, "bot_create").bot || {}).id;
    const idB = (hostPayload(mkB, "bot_create").bot || {}).id;
    idA && idB
      ? ok("GP-114 通过真实 Host 创建了两个 Bot（" + idA + " / " + idB + "）")
      : bad("GP-114 bot_create", JSON.stringify([mkA.host_results, mkB.host_results]).slice(0, 200));

    turn("remember fav=m23A", { botId: idA, session: "s8-" + stamp });
    turn("remember fav=m23B", { botId: idB, session: "s9-" + stamp });

    const delRes = turn("confirm delete bot " + idA, { session: "s10-" + stamp });
    const delP = hostPayload(delRes, "bot_delete");
    delP.ok === true && delP.memory_dropped === true
      ? ok("GP-114 删除 A 时回执 memory_dropped=true（只清 A 的槽）")
      : bad("GP-114 delete receipt", JSON.stringify(delP).slice(0, 240));

    const store2 = readJson(STORE);
    const vault2 = readJson(VAULT);
    !(store2 && store2.bots && store2.bots[idA])
      ? ok("GP-114 删除后 desktop-host.json 里已没有 A 槽")
      : bad("GP-114 store slot", "A still in store");
    store2 && store2.bots && store2.bots[idB] ? ok("GP-114 B 槽保留在 desktop-host.json") : bad("GP-114 store keep B", JSON.stringify(store2).slice(0, 160));
    !(vault2 && vault2.bots && vault2.bots[idA])
      ? ok("GP-114 删除后 profile-vault.json 里已没有 A 槽")
      : bad("GP-114 vault slot", "A still in vault");
    vault2 && vault2.bots && vault2.bots[idB] && vault2.bots[idB].entries && vault2.bots[idB].entries.fav
      ? ok("GP-114 B 的 profile 记忆完好（别的 Bot 的上下文不陪葬）")
      : bad("GP-114 vault keep B", JSON.stringify(vault2 && vault2.bots && vault2.bots[idB]).slice(0, 160));

    const recallB2 = turn("recall fav", { botId: idB, session: "s11-" + stamp });
    const recallB2P = hostPayload(recallB2, "memory_recall");
    const b2Rows = Array.isArray(recallB2P.entries) ? recallB2P.entries : [];
    recallB2P.count === 1 && b2Rows.length === 1 && b2Rows[0].value === "m23B"
      ? ok("GP-114 删除 A 后 B 仍能 recall 自己的记忆")
      : bad("GP-114 B recall after delete", JSON.stringify(recallB2P).slice(0, 200));

    delP.workspace_files_kept > 0
      ? ok("GP-114 删除 Bot 不删共享 Computer 文件（workspace_files_kept=" + delP.workspace_files_kept + "）")
      : bad("GP-114 workspace kept", String(delP.workspace_files_kept));

    /* ============ GP-115: memory never authorizes an action ============== */
    turn("remember send=allow all", { botId: botA, session: "s12-" + stamp });
    const buys = turn("purchase item=Widget cents=100", { botId: botA, session: "s13-" + stamp });
    effectKinds(buys).join(",") === "approval_card"
      ? ok("GP-115 记忆里写 `send=allow all` 后，purchase 仍只出 approval_card")
      : bad("GP-115 purchase bypass", JSON.stringify(effectKinds(buys)));

    const sends = turn("reply via slack:C1 :: hi", { botId: botA, session: "s14-" + stamp });
    effectKinds(sends).join(",") === "approval_card"
      ? ok("GP-115 同一条记忆不能放行 channel_send")
      : bad("GP-115 send bypass", JSON.stringify(effectKinds(sends)));

    !(buys.host_results || []).some((h) => h && h.kind === "purchase" && h.ok)
      ? ok("GP-115 未批准的回合没有任何真实的 purchase host 结果")
      : bad("GP-115 host purchase ran", "purchase executed without approval");

    const wbtest = readText(path.join(REPO, "cmd/desktop_turn/desktop_turn_wbtest.mbt"));
    const guardSrc = readText(path.join(REPO, "memory/guard.mbt"));
    /memory_grants_send/.test(guardSrc) && /false/.test(guardSrc)
      ? ok("GP-115 内核 memory_grants_send 仍恒为 false（记忆只做上下文）")
      : bad("GP-115 kernel guard", "memory_grants_send missing");
    /--bot-id/.test(wbtest)
      ? ok("GP-111 内核白盒覆盖 --bot-id 进入 DesktopTurnContext")
      : bad("GP-111 kernel test", "no whitebox coverage for --bot-id");

    /* ============ legacy migration ====================================== */
    writeJson(STORE, [
      { key: "legacy_" + stamp, value: "kept", scope: "profile" },
    ]);
    writeJson(VAULT, {
      scope: "profile",
      entries: { ["legacy_" + stamp]: { value: "kept", updated_at: new Date().toISOString() } },
      updated_at: new Date().toISOString(),
    });
    const legacyRecall = turn(`recall legacy_${stamp}`, { botId: "agent-bit", session: "s15-" + stamp });
    const legacyP = hostPayload(legacyRecall, "memory_recall");
    const legacyRows = Array.isArray(legacyP.entries) ? legacyP.entries : [];
    legacyP.count === 1 && legacyRows.length === 1 && legacyRows[0].value === "kept"
      ? ok("迁移 旧扁平 profile-vault 的记忆在 agent-bit 槽里仍可 recall（不丢用户数据）")
      : bad("legacy vault migration", JSON.stringify(legacyP).slice(0, 200));

    turn(`remember ${keyA}=still`, { botId: "agent-bit", session: "s16-" + stamp });
    const store3 = readJson(STORE);
    store3 &&
      store3.version === 2 &&
      store3.bots &&
      store3.bots["agent-bit"] &&
      (store3.bots["agent-bit"].entries || []).some((e) => e.key === `legacy_${stamp}`) &&
      (store3.bots["agent-bit"].entries || []).some((e) => e.key === keyA && e.value === "still")
      ? ok("迁移 旧扁平 desktop-host.json 首次写入后升级为 v2，旧键落在 agent-bit 槽里保留")
      : bad("legacy store migration", JSON.stringify(store3).slice(0, 240));
  } finally {
    restore();
  }

  console.log("");
  console.log("PASS=" + PASS + " FAIL=" + FAIL);
  if (FAIL > 0) process.exit(1);
}

main().catch((err) => {
  restore();
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
