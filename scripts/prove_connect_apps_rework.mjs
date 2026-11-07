/* prove_connect_apps_rework.mjs — 「连接应用」重设计：目录只干目录的事。
 *
 * 用户的原话：「把连接应用 整体重新设计下，并把冗余的功能移除。保持功能的易用设计」。
 * 先量了旧面板（真窗口截图 + DOM dump），一屏里塞了四样东西，其中三样是重复或错位：
 *
 *   ① 目录：同一张卡被画两遍——「为你推荐」取「未安装的前 6 个」，跟下面分类区
 *      完全重叠（实测 4 行 = 2 个应用 × 2 次）。
 *   ② 分类：13 个 chip，实际只有 1 个有内容，其余点开是空列表，还得先点「更多」。
 *   ③ 标题右边「已连接 N 个」+ 头像堆叠，跟下面的应用列表是同一件事说两遍。
 *   ④ 面板底部另立一段「技能（按来源）」，而卡片副标题又写着「技能×N」。
 *   ⑤ 国内通信渠道 13 个凭证输入框常驻摊在目录里。
 *   ⑥ 搜索框写着「在应用和技能中搜索」，实际只过滤插件。
 *   ⑦ 右上角一个「Bot 模板」按钮，点了跳去另一个面板。
 *
 * 判据（真起 Electron，对着具体故障；每条都带反向对照）：
 *   CA-00 面板能从账户菜单打开（走用户手顺，不直接调内部函数）
 *   CA-01 每张卡只出现一次：DOM 卡片数 === Host 目录条数（旧版是 2 倍）
 *   CA-02 分类只有「全部 + 有内容的」；空分类与「更多」都不许出现
 *   CA-03 安装后从「可添加」移到「已连接」，不再出现在两处（总数守恒）
 *   CA-04 渠道卡默认收起（13 个字段不可见）；点开才露出，卡头就写着三家状态
 *   CA-05 插件技能跟着应用走：展开区里有 /skill 行；独立的 #ca-skills 必须不存在
 *   CA-06 面板里没有跨面板跳转（#ca-template-btn 不存在）；搜索只承诺搜应用
 *   CA-07 展开的应用占满整个网格宽度（半宽会把工具描述截断）
 *   CA-08 全程没有 pageerror
 *   CA-09 自检不碰用户真库（rooms / sessions / bots 的 sha256 前后一致）
 *
 * 数据根走 $BITBOT_DATA_ROOT，落在 <repo>/.ca-probe-<pid>，跑完即删。
 * 跑法：node scripts/prove_connect_apps_rework.mjs
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
const ok = (msg) => console.log("  ✓ " + msg);
const bad = (msg, extra) => {
  code = 1;
  console.log("  ✗ " + msg + (extra !== undefined ? " — " + JSON.stringify(extra) : ""));
};
const sha = (p) => {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch (_) {
    return null;
  }
};

const REAL = ["rooms.json", "sessions.json", "bots.json"].map((f) => path.join(REPO, "data/desktop", f));
const before = REAL.map(sha);

/* ---------------- 空数据根：目录来自 Host 的插件清单，不需要预置用户数据 ---------------- */
const ROOT = path.join(REPO, ".ca-probe-" + process.pid);
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, "desktop"), { recursive: true });

