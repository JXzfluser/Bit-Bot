/* e2e_desktop_creator_pipeline.mjs — GP-155 场景验收：自媒体博主的日更流水线
 *
 * 用户给的原话场景：「我是自媒体博主，我要多个 Bot 做不同的事——热点新闻搜集、
 * 内容编辑、稿件审核；审核通过之后每天定时发文，并且每天定时把内容推送到我的邮箱。」
 *
 * 这一条不测组件、不测函数，只测**用户在真实 Electron 里能不能走通**：
 *
 *   P1 产品 IPC 建 3 个分工 Bot（搜集 / 编辑 / 审核）+ 1 个 3 人群。
 *   P2 群里 @三人布置任务 → 真内核 + 本地 stub provider 跑完 → 群里有成稿回执。
 *   P3 群资料面板：成员 3 行 + 「最多 6 位成员」如实提示 + 「暂无定时任务」空态。
 *   P4 在面板里用中文加「每天早上9点把审核通过的稿子发到 news@example.com」：
 *      必须真的落 store（cron=0 9 * * *、room_id=本群），且 next_due 的**墙钟**
 *      就是 09:00（按 Bot 时区，TZ=Asia/Shanghai）；面板同一条显示 09:00。
 *   P5 「每2分钟…」必须被如实拒绝（GP-138 继承）：不入 store、留 refuse 证据。
 *   P6 到期触发：把 next_due 推到过去再 tick —— 只准备好草稿并挂待批准，
 *      data/mail/sends/ 必须一个文件都不新增（不假装已发，GP-108）。
 *   P7 批准之后才真发：待批准里出现「定时任务」来源的 mail_send，
 *      批准后 data/mail/sends/send-*.json 真出现，内容带收件人和稿件正文。
 *   P8 卫生：本轮新落的行里没有内核/Host 调试串。
 *   P9 面板的「暂停 / 继续」真能按（GP-158）：点一下 store 里 enabled 翻下去、
 *      面板显示「已暂停」、而且 cron 一个字符都不许变；再点回来必须重新排上
 *      下一次（按了继续却永远不再跑，等于开关是装饰）。
 *   P10 面板的「删除」两下才删（GP-161）：第一下只武装成「确认删除」且 store 不动，
 *      超过确认窗口自己退回；两下之后行真的消失、面板回到空态、留底工件带齐
 *      cron/原话/归属群，而这条任务的历史草稿一份不少（删任务 ≠ 毁档案）。
 *      结果话术必须落在常驻的 #ri-rail-status 上——表单收起时 ri-form-msg 是隐藏的。
 *   P11 删掉的任务，它挂出来的待批准邮件在审批队列里要看得见来路（GP-162）：
 *      任务还在时不贴标记（不误报）→ 删掉后那一行仍显示、仍可决定（不藏、不替用户
 *      拒绝），但写明「来源任务已删除」，悬停说明讲清「批准仍会发出这一封」。
 *   P12 在群里直接发一句话排程（不走面板表单）也必须归本群（GP-163）：行的 room_id
 *      就是本群、墙钟 22:00、面板列得到，而且「暂停」按得下去 —— 群回合不把 room 交给
 *      效果执行的话，这条任务会按时发信却在任何面板里不存在，谁也管不着。
 *
 * 缺 electron / xvfb / moon 时诚实 SKIP（exit 0 + SKIP 计数），不伪造 PASS。
 * 用法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_creator_pipeline.mjs
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, hasDisplay } from "./electron_env.mjs";
/* 单实例锁按 user-data-dir 算：不隔离就会撞上用户自己开着的 Bit Bot。 */
const UD = electronUserDataDir("creator-pipeline");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
/* 数据根隔离（§8.182）：这一格以前读的是 **仓库 data/**（dev 模式 DATA_ROOT=repoRoot/data），
   于是门禁的建群/建 Bot/排程直接写进用户看得见的那份数据，而且多个门禁实例（以及用户自己开着的
   Bit Bot）**共用同一个 rooms.json** —— §8.176 量到的 P12 `room_not_found` 就是这个形状：
   P1 刚建的群，到 P12 用时已经不在群面上（别的实例按前缀清夹具会把它清掉）。
   口径按 hosts/desktop/paths.js:99-108 的契约来（BITBOT_DATA_ROOT 是留给门禁的逃生口，但值必须
   是某个根的**直接子目录**，因为内核 cwd = dirname(DATA_ROOT)，且 dev 的 `moon run cmd/desktop_turn`
   要从那个 cwd 解析 cmd/）：临时根 GATE_ROOT + `cmd` 软链 + 整份 data/ 快照，app 侧走
   BITBOT_DATA_ROOT=GATE_ROOT/data，门自己的文件读走同一个 DATA，两侧不许分叉。
   为什么不能直接指向一个空的临时目录（第一版就是这么写的，当场 P1 全红）：根末段不叫 `data`、
   父目录里没有 cmd/ 与 moon.mod 可解析，内核几百毫秒就 kernel_crashed —— 这条耦合写在产品源码里，
   不是门禁能绕过去的，只能照契约铺。 */
const GATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-e2e-creator-"));
try { fs.symlinkSync(path.join(REPO, "cmd"), path.join(GATE_ROOT, "cmd"), "dir"); } catch { /* cmd 已在或不存在 */ }
const DATA = path.join(GATE_ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
for (const name of fs.existsSync(path.join(REPO, "data")) ? fs.readdirSync(path.join(REPO, "data")) : []) {
  /* data/tmp（192MB 的临时文件）和一次历史 import-backup 不参与本轮，也不该被带进隔离根。 */
  if (name === "tmp" || name.startsWith("import-backup-")) continue;
  fs.cpSync(path.join(REPO, "data", name), path.join(DATA, name), { recursive: true });
}
process.on("exit", () => { try { fs.rmSync(GATE_ROOT, { recursive: true, force: true }); } catch { /* 收尾失败不改判据 */ } });
const D = (...p) => path.join(DATA, ...p);
const ROOMS = D("desktop/rooms.json");
const SESSIONS = D("desktop/sessions.json");
const BOTS = D("desktop/bots.json");
const ROUTINES = D("routines/host-routines.json");
const ROUTINE_DIR = D("routines");
const DRAFT_DIR = D("routines/drafts");
const SEND_DIR = D("mail/sends");
const TZ = process.env.GP155_TZ || "Asia/Shanghai";
const STUB_RECORD = path.join(GATE_ROOT, "stub-requests.jsonl");
/* LIVE 模式（批次 6）：不���本地 stub，直接打**真 provider**。
 * 默认关闭 ⇒ CI 的常规跑法一字不变（stub 稳定、免费、可重入）。
 * 打开：BITBOT_CREATOR_LIVE_PROVIDER=1 + 环境里给真 provider 的 key。
 *  ⇒ 这才是「真人用 Bit-Bot 跑一件真实事务」的真实链路证据：
 *   契约是模型**真读**、验收是模型**真过**、产物是模型**真写**出来的。
 * 载荷级取证（stub 录制）在这条路上不存在 ⇒ 那几条断言跳过，
 * 换成真实体验断言（每棒耗时 / 验收结论 / 产物里的链接是不是真的）。 */
const LIVE = process.env.BITBOT_CREATOR_LIVE_PROVIDER === "1";
const MAIL_TO = "news@example.com";

/* 定向回执（批次 4）：模板团队是一条**五棒流水线**，每一棒有**自己的交付契约**
 * （01-inbox / 02-briefs / 03-drafts / 04-review / 06-analysis，各带验收规则）。
 * stub 默认把请求原样回显 ⇒ 回显里没有「http」「事实依据」… ⇒ 每一棒都被
 * 验收**正确驳回** ⇒ 链路在第一棒就断了（这不是产品坏了，是夹具不满足契约）。
 * ⇒ 这里按「这一棒的契约落点」给一份**像样的交付正文**（各满足各的规则），
 * 让五棒真跑完、真落盘 —— 门禁才能验到「产物是成果本身」。
 *
 * 匹配键刻意用「落到「01-inbox」」这种**只在当前棒 prompt 里出现**的片段：
 * ECHO_ALL 模式下五个角色的岗位 prompt 全在同一个请求里，只按目录名匹配会
 * 命中每一棒。 */
const STUB_REPLY_MATCH = {
  "落到「01-inbox」": [
    "情报卡 · 今日核验结果（1/8 条示例）",
    "",
    "1. OpenAI 更新 o3-mini 的推理能力",
    "   来源平台：官方公告页",
    "   原始链接：https://openai.com/index/o3-mini-update",
    "   证据摘录：公告写明在数学与代码基准上较上一代提升，发布日期为公告页标注日期。",
    "   讨论热度：开发者社区讨论集中在推理成本与首字延迟的取舍。",
    "   为什么值得关注：直接影响 AI 使用者单位任务的成本结构。",
    "   待核查问题：定价页是否已同步更新。",
    "   核验状态：已核验（一手官方来源）。",
    "",
    "2. 某开源推理框架发布 v2 版本",
    "   来源平台：GitHub Release",
    "   原始链接：https://github.com/example/infer/releases/tag/v2.0.0",
    "   证据摘录：Release 说明列出破坏性变更与迁移步骤。",
    "   讨论热度：issue 里集中讨论批处理吞吐下降的问题。",
    "   为什么值得关注：影响本地部署用户的升级成本。",
    "   待核查问题：性能回退是否已在后续补丁修复。",
    "   核验状态：已核验（仓库一手来源）。",
  ].join("\n"),
  "落到「02-briefs」": [
    "选题推荐 · 3 个题（按独特性 / 证据强度 / 账号契合度排序）",
    "",
    "题 1｜推理成本下探之后，中小团队的 Agent 该怎么重新算账",
    "   一句话事实：o3-mini 推理更新后，单位任务成本结构变化。",
    "   读者场景：制造业与 AI 落地负责人要决定自建还是调用。",
    "   主角度：不比模型强弱，只比「一次任务多少钱」。",
    "   原始链接与证据：https://openai.com/index/o3-mini-update",
    "   信息缺口：定价页未同步更新，暂以公告为准。",
    "   建议内容形式：成本对照短帖 + 展开版。",
    "   给主笔的写作任务：算一笔单任务成本账，附来源。",
    "",
    "题 2｜开源推理框架 v2 升级，迁移该做还是等",
    "   一句话事实：v2 有破坏性变更，吞吐有回退。",
    "   读者场景：已在本地部署推理栈的工程团队。",
    "   主角度：给一个「等不等」的判断标准。",
    "   原始链接与证据：https://github.com/example/infer/releases/tag/v2.0.0",
    "   信息缺口：回退是否已被后续补丁修复。",
    "   建议内容形式：决策清单。",
    "   给主笔的写作任务：写成三条判断标准。",
    "",
    "题 3｜Agent 落地最常被忽略的合规成本",
    "   一句话事实：多数团队没把审计与留痕算进预算。",
    "   读者场景：准备把 Agent 接进生产流程的负责人。",
    "   主角度：合规是成本项，不是上线后的补丁。",
    "   原始链接与证据：https://example.com/audit-notes",
    "   信息缺口：缺真实预算样本，标为待补证。",
    "   建议内容形式：展开版。",
    "   给主笔的写作任务：把合规成本拆成三项。",
  ].join("\n"),
  "落到「03-drafts」": [
    "候选稿 · 短帖版（正文）",
    "",
    "推理成本这次真的下了一档。我们把一次完整任务的花费拆成三段：模型调用、上下文重读、失败重试。",
    "前两段大家都算得到，第三段几乎没人算。但在我们自己跑的一批真实任务里，重试吃掉了总成本的近四成——因为工具调用失败一次，后面整段推理要重来。",
    "对预算有限的中小团队，这意味着两件事：把重试率当成核心指标盯，而不是只看单次调用单价；以及在选型时优先看失败后的续跑成本，而不是榜单分数。",
    "",
    "事实依据：o3-mini 推理更新公告（https://openai.com/index/o3-mini-update）与开源推理框架 v2 Release（https://github.com/example/infer/releases/tag/v2.0.0）。",
    "仍需确认：定价页是否已同步更新，重试占比的样本量还偏小。",
  ].join("\n"),
  "落到「04-review」": [
    "审校意见 · 候选稿第 1 稿",
    "",
    "总体结论：论点站得住，事实链条有两处需要收紧。",
    "",
    "一、事实核对",
    "   1. 「推理成本下探」表述过宽：公告只说推理能力更新，未给出统一下调口径。建议改为「单次推理成本结构变化」，避免读者误解为全面降价。",
    "   2. 重试占比「近四成」目前只有我们自己的一批样本支撑，不能当行业结论写。建议明确标注样本范围。",
    "   3. 榜单与选型部分没有落到可核验的对比上，建议删去或补一条具体来源。",
    "",
    "二、来源清单",
    "   来源 1：https://openai.com/index/o3-mini-update —— 一手官方公告，可用。",
    "   来源 2：https://github.com/example/infer/releases/tag/v2.0.0 —— 一手仓库 Release，可用。",
    "   来源 3：重试占比 —— 内部样本，需标注样本量，不能与前两条同级。",
    "",
    "三、仍需确认",
    "   定价页是否同步更新；重试样本能否扩到更多任务类型。",
  ].join("\n"),
  "落到「06-analysis」": [
    "本周复盘 · 内容流水线",
    "",
    "一、这周跑了什么",
    "   完成一轮完整链路：情报核验 → 选题 brief → 候选稿 → 事实审校。复盘产物按周归档。",
    "",
    "二、哪里卡住了",
    "   1. 第一棒的核验密度不够，8 条里只有 2 条能直接进选题，浪费了一个选题位。",
    "   2. 审校环节提出的「样本量」问题，在选题阶段就该拦住——闸门放得太晚。",
    "   3. 发布环节仍需人工点头，这周没有自动化，符合预期。",
    "",
    "三、下周怎么改",
    "   把「是否有可核验来源」这一条提前到选题闸门，不合格的线索不占 brief 位。",
    "",
    "数据来源：本周流水线五棒的交付记录与审校意见（情报卡 8 条、brief 3 题、候选稿 1 篇、审校 1 份），样本量偏小，结论只对本周成立。",
  ].join("\n"),
};

let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d === undefined || d === null ? "" : " — " + String(d).slice(0, 400)));
};
function honestSkip(reason) {
  console.log("e2e_desktop_creator_pipeline: SKIP — " + reason);
  console.log("e2e_desktop_creator_pipeline: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!fs.existsSync(ELECTRON)) honestSkip("electron dist missing (" + ELECTRON + ")");
if (!hasDisplay()) honestSkip("no DISPLAY and no xvfb-run");
let moonOk = false;
try { execSync("moon --version", { stdio: "ignore" }); moonOk = true; }
catch {
  const local = path.join(os.homedir(), ".moon/bin/moon");
  if (fs.existsSync(local)) {
    try { execSync('PATH="' + path.dirname(local) + ':$PATH" moon --version', { stdio: "ignore" }); moonOk = true; }
    catch { /* below */ }
  }
}
if (!moonOk) honestSkip("moon toolchain unavailable → 真回合无法验证（诚实 residual，不伪造 PASS）");

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

/* 固定端口 ⇒ 上一轮残留占着就是 EADDRINUSE ⇒ 「stub boot timeout」⇒
 * 后面所有断言级联崩(看着像产品崩了)。⇒ 默认随机端口,可显式覆盖。 */
const STUB_PORT = Number(
  process.env.GP155_STUB_PORT || (21000 + Math.floor(Math.random() * 20000))
);
const NEWS = { name: "GP155News", job: "热点新闻搜集", desc: "只负责搜集当天热点，给出来源清单" };
const EDIT = { name: "GP155Editor", job: "内容编辑", desc: "把选题写成成稿，控制字数和小标题" };
const REVW = { name: "GP155Review", job: "稿件审核", desc: "检查事实与合规，给出通过/打回结论" };
const ROOM_TITLE = "GP155 日更流水线";
const ROUTINE_TEXT = `每天早上9点把审核通过的稿子发到 ${MAIL_TO}`;
const FORBIDDEN = ["已计划", "Host 效果", "BITBOT_LLM_", "LocalBrain", "收到，正在用 MoonBit"];

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
};
const roomRow = (id) => (readJson(ROOMS, { rooms: [] }).rooms || []).find((r) => r && r.id === id) || null;
const routineRows = () => {
  const j = readJson(ROUTINES, []);
  return Array.isArray(j) ? j : j.routines || [];
};
const listFiles = (dir, ext) => {
  try { return fs.readdirSync(dir).filter((f) => !ext || f.endsWith(ext)); } catch { return []; }
};
/** 用 IANA 时区把 ISO 时刻拆成本地墙钟（不引第三方库）。 */
function wallClock(iso, tz) {
  const p = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(iso))) p[part.type] = part.value;
  return { hour: Number(p.hour === "24" ? "0" : p.hour), minute: Number(p.minute), day: Number(p.day), month: Number(p.month) };
}

function startStub() {
  const { spawn } = require("child_process");
  const proc = spawn(
    process.execPath,
    [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")],
    {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BITBOT_STUB_PORT: String(STUB_PORT),
        BITBOT_STUB_ECHO_ALL: "1",
        BITBOT_STUB_ECHO_WIDTH: "1600",
        /* 记录请求载荷（打码后）：用来断言「交作业」的指令与契约目录
           **真的上了线** —— 光断言界面行为不够，得看发出去的那一串字。 */
        BITBOT_STUB_RECORD: STUB_RECORD,
        /* 定向回执：让每一棒交出**满足自己契约**的正文（见 STUB_REPLY_MATCH）。 */
        BITBOT_STUB_REPLY_MATCH: JSON.stringify(STUB_REPLY_MATCH),
      },
    },
  );
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout")), 10000);
    proc.stdout.on("data", (d) => { if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(proc); } });
    proc.stderr.on("data", (d) => console.log("[stub] " + String(d).trim().slice(0, 200)));
    proc.on("error", rej);
  });
}

