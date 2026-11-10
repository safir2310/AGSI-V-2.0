/**
 * Verifikasi turunan QR DINAMIS dari QRIS statis toko:
 * membangun payload untuk contoh nominal, lalu membedahnya kembali
 * (TLV) dan memeriksa ulang CRC16 — tanpa memindai QR sungguhan.
 *
 * Jalur: bun scripts/verify-statis-qris.ts
 */
import { buildStatisQrisPayload, getStatisMerchantInfo, QRIS_STATIS_ENABLED, QRIS_STATIS_PAYLOAD } from "../src/lib/qris-statis";
import { crc16CCITT } from "../src/lib/qris";

function parseTlv(payload: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    const value = payload.slice(i + 4, i + 4 + len);
    if (!Number.isInteger(len) || value.length < len) break;
    out.push([id, value]);
    i += 4 + len;
  }
  return out;
}

function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
}

console.log("=== QRIS STATIS TOKO ===");
console.log("enabled:", QRIS_STATIS_ENABLED);
const info = getStatisMerchantInfo();
console.log("merchant:", info);

for (const amount of [27500, 15000, 125000]) {
  console.log(`\n=== Turunan dinamis Rp${amount.toLocaleString("id-ID")} ===`);
  const dyn = buildStatisQrisPayload({ amount, reference: "AGSI-20261108-777" });
  console.log("payload:", dyn);

  const tags = parseTlv(dyn);
  const map = new Map(tags);
  check("format indicator 00=01", map.get("00") === "01");
  check("POI 01=12 (dinamis sekali pakai)", map.get("01") === "12", map.get("01"));

  const acc26 = new Map(parseTlv(map.get("26") ?? ""));
  const nat51 = new Map(parseTlv(map.get("51") ?? ""));
  check("GoPay merchant 26-01 utuh", acc26.get("01") === "936009143482522598", acc26.get("01"));
  check("GoPay merchant 26-02 utuh", acc26.get("02") === "G482522598", acc26.get("02"));
  check("QRIS nasional 51-02 NMID", nat51.get("02") === "ID1025429162544", nat51.get("02"));

  check("nominal 54", map.get("54") === `${amount.toFixed(2)}`, map.get("54"));
  check("mata uang 53=360", map.get("53") === "360");
  check("MCC 52=5812", map.get("52") === "5812");
  check("negara 58=ID", map.get("58") === "ID");
  const add62 = new Map(parseTlv(map.get("62") ?? ""));
  check("referensi 62-05 = AGSI20261108777", add62.get("05") === "AGSI20261108777", add62.get("05"));
  check("kriteria 62-07 = A01 utuh", add62.get("07") === "A01", add62.get("07"));

  const crcIn = dyn.slice(-4);
  const crcCalc = crc16CCITT(dyn.slice(0, -4));
  check("CRC16 valid", crcIn === crcCalc, `${crcIn} vs ${crcCalc}`);

  // Nominal statis TIDAK boleh ikut ke payload dinamis
  check("statis tanpa 54 tetap beda", dyn !== QRIS_STATIS_PAYLOAD);
}
