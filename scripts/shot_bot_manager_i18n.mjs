/* shot_bot_manager_i18n.mjs — 真起 Electron，把「机器人管理」在 zh-CN / zh-TW / en
 * 三种语言下各拍一张 + 断言没有裸 key / 渠道名跟语言走。
 *
 * 为什么存在：BM-08/BM-23 只能证明「词条存在且被引用」，证明不了「切了语言真的变」
 * —— wavegLangApply 的生效路径（settings.set → 重启 → boot 应用）只有真开起来才走得到。
 * 渠道名原先是从 channel_bind.js 硬编码中文直接渲染的（BM-23 修的那处），
 * 这条门就是把「切语言」这件事钉死在真渲染上。
 *
 * 跑法：node scripts/shot_bot_manager_i18n.mjs [输出目录]
 */
import fs from "fs";
import os from "os";
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
const OUT = process.argv[2] || path.join(os.tmpdir(), "bitbot-bm-i18n-shots");
fs.mkdirSync(OUT, { recursive: true });

/* 每种语言的期望值：标题 / 四条渠道名 / 图标字 / 微信原因里的特征词。 */
const EXPECT = {
  "zh-CN": {
    title: "机器人管理",
    names: ["钉钉", "飞书", "企业微信", "微信"],
    shorts: ["钉", "飞", "企", "微"],
    reasonMark: "没有官方机器人接口",
  },
  "zh-TW": {
    title: "機器人管理",
    names: ["釘釘", "飛書", "企業微信", "微信"],
    shorts: ["釘", "飛", "企", "微"],
    reasonMark: "沒有官方機器人介面",
  },
  en: {
    title: "Bots",
    names: ["DingTalk", "Feishu (Lark)", "WeCom", "WeChat"],
    shorts: ["D", "F", "W", "WX"],
    reasonMark: "no official bot API",
  },
};
const LANGS = Object.keys(EXPECT);

let code = 0;
const app = await _electron.launch({
  executablePath: ELECTRON,
  args: [
    path.join(DESKTOP, "main.js"),
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=" + electronUserDataDir("bm-i18n-shot"),
  ],
  cwd: REPO,
  env: electronLaunchEnv({
    BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
    BITBOT_LLM_API_KEY: "shot-no-call",
    BITBOT_LLM_MODEL: "shot-no-call",
    BITBOT_LLM_STREAM: "0",
  }),
});

const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.log("  ✗ " + m); code = 1; };

try {
  let win = await app.firstWindow();
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  await win.evaluate(() => window.resizeTo(1100, 820));

  for (const lang of LANGS) {
    const exp = EXPECT[lang];
    // 真路径：settings.set 落盘 → 重启 → boot 应用（与用户切语言是同一条路）
    await win.evaluate(async (c) => {
      await window.bitbot.settings.set({ language: c });
      location.reload();
    }, lang);
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(400);

    await win.click("#account-avatar-btn");
    await win.waitForSelector("#ap-remote", { state: "visible", timeout: 8000 });
    await win.click("#ap-remote");
    await win.waitForSelector("#mobile-control-modal", { state: "visible", timeout: 8000 });
    await win.click("#mc-open-manager");
    await win.waitForSelector("#bot-manager-modal", { state: "visible", timeout: 8000 });
    await win.waitForTimeout(700);

    const state = await win.evaluate(() => {
      const m = document.getElementById("bot-manager-modal");
      const items = Array.from(m.querySelectorAll(".bm-item")).map((b) => ({
        short: (b.querySelector(".bm-item-ic") || {}).textContent || "",
        name: (b.querySelector(".bm-item-tx b") || {}).textContent || "",
      }));
      return {
        title: (document.getElementById("bm-title") || {}).textContent || "",
        items,
        text: m.innerText,
      };
    });
    const p = path.join(OUT, "bm-" + lang + ".png");
    await win.screenshot({ path: p });

    // 1) 标题跟语言走
    state.title === exp.title
      ? ok(lang + " 标题=" + state.title)
      : bad(lang + " 标题不对：期望「" + exp.title + "」实际「" + state.title + "」");
    // 2) 四条渠道名跟语言走（顺序 = channel_bind.js 的声明序）
    const got = state.items.map((i) => i.name);
    JSON.stringify(got) === JSON.stringify(exp.names)
      ? ok(lang + " 渠道名四条全部本地化：" + got.join(" / "))
      : bad(lang + " 渠道名不对：期望 [" + exp.names.join(",") + "] 实际 [" + got.join(",") + "]");
    // 3) 图标字跟语言走（en 是 D/F/W/WX，不再是中文「钉飞企微」）
    const gotS = state.items.map((i) => i.short);
    JSON.stringify(gotS) === JSON.stringify(exp.shorts)
      ? ok(lang + " 图标字本地化：" + gotS.join("/"))
      : bad(lang + " 图标字不对：期望 [" + exp.shorts.join(",") + "] 实际 [" + gotS.join(",") + "]");
    // 4) 整个弹窗不许出现裸 key（wavegT 兜底是返回 key 本身）
    const raw = state.text.match(/\b(?:bm|mc)[A-Z][A-Za-z0-9]{3,}\b/g) || [];
    raw.length === 0
      ? ok(lang + " 无裸 key 泄漏")
      : bad(lang + " 有裸 key 泄漏：" + raw.join(", "));
    // 5) 选中微信：原因文案跟语言走（微信是声明序的最后一条）
    await win.evaluate(() => {
      const target = Array.from(document.querySelectorAll("#bot-manager-modal .bm-item")).pop();
      if (target) target.click();
    });
    await win.waitForTimeout(400);
    const reason = await win.evaluate(() =>
      (document.getElementById("bm-bind-note") || document.querySelector("#bot-manager-modal .bm-bind-note") || {}).textContent || "");
    reason.includes(exp.reasonMark)
      ? ok(lang + " 微信原因本地化（含「" + exp.reasonMark + "」）")
      : bad(lang + " 微信原因没跟语言走：实际「" + reason.slice(0, 80) + "」");

    console.log("  saved " + p);
    // 关掉弹窗回主界面，给下一轮语言一个干净入口
    await win.keyboard.press("Escape");
    await win.waitForTimeout(300);
  }
} catch (e) {
  bad("脚本异常：" + ((e && e.message) || e));
  code = 1;
} finally {
  try { await app.close(); } catch (_) { /* 已退出 */ }
}
console.log("shot_bot_manager_i18n: " + (code ? "FAIL" : "PASS=3语言全绿"));
process.exit(code);
