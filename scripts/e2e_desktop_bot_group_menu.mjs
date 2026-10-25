/* e2e_desktop_bot_group_menu.mjs — Bot 右键菜单「移动到分组」的真渲染门禁。
 *
 * 这一版是把原来的独立输入弹层（输入框 + 清除分组 / 取消 / 移动 三颗等宽按钮）
 * 拆掉、内联进主菜单之后写的。旧方案有三处结构性问题，只有真渲染才验得出来：
 *   1. 一次选择被拆成"输入 → 再点移动"，而最常见的那件事（放进已有分组）
 *      反而要打字；
 *   2. 弹层是第二个 fixed 浮层，两个 .composer-menu 同时存在时点穿/叠压说不清；
 *   3. 弹层关掉以后没有任何回执——分组到底挪没挪，侧栏不长眼睛就看不出来。
 *
 * 所以这个门禁断的是"没有弹框之后"的行为：
 *   G-01 侧栏按 group 字段分节渲染（组名 + 数量），未分组平铺。
 *   G-02 右键 Bot → 菜单里就地有一个「移动到分组」折叠头，且全程只有 1 个浮层。
 *   G-03 展开后：已有分组可点（当前所在组带 ✓）、新建输入框、未分组项都在。
 *   G-04 点已有分组 → 菜单关闭、bots.json 落盘、目标组数量 +1、目标组闪一下。
 *   G-05 输入新组名回车 → 新分组真的出现在侧栏。
 *   G-06 点「未分组」→ group 清空、空组不再渲染（不留一个空壳组头）。
 *   G-07 门禁自己没把夹具漏进用户的 data/desktop。
 *
 * 顺带守住同一轮的另一处改动（发送按钮不再用 ↑ 字符拼字形）：
 *   S-01 #send 里是内联 SVG 箭头，不是 U+2191 文本。
 *
 * 跑在隔离根目录里（BITBOT_REPO_ROOT），夹具只存在于临时目录，跑完删掉。
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
  console.log("e2e_desktop_bot_group_menu: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_bot_group_menu: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_bot_group_menu: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_bot_group_menu: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

const REAL_BOTS = path.join(REPO, "data/desktop/bots.json");
const FIXTURE_SENTINELS = ["bot-grp-a", "bot-grp-b", "bot-grp-c", "侦察兵甲", "文案乙", "配图丙", "情报组", "二期规划"];
const fixtureLeak = () => {
  if (!fs.existsSync(REAL_BOTS)) return null;
  const txt = fs.readFileSync(REAL_BOTS, "utf8");
  for (const s of FIXTURE_SENTINELS) if (txt.includes(s)) return { file: REAL_BOTS, sentinel: s };
  return null;
};

const NOW = new Date().toISOString();
const bot = (id, name, job, group) => ({
  id,
  name,
  job,
  description: job,
  avatar: "",
  hidden: false,
  pinned: false,
  group: group || "",
  created_at: NOW,
  updated_at: NOW,
});
const FIXTURE_FILES = {
  "bots.json": {
    version: 1,
    primary_id: "bot-grp-a",
    bots: [
      bot("bot-grp-a", "侦察兵甲", "搜集素材", "情报组"),
      bot("bot-grp-b", "文案乙", "写稿", ""),
      bot("bot-grp-c", "配图丙", "配图", ""),
    ],
  },
};

const readStore = (root) => {
  const f = path.join(root, "data/desktop/bots.json");
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const groupOf = (store, id) => {
  const b = ((store && store.bots) || []).find((x) => x && x.id === id);
  return b ? (typeof b.group === "string" ? b.group : "") : null;
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

/* 侧栏此刻的分组结构：按文档序走一遍 #bot-list，记下每个组头与它下面挂了哪些行。
   这样既能验「组名 + 数量」，也能验「未分组平铺」，还能验「同一个组头有没有被
   画两遍」（并发 refreshBots 的症状）。 */
