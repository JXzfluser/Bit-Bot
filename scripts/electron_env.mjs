/* electron_env.mjs — 启动真 Electron 门禁时的环境净化与用户数据隔离（单一真源）。
 *
 * 为什么需要它（不是"保险起见"，是实测踩出来的）：
 *
 *   ELECTRON_RUN_AS_NODE=1 会让 electron 二进制**退化成纯 node 运行**。
 *   后果有两个，第一个致命：
 *     - ipcMain / BrowserWindow 全是 undefined，main.js 里第一句
 *       ipcMain.handle(...) 就 TypeError；
 *     - node 模式不认 --remote-debugging-port，playwright 的启动握手直接
 *       "bad option: --remote-debugging-port=0" → "Process failed to launch!"。
 *   这个变量在不少终端/CI 环境里是常驻的（开发机、容器、某些 shell profile）。
 *   门禁不能指望调用者的 shell 是干净的，所以在 launch 时显式剔除，
 *   而不是写一句文档提醒。
 *
 * 同一把尺子还顺手管两件事：
 *   - 代理变量（HTTP_PROXY 等）：应用内请求要直连，走代理会让门禁的假数据源失真；
 *   - --user-data-dir：Chromium 的 user data 目录带单例锁，和正在运行的 app
 *     共用同一个目录时第二个实例会被顶掉，门禁表现为"随机启动失败"。
 *     门禁一律用独立临时目录，跑完清掉。
 */
import os from "os";
import path from "path";
import fs from "fs";
import { execSync, spawnSync } from "child_process";

/* --------------------------------------------------------------------------
 * 进程计数（单一真源）—— 门禁里「有几个实例」「退出后有没有残留」都走这里。
 *
 * 为什么要单独写：`execSync("pgrep -f <pat>")` 会先起一个
 * `/bin/sh -c pgrep -f <pat>`，这个 shell 自己的命令行里就带着 <pat>，
 * 于是 pgrep 永远多算 1 个。实测后果不是数字难看，而是**假红**：
 *   - 单实例门禁把「1 个实例」读成 2 → 判「锁没生效」；
 *   - 退出门禁把「0 残留」读成 1 → 判「退不干净」。
 * 两条都是红在产品里并不存在的行为上（同 UD 第二实例确实自己退了，
 * app.quit() 后主进程确实 code=0 退出，锁也确实能再次启动）。
 *
 * 这里直接 spawnSync 调 pgrep（没有中间 shell），再用 ps 逐 pid 取命令行精确
 * 过滤：只数「带 main.js + 该 user-data-dir 的应用主进程」。Chromium 的
 * gpu / renderer / network 辅助进程命令行里没有 main.js，不计入实例数。
 * ------------------------------------------------------------------------ */

/** 按命令行子串匹配进程（无中间 shell）。返回 pid 数组。 */
export function pgrepPids(pattern) {
  const res = spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" });
  if (res.status !== 0) return []; // status=1 → 没有匹配
  return String(res.stdout || "")
    .split(/\s+/)
    .map((s) => Number(s.trim()))
    .filter((p) => p && p !== process.pid && p !== process.ppid);
}

/** 取某个 pid 的命令行（mac/linux 通用）。取不到返回空串。 */
function cmdlineOf(pid) {
  const res = spawnSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8" });
  return res.status === 0 ? String(res.stdout || "").trim() : "";
}

/**
 * 某个 user-data-dir 下还活着几个「应用主进程」。
 * @param {string} ud 门禁的临时 user-data-dir
 * @returns {number} 主进程数（命令行同时含 main.js 与该 ud）
 */
export function countAppMains(ud) {
  return pgrepPids(ud).filter((pid) => {
    const cmd = cmdlineOf(pid);
    return cmd.includes("main.js") && cmd.includes(ud);
  }).length;
}

/**
 * 某个 user-data-dir 下的全部相关进程数（含 Chromium 辅助进程）。
 * 用作「退出后有没有残留」的第二双眼睛：主进程没了但辅助进程还挂着，
 * 是真泄漏，得如实报出来，而不是被实例计数糊过去。
 */
export function countAllGateProcs(ud) {
  return pgrepPids(ud).length;
}

/**
 * 清掉某个 user-data-dir 下的门禁进程（兜底清场用）。
 * 同样不能用 `execSync("pkill -f <ud>")`：那个 `sh -c` 自己的命令行里带着
 * <ud>，pkill 会把承载它的 shell 一起杀了，execSync 于是抛错（被 catch 吞掉，
 * 看起来"清场成功"，实际剩下的进程没杀干净）。
 * @returns {number} 发过 SIGKILL 的进程数
 */
export function killGateProcs(ud) {
  const pids = pgrepPids(ud);
  for (const pid of pids) {
    try { process.kill(pid, "SIGKILL"); } catch { /* 已退出，忽略 */ }
  }
  return pids.length;
}

/* 必须剔除的环境变量。ELECTRON_RUN_AS_NODE 是元凶，其余是"会污染结果但不会报错"的。 */
const DROP = [
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
];

/**
 * 给 playwright 的 _electron.launch 用的干净环境。
 * playwright 客户端接受普通对象（内部会转成 {name,value}[]），服务端再转回对象。
 * @param {Record<string,string>} [extra] 需要额外注入的变量（如 BITBOT_* 开关）
 */
export function electronLaunchEnv(extra) {
  const env = { ...process.env };
  for (const k of DROP) delete env[k];
  return Object.assign(env, extra || {});
}

