#!/usr/bin/env node
/* prove_app_identity.js — 桌面应用在系统里必须叫 Bit Bot，不能叫 Electron。
 *
 * 为什么需要这道理（都是真机上看出来的，不是推演）：
 *  ① macOS 菜单栏第一项写的是 "Electron"。app.setName("Bit Bot") 只管
 *     app.getName() / 关于面板 / ⌘Q 条目，**菜单栏那一格读的是进程所在 bundle
 *     的 CFBundleName**，dev 下跑的是 node_modules/electron 的 Electron.app，
 *     所以它永远写 Electron。修法是造一个同构包（CFBundleName=Bit Bot）再跑，
 *     见 scripts/make_dev_app_bundle.sh。
 *  ② 菜单语言跟界面语言对不上：中文界面上面挂着一排 Edit / View / Window / Help。
 *     根因是 menuLangOf 在 settings 没有 language 时回落 en，而渲染端
 *     wavegLang 的初值是 zh-CN。
 *  ③ 切了语言菜单不跟着变：主进程监听了 "bitbot:menu-relocalize"，可渲染端
 *     从来没有发过这个事件 —— 监听器一直在，链路一直是断的。
 *  ④ 关于面板的版本号取 app.getVersion()，dev 下它读的是 app 路径里的
 *     package.json，实测出现过 37.10.3（那是 Electron 自己的版本）。
 *  ⑤ 对话记录里直接渲染内核符号："AgentLoop::run"、llm_chat、exec_tool。
 *
 * 判据都带负向对照：每个判定函数都拿「修复前的那一行」喂一遍，必须判红。
 *
 * 跑法：node scripts/prove_app_identity.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DESKTOP = path.join(ROOT, "hosts/desktop");
const MAIN = path.join(DESKTOP, "main.js");
const HTML = path.join(DESKTOP, "index.html");
const PKG = path.join(DESKTOP, "package.json");
const START = path.join(ROOT, "scripts/start-desktop.sh");
const BUNDLER = path.join(ROOT, "scripts/make_dev_app_bundle.sh");

let PASS = 0;
let FAIL = 0;
const ok = (id, msg) => {
  PASS++;
  console.log("  ✓ " + id + " " + msg);
};
const bad = (id, msg, extra) => {
  FAIL++;
  console.log("  ✗ " + id + " " + msg + (extra !== undefined ? " — " + JSON.stringify(extra) : ""));
};
const skip = (id, msg) => console.log("  · " + id + " SKIP " + msg + "（没验到，不算通过）");

const read = (p) => fs.readFileSync(p, "utf8");

/** 去掉**整行注释**，保留其余代码（含字符串字面量）。
 *
 *  为什么这样做，而不是写一个完整的词法剥离器：第一版按引号配对逐字符扫，结果
 *  在 index.html 上失效 —— 这份文件是 HTML，正文与 CSS 里的英文撇号（it's、
 *  content: '…'）先把引号状态带歪，后面所有 // 都不再被当成注释，于是
 *  「注释里的 AgentLoop::run」被当成代码违规报了出来。按行判只需要一条规则：
 *  trim 之后以 // 或 * 开头的行整行丢掉，/* 与 *\/ 之间整段丢掉。代价是
 *  「代码后面跟行尾注释」那半行会被保留 —— 对「符号是否出现在代码里」这个
 *  判断来说，保留只会更严，不会更松。 */
function dropCommentLines(src) {
  let inBlock = false;
  return String(src || "")
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (inBlock) {
        if (t.includes("*/")) inBlock = false;
        return "";
      }
      if (t.startsWith("/*")) {
        if (!t.includes("*/")) inBlock = true;
        return "";
      }
      if (t.startsWith("//") || t.startsWith("*")) return "";
      return line;
    })
    .join("\n");
}

/** 取出 HTML 里所有内联 <script> 的代码，并去掉其中的整行注释。 */
function scriptCodeOf(htmlSrc) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(htmlSrc || "")))) out.push(dropCommentLines(m[1]));
  return out.join("\n");
}

const pkg = JSON.parse(read(PKG));
const main = read(MAIN);
const html = read(HTML);
const start = read(START);
const bundler = read(BUNDLER);
const PRODUCT_NAME = pkg.productName || "";

