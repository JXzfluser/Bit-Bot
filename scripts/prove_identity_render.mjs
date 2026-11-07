/* prove_identity_render.mjs — 真起 Electron，验「身份类文案」在真渲染里对不对。
 *
 * 为什么必须真开：prove_app_identity.js 只能证明源码里写对了，证明不了
 *   ① 进度行/内核 step 行真的渲染中文（它们是事件到达时才取词，静态扫描看不到）
 *   ② 在设置面板里换语言（**不刷新页面**）之后，动态文案会不会留下上一种语言
 *   ③ 原生菜单真的跟着换了语言
 * 这三件事都是「只有跑起来才知道」，而且第 ② 条正是真机上「中文界面里挂着一行
 * Kernel continuing」的成因。
 *
 * 判据（每条都对着一个具体故障）：
 *   RR-01 zh-CN：host_continuing 帧 → 进度行必须是「内核继续下一步」
 *   RR-02 zh-CN：entry + exec_tool 帧 → step 行是「开始处理 / 执行工具」，
 *                且整行不许出现内核符号（形如 Foo::bar 或 exec_tool 这种 op 名）
 *   RR-03 zh-CN：原生菜单第二项是「编辑」（中文界面配中文菜单，不再 Edit）
 *   RR-04 切到 en 且**不刷新页面**（先埋 window.__noReload = 1，切完全程仍是 1）：
 *                进度行 → "Kernel continuing"，step 行 → Working / Running a tool
 *   RR-05 en：原生菜单第二项是「Edit」
 *   RR-06 切回 zh-CN：进度行与 step 行必须回到中文（证明是重刷，不是碰巧）
 *
 * 跑法：node scripts/prove_identity_render.mjs
 */
import path from "path";
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

/* 内核符号的形状：Foo::bar / snake_case 的 op 名 / llm_chat 这类内部词。
   渲染给用户的那一行里一个都不许有。 */
const SYMBOL_RE = /[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*|\b(llm_chat|exec_tool|request_approval|deliver)\b/;

const app = await _electron.launch({
  executablePath: ELECTRON,
  args: [
    path.join(DESKTOP, "main.js"),
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=" + electronUserDataDir("identity-render"),
  ],
  cwd: REPO,
  env: electronLaunchEnv({
    BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
    BITBOT_LLM_API_KEY: "proof-no-call",
    BITBOT_LLM_MODEL: "proof-no-call",
    BITBOT_LLM_STREAM: "0",
  }),
});

/** 主进程 → 渲染进程发一帧（与宿主真实广播走同一条 channel）。 */
const emit = (channel, payload) =>
  app.evaluate(
    ({ BrowserWindow }, args) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return false;
      win.webContents.send(args.channel, args.payload);
      return true;
    },
    { channel, payload },
  );

/** 读原生菜单的顶层标签（主进程视角，不猜）。 */
const menuLabels = () =>
  app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    return m ? m.items.map((i) => i.label) : [];
  });

const readRows = (win) =>
  win.evaluate(() => {
    const p = document.getElementById("turn-progress-text");
    const row = document.getElementById("agent-step-live");
    return {
      progress: p ? p.textContent || "" : "",
      steps: row
        ? Array.from(row.children).map((c) => (c.textContent || "").trim())
        : [],
      noReload: window.__noReload === 1,
    };
  });