/**
 * 给门禁用的独立 user data 目录（跑之前重建，避免残留的 SingletonLock）。
 * @param {string} tag 用途标签，不同门禁互不干扰
 */
export function electronUserDataDir(tag) {
  // 启动新的之前，先把上一轮残留下来的旧实例清掉——否则机器上越积越多
  // （实测一次积到 4 个孤儿）。详见 killStaleGateInstances。
  killStaleGateInstances();
  const dir = path.join(os.tmpdir(), "bitbot-e2e-ud-" + (tag || "run"));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 清掉上一次门禁留下的孤儿 Electron 实例。
 *
 * 为什么会有孤儿：门禁进程被 SIGKILL（超时、会话被打断）时，脚本 finally 里的
 * app.quit() 没机会跑，它拉起的 Electron 就成了孤儿——**下一次门禁又启动新实例，
 * 旧的却还挂着**，机器上于是越积越多。这正是"为什么能启动这么多、而不是先移除旧的"
 * 的根因。
 *
 * 匹配特征是命令行里带 `--user-data-dir=…bitbot-e2e-ud-…`：只有门禁会带这个标记，
 * 用户真实运行的应用（默认 profile / 自己的 userData）永远不会被误伤。
 * 杀完等 1s 让端口/单例锁释放，避免下一次 launch 撞锁。
 */
export function killStaleGateInstances() {
  if (process.platform === "win32") return; // 门禁只在 mac/linux 跑，且 ps 语法不同
  // 走 pgrepPids：不再用 execSync("pgrep -f …")，否则这个调用会顺手把自己
  // 所在的 `/bin/sh -c` 杀掉（表现为偶发的 execSync 报错 + 少杀一个真残留）。
  const pids = pgrepPids("bitbot-e2e-ud");
  for (const pid of pids) {
    try { process.kill(pid, "SIGKILL"); } catch { /* 已退出，忽略 */ }
  }
  if (pids.length) execSync("sleep 1", { stdio: "ignore" });
}

/**
 * 这个门禁现在有显示环境吗？
 *
 * 只有 Linux 需要 X server。macOS / Windows 自带窗口系统，**没有 DISPLAY 是
 * 正常的**——初版不少脚本写成"没有 xvfb-run 且没有 DISPLAY 就跳过"，于是 macOS
 * 上这些门禁永远在第一行 SKIP，一次都没真跑过。假跳过不是 PASS。
 */
export function hasDisplay() {
  if (process.platform !== "linux") return true;
  if (process.env.DISPLAY) return true;
  try {
    execSync("command -v xvfb-run", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 给门禁用的隔离 repo 根目录。
 *
 * app 的 REPO_ROOT 来自 main.js 的 resolveRepoRoot()，它认 BITBOT_REPO_ROOT，
 * 但**只认带 moon.mod.json 或 cmd/desktop_turn/main.mbt 的目录**——所以临时根
 * 里把 cmd 软链回真仓库（门禁不跑 moon，只是让根目录解析成立）。
 *
 * 隔离的是 data/：真仓库的 data/desktop 是用户的运行时状态（群聊记录、bot
 * 列表、密钥落盘），门禁绝不能拿夹具去覆盖它，也不能"跑完再还原"——
 * app 退出时的落盘和还原动作会赛跑，还原经常输。
 *
 * @param {string} realRepo 真仓库根（用来软链 cmd）
 * @param {string} tag 用途标签
 * @param {Record<string,any>} [files] 写到 <root>/data/desktop/ 下的夹具文件
 * @returns {string} 临时根路径（调用方负责 rm）
 */
export function isolatedRepoRoot(realRepo, tag, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-e2e-root-" + (tag || "run") + "-"));
  try {
    fs.symlinkSync(path.join(realRepo, "cmd"), path.join(root, "cmd"), "dir");
  } catch {
    /* 软链失败也不致命：resolveRepoRoot 还有回退分支，但隔离性会变弱 */
  }
  const desktopDir = path.join(root, "data", "desktop");
  fs.mkdirSync(desktopDir, { recursive: true });
  for (const [name, content] of Object.entries(files || {})) {
    fs.writeFileSync(
      path.join(desktopDir, name),
      typeof content === "string" ? content : JSON.stringify(content, null, 2)
    );
  }
  return root;
}

/**
 * 门禁启动 app 时的 app 级环境变量。
 *
 * - BITBOT_REPO_ROOT：数据根指向隔离目录，门禁碰不到用户的 data/。
 * - BITBOT_ROUTINE_DAEMON_AUTOSTART=0：不自动拉起定时任务 daemon。
 *   daemon 是长驻进程，会一直往 data/routines 写；门禁跑完还留个后台进程
 *   盯着用户仓库，是纯粹的污染。
 * - BITBOT_DESKTOP_AUTOSTART=0：app 启动时默认会 applyLoginItem(true)，
 *   也就是**改用户 macOS 的开机自启设置**。门禁没这个权限，就别碰。
 */
export function gateAppEnv(root, extra) {
  return {
    BITBOT_REPO_ROOT: root,
    BITBOT_ROUTINE_DAEMON_AUTOSTART: "0",
    BITBOT_DESKTOP_AUTOSTART: "0",
    /* .env.local 是固定路径（hosts/desktop/.env.local），不在 REPO_ROOT 隔离
       范围内。app 启动时会把 env 注入的"密钥"同步进它——不关掉的话，门禁的
       假 key 会写进用户的真文件（实测发生过：真实 LLM 配置被 e2e-stub 顶掉）。 */
    BITBOT_NO_SECRET_SYNC: "1",
    ...(extra || {}),
  };
}
