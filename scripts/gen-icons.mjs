#!/usr/bin/env node
/**
 * تولید آیکون‌های PNG بدون هیچ وابستگی (zlib سراسری node).
 * طراحی: پس‌زمینه‌ی سرمه‌ای + سه کمان «سیگنال» + نقطه‌ی LED سبز.
 * اجرا:  node scripts/gen-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

/* ---------------- PNG encoder (RGBA, no filter) ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- رسم ---------------- */

function drawIcon(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4);
  const bg = [0x0b, 0x10, 0x20];
  const accent = [0x00, 0xe0, 0xa4];
  const blue = [0x4d, 0x9f, 0xff];
  const cx = size / 2;
  const cy = size * 0.62;
  const radius = maskable ? Infinity : size * 0.22; // گوشه‌گرد مگر maskable
  const pad = maskable ? size * 0.02 : size * 0.06; // ناحیه‌ی امن maskable
  const S = size / 512; // مرجع طراحی 512

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // گوشه‌گرد
      if (radius !== Infinity) {
        const dx = Math.max(Math.abs(x - size / 2) - (size / 2 - radius), 0);
        const dy = Math.max(Math.abs(y - size / 2) - (size / 2 - radius), 0);
        if (dx * dx + dy * dy > radius * radius) continue; // شفاف
      }

      let r = bg[0], g = bg[1], b = bg[2], a = 255;

      const d = Math.hypot(x - cx, y - cy);

      // سه کمان سیگنال بالای نقطه
      const rings = [
        { r: 120 * S, t: 16 * S, c: accent },
        { r: 185 * S, t: 15 * S, c: blue },
        { r: 250 * S, t: 14 * S, c: accent },
      ];
      for (const ring of rings) {
        if (y > cy + 6 * S) continue; // فقط بالای مرکز
        if (Math.abs(d - ring.r) <= ring.t) {
          // محو شدن ملایم لبه
          const edge = 1 - (Math.abs(d - ring.r) - ring.t * 0.6) / (ring.t * 0.4);
          const alpha = Math.min(1, Math.max(0.15, edge));
          r = Math.round(r * (1 - alpha) + ring.c[0] * alpha);
          g = Math.round(g * (1 - alpha) + ring.c[1] * alpha);
          b = Math.round(b * (1 - alpha) + ring.c[2] * alpha);
        }
      }

      // نقطه‌ی LED
      const ledR = 52 * S;
      if (d <= ledR) {
        const glow = d <= ledR * 0.72 ? 1 : 0.85;
        r = Math.round(accent[0] * glow);
        g = Math.round(accent[1] * glow);
        b = Math.round(accent[2] * glow);
      } else if (d <= ledR + 26 * S) {
        const k = 1 - (d - ledR) / (26 * S);
        r = Math.round(r * (1 - k * 0.8) + accent[0] * k * 0.8);
        g = Math.round(g * (1 - k * 0.8) + accent[1] * k * 0.8);
        b = Math.round(b * (1 - k * 0.8) + accent[2] * k * 0.8);
      }

      // حاشیه‌ی امن داخلی برای maskable
      if (maskable && (x < pad || y < pad || x >= size - pad || y >= size - pad)) {
        r = bg[0];
        g = bg[1];
        b = bg[2];
      }

      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return encodePng(size, size, buf);
}

const targets = [
  ["favicon.png", 64, { maskable: false }],
  ["icon-192.png", 192, { maskable: false }],
  ["icon-512.png", 512, { maskable: false }],
  ["maskable-512.png", 512, { maskable: true }],
];

for (const [name, size, opts] of targets) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, drawIcon(size, opts));
  console.log("icon:", name, fs.statSync(file).size, "bytes");
}
console.log("icons done →", outDir);
