/**
 * Uji integrasi Casaku (live ke api.casaku.id):
 *   1. casakuDeviceCheck()  — listener Android online? (validasi license key)
 *   2. createCasakuQrisPayment() dengan QR ID dummy — memastikan request
 *      benar-benar terkirim ke Casaku & error langganan (403) terurai betul.
 *
 * Jalankan: bun scripts/test-casaku.ts
 */
import { casakuDeviceCheck, createCasakuQrisPayment } from "../src/lib/qris-casaku";
import { CASAKU_LICENSE_KEY, CASAKU_QR_ID } from "../src/lib/qris-config";

console.log("== Konfigurasi ==");
console.log("licenseKeyPresent:", CASAKU_LICENSE_KEY.length > 0, `(len ${CASAKU_LICENSE_KEY.length})`);
console.log("qrId:", JSON.stringify(CASAKU_QR_ID) || "(kosong)");

console.log("\n== 1) Device check (GET /api/device/check) ==");
const device = await casakuDeviceCheck();
console.log(JSON.stringify(device, null, 2));

console.log("\n== 2) Generate QRIS (QR ID dummy -> lihat respons error/sukses) ==");
try {
  const trx = await createCasakuQrisPayment({
    amount: 15000,
    reference: "AGSI-CASAKU-TEST",
  });
  console.log("SUKSES:", JSON.stringify(trx, null, 2));
} catch (err) {
  console.log("DITOLAK (diharapkan bila belum langganan):");
  console.log(" - name:", err instanceof Error ? err.name : typeof err);
  console.log(" - message:", err instanceof Error ? err.message : String(err));
}

console.log("\nSelesai.");
process.exit(0);
