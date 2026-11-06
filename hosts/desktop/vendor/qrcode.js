/* qrcode.js — 离线可用的二维码生成（不联网、不依赖 npm 包）。
 *
 * 为什么自己写：这个产品是本地优先的桌面 app，弹窗里的二维码必须能在
 * **断网**时生成；CDN / 在线二维码 API 一律不能用。npm 装一个包又会把
 * 打包体积与供应链带进来，而这里只需要「把一段短 URL 编成码」这一件事。
 *
 * 实现的是 ISO/IEC 18004 的字节模式（Byte mode）+ Reed-Solomon 纠错，
 * 纠错级别 M，版本自动选 1..10（足够放 http://…/pair 这种短 URL），
 * 8 种掩码按标准惩罚规则取最优。输出是布尔模块矩阵，由调用方渲染
 * 成 <canvas> 或 SVG —— 本文件不碰 DOM，方便在 Node 里被门禁直接 require。
 *
 * 正确性不靠「看起来像二维码」：scripts/prove_qr_code.js 会拿 macOS
 * Vision 的条码识别器（独立实现）把渲染出来的图**真扫一遍**并比对原文。
 *
 * 参考算法结构：Nayuki Oono 的 QR Code generator（公共领域）思路重写，
 * 只保留字节模式，去掉汉字/数字/字母数字模式与 Micro QR。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BitBotQR = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- GF(256) 上界 0x11D 的乘法（Reed-Solomon 用） ---------- */
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = ((z << 1) ^ ((z >>> 7) * 0x11d)) & 0xff;
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  /** 生成 n 项纠错码字的除数多项式系数（降幂，首项 1 省略）。 */
  function rsDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  /** 对 data 求 degree 项 Reed-Solomon 余数。 */
  function rsRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (const b of data) {
      const factor = b ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let i = 0; i < result.length; i++) result[i] ^= gfMul(divisor[i], factor);
    }
    return result;
  }

  /* ---------- 版本参数表（纠错级别 M，版本 1..10） ----------
   * 每版本：纠错码字/块、块数。总码字由 getNumRawDataModules(ver)/8 算出。
   * 数据来自 ISO/IEC 18004 Table 9（M 级），只列 1..10。 */
  const ECC_CODEWORDS_PER_BLOCK = [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26,
  ];
  const NUM_ERROR_CORRECTION_BLOCKS = [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5,
  ];

  function rawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function dataCodewords(ver) {
    return Math.floor(rawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[ver] * NUM_ERROR_CORRECTION_BLOCKS[ver];
  }

  /* ---------- 位缓冲 ---------- */
  function BitBuf() { this.bits = []; }
  BitBuf.prototype.append = function (val, len) {
    for (let i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };

  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(str));
    const out = [];
    for (const ch of String(str)) {
      let cp = ch.codePointAt(0);
      if (cp <= 0x7f) out.push(cp);
      else if (cp <= 0x7ff) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp <= 0xffff) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return out;
  }

  /** 选最小版本；放不下返回 null（调用方必须回退，不许画一个装不下的码）。 */
  function chooseVersion(byteLen) {
    for (let ver = 1; ver <= 10; ver++) {
      const capacityBits = dataCodewords(ver) * 8;
      const countBits = ver <= 9 ? 8 : 16;
      const needed = 4 + countBits + byteLen * 8;
      if (needed <= capacityBits) return ver;
    }
    return null;
  }

  /** 字节模式的完整码字序列（含填充），不含纠错。 */
  function dataCodewordsFor(text, ver) {
    const bytes = utf8Bytes(text);
    const bb = new BitBuf();
    bb.append(0x4, 4);                       // Byte mode
    bb.append(bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) bb.append(b, 8);
    const cap = dataCodewords(ver) * 8;
    bb.append(0, Math.min(4, cap - bb.bits.length)); // terminator
    bb.append(0, (8 - (bb.bits.length % 8)) % 8);   // byte align
    const out = [];
    for (let i = 0; i < bb.bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bb.bits[i + j];
      out.push(v);
    }
    for (let pad = 0xec; out.length < dataCodewords(ver); pad ^= 0xec ^ 0x11) out.push(pad);
    return out;
  }

  /** 分块 → 逐块 RS → 交织，得到最终全部码字。 */
  function addEccAndInterleave(data, ver) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ver];
    const eccLen = ECC_CODEWORDS_PER_BLOCK[ver];
    const rawCodewords = Math.floor(rawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const blocks = [];
    const divisor = rsDivisor(eccLen);
    let k = 0;
    for (let i = 0; i < numBlocks; i++) {
      const datLen = shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1);
      const dat = data.slice(k, k + datLen);
      k += datLen;
      const ecc = rsRemainder(dat, divisor);
      const blk = Array.from(dat);
      if (i < numShortBlocks) blk.push(0); // 占位，交织时跳过（标准做法）
      blocks.push({ data: blk, ecc: Array.from(ecc), datLen });
    }
    const result = [];
    for (let i = 0; i < shortBlockLen - eccLen + 1; i++) {
      for (const blk of blocks) {
        // 短块最后的占位 0 不参与交织
        if (i < blk.datLen) result.push(blk.data[i]);
      }
    }
    for (let i = 0; i < eccLen; i++) for (const blk of blocks) result.push(blk.ecc[i]);
    return result;
  }

  /* ---------- 矩阵 ---------- */
  function makeMatrix(ver, codewords, mask) {
    const size = ver * 4 + 17;
    const m = [];
    const fn = []; // isFunction
    for (let y = 0; y < size; y++) {
      m.push(new Array(size).fill(false));
      fn.push(new Array(size).fill(false));
    }
    const setFn = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

    // 定位图案 + 分隔符（三个角）
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const dark = dist !== 2 && dist !== 4;
        for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
          const x = cx + dx, y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dark);
        }
      }
    }
    // 定时图案
    for (let i = 0; i < size; i++) {
      if (!fn[6][i]) setFn(i, 6, i % 2 === 0);
      if (!fn[i][6]) setFn(6, i, i % 2 === 0);
    }
    // 校正图案
    const alignCount = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (alignCount * 2 - 2)) * 2;
    const positions = [6];
    for (let i = alignCount - 1, p = size - 7; i > 0; i--, p -= step) positions.splice(1, 0, p);
    for (const y0 of positions) {
      for (const x0 of positions) {
        if ((x0 === 6 && y0 === 6) || (x0 === 6 && y0 === size - 7) || (x0 === size - 7 && y0 === 6)) continue;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            setFn(x0 + dx, y0 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    // 格式信息占位（稍后按 mask 填），版本信息占位
    drawFormatBits(m, fn, 0, size); // 先占满，后面覆写
    if (ver >= 7) drawVersionBits(m, fn, ver, size);

    // 数据位：从右下角起，两列一组蛇形向上/下
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (fn[y][x]) continue;
          let bit = false;
          if (bitIdx < totalBits) {
            bit = ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
            bitIdx++;
          }
          if (maskBit(mask, x, y)) bit = !bit;
          m[y][x] = bit;
        }
      }
    }
    drawFormatBits(m, fn, mask, size, true);
    return { size, modules: m };
  }

  function drawVersionBits(m, fn, ver, size) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      m[b][a] = bit; fn[b][a] = true;
      m[a][b] = bit; fn[a][b] = true;
    }
  }

  /** ECC 级别 M = 00，格式位 = (eccBits<<3)|mask，BCH(15,5) + 0x5412 掩码。 */
  function formatBits(mask) {
    const data = (0 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function drawFormatBits(m, fn, mask, size, overwrite) {
    const bits = formatBits(mask);
    // 第一处：左上角
    for (let i = 0; i <= 5; i++) place(8, i, i);
    place(8, 7, 6);
    place(8, 8, 7);
    place(7, 8, 8);
    for (let i = 9; i < 15; i++) place(14 - i, 8, i);
    // 第二处：右上 + 左下
    for (let i = 0; i < 8; i++) place(size - 1 - i, 8, i);
    for (let i = 8; i < 15; i++) place(8, size - 15 + i, i);
    // 固定黑点
    m[size - 8][8] = true;
    fn[size - 8][8] = true;

    function place(x, y, i) {
      const dark = ((bits >>> i) & 1) !== 0;
      if (overwrite || !fn[y][x]) { m[y][x] = dark; fn[y][x] = true; }
    }
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return false;
    }
  }

  /** ISO 18004 的 4 条惩罚规则，取分最低的掩码。 */
  function penalty(m, size) {
    let score = 0;
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;
    for (let y = 0; y < size; y++) {
      let runColor = false, runLen = 0, runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        const c = m[y][x];
        if (c === runColor) { runLen++; if (runLen === 5) score += N1; else if (runLen > 5) score++; }
        else { finderPenaltyAdd(runLen, runHistory, size); if (!c) score += finderPenaltyPattern(runHistory, size) * N3; runColor = c; runLen = 1; }
      }
      score += finderPenaltyTerminate(runLen, runHistory, size) * N3;
    }
    for (let x = 0; x < size; x++) {
      let runColor = false, runLen = 0, runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        const c = m[y][x];
        if (c === runColor) { runLen++; if (runLen === 5) score += N1; else if (runLen > 5) score++; }
        else { finderPenaltyAdd(runLen, runHistory, size); if (!c) score += finderPenaltyPattern(runHistory, size) * N3; runColor = c; runLen = 1; }
      }
      score += finderPenaltyTerminate(runLen, runHistory, size) * N3;
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += N2;
    }
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * N4;
    return score;

    function finderPenaltyAdd(len, hist, n) {
      if (len === 0) return;
      hist.shift(); hist[6] = len;
      if (hist[0] === 0) return;
    }
    function finderPenaltyTerminate(len, hist) {
      hist.shift(); hist[6] = len + (1 << 24);
      return finderPenaltyPattern(hist, hist.length);
    }
    function finderPenaltyPattern(hist, n) {
      const a = hist[3], b = hist[4], c = hist[5], d = hist[6];
      if (a === undefined || d === undefined) return 0;
      const k = Math.min(a, b, c, d);
      let res = 0;
      if (b === a && c === a * 3 && d === a && (hist[2] >= a * 4 || hist[2] === undefined)) res++;
      return res;
    }
  }

  /**
   * 主入口：文本 → { size, modules }。
   * @param {string} text 要编码的内容
   * @param {object} [opts] { mask: 0..7 强制掩码（门禁做负向对照用） }
   * @returns {{size:number, modules:boolean[][], version:number, mask:number}|null}
   */
  function encode(text, opts) {
    const s = String(text == null ? "" : text);
    if (!s) return null;
    const ver = chooseVersion(utf8Bytes(s).length);
    if (ver === null) return null;
    const cw = addEccAndInterleave(dataCodewordsFor(s, ver), ver);
    let best = null;
    const forced = opts && Number.isInteger(opts.mask) ? opts.mask : null;
    for (let mask = 0; mask < 8; mask++) {
      if (forced !== null && mask !== forced) continue;
      const cand = makeMatrix(ver, cw, mask);
      cand.version = ver;
      cand.mask = mask;
      cand.penalty = penalty(cand.modules, cand.size);
      if (!best || cand.penalty < best.penalty) best = cand;
    }
    return best;
  }

  /** 矩形矩阵 → SVG 字符串（无 DOM 依赖，门禁可直接喂给 Vision 需要转成位图）。 */
  function toSvg(text, opts) {
    const q = encode(text, opts);
    if (!q) return "";
    const border = (opts && opts.border) || 4;
    const scale = (opts && opts.scale) || 6;
    const dim = q.size + border * 2;
    let path = "";
    for (let y = 0; y < q.size; y++) {
      for (let x = 0; x < q.size; x++) {
        if (q.modules[y][x]) path += "M" + (x + border) + "," + (y + border) + "h1v1h-1z";
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim +
      '" width="' + dim * scale + '" height="' + dim * scale + '" shape-rendering="crispEdges">' +
      '<rect width="100%" height="100%" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
  }

  return { encode, toSvg, gfMul };
});
