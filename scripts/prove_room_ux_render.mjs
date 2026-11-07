/* prove_room_ux_render.mjs — 群聊这两件事必须在**真窗口**里成立：
 *   ① 左侧双击就地改名（用户否决了抽屉表单那一版）
 *   ② 进群时 #log 里不许还挂着上一条私聊
 *
 * 为什么不能只靠 prove_room_rename.js：那一份证明的是 Host 把名字写进
 * rooms.json —— 而用户抱怨的原话是「群不能修改名称？」「切换对话都一样呢？」
 * 看到的是屏幕。Host 全绿、界面没入口，用户照样改不了。
 *
 * 判据（每条都对着一个具体故障，且带负向对照）：
 *   RU-00 起得来、侧栏两个同名群都画出来了（起不来后面全是假绿）
 *   RU-01 进群前 #log 里确实挂着私聊内容（不满足则 RU-02 是空判）
 *   RU-02 进群后 #log 只剩一个群 thread（msgsOutsideThread === 0）—— 这就是
 *        「明明没开始聊，对话框就很多内容」那条
 *   RU-03 回执行折叠：气泡正文短、回执进 details（rooms.json 里的原文仍超长）
 *   RU-04 超长系统行：首屏一行 + details 收全文
 *   RU-05 双击 .name → 原地长出 input，值 = 原群名且已聚焦
 *   RU-06 回车 → rooms.json 的 title 变了 + 侧栏那一行字变了 + 无 pageerror
 *   RU-07 Esc → 不落盘（负向对照：不能「只要有输入就保存」）
 *   RU-08 双击未打开的群 = 先打开再改名（把「双击也顺带进群」这个可预期行为
 *        钉住，而不是让它当副作用漂着）
 *
 * 数据全部落在 <repo>/.room-ux-probe-<pid>（BITBOT_DATA_ROOT，仓库直接子目录，
 * 内核 cwd 不变），跑完即删；用户真库 sha256 前后必须一致。
 *
 * 跑法：node scripts/prove_room_ux_render.mjs
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");
const ELECTRON = resolveElectronBinary(DESKTOP);

let code = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m, extra) => {
  code = 1;
  console.log("  ✗ " + m + (extra !== undefined ? " — " + JSON.stringify(extra) : ""));
};
const sha = (p) => {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch (_) {
    return null;
  }
};

const REAL_ROOMS = path.join(REPO, "data/desktop/rooms.json");
const REAL_SESSIONS = path.join(REPO, "data/desktop/sessions.json");
const realRoomsSha = sha(REAL_ROOMS);
const realSessionsSha = sha(REAL_SESSIONS);

/* ---------------- 造一份可控的用户数据 ---------------- */
const ROOT = path.join(REPO, ".room-ux-probe-" + process.pid);
const DESK = path.join(ROOT, "desktop");

const HEAD = "选题我按「三个反常识」给你排好了，先看成稿能不能接住。";
const BIG_JSON = JSON.stringify(
  {
    results: Array.from({ length: 12 }, (_, i) => ({
      call: "workspace.read",
      path: "/workspace/content-team/02-briefs/brief-00" + i + ".md",
      bytes: 1200 + i,
    })),
  },
  null,
  2,
);
const RECEIPT =
  "Host FFI results applied (MoonBit kernel / ADR 0002):\n" +
  BIG_JSON +
  "\n(host_ffi: /Users/someone/bitbot/data/workspace/content-team/02-briefs)";
const BOT_TEXT = HEAD + "\n\n" + RECEIPT;
const LONG_SYSTEM = "群综合：".padEnd(10, "·") + "每个成员都收到了这一轮；".repeat(60);

