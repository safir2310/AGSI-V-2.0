/**
 * GENERATOR PDF STRUK TANPA DEPENDENSI (v1.3.23) — permintaan pemilik:
 * "saat cetak struk simpan dalam bentuk PDF". Alih-alih membuka dialog cetak
 * sistem yang tidak reliabel di sebagian perangkat (spooler nonaktif dsb.),
 * tombol Cetak/Simpan di aplikasi kini menulis file PDF sungguhan ke
 * Unduhan/AGSI — siap dibagikan via WhatsApp, dibuka, atau dicetak manual.
 *
 * Implementasi: PDF 1.4 minimalis — font base-14 Courier & Courier-Bold
 * (bawaan semua pembaca PDF, TANPA embed font), lebar kertas 66 mm (gaya
 * struk termal, sama dengan pratinjau HTML), tinggi mengikuti isi. Semua
 * teks dipaksa ASCII (emoji & karakter khusus dialihkan) sehingga panjang
 * string = panjang byte — tabel xref bisa dihitung langsung.
 */

import { STORE_ADDRESS, STORE_PHONE } from "@/lib/store-info";

/* ===== Tipe input — subset struktur receiptData() di ReceiptSheet ===== */
export type StrukPdfItem = {
  qty: number;
  name: string;
  note?: string | null;
  lineTotal: number;
};

export type StrukPdfInput = {
  code: string;
  waktu: string;
  dibayar?: string | null;
  pelanggan: string;
  phone?: string | null;
  layanan: string;
  dest?: string | null;
  note?: string | null;
  items: StrukPdfItem[];
  subtotal: number;
  deliveryFee: number;
  voucherCode?: string | null;
  voucherDiscount: number;
  total: number;
  bayar: string;
  lunas: boolean;
};

/* ===== Geometri kertas (poin PDF, 66 mm lebar seperti pratinjau) ===== */
const PW = 187; // 66 mm
const MARGIN = 12;
const USABLE = PW - MARGIN * 2;

/** Lebar karakter Courier = 0,6 × ukuran font (definisi standar PDF) */
const charW = (size: number) => size * 0.6;
const textW = (s: string, size: number) => s.length * charW(size);
const lineH = (size: number) => Math.round(size * 1.5) + 1;

/** Nominal gaya struk: "20.000" (tanpa awalan Rp) */
function fmtRp(n: number): string {
  return n.toLocaleString("id-ID");
}

/** Emoji/karakter non-ASCII → padanan ASCII (hilangkan bila tak ada) */
const ASCII_MAP: Record<string, string> = {
  "—": "-",
  "–": "-",
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "›": ">",
  "×": "x",
  "…": "...",
};
function ascii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, (c) => ASCII_MAP[c] ?? "");
}

