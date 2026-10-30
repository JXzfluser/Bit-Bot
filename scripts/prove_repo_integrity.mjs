/* prove_repo_integrity.mjs — GP-171 / GP-181：提交进分支的源码必须先是「跑得动的源码」
 *
 * 这一门来自一次真实事故（2026-10-29）：远端 `cursor/next-target-v1` 的
 * `a0ec929` 把一个**冲突没解完**的工作树提交了上去 ——
 *   hosts/desktop/product_surface.js  里留了 2 组 `<<<<<<< / ======= / >>>>>>>`
 *   scripts/prove_room_orchestrator.js 里留了 1 组，还有一份重复的 `noRunner` 夹具
 * 结果：桌面 App 一 require product_surface 就 SyntaxError（整个应用起不来），
 * 编排门也根本跑不了。而当时的矩阵/CI 没有任何一条会看这件事 —— 门禁都在
 * 「解析之后」执行，源码本身坏了它们连启动都到不了。
 *
 * 本门问五件事：
 *   I-01 被 git 跟踪的源文件里没有冲突标记
 *   I-02 所有被跟踪的 .js / .mjs 都能通过 `node --check`
 *   I-03 负向/正向对照：代码里的标记必须被抓住、文档 ``` 围栏内的逐字引用不误报、
 *        围栏外的标记照样抓住、干净文件能通过
 *   I-04 被跟踪的 .sh 里，可能为空的数组不会在 `set -u` 下被裸展开
 *   I-05 I-04 这把尺子自身的负向/正向对照
 *
 * I-04 的口径（2026-10-30）：macOS 自带的 /bin/bash 是 3.2，`set -u` 下
 * `"${ARR[@]}"` 摊到空数组会直接 "unbound variable" 退出（bash 4.4 才修）。
 * 这不是语法错，`bash -n` 全绿，只有真跑到那条分支才炸 —— 一天内连炸三处：
 *   矩阵 G-59 的 gp170_xvfb 把整轮带崩（PASS=…/FAIL=1，后面的门根本没跑）
 *   pack-box.sh 的 BUILD_FLAGS 让 debug profile 直接死在 moon build 之前
 *   prove_agent_context/prove_kernel_binary/prove_product_tools 的 FLAGS 同型
 * 三种本仓认可的写法：`${ARR[@]+"${ARR[@]}"}`（矩阵/pack-box 用）、
 * 或同文件里先做 `[[ ${#ARR[@]} -gt 0 ]]` 长度判断（pack-desktop.sh 用）、
 * 或数组字面量就非空（那样 `=()` 根本不出现）。只有「`=()` 起空 + 文件里有
 * `set -u` + 裸展开 + 全文件找不到该数组的长度判断」四件同时成立才算红。
 *
 * I-01 的口径（2026-10-29 修）：冲突标记的危害是「被解析的东西坏掉」。本仓的验收报告
 * 必须逐字留证（把 node 的 SyntaxError 连同 `<<<<<<< HEAD` 那几行原文贴进 §8.35），
 * 所以 `.md` 里**围栏内的**标记视为引用，不算未解冲突；围栏外、以及所有非文档
 * 文件里的标记照旧算红。这个豁免不能宽到「.md 整份不扫」—— 否则真在 README 里
 * 留一组冲突标记也会被放过。
 *
 * 它不判断业务，只判断「提交的东西至少是一份跑得动的源码」。
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

let PASS = 0,
  FAIL = 0,
  SKIP = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : ""));
};
const done = () => {
  console.log("prove_repo_integrity: pass=" + PASS + " fail=" + FAIL + " skip=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

const MARKER_LINE = /^(<<<<<<< |>>>>>>> )/;

/** 一个文件里是否有「未解冲突」标记。只读文本，不执行。
 *  `.md` 的代码围栏内是引用（验收报告要逐字贴 SyntaxError 原文），围栏外照罚。 */
function hasConflictMarker(text, file) {
  const isDoc = /\.md$/i.test(file);
  let fence = null; // 当前围栏用的字符（` 或 ~）
  for (const line of text.split("\n")) {
    if (isDoc) {
      const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (!fence) fence = f[1][0];
        else if (f[1][0] === fence) fence = null;
        continue;
      }
      if (fence) continue;
    }
    if (MARKER_LINE.test(line)) return true;
  }
  return false;
}

