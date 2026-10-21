#!/usr/bin/env node
"use strict";

/**
 * prove_m30_attachpreview — G-26 附件发送前预览（官方 spec §5.1 验收信号
 * 「附件在发送前可预览」）
 *
 * 静态层：chip 缩略图/类型徽标 CSS、primeAttachmentPreviews 接线（pick/paste/drop
 *         三入口）、IPC+preload 暴露。
 * 行为层：真实 surface.attachmentPreview——真实 PNG → image + data_url；
 *         mp4 → video 且无 data_url（不伪造缩略图）；txt → doc；缺失路径 →
 *         preview_unavailable。
 * 负向对照：砍掉 data_url 生成行 → 预览退化为 null（断言变红）。
 * 临时文件/store 在 exit handler 恢复，双跑幂等。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.log("  ✗ " + m); };

console.log("M30 §5.1 附件发送前预览 proof");

/* ---------- 1) 静态层 ---------- */
const htmlPath = path.join(REPO, "hosts/desktop/index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
const preloadJs = fs.readFileSync(path.join(REPO, "hosts/desktop/preload.js"), "utf8");

/img\.attach-thumb/.test(html) && /\.attach-kind/.test(html)
  ? ok("chip 缩略图 / 类型徽标 CSS 就位（GP-M30）")
  : bad("chip preview css missing");

/function primeAttachmentPreviews/.test(html) &&
  (html.match(/await primeAttachmentPreviews\(r\.paths\);/g) || []).length >= 2
  ? ok("pick 与 paste/drop 两个入口都先渲染 chip 再等预览回包后重渲染（不阻塞发送）")
  : bad("preview priming wiring missing");

/info\.kind === "image" && info\.data_url/.test(html) &&
  /info\.kind \+ " · " \+ humanBytes\(info\.bytes\)/.test(html)
  ? ok("图片 chip 渲染真实缩略图；非图片 chip 显示类型+体积徽标（不伪造图片预览）")
  : bad("chip rendering logic missing");

/bitbot:attachments:preview/.test(mainJs) &&
  /preview: \(p\) => ipcRenderer\.invoke\("bitbot:attachments:preview"/.test(preloadJs)
  ? ok("IPC bitbot:attachments:preview + preload attachments.preview 已暴露")
  : bad("preview IPC missing");

/* ---------- 2) 行为层：真实 attachmentPreview ---------- */
const TMP = path.join(REPO, "data/tmp");
fs.mkdirSync(TMP, { recursive: true });
const pngPath = path.join(TMP, "m30-probe.png");
const mp4Path = path.join(TMP, "m30-probe.mp4");
const txtPath = path.join(TMP, "m30-probe.txt");
// 1x1 transparent PNG (real bytes, not fabricated).
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
fs.writeFileSync(pngPath, Buffer.from(PNG_B64, "base64"));
fs.writeFileSync(mp4Path, Buffer.alloc(2048, 7));
fs.writeFileSync(txtPath, "hello m30");

const psPath = path.join(REPO, "hosts/desktop/product_surface.js");
const psBefore = fs.readFileSync(psPath, "utf8");

const surface = require(psPath).createProductSurface(REPO);

process.on("exit", () => {
  try { fs.rmSync(pngPath, { force: true }); } catch (_) {}
  try { fs.rmSync(mp4Path, { force: true }); } catch (_) {}
  try { fs.rmSync(txtPath, { force: true }); } catch (_) {}
  try { fs.writeFileSync(psPath, psBefore); } catch (_) {}
});

(async () => {
  try {
    const img = surface.attachmentPreview(pngPath);
    img.ok && img.kind === "image" &&
      String(img.data_url || "").startsWith("data:image/png;base64,") &&
      img.bytes === fs.statSync(pngPath).size
      ? ok("真实 PNG → kind=image + data:image/png;base64 缩略图（bytes 与磁盘一致）")
      : bad("image preview wrong: " + JSON.stringify(img).slice(0, 160));
    const vid = surface.attachmentPreview(mp4Path);
    vid.ok && vid.kind === "video" && vid.data_url === null && vid.bytes === 2048
      ? ok("mp4 → kind=video、data_url=null（不伪造缩略图）、bytes 真实")
      : bad("video preview wrong: " + JSON.stringify(vid).slice(0, 160));
    const doc = surface.attachmentPreview(txtPath);
    doc.ok && doc.kind === "doc"
      ? ok("txt → kind=doc（其余类型如实归类）")
      : bad("doc preview wrong: " + JSON.stringify(doc));
    const missing = surface.attachmentPreview(path.join(TMP, "m30-nope.png"));
    !missing.ok && missing.error === "preview_unavailable"
      ? ok("缺失路径 → preview_unavailable（不造预览）")
      : bad("missing path wrong: " + JSON.stringify(missing));
    const empty = surface.attachmentPreview("");
    !empty.ok
      ? ok("空路径被拒")
      : bad("empty path accepted");

    /* ---------- 3) 负向对照：砍掉 data_url 生成 ---------- */
    const marker = 'dataUrl = "data:" + mime + ";base64," + fs.readFileSync(src).toString("base64");';
    const broken = psBefore.replace(marker, "dataUrl = null; // sabotaged");
    if (broken !== psBefore) {
      fs.writeFileSync(psPath, broken);
      delete require.cache[require.resolve(psPath)];
      const surface2 = require(psPath).createProductSurface(REPO);
      const img2 = surface2.attachmentPreview(pngPath);
      img2.ok && img2.kind === "image" && img2.data_url === null
        ? ok("负向对照：禁用缩略图生成后 data_url 退化 null（断言会红）")
        : bad("negative control did not degrade data_url: " + JSON.stringify(img2).slice(0, 120));
    } else {
      bad("negative control marker not found in product_surface.js");
    }

    console.log("\nprove_m30_attachpreview: PASS=" + pass + " FAIL=" + fail);
    process.exit(fail ? 1 : 0);
  } catch (err) {
    console.error("probe crashed:", err);
    process.exit(1);
  }
})();


