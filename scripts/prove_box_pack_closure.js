#!/usr/bin/env node
"use strict";

/**
 * prove_box_pack_closure — 「装出来的 Box 能不能起来」的清单级取证
 *
 * 断点（本轮跑 prove_box_routine_sweep.js 撞出来的，HEAD 上就是红的）：
 * 打包脚本按一份手写文件名清单 cp 出 shared/，而 cn_inbound_server.js / host_ffi.js
 * 后来新增的 require 没有回头补这张清单 —— 结果 pack 出来的 Box 一启动就
 * MODULE_NOT_FOUND，手机侧「连上我的电脑」这条链在真机上根本走不通。
 * 单测跑的是仓库里的 hosts/shared/，永远发现不了「打包缺一块」。
 *
 * 判据：
 *   P-00 打包清单能从 pack-box.sh 里解析出来（解析不出来 = 尺子失效，直接红）
 *   P-01 从真入口（box_main.js / host_ffi.js / product_surface.js）出发，把
 *        `require("./x")` 的传递闭包全拉出来，清单里一个都不能缺
 *   P-02 闭包里的每个文件在仓库里真的存在（防止把 require 拼错也当成打包问题）
 *   P-03 清单里没有凭空多出来的幽灵条目（仓库里不存在的文件名）
 *   P-04 这次真的缺的三个模块（desktop_pairing / lan_candidates / machine_presence）
 *        必须在清单里 —— 这条是给回归用的：谁再往 server 上加 require 而不补清单，红在这里
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PACK = path.join(ROOT, "scripts", "pack-box.sh");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d === undefined ? "" : " — " + String(d).slice(0, 400))); };
const check = (c, m, d) => (c ? ok(m) : bad(m, d));

function parseLists(src) {
  // 只认 `for f in a.js b.js \
  //          c.js; do` 这两段；第一段进 shared/，第二段进包根（hosts/desktop 的文件）。
  const blocks = [...src.matchAll(/for f in ([\s\S]*?);?\s*do/g)].map((m) => (
    m[1].replace(/\\\s*/g, " ").split(/\s+/).filter((f) => /^[A-Za-z0-9_.-]+\.js$/.test(f))
  ));
  return { shared: blocks[0] || [], root: blocks[1] || [] };
}

function dirFor(kind) {
  return kind === "shared" ? path.join(ROOT, "hosts", "shared") : path.join(ROOT, "hosts", "desktop");
}

function resolveDep(fromFile, dep) {
  const name = dep.endsWith(".js") ? dep : dep + ".js";
  return { kind: fromFile.kind, name };
}

const REQUIRES = /require\(["']\.\/([^"']+)["']\)/g;

function closure(roots) {
  const seen = new Set();
  const ghosts = [];   // require 了一个仓库里不存在的相对模块
  const queue = roots.slice();
  while (queue.length) {
    const cur = queue.shift();
    const key = cur.kind + "/" + cur.name;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = path.join(dirFor(cur.kind), cur.name);
    if (!fs.existsSync(p)) { ghosts.push(key + "（文件不存在）"); continue; }
    const src = fs.readFileSync(p, "utf8");
    for (const m of src.matchAll(REQUIRES)) {
      const next = resolveDep(cur, m[1]);
      if (!fs.existsSync(path.join(dirFor(next.kind), next.name))) ghosts.push(key + " -> ./" + m[1]);
      queue.push(next);
    }
  }
  return { seen, ghosts };
}

console.log("prove_box_pack_closure — Box 打包清单的传递闭包");

const packSrc = fs.readFileSync(PACK, "utf8");
const lists = parseLists(packSrc);
const sharedSet = new Set(lists.shared);

check(
  lists.shared.length >= 15 && lists.root.length >= 2 && lists.shared.includes("box_main.js"),
  "P-00 打包清单解析得出来（shared=" + lists.shared.length + " 包根=" + lists.root.length + "）",
  "解析结果 = " + JSON.stringify(lists),
);

const packed = new Set([...lists.shared.map((f) => "shared/" + f), ...lists.root.map((f) => "desktop/" + f)]);
const roots = [
  { kind: "shared", name: "box_main.js" },
  { kind: "shared", name: "host_ffi.js" },
  { kind: "desktop", name: "product_surface.js" },
];
const { seen, ghosts } = closure(roots);
const unpacked = [...seen].filter((k) => !packed.has(k)).sort();

check(unpacked.length === 0, "P-01 真入口的 require 闭包全在打包清单里", "缺：" + unpacked.join(", "));
check(ghosts.length === 0, "P-02 闭包里的每个相对依赖在仓库里真的存在", "悬空：" + [...new Set(ghosts)].join(", "));
const ghosts2 = [
  ...lists.shared.filter((f) => !fs.existsSync(path.join(dirFor("shared"), f))),
  ...lists.root.filter((f) => !fs.existsSync(path.join(dirFor("desktop"), f))),
];
check(ghosts2.length === 0, "P-03 清单里没有仓库里不存在的幽灵条目", "幽灵：" + ghosts2.join(", "));
const mustHave = ["desktop_pairing.js", "lan_candidates.js", "machine_presence.js"];
const stillMissing = mustHave.filter((f) => !sharedSet.has(f));
check(stillMissing.length === 0, "P-04 这次补上的三个模块在清单里（回归锚）", "还缺：" + stillMissing.join(", "));

console.log("\nprove_box_pack_closure: pass=" + pass + " fail=" + fail);
process.exit(fail === 0 ? 0 : 1);
