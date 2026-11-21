#!/usr/bin/env node
/* 取数工具（不是门，别挂进矩阵）：把「并发删除被复活」那一次提交从事件库里抓出来。
   6 进程真并发写 sessions 面，P0 额外建一条哨兵再删掉；跑完直接读 events 表，
   按 seq 打印每一条碰到哨兵 id 的事件（actor + kind + 摘要），并交叉各进程自报的
   「我在写之前看到/没看到哨兵」。要的是因果链，不是对合并规则的猜测。 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const REPO = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(REPO, "x.js"));
process.env.BITBOT_EVENT_ONLY = "1"; // 不设这行，父进程的 readSurfaces 返回 read_disabled（本轮踩过）
const { DatabaseSync } = require("node:sqlite");
const SENTINEL = "哨兵-要删掉";

const CHILD = `
const REPO=${JSON.stringify(REPO)}, path=require("path");
const [dataRoot, tag, sentinel]=process.argv.slice(1);
process.env.BITBOT_EVENT_ONLY="1";
const st=require(path.join(REPO,"hosts/desktop/sessions.js")).getSessionStore(REPO,{dataRoot});
const {readSurfaces}=require(path.join(REPO,"hosts/shared/event_read_model.js"));
const seen=(w)=>{const h=readSurfaces(dataRoot);const a=(h.sessions&&(h.sessions.sessions||h.sessions))||[];return Array.isArray(a)&&a.some(x=>x.title===sentinel)?"Y":"n";};
const ids=[];
for(let i=0;i<3;i++){ const r=st.create("竞"+tag+"-"+i); if(r&&r.ok) ids.push(r.session.id); }
const pre=seen("pre");
for(const id of ids){ st.appendMessages(id,[{role:"user",content:"一句话"}]); }
let removed="";
if(tag==="P0"){
  const r=st.create(sentinel);
  if(r&&r.ok){ removed=r.session.id; st.remove(removed); }
}
console.log("SELF "+tag+" 写前见哨兵="+pre+" 我删的id="+removed);
`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kp09del-"));
const dataRoot = path.join(root, "data", "desktop");
fs.mkdirSync(dataRoot, { recursive: true });
require(path.join(REPO, "hosts/desktop/product_surface.js")).createProductSurface(REPO, { dataRoot });

const kids = [];
for (let i = 0; i < 6; i++) {
  const c = spawn("node", ["-e", CHILD, dataRoot, "P" + i, SENTINEL], { encoding: "utf8" });
  let o = "", e = "";
  c.stdout.on("data", (d) => { o += d; }); c.stderr.on("data", (d) => { e += d; });
  kids.push(new Promise((r) => c.on("exit", (code) => r({ code, o, e }))));
}
const got = await Promise.all(kids);
const me = /我删的id=(sess-\w+)/.exec(got.map((g) => g.o).join(""));
const SENTINEL_ID = me ? me[1] : "sess-none";
for (const g of got) {
  if (g.code !== 0) console.log("子进程非零退出：" + g.e.slice(0, 200));
  process.stdout.write(g.o);
}

const dbFile = path.join(dataRoot, "events", "desktop-events.sqlite");
const db = new DatabaseSync(dbFile);
const cols = Object.keys(db.prepare("select * from events limit 1").get() ?? {});
console.log("\nevents 列：" + cols.join(","));
const rows = db.prepare("select * from events order by seq").all();
// 哨兵的行内容里必有它的 id；先按标题找出 id，再列出所有带该 id 的事件。
const idList = [];
for (const r of rows) {
  const t = JSON.stringify(r);
  if (t.includes(SENTINEL)) {
    const m = /sess-[0-9a-f]{6,}/.exec(t);
    if (m && !idList.includes(m[0])) idList.push(m[0]);
  }
}
const idEvents = rows.filter((r) => {
  const t = JSON.stringify(r);
  return t.includes(SENTINEL) || idList.some((id) => t.includes(id));
});
const { readSurfaces } = require(path.join(REPO, "hosts/shared/event_read_model.js"));
const fold = readSurfaces(dataRoot);
const arr = (fold.sessions && (fold.sessions.sessions || fold.sessions)) || [];
const titles = Array.isArray(arr) ? arr.map((x) => x.title) : [];
const alive = titles.includes(SENTINEL);
console.log(`\n折叠：ok=${fold.ok} reason=${fold.reason ?? "-"} 会话数=${titles.length} anomalies=${(fold.anomalies || []).length}`);
console.log(`哨兵在折叠里=${alive ? "是（复活）" : "否"}`);
const removedSeq = Math.min(...rows.filter((r) => r.kind === "entity_removed" && String(r.session_id).length &&
  JSON.stringify(r).includes(SENTINEL_ID)).map((r) => r.seq).filter((n) => Number.isFinite(n)));
console.log(`\n标题：${JSON.stringify(titles)}`);
console.log(`\n碰到哨兵的事件（seq | actor | kind）：`);
for (const r of rows.filter((x) => JSON.stringify(x).includes(SENTINEL_ID) || JSON.stringify(x).includes(SENTINEL))) {
  const pl = typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload);
  console.log(`  ${r.seq} | ${r.actor} | ${r.kind}${r.seq > removedSeq ? "  ← 删除之后又写到它" : ""}${pl.length > 150 ? " | " + pl.slice(0, 150) : " | " + pl}`);
}
if (alive) {
  const after = rows.filter((r) => r.seq > removedSeq);
  console.log(`\n复活：删除在 seq=${removedSeq}，之后还有 ${after.length} 条事件，前 6 条：`);
  for (const r of after.slice(0, 6)) console.log(`  ${r.seq} | ${r.actor} | ${r.kind} | ${String(r.payload).slice(0, 200)}`);
}
console.log(`\n事件总数=${rows.length}`);
fs.rmSync(root, { recursive: true, force: true });
