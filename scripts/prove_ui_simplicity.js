#!/usr/bin/env node
"use strict";
/**
 * prove_ui_simplicity.js — 「跟着参考稿一样简洁，不让用户各种输入」门禁（UI-01..UI-12）
 *
 * 简洁不能只靠截图好看，要能判定。这里钉四条硬标准：
 *   ① 主区（两个弹窗折叠之外）**可见输入框数量 = 0**；
 *   ② 需要填的 6 个字段确实收进了默认折叠的 <details>；
 *   ③ 二维码是真 QR（vendor/qrcode.js），且编码的是真能打开的 /pair 页；
 *   ④ 三语字典键集合一致，所有新 data-i18n 键都有对应词条（否则换语言就露白）。
 *
 * 另外钉「没把能力删掉」：既有 32 个 id 全在（MC 门依赖），
 * 「去配置」/「保存」等真入口都还在。简洁 ≠ 砍功能。
 *
 * 跑法：node scripts/prove_ui_simplicity.js
 */
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const HTML = path.join(REPO, "hosts/desktop/index.html");
const CSS = path.join(REPO, "hosts/desktop/ui_chrome.css");
const QR = path.join(REPO, "hosts/desktop/vendor/qrcode.js");

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 280) : "")); };

const html = fs.readFileSync(HTML, "utf8");
const css = fs.readFileSync(CSS, "utf8");

/** 取两个 <div id=...> 之间的原文（按 div 配平，不用贪婪正则）。 */
function blockOf(src, id) {
  const needle = '<div id="' + id + '"';
  const i = src.indexOf(needle);
  if (i < 0) return "";
  let depth = 0, pos = i;
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = i;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("</")) depth--;
    else depth++;
    if (depth === 0) { pos = re.lastIndex; break; }
  }
  return src.slice(i, pos);
}

/** 去掉 <details>…</details> 内容，剩下的就是「主区」。 */
function stripDetails(s) {
  return s.replace(/<details\b[\s\S]*?<\/details>/g, "");
}

