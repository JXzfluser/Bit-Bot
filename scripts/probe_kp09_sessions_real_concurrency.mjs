#!/usr/bin/env node
/* 临时探针（用完即删）：sessions 面跨进程真并发到底是什么形状。
   要量的是三件事，不许推：
   ① 6 个进程各持一份 store，create/appendMessages 的成功与失败回执比例；
   ② 空 dataRoot 上每个进程的 store 初始化都会自带「新对话」——折叠里到底有几条？
   ③ 事件写口的起止时间是否真的重叠（不重叠就不能叫并发）。 */
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kp09p5-"));
const dataRoot = path.join(root, "data", "desktop");
fs.mkdirSync(dataRoot, { recursive: true });
const surface = M.createProductSurface(REPO, { dataRoot });
for (const n of ["甲Bot", "乙Bot"]) {
  const r = surface.botsCreate({ name: n });
  if (!r.ok) throw new Error("种子 Bot 失败 " + JSON.stringify(r).slice(0, 160));
}

const CHILD = `
const REPO=${JSON.stringify(REPO)}, path=require("path");
const [dataRoot, tag]=process.argv.slice(1);
process.env.BITBOT_EVENT_ONLY="1";
const st=require(path.join(REPO,"hosts/desktop/sessions.js")).getSessionStore(REPO,{dataRoot});
const t0=Date.now();
let co=0,cf=0,mo=0,mf=0;
const ids=[];
for(let i=0;i<3;i++){
  try{ const r=st.create("竞"+tag+"-"+i); if(r&&r.ok&&r.session){co++;ids.push(r.session.id);} else cf++; }catch(e){ cf++; }
}
for(const id of ids){
  try{ const r=st.appendMessages(id,[{role:"user",content:"内容"}]); (r&&r.ok===false)?mf++:mo++; }catch(e){ mf++; }
}
console.log("RESULT "+tag+" create_ok="+co+" create_fail="+cf+" msg_ok="+mo+" msg_fail="+mf+" t0="+t0+" t1="+Date.now());
`;

const kids = [];
for (let i = 0; i < 6; i++) {
  const c = spawn("node", ["-e", CHILD, dataRoot, "P" + i], { encoding: "utf8" });
  let o = ""; let err = "";
  c.stdout.on("data", (d) => { o += d; }); c.stderr.on("data", (d) => { err += d; });
  kids.push(new Promise((r) => c.on("exit", (code) => r({ code, o, err }))));
}
const got = await Promise.all(kids);
for (const g of got) {
  console.log(`exit=${g.code} out=${JSON.stringify(g.o.trim())} err=${JSON.stringify(g.err.slice(0, 200))}`);
}
const rows = got.map((g) => /RESULT (\S+) create_ok=(\d+) create_fail=(\d+) msg_ok=(\d+) msg_fail=(\d+) t0=(\d+) t1=(\d+)/.exec(g.o));
const parsed = rows.filter(Boolean).map((r) => r.slice(1));
console.log("parsed_count=", parsed.length);
const iv = parsed.map((p) => [Number(p[5]), Number(p[6])]).sort((a, b) => a[0] - b[0]);
let overlap = 0;
for (let i = 1; i < iv.length; i++) if (iv[i][0] < iv[i - 1][1]) overlap++;
console.log("windows=", iv.map((x) => `${x[0]}..${x[1]}`).join(" "), "overlap_pairs_at_least=", overlap);
console.log("span_ms=", iv.length ? iv[iv.length - 1][1] - iv[0][0] : "n/a");

const hit = readSurfaces(dataRoot);
console.log("readSurfaces_ok=", hit.ok, "reason=", hit.reason, "anomalies=", JSON.stringify(hit.anomalies));
const arr = (hit.sessions && (hit.sessions.sessions || hit.sessions)) || [];
const list = Array.isArray(arr) ? arr.map((x) => `${x.title}:${x.message_count ?? (x.messages || []).length}`).sort() : [];
console.log("fold_sessions_count=", list.length);
console.log("fold_list=", JSON.stringify(list));
console.log("new_default_count=", list.filter((x) => x.startsWith("新对话")).length);
console.log("sum_create_ok=", parsed.reduce((a, p) => a + Number(p[1]), 0));
console.log("sum_msg_ok=", parsed.reduce((a, p) => a + Number(p[3]), 0));
console.log("sessions.json_exists=", fs.existsSync(path.join(dataRoot, "desktop", "sessions.json")),
  "root_sessions.json_exists=", fs.existsSync(path.join(dataRoot, "sessions.json")));
