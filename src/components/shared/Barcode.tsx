"use client";

/**
 * Barcode Code 128 — SVG murni, tanpa dependensi.
 *
 * Tabel pola (lebar bar/spasi per simbol) mengikuti spesifikasi
 * ISO/IEC 15417 (Code 128), diverifikasi terhadap tabel referensi
 * publik Wikipedia "Code 128" (nilai 0-106; stop = 2331112).
 *
 * - Angka semua & panjang genap >= 4 → otomatis pakai Code C (lebih pendek).
 * - Karakter lain → Code B (ASCII 32-126).
 * - Fungsi murni & deterministik → aman untuk SSR/hydration.
 */

/** Lebar 6 bar/spasi untuk tiap simbol; entri 106 (stop) punya 7 angka. */
const WIDTHS: readonly string[] = Object.freeze([
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131",
  "211412", // 103 Start A
  "211214", // 104 Start B
  "211232", // 105 Start C
  "2331112", // 106 Stop (pola 7 lebar, 13 modul)
]);

const START_B = 104;
const START_C = 105;
const STOP = 106;

export type BarcodeEncode = {
  /** urutan nilai simbol: start, data..., checksum, stop */
  symbols: number[];
  /** total lebar dalam modul (termasuk stop 13 modul) */
  modules: number;
  /** code set yang dipakai */
  codeSet: "B" | "C";
};

/** Pilih code set & hitung simbol data + checksum untuk sebuah nilai. */
export function encodeCode128(value: string): BarcodeEncode {
  const chars = [...value];
  if (chars.length === 0) throw new Error("Barcode: nilai kosong");

  const digitsOnly = chars.every((c) => c >= "0" && c <= "9");
  const useCodeC = digitsOnly && chars.length >= 4 && chars.length % 2 === 0;

  const start = useCodeC ? START_C : START_B;
  const data: number[] = [];

  if (useCodeC) {
    for (let i = 0; i < chars.length; i += 2) {
      data.push(Number(chars[i] + chars[i + 1]));
    }
  } else {
    for (const c of chars) {
      const code = c.charCodeAt(0);
      if (code < 32 || code > 126) {
        throw new Error(`Barcode: karakter "${c}" tidak didukung Code B`);
      }
      data.push(code - 32);
    }
  }

  // Checksum: (start + Σ posisi(1..n) × nilai) mod 103
  let sum = start;
  data.forEach((v, i) => {
    sum += (i + 1) * v;
  });
  const checksum = sum % 103;

  const symbols = [start, ...data, checksum, STOP];
  const modules = symbols.reduce((total, s) => total + widthsTotal(WIDTHS[s]), 0);
  return { symbols, modules, codeSet: useCodeC ? "C" : "B" };
}

function widthsTotal(w: string): number {
  let total = 0;
  for (const ch of w) total += Number(ch);
  return total;
}

export type BarcodeProps = {
  value: string;
  /** tinggi batang (px) */
  height?: number;
  /** lebar satu modul (px) */
  moduleWidth?: number;
  /** tampilkan teks nilai di bawah batang */
  showText?: boolean;
  className?: string;
  /** warna batang & teks */
  color?: string;
};

/** Render barcode Code 128 sebagai SVG (untuk discan pemindai kasir). */
export function Barcode({
  value,
  height = 64,
  moduleWidth = 2,
  showText = true,
  className,
  color = "#1C1917",
}: BarcodeProps) {
  let enc: BarcodeEncode;
  try {
    enc = encodeCode128(value);
  } catch {
    // nilai tidak valid → jangan render batang salah baca
    return (
      <span className={className} role="img" aria-label={`Barcode ${value}`}>
        {value}
      </span>
    );
  }

  // Quiet zone kiri-kanan minimal 10 modul (wajib menurut spesifikasi)
  const quiet = 10 * moduleWidth;
  const width = enc.modules * moduleWidth + quiet * 2;
  const textH = showText ? 16 : 0;
  const fontSize = Math.min(13, Math.max(9, moduleWidth * 5));

  // Susun persegi (x, w) untuk setiap bar hitam
  const bars: Array<{ x: number; w: number }> = [];
  let x = quiet;
  for (const s of enc.symbols) {
    const w = WIDTHS[s];
    for (let i = 0; i < w.length; i++) {
      const widthModules = Number(w[i]);
      const isBar = i % 2 === 0; // mulai dari bar
      if (isBar) bars.push({ x, w: widthModules * moduleWidth });
      x += widthModules * moduleWidth;
    }
  }

  return (
    <svg
      className={className}
      width={width}
      height={height + textH}
      viewBox={`0 0 ${width} ${height + textH}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Barcode ${value}`}
      shapeRendering="crispEdges"
    >
      <rect x="0" y="0" width={width} height={height + textH} fill="#FFFFFF" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill={color} />
      ))}
      {showText && (
        <text
          x={width / 2}
          y={height + fontSize}
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize={fontSize}
          fontWeight={700}
          letterSpacing={moduleWidth}
          fill={color}
        >
          {value}
        </text>
      )}
    </svg>
  );
}