/** 返回 [违规文件…]。 */
function findConflictMarkers(files) {
  const hits = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(REPO, f), "utf8");
    } catch (_) {
      continue; // 删除/子模块等读不到的条目不算违规
    }
    if (hasConflictMarker(text, f)) hits.push(f);
  }
  return hits;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

function isSource(f) {
  if (!/\.(js|mjs|cjs)$/.test(f)) return false;
  // 第三方/构建产物不归本门管；它们不是我们提交的源码。
  return !/(^|\/)(node_modules|vendor|_build|artifacts|dist)\//.test(f);
}

function isShell(f) {
  if (!/\.sh$/.test(f)) return false;
  return !/(^|\/)(node_modules|vendor|_build|artifacts|dist)\//.test(f);
}

const SET_U = /(^|[^-\w])set\s+-[a-z]*u/;

/** bash 3.2 + `set -u` 下会炸的空数组裸展开。返回命中数组名+行号。
 *
 * 判「裸」不能靠 lookbehind：`${ARR[@]+"${ARR[@]}"}` 的内层前面是 `"` 而不是 `+`，
 * 只看前一个字符会把这条惯用法误报成违规。所以先把整条受保护的展开
 * （`${ARR[@]+…}`）和带默认值的展开（`${ARR[@]:-…}`）从行里剥掉，
 * 剩下的里再出现 `${ARR[@]}` / `${ARR[*]}` 才是真裸的 —— 一行里既用惯用法
 * 又另留一处裸展开，照样抓住。
 */
function bareEmptyArrayLine(name, line) {
  const stripped = line
    .replace(new RegExp("\\$\\{" + name + "\\[(?:@|\\*)\\]\\+[^}]*\\}", "g"), "")
    .replace(new RegExp("\\$\\{" + name + "\\[(?:@|\\*)\\]:[^}]*\\}", "g"), "");
  return new RegExp("\\$\\{" + name + "\\[(?:@|\\*)\\]").test(stripped);
}

