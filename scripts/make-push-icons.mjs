/**
 * Membuat ikon notifikasi push web (public/push-icon-192.png & 512.png)
 * dari logo AGSI — latar oranye rounded + logo maskot di tengah.
 * Jalankan: node scripts/make-push-icons.mjs
 */
import sharp from "sharp";
import { readFileSync } from "fs";

const ROOT = new URL("..", import.meta.url).pathname;
const logoSvg = readFileSync(`${ROOT}public/logo.svg`, "utf8");

// Hilangkan animasi CSS (tidak berguna di PNG statis)
const staticSvg = logoSvg.replace(/class="z-breathe"\s*/g, "");

async function makeIcon(size) {
  const logoSize = Math.round(size * 0.72);
  const pad = Math.round((size - logoSize) / 2);
  const bg = Buffer.from(`
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#EA580C"/>
      <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="url(#g)"/>
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#F97316"/>
          <stop offset="1" stop-color="#C2410C"/>
        </linearGradient>
      </defs>
    </svg>`);
  const logo = await sharp(Buffer.from(staticSvg), { density: 512 })
    .resize(logoSize, logoSize)
    .png()
    .toBuffer();
  const out = await sharp(bg)
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toFile(`${ROOT}public/push-icon-${size}.png`);
  console.log(`push-icon-${size}.png dibuat (${out.width}x${out.height})`);
}

await makeIcon(192);
await makeIcon(512);
console.log("Selesai.");
