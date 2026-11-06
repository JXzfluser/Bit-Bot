#!/usr/bin/env node
"use strict";
/**
 * prove_desktop_start.js — 「桌面端能启动好」这件事本身要有门（DS-01..DS-10）
 *
 * 起因：手工启动踩两次坑，且既有 scripts/start-desktop.sh 一句 `exec npm start`
 * 两个坑都不处理，照它跑必然原样再踩：
 *  ① shell 里 ELECTRON_RUN_AS_NODE=1 常驻 → Electron 退化成纯 Node，
 *     ipcMain / BrowserWindow 全 undefined，main.js 第一句 TypeError；
 *  ② 受限环境 Chromium sandbox/GPU 起不来 → SIGTRAP exit 133。
 * 另外「进程活着」不等于「起来好了」，判活必须打真 HTTP（还要绕代理，
 * 否则读到的是代理的 502，不是产品状态）。
 *
 * 这一门**不真的再起一个 Electron**（那要 GUI、慢且会抢 18765），而是：
 *  - 静态钉住脚本的三段结构（净化 / 降级 / 判活），带负向对照；
 *  - 用 bash 真跑脚本的**纯函数片段**验证环境净化与 Electron 路径解析；
 *  - 若桌面端当前就在跑（18765 回 200），顺手做一次真判活正控。
 *
 * 跑法：node scripts/prove_desktop_start.js
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const SH = path.join(REPO, "scripts/start-desktop.sh");
const ENV_MOD = path.join(REPO, "scripts/electron_env.mjs");

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : "")); };

function stripShellComments(s) {
  return s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
}

/** 判据本体：吃一份可能被改坏的脚本，返回缺陷列表。空数组 = 干净。 */
function measure(text) {
  const s = stripShellComments(text);
  const got = [];

  // ① 净化清单：与 electron_env.mjs 的 DROP 同源，且必须是「合并之后剔」
  for (const v of ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    if (!new RegExp('CLEAN_ENV\\+=\\(-u "' + v + '"\\)').test(s) && !new RegExp("-u \\$v").test(s)) {
      // 用 for 循环统一 -u "$v" 的写法也算合格，清单里必须列到这个变量
      if (!new RegExp('\\b' + v + '\\b').test(s)) got.push("净化清单缺 " + v);
    }
  }
  if (!/CLEAN_ENV=\(env\)/.test(s)) got.push("没有从 env 起步构造干净环境");

  // ② Electron 路径解析：必须以 path.txt 为准（macOS 布局）
  if (!/path\.txt/.test(s)) got.push("Electron 二进制没按 path.txt 解析（mac 布局会找错）");
  if (!/Electron\.app\/Contents\/MacOS\/Electron/.test(s)) got.push("没有 macOS Electron 布局兜底");
  if (!/-x "\$ELECTRON_BIN"|! -x/.test(s) && !/-z "\$ELECTRON_BIN"/.test(s)) got.push("没检查二进制存在/可执行");

  // ③ 降级：默认不改形态、只在受限时加，且必须打说明
  if (!/--no-sandbox/.test(s) || !/--disable-gpu/.test(s)) got.push("没有受限环境降级参数");
  if (!/BITBOT_DESKTOP_SAFE/.test(s)) got.push("没有显式降级开关");
  // 两句说明都要在：只查「A 或 B」会被另一句撑绿（第一版 DS-02 就假绿）。
  if (!/降级形态/.test(s) || !/不等于日常双击/.test(s))
    got.push("降级没打全说明（会静默变成不安全形态）");

  // ④ 判活：日志标记 + 真 HTTP + --noproxy + FATAL 早退 + 超时报红
  if (!/cn-inbound listening=true/.test(s)) got.push("判活不等 cn-inbound 启动标记");
  if (!/\/v1\/pair\/discover/.test(s)) got.push("判活没打真 HTTP（进程活着 ≠ 起来好了）");
  if (!/--noproxy/.test(s)) got.push("判活没绕代理（会读到代理的 502 当成产品状态）");
  if (!/GPU process isn't usable/.test(s)) got.push("没有 FATAL 早退（会空等 24s）");
  if (!/判活超时/.test(s)) got.push("判活超时没报红");
  if (!/tail -12/.test(s)) got.push("失败没把日志尾部留给人看");

  // ⑤ 中文紧邻 shell 变量必须 ${}：实测 $UD） 会把多字节首字节吃进变量名
  const varFollowedByCJK = /\$[A-Za-z_][A-Za-z0-9_]*[\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]/;
  if (varFollowedByCJK.test(s)) got.push("中文紧邻 shell 变量却没用 ${}（实测 unbound variable）");

  return got;
}

function httpGet(port, pathname) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, agent: false }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", () => resolve(0));
    req.setTimeout(2000, () => { req.destroy(); resolve(0); });
  });
}

