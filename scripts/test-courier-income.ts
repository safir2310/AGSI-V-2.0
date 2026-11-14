/**
 * Uji unit batas hari WIB & penjumlahan ongkir — jalankan:
 * bunx tsx scripts/test-courier-income.ts
 * Murni tanpa DB: menguji src/lib/courier-income.ts.
 */
import { wibDayBounds, isCompletedToday, isCompletedYesterday, sumOngkir } from "../src/lib/courier-income";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
}
/** Instan UTC dari string UTC */
const utc = (iso: string) => new Date(iso);

console.log("== 1. Batas hari WIB (UTC+7, tanpa DST) ==");
// Siang WIB 2026-11-14 10:00 WIB = 03:00 UTC
const siang = wibDayBounds(utc("2026-11-14T03:00:00Z"));
check("start hari ini = 2026-11-14 00:00 WIB (13-14 17:00 UTC)",
  siang.startOfTodayUtc.toISOString() === "2026-11-13T17:00:00.000Z",
  siang.startOfTodayUtc.toISOString());
check("start kemarin = 2026-11-13 00:00 WIB (12-13 17:00 UTC)",
  siang.startOfYesterdayUtc.toISOString() === "2026-11-12T17:00:00.000Z",
  siang.startOfYesterdayUtc.toISOString());
check("durasi 1 hari tepat",
  siang.endOfTodayUtc.getTime() - siang.startOfTodayUtc.getTime() === 24 * 3600 * 1000);

// Tepat tengah malam WIB 00:00 = 17:00 UTC sebelumnya
const tepat00 = wibDayBounds(utc("2026-11-14T17:00:00Z"));
check("tepat 00:00 WIB sudah dianggap hari BERIKUTNYA",
  tepat00.startOfTodayUtc.toISOString() === "2026-11-14T17:00:00.000Z",
  tepat00.startOfTodayUtc.toISOString());

// Larik pergeseran bulan/tahun (akhir bulan & akhir tahun)
const akhirBulan = wibDayBounds(utc("2026-12-01T02:00:00Z")); // 09:00 WIB 1 Des
check("lintas bulan: 1 Des 2026 00:00 WIB = 30 Nov 17:00 UTC",
  akhirBulan.startOfTodayUtc.toISOString() === "2026-11-30T17:00:00.000Z",
  akhirBulan.startOfTodayUtc.toISOString());
const akhirTahun = wibDayBounds(utc("2027-01-01T00:30:00Z")); // 07:30 WIB 1 Jan
check("lintas tahun: 1 Jan 2027 00:00 WIB = 31 Des 17:00 UTC",
  akhirTahun.startOfTodayUtc.toISOString() === "2026-12-31T17:00:00.000Z",
  akhirTahun.startOfTodayUtc.toISOString());

console.log("== 2. Klasifikasi selesai hari ini / kemarin (10:00 WIB) ==");
const now = utc("2026-11-14T03:00:00Z");
check("selesai 09:00 WIB hari ini → HARI INI",
  isCompletedToday(utc("2026-11-14T02:00:00Z"), now));
check("selesai 23:59 WIB kemarin → KEMARIN (bukan hari ini)",
  isCompletedYesterday(utc("2026-11-13T16:59:00Z"), now) &&
  !isCompletedToday(utc("2026-11-13T16:59:00Z"), now));
check("selesai tepat 00:00 WIB hari ini → HARI INI",
  isCompletedToday(utc("2026-11-13T17:00:00Z"), now));
check("selesai tepat 00:00 WIB kemarin → KEMARIN",
  isCompletedYesterday(utc("2026-11-12T17:00:00Z"), now));
check("selesai 2 hari lalu → bukan keduanya",
  !isCompletedToday(utc("2026-11-12T10:00:00Z"), now) &&
  !isCompletedYesterday(utc("2026-11-12T10:00:00Z"), now));
check("selesai besok (jam server salah) → bukan hari ini",
  !isCompletedToday(utc("2026-11-15T02:00:00Z"), now));

console.log("== 3. Penjumlahan ongkir ==");
check("jumlah biasa", sumOngkir([1000, 2000, 1500]) === 4500);
check("null/undefined dianggap 0", sumOngkir([1000, null, undefined, 500]) === 1500);
check("array kosong = 0", sumOngkir([]) === 0);

console.log(`\n${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
