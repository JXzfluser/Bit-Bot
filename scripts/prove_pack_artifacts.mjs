/* prove_pack_artifacts.mjs — 打包产物门禁（T0-02 / T0-03）
 *
 * 「包里有大脑」这句话以前是靠人眼的：dmg 装完能跑就算过了，但没人核对
 * 内核二进制是否真在分发物里、是否还带可执行位、包体积是否失控。这个门禁
 * 只读产物本身（不读源码），把下面这些事变成退出码：
 *
 *   PA-01 分发物存在 —— --dir 产物不算可分发物，target=dist 才有 dmg/zip/exe/AppImage
 *   PA-02 体积在棘轮上限内 —— 默认 85 MB（超标即红），同时报 AC-T0-1 的 70 MB 目标差距
 *   PA-03 内核真在包内 —— zip 读中央目录（文件名 + unix 可执行位），dmg 读同级 --dir 产物
 *   PA-04 包内内核能跑 —— 直接执行它问 ListMachines，回包里必须有 "v":1
 *   PA-05 语言包瘦身真的生效 —— Electron 框架的 *.lproj 只剩白名单那几个
 *   PA-06 无源码树能启动 —— 把 .app 复制到仓库外的临时目录，起真窗口、渲染出 #composer
 *   PA-07 无源码树能跑一轮 —— 同一个临时副本里跑完一轮内核回合，证据 ok=true
 *   PA-08 包内跑的是常驻内核 —— 证据 loop_trace.resident=true，且宿主退出后
 *         包内内核 0 残留（T1-07「不再每轮 spawn」在分发物上盖章）
 *
 * PA-06/07 是 AC-T0-2 的全部内容，也是这个门禁存在的理由：2026-10-29 之前，
 * 打包产物**从来没起过窗口**——main.js 里的 `require("../shared/…")` 在
 * asar 里指向归档外，桌面应用一启动就抛错。体积、内核文件、可执行位全都绿，
 * 产品却打不开。只查"包里有没有"是不够的，必须查"拿走源码树之后还能不能跑"。
 *
 * 用法：
 *   node scripts/prove_pack_artifacts.mjs
 *   BITBOT_PACK_MAX_MB=95 node scripts/prove_pack_artifacts.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import { electronLaunchEnv, electronUserDataDir, killGateProcs, pgrepPids } from "./electron_env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "hosts", "desktop", "dist");
// AC-T0-1 的目标是 70 MB，但 2026-10-29 实测 Electron 33.4.11 arm64 的运行时地板
// 就在 ~77 MB（把 app.asar+kernel 全删掉也不到 70）。门禁按「棘轮」跑：上限是
// 当前可达值加余量，超标即红；目标 70 每轮都打在输出里，不让它被遗忘。
const MAX_MB = Number(process.env.BITBOT_PACK_MAX_MB || 85);
const TARGET_MB = Number(process.env.BITBOT_PACK_TARGET_MB || 70);
const LOCALE_KEEP = (process.env.BITBOT_PACK_LANGUAGES || "zh-CN,en-US").split(",");

let pass = 0;
let fail = 0;
const ok = (id, msg) => { console.log(`ok ${id} — ${msg}`); pass += 1; };
const bad = (id, msg) => { console.log(`FAIL ${id} — ${msg}`); fail += 1; };

const MB = (bytes) => (bytes / 1024 / 1024).toFixed(1);
const DISTRIBUTABLE_EXT = [".dmg", ".zip", ".exe", ".appimage"];

function listDistributables() {
  if (!fs.existsSync(DIST)) return [];
  return fs.readdirSync(DIST)
    .filter((name) => !name.endsWith(".blockmap"))
    .map((name) => path.join(DIST, name))
    .filter((p) => fs.statSync(p).isFile() && DISTRIBUTABLE_EXT.includes(path.extname(p).toLowerCase()));
}

/* zip 中央目录：不依赖 unzip（Windows runner 上没有），只读 EOCD + CD 条目。
 * 遇到 zip64 直接明说「读不了」，不猜——猜错的门禁比没有门禁更糟。 */
