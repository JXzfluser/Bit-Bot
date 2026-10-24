// G-28 主聊天界面对标：启动真实 Bit Bot 桌面端，截主聊天界面 before 基准。
// 真实数据（BITBOT_REPO_ROOT=REPO），临时 user-data-dir 避免单例锁，
// NO_SECRET_SYNC 避免污染 .env.local。
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const mainJs = path.join(DESKTOP, "main.js");
const ELECTRON = resolveElectronBinary(DESKTOP);

const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

const ud = electronUserDataDir("grok-shot");
const env = electronLaunchEnv(gateAppEnv(REPO, { BITBOT_NO_SECRET_SYNC: "1" }));

const app = await _electron.launch({
  executablePath: ELECTRON,
  args: [mainJs, "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
  cwd: REPO,
  env,
});

const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded").catch(() => {});
// 等主聊天流渲染
await win.waitForSelector("#log", { timeout: 15000 }).catch(() => {});
await win.waitForTimeout(1500);

// G-28 设计预览：在无供应商回放的情况下，往 #log 顶部注入一条「应用真实构造的」
// DM bot 回复气泡（头像 + 发送者名 + 灰底块），让截图能呈现对标 Grok 的真实观感。
// 仅用于本验证脚本，不写入任何用户数据（临时 user-data-dir + NO_SECRET_SYNC）。
await win.evaluate(() => {
  const log = document.getElementById("log");
  if (!log) return;
  const el = document.createElement("div");
  el.id = "grok-preview-msg";
  el.className = "msg assistant";
  el.innerHTML =
    '<div class="role">assistant</div>' +
    '<div class="msg-grok-head">' +
    '<span class="msg-grok-avatar" style="--av:#c026d3">侦</span>' +
    '<span class="msg-grok-name">情报侦察员</span>' +
    "</div>" +
    '<div class="body bb-md"><p>这是一条对标 Grok 的助手回复示例：左侧圆形头像、上方粉色发送者名、满列浅灰卡片。代码块与行内 <code>code</code> 均走安全渲染路径。</p></div>';
  log.insertBefore(el, log.firstChild);
}).catch(() => {});

// 单独截注入的预览气泡，避免被会话自动加载覆盖或整窗裁切。
const prev = win.locator("#grok-preview-msg");
if (await prev.count()) await prev.screenshot({ path: "/tmp/grok_preview.png" }).catch(() => {});

await win.screenshot({ path: "/tmp/grok_window.png" });
const log = win.locator("#log");
if (await log.count()) await log.screenshot({ path: "/tmp/grok_main.png" }).catch(() => {});
// 侧栏也来一张
const sb = win.locator("#sidebar");
if (await sb.count()) await sb.screenshot({ path: "/tmp/grok_sidebar.png" }).catch(() => {});

// G-28: composer 关闭态 + 「＋」弹层打开态
const comp = win.locator("#composer");
if (await comp.count()) await comp.screenshot({ path: "/tmp/grok_composer_closed.png" }).catch(() => {});
await win.click("#attach-btn").catch(() => {});
await win.waitForTimeout(250);
if (await comp.count()) await comp.screenshot({ path: "/tmp/grok_composer_menu.png" }).catch(() => {});
// 弹层在 composer 上方，元素截图会裁顶 → 整窗再补一张看完整菜单
await win.screenshot({ path: "/tmp/grok_menu_window.png" }).catch(() => {});
await win.click("#attach-btn").catch(() => {}); // 收起，别挡后面的侧栏状态

// G-28: 侧栏底部「会话」图标弹出面板（Grok 底部图标对的位置）
await win.click("#ab-sessions-btn").catch(() => {});
await win.waitForTimeout(350);
await win.screenshot({ path: "/tmp/grok_sessions_popup.png" }).catch(() => {});
await win.click("#ab-sessions-btn").catch(() => {});

console.log("shots saved: /tmp/grok_window.png /tmp/grok_main.png /tmp/grok_sidebar.png /tmp/grok_composer_closed.png /tmp/grok_composer_menu.png /tmp/grok_sessions_popup.png");
// 先真正退出 Electron 再退自己：直接 process.exit 会让 app 变孤儿进程
// （每次跑这个脚本就漏一个 Electron 实例挂在后台）。
try { await app.close(); } catch (_) { try { app.process().kill("SIGKILL"); } catch (_) {} }
fs.rmSync(ud, { recursive: true, force: true });
process.exit(0);
