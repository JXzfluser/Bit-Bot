/* e2e_desktop_cn_channel_guard.mjs — 国内渠道凭证不许「裸奔」的真渲染门禁（CN-01..CN-08）
 *
 * 用户装完手机端的原话是「各种都要输入。用户要疯吧」。桌面这屏同样有这个问题，
 * 只是形态不同：钉钉/飞书/企微这一张卡是「填了不知道有没有用、错了也没人告诉你」——
 *   - 含 access_token 的完整 Webhook 明文摊在屏幕上（type=text），旁边只有一个「保存」；
 *   - 勾了「开启推送」但地址留空，照样提示「已保存」，用户以为配好了；
 *   - 粘进去一段没有 scheme 的地址，保存成功，之后发不出去，看不出为什么；
 *   - 卡里填凭证、设置→凭证 里保存、同一个设置页里另有一排「试连」——三段路要用户自己连起来。
 * 这些都是「看起来修了」的形状，所以每条先跑红再修绿。
 *
 * 断言：
 *   CN-01 钉钉 Webhook 输入框默认必须是掩码（type=password）
 *   CN-02 卡内必须能就地显隐（点「显示」露出原文核对，再点收回），不用去别处找
 *   CN-03 勾了开启推送但没填 Webhook → 当场在该字段下红字点名，不许假装能保存
 *   CN-04 粘进没有 scheme 的地址 → 红字说明「要以 http(s):// 开头」；补全后红字消失
 *   CN-05 有校验错误时「保存并热加载」不可点（把错误挡在写盘之前），错误消失后恢复可点
 *   CN-06 卡内要有「下一步」引导，点了直接落到 设置→凭证 的保存/试连那一排
 *   CN-07 新增的两行说明与红字必须走 class + 令牌：computed 字号等于 --text-sm，
 *        且没有行内字面字号/颜色（守视觉契约基线，别把债挪个地方欠）
 *   CN-08 三渠道的开关状态必须在这张卡里如实写出来（未开启就说未开启），不许留空白
 *
 * 跑法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_cn_channel_guard.mjs
 * 缺 electron / 缺显示环境时诚实 SKIP。
 *
 * ── 修复前红（HEAD 产品代码的真实输出，PASS=0 FAIL=8）──────────────────
 *   ✗ CN-01 钉钉 Webhook 必须是掩码输入（URL 里就带着 access_token） — got "text"
 *   ✗ CN-02 卡内没有就地显隐按钮（#cn-ding-reveal 不存在）
 *   ✗ CN-03 没有字段级错误位（#sec-ding-hook-err 不存在）——勾了开启、地址空着也能「保存成功」
 *   ✗ CN-04 少了 scheme 的地址照样被接受（用户要等到发不出去才知道） — {"exists":false}
 *   ✗ CN-05 有校验错误时「保存并热加载」照样能点（先写盘，再由用户去猜为什么发不出去）
 *   ✗ CN-06 卡内没有下一步入口（#cn-goto-credentials 不存在）
 *   ✗ CN-07 这些说明节点不存在，字号无从谈起 — #cn-card-state,#sec-ding-hook-err,#cn-next-hint
 *   ✗ CN-08 卡里没有三渠道状态行（#cn-card-state 不存在）
 * ── 修复后绿 ────────────────────────────────────────────────────────
 *   e2e_desktop_cn_channel_guard: PASS=8 FAIL=0 SKIP=0
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
  countAppMains,
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
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 240) : ""));
};
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_cn_channel_guard: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_cn_channel_guard: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_cn_channel_guard: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_cn_channel_guard: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "cnchan", {
  "bots.json": { bots: [{ id: "b1", name: "派单助手", job: "派单调度", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW }], primary: "b1" },
  "settings.json": { notify: {}, dev_mode: true },
  "sessions.json": { sessions: [] },
});

const UD = electronUserDataDir("cnchan");

function launch() {
  return _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
    cwd: REPO,
    env: electronLaunchEnv(
      gateAppEnv(root, {
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
        BITBOT_LLM_API_KEY: "gate-no-call",
        BITBOT_LLM_MODEL: "gate-no-call",
        BITBOT_LLM_STREAM: "0",
      }),
    ),
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在页面里改一个输入框并触发 input/change，模拟真人敲键盘后的失焦。 */
const setField = (win, id, value) =>
  win.evaluate(
    ([i, v]) => {
      const el = document.getElementById(i);
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    },
    [id, value],
  );

