/* prove_template_market_render.mjs — 模板市场里真的能看到用户自己的模板。
 *
 * 为什么必须真开窗口：prove_template_store.js 只能证明「Host 读得出 7 条」，
 * 证明不了渲染层把它画出来了。用户的原话是「怎么都不见了」—— 他说的是眼睛
 * 看到的那个面板，不是 JSON。
 *
 * 判据（对着具体故障）：
 *   TM-00 市场能打开且出卡片（打不开 = 后面全是假的绿）
 *   TM-01 模板数 ≥ 7 且六条内置都在 —— 旧行为下这里正好是 6，这就是对照
 *   TM-02 「自媒体」分类出现，且 team 模板媒体内容团队的卡片在
 *   TM-03 该卡片的按钮是「一键成队」（只有 kind:"team" 才走这条路）
 *   TM-04 反向对照：六条内置卡片的按钮必须是「创建」，不许全变「一键成队」
 *        （要是 isTeam 判定错了，TM-03 会假绿）
 *
 * 跑法：node scripts/prove_template_market_render.mjs
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

const BUILTIN = [
  "sales-outbound",
  "talent-scout",
  "paid-media",
  "expense-manager",
  "bug-reproduction",
  "chief-of-staff",
];

let code = 0;
const ok = (m) => console.log("  ✓ " + m);
const bad = (m, extra) => {
  code = 1;
  console.log("  ✗ " + m + (extra !== undefined ? " — " + JSON.stringify(extra) : ""));
};

const app = await _electron.launch({
  executablePath: ELECTRON,
  args: [
    path.join(DESKTOP, "main.js"),
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=" + electronUserDataDir("tpl-market-render"),
  ],
  cwd: REPO,
  env: electronLaunchEnv({
    BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
    BITBOT_LLM_API_KEY: "proof-no-call",
    BITBOT_LLM_MODEL: "proof-no-call",
    BITBOT_LLM_STREAM: "0",
  }),
});

try {
  const win = await app.firstWindow();
  await win.waitForSelector("#composer #text", { timeout: 30000 });

  /* 打开市场：优先用界面按钮（用户真会点的那条路），点不到才退回 open 函数。 */
  const opened = await win.evaluate(() => {
    const btn = document.getElementById("marketplace-btn");
    if (btn) {
      btn.click();
      return "click";
    }
    if (typeof window.openMarketplace === "function") {
      window.openMarketplace();
      return "fn";
    }
    return "none";
  });

  const cards = async () =>
    win.evaluate(() => {
      const grid = document.getElementById("mk-grid");
      if (!grid) return { grid: false, cards: [], cats: [] };
      const all = Array.from(grid.children);
      const cats = all
        .filter((el) => el.classList.contains("mk-cat-head"))
        .map((el) => (el.textContent || "").trim());
      const items = all
        .filter((el) => el.dataset && el.dataset.templateId)
        .map((el) => {
          const btn = el.querySelector("button");
          return {
            id: el.dataset.templateId,
            title: (el.textContent || "").trim().split("\n")[0],
            action: btn ? (btn.textContent || "").trim() : "",
          };
        });
      return { grid: true, cards: items, cats };
    });

  // TM-00：等卡片出来（市场是异步取目录的）
  let snap = await cards();
  try {
    await win.waitForFunction(
      () => {
        const g = document.getElementById("mk-grid");
        return !!g && !!g.querySelector("[data-template-id]");
      },
      { timeout: 15000 },
    );
    snap = await cards();
  } catch (_) {
    /* 下面按空判 */
  }
  const ids = snap.cards.map((c) => c.id);
  if (opened !== "none" && snap.cards.length) {
    ok("TM-00 模板市场打开成功（入口=" + opened + "），渲染出 " + snap.cards.length + " 张卡片");
  } else {
    bad("TM-00 市场打不开或没有卡片", { opened, count: snap.cards.length });
  }

  // TM-01：内置六条必须在，且总数 ≥ 7（旧行为下正好 6 —— 这是对照）
  const missingBuiltin = BUILTIN.filter((id) => !ids.includes(id));
  if (!missingBuiltin.length && snap.cards.length >= 7) {
    ok("TM-01 卡片 " + snap.cards.length + " 张，内置六条齐全（旧行为下是 6 张）");
  } else {
    bad("TM-01 模板数不对", { count: snap.cards.length, missingBuiltin });
  }

  // TM-02：自媒体分类 + 团队模板卡片
  const team = snap.cards.find((c) => c.id === "media-content-team");
  const hasCat = snap.cats.some((c) => c.includes("自媒体"));
  if (team && hasCat) {
    ok("TM-02 「自媒体」分类在，团队模板卡片：" + team.title);
  } else {
    bad("TM-02 自媒体/团队模板没画出来", { hasCat, team: team || null, cats: snap.cats });
  }

  // TM-03：团队卡片按钮必须是「一键成队」
  if (team && team.action === "一键成队") {
    ok("TM-03 团队模板按钮 = 一键成队（走 buildTeamFromBrief 建整队）");
  } else {
    bad("TM-03 团队模板按钮文案不对", team ? team.action : null);
  }

  // TM-04：反向对照 —— 内置六条必须都是「创建」，不许全变「一键成队」
  const builtinActions = snap.cards.filter((c) => BUILTIN.includes(c.id)).map((c) => c.action);
  const allTeam = builtinActions.length > 0 && builtinActions.every((a) => a === "一键成队");
  const anyWrong = builtinActions.filter((a) => a !== "创建");
  if (!allTeam && !anyWrong.length) {
    ok("TM-04 反向对照：内置六条按钮都是「创建」，isTeam 判定没误伤");
  } else {
    bad("TM-04 内置模板的按钮文案被带歪了（isTeam 判定错）", builtinActions);
  }

  const shot = "/tmp/tpl-market.png";
  // 面板有入场动画：立刻截图会拍到半透明的中间帧，证据就不像产品了。
  await win.waitForTimeout(900);
  await win.screenshot({ path: shot });
  console.log("  · 证据截图：" + shot);
} finally {
  await app.close();
}

console.log("\nprove_template_market_render: " + (code ? "FAIL" : "PASS"));
process.exit(code);