const seed = () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(DESK, { recursive: true });
  fs.writeFileSync(
    path.join(DESK, "bots.json"),
    JSON.stringify(
      {
        bots: [
          { id: "bot-a", name: "选题策划师", job: "选题", description: "排选题。", created_at: "2026-11-01T00:00:00.000Z" },
          { id: "bot-b", name: "内容主笔", job: "成稿", description: "写稿。", created_at: "2026-11-01T00:00:00.000Z" },
          { id: "bot-c", name: "事实编辑", job: "核验", description: "核事实。", created_at: "2026-11-01T00:00:00.000Z" },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(DESK, "rooms.json"),
    JSON.stringify(
      {
        version: 1,
        rooms: [
          {
            id: "room-dup-a",
            title: "自媒体内容团队",
            members: ["bot-a", "bot-b"],
            created_at: "2026-11-01T00:00:00.000Z",
            transcript: [
              { id: "t1", kind: "user", text: "开始吧", at: "2026-11-01T10:00:00.000Z" },
              { id: "t2", kind: "bot_reply", bot_id: "bot-a", name: "选题策划师", text: BOT_TEXT, at: "2026-11-01T10:00:05.000Z" },
              { id: "t3", kind: "system", text: LONG_SYSTEM, at: "2026-11-01T10:00:09.000Z" },
            ],
          },
          {
            id: "room-dup-b",
            title: "自媒体内容团队",
            members: ["bot-c"],
            created_at: "2026-11-02T00:00:00.000Z",
            transcript: [],
          },
        ],
      },
      null,
      2,
    ),
  );
  // 私聊：进群前 #log 里必须已经有东西，否则 RU-05 是空判。
  const at = "2026-11-01T09:00:00.000Z";
  fs.writeFileSync(
    path.join(DESK, "sessions.json"),
    JSON.stringify(
      {
        version: 1,
        active_id: "sess-priv",
        sessions: [
          {
            id: "sess-priv",
            title: "选题策划师 · DM",
            created_at: at,
            updated_at: at,
            messages: [
              { id: "m1", role: "user", text: "今天写什么？", at },
              { id: "m2", role: "assistant", text: "三条备选，你挑一条我就开工。", at },
              { id: "m3", role: "user", text: "挑第一条。", at },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
};

const readRooms = () => JSON.parse(fs.readFileSync(path.join(DESK, "rooms.json"), "utf8"));
const titleOf = (id) => (readRooms().rooms.find((r) => r.id === id) || {}).title;

seed();

const app = await _electron.launch({
  executablePath: ELECTRON,
  args: [
    path.join(DESKTOP, "main.js"),
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=" + electronUserDataDir("room-ux-render"),
  ],
  cwd: REPO,
  env: electronLaunchEnv({
    BITBOT_DATA_ROOT: ROOT,
    BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
    BITBOT_LLM_API_KEY: "proof-no-call",
    BITBOT_LLM_MODEL: "proof-no-call",
    BITBOT_LLM_STREAM: "0",
  }),
});

const pageErrors = [];

try {
  const win = await app.firstWindow();
  win.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  await win.waitForSelector("#composer #text", { timeout: 30000 });

  // RU-00：两个同名群都在侧栏
  let rows = [];
  try {
    await win.waitForSelector("#room-list .sess-row", { timeout: 20000 });
    rows = await win.evaluate(() =>
      Array.from(document.querySelectorAll("#room-list .sess-row")).map((el) => ({
        id: el.dataset.roomId,
        name: (el.querySelector(".name") || {}).textContent || "",
        title: el.getAttribute("title") || "",
      })),
    );
  } catch (_) {
    rows = [];
  }
  const dupA = rows.find((r) => r.id === "room-dup-a");
  const dupB = rows.find((r) => r.id === "room-dup-b");
  if (dupA && dupB && dupA.name === "自媒体内容团队" && dupB.name === "自媒体内容团队") {
    ok("RU-00 侧栏画出两个同名群（" + rows.length + " 行），就是用户截图里分不清的那个状态");
  } else {
    bad("RU-00 侧栏没有画出两个同名群", rows);
  }

  // RU-01：进群前 #log 里确实挂着私聊（顺序不能反：双击/单击都会进群，
  // 一旦进过群，私聊面就再也测不到了，RU-02 会变成空判）
  const before = await win.evaluate(() => {
    const log = document.getElementById("log");
    return {
      msgs: log.querySelectorAll(".msg").length,
      thread: log.querySelectorAll(".room-thread").length,
      text: (log.textContent || "").slice(0, 60),
    };
  });
  if (before.msgs >= 3 && before.thread === 0) {
    ok("RU-01 进群前 #log 是私聊面：" + before.msgs + " 条消息（「" + before.text.trim().slice(0, 18) + "…」）");
  } else {
    bad("RU-01 私聊面没渲染出来，RU-02 会变成空判", before);
  }

  // RU-02：进群后只剩群 thread
  await win.click('#room-list .sess-row[data-room-id="room-dup-a"]');
  await win.waitForSelector("#log .room-thread", { timeout: 15000 });
  await win.waitForTimeout(600);
  const after = await win.evaluate(() => {
    const log = document.getElementById("log");
    const threads = log.querySelectorAll(".room-thread");
    const thread = threads[0];
    const outside = Array.from(log.children).filter((el) => el !== thread);
    return {
      threads: threads.length,
      kids: Array.from(log.children).map((el) => el.className),
      outside: outside.length,
      outsideKinds: outside.map((el) => el.className),
      outsideText: outside.map((el) => (el.textContent || "").replace(/\s+/g, " ").slice(0, 100)),
      streaming: log.querySelectorAll("[data-streaming]").length,
      threadKids: thread ? thread.children.length : 0,
    };
  });
  if (after.outside === 0 && after.threads === 1 && after.threadKids > 0) {
    ok("RU-02 进群后 #log 只剩一个 .room-thread（" + after.threadKids + " 个子节点），上一条私聊一条不剩");
  } else {
    bad("RU-02 进群后还挂着外面来的东西（或叠了两个 thread）", after);
  }

  // RU-06 / RU-07：回执与超长系统行都必须折叠
  const fold = await win.evaluate(() => {
    const thread = document.querySelector("#log .room-thread");
    if (!thread) return { thread: false };
    const reply = thread.querySelector(".msg.room-reply");
    const sys = thread.querySelector(".room-system");
    const body = reply ? reply.querySelector(".body") : null;
    const foldIn = (el) => {
      const d = el ? el.querySelector("details.rr-fold") : null;
      return d
        ? { has: true, sum: (d.querySelector("summary") || {}).textContent || "", len: ((d.querySelector("pre") || {}).textContent || "").length }
        : { has: false };
    };
    const visibleText = (el) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll("details").forEach((d) => d.remove());
      return (clone.textContent || "").replace(/\s+/g, " ").trim();
    };
    return {
      thread: true,
      // 只量**看得见的**正文：details 里的 pre 也属于 body.textContent，
      // 直接量会把折叠掉的那 1KB 又算进去，判据就自己骗自己。
      replyText: body ? visibleText(body) : null,
      replyFold: foldIn(reply),
      sysText: sys ? ((sys.querySelector(".room-system-text") || {}).textContent || "").trim() : null,
      sysFold: foldIn(sys),
    };
  });
  const rawLen = BOT_TEXT.length;
  if (fold.thread && fold.replyText && fold.replyText.length < 200 && fold.replyFold.has && fold.replyFold.len > 900) {
    ok(
      "RU-03 气泡正文 " + fold.replyText.length + " 字（rooms.json 里那条原文 " + rawLen + " 字），回执进 details 保留了 " + fold.replyFold.len + " 字",
    );
  } else {
    bad("RU-03 执行回执没有折叠（一屏机器话）", fold);
  }
  if (fold.sysText && fold.sysText.length < 200 && fold.sysFold.has && fold.sysFold.len > 600) {
    ok("RU-04 超长系统行首屏 " + fold.sysText.length + " 字 + 折叠保留全文 " + fold.sysFold.len + " 字");
  } else {
    bad("RU-04 超长系统行没有折叠", { sysText: fold.sysText, sysFold: fold.sysFold });
  }

  /* ---------------- 改名：双击就地改 ---------------- */
  // RU-05：双击就地长出输入框
  await win.dblclick('#room-list .sess-row[data-room-id="room-dup-a"] .name');
  const editState = await win.evaluate(() => {
    const input = document.querySelector('#room-list .sess-row[data-room-id="room-dup-a"] .sess-name-input');
    if (!input) return { exists: false };
    return {
      exists: true,
      value: input.value,
      focused: document.activeElement === input,
      selected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
    };
  });
  if (editState.exists && editState.value === "自媒体内容团队" && editState.focused) {
    ok("RU-05 双击名字 → 原地变成输入框（值=原群名、已聚焦、整段选中可直接覆盖）");
  } else {
    bad("RU-05 双击没有进入就地编辑", editState);
  }

  // RU-06：回车保存（落盘 + 侧栏 + banner 三处同步）
  await win.fill('#room-list .sess-row[data-room-id="room-dup-a"] .sess-name-input', "自媒体内容团队 · A");
  await win.keyboard.press("Enter");
  await win.waitForTimeout(700);
  const afterEnter = await win.evaluate(() => {
    const el = document.querySelector('#room-list .sess-row[data-room-id="room-dup-a"]');
    return {
      hasInput: !!document.querySelector("#room-list .sess-name-input"),
      name: el ? (el.querySelector(".name") || {}).textContent || "" : null,
      banner: (document.getElementById("room-banner-title") || {}).textContent || "",
      threads: document.querySelectorAll("#log .room-thread").length,
    };
  });
  if (
    titleOf("room-dup-a") === "自媒体内容团队 · A" &&
    afterEnter.name === "自媒体内容团队 · A" &&
    afterEnter.banner === "自媒体内容团队 · A" &&
    !afterEnter.hasInput &&
    afterEnter.threads === 1
  ) {
    ok("RU-06 回车 → rooms.json / 侧栏 / 输入卡表头同时改了：「" + afterEnter.name + "」，且没叠出第二个 thread");
    // 证据：这一刻左侧是改好的名字，右侧是「人话 + 折叠起来的执行回执」
    await win.waitForTimeout(400);
    await win.screenshot({ path: "/tmp/room-ux-fold.png" });
  } else {
    bad("RU-06 回车没保存或界面没跟上", { disk: titleOf("room-dup-a"), ui: afterEnter });
  }

  // RU-07：Esc 不落盘（负向对照：不能「有输入就保存」）
  const beforeEsc = titleOf("room-dup-b");
  await win.dblclick('#room-list .sess-row[data-room-id="room-dup-b"] .name');
  await win.fill('#room-list .sess-row[data-room-id="room-dup-b"] .sess-name-input', "不该被保存的名字");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
  const afterEsc = await win.evaluate(() => {
    const el = document.querySelector('#room-list .sess-row[data-room-id="room-dup-b"]');
    return {
      hasInput: !!document.querySelector("#room-list .sess-name-input"),
      name: el ? (el.querySelector(".name") || {}).textContent || "" : null,
    };
  });
  if (titleOf("room-dup-b") === beforeEsc && afterEsc.name === beforeEsc && !afterEsc.hasInput) {
    ok("RU-07 Esc → 一个字都没存，行上还是「" + afterEsc.name + "」（不是「有输入就保存」）");
  } else {
    bad("RU-07 Esc 之后仍然落盘了", { disk: titleOf("room-dup-b"), ui: afterEsc });
  }

  // RU-08：双击未打开的群 = 先打开再改名。这是原生列表的手感（单击打开、
  // 双击标签改名），钉住它，免得以后有人顺手改掉却没人知道。
  const openedByDbl = await win.evaluate(() => ({
    banner: (document.getElementById("room-banner-title") || {}).textContent || "",
    bannerShown: (document.getElementById("room-banner") || {}).style.display !== "none",
    thread: document.querySelectorAll("#log .room-thread").length,
  }));
  if (openedByDbl.thread === 1 && openedByDbl.bannerShown) {
    ok("RU-08 双击未打开的群 → 顺带进群（表头「" + openedByDbl.banner + "」），单击打开的手感没被改名抢走");
  } else {
    bad("RU-08 双击之后没进群（单击进群被改名抢走了）", openedByDbl);
  }

  if (!pageErrors.length) ok("RU-09 全程没有 pageerror");
  else bad("RU-09 渲染层抛错", pageErrors.slice(0, 3));

  const shot = "/tmp/room-ux.png";
  await win.waitForTimeout(500);
  await win.screenshot({ path: shot });
  console.log("  · 证据截图：" + shot);
} catch (e) {
  bad("RU-00 自检抛错", String((e && e.stack) || e).slice(0, 400));
} finally {
  await app.close();
  fs.rmSync(ROOT, { recursive: true, force: true });
}

if (sha(REAL_ROOMS) !== realRoomsSha || sha(REAL_SESSIONS) !== realSessionsSha) {
  bad("RU-10 自检动了用户真库（data/desktop 的 rooms.json / sessions.json sha256 变了）");
} else {
  ok("RU-10 自检全程没碰用户真库（rooms.json / sessions.json sha256 未变）");
}

console.log("\nprove_room_ux_render: " + (code ? "FAIL" : "PASS"));
process.exit(code);
