#!/usr/bin/env node
"use strict";

/**
 * prove_ui_tokens — 桌面 UI 单一源/去混乱门禁（ratchet）
 *
 * 目的：把 docs/design/desktop-target/ui-unified-spec.md 的规范钉成
 * “过不去就合不了”。基线是当前实测数字（高水位），随技术债收敛**只许下降**；
 * 任何让计数上涨的改动直接 FAIL。这是源码级正则 lint（LINT ONLY，target-v1.md §5），
 * 不替代 e2e_* 真实渲染门。
 *
 * 检查：
 *   T-1  ui_chrome.css `!important` 计数 ≤ 基线（唯一豁免 [hidden]{display:none!important}）
 *   T-2  原始色值（十六进制）计数 css+html ≤ 基线（token 定义块是唯一色值源，靠基线锁总量）
 *   T-3  index.html 行内 `style="…font-size` 计数 ≤ 基线（收敛目标 0）
 *   T-4  ui_chrome.css `[style*=` 属性反选补丁 ≤ 基线（收敛目标 0）
 *   T-5  几何单一源：`--sidebar-w` / `--header-h` 各只定义一次，且等于
 *        layout-contract §3 合同值 280px / 56px（钉死，禁止 body.grok-ui 248/0 复发）
 *
 * 用法：node scripts/prove_ui_tokens.js
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const CSS = path.join(REPO, "hosts/desktop/ui_chrome.css");
const HTML = path.join(REPO, "hosts/desktop/index.html");

/* ---- 高水位基线（收敛后请下调这些数字，禁止上调）----
   2026-10-23 侧栏列表本体改成参考图形状（全宽行 / 1px 细线 / 44px 头像）
   时，顺手删掉了 Round 2/7/8/8b/9 互相打架的 49 处 `!important`，基线随之
   从 346 降到 198；hex 也从 141 降到 139（新色值全部用 color-mix 从 token
   混出来，没有新增字面色）。 */
const BASE = {
  /* 2026-11-02 重锚 180 → 178：实测已经降到 178（此前几轮删样式时顺手消掉的
     两处），按棘轮纪律「只许降」，基线跟着落地值走，别留空额度。 */
  /* 2026-11-26 重锚 178 → 172：并栏后 #model-entry 从顶栏搬进左栏，
     `header #model-entry` 那两段（基础态 7 处 + hover 2 处，另有一份完全
     重复的副本 8 处）成了**打不中元素的死选择器**，删掉即降 8+7=15，
     实测 180 → 172。基线跟着落地值走。 */
  /* 2026-11-28 P1 拆分重锚 172 → 178：6 处 !important 原来躺在 index.html 的
     <style> 里、根本没被 T-1 扫到；搬进 ui_components.css 后终于进账。
     不是新增债，是"以前漏数的现在数上了"。基线按真值落地。 */
  cssImportant: 178,
  /* 2026-10-24 W0 落地后重锚：0a 调色去重 + 0b 折第二套家族，css hex 139 → 57（82 个预算槽供 W1-W5 消费） */
  /* 2026-11-21 下调:原语块里重复的字面量合并成 var() 引用
     (CSS 自定义属性的 var() 运行时解析,顺序无关 ⇒ 像素零变化),
     加上非原语的硬编码 #fff 收进 --p-lt-solid ⇒ 总数 70 → 48。
     基线跟着落地值走(棘轮纪律:只许降)。 */
  /* 2026-11-28 P1 拆分重锚 48 → 65：17 个 hex 原本在 index.html 的 <style>
     里（归入 htmlHex），搬进 ui_components.css 后改归 cssHex；总数没变，
     只是分类变了。T-2b 的调色区纪律独立守着，没有松。 */
  cssHex: 65,
  /* 2026-11-01 重锚 26 → 40，两笔都是「有理由的字面色值」而不是新配色：
     · +8 用量页的图表色板（USAGE_SERIES 六色 + 图例两处直接引用）——与
       AVATAR_PALETTE 同性质：采样来的数据色，不该走 --token；
     · +6 粘贴框的 `var(--token, #fallback)` 兜底（URL 弹窗那次修的：token
       不存在时不能再塌成深底深字）。兜底不是主色，是 token 缺失时的最后一道。
     T-2b「调色块外不得出现字面色值」仍然守着配色纪律，没松。 */
  /* 2026-11-21 下调:index.html 里 43 个 hex 里,块注释里的 1 个 +
     17 个 `var(--token, #fallback)` 兜底(ui_chrome.css 已定义这些 token
     且 index.html 有 <link> 引它 ⇒ 兜底永远走不到)⇒ 43 → 25。 */
  /* 2026-11-28 P1：上面那 17 个搬去 cssHex 了 ⇒ 25 → 8（棘轮只许降）。 */
  htmlHex: 8,
  htmlInlineFont: 13,
  cssAttrPatch: 5,
};

