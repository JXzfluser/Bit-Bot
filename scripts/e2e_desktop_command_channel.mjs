/* e2e_desktop_command_channel.mjs — 「命令不进对话」+「一句话组队」的真渲染门禁（G-28 #12）
 *
 * 起因是一次真实的会话录像：用户在输入框打了
 *     set appearance dark / set appearance light / local execution always
 * 于是消息流里留下三组
 *     [user] set appearance dark   ✓✓
 *     [bot]  已完成。
 * 真正的对话（一份公众号运营方案）被夹在这些空转回执中间。这些命令既不是
 * 用户想留档的内容，也不是 Bot 的工作成果 —— 它们只是一次设置写入。
 *
 * 本门禁断的是「分流」这件事本身：
 *   C-01 外观命令：不新增任何气泡，主题真的变了，回执落在 #cmd-toast
 *   C-02 执行策略命令：不新增气泡，settings.json 真的写了
 *   C-03 组队话术：建出 N 个 Bot + 一个群，Bot 归到同名分组，全程 0 气泡
 *   C-04 只说「组建团队」没给角色：不建任何东西，回执教怎么说话
 *   C-05 问句「组建团队要怎么做？」：交回对话（有用户气泡），不建 Bot
 *   C-06 `delete bot <id>`：**不能**静默执行 —— 删除必须走确认路径
 *   C-07 普通聊天仍然是聊天（有用户气泡）—— 分流没有把对话一起吞掉
 *
 * 跑在隔离根目录里（BITBOT_REPO_ROOT），夹具只存在临时目录，跑完删掉；
 * LLM 端点指向一个必然连不上的端口，所以就算走到对话路径也不会真的调模型。
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, isolatedRepoRoot, gateAppEnv, hasDisplay } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);

/* 用户的 data/desktop 里本来就有「选题策划师」这样的 Bot，所以「夹具字符串在不在」
 * 这种写法必然误报（也证明不了隔离）。改成真正的问题：本门禁跑的那几十秒里，
 * 用户目录的字节动过没有。进门禁前拍快照，出门禁逐文件比；只有差异真存在才判红，
 * 并在消息里点名是哪几个文件、是否带着本门禁的夹具标记。 */
const REAL_DESKTOP = path.join(REPO, "data/desktop");
const WATCHED = ["bots.json", "rooms.json", "sessions.json", "settings.json"];
const FIXTURE_MARKERS = ["新团队", "派单调度", "gate-r1"];
function snapshotRealDesktop() {
  const map = {};
  for (const name of WATCHED) {
    try {
      map[name] = fs.readFileSync(path.join(REAL_DESKTOP, name), "utf8");
    } catch {
      map[name] = null;
    }
  }
  return map;
}
function diffRealDesktop(before) {
  const changed = [];
  for (const name of WATCHED) {
    let now = null;
    try {
      now = fs.readFileSync(path.join(REAL_DESKTOP, name), "utf8");
    } catch {
      now = null;
    }
    if (now !== before[name]) changed.push({ name, now: now || "" });
  }
  return changed;
}

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
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_command_channel: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_command_channel: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_command_channel: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_command_channel: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "cmd-channel", {
  "bots.json": {
    bots: [
      { id: "b1", name: "派单助手", job: "派单调度", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW },
      { id: "b2", name: "数据治理", job: "数据质量", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW },
    ],
    primary: "b1",
  },
  "settings.json": { notify: {} },
  "sessions.json": { sessions: [] },
});

