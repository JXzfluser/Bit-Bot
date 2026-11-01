#!/usr/bin/env node
/**
 * prove_locexec_single_entry — 「执行命令 / 操作电脑」的审批只有一个入口
 *
 * 用户报的：设置页里「自动复核规则」和「本地执行（电脑权限）」重叠了。
 *
 * 是真重叠，不只是长得像：
 *   · host_ffi 里 `WAVEG_LOCAL_KINDS = ["shell", "computer_use"]` —— 本地执行
 *     这个总开关管的就是这两项；
 *   · 而「通用 → 自动复核规则」的下拉里又把它们列了一遍，两边词还是同义的
 *     （每次询问≈先询问 / 总是允许≈自动允许）；
 *   · 结果两个开关互相盖：本地执行=始终允许 + 规则(执行命令)=先询问 → 仍然
 *     弹审批（executeHostEffects 里 approval gate 排在 local exec gate 之后，
 *     规则赢），用户以为设置没生效。
 *
 * 契约（一个决定只给一个入口，一个话题只给一页）：
 *   T1 「电脑与权限」的本地执行下，有且只有两行单项例外：执行命令 / 操作电脑。
 *   T2 其它动作的审批也搬到这一页：发送消息 / 发送邮件 / 发起购买 / 调用工具 /
 *      委派任务，五行齐全。
 *   T3 没有个人规则时都停在「跟随」，不假装已经设了什么。
 *   T4 「通用」页不再有任何审批入口（旧的 select + 两颗按钮已拆掉）——
 *      通用页只留外观 / 语言 / 时区 / 账户。
 *   T5 隐私模式不归本机管，但解释必须看得见（以前只藏在 title 里，等于没有）。
 *   T6 点「先询问」→ 真的落一条 `<kind>:*` = ask 的个人规则（gate 读的就是它）。
 *   T7 选中态跟着数据走，不是本地记一个变量。
 *   T8 云端动作的档位同样真的落盘，不是只有本地那两行接了线。
 *   T9 点「跟随」→ 规则被删掉（回到听默认，而不是留一条假规则）。
 *   T10 总开关选「禁止」→ 本地两行置灰且 disabled（never 是硬闸，不假装还能设）。
 *
 * 起的是真 app（playwright _electron + 隔离 repo root），因为这段接线全在渲染
 * 层与 IPC 之间 —— 静态扫字符串证明不了「点了真的落盘」。
 */
import path from "path";
import fs from "fs";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import {
  electronLaunchEnv,
  electronUserDataDir,
  isolatedRepoRoot,
  gateAppEnv,
} from "./electron_env.mjs";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const NOW = new Date().toISOString();
const FIXTURE_FILES = {
  "bots.json": {
    version: 1,
    primary_id: "bot-a",
    bots: [
      {
        id: "bot-a", name: "情报侦察员", job: "搜集素材", description: "你是情报侦察员。",
        avatar: "", hidden: false, pinned: true, created_at: NOW, updated_at: NOW,
      },
    ],
  },
  "rooms.json": { version: 1, rooms: [] },
};

