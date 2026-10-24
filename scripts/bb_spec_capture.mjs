/* bb_spec_capture.mjs — 取 Bit Bot 桌面版的「现状」UI 数值，对齐真源基准
 *   docs/design/desktop-target/reference/grok-real-spec.json。
 *
 * 为什么要它：G-28 把「长得像 Grok Bot.app」当成目标，但只能拿真渲染出来的
 * 数值做逐项对照，不能靠源码文本。本脚本在真 Electron 窗口里读
 * getComputedStyle()/getBoundingClientRect()，输出字段名与 Grok 那份**完全同名同量纲**，
 * 于是可以逐字段 diff。
 *
 * 严格约束（保证可比）：
 *   - 窗口内容区 1040×760 逻辑像素（Grok 那份就是 1040×760 测的），用实测 rect 复核；
 *   - 浅色主题：body.classList 加 force-light（同仓库门禁 setTheme 的做法），
 *     取数前等 220ms + 两个 requestAnimationFrame（#send 有 transition，不等会采到中间帧）；
 *   - 所有几何都是 CSS 逻辑像素（dpr 只影响截图，不影响数值）；
 *   - 用 resolved 值（getComputedStyle），getBoundingClientRect 保留小数。
 *
 * 纪律：只往运行时 DOM 注入探针（同 ui_baseline_shot.mjs 的做法），绝不改仓库源码；
 *   独立临时 user-data-dir；跑完 app.close() 关进程。
 *
 * Usage: node scripts/bb_spec_capture.mjs
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const OUT_JSON = path.join(REPO, "docs/design/desktop-target/reference/bb-real-spec.json");
const SHOT_DIR = "/tmp/bb_ref";

if (!fs.existsSync(ELECTRON)) {
  console.error("bb_spec_capture: electron dist missing (" + ELECTRON + ")");
  process.exit(1);
}
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

const ud = electronUserDataDir("bb-spec");
const env = electronLaunchEnv(gateAppEnv(REPO, { BITBOT_NO_SECRET_SYNC: "1", BITBOT_DESKTOP_AUTOSTART: "0" }));

async function setThemeLight(win) {
  await win.evaluate(() => {
    const b = document.body;
    b.classList.remove("force-dark");
    b.classList.add("force-light");
  });
  // #send 有 `transition: all .15s ease`：主题切换后立刻采样会读到插值中间帧。
  // 等过 transition，再用两帧落到静止色，采到的才是 resting value。
  await win.waitForTimeout(220);
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

(async () => {
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO,
    env,
    timeout: 60000,
  });
  const win = await app.firstWindow({ timeout: 60000 });
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const spec = {};
  const clips = {};
  try {
    await win.waitForSelector("#composer #text", { timeout: 30000 });

    // --- 强制窗口内容区 1040×760 逻辑像素（Grok 基准尺寸） -------------------
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return;
      w.setContentSize(1040, 760);
      w.setResizable(true);
    });
    await win.waitForTimeout(120);
    // 用实测 rect 复核：innerWidth/innerHeight 必须就是 1040×760，否则补偿 delta。
    let size = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    if (size.w !== 1040 || size.h !== 760) {
      await app.evaluate(({ BrowserWindow }, { dw, dh }) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (!w) return;
        const [cw, ch] = w.getContentSize();
        w.setContentSize(cw + dw, ch + dh);
      }, { dw: 1040 - size.w, dh: 760 - size.h });
      await win.waitForTimeout(120);
      size = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    }

    // --- 浅色主题 ---
    await setThemeLight(win);

    // --- 注入探针 DOM（不跑真实 LLM turn） -----------------------------------
    await win.evaluate(() => {
      // 1) 消息流：1 user + 2 assistant（其中 1 条带 grok-head + 代码块）
      const log = document.getElementById("log");
      if (log) {
        log.innerHTML = "";
        const mk = (cls, html) => {
          const el = document.createElement("div");
          el.className = cls;
          el.innerHTML = html;
          log.appendChild(el);
          return el;
        };
        mk("msg user",
          '<div class="role">user</div><div class="body">帮我把这份 PR 合并到 main，注意别动 lockfile。</div>');
        const a1 = mk("msg assistant",
          '<div class="role">assistant</div>' +
          '<div class="msg-grok-head"><span class="msg-grok-avatar">B</span><span class="msg-grok-name">Bit Bot</span></div>' +
          '<div class="body"><div>云端代理已在跑：合并前先确认 CI 全绿。</div>' +
          '<div class="bb-codeblock"><span class="bb-codeblock-lang">bash</span>' +
          '<pre><code>git checkout -b merge/main\ngh pr merge 128 --admin</code></pre></div></div>');
        a1.setAttribute("data-probe", "head");
        const a2 = mk("msg assistant",
          '<div class="role">assistant</div><div class="body">GitHub 授权已生效，正在确认推送代理状态。</div>');
        a2.setAttribute("data-probe", "plain");
        log.scrollTop = 0;
      }
      // 2) 侧栏：清空 #bot-list，造一个分组头 + 3 行 .sess-row（结构对齐 botRow）
      const box = document.getElementById("bot-list");
      if (box) {
        box.innerHTML = "";
        const PALETTE = ["#18c272", "#fd6d17", "#915cf9"];
        const head = document.createElement("div");
        head.className = "bot-group-head";
        const label = document.createElement("span");
        label.textContent = "核心";
        const cnt = document.createElement("span");
        cnt.className = "cnt";
        cnt.textContent = "3";
        head.appendChild(label);
        head.appendChild(cnt);
        box.appendChild(head);
        ["研究代理", "代码助手", "运营小助手"].forEach((nm, i) => {
          const el = document.createElement("div");
          el.className = "agent-item sess-row";
          el.style.cursor = "pointer";
          const av = document.createElement("span");
          av.className = "sess-avatar";
          av.style.setProperty("--av", PALETTE[i]);
          av.textContent = nm.slice(0, 1);
          const main = document.createElement("div");
          main.className = "sess-main";
          const name = document.createElement("div");
          name.className = "name";
          name.textContent = nm;
          const meta = document.createElement("div");
          meta.className = "meta";
          meta.textContent = "正在整理今天的日报与待办提醒";
          main.appendChild(name);
          main.appendChild(meta);
          el.appendChild(av);
          el.appendChild(main);
          box.appendChild(el);
        });
      }
    });
    await win.waitForTimeout(120);

    // --- 静态区一次采全 ---
    const base = await win.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const qa = (s) => Array.from(document.querySelectorAll(s));
      const num = (v) => (v && v.endsWith("px") ? parseFloat(v) : v);
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const d = (x) => Math.round(x * 100) / 100;
        return { left: d(r.left), top: d(r.top), right: d(r.right), bottom: d(r.bottom), width: d(r.width), height: d(r.height) };
      };
      const style = (el, props) => {
        if (!el) return null;
        const s = getComputedStyle(el);
        const out = {};
        for (const p of props) out[p] = s[p];
        return out;
      };

      const GEO = ["left", "top", "width", "height", "padding", "margin", "gap"];
      const BOX = ["backgroundColor", "borderRadius", "boxShadow", "fontSize", "fontWeight", "color", "lineHeight", "opacity", "display", "fontFamily"];

      // windowShell: body 就是网格外壳（等价 .sand-shell）
      const body = document.body;
      const bodyRt = rect(body);
      const htmlCs = getComputedStyle(document.documentElement);
      const windowShell = {
        selector: "body",
        ...bodyRt,
        ...style(body, ["backgroundColor", "color", "fontFamily", "fontSize", "padding", "margin"]),
        htmlBackgroundColor: htmlCs.backgroundColor,
        note: "body 本身即 layout grid（sidebar|main|rail），等价 Grok .sand-shell",
      };

      // sidebar #agents
      const agents = q("#agents");
      const sidebar = {
        selector: "#agents",
        ...rect(agents),
        ...style(agents, ["backgroundColor", "color", "fontSize", "fontFamily", "padding", "borderRightWidth", "borderRightColor", "borderRightStyle"]),
      };

      // sidebarHeader #sidebar-toolbar + buttons
      const tb = q("#sidebar-toolbar");
      const tbBtns = qa("#sidebar-toolbar button").map((b) => ({
        selector: "#" + b.id,
        ...rect(b),
        ...style(b, ["width", "height", "borderRadius", "backgroundColor", "borderTopWidth", "borderTopColor", "color", "boxShadow", "fontSize", "fontFamily"]),
      }));
      const sidebarHeader = {
        selector: "#sidebar-toolbar",
        ...rect(tb),
        ...style(tb, ["backgroundColor", "color", "padding", "gap", "display", "alignItems", "justifyContent", "borderTopWidth", "borderTopColor", "borderTopStyle", "borderRadius", "boxShadow", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "opacity"]),
      };

      // sessionRow（首个 .sess-row）+ pitch/gap + title/preview
      const rows = qa("#agents .sess-row, #bot-list .sess-row, .sess-row");
      const row0 = rows[0] || null;
      const row1 = rows[1] || null;
      const row0rt = rect(row0);
      const row1rt = rect(row1);
      const title = row0 && row0.querySelector(".name");
      const preview = row0 && row0.querySelector(".meta");
      const sessionRow = row0
        ? {
            selector: ".sess-row",
            count: rows.length,
            ...row0rt,
            ...style(row0, ["backgroundColor", "color", "padding", "margin", "gap", "borderRadius", "boxShadow", "borderTopWidth", "borderTopColor", "borderTopStyle", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "opacity", "display", "alignItems", "fontFamily"]),
            verticalPitch: row1rt && row0rt ? Math.round((row1rt.top - row0rt.top) * 100) / 100 : null,
            interRowGap: row1rt && row0rt ? Math.round((row1rt.top - row0rt.top - row0rt.height) * 100) / 100 : null,
            title: title
              ? { selector: ".sess-row .name", ...rect(title), ...style(title, ["fontSize", "fontWeight", "color", "lineHeight", "letterSpacing"]) }
              : null,
            preview: preview
              ? { selector: ".sess-row .meta", ...rect(preview), ...style(preview, ["fontSize", "fontWeight", "color", "lineHeight", "letterSpacing"]) }
              : null,
            activeRowBackground: null,
          }
        : { selector: ".sess-row", missing: true };

      // avatar .sess-avatar（Grok 是不规则 blob）
      const av = row0 && row0.querySelector(".sess-avatar");
      const avatar = av
        ? {
            selector: ".sess-avatar",
            ...rect(av),
            ...style(av, ["borderRadius", "backgroundColor", "overflow", "color", "fontSize", "fontWeight"]),
            avatarBlobClass: av.className.replace("sess-avatar", "").trim(),
          }
        : { selector: ".sess-avatar", missing: true };

      // groupLabel .bot-group-head
      const gh = q(".bot-group-head");
      const ghSpan = gh && gh.querySelector("span");
      const groupLabel = gh
        ? {
            selector: ".bot-group-head",
            ...rect(gh),
            ...style(gh, ["height", "padding", "fontSize", "fontWeight", "color", "lineHeight", "textTransform", "backgroundColor", "margin", "gap", "display", "justifyContent"]),
            textSpan: ghSpan
              ? { ...rect(ghSpan), ...style(ghSpan, ["fontSize", "fontWeight", "color", "lineHeight", "letterSpacing", "textTransform"]), text: ghSpan.textContent }
              : null,
          }
        : { selector: ".bot-group-head", missing: true };

      // composer：#composer(dock 外层) .row + #text(field) + 派生指标
      const comp = q("#composer");
      const crow = q("#composer .row");
      const field = q("#text");
      const main = q("#main");
      const crowRt = rect(crow);
      const fieldRt = rect(field);
      const mainRt = rect(main);
      const composer = {
        selector: "#composer .row",
        dock: { selector: "#composer", ...rect(comp), ...style(comp, ["backgroundColor", "padding", "display", "flexDirection", "gap"]) },
        ...crowRt,
        ...style(crow, ["backgroundColor", "borderTopWidth", "borderTopColor", "borderTopStyle", "borderRadius", "boxShadow", "padding", "margin", "gap", "display", "alignItems"]),
        field: { selector: "#text", ...fieldRt, ...style(field, ["fontSize", "lineHeight", "color", "fontFamily", "backgroundColor", "padding"]) },
        fieldLeftInset: crowRt && fieldRt ? Math.round((fieldRt.left - crowRt.left) * 100) / 100 : null,
        frameWidthVsPane: crowRt && mainRt ? Math.round((crowRt.width / mainRt.width) * 1000) / 1000 : null,
      };

      const btnSpec = (sel) => {
        const el = q(sel);
        if (!el) return { selector: sel, missing: true };
        return {
          selector: sel,
          ...rect(el),
          ...style(el, ["width", "height", "borderRadius", "backgroundColor", "color", "boxShadow", "display", "order", "opacity", "visibility", "borderTopWidth"]),
        };
      };
      const attachButton = btnSpec("#attach-btn");
      const micButton = btnSpec("#voice-btn"); // 仓库里 mic 就是 #voice-btn
      const sendButton = btnSpec("#send");
      sendButton.text = (q("#send") || {}).textContent || null;

      // bubble：assistant .msg.assistant .body
      const aBody = q('.msg.assistant[data-probe="head"] .body');
      const bubble = aBody
        ? {
            selector: ".msg.assistant .body",
            ...rect(aBody),
            ...style(aBody, ["padding", "margin", "borderRadius", "backgroundColor", "borderTopWidth", "borderTopColor", "borderTopStyle", "boxShadow", "fontSize", "fontWeight", "lineHeight", "color", "width", "fontFamily"]),
            hasBorder: parseFloat(getComputedStyle(aBody).borderTopWidth) > 0,
            hasShadow: getComputedStyle(aBody).boxShadow !== "none",
          }
        : { selector: ".msg.assistant .body", missing: true };

      // user 气泡（背景在 .msg.user 元素本身）
      const uEl = q(".msg.user");
      const uBody = uEl && uEl.querySelector(".body");
      const bubbleVariants = [
        bubble,
        uEl
          ? {
              selector: ".msg.user",
              ...rect(uEl),
              ...style(uEl, ["backgroundColor", "color", "borderRadius", "padding", "borderTopWidth", "boxShadow", "fontSize", "fontWeight", "lineHeight"]),
              body: uBody ? { selector: ".msg.user .body", ...rect(uBody), ...style(uBody, ["fontSize", "lineHeight", "color", "fontWeight"]) } : null,
            }
          : { selector: ".msg.user", missing: true },
      ];

      const gname = q(".msg-grok-name");
      const gav = q(".msg-grok-avatar");
      const bubbleAuthorName = gname
        ? { selector: ".msg-grok-name", ...rect(gname), ...style(gname, ["fontSize", "fontWeight", "color", "lineHeight"]), text: gname.textContent }
        : { selector: ".msg-grok-name", missing: true };
      const bubbleAvatar = gav
        ? { selector: ".msg-grok-avatar", ...rect(gav), ...style(gav, ["width", "height", "borderRadius", "backgroundColor", "color"]) }
        : { selector: ".msg-grok-avatar", missing: true };

      // messageColumn #log
      const logEl = q("#log");
      const msg0 = q('.msg.assistant[data-probe="head"]');
      const cb = q(".bb-codeblock");
      const logRt = rect(logEl);
      const mainRt2 = rect(main);
      const logCs = logEl ? getComputedStyle(logEl) : null;
      const messageColumn = logEl
        ? {
            selector: "#log",
            row: msg0 ? { selector: '.msg', ...rect(msg0), ...style(msg0, ["padding", "margin", "backgroundColor", "maxWidth", "width"]) } : null,
            paneWidth: mainRt2 ? mainRt2.width : null,
            rowWidth: logRt ? logRt.width : null,
            sideMargin: mainRt2 && logRt ? Math.round(((mainRt2.width - logRt.width) / 2) * 100) / 100 : null,
            maxWidthRule: {
              cssMaxWidth: logCs ? logCs.maxWidth : null,
              contentMaxVar: logCs ? logCs.getPropertyValue("--content-max").trim() : null,
              resolved: logRt ? logRt.width : null,
              msgMaxWidth: msg0 ? getComputedStyle(msg0).maxWidth : null,
            },
            codeBlock: cb
              ? { selector: ".bb-codeblock", ...rect(cb), ...style(cb, ["width", "borderRadius", "backgroundColor", "padding", "borderTopWidth", "borderTopColor", "boxShadow", "fontSize", "fontFamily", "lineHeight"]) }
              : { selector: ".bb-codeblock", missing: true },
          }
        : { selector: "#log", missing: true };

      // accountBar
      const footer = q("#sidebar-footer");
      const acctBar = q("#account-bar");
      const acctBtn = q("#account-avatar-btn");
      const acctCircle = q("#account-avatar-circle");
      const email = q("#account-name-label");
      const abSess = q("#ab-sessions-btn");
      const abSet = q("#ab-settings-btn");
      const iconBtns = qa("#account-bar .ab-icon-btn");
      const accountBar = {
        selector: "#sidebar-footer / #account-bar",
        footer: { selector: "#sidebar-footer", ...rect(footer), ...style(footer, ["height", "padding", "gap", "backgroundColor", "borderTopWidth", "borderTopColor", "display"]) },
        ...rect(acctBar),
        ...style(acctBar, ["height", "padding", "gap", "backgroundColor", "display", "alignItems"]),
        accountButton: acctBtn
          ? { selector: "#account-avatar-btn", ...rect(acctBtn), ...style(acctBtn, ["backgroundColor", "borderRadius", "fontSize", "color", "padding", "boxShadow", "borderTopWidth", "borderTopColor", "gap", "display", "minHeight"]) }
          : { selector: "#account-avatar-btn", missing: true },
        accountAvatar: acctCircle
          ? { selector: "#account-avatar-circle", ...rect(acctCircle), ...style(acctCircle, ["width", "height", "borderRadius", "backgroundColor", "color", "fontSize", "boxShadow"]) }
          : { selector: "#account-avatar-circle", missing: true },
        emailText: email
          ? { selector: "#account-name-label", ...rect(email), ...style(email, ["fontSize", "fontWeight", "color", "width"]), text: email.textContent }
          : { selector: "#account-name-label", missing: true },
        connectAppsButton: (() => {
          // Grok 底部有独立「Connect apps」胶囊；我们底部只有账户胶囊 + 两个图标。
          // 如实记录：无独立连接应用胶囊（功能收进 #account-popup 的「连接应用」行）。
          const has = iconBtns.some((b) => /连接|应用|apps/i.test(b.getAttribute("title") || b.getAttribute("aria-label") || ""));
          return {
            absent: !has,
            note: has ? null : "底部无独立 Connect apps 胶囊；该功能收进 #account-popup 的 ap-connect「连接应用」行。右侧是两个 .ab-icon-btn（会话 / 设置）。",
            abSessionsBtn: abSess ? { selector: "#ab-sessions-btn", ...rect(abSess), ...style(abSess, ["width", "height", "borderRadius", "backgroundColor", "color"]) } : null,
            abSettingsBtn: abSet ? { selector: "#ab-settings-btn", ...rect(abSet), ...style(abSet, ["width", "height", "borderRadius", "backgroundColor", "color"]) } : null,
          };
        })(),
      };

      // tokens：把请求的属性名逐条 getPropertyValue（未定义的会是空串）
      const REQ_TOKENS = [
        "--bg", "--bg-elev", "--text", "--text-muted", "--border", "--fill", "--fill-strong",
        "--accent", "--accent-ink", "--sidebar-w", "--header-h", "--content-max",
        "--radius-composer", "--radius-bubble", "--radius-pill", "--radius-xl",
        "--space-1", "--space-2", "--space-3", "--space-4", "--space-5", "--space-6", "--space-7",
        "--text-xs", "--text-sm", "--text-base", "--text-md", "--text-lg",
      ];
      const bodyCs = getComputedStyle(document.body);
      const cssVars = {};
      for (const t of REQ_TOKENS) {
        const raw = bodyCs.getPropertyValue(t).trim();
        cssVars[t] = raw === "" ? null : raw;
      }
      const tokens = {
        note: "值来自 getComputedStyle(document.body).getPropertyValue()（浅色 force-light）；仓库未定义的别名返回 null",
        cssVars,
      };

      return {
        windowShell,
        sidebar,
        sidebarHeader,
        sidebarHeaderButtons: tbBtns,
        sessionRow,
        avatar,
        groupLabel,
        composer,
        attachButton,
        micButton,
        sendButton,
        bubble,
        bubbleVariants,
        bubbleAuthorName,
        bubbleAvatar,
        messageColumn,
        accountBar,
        tokens,
        // clip 用的锚点矩形
        _clip: {
          full: { x: 0, y: 0, width: 1040, height: 760 },
          sidebar: rect(q("#agents")),
          sessionRow: row0rt,
          groupLabel: rect(q(".bot-group-head")),
          composer: rect(q("#composer")),
          accountBar: rect(q("#sidebar-footer")),
          chatPane: rect(q("#main")),
          log: rect(q("#log")),
          msgRow: rect(q('.msg.assistant[data-probe="head"]')),
        },
      };
    });

    Object.assign(spec, base);
    const clipData = base._clip;
    delete spec._clip;

    // --- 交互态：hover + 选中态（active）-------------------------------------
    let hoverBg = null;
    try {
      const handle = await win.$("#agents .sess-row");
      if (handle) {
        await handle.hover();
        await win.waitForTimeout(160);
        hoverBg = await win.evaluate(() => getComputedStyle(document.querySelector("#agents .sess-row")).backgroundColor);
      }
    } catch (_) { /* 无行 */ }
    const activeBg = await win.evaluate(() => {
      const r = document.querySelector("#agents .sess-row");
      if (!r) return null;
      r.classList.add("active");
      // 等 transition 落定
      return new Promise((res) => {
        setTimeout(() => {
          const v = getComputedStyle(r).backgroundColor;
          r.classList.remove("active");
          res(v);
        }, 200);
      });
    });
    spec.rowInteractionStates = {
      selector: ".sess-row",
      hoverBackgroundColor: hoverBg,
      hoverNote: hoverBg ? null : "取 hover 失败（无行 / hover 无 background 变化）",
      activeBackgroundColor: activeBg,
      activeNote: "以 .active 类模拟选中态采样（真实点击会触发 LLM turn，故不点），与门禁读法一致",
    };
    if (spec.sessionRow && !spec.sessionRow.missing) spec.sessionRow.activeRowBackground = activeBg;

    // --- sendButton 有字态 ---
    const sendWithText = await win.evaluate(() => {
      const t = document.getElementById("text");
      const s = document.getElementById("send");
      if (!t || !s) return null;
      t.value = "你好，帮我看下这个 PR";
      t.dispatchEvent(new Event("input", { bubbles: true }));
      return new Promise((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const r = s.getBoundingClientRect();
          const cs = getComputedStyle(s);
          const out = {
            value: t.value,
            width: Math.round(r.width * 100) / 100,
            height: Math.round(r.height * 100) / 100,
            borderRadius: cs.borderRadius,
            backgroundColor: cs.backgroundColor,
            color: cs.color,
            boxShadow: cs.boxShadow,
            opacity: cs.opacity,
            disabled: s.disabled,
          };
          t.value = "";
          t.dispatchEvent(new Event("input", { bubbles: true }));
          res(out);
        }));
      });
    });
    spec.sendButton.withTextState = sendWithText;
    spec.sendButton.emptyState = {
      backgroundColor: base.sendButton.backgroundColor,
      opacity: base.sendButton.opacity,
    };
    spec.sendButton.note =
      "本仓库 #send 底色恒为 var(--accent)，不随是否有字变化（Grok 空态/有字态底色不同）；" +
      "空态只靠 :disabled 改 opacity。见 withTextState.disabled/opacity。";

    // --- accountPopup 展开态 ---
    const popup = await win.evaluate(() => {
      const btn = document.getElementById("account-avatar-btn");
      const pop = document.getElementById("account-popup");
      if (!btn || !pop) return { missing: true };
      btn.click();
      return new Promise((res) => {
        setTimeout(() => {
          const cs = getComputedStyle(pop);
          const rect = (el) => {
            const r = el.getBoundingClientRect();
            const d = (x) => Math.round(x * 100) / 100;
            return { x: d(r.left), y: d(r.top), left: d(r.left), top: d(r.top), width: d(r.width), height: d(r.height) };
          };
          const items = Array.from(pop.querySelectorAll(".ap-item")).map((it) => {
            const s = getComputedStyle(it);
            const ic = it.querySelector(".ap-ic");
            const tx = it.querySelector(".ap-tx");
            const r = rect(it);
            return {
              id: it.id || null,
              text: (tx || it).textContent.trim(),
              ...r,
              padding: s.padding,
              borderRadius: s.borderRadius,
              fontSize: s.fontSize,
              fontWeight: s.fontWeight,
              color: s.color,
              backgroundColor: s.backgroundColor,
              icon: ic ? { fontSize: getComputedStyle(ic).fontSize, color: getComputedStyle(ic).color } : null,
            };
          });
          const seps = Array.from(pop.querySelectorAll(".ap-sep")).map((sp) => {
            const s = getComputedStyle(sp);
            return { height: s.height, backgroundColor: s.backgroundColor, margin: s.margin };
          });
          res({
            selector: "#account-popup",
            ...rect(pop),
            borderRadius: cs.borderRadius,
            backgroundColor: cs.backgroundColor,
            borderTopWidth: cs.borderTopWidth,
            borderTopColor: cs.borderTopColor,
            boxShadow: cs.boxShadow,
            padding: cs.padding,
            gap: cs.gap,
            transition: cs.transitionDuration + " / " + cs.transitionProperty,
            items,
            separators: seps,
          });
        }, 260);
      });
    });
    spec.accountPopup = popup;

    // --- plusMenuItems：临时显示 #composer-more ---
    const plus = await win.evaluate(() => {
      const m = document.getElementById("composer-more");
      if (!m) return { missing: true };
      const prev = m.getAttribute("hidden");
      m.removeAttribute("hidden");
      m.style.display = "flex";
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        const d = (x) => Math.round(x * 100) / 100;
        return { left: d(r.left), top: d(r.top), width: d(r.width), height: d(r.height) };
      };
      const items = Array.from(m.querySelectorAll("button")).map((b) => {
        const s = getComputedStyle(b);
        return {
          id: b.id || null,
          text: (b.querySelector("[data-i18n]") || b).textContent.trim(),
          ...rect(b),
          padding: s.padding,
          borderRadius: s.borderRadius,
          fontSize: s.fontSize,
          color: s.color,
          backgroundColor: s.backgroundColor,
          border: s.borderTopWidth + " " + s.borderTopStyle + " " + s.borderTopColor,
        };
      });
      const contCs = getComputedStyle(m);
      const contRt = rect(m);
      // 还原
      if (prev !== null) m.setAttribute("hidden", prev);
      m.style.display = "";
      return {
        selector: "#composer-more",
        ...contRt,
        container: { padding: contCs.padding, gap: contCs.gap, borderRadius: contCs.borderRadius, backgroundColor: contCs.backgroundColor, boxShadow: contCs.boxShadow, border: contCs.borderTopWidth + " " + contCs.borderTopStyle + " " + contCs.borderTopColor },
        items,
      };
    });
    spec.plusMenuItems = plus;

    // --- connectAppsPanel：字段名与 Grok 那份 connectAppsPanel 完全同名，可逐字段 diff ---
    // 只读几何/样式，绝不读取任何 input 的 value（面板里有渠道凭证输入框）。
    const connect = await win.evaluate(async () => {
      const btn = document.getElementById("connect-apps-btn");
      const modal = document.getElementById("connect-apps-modal");
      if (!modal) return { missing: true };
      if (btn && getComputedStyle(modal).display === "none") btn.click();
      // 插件列表是异步渲染的：等到卡片真正有高度再采样，否则采到 0x0 的中间帧。
      await new Promise((done) => {
        const tick = (n) => {
          const first = modal.querySelector(".ca-card, .ca-item, .ca-grid > *");
          const laidOut = first && first.getBoundingClientRect().height > 8;
          if (laidOut || n <= 0) return done();
          setTimeout(() => tick(n - 1), 120);
        };
        setTimeout(() => tick(8), 200);
      });
      return new Promise((res) => {
        setTimeout(() => {
          const d = (x) => Math.round(x * 100) / 100;
          const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { left: d(r.left), top: d(r.top), width: d(r.width), height: d(r.height) };
          };
          const box = (sel) => {
            const el = typeof sel === "string" ? modal.querySelector(sel) : sel;
            if (!el) return null;
            const s = getComputedStyle(el);
            return {
              selector: typeof sel === "string" ? sel : null,
              text: (el.textContent || "").trim().slice(0, 40),
              ...rect(el),
              padding: s.padding,
              backgroundColor: s.backgroundColor,
              color: s.color,
              borderRadius: s.borderRadius,
              fontSize: s.fontSize,
              fontWeight: s.fontWeight,
              boxShadow: s.boxShadow,
              borderTopWidth: s.borderTopWidth,
              borderTopColor: s.borderTopColor,
              borderTopStyle: s.borderTopStyle,
            };
          };
          const sheet = modal.querySelector(".bb-sheet") || modal;
          const sheetCs = getComputedStyle(sheet);
          const container = {
            selector: "#connect-apps-modal .bb-sheet",
            ...rect(sheet),
            padding: sheetCs.padding,
            backgroundColor: sheetCs.backgroundColor,
            borderRadius: sheetCs.borderRadius,
            boxShadow: sheetCs.boxShadow,
            borderTopWidth: sheetCs.borderTopWidth,
            borderTopColor: sheetCs.borderTopColor,
            borderTopStyle: sheetCs.borderTopStyle,
            zIndex: sheetCs.zIndex,
            position: sheetCs.position,
            overflow: sheetCs.overflow,
            fontFamily: sheetCs.fontFamily,
            fontSize: sheetCs.fontSize,
            fontWeight: sheetCs.fontWeight,
            color: sheetCs.color,
          };
          const chips = Array.from(modal.querySelectorAll(".ca-chip")).map((c) => {
            const s = getComputedStyle(c);
            return {
              text: c.textContent.trim(),
              active: c.classList.contains("active"),
              ...rect(c),
              padding: s.padding,
              backgroundColor: s.backgroundColor,
              color: s.color,
              borderRadius: s.borderRadius,
              fontSize: s.fontSize,
              fontWeight: s.fontWeight,
              boxShadow: s.boxShadow,
              borderTopWidth: s.borderTopWidth,
              borderTopColor: s.borderTopColor,
            };
          });
          const cards = Array.from(modal.querySelectorAll(".ca-card, .bb-modal .ca-item, .ca-grid > *")).slice(0, 12);
          const gridEl = modal.querySelector(".ca-grid") || modal.querySelector("[class*=grid]");
          const gridCs = gridEl ? getComputedStyle(gridEl) : null;
          const headings = Array.from(modal.querySelectorAll(".ca-cat-head, .bb-section-title")).map((h) => ({
            text: h.textContent.trim().slice(0, 30),
            ...rect(h),
            fontSize: getComputedStyle(h).fontSize,
            fontWeight: getComputedStyle(h).fontWeight,
          }));
          // 所有几何必须在「关闭弹层」之前采完，否则淡出中采到 0x0。
          const titleBox = box(".bb-sheet-title");
          const closeBox = box("#ca-close");
          const searchBox = box("#ca-search");
          const gridBox = gridEl
            ? { selector: null, ...rect(gridEl), gap: gridCs.gap, display: gridCs.display, gridTemplateColumns: gridCs.gridTemplateColumns }
            : null;
          const rowsBox = cards.map((c) => ({ text: c.textContent.trim().slice(0, 30), ...rect(c), borderRadius: getComputedStyle(c).borderRadius, padding: getComputedStyle(c).padding }));
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          const closeBtn = modal.querySelector("#ca-close");
          if (closeBtn && getComputedStyle(modal).display !== "none") closeBtn.click();
          res({
            container,
            title: titleBox,
            close: closeBox,
            searchBox,
            chips,
            grid: gridBox,
            rowCount: cards.length,
            rows: rowsBox,
            headings,
            absent: {
              installedPreview: !modal.querySelector(".sand-plugins__installed-preview"),
              botTemplate: !modal.querySelector("[class*=template]"),
              viewAll: !modal.querySelector("[class*=view-all]"),
              teamBadges: !modal.querySelector("[class*=team]"),
            },
            note: "Grok 侧是 800x666 fixed dialog；我方是 .bb-sheet 弹层。字段同名可直接 diff。",
          });
        }, 260);
      });
    });
    spec.connectAppsPanel = connect;

    // --- 截图（先静态，再展开态，逐区 clip）----------------------------------
    const shot = async (name, clip) => {
      const opts = { path: path.join(SHOT_DIR, name) };
      if (clip && clip.width > 0 && clip.height > 0) {
        opts.clip = { x: Math.max(0, clip.left ?? clip.x), y: Math.max(0, clip.top ?? clip.y), width: Math.max(1, clip.width), height: Math.max(1, clip.height) };
      }
      await win.screenshot(opts);
    };
    await shot("00-window-full.png");
    await shot("01-sidebar.png", clipData.sidebar);
    await shot("02-session-row.png", clipData.sessionRow);
    await shot("03-group-label.png", clipData.groupLabel);
    await shot("04-composer.png", clipData.composer);
    await shot("05-account-bar.png", clipData.accountBar);
    await shot("06-chat-pane.png", clipData.chatPane);
    await shot("08-bubble-area.png", clipData.log);
    await shot("09-message-row.png", clipData.msgRow);

    // 10：＋ 菜单打开
    await win.evaluate(() => {
      const m = document.getElementById("composer-more");
      if (m) { m.setAttribute("data-keep", "1"); m.removeAttribute("hidden"); m.style.display = "flex"; }
    });
    await win.waitForTimeout(60);
    await shot("10-composer-plus-menu-open.png", { left: 280, top: 520, width: 760, height: 240 });
    await win.evaluate(() => {
      const m = document.getElementById("composer-more");
      if (m) { m.setAttribute("hidden", ""); m.style.display = ""; m.removeAttribute("data-keep"); }
    });

    // 11：composer 有字
    await win.evaluate(() => {
      const t = document.getElementById("text");
      t.value = "帮我把这份 PR 合并到 main，先跑 CI 再合，别动 lockfile。";
      t.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await win.waitForTimeout(120);
    await shot("11-composer-with-text.png", clipData.composer);
    await win.evaluate(() => {
      const t = document.getElementById("text");
      t.value = "";
      t.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // 12：账户弹层打开
    await win.evaluate(() => {
      const b = document.getElementById("account-avatar-btn");
      if (b) b.click();
    });
    await win.waitForTimeout(260);
    await shot("12-account-popup-open.png", { left: 0, top: 380, width: 280, height: 380 });
    await win.keyboard.press("Escape").catch(() => {});
    await win.evaluate(() => {
      const b = document.getElementById("account-avatar-btn");
      const pop = document.getElementById("account-popup");
      if (pop && !pop.hidden) b && b.click();
    });

    // --- 13：连接应用面板截图（对照稿用；面板自身在 connectAppsPanel 段已被关闭）---
    await win.evaluate(() => {
      const b = document.getElementById("connect-apps-btn");
      if (b) b.click();
    });
    await win.waitForTimeout(900);
    await shot("13-connect-apps.png");
    await win.keyboard.press("Escape").catch(() => {});

    // --- meta ---
    spec.meta = {
      url: await win.evaluate(() => location.href),
      viewport: {
        width: await win.evaluate(() => window.innerWidth),
        height: await win.evaluate(() => window.innerHeight),
        deviceScaleFactor: await win.evaluate(() => window.devicePixelRatio),
      },
      contentAreaVerified: size,
      theme: "light (body.force-light, grok-ui shell)",
      unit: "all geometry values are CSS logical pixels; screenshots are deviceScaleFactor x",
      capturedAt: new Date().toISOString(),
      source: "Bit Bot desktop (Electron, hosts/desktop/index.html + ui_chrome.css)",
      script: "scripts/bb_spec_capture.mjs",
      selectorMap: {
        windowShell: "body (grid shell)",
        sidebar: "#agents",
        sidebarHeader: "#sidebar-toolbar",
        sessionRow: ".sess-row (injected into #bot-list)",
        avatar: ".sess-avatar",
        groupLabel: ".bot-group-head",
        composer: "#composer .row (dock=#composer, field=#text)",
        attachButton: "#attach-btn",
        micButton: "#voice-btn (mic)",
        sendButton: "#send",
        bubble: ".msg.assistant .body",
        bubbleVariants: "[assistant .body, .msg.user]",
        bubbleAuthorName: ".msg-grok-name",
        bubbleAvatar: ".msg-grok-avatar",
        messageColumn: "#log (pane=#main, codeBlock=.bb-codeblock)",
        accountBar: "#sidebar-footer / #account-bar",
        accountPopup: "#account-popup (.ap-item/.ap-ic/.ap-sep)",
        plusMenuItems: "#composer-more (temporarily un-hidden)",
        connectAppsPanel: "#connect-apps-modal .bb-sheet (.ca-chip/.ca-grid)",
      },
    };

    fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(spec, null, 2) + "\n");
    console.log("bb_spec_capture: wrote " + path.relative(REPO, OUT_JSON));
    console.log("bb_spec_capture: verified content area = " + JSON.stringify(spec.meta.contentAreaVerified) + " dpr=" + spec.meta.viewport.deviceScaleFactor);
    console.log("bb_spec_capture: screenshots -> " + SHOT_DIR);
  } catch (e) {
    console.error("bb_spec_capture crashed:", e && e.stack ? e.stack : e);
    throw e;
  } finally {
    try {
      await app.evaluate(({ app: ea }) => { ea.isQuiting = true; ea.quit(); });
      await app.close();
    } catch (_) { /* already gone */ }
    fs.rmSync(ud, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error("bb_spec_capture fatal:", err && err.stack ? err.stack : err);
  process.exit(1);
});
