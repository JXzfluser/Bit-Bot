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
import { execSync } from "child_process";

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
  try {
    const out = execSync("pgrep -f bitbot-e2e-ud", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const self = process.pid;
    const pids = out
      .split(/\s+/)
      .map((s) => Number(s.trim()))
      .filter((p) => p && p !== self && p !== process.ppid);
    for (const pid of pids) {
      try { process.kill(pid, "SIGKILL"); } catch { /* 已退出，忽略 */ }
    }
    if (pids.length) execSync("sleep 1", { stdio: "ignore" });
  } catch {
    /* pgrep 退出码 1 = 没有匹配进程 = 没有残留，正常，无需处理 */
  }
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
