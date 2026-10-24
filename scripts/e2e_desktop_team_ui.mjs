/* e2e_desktop_team_ui.mjs — 团队/群组 UI 的真渲染门禁。
 *
 * 群资料面板（成员 / 定时任务 / 资料库）与群聊 @ 提及浮层，只有在真渲染里
 * 才验得了：单测看不见「浮层压在消息上」「回车把消息误发出去」。
 * 这个门禁启动真 app（hosts/desktop/main.js），用真键鼠事件驱动，然后断言：
 *   T-01  侧栏群组行显示群名与成员数（数据源 = 真的 rooms.json）。
 *   T-02  点群行 → 进入该群，banner 标题是群名。
 *   T-03  点「群资料」→ rail 真的可见；资料库区块列出条目与类型。
 *   T-04  输入 @ → 提及浮层出现，候选 = 全体 + 本群成员。
 *   T-05  浮层落在输入框正上方、左边缘对齐（不是盖在消息上）。
 *   T-06  ↑↓ + 回车 → 插入 "@<成员名> "，浮层收起，而且**消息没有被误发出去**。
 *   T-07  Esc → 浮层关闭。
 *
 * 跑之前把 data/desktop/{bots,rooms}.json 换成夹具，跑完原样还原
 * （和 e2e_desktop_layout_target.mjs 同一套手法）。electron / 显示环境
 * 不可用时如实打印 SKIP —— 跳过的门禁永远不算 PASS。
 *
 * （上面那句是初版写法，已作废：夹具不再写进真仓库。app 用
 * BITBOT_REPO_ROOT 指向临时根目录，夹具只存在于那里，跑完整个删掉。
 * 「跑完再还原」会输给 app 退出时的落盘，把夹具留在用户数据里。
 * 现在最后一条断言 T-08 现场验证「用户的 data/desktop 一个字节没动」。）
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, isolatedRepoRoot, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);

let PASS = 0,
  FAIL = 0,
  SKIP = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 240) : ""));
};
const skip = (m, why) => {
  SKIP++;
  console.log("  · SKIP " + m + " — " + why);
};
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_team_ui: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_team_ui: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
/* macOS 自带窗口系统，不需要 DISPLAY；Linux 没 DISPLAY 又没 xvfb 就真跑不了。 */
if (process.platform === "linux" && !process.env.DISPLAY) {
  let hasXvfb = false;
  try {
    execSync("command -v xvfb-run", { stdio: "ignore" });
    hasXvfb = true;
  } catch {
    /* none */
  }
  if (!hasXvfb) {
    console.log("e2e_desktop_team_ui: SKIP — no DISPLAY and no xvfb-run");
    console.log("e2e_desktop_team_ui: PASS=0 FAIL=0 SKIP=1");
    process.exit(0);
  }
}

const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

/* ---- 夹具与还原 ----
 *
 * 夹具不再写进真仓库的 data/desktop —— 那是用户的运行时状态（群聊、bot 列表、
 * 密钥落盘）。整个 app 用 BITBOT_REPO_ROOT 指到一个临时根目录，夹具只存在于
 * 那里，跑完整个临时目录删掉。
 *
 * 「跑完再把真文件还原回去」是错的：app 退出时的落盘和还原动作会赛跑，
 * 还原经常输，真仓库就留下夹具内容（这个门禁第一版就是这么把一个测试群
 * 留在了用户数据里）。隔离 + 事后断言"真数据一个字节没动"才是能自证的。
 */
const REAL_BOTS = path.join(REPO, "data/desktop/bots.json");
const REAL_ROOMS = path.join(REPO, "data/desktop/rooms.json");
const realSnap = () =>
  [REAL_BOTS, REAL_ROOMS].map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f) : null]);
/* 断言要针对**因果**：本门禁的夹具有没有漏进用户的 data/desktop。
   直接比"运行前后字节一致"会被别的并发门禁误伤（仓库里另有几个门禁按真实
   REPO_ROOT 跑，会写 data/desktop）—— 那不是本门禁的锅，也不该由本门禁报警。
   夹具的哨兵值（群 id / bot 名）出现在用户数据里，才是真泄漏。 */
const FIXTURE_SENTINELS = ["room-e2e", "情报侦察员", "内容主笔", "内容生产战队"];
const fixtureLeak = () => {
  for (const f of [REAL_BOTS, REAL_ROOMS]) {
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, "utf8");
    for (const s of FIXTURE_SENTINELS) if (txt.includes(s)) return { file: f, sentinel: s };
  }
  return null;
};

