#!/usr/bin/env node
"use strict";

/**
 * prove_gp142_unreadable — GP-142（§5.5）加密/损坏附件诚实拒绝
 *
 * stageAttachments 现在做内容可解码性探测（保守）：
 *   - 图片：magic-byte（png/jpg/gif/webp）；```
 *   - PDF：`%PDF-` 头 + 无 `/Encrypt` + 有 `%%EOF`（否则加密/截断）；
 *   - 文本族：无 NUL、UTF-8 可解码；
 *   - 其它二进制：不误杀。
 * 失败 → ok:false, error:"unreadable", 不落盘、不进上下文。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductSurface } = require("../hosts/desktop/product_surface");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 160) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp142-"));
const seeds = path.join(root, "seeds");
fs.mkdirSync(seeds, { recursive: true });
const surface = createProductSurface(root);

const w = (name, buf) => { const p = path.join(seeds, name); fs.writeFileSync(p, buf); return p; };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

function expect(name, p, want) {
  const r = surface.stageAttachments([p], "sess", 0);
  let good;
  if (want === "ok") good = r.ok === true && (r.staged || []).length === 1;
  else good = r.ok === false && r.error === "unreadable" && r.reason === want;
  good ? ok(`${name} → ${want}`) : bad(`${name} expected ${want}`, JSON.stringify(r));
}

console.log("prove_gp142_unreadable — 不可读附件诚实拒绝（GP-142）");

expect("有效 PNG（magic 正确）", w("ok.png", PNG_SIG), "ok");
expect("伪 PNG（随机字节）", w("bad.png", Buffer.from("not an image at all, just text bytes")), "not_a_valid_image");
expect("伪 PDF（随机字节）", w("fake.pdf", Buffer.from("this is not a pdf payload")), "not_a_pdf");
expect("加密 PDF（含 /Encrypt）", w("enc.pdf", Buffer.from("%PDF-1.7\n1 0 obj << /Encrypt 5 0 R >>\n%%EOF")), "encrypted_pdf");
expect("截断 PDF（无 %%EOF）", w("trunc.pdf", Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog")), "truncated_pdf");
expect("有效 PDF", w("ok.pdf", Buffer.from("%PDF-1.4\n9 0 obj <<>>\nstartxref 0\n%%EOF")), "ok");
expect("有效文本 .md（中文）", w("ok.md", Buffer.from("季度简报：要点 A/B/C\n", "utf8")), "ok");
expect("含 NUL 的 .txt（二进制伪装文本）", w("nul.txt", Buffer.from("abc\u0000def")), "binary_not_text");
expect("非法 UTF-8 的 .txt", w("badutf.txt", Buffer.from([0xff, 0xfe, 0x41, 0x42])), "invalid_utf8");
// 未知二进制（如 docx/zip）不误杀：以合法 zip magic 的 .docx 仍放行
expect("未知二进制 .docx（保守放行）", w("ok.docx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])), "ok");

console.log(`\nprove_gp142_unreadable: PASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
