#!/usr/bin/env node
/*
 * diagnose_surfaces.mjs — 把 G-125 那条尺变成一条能当场敲的命令。
 *
 * 为什么要有它：尺今天只有门在用，出了门没人能问「日志侧和旁路 JSON 到底差在哪」。
 * 而 #80 的授权重锚要成立，前提是有人能先说出偏差有多大 —— 所以这条命令是那段工作的
 * 证据面，不是便利贴。
 *
 * 只读：不写任何文件。库不存在时**不去创建**（`surface_parity` 只在文件存在时开库），
 * 因为 dev 的 dataRoot 就是仓库里那份 `data/`，一次误建就会把夹具堆进用户看得见的数据。
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");
const parity = require(path.join(repoRoot, "hosts/shared/surface_parity.js"));

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const positional = argv.filter((a) => !a.startsWith("--"));

const dataRoot = path.resolve(positional[0] || path.join(repoRoot, "data"));
if (!fs.existsSync(dataRoot)) {
  console.error(`数据目录不存在：${dataRoot}`);
  process.exit(2);
}

const result = parity.auditSurfaces({ dataRoot });

// 默认配置下没有日志库是**预期**，不是故障；把这句话打出来，省得「无读数」被当成坏了。
// 判据用「库文件到底在不在」，不用环境变量：上一版拿 env 推，结果是临时库明明在读、
// 输出里却写着 dualWriteOff:true —— 同屏两个来源的数互相矛盾（G-124 臂7 之后这条尤其贵）。
const dbFile = path.join(dataRoot, "events", "desktop-events.sqlite");
const dbPresent = fs.existsSync(dbFile);

if (asJson) {
  console.log(JSON.stringify({ dataRoot, dbPresent, ...result }, null, 2));
} else {
  console.log(`对账尺 · ${dataRoot}`);
  result.records.forEach((rec, i) => {
    console.log(`  [${result.levels[i]}] ${parity.formatWarn(rec)}`);
  });
  console.log(
    `  合计：偏差 ${result.drift} 处 / 无读数 ${result.noReading} 张面（共 ${result.records.length} 张）`,
  );
  if (!dbPresent && result.noReading === result.records.length) {
    console.log(
      `  说明：日志侧没库（${dbFile} 不存在；双写默认关，见 event_mirror.js:454）—— 无读数不是「一致」，也不是故障。`,
    );
  }
}

// 命令本身成功就 0；偏差多大都交给读的人判断（--strict 留给门禁自己用，不在这里发明策略）。
process.exit(0);
