/* prove_repo_integrity.mjs — GP-171：提交进分支的源码必须先是「能跑的源码」
 *
 * 这一门来自一次真实事故（2026-10-29）：远端 `cursor/next-target-v1` 的
 * `a0ec929` 把一个**冲突没解完**的工作树提交了上去 ——
 *   hosts/desktop/product_surface.js  里留了 2 组 `<<<<<<< / ======= / >>>>>>>`
 *   scripts/prove_room_orchestrator.js 里留了 1 组，还有一份重复的 `noRunner` 夹具
 * 结果：桌面 App 一 require product_surface 就 SyntaxError（整个应用起不来），
 * 编排门也根本跑不了。而当时的矩阵/CI 没有任何一条会看这件事 —— 门禁都在
 * 「解析之后」执行，源码本身坏了它们连启动都到不了。
 *
 * 本门只问三件事：
 *   I-01 被 git 跟踪的源文件里没有冲突标记
 *   I-02 所有被跟踪的 .js / .mjs 都能通过 `node --check`
 *   I-03 负向/正向对照：代码里的标记必须被抓住、文档 ``` 围栏内的逐字引用不误报、
 *        围栏外的标记照样抓住、干净文件能通过
 *
 * I-01 的口径（2026-10-29 修）：冲突标记的危害是「被解析的东西坏掉」。本仓的验收报告
 * 必须逐字留证（把 node 的 SyntaxError 连同 `<<<<<<< HEAD` 那几行原文贴进 §8.35），
 * 所以 `.md` 里**围栏内的**标记视为引用，不算未解冲突；围栏外、以及所有非文档
 * 文件里的标记照旧算红。这个豁免不能宽到「.md 整份不扫」—— 否则真在 README 里
 * 留一组冲突标记也会被放过。
 *
 * 它不判断业务，只判断「提交的东西至少是一份源码」。
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
} catch (err) {
  bad("门禁执行异常", err && err.stack ? err.stack : String(err));
}

done();
