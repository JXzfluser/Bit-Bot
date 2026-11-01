/* check_box_requires.js — 打包产物里的 require 是否**至少有一条**指得到文件。
 *
 * pack-box.sh 用一张人工维护的允许清单往包里拷 `hosts/shared/*.js`，而包是**平铺**的
 * （hosts/desktop/product_surface.js → <包>/product_surface.js）。这两种事实叠在一起
 * 会产生一类很贵的问题：允许清单少拷一个文件，包照样打完，Box 一开机构造
 * product surface 就抛 `Cannot find module`，被 product_surface_ref.js 的 catch 咽成
 * null —— 用户侧的症状是手机拉待批拿到 503 approval_queue_unavailable（GP-184 撞的
 * 就是这个）。
 *
 * 尺子的口径（按「同一次查找的几条候选」聚类，而不是逐个 require 判）：
 *   - 仓库里既有写法是 try-chain：`../desktop/X` → `../../hosts/desktop/X` → `../X`
 *     （host_ffi.js:26-30、product_surface_ref.js:23-33），三条里**有一条**在平铺包里
 *     指得到就够了。所以按 basename 聚类，簇内任意一条能解析即算通过。
 *   - 一个模块只有一条拼法、而那条在包内指不到 → 红。这正是「允许清单漏拷」和
 *     「平铺布局里写了 dev 专用的 ../shared/…」两种破损的形状。
 * 只看相对 require（`./`、`../`）：内置模块与 node_modules 不归这里管。
 *
 * 用法：node scripts/check_box_requires.js <包目录>
 */
"use strict";

const fs = require("fs");
const path = require("path");

const out = path.resolve(process.argv[2] || "");
if (!out || !fs.existsSync(out)) {
  console.error(`check_box_requires: 目录不存在：${out || "（没传参数）"}`);
  process.exit(2);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
    return e.isFile() && p.endsWith(".js") ? [p] : [];
  });
}

function resolves(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  return [base, `${base}.js`, `${base}.json`, path.join(base, "index.js")].some(
    (p) => fs.existsSync(p) && fs.statSync(p).isFile(),
  );
}

const files = walk(out);
const deadClusters = [];
let clusters = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  /** basename → 这个 basename 的全部拼法；再记一条「有没有解析得动的」。 */
  const byName = new Map();
  for (const m of src.matchAll(/require\(\s*(['"])(\.[^'"]+)\1\s*\)/g)) {
    const spec = m[2];
    const name = path.basename(spec).replace(/\.(js|json)$/, "");
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(spec);
  }
  for (const [name, specs] of byName) {
    clusters += 1;
    if (!specs.some((s) => resolves(file, s))) {
      deadClusters.push(`${path.relative(out, file)} → ${name}（试了 ${specs.join(" / ")}，包内都指不到）`);
    }
  }
}

if (deadClusters.length) {
  console.error(`[pack-box] ${deadClusters.length} 个 require 簇在包内指不到文件（打完也用不起来）：`);
  for (const x of deadClusters) console.error(`  · ${x}`);
  process.exit(1);
}
console.log(`[pack-box] require 自检通过：${files.length} 个 .js、${clusters} 个 require 簇，每簇至少一条指得到文件`);