/* ---------------- 判定函数（每个都单独可喂负向样本） ---------------- */

/** 菜单语言回落方向：只有 en* 走英文，缺值/未知值/中文一律回落 zh。 */
function judgeMenuLang(line) {
  const s = String(line || "").replace(/\s+/g, " ").trim();
  if (!/menuLangOf/.test(s)) return { ok: false, why: "找不到 menuLangOf 定义行" };
  if (!/en/i.test(s)) return { ok: false, why: "没有 en 分支" };
  // 兜底是 en → 中文界面会配英文菜单（就是被修掉的那版）
  if (/:\s*"en"\s*\)\s*;?\s*$/.test(s)) {
    return { ok: false, why: "回落方向是 en（缺值/未知值时界面中文、菜单英文）" };
  }
  if (!/:\s*"zh"\s*\)/.test(s)) return { ok: false, why: "没有 zh 兜底" };
  return { ok: true, why: "只有 en* 走英文，其余回落 zh" };
}

/** 关于面板版本号：必须来自 package.json 的产品版本，不许是裸 app.getVersion()。 */
function judgeAboutVersion(block) {
  const s = String(block || "");
  const m = /applicationVersion:\s*([^,\n]+)/.exec(s);
  if (!m) return { ok: false, why: "找不到 applicationVersion" };
  const expr = m[1].trim();
  if (/^app\.getVersion\(\)$/.test(expr)) {
    return { ok: false, why: "直接吃 app.getVersion()（dev 下是 Electron 的版本号）" };
  }
  if (!/PRODUCT_VERSION/.test(expr)) return { ok: false, why: "没走 PRODUCT_VERSION 常量：" + expr };
  return { ok: true, why: "applicationVersion ← " + expr };
}

/** bundle 身份：plist 里的名字/版本必须与 package.json 一致（不许出现 Electron）。 */
function judgeBundleIdentity(plist, want) {
  const problems = [];
  const get = (k) => (plist && plist[k] !== undefined ? String(plist[k]) : "<missing>");
  if (get("CFBundleName") !== want.name) problems.push("CFBundleName=" + get("CFBundleName"));
  if (get("CFBundleDisplayName") !== want.name) problems.push("CFBundleDisplayName=" + get("CFBundleDisplayName"));
  if (get("CFBundleExecutable") !== want.name) problems.push("CFBundleExecutable=" + get("CFBundleExecutable"));
  if (get("CFBundleShortVersionString") !== want.version) {
    problems.push("CFBundleShortVersionString=" + get("CFBundleShortVersionString"));
  }
  if (/electron/i.test(get("CFBundleName"))) problems.push("名字里带 Electron");
  return problems.length ? { ok: false, why: problems.join(" / ") } : { ok: true, why: "plist 与 package.json 一致" };
}

