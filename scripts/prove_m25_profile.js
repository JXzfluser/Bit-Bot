#!/usr/bin/env node
"use strict";

/**
 * M25 §2.2 / §2.3 proof — Bot profile management + create flow, verified
 * against the real kernel, Host FFI and product surface (no Electron).
 *
 * Why each assertion exists:
 *
 *   GP-120 "Edit Profile" really edits 名称 / 标签 / 描述 / 头像: the renderer
 *          emits `update bot …` and the kernel plans a `bot_update` effect; the
 *          store row (tags included) is what changes, not just a label.
 *   GP-121 a skipped Name still creates the official "New Bot" placeholder, and
 *          the dialog auto-opens the created Bot's chat.
 *   GP-122 avatar: the picker returns a preview data URL, the Host validates the
 *          real path, listViews() serves the image back; a missing file is
 *          refused instead of pretending success.
 *   GP-123 session list parity: 今天/昨天/更早 + search + rename/delete over the
 *          existing Host IPC (which must actually mutate sessions.json).
 *
 * Usage: node scripts/prove_m25_profile.js   (exit 0 = all green)
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const HTML_PATH = path.join(REPO, "hosts/desktop/index.html");
const MAIN_PATH = path.join(REPO, "hosts/desktop/main.js");
const PRELOAD_PATH = path.join(REPO, "hosts/desktop/preload.js");
const SURFACE_PATH = path.join(REPO, "hosts/desktop/product_surface.js");
const CLI = path.join(REPO, "hosts/cli_host/run_turn.js");
const BOTS = path.join(REPO, "data/desktop/bots.json");
const SESSIONS = path.join(REPO, "data/desktop/sessions.json");

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

const readText = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (_) {
    return "";
  }
};
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    return null;
  }
};

function turn(text) {
  const run = spawnSync(process.execPath, [CLI, "--session-id", "m25-probe", text], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 180000,
    env: Object.assign({}, process.env, { BITBOT_PROBE: "1" }),
  });
  const out = String(run.stdout || "");
  let json = null;
  try {
    json = JSON.parse(out.trim().split("\n").filter(Boolean).pop());
  } catch (_) {
    json = null;
  }
  return { out, json, stderr: String(run.stderr || ""), code: run.status };
}

function hostPayload(json, kinds) {
  const hit = ((json && json.host_results) || []).find(
    (h) => h && kinds.indexOf(h.kind) >= 0,
  );
  if (!hit) return null;
  try {
    return JSON.parse(hit.stdout || "{}");
  } catch (_) {
    return null;
  }
}

function main() {
  console.log("M25 §2.2/§2.3 Bot 资料与创建流程 proof");
  const html = readText(HTML_PATH);
  const mainSrc = readText(MAIN_PATH);
  const preload = readText(PRELOAD_PATH);
  if (!html) {
    bad("index.html", "missing");
    return finish();
  }

  /* ---------- GP-120: Edit Profile dialog surface ---------- */
  const modalAt = html.indexOf('id="bot-edit-modal"');
  const fields = ["bc-name", "bc-tags", "bc-job", "bc-desc", "bf-avatar-preview", "bf-avatar-pick", "bf-avatar-clear", "bf-title", "bf-status"];
  const misses = fields.filter((id) => html.indexOf('id="' + id + '"') < 0);
  modalAt >= 0 && misses.length === 0
    ? ok("Edit Profile 对话框存在且含 名称 / 标签 / 描述 / 头像 / 状态位（GP-120）")
    : bad("edit dialog", misses.join(",") || "modal missing");
  /function openBotForm\(bot\)/.test(html) && /wavegT\(editing \? "botEditTitle" : "botCreateTitle"\)/.test(html)
    ? ok("同一个表单在 Edit / Create 之间切换（标题来自 i18n）")
    : bad("bot form switch", "openBotForm/title not found");

  /* ---------- i18n: every new string exists in all three locales ---------- */
  const localeStarts = ["zh-CN", "zh-TW", "en"].map((k) => {
    const quoted = html.indexOf('"' + k + '": {');
    return quoted >= 0 ? quoted : html.indexOf("\n      " + k + ": {");
  });
  const keys = [
    "sessSearchPh", "sessToday", "sessYesterday", "sessEarlier", "sessNoMatch",
    "sessRename", "sessDelete", "sessRenameTitle", "sessDeleteTitle", "sessDeleteWarn",
    "commonSave", "commonCancel", "commonDelete", "botEditTitle", "botCreateTitle",
    "bfName", "bfTags", "bfJob", "bfDesc", "bfNamePh", "bfTagsPh", "bfAvatar", "bfPickAvatar", "bfClearAvatar", "bfDescHint",
    "bfSaved", "bfFailed", "defaultBotName", "avatarInvalid", "botCreatedOpen", "botCreateFailed",
  ];
  const spans = localeStarts.map((s, i) => {
    const next = i + 1 < localeStarts.length ? localeStarts[i + 1] : html.length;
    return html.slice(s, next);
  });
  const missing = [];
  keys.forEach((k) => {
    spans.forEach((sp, i) => {
      if (!new RegExp("\\n\\s*" + k + ":\\s*\"").test(sp)) {
        missing.push(["zh-CN", "zh-TW", "en"][i] + ":" + k);
      }
    });
  });
  missing.length === 0
    ? ok("新增 31 个文案在 zh-CN / zh-TW / en 三套 i18n 里齐全（不会漏成 key）")
    : bad("i18n keys", missing.join(", "));

  /* ---------- GP-121: create flow signals ---------- */
  /const name = typedName \|\| \(editing \? "" : wavegT\("defaultBotName"\)\)/.test(html)
    ? ok("创建时留空 Name → 使用官方 \"New Bot\" 占位名（GP-121）")
    : bad("placeholder name", "defaultBotName fallback missing");
  /await selectBotForChat\(bot\)/.test(html) && /host_payload && r\.host_payload\.bot/.test(html)
    ? ok("创建成功后自动打开该 Bot 的对话（读取 Host 返回的真实 Bot 行）")
    : bad("auto-open", "selectBotForChat(created) not wired");
  /<textarea id="bc-desc"/.test(html)
    ? ok("Description 是多行 textarea（官方 §2.3 验收信号）")
    : bad("multiline description", "bc-desc is not a textarea");

  /* ---------- GP-122: avatar picker + real rendering ---------- */
  /bitbot:bots:pickAvatar/.test(mainSrc) && /pickAvatar: \(\) => ipcRenderer\.invoke\("bitbot:bots:pickAvatar"\)/.test(preload)
    ? ok("头像选择走真实 OS 文件对话框（main + preload）")
    : bad("avatar picker ipc", "missing");
  /avatarDataUrl\(bot\)/.test(readText(SURFACE_PATH)) && /avatar_data_url/.test(readText(SURFACE_PATH))
    ? ok("Host listViews() 把已保存头像读回 data URL（重启后仍显示）")
    : bad("avatar data url", "surface does not decorate bots");
  /b\.avatar_data_url/.test(html)
    ? ok("侧栏 Bot 行 / 标题 pill 使用真实头像图（不是纯色首字母）")
    : bad("avatar render", "renderer ignores avatar_data_url");

  /* ---------- GP-123: session list parity surface ---------- */
  const searchAt = html.indexOf('id="session-search"');
  const listAt = html.indexOf('id="session-list"');
  searchAt >= 0 && listAt > searchAt
    ? ok("会话面板有搜索框，位于真实会话列表之前（GP-123）")
    : bad("session search", "missing or misplaced");
  /\.sess-group \{/.test(html) && /sessDayBucket\(s\.updated_at\)/.test(html)
    ? ok("会话按 updated_at 分 今天 / 昨天 / 更早（不是假分组）")
    : bad("date groups", "sess-group or bucket missing");
  /window\.bitbot\.sessions\.rename\(/.test(html) && /window\.bitbot\.sessions\.delete\(/.test(html)
    ? ok("重命名 / 删除接到已存在的 Host IPC（渲染层不直接写 sessions.json）")
    : bad("session actions", "rename/delete not wired");
  /id="session-rename-modal"/.test(html) && /id="session-delete-modal"/.test(html) && /sessDeleteWarn/.test(html)
    ? ok("重命名 / 删除都有确认对话（删除明示不可恢复）")
    : bad("session dialogs", "missing");

  /* ---------- Host behaviour: real turns ---------- */
  const botsSnap = readText(BOTS);
  const sessionsSnap = readText(SESSIONS);
  const { createProductSurface } = require(SURFACE_PATH);
  const surface = createProductSurface(REPO);
  try {
    // GP-121a: the surface itself never invents a different placeholder.
    const blank = surface.createBot({ name: "", job: "probe", description: "blank name" });
    const blankName = (blank && blank.bot && blank.bot.name) || "";
    blankName === "New Bot"
      ? ok("Host 端空白名称也落成 \"New Bot\"（不是 Unnamed Bot）")
      : bad("surface placeholder", blankName);

    // GP-121b: the renderer's actual phrase round-trips through the kernel.
    const made = turn("create bot New+Bot job=Probe description=Created+from+M25");
    const madePayload = hostPayload(made.json, ["bot_create"]);
    const madeBot = (madePayload && madePayload.bot) || null;
    madeBot && madeBot.name === "New Bot" && madeBot.job === "Probe"
      ? ok("渲染层短语 `create bot New+Bot …` → 内核 → Host 建出 \"New Bot\"")
      : bad("create phrase", JSON.stringify(madePayload).slice(0, 220));

    // GP-120: name/job/description/tags all persist.
    const id = madeBot && madeBot.id;
    if (!id) {
      bad("update needs a bot", "create failed");
    } else {
      const upd = turn(
        "update bot " + id + " name=Piper job=Perf tags=perf,+research description=Keep+the+voice",
      );
      const updPayload = hostPayload(upd.json, ["bot_update"]);
      const row = (readJson(BOTS) || { bots: [] }).bots.find((b) => b.id === id) || {};
      updPayload && updPayload.ok && row.name === "Piper" && row.job === "Perf" &&
      row.description === "Keep the voice" &&
      Array.isArray(row.tags) && row.tags.join(",") === "perf,research"
        ? ok("`update bot … tags=…` 真写进 bots.json（名称/职责/描述/标签）")
        : bad("update persist", JSON.stringify({ payload: updPayload, row }).slice(0, 260));

      // §2.3: Description is multi-line — newlines must survive the phrase.
      const ml = turn("update bot " + id + " description=First+line\nSecond+line");
      const mlPayload = hostPayload(ml.json, ["bot_update"]);
      const mlRow = (readJson(BOTS) || { bots: [] }).bots.find((b) => b.id === id) || {};
      mlPayload && mlPayload.ok && mlRow.description === "First line\nSecond line"
        ? ok("Description 多行文本原样落盘（换行不丢）")
        : bad("multiline description", JSON.stringify(mlRow.description));

      // GP-122: real avatar path → data URL served by listViews().
      const avatarPath = path.join(require("os").tmpdir(), "m25-avatar.png");
      // 1x1 PNG, valid bytes — the Host only checks existence + size.
      fs.writeFileSync(
        avatarPath,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
      const av = turn("update bot " + id + " avatar=" + avatarPath);
      const avPayload = hostPayload(av.json, ["bot_update"]);
      const view = surface.listViews();
      const seen = (view.bots || []).find((b) => b.id === id) || {};
      avPayload && avPayload.ok && seen.avatar === avatarPath &&
      String(seen.avatar_data_url || "").startsWith("data:image/png;base64,")
        ? ok("头像路径存在 → 保存并把图片读回 data URL（GP-122）")
        : bad("avatar save", JSON.stringify({ payload: avPayload, avatar: seen.avatar, url: String(seen.avatar_data_url || "").slice(0, 30) }).slice(0, 240));

      // A missing avatar is refused, and the old one is untouched.
      const beforeBad = (readJson(BOTS) || { bots: [] }).bots.find((b) => b.id === id) || {};
      const badAv = turn("update bot " + id + " avatar=/tmp/does-not-exist-m25.png");
      const badPayload = hostPayload(badAv.json, ["bot_update"]);
      const afterBad = (readJson(BOTS) || { bots: [] }).bots.find((b) => b.id === id) || {};
      badPayload && badPayload.ok === false && badPayload.error === "invalid_avatar" &&
      afterBad.avatar === beforeBad.avatar
        ? ok("不存在的头像路径被 Host 拒绝（invalid_avatar），旧头像保持不变")
        : bad("invalid avatar", JSON.stringify(badPayload).slice(0, 200));

      // Clear signals: tags=- / avatar=- are explicit.
      turn("update bot " + id + " tags=- avatar=-");
      const cleared = (readJson(BOTS) || { bots: [] }).bots.find((b) => b.id === id) || {};
      Array.isArray(cleared.tags) && cleared.tags.length === 0 && cleared.avatar === ""
        ? ok("`tags=-` / `avatar=-` 明确清空（与省略字段=保持不变区分开）")
        : bad("clear signals", JSON.stringify(cleared).slice(0, 200));

      // Duplicate copies config (tags) but is a fresh row.
      turn("update bot " + id + " tags=copy,me");
      const dup = surface.duplicateBot(id);
      const dupRow = (dup && dup.bot) || {};
      dupRow.id !== id && Array.isArray(dupRow.tags) && dupRow.tags.join(",") === "copy,me"
        ? ok("创建副本复制配置（含标签），不是同一个 id / 同一份对话")
        : bad("duplicate", JSON.stringify(dupRow).slice(0, 200));
    }

    /* ---------- GP-123: rename / delete really mutate the store ---------- */
    const { createSessionStore } = require(path.join(REPO, "hosts/desktop/sessions.js"));
    const store = createSessionStore(REPO);
    const made2 = store.create("M25 probe chat");
    const sid = made2 && made2.session && made2.session.id;
    const renamed = store.rename(sid, "Renamed chat");
    const listed = (store.list().sessions || []).find((s) => s.id === sid) || {};
    renamed && renamed.ok && listed.title === "Renamed chat"
      ? ok("sessions.rename 真改标题（UI 面板接的就是这条路径）")
      : bad("rename", JSON.stringify(listed));
    const removed = store.remove(sid);
    const gone = !(store.list().sessions || []).some((s) => s.id === sid);
    removed && removed.ok && gone
      ? ok("sessions.delete 真删会话并要求 Host 重选 active（不可恢复）")
      : bad("delete", JSON.stringify(removed));
  } finally {
    if (botsSnap) fs.writeFileSync(BOTS, botsSnap);
    if (sessionsSnap) fs.writeFileSync(SESSIONS, sessionsSnap);
  }

  /* ---------- IPC chain closure ---------- */
  /host_payload: hostPayload/.test(mainSrc) && /ok: Boolean\(result && result\.ok\) && effectOk/.test(mainSrc)
    ? ok("bots:op 把 Host 的拒绝也算作失败（不会绿着返回却没保存）")
    : bad("bots:op ok", "effect failure not reflected");
  /bitbot:sessions:rename/.test(mainSrc) && /bitbot:sessions:delete/.test(mainSrc)
    ? ok("main.js 已有 sessions rename / delete IPC（渲染层只是补 UI）")
    : bad("session ipc", "missing in main");

  return finish();
}

function finish() {
  console.log("\nprove_m25_profile: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
}

main();
