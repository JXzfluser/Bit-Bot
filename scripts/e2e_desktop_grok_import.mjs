/* e2e_desktop_grok_import.mjs — 「从 Grok 搬过来」的界面到底能不能用
 *
 * 为什么要有这条：静态断言（prove_m53d）只能证明纯函数与接线对，证明不了
 * 「对话框打得开、清单渲染出来、勾选能勾、点下去真的建了东西、建完界面自己变灰」。
 * 而这四步里任何一步断了，用户看到的就是"按钮没用"。
 *
 * 做法：真 Electron + **临时空数据根**（不碰你自己的库）。
 * 空根在这里没问题 —— 本流程不跑回合，只走 Host 侧的文件操作；
 * （跑回合的 e2e 才必须用仓库 data/，空根上内核会崩，见 e2e_desktop_turn_cancel 注释。）
 *
 * 覆盖：
 *   1) 点入口能打开；三段清单都渲染出来，数量与源库一致；
 *   2) 只有 1 名成员的那个群是 is-blocked 且不可勾（灰着也说清为什么）；
 *   3) 全选 → 点迁移 → 结果行给出建成的数量，失败项如实列出；
 *   4) 真的落到盘上（读临时根的 bots.json/rooms.json/sessions.json），
 *      且消息时间是原始时间（不是导入那一刻）；
 *   5) 迁移完再扫一遍，条目变"已迁移"且不可再勾（幂等看得见）。
 */

import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 400) : "")); };

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-grok-e2e-"));
const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-grok-shot-"));
const readJson = (p, fb) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; }
};

