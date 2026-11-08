export {}; // modul agar tsc tenang
import { readFileSync } from "node:fs";
/**
 * Uji langsung POST /v2/charge ke Midtrans sandbox untuk melihat pesan galat.
 * Kunci diambil dari .env (tidak dicetak).
 */
const env = readFileSync(".env", "utf8");
const getKey = (name: string) =>
  env.split("\n").find((l) => l.startsWith(name + "="))?.slice(name.length + 1).trim() ?? "";
const serverKey = getKey("MIDTRANS_SERVER_KEY");
console.log("KEY_LEN=" + serverKey.length + " PREFIX_OK=" + serverKey.startsWith("SB-Mid-server-"));

const basic = Buffer.from(serverKey + ":").toString("base64");
const res = await fetch("https://api.sandbox.midtrans.com/v2/charge", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Basic ${basic}`,
  },
  body: JSON.stringify({
    payment_type: "qris",
    transaction_details: { order_id: "AGSI-DIAG-" + Date.now().toString(36), gross_amount: 16000 },
    qris: { acquirer: "gopay" },
  }),
});
const body = await res.json();
console.log("HTTP=" + res.status);
console.log("STATUS_CODE=" + body.status_code);
console.log("STATUS_MESSAGE=" + body.status_message);
if (body.validation_messages) console.log("VALIDATION=" + JSON.stringify(body.validation_messages));
if (body.summary) console.log("SUMMARY=" + body.summary);
if (res.ok) console.log("QR_HEAD=" + String(body.qr_string ?? "").slice(0, 50));