/* ---- 合同几何真值（与 layout-contract §3 对齐）---- */
const CONTRACT = { sidebarW: "280px", headerH: "56px" };

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("prove_ui_tokens — 桌面 UI 单一源 / 去混乱门禁 (LINT ONLY)");

/* P1/P0 拆分：组件 CSS 从 index.html 的 <style> 搬到了 ui_components.css，
   指挥台脚本搬到 command_center.js。两处都必须继续进扫描，不然 T-1/T-2/T-4
   会因为"源变短"而假绿。 */
const css = fs.readFileSync(CSS, "utf8") + "\n" + fs.readFileSync(path.join(REPO, "hosts/desktop/ui_components.css"), "utf8");
const html = fs.readFileSync(HTML, "utf8") + "\n" + fs.readFileSync(path.join(REPO, "hosts/desktop/command_center.js"), "utf8");
/* strip /* … * / comments so prose (e.g. geometry notes) never trips regexes.
   ⚠️ 用**等长空白**替换，不是删掉：T-2b 拿 `css.indexOf(标记)` 的下标去 slice
   这个剥过注释的串，一旦长度变了就是「拿 A 的下标切 B」——
   标记前多写两行注释，切片边界就会往后滑进 shared chrome 之后，
   于是 `.bb-btn-primary:hover` 的 #1570d8 被误判成调色区泄漏。
   （这是执法器自身的老 bug，2026-11-26 被一条两行的注释改动暴露出来。） */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));

const count = (s, re) => (s.match(re) || []).length;

/* ---------- T-1  !important ratchet ---------- */
{
  const n = count(cssCode, /!important/g);
  const hiddenOk = /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(cssCode);
  if (n <= BASE.cssImportant) ok(`T-1 !important ${n} ≤ 基线 ${BASE.cssImportant}（只许降）`);
  else bad(`T-1 !important ${n} > 基线 ${BASE.cssImportant}`, "新增了 !important，须改为挂基类正常样式");
  if (hiddenOk) ok("T-1b [hidden]{display:none!important} 豁免在位");
  else bad("T-1b [hidden] 兜底缺失", "layout-contract/ M37 依赖此兜底");
}

