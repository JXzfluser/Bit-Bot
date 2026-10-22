#!/usr/bin/env node
"use strict";

/**
 * prove_gp140_shared_computer — GP-140（§3.1）跨 Bot 共享 Computer 浏览器登录态
 *
 * 一个 Computer 共用一个持久 user-data-dir；Bot A 登录的站点标记写入同一
 * computer.json，Bot B 读取时可见（visible_to_bots=all）。
 * 诚实残留：真实 Cookie 内容与云 microVM 不可达（pretend_cookies:false）。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductSurface } = require("../hosts/desktop/product_surface");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp140-"));
const surface = createProductSurface(root);
const ffi = createHostFfi(root);

(async () => {
  console.log("prove_gp140_shared_computer — 跨 Bot 共享登录态（GP-140）");

  const a = surface.recordSharedBrowserSession({
    bot_id: "bot-a",
    site: "calendar.example.com",
    signed_in: true,
    detail: "signed in once",
  });
  if (a.ok && a.shared_browser && a.shared_browser.shared_across_bots === true) {
    ok("Bot A 登录写入共享解析（shared_across_bots=true）");
  } else {
    bad("Bot A 记录失败", JSON.stringify(a));
  }
  const profile = (a.shared_browser || {}).user_data_dir || "";
  if (profile && fs.existsSync(profile)) ok("共享 user-data-dir 已创建");
  else bad("共享 profile 目录不存在", profile);
  if (!/bot-a|bot-b/.test(profile)) ok("profile 路径按 Computer 共享（不含 Bot id）");
  else bad("profile 路径被 per-Bot 化", profile);

  const readB = surface.readSharedBrowserSession({ bot_id: "bot-b" });
  const site = (readB.sites || {})["calendar.example.com"];
  if (
    readB.ok &&
    readB.visible_to_bots === "all" &&
    site &&
    site.signed_in === true &&
    site.by_bot === "bot-a"
  ) {
    ok("Bot B 读到 Bot A 的登录标记（by_bot=bot-a）");
  } else {
    bad("Bot B 不可见 Bot A 登录态", JSON.stringify(readB).slice(0, 300));
  }
  if (readB.user_data_dir === profile) ok("两个 Bot 指向同一 user-data-dir");
  else bad("user-data-dir 不一致", readB.user_data_dir + " vs " + profile);

  const b = surface.recordSharedBrowserSession({ bot_id: "bot-b", site: "mail.example.com" });
  const readA = surface.readSharedBrowserSession({ bot_id: "bot-a" });
  const names = Object.keys(readA.sites || {}).sort().join(",");
  if (b.ok && names === "calendar.example.com,mail.example.com") {
    ok("双向共享：Bot A 也看到 Bot B 登录的站点");
  } else {
    bad("双向共享失败", names);
  }
  if (readA.pretend_cookies === false && readA.real_cloud_vm === false && readA.cookie_sandbox_residual === true) {
    ok("诚实残留：pretend_cookies:false / 云 microVM 标记残留");
  } else {
    bad("残留标记缺失", JSON.stringify(readA).slice(0, 200));
  }

  const computerPath = path.join(root, "data", "desktop", "computer.json");
  const computer = JSON.parse(fs.readFileSync(computerPath, "utf8"));
  if (computer.shared_browser && computer.shared_browser.shared_across_bots === true) {
    ok("登录态落在同一 computer.json（shared_browser）");
  } else {
    bad("computer.json 缺 shared_browser", JSON.stringify(computer.shared_browser));
  }
  const perBotDirs = fs
    .readdirSync(path.join(root, "data", "connectors", "identity"))
    .filter((n) => /^chrome-user-data-(bot|agent)/.test(n));
  if (!perBotDirs.length) ok("未创建 per-Bot 浏览器 profile（不分裂登录态）");
  else bad("出现 per-Bot profile", perBotDirs.join(","));

  // Host FFI 通道（回合可调用的 kind）。
  const w = await ffi.executeHostEffects([
    { kind: "computer_shared_session", command: "record|bot-c|docs.example.com|1|shared via host" },
  ]);
  const wHit = (w || []).find((r) => r && r.kind === "computer_shared_session");
  const r = await ffi.executeHostEffects([
    { kind: "computer_shared_session", command: "read|bot-d" },
  ]);
  const rHit = (r || []).find((x) => x && x.kind === "computer_shared_session");
  let payload = {};
  try { payload = JSON.parse((rHit && rHit.stdout) || "{}"); } catch (_) { payload = {}; }
  if (
    wHit && wHit.ok &&
    payload.sites &&
    payload.sites["docs.example.com"] &&
    payload.sites["docs.example.com"].by_bot === "bot-c"
  ) {
    ok("Host 效果通道 record→read 跨 Bot 可见");
  } else {
    bad("Host 效果通道失败", JSON.stringify(rHit).slice(0, 300));
  }
  const missing = await ffi.executeHostEffects([
    { kind: "computer_shared_session", command: "record|bot-e||1|x" },
  ]);
  const mHit = (missing || []).find((x) => x && x.kind === "computer_shared_session");
  if (mHit && mHit.ok === false && mHit.error === "site_required") {
    ok("缺站点诚实拒绝（site_required，不伪造登录）");
  } else {
    bad("缺站点未拒绝", JSON.stringify(mHit));
  }

  console.log(`\nprove_gp140_shared_computer: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("prove_gp140_shared_computer crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
