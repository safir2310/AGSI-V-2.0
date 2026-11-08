/**
 * ===== PENGANTARAN & ONGKIR AGSI =====
 *
 * Aturan ongkir (permintaan owner):
 *   Rp 1.000 per 1 km — berlaku KELIPATAN JARAK.
 *   Contoh: 0,4 km → 1 km  × 1.000 = Rp 1.000
 *           2,4 km → 3 km  × 1.000 = Rp 3.000
 *           7,8 km → 8 km  × 1.000 = Rp 8.000
 *   (jarak dibulatkan KE ATAS ke kilometer terdekat, minimum 1 km)
 *
 * Area layanan alamat KHUSUS Kecamatan Pidie, Kab. Pidie, Aceh 24151 —
 * nama gampong diambil dari daftar resmi gampong Kecamatan Pidie.
 * Jarak di bawah adalah perkiraan jarak darat dari toko (Simpang Camat,
 * Gampong Tijue) dan bisa disesuaikan owner kapan saja di daftar ini.
 */

/** Tarif ongkir per kilometer (Rp) */
export const DELIVERY_FEE_PER_KM = 1000;

/** Kode pos area layanan pengantaran */
export const DELIVERY_POSTAL = "24151";

/** Label area layanan yang tampil ke pelanggan */
export const DELIVERY_AREA_LABEL = "Kec. Pidie, Kab. Pidie, Aceh 24151";

export type DeliveryArea = {
  /** id stabil untuk dikirim dari klien & divalidasi server */
  id: string;
  /** nama gampong (resmi Kecamatan Pidie) */
  gampong: string;
  /** perkiraan jarak darat dari toko (km) — boleh pecahan */
  distanceKm: number;
};

/**
 * Daftar area pengantaran — semua di Kecamatan Pidie (24151).
 * Urutan dari yang terdekat ke toko. Jarak = perkiraan config (bukan GPS).
 */
export const DELIVERY_AREAS: DeliveryArea[] = [
  { id: "tijue", gampong: "Tijue", distanceKm: 0.4 },
  { id: "dayah-teungoh", gampong: "Dayah Teungoh", distanceKm: 1.2 },
  { id: "baroh", gampong: "Baroh", distanceKm: 1.8 },
  { id: "lampeudue-tunong", gampong: "Lampeudue Tunong", distanceKm: 2.4 },
  { id: "lampeudue-baroh", gampong: "Lampeudue Baroh", distanceKm: 2.9 },
  { id: "paya", gampong: "Paya", distanceKm: 3.4 },
  { id: "mesjid-reuntoh", gampong: "Mesjid Reuntoh", distanceKm: 3.9 },
  { id: "peukan-baro", gampong: "Peukan Baro", distanceKm: 4.6 },
  { id: "paloh", gampong: "Paloh", distanceKm: 5.6 },
  { id: "keude-keulibeut", gampong: "Keude Keulibeut", distanceKm: 6.8 },
  { id: "ulee-tutue", gampong: "Ulee Tutue", distanceKm: 7.8 },
  { id: "lhok-keutapang", gampong: "Lhok Keutapang", distanceKm: 9.2 },
];

/** Cari area berdasarkan id (dipakai server untuk validasi & hitung ongkir) */
export function findDeliveryArea(id: string): DeliveryArea | undefined {
  return DELIVERY_AREAS.find((a) => a.id === id);
}

/**
 * Ongkir = KELIPATAN JARAK: jarak dibulatkan KE ATAS ke km terdekat,
 * dikali tarif per km. Minimum 1 km (bukan gratis walau sebelah toko).
 */
export function calcDeliveryFee(distanceKm: number): number {
  const km = Math.max(1, Math.ceil(distanceKm));
  return km * DELIVERY_FEE_PER_KM;
}

/** Ongkir untuk sebuah area (null bila id tidak dikenal) */
export function feeForArea(id: string): number | null {
  const area = findDeliveryArea(id);
  return area ? calcDeliveryFee(area.distanceKm) : null;
}

/** "0,4 km" gaya Indonesia (koma desimal) */
export function formatDistance(km: number): string {
  return `${km.toLocaleString("id-ID", { maximumFractionDigits: 1 })} km`;
}

/** Jarak dibulatkan ke atas per km yang dipakai menghitung ongkir */
export function billedKm(distanceKm: number): number {
  return Math.max(1, Math.ceil(distanceKm));
}