const readSidebar = (win) =>
  win.evaluate(() => {
    const heads = [];
    const ungrouped = [];
    let cur = null;
    for (const el of document.querySelectorAll("#bot-list > *")) {
      if (el.classList.contains("bot-group-head")) {
        cur = {
          name: (el.firstElementChild ? el.firstElementChild.textContent : "").trim(),
          count: (el.querySelector(".cnt") ? el.querySelector(".cnt").textContent : "").trim(),
          moved: el.classList.contains("just-moved"),
          rows: [],
        };
        heads.push(cur);
      } else if (el.dataset && el.dataset.agentId) {
        (cur ? cur.rows : ungrouped).push(el.dataset.agentId);
      }
    }
    return {
      heads: heads.map((h) => ({ name: h.name, count: h.count, moved: h.moved })),
      ungrouped,
      totalRows: heads.reduce((n, h) => n + h.rows.length, 0) + ungrouped.length,
    };
  });

/* 「浮层」只能数真正看得见的那些：#composer-menu（输入框左侧 + 号菜单）常驻
   DOM 且 hidden，按 class 直接 count 会永远多 1。 */
const visibleMenus = (win) =>
  win.evaluate(() =>
    Array.from(document.querySelectorAll(".composer-menu")).filter((m) => {
      if (m.hidden) return false;
      if (getComputedStyle(m).display === "none") return false;
      return m.getBoundingClientRect().height > 0;
    }).length,
  );

