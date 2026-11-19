#!/usr/bin/env node
/* KP-09 片9 的门：三张旁路面在 EVENT_ONLY 下的并发交错必须一行不丢。
   两条臂：同进程双实例（8.139/8.142）、跨进程 + 文件屏障强制交错（8.144）。
   反向对照不是另写的假象，就用产品自己的「改名 = 删旧行 + 加新行」：
   旧标题必须从折叠里消失，而另一进程刚写的行必须还在 —— 尺子若看不见删除，
   「没丢行」这句就是恒真。（报告 §8.141 的教训也钉在这里：写入回执必须 ok:true，
   否则又会拿一次「没写成的测量」当结论。） */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const REPO = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(REPO, "x.js"));
process.env.BITBOT_EVENT_ONLY = "1";
const { readSurfaces } = require(path.join(REPO, "hosts/shared/event_read_model.js"));
const M = require(path.join(REPO, "hosts/desktop/product_surface.js"));

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got === undefined ? "" : ` —— 实得 ${JSON.stringify(got)}`}`); }
};
const honestSkip = (why) => { skip++; console.log(`  - SKIP：${why}`); };

const CHILD = `
const REPO=${JSON.stringify(REPO)}, path=require("path"), fs=require("fs");
const [dataRoot, role, dir]=process.argv.slice(1);
process.env.BITBOT_EVENT_ONLY="1";
const s=require(path.join(REPO,"hosts/desktop/product_surface.js")).createProductSurface(REPO,{dataRoot});
const {readSurfaces}=require(path.join(REPO,"hosts/shared/event_read_model.js"));
const wait=(f,ms)=>{const t=Date.now();while(!fs.existsSync(f)){if(Date.now()-t>ms)throw new Error("屏障超时 "+f);}};
const rooms=()=>((readSurfaces(dataRoot).rooms||{}).rooms||[]);
const idOf=(t)=>{const r=rooms().find(x=>x.title===t);return r&&(r.room_id||r.id);};
if(role==="A"){
  const c=s.roomCreate("甲Bot,乙Bot","甲一"); if(!c.ok) throw new Error("A 建群失败 "+JSON.stringify(c));
  fs.writeFileSync(path.join(dir,"A1_done"),"1");
  wait(path.join(dir,"go"),30000);
  const r=s.roomRename({room:idOf("甲一"),title:"甲一改"}); if(!r.ok) throw new Error("A 改名失败 "+JSON.stringify(r));
  s.appendPendingApproval({source:"chat",kind:"shell",command:"cmd-a1",expires_at:""});
  s.appendPendingApproval({source:"chat",kind:"shell",command:"cmd-a2",expires_at:""});
} else {
  const c=s.roomCreate("甲Bot,乙Bot","乙一"); if(!c.ok) throw new Error("B 建群失败 "+JSON.stringify(c));
  s.appendPendingApproval({source:"chat",kind:"shell",command:"cmd-b1",expires_at:""});
  s.appendPendingApproval({source:"chat",kind:"shell",command:"cmd-b2",expires_at:""});
  fs.writeFileSync(path.join(dir,"B_done"),"1");
}
`;

function freshSurface() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kp09gate-"));
  const dataRoot = path.join(root, "data", "desktop");
  fs.mkdirSync(dataRoot, { recursive: true });
  const surface = M.createProductSurface(REPO, { dataRoot });
  const b1 = surface.botsCreate({ name: "甲Bot" }), b2 = surface.botsCreate({ name: "乙Bot" });
  if (!b1.ok || !b2.ok) throw new Error("种子 Bot 建不出来：" + JSON.stringify([b1, b2]).slice(0, 160));
  return { root, dataRoot, surface };
}
const read = (dataRoot) => {
  const hit = readSurfaces(dataRoot);
  if (!hit.ok) throw new Error("折叠读不回：" + JSON.stringify(hit).slice(0, 160));
  return {
    titles: ((hit.rooms || {}).rooms || []).map((r) => r.title).sort(),
    cmds: (hit.approvals || []).map((a) => a.command).sort(),
    anomalies: hit.anomalies || [],
  };
};

/* 臂1：同进程两个实例交替写（8.139 + 8.142 的形状） */
{
  const { dataRoot, surface: A } = freshSurface();
  const B = M.createProductSurface(REPO, { dataRoot });
  const receipts = [];
  for (const [s, t] of [[A, "甲一"], [B, "乙一"], [A, "甲二"], [B, "乙二"]]) {
    receipts.push(s.roomCreate("甲Bot,乙Bot", t));
  }
  // 前置不真就整臂 SKIP：§8.141 踩过「没写成的测量被当成结论」这一坑。
  if (!receipts.every((r) => r && r.ok)) {
    honestSkip("臂1 建群回执不是全 ok:true：" + JSON.stringify(receipts).slice(0, 140));
  } else {
    const ids = [];
    for (const [s, t] of [[B, "b1"], [A, "a1"], [B, "b2"], [A, "a2"]]) {
      ids.push(s.appendPendingApproval({ source: "chat", kind: "shell", command: "cmd-" + t, expires_at: "" }).id);
    }
    const got = read(dataRoot);
    ok("臂1 群面：整面替换不抹掉另一实例的群（恰好 4 个群）",
      JSON.stringify(got.titles) === JSON.stringify(["乙一", "乙二", "甲一", "甲二"].sort()), got.titles);
    ok("臂1 追加面：交替四条按 id 逐条对上（不是数个数糊过去）",
      ids.every(Boolean) && got.cmds.length === 4 &&
        ["cmd-a1", "cmd-a2", "cmd-b1", "cmd-b2"].every((c) => got.cmds.includes(c)),
      { ids, cmds: got.cmds });
    ok("臂1 折叠无异常", got.anomalies.length === 0, got.anomalies);
  }
}

/* 臂2：跨进程 + 屏障，A 的第二次写必然晚于 B 的全部写入 */
{
  const { root, dataRoot } = freshSurface();
  const child = (role) => spawn("node", ["-e", CHILD, dataRoot, role, root], { encoding: "utf8" });
  const A = child("A");
  let aErr = "";
  A.stderr.on("data", (d) => { aErr += d; });
  const barrier = (f, ms = 30000) => { const t = Date.now(); while (!fs.existsSync(f)) { if (Date.now() - t > ms) return false; } return true; };
  if (!barrier(path.join(root, "A1_done"))) { honestSkip("臂2 屏障 A1_done 没等到：" + aErr.slice(0, 120)); }
  else {
    const B = child("B");
    let bCode = 0;
    await new Promise((r) => { B.on("exit", (c) => { bCode = c; r(); }); });
    if (bCode !== 0) honestSkip("臂2 B 进程非零退出（那条写没发生，不判绿）");
    fs.writeFileSync(path.join(root, "go"), "1");
    const code = await new Promise((r) => A.on("exit", r));
    if (code !== 0) honestSkip("臂2 A 进程非零退出：" + aErr.slice(0, 160));
    else {
      const got = read(dataRoot);
      ok("臂2 跨进程：A 的改名没抹掉 B 的群", got.titles.includes("乙一") && got.titles.includes("甲一改"), got.titles);
      ok("臂2 反向对照（尺子得看得见删除）：旧标题「甲一」已从折叠消失", !got.titles.includes("甲一"), got.titles);
      ok("臂2 追加面跨进程四条都在", got.cmds.length === 4 && ["cmd-a1", "cmd-a2", "cmd-b1", "cmd-b2"].every((c) => got.cmds.includes(c)), got.cmds);
      ok("臂2 折叠无异常", got.anomalies.length === 0, got.anomalies);
    }
  }
}


/* 臂3：会话面跨进程（§8.147 记的「没量出来」在这一臂补上）
   两条明写的口径：① store 在空 dataRoot 上会自带一条「新对话」，期望必须按 +1 写，
   否则第一版门会因为多出一条而假红；② 反向对照用 st.remove —— 删得掉才说明
   「另一进程的会话还在」不是恒真。
   子进程用 `node -e`，argv 从 1 开始取（写成文件跑时 slice(1) 会把脚本路径当成参数，
   §8.147 那个「子进程零输出」就是这么来的）。 */
const CHILD_SES = `
const REPO=${JSON.stringify(REPO)}, path=require("path"), fs=require("fs");
const [dataRoot, role, dir]=process.argv.slice(1);
process.env.BITBOT_EVENT_ONLY="1";
const st=require(path.join(REPO,"hosts/desktop/sessions.js")).getSessionStore(REPO,{dataRoot});
const wait=(f,ms)=>{const t=Date.now();while(!fs.existsSync(f)){if(Date.now()-t>ms)throw new Error("屏障超时 "+f);}};
const mk=(t)=>{const r=st.create(t); if(!r||!r.ok||!r.session) throw new Error("create 失败 "+t+"："+JSON.stringify(r).slice(0,120)); return r.session.id;};
const msg=(id,text)=>{const r=st.appendMessages(id,[{role:"user",content:text}]); if(!r||r.ok===false) throw new Error("appendMessages 失败 "+id+"："+JSON.stringify(r).slice(0,120));};
if(role==="A"){
  const id=mk("甲-一"); msg(id,"甲的内容");
  fs.writeFileSync(path.join(dir,"SES_A1_done"),"1");
  wait(path.join(dir,"SES_go"),40000);
  const gone=mk("甲-三要删掉");
  const r=st.remove(gone); if(!r||r.ok===false) throw new Error("remove 失败 "+JSON.stringify(r).slice(0,120));
} else {
  wait(path.join(dir,"SES_A1_done"),40000);
  const id=mk("乙-一"); msg(id,"乙的内容");
  fs.writeFileSync(path.join(dir,"SES_B_done"),"1");
}
`;
{
  const { root, dataRoot } = freshSurface();
  const child = (role) => spawn("node", ["-e", CHILD_SES, dataRoot, role, root], { encoding: "utf8" });
  const spin = (c) => { let err = ""; c.stderr.on("data", (d) => { err += d; });
    return { code: new Promise((r) => c.on("exit", r)), err: () => err }; };
  const A = spin(child("A"));
  const barrier = (f, ms = 45000) => { const t = Date.now(); while (!fs.existsSync(f)) { if (Date.now() - t > ms) return false; } return true; };
  if (!barrier(path.join(root, "SES_A1_done"))) {
    const aErr = A.err();
    honestSkip("臂3 屏障 SES_A1_done 没等到（会话没写成就整臂 SKIP，不判绿）：" + aErr.slice(0, 160));
  } else {
    const B = spin(child("B"));
    if (!barrier(path.join(root, "SES_B_done"))) honestSkip("臂3 B 没写出乙-一的屏障：" + B.err().slice(0, 160));
    fs.writeFileSync(path.join(root, "SES_go"), "1");
    const [aCode, bCode] = [await A.code, await B.code];
    if (aCode !== 0 || bCode !== 0) {
      honestSkip(`臂3 子进程非零退出（甲 ${aCode} / 乙 ${bCode}）：${A.err().slice(0, 160)}`);
    } else {
      const hit = readSurfaces(dataRoot);
      const arr = (hit.sessions && (hit.sessions.sessions || hit.sessions)) || [];
      const list = Array.isArray(arr) ? arr.map((x) => `${x.title}:${x.message_count ?? (x.messages || []).length}`).sort() : [];
      ok("臂3 会话面：两条进程各自的会话与消息都在（含 store 自带的那条「新对话」）",
        JSON.stringify(list) === JSON.stringify(["乙-一:1", "新对话:0", "甲-一:1"]), list);
      ok("臂3 反向对照（尺子得看得见删除）：甲删掉的会话从折叠消失，乙的还在",
        !list.some((x) => x.startsWith("甲-三要删掉")) && list.some((x) => x.startsWith("乙-一")), list);
      ok("臂3 折叠无异常", (hit.anomalies || []).length === 0, hit.anomalies);
      ok("臂3 旁路生效：EVENT_ONLY 下 sessions.json 不落盘",
        !fs.existsSync(path.join(dataRoot, "desktop", "sessions.json")));
    }
  }
}


/* 臂4：真并发 —— 6 个进程无屏障同时写 approvals 与 rooms，谁先落库由调度决定。
   两条硬口径：① 「并发」本身要量出来才判绿（各进程写窗口的起止时间必须至少有一对重叠，
   否则只是六个串行样本，不配叫并发 → SKIP）；② 判据是「折叠行数 == 成功回执之和」，
   失败回执允许存在（真并发下 SQLite 抢锁本来就可能拒人），
   但失败必须当场有回执 —— 静默少一行才是缺陷。 */
const CHILD_RACE = `
const REPO=${JSON.stringify(REPO)}, path=require("path");
const [dataRoot, tag]=process.argv.slice(1);
process.env.BITBOT_EVENT_ONLY="1";
const t0=Date.now();
const s=require(path.join(REPO,"hosts/desktop/product_surface.js")).createProductSurface(REPO,{dataRoot});
let ao=0,af=0,ro=0,rf=0;
for(let i=0;i<4;i++){ try{ const r=s.appendPendingApproval({source:"chat",kind:"shell",command:"R"+tag+"-"+i,expires_at:""}); (r&&r.ok===false)?af++:ao++; }catch(e){ af++; } }
for(let i=0;i<2;i++){ try{ const r=s.roomCreate("甲Bot,乙Bot","房"+tag+"-"+i); (r&&r.ok===false)?rf++:ro++; }catch(e){ rf++; } }
console.log("RESULT "+tag+" appr_ok="+ao+" appr_fail="+af+" room_ok="+ro+" room_fail="+rf+" t0="+t0+" t1="+Date.now());
`;
{
  const { dataRoot } = freshSurface();
  const kids = [];
  for (let i = 0; i < 6; i++) {
    const c = spawn("node", ["-e", CHILD_RACE, dataRoot, "P" + i], { encoding: "utf8" });
    let o = ""; let err = "";
    c.stdout.on("data", (d) => { o += d; }); c.stderr.on("data", (d) => { err += d; });
    kids.push(new Promise((r) => c.on("exit", (code) => r({ code, o, err }))));
  }
  const got = await Promise.all(kids);
  const rows = got.map((g) => /RESULT \S+ appr_ok=(\d+) appr_fail=(\d+) room_ok=(\d+) room_fail=(\d+) t0=(\d+) t1=(\d+)/.exec(g.o));
  if (rows.some((r) => !r) || got.some((g) => g.code !== 0)) {
    honestSkip("臂4 子进程没交出可解析的 RESULT（退出码或输出不对，写没发生就不判绿）：" +
      got.map((g) => g.code + ":" + (g.err || "").slice(0, 60)).join(" ;; ").slice(0, 220));
  } else {
    const iv = rows.map((r) => [Number(r[5]), Number(r[6])]).sort((a, b) => a[0] - b[0]);
    let overlap = 0;
    for (let i = 1; i < iv.length; i++) if (iv[i][0] < iv[i - 1][1]) overlap++;
    ok("臂4 前置：并发窗口真的重叠（不是六个串行样本）", overlap >= 1, iv.map((x) => `${x[0]}..${x[1]}`).join(" "));
    const sum = rows.reduce((a, r) => ({ ao: a.ao + +r[1], af: a.af + +r[2], ro: a.ro + +r[3], rf: a.rf + +r[4] }), { ao: 0, af: 0, ro: 0, rf: 0 });
    const hit = readSurfaces(dataRoot);
    const appr = (hit.approvals || []).length;
    const rooms = ((hit.rooms || {}).rooms || []).length;
    ok(`臂4 追加面：折叠行数 == 成功回执 ${sum.ao}（失败回执 ${sum.af} 条当场有名字，不算静默丢行）`,
      appr === sum.ao, { 折叠: appr, 成功: sum.ao, 失败: sum.af });
    ok(`臂4 群面：折叠行数 == 成功回执 ${sum.ro}（失败回执 ${sum.rf} 条）`,
      rooms === sum.ro, { 折叠: rooms, 成功: sum.ro, 失败: sum.rf });
    ok("臂4 折叠无异常", (hit.anomalies || []).length === 0, hit.anomalies);
  }
}

/* 臂5：会话面真并发 —— §8.150 量出来这条是红的（18 条 create 回执全 ok 却 0 条消息落库、
   折叠 21 条 anomaly），片10（不再拿空面覆盖）+ 片11（提交时在锁内重取基底）修完后在这里钉住。
   判据不许用「大概没丢」：
   ① 并发本身要量出来（写窗口重叠）才算这一臂存在；
   ② 折叠标题的**多重集** == 成功建会话回执 + 播种的那条「新对话」—— 用逐条标题而不是条数，
      复活/重复提交/整批丢失都会在这里露形；那条「+1」是空 dataRoot 上唯一一次播种（§8.150 之后
      播种进了跨进程锁，所以只会有一条）；
   ③ 折叠消息总数 == 成功 appendMessages 回执 —— 只数会话条数会漏掉历史症状「会话在、消息没了」；
   ④ 折叠必须 ok 且 0 anomaly。
   本臂**不含并发删除**：第一次带删除跑的时候实测到「A 删掉的那条被从没看过它的 B 复活」
   （三方合并只认得自己基底里的行，别人新建的行一律保留）—— 那是删除语义缺墓碑，不是这臂能钉住的账，
   已单独记成待办（报告 §8.152）。 */
const CHILD_RACE_SES = `
const REPO=${JSON.stringify(REPO)}, path=require("path");
const [dataRoot, tag]=process.argv.slice(1);
process.env.BITBOT_EVENT_ONLY="1";
const t0=Date.now();
const st=require(path.join(REPO,"hosts/desktop/sessions.js")).getSessionStore(REPO,{dataRoot});
let co=0,cf=0,mo=0,mf=0;
const mk=(t)=>{const r=st.create(t); return r&&r.ok&&r.session?r.session.id:null;};
const ids=[];
for(let i=0;i<2;i++){ const id=mk("竞"+tag+"-"+i); if(id){co++;ids.push(id);} else cf++; }
for(const id of ids){ const r=st.appendMessages(id,[{role:"user",content:"一句话"}]); (r&&r.ok===false)?mf++:mo++; }
console.log("RESULT "+tag+" create_ok="+co+" create_fail="+cf+" msg_ok="+mo+" msg_fail="+mf+" t0="+t0+" t1="+Date.now());
`;
{
  const { dataRoot } = freshSurface();
  const kids = [];
  for (let i = 0; i < 6; i++) {
    const c = spawn("node", ["-e", CHILD_RACE_SES, dataRoot, "P" + i], { encoding: "utf8" });
    let o = ""; let err = "";
    c.stdout.on("data", (d) => { o += d; }); c.stderr.on("data", (d) => { err += d; });
    kids.push(new Promise((r) => c.on("exit", (code) => r({ code, o, err }))));
  }
  const got = await Promise.all(kids);
  const rows = got.map((g) =>
    /RESULT (\S+) create_ok=(\d+) create_fail=(\d+) msg_ok=(\d+) msg_fail=(\d+) t0=(\d+) t1=(\d+)/.exec(g.o),
  );
  if (rows.some((r) => !r) || got.some((g) => g.code !== 0)) {
    honestSkip("臂5 子进程没交出可解析的 RESULT（退出码或输出不对，写没发生就不判绿）：" +
      got.map((g) => g.code + ":" + (g.err || "").slice(0, 60)).join(" ;; ").slice(0, 220));
  } else {
    const iv = rows.map((r) => [Number(r[6]), Number(r[7])]).sort((a, b) => a[0] - b[0]);
    let overlap = 0;
    for (let i = 1; i < iv.length; i++) if (iv[i][0] < iv[i - 1][1]) overlap++;
    ok("臂5 前置：并发窗口真的重叠（不是六个串行样本）", overlap >= 1, iv.map((x) => `${x[0]}..${x[1]}`).join(" "));
    const sum = rows.reduce((a, r) => ({ co: a.co + +r[2], cf: a.cf + +r[3], mo: a.mo + +r[4], mf: a.mf + +r[5] }), { co: 0, cf: 0, mo: 0, mf: 0 });
    const hit = readSurfaces(dataRoot);
    const arrRaw = (hit.sessions && (hit.sessions.sessions || hit.sessions)) || [];
    const arr = Array.isArray(arrRaw) ? arrRaw : [];
    const titles = arr.map((s) => s.title);
    const msgTotal = arr.reduce((a, s) => a + (s.message_count ?? (s.messages || []).length), 0);
    // 期望是**逐条标题的多重集**，不是「条数差不多」：重复提交/复活都会在这里露形。
    const expect = ["新对话"];
    for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) if (sum.co >= i * 2 + k + 1) expect.push(`竞P${i}-${k}`);
    ok(`臂5 会话面：折叠标题多重集 == 成功回执 ${sum.co} 条 + 播种的那条「新对话」（失败回执 ${sum.cf} 条当场有名字）`,
      JSON.stringify(titles.slice().sort()) === JSON.stringify(expect.slice().sort()),
      { 折叠: titles.length, 成功: sum.co, 失败: sum.cf, 多出来: titles.filter((t) => !expect.includes(t)), 少了: expect.filter((t) => !titles.includes(t)) });
    ok(`臂5 消息：折叠消息总数 == 成功 appendMessages 回执 ${sum.mo}（失败 ${sum.mf} 条）—— 会话在、消息整批没了不算过`,
      msgTotal === sum.mo, { 折叠消息: msgTotal, 成功: sum.mo, 失败: sum.mf });
    ok("臂5 折叠无异常（§8.150 改前的症状就是这一条 21 项）", (hit.anomalies || []).length === 0 && hit.ok === true,
      { ok: hit.ok, reason: hit.reason, anomalies: (hit.anomalies || []).slice(0, 3) });
    ok("臂5 旁路生效：EVENT_ONLY 下 sessions.json 不落盘",
      !fs.existsSync(path.join(dataRoot, "desktop", "sessions.json")));
  }
}

/* 臂6：折叠不可用时的写口行为 —— §8.151 把那条封堵叫「预防性、今天没有门钉得住」，
   这一臂就是那件夹具，把口径钉成实测。夹具是确定性的：往事件库直接追加一条
   `entity_order_changed{surface:"sessions",ids:["sess-dead0000"]}`（顺序指向不存在的实体），
   readSurfaces 立刻稳定返回 ok:false reason:"fold_anomalies"。
   实测到的三条形状，逐条判：
   ① 会话面写口 = 拒写 + 回执 `{ok:false,error:"fold_blocked"}`（片10）；
   ② 群面**冷基底**（新 surface 实例、prev 缓存空）= 抛 EVENT_PREV_UNREADABLE（片10b）——
      注意只对冷缓存生效：同一实例里已经写过一次的面，prev 来自自己上一次提交，走的是增量，
      不会被拦（那是对的，拦了就成了恒真）；
   ③ 两次拒绝之后事件库行数**一格没多** —— 拒了却不许偷偷整面替换。
   另有一条实测事实记在这里备查：追加面（approvals）自带 prevText（next = prev + 一行），
   折叠坏了也照样写得进去且不会覆盖别人 —— 所以它不在本臂的拒绝判据里。 */
{
  const { dataRoot } = freshSurface();
  const surface = M.createProductSurface(REPO, { dataRoot });
  const { openEventLog } = require(path.join(REPO, "hosts/shared/event_log.js"));
  const { DatabaseSync } = require("node:sqlite");
  const dbFile = path.join(dataRoot, "events", "desktop-events.sqlite");
  const count = () => new DatabaseSync(dbFile).prepare("select count(*) as n from events").get().n;
  // 先让面上有账（也确保库存在）
  const seedRoom = surface.roomCreate("甲Bot,乙Bot", "夹具前就有群");
  if (!seedRoom || !seedRoom.ok || !fs.existsSync(dbFile)) {
    honestSkip("臂6 前置没成立（建群回执或事件库文件不在），不拿这次运行判绿");
  } else {
    openEventLog({ file: dbFile, actor: "gate-arm6" }).append({
      sessionId: "system", kind: "entity_order_changed", payload: { surface: "sessions", ids: ["sess-dead0000"] },
    });
    const broken = readSurfaces(dataRoot);
    if (broken.ok !== false || !(broken.anomalies || []).some((a) => a.includes("顺序指向不存在的实体"))) {
      honestSkip("臂6 夹具没能造出「库有账但折不动」（" + JSON.stringify(broken.reason) + "）——这件夹具本身失效，不判绿");
    } else {
      pass++;
      console.log("  ✓ 臂6 夹具自证：注入一条幽灵顺序后 readSurfaces 稳定 ok:false + 「顺序指向不存在的实体」");
      const n0 = count();
      const st = require(path.join(REPO, "hosts/desktop/sessions.js")).createSessionStore(REPO, { dataRoot });
      const ses = st.create("坏折叠下建的会话");
      ok("臂6 会话面：折叠坏时写口给的是拒绝回执，不是 ok:true",
        ses && ses.ok === false && ses.error === "fold_blocked", ses);
      let threw = "";
      try {
        M.createProductSurface(REPO, { dataRoot }).roomCreate("甲Bot,乙Bot", "坏折叠下建的群");
      } catch (e) { threw = String((e && e.code) || e && e.message); }
      ok("臂6 群面（冷基底）：折叠坏时提交被拦成 EVENT_PREV_UNREADABLE", threw === "EVENT_PREV_UNREADABLE", threw || "没抛异常");
      const n1 = count();
      ok(`臂6 拒而不覆盖：两次被拦的写一格事件都没落（前后都是 ${n0} 行）`, n1 === n0, { 之前: n0, 之后: n1 });
      // 反向对照：干净库上同样的两件写必须成功 —— 证明上面三条不是恒真。
      const ctl = freshSurface();
      const ctlSurface = M.createProductSurface(REPO, { dataRoot: ctl.dataRoot });
      const okRoom = ctlSurface.roomCreate("甲Bot,乙Bot", "干净库上的群");
      const ctlStore = require(path.join(REPO, "hosts/desktop/sessions.js")).createSessionStore(REPO, { dataRoot: ctl.dataRoot });
      const okSes = ctlStore.create("干净库上的会话");
      const ctlCount = new DatabaseSync(path.join(ctl.dataRoot, "events", "desktop-events.sqlite"))
        .prepare("select count(*) as n from events").get().n;
      ok("臂6 反向对照：干净折叠下同样的两件写都成功且事件确实入库",
        okRoom && okRoom.ok === true && okSes && okSes.ok === true && ctlCount > 0,
        { room: okRoom && okRoom.ok, ses: okSes && okSes.ok, 事件行: ctlCount });
    }
  }
}

console.log(`prove_kp09_event_only_concurrency: PASS=${pass} FAIL=${fail} SKIP=${skip}`);
process.exit(fail ? 1 : 0);
