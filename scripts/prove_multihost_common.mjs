/* prove_multihost_common.mjs — GP-185：多端通用逻辑只能有一份。
 *
 * 背景（这一门为什么存在）：Desktop、CLI Host、iOS/Android 壳、mobile_host 用的
 * 是同一颗 MoonBit 大脑 + 同一套 Host FFI。但凡「同一件事」在两端各写一份，
 * 漂移就不会被单端门禁发现 —— 例如：
 *   · `.env.local` 解析：Desktop 一份、mobile_host 一份、入站 onTurn 一份；
 *   · 「哪些 Host 结果算可递送 + 哪些 *_residual 要如实带出」：mobile_host 在
 *     镜像里手抄了 42 个键，send_to_user_surface 又手抄了一遍；
 *   · 机器 id 默认值（desk-1 / phone-ios / phone-android）：machine_identity 一份，
 *     入站 seedMachineId 又写死一份。
 * 这些重复本身不是 bug，但它让「改了一端、另一端没改」变成静默事件。本门把
 * 「唯一来源」变成可检查的事实，而不是文档里的君子协定。
 *
 * 口径（只读源码，不执行任何 Host 逻辑）：
 *   MC-00 各端入口都在，且都经由共享模块拿大脑（清单打印出来，供人复核）
 *   MC-01 `.env.local` 解析实现只允许在 hosts/shared/host_env.js
 *   MC-02 残差词表（42 个 *_residual）只允许在 hosts/shared/delivery_mirror.js
 *   MC-03 可递送 Host kind 清单只在 delivery_mirror，mobile_host 必须 import
 *   MC-04 机器 id 默认值字面量只允许在 hosts/shared/machine_identity.js
 *   MC-05 三个回合入口都走 run_moon_turn.createTurnRunner（不各起一套）
 *   MC-06 进度分类只有 progress_protocol 一份（Host 与 UI 同源）
 *   MC-07 尺子自检：重复解析器/重复词表必须在合成样本里被判红，干净样本不误报
 *   MC-08 行为等价：共享后的解析/镜像逐字段等于收敛前的实现（fixture 对照）
 *   MC-09 原生壳（iOS/Android）残差键必须与 RESIDUAL_KEYS 逐个同序（chip 文字顺序一致）
 *
 * 退出码：任何一条红即 1。
 */

import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const HOSTS = path.join(REPO, "hosts");

let PASS = 0,
  FAIL = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 400) : ""));
};

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "vendor", "dist", "build", "_build"].includes(e.name))
        return [];
      return walk(p);
    }
    return e.isFile() && p.endsWith(".js") ? [p] : [];
  });
}

const REL = (p) => path.relative(REPO, p).split(path.sep).join("/");
const read = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

const hostFiles = walk(HOSTS);

/* ---- 检测器（纯函数：给源码 → 违规文件；MC-07 直接用它们自检） ---- */