const readJson = (name) => {
  const f = path.join(root, "data/desktop", name);
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const botsNow = () => ((readJson("bots.json") || {}).bots || []).slice();
const roomsNow = () => {
  const r = readJson("rooms.json");
  const p = (r && r.rooms) || r;
  if (Array.isArray(p)) return p;
  if (p && Array.isArray(p.rooms)) return p.rooms;
  return [];
};
/* schedules.jsonl 是「每次排程一条事件」的流水，room_id 就记在这里
   （host-routines.json 是聚合，不带 room 归属）。 */
const readSchedules = () => {
  const f = path.join(root, "data/routines/schedules.jsonl");
  try {
    return fs
      .readFileSync(f, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

/* 气泡数量：#log 里的 .msg 行数（含 debug-only —— 用它断"一点东西都没多"更严）。 */
/* bubbleTexts 只读**用户真的看得见**的行。#log 里还躺着 debug-only 的调试行
   （CSS display:none，Alt+D 才显示），textContent 会把它们一起读出来，
   用它断言就会把"已经藏好了"误判成"泄漏"。 */
const bubbleCount = (win) => win.evaluate(() => document.querySelectorAll("#log .msg").length);
const bubbleTexts = (win) =>
  win.evaluate(() =>
    Array.from(document.querySelectorAll("#log .msg"))
      .filter((m) => getComputedStyle(m).display !== "none")
      .map((e) => {
        const b = e.querySelector(".body");
        return (b ? b.textContent || "" : "").trim();
      }),
  );
const toastState = (win) =>
  win.evaluate(() => {
    const el = document.getElementById("cmd-toast");
    if (!el) return { missing: true };
    return {
      hidden: el.hidden === true,
      text: (el.textContent || "").trim(),
      warn: el.classList.contains("warn"),
      pe: getComputedStyle(el).pointerEvents,
    };
  });

async function say(win, text) {
  await win.fill("#composer #text", text);
  await win.press("#composer #text", "Enter");
  await win.waitForTimeout(900); // 命令走本地 IPC，900ms 足够；对话路径不等它结束
}

/* 等「没有回合在飞」：发送键被禁用 = 有回合在跑。前面几条对话回合连不上端点，
   失败回执会迟到几秒；不等它们，后面量到的气泡数量就不是因果。
   （C-01 里 1 → 1 是对的：那时还没有任何对话回合。） */
async function idle(win) {
  await win
    .waitForFunction(() => {
      const b = document.getElementById("send");
      return b && !b.disabled;
    }, null, { timeout: 20000 })
    .catch(() => {});
  await win.waitForTimeout(300);
}

async function shutdown(app) {
  try {
    await app.evaluate(({ app: a }) => a.quit());
  } catch {
    /* already gone */
  }
  try {
    await app.close();
  } catch {
    /* already gone */
  }
}

/* Node 侧轮询：等一个"文件里真的出现了"的条件，而不是拍一个 sleep。
   组队链路是多个 IPC 串起来的（建 Bot ×N → 分组 ×N → 建群 → 建任务），
   时长跟机器有关，固定 sleep 要么不够、要么白等。 */
async function waitFor(fn, ms, step) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (fn()) return true;
    } catch {
      /* 文件正在被写，下次再看 */
    }
    await new Promise((r) => setTimeout(r, step || 200));
  }
  try {
    return !!fn();
  } catch {
    return false;
  }
}

(async () => {
  let app = null;
  const realBefore = snapshotRealDesktop();
  try {
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [
        path.join(DESKTOP, "main.js"),
        "--no-sandbox",
        "--disable-gpu",
        "--user-data-dir=" + electronUserDataDir("cmd-channel"),
      ],
      cwd: REPO,
      env: electronLaunchEnv(
        gateAppEnv(root, {
          /* 对话路径必须失败得快且免费：指向一个必然连不上的端口。
             真跑起来的话 C-05/C-07 会去打真 provider —— 门禁不该花用户的钱。 */
          BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
          BITBOT_LLM_API_KEY: "gate-no-call",
          BITBOT_LLM_MODEL: "gate-no-call",
          BITBOT_LLM_STREAM: "0",
        }),
      ),
    });
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    /* 默认窗口偏窄，账户按钮会落进折叠区；C-08 要点它，先把窗口放到常规尺寸。 */
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 860)).catch(() => {});
    await win.waitForTimeout(1000);

    /* ---------- C-01 外观命令：不进对话 + 真的生效 ---------- */
    const b0 = await bubbleCount(win);
    await say(win, "set appearance dark");
    const b1 = await bubbleCount(win);
    const darkOn = await win.evaluate(() => document.body.classList.contains("force-dark"));
    const t1 = await toastState(win);
    b1 === b0
      ? ok("C-01 `set appearance dark` 没有新增任何气泡（" + b0 + " → " + b1 + "）")
      : bad("C-01 command leaked into the transcript", JSON.stringify({ before: b0, after: b1 }));
    darkOn ? ok("C-01 主题真的切到深色（body.force-dark）") : bad("C-01 appearance not applied", String(darkOn));
    !t1.hidden && t1.text
      ? ok("C-01 回执落在 #cmd-toast：" + t1.text)
      : bad("C-01 no toast receipt", JSON.stringify(t1));
    t1.pe === "none"
      ? ok("C-01 回执不拦点击（pointer-events: none）")
      : bad("C-01 toast blocks clicks", String(t1.pe));

    const set1 = readJson("settings.json") || {};
    String(set1.appearance || "") === "dark"
      ? ok("C-01 settings.json 真的写了 appearance=dark")
      : bad("C-01 appearance not persisted", JSON.stringify(set1.appearance));

    /* ---------- C-02 执行策略命令：不进对话 + 落盘 ---------- */
    const b2before = await bubbleCount(win);
    await say(win, "local execution always");
    const b2after = await bubbleCount(win);
    const set2 = readJson("settings.json") || {};
    b2after === b2before
      ? ok("C-02 `local execution always` 没有新增气泡")
      : bad("C-02 policy command leaked", JSON.stringify({ before: b2before, after: b2after }));
    String(set2.local_execution || "") === "always"
      ? ok("C-02 settings.json 真的写了 local_execution=always")
      : bad("C-02 local_execution not persisted", JSON.stringify(set2.local_execution));

    /* ---------- C-03 一句话组队：建 Bot + 建群 + 分组 ---------- */
    // 宿主启动时总会注入一个默认 Bot（Bit Bot），所以判定用「执行前后差集」，
    // 不写死 id —— 否则默认 Bot 会被算进「新建的」里。
    const beforeIds = new Set(botsNow().map((b) => b.id));
    await say(win, "组建团队：选题、写作、排版");
    const bots3 = botsNow();
    const made3 = bots3.filter((b) => !beforeIds.has(b.id));
    const b3 = await bubbleCount(win);
    made3.length === 3
      ? ok("C-03 一句话建出 3 个 Bot（" + made3.map((b) => b.name).join(" / ") + "）")
      : bad("C-03 team size", JSON.stringify({ before: beforeIds.size, after: bots3.length, names: made3.map((b) => b.name) }));
    made3.every((b) => String(b.group || "") === "新团队")
      ? ok("C-03 每个 Bot 都归到同名分组「新团队」（复用 bots.json 的 group，不另造实体）")
      : bad("C-03 group not set", JSON.stringify(made3.map((b) => [b.name, b.group])));
    made3.every((b) => String(b.job || "").trim())
      ? ok("C-03 每个 Bot 的 job 就是它的角色名（不是空壳）")
      : bad("C-03 job missing", JSON.stringify(made3.map((b) => [b.name, b.job])));
    const rooms3 = roomsNow();
    const team = rooms3.find((r) => String(r.title || "") === "新团队") || null;
    team && Array.isArray(team.members) && team.members.length === 3
      ? ok("C-03 建了群「新团队」并把 3 个成员拉了进去")
      : bad("C-03 room missing or wrong members", JSON.stringify(rooms3.map((r) => [r.title, r.members])));
    b3 === b2after
      ? ok("C-03 组队全程 0 气泡（结果只在侧栏 + 一行回执）")
      : bad("C-03 team brief leaked into transcript", JSON.stringify({ before: b2after, after: b3 }));
    const t3 = await toastState(win);
    /3/.test(t3.text) && /新团队/.test(t3.text)
      ? ok("C-03 回执说清了「建了几个 + 哪个团队」：" + t3.text)
      : bad("C-03 receipt vague", JSON.stringify(t3.text));

    /* ---------- C-04 只说「组建团队」：不造东西，教怎么说话 ---------- */
    const before4 = botsNow().length;
    await say(win, "组建团队");
    const after4 = botsNow().length;
    const t4 = await toastState(win);
    after4 === before4
      ? ok("C-04 没给角色时不建任何 Bot（不猜）")
      : bad("C-04 built bots without roles", JSON.stringify({ before: before4, after: after4 }));
    !t4.hidden && t4.text && t4.warn
      ? ok("C-04 回执教了一句怎么说话：" + t4.text)
      : bad("C-04 no hint toast", JSON.stringify(t4));

    /* ---------- C-05 问句交回对话 ---------- */
    const b5before = await bubbleCount(win);
    const before5 = botsNow().length;
    await say(win, "组建团队要怎么做？");
    const b5after = await bubbleCount(win);
    const after5 = botsNow().length;
    b5after > b5before
      ? ok("C-05 「组建团队要怎么做？」当成对话发出去了（新增 " + (b5after - b5before) + " 条气泡）")
      : bad("C-05 question was swallowed by the team parser", JSON.stringify({ before: b5before, after: b5after }));
    after5 === before5
      ? ok("C-05 问句没有顺手建出 Bot（「要怎么做」没被当成角色名）")
      : bad("C-05 question created bots", JSON.stringify({ before: before5, after: after5 }));

    /* ---------- C-06 删除不能被一句聊天静默执行 ---------- */
    const b6before = await bubbleCount(win);
    await say(win, "delete bot b1");
    await win.waitForTimeout(400);
    const b6after = await bubbleCount(win);
    const stillThere = botsNow().some((b) => b.id === "b1");
    stillThere
      ? ok("C-06 `delete bot b1` 没有静默删掉 Bot（删除必须走确认路径）")
      : bad("C-06 silent delete happened", "b1 vanished from bots.json");
    b6after > b6before
      ? ok("C-06 它按对话处理了（新增气泡），不是命令")
      : bad("C-06 delete treated as silent command", JSON.stringify({ before: b6before, after: b6after }));

    /* ---------- C-07 普通聊天仍然是聊天 ---------- */
    const b7before = await bubbleCount(win);
    await say(win, "帮我想三个公众号选题");
    const b7after = await bubbleCount(win);
    const texts = await bubbleTexts(win);
    b7after > b7before
      ? ok("C-07 普通消息照常进对话（" + (b7after - b7before) + " 条气泡）")
      : bad("C-07 normal chat swallowed", JSON.stringify({ before: b7before, after: b7after }));
    texts.some((t) => t.includes("帮我想三个公众号选题"))
      ? ok("C-07 用户那句话原样留在消息流里")
      : bad("C-07 user line missing", JSON.stringify(texts.slice(-3)));

    /* ---------- C-08 设置页的 chip 同样不吐气泡 ----------
       这是同源问题：外观 chip 原来也是 runUserTurn(..., skipSession)，
       不落会话但**照样画气泡**，于是每点一次主题就多一条「已完成。」。
       前面几条对话回合连不上端点，失败回执会迟到——先等静默再取基线。 */
    await idle(win);
    const b8before = await bubbleCount(win);
    // 这里只验「chip 的点击处理函数」，不验「怎么打开设置页」——后者已经有
    // shell_v2 / modal_computed 在断，这里再去点一遍账户弹层只会让本门禁跟着
    // 侧栏布局变化碎掉。chip 的监听在 boot 时就绑好了，面板不开也能触发。
    const chipOk = await win.evaluate(() => {
      const b = document.querySelector('#gp-appearance-row [data-appearance="light"]');
      if (!b) return false;
      b.click();
      return true;
    });
    await win.waitForTimeout(900);
    const b8after = await bubbleCount(win);
    const lightOn = await win.evaluate(() => document.body.classList.contains("force-light"));
    const set8 = readJson("settings.json") || {};
    chipOk
      ? ok("C-08 找到并触发了外观 chip（#gp-appearance-row [data-appearance=light]）")
      : bad("C-08 appearance chip missing", "selector not found");
    b8after === b8before
      ? ok("C-08 点设置页的外观 chip 不产生任何气泡（" + b8before + " → " + b8after + "）")
      : bad("C-08 settings chip leaked a bubble", JSON.stringify({ before: b8before, after: b8after }));
    lightOn && String(set8.appearance || "") === "light"
      ? ok("C-08 chip 仍然真的切了主题并落盘（静默 ≠ 不生效）")
      : bad("C-08 chip silent but ineffective", JSON.stringify({ lightOn, persisted: set8.appearance }));

    /* ---------- C-09 点开 Bot 是导航，不是一次对话 ----------
       原来 selectBotForChat 调 runUserTurn("open agent info agent=…")，会往消息流里
       塞三条：用户命令 / 「已完成。」/「与 X 的私聊会话。」。用户只是点了一下侧栏，
       就凭空多出三行看不懂的东西（实录："新建 bot 之后初始化的消息看到一头雾水"）。 */
    await idle(win);
    const b9before = await bubbleCount(win);
    const clicked9 = await win.evaluate(() => {
      const el = document.querySelector('.agent-item.sess-row[data-agent-id="b1"]');
      if (!el) return false;
      el.click();
      return true;
    });
    await win.waitForTimeout(1600);
    const b9after = await bubbleCount(win);
    const t9 = await bubbleTexts(win);
    clicked9 ? ok("C-09 找到并点开了侧栏 Bot（b1）") : bad("C-09 sidebar bot row missing", "selector not found");
    /* 点开 Bot 会切到这个 Bot 的 DM 会话，消息流**本来就会清空**（旧会话的内容
       不该留下）。所以这里不能断言"气泡数不变"——那是把切会话当成泄漏。
       该断的是两件事：切过去的会话是干净的，且里面没有导航留下的旁白。 */
    b9after === 0
      ? ok("C-09 点开 Bot 后是干净的新 DM 会话（" + b9before + " → 0 条，旧会话已收起）")
      : bad("C-09 DM session is not empty on first open", JSON.stringify({ before: b9before, after: b9after, tail: t9.slice(-4) }));
    const noise9 = t9.filter((x) => /open agent info|的私聊会话|^已完成。?$/.test(x));
    noise9.length === 0
      ? ok("C-09 消息流里没有 open agent info /「与 X 的私聊会话」/「已完成。」")
      : bad("C-09 internal navigation text leaked into the transcript", JSON.stringify(noise9.slice(0, 3)));

    /* ---------- C-10 「我要组建团队来做…」一句话建队 + 建群 + 挂定时任务 ----------
       实录原句：用户要的是「组建团队 → 每天收集 AI 热点 → 发邮箱」。旧识别器只认
       「组建」开头，整句于是掉进对话：Bot 有了、定时任务有了（prompt 就是整句话、
       room_id 为空），群没有 —— 而他明明说了"组建团队"。 */
    await idle(win);
    const beforeBotIds = new Set(botsNow().map((b) => b.id));
    const beforeRoomIds = new Set(roomsNow().map((r) => r.id));
    const beforeSched = readSchedules().length;
    const b10before = await bubbleCount(win);
    await say(win, "我要组建团队来处理公众号从每天定时收集AI科技热点内容 发我邮箱");
    /* 组队不走 runUserTurn，发送键不会进 disabled，idle() 立刻就过了。
       所以这里按"东西真的出现了"来等，而不是按时间。 */
    await waitFor(() => botsNow().length >= beforeBotIds.size + 3, 20000);
    await waitFor(() => roomsNow().some((r) => !beforeRoomIds.has(r.id)), 10000);
    await waitFor(() => readSchedules().length > beforeSched, 10000);
    await win.waitForTimeout(500);
    const b10after = await bubbleCount(win);
    const newBots = botsNow().filter((b) => !beforeBotIds.has(b.id));
    const newNames = newBots.map((b) => b.name).sort();
    b10after === b10before
      ? ok("C-10 组队全程不进消息流（" + b10before + " → " + b10after + " 条气泡）")
      : bad("C-10 team build leaked bubbles", JSON.stringify({ before: b10before, after: b10after }));
    newBots.length === 3
      ? ok("C-10 建出 3 个 Bot：" + newBots.map((b) => b.name).join("、"))
      : bad("C-10 wrong bot count", JSON.stringify({ n: newBots.length, names: newBots.map((b) => b.name) }));
    JSON.stringify(newNames) === JSON.stringify(["写作", "排版", "选题"].sort())
      ? ok("C-10 角色命中「公众号内容运营」常规分工（选题 / 写作 / 排版）")
      : bad("C-10 unexpected roles", JSON.stringify(newNames));
    newBots.length > 0 && newBots.every((b) => b.group === "新团队")
      ? ok("C-10 三个 Bot 都归进分组「新团队」")
      : bad("C-10 group not written", JSON.stringify(newBots.map((b) => [b.name, b.group])));

    const newRooms = roomsNow().filter((r) => !beforeRoomIds.has(r.id));
    const teamRoom = newRooms.find((r) => r.title === "新团队");
    teamRoom
      ? ok("C-10 建出了群「新团队」（" + teamRoom.id + "）")
      : bad("C-10 no group created — 正是用户报的那个问题", JSON.stringify(newRooms.map((r) => r.title)));
    const newIds = newBots.map((b) => b.id);
    teamRoom && newIds.every((id) => (teamRoom.members || []).indexOf(id) >= 0)
      ? ok("C-10 群成员就是这三个新 Bot")
      : bad("C-10 group members mismatch", JSON.stringify({ members: teamRoom && teamRoom.members, newIds }));

    const newSched = readSchedules().slice(beforeSched);
    const hook = newSched.find((s) => String(s.room_id || "").trim() !== "");
    hook
      ? ok("C-10 定时任务挂在了群里（room_id=" + hook.room_id + "，cron=" + hook.cron + "）")
      : bad("C-10 routine not bound to the room", JSON.stringify(newSched.map((s) => ({ id: s.id, room_id: s.room_id }))));
    hook && /公众号|热点/.test(String(hook.prompt || ""))
      ? ok("C-10 定时任务的 prompt 是用户那句任务描述")
      : bad("C-10 routine prompt lost the task", JSON.stringify(hook && hook.prompt));

    /* ---------- C-11 定时任务回执说人话 ----------
       内核原话是「已建定时任务 routine-cn-518247（排程 @daily）；…可在群资料 →
       定时任务里查看。」——内部 id、用户从没输过的 cron 表达式、以及一个在没有群时
       根本不存在的位置。渲染层现在把它翻成「定时任务已建好：每天执行」。 */
    await idle(win);
    await say(win, "create routine id=gate-r1 cron=@daily prompt=gate smoke");
    await idle(win);
    await win.waitForTimeout(1200);
    const t11all = await bubbleTexts(win);
    const line11 = t11all.slice().reverse().find((x) => /定时任务|routine/i.test(x)) || "";
    /定时任务已建好/.test(line11)
      ? ok("C-11 回执说人话：" + line11.slice(0, 60))
      : bad("C-11 routine receipt still raw", JSON.stringify(t11all.slice(-3)));
    !/routine-|@daily/.test(line11)
      ? ok("C-11 回执里没有内部 id / cron 原文")
      : bad("C-11 internal routine id or cron leaked", line11);

    /* ---------- 隔离性：用户的 data/desktop 一个字节都没动 ---------- */
    const moved = diffRealDesktop(realBefore);
    if (moved.length === 0) {
      ok("C-08 隔离性：本门禁全程没有改动用户 data/desktop 的 " + WATCHED.length + " 个文件");
    } else {
      const markers = FIXTURE_MARKERS.filter((s) => moved.some((m) => m.now.includes(s)));
      bad(
        "C-08 用户 data/desktop 在本门禁期间被写",
        JSON.stringify({ files: moved.map((m) => m.name), 含本门禁夹具: markers }),
      );
    }
  } catch (err) {
    bad("门禁异常", err && err.message ? err.message : String(err));
  } finally {
    if (app) await shutdown(app);
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    done("e2e_desktop_command_channel");
  }
})();
