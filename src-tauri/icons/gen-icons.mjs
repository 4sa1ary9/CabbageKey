// KeyVault 品牌图标生成器（一次性脚本）。
// 设计：青绿渐变圆角方块 + 白色钥匙孔（keyhole），SDF 抗锯齿渲染。
// 输出：32x32.png / 128x128.png / 128x128@2x.png(256) / icon.png(512) / icon.ico(32+128+256)
// Run: node gen-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------- PNG 编码 ----------
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
function encodePng(size, rgba) {
  const rowLen = size * 4;
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(Buffer.from([0])); // filter: None
    rows.push(rgba.subarray(y * rowLen, (y + 1) * rowLen));
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const idat = deflateSync(Buffer.concat(rows), { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- SDF 形状（512 坐标系） ----------
const SIZE = 512;
const KEYHOLE = { cx: 256, cy: 222, r: 96 }; // 钥匙孔圆
const WEDGE = { top: 296, bottom: 408, halfTop: 34, halfBottom: 16 }; // 楔形

function sdfRoundedRect(x, y, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(x - cx) - (halfW - r);
  const qy = Math.abs(y - cy) - (halfH - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdfCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

// 楔形（梯形）距离：三条边半平面 + 上下界，内部为负
function sdfWedge(x, y) {
  const { top, bottom, halfTop, halfBottom } = WEDGE;
  if (y < top || y > bottom) return Infinity;
  const t = (y - top) / (bottom - top);
  const hw = halfTop + (halfBottom - halfTop) * t;
  const dL = (KEYHOLE.cx - hw) - x; // 内部为负：x 在左边界右侧
  const dR = x - (KEYHOLE.cx + hw);
  const dTop = top - y;
  const dBottom = y - bottom;
  return Math.max(dL, dR, dTop, dBottom);
}

function sdfKeyhole(x, y) {
  const dCircle = sdfCircle(x, y, KEYHOLE.cx, KEYHOLE.cy, KEYHOLE.r);
  const dWedge = sdfWedge(x, y);
  return Math.min(dCircle, dWedge);
}

// 圆角矩形背景（稍留白边）：整体 512，内容 480 居中
const BG = { cx: 256, cy: 256, half: 240, r: 92 };

// ---------- 渲染 512 ----------
function render512() {
  const out = Buffer.alloc(SIZE * SIZE * 4);
  const tealA = [20, 184, 166]; // #14B8A6
  const tealB = [15, 118, 110]; // #0F766E
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = sdfRoundedRect(x + 0.5, y + 0.5, BG.cx, BG.cy, BG.half, BG.half, BG.r);
      const bgA = Math.min(Math.max(0.5 - d, 0), 1); // 背景 alpha（抗锯齿）
      let r = 0, g = 0, b = 0, a = 0;
      if (bgA > 0) {
        const t = (x + y) / (2 * SIZE); // 对角渐变
        r = tealA[0] + (tealB[0] - tealA[0]) * t;
        g = tealA[1] + (tealB[1] - tealA[1]) * t;
        b = tealA[2] + (tealB[2] - tealA[2]) * t;
        // 顶部光泽：上半区域叠 6% 白
        const gloss = y < SIZE / 2 ? (1 - y / (SIZE / 2)) * 0.06 : 0;
        r += gloss * 255; g += gloss * 255; b += gloss * 255;
        // 钥匙孔（暖白），边缘 1px 深色描边增强对比
        const dk = sdfKeyhole(x + 0.5, y + 0.5);
        const khA = Math.min(Math.max(0.5 - dk, 0), 1) * bgA;
        const stroke = dk > 0 && dk < 2 ? 0.85 : 0; // 描边暗化
        if (khA > 0) {
          const kr = 250 * (1 - stroke);
          const kg = 249 * (1 - stroke);
          const kb = 247 * (1 - stroke);
          r = r * (1 - khA) + kr * khA;
          g = g * (1 - khA) + kg * khA;
          b = b * (1 - khA) + kb * khA;
        }
        a = bgA * 255;
      }
      const i = (y * SIZE + x) * 4;
      out[i] = Math.round(r); out[i + 1] = Math.round(g); out[i + 2] = Math.round(b); out[i + 3] = Math.round(a);
    }
  }
  return out;
}

// 512 → n 均值降采样
function downsample(src, n) {
  const step = SIZE / n;
  const out = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      const y0 = Math.floor(y * step), y1 = Math.ceil((y + 1) * step);
      const x0 = Math.floor(x * step), x1 = Math.ceil((x + 1) * step);
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * SIZE + sx) * 4;
          r += out_buf[i]; g += out_buf[i + 1]; b += out_buf[i + 2]; a += out_buf[i + 3];
          cnt++;
        }
      }
      const j = (y * n + x) * 4;
      out[j] = r / cnt; out[j + 1] = g / cnt; out[j + 2] = b / cnt; out[j + 3] = a / cnt;
    }
  }
  return out;
}

// ---------- ICO（多尺寸 PNG-embedded） ----------
function encodeIco(sizes, dataOf) {
  const entries = sizes.map((s) => ({ s, png: dataOf(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const parts = [header];
  for (const e of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = e.s >= 256 ? 0 : e.s;
    dir[1] = e.s >= 256 ? 0 : e.s;
    dir[2] = 0; dir[3] = 0; // 调色板
    dir.writeUInt16LE(1, 4); // 平面
    dir.writeUInt16LE(32, 6); // 位深
    dir.writeUInt32LE(e.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += e.png.length;
    parts.push(dir);
  }
  for (const e of entries) parts.push(e.png);
  return Buffer.concat(parts);
}

const dir = new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const out_buf = render512();
const png512 = encodePng(512, out_buf);
const png256 = encodePng(256, downsample(out_buf, 256));
const png128 = encodePng(128, downsample(out_buf, 128));
const png32 = encodePng(32, downsample(out_buf, 32));

writeFileSync(dir + "icon.png", png512);
writeFileSync(dir + "128x128@2x.png", png256);
writeFileSync(dir + "128x128.png", png128);
writeFileSync(dir + "32x32.png", png32);
writeFileSync(dir + "icon.ico", encodeIco([256, 128, 32], (s) => (s === 256 ? png256 : s === 128 ? png128 : png32)));

console.log("icons generated: icon.png(512), 128x128@2x.png(256), 128x128.png, 32x32.png, icon.ico(256+128+32)");