function shellEmptyArrayHazards(text) {
  if (!SET_U.test(text)) return [];
  const lines = text.split("\n");
  const emptyAt = new Map(); // 名字 → 第一次 `NAME=()` 的行号
  for (let i = 0; i < lines.length; i++) {
    // 不锚行首：`local NAME=()` 可能在同一行的函数体里。可选前缀覆盖
    // local/declare/typeset/export —— 函数里的空数组一样会炸
    // （本仓 turn_json 的 `local extra=()` 就是全部 kind 断言的入口）。
    const re = /(?:(?:local|declare|typeset|export)\s+(?:-a\s+)?)?([A-Za-z_]\w*)=\(\)/g;
    for (const m of lines[i].matchAll(re)) {
      if (!emptyAt.has(m[1])) emptyAt.set(m[1], i + 1);
    }
  }
  const hits = [];
  for (const [name, declLine] of emptyAt) {
    // 同文件里对这个数组做过长度判断 = 走了另一种安全写法，不算 hazard。
    if (text.includes("${#" + name + "[@]}")) continue;
    for (let i = 0; i < lines.length; i++) {
      // 整行注释跳过：门禁注释里常引用 `"${ARR[@]}"` 这种形状来解释坑本身，
      // 把它当违规会让「写下这个坑」变成翻红。（行中有 # 的不放 —— 那可能真是命令。）
      if (/^[ \t]*#/.test(lines[i])) continue;
      if (bareEmptyArrayLine(name, lines[i])) {
        hits.push({ name, declLine, useLine: i + 1 });
        break;
      }
    }
  }
  return hits;
}

/** 返回 [{file, name, declLine, useLine}…]。 */
function findShellHazards(files) {
  const out = [];
  for (const f of files.filter(isShell)) {
    let text;
    try {
      text = fs.readFileSync(path.join(REPO, f), "utf8");
    } catch (_) {
      continue;
    }
    for (const h of shellEmptyArrayHazards(text)) out.push({ file: f, ...h });
  }
  return out;
}

try {
  /* ---------- I-00 仓库可用 ---------- */
  const all = trackedFiles();
  if (!all.length) {
    bad("I-00 git ls-files 能列出被跟踪文件");
    done();
  }
  ok("I-00 git ls-files 列出 " + all.length + " 个被跟踪文件");

  /* ---------- I-01 没有冲突标记 ---------- */
  const marked = findConflictMarkers(all);
  if (marked.length) {
    bad("I-01 被跟踪文件里没有冲突标记", marked.join(", "));
  } else {
    ok("I-01 被跟踪文件里没有冲突标记（" + all.length + " 个文件全扫）");
  }

  /* ---------- I-02 所有 JS 都能解析 ---------- */
  const sources = all.filter(isSource);
  const broken = [];
  for (const f of sources) {
    try {
      execFileSync(process.execPath, ["--check", path.join(REPO, f)], {
        cwd: REPO,
        stdio: "ignore",
      });
    } catch (e) {
      broken.push(f);
    }
  }
  if (broken.length) {
    bad("I-02 被跟踪的 .js/.mjs 全部通过 node --check", broken.join(", "));
  } else {
    ok("I-02 被跟踪的 .js/.mjs 全部通过 node --check（" + sources.length + " 个文件）");
  }

  /* ---------- I-03 尺子自身的负向/正向对照 ---------- */
  {
    const dirty = path.join(REPO, ".gp171-dirty-probe.js");
    const clean = path.join(REPO, ".gp171-clean-probe.js");
    const quoted = path.join(REPO, ".gp171-quoted-probe.md");
    const bareDoc = path.join(REPO, ".gp171-bare-probe.md");
    fs.writeFileSync(
      dirty,
      "const a = 1;\n<<<<<<< HEAD\nconst b = 2;\n=======\nconst b = 3;\n>>>>>>> deadbeef\n",
    );
    fs.writeFileSync(clean, "const a = 1;\nmodule.exports = a;\n");
    // 文档里「围栏内的逐字引用」是合法留证（本仓 §8.35 就这么写的）……
    fs.writeFileSync(
      quoted,
      "报告原文：\n\n```\n<<<<<<< HEAD\nSyntaxError: Unexpected token '<<'\n>>>>>>> deadbeef\n```\n",
    );
    // ……但围栏外留一组标记仍然是没解完的冲突，必须抓住。
    fs.writeFileSync(bareDoc, "# 看起来正常的标题\n<<<<<<< HEAD\n两边都留着\n>>>>>>> deadbeef\n");
    let markerCaught = false;
    let quoteExempt = false;
    let bareCaught = false;
    try {
      const rel = [path.basename(dirty), path.basename(clean)];
      const hits = findConflictMarkers(rel);
      markerCaught = hits.length === 1 && hits[0] === rel[0];
      quoteExempt = findConflictMarkers([path.basename(quoted)]).length === 0;
      bareCaught =
        findConflictMarkers([path.basename(bareDoc)]).length === 1;
    } catch (_) {
      markerCaught = quoteExempt = bareCaught = false;
    }
    // 解析检测器：脏文件必须被 node --check 拒掉，干净文件必须通过。
    let parseCaught = false;
    try {
      execFileSync(process.execPath, ["--check", dirty], { stdio: "ignore" });
    } catch (_) {
      parseCaught = true;
    }
    let cleanParses = false;
    try {
      execFileSync(process.execPath, ["--check", clean], { stdio: "ignore" });
      cleanParses = true;
    } catch (_) {
      cleanParses = false;
    }
    if (markerCaught && quoteExempt && bareCaught && parseCaught && cleanParses) {
      ok(
        "I-03 负向/正向对照：代码标记必抓、文档围栏内引用不误报、围栏外照抓、干净文件能解析",
      );
    } else {
      bad(
        "I-03 负向/正向对照",
        JSON.stringify({ markerCaught, quoteExempt, bareCaught, parseCaught, cleanParses }),
      );
    }
    for (const p of [dirty, clean, quoted, bareDoc]) fs.rmSync(p, { force: true });
  }

  /* ---------- I-04 shell 在 bash 3.2 上跑得动 ---------- */
  const hazards = findShellHazards(all);
  const shells = all.filter(isShell);
  if (hazards.length) {
    bad(
      "I-04 被跟踪的 .sh 没有 `set -u` 下的空数组裸展开",
      hazards.map((h) => h.file + ":" + h.useLine + " " + h.name).join(", "),
    );
  } else {
    ok("I-04 被跟踪的 .sh 没有 `set -u` 下的空数组裸展开（" + shells.length + " 个脚本全扫）");
  }

  /* ---------- I-05 I-04 这把尺子自身的负向/正向对照 ---------- */
  {
    const pBare = path.join(REPO, ".gp174-bare-probe.sh");
    const pQuoted = path.join(REPO, ".gp174-quoted-probe.sh");
    const pMixed = path.join(REPO, ".gp174-mixed-probe.sh");
    const pGuard = path.join(REPO, ".gp174-guard-probe.sh");
    const pLen = path.join(REPO, ".gp174-len-probe.sh");
    const pNoU = path.join(REPO, ".gp174-nou-probe.sh");
    const pLit = path.join(REPO, ".gp174-literal-probe.sh");
    const pLocal = path.join(REPO, ".gp174-local-probe.sh");
    const pComment = path.join(REPO, ".gp174-comment-probe.sh");
    // 违规：`=()` 起空 + set -u + 裸展开（带引号和不带引号两种都会炸）。
    // 违规探针里也塞一行同名的注释引用：证明「注释豁免」只豁免那一行，不会整份放过。
    fs.writeFileSync(
      pBare,
      '#!/usr/bin/env bash\nset -euo pipefail\nFLAGS=()\n# 注释里也写着 "${FLAGS[@]}"，它不算违规\nmoon build ${FLAGS[@]}\n',
    );
    fs.writeFileSync(
      pQuoted,
      '#!/usr/bin/env bash\nset -euo pipefail\nFLAGS=()\nmoon build "${FLAGS[@]}"\n',
    );
    // 一行里既用了惯用法、又另留一处裸展开 —— 豁免不能宽到整行放过。
    fs.writeFileSync(
      pMixed,
      '#!/usr/bin/env bash\nset -euo pipefail\nFLAGS=()\nmoon build ${FLAGS[@]+"${FLAGS[@]}"} --out "${FLAGS[@]}"\n',
    );
    // 合规惯用法一：`${ARR[@]+"${ARR[@]}"}` —— 内层长得和违规一模一样，不能误报。
    fs.writeFileSync(
      pGuard,
      '#!/usr/bin/env bash\nset -euo pipefail\nFLAGS=()\nmoon build ${FLAGS[@]+"${FLAGS[@]}"}\nother ${FLAGS[@]+${FLAGS[@]}}\n',
    );
    // 合规惯用法二：先做长度判断（pack-desktop.sh 就是这么写的）。
    fs.writeFileSync(
      pLen,
      '#!/usr/bin/env bash\nset -euo pipefail\nFLAGS=()\nif [[ ${#FLAGS[@]} -gt 0 ]]; then moon build "${FLAGS[@]}"; fi\n',
    );
    // 没有 set -u：空数组摊成 0 个词，无害。
    fs.writeFileSync(pNoU, "#!/usr/bin/env bash\nset -eo pipefail\nFLAGS=()\nmoon build \"${FLAGS[@]}\"\n");
    // 字面量就非空的数组：本门只管「可能为空」的那些。
    fs.writeFileSync(pLit, "#!/usr/bin/env bash\nset -euo pipefail\nRUN=(node x.js)\n\"${RUN[@]}\"\n");
    // 函数里的 `local NAME=()` 同型（本仓 turn_json 就是这种，且它是所有 kind 断言的入口）。
    fs.writeFileSync(
      pLocal,
      '#!/usr/bin/env bash\nset -euo pipefail\nrun(){ local extra=(); node x "${extra[@]}"; }\nrun\n',
    );
    // 只有注释里提到这个坑（门禁脚本的注释天天这么写）：不算违规。
    fs.writeFileSync(
      pComment,
      '#!/usr/bin/env bash\nset -euo pipefail\nFLAGS=()\n# 提醒：别写 "${FLAGS[@]}"，空数组在 bash 3.2 会 unbound\nprintf \'ok\\n\'\n',
    );

    const seen = (p) => findShellHazards([path.basename(p)]).length > 0;
    const bareCaught = seen(pBare);
    const quotedCaught = seen(pQuoted);
    const mixedCaught = seen(pMixed);
    const localCaught = seen(pLocal);
    const commentExempt = !seen(pComment);
    const guardExempt = !seen(pGuard);
    const lenExempt = !seen(pLen);
    const noUExempt = !seen(pNoU);
    const litExempt = !seen(pLit);
    if (
      bareCaught &&
      quotedCaught &&
      mixedCaught &&
      localCaught &&
      commentExempt &&
      guardExempt &&
      lenExempt &&
      noUExempt &&
      litExempt
    ) {
      ok(
        "I-05 空数组尺子对照：裸展开（带引号/不带/混在一行/local 起空）必抓，纯注释引用、`+` 惯用法、长度守卫、无 set -u、非空字面量不误报",
      );
    } else {
      bad(
        "I-05 空数组尺子对照",
        JSON.stringify({
          bareCaught,
          quotedCaught,
          mixedCaught,
          localCaught,
          commentExempt,
          guardExempt,
          lenExempt,
          noUExempt,
          litExempt,
        }),
      );
    }
    // 尺子之外，还要证明「这条规则管的是本机真会炸的东西」：
    // macOS 自带 /bin/bash 是 3.2，`set -u` 下裸展开空数组直接 unbound；
    // bash 4.4+ 修了，所以这半边只在老 bash 上要求翻红，新 bash 上要求两边都绿，
    // 两种情况都把版本号打在消息里，读的人知道走的是哪半边。
    const shBare = path.join(REPO, ".gp174-exec-bare.sh");
    const shGuard = path.join(REPO, ".gp174-exec-guard.sh");
    fs.writeFileSync(shBare, "#!/bin/bash\nset -u\nFLAGS=()\nprintf '%s\\n' \"${FLAGS[@]}\"\n");
    fs.writeFileSync(
      shGuard,
      '#!/bin/bash\nset -u\nFLAGS=()\nprintf \'%s\\n\' ${FLAGS[@]+"${FLAGS[@]}"}\n',
    );
    const runSh = (p) => {
      try {
        execFileSync("/bin/bash", [p], { stdio: "ignore" });
        return 0;
      } catch (e) {
        return e && typeof e.status === "number" ? e.status : -1;
      }
    };
    let bashVer = "";
    try {
      bashVer = execFileSync("/bin/bash", ["-c", "echo $BASH_VERSION"], { encoding: "utf8" }).trim();
    } catch (_) {
      bashVer = "";
    }
    const parts = bashVer.split(".").map(Number);
    const oldBash = parts.length >= 2 && (parts[0] < 4 || (parts[0] === 4 && parts[1] < 4));
    const bareRc = runSh(shBare);
    const guardRc = runSh(shGuard);
    const execProof =
      !!bashVer && guardRc === 0 && (oldBash ? bareRc !== 0 : bareRc === 0);
    if (execProof) {
      ok(
        "I-05 行为对照（/bin/bash " +
          bashVer +
          "）：裸展开" +
          (oldBash ? "真的炸(rc=" + bareRc + ")" : "不炸(4.4+ 已修)") +
          "、`+` 惯用法始终安全",
      );
    } else {
      bad(
        "I-05 行为对照",
        JSON.stringify({ bashVer, oldBash, bareRc, guardRc }),
      );
    }
    for (const p of [
      pBare,
      pQuoted,
      pMixed,
      pGuard,
      pLen,
      pNoU,
      pLit,
      pLocal,
      pComment,
      shBare,
      shGuard,
    ])
      fs.rmSync(p, { force: true });
  }
} catch (err) {
  bad("门禁执行异常", err && err.stack ? err.stack : String(err));
}

done();
