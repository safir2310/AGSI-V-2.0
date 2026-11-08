export {}; // modul agar tsc tenang
import { readFileSync } from "node:fs";
/**
 * Uji POST /v2/charge ke Midtrans PRODUCTION memakai kunci produksi di .env.
 * Membuat transaksi QRIS pending kecil — QR tidak dibayar siapa pun dan
 * kedaluwarsa otomatis (15 menit), TIDAK ADA dana berpindah.
 * Tujuan: memastikan akun produksi aktif & IP server diterima Midtrans.
 */
const env = readFileSync(".env", "utf8");
const getKey = (name: string) =>
  env.split("\n").find((l) => l.startsWith(name + "="))?.slice(name.length + 1).trim() ?? "";
const serverKey = getKey("MIDTRANS_SERVER_KEY_PRODUCTION");
console.log(
  "KEY_LEN=" + serverKey.length + " PREFIX_OK=" + serverKey.startsWith("Mid-server-")
);

const orderId = "AGSI-DIAGP-" + Date.now().toString(36);
const gross = 15000;
const basic = Buffer.from(serverKey + ":").toString("base64");
const res = await fetch("https://api.midtrans.com/v2/charge", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Basic ${basic}`,
  },
  body: JSON.stringify({
    payment_type: "qris",
    transaction_details: { order_id: orderId, gross_amount: gross },
    qris: { acquirer: "gopay" },
    custom_expiry: { expiry_duration: 15, unit: "minute" },
  }),
});
const text = await res.text();
let body: Record<string, unknown> = {};
try {
  body = JSON.parse(text) as Record<string, unknown>;
} catch {
  console.log("RAW_BODY=" + text.slice(0, 300));
}
console.log("ORDER_ID=" + orderId + " GROSS=" + gross);
console.log("HTTP=" + res.status);
console.log("STATUS_CODE=" + body.status_code);
console.log("STATUS_MESSAGE=" + body.status_message);
console.log("TRANSACTION_STATUS=" + body.transaction_status);
if (body.validation_messages) console.log("VALIDATION=" + JSON.stringify(body.validation_messages));
if (res.ok) {
  const qr = String(body.qr_string ?? "");
  console.log("QR_LEN=" + qr.length + " QR_HEAD=" + qr.slice(0, 40));
  console.log("PROD_CHARGE_OK=true");
  // Langsung batalkan transaksi diagnosa agar tidak menggantung pending
  const trxId = String(body.transaction_id ?? "");
  const cancel = await fetch(`https://api.midtrans.com/v2/${orderId}/cancel`, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Basic ${basic}` },
  });
  console.log(`CANCEL_HTTP=${cancel.status} TRX=${trxId.slice(0, 8)}…`);
} else {
  console.log("PROD_CHARGE_OK=false");
}
