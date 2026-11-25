#!/usr/bin/env node
/**
 * verify_link_reachability.mjs — 链接「能不能打开」的核验器（批次 8）。
 *
 * 为什么做这个：
 *   评审（两个独立评审组 + 实测）指出的最深一条：
 *   「核验状态：已核验（一手官方来源）」这句话**配不上它的字面意思** ——
 *   契约能判「链接长得对」，判不了「链接是死的」。
 *   实测那份产物里有一条 `https://example.com/audit-notes`：
 *   它格式完全正确（纯 ASCII、能通过 min_urls），但**情报卡里根本没有这条来源**
 *   ——链接是**编的**。格式判据对它完全无效。
 *
 *   ⇒ 唯一能判的办法是：**真的去访问那个 URL**。
 *
 * 设计取舍（都是刻意选的，不是省事）：
 *   1. **Host 做，不让成员做**。成员交产物，Host 核验 —— 否则模型会自己说
 *      「我核验过了」，那就是自证。
 *   2. **不阻塞验收**。链接抓不到 ≠ 产物不合格（可能是登录墙/付费墙）。
 *      但要**如实记录**，写进产物，让用户看得见哪些链接真的通。
 *   3. **限流**。核验不能把抓取额度打爆 —— 实测一棒 224 次抓取的教训。
 *   4. **只抓 HEAD-ish 的正文**，不下载整页。
 *
 * 用法：
 *   node scripts/verify_link_reachability.mjs --file <md> [--json]
 *   node scripts/verify_link_reachability.mjs --urls u1,u2 [--timeout 8000]
 *
 * 退出码：0 = 全部读完（不管通不通）；1 = 脚本自身崩了。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return dflt;
};
const hasFlag = (name) => argv.includes("--" + name);

const TIMEOUT_MS = Number(argOf("timeout", 9000));
const MAX_LINKS = Number(argOf("max", 12));

/** 从正文里抽出**纯 ASCII**的完整链接（与产品的 countDeliverableUrls 同口径）。
 *  与产品共用同一份实现（room_orchestrator.extractCleanUrls）——
 *  两份实现早晚会长歪，而「口径」一旦歪了，门禁就在验另一件事。 */
export function extractCleanUrls(content) {
  const s = String(content || "");
  const segs = s.split(/\]\(/);
  const out = [];
  for (const seg of segs) {
    const m = seg.match(/https?:\/\/[^\s]+/g);
    if (!m) continue;
    for (const tok of m) {
      let t = tok;
      while (t.endsWith(")") || t.endsWith("]")) t = t.slice(0, -1);
      if (!t) continue;
      if (/[^\x00-\x7F]/.test(t)) continue; // 混了全角/中文 ⇒ 坏链，不是链接
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** 真的访问一次，返回可达性判定。 */
export function probeUrl(url, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      resolve({ url, ok: false, status: 0, reason: "bad_url" });
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          "User-Agent": "BitBot/1.0 (+link-verifier)",
          Accept: "text/html,application/xhtml+xml,*/*",
          Range: "bytes=0-2047",
        },
        timeout: Math.max(1000, Number(timeoutMs) || 9000),
      },
      (res) => {
        const status = res.statusCode || 0;
        res.resume();
        /* 3xx 说明有跳转 —— 跟随一次（很多站点 301 到真实页面）。
           4xx/5xx ⇒ 明确不可达。2xx ⇒ 可达。 */
        if (status >= 300 && status < 400 && res.headers && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          resolve(probeUrl(next, timeoutMs).then((r) => ({
            ...r, redirected_from: url, final_url: next,
          })));
          return;
        }
        resolve({
          url,
          ok: status >= 200 && status < 400,
          status,
          reason: status >= 200 && status < 400 ? "" : "http_" + status,
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ url, ok: false, status: 0, reason: "timeout" });
    });
    req.on("error", (e) => {
      resolve({ url, ok: false, status: 0, reason: String((e && e.code) || e.message || "network_error").slice(0, 60) });
    });
    req.end();
  });
}

/** 核验一批链接，带并发上限（别把对方站点打挂，也别把自己拖死）。 */
export async function verifyLinks(urls, { timeoutMs = TIMEOUT_MS, concurrency = 3 } = {}) {
  const list = Array.from(new Set(urls || [])).slice(0, MAX_LINKS);
  const results = [];
  let idx = 0;
  const worker = async () => {
    while (idx < list.length) {
      const u = list[idx++];
      results.push(await probeUrl(u, timeoutMs));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
  return results;
}

/** 把核验结果渲染成能贴进产物的一段话。 */
export function renderVerificationNote(results) {
  const rows = (results || []).map((r) => {
    const mark = r.ok ? "可访问" : "打不开";
    const why = r.ok ? ("HTTP " + r.status) : (r.reason || "unknown");
    return "  - " + r.url + " —— " + mark + "（" + why + "）";
  });
  const okN = (results || []).filter((r) => r.ok).length;
  const total = (results || []).length;
  const head = "链接可达性（Host 实测 " + new Date().toISOString().slice(0, 10) + "）：" +
    total + " 条里 " + okN + " 条能打开";
  return rows.length ? head + "\n" + rows.join("\n") : head + "（没有可核验的链接）";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = argOf("file", "");
  const urlsArg = argOf("urls", "");
  let urls = [];
  if (urlsArg) {
    urls = urlsArg.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (file) {
    if (!fs.existsSync(file)) {
      console.error("文件不存在：" + file);
      process.exit(1);
    }
    urls = extractCleanUrls(fs.readFileSync(file, "utf8"));
  }
  if (!urls.length) {
    console.log("没有可核验的链接（正文里没有纯 ASCII 的完整 URL）");
    process.exit(0);
  }
  /* 用**产品里那份**核验器（host_ffi.verifyLinkReachability）——
     脚本和产品的行为必须一致，否则「脚本说通、��品说不通」就没法排查了。 */
  const { createHostFfi } = await import(path.join(REPO, "hosts/shared/host_ffi.js"));
  const ffi = createHostFfi(REPO, { dataRoot: os.tmpdir() });
  const results = await ffi.verifyLinkReachability(urls, { timeoutMs: TIMEOUT_MS, concurrency: 3, max: MAX_LINKS });
  if (hasFlag("json")) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    console.log(renderVerificationNote(results));
  }
  console.log("");
  console.log("summary: total=" + results.length +
    " reachable=" + results.filter((r) => r.ok).length +
    " unreachable=" + results.filter((r) => !r.ok).length);
}
