#!/usr/bin/env node
/**
 * Generate PWA raster icons (192x192, 512x512) from favicon.svg.
 *
 * Uses built-in Node APIs only — draws the SVG-equivalent shape
 * (black rounded-rect + white "L") into a minimal PNG via raw pixel buffer.
 *
 * Run: node scripts/generate-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "..", "public");

/** Create a minimal valid PNG file with a black background and white "L" */
function createPng(size) {
  const channels = 4; // RGBA
  const raw = Buffer.alloc(size * (size * channels + 1)); // +1 per row for filter byte

  const cornerRadius = Math.round(size * 0.125); // rx=4 out of 32 = 12.5%

  // Helper: is pixel inside the rounded rect?
  function insideRoundedRect(x, y) {
    if (x < cornerRadius && y < cornerRadius) {
      const dx = cornerRadius - x;
      const dy = cornerRadius - y;
      return dx * dx + dy * dy <= cornerRadius * cornerRadius;
    }
    if (x >= size - cornerRadius && y < cornerRadius) {
      const dx = x - (size - cornerRadius - 1);
      const dy = cornerRadius - y;
      return dx * dx + dy * dy <= cornerRadius * cornerRadius;
    }
    if (x < cornerRadius && y >= size - cornerRadius) {
      const dx = cornerRadius - x;
      const dy = y - (size - cornerRadius - 1);
      return dx * dx + dy * dy <= cornerRadius * cornerRadius;
    }
    if (x >= size - cornerRadius && y >= size - cornerRadius) {
      const dx = x - (size - cornerRadius - 1);
      const dy = y - (size - cornerRadius - 1);
      return dx * dx + dy * dy <= cornerRadius * cornerRadius;
    }
    return true;
  }

  // Draw a simple "L" shape (approximating the SVG text)
  const fontSize = Math.round(size * 0.625); // 20/32 = 0.625
  const letterWidth = Math.round(fontSize * 0.5);
  const strokeWidth = Math.round(fontSize * 0.14);
  const baselineY = Math.round(size * 0.72); // y=23 of 32 ≈ 0.72
  const topY = baselineY - Math.round(fontSize * 0.72);
  const leftX = Math.round((size - letterWidth) / 2);

  function insideLetter(x, y) {
    // Vertical stroke of L
    if (x >= leftX && x < leftX + strokeWidth && y >= topY && y <= baselineY) {
      return true;
    }
    // Horizontal stroke of L
    if (x >= leftX && x < leftX + letterWidth && y > baselineY - strokeWidth && y <= baselineY) {
      return true;
    }
    return false;
  }

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (size * channels + 1);
    raw[rowOffset] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * channels;
      if (!insideRoundedRect(x, y)) {
        // Transparent
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
      } else if (insideLetter(x, y)) {
        // White
        raw[px] = 255;
        raw[px + 1] = 255;
        raw[px + 2] = 255;
        raw[px + 3] = 255;
      } else {
        // Black
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 255;
      }
    }
  }

  // Build PNG file
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, "ascii");
    const crcData = Buffer.concat([typeB, data]);
    const crc = Buffer.alloc(4);
    crc.writeInt32BE(crc32(crcData));
    return Buffer.concat([len, typeB, data, crc]);
  }

  // CRC32 table
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }
  function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return c ^ -1;
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT
  const compressed = zlib.deflateSync(raw, { level: 9 });

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", iend),
  ]);
}

for (const size of [192, 512]) {
  const png = createPng(size);
  const outPath = path.join(PUBLIC, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${png.length} bytes)`);
}
