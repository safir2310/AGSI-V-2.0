/**
 * copy-apk.mjs — salin APK rilis terbaru dari download/ ke public/agsi-app.apk
 * agar bisa diunduh LANGSUNG dari situs web (di dalam aplikasi: tombol
 * "Perbarui" banner memicu DownloadManager Android).
 *
 * Dijalankan otomatis oleh `npm run build` SEBELUM `next build`.
 * Kalau tidak ada APK di download/, build tetap lanjut (hanya peringatan).
 */
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "download");
const outDir = path.join(root, "public");
const outFile = path.join(outDir, "agsi-app.apk");

const verCmp = (a, b) => {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

const files = existsSync(srcDir)
  ? readdirSync(srcDir)
      .map((f) => {
        const m = f.match(/^AGSI-release-(\d+\.\d+\.\d+)\.apk$/);
        return m ? { file: f, ver: m[1] } : null;
      })
      .filter(Boolean)
  : [];

if (files.length === 0) {
  if (existsSync(outFile)) {
    console.log("copy-apk: tidak ada APK baru di download/ — pakai public/agsi-app.apk yang ada");
  } else {
    console.warn("copy-apk: PERINGATAN — tidak ada AGSI-release-*.apk di download/, /agsi-app.apk tidak tersedia");
  }
  process.exit(0);
}

// Pilih versi tertinggi (bukan urutan alfabet — 1.2.10 > 1.2.9)
files.sort((a, b) => verCmp(b.ver, a.ver));
const best = files[0];

mkdirSync(outDir, { recursive: true });
copyFileSync(path.join(srcDir, best.file), outFile);
const mb = (statSync(outFile).size / (1024 * 1024)).toFixed(1);
console.log(`copy-apk: ${best.file} (v${best.ver}, ${mb} MB) → public/agsi-app.apk`);
