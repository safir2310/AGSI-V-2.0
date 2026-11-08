/**
 * Dekode barcode yang diambil langsung dari DOM browser (verifikasi akhir
 * bahwa SVG yang dirender benar-benar bisa dibaca pemindai).
 */
const RECTS = JSON.parse(
  '[{"x":30,"w":6},{"x":39,"w":3},{"x":48,"w":9},{"x":63,"w":3},{"x":72,"w":3},{"x":81,"w":12},{"x":96,"w":12},{"x":114,"w":3},{"x":120,"w":3},{"x":129,"w":3},{"x":138,"w":3},{"x":150,"w":6},{"x":162,"w":3},{"x":177,"w":3},{"x":186,"w":6},{"x":195,"w":9},{"x":207,"w":6},{"x":219,"w":3},{"x":228,"w":6},{"x":243,"w":9},{"x":255,"w":3},{"x":261,"w":6}]'
);

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
const BY_WIDTH = new Map(WIKI.map((w, i) => [w, i]));

const MOD = 3; // moduleWidth
// Rekonstruksi run-length: mulai dari bar pertama, bergantian bar/spasi.
// Lebar total = x akhir bar terakhir. Quiet kiri = x bar pertama (30 = 10 modul).
const runs: Array<{ bar: boolean; n: number }> = [];
let prevEnd = RECTS[0].x;
RECTS.forEach((r, i) => {
  const gap = (r.x - prevEnd) / MOD;
  if (i > 0 && gap > 0) runs.push({ bar: false, n: gap });
  runs.push({ bar: true, n: r.w / MOD });
  prevEnd = r.x + r.w;
});

// Kelompokkan 6 run per simbol; stop = 7 run (2331112)
const symbols: number[] = [];
let i = 0;
while (i < runs.length) {
  const next7 = runs.slice(i, i + 7).map((r) => r.n).join("");
  if (next7 === "2331112") {
    symbols.push(106);
    i += 7;
    break;
  }
  const w = runs.slice(i, i + 6).map((r) => r.n).join("");
  const val = BY_WIDTH.get(w);
  if (val == null) throw new Error(`Pola tak dikenal di run ${i}: "${w}"`);
  symbols.push(val);
  i += 6;
}
if (i !== runs.length) throw new Error("Sisa run setelah stop!");

// Dekode
const start = symbols[0];
if (start !== 105) throw new Error(`Start bukan Code C: ${start}`);
const stopVal = symbols[symbols.length - 1];
if (stopVal !== 106) throw new Error("Stop salah");
const data = symbols.slice(1, symbols.length - 2);
const checksum = symbols[symbols.length - 2];
let sum = start;
data.forEach((v, idx) => (sum += (idx + 1) * v));
if (sum % 103 !== checksum) throw new Error(`Checksum salah: ${sum % 103} vs ${checksum}`);
const value = data.map((v) => String(v).padStart(2, "0")).join("");

console.log("Simbol :", symbols.join(","));
console.log("Checksum: OK (mod 103)");
console.log("Hasil decode dari DOM browser:", value);
console.log(value === "82870468" ? "LOLOS ✓ barcode browser dapat discan" : "GAGAL ✗");
process.exit(value === "82870468" ? 0 : 1);
