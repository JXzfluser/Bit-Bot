#!/usr/bin/env node
"use strict";
/**
 * prove_qr_code.js — 二维码「真能被扫」门禁（QR-01..QR-12）
 *
 * 自己写的编码器最大的风险不是画得不像，是**自证闭环**：自己生成、自己按同一套
 * 假设解码，两边一起错也会全绿。所以这里用 macOS 自带的 Vision 框架
 * （VNDetectBarcodesRequest，Apple 的独立实现）把渲染出的 PNG **真扫一遍**，
 * 比对解出的原文。扫不出来 = 红，不是「看起来像二维码」就行。
 *
 * 内容也是真的：桌面 pairing.state() 给的 pair_page_url（http://…/pair）。
 * 绝不编码 bitbot-relay:// 自定 scheme —— Android 端没注册 deep link，
 * 扫了打不开，那会是一个假入口。
 *
 * 跑法：node scripts/prove_qr_code.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const QR = require(path.join(REPO, "hosts/desktop/vendor/qrcode.js"));

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

/* ---------------- 极简 PNG 编码（RGBA，无依赖） ---------------- */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** 模块矩阵 → PNG 文件。scale 用 8，border 4（扫码器要求安静区）。 */
function writePng(q, file, opts) {
  const scale = (opts && opts.scale) || 8;
  const border = (opts && opts.border) || 4;
  const dim = (q.size + border * 2) * scale;
  const row = Buffer.alloc(dim * 4 + 1);
  const raw = [];
  for (let py = 0; py < dim; py++) {
    row[0] = 0; // filter: none
    const my = Math.floor(py / scale) - border;
    for (let px = 0; px < dim; px++) {
      const mx = Math.floor(px / scale) - border;
      const dark = my >= 0 && my < q.size && mx >= 0 && mx < q.size && q.modules[my][mx];
      const v = dark ? 0 : 255;
      const o = 1 + px * 4;
      row[o] = v; row[o + 1] = v; row[o + 2] = v; row[o + 3] = 255;
    }
    raw.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0); ihdr.writeUInt32BE(dim, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return dim;
}

/* ---------------- Swift / Vision 独立解码器 ---------------- */
const SWIFT_SRC = `
import Foundation
import AppKit
import Vision

let args = CommandLine.arguments
guard args.count > 1 else { print("ERR no file"); exit(2) }
guard let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("ERR cannot load image"); exit(2)
}
let req = VNDetectBarcodesRequest()
req.symbologies = [.qr]
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
    try handler.perform([req])
    guard let results = req.results, !results.isEmpty else { print("NO_DETECT"); exit(0) }
    for r in results {
        if let s = r.payloadStringValue { print("OK " + s) }
        else { print("NO_PAYLOAD") }
    }
} catch { print("ERR \\(error)"); exit(2) }
`;

function visionDecode(pngPath, swiftBin) {
  const r = spawnSync(swiftBin, ["-", pngPath], { input: SWIFT_SRC, encoding: "utf8", timeout: 120000 });
  const out = String(r.stdout || "");
  if (r.status !== 0) return { ok: false, why: "swift exit=" + r.status + " " + (r.stderr || "").slice(-160) };
  const line = out.split("\n").find((l) => l.startsWith("OK ") || l === "NO_DETECT" || l === "NO_PAYLOAD" || l.startsWith("ERR"));
  if (!line) return { ok: false, why: "无输出 " + out.slice(0, 120) };
  if (line.startsWith("OK ")) return { ok: true, payload: line.slice(3) };
  return { ok: false, why: line };
}

async function main() {
  console.log("qr code proof (QR-01..QR-12)");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-qr-"));
  const swift = process.env.BITBOT_SWIFT || "swift";
  const swiftProbe = spawnSync(swift, ["-e", "import Vision; print(\"ok\")"], { encoding: "utf8", timeout: 120000 });
  const hasVision = swiftProbe.status === 0 && /ok/.test(String(swiftProbe.stdout || ""));

  try {
    /* ---------- 结构断言（不依赖 Vision） ---------- */
    {
      const q = QR.encode("http://192.168.1.5:18765/pair");
      if (!q) bad("QR-01 编码失败（连一段短 URL 都编不出来）");
      else if (q.size !== q.version * 4 + 17) bad("QR-01 尺寸与版本不符", q.size + "/" + q.version);
      else if (!q.modules || q.modules.length !== q.size || q.modules[0].length !== q.size) bad("QR-01 不是方阵");
      else if (!(q.mask >= 0 && q.mask <= 7)) bad("QR-01 掩码越界", q.mask);
      else ok("QR-01 短 URL → 版本 " + q.version + " / " + q.size + "×" + q.size + " 模块 / 掩码 " + q.mask);

      // 三个定位图案必须是 7×7 环
      const finder = (ox, oy) => {
        for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
          const dist = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          const want = dist !== 2 && dist !== 4;
          if (q.modules[oy + dy][ox + dx] !== want) return false;
        }
        return true;
      };
      if (!finder(0, 0) || !finder(q.size - 7, 0) || !finder(0, q.size - 7))
        bad("QR-02 定位图案不对（扫码器根本定位不到）");
      else ok("QR-02 三个 7×7 定位图案完好");

      // 掩码确实被应用：同一内容强制不同掩码，矩阵必须不同、但仍同尺寸
      const a = QR.encode("http://192.168.1.5:18765/pair", { mask: 0 });
      const b = QR.encode("http://192.168.1.5:18765/pair", { mask: 7 });
      if (JSON.stringify(a.modules) === JSON.stringify(b.modules)) bad("QR-03 换掩码矩阵没变（掩码没应用）");
      else ok("QR-03 掩码真实生效（强制 0 / 7 得到不同矩阵）");

      // 容量边界：超长必须返回 null 让调用方回退，不许画一个装不下的码
      if (QR.encode("x".repeat(2000)) !== null) bad("QR-04 超长内容没拒绝（会画出装不下的码）");
      else if (QR.encode("") !== null) bad("QR-04 空内容没拒绝");
      else ok("QR-04 超出版本 10 / 空内容都干净返回 null（调用方回退，不画假码）");

      // UTF-8：中文内容也得能编
      const zh = QR.encode("http://192.168.1.5:18765/pair?name=我的桌面");
      if (!zh) bad("QR-05 中文 UTF-8 编不出来");
      else ok("QR-05 中文 UTF-8 内容可编码（版本 " + zh.version + "）");
    }

    /* ---------- 真扫码（独立解码器） ---------- */
    if (!hasVision) {
      bad("QR-06 环境没有 Swift/Vision —— 无法证明「真能被扫」。SKIP 不等于 PASS。",
        (swiftProbe.stderr || "").slice(-160));
    } else {
      const cases = [
        ["QR-06 短 URL", "http://192.168.1.5:18765/pair"],
        ["QR-07 带查询参数", "http://192.168.1.5:18765/pair?box=my-desktop&lan=1"],
        ["QR-08 域名", "https://relay.example.com:18765/pair"],
        ["QR-09 较长内容", "http://192.168.1.5:18765/pair?name=" + "a".repeat(60)],
        ["QR-10 中文 UTF-8", "http://192.168.1.5:18765/pair?name=我的桌面"],
      ];
      for (const [label, text] of cases) {
        const q = QR.encode(text);
        if (!q) { bad(label + " 编码失败"); continue; }
        const png = path.join(tmp, label.replace(/\W/g, "_") + ".png");
        writePng(q, png);
        const r = visionDecode(png, swift);
        if (!r.ok) bad(label + " 扫不出来", r.why);
        else if (r.payload !== text) bad(label + " 扫出的内容不对", JSON.stringify(r.payload));
        else ok(label + " → Vision 真扫出原文（版本 " + q.version + "，" + text.length + " 字节）");
      }

      /* 负向对照：把矩阵弄坏，独立解码器必须扫不出**相同**内容。
       * 否则「扫出来了」可能只是 Vision 读到了别的东西 / 脚本恒真。 */
      {
        const text = "http://192.168.1.5:18765/pair";
        const q = QR.encode(text);
        const pngGood = path.join(tmp, "neg-good.png");
        writePng(q, pngGood);
        const good = visionDecode(pngGood, swift);
        if (!good.ok || good.payload !== text) {
          bad("QR-11 负向对照前置：正本自己都扫不出来", JSON.stringify(good));
        } else {
          const broken = QR.encode("http://192.168.1.5:18765/OTHER");
          const pngBad = path.join(tmp, "neg-other.png");
          writePng(broken, pngBad);
          const other = visionDecode(pngBad, swift);
          if (other.ok && other.payload === text)
            bad("QR-11 不同内容解出了相同原文（判据/编码器恒真）");
          else if (!other.ok)
            ok("QR-11 换成别的内容后扫出的不是原文（判据能分辨内容）");
          else ok("QR-11 换成别的内容后扫出 " + JSON.stringify(other.payload) + "，与原文不同（判据能分辨）");
        }
      }

      /* 安静区：没有 4 模块白边时许多扫码器会失败；确认我们渲染时留了。 */
      {
        const q = QR.encode("http://192.168.1.5:18765/pair");
        const noBorder = path.join(tmp, "no-border.png");
        writePng(q, noBorder, { border: 0, scale: 8 });
        const r = visionDecode(noBorder, swift);
        const pngOk = path.join(tmp, "with-border.png");
        writePng(q, pngOk, { border: 4, scale: 8 });
        const g = visionDecode(pngOk, swift);
        if (!g.ok) bad("QR-12 带 4 模块安静区反而扫不出", JSON.stringify(g));
        else ok("QR-12 4 模块安静区扫描正常" + (r.ok ? "（无安静区这次也扫出了，属扫码器容错）" : "（无安静区确实扫不出，安静区是必要的）"));
      }
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  console.log("prove_qr_code: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