function readZipEntries(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 66_000);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("没有 zip 结束标记（EOCD）");
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new Error("这是 zip64 包，本门禁未实现读取");
    }
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    const entries = [];
    let p = 0;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const external = cd.readUInt32LE(p + 38);
      entries.push({
        name: cd.toString("utf8", p + 46, p + 46 + nameLen),
        mode: (external >>> 16) & 0o7777,
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

// electron-builder 在 macOS 上把 --dir 产物留在 dist/mac-<arch>/ 下，
// 挂 dmg 才能看到内容；同机的这份目录树就是 dmg 的同一批文件。
function unpackedAppDirs() {
  if (!fs.existsSync(DIST)) return [];
  return fs.readdirSync(DIST)
    .map((name) => ({ name, p: path.join(DIST, name) }))
    .filter(({ name, p }) => /^(mac|linux|win)-/.test(name) && fs.statSync(p).isDirectory())
    .map(({ p }) => p);
}

function findKernelInTree(dir) {
  const stack = [dir];
  const hits = [];
  while (stack.length) {
    const cur = stack.pop();
    let items = [];
    try { items = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      const p = path.join(cur, it.name);
      if (it.isDirectory()) { stack.push(p); continue; }
      if (/desktop_turn(\.exe)?$/.test(it.name)) hits.push(p);
    }
  }
  return hits;
}

function findLprojDirs(appDir) {
  const stack = [appDir];
  const hits = [];
  while (stack.length) {
    const cur = stack.pop();
    let items = [];
    try { items = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      const p = path.join(cur, it.name);
      if (!it.isDirectory()) continue;
      if (it.name.endsWith(".lproj")) hits.push(p);
      else stack.push(p);
    }
  }
  return hits;
}

const distributables = listDistributables();

console.log(`== PA-01 分发物存在（棘轮上限 ${MAX_MB} MB / AC 目标 ${TARGET_MB} MB）==`);
if (distributables.length === 0) {
  bad("PA-01", `${DIST} 下没有 .dmg/.zip/.exe/.AppImage —— 用 BITBOT_PACK_TARGET=dist 重新打包（--dir 不算可分发物）`);
} else {
  ok("PA-01", `${distributables.length} 个可分发物：${distributables.map((p) => path.basename(p)).join(", ")}`);
}

console.log("== PA-02 体积 ==");
for (const p of distributables) {
  const bytes = fs.statSync(p).size;
  const mb = bytes / 1024 / 1024;
  const gap = (mb - TARGET_MB).toFixed(1);
  const verdict = mb > TARGET_MB ? `目标 ${TARGET_MB} MB 还差 ${gap} MB` : `已达目标 ${TARGET_MB} MB`;
  const label = `${path.basename(p)} = ${MB(bytes)} MB（${verdict}）`;
  if (mb > MAX_MB) {
    bad("PA-02", `${label} — 超过棘轮上限 ${MAX_MB} MB`);
  } else {
    ok("PA-02", `${label} ≤ 棘轮 ${MAX_MB} MB`);
  }
}

console.log("== PA-03 内核在包内 ==");
let kernelChecked = 0;
for (const p of distributables.filter((f) => f.toLowerCase().endsWith(".zip"))) {
  let entries;
  try { entries = readZipEntries(p); }
  catch (e) { bad("PA-03", `${path.basename(p)} 读中央目录失败：${e.message}`); continue; }
  const kernels = entries.filter((e) => /kernel\/bin\/desktop_turn(\.exe)?$/.test(e.name));
  if (kernels.length === 0) { bad("PA-03", `${path.basename(p)} 内没有 kernel/bin/desktop_turn`); continue; }
  const exec = kernels.filter((e) => (e.mode & 0o111) !== 0);
  if (exec.length !== kernels.length) {
    bad("PA-03", `${path.basename(p)} 内核丢了可执行位：${kernels.map((k) => `${k.name} mode=${k.mode.toString(8)}`).join(", ")}`);
    continue;
  }
  ok("PA-03", `${path.basename(p)} 内 ${kernels.length} 个内核二进制，都有可执行位（共 ${entries.length} 条目）`);
  kernelChecked += 1;
}

const trees = unpackedAppDirs();
for (const tree of trees) {
  const hits = findKernelInTree(tree);
  if (hits.length === 0) { bad("PA-03", `${path.basename(tree)} 里找不到 desktop_turn —— 包里没有大脑`); continue; }
  const runnable = hits.filter((h) => { try { fs.accessSync(h, fs.constants.X_OK); return true; } catch { return false; } });
  if (runnable.length === 0) { bad("PA-03", `${path.basename(tree)} 里的内核不可执行：${hits.join(", ")}`); continue; }
  ok("PA-03", `${path.basename(tree)}: ${runnable.map((r) => path.relative(tree, r)).join(", ")}`);
  kernelChecked += 1;
}
if (kernelChecked === 0 && distributables.length > 0) {
  bad("PA-03", "没有任何一份产物被确认带内核（zip 中央目录与 --dir 目录树都没读到）");
}

console.log("== PA-04 包内内核真能跑 ==");
const runnableKernel = trees.flatMap((t) => findKernelInTree(t))
  .find((h) => { try { fs.accessSync(h, fs.constants.X_OK); return true; } catch { return false; } });
if (!runnableKernel) {
  bad("PA-04", "没有可执行的内核二进制可供自检");
} else {
  let out = "";
  try {
    out = execFileSync(runnableKernel, ["ListMachines"], { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    bad("PA-04", `${runnableKernel} 执行失败：${e.message}`);
  }
  if (out.includes('"v":1')) ok("PA-04", `${path.basename(runnableKernel)} ListMachines 回了 v:1 JSON（${out.trim().length} 字节）`);
  else if (out) bad("PA-04", `${path.basename(runnableKernel)} 回包不是 v:1 JSON：${out.slice(0, 160)}`);
}

console.log("== PA-05 语言包瘦身 ==");
const appDirs = trees.flatMap((t) => fs.existsSync(t) ? fs.readdirSync(t).filter((n) => n.endsWith(".app")).map((n) => path.join(t, n)) : []);
if (appDirs.length === 0) {
  ok("PA-05", "本机产物不是 macOS .app，跳过 .lproj 统计");
} else {
  // 与 build/afterPack.js 的 keepNames 一致：zh-CN 同时保 zh 与 zh_CN。
  const want = new Set(["base"]);
  for (const locale of LOCALE_KEEP) {
    const [lang, region] = String(locale).split(/[-_]/);
    want.add(lang.toLowerCase());
    if (region) want.add(`${lang.toLowerCase()}_${region.toUpperCase()}`);
  }
  for (const app of appDirs) {
    const lproj = findLprojDirs(app);
    const strays = lproj.filter((d) => !want.has(path.basename(d).replace(/\.lproj$/, "")));
    if (strays.length > 0) bad("PA-05", `${path.basename(app)} 还剩 ${strays.length} 个白名单外的 .lproj（共 ${lproj.length}）：${strays.slice(0, 5).map((s) => path.basename(s)).join(", ")}…`);
    else ok("PA-05", `${path.basename(app)} 的 .lproj 只剩 ${lproj.length} 个（白名单 ${[...want].join(", ")}）`);
  }
}

/* --------------------------------------------------------------------------
 * PA-06 / PA-07 — AC-T0-2「删除源码树后仍能跑一轮（内核在包内）」。
 *
 * 为什么要复制：应用在仓库里跑起来不算数。resolveRepoRoot() 会从 bundle 一路
 * 向上走 12 层找 moon.mod，`dist/mac-arm64/Bit Bot.app` 往上三层就是本仓库根，
 * 于是"打包自检"在开发机上永远命中源码树，测的是开发态而不是用户态。
 * 复制到 os.tmpdir() 之后那条回退分支必然失败，REPO_ROOT 只能来自包内的内核。
 * ------------------------------------------------------------------------ */
console.log("== PA-06 无源码树启动 + PA-07 无源码树跑一轮 ==");

/** 找到产物里「可启动的那一份」：macOS 的 .app，或 win/linux 的 unpacked 目录。 */
function findLaunchable(dirs) {
  const found = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const p = path.join(dir, name);
      if (name.endsWith(".app")) {
        const mac = path.join(p, "Contents", "MacOS");
        const asar = path.join(p, "Contents", "Resources", "app.asar");
        if (!fs.existsSync(mac) || !fs.existsSync(asar)) continue;
        const exe = fs.readdirSync(mac).find((f) => !f.startsWith(".") && f !== "__appexrc");
        if (exe) found.push({ root: p, exe: path.join(mac, exe), kind: "app" });
        continue;
      }
      const asar = path.join(p, "resources", "app.asar");
      if (!fs.existsSync(asar)) continue;
      const exe = ["Bit Bot", "bitbot-desktop", "Bit Bot.exe"].find((c) => fs.existsSync(path.join(p, c)));
      if (exe) found.push({ root: p, exe: path.join(p, exe), kind: "unpacked" });
    }
  }
  return found;
}

// 当前环境能不能起真窗口（Electron 需要显示器 / Xvfb）：
//  - Windows 自带显示 → 能
//  - macOS 真机有屏幕能起，但 CI runner（GitHub macOS）没有显示器也没有 Xvfb，
//    electron.launch 必 60s 超时假 FAIL；项目 replica/BACKLOG P2-1 也定 macOS 上
//    这类 e2e 恒 SKIP。这里只在 CI 环境跳过，真机开发仍可本地验。
//  - Linux 有 DISPLAY 且该 socket 真存在，或能找到 xvfb-run → 能；否则诚实 SKIP。
function hasUsableDisplay() {
  if (process.platform === "win32") return true;
  if (process.platform === "darwin") return !process.env.CI;
  const disp = process.env.DISPLAY || "";
  if (disp && (disp.startsWith(":") ? fs.existsSync(`/tmp/.X11-unix/X${disp.slice(1)}`) : fs.existsSync(disp))) {
    return true;
  }
  try { execFileSync("sh", ["-c", "command -v xvfb-run"], { stdio: "ignore" }); return true; } catch { return false; }
}

const launchable = findLaunchable(trees);
if (launchable.length === 0) {
  bad("PA-06", `产物目录里没找到可启动的 bundle（查过 ${trees.map((t) => path.basename(t)).join(", ") || DIST}）—— macOS 需要 *.app/Contents/Resources/app.asar，win/linux 需要 resources/app.asar + 同名可执行文件`);
} else if (!hasUsableDisplay()) {
  // AC-T0-2 真实断言需要显示器；当前 runner 没有（macOS CI 无显示器 / Linux 无
  // DISPLAY 且无 xvfb-run），老老实实 SKIP（SKIP≠PASS），不谎报红。真实冷启动
  // 断言留给有显示器的环境（项目 BACKLOG P2-1：macOS 恒 SKIP，Linux 全绿）。
  console.log(`SKIP PA-06/PA-07/PA-08 — 当前环境没有可用显示器（${process.platform}${process.env.CI ? "/CI" : ""}），无源码树启动 / 跑一轮 / 常驻内核门跳过；真实冷启动断言需在有显示器的环境执行`);
  console.log(`\n== 汇总 == pass ${pass} / fail ${fail} / skip 3`);
  if (fail > 0) { console.log("门禁不过：分发物体积、内核存在性或可执行位有不合格项。"); process.exit(1); }
  process.exit(0);
} else {
  let playwright = null;
  try {
    const req = createRequire(path.join(ROOT, "hosts", "desktop", "package.json"));
    ({ _electron: playwright } = req("playwright-core"));
  } catch (e) {
    bad("PA-06", `hosts/desktop 里没有 playwright-core（${e.message}）—— 起不了真窗口就没有 PA-06/PA-07，先 npm install`);
  }

  for (const bundle of playwright ? launchable.slice(0, 1) : []) {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-pack-isolated-"));
    const copies = [];
    const uds = [];
    try {
      for (const tag of ["win", "turn"]) {
        const dst = path.join(stage, `${tag}-${path.basename(bundle.root)}`);
        fs.cpSync(bundle.root, dst, { recursive: true });
        copies.push(dst);
        uds.push(electronUserDataDir(`pack-${tag}`));
      }
      // 环境净化必须显式清掉 BITBOT_REPO_ROOT：它是 resolveRepoRoot 的第一优先，
      // 留着就等于把源码树"喂"给被测试的安装，AC-T0-2 当场失去意义。
      const cleanEnv = (extra) => {
        const env = electronLaunchEnv({
          BITBOT_NO_SECRET_SYNC: "1",
          BITBOT_DESKTOP_AUTOSTART: "0",
          BITBOT_ROUTINE_DAEMON_AUTOSTART: "0",
          ...extra,
        });
        delete env.BITBOT_REPO_ROOT;
        // 常驻开关由**包里的 main.js 自己决定**（T1-07 默认开）。留着调用者 shell
        // 里的值，PA-08 测的就是「这台机器的环境」而不是「这份分发物」。
        delete env.BITBOT_KERNEL_RESIDENT;
        return env;
      };

      /* ---- PA-06：真起一个窗口，渲染出输入区 ---- */
      let electronApp = null;
      try {
        electronApp = await playwright.launch({
          executablePath: bundle.exe,
          args: [`--user-data-dir=${uds[0]}`],
          env: cleanEnv({}),
          timeout: 60_000,
        });
        const win = await electronApp.firstWindow({ timeout: 45_000 });
        await win.waitForTimeout(2_500);
        const dom = await win.evaluate(() => ({
          title: document.title,
          composer: Boolean(document.getElementById("composer")),
          send: Boolean(document.getElementById("send")),
          bodyChildren: document.body.children.length,
        }));
        if (!dom.composer || !dom.send) {
          bad("PA-06", `${path.basename(bundle.root)} 起了窗口但界面没渲染完整：${JSON.stringify(dom)}`);
        } else {
          ok("PA-06", `${path.basename(bundle.root)} 在仓库外无源码树启动：窗口 1 个，title=「${dom.title}」，#composer/#send 都在`);
        }
      } catch (e) {
        bad("PA-06", `${path.basename(bundle.root)} 无源码树启动失败：${String(e).split("\n")[0]}`);
      } finally {
        if (electronApp) {
          killGateProcs(uds[0]);
          await electronApp.close().catch(() => { /* 已经退了 */ });
        }
      }

      /* ---- PA-07：同一份临时副本里跑完一轮真内核回合 ---- */
      const evidence = path.join(uds[1], "data", "tmp", "desktop-electron-turn.json");
      fs.rmSync(evidence, { force: true });
      const child = spawn(bundle.exe, [`--user-data-dir=${uds[1]}`], {
        env: cleanEnv({ BITBOT_DESKTOP_SMOKE_TURN: "ListMachines" }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      child.stdout.on("data", (c) => { out += String(c); });
      child.stderr.on("data", (c) => { out += String(c); });
      const exited = await new Promise((resolve) => {
        const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* 已退 */ } resolve("timeout"); }, 90_000);
        child.on("exit", (code) => { clearTimeout(timer); resolve(`code=${code}`); });
      });
      let ev = null;
      try { ev = JSON.parse(fs.readFileSync(evidence, "utf8")); } catch { /* 没落盘就是没跑 */ }
      if (!ev) {
        bad("PA-07", `${exited}，但 ${path.relative(uds[1], evidence)} 没落盘 —— 无源码树的安装没跑完回合。宿主输出：${out.trim().slice(0, 300) || "(空)"}`);
      } else if (ev.ok !== true || ev.moonbit_brain !== true) {
        bad("PA-07", `回合证据不合格：ok=${ev.ok} moonbit_brain=${ev.moonbit_brain} intent=${ev.intent} error=${ev.error || "无"}（${exited}）`);
      } else {
        const replies = Array.isArray(ev.turn && ev.turn.messages) ? ev.turn.messages.filter((m) => m.role === "assistant").length : 0;
        ok("PA-07", `无源码树跑完一轮：intent=${ev.intent}，assistant 消息 ${replies} 条，moonbit_brain=true（${exited}）`);
        /* ---- PA-08：包内这一轮走的是常驻内核，不是每轮 spawn（T1-07）----
         * 判据只取宿主在回合结束时自己记下的传输事实（loop_trace.resident /
         * kernel_pid），不看回话内容 —— 常驻与否和模型无关，密钥没配也不该影响。
         * 字段缺失 = 包里的 shared/ 早于行协议；这时**必须说清楚**，不能让旧包
         * 冒充「已交付」。 */
        const trace = ev.turn ? ev.turn.loop_trace : null;
        if (!trace || typeof trace.resident !== "boolean") {
          bad("PA-08", `回合证据里没有 loop_trace.resident —— 这个包早于 T1-07 的常驻行协议（hosts/shared/kernel_server.js），请重跑 bash scripts/pack-desktop.sh 再验收。实际字段：${JSON.stringify(Object.keys(trace || {}))}`);
        } else if (!trace.resident) {
          bad("PA-08", `包内这一轮 resident=false —— 分发物仍在每轮 spawn。可能是包里的 main.js 没设默认（BITBOT_KERNEL_RESIDENT）、或 kernel_server.js 不在 asar 里。kernel_pid=${JSON.stringify(trace.kernel_pid)}`);
        } else if (!Number.isInteger(trace.kernel_pid) || trace.kernel_pid <= 0) {
          bad("PA-08", `resident=true 但 kernel_pid 不可信：${JSON.stringify(trace.kernel_pid)}`);
        } else {
          /* 包内内核还必须是「退出得干净」的常驻：宿主烟测是直接退出的，不走
           * before-quit 的 stopKernel，全靠父进程没了以后 stdin 到 EOF 自己收摊。
           * 数的是这份 bundle 自己的内核路径（应用就是按 bundle 内的绝对路径
           * spawn 的；相对路径启动的开发态进程不会匹配进来，也不该算在这份包账上），
           * 所以别的实例、开发态内核都不会被误伤。 */
          const ownKernel = findKernelInTree(bundle.root)[0];
          const leftovers = ownKernel ? pgrepPids(`${ownKernel} --serve`) : [];
          const ops = Array.isArray(trace.kernel_ops) ? trace.kernel_ops.length : 0;
          if (leftovers.length > 0) {
            bad("PA-08", `回合确实走常驻（pid=${trace.kernel_pid}，op ${ops} 条），但宿主退出后包内内核还活着：${leftovers.join(",")} —— 常驻可以，泄漏不行`);
          } else {
            ok("PA-08", `包内回合由常驻内核服务：kernel_pid=${trace.kernel_pid}，内核 op ${ops} 条；宿主退出后该内核 0 残留（跨回合复用，不再每轮一个新进程）`);
          }
        }
      }
      killGateProcs(uds[1]);
    } finally {
      for (const ud of uds) { killGateProcs(ud); fs.rmSync(ud, { recursive: true, force: true }); }
      for (const dst of copies) fs.rmSync(path.dirname(dst), { recursive: true, force: true });
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
}

console.log(`\n== 汇总 == pass ${pass} / fail ${fail}`);
if (fail > 0) {
  console.log("门禁不过：分发物体积、内核存在性或可执行位有不合格项。");
  process.exit(1);
}