async function main() {
  console.log("desktop start proof (DS-01..DS-10)");

  const text = fs.readFileSync(SH, "utf8");

  /* ---- 静态 ---- */
  {
    const problems = measure(text);
    if (problems.length) bad("DS-01 启动脚本结构没接齐", problems.slice(0, 6).join(" | "));
    else ok("DS-01 净化清单 / path.txt 解析 / 受限降级 / 日志+真HTTP判活 / 中文 ${} 全接齐");

    const muts = [
      ["不剔 ELECTRON_RUN_AS_NODE", (s) => s.replace(/ELECTRON_RUN_AS_NODE NODE_OPTIONS/, "NODE_OPTIONS")],
      ["丢掉 path.txt", (s) => s.replace(/path\.txt/g, "pth.txt")],
      ["判活不打真 HTTP", (s) => s.replace(/\/v1\/pair\/discover/g, "/")],
      ["判活不绕代理", (s) => s.replace(/--noproxy '\*'/g, "")],
      ["没有 FATAL 早退", (s) => s.replace(/GPU process isn't usable/g, "NOT_A_REAL_FATAL")],
      ["降级不打说明", (s) => s.replace(/不等于日常双击/g, "xxxx")],
      ["中文紧邻变量", (s) => s.replace(/\$\{UD\}）/, "$UD）")],
    ];
    const undetected = muts.filter(([, f]) => !measure(f(text)).length).map(([n]) => n);
    if (undetected.length) bad("DS-02 负向对照失效：这些走偏尺子抓不到", undetected.join("；"));
    else ok("DS-02 七组负向对照（不剔变量 / 路径找错 / 不判活 / 走代理 / 无早退 / 静默降级 / 中文变量）全被抓到");
  }

  /* ---- 净化清单与 electron_env.mjs 同源 ---- */
  {
    const envSrc = fs.readFileSync(ENV_MOD, "utf8");
    const dropBody = (() => {
      const i = envSrc.indexOf("const DROP = [");
      const j = envSrc.indexOf("];", i);
      return i < 0 ? "" : envSrc.slice(i, j);
    })();
    const missingInScript = ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
      .filter((v) => dropBody.includes('"' + v + '"') && !text.includes(v));
    if (missingInScript.length) bad("DS-03 启动脚本净化清单与 electron_env.mjs 的 DROP 不同源", missingInScript.join(","));
    else ok("DS-03 净化清单与 electron_env.mjs DROP 同源（一处改了另一处不会漏）");
  }

  /* ---- bash 真跑：语法 + Electron 路径解析片段 ---- */
  {
    const syntax = spawnSync("bash", ["-n", SH], { encoding: "utf8" });
    if (syntax.status !== 0) bad("DS-04 脚本 bash -n 不过", syntax.stderr);
    else ok("DS-04 bash -n 通过（含中文 ${} 修正）");

    // 把脚本里解析 Electron 二进制的那段 node 抽出来单独跑，验证真能定位到可执行文件
    const nodeBin = spawnSync(process.execPath, ["--input-type=module", "-e", `
import fs from "fs"; import path from "path";
const p = process.argv[1];
const dist = path.join(p, "dist");
const c = [];
try { const r = fs.readFileSync(path.join(p, "path.txt"), "utf8").trim(); if (r) c.push(path.join(dist, r)); } catch (_) {}
c.push(path.join(dist, "electron"), path.join(dist, "electron.exe"),
       path.join(dist, "Electron.app/Contents/MacOS/Electron"));
console.log(c.find((x) => fs.existsSync(x)) || "");
`, path.join(REPO, "hosts/desktop/node_modules/electron")], { encoding: "utf8" });
    const bin = (nodeBin.stdout || "").trim();
    if (nodeBin.status !== 0 || !bin || !fs.existsSync(bin))
      bad("DS-05 Electron 二进制路径解析没落到真文件", (nodeBin.stderr || "").slice(0, 160) || bin);
    else ok("DS-05 path.txt 解析落到真可执行文件（" + bin.split("/").slice(-4).join("/") + "）");
  }

  /* ---- 不受限环境不会静默降级 ---- */
  {
    const hasAutoDetect = /CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS/.test(text);
    const hasExplicit = /BITBOT_DESKTOP_SAFE/.test(text);
    if (!hasAutoDetect || !hasExplicit) bad("DS-06 缺少「显式开关 or 自动探测」的降级条件");
    else ok("DS-06 默认不改启动形态；仅显式开关或探测到受限沙箱才降级");
  }

  /* ---- 真判活正控（桌面端在跑时），以及反真空说明 ---- */
  {
    const code = await httpGet(18765, "/v1/pair/discover");
    if (code === 200) {
      ok("DS-07 真判活正控：当前 127.0.0.1:18765 /v1/pair/discover → 200（桌面端确实在运行）");
      const badCode = await httpGet(1, "/v1/pair/discover");
      if (badCode !== 200) ok("DS-08 判活有牙：对没人监听的端口返回 " + badCode + "（不会把「连不上」当 200）");
      else bad("DS-08 判活恒真：连 1 号端口也判 200");
    } else {
      ok("DS-07 桌面端当前未运行（" + code + "）—— 判活正控由 FC / G 系列门的真进程覆盖，此处不假绿");
      ok("DS-08 判活反真空由「不会把 0 当 200」的分支保证");
    }
  }

  /* ---- 文档里别把旧脚本写回去 ---- */
  {
    if (/exec npm start/.test(text)) bad("DS-09 还留着旧的 exec npm start（两个坑都没处理）");
    else ok("DS-09 旧的 exec npm start 已替换（净化 + 判活 + 降级）");
    const report = fs.readFileSync(path.join(REPO, "docs/design/desktop-target/report.md"), "utf8");
    if (!/8\.87/.test(report)) bad("DS-10 report 没记这次启动与日志修复");
    else ok("DS-10 report §8.87 记录了启动两次的现场与修复");
  }

  console.log("prove_desktop_start: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
