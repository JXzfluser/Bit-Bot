#!/usr/bin/env node
/* prove_electron_app_path.js — 所有门禁/截图脚本启动 Electron 时必须给 app 路径。
 *
 * 为什么需要这道理：
 *   `shot_bind_page.mjs` 第一版 args 只写了 `--no-sandbox --disable-gpu
 *   --user-data-dir=…`，没给 app 路径。Electron 于是把自己的**默认欢迎页**
 *   （「Electron v37… To run a local app, execute the following on the command line」）
 *   开出来。截图脚本 goto 之后照样能截到图，所以所有门都是绿的 —— 但每跑一次
 *   桌面就闪一个默认窗口，脚本被中断时它还留在屏幕上（用户就是这么看到的）。
 *   这类 bug 只有「看进程/看屏幕」才发现，得让尺子盯住它。
 *
 * 判据（只抓这一类，不去猜动态表达式的语义）：
 *   一个 `_electron.launch({...})` 块里，args 数组若**只有字面量且全是 `--` 开关**，
 *   就是没给 app 路径 → 红。
 *   args 是变量（如 `args`）时，回文件里找它的赋值，同样按上面的规则判。
 *   `executablePath` 指向打包产物（不是 dev 的 electron 二进制）时跳过 ——
 *   打包 app 自带 app 路径，不需要再传。
 *
 * 负向对照：把一段「只有开关」的假启动喂给同一判据必须判红；
 * 把一段带 app 路径的喂进去必须判绿。
 *
 * 跑法：node scripts/prove_electron_app_path.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCRIPTS = path.join(ROOT, "scripts");

let PASS = 0;
let FAIL = 0;
const ok = (id, msg) => {
  PASS++;
  console.log("  ✓ " + id + " " + msg);
};
const bad = (id, msg, extra) => {
  FAIL++;
  console.log("  ✗ " + id + " " + msg + (extra ? " — " + JSON.stringify(extra) : ""));
};

/** 从 `{` 位置取出配平的 {...}，跳过字符串里的括号。 */
function sliceBraces(src, openIdx) {
  if (src[openIdx] !== "{") return "";
  let depth = 0;
  let quote = "";
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx);
}

/** `args: [ ... ]` → 顶层元素数组（按逗号切，跳过嵌套与字符串）。 */
function sliceArray(src, openIdx) {
  if (src[openIdx] !== "[") return "";
  let depth = 0;
  let quote = "";
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return src.slice(openIdx + 1);
}

function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") {
        cur += text[i + 1] || "";
        i++;
      } else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/** 一段 args 文本的判定：ok / bad（只有 -- 开关） */
function judgeArgs(argsText, wholeSrc) {
  const tokens = splitTopLevel(argsText);
  if (!tokens.length) return { ok: false, why: "args 是空的" };
  /* Electron 的规则：**第一个不是 -- 开关的参数**就是 app 路径。
     （--user-data-dir=… 这类带值开关还是 -- 开头，不算。） */
  const firstPositional = tokens.find((t) => !/^["'`]--/.test(t) && !/^--/.test(t));
  if (firstPositional) return { ok: true, why: "app 路径 = " + firstPositional.slice(0, 40) };
  /* 没有位置参数：可能是 args 整个是变量（`{ args }` 简写或 `args:` 后跟变量），
     回文件里找它的赋值再判一次。 */
  if (tokens.length === 1 && /^[A-Za-z_$][\w$.]*$/.test(tokens[0])) {
    const name = tokens[0].split(".")[0];
    const re = new RegExp("(?:const|let|var)\\s+" + name.replace(/\$/g, "\\$") + "\\s*=\\s*\\[");
    const m = re.exec(wholeSrc);
    if (m) {
      const arrStart = wholeSrc.indexOf("[", m.index);
      return judgeArgs(sliceArray(wholeSrc, arrStart), wholeSrc);
    }
    /* 认不出赋值：不算红，但要说明「这条靠跑起来看」——不假装验过。 */
    return { ok: true, why: "args 是变量且找不到赋值，静态判不出（如实）", unsure: true };
  }
  return { ok: false, why: "args 只有 -- 开关，没给 app 路径" };
}

/** 扫一份源码里的所有 _electron.launch({...}) */
function scan(src, fileLabel) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf("_electron.launch(", i)) >= 0) {
    const braceIdx = src.indexOf("{", i);
    if (braceIdx < 0) break;
    const block = sliceBraces(src, braceIdx);
    const line = src.slice(0, i).split("\n").length;
    const execLine = (/executablePath:\s*([^,\n]+)/.exec(block) || [])[1] || "";
    /* 打包产物自带 app 路径：dev 的 electron 二进制才需要显式传。 */
    const packaged = execLine && !/ELECTRON|electronBinary|resolveElectronBinary/.test(execLine);
    /* args 也可能写成简写（`{ args, ... }`），这时按变量处理。 */
    const argsColon = /args:\s*(\[[\s\S]*?\n\s*\]|\[[^\]]*\]|[A-Za-z_$][\w$.]*)/.exec(block);
    const argsShorthand = /[{,]\s*args\s*[,}]/.test(block);
    const argsM = argsColon || (argsShorthand ? [null, "args"] : null);
    if (packaged) {
      out.push({ file: fileLabel, line, ok: true, why: "打包产物（自带 app 路径），跳过" });
    } else if (!argsM) {
      out.push({ file: fileLabel, line, ok: false, why: "launch 里没有 args（等于没给 app 路径）" });
    } else {
      const raw = argsM[1];
      const argsText = raw.startsWith("[") ? raw.slice(1, raw.lastIndexOf("]")) : raw;
      out.push(Object.assign({ file: fileLabel, line }, judgeArgs(argsText, src)));
    }
    i = braceIdx + block.length;
  }
  return out;
}