const setCheck = (win, id, on) =>
  win.evaluate(
    ([i, o]) => {
      const el = document.getElementById(i);
      if (!el) return false;
      el.checked = o;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    [id, on],
  );

/** 读一个字段级红字的可见状态与文本。 */
const fieldErr = (win, id) =>
  win.evaluate((i) => {
    const el = document.getElementById(i);
    if (!el) return { exists: false };
    const cs = getComputedStyle(el);
    return {
      exists: true,
      hiddenAttr: Boolean(el.hidden),
      shown: cs.display !== "none" && cs.visibility !== "hidden",
      text: String(el.textContent || "").trim(),
      size: cs.fontSize,
      inline: String(el.getAttribute("style") || ""),
      color: cs.color,
    };
  }, id);

let app = null;

(async () => {
  try {
    app = await launch();
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(600);

    /* 打开「连接应用」：账户菜单 → 连接应用（用户的手顺，不直接调内部函数）。
     * 侧栏项是 #ap-connect；#connect-apps-btn 是收进侧栏折叠区的那个，看不见。 */
    await win.click("#account-avatar-btn");
    await win.waitForSelector("#ap-connect", { state: "visible", timeout: 8000 });
    await win.click("#ap-connect");
    await win.waitForSelector("#connect-apps-modal", { state: "visible", timeout: 10000 });
    await win.waitForTimeout(400);

    /* ---------- CN-01 含 access_token 的 URL 不许明文摊在屏幕上 ---------- */
    {
      const t = await win.evaluate(() => {
        const el = document.getElementById("sec-ding-hook");
        return el ? el.type : null;
      });
      if (t === null) bad("CN-01 找不到 #sec-ding-hook");
      else if (t !== "password") bad("CN-01 钉钉 Webhook 必须是掩码输入（URL 里就带着 access_token）", 'got "' + t + '"');
      else ok("CN-01 钉钉 Webhook 默认掩码（type=password）");
    }

    /* ---------- CN-02 就地显隐：掩码不能变成「看不见就只能猜」 ---------- */
    {
      const r = await win.evaluate(async () => {
        const btn = document.getElementById("cn-ding-reveal");
        const el = document.getElementById("sec-ding-hook");
        if (!btn || !el) return { has: false };
        const before = el.type;
        btn.click();
        const revealed = el.type;
        const label1 = String(btn.textContent || "");
        btn.click();
        return { has: true, before, revealed, back: el.type, label1 };
      });
      if (!r.has) bad("CN-02 卡内没有就地显隐按钮（#cn-ding-reveal 不存在）");
      else if (r.before !== "password" || r.revealed !== "text" || r.back !== "password")
        bad("CN-02 显隐开关没真的切换输入框类型", JSON.stringify(r));
      else ok("CN-02 点「显示」露出原文、再点收回，全程不用离开这张卡（按钮文案跟着变：" + r.label1 + "）");
    }

    /* ---------- CN-03 勾了开启却没填地址：必须当场点名 ---------- */
    {
      await setCheck(win, "sec-ding-post", true);
      await setField(win, "sec-ding-hook", "");
      const e = await fieldErr(win, "sec-ding-hook-err");
      if (!e.exists) bad("CN-03 没有字段级错误位（#sec-ding-hook-err 不存在）——勾了开启、地址空着也能「保存成功」");
      else if (!e.shown || !/Webhook|地址/.test(e.text))
        bad("CN-03 地址空着时没有点名这一栏", JSON.stringify(e));
      else ok("CN-03 勾了开启推送但没填 Webhook：该字段下红字点名「" + e.text.slice(0, 40) + "」");
    }

    /* ---------- CN-04 粘了没有 scheme 的地址：说清楚为什么不行，改对就消失 ---------- */
    {
      await setField(win, "sec-ding-hook", "oapi.dingtalk.com/robot/send?access_token=abc");
      const e1 = await fieldErr(win, "sec-ding-hook-err");
      await setField(win, "sec-ding-hook", "https://oapi.dingtalk.com/robot/send?access_token=abc");
      const e2 = await fieldErr(win, "sec-ding-hook-err");
      if (!e1.shown || !/http/.test(e1.text))
        bad("CN-04 少了 scheme 的地址照样被接受（用户要等到发不出去才知道）", JSON.stringify(e1));
      else if (e2.shown) bad("CN-04 改对之后红字没消失（红字会变成噪音）", JSON.stringify(e2));
      else ok("CN-04 无 scheme 当场提示「" + e1.text.slice(0, 34) + "」，补成 https:// 后红字消失");
    }

    /* ---------- CN-05 有错时保存不可点：把错误挡在写盘之前 ---------- */
    {
      await setField(win, "sec-ding-hook", "not a url at all");
      const badState = await win.evaluate(() => {
        const b = document.getElementById("sec-save");
        return b ? { disabled: Boolean(b.disabled), text: String(b.textContent || "") } : null;
      });
      await setField(win, "sec-ding-hook", "https://oapi.dingtalk.com/robot/send?access_token=abc");
      const goodState = await win.evaluate(() => {
        const b = document.getElementById("sec-save");
        return b ? { disabled: Boolean(b.disabled) } : null;
      });
      if (!badState) bad("CN-05 找不到 #sec-save");
      else if (!badState.disabled)
        bad("CN-05 有校验错误时「保存并热加载」照样能点（先写盘，再由用户去猜为什么发不出去）", JSON.stringify(badState));
      else if (goodState.disabled)
        bad("CN-05 改对之后保存按钮没有恢复可点（校验变成新的死路）", JSON.stringify(goodState));
      else ok("CN-05 有错时保存不可点、改对后恢复可点（错误挡在写盘之前）");
    }

    /* ---------- CN-06 下一步引导：填凭证的地方就该指出「然后做什么」 ---------- */
    {
      const goto = await win.evaluate(() => {
        const b = document.getElementById("cn-goto-credentials");
        const h = document.getElementById("cn-next-hint");
        return {
          btn: b ? String(b.textContent || "") : null,
          hint: h ? String(h.textContent || "") : null,
        };
      });
      if (!goto.btn) bad("CN-06 卡内没有下一步入口（#cn-goto-credentials 不存在）");
      else if (!goto.hint || !/保存|试连/.test(goto.hint)) bad("CN-06 下一步说明没写清要做什么", JSON.stringify(goto));
      else {
        await win.click("#cn-goto-credentials");
        await win.waitForSelector("#settings-panel", { state: "visible", timeout: 10000 });
        const landed = await win.evaluate(() => {
          const tab = document.querySelector('.settings-tab-btn[data-stab="credentials"]');
          const save = document.getElementById("sec-save");
          const probe = document.getElementById("sec-probe-cn");
          const r = (el) => {
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { w: Math.round(b.width), h: Math.round(b.height) };
          };
          return {
            tabActive: tab ? tab.classList.contains("active") : false,
            save: r(save),
            probe: r(probe),
          };
        });
        if (!landed.tabActive) bad("CN-06 点了下一步却没落到「凭证」标签上", JSON.stringify(landed));
        else if (!landed.save || !landed.probe || landed.save.h === 0 || landed.probe.h === 0)
          bad("CN-06 落地之后看不见保存/试连这两个按钮", JSON.stringify(landed));
        else ok("CN-06 卡内「" + goto.btn + "」直接把用户送到保存与试连那一排（同一屏三段路接上了）");
      }
    }

    /* ---------- CN-07 新文案走 class + 令牌（别把视觉债挪个地方欠） ---------- */
    {
      const m = await win.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.setProperty("font-size", "var(--text-sm)");
        document.body.appendChild(probe);
        const scale = getComputedStyle(probe).fontSize;
        probe.remove();
        const read = (id) => {
          const el = document.getElementById(id);
          if (!el) return null;
          const cs = getComputedStyle(el);
          return { size: cs.fontSize, inline: String(el.getAttribute("style") || "") };
        };
        return { scale, state: read("cn-card-state"), err: read("sec-ding-hook-err"), hint: read("cn-next-hint") };
      });
      const nodes = [["#cn-card-state", m.state], ["#sec-ding-hook-err", m.err], ["#cn-next-hint", m.hint]];
      const missing = nodes.filter(([, v]) => !v).map(([k]) => k);
      const wrongSize = nodes.filter(([, v]) => v && v.size !== m.scale).map(([k, v]) => k + "=" + v.size);
      const inline = nodes.filter(([, v]) => v && /(font|color)/i.test(v.inline)).map(([k]) => k);
      if (missing.length) bad("CN-07 这些说明节点不存在，字号无从谈起", missing.join(","));
      else if (wrongSize.length) bad("CN-07 说明文字没落在 --text-sm 类型阶上（class 没生效或被盖掉）", wrongSize.join(" "));
      else if (inline.length) bad("CN-07 说明节点还带着行内字号/颜色（视觉契约按属性名计数）", inline.join(","));
      else ok("CN-07 三处新文案 computed 字号都等于 --text-sm（" + m.scale + "），且无行内字面值");
    }

    /* ---------- CN-08 未开启也要说出来：空白状态 = 用户不知道下一步 ---------- */
    {
      await setCheck(win, "sec-feishu-post", false);
      await setCheck(win, "sec-wecom-post", false);
      await win.evaluate(() => {
        const el = document.getElementById("sec-ding-post");
        if (el) {
          el.checked = false;
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      const s = await win.evaluate(() => {
        const el = document.getElementById("cn-card-state");
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { text: String(el.textContent || "").trim(), shown: cs.display !== "none" };
      });
      if (!s) bad("CN-08 卡里没有三渠道状态行（#cn-card-state 不存在）");
      else if (!s.shown) bad("CN-08 状态行被藏起来了（用 display:none 掩盖状态就是假修）", JSON.stringify(s));
      else if (!/钉钉/.test(s.text) || !/飞书/.test(s.text) || !/企微/.test(s.text) || !/未开启/.test(s.text))
        bad("CN-08 状态行没把三路都如实交代", JSON.stringify(s));
      else ok("CN-08 未开启也写明：「" + s.text.slice(0, 46) + "」");
    }

    done("e2e_desktop_cn_channel_guard");
  } catch (err) {
    bad("unexpected error", err && err.message);
    done("e2e_desktop_cn_channel_guard");
  } finally {
    if (app) await app.close().catch(() => {});
    await sleep(500);
    const left = countAppMains(UD);
    if (left > 0) killGateProcs(UD);
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
  }
})();