/** IPC 片段：settings:set 里必须真的重排菜单。 */
function judgeMenuRewire(fragment) {
  const s = String(fragment || "");
  if (!/relocalizeMenu\s*\(/.test(s)) return { ok: false, why: "settings:set 里没有调用 relocalizeMenu" };
  if (!/patch\.language/.test(s)) return { ok: false, why: "只在别的字段上重排，语言变了不重建" };
  return { ok: true, why: "settings:set 收到 language 变化即重建菜单" };
}

/* ---------------- 8.92.6 那一轮补的两条判据 ---------------- */

/** dev 包必须自给自足：Resources/app 指到真应用目录（否则双击 .app 开欢迎页）。 */
function judgeSelfContained(resolvedAppDir, resolvedDesktop, hasPkg) {
  if (!hasPkg) return { ok: false, why: "Resources/app/package.json 不存在（包不自给自足）" };
  if (!resolvedAppDir) return { ok: false, why: "Resources/app 解不出真实路径（软链断了）" };
  if (resolvedAppDir !== resolvedDesktop) {
    return { ok: false, why: "Resources/app 指向 " + resolvedAppDir + "，不是应用目录" };
  }
  return { ok: true, why: "Resources/app → 应用目录" };
}

/** 「开发构建」的判定必须覆盖 bundle 那条路径，不能只看 app.isPackaged。 */
function judgeIsDevBuild(block) {
  const s = String(block || "");
  if (!/IS_DEV_BUILD/.test(s)) return { ok: false, why: "没有 IS_DEV_BUILD 定义" };
  if (!/build\[?\\\\?\/\]?dev-app|build\[\/\|\\\\\/\]dev-app/.test(s) && !s.includes("dev-app")) {
    return { ok: false, why: "只在 !app.isPackaged 上判 —— 从 .app 启动时 isPackaged 为真，会被当安装版" };
  }
  if (!/app\.isPackaged/.test(s)) return { ok: false, why: "连 isPackaged 都没看" };
  return { ok: true, why: "isPackaged 为假 **或** 可执行文件在 build/dev-app 下 → 开发构建" };
}

/** dev 态不许注册登录项（并把历史遗留的撤掉），且必须早返回。 */
function judgeLoginGuard(fnSrc) {
  const s = String(fnSrc || "");
  if (!/if \(IS_DEV_BUILD\)/.test(s)) return { ok: false, why: "没有 IS_DEV_BUILD 分支" };
  if (!/setLoginItemSettings\(\{\s*openAtLogin: false/.test(s)) {
    return { ok: false, why: "没有撤销动作（历史遗留的登录项会继续在登录时拉起欢迎页）" };
  }
  if (!/skipped: "dev_build"/.test(s)) return { ok: false, why: "没有把「跳过」说出来（调用方会以为真的注册了）" };
  return { ok: true, why: "dev 早返回 + 撤销旧项 + 明确标 skipped" };
}

/* ---------------- 1) 身份三件套 ---------------- */

if (PRODUCT_NAME === "Bit Bot" && pkg.build && pkg.build.appId) {
  ok("ID-01", "package.json 身份：" + PRODUCT_NAME + " / " + pkg.version + " / " + pkg.build.appId);
} else {
  bad("ID-01", "productName 或 build.appId 不对", { productName: PRODUCT_NAME, appId: pkg.build && pkg.build.appId });
}
if (/^\d+\.\d+\.\d+/.test(String(pkg.version || ""))) {
  ok("ID-02", "版本号是 semver：" + pkg.version);
} else {
  bad("ID-02", "版本号不是 semver", pkg.version);
}

/* ---------------- 2) main.js：setName 在 ready 之前、来自 package.json ---------------- */

{
  const iSet = main.indexOf("app.setName(");
  const iReady = main.indexOf("app.whenReady(");
  const usesConst = /app\.setName\(PRODUCT_NAME\)/.test(main);
  const fromPkg = /APP_PKG\.productName/.test(main);
  if (iSet > 0 && iReady > 0 && iSet < iReady && usesConst && fromPkg) {
    ok("ID-03", "app.setName(PRODUCT_NAME) 在 whenReady 之前，名字来自 package.json");
  } else {
    bad("ID-03", "setName 位置/取值不合格", { iSet, iReady, usesConst, fromPkg });
  }
}

/* ---------------- 3) 关于面板版本号 ---------------- */

{
  const i = main.indexOf("setAboutPanelOptions(");
  const block = i < 0 ? "" : main.slice(i, i + 600);
  const r = judgeAboutVersion(block);
  if (r.ok) ok("ID-04", "关于面板 " + r.why);
  else bad("ID-04", "关于面板版本号不对：" + r.why);

  // 负向对照：把版本号换回 app.getVersion()，同一判定必须判红
  const mutated = block.replace(/applicationVersion:[^,\n]+/, "applicationVersion: app.getVersion(),");
  if (mutated === block) {
    bad("ID-04b", "注入对照失效：模板没匹配上（判据与代码脱节）");
  } else if (judgeAboutVersion(mutated).ok) {
    bad("ID-04b", "注入对照失效：换回 app.getVersion() 之后仍判绿");
  } else {
    ok("ID-04b", "注入对照：applicationVersion 换回 app.getVersion() → 判红");
  }
}

/* ---------------- 4) 菜单语言回落 + 负向对照 ---------------- */

{
  const line = (main.match(/^.*menuLangOf\s*=.*$/m) || [""])[0];
  const r = judgeMenuLang(line);
  if (r.ok) ok("ID-05", "菜单语言回落：" + r.why);
  else bad("ID-05", "菜单语言回落不合格：" + r.why);

  // 负向对照：修复前那一行（settings 无 language 时回落 en）必须判红
  const oldLine = '  const menuLangOf = (lang) => (lang && /zh/i.test(String(lang)) ? "zh" : "en");';
  if (judgeMenuLang(oldLine).ok) {
    bad("ID-05b", "注入对照失效：修复前的 en 回落实现仍判绿");
  } else {
    ok("ID-05b", "注入对照：修复前的 en 回落实现 → 判红");
  }
  // 正向对照：只有开关式英文判定才判绿
  const goodSample = '  const menuLangOf = (lang) => (/^\\s*en/i.test(String(lang || "")) ? "en" : "zh");';
  if (!judgeMenuLang(goodSample).ok) {
    bad("ID-05c", "正向对照失效：正确的实现被判红");
  } else {
    ok("ID-05c", "正向对照：正确的实现判绿");
  }
}

/* ---------------- 5) 切语言 → 菜单重建（真实链路） ---------------- */

{
  const i = main.indexOf('ipcMain.handle("bitbot:settings:set"');
  const j = main.indexOf('ipcMain.handle("bitbot:', i + 10);
  const frag = i < 0 ? "" : main.slice(i, j > 0 ? j : i + 1200);
  const r = judgeMenuRewire(frag);
  if (r.ok) ok("ID-06", "菜单重建挂在 settings:set：" + r.why);
  else bad("ID-06", "切语言不会重建菜单：" + r.why);

  // 负向对照：把 language 分支摘掉，同一判定必须判红
  const mutated = frag.replace(/if \(res && res\.ok && patch && patch\.language && relocalizeMenu\) \{[\s\S]*?\n    \}\n/, "");
  if (mutated === frag) {
    bad("ID-06b", "注入对照失效：language 分支没匹配上（判据与代码脱节）");
  } else if (judgeMenuRewire(mutated).ok) {
    bad("ID-06b", "注入对照失效：摘掉 language 分支后仍判绿");
  } else {
    ok("ID-06b", "注入对照：摘掉 language 分支 → 判红");
  }
}

/* ---------------- 6) dev 应用包（真读 Info.plist，不猜） ---------------- */

{
  const appPath = path.join(DESKTOP, "build/dev-app", PRODUCT_NAME + ".app");
  const plist = path.join(appPath, "Contents/Info.plist");
  if (!fs.existsSync(plist)) {
    skip("ID-07", "还没造过 dev 应用包（先跑 scripts/make_dev_app_bundle.sh）");
  } else {
    let parsed = null;
    try {
      parsed = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist], { encoding: "utf8" }));
    } catch (e) {
      bad("ID-07", "Info.plist 读不出来", String((e && e.message) || e).slice(0, 120));
    }
    if (parsed) {
      const want = { name: PRODUCT_NAME, version: String(pkg.version) };
      const r = judgeBundleIdentity(parsed, want);
      if (r.ok) ok("ID-07", "dev 应用包 plist：" + r.why + "（" + want.name + " " + want.version + "）");
      else bad("ID-07", "dev 应用包 plist 不合格：" + r.why);

      // 负向对照：把它当成没改过的 Electron.app（名字 Electron）必须判红
      const mutated = Object.assign({}, parsed, {
        CFBundleName: "Electron",
        CFBundleDisplayName: "Electron",
        CFBundleExecutable: "Electron",
      });
      if (judgeBundleIdentity(mutated, want).ok) {
        bad("ID-07b", "注入对照失效：CFBundleName=Electron 仍判绿");
      } else {
        ok("ID-07b", "注入对照：CFBundleName 改回 Electron → 判红");
      }
      // 可执行文件必须真的改过名（plist 指谁，MacOS/ 下就得是谁）
      const exe = path.join(appPath, "Contents/MacOS", PRODUCT_NAME);
      if (fs.existsSync(exe)) ok("ID-07c", "可执行文件存在：Contents/MacOS/" + PRODUCT_NAME);
      else bad("ID-07c", "没有 Contents/MacOS/" + PRODUCT_NAME + "（plist 指向的文件不存在 = 起不来）");
    }
  }
}

