/**
 * Uji unit kebijakan sandi AGSI — jalankan: bunx tsx scripts/test-password-policy.ts
 * Tanpa menyentuh DB: murni menguji validatePassword & suggestPassword.
 */
import { validatePassword, suggestPassword, PASSWORD_MIN } from "../src/lib/password-policy";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
}
function rejected(pw: string, opts?: { email?: string | null }): boolean {
  return !validatePassword(pw, opts).ok;
}
function accepted(pw: string, opts?: { email?: string | null }): boolean {
  return validatePassword(pw, opts).ok;
}

console.log("== 1. Sandi umum/bocor DITOLAK (penyebab peringatan Chrome) ==");
check("kurir123 ditolak", rejected("kurir123"));
check("Kurir123 (beda kapital) ditolak", rejected("Kurir123"));
check("admin123 ditolak", rejected("admin123"));
check("password123 ditolak", rejected("password123"));
check("kasir1234 ditolak", rejected("kasir1234"));
check("agsi2026 ditolak", rejected("agsi2026"));
check("12345678 ditolak", rejected("12345678"));
check("geprek123 ditolak", rejected("geprek123"));

console.log("== 2. Aturan bentuk ==");
check("terlalu pendek ditolak", rejected("Ab12"));
check("tanpa angka ditolak", rejected("sandiKuatAja"));
check("tanpa huruf ditolak", rejected("1234567890"));
check("ulang 4x ditolak", rejected("Aaaa1111x"));
check("urutan 5 ditolak", rejected("Abcde123x"));
check("urutan turun ditolak", rejected("Zyxwv987x"));
check("memuat email ditolak", rejected("Budi98xsel", { email: "budi@agsi.com" }));

console.log("== 3. Sandi kuat DITERIMA ==");
check("GeprekMantap7x diterima", accepted("GeprekMantap7x"));
check("sandi panjang campur diterima", accepted("Ayam-Geprek-2026-SambalIjo"));
check("email beda nama ok", accepted("GeprekMantap7x", { email: "kurir@agsi.com" }));

console.log("== 4. Generator usulan ==");
for (let i = 0; i < 200; i++) {
  const s = suggestPassword();
  if (!accepted(s) || s.length < PASSWORD_MIN) { fail++; console.log(`  ✗ usulan ditolak: ${s}`); break; }
  pass++;
}
console.log("  ✓ 200 usulan acak semuanya lolos kebijakan");
check("dua usulan berurutan beda", suggestPassword() !== suggestPassword());

console.log("== 5. Mode santai KURIR (relaxed) ==");
check("nama saja 'budiono' (7 huruf) diterima", accepted("budiono", { relaxed: true }));
check("nama pendek 'budi' (4 huruf) ditolak — di bawah min 6", rejected("budi", { relaxed: true }));
check("nama+angka 'budi123' diterima", accepted("budi123", { relaxed: true }));
check("angka berurutan '123456' diterima", accepted("123456", { relaxed: true }));
check("'kurir123' (denylist ketat) diterima relaxed", accepted("kurir123", { relaxed: true }));
check("'111111' (ulangan) diterima relaxed", accepted("111111", { relaxed: true }));
check("'agusantarno' nama panjang diterima", accepted("agusantarno", { relaxed: true }));
check("terlalu pendek 'budi1' ditolak", rejected("budi1", { relaxed: true }));
check("terlalu pendek '12345' ditolak", rejected("12345", { relaxed: true }));
check("kosong ditolak", rejected("      ", { relaxed: true }));
check("relaxed TIDAK berlaku tanpa flag: 'kurir123' tetap ditolak", rejected("kurir123"));

console.log(`\n${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