(function main() {
  console.log("prove_electron_app_path — 启动 Electron 必须给 app 路径");
  const files = fs
    .readdirSync(SCRIPTS)
    .filter((f) => /\.(mjs|js)$/.test(f))
    /* 自己这份文件里的示例串不是真的启动，别把尺子自己算进去。 */
    .filter((f) => f !== "prove_electron_app_path.js")
    .sort();

  const results = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(SCRIPTS, f), "utf8");
    if (src.indexOf("_electron.launch(") < 0) continue;
    results.push(...scan(src, f));
  }

  if (!results.length) {
    bad("AP-00", "一个 _electron.launch 都没扫到（尺子指错了地方）");
  } else {
    ok("AP-00", "扫到 " + results.length + " 处 _electron.launch（" + new Set(results.map((r) => r.file)).size + " 个文件）");
  }

  const offenders = results.filter((r) => !r.ok);
  if (offenders.length) {
    bad(
      "AP-01",
      "有启动没给 app 路径（会弹 Electron 默认欢迎页）",
      offenders.map((o) => o.file + ":" + o.line + " → " + o.why),
    );
  } else {
    ok("AP-01", "所有启动都给了 app 路径或指向打包产物（不会弹默认欢迎页）");
  }

  const unsure = results.filter((r) => r.unsure);
  if (unsure.length) {
    console.log(
      "  · 如实：" + unsure.length + " 处 args 是变量且静态判不出（" +
        unsure.map((u) => u.file + ":" + u.line).join(", ") + "），这几处靠跑起来看",
    );
  }

  /* 负向对照：同一判据喂「只有开关」的假启动必须判红。 */
  const fakeBad = 'const app = await _electron.launch({ executablePath: ELECTRON, args: ["--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud], cwd: REPO });';
  const fakeGood = 'const app = await _electron.launch({ executablePath: ELECTRON, args: [mainJs, "--no-sandbox"], cwd: REPO });';
  const rBad = scan(fakeBad, "<fake-bad>");
  const rGood = scan(fakeGood, "<fake-good>");
  if (!rBad.length || rBad[0].ok) {
    bad("AP-02", "负向对照失效：只有开关的假启动没被判红");
  } else if (!rGood.length || !rGood[0].ok) {
    bad("AP-03", "正向对照失效：带 app 路径的假启动被判红了");
  } else {
    ok("AP-02", "负向对照：只有 -- 开关的启动被判红（判据不是恒绿）");
    ok("AP-03", "正向对照：带 mainJs 的启动照常判绿");
  }

  /* 回归样本：把**第一版真实写错的那段 args 原样**钉在这里。
     这段是从 shot_bind_page.mjs 的历史版本抄下来的，不是编的；
     以后判据被改松，这条会先红。 */
  {
    const originalBugArgs = [
      '"--no-sandbox",',
      '"--disable-gpu",',
      '"--user-data-dir=" + electronUserDataDir("bind-shot"),',
    ].join("\n    ");
    const v = judgeArgs(originalBugArgs, "");
    if (v.ok) bad("AP-05", "回归样本没过：第一版那段「只有开关的 args」现在被判绿了");
    else ok("AP-05", "回归样本：第一版那段「只有开关的 args」仍被判红（判据没被改松）");
  }

  /* 负向对照 2：把真仓库里第一处 launch 的 app 路径摘掉，扫描必须转红。 */
  const target = results.find((r) => r.ok && !r.unsure);
  if (!target) {
    bad("AP-04", "找不到可注入的样本（静态可判的启动一处都没有）");
  } else {
    const src = fs.readFileSync(path.join(SCRIPTS, target.file), "utf8");
    const mutated = src.replace(/args:\s*\[([^\]]*?)(mainJs|MAIN_JS)/, 'args: ["--no-sandbox"');
    const mutatedRes = scan(mutated, target.file);
    const nowBad = mutatedRes.some((r) => !r.ok);
    /* 摘掉之后语法可能不再成立（残留项），此时按「红」算是不成立的，
       所以只认 mut 真的改变了源码的情形。 */
    if (mutated === src) {
      console.log("  · AP-04 跳过：这处 args 形态不匹配注入模板（" + target.file + "），不算通过");
    } else if (!nowBad) {
      bad("AP-04", "注入对照失效：摘掉 app 路径后仍判绿");
    } else {
      ok("AP-04", "注入对照：把 " + target.file + " 的 app 路径摘掉，判据转红");
    }
  }

  console.log("prove_electron_app_path: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
})();