const app = await _electron.launch({
  executablePath: ELECTRON,
  args: [
    path.join(DESKTOP, "main.js"),
    "--no-sandbox",
    "--disable-gpu",
    "--user-data-dir=" + electronUserDataDir("ca-rework"),
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
  win.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e)));
  await win.waitForSelector("#composer #text", { timeout: 30000 });

  /* ---------------- CA-00 走用户手顺打开 ---------------- */
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-connect", { state: "visible", timeout: 8000 });
  await win.click("#ap-connect");
  await win.waitForSelector("#connect-apps-modal", { state: "visible", timeout: 10000 });
  await win.waitForSelector("#ca-sections .ca-app", { timeout: 15000 });
  await win.waitForTimeout(600);
  ok("CA-00 账户菜单 → 连接应用 打开成功，目录已出卡片");

  /* ---------------- 目录条数（对照组：旧版会翻倍） ---------------- */
  const payload = await win.evaluate(async () => {
    const r = await window.bitbot.plugins.list({ query: "" });
    return (r && r.plugins) || [];
  });
  const domIds = await win.evaluate(() =>
    Array.from(document.querySelectorAll("#ca-sections [data-plugin-id]")).map((el) => el.dataset.pluginId),
  );
  const uniq = new Set(domIds);
  if (domIds.length === uniq.size && domIds.length === payload.length) {
    ok("CA-01 每张卡只出现一次：目录 " + payload.length + " 条 → DOM " + domIds.length + " 张（旧版「为你推荐」会画成 " + payload.length * 2 + " 张）");
  } else {
    bad("CA-01 卡片重复或缺失", { payload: payload.map((p) => p.id), dom: domIds });
  }

  /* ---------------- 分类：只留「全部 + 有内容的」 ---------------- */
  const cats = await win.evaluate(() => {
    const box = document.getElementById("ca-cats");
    return {
      hidden: Boolean(box && box.hidden),
      chips: Array.from(document.querySelectorAll("#ca-cats .ca-chip")).map((b) => ({
        cat: b.dataset.cat,
        text: (b.textContent || "").trim(),
      })),
      more: Boolean(document.getElementById("ca-more-chip")),
      extras: document.querySelectorAll("#ca-cats .ca-extra").length,
    };
  });
  const emptyCats = [];
  for (const c of cats.chips) {
    if (c.cat === "all") continue;
    // 点着点着 chip 自己消失，本身就是毛病（分类条不该随选中项缩水）——记成空分类，别让判据崩掉。
    const still = await win.evaluate((cat) => Boolean(document.querySelector('#ca-cats .ca-chip[data-cat="' + cat + '"]')), c.cat);
    if (!still) {
      emptyCats.push(c.text + "（选中别的分类后自己消失了）");
      continue;
    }
    await win.click('#ca-cats .ca-chip[data-cat="' + c.cat + '"]');
    await win.waitForTimeout(250);
    const n = await win.evaluate((cat) => {
      const rows = document.querySelectorAll("#ca-sections [data-plugin-id]").length;
      const cn = document.getElementById("ca-cn-channels");
      const cnShown = cn && cn.style.display !== "none" ? 1 : 0;
      return rows + (cat === "communication" ? cnShown : 0);
    }, c.cat);
    if (!n) emptyCats.push(c.text);
  }
  await win.click('#ca-cats .ca-chip[data-cat="all"]');
  await win.waitForTimeout(250);
  if (!cats.more && cats.extras === 0 && !emptyCats.length && cats.chips.length <= payload.length + 2) {
    ok(
      "CA-02 分类只剩 " + cats.chips.map((c) => c.text).join(" / ") + "，逐个点开都有内容；「更多」与空分类都不在了",
    );
  } else {
    bad("CA-02 分类条还有空分类或「更多」", { emptyCats, more: cats.more, extras: cats.extras, chips: cats.chips });
  }

  /* ---------------- 安装 → 从「可添加」移到「已连接」，不是两处都留 ---------------- */
  const target = payload.find((p) => p && !p.installed);
  if (!target) {
    ok("CA-03 目录里没有可安装的应用（跳过）——本次判据不适用");
  } else {
    const before3 = await win.evaluate(() => ({
      on: document.querySelectorAll("#ca-sections .ca-app.is-installed").length,
      off: document.querySelectorAll("#ca-sections .ca-app").length,
    }));
    const op = await win.evaluate(
      async (id) => await window.bitbot.plugins.op({ action: "install", plugin_id: id }),
      target.id,
    );
    await win.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await win.evaluate(async () => {
      // 面板开着的时候重新拉一次目录（用户点「添加」走的就是这条路）
      if (typeof refreshConnectApps === "function") await refreshConnectApps();
    });
    await win.waitForTimeout(1200);
    const after3 = await win.evaluate((id) => {
      const rows = Array.from(document.querySelectorAll("#ca-sections [data-plugin-id]"));
      const mine = rows.filter((el) => el.dataset.pluginId === id);
      return {
        count: rows.length,
        mine: mine.length,
        installedMine: mine.filter((el) => el.classList.contains("is-installed")).length,
        groups: Array.from(document.querySelectorAll("#ca-sections .ca-section-title")).map((e) => e.textContent),
      };
    }, target.id);
    if (op && op.ok && after3.mine === 1 && after3.installedMine === 1 && after3.count === before3.off) {
      ok(
        "CA-03 装了「" + target.id + "」→ 只出现一次且进了「已连接」（分组：" + after3.groups.join(" / ") + "），目录总数仍是 " + after3.count,
      );
    } else {
      bad("CA-03 安装后卡片重复或没换组", { op, before: before3, after: after3 });
    }

    /* ---------------- 技能跟着应用走 ---------------- */
    const skills = await win.evaluate(() => {
      const row = document.querySelector("#ca-sections .ca-app.is-installed .ca-app-row");
      if (row) row.click();
      const panel = document.querySelector("#ca-sections .ca-app.is-installed .ca-app-tools");
      return {
        legacyList: Boolean(document.getElementById("ca-skills")),
        legacyFn: typeof window.renderConnectAppsSkills,
        heads: panel ? Array.from(panel.querySelectorAll(".ca-app-tools-head,.ca-app-skills-head")).map((e) => e.textContent) : [],
        slash: panel ? Array.from(panel.querySelectorAll(".ca-app-skill code")).map((e) => e.textContent) : [],
        tools: panel ? panel.querySelectorAll(".ca-tool").length : 0,
      };
    });
    if (!skills.legacyList && skills.heads.some((h) => /技能/.test(h)) && skills.slash.length > 0) {
      ok(
        "CA-05 技能长在应用里：" + skills.heads.join(" / ") + "，" + skills.slash.join("、") + "（面板里已无独立的技能列表）",
      );
    } else {
      bad("CA-05 技能没有跟应用走，或旧技能列表还在", skills);
    }

    /* ---------------- 展开占满整行 ---------------- */
    const width = await win.evaluate(() => {
      const open = document.querySelector("#ca-sections .ca-app.is-open");
      const grid = open ? open.closest(".ca-grid") : null;
      if (!open || !grid) return null;
      return {
        app: Math.round(open.getBoundingClientRect().width),
        grid: Math.round(grid.getBoundingClientRect().width),
      };
    });
    if (width && Math.abs(width.app - width.grid) <= 2) {
      ok("CA-07 展开的应用占满整行（" + width.app + "px ≈ 网格 " + width.grid + "px），工具描述不再被半栏截断");
    } else {
      bad("CA-07 展开区还是半宽", width);
    }
  }

  /* ---------------- 渠道卡：默认收起，卡头先说状态 ---------------- */
  const cn = await win.evaluate(() => {
    const box = document.getElementById("ca-cn-box");
    const hook = document.getElementById("sec-ding-hook");
    const state = document.getElementById("cn-card-state");
    /* <details> 收起时 Chromium 用的是 content-visibility（不是 display:none），
     * 几何量法会读到「上次布局的尺寸」，offsetParent 也照样非空。
     * 唯一诚实的问法是：它到底有没有被画出来 —— checkVisibility。 */
    const vis = (el) => {
      if (!el) return null;
      try {
        return el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
      } catch (_) {
        return null;
      }
    };
    return {
      exists: Boolean(box),
      open: box ? box.open : null,
      hookPainted: vis(hook),
      state: state ? String(state.textContent || "").trim() : "",
      fields: document.querySelectorAll("#ca-cn-channels input").length,
    };
  });
  if (cn.exists && cn.open === false && cn.hookPainted === false && /钉钉|飞书|企微/.test(cn.state)) {
    ok("CA-04 渠道卡默认收起（" + cn.fields + " 个字段都在 DOM 里，一个都没画出来），卡头就写着「" + cn.state + "」");
  } else {
    bad("CA-04 渠道卡没有默认收起，或卡头没写状态", cn);
  }
  await win.click("#ca-cn-box > summary");
  await win.waitForTimeout(300);
  const cnOpen = await win.evaluate(() => {
    const hook = document.getElementById("sec-ding-hook");
    const box = document.getElementById("ca-cn-box");
    if (hook && hook.scrollIntoView) hook.scrollIntoView({ block: "center" });
    let painted = null;
    try {
      painted = hook ? hook.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }) : null;
    } catch (_) {}
    return { open: box.open, hookPainted: painted };
  });
  if (cnOpen.open && cnOpen.hookPainted === true) {
    ok("CA-04b 点一下卡头 → 展开，Webhook 字段立即可见（不用再找别处）");
  } else {
    bad("CA-04b 展开后字段仍不可见", cnOpen);
  }
  await win.click("#ca-cn-box > summary");
  await win.waitForTimeout(200);

  /* ---------------- 跨面板跳转与「搜技能」的承诺都撤掉了 ---------------- */
  const leftovers = await win.evaluate(() => ({
    tplBtn: Boolean(document.getElementById("ca-template-btn")),
    ph: (document.getElementById("ca-search") || {}).placeholder || "",
    connectedPill: Boolean(document.getElementById("ca-connected")),
    stack: Boolean(document.getElementById("ca-stack")),
  }));
  if (!leftovers.tplBtn && !leftovers.connectedPill && !leftovers.stack && !/技能/.test(leftovers.ph)) {
    ok("CA-06 面板里没有「Bot 模板」跨面板按钮、没有重复的「已连接」胶囊，搜索框只承诺「" + leftovers.ph + "」");
  } else {
    bad("CA-06 冗余入口还在", leftovers);
  }

  if (!pageErrors.length) ok("CA-08 全程没有 pageerror");
  else bad("CA-08 渲染层抛错", pageErrors.slice(0, 3));

  await win.screenshot({ path: "/tmp/ca-rework.png" });
  console.log("  · 证据截图：/tmp/ca-rework.png");
} catch (e) {
  bad("CA-00 自检抛错", String((e && e.stack) || e).slice(0, 400));
} finally {
  await app.close();
  fs.rmSync(ROOT, { recursive: true, force: true });
}

const after = REAL.map(sha);
if (after.every((v, i) => v === before[i])) {
  ok("CA-09 自检全程没碰用户真库（rooms / sessions / bots 的 sha256 未变）");
} else {
  bad("CA-09 自检动了用户真库", { before, after });
}

console.log("\nprove_connect_apps_rework: " + (code ? "FAIL" : "PASS"));
process.exit(code);
