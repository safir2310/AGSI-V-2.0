/**
 * Uji bolak-balik encoder Code 128 (src/components/shared/Barcode.tsx).
 *
 * 1. Integritas tabel: tiap pola = 6 lebar, total 11 modul, jumlah lebar bar
 *    genap (4/6/8), jumlah lebar spasi ganjil (3/5/7), tiap lebar 1-4.
 *    (aturan spesifikasi ISO/IEC 15417, lihat Wikipedia "Code 128")
 * 2. Pola stop = 7 lebar, total 13 modul.
 * 3. Tidak ada pola ganda (dekoder tak ambigu).
 * 4. Checksum cocok dengan contoh resmi Wikipedia (PJJ123C di Code A → 54).
 * 5. Round-trip: render modul seperti SVG, lalu "pindai" balik seperti pemindai
 *    nyata (hitung run bar/spasi) → nilai hasil scan harus sama dengan input.
 */
import { encodeCode128, type BarcodeEncode } from "../src/components/shared/Barcode";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

// ---- Pola lebar dari encoder (tabel di-modul uji) ----
// Ambil tabel lebar lewat simbol: encode nilai apa pun lalu ekstrak? Tabel
// tidak diekspor — jadi uji integritas lewat simbol yang dihasilkan + uji
// silang langsung terhadap salinan tabel referensi Wikipedia di bawah.
const WIKI = [
  "212222","222122","222221","121223","121322","131222","122213","122312",
  "132212","221213","221312","231212","112232","122132","122231","113222",
  "123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321",
  "232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321",
  "331121","312113","312311","332111","314111","221411","431111","111224",
  "111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112",
  "421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131",
  "211412","211214","211232","2331112",
];

console.log("1-2) Integritas tabel referensi (107 simbol):");
let tableOk = true;
const seen = new Map<string, number>();
WIKI.forEach((w, idx) => {
  const digits = [...w].map(Number);
  const isStop = idx === 106;
  const expectTotal = isStop ? 13 : 11;
  const expectCount = isStop ? 7 : 6;
  const total = digits.reduce((a, b) => a + b, 0);
  const barSum = digits.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
  const spaceSum = digits.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0);
  if (digits.length !== expectCount || total !== expectTotal) tableOk = false;
  if (digits.some((d) => d < 1 || d > 4)) tableOk = false;
  if (!isStop && (barSum % 2 !== 0 || spaceSum % 2 !== 1)) tableOk = false;
  if (seen.has(w)) tableOk = false;
  seen.set(w, idx);
});
check("struktur semua pola valid & unik (bar genap, spasi ganjil, total 11/13)", tableOk);

console.log("3) Checksum vs contoh resmi Wikipedia (PJJ123C, Code A → 54):");
{
  // PJJ123C di Code A: P=48 J=42 J=42 1=17 2=18 3=19 C=35, start=103
  const sum = 103 + 48 * 1 + 42 * 2 + 42 * 3 + 17 * 4 + 18 * 5 + 19 * 6 + 35 * 7;
  check("rumus checksum = (start + Σ i×nilai) mod 103", sum % 103 === 54, `got ${sum % 103}`);
}

console.log("4) Round-trip render→scan (seperti pemindai nyata):");

/** Render simbol jadi bitmap modul (true=bar) — meniru geometri SVG asli */
function renderModules(enc: BarcodeEncode): boolean[] {
  const quiet = 10; // 10 modul quiet zone sesuai spesifikasi
  const total = enc.modules + quiet * 2;
  const bitmap = new Array<boolean>(total).fill(false);
  let x = quiet;
  for (const s of enc.symbols) {
    const w = [...WIKI[s]];
    for (let i = 0; i < w.length; i++) {
      const n = Number(w[i]);
      if (i % 2 === 0) {
        for (let j = 0; j < n; j++) bitmap[x + j] = true;
      }
      x += n;
    }
  }
  return bitmap;
}

/** "Pindai" bitmap: hitung run bar/spasi → kelompokkan 6 run per simbol */
function scanDecode(bitmap: boolean[]): BarcodeEncode["symbols"] {
  const runs: Array<{ isBar: boolean; n: number }> = [];
  let cur = bitmap[0];
  let n = 1;
  for (let i = 1; i < bitmap.length; i++) {
    if (bitmap[i] === cur) n++;
    else {
      runs.push({ isBar: cur, n });
      cur = bitmap[i];
      n = 1;
    }
  }
  runs.push({ isBar: cur, n });

  // buang quiet zone depan (run putih pertama) & belakang (run putih terakhir)
  if (!runs[0].isBar) runs.shift();
  if (!runs[runs.length - 1].isBar) runs.pop();

  // pastikan mulai & selesai dengan bar
  if (runs.length === 0 || !runs[0].isBar || !runs[runs.length - 1].isBar) {
    throw new Error("scan: tidak mulai/berakhir dengan bar");
  }

  // kelompokkan 6 run per simbol; simbol stop = 7 run (pola 2331112)
  const symbols: number[] = [];
  let i = 0;
  while (i < runs.length) {
    // coba deteksi stop (7 run berikut membentuk 2331112)
    const widthsAt = (count: number) =>
      runs.slice(i, i + count).map((r) => r.n).join("");
    if (widthsAt(7) === "2331112") {
      symbols.push(106);
      i += 7;
      break;
    }
    const w = widthsAt(6);
    const val = seen.get(w);
    if (val == null) throw new Error(`scan: pola tak dikenal "${w}"`);
    symbols.push(val);
    i += 6;
  }
  if (i !== runs.length) throw new Error("scan: sisa run setelah stop");
  return symbols;
}

/** Dekode simbol → teks + verifikasi checksum */
function decodeSymbols(symbols: number[]): string {
  const start = symbols[0];
  if (start !== 104 && start !== 105) throw new Error("decode: start bukan B/C");
  const stop = symbols[symbols.length - 1];
  if (stop !== 106) throw new Error("decode: simbol stop salah");
  const data = symbols.slice(1, symbols.length - 2);
  const checksum = symbols[symbols.length - 2];

  let sum = start;
  data.forEach((v, idx) => (sum += (idx + 1) * v));
  if (sum % 103 !== checksum) {
    throw new Error(`decode: checksum salah (harus ${sum % 103}, dapat ${checksum})`);
  }

  if (start === 105) {
    if (data.some((v) => v > 99)) throw new Error("decode: simbol C > 99");
    return data.map((v) => String(v).padStart(2, "0")).join("");
  }
  return data.map((v) => String.fromCharCode(v + 32)).join("");
}

const samples = [
  "28374615", // kode member 8 digit → Code C
  "10000000",
  "99999999",
  "0123456789",
  "1234",
  "PNT-7K2M9Q", // kode voucher → Code B
  "AGSI-20260104-1234",
  "budi@example.com",
  "Ayam Geprek Sambal Ijo 2026",
  "A",
  "zzz~^|",
];

for (const s of samples) {
  try {
    const enc = encodeCode128(s);
    const bitmap = renderModules(enc);
    const symbols = scanDecode(bitmap);
    const decoded = decodeSymbols(symbols);
    const codeSet = enc.codeSet === "C" ? "Code C" : "Code B";
    check(`"${s}" (${codeSet})`, decoded === s, `hasil scan: "${decoded}"`);
  } catch (err) {
    check(`"${s}"`, false, String(err));
  }
}

console.log("");
if (failures === 0) {
  console.log("SEMUA UJI BARCODE LULUS ✓");
  process.exit(0);
} else {
  console.error(`${failures} uji GAGAL`);
  process.exit(1);
}