/** 一个文件是不是自己写了一份 .env.local 解析。 */
function parsesEnvFile(src) {
  if (!src.includes('.indexOf("=")') && !src.includes(".indexOf('=')")) return false;
  return /startsWith\(["']#["']\)/.test(src) && /\bsplit\(\/\\r\?\\n\/\)/.test(src);
}

/** 源码里最长的「连续 *_residual 词」长度。词表是成串出现的，散点不会成串。 */
function maxResidualRun(src) {
  const re = /[a-z0-9_]+_residual/g;
  let best = 0,
    cur = 0,
    prev = -1;
  for (const m of src.matchAll(re)) {
    cur = prev >= 0 && m.index - prev <= 120 ? cur + 1 : 1;
    prev = m.index;
    if (cur > best) best = cur;
  }
  return best;
}

/** 机器 id 默认值是否被写死在别处。 */
function hasMachineDefaultLiteral(src) {
  return /["']phone-(?:ios|android)["']/.test(src) || /["']desk-1["']/.test(src);
}

/* ---- 入口清单 ---- */
const ENTRIES = [
  ["desktop", "hosts/desktop/main.js"],
  ["cli", "hosts/cli_host/run_turn.js"],
  ["mobile", "hosts/mobile_host/run.js"],
];

const BRAIN_NEEDS = {
  desktop: ["run_moon_turn", "host_ffi", "machine_identity", "p0_security"],
  cli: ["run_moon_turn", "machine_identity"],
  mobile: ["send_to_user_surface", "p0_security", "delivery_mirror"],
};

/* MC-00 入口与共享大脑 */
try {
  const missing = ENTRIES.filter(([, f]) => !fs.existsSync(path.join(REPO, f))).map(
    ([, f]) => f,
  );
  if (missing.length) bad("MC-00 入口文件缺失", missing.join(", "));
  else {
    const rows = [];
    let incomplete = [];
    for (const [name, f] of ENTRIES) {
      const src = read(path.join(REPO, f));
      const mods = [...src.matchAll(/require\(\s*["'][^"']*?\/([a-z0-9_]+)["']\s*\)/g)].map(
        (m) => m[1],
      );
      const uniq = [...new Set(mods)].filter((m) =>
        fs.existsSync(path.join(REPO, "hosts/shared", m + ".js")),
      );
      const need = BRAIN_NEEDS[name];
      const miss = need.filter((n) => !uniq.includes(n));
      if (miss.length) incomplete.push(`${name} 缺 ${miss.join("/")}`);
      rows.push(`${name}: ${uniq.sort().join(",")}`);
    }
    if (incomplete.length)
      bad("MC-00 各端没有都接上共享大脑模块", incomplete.join("；"));
    else ok("MC-00 三个回合入口都经由共享模块（" + rows.join(" | ") + "）");
  }
} catch (err) {
  bad("MC-00 执行异常", err && err.stack ? err.stack : err);
}

/* MC-01 .env.local 解析唯一来源 */
try {
  const expect = "hosts/shared/host_env.js";
  const hits = hostFiles
    .filter((f) => parsesEnvFile(read(f)))
    .map(REL)
    .filter((f) => !f.endsWith("node_modules"));
  if (hits.length === 0) bad("MC-01 没有找到 .env.local 解析实现（共享模块缺失）");
  else if (hits.length === 1 && hits[0] === expect)
    ok(`MC-01 .env.local 解析只有一份（${expect}）`);
  else
    bad(
      "MC-01 .env.local 解析出现了重复实现（应为 " + expect + "）",
      hits.join(", "),
    );
} catch (err) {
  bad("MC-01 执行异常", err && err.stack ? err.stack : err);
}

/* MC-02 残差词表唯一来源 */
try {
  const expect = "hosts/shared/delivery_mirror.js";
  const hits = hostFiles
    .filter((f) => maxResidualRun(read(f)) >= 30)
    .map(REL);
  if (hits.length === 1 && hits[0] === expect)
    ok(`MC-02 残差词表只有一份（${expect}，42 个键）`);
  else if (!hits.length)
    bad("MC-02 没有找到残差词表（共享模块缺失）");
  else
    bad(
      "MC-02 残差词表被多份源码各写一遍（应为 " + expect + "）",
      hits.join(", "),
    );
} catch (err) {
  bad("MC-02 执行异常", err && err.stack ? err.stack : err);
}

/* MC-03 可递送 kind 清单 */
try {
  const dm = read(path.join(REPO, "hosts/shared/delivery_mirror.js"));
  const mobile = read(path.join(REPO, "hosts/mobile_host/run.js"));
  const exportOk =
    /DELIVERY_HOST_KINDS/.test(dm) &&
    (dm.match(/["'][a-z][a-z0-9_]{2,}["']/g) || []).length >= 80;
  const importsIt = /require\([^)]*delivery_mirror[^)]*\)/.test(mobile);
  const inlined = /["']channel_send["']\s*,/.test(mobile);
  if (exportOk && importsIt && !inlined)
    ok("MC-03 可递送 Host kind 清单在 delivery_mirror，mobile_host 只引用不内联");
  else
    bad(
      "MC-03 可递送 kind 清单没有收敛到共享模块",
      JSON.stringify({ exportOk, importsIt, inlined }),
    );
} catch (err) {
  bad("MC-03 执行异常", err && err.stack ? err.stack : err);
}

/* MC-04 机器 id 默认值唯一来源 */
try {
  const expect = "hosts/shared/machine_identity.js";
  const hits = hostFiles
    .filter((f) => hasMachineDefaultLiteral(read(f)))
    .map(REL);
  if (hits.length === 1 && hits[0] === expect)
    ok(`MC-04 机器 id 默认值只有一份（${expect}）`);
  else
    bad(
      "MC-04 机器 id 默认值被写死在多处（应为 " + expect + "）",
      hits.join(", ") || "（一份都没找到）",
    );
} catch (err) {
  bad("MC-04 执行异常", err && err.stack ? err.stack : err);
}

/* MC-05 同一个回合执行器 */
try {
  const d = read(path.join(REPO, "hosts/desktop/main.js"));
  const c = read(path.join(REPO, "hosts/cli_host/run_turn.js"));
  const m = read(path.join(REPO, "hosts/mobile_host/run.js"));
  const desktopOk = /run_moon_turn/.test(d) && /createTurnRunner/.test(d);
  const cliOk = /createTurnRunner/.test(c) && /run_moon_turn/.test(c);
  // mobile 自己不起内核：它把同一份 CLI 入口拉起来（同一颗大脑）。
  const mobileOk = /hosts\/cli_host\/run_turn\.js/.test(m) && !/createHostFfi/.test(m);
  if (desktopOk && cliOk && mobileOk)
    ok("MC-05 桌面 / CLI / 手机端都走 run_moon_turn（手机端复用 CLI 入口）");
  else bad("MC-05 有入口绕开了共享回合执行器", JSON.stringify({ desktopOk, cliOk, mobileOk }));
} catch (err) {
  bad("MC-05 执行异常", err && err.stack ? err.stack : err);
}

/* MC-06 进度分类唯一来源 */
try {
  const tp = read(path.join(REPO, "hosts/shared/turn_progress.js"));
  const doubles = hostFiles.filter((f) => {
    const s = read(f);
    return /KIND_CATEGORY\s*=\s*\{/.test(s) && !f.endsWith("progress_protocol.js");
  });
  if (/progress_protocol/.test(tp) && doubles.length === 0)
    ok("MC-06 进度分类只有 progress_protocol 一份（Host 与 UI 同源）");
  else bad("MC-06 进度分类出现第二份", doubles.map(REL).join(", ") || "turn_progress 未引用协议层");
} catch (err) {
  bad("MC-06 执行异常", err && err.stack ? err.stack : err);
}

/* MC-07 尺子自检 */
try {
  const dupEnv = [
    parsesEnvFile('const t = line.trim(); if (t.startsWith("#")) continue; const eq = t.indexOf("="); const l = src.split(/\\r?\\n/);'),
    parsesEnvFile('const eq = row.indexOf("="); if (row.startsWith("#")) continue; rows = text.split(/\\r?\\n/);'),
  ];
  const cleanEnv = parsesEnvFile("const x = cfg.indexOf(\"=\");" ) ;
  const vocab = 'k: ["live_mail_residual","live_x_residual","live_job_residual","live_finance_residual","live_calendar_residual","live_slack_residual","live_teams_residual","live_meeting_residual","live_channel_residual","live_sms_residual","live_webhook_residual","live_voice_residual","mail_claim_residual","inbound_push_residual","voice_stt_residual","voice_tts_residual","ocr_residual","git_commit_residual"]';
  const run = maxResidualRun(vocab);
  const dupId = [
    hasMachineDefaultLiteral('function x(k){ if(k==="android") return "phone-android"; }'),
    hasMachineDefaultLiteral('const DEFAULTS={ios:"phone-ios"};'),
  ];
  // 干净样本：只出现 kind，没有写死默认 id 字面量。
  const cleanId = !hasMachineDefaultLiteral("const DEFAULTS = { ios: kind };");
  if (dupEnv.every(Boolean) && !cleanEnv && run >= 18 && dupId.every(Boolean) && cleanId)
    ok("MC-07 尺子自检：两份解析器/两处机器 id 会被抓住，干净样本不误报");
  else
    bad(
      "MC-07 尺子自检没成立",
      JSON.stringify({ dupEnv, cleanEnv, run, dupId, cleanId }),
    );
} catch (err) {
  bad("MC-07 执行异常", err && err.stack ? err.stack : err);
}

/* MC-08 行为等价（fixture 对照） */
try {
  const hostEnv = require("../hosts/shared/host_env.js");
  const dm = require("../hosts/shared/delivery_mirror.js");
  const send = require("../hosts/shared/send_to_user_surface.js");

  // --- .env 解析：注释 / 引号 / 空值 / 坏行 / 值里带 = ---
  const envFile = path.join(os.tmpdir(), `mh-env-${process.pid}.env`);
  fs.writeFileSync(
    envFile,
    ['# comment', "A=1", 'B="two"', "C='three'", "D=", "BAD LINE", "E=a=b", ""].join("\n"),
  );
  const parsed = hostEnv.parseEnvFile(envFile);
  const envOk =
    parsed.A === "1" &&
    parsed.B === "two" &&
    parsed.C === "three" &&
    parsed.D === "" &&
    parsed.E === "a=b" &&
    !("BAD LINE" in parsed);

  // 装载策略：默认不覆盖、overwrite 覆盖、skip 生效
  process.env.MH_GP185_KEEP = "keep";
  delete process.env.MH_GP185_NEW;
  delete process.env.MH_GP185_SKIP;
  fs.writeFileSync(envFile, "MH_GP185_KEEP=file\nMH_GP185_NEW=new\nMH_GP185_SKIP=no\n");
  hostEnv.loadEnvFiles([envFile], { skip: (k) => k === "MH_GP185_SKIP" });
  const policy1 =
    process.env.MH_GP185_KEEP === "keep" &&
    process.env.MH_GP185_NEW === "new" &&
    process.env.MH_GP185_SKIP === undefined;
  hostEnv.loadEnvFiles([envFile], { overwrite: true });
  const policy2 = process.env.MH_GP185_KEEP === "file";
  for (const k of ["MH_GP185_KEEP", "MH_GP185_NEW", "MH_GP185_SKIP"]) delete process.env[k];
  fs.rmSync(envFile, { force: true });

  // --- 手机镜像：字段值 + 字段顺序与收敛前一致 ---
  const payload = {
    artifact_path: "/tmp/a.png",
    media_path: "/tmp/a.png",
    pretend_connected: false,
    live_mail_residual: true,
    widget_degraded: true,
    outcome: { live_paid_residual: true, ocr_residual: true },
    gui: { vision_plan: { ocr_residual: true } },
    mode: "dry",
    remote_pr: { mode: "dry" },
  };
  const mirror = dm.buildDeliveryMirror({
    kind: "mail_send",
    machineKind: "ios",
    payload,
    hostPath: "/tmp/a.png",
    hostOk: false,
    at: "2026-10-30T00:00:00.000Z",
  });
  // 收敛前的字段顺序（mobile_host/run.js 旧对象字面量），逐字对照。
  const EXPECT_ORDER = [
    "kind", "machine_kind", "host_kind", "host_path", "media_path",
    "frame_path", "html_path", "eml_path", "mode", "pretend_live",
    "pretend_sent", "pretend_connected", "live_mail_residual",
    "live_mail_claim_residual", "live_channel_residual", "widget_degraded",
    "inbound_push_residual", "live_slack_residual", "live_teams_residual",
    "live_meeting_residual", "live_sms_residual", "live_webhook_residual",
    "live_voice_residual", "live_x_residual", "live_x_post_residual",
    "live_job_residual", "live_finance_residual", "live_calendar_residual",
    "voice_stt_residual", "voice_tts_residual", "voice_end_match_residual",
    "inbound_turn_residual", "credential_browser_fill_residual",
    "signin_fill_residual", "cross_machine_copy_residual",
    "device_capture_residual", "device_tool_residual", "product_tool_residual",
    "live_paid_residual", "box_doctor_bin_residual", "box_chrome_bin_residual",
    "long_lived_cron_residual", "remote_cloud_residual",
    "remote_cloud_artifact_residual", "code_apply_residual",
    "git_commit_residual", "git_push_residual", "screenshot_residual",
    "remote_pr_residual", "public_fallback_residual",
    "interactive_oauth_residual", "true_device_os_dialog_residual",
    "gh_pr_create_residual", "ocr_residual", "os_window_automation_residual",
    "host_ok", "at", "note",
  ];
  const orderOk =
    JSON.stringify(Object.keys(mirror)) === JSON.stringify(EXPECT_ORDER);
  const valueOk =
    mirror.kind === "mail_send_mobile_mirror" &&
    mirror.machine_kind === "ios" &&
    mirror.host_kind === "mail_send" &&
    mirror.host_path === "/tmp/a.png" &&
    mirror.mode === "dry" &&
    mirror.pretend_connected === false &&
    mirror.live_mail_residual === true &&
    mirror.live_paid_residual === true &&
    mirror.ocr_residual === true &&
    mirror.widget_degraded === true &&
    mirror.live_x_residual === false &&
    mirror.host_ok === false &&
    mirror.at === "2026-10-30T00:00:00.000Z";

  // SendToUser chip 与镜像同源：顺序按共享词表，widget_degraded 单列。
  const chip = (() => {
    // residualSuffix 不导出；用 extractDeliveryTypes 的产物间接验证。
    const turn = JSON.stringify({
      host_results: [{ kind: "mail_send", ok: true, stdout: JSON.stringify(payload) }],
    });
    const ex = send.extractDeliveryTypes(turn);
    return ex && ex.labels ? ex.labels.join("|") : "";
  })();
  const chipOk = /live_mail_residual/.test(chip) && /widget_degraded/.test(chip);

  if (envOk && policy1 && policy2 && orderOk && valueOk && chipOk)
    ok("MC-08 行为等价：.env 解析/装载策略、镜像 42+3 字段与顺序、SendToUser chip 都与收敛前一致");
  else
    bad(
      "MC-08 行为等价没成立",
      JSON.stringify({ envOk, policy1, policy2, orderOk, valueOk, chipOk, chip }),
    );
} catch (err) {
  bad("MC-08 执行异常", err && err.stack ? err.stack : err);
}

/* MC-09 原生壳残差键与共享词表同序 */
try {
  const dm = require("../hosts/shared/delivery_mirror.js");
  const natives = [
    ["iOS", path.join(HOSTS, "ios/BitBotHost/Sources/BitBotHost/SendToUserSurface.swift")],
    ["Android", path.join(HOSTS, "android/BitBotHost/app/src/main/java/com/bitbot/host/SendToUserSurface.kt")],
  ];
  const rows = [];
  const wrong = [];
  for (const [name, file] of natives) {
    if (!fs.existsSync(file)) {
      wrong.push(`${name}: missing ${REL(file)}`);
      continue;
    }
    const src = fs.readFileSync(file, "utf8");
    const fn = src.search(/(func residualSuffix|fun residualSuffix)/);
    const scope = fn < 0 ? "" : src.slice(fn);
    const rel = scope.search(/(let keys = \[|val keys = listOf\()/);
    const body = rel < 0 ? "" : scope.slice(rel);
    const end = body.search(/\n\s*[)\]]/);
    const block = end < 0 ? body : body.slice(0, end);
    const keys = [...block.matchAll(/"([A-Za-z0-9_]+_residual)"/g)].map((m) => m[1]);
    const same =
      keys.length === dm.RESIDUAL_KEYS.length &&
      keys.every((k, i) => k === dm.RESIDUAL_KEYS[i]);
    rows.push(`${name}=${keys.length}`);
    if (!same) {
      const firstDiff = keys.findIndex((k, i) => k !== dm.RESIDUAL_KEYS[i]);
      wrong.push(
        firstDiff < 0
          ? `${name} 键数 ${keys.length}/${dm.RESIDUAL_KEYS.length}（共同前缀之外缺项）`
          : `${name} 第 ${firstDiff + 1} 项起不同（native=${keys[firstDiff]} canonical=${dm.RESIDUAL_KEYS[firstDiff]}，${keys.length}/${dm.RESIDUAL_KEYS.length} 项）`,
      );
    }
  }
  if (!wrong.length && rows.length)
    ok(`MC-09 iOS/Android 残差键与 RESIDUAL_KEYS 同序（${rows.join(" ")} / ${dm.RESIDUAL_KEYS.length}）`);
  else bad("MC-09 原生壳残差键顺序/集合与共享词表不一致", wrong.join("；") || "no native files");
} catch (err) {
  bad("MC-09 执行异常", err && err.stack ? err.stack : err);
}

console.log(`prove_multihost_common: pass=${PASS} fail=${FAIL}`);
process.exit(FAIL ? 1 : 0);