try {
  const win = await app.firstWindow();
  await win.waitForSelector("#composer #text", { timeout: 30000 });

  /* RR-00 —— 先等「boot 时的语言应用」落地。
     它会发一次 settings.get IPC，是异步的。第一版门禁在 waitForSelector
     之后立刻发帧，撞上「还没应用」的那一刻，读到英文就判红 —— 那是尺子抢跑，
     不是产品错（同一条命令第二次跑就全绿，正说明它是时序问题）。
     这里改成显式等界面出现中文（默认语言 zh-CN 的落地证据），等不到才是真红。 */
  try {
    await win.waitForFunction(
      () => {
        const el = document.querySelector('[data-i18n="credentials"]');
        return !!el && (el.textContent || "").trim() === "模型与密钥";
      },
      { timeout: 20000 },
    );
    ok("RR-00 boot 语言落地：界面是中文（默认 zh-CN）");
  } catch (_e) {
    const actual = await win.evaluate(() => {
      const el = document.querySelector('[data-i18n="credentials"]');
      return {
        credentials: el ? (el.textContent || "").trim() : "<missing>",
        langSel: (document.getElementById("gp-language") || {}).value,
      };
    });
    bad("RR-00 boot 后界面不是中文（默认语言没落地）", actual);
  }
  // 语言从 zh-CN 起（渲染端 wavegLang 的初值就是这个，settings 里没有值也走这里）
  await win.evaluate(() => window.__noReload === undefined && (window.__noReload = 0));

  /* ---------- zh-CN ---------- */
  await emit("bitbot:turn-progress", { phase: "turn_start" });
  await emit("bitbot:turn-progress", {
    phase: "host_continuing", category: "model_reply", label_key: "model", index: 1, total: 1,
  });
  await emit("bitbot:agent-loop", { kind: "entry" });
  await emit("bitbot:agent-loop", { kind: "op", op: "exec_tool" });
  await win.waitForTimeout(400);
  let s = await readRows(win);

  s.progress === "内核继续下一步"
    ? ok("RR-01 zh-CN 进度行 = 内核继续下一步")
    : bad("RR-01 zh-CN 进度行不对", s.progress);

  const stepsZh = s.steps.join(" | ");
  const zhOk = s.steps.includes("开始处理") && s.steps.includes("执行工具");
  zhOk && !SYMBOL_RE.test(stepsZh)
    ? ok("RR-02 zh-CN step 行 = 开始处理 | 执行工具（无内核符号）")
    : bad("RR-02 zh-CN step 行不对", { steps: s.steps, symbol: SYMBOL_RE.test(stepsZh) });

  let labels = await menuLabels();
  labels[1] === "编辑"
    ? ok("RR-03 zh-CN 原生菜单 = " + labels.slice(0, 3).join(" / "))
    : bad("RR-03 zh-CN 菜单没跟界面语言", labels);

  /* ---------- 切 en：走设置面板的真实事件，不刷新页面 ---------- */
  await win.evaluate(() => { window.__noReload = 1; });
  await win.evaluate(() => {
    const sel = document.getElementById("gp-language");
    sel.value = "en";
    sel.dispatchEvent(new Event("change"));
  });
  await win.waitForTimeout(900);
  s = await readRows(win);

  if (!s.noReload) {
    bad("RR-04 页面被刷新了，这次切换证明不了「动态重刷」");
  } else {
    s.progress === "Kernel continuing"
      ? ok("RR-04 en 进度行 = Kernel continuing（未刷新页面，说明是重刷）")
      : bad("RR-04 en 进度行没跟着换", s.progress);
  }
  const stepsEn = s.steps.join(" | ");
  s.steps.includes("Working") && s.steps.includes("Running a tool") && !SYMBOL_RE.test(stepsEn)
    ? ok("RR-04b en step 行 = Working | Running a tool（无内核符号）")
    : bad("RR-04b en step 行没跟着换", s.steps);

  labels = await menuLabels();
  labels[1] === "Edit"
    ? ok("RR-05 en 原生菜单 = " + labels.slice(0, 3).join(" / "))
    : bad("RR-05 en 菜单没跟着换", labels);

  /* ---------- 切回 zh-CN ---------- */
  await win.evaluate(() => {
    const sel = document.getElementById("gp-language");
    sel.value = "zh-CN";
    sel.dispatchEvent(new Event("change"));
  });
  await win.waitForTimeout(900);
  s = await readRows(win);
  s.progress === "内核继续下一步" && s.steps.includes("执行工具") && !SYMBOL_RE.test(s.steps.join(" | "))
    ? ok("RR-06 切回 zh-CN：进度行/step 行都回到中文")
    : bad("RR-06 切回 zh-CN 后留下了别的语言", s);

  labels = await menuLabels();
  labels[1] === "编辑"
    ? ok("RR-06b 切回 zh-CN：原生菜单回到「编辑」")
    : bad("RR-06b 切回 zh-CN 菜单没回来", labels);
} catch (e) {
  bad("脚本异常：" + ((e && e.message) || e));
} finally {
  try { await app.close(); } catch (_) { /* 已退出 */ }
}

console.log("prove_identity_render: " + (code ? "FAIL" : "PASS"));
process.exit(code);
