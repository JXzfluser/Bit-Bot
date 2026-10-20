#!/usr/bin/env node
/**
 * lib_png_pixel.mjs — dependency-free PNG reader + luminance probe.
 *
 * Why hand-rolled: the parity assertions must run in a bare sandbox where no
 * image package (pngjs/sharp) is guaranteed. Node's built-in zlib is enough
 * to inflate IDAT and un-filter scanlines for the subset CDP produces
 * (8-bit, non-interlaced, color type 2 RGB / 6 RGBA).
 *
 * GP-70 pixel assertion uses avgLuma() over a viewport region: theme tokens
 * are #171717 (dark) vs #ffffff (light), so the two states are far outside any
 * anti-aliasing noise — a real falsifiable signal, not a CSS-string check.
 */

import zlib from "node:zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode a PNG buffer into { width, height, channels, data:Uint8Array }. */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) {
    throw new Error("not a PNG buffer");
  }
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = 0;
  let interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const start = off + 8;
    const data = buf.subarray(start, start + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    off = start + len + 4; // skip CRC
  }
  if (depth !== 8) throw new Error("unsupported bit depth " + depth);
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");
  const channels = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : 0;
  if (!channels) throw new Error("unsupported color type " + color);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v = v + a;
      else if (filter === 2) v = v + b;
      else if (filter === 3) v = v + ((a + b) >> 1);
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else if (filter !== 0) throw new Error("bad filter " + filter);
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { width, height, channels, data: out };
}

/**
 * Average perceived luminance (Rec. 709) over a rect.
 * rect defaults to the full frame.
 */
export function avgLuma(png, rect) {
  const { width, height, channels, data } = png;
  const x0 = Math.max(0, rect ? rect.x : 0);
  const y0 = Math.max(0, rect ? rect.y : 0);
  const x1 = Math.min(width, rect ? x0 + rect.w : width);
  const y1 = Math.min(height, rect ? y0 + rect.h : height);
  if (x1 <= x0 || y1 <= y0) throw new Error("empty probe rect");
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * width * channels;
    for (let x = x0; x < x1; x++) {
      const i = row + x * channels;
      const r = data[i];
      const g = data[i + 1] ?? r;
      const b = data[i + 2] ?? r;
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++;
    }
  }
  return sum / n;
}

/** Single-pixel RGB triplet at (x,y) — used to reject "all one colour" fixtures. */
export function pixelAt(png, x, y) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) throw new Error("pixel out of bounds");
  const i = (y * png.width + x) * png.channels;
  const d = png.data;
  return [d[i], d[i + 1] ?? d[i], d[i + 2] ?? d[i]];
}

/** Minimal 8-bit RGB PNG encoder (filter 0) — decoder self-test fixture. */
export function encodeRgbPng(width, height, rgbFn) {
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgbFn(x, y);
      const i = y * (stride + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