const NOW = new Date().toISOString();
const bot = (id, name, job, pinned) => ({
  id,
  name,
  job,
  description: job,
  avatar: "",
  hidden: false,
  pinned: !!pinned,
  created_at: NOW,
  updated_at: NOW,
});
const FIXTURE_FILES = {
  "bots.json": {
    version: 1,
    primary_id: "bot-a",
    bots: [bot("bot-a", "情报侦察员", "搜集素材", true), bot("bot-b", "内容主笔", "写稿", false)],
  },
  "rooms.json": {
    version: 1,
    rooms: [
      {
        id: "room-e2e",
        title: "内容生产战队",
        members: ["bot-a", "bot-b"],
        created_at: NOW,
        transcript: [],
        library: [
          { title: "品牌口径手册 v3", kind: "手册" },
          { title: "竞品拆解表", kind: "表格" },
        ],
      },
    ],
  },
};

async function shutdown(app) {
  try {
    await app.evaluate(({ app: electronApp }) => {
      electronApp.isQuiting = true;
      electronApp.quit();
    });
  } catch {
    /* already gone */
  }
  try {
    await app.close();
  } catch {
    /* already gone */
  }
}

(async () => {
  console.log("e2e_desktop_team_ui — 群资料（成员/定时任务/资料库）+ @ 提及浮层的真渲染门禁");
  const before = realSnap();
  const root = isolatedRepoRoot(REPO, "team-ui", FIXTURE_FILES);
  let app = null;
  try {
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [
        path.join(DESKTOP, "main.js"),
        "--no-sandbox",
        "--disable-gpu",
        "--user-data-dir=" + electronUserDataDir("team-ui"),
      ],
      cwd: REPO,
      /* ELECTRON_RUN_AS_NODE=1 会让 electron 退化成纯 node：ipcMain 是 undefined，
         且 node 模式不认 --remote-debugging-port → 启动直接 "Process failed to
         launch!"。这里必须显式剔除，不能指望调用者的 shell 干净。 */
      env: electronLaunchEnv(gateAppEnv(root)),
    });
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(800);

    /* T-01 侧栏群组行 */
    await win.evaluate(() => refreshSidebarRooms());
    await win.waitForTimeout(500);
    const row = await win.evaluate(() => {
      const el = document.querySelector("#room-list .sess-row");
      if (!el) return null;
      return {
        name: (el.querySelector(".name") || {}).textContent || "",
        meta: (el.querySelector(".meta") || {}).textContent || "",
      };
    });
    row && row.name === "内容生产战队" && /2\s*位成员/.test(row.meta)
      ? ok("T-01 侧栏群组行显示群名与成员数（" + row.name + " · " + row.meta + "）")
      : bad("T-01 侧栏群组行不对", JSON.stringify(row));

    /* T-02 进入群聊 */
    await win.click("#room-list .sess-row");
    await win.waitForTimeout(1200);
    const banner = await win.evaluate(() => ({
      title: (document.getElementById("room-banner-title") || {}).textContent || "",
      shown: document.getElementById("room-banner").style.display,
    }));
    banner.title === "内容生产战队" && banner.shown !== "none"
      ? ok("T-02 点群行进入该群（banner = " + banner.title + "）")
      : bad("T-02 没进群", JSON.stringify(banner));

    /* T-03 群资料 rail + 资料库 */
    await win.click("#room-banner-info");
    await win.waitForTimeout(1200);
    const rail = await win.evaluate(() => {
      const railEl = document.getElementById("room-rail");
      const items = Array.from(document.querySelectorAll("#ri-lib-list .ri-item")).map((el) => ({
        name: (el.querySelector(".ri-name") || {}).textContent || "",
        meta: (el.querySelector(".ri-meta") || {}).textContent || "",
        hasOpen: !!el.querySelector(".bb-btn"),
      }));
      return {
        visible: getComputedStyle(railEl).display !== "none",
        panel: document.body.dataset.panel,
        items,
        empty: (document.getElementById("ri-lib-list") || {}).innerText || "",
      };
    });
    rail.visible && rail.panel === "room"
      ? ok("T-03a 群资料 rail 真的可见（panel=" + rail.panel + "）")
      : bad("T-03a 群资料 rail 没打开", JSON.stringify({ visible: rail.visible, panel: rail.panel }));
    rail.items.length === 2 &&
    rail.items[0].name === "品牌口径手册 v3" &&
    rail.items[0].meta === "类型：手册" &&
    rail.items[1].name === "竞品拆解表" &&
    rail.items.every((i) => i.hasOpen)
      ? ok("T-03b 资料库列出 2 条（标题 + 类型 + 打开按钮）")
      : bad("T-03b 资料库条目不对", JSON.stringify(rail.items));

    /* T-04 / T-05 @ 提及浮层 */
    await win.focus("#composer #text");
    await win.keyboard.type("@");
    await win.waitForTimeout(500);
    const pop = await win.evaluate(() => {
      const p = document.getElementById("mention-pop");
      const r = p.getBoundingClientRect();
      const ir = document.getElementById("text").getBoundingClientRect();
      return {
        display: p.style.display,
        items: Array.from(p.querySelectorAll(".mention-item")).map((e) => e.textContent || ""),
        bottom: Math.round(r.bottom),
        top: Math.round(r.top),
        inputTop: Math.round(ir.top),
        inputLeft: Math.round(ir.left),
        left: Math.round(r.left),
      };
    });
    pop.display === "block" && pop.items.length === 3
      ? ok("T-04 输入 @ → 浮层出现，候选 " + pop.items.length + " 个（" + pop.items.join(" / ") + "）")
      : bad("T-04 浮层没出现或候选不对", JSON.stringify(pop));
    pop.items.some((t) => t.includes("全部成员")) && pop.items.some((t) => t.includes("情报侦察员"))
      ? ok("T-04b 候选含「全体」与本群成员")
      : bad("T-04b 候选内容不对", JSON.stringify(pop.items));
    pop.bottom <= pop.inputTop + 2 && Math.abs(pop.left - pop.inputLeft) <= 2
      ? ok("T-05 浮层落在输入框正上方、左边缘对齐（bottom " + pop.bottom + " ≤ input.top " + pop.inputTop + "）")
      : bad("T-05 浮层位置不对", JSON.stringify(pop));

    /* T-06 ↑↓ + 回车：插入成员名，且不误发消息 */
    const userMsgsBefore = await win.evaluate(() => document.querySelectorAll("#log .msg.user").length);
    await win.keyboard.press("ArrowDown");
    await win.waitForTimeout(200);
    await win.keyboard.press("Enter");
    await win.waitForTimeout(600);
    const after = await win.evaluate(() => ({
      value: document.getElementById("text").value,
      popDisplay: document.getElementById("mention-pop").style.display,
      userMsgs: document.querySelectorAll("#log .msg.user").length,
    }));
    after.value === "@情报侦察员 "
      ? ok("T-06a 回车插入成员名（" + JSON.stringify(after.value) + "），浮层收起")
      : bad("T-06a 回车没插对", JSON.stringify(after));
    after.popDisplay === "none" ? ok("T-06b 插入后浮层收起") : bad("T-06b 浮层没收起", after.popDisplay);
    after.userMsgs === userMsgsBefore
      ? ok("T-06c 消息没有被误发出去（user 行数不变：" + userMsgsBefore + "）")
      : bad("T-06c 回车把消息发出去了（" + userMsgsBefore + " → " + after.userMsgs + "）");

    /* T-07 Esc 关闭浮层 */
    await win.evaluate(() => {
      const t = document.getElementById("text");
      t.value = "@";
      t.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await win.waitForTimeout(300);
    const popOpen = await win.evaluate(() => document.getElementById("mention-pop").style.display);
    await win.keyboard.press("Escape");
    await win.waitForTimeout(300);
    const popClosed = await win.evaluate(() => document.getElementById("mention-pop").style.display);
    popOpen === "block" && popClosed === "none"
      ? ok("T-07 Esc 关闭提及浮层")
      : bad("T-07 Esc 没关掉浮层", JSON.stringify({ popOpen, popClosed }));

    /* T-08 门禁自己不能污染用户数据 —— 隔离要可自证，不是"应该没问题" */
    const leak = fixtureLeak();
    !leak
      ? ok("T-08 用户的 data/desktop 里没有本门禁的夹具内容（夹具全在临时根目录里）")
      : bad("T-08 夹具内容泄漏进了用户的 data/desktop", JSON.stringify(leak));
  } catch (e) {
    bad("e2e crashed", (e && (e.stack || e.message)) || e);
  } finally {
    if (app) await shutdown(app);
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* 临时目录残留不影响判定 */
    }
  }
  done("e2e_desktop_team_ui");
})();