/** Escape string untuk tanda kurung PDF: \ ( ) */
function pdfStr(s: string): string {
  return ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Pecah teks agar muat dalam `budget` karakter Courier ukuran `size` */
function wrap(s: string, budget: number, size: number): string[] {
  const max = Math.max(6, Math.floor(budget / charW(size)));
  const words = ascii(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
    // kata tunggal lebih panjang dari baris — potong paksa
    while (cur.length > max) {
      lines.push(cur.slice(0, max));
      cur = cur.slice(max);
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

type Seg = { x: number; text: string; font: "F1" | "F2"; size: number };

/** Satu baris terlayout; tinggi baris dihitung dari size terbesar */
type Line = { segs: Seg[]; h: number };

function mkLine(size: number, ...segs: Seg[]): Line {
  return { segs, h: lineH(size) };
}

const left = (text: string, size = 9, font: "F1" | "F2" = "F1"): Seg => ({
  x: MARGIN,
  text,
  font,
  size,
});
const right = (text: string, size = 9, font: "F1" | "F2" = "F1"): Seg => ({
  x: PW - MARGIN - textW(text, size),
  text,
  font,
  size,
});
const center = (text: string, size = 9, font: "F1" | "F2" = "F1"): Seg => ({
  x: (PW - textW(text, size)) / 2,
  text,
  font,
  size,
});

/** Baris "label ........ nilai" dengan pelipatan nilai panjang (alamat dll.) */
function kv(label: string, value: string, boldValue = false): Line[] {
  const size = 9;
  const font: "F1" | "F2" = boldValue ? "F2" : "F1";
  const budget = USABLE - textW(label, size) - 3;
  const chunks = wrap(value, budget, size);
  return chunks.map((c, i) =>
    mkLine(size, left(i === 0 ? label : "", size), right(c, size, font)),
  );
}

const SEP = "-".repeat(Math.floor(USABLE / charW(9)));

/**
 * Bangun PDF struk — kembalikan string base64 (siap dikirim ke jembatan
 * nativeSaveFile sebagai "application/pdf").
 */
export function buildStrukPdf(d: StrukPdfInput): string {
  const lines: Line[] = [];

  // Kepala toko
  lines.push(mkLine(14, center("AYAM GEPREK SAMBAL IJO", 12, "F2")));
  for (const c of wrap(STORE_ADDRESS, USABLE, 8)) lines.push(mkLine(10, center(c, 8)));
  lines.push(mkLine(10, center(`HP ${STORE_PHONE}`, 8)));

  // Info pesanan
  lines.push(mkLine(13, left(SEP)));
  lines.push(...kv("No. Pesanan", d.code, true));
  lines.push(...kv("Waktu", d.waktu));
  lines.push(...kv("Pelanggan", d.pelanggan));
  if (d.phone) lines.push(...kv("No. HP", d.phone));
  lines.push(...kv("Layanan", d.layanan));
  if (d.dest) lines.push(...kv(d.layanan === "Antar Pesanan" ? "Alamat" : "Detail", d.dest));
  if (d.dibayar) lines.push(...kv("Dibayar", d.dibayar));
  if (d.note) {
    for (const c of wrap(`Catatan: ${d.note}`, USABLE, 8)) lines.push(mkLine(11, left(c, 8)));
  }

  // Rincian item
  lines.push(mkLine(13, left(SEP)));
  for (const it of d.items) {
    const price = fmtRp(it.lineTotal);
    const budget = USABLE - textW(price, 9) - 3;
    const chunks = wrap(`${it.qty}x ${it.name}`, budget, 9);
    chunks.forEach((c, i) => lines.push(mkLine(12, left(i === 0 ? c : `   ${c}`), right(i === 0 ? price : ""))));
    if (it.note) for (const c of wrap(`> ${it.note}`, USABLE - 8, 8)) lines.push(mkLine(10, left(`   ${c}`, 8)));
  }

  // Total
  lines.push(mkLine(13, left(SEP)));
  lines.push(...kv("Subtotal", fmtRp(d.subtotal)));
  if (d.deliveryFee > 0) lines.push(...kv("Ongkir", fmtRp(d.deliveryFee)));
  if (d.voucherDiscount > 0)
    lines.push(...kv(`Voucher ${d.voucherCode ?? ""}`, `-${fmtRp(d.voucherDiscount)}`));
  lines.push(
    mkLine(
      15,
      left("TOTAL", 12, "F2"),
      right(`Rp ${fmtRp(d.total)}`, 12, "F2"),
    ),
  );

  // Pembayaran
  lines.push(mkLine(13, left(SEP)));
  lines.push(...kv("Bayar", d.bayar));
  lines.push(...kv("Status", d.lunas ? "LUNAS" : "BELUM BAYAR", d.lunas));

  // Kaki struk
  lines.push(mkLine(13, left(SEP)));
  lines.push(mkLine(12, center("Terima kasih atas pesanan Anda!", 8)));
  lines.push(mkLine(11, center("Selamat menikmati!", 8)));
  lines.push(mkLine(12, center("Simpan struk ini sebagai", 8)));
  lines.push(mkLine(12, center("bukti pembayaran.", 8)));

  // Tinggi kertas mengikuti isi (minimal 340 pt)
  const contentH = lines.reduce((a, l) => a + l.h, 0);
  const H = Math.max(340, contentH + MARGIN + 18);

  // Stream konten: y dihitung dari bawah (kursor turun dari atas kertas)
  let y = H - MARGIN;
  const ops: string[] = [];
  for (const l of lines) {
    y -= l.h;
    for (const s of l.segs) {
      if (!s.text) continue;
      ops.push(
        `BT /${s.font} ${s.size} Tf ${s.x.toFixed(2)} ${y.toFixed(2)} Td (${pdfStr(s.text)}) Tj ET`,
      );
    }
  }
  const stream = ops.join("\n");

  /* ===== Rakit objek PDF + tabel xref (semua ASCII → len = byte) ===== */
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>",
  ];

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return btoa(out);
}
