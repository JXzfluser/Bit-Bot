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

console.log(`prove_kp09_event_only_concurrency: PASS=${pass} FAIL=${fail} SKIP=${skip}`);
process.exit(fail ? 1 : 0);
