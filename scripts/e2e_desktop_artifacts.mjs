/* e2e_desktop_artifacts.mjs — 产物落库之后「刷新不丢卡」
 *
 * 预置一条带产物的 assistant 行（一张真 PNG + 一个已经被删掉的文件），
 * 真 Electron 打开这条会话：
 *   1) 那张图必须被重建出来（.msg.media 里的 img 有 data: 源）；
 *   2) 那个不存在的文件必须写一行「已不在本机」，而不是画一张点开是空的破卡，
 *      也不能把整段历史加载打断（后续消息照常渲染）。
 *
 * 纪律：独立 dataRoot（tmp）+ 独立 user-data-dir，跑完关进程，不碰仓库 data/。
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const DATA = path.join(os.tmpdir(), "bitbot-e2e-artifacts");
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(path.join(DATA, "desktop"), { recursive: true });

/* 一张真 PNG（1×1，最小合法 PNG）+ 一个故意不存在的文件 */
const PNG = path.join(DATA, "chart-report.png");
const MIN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
fs.writeFileSync(PNG, MIN_PNG);
const GONE = path.join(DATA, "deleted-export.md");

const now = new Date();
const sid = "sess-art0001";
fs.writeFileSync(path.join(DATA, "desktop", "sessions.json"), JSON.stringify({
  version: 1,
  active_id: sid,
  sessions: [{
    id: sid,
    title: "产物重建",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    messages: [
      { id: "msg-u1", role: "user", text: "画一张本周派单趋势图，顺便导一份 md", at: now.toISOString() },
      {
        id: "msg-a1",
        role: "assistant",
        text: "图做好了，明细也导出成 md 了。",
        at: new Date(now.getTime() + 1000).toISOString(),
        artifacts: [
          { path: PNG, name: "chart-report.png", kind: "structured_chart", bytes: MIN_PNG.length },
          { path: GONE, name: "deleted-export.md", kind: "export_pack", bytes: 42 },
        ],
      },
      { id: "msg-u2", role: "user", text: "收到", at: new Date(now.getTime() + 2000).toISOString() },
    ],
  }],
}, null, 2));

const ud = electronUserDataDir("bb-artifacts");
const env = electronLaunchEnv(
  gateAppEnv(REPO, {
    BITBOT_DATA_ROOT: DATA,
    BITBOT_NO_SECRET_SYNC: "1",
    BITBOT_DESKTOP_AUTOSTART: "0",
  }),
);

(async () => {
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO,
    env,
    timeout: 60000,
  });
  const win = await app.firstWindow({ timeout: 60000 });
  try {
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.evaluate(() => {
      document.body.classList.remove("force-dark");
      document.body.classList.add("force-light");
    });

    await win.waitForFunction(() => document.querySelectorAll("#log .msg").length >= 3, null, { timeout: 20000 }).catch(() => {});
    await win.waitForTimeout(900); // 等产物卡异步重建

    const state = await win.evaluate(() => {
      const media = document.querySelectorAll("#log .msg.media").length;
      const img = document.querySelector("#log .msg.media img");
      const gone = Array.from(document.querySelectorAll("#log .artifact-gone")).map((x) => x.textContent.trim());
      const msgs = document.querySelectorAll("#log .msg").length;
      return {
        media,
        imgSrc: img ? String(img.getAttribute("src") || "").slice(0, 12) : "",
        gone,
        msgs,
        laterMsg: Array.from(document.querySelectorAll("#log .msg")).some((m) => /收到/.test(m.textContent || "")),
      };
    });

    state.media >= 1 && state.imgSrc.startsWith("data:")
      ? ok("刷新后图片卡被重建出来（" + state.media + " 张媒体卡，img src 是 data:）")
      : bad("media card missing", JSON.stringify(state));

    state.gone.length === 1 && /deleted-export\.md/.test(state.gone[0]) && /不在本机/.test(state.gone[0])
      ? ok("文件已经被删掉的那条如实写「" + state.gone[0] + "」，不画破卡")
      : bad("gone line", JSON.stringify(state.gone));

    state.msgs >= 3 && state.laterMsg
      ? ok("产物处理没有打断历史加载（后面的「收到」照常渲染）")
      : bad("history broken by artifacts", JSON.stringify({ msgs: state.msgs, laterMsg: state.laterMsg }));

    await win.screenshot({ path: path.join(os.tmpdir(), "bb-artifacts.png") });
  } finally {
    await app.close();
  }
  console.log("\ne2e_desktop_artifacts: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => {
  console.error("e2e_desktop_artifacts fatal:", e && e.message ? e.message : e);
  process.exit(1);
});