/* ---------- T-2  原始色值总量 ratchet ---------- */
{
  const cn = count(cssCode, /#[0-9a-fA-F]{3,8}\b/g);
  const hn = count(html, /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
  if (cn <= BASE.cssHex) ok(`T-2 css hex ${cn} ≤ 基线 ${BASE.cssHex}`);
  else bad(`T-2 css hex ${cn} > 基线 ${BASE.cssHex}`, "新增硬编码色值，须走 var(--token)");
  if (hn <= BASE.htmlHex) ok(`T-2 html hex ${hn} ≤ 基线 ${BASE.htmlHex}`);
  else bad(`T-2 html hex ${hn} > 基线 ${BASE.htmlHex}`, "内联/内联样式新增原始色值");
}

/* ---------- T-2b  调色块纪律（W0-0a 起）：原语块外不得出现字面色值 ---------- */
{
  // 调色区 = 文件头到「shared chrome」分隔线；其中只有 --p-* 原语块允许 hex
  const cut = css.indexOf("/* ---- shared chrome");
  const palette = cssCode.slice(0, cut > 0 ? cut : undefined);
  const primBlocks = [...palette.matchAll(/--p-(?:lt|dk)-[\w-]+:\s*([^;]+);/g)].map((m) => m[1]).join(";");
  const rest = palette.replace(/--p-(?:lt|dk)-[\w-]+:\s*[^;]+;/g, "");
  const leaked = (rest.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
  if (leaked === 0) ok(`T-2b 调色区字面色值只存在于 --p-* 原语（${(primBlocks.match(/#/g) || []).length} 处）`);
  else bad(`T-2b 调色区泄漏 ${leaked} 处字面色值`, "新颜色必须先进 --p-* 原语块，调色块只做 var() 映射");
}

/* ---------- T-3  行内 font-size ratchet ---------- */
{
  const n = count(html, /style="[^"]*font-size/g);
  if (n <= BASE.htmlInlineFont) ok(`T-3 行内 font-size ${n} ≤ 基线 ${BASE.htmlInlineFont}`);
  else bad(`T-3 行内 font-size ${n} > 基线 ${BASE.htmlInlineFont}`, "字号须走类型阶 class，不写行内");
}

/* ---------- T-4  [style*=] 属性反选补丁 ratchet ---------- */
{
  const n = count(cssCode, /\[style\*=/g);
  if (n <= BASE.cssAttrPatch) ok(`T-4 [style*=] 补丁 ${n} ≤ 基线 ${BASE.cssAttrPatch}`);
  else bad(`T-4 [style*=] 补丁 ${n} > 基线 ${BASE.cssAttrPatch}`, "禁止用属性反选打补丁，须删内联 style 改基类");
}

/* ---------- T-5  几何单一源 + 合同真值 ---------- */
{
  /* "单一源"说的是**基础层**只能定义一次；@media (max-width:900px) 里的
     --sidebar-w:200px 是窄窗覆盖，本来就该存在。P1 之前那条规则住在
     index.html 的 <style> 里、T-5 没扫到；搬进 ui_components.css 后它
     才进账 —— 所以这里剥掉 @media 块再数，不是放宽而是校正口径。 */
  const cssBase = (() => {
    let out = "", i = 0;
    for (;;) {
      const m = /@media[^{]*\{/.exec(cssCode.slice(i));
      if (!m) { out += cssCode.slice(i); break; }
      const at = i + m.index;
      out += cssCode.slice(i, at);
      let depth = 1, j = at + m[0].length;
      while (j < cssCode.length && depth > 0) {
        if (cssCode[j] === "{") depth++;
        else if (cssCode[j] === "}") depth--;
        j++;
      }
      i = j;
    }
    return out;
  })();
  const sb = cssBase.match(/--sidebar-w:\s*([^;]+);/g) || [];
  const hd = cssBase.match(/--header-h:\s*([^;]+);/g) || [];
  const oneVal = (arr) => arr.length === 1;
  const sbVal = sb[0] && sb[0].replace(/.*--sidebar-w:\s*/, "").replace(/;$/, "").trim();
  const hdVal = hd[0] && hd[0].replace(/.*--header-h:\s*/, "").replace(/;$/, "").trim();
  if (oneVal(sb) && sbVal === CONTRACT.sidebarW) ok(`T-5 --sidebar-w 单一源=${sbVal}（合同 ${CONTRACT.sidebarW}）`);
  else bad(`T-5 --sidebar-w 非单一源/偏离合同`, `defs=${sb.length} [${sb.join(" | ")}]`);
  if (oneVal(hd) && hdVal === CONTRACT.headerH) ok(`T-5 --header-h 单一源=${hdVal}（合同 ${CONTRACT.headerH}）`);
  else bad(`T-5 --header-h 非单一源/偏离合同`, `defs=${hd.length} [${hd.join(" | ")}]`);
  // 显式拦截 248 / 0 复发
  if (/--sidebar-w:\s*248px/.test(cssCode)) bad("T-5b 检测到 --sidebar-w:248px 复发", "grok-ui 旧覆盖不得回归");
  if (/--header-h:\s*0px/.test(cssCode)) bad("T-5b 检测到 --header-h:0px 复发", "grok-ui 旧覆盖不得回归");
}

console.log(`\nprove_ui_tokens: PASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
