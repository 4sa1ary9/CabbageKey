// One-off: generate placeholder PNG + ICO icons so the Tauri build has valid
// assets. Real branded icons replace these later. Run: node gen-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(size, rgba = [13, 148, 136, 255]) {
  const w = size, h = size;
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array(w).fill(Buffer.from(rgba)))]);
  const raw = Buffer.concat(Array(h).fill(row));
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const dir = new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const png32 = makePng(32);
writeFileSync(dir + "32x32.png", makePng(32));
writeFileSync(dir + "128x128.png", makePng(128));
writeFileSync(dir + "128x128@2x.png", makePng(256));
writeFileSync(dir + "icon.png", makePng(512));

// Minimal ICO wrapping the 32x32 PNG (ICO supports embedded PNG).
const ico = Buffer.alloc(6 + 16);
ico.writeUInt16LE(0, 0);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = 32; ico[7] = 32; ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png32.length, 14);
ico.writeUInt32LE(6 + 16, 18);
writeFileSync(dir + "icon.ico", Buffer.concat([ico, png32]));

console.log("icons generated");
