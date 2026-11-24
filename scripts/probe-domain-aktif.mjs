/**
 * probe-domain-aktif.mjs — uji apakah domain milik pemilik sudah VERIFIED di
 * Resend, dengan cara empiris (kunci aktif send-only tak bisa GET /domains):
 * kirim probe dari no-reply@<domain> ke alamat canary.
 * - 200 → domain terverifikasi: OTP email bisa ke SEMUA penerima
 * - 403/422 → domain belum verified (pesan berisi alasannya)
 */
import { readFileSync } from "fs";

const RK = readFileSync("scripts/.rkey", "utf8").trim();
const FROMS = ["no-reply@agsi.co.id", "no-reply@ayamgepreksambalijo.com"];

for (const from of FROMS) {
  try {
    const p = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RK}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `AGSI <${from}>`,
        to: ["diag-probe.agsi@zagent-test.dev"],
        subject: "Probe status domain",
        html: "<p>tes</p>",
      }),
    });
    const pj = await p.json().catch(() => ({}));
    console.log(`${from} → ${p.status}`, p.ok ? "TERKIRIM — domain VERIFIED ✅" : JSON.stringify(pj).slice(0, 220));
  } catch (e) {
    console.log(`${from} → error jaringan:`, String(e).slice(0, 120));
  }
}