/* ---------------- 7) 启动路径真的用了它，失败要明说 ---------------- */

{
  const usesBundler = /make_dev_app_bundle\.sh/.test(start);
  const swaps = /ELECTRON_BIN="\$DEV_APP\/Contents\/MacOS\//.test(start);
  const warns = /菜单栏会显示 Electron/.test(start);
  if (usesBundler && swaps && warns) {
    ok("ID-08", "start-desktop.sh：darwin 上切到产品身份包，造不出来时明说会显示 Electron");
  } else {
    bad("ID-08", "启动脚本没接上产品身份", { usesBundler, swaps, warns });
  }
  if (/CFBundleName/.test(bundler) && /PlistBuddy/.test(bundler)) {
    ok("ID-09", "make_dev_app_bundle.sh 真的改 CFBundleName（不是只复制一份）");
  } else {
    bad("ID-09", "造包脚本没改 CFBundleName");
  }
}

/* ---------------- 8) 渲染端不许直出内核符号 ---------------- */

{
  // 只看代码，不看注释（注释里必须能写这段历史，否则下次没人知道为什么这么改）
  const htmlCode = scriptCodeOf(html);
  if (!/AgentLoop::run/.test(htmlCode)) {
    ok("ID-10", "代码里不再把内核符号 AgentLoop::run 渲染出去");
  } else {
    bad("ID-10", "index.html 的代码里仍有 AgentLoop::run（会原样显示给用户）");
  }
  // 负向对照：塞一行渲染代码进去，同一判据必须判红
  const mutated = htmlCode.replace(
    "el.textContent = wavegT(stepKey);",
    'el.textContent = step.kind === "entry" ? "AgentLoop::run" : String(step.op || "");',
  );
  if (mutated === htmlCode) {
    bad("ID-10b", "注入对照失效：找不到 el.textContent 赋值点（判据与代码脱节）");
  } else if (!/AgentLoop::run/.test(mutated)) {
    bad("ID-10b", "注入对照失效：塞回内核符号后仍判绿");
  } else {
    ok("ID-10b", "注入对照：把内核符号塞回渲染点 → 判红");
  }
  const hasMap = /const AGENT_STEP_LABEL\s*=\s*\{/.test(html) && /dataset\.agentStepKey/.test(html);
  if (hasMap) ok("ID-11", "step 行措辞走词条表 AGENT_STEP_LABEL + data-agent-step-key");
  else bad("ID-11", "step 行还没接词条表");

  // 切语言不刷新页面时，动态文案必须被重刷（否则留下上一种语言）
  const applySrc = html.slice(html.indexOf("function wavegLangApply(code)"), html.indexOf("function wavegApplyAppearanceClass"));
  const rerenders = /renderProgressRow\(\)/.test(applySrc) && /data-agent-step-key/.test(applySrc);
  if (rerenders) ok("ID-12", "wavegLangApply 重刷进度行与 step 行（实时切语言不留旧语言）");
  else bad("ID-12", "wavegLangApply 没重刷动态文案");
}

/* ---------------- 9) 新词条三语齐全 ---------------- */

{
  const keys = [
    "routeOnRecording",
    "agentStepEntry", "agentStepLlm", "agentStepTool", "agentStepApproval", "agentStepDeliver",
  ];
  const missing = [];
  for (const k of keys) {
    const n = (html.match(new RegExp("\\n\\s*" + k + ":", "g")) || []).length;
    if (n < 3) missing.push(k + "×" + n);
  }
  if (!missing.length) ok("ID-13", keys.length + " 个词条 ×3 语言齐全（按字典行数数，不是「出现一次就算」）");
  else bad("ID-13", "词条不足三语：" + missing.join(", "));
}

/* ---------------- 10) dev 包自给自足 + 不许注册登录项（§8.92.6） ---------------- */

{
  const appPath = path.join(DESKTOP, "build/dev-app", PRODUCT_NAME + ".app");
  const link = path.join(appPath, "Contents/Resources/app");
  const pkgInLink = path.join(link, "package.json");
  if (!fs.existsSync(appPath)) {
    skip("ID-14", "还没造过 dev 应用包（先跑 scripts/make_dev_app_bundle.sh）");
    skip("ID-14b", "同上（负向对照没有真包可喂）");
  } else {
    let resolvedApp = "";
    try { resolvedApp = fs.realpathSync(link); } catch (_) { /* 软链不存在 */ }
    let resolvedDesktop = "";
    try { resolvedDesktop = fs.realpathSync(DESKTOP); } catch (_) { /* 不可能 */ }
    const r = judgeSelfContained(resolvedApp, resolvedDesktop, fs.existsSync(pkgInLink));
    if (r.ok) ok("ID-14", "dev 包自给自足：" + r.why + "（双击 / open -a 不带 app 路径也能起）");
    else bad("ID-14", "dev 包不自给自足：" + r.why + " —— 双击 .app 会开 Electron 默认欢迎页");

    // 负向对照：把「指向别处」的路径喂进去必须判红
    const neg = judgeSelfContained("/tmp", resolvedDesktop, fs.existsSync(pkgInLink));
    if (neg.ok) {
      bad("ID-14b", "注入对照失效：Resources/app 指到别处仍判绿");
    } else {
      ok("ID-14b", "注入对照：Resources/app 指向 /tmp（不是应用目录）→ 判红");
    }
  }
}

{
  const fn = main.slice(main.indexOf("function applyLoginItem(enabled)"), main.indexOf("function readDaemonStatus"));
  const r = judgeLoginGuard(fn);
  if (r.ok) ok("ID-15", "登录项：" + r.why);
  else bad("ID-15", "登录项策略不合格：" + r.why);

  // 负向对照：把守卫摘掉（回到「dev 也注册」）必须判红
  const mutated = fn.replace(/if \(IS_DEV_BUILD\) \{[\s\S]*?\n  \}\n/, "");
  if (mutated === fn) {
    bad("ID-15b", "注入对照失效：守卫没匹配上（判据与代码脱节）");
  } else if (judgeLoginGuard(mutated).ok) {
    bad("ID-15b", "注入对照失效：摘掉 dev 守卫后仍判绿");
  } else {
    ok("ID-15b", "注入对照：摘掉 dev 守卫 → 判红");
  }
}

{
  const block = main.slice(main.indexOf("const IS_DEV_BUILD"), main.indexOf("const IS_DEV_BUILD") + 700);
  const r = judgeIsDevBuild(block);
  if (r.ok) ok("ID-16", "IS_DEV_BUILD：" + r.why);
  else bad("ID-16", "IS_DEV_BUILD 定义不合格：" + r.why);

  // 负向对照：退回只看 isPackaged，必须判红
  const oldBlock = 'const IS_DEV_BUILD = (() => { try { return !app.isPackaged; } catch (_) { return true; } })();';
  if (judgeIsDevBuild(oldBlock).ok) {
    bad("ID-16b", "注入对照失效：只看 !app.isPackaged 仍判绿");
  } else {
    ok("ID-16b", "注入对照：退回只看 !app.isPackaged → 判红");
  }

  // 三处「行为分支」都别再裸用 app.isPackaged（它们在 bundle 启动时会走成安装版）
  const risky = [
    ["RESOURCES_PATH", /app\.isPackaged && process\.resourcesPath/, /app\.isPackaged && !IS_DEV_BUILD && process\.resourcesPath/],
    ["DESKTOP_ENV_LOCAL", /const DESKTOP_ENV_LOCAL = app\.isPackaged && USER_DATA_DIR/, /const DESKTOP_ENV_LOCAL = app\.isPackaged && !IS_DEV_BUILD && USER_DATA_DIR/],
    ["otaFeed", /\(app\.isPackaged && hasBakedGithubFeed\(\)\)/, /\(app\.isPackaged && !IS_DEV_BUILD && hasBakedGithubFeed\(\)\)/],
  ];
  const left = risky.filter(([, bare, guarded]) => bare.test(main) && !guarded.test(main)).map(([n]) => n);
  if (!left.length) ok("ID-17", "三处行为分支（资源目录 / userData 的 .env.local / 自动更新）都走 IS_DEV_BUILD");
  else bad("ID-17", "还有分支裸用 app.isPackaged（双击启动时会按安装版走）：" + left.join(", "));
}

console.log("\nprove_app_identity: PASS=" + PASS + " FAIL=" + FAIL);
process.exit(FAIL ? 1 : 0);
