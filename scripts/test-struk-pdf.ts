/**
 * Uji runtime buildStrukPdf — buat PDF sampel lalu tulis ke /tmp/struk-test/
 * untuk dirender (pdfinfo + pdftoppm). Jalankan: npx tsx scripts/test-struk-pdf.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildStrukPdf, type StrukPdfInput } from "../src/lib/struk-pdf";

const sample: StrukPdfInput = {
  code: "AGSI-261116-C3D4",
  waktu: "16 Nov 2026 19.42",
  dibayar: "16 Nov 2026 19.44",
  pelanggan: "Budi Santoso",
  phone: "0812-3456-7890",
  layanan: "Antar Pesanan",
  dest: "Perumahan Griya Asri Blok C No. 21, RT 04 / RW 06, Kel. Sukamaju, Kec. Cibinong — rumah pagar hijau",
  note: "Sambal ijo dipisah, jangan terlalu pedas — untuk anak juga 🍗",
  items: [
    { qty: 2, name: "Ayam Geprek Sambal Ijo Level 5", note: "nasi tambahan", lineTotal: 34000 },
    { qty: 1, name: "Es Teh Manis Jumbo", lineTotal: 8000 },
    { qty: 3, name: "Tahu Tempe Goreng", lineTotal: 15000 },
  ],
  subtotal: 57000,
  deliveryFee: 9000,
  voucherCode: "HEMAT10K",
  voucherDiscount: 10000,
  total: 56000,
  bayar: "QRIS",
  lunas: true,
};

// v1.3.24 — buildStrukPdf kini mengembalikan STRING PDF MENTAH (ASCII).
// Simulasikan jalur aplikasi persis: nativeSaveFile meng-encode utf8ToBase64
// (TextEncoder → base64), sisi native mendecode → byte PDF harus sah.
const pdf = buildStrukPdf(sample);
const b64 = Buffer.from(new TextEncoder().encode(pdf)).toString("base64"); // = utf8ToBase64
const bytes = Buffer.from(b64, "base64"); // = Base64.decode native
const direct = Buffer.from(pdf, "binary");
mkdirSync("/tmp/struk-test", { recursive: true });
writeFileSync("/tmp/struk-test/Struk-AGSI-261116-C3D4.pdf", bytes);
const ok =
  bytes.subarray(0, 8).toString() === "%PDF-1.4" &&
  bytes.subarray(-5).toString() === "%%EOF" &&
  bytes.equals(direct);
console.log(
  ok ? "ROUND-TRIP OK" : "ROUND-TRIP GAGAL",
  "— byte:", bytes.length, "awal:", bytes.subarray(0, 8).toString(),
  "→ /tmp/struk-test/Struk-AGSI-261116-C3D4.pdf",
);
if (!ok) process.exit(1);
