#!/usr/bin/env node
"use strict";

/**
 * M22 §6.4 先读后执行 proof — prepare-then-execute, verified against the real
 * kernel + Host FFI + renderer source (no Electron needed).
 *
 * What is pinned, and why a UI-only shell would fail this probe:
 *
 *   GP-108 `fire routine r` PREPARES. The Host writes a draft artifact carrying
 *          the prompt and the approval boundary, records `executed:false` and
 *          `pretend_executed:false`, and produces no outbound side effect
 *          (no channel_send / purchase / delete row for that turn).
 *   GP-109 execution is a SECOND, explicit step: the unapproved `execute=1`
 *          turn stops at an `approval_card` (no routine_fire effect at all);
 *          only the `--approved` turn runs and it records `executed:true` with
 *          `execute_via` naming why it ran.
 *   GP-110 read intents never prompt (zero `approval_card` in effects AND host
 *          results); write intents always stop — an unapproved purchase/draft
 *          mail yields a card and no successful execution record.
 *
 * Usage: node scripts/prove_m22_readfirst.js   (exit 0 = all assertions green)
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const CLI = path.join(REPO, "hosts/cli_host/run_turn.js");

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

/** Run one real turn through the same Host the Desktop app uses. */
function turn(text, opts) {
  const o = opts || {};
  const args = [CLI, "--session-id", o.session || "m22-probe", text];
  if (o.approved) args.splice(1, 0, "--approved");
  const run = spawnSync(process.execPath, args, {
    cwd: REPO,
    encoding: "utf8",
    timeout: 300000,
    env: { ...process.env },
  });
  const line = String(run.stdout || "")
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .pop();
  let parsed = null;
  try {
    parsed = JSON.parse(line || "{}");
  } catch (_) {
    parsed = null;
  }
  return parsed;
}

const hostRow = (res, kind) =>
  (res && Array.isArray(res.host_results) ? res.host_results : []).find(
    (h) => h && h.kind === kind,
  );

const hostKinds = (res) =>
  (res && Array.isArray(res.host_results) ? res.host_results : []).map(
    (h) => (h && h.kind) || "",
  );

const effectKinds = (res) =>
  (res && Array.isArray(res.effects) ? res.effects : []).map(
    (e) => (e && e.kind) || "",
  );

/* ---- data snapshot: a probe must not leave routine/fire artifacts behind --- */
const ROUTINES = path.join(REPO, "data/routines/host-routines.json");
const FIRES = path.join(REPO, "data/routines/fires.jsonl");
const DRAFTS = path.join(REPO, "data/routines/drafts");
const SEND = path.join(REPO, "data/delivery/send-to-user.jsonl");
const HDJ = path.join(REPO, "data/journal/host-delivery.jsonl");
const RECEIPTS = path.join(REPO, "data/commerce/receipts");

const snap = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
const before = {
  routines: snap(ROUTINES),
  fires: snap(FIRES),
  send: snap(SEND),
  hdj: snap(HDJ),
  drafts: fs.existsSync(DRAFTS) ? fs.readdirSync(DRAFTS) : [],
  receipts: fs.existsSync(RECEIPTS) ? fs.readdirSync(RECEIPTS) : [],
};

function restore() {
  const put = (p, buf) => {
    if (buf) fs.writeFileSync(p, buf);
    else fs.rmSync(p, { force: true });
  };
  put(ROUTINES, before.routines);
  put(FIRES, before.fires);
  put(SEND, before.send);
  put(HDJ, before.hdj);
  for (const f of fs.existsSync(DRAFTS) ? fs.readdirSync(DRAFTS) : []) {
    if (!before.drafts.includes(f)) fs.rmSync(path.join(DRAFTS, f), { force: true });
  }
  for (const f of fs.existsSync(RECEIPTS) ? fs.readdirSync(RECEIPTS) : []) {
    if (!before.receipts.includes(f)) fs.rmSync(path.join(RECEIPTS, f), { force: true });
  }
}