(async () => {
  console.log("e2e_desktop_bot_group_menu — 「移动到分组」内联菜单 + 发送按钮图标的真渲染门禁");
  const root = isolatedRepoRoot(REPO, "bot-group", FIXTURE_FILES);
  let app = null;
  try {
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [
        path.join(DESKTOP, "main.js"),
        "--no-sandbox",
        "--disable-gpu",
        "--user-data-dir=" + electronUserDataDir("bot-group"),
      ],
      cwd: REPO,
      env: electronLaunchEnv(gateAppEnv(root)),
    });
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(900);

    /* 侧栏默认折叠成头像条（G-28 #2），先展开再量分组结构。 */
    await win.evaluate(() => {
      const sec = document.getElementById("sb-bots-rooms");
      if (sec) sec.classList.remove("collapsed");
    });
    await win.waitForSelector('#bot-list [data-agent-id="bot-grp-b"]', { timeout: 15000 });

    /* G-01 分节渲染 */
    const s1 = await readSidebar(win);
    const heads1 = s1.heads.filter((h) => h.name === "情报组");
    heads1.length === 1 &&
    heads1[0].count === "1" &&
    s1.ungrouped.includes("bot-grp-b") &&
    s1.ungrouped.includes("bot-grp-c")
      ? ok("G-01 侧栏按 group 分节：情报组 1 个（只一个组头），未分组的乙/丙平铺在外")
      : bad("G-01 分组渲染不对", JSON.stringify(s1));

    /* G-02 右键 → 菜单里就地一个折叠头，全程只有 1 个浮层 */
    await win.click('#bot-list [data-agent-id="bot-grp-b"]', { button: "right" });
    await win.waitForTimeout(300);
    const m1 = await win.evaluate(() => {
      const menus = Array.from(document.querySelectorAll(".composer-menu")).filter((m) => {
        if (m.hidden) return false;
        return m.getBoundingClientRect().height > 0;
      });
      const menu = menus[menus.length - 1];
      if (!menu) return { menus: 0 };
      const head = menu.querySelector(".menu-group-head");
      const sub = menu.querySelector(".menu-sub");
      return {
        menus: menus.length,
        hasHead: !!head,
        headText: head ? head.textContent.trim() : "",
        expanded: head ? head.getAttribute("aria-expanded") : null,
        subHidden: sub ? sub.hidden : null,
        // 「移动…」后面带省略号的旧菜单项必须消失（它意味着还要再弹一层）
        legacyEllipsis: Array.from(menu.querySelectorAll("button")).some((b) =>
          /移动到分组…|Move to group…/.test(b.textContent || ""),
        ),
      };
    });
    m1.menus === 1 && m1.hasHead && m1.subHidden === true && m1.legacyEllipsis === false
      ? ok("G-02 菜单内联分组折叠头（默认收起：" + JSON.stringify(m1.headText) + "），只有 1 个浮层")
      : bad("G-02 菜单结构不对", JSON.stringify(m1));

    /* G-08 菜单只留高频动作：创建副本 / 从侧栏隐藏 / 设为 Primary 都搬到
       Bot 设置右栏（那里能看清当前状态），右键里不再重复一遍。 */
    const inv = await win.evaluate(() => {
      const menus = Array.from(document.querySelectorAll(".composer-menu")).filter(
        (m) => !m.hidden && m.getBoundingClientRect().height > 0,
      );
      const menu = menus[menus.length - 1];
      const texts = menu.textContent || "";
      return {
        items: Array.from(menu.querySelectorAll(":scope > button[data-menu]")).map((b) => b.dataset.menu),
        seps: menu.querySelectorAll(".menu-sep").length,
        hasHead: !!menu.querySelector(".menu-group-head"),
        dup: /创建副本|Duplicate/.test(texts),
        hide: /从侧栏隐藏|Hide from sidebar/.test(texts),
        primary: /设为 Primary|Set as Primary/.test(texts),
      };
    });
    inv.items.join(",") === "pin,edit,settings,delete" && inv.hasHead && inv.seps === 2 && !inv.dup && !inv.hide && !inv.primary
      ? ok("G-08 右键只留 置顶/编辑/设置/(分组)/删除 五项 + 2 条分隔线；副本·隐藏·Primary 已移出")
      : bad("G-08 菜单项没有收敛", JSON.stringify(inv));

    /* G-03 展开：已有分组 + 新建输入框 + 未分组项 */
    await win.evaluate(() => {
      const menus = document.querySelectorAll(".composer-menu");
      const head = menus[menus.length - 1].querySelector(".menu-group-head");
      head.click();
    });
    await win.waitForTimeout(200);
    const m2 = await win.evaluate(() => {
      const menus = Array.from(document.querySelectorAll(".composer-menu")).filter((m) => {
        if (m.hidden) return false;
        return m.getBoundingClientRect().height > 0;
      });
      const menu = menus[menus.length - 1];
      const sub = menu.querySelector(".menu-sub");
      const btns = Array.from(sub.querySelectorAll("button"));
      const input = sub.querySelector("input");
      return {
        hidden: sub.hidden,
        items: btns.map((b) => b.textContent.trim()),
        current: btns.filter((b) => b.getAttribute("aria-current") === "true").map((b) => b.textContent.trim()),
        hasInput: !!input,
        maxLength: input ? input.maxLength : null,
        placeholder: input ? input.placeholder : "",
        menus: menus.length,
      };
    });
    m2.hidden === false &&
    m2.items.includes("情报组") &&
    m2.items.includes("未分组") &&
    m2.hasInput &&
    m2.maxLength === 24 &&
    m2.menus === 1
      ? ok("G-03 展开后是 [已有分组 情报组] + 新建输入框 + [未分组]，仍未生成第二个浮层")
      : bad("G-03 展开内容不对", JSON.stringify(m2));

    /* G-04 点已有分组 → 落盘 + 数量 +1 + 闪一下 */
    await win.evaluate(() => {
      const menus = document.querySelectorAll(".composer-menu");
      const sub = menus[menus.length - 1].querySelector(".menu-sub");
      Array.from(sub.querySelectorAll("button"))
        .find((b) => b.textContent.trim() === "情报组")
        .click();
    });
    // 闪烁只有 1s，用轮询确认"确实闪过"而不是刚好错过
    let sawFlash = false;
    for (let i = 0; i < 40 && !sawFlash; i++) {
      const s = await readSidebar(win);
      if (s.heads.some((h) => h.name === "情报组" && h.moved)) sawFlash = true;
      if (!sawFlash) await win.waitForTimeout(50);
    }
    await win.waitForTimeout(400);
    const store1 = readStore(root);
    const s2 = await readSidebar(win);
    const head2 = s2.heads.find((h) => h.name === "情报组");
    const menusAfter = await visibleMenus(win);
    groupOf(store1, "bot-grp-b") === "情报组" &&
    head2 &&
    head2.count === "2" &&
    s2.heads.filter((h) => h.name === "情报组").length === 1 &&
    menusAfter === 0 &&
    sawFlash
      ? ok("G-04 点已有分组：bots.json 落盘、情报组 2 个（组头只有一个）、菜单关闭、目标组闪烁过")
      : bad(
          "G-04 移动没生效",
          JSON.stringify({ group: groupOf(store1, "bot-grp-b"), heads: s2.heads, menusAfter, sawFlash }),
        );

    /* G-05 新建分组：输入框回车即建 */
    await win.click('#bot-list [data-agent-id="bot-grp-c"]', { button: "right" });
    await win.waitForTimeout(250);
    await win.evaluate(() => {
      const menus = document.querySelectorAll(".composer-menu");
      menus[menus.length - 1].querySelector(".menu-group-head").click();
    });
    await win.waitForTimeout(200);
    await win.evaluate(() => {
      const menus = document.querySelectorAll(".composer-menu");
      menus[menus.length - 1].querySelector(".menu-sub input").focus();
    });
    await win.keyboard.type("二期规划");
    await win.keyboard.press("Enter");
    await win.waitForTimeout(700);
    const store2 = readStore(root);
    const s3 = await readSidebar(win);
    groupOf(store2, "bot-grp-c") === "二期规划" && s3.heads.some((h) => h.name === "二期规划" && h.count === "1")
      ? ok("G-05 输入新组名回车：新建「二期规划」并立刻出现在侧栏")
      : bad("G-05 新建分组失败", JSON.stringify({ group: groupOf(store2, "bot-grp-c"), heads: s3.heads }));

    /* G-06 未分组：group 清空，空组不渲染 */
    await win.click('#bot-list [data-agent-id="bot-grp-c"]', { button: "right" });
    await win.waitForTimeout(250);
    await win.evaluate(() => {
      const menus = document.querySelectorAll(".composer-menu");
      menus[menus.length - 1].querySelector(".menu-group-head").click();
    });
    await win.waitForTimeout(200);
    await win.evaluate(() => {
      const menus = document.querySelectorAll(".composer-menu");
      const sub = menus[menus.length - 1].querySelector(".menu-sub");
      Array.from(sub.querySelectorAll("button"))
        .find((b) => b.classList.contains("menu-sub-off"))
        .click();
    });
    await win.waitForTimeout(600);
    const store3 = readStore(root);
    const s4 = await readSidebar(win);
    /* 宿主总会注入一个 agent-bit，所以「未分组几行」不是夹具能钉死的常量；
       这里断的是因果：丙回到了未分组、而「二期规划」这个空组没有留下壳。 */
    groupOf(store3, "bot-grp-c") === "" &&
    s4.ungrouped.includes("bot-grp-c") &&
    !s4.heads.some((h) => h.name === "二期规划")
      ? ok("G-06 点「未分组」：group 清空、丙回到未分组，空组不留壳")
      : bad("G-06 未分组没生效", JSON.stringify({ group: groupOf(store3, "bot-grp-c"), s4 }));

    /* G-09 自适应：菜单宽度跟着视口走，四个边角都不得溢出。
       窄窗用真实的 contextmenu 事件驱动（≤900px 时外壳改成上下堆叠、侧栏变成
       一条可滚的横带，Playwright 的可见性检查会卡住，事件派发不会）。 */
    await win.click('#bot-list [data-agent-id="bot-grp-a"]', { button: "right" });
    await win.waitForTimeout(300);
    const widthAdapt = await win.evaluate(() => {
      const menus = Array.from(document.querySelectorAll(".composer-menu")).filter(
        (m) => !m.hidden && m.getBoundingClientRect().height > 0,
      );
      const menu = menus[menus.length - 1];
      return { w: Math.round(menu.getBoundingClientRect().width), vw: window.innerWidth };
    });
    widthAdapt.w === Math.min(240, widthAdapt.vw - 16)
      ? ok("G-09 菜单宽度自适应：min(240, 100vw-16) = " + widthAdapt.w + "px（vw=" + widthAdapt.vw + "）")
      : bad("G-09 菜单宽度不是自适应值", JSON.stringify(widthAdapt));

    const corners = await win.evaluate(() => {
      const menus = Array.from(document.querySelectorAll(".composer-menu")).filter(
        (m) => !m.hidden && m.getBoundingClientRect().height > 0,
      );
      const menu = menus[menus.length - 1];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const anchors = [
        [4, 4],
        [vw - 2, 4],
        [4, vh - 2],
        [vw - 2, vh - 2],
      ];
      return anchors.map(([x, y]) => {
        placeFloatingMenu(menu, x, y);
        const r = menu.getBoundingClientRect();
        return {
          at: [x, y],
          vw,
          vh,
          ok: r.left >= 8 - 0.5 && r.top >= 8 - 0.5 && r.right <= vw - 8 + 0.5 && r.bottom <= vh - 8 + 0.5,
          box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
        };
      });
    });
    corners.every((c) => c.ok)
      ? ok("G-09b 四角贴边点击都不溢出（左上/右上/左下/右下各 " + JSON.stringify(corners[3].box) + "）")
      : bad("G-09b 贴边溢出", JSON.stringify(corners));

    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.setSize(480, 600);
    });
    await win.waitForTimeout(700);
    const narrow = await win.evaluate(() => {
      const row = document.querySelector('#bot-list [data-agent-id="bot-grp-b"]');
      if (!row) return { missing: true };
      row.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }),
      );
      const menus = Array.from(document.querySelectorAll(".composer-menu")).filter(
        (m) => !m.hidden && m.getBoundingClientRect().height > 0,
      );
      const menu = menus[menus.length - 1];
      if (!menu) return { noMenu: true };
      const r = menu.getBoundingClientRect();
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        left: Math.round(r.left),
        top: Math.round(r.top),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
        w: Math.round(r.width),
      };
    });
    narrow.left >= 8 && narrow.top >= 8 && narrow.right <= narrow.vw - 8 && narrow.bottom <= narrow.vh - 8
      ? ok(
          "G-09c 窄窗口 " + narrow.vw + "×" + narrow.vh + " 下菜单整体在视口内（" +
            narrow.left + "," + narrow.top + " → " + narrow.right + "," + narrow.bottom +
            "，宽 " + narrow.w + "）",
        )
      : bad("G-09c 窄窗口溢出", JSON.stringify(narrow));

    /* G-10 「设为 Primary」搬到 Bot 设置右栏（按当前状态出现），菜单不再有它 */
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.setSize(1280, 800);
    });
    await win.keyboard.press("Escape");
    await win.waitForTimeout(500);
    await win.click('#bot-list [data-agent-id="bot-grp-c"]', { button: "right" });
    await win.waitForSelector('[data-menu="settings"]', { timeout: 5000 });
    await win.locator('[data-menu="settings"]').click();
    await win
      .waitForFunction(() => document.querySelectorAll("#br-actions .bb-btn").length >= 3, null, { timeout: 10000 })
      .catch(() => {});
    const railActs = await win.evaluate(() =>
      Array.from(document.querySelectorAll("#br-actions .bb-btn")).map((b) => b.textContent.trim()),
    );
    railActs.some((t) => /设为 Primary|Set as Primary/.test(t))
      ? ok("G-10 「设为 Primary」出现在 Bot 设置右栏（" + railActs.length + " 个动作），右键菜单不再有它")
      : bad("G-10 右栏缺 Primary", JSON.stringify(railActs));

    /* S-01 发送按钮：内联 SVG 箭头，不是 U+2191 字形 */
    const send = await win.evaluate(() => {
      const b = document.getElementById("send");
      if (!b) return null;
      const svg = b.querySelector("svg");
      const before = getComputedStyle(b, "::before").content;
      return {
        text: (b.textContent || "").trim(),
        hasSvg: !!svg,
        paths: svg ? svg.querySelectorAll("path").length : 0,
        strokeWidth: svg ? svg.getAttribute("stroke-width") : "",
        before: before === "none" ? "" : before,
        color: svg ? getComputedStyle(svg).stroke : "",
      };
    });
    send && send.hasSvg && send.paths === 2 && !send.text && !send.before && send.strokeWidth === "2.2"
      ? ok("S-01 发送按钮是内联 SVG 箭头（stroke=" + send.color + "，无 ↑ 字形、无 ::before）")
      : bad("S-01 发送按钮图标不对", JSON.stringify(send));

    /* G-07 不污染用户数据 */
    const leak = fixtureLeak();
    !leak
      ? ok("G-07 用户的 data/desktop 里没有本门禁的夹具内容")
      : bad("G-07 夹具泄漏进用户数据", JSON.stringify(leak));
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
  done("e2e_desktop_bot_group_menu");
})();
