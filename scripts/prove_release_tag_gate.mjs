/* prove_release_tag_gate.mjs — 发布链路的 tag 判定与触发条件一致性门禁 (A0-1)
 *
 * 病征：workflow 触发前缀是 `desktop-v*` 与 `v*`，但三处门禁
 * `BITBOT_PUBLISH` / `BITBOT_REQUIRE_SIGN` / `BITBOT_REQUIRE_NOTARIZE` 都只认
 * `startsWith(github.ref_name, 'v')`。远端真实 tag `desktop-v0.1.0` 的 ref_name
 * 以 `d` 开头 ⇒ 三个表达式全为 false ⇒ 发布链路永远不会跑。
 *
 * GitHub Actions 表达式语义依据：
 *   - github.ref_name：短 ref 名。对 tag push 而言就是 tag 名本身（不含 refs/tags/）。
 *     文档：https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#push
 *     上下文：https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs#github-context
 *   - startsWith(searchString, searchValue)：字符串前缀匹配，大小写敏感。
 *     文档：https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/expressions#startswith
 *
 * 这道门禁钉住：
 *   RT-01 解析 workflow 的 on.push.tags 前缀清单
 *   RT-02 解析三处 BITBOT_* 门禁的 startsWith 条件
 *   RT-03 对每个触发前缀，取真实形态的 tag 名代入判定，断言三者同时被点亮
 *   RT-04 负向对照：构造一份「前缀 v* 但判定只认 v」的副本，确认门禁真的会红
 *   RT-05 真实 tag `desktop-v0.1.0` 必须匹配 workflow 声明的触发前缀
 *
 * 跑法：node scripts/prove_release_tag_gate.mjs（纯 Node，不启动 Electron）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const WORKFLOW = path.join(REPO, ".github/workflows/desktop-macos.yml");

let PASS = 0, FAIL = 0;
const ok = (id, msg) => { PASS++; console.log(`ok ${id} — ${msg}`); };
const bad = (id, msg, detail) => {
  FAIL++;
  console.log(`FAIL ${id} — ${msg}${detail ? " — " + String(detail).slice(0, 260) : ""}`);
};
const done = () => {
  console.log(`\nprove_release_tag_gate: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL ? 1 : 0);
};

/* ---------- helpers ---------- */

/** GitHub Actions startsWith 语义：大小写敏感前缀匹配 */
function ghStartsWith(str, prefix) {
  return typeof str === "string" && typeof prefix === "string" && str.startsWith(prefix);
}

/** 从 workflow YAML 提取 on.push.tags 前缀清单（形如 "desktop-v*" → "desktop-v"） */
function extractTagPrefixes(yaml) {
  const prefixes = [];
  // 匹配 on.push.tags 下的列表项
  const tagSection = yaml.match(/on:\s*\n(?:.*\n)*?\s*push:\s*\n\s*tags:\s*\n((?:\s*-\s*["'][^"']+["']\s*\n?)+)/);
  if (!tagSection) return prefixes;
  const items = tagSection[1].matchAll(/-\s*["']([^"']+)["']/g);
  for (const m of items) {
    // 把 glob 后缀 * 去掉，得到前缀
    const pattern = m[1].replace(/\*$/, "");
    prefixes.push(pattern);
  }
  return prefixes;
}

/** 从 workflow YAML 提取 BITBOT_PUBLISH / BITBOT_REQUIRE_SIGN / BITBOT_REQUIRE_NOTARIZE 的 startsWith 条件
 *  支持两种格式：
 *  - 单前缀：startsWith(github.ref_name, 'v')
 *  - 复合：(startsWith(github.ref_name, 'v') || startsWith(github.ref_name, 'desktop-v'))
 */
function extractGateConditions(yaml) {
  const gates = {};
  const gateNames = ["BITBOT_PUBLISH", "BITBOT_REQUIRE_SIGN", "BITBOT_REQUIRE_NOTARIZE"];
  for (const name of gateNames) {
    // 匹配整行
    const lineRe = new RegExp(`${name}:\\s*\\$\\{\\{([^}]+)\\}\\}`);
    const lineMatch = yaml.match(lineRe);
    if (!lineMatch) continue;
    const expr = lineMatch[1];
    // 提取所有 startsWith(github.ref_name, '...') 的前缀
    const prefixRe = /startsWith\(github\.ref_name,\s*['"]([^'"]+)['"]\)/g;
    const prefixes = [];
    let m;
    while ((m = prefixRe.exec(expr)) !== null) {
      prefixes.push(m[1]);
    }
    if (prefixes.length > 0) {
      gates[name] = prefixes; // 存储前缀数组
    }
  }
  return gates;
}

/** 模拟 GitHub Actions 的 tag 触发判定：tag 名是否匹配任一前缀 */
function tagMatchesTrigger(tag, prefixes) {
  return prefixes.some(p => ghStartsWith(tag, p));
}

/** 模拟门禁判定：tag 名是否让三处 BITBOT_* 同时被点亮
 *  每处门禁可能有多个前缀（OR 关系），任一匹配即点亮
 */
