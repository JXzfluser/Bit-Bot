/* e2e_desktop_cn_secret_inputs.mjs — 国内渠道「加签 / 回调」密钥能不能在界面上配（CN-SEC-01..06）
 *
 * 为什么这条值得单独钉：博主场景里「定时推到群里」这一步用的是钉钉/飞书/企微机器人。
 * 钉钉自定义机器人要么开「加签」，要么开关键词/IP 白名单；飞书事件订阅要 Encrypt Key +
 * Verification Token；企微回调要 Callback Token。这四个值内核与发送路径**都已经支持**
 * （ALLOWED_SECRET_KEYS 里有 BITBOT_DINGTALK_APP_SECRET / BITBOT_FEISHU_ENCRYPT_KEY /
 * BITBOT_FEISHU_VERIFICATION_TOKEN / BITBOT_WECOM_CALLBACK_TOKEN，
 * cn_inbound_server.js:339/379/429 真的在读），但界面上一个输入框都没有，
 * `secrets:status` 也不回读它们 —— 于是用户只能在终端里手改 .env.local。
 * 「装完 app 还得去改文件」不等于能走通。
 *
 * 断言（都在真 Electron 渲染的 DOM 上读，不看源码说了算）：
 *   CN-SEC-01 四个输入框存在，且默认掩码（type=password）
 *   CN-SEC-02 secrets:status 回读这四个键，只给 masked、不给明文 value
 *   CN-SEC-03 密钥已存在时卡里要显示「已配置 ****xxxx」，且屏幕上不许出现我注入的原文
 *   CN-SEC-04 这四栏必须是可选的：勾了开启推送、四栏留空 → 红字 0 条、保存仍可点
 *            （不能把关键词/IP 白名单型的机器人逼成必须填加签）
 *   CN-SEC-05 每个新密钥栏要有就地显隐（默认藏着，点了才露，再点收回）
 *   CN-SEC-06 界面值要真的接得到写盘：栏上必须带 data-secret-key（键名与主进程白名单一致），
 *            页内写盘收集器必须遍历 [data-secret-key]
 *            —— 不桩 IPC（contextBridge 挂上来的属性不可重定义），也不点真保存
 *               （.env.local 是固定路径，BITBOT_REPO_ROOT 隔离不到它，门禁不许碰）
 *
 * 跑法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_cn_secret_inputs.mjs
 * 缺 electron / 缺显示环境时诚实 SKIP。
 *
 * ── 修复前红（同一轮实测）────────────────────────────────────────────
 *   ✗ CN-SEC-01 输入框不存在 — ["sec-ding-secret","sec-feishu-encrypt",
 *                                "sec-feishu-verify","sec-wecom-callback"]
 *   ✗ CN-SEC-02 status 不回读 — 四个键全部缺席
 *   ✗ CN-SEC-03 卡里不说「已配置 ****3k7q」（密钥明明已经注入进程）
 *   ✓ CN-SEC-04 —— 但这条当时是**空断言**：栏不存在，循环没执行，"没报红" 是白给的。
 *                    现在补了「栏必须存在，否则这条判不过」，见 CN-SEC-04 的 exists 检查。
 *   ✗ CN-SEC-05 无显隐按钮 ×4
 *   ✗ CN-SEC-06 桩 IPC 失败 — Cannot redefine property: set（换断法，见上）
 *   合计 PASS=1 FAIL=5 → 修到 PASS=6 FAIL=0
 *
 *   补完输入框再跑，第二轮还剩两条红，两条都不是「假装修」能糊过去的：
 *   ✗ CN-SEC-04 四栏留空时保存按钮被禁 —— 红得有价值，但真因不在这四栏：
 *     钉钉 Webhook 磁盘上明明配着（status 给 present + ****xxxx），输入框按安全规则
 *     不回填明文，于是必填校验把它读成「空的」，卡里写「勾选了开启推送，Webhook 地址
 *     还是空的」并禁掉保存。用户看到的是一句谎话 + 一个按不动的按钮。→ 修在校验里：
 *     掩码栏 empty 但 status 说已配置 = 满足，并在状态行写明「已配置 ****xxxx（无需重填）」。
 *   ✗ CN-SEC-05 显隐按钮不存在 —— 这条红的是尺子自己：成功分支的返回对象里没带
 *     hasBtn/hasField，`!x.hasBtn` 对成功项也成立。产品的四个按钮一开始就是好的。
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
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 240) : ""));
};
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_cn_secret_inputs: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_cn_secret_inputs: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_cn_secret_inputs: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_cn_secret_inputs: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
// 注入的假密钥长这样：屏幕上只要出现它，就是明文回显（CN-SEC-03 抓这个）
const FAKE_DING_SECRET = "SEC-gate-ding-9f3k7q";
const root = isolatedRepoRoot(REPO, "cnsec", {
  "bots.json": { bots: [{ id: "b1", name: "派单助手", job: "派单调度", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW }], primary: "b1" },
  "settings.json": { notify: {}, dev_mode: true },
  "sessions.json": { sessions: [] },
});
const UD = electronUserDataDir("cnsec");

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
        BITBOT_DINGTALK_POST: "1",
        BITBOT_DINGTALK_WEBHOOK: "https://oapi.dingtalk.com/robot/send?access_token=gate",
        BITBOT_DINGTALK_APP_SECRET: FAKE_DING_SECRET,
      }),
    ),
  });
}

const NEW_FIELDS = [
  { id: "sec-ding-secret", key: "BITBOT_DINGTALK_APP_SECRET", reveal: "cn-ding-secret-reveal" },
  { id: "sec-feishu-encrypt", key: "BITBOT_FEISHU_ENCRYPT_KEY", reveal: "cn-feishu-encrypt-reveal" },
  { id: "sec-feishu-verify", key: "BITBOT_FEISHU_VERIFICATION_TOKEN", reveal: "cn-feishu-verify-reveal" },
  { id: "sec-wecom-callback", key: "BITBOT_WECOM_CALLBACK_TOKEN", reveal: "cn-wecom-callback-reveal" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let app = null;

(async () => {
  try {
    app = await launch();
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await sleep(600);

    await win.click("#account-avatar-btn");
    await win.waitForSelector("#ap-connect", { state: "visible", timeout: 8000 });
    await win.click("#ap-connect");
    await win.waitForSelector("#connect-apps-modal", { state: "visible", timeout: 10000 });
    // 卡打开时会自己发一次 secrets:status（异步），状态行是它回来才写的；
    // 这里等的是「这一轮 IPC 已经落回 DOM」，不是等一个特定结论。
    await sleep(900);

    /* ---------- CN-SEC-01 四个输入框存在且默认掩码 ---------- */
    {
      const shape = await win.evaluate((fields) => {
        return fields.map((f) => {
          const el = document.getElementById(f.id);
          return { id: f.id, exists: Boolean(el), type: el ? el.type : null, label: el ? (el.closest("label") || {}).textContent || "" : "" };
        });
      }, NEW_FIELDS);
      const missing = shape.filter((s) => !s.exists);
      const plain = shape.filter((s) => s.exists && s.type !== "password");
      if (missing.length) bad("CN-SEC-01 密钥输入框不存在（用户只能去手改 .env.local）", JSON.stringify(missing.map((m) => m.id)));
      else if (plain.length) bad("CN-SEC-01 密钥框不是默认掩码", JSON.stringify(plain));
      else ok("CN-SEC-01 钉钉加签 / 飞书 Encrypt Key / 飞书 Verification Token / 企微 Callback Token 四个输入框都在，且默认掩码");
    }

    /* ---------- CN-SEC-02 status 回读这四个键，且只给掩码 ---------- */
    {
      const st = await win.evaluate(async () => await window.bitbot.secrets.status());
      const f = st.fields || {};
      const absent = NEW_FIELDS.map((x) => x.key).filter((k) => !f[k]);
      const leaky = NEW_FIELDS.map((x) => x.key).filter((k) => f[k] && f[k].value !== undefined && String(f[k].value).length > 0);
      if (absent.length) bad("CN-SEC-02 secrets:status 不回读这四个键（界面上连「配过没有」都说不了）", JSON.stringify(absent));
      else if (leaky.length) bad("CN-SEC-02 status 把密钥明文回给渲染层", JSON.stringify(leaky));
      else ok("CN-SEC-02 status 回读四个键，只给 present/masked，不给明文 value");
    }

    /* ---------- CN-SEC-03 已配置要说「已配置 ****xxxx」，且不许出现原文 ---------- */
    {
      const seen = await win.evaluate(
        (args) => {
          const card = document.getElementById("ca-cn-channels");
          const text = card ? String(card.textContent || "") : "";
          const field = document.getElementById("sec-ding-secret");
          return {
            cardText: text.slice(0, 1200),
            fieldValue: field ? field.value : null,
            fake: args.fake,
            maskedTail: args.tail,
          };
        },
        { fake: FAKE_DING_SECRET, tail: FAKE_DING_SECRET.slice(-4) },
      );
      const saysConfigured = /已配置/.test(seen.cardText) && seen.cardText.includes(seen.maskedTail);
      const leaks = seen.cardText.includes(seen.fake) || (seen.fieldValue || "").includes(seen.fake);
      if (leaks) bad("CN-SEC-03 屏幕上出现了密钥原文（掩码形同虚设）", seen.cardText.slice(0, 160));
      else if (!saysConfigured) bad("CN-SEC-03 密钥已经在了，卡里却不说「已配置 ****xxxx」（用户只能靠自己记得填过没有）", seen.cardText.slice(0, 220));
      else ok("CN-SEC-03 已配置的密钥在卡里如实标出（含掩码尾 4 位），原文不在屏幕上");
    }

    /* ---------- CN-SEC-04 这四栏必须可选：留空不许挡保存 ---------- */
    {
      const state = await win.evaluate(() => {
        const rows = ["sec-ding-secret", "sec-feishu-encrypt", "sec-feishu-verify", "sec-wecom-callback"];
        const exists = {};
        rows.forEach((id) => {
          const el = document.getElementById(id);
          exists[id] = Boolean(el);
          if (el) {
            el.value = "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        const errEls = Array.prototype.slice.call(document.querySelectorAll(".st-field-error"));
        const shown = errEls.filter((e) => !e.hidden && String(e.textContent || "").trim());
        const save = document.getElementById("sec-save");
        return {
          exists,
          errs: shown.map((e) => String(e.textContent || "").trim()).slice(0, 6),
          saveDisabled: save ? Boolean(save.disabled) : null,
        };
      });
      const gone = Object.keys(state.exists).filter((k) => !state.exists[k]);
      const mentionsNew = state.errs.filter((t) => /加签|Encrypt|Verification|Callback/.test(t));
      if (gone.length) bad("CN-SEC-04 栏还没建出来，这条断不了「可选」（先补输入框再谈必填与否）", JSON.stringify(gone));
      else if (mentionsNew.length) bad("CN-SEC-04 这四栏被当成必填了：关键词/IP 白名单型机器人会被自己的界面挡住", JSON.stringify(mentionsNew));
      else if (state.saveDisabled) bad("CN-SEC-04 四栏留空时保存按钮被禁（可选字段不该挡写盘）", JSON.stringify(state));
      else ok("CN-SEC-04 四个密钥栏留空不报红、不禁保存（加签是可选路径，不是门槛）");
    }

    /* ---------- CN-SEC-05 每栏就地显隐 ---------- */
    {
      const r = await win.evaluate((fields) => {
        const out = [];
        for (const f of fields) {
          const btn = document.getElementById(f.reveal);
          const el = document.getElementById(f.id);
          if (!btn || !el) {
            out.push({ id: f.id, hasBtn: Boolean(btn), hasField: Boolean(el) });
            continue;
          }
          const before = el.type;
          btn.click();
          const shown = el.type;
          btn.click();
          out.push({ id: f.id, hasBtn: true, hasField: true, before, shown, back: el.type });
        }
        return out;
      }, NEW_FIELDS);
      const absent = r.filter((x) => !x.hasBtn || !x.hasField);
      const broken = r.filter((x) => x.before === "password" && x.shown !== "text");
      const noRestore = r.filter((x) => x.shown === "text" && x.back !== "password");
      if (absent.length) bad("CN-SEC-05 有的密钥栏没有就地显隐按钮", JSON.stringify(absent));
      else if (broken.length) bad("CN-SEC-05 点了「显示」没露出原文", JSON.stringify(broken));
      else if (noRestore.length) bad("CN-SEC-05 再点一次没收回成掩码", JSON.stringify(noRestore));
      else ok("CN-SEC-05 四个密钥栏都能就地显隐（password → text → password）");
    }

    /* ---------- CN-SEC-06 填了新值要真的进 save patch ---------- */
    {
      const res = await win.evaluate(
        async (args) => {
          /* contextBridge 挂上来的 window.bitbot 是不可重定义的（实测
             "Cannot redefine property: set"），所以没法在渲染进程里桩截 IPC。
             又不能真点保存 —— upsertDesktopEnvLocal 写的是 hosts/desktop/.env.local
             这个固定路径，BITBOT_REPO_ROOT 隔离不到它，一点就把假密钥写进用户真文件。
             退一步的断法仍然在页面里、仍然不读源码文件：
               a) 四个 input 必须带 data-secret-key，且键名就是主进程白名单里那四个；
               b) 页内内联脚本里的写盘收集器必须遍历 [data-secret-key] 并按非空入 patch。
             这两条合起来说的是「界面上的值确实走得到写盘」，而 (b) 只在边界处断，
             因为把 IPC 打穿需要动 main.js 的密钥路径，不该为了门禁去动它。 */
          const attrs = {};
          for (const f of args.fields) {
            const el = document.getElementById(f.id);
            attrs[f.id] = el ? String(el.getAttribute("data-secret-key") || "") : null;
          }
          const inline = Array.prototype.slice
            .call(document.scripts)
            .map((s) => s.textContent || "")
            .join("\n");
          const loopsAttrs = /\[data-secret-key\]|querySelectorAll\(['"]\[data-secret-key\]/.test(inline);
          const keysInCollector = args.fields.every((f) => inline.indexOf(f.key) >= 0);
          return { attrs, loopsAttrs, keysInCollector, inlineLen: inline.length };
        },
        { fields: NEW_FIELDS },
      );
      const wrongAttr = NEW_FIELDS.filter((f) => res.attrs[f.id] !== f.key);
      if (wrongAttr.length) bad("CN-SEC-06 输入框没带对 data-secret-key（值传不到主进程白名单）", JSON.stringify(res.attrs));
      else if (!res.loopsAttrs) bad("CN-SEC-06 写盘收集器没有遍历 [data-secret-key]：新栏只是摆设", "");
      else if (!res.keysInCollector) bad("CN-SEC-06 收集器里找不到这四个键名", "");
      else ok("CN-SEC-06 四个栏都带 data-secret-key（真键名），页内写盘收集器按这个属性收值（不点真保存：.env.local 是固定路径，门禁不许碰）");
    }
  } catch (e) {
    bad("门禁本身跑挂", String(e && e.stack ? e.stack.slice(0, 400) : e));
  } finally {
    try {
      if (app) await app.close();
    } catch (e) {
      /* app 已退出，桩随进程消失 */
    }
    killGateProcs();
  }
  done("e2e_desktop_cn_secret_inputs");
})();
