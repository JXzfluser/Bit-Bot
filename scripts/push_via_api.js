#!/usr/bin/env node
"use strict";

/**
 * 用 GitHub REST Git Database API 把本地分支推上去 —— 并且做到
 * **本地 commit SHA 与远端 commit SHA 逐个字节相同**。
 *
 * ── 为什么不用 `git push` ─────────────────────────────────────────
 * 沙箱到 github.com 的 TLS 握手频繁中断(git 的 gnutls 后端实测 0/22 成功率),
 * 而 api.github.com 稳定可达。所以走 REST API 重放 git 对象。
 *
 * ── 为什么能字节级一致 ────────────────────────────────────────────
 * git 对象是内容寻址的。GitHub 的 create-commit 实测行为(见
 * scripts/probe_github_commit.js 的探针结论):
 *   · message **原样存储**,不补换行、不裁剪
 *   · author/committer 的 **时区偏移被强制归一为 +0000**(瞬时不变)
 * 所以本地用 `git commit-tree` 以 `+0000` 和原样 message 重建,
 * SHA 就和 GitHub 造出来的一模一样。
 *
 * ── 纪律 ─────────────────────────────────────────────────────────
 * 每个 blob / tree / commit 都拿远端返回的 SHA 和本地比,对不上**立即报错停下**,
 * 绝不"看着差不多就过"。推完再把远端 ref 读回来核对。
 *
 * 用法:
 *   BITBOT_PUSH_TOKEN=<pat> node scripts/push_via_api.js [--no-rebuild]
 */

const crypto = require("crypto");
const { execFileSync } = require("child_process");
const path = require("path");

const REPO_DIR = process.env.BITBOT_REPO_DIR || path.resolve(__dirname, "..");
const OWNER = process.env.BITBOT_REPO_OWNER || "JXzfluser";
const REPO = process.env.BITBOT_REPO_NAME || "Bit-Bot";
const BRANCH = process.env.BITBOT_BRANCH || "feat/l3-l6-gap-closure";
const BASE_REF = process.env.BITBOT_BASE_REF || "refs/remotes/upstream/desktop-layout-target-v2";
const TOKEN = process.env.BITBOT_PUSH_TOKEN || "";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const REBUILD = !process.argv.includes("--no-rebuild");

if (!TOKEN) {
  console.error("BITBOT_PUSH_TOKEN 未设置");
  process.exit(2);
}