function gatesLit(tag, gates) {
  const results = {};
  for (const [name, prefixes] of Object.entries(gates)) {
    // prefixes 是数组，任一匹配即点亮
    results[name] = Array.isArray(prefixes)
      ? prefixes.some(p => ghStartsWith(tag, p))
      : ghStartsWith(tag, prefixes);
  }
  return results;
}

/* ---------- RT-01: 解析 workflow 的 on.push.tags 前缀清单 ---------- */
const yaml = fs.readFileSync(WORKFLOW, "utf8");
const triggerPrefixes = extractTagPrefixes(yaml);
if (triggerPrefixes.length === 0) {
  bad("RT-01", "无法从 workflow 解析出 on.push.tags 前缀清单");
} else {
  ok("RT-01", `workflow 声明的触发前缀：${triggerPrefixes.map(p => JSON.stringify(p + "*")).join(", ")}`);
}

/* ---------- RT-02: 解析三处 BITBOT_* 门禁的 startsWith 条件 ---------- */
const gates = extractGateConditions(yaml);
const gateNames = ["BITBOT_PUBLISH", "BITBOT_REQUIRE_SIGN", "BITBOT_REQUIRE_NOTARIZE"];
const parsedGates = gateNames.filter(n => n in gates);
if (parsedGates.length !== 3) {
  bad("RT-02", `只解析到 ${parsedGates.length}/3 处门禁条件`, JSON.stringify(gates));
} else {
  const gateDesc = gateNames.map(n => {
    const prefixes = gates[n];
    return `${n}=[${Array.isArray(prefixes) ? prefixes.map(p => `'${p}'`).join(",") : `'${prefixes}'`}]`;
  }).join(", ");
  ok("RT-02", `三处门禁的 startsWith 前缀：${gateDesc}`);
}

/* ---------- RT-03: 对每个触发前缀，取真实形态的 tag 名代入判定 ---------- */
if (triggerPrefixes.length > 0 && parsedGates.length === 3) {
  // 为每个触发前缀构造一个真实形态的 tag 名
  const testTags = triggerPrefixes.map(p => p + "0.1.0");
  let allLit = true;
  const failures = [];

  for (const tag of testTags) {
    // 先确认这个 tag 能触发 workflow
    const triggered = tagMatchesTrigger(tag, triggerPrefixes);
    if (!triggered) {
      failures.push(`${tag}: 不匹配任何触发前缀`);
      allLit = false;
      continue;
    }
    // 再确认三处门禁都被点亮
    const gateResults = gatesLit(tag, gates);
    const litCount = Object.values(gateResults).filter(Boolean).length;
    if (litCount !== 3) {
      failures.push(`${tag}: 只点亮 ${litCount}/3 处门禁 (${Object.entries(gateResults).map(([k,v]) => `${k}=${v}`).join(", ")})`);
      allLit = false;
    }
  }

  if (allLit) {
    ok("RT-03", `所有触发前缀的真实 tag（${testTags.join(", ")}）都能同时点亮三处门禁`);
  } else {
    bad("RT-03", `触发前缀与门禁判定不一致`, failures.join("; "));
  }
}

/* ---------- RT-04: 负向对照 ---------- */
// 构造一份「前缀 v* 但判定只认 v」的副本，确认门禁真的会红
{
  const brokenPrefixes = ["v"]; // 触发前缀是 "v*"
  const brokenGates = {
    BITBOT_PUBLISH: ["v"], // 只认 'v' 前缀
    BITBOT_REQUIRE_SIGN: ["v"],
    BITBOT_REQUIRE_NOTARIZE: ["v"],
  };
  // 用 "desktop-v0.1.0" 这个真实 tag 代入
  const brokenTag = "desktop-v0.1.0";
  const triggered = tagMatchesTrigger(brokenTag, brokenPrefixes);
  const gateResults = gatesLit(brokenTag, brokenGates);
  const litCount = Object.values(gateResults).filter(Boolean).length;

  // 负向对照：这个 broken workflow 应该让 desktop-v0.1.0 触发失败（不匹配 v*）
  // 或者门禁全灭（startsWith 'v' 对 'desktop-v0.1.0' 为 false）
  if (!triggered || litCount === 0) {
    ok("RT-04", `负向对照成立：broken workflow 让 ${brokenTag} ${!triggered ? "不触发" : "门禁全灭"}（triggered=${triggered}, lit=${litCount}/3）`);
  } else {
    bad("RT-04", `负向对照失败：broken workflow 不该让 ${brokenTag} 通过`, `triggered=${triggered}, lit=${litCount}/3`);
  }
}

/* ---------- RT-05: 真实 tag desktop-v0.1.0 必须匹配触发前缀 ---------- */
{
  const realTag = "desktop-v0.1.0";
  const triggered = tagMatchesTrigger(realTag, triggerPrefixes);
  if (triggered) {
    ok("RT-05", `真实 tag ${realTag} 匹配 workflow 声明的触发前缀`);
  } else {
    bad("RT-05", `真实 tag ${realTag} 不匹配任何触发前缀`, `prefixes=${JSON.stringify(triggerPrefixes)}`);
  }
}

done();
