/* e2e_desktop_llm_key_paste_guard.mjs — 模型密钥粘错了，要在写盘之前当场说清楚（LK-01..07）
 *
 * 为什么这条值得单独钉：博主场景里第一次装完 app，最容易卡死的一步就是「填模型 key」。
 * 用户是从聊天窗口 / 控制台里**粘**过来的，粘出来的东西经常不是纯 key：
 *   · 连着 HTTP 头的写法 `Authorization: Bearer sk-…`（文档里就是这么写的）；
 *   · 从**我们自己的界面**上复制了掩码 `****3k7q`（状态行就摆在那儿，手快就会选中它）；
 *   · 中间夹了换行 / 空格（从微信、飞书里复制常见），或者粘到了旁边的中文说明；
 *   · 只粘了一半（`sk-`）。
 * 这些值现在**一个都不拦**：写进 .env.local、热加载进 process.env，然后模型调用报
 * 401 / 「大脑仍缺 key」——用户看到的是「模型连不上」，真实原因是三周前粘错的一行。
 * 这就是 §8.20 那条标准反面：能填 ≠ 走得通。
 *
 * 断言（全部在真 Electron 渲染的 DOM 上读；**不点真保存**，见文件末尾的安全边界）：
 *   LK-01 粘进 `Bearer sk-…` / `Authorization: Bearer sk-…` → 就地清成纯 key，并写明清了什么
 *   LK-02 粘进界面显示的掩码 `****3k7q` → 当场点名「那是掩码不是密钥」，红字 + 保存不可点
 *   LK-03 键中间有空白 / 有中文 / 短得像没粘全 → 点名；而**首尾**空白只是被 trim，不算错
 *   LK-04 正常 `sk-…` → 0 条红字、保存可点（校验不许变成新门槛）
 *   LK-05 留空 = 不改动旧密钥，界面上必须这么说（否则用户以为留空会把 key 清掉）
 *   LK-06 备用渠道 key（通义 / Kimi）与搜索 key 走同一套：掩码误粘同样当场拦住
 *   LK-07 红字是即时反馈不是永久噪音：改对之后红字消失、保存恢复可点
 *
 * 安全边界（本轮实测换来的，别为了门禁去动密钥写盘路径）：
 *   1. `window.bitbot.secrets.set` 是 contextBridge 挂上来的，**不可重定义**
 *      （实测 Cannot redefine property: set），所以在渲染进程里桩不掉 IPC；
 *   2. 真点「保存并热加载」会写 `hosts/desktop/.env.local` —— 那是**固定路径**，
 *      `BITBOT_REPO_ROOT` 隔离不到它，门禁一点就把假 key 落进用户真文件。
 *   所以这条门只读「红字 + sec-save.disabled」：挡在写盘之前的那道闸**本身就是**被测对象，
 *   不需要真的走到写盘那一步。
 *
 * 跑法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_llm_key_paste_guard.mjs
 * 缺 electron / 缺显示环境时诚实 SKIP（SKIP ≠ PASS）。
 *
 * ── 修复前红（同一轮实测）────────────────────────────────────────────
 *   ✗ LK-01 粘进「Authorization: Bearer sk-…」没有被就地清成纯 key — got "Authorization: Bearer sk-gate-0123456789"
 *   ✗ LK-02 把掩码 ****3k7q 当密钥收下啦 — errShown:false, saveDisabled:false
 *   ✗ LK-03 这几类粘法本该当场点名 — 中间空格 / 中文 / 只粘了一半，三条全部无红字
 *   ✓ LK-04 正常的 sk-… 密钥 0 条红字、保存可点            ← 空断言：那时根本没有校验
 *   ✗ LK-05 界面上没说清「留空＝不改动」 — mask 只有「（已配置 ****3k7q）」
 *   ✗ LK-06 这些栏把掩码当密钥收下了 — 通义 / Kimi / 搜索三栏全放过
 *   ✓ LK-07 改对之后红字当场收回（0 条红字）                ← 同样是空断言
 *   合计 PASS=2 FAIL=5；两条绿的是「没有校验所以当然不报红」白送的。
 *
 * ── 补完之后的两轮红，以及它们各自红在谁身上 ─────────────────────────
 *   第二轮 PASS=5 FAIL=2：
 *     ✗ LK-01 note 是空的 —— 一次粘贴连着触发 paste/input/change，第二个事件里
 *       归一化已经无事可做，于是把刚写明的「替他清掉了什么」擦掉了。产品的归一化
 *       一直是好的，红的是「说明活不过第二个事件」。→ 记下上一轮留在框里的值，
 *       同一个值被重复刷新时保留说明。
 *     ✗ LK-07 全部改对仍拦着保存 —— 门禁自己的错：上一版只清了通义与搜索两栏，
 *       Kimi 那栏还留着 LK-06 故意粘进去的 ****3k7q。红的是尺子，不是产品。
 *
 * ── 负向对照（证明这七条都不是恒真）─────────────────────────────────
 *   对照 1：`secretKeyProblem` 一进来就 return ""（把校验整条摘掉）
 *     → LK-02 / LK-03 / LK-06 立刻翻红（PASS=4 FAIL=3），LK-04/05/07 仍绿。
 *   对照 2：反过来让 `secretKeyProblem` 对任何值都报错
 *     → LK-04 / LK-05 / LK-07 翻红（PASS=2 FAIL=5），连 LK-02/03 也红——
 *       因为它们要求的是**说对了原因**，不是「有红字就行」。
 *   也就是说：这道门既拦「不拦错的」，也拦「拦太过的」。
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import {
  electronLaunchEnv,
  electronUserDataDir,
  isolatedRepoRoot,
  gateAppEnv,
  hasDisplay,
  killGateProcs,
} from "./electron_env.mjs";

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
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : ""));
};
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_llm_key_paste_guard: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_llm_key_paste_guard: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_llm_key_paste_guard: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_llm_key_paste_guard: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const GOOD_KEY = "sk-gate-0123456789abcdef0123456789abcdef";
const MASKED = "****3k7q";
const root = isolatedRepoRoot(REPO, "lkpaste", {
  "bots.json": { bots: [{ id: "b1", name: "派单助手", job: "派单调度", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW }], primary: "b1" },
  // dev_mode 开着：这个页面在精简外壳里也要能拿到；表单本身两种模式都渲染。
  "settings.json": { notify: {}, dev_mode: true },
  "sessions.json": { sessions: [] },
});
const UD = electronUserDataDir("lkpaste");

function launch() {
  return _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
    cwd: REPO,
    env: electronLaunchEnv(
      gateAppEnv(root, {
        // 让「已配置」这条路真的被走到（LK-05 要读状态行文案）。
        BITBOT_LLM_API_KEY: "gate-existing-key-9f3k7q",
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
        BITBOT_LLM_MODEL: "gate-no-call",
        BITBOT_LLM_STREAM: "0",
      }),
    ),
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在页面里往密钥栏「粘」一段文本：填值 → 触发 paste/change/input（真用户paste 之后
 *  浏览器就是这几个事件），然后读回输入框的值、错误位与保存按钮状态。 */