const git = (...args) =>
  execFileSync("git", args, { cwd: REPO_DIR, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const gitBuf = (...args) =>
  execFileSync("git", args, { cwd: REPO_DIR, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });

let apiCalls = 0;
async function api(method, endpoint, body) {
  apiCalls += 1;
  const res = await fetch(API + endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bitbot-push",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text.slice(0, 400) }; }
  if (!res.ok) {
    const e = new Error(`${method} ${endpoint} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

function commitInfo(sha) {
  const raw = git("cat-file", "commit", sha);
  const nl = raw.indexOf("\n\n");
  const header = raw.slice(0, nl);
  const message = raw.slice(nl + 2);
  const g = (k) => (header.match(new RegExp("^" + k + " (.*)$", "m")) || ["", ""])[1];
  return {
    sha,
    tree: g("tree"),
    parents: (header.match(/^parent (.*)$/gm) || []).map((s) => s.slice(7).trim()),
    author: g("author"),
    committer: g("committer"),
    message,
  };
}

function parseIdent(raw) {
  const m = raw.match(/^(.*) <(.*)> (\d+) ([+-]\d{4})$/);
  if (!m) throw new Error("ident 解析失败: " + raw);
  return { name: m[1], email: m[2], ts: m[3], tz: m[4] };
}

const isoUtc = (ts) => new Date(Number(ts) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** 两个 commit 之间变了的文件 */
function changedPaths(parentSha, commitSha) {
  // --no-renames:git mv 的 R081 行有两个路径(旧+新),解析容易出错。
  // 关掉 rename 检测后,rename 自然退化成 "删旧的 + 加新的" 两个条目 —— 语义一样,格式单一。
  const out = git("diff-tree", "-r", "--no-commit-id", "--raw", "--no-renames", parentSha, commitSha);
  const rows = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) (\w+)\t(.+)$/);
    if (!m) continue;
    rows.push({
      oldMode: m[1], newMode: m[2], oldSha: m[3], newSha: m[4], status: m[5], path: m[6],
    });
  }
  return rows;
}

function rebuildLocal() {
  const list = git("rev-list", "--reverse", `${BASE_REF}..${BRANCH}`).trim().split("\n").filter(Boolean);
  console.log(`== 本地重建(${list.length} 个 commit,时区归一为 +0000)==`);
  const baseSha = git("rev-parse", BASE_REF).trim();
  let parent = baseSha;
  const map = [];
  for (const sha of list) {
    const ci = commitInfo(sha);
    const a = parseIdent(ci.author);
    const c = parseIdent(ci.committer);
    const newSha = execFileSync("git", ["commit-tree", ci.tree, "-p", parent], {
      cwd: REPO_DIR,
      encoding: "utf8",
      input: ci.message,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: a.name, GIT_AUTHOR_EMAIL: a.email, GIT_AUTHOR_DATE: `${a.ts} +0000`,
        GIT_COMMITTER_NAME: c.name, GIT_COMMITTER_EMAIL: c.email, GIT_COMMITTER_DATE: `${c.ts} +0000`,
      },
    }).trim();
    console.log(`  ${sha.slice(0, 8)} → ${newSha.slice(0, 8)}  ${ci.message.split("\n")[0].slice(0, 52)}`);
    map.push({ old: sha, new: newSha, info: ci });
    parent = newSha;
  }
  // 备份旧分支,然后把分支指到重建后的历史
  const backup = `backup/pre-utc-rewrite-${Date.now().toString(36)}`;
  git("branch", backup, BRANCH);
  git("update-ref", `refs/heads/${BRANCH}`, parent);
  git("reset", "--soft", parent);
  console.log(`  分支已指到 ${parent.slice(0, 10)}(旧分支备份在 ${backup})`);
  return { list: map, finalSha: parent, backup };
}

async function main() {
  console.log("== 准备 ==");
  const baseSha = git("rev-parse", BASE_REF).trim();
  console.log(`base ${BASE_REF} = ${baseSha}`);

  const rebuilt = REBUILD ? rebuildLocal() : null;
  const list = git("rev-list", "--reverse", `${BASE_REF}..${BRANCH}`).trim().split("\n").filter(Boolean);
  if (!list.length) { console.log("没有要推的 commit,收工"); return; }

  let parentTree = commitInfo(baseSha).tree;
  let parentSha = baseSha;

  for (const sha of list) {
    const ci = commitInfo(sha);
    const rows = changedPaths(parentSha, sha);
    const entries = [];
    for (const r of rows) {
      if (r.status === "D") {
        // 删除:tree 里给 sha:null。mode 必须用**旧 mode** —— 删除行的 newMode 是 000000,
        // GitHub 会拒收("Must supply a valid tree.mode")。
        entries.push({ path: r.path, mode: r.oldMode === "000000" ? "100644" : r.oldMode, type: "blob", sha: null });
        continue;
      }
      const mode = r.newMode === "000000" ? r.oldMode : r.newMode;
      const content = gitBuf("cat-file", "blob", r.newSha).toString("base64");
      const up = await api("POST", "/git/blobs", { content, encoding: "base64" });
      if (up.sha !== r.newSha) throw new Error(`blob SHA 不一致: ${up.sha} != ${r.newSha} (${r.path})`);
      entries.push({ path: r.path, mode, type: "blob", sha: r.newSha });
    }

    const tree = await api("POST", "/git/trees", { base_tree: parentTree, tree: entries });
    if (tree.sha !== ci.tree) throw new Error(`tree SHA 不一致: ${tree.sha} != ${ci.tree}`);

    const a = parseIdent(ci.author);
    const c = parseIdent(ci.committer);
    const body = {
      message: ci.message,                       // 原样(含结尾换行)—— GitHub 原样存储
      tree: ci.tree,
      parents: [parentSha],
      author: { name: a.name, email: a.email, date: isoUtc(a.ts) },
      committer: { name: c.name, email: c.email, date: isoUtc(c.ts) },
    };
    let created;
    try {
      created = await api("POST", "/git/commits", body);
    } catch (e) {
      if (e.status !== 422) throw e;
      created = await api("GET", `/git/commits/${sha}`);
    }
    if (created.sha !== sha) {
      throw new Error(`commit SHA 不一致: 远端 ${created.sha} != 本地 ${sha}`);
    }
    console.log(`✅ ${sha.slice(0, 8)}  ${ci.message.split("\n")[0].slice(0, 54)}  (${rows.length} 文件)`);
    parentTree = ci.tree;
    parentSha = sha;
  }

  const refPath = `heads/${BRANCH}`;
  let exists = true;
  try { await api("GET", `/git/ref/${refPath}`); } catch (e) { if (e.status === 404) exists = false; else throw e; }
  if (exists) {
    // 注意:GitHub 这两个端点的路径不一样 —— 读是 /git/ref/{ref}(单数),
    // 改是 /git/refs/{ref}(复数)。写成单数会 404。
    await api("PATCH", `/git/refs/${refPath}`, { sha: parentSha, force: false });
    console.log(`↻ 更新远端分支 ${BRANCH}`);
  } else {
    await api("POST", "/git/refs", { ref: `refs/${refPath}`, sha: parentSha });
    console.log(`＋ 新建远端分支 ${BRANCH}`);
  }

  // 回头核对
  const ref = await api("GET", `/git/ref/${refPath}`);
  const remoteTip = ref.object.sha;
  const localTip = git("rev-parse", BRANCH).trim();
  console.log(`\n远端 tip: ${remoteTip}`);
  console.log(`本地 tip: ${localTip}`);
  console.log(remoteTip === localTip ? "==> ✅ 本地与远端 tip 完全一致" : "==> ❌ tip 不一致");
  console.log(`共 ${apiCalls} 次 API 调用`);
  if (rebuilt) console.log(`(旧本地分支备份: ${rebuilt.backup})`);
}

main().catch((e) => {
  console.error("push 失败:" + String((e && e.message) || e));
  process.exit(1);
});
