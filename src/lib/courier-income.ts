/**
 * PENDAPATAN KURIR AGSI — fungsi MURNI (tanpa DB/jaringan) agar mudah
 * diuji offline (scripts/test-courier-income.ts).
 *
 * Pendapatan kurir = TOTAL ONGKIR (deliveryFee) pesanan ANTAR yang sudah
 * "Sampai Tujuan" (COMPLETED) dan ditugaskan ke akun kurir itu. Ongkir
 * bukan uang admin — konsisten dengan src/lib/courier-setoran.ts.
 *
 * Waktu selesai pesanan diproksikan dari `updatedAt` (Prisma menyentuhnya
 * saat kurir menekan "Sampai Tujuan" → status COMPLETED).
 *
 * SEMUA batas hari memakai WIB (Asia/Jakarta, UTC+7, tanpa DST) — bukan
 * jam perangkat kurir yang bisa salah set, dan bukan UTC server.
 */

/** Ongkir pesanan = pendapatan kurir (sama dengan courier-setoran.ts) */
export function sumOngkir(fees: Array<number | null | undefined>): number {
  return fees.reduce<number>((sum, f) => sum + (f ?? 0), 0);
}

export type WibDayBounds = {
  /** instan UTC tepat 00:00 WIB HARI INI */
  startOfTodayUtc: Date;
  /** instan UTC tepat 00:00 WIB KEMARIN */
  startOfYesterdayUtc: Date;
  /** instan UTC tepat 00:00 WIB BESOK (batas atas "hari ini") */
  endOfTodayUtc: Date;
};

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7, tanpa DST

/**
 * Batas hari WIB untuk sebuah instan. Teknik: geser jam +7 jam lalu ambil
 * midnight UTC-nya — hasilnya instan UTC yang persis 00:00 WIB.
 */
export function wibDayBounds(now: Date = new Date()): WibDayBounds {
  const shifted = new Date(now.getTime() + WIB_OFFSET_MS);
  const midnightShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  );
  const startOfTodayUtc = new Date(midnightShifted - WIB_OFFSET_MS);
  const startOfYesterdayUtc = new Date(startOfTodayUtc.getTime() - 24 * 60 * 60 * 1000);
  const endOfTodayUtc = new Date(startOfTodayUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startOfTodayUtc, startOfYesterdayUtc, endOfTodayUtc };
}

/** "Hari ini" (WIB) untuk pesanan yang selesai pada instan `completedAt`? */
export function isCompletedToday(completedAt: Date, now: Date = new Date()): boolean {
  const b = wibDayBounds(now);
  return completedAt >= b.startOfTodayUtc && completedAt < b.endOfTodayUtc;
}

/** "Kemarin" (WIB) untuk pesanan yang selesai pada instan `completedAt`? */
export function isCompletedYesterday(completedAt: Date, now: Date = new Date()): boolean {
  const b = wibDayBounds(now);
  return completedAt >= b.startOfYesterdayUtc && completedAt < b.startOfTodayUtc;
}