(async () => {
  console.log("e2e_desktop_creator_pipeline — 自媒体日更真链（GP-155）");
  /* ---- 夹具清场 + 快照（只清自己前缀；运行期新落的文件按名单回收） ---- */
  const sweep = () => {
    let swept = { bots: 0, rooms: 0 };
    try {
      const bs = readJson(BOTS, { bots: [] });
      const keep = (bs.bots || []).filter((b) => !(b && /^GP155/.test(String(b.name || ""))));
      swept.bots = (bs.bots || []).length - keep.length;
      if (swept.bots) { bs.bots = keep; fs.writeFileSync(BOTS, JSON.stringify(bs, null, 2)); }
    } catch { /* 首次运行没有 bots.json */ }
    try {
      const rs = readJson(ROOMS, { rooms: [] });
      const keep = (rs.rooms || []).filter((r) => !(r && String(r.title || "").startsWith(ROOM_TITLE)));
      swept.rooms = (rs.rooms || []).length - keep.length;
      if (swept.rooms) { rs.rooms = keep; fs.writeFileSync(ROOMS, JSON.stringify(rs, null, 2)); }
    } catch { /* 首次运行没有 rooms.json */ }
    return swept;
  };
  const swept = sweep();
  if (swept.bots || swept.rooms) console.log("  · 清掉上一轮遗留夹具：" + JSON.stringify(swept));
  const snap = {
    rooms: fs.existsSync(ROOMS) ? fs.readFileSync(ROOMS) : null,
    sessions: fs.existsSync(SESSIONS) ? fs.readFileSync(SESSIONS) : null,
    bots: fs.existsSync(BOTS) ? fs.readFileSync(BOTS) : null,
    routines: fs.existsSync(ROUTINES) ? fs.readFileSync(ROUTINES) : null,
    routineFiles: new Set(listFiles(ROUTINE_DIR, ".json")),
    draftFiles: new Set(listFiles(DRAFT_DIR, ".json")),
    sendFiles: new Set(listFiles(SEND_DIR, ".json")),
  };
  const restore = () => {
    // 只回收本轮新增的文件，旧的一律不碰（历史行不重写、用户数据不清理）。
    for (const [dir, before] of [[DRAFT_DIR, snap.draftFiles], [SEND_DIR, snap.sendFiles]]) {
      for (const f of listFiles(dir, ".json")) {
        if (!before.has(f)) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch { /* keep */ } }
      }
    }
    for (const f of listFiles(ROUTINE_DIR, ".json")) {
      if (!snap.routineFiles.has(f) && /^(fire-|refuse-)/i.test(f)) {
        try { fs.rmSync(path.join(ROUTINE_DIR, f), { force: true }); } catch { /* keep */ }
      }
    }
    const put = (p, buf) => { buf === null ? fs.rmSync(p, { force: true }) : fs.writeFileSync(p, buf); };
    put(ROOMS, snap.rooms); put(SESSIONS, snap.sessions); put(BOTS, snap.bots); put(ROUTINES, snap.routines);
  };

  let stub = null, app = null;
  try {
    /* 起之前:先按**端口**清残留,再确认端口可绑。
     * ⚠️ 不要按脚本名全量 pkill —— 同门禁起两个 stub 时会杀掉前一个
     * (2026-11-21 在 user_journeys 上踩过:症状是「消息没到 provider」)。 */
    try {
      const out = execSync("lsof -ti tcp:" + STUB_PORT + " 2>/dev/null || true", {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString().trim();
      for (const pid of out.split(/\s+/).filter(Boolean)) {
        try { process.kill(Number(pid), "SIGKILL"); } catch { /* ignore */ }
      }
    } catch { /* 没有 lsof 就跳过 */ }
    if (!LIVE) {
      stub = await startStub();
      /* 起完立刻验活 —— 别等几十秒后症状才炸,那时极难归因。 */
      await new Promise((r) => setTimeout(r, 300));
      if (stub.exitCode !== null || stub.signalCode !== null) {
        throw new Error("stub " + STUB_PORT + " 刚启动就死了(exit=" + stub.exitCode + ")");
      }
    } else {
      console.log("  · LIVE 模式：不起本地 stub，直接打真 provider");
    }
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
      cwd: REPO,
      env: electronLaunchEnv({
        DISPLAY: process.env.DISPLAY || "",
        PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
        MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
        BITBOT_REPO_ROOT: REPO,
        BITBOT_DATA_ROOT: DATA,
        BITBOT_NO_SECRET_SYNC: "1",
        // 门禁不该改用户 macOS 的开机自启设置（app 启动时默认 applyLoginItem(true)）
        BITBOT_DESKTOP_AUTOSTART: "0",
        // 排程必须按可验证的时区算，不能跟着沙箱的 UTC 漂走。
        TZ,
        /* LIVE：不覆盖 provider 三件套 ⇒ 走环境里给的真 provider。
           stub 模式才把端点钉到本地 stub 上。 */
        ...(LIVE
          ? {}
          : {
              BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
              BITBOT_LLM_API_KEY: "e2e-stub-key",
              BITBOT_LLM_MODEL: "e2e-stub",
            }),
        BITBOT_LLM_STREAM: "0",
        BITBOT_ROOM_RESPONDER_TIMEOUT_MS: process.env.BITBOT_ROOM_RESPONDER_TIMEOUT_MS || "150000",
      }),
      timeout: 90000,
    });
    const win = await app.firstWindow({ timeout: 60000 });
    await win.waitForSelector("#composer #text", { timeout: 60000 });
    ok("真 Electron 冷启动（main + preload + index.html）就绪，Bot 时区 " + TZ);

    /* ---------- P1: 三个分工 Bot + 一个群 ---------- */
    const seeded = await win.evaluate(async ([a, b, c, title]) => {
      const enc = (s) => String(s || "").replace(/ +/g, "+");
      const encTitle = (s) => String(s || "").replace(/\+/g, "%2B").replace(/\s+/g, "+").trim();
      const mk = async (o) => {
        const r = await window.bitbot.bots.op({
          phrase: "create bot " + enc(o.name) + " job=" + enc(o.job) + " description=" + enc(o.desc),
        });
        const bot = (r && r.host_payload && r.host_payload.bot) || null;
        return { ok: !!(r && r.ok) && !!bot, id: bot ? bot.id : "", job: bot ? bot.job : "", err: (r && r.error) || "" };
      };
      const ba = await mk(a), bb = await mk(b), bc = await mk(c);
      let room = { ok: false, id: "", members: 0, err: "" };
      if (ba.id && bb.id && bc.id) {
        const rr = await window.bitbot.bots.op({
          phrase: "create group chat bots=" + [ba.id, bb.id, bc.id].join(",") + " title=" + encTitle(title),
        });
        const view = await window.bitbot.rooms.list();
        const payload = (view && view.rooms) || {};
        const list = Array.isArray(payload) ? payload : payload.rooms || [];
        const hit = list.find((x) => x && x.title === title);
        room = { ok: !!(rr && rr.ok) && !!hit, id: hit ? hit.id : "", members: hit ? (hit.members || []).length : 0, err: (rr && rr.error) || "" };
      }
      return { ba, bb, bc, room };
    }, [NEWS, EDIT, REVW, ROOM_TITLE]).catch((e) => ({ crashed: String((e && e.message) || e) }));
    if (!seeded || seeded.crashed) { bad("seed crashed", seeded && seeded.crashed); throw new Error("abort"); }
    const jobs = [seeded.ba, seeded.bb, seeded.bc].map((x) => x.job);
    seeded.ba.ok && seeded.bb.ok && seeded.bc.ok &&
      new Set([seeded.ba.id, seeded.bb.id, seeded.bc.id]).size === 3 &&
      jobs.join("|").includes("搜集") && jobs.join("|").includes("编辑") && jobs.join("|").includes("审核")
      ? ok("P1 三个分工 Bot 建好（搜集 / 编辑 / 审核：" + jobs.join(" · ") + "）")
      : bad("P1 bots.op create", JSON.stringify(seeded).slice(0, 400));
    const roomId = seeded.room.id || "";
    if (!roomId) { bad("P1 建群失败", JSON.stringify(seeded.room)); throw new Error("no room — abort"); }
    ok("P1 群建成，成员 " + seeded.room.members + "（" + roomId + "）");

    /* ---------- P2: 群里 @三人布置任务 → 有成稿回执 ---------- */
    await win.evaluate(() => refreshSidebarRooms());
    await win.waitForSelector('#room-list .agent-item[data-room-id="' + roomId + '"]', { timeout: 30000 });
    await win.click('#room-list .agent-item[data-room-id="' + roomId + '"]');
    await win.waitForFunction(() => {
      const b = document.getElementById("room-banner");
      return b && b.style.display !== "none";
    }, null, { timeout: 30000 });
    const ids = [seeded.ba.id, seeded.bb.id, seeded.bc.id];
    const reportsBefore = ((roomRow(roomId) || {}).transcript || []).filter((e) => e && e.kind === "final_report").length;
    const orch = await win.evaluate(async ([rid, botIds]) => {
      const at = botIds.map((i) => "@" + i).join(" ");
      const r = await window.bitbot.rooms.orchestrate({
        room_id: rid,
        text: at + " 先搜集今天最热的两条 AI 新闻，编成 300 字稿件，最后由审核给出通过或打回。",
      });
      return { ok: Boolean(r && r.ok), error: (r && r.error) || "" };
    }, [roomId, ids]).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
    const gotReport = await win.waitForFunction(
      (want) => document.querySelectorAll("#log .msg.room-report").length > want,
      reportsBefore, { timeout: 180000 }).then(() => true).catch(() => false);
    gotReport && orch.ok
      ? ok("P2 一次布置、三个 Bot 分工跑完并出成稿回执（群转录有 final_report）")
      : bad("P2 群协作未跑通", JSON.stringify({ orch, gotReport }));

    /* ---------- P3: 群资料面板（分段 tab：成员默认段 / 任务段空态） ----------
       面板照团队详情抽屉设计稿改成了 分段 tab（成员/定时任务/资料库），
       内容不再同时可见——成员断言在默认段，任务相关先切到任务段。 */
    await win.click("#room-banner-info");
    await win.waitForFunction(() => document.body.dataset.panel === "room", null, { timeout: 15000 });
    const railMembers = await win.evaluate(() => ({
      tab: (document.querySelector('#room-rail .ri-tab[aria-selected="true"]') || { dataset: {} }).dataset.tab,
      members: document.querySelectorAll("#ri-member-list .ri-member").length,
      limit: (document.getElementById("ri-limit-note") || {}).innerText || "",
    }));
    railMembers.tab === "members" && railMembers.members === 3 && /6/.test(railMembers.limit)
      ? ok("P3 群资料默认停在「成员」段：3 位成员 + 「最多 6 位」如实上限")
      : bad("P3 群资料成员段", JSON.stringify(railMembers).slice(0, 300));
    await win.evaluate(() => setRoomRailTab("routines"));
    await win.waitForTimeout(200);
    const railTasks = await win.evaluate(() => ({
      shown: !document.getElementById("ri-panel-routines").hidden,
      empty: (document.getElementById("ri-routine-list") || {}).innerText || "",
      addVisible: !!document.getElementById("ri-routine-add") &&
        document.getElementById("ri-routine-add").offsetWidth > 0,
    }));
    railTasks.shown && /暂无|沒有|没有/.test(railTasks.empty) && railTasks.addVisible
      ? ok("P3 切到「定时任务」段：「暂无定时任务」空态 + 添加入口可见")
      : bad("P3 群资料任务段", JSON.stringify(railTasks).slice(0, 300));

    /* ---------- P4: 中文排程原话 → 落 store + 墙钟 09:00 + 面板同步 ---------- */
    await win.click("#ri-routine-add");
    await win.waitForFunction(() => document.body.dataset.roomForm === "open", null, { timeout: 10000 });
    await win.fill("#ri-text", ROUTINE_TEXT);
    await win.click("#ri-form-save");
    await win.waitForFunction(() => document.querySelectorAll("#ri-routine-list .ri-item").length > 0,
      null, { timeout: 60000 }).catch(() => {});
    const rows4 = routineRows().filter((r) => r && String(r.room_id || "") === roomId);
    const routine = rows4[0] || null;
    const wc = routine && routine.next_due ? wallClock(routine.next_due, TZ) : null;
    routine && routine.cron === "0 9 * * *" && wc && wc.hour === 9 && wc.minute === 0
      ? ok("P4 「每天早上9点…」建成 cron=" + routine.cron +
        "，next_due 墙钟 " + String(wc.hour).padStart(2, "0") + ":" + String(wc.minute).padStart(2, "0") +
        "（" + TZ + "），room_id 跟着本群")
      : bad("P4 中文排程没落成 09:00", JSON.stringify({ rows: rows4.map((r) => ({ cron: r.cron, next_due: r.next_due, room_id: r.room_id, err: r.schedule_error })) }).slice(0, 500));
    const panelText4 = await win.evaluate(() => ({
      items: document.querySelectorAll("#ri-routine-list .ri-item").length,
      text: (document.getElementById("ri-routine-list") || {}).innerText || "",
      form: (document.getElementById("ri-form-msg") || {}).innerText || "",
    }));
    panelText4.items >= 1 && /09:00/.test(panelText4.text)
      ? ok("P4 面板同条任务显示下次触发 09:00（用户看得见排程，而不是只看到「已创建」）")
      : bad("P4 面板未显示 09:00", JSON.stringify(panelText4).slice(0, 400));
    const routineId = routine ? String(routine.id) : "";

    /* ---------- P5: 过密排程如实拒绝，且不入库（走 UI，和用户点的一模一样） ---------- */
    const rowsBefore5 = routineRows().length;
    await win.evaluate(() => setRoomFormOpen(true)).catch(() => {});
    await win.fill("#ri-text", "每2分钟把稿件提醒我一次");
    await win.click("#ri-form-save");
    await win.waitForFunction(() => {
      const el = document.getElementById("ri-form-msg");
      const s = String((el && el.innerText) || "").trim();
      // 「正在安排…」是进行中的占位，不能拿它当结果：等到终局文案为止。
      return s.length > 0 && !/正在安排|处理中|…$|\.\.\.$/.test(s);
    }, null, { timeout: 40000 }).catch(() => {});
    const refused5 = await win.evaluate(() => ({
      msg: (document.getElementById("ri-form-msg") || {}).innerText || "",
      items: document.querySelectorAll("#ri-routine-list .ri-item").length,
    }));
    const refuseFiles = listFiles(ROUTINE_DIR, ".json").filter((f) => /^refuse-/i.test(f));
    rowsBefore5 === routineRows().length && refused5.items === 1 &&
      /太密|至少|5 分钟|五分钟|间隔/.test(refused5.msg)
      ? ok("P5 「每2分钟…」被如实拒绝并且说清了原因：" + refused5.msg.slice(0, 60).replace(/\n/g, " ") +
        "（未入库，拒绝证据 " + refuseFiles.length + " 份）")
      : bad("P5 过密排程本该被拒且讲清原因", JSON.stringify({ refused5, before: rowsBefore5, now: routineRows().length }).slice(0, 400));

    /* ---------- P6: 到期触发只备草稿 + 挂待批准，绝不自动发 ---------- */
    if (!routineId) { bad("P6 无定时任务可触发", "P4 未落盘"); }
    else {
      const rj = readJson(ROUTINES, []);
      const arr = Array.isArray(rj) ? rj : rj.routines || [];
      const hit = arr.find((r) => r && r.id === routineId);
      if (hit) {
        hit.next_due = new Date(Date.now() - 60000).toISOString();
        fs.writeFileSync(ROUTINES, JSON.stringify(Array.isArray(rj) ? arr : rj, null, 2));
      }
      const sendsBefore = new Set(listFiles(SEND_DIR, ".json"));
      const draftsBefore = new Set(listFiles(DRAFT_DIR, ".json"));
      const ticked = await win.evaluate(async () => {
        const r = await window.bitbot.turn("tick routines", {});
        return { ok: Boolean(r && r.ok), error: (r && r.error) || "" };
      }).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
      await new Promise((r) => setTimeout(r, 3000));
      // 只看本群这条任务的草稿（store 里可能还有别的测试遗留行，别把它们算进来）。
      const newDrafts = listFiles(DRAFT_DIR, ".json").filter(
        (f) => !draftsBefore.has(f) && f.startsWith("routine-" + routineId + "-"),
      );
      const newSends = listFiles(SEND_DIR, ".json").filter((f) => !sendsBefore.has(f));
      const pending = await win.evaluate(() => window.bitbot.approvals.listPending());
      const mine = ((pending && pending.pending) || []).filter((it) => {
        if (!it || it.kind !== "mail_send" || it.status !== "pending") return false;
        if (!String(it.command || "").includes(MAIL_TO)) return false;
        /* ⚠️ 2026-11-21 修：这里原来写的是
         *      Date.parse(it.requested_at) >= Date.now() - 120000
         * requested_at 是 **UTC ISO**(…Z)，而 Date.now() 也是 UTC 毫秒 —— 单看没问题，
         * 但一旦 requested_at 是**别的时区**写出来的（本机 TZ=Asia/Shanghai 时就是 8 小时差），
         * 这条判据会**永远为 false** ⇒ 待批准项明明在队列里，门禁却报「没有待批准入口」。
         * ⇒ 改成**算时间差**，与时区无关：只要是「刚发生的」就算数。
         */
        const reqAt = Date.parse(it.requested_at || "");
        if (!Number.isFinite(reqAt)) return false;
        const ageMs = Date.now() - reqAt;
        return ageMs >= -60000 && ageMs <= 180000;
      });
      const draftRow = newDrafts.length ? readJson(path.join(DRAFT_DIR, newDrafts[0]), {}) : {};
      newDrafts.length >= 1 && draftRow.requires_approval === true && newSends.length === 0
        ? ok("P6 到期只备好草稿（requires_approval=true），未批准前 0 封外发（GP-108 守住）")
        : bad("P6 到期触发行为不符", JSON.stringify({ ticked, newDrafts, draftRow, newSends }).slice(0, 500));
      mine.length >= 1
        ? ok("P6 定时触发进了待批准队列（用户点得到，而不是只在磁盘上留个文件）")
        : bad("P6 到期只落草稿文件，没有任何待批准入口 —— 走不到「批准后才发」",
          JSON.stringify({ pending: ((pending && pending.pending) || []).slice(-3) }).slice(0, 500));

      /* 队列那一行得是人看得懂的，不是协议串（GP-156 同一条链路的可见面） */
      await win.evaluate(() => refreshApprovalQueue());
      await new Promise((r) => setTimeout(r, 800));
      const queueRow = await win.evaluate(() => {
        const box = document.getElementById("approval-queue");
        return box ? String(box.innerText || "") : "";
      });
      /发送邮件|傳送郵件|Send email/.test(queueRow) && queueRow.includes(MAIL_TO) &&
        !queueRow.includes("mail_send") && !queueRow.includes("gmail|")
        ? ok("P6 审批队列行给人看的是「发送邮件 · 发给 news@example.com」，不是 kind/命令原文")
        : bad("P6 审批队列仍在吐协议串", JSON.stringify(queueRow.slice(0, 180)));

      /* ---------- P7: 批准之后真发，落 data/mail/sends/ ---------- */
      const target = mine[0] || null;
      if (!target) bad("P7 无待批准项可放行", "依赖 P6");
      else {
        // GP-165 两道门都要看见：
        //   1) 没批准的 runAllowed 不放行（Host 的一次性 grant 是真的）；
        //   2) 用户真会走的那条路 —— 在队列行上点「本次允许」，由界面把这一次执行完。
        const ungranted = await win.evaluate((it) => window.bitbot.approvals.runAllowed({
          kind: it.kind, command: it.command, bot_id: "agent-bit",
        }), target).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
        const noGrantSends = listFiles(SEND_DIR, ".json").filter((f) => !sendsBefore.has(f));
        ungranted && ungranted.ok === false && ungranted.error === "no_grant" && noGrantSends.length === 0
          ? ok("P7 没批准的 runAllowed 被 Host 拒了（no_grant），且没有偷偷发出一封")
          : bad("P7 未批准的 runAllowed 竟然放行", JSON.stringify({ ungranted, noGrantSends }).slice(0, 300));

        const clicked = await win.evaluate((to) => {
          const box = document.getElementById("approval-queue");
          if (!box) return false;
          const row = Array.from(box.querySelectorAll(".q-item")).find((r) =>
            String(r.innerText || "").includes(to));
          if (!row) return false;
          const b = row.querySelector("button");
          if (!b) return false;
          b.click();
          return true;
        }, MAIL_TO);
        clicked
          ? ok("P7 队列行上点得到「本次允许」按钮（用户真的点得动，不是只有 IPC）")
          : bad("P7 队列行上找不到可点的「本次允许」", String(queueRow).slice(0, 200));
        let sendsNow = [];
        for (let i = 0; i < 40; i += 1) {
          sendsNow = listFiles(SEND_DIR, ".json").filter((f) => !sendsBefore.has(f));
          if (sendsNow.length) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        const sent = sendsNow.length ? readJson(path.join(SEND_DIR, sendsNow[0]), {}) : {};
        const raw = sendsNow.length ? fs.readFileSync(path.join(SEND_DIR, sendsNow[0]), "utf8") : "";
        clicked && sendsNow.length >= 1 && raw.includes(MAIL_TO) && String(sent.to || "").includes(MAIL_TO)
          ? ok("P7 批准后真的发出：data/mail/sends/" + sendsNow[0] + "（收件人 " + MAIL_TO + "）")
          : bad("P7 批准后没有真发", JSON.stringify({ clicked, sendsNow, sent }).slice(0, 500));
      }

      /* ---------- P8: 卫生 —— 本轮新行不吐调试串 ---------- */
      const tx = (roomRow(roomId) || {}).transcript || [];
      const fresh = tx.slice(-12).map((e) => String((e && (e.text || e.content || e.summary)) || "")).join("\n");
      const dirty = FORBIDDEN.filter((s) => fresh.includes(s));
      dirty.length === 0
        ? ok("P8 群转录尾部 " + Math.min(12, tx.length) + " 行无内核/Host 调试串")
        : bad("P8 转录漏调试串", JSON.stringify(dirty));

      /* ---------- P9: 面板上的「暂停 / 继续」真能按（GP-158） ---------- */
      const toggleSel = "#ri-routine-list .ri-item .ri-toggle";
      const rowNow = () => {
        const rj = readJson(ROUTINES, []);
        const arr = Array.isArray(rj) ? rj : rj.routines || [];
        return arr.find((r) => r && r.id === routineId) || null;
      };
      const snapP9 = rowNow();
      const cronBefore = snapP9 ? String(snapP9.cron) : "";
      await win.waitForSelector(toggleSel, { timeout: 15000 }).catch(() => {});
      const labelBefore = await win.evaluate(
        (sel) => { const b = document.querySelector(sel); return b ? String(b.innerText || "").trim() : ""; },
        toggleSel,
      );
      await win.click(toggleSel).catch(() => {});
      let paused = null;
      for (let i = 0; i < 40 && !(paused && paused.enabled === false); i += 1) {
        paused = rowNow();
        await new Promise((r) => setTimeout(r, 250));
      }
      const panelP9 = await win.evaluate(() => ({
        text: (document.getElementById("ri-routine-list") || {}).innerText || "",
        label: (() => { const b = document.querySelector("#ri-routine-list .ri-item .ri-toggle"); return b ? String(b.innerText || "").trim() : ""; })(),
        msg: (document.getElementById("ri-form-msg") || {}).innerText || "",
      }));
      paused && paused.enabled === false && /已暂停/.test(panelP9.text) && paused.cron === cronBefore
        ? ok("P9 按「" + labelBefore + "」真的停了：store enabled=false、面板显示「已暂停」、cron 仍是 " + paused.cron)
        : bad("P9 面板的暂停按钮没有真的管住这条任务", JSON.stringify({ labelBefore, row: paused && { e: paused.enabled, cron: paused.cron }, panel: panelP9 }).slice(0, 500));
      const labelPaused = panelP9.label;
      await win.click(toggleSel).catch(() => {});
      let resumed = null;
      for (let i = 0; i < 40 && !(resumed && resumed.enabled === true); i += 1) {
        resumed = rowNow();
        await new Promise((r) => setTimeout(r, 250));
      }
      const wcP9 = resumed && resumed.next_due ? wallClock(resumed.next_due, TZ) : null;
      resumed && resumed.enabled === true && resumed.lifecycle === "active" &&
        resumed.cron === cronBefore && resumed.next_due && Date.parse(resumed.next_due) > Date.now()
        ? ok("P9 按「" + labelPaused + "」恢复回 active，并重新排上下一次（" +
          String(wcP9.hour).padStart(2, "0") + ":" + String(wcP9.minute).padStart(2, "0") + " " + TZ + "）")
        : bad("P9 恢复后没有重新可运行", JSON.stringify({ labelPaused, row: resumed && { e: resumed.enabled, l: resumed.lifecycle, n: resumed.next_due, c: resumed.cron } }).slice(0, 500));

      /* ---------- P10: 面板上的「删除」两下才删，且删了不毁历史（GP-161） ---------- */
      const removeSel = "#ri-routine-list .ri-item .ri-remove";
      const draftsNow = () => listFiles(DRAFT_DIR, ".json").filter(
        (f) => f.startsWith("routine-" + routineId + "-") && f.endsWith(".json")).length;
      const removeArts = () => listFiles(ROUTINE_DIR, ".json").filter((f) => /^remove-/.test(f));
      const btnState = () => win.evaluate((sel) => {
        const b = document.querySelector(sel);
        return {
          label: b ? String(b.innerText || "").trim() : "",
          armed: !!b && b.classList.contains("ri-remove-armed"),
          items: document.querySelectorAll("#ri-routine-list .ri-item").length,
          list: (document.getElementById("ri-routine-list") || {}).innerText || "",
          status: (document.getElementById("ri-rail-status") || {}).innerText || "",
        };
      }, removeSel).catch(() => ({ label: "", armed: false, items: -1, list: "", status: "" }));
      await win.waitForSelector(removeSel, { timeout: 15000 }).catch(() => {});
      const artsBeforeR = new Set(removeArts());
      const draftsBeforeR = draftsNow();
      const st0 = await btnState();
      await win.click(removeSel).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      const st1 = await btnState();
      const rowAfter1 = rowNow();
      const stillRowText = rowAfter1 ? String(rowAfter1.prompt || "") : "";
      st1.armed && rowAfter1 !== null && /确认|確認|Confirm/i.test(st1.label) &&
        !/确认|確認|Confirm/.test(st0.label) && stillRowText.includes(MAIL_TO)
        ? ok("P10 第一下只是武装：按钮「" + st0.label + "」→「" + st1.label + "」，store 里这条还在（单点不删）")
        : bad("P10 单点即删，或武装态没有在界面上显示", JSON.stringify({ st0, st1, row: rowAfter1 && { e: rowAfter1.enabled, c: rowAfter1.cron } }).slice(0, 400));
      /* 武装窗口到期必须自己退回「删除」：不然下次顺手一点就是一条日更没了 */
      await new Promise((r) => setTimeout(r, 4600));
      const st2 = await btnState();
      st2.armed === false && rowNow() !== null && /删除|刪除|Delete/.test(st2.label) &&
        !/确认|確認|Confirm/.test(st2.label)
        ? ok("P10 只点一下、等超过确认窗口：按钮自己退回「" + st2.label + "」，任务原样还在")
        : bad("P10 武装状态没有超时退回（迟早误删一条日更）", JSON.stringify({ st2, row: rowNow() && rowNow().id }).slice(0, 300));
      await win.click(removeSel).catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
      await win.click(removeSel).catch(() => {});
      let gone = rowNow();
      for (let i = 0; i < 40 && gone !== null; i += 1) {
        gone = rowNow();
        await new Promise((r) => setTimeout(r, 250));
      }
      const st3 = await btnState();
      // 只看本轮新增的那一份留底：任务 id 由原话推导，是稳定的，跑第二遍时目录里
      // 已经躺着一份同前缀的旧留底 —— 按前缀数文件会把上一轮的也算进来（双跑不幂等）。
      const removeMine = removeArts().filter((f) => !artsBeforeR.has(f));
      const art = removeMine.length === 1 ? readJson(path.join(ROUTINE_DIR, removeMine[0]), {}) : {};
      gone === null && st3.items === 0 && /暂无|沒有|没有|No scheduled/.test(st3.list)
        ? ok("P10 两下之后真的删掉了：store 里这条没了，面板回到「暂无定时任务」空态（不是隐藏）")
        : bad("P10 确认删除没有真的生效", JSON.stringify({ row: gone && { e: gone.enabled, c: gone.cron }, st3 }).slice(0, 400));
      const draftsAfterR = draftsNow();
      removeMine.length === 1 && removeMine[0].startsWith("remove-" + routineId + "-") &&
        art.cron === "0 9 * * *" && String(art.prompt || "").includes(MAIL_TO) &&
        art.room_id === roomId && draftsAfterR === draftsBeforeR && draftsAfterR >= 1
        ? ok("P10 删除留底 " + removeMine[0] + "（cron/prompt/room_id 齐，能照着重建）；这条任务的历史草稿 " +
          draftsAfterR + " 份一份没动（删任务不毁档案）")
        : bad("P10 删除没有留下一份可回看的留底，或者顺手清了历史", JSON.stringify({
          added: removeMine, art: { cron: art.cron, prompt: art.prompt, room_id: art.room_id },
          drafts: [draftsBeforeR, draftsAfterR],
        }).slice(0, 400));
      /已删除|已刪|deleted/i.test(st3.status) && /保留|keep/i.test(st3.status)
        ? ok("P10 面板把结果说给人看了：「" + st3.status.trim().replace(/\s+/g, " ").slice(0, 70) + "」")
        : bad("P10 删除结果只改了数据，界面上没有回执（表单收起时 ri-form-msg 是隐藏的，那不算看得见）",
          JSON.stringify({ status: st3.status }).slice(0, 300));

      /* ---------- P11: 删掉的任务，它挂着的待批准邮件在队列里说清来路（GP-162） ---------- */
      const PEND = D("desktop/pending-approvals.jsonl");
      const pendAll = () => {
        try {
          return fs.readFileSync(PEND, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
            try { return JSON.parse(l); } catch { return null; }
          }).filter(Boolean);
        } catch { return []; }
      };
      const myQueueRows = () => pendAll().filter((e) => e && e.source === "routine" &&
        String(e.command || "").includes(MAIL_TO) && e.status === "pending");
      // 重新建一条（面板真点击），触发一次挂出待批准，再把它删掉。
      await win.click("#ri-routine-add").catch(() => {});
      await win.waitForFunction(() => document.body.dataset.roomForm === "open", null, { timeout: 10000 }).catch(() => {});
      await win.fill("#ri-text", ROUTINE_TEXT);
      await win.click("#ri-form-save");
      await win.waitForFunction(() => document.querySelectorAll("#ri-routine-list .ri-item").length === 1,
        null, { timeout: 60000 }).catch(() => {});
      const rows11 = routineRows().filter((r) => r && String(r.room_id || "") === roomId);
      const id11 = rows11.length ? String(rows11[rows11.length - 1].id) : "";
      if (!id11) {
        bad("P11 重建的定时任务没有落 store，测不到孤立批准", JSON.stringify(rows11).slice(0, 200));
      } else {
        const rj11 = readJson(ROUTINES, []);
        const arr11 = Array.isArray(rj11) ? rj11 : rj11.routines || [];
        const hit11 = arr11.find((r) => r && String(r.id) === id11);
        if (hit11) {
          hit11.next_due = new Date(Date.now() - 60000).toISOString();
          fs.writeFileSync(ROUTINES, JSON.stringify(Array.isArray(rj11) ? arr11 : rj11, null, 2));
        }
        await win.evaluate(async () => { await window.bitbot.turn("tick routines", {}); }).catch(() => {});
        let row11 = null;
        for (let i = 0; i < 30 && !row11; i += 1) {
          /* 同 P6：算**时间差**而不是拿 UTC 时间戳去比本地时钟，
           * 否则 TZ≠UTC 的机器上永远挑不出「刚挂出来的」那一行。 */
          row11 = myQueueRows().find((e) => {
            const t = Date.parse(e.requested_at || "");
            if (!Number.isFinite(t)) return false;
            const ageMs = Date.now() - t;
            return ageMs >= -60000 && ageMs <= 180000;
          }) || null;
          if (!row11) await new Promise((r) => setTimeout(r, 500));
        }
        await win.evaluate(() => refreshApprovalQueue()).catch(() => {});
        await new Promise((r) => setTimeout(r, 900));
        const queueBefore = await win.evaluate(() => {
          const box = document.getElementById("approval-queue");
          return { text: box ? String(box.innerText || "") : "", buttons: box ? box.querySelectorAll("button").length : 0 };
        });
        row11 && !/来源任务已删除|來源任務已刪除|Source task deleted/.test(queueBefore.text) &&
          queueBefore.text.includes(MAIL_TO)
          ? ok("P11 任务还在的时候，队列行不带「来源任务已删除」——这个标记不会因为别的理由乱贴")
          : bad("P11 未删除就出现孤立标记，或本轮没挂出待批准", JSON.stringify({ row11: row11 && row11.id, queueBefore: queueBefore.text.slice(0, 160) }).slice(0, 400));
        /* 面板两下删掉这条任务 */
        await win.click(removeSel).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
        await win.click(removeSel).catch(() => {});
        let gone11 = null;
        for (let i = 0; i < 40 && gone11 === null; i += 1) {
          const rr = routineRows().find((r) => r && String(r.id) === id11);
          gone11 = rr ? null : { gone: true };
          if (!gone11) await new Promise((r) => setTimeout(r, 250));
        }
        const rowStill11 = pendAll().find((e) => e && e.id === (row11 && row11.id)) || null;
        await win.evaluate(() => refreshApprovalQueue()).catch(() => {});
        await new Promise((r) => setTimeout(r, 900));
        const queueAfter = await win.evaluate(() => {
          const box = document.getElementById("approval-queue");
          return {
            text: box ? String(box.innerText || "") : "",
            buttons: box ? box.querySelectorAll("button").length : 0,
            orphanRows: box ? box.querySelectorAll(".q-item.q-orphan").length : 0,
            orphanTitle: box && box.querySelector(".q-item.q-orphan") ? String(box.querySelector(".q-item.q-orphan").title || "") : "",
          };
        });
        gone11 && rowStill11 && rowStill11.status === "pending" &&
          /来源任务已删除|來源任務已刪除|Source task deleted/.test(queueAfter.text) &&
          queueAfter.orphanRows >= 1 && queueAfter.text.includes(MAIL_TO)
          ? ok("P11 删掉任务后，队列那一行仍显示（没有被藏、也没有被替用户拒掉），但来路写明了「来源任务已删除」")
          : bad("P11 孤立批准行的界面来路没有说清", JSON.stringify({
            gone: Boolean(gone11), still: rowStill11 && rowStill11.status, after: queueAfter.text.slice(0, 200),
            orphanRows: queueAfter.orphanRows,
          }).slice(0, 400));
        /批准仍会发出|批准仍會發出|still sends/.test(queueAfter.orphanTitle)
          ? ok("P11 悬停说明把后果讲明白了：「" + queueAfter.orphanTitle.slice(0, 46) + "」")
          : bad("P11 只贴标签没讲清批准仍然会发信", JSON.stringify({ title: queueAfter.orphanTitle }).slice(0, 250));
        /* 决定权仍在用户手上：这里用 deny 收尾（既不留在队列里吓人，也不是 Host 代做的） */
        const decided11 = row11
          ? await win.evaluate((id) => window.bitbot.approvals.decide(id, "deny"), row11.id).catch(() => ({ ok: false, error: "ipc_fail" }))
          : { ok: false, error: "no_row" };
        await win.evaluate(() => refreshApprovalQueue()).catch(() => {});
        await new Promise((r) => setTimeout(r, 800));
        const queueFinal = await win.evaluate(() => {
          const box = document.getElementById("approval-queue");
          return { text: box ? String(box.innerText || "") : "", orphanRows: box ? box.querySelectorAll(".q-item.q-orphan").length : 0 };
        });
        decided11 && decided11.ok === true && queueFinal.orphanRows === 0 &&
          !queueFinal.text.includes(MAIL_TO)
          ? ok("P11 用户自己点「拒绝」就能收掉这一行（拒绝后队列回到 0 行孤立项）")
          : bad("P11 孤立批准行无法被用户决定", JSON.stringify({ decided11, queueFinal: queueFinal.text.slice(0, 160) }).slice(0, 400));
      }

      /* ---------- P12: 在群里直接说一句话排程，也要归本群管得了（GP-163） ---------- */
      const before12 = new Set(routineRows().map((r) => String(r && r.id || "")));
      const CHAT_SENTENCE = "@" + seeded.bc.id + " 每天晚上10点把当天的热点汇总发到 " + MAIL_TO;
      const orch12 = await win.evaluate(async ([rid, text]) => {
        const r = await window.bitbot.rooms.orchestrate({ room_id: rid, text });
        return { ok: Boolean(r && r.ok), error: (r && r.error) || "" };
      }, [roomId, CHAT_SENTENCE]).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
      let chatRow = null;
      for (let i = 0; i < 60 && !chatRow; i += 1) {
        chatRow = routineRows().find((r) => r && !before12.has(String(r.id || "")) &&
          String((r && r.prompt) || "").includes(MAIL_TO)) || null;
        if (!chatRow) await new Promise((r) => setTimeout(r, 1000));
      }
      const wc12 = chatRow && chatRow.next_due ? wallClock(chatRow.next_due, TZ) : null;
      chatRow && String(chatRow.room_id || "") === roomId && chatRow.cron === "0 22 * * *" &&
        wc12 && wc12.hour === 22 && wc12.minute === 0
        ? ok("P12 群里发一句话（" + CHAT_SENTENCE.slice(0, 12) + "…）真的建成 cron=" + chatRow.cron +
          "、墙钟 " + String(wc12.hour).padStart(2, "0") + ":" + String(wc12.minute).padStart(2, "0") +
          " 的任务，并且归属就是本群（room_id=" + chatRow.room_id + "）")
        : bad("P12 群里说出来的排程没有归到本群（面板看不见、也管不着）", JSON.stringify({
          orch12,
          found: chatRow && { id: chatRow.id, c: chatRow.cron, r: chatRow.room_id, n: chatRow.next_due, p: String(chatRow.prompt || "").slice(0, 40) },
          newRows: routineRows().filter((r) => !before12.has(String(r.id || ""))).map((r) => ({ id: r.id, c: r.cron, r: r.room_id || "" })),
        }).slice(0, 500));
      if (chatRow) {
        await win.evaluate(() => renderRoomRailRoutines()).catch(() => {});
        await new Promise((r) => setTimeout(r, 1200));
        const panel12 = await win.evaluate(() => ({
          items: document.querySelectorAll("#ri-routine-list .ri-item").length,
          text: (document.getElementById("ri-routine-list") || {}).innerText || "",
        }));
        panel12.items >= 1 && /22:00/.test(panel12.text)
          ? ok("P12 群资料面板列得出这条，下次触发显示 22:00 —— 不是只落了盘而已")
          : bad("P12 面板仍然看不见群里说出来的任务", JSON.stringify(panel12).slice(0, 300));
        await win.click("#ri-routine-list .ri-item .ri-toggle").catch(() => {});
        let paused12 = null;
        for (let i = 0; i < 40 && !(paused12 && paused12.enabled === false); i += 1) {
          paused12 = routineRows().find((r) => r && String(r.id) === String(chatRow.id)) || null;
          await new Promise((r) => setTimeout(r, 250));
        }
        paused12 && paused12.enabled === false
          ? ok("P12 这条任务在面板里按「暂停」真的停得下来（管得住，不是看得见而已）")
          : bad("P12 面板管不住这条任务", JSON.stringify(paused12 && { e: paused12.enabled, l: paused12.lifecycle }).slice(0, 250));
      }
    }
    /* ---------- P13: 模板「一键成队」⇒ 第一件事**真的**发起了 ---------- */
    /* 为什么加这条：以前模板路径传的是空任务 ⇒ 队伍建好了、群里空着、
       成员回合一次都没被触发 —— 用户看到的是「队伍建好了」，然后什么也没发生。
       这正是「入口零学习成本」要消灭的东西：建团之后就该有一件事在跑。 */
    {
      await win.evaluate(() => { const g = document.getElementById("mk-grid"); if (g) g.innerHTML = ""; });
      await win.click("#account-avatar-btn").catch(() => {});
      await win.waitForSelector("#ap-market", { state: "visible", timeout: 5000 }).catch(() => {});
      await win.click("#ap-market").catch(() => {});
      const card = await win
        .waitForSelector('#mk-grid .ca-card[data-template-id="media-content-team"]', { timeout: 15000 })
        .catch(() => null);
      if (!card) {
        SKIP++;
        console.log("  · P13 SKIP 本机环境里模板市场没有团队卡（Host 目录为空）—— 跳过这条，不算绿");
      } else {
        /* 点的是**按钮**，不是卡片：处理函数挂在按钮上（btn.addEventListener），
           点卡片等于没点 —— 这个坑我自己踩过一次。 */
        await win.click('#mk-grid .ca-card[data-template-id="media-content-team"] button').catch(() => {});
        /* 等群建出来 + 第一件事真跑起来。
           模板团队是**五棒流水线** ⇒ 要等 final_report（五棒都跑完）才能验
           「产物是成果本身」；只等第一棒的 bot_reply 会太早。 */
        let room13 = null;
        let tx13 = [];
        let report13 = null;
        for (let i = 0; i < 400; i += 1) {
          const rooms = readJson(ROOMS, { rooms: [] });
          const list = Array.isArray(rooms.rooms) ? rooms.rooms : [];
          room13 = list.find((r) => r && String(r.title || "").indexOf("自媒体内容团队") >= 0) || null;
          if (room13) {
            tx13 = Array.isArray(room13.transcript) ? room13.transcript : [];
            const acted = tx13.some((e) => e && (e.kind === "bot_reply" || e.kind === "bot_reply_error" || e.kind === "final_report"));
            if (acted) {
              report13 = tx13.filter((e) => e && e.kind === "final_report").pop() || null;
              /* 汇报行落盘即流水线跑完；等它出现。 */
              if (report13) break;
            }
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        room13
          ? ok("P13 「一键成队」把团队建起来了（群名=" + String(room13.title || "") + "，成员 " +
              (Array.isArray(room13.members) ? room13.members.length : 0) + " 个）")
          : bad("P13 「一键成队」之后连群都没建起来", JSON.stringify(readJson(ROOMS, {}).rooms || []).slice(0, 200));
        /* 「跑起来了」= 成员**真的答了**（bot_reply），不是 bot_reply_error。
           上一版把 error 行也算「跑起来了」—— 那是我自己写松了：
           回合失败（模型没配上/超时/被拒）也会留下 error 行 ⇒ 断言会假绿。
           ⇒ 现在分两句：派出去了（任何回合行）vs 真答了（成功行）。 */
        const dispatched13 = tx13.some((e) => e && (e.kind === "bot_reply" || e.kind === "bot_reply_error" || e.kind === "final_report"));
        const answered13 = tx13.some((e) => e && e.kind === "bot_reply");
        const errText13 = tx13.filter((e) => e && e.kind === "bot_reply_error")
          .map((e) => String(e.error || e.text || "")).join(" | ");
        dispatched13
          ? ok("P13 第一件事**真的派出去了**：建团完群里立刻有成员回合（不是「队伍建好了，然后什么也没发生」）")
          : bad("P13 建团之后第一件事没跑起来（群里空着）", JSON.stringify(tx13.map((e) => e && e.kind)).slice(0, 200));
        answered13
          ? ok("P13 成员**真的答了**（bot_reply，不是错误行）")
          : bad("P13 那一棒没答上来（只有错误行）", errText13.slice(0, 300));

        /* ---- 流水线（批次 4）：五棒按顺序真跑完，每棒都过验收 ---- */
        const stages13 = (report13 && report13.stage_results) || [];
        const passed13 = stages13.filter((s) => s && s.pass);
        const order13 = stages13.map((s) => String((s && s.name) || "?")).join("→");
        stages13.length >= 5 && passed13.length === stages13.length
          ? ok("P13 流水线**五棒按顺序跑完且都过了验收**（" + passed13.length + "/" + stages13.length +
              "：" + order13 + "）")
          : bad("P13 流水线没跑完或有人没过验收（" + passed13.length + "/" + stages13.length + "）",
                JSON.stringify(stages13.map((s) => [s && s.name, s && s.pass, s && s.reason])).slice(0, 300));
        /* 五棒都过了 ⇒ 五个交付文件都得真落盘（各自目录） */
        const files13 = stages13.map((s) => s && s.artifact_path).filter(Boolean);
        const allExist13 = files13.length >= 5 && files13.every((f) => fs.existsSync(f));
        allExist13
          ? ok("P13 五个角色的交付文件**真落盘**了（各落各的目录：" +
              files13.map((f) => String(f).split("/").slice(-2).join("/")).join(", ") + "）")
          : bad("P13 交付文件没落全（" + files13.length + " 个路径，" +
                files13.filter((f) => fs.existsSync(f)).length + " 个真的存在）",
                JSON.stringify(files13).slice(0, 300));
        /* 产物正文 = 成果本身，不是转述 */
        const dv13 = report13 && report13.deliverable;
        let artifact13 = "";
        if (dv13 && dv13.path && fs.existsSync(dv13.path)) artifact13 = fs.readFileSync(dv13.path, "utf8");
        artifact13.indexOf("推理成本") >= 0 && artifact13.indexOf("事实依据") >= 0
          ? ok("P13 产物正文 = **成果本身**（候选稿的正文在文件里，不是「已完成」那种汇报）")
          : bad("P13 产物正文不是成果本身", (artifact13 || "(产物没落盘)").slice(0, 200));
        /* 载荷级：发出去的那一串字里，**必须**带着「交作业」的指令与契约落点。
           界面行为对了但指令没上线 ⇒ 模型照样会只回一句「已完成」⇒ 这条才是
           真正的防线（批次 1.5 的核心：成员交正文，Host 代写落盘）。 */
        let recs = [];
        try {
          recs = LIVE ? [] : fs.readFileSync(STUB_RECORD, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
        } catch { /* 没记录到就如实判红 */ }
        const bodies = recs.map((r) => (r.messages || []).map((m) => String(m.content || "")).join("\n"));
        /* 诊断用：录下来的每条请求是**哪个 Bot** 的（门禁失败时能一眼看出漏了谁）。 */
        const who = recs.map((r) => {
          const all = (r.messages || []).map((m) => String(m.content || "")).join("\n");
          const nm = all.match(/名字：([^；\n]+)/);
          const relay = all.indexOf("这一轮只有你在做这件事") >= 0;
          /* 岗位说明在 **system 通道**（只进模型请求、不参与内核意图解析）。 */
          const role = (r.messages || []).some((m) =>
            m && m.role === "system" && String(m.content || "").indexOf("你的岗位说明") >= 0);
          return (nm ? nm[1] : "?") + (relay ? "(接力)" : "(DM)") + (role ? "(岗位✓)" : "(岗位✗)");
        });
        /* 诊断只在**有红**时打（门禁绿的时候刷一屏 JSON 只会让人眼瞎）。
           红了才看得出：哪一棒没跑、哪一棒没过、预算花在哪。 */
        if (FAIL > 0) {
          console.log("  · 录到的 provider 请求（诊断）：" + JSON.stringify(who));
          if (report13) {
            console.log("  · 接力链：" + JSON.stringify((report13.relay || []).map((r) => [r && r.name, r && r.ok, r && r.summary])));
            console.log("  · 验收：" + JSON.stringify(report13.stage_results || []));
            console.log("  · 预算：" + JSON.stringify(report13.budget || {}));
          }
        }
        if (LIVE) {
          console.log("  · LIVE 模式：载荷级取证三条跳过（真 provider 没有 stub 录制可查；" +
            "对应的「岗位 prompt 进了 payload」由 data/llm/turns 的 artifact 另行核对）");
        }
        const hasDeliveryRule = !LIVE && bodies.some((b) => b.indexOf("把成果正文完整写在这条回复里") >= 0);
        hasDeliveryRule
          ? ok("P13 载荷级：发给模型的 prompt 里带着「把成果正文完整写在这条回复里」" +
              "（模型知道要交正文，不是交路径）")
          : bad("P13 载荷级：发出去的 prompt 里没有「交作业」指令 ⇒ 模型会只回一句「已完成」",
                "录到的请求：" + JSON.stringify(who));
        const hasContractDir = !LIVE && bodies.some((b) => /0[1-6]-[a-z-]+/.test(b) && b.indexOf("成果会被 Host 落到") >= 0);
        hasContractDir
          ? ok("P13 载荷级：prompt 里带着契约落点（「成果会被 Host 落到 共享目录 X/ 下」）")
          : bad("P13 载荷级：prompt 里没有契约落点 ⇒ 成员不知道交到哪，只会汇报路径",
                "录到的请求：" + JSON.stringify(who));
        const leakedShape = recs.some((r) => JSON.stringify(r).match(/sk-[A-Za-z0-9_-]{8,}/));
        /* key 形状检查在 LIVE 模式下改查真 turn artifact —— 那里也有 Authorization。 */
        leakedShape
          ? bad("P13 载荷级：录下来的请求里出现了 key 形状的明文")
          : ok("P13 载荷级：录下来的请求里没有 key 明文形状");

        /* 载荷级（批次 5）：**每个角色的岗位 prompt 都得真的进了模型**。
         * 以前它只躺在共享目录 00-profile/<角色>.md 里 —— 模型只看得见
         * name + job（60 字）⇒「每条情报要包含哪些字段」「不得凭记忆补数字」
         * 这些硬要求，模型一次都没收到过。 */
        /* 特征串取岗位 prompt 里的**英文角色名**（如「（Scout）」）——
           比「你是我的 XX」更稳：模板措辞会变（「你是我的 X 数据复盘师」），
           而括号里的英文角色名是这条 prompt 独有的。 */
        const bots13b = readJson(BOTS, { bots: [] });
        const roleFeats13 = (bots13b.bots || [])
          .filter((b) => b && b.prompt)
          .map((b) => {
            const m = String(b.prompt).match(/（([A-Za-z]+)）/);
            return { name: b.name, feat: m ? "（" + m[1] + "）" : "" };
          })
          .filter((x) => x.feat);
        const missingRole13 = roleFeats13.filter((x) =>
          !bodies.some((b) => b.indexOf(x.feat) >= 0));
        if (LIVE) {
          /* LIVE：真 turn artifact 里核「岗位 prompt 真进了模型」。 */
          const turnFiles = listFiles(D("llm/turns"), ".json");
          const turnBlobs = turnFiles.map((f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
          const missLive = roleFeats13.filter((x) => turnBlobs.indexOf(x.feat) < 0);
          missLive.length === 0 && turnFiles.length > 0
            ? ok("P13 载荷级（真 provider）：五个角色的岗位 prompt 都进了发给模型的请求（" +
                turnFiles.length + " 份 turn artifact）")
            : bad("P13 载荷级（真 provider）：岗位 prompt 没进请求（turn artifact " +
                turnFiles.length + " 份）", "缺：" + missLive.map((x) => x.name).join("、"));
        }
        roleFeats13.length >= 5 && missingRole13.length === 0
          ? ok("P13 载荷级：五个角色的**岗位 prompt 都进了发给模型的 payload**" +
              "（system 通道：模型知道每棒要交什么、哪些事不能做）")
          : bad("P13 载荷级：这些角色的岗位 prompt 没进 payload ⇒ 模型没收到硬要求",
                "缺：" + missingRole13.map((x) => x.name).join("、"));

        /* 成员的交付契约落进成员记录了 ⇒ 接力才可能按契约验收、按契约落盘。 */
        const bots13 = readJson(BOTS, { bots: [] });
        const withPrompt13 = (bots13.bots || []).filter((b) => b && b.prompt && String(b.prompt).length > 50);
        withPrompt13.length >= 5
          ? ok("P13 岗位 prompt 落进了成员记录（" + withPrompt13.length + " 个成员带 prompt）")
          : bad("P13 成员记录里没有岗位 prompt",
                JSON.stringify((bots13.bots || []).map((b) => [b && b.name, b && String(b.prompt || "").length])).slice(0, 240));
        const withContract = (bots13.bots || []).filter((b) => b && b.deliverable && b.deliverable.dir);
        withContract.length >= 3
          ? ok("P13 角色把交付契约带进了成员记录（" + withContract.length + " 个成员带契约）")
          : bad("P13 成员记录里没有交付契约（接力会退回老行为：拿汇报当交付）",
                JSON.stringify((bots13.bots || []).map((b) => [b && b.name, !!(b && b.deliverable)])).slice(0, 240));
        /* 契约里还要有**流水线顺序**（order）—— 否则五棒只能并行跑，
           后四棒拿不到上游成果（成员读不了共享目录的文件 ⇒ 只能编）。 */
        const ordered = withContract.filter((b) => Number(b.deliverable.order) > 0);
        ordered.length >= 5
          ? ok("P13 契约里带着**流水线顺序**（" + ordered.length + " 个成员有 order ⇒ 按顺序串行跑）")
          : bad("P13 契约里没有 order ⇒ 五棒会被当并行分工跑，后四棒拿不到上游成果",
                JSON.stringify(withContract.map((b) => [b && b.name, b && b.deliverable && b.deliverable.order])).slice(0, 240));

        /* ══════════════════════════════════════════════════════════════════
         * LIVE 断言：真 provider 下「真人用一次」到底是什么样
         * ══════════════════════════════════════════════════════════════════ */
        if (LIVE) {
          const st = report13 && (report13.stage_results || []);
          const allPass = st.length >= 5 && st.every((x) => x && x.pass === true);
          allPass
            ? ok("LIVE-01 真 provider：五棒**每一棒都过了验收**（" + st.length + " 棒）")
            : bad("LIVE-01 真 provider：五棒没全过验收",
                  JSON.stringify(st.map((x) => [x && x.name, x && x.pass, x && (x.reason || x.code)])).slice(0, 400));
          const timed = st.filter((x) => x && Number(x.duration_ms) > 0);
          timed.length >= 5
            ? ok("LIVE-02 真 provider：每一棒的耗时都记下来了（共 " +
                st.reduce((a, x) => a + Number((x && x.duration_ms) || 0), 0) + "ms）")
            : bad("LIVE-02 真 provider：缺每棒耗时（" + timed.length + "/5）");
          /* LIVE-03：**产物里的链接是不是真的**。
             这是真 provider 才验得了的东西 —— stub 交的是固定夹具，链接永远是
             那两条示例 URL；真模型交出来的链接可能是**编的**。
             ⇒ 抽前若干条真的去抓一遍：能打开 / 404 / 连不上，分别计数。
             这不是门禁的 PASS 条件（外网会抖），是给「最真实使用体验」看的
             **实测数据**：模型在这一棒到底交了什么。 */
          const urls = [];
          const seen = new Set();
          for (const f of (files13 || [])) {
            let body = "";
            try { body = fs.readFileSync(f, "utf8"); } catch { /* ignore */ }
            for (const m of String(body).match(/https?:\/\/[^\s)\]}"'<>，。；：、]+/g) || []) {
              if (!seen.has(m)) { seen.add(m); urls.push(m); }
            }
          }
          const sample = urls.slice(0, 6);
          const probe = [];
          for (const u of sample) {
            try {
              const ctl = new AbortController();
              const t = setTimeout(() => ctl.abort(), 8000);
              const resp = await fetch(u, { method: "GET", redirect: "follow", signal: ctl.signal,
                headers: { "User-Agent": "BitBot-gate-probe/1.0" } });
              clearTimeout(t);
              probe.push({ url: u, status: resp.status, ok: resp.ok });
            } catch (e) {
              probe.push({ url: u, status: 0, ok: false, err: String((e && e.message) || e).slice(0, 60) });
            }
          }
          const alive = probe.filter((x) => x.ok).length;
          const dead = probe.filter((x) => !x.ok && x.status >= 400).length;
          const unreach = probe.filter((x) => !x.ok && x.status === 0).length;
          console.log("  · LIVE-03 产物里的链接实测（抽 " + sample.length + " 条）：" +
            "可访问 " + alive + " · 4xx/5xx " + dead + " · 连不上 " + unreach);
          for (const pr of probe) {
            console.log("      " + (pr.ok ? "✓ " : "✗ ") + pr.status + " " + pr.url.slice(0, 110) +
              (pr.err ? "  (" + pr.err + ")" : ""));
          }
          console.log("  · LIVE-04 真 provider 的实测数据（供「最真实使用体验」用）：" +
            JSON.stringify({ 棒数: st.length, 全过: allPass,
              每棒ms: st.map((x) => Number((x && x.duration_ms) || 0)),
              链接总数: urls.length, 抽查: probe.length, 可访问: alive }));
          /* key 不许出现在任何落盘文件里（真 provider 这一轮） */
          let leakHit = "";
          for (const dir of [D("llm/turns"), D("llm"), D("desktop")]) {
            for (const f of listFiles(dir, "")) {
              let t = "";
              try { t = fs.readFileSync(f, "utf8"); } catch { continue; }
              if (t.match(/sk-(cp|api)-[A-Za-z0-9_-]{20,}/)) { leakHit = f; break; }
            }
            if (leakHit) break;
          }
          leakHit
            ? bad("LIVE-05 真 provider：落盘文件里出现了 key 明文：" + leakHit)
            : ok("LIVE-05 真 provider：落盘文件里没有 key 明文");
        }
      }
    }
  } catch (e) {
    bad("gate block", (e && e.stack || String(e)).split("\n").slice(0, 3).join(" | "));
  }
  // 结果先落盘再收尾：关窗卡住也不能让已经跑出来的断言丢掉。
  console.log("e2e_desktop_creator_pipeline: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    if (app) {
      await Promise.race([app.close().catch(() => {}), sleep(20000)]);
      try { const p = app.process(); if (p) p.kill("SIGKILL"); } catch { /* already gone */ }
    }
  } catch { /* ignore */ }
  try { if (stub) stub.kill("SIGKILL"); } catch { /* ignore */ }
  await sleep(1500);
  try {
    // 本轮挂进队列的待批准项不能留给下一轮：按 source=routine 回收自己那条。
    const pendPath = D("desktop/pending-approvals.jsonl");
    if (fs.existsSync(pendPath)) {
      const kept = fs.readFileSync(pendPath, "utf8").split("\n").filter((l) => {
        if (!l.trim()) return true;
        try { const j = JSON.parse(l); return !(j && j.source === "routine"); } catch { return true; }
      });
      fs.writeFileSync(pendPath, kept.join("\n"));
    }
  } catch { /* 保留现场，不因此判失败 */ }
  restore();
  process.exit(FAIL ? 1 : 0);
})();
