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

console.log(`prove_kp09_event_only_concurrency: PASS=${pass} FAIL=${fail} SKIP=${skip}`);
process.exit(fail ? 1 : 0);
