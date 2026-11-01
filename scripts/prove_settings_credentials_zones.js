#!/usr/bin/env node
"use strict";

/**
 * prove_settings_credentials_zones — GP-185「设置 → 凭证」分区 + GP-189「设置 → 手机」独立页
 *
 * 为什么要有这把尺子：这一屏的门禁以前只断「某个 id 在不在」，从不断「它在第几层、
 * 折叠起来没有」。结果是布局可以烂到 6 张等大卡 + 4 颗粒色相同按钮，仍然全绿。
 * 本门把重排后的形状钉成契约，并且把真机门（Playwright）依赖的可见性底线钉住 ——
 * 否则下一次"再精简一点"会把 #sec-llm-key 收进折叠里，真机门当场红。
 *
 * GP-189 起还管「手机」页：配对以前寄在凭证页最后一张卡里，现在有自己的页签。
 * PH 系列钉三件事：① 配对控件真搬过来了（凭证页里一份都不许剩）；
 * ② 主路（局域网开关 / 配对码）在明面上，抄令牌这种兜底才进折叠；
 * ③ 内核 SettingsTab、host_ffi、渲染器三张路由表说的是同一件事 ——
 *   上一节 §8.50 记录的正是这类跨语言漂移没人管，所以这里当场比。
 *
 * 每条断言写成纯函数（吃屏文本，吐布尔），CL-10/PH-90 用同一个函数跑真实改坏的文本，
 * 证明它们不是恒真。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : "")); };

console.log("GP-185/GP-189 settings credentials+phone zones proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
const css = fs.readFileSync(path.join(REPO, "hosts/desktop/ui_chrome.css"), "utf8");
const kernel = fs.readFileSync(path.join(REPO, "ui_protocol/settings_ui.mbt"), "utf8");
const ffi = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");

/* ---------- 解析助手 ---------- */
/* 取某一屏：从容器 id 到下一个容器的 id（屏与屏之间不重叠，防止「搬过去了但原件没删」） */
function sliceOf(doc, fromNeedle, toNeedle) {
  const a = doc.indexOf(fromNeedle);
  const b = doc.indexOf(toNeedle);
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

const CRED_START = 'id="secrets-panel"';
const PHONE_START = 'id="st-phone"';
const PANEL_END = "<!-- GP-92: fullscreen artifact viewer";

const ZONES = ["sec-zone-brain", "sec-zone-capability", "sec-zone-inbound", "sec-zone-compliance"];
/* 手机页只有两张卡：怎么做（三步）+ 一个诚实的边界说明 */
const PHONE_ZONES = ["sec-zone-devices", "phone-zone-scope"];
const STEPS = ["phone-step-1", "phone-step-2", "phone-step-3"];
const MAIN = ["sec-llm-preset", "sec-llm-model", "sec-llm-base", "sec-llm-key"];
const EXPECT_OUTSIDE = MAIN.concat([
  "sec-search-provider", "sec-search-key", "sec-search-base", "sec-icp", "sec-algo", "sec-moderation",
]);
const ADV = ["sec-llm-provider", "sec-qwen-key", "sec-moon-key"];
/* 真机门按 visible 点或按盒子高度量的控件：e2e_desktop_llm_key_paste_guard /
   cn_channel_guard / user_journeys / shell_v2 都在这几颗上。GP-189 起配对三颗
   移交手机页，由 PH-03 用同一套「明面」标准盯。 */
const MUST_SEE = ["sec-llm-key", "sec-save", "sec-probe-cn", "sec-model-open", "sec-moderation"];
const PAIR_MAIN = ["pairing-lan-btn", "pairing-copy-url", "pairing-gen-btn", "pairing-revoke-btn", "sec-pairing-line", "sec-pairing-note"];
const PAIR_MANUAL = ["pairing-token-btn", "pairing-copy-token", "sec-pairing-token", "sec-pairing-status", "sec-pairing-turn"];
/* 这些 id 只许在手机页出现一次：搬完必须把原件删掉，否则「保存」写哪一份没人说得清 */
const MOVED_OUT_OF_CRED = PAIR_MAIN.concat(PAIR_MANUAL).concat([
  "pairing-code-block", "pairing-code-display", "pairing-code-digits", "pairing-code-countdown",
  "pairing-code-actions", "pairing-code-hint", "pairing-manual-label", "sec-zone-devices",
]);
const NEW_KEYS = [
  "credLead", "credZoneBrain", "credTagRequired", "credTagOptional", "credBrainNote",
  "credAdvTitle", "credZoneCapability", "credCapNote", "credZoneDevices", "credInboundLabel",
  "credZoneCompliance", "credApplyLead",
  /* GP-189 手机页 */
  "credZoneInbound", "tabPhone", "phoneTitle", "phoneLead", "phoneTagMust",
  "phoneStepName1", "phoneStepDesc1", "phoneStepName2", "phoneStepDesc2",
  "phoneStepName3", "phoneStepDesc3", "phoneAdvTitle", "phoneZoneScope",
  "phoneScopeYes", "phoneScopeSame", "phoneScopeWarn1", "phoneScopeOther",
  "phoneScopeWarn2", "phoneScopePublic",
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

/* ---------- GP-189 手机页断言（同样是纯函数，正向与反向对照共用） ---------- */
const ph01 = (p) =>
  [...p.matchAll(/<div class="st-card" id="((?:sec-zone|phone-zone)-[a-z]+)"/g)].map((m) => m[1]).join(",") === PHONE_ZONES.join(",") &&
  p.indexOf('id="st-phone"') === 0;

const ph02 = (p) => {
  const pos = STEPS.map((id) => p.indexOf('id="' + id + '"'));
  if (pos.some((i) => i < 0)) return false;
  for (let i = 1; i < pos.length; i++) if (pos[i] <= pos[i - 1]) return false;
  return STEPS.every((id) => new RegExp('id="' + id + '"[^>]*>\\s*<span class="st-step-no" aria-hidden="true">' + id.slice(-1)).test(p));
};

const ph03 = (p) => {
  const r = detailsRanges(p);
  return PAIR_MAIN.every((id) => insideDetails(p, r, id) === false) && PAIR_MANUAL.every((id) => insideDetails(p, r, id) === true);
};

/* 搬走的 id 在凭证屏里一份都不许留（两份同时存在时，JS 按 getElementById 拿第一份，
   用户看到的和保存的是不同的东西 —— 这是上一节 §8.50 说的「门问 id 在不在」问不出来的） */
const ph04 = (cred, phone) =>
  MOVED_OUT_OF_CRED.every((id) => cred.indexOf('id="' + id + '"') < 0) &&
  MOVED_OUT_OF_CRED.every((id) => phone.indexOf('id="' + id + '"') >= 0);

const ph05 = (p) => {
  const scope = /id="phone-zone-scope"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(p);
  const seg = scope ? scope[0] : p.slice(p.indexOf('id="phone-zone-scope"'));
  return ["phoneScopeYes", "phoneScopeWarn1", "phoneScopeWarn2"].every((k) => seg.indexOf('data-i18n="' + k + '"') >= 0) &&
    ["phoneScopeSame", "phoneScopeOther", "phoneScopePublic"].every((k) => seg.indexOf('data-i18n="' + k + '"') >= 0);
};

/* 三张路由表必须说同一件事：内核有第 6 个页签 + pairing 归它，Host FFI 认这个锚点，
   渲染器把 pairing 落到 phone 页、并且切到 phone 页才刷配对状态 */
const ph06 = (doc, ker, hostFfi) => {
  const keys = /const SETTINGS_TAB_KEYS = \[([^\]]*)\]/.exec(doc);
  if (!keys) return false;
  const list = keys[1].split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  /* 刷新要跟界面走：切到凭证页还在刷配对状态，说明代码没跟着搬家，手机页会显示上一站的旧值 */
  const credBlock = /if \(key === "credentials"\) \{([\s\S]*?)\n      \}/.exec(doc);
  return list.join(",") === "general,computer,credentials,phone,usage,updates" &&
    /"pairing":\s*"phone"/.test(doc) &&
    /if \(key === "phone"\) refreshPairingStrip\(\)/.test(doc) &&
    !!credBlock && !/refreshPairingStrip/.test(credBlock[1]) &&
    /enum SettingsTab \{[^}]*Vault\s+Phone\s+UsageBilling/.test(ker) &&
    /Pairing => Phone/.test(ker) &&
    /Pairing => "pairing"/.test(ker) &&
    /pairing: "Phone"/.test(hostFfi);
};

/* 页签条的按钮顺序 = 用户看到的顺序（渲染器数组对了但按钮没多一个，等于没有这页） */
const ph07 = (doc) => {
  const bar = /<div id="settings-tabs">([\s\S]*?)<\/div>/.exec(doc);
  if (!bar) return false;
  const tabs = [...bar[1].matchAll(/data-stab="([a-z]+)"/g)].map((m) => m[1]);
  return tabs.join(",") === "general,computer,credentials,phone,usage,updates";
};

/* 账户弹层「手机」这一项要走内核深链落到手机页，不能再假装落到凭证页找卡 */
const ph08 = (doc) => {
  const at = doc.indexOf('getElementById("ap-mobile")');
  if (at < 0) return false;
  const seg = doc.slice(at, at + 1200);
  return /anchor=pairing/.test(seg) && !/anchor=security-keys/.test(seg) && /设置 → 手机/.test(seg);
};

/* 手机页要有一条真的会随网络形态变红的说明区（不是把提示写死成「同一 Wi-Fi 即可」）：
   界面里必须同时存在「私有网段可用」和「非私有 / 跨网段」两类说法 */
const ph09 = (p) =>
  /同一 Wi-Fi/.test(p) && /公网|跨网段/.test(p) && /没有内置内网穿透|内网穿透/.test(p);

/* ---------- 正向 ---------- */
const panel = sliceOf(html, CRED_START, PHONE_START);
const phone = sliceOf(html, PHONE_START, PANEL_END);
if (!panel || !phone) {
  bad("取不到凭证屏或手机屏", JSON.stringify({ cred: !!panel, phone: !!phone }));
} else {
  if (cl01(panel)) ok("CL-01 恰好 4 张分区卡，顺序 = 大脑 → 能力 → 入站 → 合规");
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

  /* ---------- GP-189：手机页 ---------- */
  if (ph01(phone)) ok("PH-01 手机屏恰好 " + PHONE_ZONES.length + " 张卡，顺序 = 三步配对 → 局域网边界");
  else bad("PH-01 手机屏形状漂了", JSON.stringify([...phone.matchAll(/<div class="st-card" id="((?:sec-zone|phone-zone)-[a-z]+)"/g)].map((m) => m[1])));

  if (ph02(phone)) ok("PH-02 三步按 1 → 2 → 3 排在界面上（序号就是「先做哪个」的答案）");
  else bad("PH-02 步骤顺序或序号对不上", JSON.stringify(STEPS.map((id) => phone.indexOf('id="' + id + '"'))));

  if (ph03(phone)) ok("PH-03 主路 " + PAIR_MAIN.length + " 颗在明面上、兜底 " + PAIR_MANUAL.length + " 颗进折叠（抄令牌不再是第一步）");
  else bad("PH-03 配对控件的层次错了", JSON.stringify({ main: PAIR_MAIN.map((id) => insideDetails(phone, detailsRanges(phone), id)), manual: PAIR_MANUAL.map((id) => insideDetails(phone, detailsRanges(phone), id)) }));

  if (ph04(panel, phone)) ok("PH-04 配对 " + MOVED_OUT_OF_CRED.length + " 个 id 只在手机页有一份（凭证页里一份都不剩）");
  else bad("PH-04 搬完没删原件，或手机页缺件", JSON.stringify({ still_in_cred: MOVED_OUT_OF_CRED.filter((id) => panel.indexOf('id="' + id + '"') >= 0), missing_in_phone: MOVED_OUT_OF_CRED.filter((id) => phone.indexOf('id="' + id + '"') < 0) }));

  if (ph05(phone)) ok("PH-05 边界说明有 3 行（能用 / 看网络 / 本版不支持），每行都走字典");
  else bad("PH-05 局域网边界说明缺行或缺 data-i18n");

  if (ph06(html, kernel, ffi)) ok("PH-06 内核 / Host FFI / 渲染器三张路由表都认 phone 页与 pairing 锚点");
  else bad("PH-06 三张路由表不一致", "第 6 个页签只在一处存在 = 深链会落回常规页");

  if (ph07(html)) ok("PH-07 页签条真有 6 个按钮，顺序 = 通用 → 电脑 → 凭证 → 手机 → 用量与账单 → 更新");
  else {
    const bar = /<div id="settings-tabs">([\s\S]*?)<\/div>/.exec(html);
    bad("PH-07 页签条形状不对", JSON.stringify(bar ? [...bar[1].matchAll(/data-stab="([a-z]+)"/g)].map((m) => m[1]) : null));
  }

  if (ph08(html)) ok("PH-08 账户弹层「手机」走内核深链 anchor=pairing，落点是「设置 → 手机」");
  else bad("PH-08 移动版入口还落在凭证页", "文案和落点不一致 = 用户按提示找不到东西");

  if (ph09(phone)) ok("PH-09 界面里同时写明「同一 Wi-Fi 可用」和「公网/跨网段没有内置穿透」（不是一句「连同一 Wi-Fi」糊过去）");
  else bad("PH-09 边界说明退化成一句口号");

  if (cl08(phone)) ok("PH-10 手机屏 0 处行内字面字号/色（新加的每一步都走 .st-step / .st-readout）");
  else bad("PH-10 手机屏又写回行内字面量了", JSON.stringify([...phone.matchAll(/style="([^"]*)"/g)].filter((m) => /(font\s*:|font-size|#[0-9a-fA-F]{3,8})/.test(m[1])).map((m) => m[1].slice(0, 40))));

  /* ---------- 负向对照：每条都能被一次真实改动打翻（CL 与 PH 同一张表） ---------- */
  const NEG = [
    ["CL-01", "把能力卡改名成第五张区", cl01, panel.replace('id="sec-zone-capability"', 'id="sec-zone-extra"')],
    ["CL-01b", "删掉合规卡 id", cl01b, panel.replace('id="sec-zone-compliance"', 'class="gone"')],
    ["CL-02", "把主流程的 API Key 挪进折叠", cl02, panel.replace('<label class="st-field"><span class="st-field-name">API Key', '<details id="t10a"><label class="st-field"><span class="st-field-name">API Key').replace('<div id="sec-llm-key-note"', '</details><div id="sec-llm-key-note"')],
    ["CL-03", "把备用渠道摊平（去掉折叠）", cl03, panel.replace('<details class="st-adv" id="sec-alt-channels">', '<div class="st-adv" id="sec-alt-channels">').replace('</details>', '</div>')],
    ["CL-04", "把 #sec-save 塞进折叠", cl04, panel.replace('<details class="st-adv" id="sec-alt-channels">', '<details open class="st-adv" id="sec-alt-channels"><button id="sec-save">')],
    ["CL-05", "状态行搬出保存条", cl05, panel.replace('<div id="sec-status" class="st-foot-status">…</div>', '')],
    ["CL-05b", "保存条的 sticky 换成 static", cl05b, css.replace(/body\.grok-ui \.st-foot \{([\s\S]*?)\}/, (m0) => m0.replace("position: sticky", "position: static"))],
    ["CL-06", "data-i18n 挂到含 <a> 的说明行", cl06, panel.replace('<div class="st-note"><span data-i18n="credApplyLead">申请 DeepSeek</span>：', '<div class="st-note" data-i18n="credApplyLead">：')],
    ["CL-07", "繁体字典删掉分区标题", cl07, html.replace('credZoneBrain: "本機大腦",', '')],
    ["CL-08", "给入站地址写回行内字体", cl08, panel.replace('<div id="sec-inbound-url" class="st-readout">', '<div id="sec-inbound-url" class="st-readout" style="font:12px/1.5 ui-monospace,monospace">')],
    ["CL-09", "验收门禁按钮去掉 data-lab", cl09, panel.replace('<button type="button" id="sec-gate" class="bb-btn bb-btn-sm" data-lab>', '<button type="button" id="sec-gate" class="bb-btn bb-btn-sm">')],
    ["CL-11", "切页签时无条件写诊断行（回到改动前）", cl11, html.replace('if (metaEl && typeof devModeOn === "function" && devModeOn()) {', "if (metaEl) {")],
    ["CL-12", "抹掉折叠指示器", (x) => cl12(x, css), panel.replace('<span class="st-adv-mark" aria-hidden="true"></span>', "")],
    ["CL-13", "把模型入口挪回折叠后面", cl13, panel.replace(/<div class="gp-row" style="margin-top:10px">\s*<button type="button" class="bb-btn bb-btn-sm" id="sec-model-open"[\s\S]*?<\/div>\s*(<!-- provider_id)/, "$1").replace("</details>", '</details><div class="gp-row"><button type="button" id="sec-model-open">模型与供应商</button></div>')],
    ["PH-01", "把边界卡改名（手机屏变成一张卡）", ph01, phone.replace('id="phone-zone-scope"', 'id="phone-zone-notes"')],
    ["PH-02", "步骤序号写重（第三步标成 2）", ph02, phone.replace(/(id="phone-step-3"[\s\S]{0,160}?aria-hidden="true">)3/, "$12")],
    ["PH-03", "把兜底摊平到明面（去掉手动折叠）", ph03, phone.replace('<details class="st-adv" id="phone-adv">', '<div class="st-adv" id="phone-adv">').replace("</details>", "</div>")],
    ["PH-04", "搬完没删原件（凭证页留了一份配对状态行）", (x) => ph04(x, phone), panel.replace('<div class="st-card" id="sec-zone-inbound">', '<div id="sec-pairing-line" class="st-readout">旧副本</div>\n        <div class="st-card" id="sec-zone-inbound">')],
    ["PH-05", "删掉「公网/跨网段」那一行的键", (x) => ph05(x), phone.replace('<span class="st-scope-no" data-i18n="phoneScopeWarn2">公网 / 跨网段</span>', "")],
    ["PH-06", "只改渲染器、内核把 pairing 记在 Vault 下", (x) => ph06(html, x, ffi), kernel.replace("Pairing => Phone", "Pairing => Vault")],
    ["PH-07", "页签数组加了但按钮没加（用户看不见这页）", (x) => ph07(x), html.replace('        <button type="button" class="settings-tab-btn" data-stab="phone" data-i18n="tabPhone">手机</button>\n', "")],
    ["PH-08", "移动版入口落点改回 anchor=security-keys", (x) => ph08(x), html.replace('open settings entry=account anchor=pairing', 'open settings entry=account anchor=security-keys')],
    ["PH-09", "边界说明退化成「连同一 Wi-Fi 即可」", (x) => ph09(x), phone.replace('<span class="st-scope-no" data-i18n="phoneScopeWarn2">公网 / 跨网段</span>', '<span class="st-scope-no" data-i18n="phoneScopeWarn2">同一 Wi-Fi</span>').replace(/<span class="st-scope-desc" data-i18n="phoneScopePublic">[\s\S]*?<\/span>/, '<span class="st-scope-desc" data-i18n="phoneScopePublic">连同一 Wi-Fi 即可。</span>')],
    ["PH-10", "给步骤标题写回行内字号", (x) => cl08(x), phone.replace('<div class="st-step-name" data-i18n="phoneStepName1">', '<div class="st-step-name" data-i18n="phoneStepName1" style="font-size:15px">')],
  ];
  const red = [];
  for (const [key, what, fn, mutated] of NEG) {
    if (fn(mutated)) bad("CL-10 " + key + " 打不红 = 假覆盖", what);
    else red.push(key);
  }
  if (red.length === NEG.length) {
    ok("CL-10 负向对照 " + red.length + "/" + NEG.length + " 条全部翻红（每条断言都能被真实改动打翻）");
  }
  console.log("      · 逐条：" + red.join(" ") + " ✓可翻红");
}

console.log("\nprove_settings_credentials_zones: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
