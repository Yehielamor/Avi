#!/usr/bin/env node
/**
 * מייצר את אייקוני ה-PWA אל public/icons.
 *
 * הקידוד ל-PNG נעשה כאן ידנית (zlib + CRC32) ולא דרך ספריית גרפיקה:
 * אייקון של ריבוע וּוִי אינו מצדיק תלות בנייה נוספת, ובעיקר — הוא
 * חייב להיווצר בכל בנייה. manifest שמצביע על קובץ שלא קיים נכשל
 * בהתקנה בשקט, בלי שגיאה בקונסול.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

/* צבעי המותג, sRGB. מקבילים ל---color-accent ול---color-canvas ב-theme.css
   (oklch שם; כאן ערכי RGB, כי PNG אינו יודע oklch). */
const ACCENT = [10, 106, 168];
const ON_ACCENT = [255, 255, 255];

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Buffer באורך size*size*4. */
function encodePng(size, rgba) {
  // כל שורה נפתחת בבייט filter 0 (None). דחיסה טובה פחות, קוד פשוט יותר.
  const rowLen = size * 4;
  const raw = Buffer.alloc(size * (rowLen + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (rowLen + 1)] = 0;
    rgba.copy(raw, y * (rowLen + 1) + 1, y * rowLen, (y + 1) * rowLen);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** מרחק נקודה מקטע — משמש לציור הווי בעובי אמיתי ובקצוות מעוגלים. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * ריבוע מעוגל בצבע המותג עם וי לבן.
 * @param padRatio שוליים סביב הריבוע. ל-maskable נדרש safe-zone —
 *   מערכת ההפעלה חותכת עיגול מתוך האייקון, ובלי שוליים הווי נחתך.
 */
function drawIcon(size, padRatio) {
  const px = new Uint8Array(size * size * 4);
  const pad = size * padRatio;
  const box = size - pad * 2;
  const radius = box * 0.22;
  const stroke = box * 0.115;

  // שלוש נקודות הווי, ביחס לתיבה.
  const p = (fx, fy) => [pad + box * fx, pad + box * fy];
  const [ax, ay] = p(0.26, 0.52);
  const [bx, by] = p(0.44, 0.7);
  const [cx, cy] = p(0.76, 0.32);

  const set = (i, [r, g, b], a) => {
    // מיזוג על מה שכבר קיים (הרקע צויר קודם).
    const inv = 1 - a;
    px[i] = Math.round(r * a + px[i] * inv);
    px[i + 1] = Math.round(g * a + px[i + 1] * inv);
    px[i + 2] = Math.round(b * a + px[i + 2] * inv);
    px[i + 3] = Math.round(255 * a + px[i + 3] * inv);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cxp = x + 0.5;
      const cyp = y + 0.5;

      // ריבוע מעוגל: מרחק חתום מהמלבן הפנימי.
      const qx = Math.abs(cxp - size / 2) - (box / 2 - radius);
      const qy = Math.abs(cyp - size / 2) - (box / 2 - radius);
      const outside =
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      // אנטי-אליאסינג ברוחב פיקסל אחד — בלעדיו הקצוות משוננים ב-192px.
      const bgAlpha = Math.max(0, Math.min(1, 0.5 - outside));
      if (bgAlpha > 0) set(i, ACCENT, bgAlpha);

      const d = Math.min(
        distToSegment(cxp, cyp, ax, ay, bx, by),
        distToSegment(cxp, cyp, bx, by, cx, cy),
      );
      const fgAlpha = Math.max(0, Math.min(1, 0.5 - (d - stroke / 2)));
      if (fgAlpha > 0) set(i, ON_ACCENT, fgAlpha);
    }
  }
  return Buffer.from(px);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, pad: 0.04 },
  { file: 'icon-512.png', size: 512, pad: 0.04 },
  // safe-zone של 20% מכל צד — הדרישה של purpose="maskable".
  { file: 'icon-maskable-512.png', size: 512, pad: 0.2 },
];

for (const { file, size, pad } of targets) {
  const png = encodePng(size, drawIcon(size, pad));
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`icons: ${file} (${size}×${size}, ${png.length} bytes)`);
}