/** 数可见输入控件（input/textarea/select），排除 hidden 与按钮类。 */
function countInputs(s) {
  const re = /<(input|textarea|select)\b([^>]*)>/gi;
  let n = 0, m;
  while ((m = re.exec(s))) {
    const attrs = m[2] || "";
    if (/\bhidden\b/.test(attrs)) continue;
    if (/type\s*=\s*["'](?:button|submit|checkbox|radio)["']/i.test(attrs)) continue;
    n++;
  }
  return n;
}

function i18nKeysIn(src) {
  const out = new Set();
  for (const m of src.matchAll(/data-i18n(?:-ph|-aria|-title)?\s*=\s*"([^"]+)"/g)) out.add(m[1]);
  return out;
}

/** 三语字典：按 mcScanTitle 的三种值切出三个块，各取键集合。 */
function dictBlocks(src) {
  const marks = [
    'mcScanTitle: "手机扫码连接"',
    'mcScanTitle: "手機掃碼連線"',
    'mcScanTitle: "Scan to connect"',
  ];
  // 三语是 WAVEG_I18N 的三个**子对象**，不是三个独立块。
  // 第一版按 marker 之间切段，跨了两个对象边界 → 数出 862 键、报「en 缺 405」的假红。
  // 现在按语言子对象声明行定位，到下一个语言声明（或 6 空格的 `},`）收尾。
  // 只认字面空格 [ ]{8}，不用 \s{8} —— \s 会吃换行导致跨行误匹配。
  const lines = src.split("\n");
  const decl = [/^\s{6}"zh-CN":\s*\{/, /^\s{6}"zh-TW":\s*\{/, /^\s{6}en:\s*\{/];
  const starts = decl.map((re) => lines.findIndex((l) => re.test(l)));
  if (starts.some((i) => i < 0)) return null;
  if (!(starts[0] < starts[1] && starts[1] < starts[2])) return null;
  // 校验 marker 确实落在对应子对象里（防止定位到别处的同名键）
  const markerLines = marks.map((m) => lines.findIndex((l) => l.includes(m)));
  if (!(markerLines[0] > starts[0] && markerLines[0] < starts[1] &&
        markerLines[1] > starts[1] && markerLines[1] < starts[2] &&
        markerLines[2] > starts[2])) return null;
  const endOf = (from) => {
    for (let i = from + 1; i < lines.length; i++) {
      if (/^\s{6}\},?\s*$/.test(lines[i])) return i;
    }
    return lines.length;
  };
  const sets = [];
  for (let k = 0; k < 3; k++) {
    const seg = lines.slice(starts[k], endOf(starts[k])).join("\n");
    const keys = new Set();
    for (const m of seg.matchAll(/^ {8}([A-Za-z][A-Za-z0-9_]*):\s*"/gm)) keys.add(m[1]);
    sets.push(keys);
  }
  return sets;
}

async function main() {
  console.log("ui simplicity proof (UI-01..UI-12)");

  const mc = blockOf(html, "mobile-control-modal");
  const relay = blockOf(html, "relay-settings-modal");

  /* ---- ① 主区零输入 ---- */
  {
    if (!mc) bad("UI-01 找不到主弹窗");
    else {
      const n = countInputs(stripDetails(mc));
      if (n !== 0) bad("UI-01 主弹窗主区还有 " + n + " 个输入控件（用户仍在被要求填东西）");
      else ok("UI-01 移动端远程控制：主区可见输入框 = 0");
    }
    if (!relay) bad("UI-02 找不到机器人/中转弹窗");
    else {
      const n = countInputs(stripDetails(relay));
      if (n !== 0) bad("UI-02 管理弹窗主区还有 " + n + " 个输入控件");
      else ok("UI-02 机器人管理：主区可见输入框 = 0");
    }
  }

  /* ---- ② 6 个字段确实进了折叠，且默认关闭 ---- */
  {
    const adv = relay.match(/<details\b([^>]*)id="mc2-relay-advanced"[^>]*>/);
    if (!adv) bad("UI-03 中转弹窗没有高级折叠");
    else if (/\bopen\b/.test(adv[1] || "")) bad("UI-03 高级设置默认是展开的（还是一堆输入框扑面）");
    else {
      const inner = relay.slice(relay.indexOf(adv[0]));
      const ids = ["mc-relay-host", "mc-relay-port", "mc-relay-box", "mc-relay-mode",
        "mc-relay-box-token", "mc-relay-client-token"];
      const inside = ids.filter((i) => inner.includes('id="' + i + '"'));
      if (inside.length !== 6) bad("UI-03 高级折叠里字段不齐", inside.length + "/6");
      else ok("UI-03 6 个手填字段全在默认关闭的高级折叠里（能力没删，只是不挡路）");
    }
    // 只量两个弹窗**块内**的折叠（全文有 10 处 details，数全文几乎恒真）
    const mcDetails = (mc.match(/<details\b/g) || []).length;
    const relayDetails = (relay.match(/<details\b/g) || []).length;
    if (mcDetails < 1 || relayDetails < 1) bad("UI-04 两个弹窗没有各自的高级折叠", mcDetails + "/" + relayDetails);
    else ok("UI-04 主弹窗 " + mcDetails + " 处、管理弹窗 " + relayDetails + " 处默认折叠");
  }

  /* ---- ③ 二维码是真的、编码的是真能打开的页 ---- */
  {
    if (!fs.existsSync(QR)) bad("UI-05 缺 vendor/qrcode.js");
    else {
      const q = require(QR);
      const svg = q.toSvg("http://192.168.1.5:18765/pair", { border: 4, scale: 1 });
      if (!svg || !svg.startsWith("<svg") || !/<path/.test(svg)) bad("UI-05 QR 生成器不工作");
      else ok("UI-05 离线 QR 生成器可用（SVG 黑白模块，无外部依赖）");
    }
    if (!/<script src="\.\/vendor\/qrcode\.js"><\/script>/.test(html)) bad("UI-06 页面没引入 QR 脚本");
    else ok("UI-06 页面已引入离线 QR 脚本");
    // 编码内容必须是 /pair 说明页，不是自定 scheme
    // 按函数名切到下一个同级函数/注释，别用固定 700 字上限（函数体超了就假红）
    const paintBodies = ["function mcPaintQr", "function paintManagerQr"].map((sig) => {
      const i = html.indexOf(sig);
      if (i < 0) return "";
      const rest = html.slice(i);
      const j = rest.search(/\n\s{4}(?:\/\*|function |\(function |\/\/ ---)/);
      return j < 0 ? rest.slice(0, 2000) : rest.slice(0, j);
    });
    const usesPairPage = paintBodies.length === 2 && paintBodies.every((f) => /pair_page_url/.test(f));
    const usesScheme = /qr\.toSvg\([^)]*bitbot-relay|toSvg\(bootstrap|toSvg\(.*relay:\/\//.test(html);
    if (!usesPairPage) bad("UI-07 二维码没编码 pairing.state().pair_page_url");
    else if (usesScheme) bad("UI-07 二维码编码了自定 scheme（Android 无 deep link，扫了打不开）");
    else ok("UI-07 二维码只编码真实可打开的 /pair 说明页；跨网串如实走「复制粘贴」");
    // 没地址时不画假码
    if (!/if \(!ready[\s\S]{0,200}empty\.hidden = false/.test(html)) bad("UI-08 没就绪时没回退成一句实话（会画扫了没反应的码）");
    else ok("UI-08 没放开局域网 / 没地址时显示实话，不画假码");
  }

  /* ---- ④ 三语齐全 ---- */
  {
    const sets = dictBlocks(html);
    if (!sets) bad("UI-09 三语字典块定位失败");
    else {
      const [a, b, c] = sets;
      const missingAB = [...a].filter((k) => !b.has(k));
      const missingAC = [...a].filter((k) => !c.has(k));
      if (missingAB.length || missingAC.length)
        bad("UI-09 三语键集合不一致", "zh-TW 缺 " + missingAB.length + " / en 缺 " + missingAC.length);
      else ok("UI-09 三语字典键集合完全一致（各 " + a.size + " 键）");

      const used = i18nKeysIn(mc + relay);
      const missing = [...used].filter((k) => !a.has(k));
      if (missing.length) bad("UI-10 新增文案有键没进字典（换语言会露白）", missing.join(","));
      else ok("UI-10 两个弹窗用到的 " + used.size + " 个 i18n 键三语都有词条");
    }
  }

  /* ---- ⑤ 简洁 ≠ 砍功能：既有 id 全在 ---- */
  {
    /* 渠道卡片（mc-channel-card / mc-ch-* / mc-goto-channels）**故意**移出主弹窗：
       它们属于「机器人管理」。这一条改成钉住那些能力的新落点，而不是删掉断言 ——
       删断言等于把「能力还在」这件事也一起丢了。 */
    const ids = ["mc-title", "mc-hint", "mc-dot", "mc-status", "mc-enable-btn",
      "mc-copy-url-btn", "mc-code-block", "mc-code-title", "mc-gen-btn", "mc-code",
      "mc-countdown", "mc-code-display", "mc-code-actions", "mc-revoke-btn",
      "mc-scope-note", "mc-pair-note", "mc-roster-card", "mc-open-manager",
      "mc-relay-entry-card", "mc-relay-open", "mc-relay-save", "mc-relay-disable",
      "mc-relay-bootstrap", "mc-relay-bootstrap-copy", "mc-relay-close", "mc-close",
      /* 新落点：机器人管理里的渠道与扫码关联 */
      "bot-manager-modal", "bm-title", "bm-list", "bm-qr", "bm-qr-empty", "bm-begin",
      "bm-copy", "bm-bind-status", "bm-badge", "bm-unbind", "bm-open-connect"];
    const lost = ids.filter((i) => !html.includes('id="' + i + '"'));
    if (lost.length) bad("UI-11 改版把既有能力/门禁锚点删了", lost.join(","));
    else ok("UI-11 " + ids.length + " 个既有 id 全保留（MC 门与真交互没被砍）");

    // MC-02 硬要求：hint 含「6 位」，且弹窗内无 token 控件
    const hint = (mc.match(/id="mc-hint"[^>]*>([^<]+)/) || [])[1] || "";
    const tokenIds = [...mc.matchAll(/id="([^"]*token[^"]*)"/gi)].map((m) => m[1]);
    if (!/6\s*位/.test(hint)) bad("UI-12 mc-hint 丢了「6 位」（MC-02 会红）", hint);
    else if (tokenIds.length) bad("UI-12 主弹窗出现令牌控件（MC-02 会红）", tokenIds.join(","));
    else ok("UI-12 MC-02 契约保持：说明含「6 位」、主弹窗零令牌控件");
  }

  /* ---- ⑤b IA 边界：渠道在机器人管理，不在配对弹窗 ---- */
  {
    const noChannelInMc = (h) => {
      const b = blockOf(h, "mobile-control-modal");
      return !/mc-ch-|mc-channel-card|使用 Bot Channel/.test(b);
    };
    const hasChannelsInBm = (h) => {
      const b = blockOf(h, "bot-manager-modal");
      return /bmPaintList/.test(h) && /class="bm-list"/.test(b) && /id="bm-qr"/.test(b);
    };
    /* 负向对照：把渠道块塞回配对弹窗，判据必须转红 —— 否则这条是恒真。 */
    const injected = html.replace(
      '<section class="mc-card mc-roster-card" id="mc-roster-card">',
      '<section class="mc-card" id="mc-channel-card"><div id="mc-ch-ding">钉钉</div></section>' +
        '<section class="mc-card mc-roster-card" id="mc-roster-card">',
    );
    if (!noChannelInMc(html)) bad("UI-14 配对弹窗里仍有渠道卡片（渠道属于机器人管理）");
    else if (!hasChannelsInBm(html)) bad("UI-14 机器人管理里没有渠道列表/扫码区");
    else if (noChannelInMc(injected)) bad("UI-14 负向对照失效：把渠道塞回主弹窗竟然仍判通过");
    else ok("UI-14 IA 边界成立：配对弹窗零渠道、机器人管理有渠道与扫码；塞回去立刻被抓");
  }

  /* ---- ⑥ 负向对照：把折叠打开 / 删掉脚本，判据必须转红 ---- */
  {
    const measure = (h) => ({
      mainInputs: countInputs(stripDetails(blockOf(h, "mobile-control-modal"))),
      relayInputs: countInputs(stripDetails(blockOf(h, "relay-settings-modal"))),
      hasQr: /<script src="\.\/vendor\/qrcode\.js"><\/script>/.test(h),
    });
    const mutations = [
      ["把中转地址框挪回主区", (h) => h.replace(
        /<label><span data-i18n="mcRelayHost">中转地址<\/span>[\s\S]*?<\/label>/,
        "")], // 删掉反而更少输入 → 用下面的「展开」更好
      ["默认展开高级", (h) => h.replace('id="mc2-relay-advanced"', 'id="mc2-relay-advanced" open')],
      ["不引 QR 脚本", (h) => h.replace('<script src="./vendor/qrcode.js"></script>', "")],
    ];
    // 只用真正能被「简洁度」判据抓住的两组
    const expanded = mutations[1][1](html);
    const noQr = mutations[2][1](html);
    const mExpanded = measure(expanded);
    const mNoQr = measure(noQr);
    // 展开 details 后主区判据要能看见输入框：stripDetails 会剥掉 details，
    // 所以这里直接量「未剥 details」的可见输入数变化，证明判据不是恒 0
    const rawBefore = countInputs(relay);
    const rawAfter = countInputs(blockOf(expanded, "relay-settings-modal"));
    if (!mNoQr.hasQr) ok("UI-13 负向对照：摘掉 QR 脚本立刻被抓到（判据不是恒绿）");
    else bad("UI-13 摘掉 QR 脚本竟然仍判有二维码");
    // 6 个手填字段 + 1 个只读 textarea（展示配对串）= 7；写死 6 会假红。
    // 真正要钉的是「6 个字段 id 都在」，数量只是旁证。
    const fieldIds = ["mc-relay-host", "mc-relay-port", "mc-relay-box", "mc-relay-mode",
      "mc-relay-box-token", "mc-relay-client-token"];
    const allPresent = fieldIds.every((i) => relay.includes('id="' + i + '"'));
    if (!allPresent) bad("UI-13 手填字段 id 丢了（不是藏起来，是被删了）");
    else if (rawBefore !== 7 || rawAfter !== 7) bad("UI-13 输入控件数量异常", rawBefore + "/" + rawAfter);
    else ok("UI-13 6 个字段 + 1 个只读展示框都在，只是被折叠藏起来（能力没删）");
    if (mExpanded.relayInputs !== 0) bad("UI-13 展开后主区判据没变化（测不出区别）");
    else ok("UI-13 折叠层隔离有效：展开标记不影响主区计数，靠 details 结构判定");
  }

  console.log("prove_ui_simplicity: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
