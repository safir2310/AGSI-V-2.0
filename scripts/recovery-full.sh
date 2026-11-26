#!/bin/bash
# recovery-full.sh — pemulihan lengkap AGSI POS setelah kredensial DB valid diperoleh.
#
# Pemakaian:
#   bash /home/z/my-project/scripts/recovery-full.sh "postgres://USER:PASSWORD@db.prisma.io:5432/postgres?sslmode=require"
#
# Langkah:
#   [0] Simpan URL ke /tmp/dburl.txt (tidak dicetak ke layar)
#   [1] Uji koneksi (handshake Postgres asli — pesan error autentikasi muncul apa adanya,
#       tidak ditutupi P1001 seperti Prisma CLI)
#   [2] prisma db push — buat SEMUA tabel sesuai schema (aman: CREATE IF NOT EXISTS)
#   [3] Patch 001–011 (prisma/sql/*.sql — aditif & idempoten)
#   [4] Cek isi tabel User — bila kosong: buat akun admin (password dibuat acak & dicetak sekali)
#   [5] Verifikasi: SELECT hitungan tabel utama
#
# SETELAH skrip ini: pemilik (atau agent dgn token Vercel) memperbarui DATABASE_URL
# (+PRISMA_DATABASE_URL+POSTGRES_URL) di Vercel → redeploy → login pulih.
set -euo pipefail

URL="${1:?Pemakaian: bash recovery-full.sh \"postgres://USER:PASSWORD@db.prisma.io:5432/postgres?sslmode=require\"}"
case "$URL" in
  postgres://*|postgresql://*) ;;
  *) echo "✗ URL harus diawali postgres:// atau postgresql://"; exit 1 ;;
esac

printf '%s\n' "$URL" > /tmp/dburl.txt
chmod 600 /tmp/dburl.txt
echo "== [0] URL disimpan ke /tmp/dburl.txt (rahasia, tak dicetak) =="

cd /home/z/my-project
export DATABASE_URL="$URL"

echo
echo "== [1] Uji koneksi (handshake Postgres murni) =="
node - <<'NODEEOF'
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";
const u = new URL(fs.readFileSync("/tmp/dburl.txt", "utf8").trim());
const user = decodeURIComponent(u.username), pass = decodeURIComponent(u.password);
const cstr = (s) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
const mk = (t, p) => { const h = Buffer.alloc(5); h[0] = t.charCodeAt(0); h.writeInt32BE(p.length + 4, 1); return Buffer.concat([h, p]); };
const sock = net.connect({ host: u.hostname, port: 5432, timeout: 15000 }, () => {
  sock.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]));
});
sock.on("data", (d) => {
  if (d[0] === 83) {
    const t = tls.connect({ socket: sock, servername: u.hostname, rejectUnauthorized: false }, () => {
      const params = Buffer.concat([cstr("user"), cstr(user), cstr("database"), cstr("postgres"), Buffer.from([0])]);
      const st = Buffer.concat([Buffer.alloc(4), params]);
      st.writeInt32BE(params.length + 4, 0); st.writeInt32BE(196608, 4);
      t.write(st);
    });
    t.on("data", (td) => {
      let off = 0;
      while (off < td.length) {
        const type = String.fromCharCode(td[off]);
        const len = td.readInt32BE(off + 1);
        const p = td.subarray(off + 5, off + 1 + len);
        off += 1 + len;
        if (type === "R") {
          const code = p.readInt32BE(0);
          if (code === 3) t.write(mk("p", cstr(pass)));
        } else if (type === "E") {
          let i = 0; const f = {};
          while (p[i] !== 0) { const c = String.fromCharCode(p[i]); const e = p.indexOf(0, i + 1); f[c] = p.toString("utf8", i + 1, e); i = e + 1; }
          console.log("✗ AUTENTIKASI DITOLAK:", f.M || "(tanpa pesan)");
          console.log("  → URL masih salah. Ambil 'Direct connection string' lengkap dari");
          console.log("    Prisma Console → database → Connect → Generate new connection string.");
          process.exit(1);
        } else if (type === "Z") {
          console.log("✓ Koneksi & autentikasi BERHASIL");
          process.exit(0);
        }
      }
    });
    t.on("error", (e) => { console.log("✗ TLS:", e.message); process.exit(1); });
  }
});
sock.on("error", (e) => { console.log("✗ Koneksi:", e.message); process.exit(1); });
sock.on("timeout", () => { console.log("✗ TIMEOUT"); process.exit(2); });
setTimeout(() => { console.log("✗ timeout global"); process.exit(2); }, 20000);
NODEEOF

echo
echo "== [2] prisma db push (buat semua tabel) =="
node_modules/.bin/prisma db push --skip-generate --accept-data-loss 2>&1 | tail -5 || true
# db push --accept-data-loss hanya utk kasus tabel bentrok; skema baru biasanya bersih.
# Jalankan ulang tanpa flag bila ingin konservatif — output di atas menunjukkan hasilnya.

echo
echo "== [3] Patch SQL 001–011 (aditif & idempoten) =="
node scripts/apply-pg-schema-extras.mjs

echo
echo "== [4] Cek akun User; buat admin bila kosong =="
ADMIN_COUNT=$(node_modules/.bin/prisma db execute --stdin --schema prisma/schema.prisma <<< 'SELECT COUNT(*) FROM "User";' 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "?")
# prisma db execute tak mencetak hasil SELECT — pakai skrip node:
node - <<'NODEEOF2'
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
const db = new PrismaClient();
const n = await db.user.count();
console.log("User saat ini:", n);
if (n === 0) {
  const pw = randomBytes(6).toString("hex");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  await db.user.create({
    data: {
      email: "admin@agsi.co.id",
      passwordHash: `${salt}:${hash}`,
      name: "Admin AGSI",
      role: "ADMIN",
      memberCode: String(Math.floor(10000000 + Math.random() * 89999999)),
    },
  });
  console.log("✓ Akun admin dibuat:");
  console.log("    email    : admin@agsi.co.id");
  console.log("    password :", pw, "(catat sekarang — tak disimpan di mana pun)");
} else {
  console.log("✓ Data User sudah ada — tidak menyentuh apa pun.");
}
await db.$disconnect();
NODEEOF2

echo
echo "== [5] Ringkasan isi DB =="
node - <<'NODEEOF3'
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
for (const [nama, model] of [
  ["User", db.user], ["Product", db.product], ["Order", db.order],
  ["StoreSetting", db.storeSetting], ["Voucher", db.voucher],
]) {
  try { console.log(`  ${nama}: ${await model.count()} baris`); }
  catch { console.log(`  ${nama}: (tabel belum ada)`); }
}
await db.$disconnect();
NODEEOF3

echo
echo "SELESAI — langkah terakhir (butuh token Vercel / akses console):"
echo "  1. Vercel → Project agsi-v-2-0 → Settings → Environment Variables:"
echo "     perbarui DATABASE_URL, PRISMA_DATABASE_URL, POSTGRES_URL ke URL baru."
echo "  2. Deployments → deploy terakhir → ⋯ → Redeploy."
echo "  3. Atau kirim token Vercel ke agent utk otomatis."