async function pasteInto(win, id, text) {
  return win.evaluate(
    (a) => {
      const el = document.getElementById(a.id);
      if (!el) return { missing: true };
      el.focus();
      el.value = a.text;
      el.dispatchEvent(new Event("paste", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      const err = document.getElementById(a.id + "-err");
      const note = document.getElementById(a.id + "-note");
      const save = document.getElementById("sec-save");
      const mask = document.getElementById(a.id.replace("-key", "-mask"));
      return {
        value: el.value,
        errShown: !!err && !err.hidden && String(err.textContent || "").trim().length > 0,
        errText: err ? String(err.textContent || "").trim() : "",
        noteText: note && !note.hidden ? String(note.textContent || "").trim() : "",
        saveDisabled: save ? Boolean(save.disabled) : null,
        maskText: mask ? String(mask.textContent || "").trim() : "",
      };
    },
    { id, text },
  );
}

let app = null;

(async () => {
  try {
    app = await launch();
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await sleep(600);

    await win.click("#account-avatar-btn");
    await win.waitForSelector("#ap-settings", { state: "visible", timeout: 8000 });
    await win.click("#ap-settings");
    await win.waitForSelector("#settings-panel", { state: "visible", timeout: 10000 });
    await win.click('.settings-tab-btn[data-stab="credentials"]');
    await win.waitForSelector("#sec-llm-key", { state: "visible", timeout: 10000 });
    // 凭证页打开会异步刷一次 secrets:status（掩码文案由它写）
    await sleep(900);

    /* ---------- LK-01 粘进 HTTP 头写法：就地清成纯 key，并说清清了什么 ---------- */
    {
      const r = await pasteInto(win, "sec-llm-key", "Authorization: Bearer " + GOOD_KEY);
      if (r.missing) bad("LK-01 找不到 #sec-llm-key");
      else if (r.value !== GOOD_KEY) bad("LK-01 粘进「Authorization: Bearer sk-…」没有被就地清成纯 key", JSON.stringify({ got: r.value.slice(0, 40) }));
      else if (!/Bearer|前缀|頭|头/.test(r.noteText)) bad("LK-01 清了前缀却没告诉用户清了什么（悄悄改用户粘的东西最招骂）", JSON.stringify({ note: r.noteText }));
      else ok("LK-01 粘进 HTTP 头写法自动收成纯 key，并写明「去掉的是什么」（" + r.noteText.slice(0, 40) + "）");
    }

    /* ---------- LK-02 粘成界面自己的掩码：当场拦住 ---------- */
    {
      const r = await pasteInto(win, "sec-llm-key", MASKED);
      if (r.missing) bad("LK-02 找不到 #sec-llm-key");
      else if (!r.errShown) bad("LK-02 把掩码 ****3k7q 当密钥收下啦（要等到模型 401 才发现）", JSON.stringify(r));
      else if (!/掩码|.mask/.test(r.errText)) bad("LK-02 报了红字但没点明这是掩码", JSON.stringify({ err: r.errText }));
      else if (r.saveDisabled !== true) bad("LK-02 红字有了但保存仍可点（错误挡不住写盘就是假修）", JSON.stringify({ saveDisabled: r.saveDisabled }));
      else ok("LK-02 粘到界面自己的掩码会当场点名并挡住保存：「" + r.errText.slice(0, 40) + "」");
    }

    /* ---------- LK-03 中间空白 / 中文 / 太短：点名；首尾空白只 trim ---------- */
    {
      const mid = await pasteInto(win, "sec-llm-key", "sk-gate-01234567 89abcdef");
      const zh = await pasteInto(win, "sec-llm-key", "sk-在此粘贴你的密钥");
      const short = await pasteInto(win, "sec-llm-key", "sk-");
      const padded = await pasteInto(win, "sec-llm-key", "  " + GOOD_KEY + "\n ");
      const problems = [
        ["中间空格", mid, /空格|换行|空白/],
        ["中文", zh, /中文/],
        ["只粘了一半", short, /没粘全|太短|完整/],
      ].filter(([, r, re]) => !r.errShown || !re.test(r.errText));
      if (problems.length) bad("LK-03 这几类粘法本该当场点名", JSON.stringify(problems.map(([n, r]) => [n, r.errShown, r.errText.slice(0, 40)])));
      else if (padded.errShown) bad("LK-03 首尾空白被当成错误（应静默 trim，不是红字）", JSON.stringify({ err: padded.errText }));
      else if (padded.value !== GOOD_KEY) bad("LK-03 首尾空白没有被 trim 掉", JSON.stringify({ got: JSON.stringify(padded.value.slice(0, 12)) }));
      else ok("LK-03 键中间空白 / 中文 / 只粘一半都会当场点名，首尾空白只静默 trim（不算错）");
    }

    /* ---------- LK-04 正常 key 不许被拦 ---------- */
    {
      const r = await pasteInto(win, "sec-llm-key", GOOD_KEY);
      if (r.errShown || r.saveDisabled) bad("LK-04 正常密钥被拦住了（校验变成新门槛）", JSON.stringify({ err: r.errText, saveDisabled: r.saveDisabled }));
      else ok("LK-04 正常的 sk-… 密钥 0 条红字、保存可点（校验不是门槛）");
    }

    /* ---------- LK-05 留空 = 不改动，界面上要说 ---------- */
    {
      const r = await pasteInto(win, "sec-llm-key", "");
      const headless = await win.evaluate(() => {
        const m = document.getElementById("sec-llm-mask");
        return { mask: m ? String(m.textContent || "").trim() : "" };
      });
      const saysKeep = /留空|不改|保持|不受影響|不受影响/.test(headless.mask);
      if (r.errShown) bad("LK-05 留空被当错了（留空就是不改动，不是错误）", JSON.stringify({ err: r.errText }));
      else if (!/已配置/.test(headless.mask)) bad("LK-05 状态行没有如实说已配置的密钥", JSON.stringify(headless));
      else if (!saysKeep) bad("LK-05 界面上没说清「留空＝不改动」——用户会以为留空能把旧 key 清掉，或者干脆不敢保存", JSON.stringify(headless));
      else ok("LK-05 留空不报错，且状态行写明「留空＝不改动」：" + headless.mask.slice(0, 46));
    }

    /* ---------- LK-06 备用渠道与搜索 key 同规则 ---------- */
    {
      await win.evaluate(() => {
        const d = document.getElementById("sec-alt-channels");
        if (d && typeof d.open === "boolean") d.open = true;
      });
      const rows = ["sec-qwen-key", "sec-moon-key", "sec-search-key"];
      const res = [];
      for (const id of rows) {
        const r = await pasteInto(win, id, MASKED);
        res.push({ id, missing: r.missing, errShown: r.errShown, errText: r.errText, saveDisabled: r.saveDisabled });
      }
      const absent = res.filter((x) => x.missing);
      const notCaught = res.filter((x) => !x.missing && !x.errShown);
      const notBlocked = res.filter((x) => !x.missing && x.errShown && x.saveDisabled !== true);
      if (absent.length) bad("LK-06 这几个密钥栏不存在", JSON.stringify(absent.map((x) => x.id)));
      else if (notCaught.length) bad("LK-06 这些栏把掩码当密钥收下了", JSON.stringify(notCaught.map((x) => [x.id, x.errText])));
      else if (notBlocked.length) bad("LK-06 这些栏报了红但挡不住保存", JSON.stringify(notBlocked.map((x) => x.id)));
      else ok("LK-06 通义 / Kimi / 搜索 key 与主密钥同规则：掩码误粘当场拦住、保存也按不动");
    }

    /* ---------- LK-07 改对之后红字要消失 ---------- */
    {
      await pasteInto(win, "sec-llm-key", MASKED);
      const fixed = await pasteInto(win, "sec-llm-key", GOOD_KEY);
      await win.evaluate(() => {
        /* 这条断的是「全部改对之后红字要收回」，所以 LK-06 里故意粘错的三栏
           都得清干净——上一版只清了通义和搜索，Kimi 那栏还留着 ****3k7q，
           于是「仍然拦着保存」红的是门禁自己，不是产品。 */
        ["sec-qwen-key", "sec-moon-key", "sec-search-key"].forEach((id) => {
          const el = document.getElementById(id);
          if (!el) return;
          el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
      });
      const after = await win.evaluate(() => {
        const ids = ["sec-llm-key", "sec-qwen-key", "sec-moon-key", "sec-search-key"];
        const shown = ids
          .map((i) => document.getElementById(i + "-err"))
          .filter((e) => e && !e.hidden && String(e.textContent || "").trim());
        const save = document.getElementById("sec-save");
        return { errs: shown.length, saveDisabled: save ? Boolean(save.disabled) : null };
      });
      if (fixed.errShown) bad("LK-07 改对了红字还在（红字变噪音，用户就不信它了）", JSON.stringify({ err: fixed.errText }));
      else if (after.errs > 0 || after.saveDisabled) bad("LK-07 全部改对之后仍然拦着保存", JSON.stringify(after));
      else ok("LK-07 改对之后红字当场收回（4 栏剩 " + after.errs + " 条红字），保存恢复可点");
    }
  } catch (e) {
    bad("门禁本身跑挂", String(e && e.stack ? e.stack.slice(0, 400) : e));
  } finally {
    try {
      if (app) await app.close();
    } catch (e) {
      /* app 已退出 */
    }
    killGateProcs();
  }
  done("e2e_desktop_llm_key_paste_guard");
})();
