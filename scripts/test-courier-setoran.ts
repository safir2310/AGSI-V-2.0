/**
 * Uji ATURAN UANG COD KURIR (src/lib/courier-setoran.ts) — murni offline,
 * tanpa DB/jaringan. Memastikan:
 *
 *   A. "Sampai Tujuan" kurir: hanya pesanan ANTAR miliknya yang READY bisa
 *      ditandai COMPLETED — pesanan kurir lain / status lain / perubahan
 *      lain (paymentStatus manual, status→CANCELLED) DITOLAK.
 *   B. Penandaan COD: pesanan antar tunai (CASH) belum lunas → PAID +
 *      paidVia "COD" saat kurir menyelesaikan; QRIS/e-wallet TIDAK
 *      ditandai (pelunasan digital hanya lewat verifikasi otomatis);
 *      yang sudah PAID tidak diutak-atik; TAKEAWAY tidak dianggap COD.
 *   C. Kantong setoran: hanya paidVia "COD" & belum terikat setoran
 *      (codSetoranId NULL) dihitung; jumlah = penjumlahan total; setelah
 *      diikat (codSetoranId terisi) → kembali 0.
 *
 *   bun scripts/test-courier-setoran.ts
 */
import { codCompletionMarking, courierCompleteDecision, isCodDelivery, isUndepositedCod, setoranSummary } from "../src/lib/courier-setoran";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const kurir = { id: "kurir-1", role: "COURIER" };
const kurirLain = { id: "kurir-2", role: "COURIER" };
const admin = { id: "adm", role: "ADMIN" };

const orderReadyKurir1 = {
  id: "o1",
  type: "DELIVERY",
  status: "READY",
  paymentMethod: "CASH",
  paymentStatus: "UNPAID",
  courierUserId: "kurir-1",
  total: 33000,
};

console.log("\n=== A. Tombol 'Sampai Tujuan' kurir ===");

// A1. Bug lama: kurir dulu SELALU ditolak (403) — kini boleh untuk pesanannya
ok(
  "kurir boleh menyelesaikan pesanan antarnya sendiri (READY → COMPLETED)",
  courierCompleteDecision(kurir, orderReadyKurir1, { status: "COMPLETED" }).ok === true
);
ok(
  "kurir lain DITOLAK (pesanan bukan tugasnya)",
  courierCompleteDecision(kurirLain, orderReadyKurir1, { status: "COMPLETED" }).code === 403
);
ok(
  "pesanan sudah COMPLETED → ditolak (tidak bisa diproses dua kali)",
  courierCompleteDecision(kurir, { ...orderReadyKurir1, status: "COMPLETED" }, { status: "COMPLETED" }).code === 400
);
ok(
  "pesanan PREPARING (belum serah ke kurir) → ditolak",
  courierCompleteDecision(kurir, { ...orderReadyKurir1, status: "PREPARING" }, { status: "COMPLETED" }).code === 400
);
ok(
  "kurir mencoba ubah status lain (CANCELLED) → ditolak",
  courierCompleteDecision(kurir, orderReadyKurir1, { status: "CANCELLED" }).code === 403
);
ok(
  "kurir mencoba tandai lunas manual (paymentStatus) → ditolak",
  courierCompleteDecision(kurir, orderReadyKurir1, { paymentStatus: "PAID" }).code === 403
);
ok(
  "pesanan tak ditemukan → 404",
  courierCompleteDecision(kurir, null, { status: "COMPLETED" }).code === 404
);
ok(
  "role ADMIN memakai jalur kurir → ditolak (jalur admin terpisah)",
  courierCompleteDecision(admin, orderReadyKurir1, { status: "COMPLETED" }).code === 403
);

console.log("\n=== B. Penandaan COD saat selesai ===");

// B1. Tunai belum lunas → PAID + paidVia COD (uang ke tangan kurir)
const m1 = codCompletionMarking(orderReadyKurir1);
ok("antar tunai UNPAID → dilunasi di tempat", m1?.paymentStatus === "PAID");
ok("paidVia = 'COD' (penanda uang di tangan kurir)", m1?.paidVia === "COD");

// B2. Digital TIDAK ditandai — pelunasan hanya oleh sistem
ok(
  "QRIS UNPAID → tanpa penandaan (verifikasi otomatis sistem)",
  codCompletionMarking({ ...orderReadyKurir1, paymentMethod: "QRIS" }) === null
);
ok(
  "E-WALLET UNPAID → tanpa penandaan",
  codCompletionMarking({ ...orderReadyKurir1, paymentMethod: "EWALLET" }) === null
);

// B3. Sudah lunas (QRIS terverifikasi sebelum sampai) → tak diutak-atik
ok(
  "QRIS sudah PAID → tanpa penandaan",
  codCompletionMarking({ ...orderReadyKurir1, paymentMethod: "QRIS", paymentStatus: "PAID", paidVia: "AUTO" }) === null
);
ok(
  "tunai sudah PAID (kasir verifikasi) → tanpa penandaan",
  codCompletionMarking({ ...orderReadyKurir1, paymentStatus: "PAID", paidVia: "CASH" }) === null
);

// B4. Pesanan non-antar bukan COD kurir
ok(
  "TAKEAWAY tunai → bukan COD kurir",
  isCodDelivery({ ...orderReadyKurir1, type: "TAKEAWAY" }) === false
);
ok("DELIVERY tunai → COD kurir", isCodDelivery(orderReadyKurir1) === true);

console.log("\n=== C. Kantong setoran (harus disetor → 0 setelah setor) ===");

const kantong = [
  { ...orderReadyKurir1, total: 33000, paidVia: "COD", codSetoranId: null },
  { ...orderReadyKurir1, id: "o2", total: 21500, paidVia: "COD", codSetoranId: null },
  { ...orderReadyKurir1, id: "o3", total: 40000, paidVia: "AUTO", codSetoranId: null }, // QRIS — bukan uang tunai
  { ...orderReadyKurir1, id: "o4", total: 25000, paidVia: "CASH", codSetoranId: null }, // lunas di kasir
  { ...orderReadyKurir1, id: "o5", total: 15000, paidVia: "COD", codSetoranId: "setoran-lama" }, // sudah disetor
];

const sum = setoranSummary(kantong);
ok("hanya COD belum disetor dihitung (2 pesanan)", sum.count === 2);
ok("jumlah = 33.000 + 21.500 = 54.500", sum.amount === 54500, formatRupiah(sum.amount));

// Setelah setor: semua pesanan terikat setoran → kantong kembali ke 0
const setelahSetor = kantong.map((o) => ({ ...o, codSetoranId: "setoran-baru" }));
const sum2 = setoranSummary(setelahSetor);
ok("setelah disetor ke admin → kantong kembali 0 pesanan", sum2.count === 0);
ok("setelah disetor ke admin → kantong kembali Rp0", sum2.amount === 0);

// IsUndepositedCod presisi
ok("paidVia COD tanpa setoran → tertunggak", isUndepositedCod({ paidVia: "COD", codSetoranId: null }) === true);
ok("paidVia COD sudah terikat setoran → bukan tertunggak", isUndepositedCod({ paidVia: "COD", codSetoranId: "s1" }) === false);
ok("paidVia CASH → bukan tertunggak", isUndepositedCod({ paidVia: "CASH", codSetoranId: null }) === false);

function formatRupiah(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}

console.log(`\n===== HASIL: ${pass} lulus, ${fail} gagal =====`);
if (fail > 0) process.exit(1);