async function main() {
  console.log("M22 §6.4 先读后执行 proof");
  const html = readText(path.join(REPO, "hosts/desktop/index.html"));

  try {
    /* ================= GP-108: firing PREPARES a draft ================== */
    const rid = "m22probe-" + Date.now().toString(36);
    const prep = turn("fire routine " + rid);
    const prepEff = prep && prep.effects ? prep.effects[0] : null;
    prep && prep.ok === true && prep.intent === "fire_routine"
      ? ok("GP-108 默认 `fire routine` 是 fire_routine 回合且成功")
      : bad("GP-108 default fire", JSON.stringify(prep && { ok: prep.ok, intent: prep.intent }));

    prepEff && prepEff.kind === "routine_fire" &&
      prepEff.command === rid
      ? ok("GP-108 默认 effect 命令里没有 execute=1（只准备）")
      : bad("GP-108 effect command", JSON.stringify(prepEff));

    const prepH = hostRow(prep, "routine_fire");
    let prepP = {};
    try {
      prepP = JSON.parse((prepH && prepH.stdout) || "{}");
    } catch (_) {
      prepP = {};
    }
    prepP.mode === "host_routine_draft" &&
      prepP.executed === false &&
      prepP.pretend_executed === false &&
      prepP.pretend_fired === false
      ? ok("GP-108 回执 mode=host_routine_draft 且 executed/pretend_executed/pretend_fired 全 false")
      : bad("GP-108 honest shape", JSON.stringify(prepP).slice(0, 200));

    prepP.draft_path && fs.existsSync(prepP.draft_path)
      ? ok("GP-108 产出草稿文件（draft_path 在磁盘上真实存在）")
      : bad("GP-108 draft file", String(prepP.draft_path || "missing"));

    const draft = readJson(prepP.draft_path);
    draft &&
      draft.requires_approval === true &&
      Array.isArray(draft.approval_boundary) &&
      ["external_send", "purchase", "delete", "publish", "production_change"].every(
        (k) => draft.approval_boundary.includes(k),
      ) &&
      draft.default_action === "draft" &&
      draft.routine_id === rid
      ? ok("GP-108 草稿带 requires_approval + 5 类 approval_boundary + default_action=draft")
      : bad("GP-108 draft boundary", JSON.stringify(draft || {}).slice(0, 240));

    draft && String(draft.prepared_at || "").length > 0 && "prompt" in draft
      ? ok("GP-108 草稿记录 prompt 与 prepared_at（可人工复核“将要做什么”）")
      : bad("GP-108 draft content", JSON.stringify(draft || {}).slice(0, 160));

    // No outbound side effect: the send-to-user rows for this prepare are
    // attachments (fire snapshot + draft), never a channel_send/purchase/delete.
    const sendRows = readText(SEND)
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (_) {
          return {};
        }
      });
    const prepRows = sendRows.filter((r) => r && r.source_kind === "routine_fire");
    const prepBad = prepRows.filter(
      (r) =>
        r.type === "text" ||
        /channel_send|purchase|delete|publish/.test(String(r.label || "")) ||
        r.charged === true,
    );
    prepRows.length >= 1 && prepBad.length === 0
      ? ok("GP-108 制备阶段只有附件投递（没有 channel_send / purchase / delete 行）")
      : bad("GP-108 outbound side effect", JSON.stringify(prepBad).slice(0, 200));

    const prepDeleted = hostKinds(prep).filter((k) =>
      /^(channel_send|purchase|delete_bot|x_post)$/.test(k),
    );
    prepDeleted.length === 0
      ? ok("GP-108 制备回合没有真实的对外发送/购买/删除 host 结果")
      : bad("GP-108 host side effects", prepDeleted.join(","));

    /* ================= GP-109: execute is a second, approved step ====== */
    const gated = turn("fire routine " + rid + " execute=1");
    gated && gated.ok === true && effectKinds(gated).join(",") === "approval_card"
      ? ok("GP-109 未 approved 的 execute=1 只出 approval_card（无 routine_fire effect）")
      : bad("GP-109 execute gate", JSON.stringify(effectKinds(gated)));

    !hostRow(gated, "routine_fire")
      ? ok("GP-109 未 approved 时 Host 根本没有执行记录（零副作用的诚实拒绝）")
      : bad("GP-109 premature execution", "routine_fire ran without approval");

    const executed = turn("fire routine " + rid + " execute=1", { approved: true });
    const execH = hostRow(executed, "routine_fire");
    let execP = {};
    try {
      execP = JSON.parse((execH && execH.stdout) || "{}");
    } catch (_) {
      execP = {};
    }
    execP.mode === "host_routine_fire_executed" &&
      execP.executed === true &&
      String(execP.executed_at || "").length > 0
      ? ok("GP-109 approved 后才真实执行（mode=…_executed + executed_at 落盘）")
      : bad("GP-109 approved execute", JSON.stringify(execP).slice(0, 200));

    execP.execute_via === "command"
      ? ok("GP-109 执行记录写明 execute_via=command（审计能回答“为什么跑了”）")
      : bad("GP-109 execute_via", String(execP.execute_via));

    execP.draft_path && execP.draft_path !== prepP.draft_path &&
      fs.existsSync(execP.draft_path)
      ? ok("GP-109 执行步骤也有自己的草稿快照（两阶段各自留痕）")
      : bad("GP-109 execute draft", String(execP.draft_path || "missing"));

    // Approved execution must still not fabricate an outbound send that the
    // routine did not request; it records execution, not an external action.
    const execRows = readText(SEND)
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (_) {
          return {};
        }
      })
      .filter((r) => r && r.source_kind === "routine_fire");
    !execRows.some((r) => r.charged === true)
      ? ok("GP-109 执行步骤不虚构扣款（无 charged:true 记录）")
      : bad("GP-109 pretend charge", "charged:true written by routine execute");

    /* ================= GP-110: reads never prompt ====================== */
    const reads = [
      ["list routines", "list_routines"],
      ["list connectors", "connectors_status"],
      ["list skills", "list_skills"],
      ["list credentials", "list_credentials"],
    ];
    let readMisses = [];
    for (const [text, intent] of reads) {
      const r = turn(text);
      const cards = effectKinds(r).filter((k) => k === "approval_card");
      const hostCards = hostKinds(r).filter((k) => k === "approval_card");
      if (!r || r.ok !== true || r.intent !== intent || cards.length || hostCards.length) {
        readMisses.push(
          text +
            " → " +
            JSON.stringify({ ok: r && r.ok, intent: r && r.intent, cards, hostCards }),
        );
      }
    }
    readMisses.length === 0
      ? ok("GP-110 四个只读 intent 在未 approved 下都 ok:true 且零 approval_card")
      : bad("GP-110 read friction", readMisses.join(" | "));

    /* ================= GP-110: writes always stop ====================== */
    const receiptsBefore = fs.existsSync(RECEIPTS) ? fs.readdirSync(RECEIPTS).length : 0;
    const buy = turn("purchase item");
    const buyCards = effectKinds(buy).filter((k) => k === "approval_card");
    buyCards.length === 1 && !hostRow(buy, "purchase")
      ? ok("GP-110 未 approved 的 purchase 只弹卡，没有 purchase host 结果")
      : bad("GP-110 purchase gate", JSON.stringify({ cards: buyCards, hosts: hostKinds(buy) }));

    const receiptsAfter = fs.existsSync(RECEIPTS) ? fs.readdirSync(RECEIPTS).length : 0;
    receiptsAfter === receiptsBefore
      ? ok("GP-110 被拦下的 purchase 不产生小票（没有假装成交）")
      : bad("GP-110 phantom receipt", receiptsBefore + " → " + receiptsAfter);

    const mail = turn("draft mail to=m22@example.com subject=ReadFirst body=hello");
    effectKinds(mail).join(",") === "approval_card" && !hostRow(mail, "mail_send")
      ? ok("GP-110 未 approved 的对外发信停在审批卡（无 mail_send 执行）")
      : bad("GP-110 mail gate", JSON.stringify({ kinds: effectKinds(mail), hosts: hostKinds(mail) }));

    /* ================= renderer wiring ================================ */
    const html2 = html;
    /function renderRoutineDraftCard\(h, p\)/.test(html2) &&
      /id = "routine-draft-execute"/.test(html2)
      ? ok("GP-108 UI 有草稿卡与独立的 #routine-draft-execute 按钮")
      : bad("GP-108 draft card", "missing renderRoutineDraftCard / execute button");

    const execBlock = (html2.match(
      /execBtn\.addEventListener\("click", \(\) => \{[\s\S]*?\n      \}\);/,
    ) || [""])[0];
    /runUserTurn\("fire routine " \+ String\(p\.id \|\| ""\) \+ " execute=1", \{/.test(
      execBlock,
    ) && /approved: true/.test(execBlock)
      ? ok("GP-109 草稿卡的“执行”= 一次显式 approved 回合（execute=1）")
      : bad("GP-109 execute button", "card execute is not an approved execute=1 turn");

    // The Fire button must not pre-approve: preparing never bypasses the gate.
    const fireBlock = (html2.match(
      /getElementById\("rt-fire"\)\.addEventListener\("click", \(\) => \{[\s\S]*?\n    \}\);/,
    ) || [""])[0];
    fireBlock.length > 40 &&
      !/approved\s*:\s*true/.test(fireBlock) &&
      /runUserTurn\("fire routine desk-r", \{\}\)/.test(fireBlock)
      ? ok("GP-108 面板 Fire 按钮不带 approved（准备 ≠ 执行）")
      : bad("GP-108 fire button bypass", fireBlock.slice(0, 160) || "handler not found");

    /p\.executed !== true && p\.draft_path\) renderRoutineDraftCard/.test(html2) &&
      /Array\.isArray\(p\.fired\) \? p\.fired : \[\]\)\.forEach/.test(html2)
      ? ok("GP-108 routine_fire / routine_tick 都在对话流里渲染草稿卡")
      : bad("GP-108 delivery dispatch", "draft card not dispatched from host results");

    const rtKeys = [
      "rtDraftTitle",
      "rtDraftBoundary",
      "rtDraftExecute",
      "rtDraftDiscard",
      "rtDraftStatus",
      "rtDraftExecuting",
      "rtDraftDiscarded",
    ];
    const missingKeys = rtKeys.filter(
      (k) => (html2.match(new RegExp(k + ":", "g")) || []).length < 3,
    );
    missingKeys.length === 0
      ? ok("GP-108 七个草稿卡 i18n key 在 zh-CN / zh-TW / en 三套字典里齐全")
      : bad("GP-108 i18n", missingKeys.join(","));

    /* ================= kernel test coverage =========================== */
    const wbtest = readText(path.join(REPO, "cmd/desktop_turn/desktop_turn_wbtest.mbt"));
    /fire routine .*execute=1/.test(wbtest) && /approval_card/.test(wbtest)
      ? ok("GP-109 kernel 白盒测试覆盖 execute=1 的审批门")
      : bad("GP-109 kernel test", "no whitebox coverage for execute=1 gate");

    const draftBefore = turn("fire routine " + rid);
    const draftP = JSON.parse((hostRow(draftBefore, "routine_fire") || {}).stdout || "{}");
    draftP.executed === false
      ? ok("GP-108 同一 routine 再 fire 一次仍然是 draft（可重复准备，执行才不可逆）")
      : bad("GP-108 repeat prepare", String(draftP.executed));
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
