/**
 * resend-verify-key.mjs — verifikasi kunci API Resend dari argumen env.
 *   RESEND_TEST_KEY=re_... node scripts/resend-verify-key.mjs
 * Mengecek: (1) kunci valid, (2) daftar domain + status verifikasi,
 * (3) penerima mana yang diizinkan (via percobaan kirim ke 2 alamat uji).
 * Kunci tidak pernah dicetak utuh.
 */
const key = process.env.RESEND_TEST_KEY?.trim();
if (!key || !key.startsWith("re_")) {
  console.log("Kunci tidak valid / tidak diberikan (harus diawali re_)");
  process.exit(2);
}
console.log(`kunci: ${key.slice(0, 9)}…${key.slice(-4)} (${key.length} char)\n`);

const h = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

// 1) daftar domain
const dr = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
console.log(`GET /domains → HTTP ${dr.status}`);
const dj = await dr.json().catch(() => ({}));
if (!dr.ok) {
  console.log("  kunci ditolak:", dj.message ?? "(tanpa detail)");
  process.exit(1);
}
const ds = dj.data ?? [];
console.log(`  domain terdaftar: ${ds.length}`);
for (const d of ds) {
  console.log(`  - ${d.name} | status=${d.status} | region=${d.region ?? "?"}`);
}

// 2) percobaan kirim ke 2 alamat uji — error Resend mengungkap penerima yang diizinkan
for (const to of ["2310musafir@gmail.com", "budi@example.com"]) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      from: "onboarding@resend.dev",
      to: [to],
      subject: "Tes konfigurasi Resend AGSI",
      html: "<p>Uji koneksi Resend untuk alur OTP AGSI — abaikan email ini.</p>",
    }),
  });
  const j = await r.json().catch(() => ({}));
  console.log(`\nkirim ke ${to} → HTTP ${r.status}`);
  if (r.ok) console.log(`  BERHASIL (id ${j.id?.slice(0, 12)}…) — kunci ini BOLEH kirim ke alamat ini`);
  else console.log(`  ditolak: ${j.message ?? "(tanpa detail)"}`);
}