(async () => {
  let app = null;
  try {
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [
        path.join(DESKTOP, "main.js"),
        "--no-sandbox",
        "--disable-gpu",
        "--user-data-dir=" + electronUserDataDir("grok-import"),
      ],
      cwd: REPO,
      env: electronLaunchEnv({
        DISPLAY: process.env.DISPLAY || "",
        BITBOT_REPO_ROOT: REPO,
        BITBOT_DATA_ROOT: dataRoot,
        BITBOT_NO_SECRET_SYNC: "1",
        BITBOT_DESKTOP_AUTOSTART: "0",
      }),
      timeout: 90000,
    });
    const win = await app.firstWindow({ timeout: 60000 });
    await win.waitForSelector("#gi-open", { state: "attached", timeout: 60000 });
    await win.waitForTimeout(500);

    /* ---------- 1) 打开对话框 ---------- */
    await win.evaluate(() => document.getElementById("gi-open").click());
    const opened = await win
      .waitForSelector("#gi-body:not([hidden])", { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      const err = await win.evaluate(() => {
        const e = document.getElementById("gi-error");
        return { hidden: e ? e.hidden : null, text: e ? e.textContent : "" };
      });
      bad("对话框没出清单", JSON.stringify(err));
      throw new Error("dialog did not render");
    }
    ok("点「从 Grok 搬过来」→ 对话框打开并读到清单");

    const shape = await win.evaluate(() => {
      const groups = [...document.querySelectorAll("#gi-groups .gi-group")].map((g) => ({
        title: (g.querySelector(".gi-group-title") || {}).textContent || "",
        count: (g.querySelector(".gi-group-count") || {}).textContent || "",
        items: g.querySelectorAll(".gi-item").length,
        blocked: g.querySelectorAll(".gi-item.is-blocked").length,
        badges: g.querySelectorAll(".gi-badge").length,
      }));
      const stats = (document.getElementById("gi-stats") || {}).textContent || "";
      const extra = (document.querySelector(".gi-stats-extra") || {}).textContent || "";
      return { groups, stats, extra };
    });
    shape.groups.length === 3
      ? ok("三段清单（Bot / 群 / 对话）都渲染出来")
      : bad("清单段数不是 3", JSON.stringify(shape.groups));

    const [gBots, gRooms, gSess] = shape.groups;
    gBots && gBots.items > 0 && gRooms && gRooms.items > 0 && gSess && gSess.items > 0
      ? ok(`三段都有条目（Bot ${gBots.items} / 群 ${gRooms.items} / 对话 ${gSess.items}）`)
      : bad("有段落是空的", JSON.stringify(shape.groups));

    gRooms && gRooms.blocked >= 1
      ? ok("只有 1 名成员的那个群：留在原位但标 is-blocked（灰了也说清为什么）")
      : bad("没有出现 is-blocked 的群", JSON.stringify(gRooms));

    // 群段一屏只放得下两行，建不成的那条如果排第三就等于看不见
    const firstRoom = await win.evaluate(() => {
      const g = document.querySelectorAll("#gi-groups .gi-group")[1];
      const it = g && g.querySelector(".gi-item");
      return it ? {
        name: (it.querySelector(".gi-item-name") || {}).textContent || "",
        blocked: it.classList.contains("is-blocked"),
      } : null;
    });
    firstRoom && firstRoom.blocked
      ? ok("群段把「建不成」的那条排在第一位（默认视野里就能看到）")
      : bad("群段排序没生效", JSON.stringify(firstRoom));

    /[0-9]/.test(shape.stats) && /[0-9]/.test(shape.extra)
      ? ok("统计行带真实数字（含选项卡片/跳过说明）")
      : bad("统计行没有数字", JSON.stringify({ s: shape.stats, e: shape.extra }));

    await win.screenshot({ path: path.join(shotDir, "grok-import-list.png") });

    /* ---------- 2) 全选 → 迁移 ---------- */
    const beforeNote = await win.evaluate(() => {
      const btns = [...document.querySelectorAll("#gi-groups .gi-selectall")];
      for (const b of btns) if (!b.disabled) b.click();
      return (document.getElementById("gi-actions-note") || {}).textContent || "";
    });
    /[0-9]/.test(beforeNote)
      ? ok("点每段「全选」→ 底部汇总出已选数量（" + beforeNote.trim() + "）")
      : bad("全选后底部没有汇总", beforeNote);

    await win.evaluate(() => document.getElementById("gi-apply").click());
    const done = await win
      .waitForSelector("#gi-result:not([hidden])", { timeout: 180000 })
      .then(() => true)
      .catch(() => false);
    if (!done) {
      bad("点了迁移但结果区一直没出现");
      throw new Error("apply did not finish");
    }

    const result = await win.evaluate(() => {
      const r = document.getElementById("gi-result");
      return { text: r.textContent || "", fails: r.querySelectorAll(".gi-fail").length };
    });
    /[0-9]/.test(result.text)
      ? ok("结果区给出回执（" + result.text.replace(/\s+/g, " ").slice(0, 90) + "…）")
      : bad("结果区没有数字", result.text);
    // 勾不了的群不会进 selection，也就进不了 failed —— 但"没建成"不该只活在清单的
    // 灰字里（关掉对话框就看不见了）。判据用那个群标题的前半句，与界面语言无关。
    result.text.includes("我想围绕近期")
      ? ok("回执点名了那个建不成的群（关掉对话框也还知道有这回事）")
      : bad("建不成的群在回执里消失了", result.text);
    result.fails === 0
      ? ok("没有真失败时不摆失败项（不制造假警报）")
      : bad("凭空报了失败", result.text);

    await win.screenshot({ path: path.join(shotDir, "grok-import-result.png") });

    /* ---------- 3) 真的落盘了 ---------- */
    const bots = readJson(path.join(dataRoot, "desktop/bots.json"), { bots: [] });
    const rooms = readJson(path.join(dataRoot, "desktop/rooms.json"), { rooms: [] });
    const sess = readJson(path.join(dataRoot, "desktop/sessions.json"), { sessions: [] });
    const bj = Array.isArray(bots.bots) ? bots.bots : [];
    const rj = Array.isArray(rooms.rooms) ? rooms.rooms : [];
    const sj = Array.isArray(sess.sessions) ? sess.sessions : [];
    const migrated = sj.filter((s) => String(s.title || "").startsWith("Grok · "));

    bj.length > 0 && rj.length > 0 && migrated.length > 0
      ? ok(`落盘：Bot ${bj.length} / 群 ${rj.length} / 迁移会话 ${migrated.length}`)
      : bad("盘上没有建成的东西", JSON.stringify({ b: bj.length, r: rj.length, s: migrated.length }));

    // 这条是本轮最贵的教训：参数存在但不生效 —— 时间必须是原来的，不是导入那一刻
    const days = new Set();
    let total = 0;
    for (const s of migrated) for (const m of s.messages || []) { total++; days.add(String(m.at || "").slice(0, 10)); }
    migrated.length && days.size >= 2 && total > 0
      ? ok(`迁移进 ${total} 条消息、跨 ${days.size} 天（时间不是导入那一刻）`)
      : bad("消息时间被抹平或消息没落盘", JSON.stringify({ total, days: [...days].slice(0, 4) }));

    /* ---------- 4) 迁完再扫一遍：条目变"已迁移"且不可勾 ---------- */
    await win.evaluate(() => document.getElementById("gi-rescan").click());
    await win.waitForTimeout(1500);
    const after = await win.evaluate(() => {
      const g = document.querySelectorAll("#gi-groups .gi-group")[0];
      const items = g ? [...g.querySelectorAll(".gi-item")] : [];
      return {
        locked: items.filter((i) => i.classList.contains("is-locked")).length,
        checked: items.filter((i) => {
          const cb = i.querySelector('input[type="checkbox"]');
          return cb && cb.checked;
        }).length,
        enabled: items.filter((i) => {
          const cb = i.querySelector('input[type="checkbox"]');
          return cb && !cb.disabled;
        }).length,
        doneBadges: items.filter((i) => i.querySelector(".gi-badge.is-done")).length,
      };
    });
    after.locked > 0 && after.enabled === 0 && after.checked === 0
      ? ok(`迁移后再扫：Bot 全部「已迁移」且不可勾（locked ${after.locked} / 可选 ${after.enabled}）`)
      : bad("迁移后状态没更新", JSON.stringify(after));

    console.log("\n截图：" + shotDir);
  } catch (err) {
    bad("e2e 崩了", (err && err.stack) || err);
  } finally {
    if (app) { try { await app.close(); } catch (_) {} }
    try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch (_) {}
  }

  console.log("");
  if (FAIL) {
    console.log(`e2e_desktop_grok_import: ${PASS}/${FAIL} — 有失败`);
    process.exit(1);
  }
  console.log(`e2e_desktop_grok_import: ${PASS}/0`);
})();
