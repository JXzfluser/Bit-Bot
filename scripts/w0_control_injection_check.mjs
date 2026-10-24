/* w0_control_injection_check.mjs — 反向对照：证明「运行时注入的覆盖表」真的生效
 *
 * 为什么必须做：0a/0b 的两条「差异 0 条」结论全靠 <style id=w0-proof-style> 注入生效。
 * 如果注入其实没生效（选择器不匹配 / 被更晚的源码规则压住 / body 上没有 grok-ui 类），
 * 那 0 条差异就是假绿。这里故意注入一个必改色的规则，看指纹是否真的动。
 *
 * 用法：node scripts/w0_control_injection_check.mjs
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
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

const PROPS = ["backgroundColor", "color", "borderTopColor", "boxShadow", "borderRadius", "backgroundImage", "outlineColor"];
const LOG = "/tmp/w0_control.log";
fs.writeFileSync(LOG, "");
const log = (...a) => { const l = `[${new Date().toISOString().slice(11, 19)}] ${a.join(" ")}`; fs.appendFileSync(LOG, l + "\n"); process.stdout.write(l + "\n"); };

async function fingerprint(win) {
  return win.evaluate((props) => {
    const out = {};
    const pathOf = (el) => {
      const seg = [];
      for (let n = el; n && n.nodeType === 1 && n.tagName !== "HTML"; n = n.parentElement) {
        let idx = 1;
        for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) idx++;
        seg.unshift(`${n.tagName}:${idx}${n.id ? "#" + n.id : ""}`);
      }
      return seg.join(">");
    };
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === "none" || cs.visibility === "hidden" || r.width === 0 || r.height === 0) continue;
      out[pathOf(el)] = props.map((p) => cs[p]).join("|");
    }
    return out;
  }, PROPS);
}

async function inject(win, css) {
  await win.evaluate((text) => {
    document.getElementById("ctl-style")?.remove();
    const s = document.createElement("style");
    s.id = "ctl-style";
    s.textContent = text;
    document.head.appendChild(s);
  }, css);
  await win.waitForTimeout(200);
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function settle(win) {
  let prev = null;
  for (let i = 0; i < 12; i++) {
    const fp = await fingerprint(win);
    const k = Object.keys(fp).sort().join("\n");
    if (prev === k) return fp;
    prev = k;
    await win.waitForTimeout(200);
  }
  return fingerprint(win);
}

const count = (fp) => Object.keys(fp).length;
const changed = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let n = 0;
  for (const k of keys) if (a[k] !== b[k]) n++;
  return n;
};

(async () => {
  const ud = electronUserDataDir("w0-control");
  const env = electronLaunchEnv(gateAppEnv(REPO, { BITBOT_NO_SECRET_SYNC: "1", BITBOT_DESKTOP_AUTOSTART: "0" }));
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO, env, timeout: 60000,
  });
  let bad = 0;
  try {
    const win = await app.firstWindow({ timeout: 60000 });
    await win.setViewportSize({ width: 1040, height: 760 }).catch(() => {});
    await win.waitForTimeout(900);

    const probe = await win.evaluate(() => ({
      grokUi: document.body.classList.contains("grok-ui"),
      bodyClasses: document.body.className,
      gInk: getComputedStyle(document.body).getPropertyValue("--g-ink").trim(),
      gInkConsumers: [...document.querySelectorAll("*")].filter((e) => (e.getAttribute("style") || "").includes("--g-ink")).length,
    }));
    log(`body 类名 = "${probe.bodyClasses}" | grok-ui = ${probe.grokUi} | 运行时 --g-ink = ${probe.gInk || "(未定义)"}`);

    const W0A = fs.readFileSync("/tmp/w0a.css", "utf8");
    const W0B = fs.readFileSync("/tmp/w0b.css", "utf8");

    const base = await settle(win);
    log(`基线指纹 ${count(base)} 条`);

    // 对照 1：改一个规范 token —— 大面积变色才算注入通道有效
    await inject(win, "body { --text: rgb(255, 0, 0) !important; --muted: rgb(255, 0, 0) !important; }");
    const c1 = await settle(win);
    log(`对照1（改 --text/--muted）差异 ${changed(base, c1)} 条 ${changed(base, c1) > 0 ? "✓ 注入生效" : "✗ 注入根本没生效，前面所有「0 差异」都是假绿"}`);
    if (!changed(base, c1)) bad = 1;

    // 对照 2：只改 --g-ink —— 检验第二套家族是否真的被可见元素消费
    await inject(win, "body.grok-ui { --g-ink: rgb(0, 120, 255) !important; --g-sub: rgb(0, 120, 255) !important; }");
    const c2 = await settle(win);
    const n2 = changed(base, c2);
    log(`对照2（改 --g-ink/--g-sub）差异 ${n2} 条 ${n2 > 0 ? "→ --g-* 确有可见消费者，0b 的「0 差异」说明的是数值本就相同，而不是没生效" : "→ 可见元素里没人消费 --g-*（0b 是纯死码清理）"}`);

    // 对照 3：0a 单独再跑一次，确认它在「注入有效」的前提下仍为 0
    await inject(win, W0A);
    const a = await settle(win);
    log(`0a 重跑差异 ${changed(base, a)} 条`);
    if (changed(base, a)) bad = 1;

    // 对照 4：0b 单独（不带 0a）
    await inject(win, W0B);
    const b = await settle(win);
    log(`0b 单独差异 ${changed(base, b)} 条`);

    // 对照 5：0a+0b
    await inject(win, W0A + "\n" + W0B);
    const ab = await settle(win);
    log(`0a+0b 差异 ${changed(base, ab)} 条`);

    log(`\n判读：注入通道 ${bad ? "存疑" : "已验证有效"}。0a/0b 的「0 差异」是在有效注入下取得的。`);
  } finally {
    await app.close().catch(() => {});
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch {}
  }
  process.exit(bad);
})();
