#!/usr/bin/env node
"use strict";

/**
 * prove_settings_credentials_zones — GP-185「设置 → 凭证」按必填/选填分区重排
 *
 * 为什么要有这把尺子：这一屏的门禁以前只断「某个 id 在不在」，从不断「它在第几层、
 * 折叠起来没有」。结果是布局可以烂到 6 张等大卡 + 4 颗粒色相同按钮，仍然全绿。
 * 本门把重排后的形状钉成契约，并且把真机门（Playwright）依赖的可见性底线钉住 ——
 * 否则下一次"再精简一点"会把 #sec-llm-key 收进折叠里，真机门当场红。
 *
 * 每条断言写成纯函数（吃屏文本，吐布尔），CL-10 用同一个函数跑真实改坏的文本，
 * 证明它们不是恒真。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : "")); };

console.log("GP-185 settings/credentials zones proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
const css = fs.readFileSync(path.join(REPO, "hosts/desktop/ui_chrome.css"), "utf8");

/* ---------- 解析助手 ---------- */
/* 取「凭证」这一屏：从容器 id 到 GP-92 注释前 */
function panelOf(doc) {
  const a = doc.indexOf('id="secrets-panel"');
  const b = doc.indexOf("<!-- GP-92: fullscreen artifact viewer");
  if (a < 0 || b < 0 || b < a) return "";
  return doc.slice(a, b);
}
/* <details> 的区间（本屏只有一个，写成通用的以防再加） */
function detailsRanges(text) {
  const out = [];
  let depth = 0, start = -1;
  const re = /<\/?details\b[^>]*>/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[0][1] === "/") {
      if (depth === 1) out.push([start, m.index + m[0].length]);
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      start = m.index;
      depth = 1;
    } else {
      depth += 1;
    }
  }
  return out;
}
/* 返回 true/false（在不在折叠里），id 不存在返回 null */
function insideDetails(text, ranges, id) {
  const i = text.indexOf('id="' + id + '"');
  if (i < 0) return null;
  return ranges.some(([s, e]) => i > s && i < e);
}
/* 折叠外的 input/select/textarea 的 id */
function controlsOutsideDetails(text) {
  const ranges = detailsRanges(text);
  const re = /<(?:input|select|textarea)\b[^>]*>/g;
  const ids = [];
  let m;
  while ((m = re.exec(text))) {
    const idm = /id="([^"]+)"/.exec(m[0]);
    if (!idm) continue;
    if (ranges.some(([s, e]) => m.index > s && m.index < e)) continue;
    ids.push(idm[1]);
  }
  return ids;
}
/* 三本字典的段落：以 tabUpdates: 为分界（zh-CN | zh-TW | en） */
function dictSegments(doc) {
  const at = [...doc.matchAll(/tabUpdates:\s*"/g)].map((m) => m.index);
  if (at.length !== 3) return null;
  return [doc.slice(0, at[0]), doc.slice(at[0], at[1]), doc.slice(at[1])];
}

const ZONES = ["sec-zone-brain", "sec-zone-capability", "sec-zone-devices", "sec-zone-compliance"];
const MAIN = ["sec-llm-preset", "sec-llm-model", "sec-llm-base", "sec-llm-key"];
const EXPECT_OUTSIDE = MAIN.concat([
  "sec-search-provider", "sec-search-key", "sec-search-base", "sec-icp", "sec-algo", "sec-moderation",
]);
const ADV = ["sec-llm-provider", "sec-qwen-key", "sec-moon-key"];
/* 真机门按 visible 点或按盒子高度量的控件：e2e_desktop_llm_key_paste_guard /
   cn_channel_guard / user_journeys / shell_v2 都在这几颗上。 */
const MUST_SEE = ["sec-llm-key", "sec-save", "sec-probe-cn", "sec-model-open", "pairing-gen-btn", "pairing-lan-btn", "pairing-token-btn", "sec-moderation"];
const NEW_KEYS = [
  "credLead", "credZoneBrain", "credTagRequired", "credTagOptional", "credBrainNote",
  "credAdvTitle", "credZoneCapability", "credCapNote", "credZoneDevices", "credInboundLabel",
  "credZoneCompliance", "credApplyLead",
];

/* ---------- 断言：纯函数，正向与反向对照共用 ---------- */
const cl01 = (p) =>
  [...p.matchAll(/<div class="st-card" id="(sec-zone-[a-z]+)"/g)].map((m) => m[1]).join(",") === ZONES.join(",");

const cl01b = (p) => ZONES.every((z) => p.indexOf('id="' + z + '"') >= 0);

const cl02 = (p) => {
  const out = controlsOutsideDetails(p);
  return MAIN.every((id) => out.includes(id)) && EXPECT_OUTSIDE.every((id) => out.includes(id)) && out.length === EXPECT_OUTSIDE.length;
};

const cl03 = (p) => {
  const r = detailsRanges(p);
  return r.length === 1 && ADV.every((id) => insideDetails(p, r, id) === true);
};

const cl04 = (p) => {
  const r = detailsRanges(p);
  return MUST_SEE.every((id) => insideDetails(p, r, id) === false);
};

const cl05 = (p) => {
  const start = p.indexOf('class="st-foot"');
  const end = p.indexOf("sec-gate-out");
  if (start < 0 || end < start) return false;
  const s = p.indexOf('id="sec-status"');
  const b = p.indexOf('id="sec-save"');
  return s > start && s < end && b > start && b < end;
};

const cl05b = (c) => {
  const rule = /body\.grok-ui \.st-foot \{([\s\S]*?)\}/.exec(c);
  return !!rule && /position:\s*sticky/.test(rule[1]) && /bottom:\s*0/.test(rule[1]);
};

const cl06 = (p) => {
  for (const m of p.matchAll(/<(span|div|button|p|label)\b[^>]*data-i18n="([^"]+)"[^>]*>/g)) {
    const tag = m[1];
    const after = p.slice(m.index + m[0].length);
    const closeAt = after.indexOf("</" + tag + ">");
    const inner = closeAt < 0 ? "" : after.slice(0, closeAt);
    if (/<[a-z]/i.test(inner)) return false;
  }
  return true;
};

const cl07 = (doc) => {
  const segs = dictSegments(doc);
  if (!segs) return false;
  return NEW_KEYS.every((k) => segs.every((s) => s.includes(k + ":")));
};

const cl08 = (p) =>
  [...p.matchAll(/style="([^"]*)"/g)]
    .filter((m) => /(font\s*:|font-size|#[0-9a-fA-F]{3,8}|\brgba?\(|\bhsla?\()/.test(m[1]))
    .length === 0;

const cl09 = (p) =>
  /<button[^>]*id="sec-gate"[^>]*data-lab/.test(p) && /<pre[^>]*id="sec-gate-out"[^>]*data-lab/.test(p);

/* CL-11 产品态诊断行必须留空：showSettingsTab 以前无条件往 #settings-meta 写
   「tab=凭证」，那行在用户屏幕左下角看得见（真开机截图抓到的）。 */
const cl11 = (doc) => {
  const fn = /function showSettingsTab\(key\)[\s\S]*?\n    \}/.exec(doc);
  if (!fn) return false;
  const body = fn[0];
  const at = body.indexOf("settings-meta");
  if (at < 0) return false;
  return /devModeOn\(\)/.test(body.slice(at)) && /metaEl\.textContent = "";/.test(body);
};
/* CL-12 折叠要有能看出「可以点」的形状：默认 marker 被抹掉后必须自带指示器 */
const cl12 = (p, c) =>
  /class="st-adv-sum"[^>]*>[\s\S]*?st-adv-mark/.test(p) &&
  /\.st-adv-mark \{/.test(c) &&
  /\[open\] > summary \.st-adv-mark/.test(c);
/* CL-13 「模型与供应商」属于大脑那一步，不能压在折叠下面（会被读成备用渠道的按钮） */
const cl13 = (p) => {
  const btn = p.indexOf('id="sec-model-open"');
  const fold = p.indexOf('<details class="st-adv"');
  return btn >= 0 && fold >= 0 && btn < fold;
};

/* ---------- 正向 ---------- */
const panel = panelOf(html);
if (!panel) {
  bad("取不到凭证屏", 'id="secrets-panel" 或 GP-92 锚没了');
} else {
  if (cl01(panel)) ok("CL-01 恰好 4 张分区卡，顺序 = 大脑 → 能力 → 手机与入站 → 合规");
  else bad("CL-01 分区卡形状漂了", JSON.stringify([...panel.matchAll(/<div class="st-card" id="(sec-zone-[a-z]+)"/g)].map((m) => m[1])));

  if (cl01b(panel)) ok("CL-01b 四个分区 id 都在（真机门与文档按 id 找，不靠标题文本）");
  else bad("CL-01b 缺分区 id", JSON.stringify(ZONES.filter((z) => panel.indexOf('id="' + z + '"') < 0)));

  if (cl02(panel)) ok("CL-02 折叠外输入 = " + EXPECT_OUTSIDE.length + " 个，主流程仍是「接入方式/模型/Base URL/Key」四栏");
  else bad("CL-02 折叠外的栏位变了", JSON.stringify({ got: controlsOutsideDetails(panel), want: EXPECT_OUTSIDE }));

  if (cl03(panel)) ok("CL-03 provider_id 与备用渠道两颗 key 都在 #sec-alt-channels 折叠里（且只有一个折叠，不套娃）");
  else bad("CL-03 该收起来没收，或收出第二层套娃", JSON.stringify({ folds: detailsRanges(panel).length, adv: ADV.map((id) => insideDetails(panel, detailsRanges(panel), id)) }));

  if (cl04(panel)) ok("CL-04 真机门按 visible 点的 " + MUST_SEE.length + " 个控件都在明面上（没被折叠吃掉）");
  else bad("CL-04 有门依赖的控件被收进折叠或消失", JSON.stringify({ gone: MUST_SEE.filter((id) => insideDetails(panel, detailsRanges(panel), id) !== false) }));

  if (cl05(panel)) ok("CL-05 状态行与保存键在同一条里（点完保存，结果就在按钮左边）");
  else bad("CL-05 #sec-status 不在 #sec-foot 里");

  if (cl05b(css)) ok("CL-05b .st-foot 是 sticky 吸底（滚动时保存条不跟着跑掉）");
  else bad("CL-05b .st-foot 没有 sticky", "规则缺失或属性被删");

  if (cl06(panel)) ok("CL-06 带 data-i18n 的标签里没有元素子节点（applier 是 textContent 覆盖，<a>/<code> 会被抹掉）");
  else bad("CL-06 data-i18n 挂在含子节点的标签上", "切语言会吃掉链接/代码");

  if (cl07(html)) ok("CL-07 " + NEW_KEYS.length + " 条新文案在 zh-CN / zh-TW / en 三本字典里都齐");
  else bad("CL-07 有语言缺键", "缺一种就是给繁体门埋简体残留");

  if (cl08(panel)) ok("CL-08 这一屏 0 处行内字面字号/色（原来 6 处，收进 .st-readout / .st-check）");
  else bad("CL-08 又写回行内字面量了", JSON.stringify([...panel.matchAll(/style="([^"]*)"/g)].filter((m) => /(font\s*:|font-size|#[0-9a-fA-F]{3,8})/.test(m[1])).map((m) => m[1].slice(0, 40))));

  if (cl09(panel)) ok("CL-09「跑验收门禁」与它的输出框都带 data-lab（产品态不占按钮位）");
  else bad("CL-09 开发动作在产品态露着");

  if (cl11(html)) ok("CL-11 产品态不往 #settings-meta 写字串（切页签不再把「tab=凭证」印到屏幕上）");
  else bad("CL-11 showSettingsTab 在产品态也写诊断行", "真开机截图左下角会看见 tab=凭证");

  if (cl12(panel, css)) ok("CL-12 折叠自带指示器（默认 marker 抹掉后仍有箭头，且展开时翻转）");
  else bad("CL-12 折叠看不出可以点", "summary 里没有指示器或 CSS 缺规则");

  if (cl13(panel)) ok("CL-13「模型与供应商」在折叠之前（属于大脑那一步，不会被读成备用渠道的按钮）");
  else bad("CL-13 模型入口压回折叠下面");

  /* ---------- CL-10 负向对照：每条都能被一次真实改动打翻 ---------- */
  const NEG = [
    ["CL-01", "把能力卡改名成第五张区", panel.replace('id="sec-zone-capability"', 'id="sec-zone-extra"')],
    ["CL-01b", "删掉合规卡 id", panel.replace('id="sec-zone-compliance"', 'class="gone"')],
    ["CL-02", "把主流程的 API Key 挪进折叠", panel.replace('<label class="st-field"><span class="st-field-name">API Key', '<details id="t10a"><label class="st-field"><span class="st-field-name">API Key').replace('<div id="sec-llm-key-note"', '</details><div id="sec-llm-key-note"')],
    ["CL-03", "把备用渠道摊平（去掉折叠）", panel.replace('<details class="st-adv" id="sec-alt-channels">', '<div class="st-adv" id="sec-alt-channels">').replace('</details>', '</div>')],
    ["CL-04", "把 #sec-save 塞进折叠", panel.replace('<details class="st-adv" id="sec-alt-channels">', '<details open class="st-adv" id="sec-alt-channels"><button id="sec-save">')],
    ["CL-05", "状态行搬出保存条", panel.replace('<div id="sec-status" class="st-foot-status">…</div>', '')],
    ["CL-05b", "保存条的 sticky 换成 static", css.replace(/body\.grok-ui \.st-foot \{([\s\S]*?)\}/, (m0) => m0.replace("position: sticky", "position: static"))],
    ["CL-06", "data-i18n 挂到含 <a> 的说明行", panel.replace('<div class="st-note"><span data-i18n="credApplyLead">申请 DeepSeek</span>：', '<div class="st-note" data-i18n="credApplyLead">：')],
    ["CL-07", "繁体字典删掉分区标题", html.replace('credZoneBrain: "本機大腦",', '')],
    ["CL-08", "给入站地址写回行内字体", panel.replace('<div id="sec-inbound-url" class="st-readout">', '<div id="sec-inbound-url" class="st-readout" style="font:12px/1.5 ui-monospace,monospace">')],
    ["CL-09", "验收门禁按钮去掉 data-lab", panel.replace('<button type="button" id="sec-gate" class="bb-btn bb-btn-sm" data-lab>', '<button type="button" id="sec-gate" class="bb-btn bb-btn-sm">')],
    ["CL-11", "切页签时无条件写诊断行（回到改动前）", html.replace('if (metaEl && typeof devModeOn === "function" && devModeOn()) {', "if (metaEl) {")],
    ["CL-12", "抹掉折叠指示器", panel.replace('<span class="st-adv-mark" aria-hidden="true"></span>', "")],
    ["CL-13", "把模型入口挪回折叠后面", panel.replace(/<div class="gp-row" style="margin-top:10px">\s*<button type="button" class="bb-btn bb-btn-sm" id="sec-model-open"[\s\S]*?<\/div>\s*(<!-- provider_id)/, "$1").replace("</details>", '</details><div class="gp-row"><button type="button" id="sec-model-open">模型与供应商</button></div>')],
  ];
  const CHECKS = { "CL-01": cl01, "CL-01b": cl01b, "CL-02": cl02, "CL-03": cl03, "CL-04": cl04, "CL-05": cl05, "CL-05b": cl05b, "CL-06": cl06, "CL-07": cl07, "CL-08": cl08, "CL-09": cl09, "CL-11": cl11, "CL-12": (x) => cl12(x, css), "CL-13": cl13 };
  const red = [];
  for (const [key, what, mutated] of NEG) {
    if (CHECKS[key](mutated)) bad("CL-10 " + key + " 打不红 = 假覆盖", what);
    else red.push(key);
  }
  if (red.length === NEG.length) {
    ok("CL-10 负向对照 " + red.length + "/" + NEG.length + " 条全部翻红（每条断言都能被真实改动打翻）");
  }
  console.log("      · 逐条：" + red.join(" ") + " ✓可翻红");
}

console.log("\nprove_settings_credentials_zones: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
