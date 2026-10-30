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
 *        相对 require 的传递闭包全拉出来，清单里一个都不能缺
 *        （跨目录的 ../shared/… 也走：GP-184 那天旧 walker 只认 ./x，
 *         product_surface.js 新加的 ../shared/event_mirror 就这么绕过去了）
 *   P-02 闭包里的每个文件在仓库里真的存在（防止把 require 拼错也当成打包问题）
 *   P-03 清单里没有凭空多出来的幽灵条目（仓库里不存在的文件名）
 *   P-04 这次真的缺的三个模块（desktop_pairing / lan_candidates / machine_presence）
 *        必须在清单里 —— 这条是给回归用的：谁再往 server 上加 require 而不补清单，红在这里
 *   P-05 尺子自己的视力：闭包必须真的走过「归一后换目录」的边，否则 P-01 又瞎了
 *   P-06 GP-184 的回归锚：event_mirror / event_log / event_mirror_ref 三个名字各在其位
 *
 * 另一半由 pack-box.sh 收尾的 scripts/check_box_requires.js 盯：它扫**打出来的包**，
 * 按 require 簇判「至少一条候选在包内指得到」—— 平铺布局里写了 dev 专用的
 * ../shared/… 这种「清单拷了但路径还是错的」破损只在那半边现形。
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

/** 一条相对拼法归一到 (kind, name)。四种写法都要认（先认目录段，再退回同目录）：
 *   ./x                        → 同目录
 *   ../shared/x / ../desktop/x → 按目录段判
 *   ../../hosts/{shared,desktop}/x → 同上（仓库里另一种入口布局）
 *   ./shared/x、../x           → 平铺包里的候选：包根文件指到 <包>/shared/x 与 <包>/x，
 *                                也就是源里的 shared/x 与 desktop/x
 * 只看 `.` 开头的：内置模块与 node_modules 不归这里管。
 * try-chain（host_ffi.js:26-30 那种三条候选）会归出同一个 (kind,name)，靠 seen 去重，
 * 所以「三条里有一条能用」不会被误判成「三条都得在清单里」。 */
const REQUIRES = /require\(\s*(['"])(\.[^'"]+)\1\s*\)/g;

function normalize(fromKind, spec) {
  const name = path.basename(spec).replace(/\.(js|json)$/, "") + ".js";
  if (/(^|\/)shared\//.test(spec)) return { kind: "shared", name };
  if (/(^|\/)desktop\//.test(spec)) return { kind: "desktop", name };
  if (spec.startsWith("./")) return { kind: fromKind, name };
  return { kind: "desktop", name };
}

function closure(roots) {
  const seen = new Set();
  const ghosts = [];   // require 了一个仓库里不存在的相对模块
  let crossDir = 0;    // 归一后换了目录的边
  let upEdges = 0;     // 其中来自 `../…` 的：老视力（只认 ./x）一条都走不到
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
      const next = normalize(cur.kind, m[2]);
      if (next.kind !== cur.kind) crossDir += 1;
      if (m[2].startsWith("../")) upEdges += 1;
      if (!fs.existsSync(path.join(dirFor(next.kind), next.name))) ghosts.push(key + " -> " + m[2]);
      queue.push(next);
    }
  }
  return { seen, ghosts, crossDir, upEdges };
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
const { seen, ghosts, crossDir, upEdges } = closure(roots);
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

/* P-05 尺子自己的视力：老版本只认 require("./x")，跨目录的 ../shared/… 一概看不见，
   于是 T1-03 加在 product_surface.js 上的那一句绕过了 P-01，包打完了、Box 开机才炸。
   只数「归一后换目录的边」不够——`./shared/x` 那条平铺拼法也能凑出 1 条；
   所以这里单独数来自 `../…` 的边：老视力下一条都走不到，红得掉。 */
check(
  upEdges >= 1,
  "P-05 闭包真的走跨目录边（`../…` 拼法走通 " + upEdges + " 条；归一后换目录共 " + crossDir + " 条）",
  "来自 ../ 的边一条都没走到：walker 退回只看 ./x，../shared/… 的漏拷它永远看不见",
);

/* P-06 GP-184 的回归锚：event_mirror 这条链的三个名字各在其位。 */
const gp184 = {
  "shared/event_mirror.js 在闭包里": seen.has("shared/event_mirror.js"),
  "shared/event_mirror.js 在清单里": sharedSet.has("event_mirror.js"),
  "desktop/event_mirror_ref.js 在包根清单里": new Set(lists.root).has("event_mirror_ref.js"),
};
const gp184Miss = Object.entries(gp184).filter(([, v]) => !v).map(([k]) => k);
check(gp184Miss.length === 0, "P-06 GP-184 回归锚：event_mirror 这条链三个名字各在其位", "缺：" + gp184Miss.join("、"));

console.log("\nprove_box_pack_closure: pass=" + pass + " fail=" + fail);
process.exit(fail === 0 ? 0 : 1);