(async () => {
  console.log("prove_locexec_single_entry — 「执行命令 / 操作电脑」的审批只有一个入口");

  const root = isolatedRepoRoot(REPO, "locexec-single-entry", FIXTURE_FILES);
  const RULES = path.join(root, "data", "desktop", "approval-rules.json");
  const readRules = () => {
    try { return (JSON.parse(fs.readFileSync(RULES, "utf8")).rules) || []; } catch { return []; }
  };

  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [
      path.join(DESKTOP, "main.js"),
      "--no-sandbox",
      "--disable-gpu",
      "--user-data-dir=" + electronUserDataDir("locexec-single-entry"),
    ],
    cwd: REPO,
    env: electronLaunchEnv(gateAppEnv(root)),
  });
  const win = await app.firstWindow();
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  await win.waitForTimeout(1200);

  // 打开设置 → 电脑页（侧栏按钮在真 app 里不可见，走头像菜单）
  await win.click("#account-avatar-btn");
  await win.waitForTimeout(500);
  await win.click("#ap-settings");
  await win.waitForTimeout(1500);
  await win.click('.settings-tab-btn[data-stab="computer"]');
  await win.waitForTimeout(900);

  const snap = () => win.evaluate(() => {
    const grab = (sel) => [...document.querySelectorAll(sel)].map((r) => ({
      name: (r.querySelector(".gp-lorule-name") || {}).textContent,
      chips: [...r.querySelectorAll("button[data-lokind]")].map((b) => ({
        d: b.dataset.lodecision, on: b.classList.contains("active"), dis: b.disabled,
      })),
    }));
    return {
      rows: grab("#gp-locexec-rules .gp-lorule"),
      approvalRows: grab("#gp-approval-rules .gp-lorule"),
      disabledBlock: document.getElementById("gp-locexec-rules").classList.contains("is-disabled"),
      // 「通用」页不该再有任何审批档位：审批只有一个地方（电脑与权限）。
      generalRuleRowCount: document.querySelectorAll("#st-general .gp-lorule button[data-lokind]").length,
      hasOldSelect: !!document.getElementById("gp-rule-kind"),
      privacyState: (document.getElementById("gp-privacy-state") || {}).textContent,
      privacyNote: (document.getElementById("gp-privacy-note") || {}).textContent,
    };
  });

  const a = await snap();
  const names = a.rows.map((r) => String(r.name || "").trim());
  names.join(",") === "执行命令,操作电脑"
    ? ok("T1 电脑页「本地执行」下有且只有两行单项例外：执行命令 / 操作电脑")
    : bad("T1 单项例外的行不对", JSON.stringify(names));

  const cloudNames = a.approvalRows.map((r) => String(r.name || "").trim());
  cloudNames.join(",") === "发送消息,发送邮件,发起购买,调用工具,委派任务"
    ? ok("T2 其它动作的审批也在这里，五行齐全：" + cloudNames.join(" / "))
    : bad("T2 云端动作的审批行不对", JSON.stringify(cloudNames));

  const followOn = (r) => {
    const c = r.chips.find((x) => x.d === "follow");
    return !!c && c.on;
  };
  a.rows.length && a.rows.every(followOn)
    ? ok("T3 没有个人规则时都停在「跟随」（不假装已设）")
    : bad("T3 默认档位不对", JSON.stringify(a.rows));

  !a.hasOldSelect && a.generalRuleRowCount === 0
    ? ok("T4 「通用」页不再有任何审批档位（旧的 select + 两颗按钮已拆掉）")
    : bad("T4 通用页还留着审批入口", JSON.stringify({
        hasOldSelect: a.hasOldSelect, rows: a.generalRuleRowCount,
      }));

  // 隐私模式：不归本机管，但解释必须看得见（以前只藏在 title 里，等于没有）。
  a.privacyState && a.privacyNote && a.privacyNote.length > 6
    ? ok("T5 隐私模式在账户组里如实说状态，并把原因写出来：" + a.privacyNote.slice(0, 26) + "…")
    : bad("T5 隐私模式只有一句状态、没有解释", JSON.stringify({
        state: a.privacyState, note: a.privacyNote,
      }));

  await win.click('#gp-locexec-rules button[data-lokind="shell"][data-lodecision="ask"]');
  await win.waitForTimeout(900);
  const askRule = readRules().find((r) => r && r.pattern === "shell:*");
  askRule && askRule.decision === "ask"
    ? ok("T6 点「先询问」→ 落了一条 shell:* = ask 的个人规则")
    : bad("T6 规则没落盘", JSON.stringify(readRules()));

  const b = await snap();
  const shellRow = b.rows[0] || { chips: [] };
  shellRow.chips.find((c) => c.d === "ask") && shellRow.chips.find((c) => c.d === "ask").on &&
    shellRow.chips.find((c) => c.d === "follow") && !shellRow.chips.find((c) => c.d === "follow").on
    ? ok("T7 选中态跟着数据走（先询问亮、跟随灭）")
    : bad("T7 选中态没跟上", JSON.stringify(shellRow));

  // 云端动作的档位也真的落盘（不是只有本地那两行接线）
  await win.click('#gp-approval-rules button[data-lokind="mail_send"][data-lodecision="ask"]');
  await win.waitForTimeout(900);
  readRules().some((r) => r && r.pattern === "mail_send:*" && r.decision === "ask")
    ? ok("T8 「发送邮件 → 先询问」也落成了 mail_send:* 规则")
    : bad("T8 云端动作的档位没接线", JSON.stringify(readRules()));

  await win.click('#gp-locexec-rules button[data-lokind="shell"][data-lodecision="follow"]');
  await win.waitForTimeout(900);
  !readRules().some((r) => r && r.pattern === "shell:*")
    ? ok("T9 点「跟随」→ 规则被删掉（回到听总开关）")
    : bad("T9 规则没删掉", JSON.stringify(readRules()));

  await win.click('#gp-locexec-row .gp-chip[data-locexec="never"]');
  await win.waitForTimeout(1000);
  const c = await snap();
  c.disabledBlock && c.rows.length && c.rows.every((r) => r.chips.length && r.chips.every((x) => x.dis))
    ? ok("T10 总开关=禁止 → 本地两行置灰且 buttons disabled（never 是硬闸）")
    : bad("T10 禁止态没把单项例外按住", JSON.stringify(c));

  console.log("\npass=" + pass + " fail=" + fail);
  try { await app.evaluate(({ app: x }) => { x.isQuiting = true; x.quit(); }); } catch { /* gone */ }
  try { await app.close(); } catch { /* gone */ }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log("  ✗ 探针崩了 — " + String((e && e.message) || e).slice(0, 300));
  console.log("\npass=" + pass + " fail=" + (fail + 1));
  process.exit(1);
});
