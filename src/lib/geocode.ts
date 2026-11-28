/**
 * Geokode alamat → koordinat (fallback bila pelanggan tidak menempel pin
 * GPS saat checkout). Memakai Nominatim (OpenStreetMap) gratis tanpa API key:
 * https://nominatim.org/release-docs/latest/api/Search/ — wajib menyertakan
 * User-Agent identitas aplikasi; permintaan dibatasi MURNI sesuai kebutuhan
 * (volume pesanan antar rendah) + cache di memori proses.
 *
 * Dipakai GET /api/orders/[id]/track untuk menyediakan pin pelanggan ke
 * peta kurir bila deliveryLat/deliveryLng kosong. Gagal / lembat → null:
 * UI turun ke tombol Google Maps berbasis alamat (perilaku lama).
 */

type GeocodeResult = { lat: number; lng: number } | null;

const UA = "AGSI-POS/1.0 (layanan pelacakan kurir; kontak: admin AGSI Pidie)";
const TTL_MS = 10 * 60_000; // hasil alamat sama dipakai ulang 10 menit

const cache = new Map<string, { at: number; res: GeocodeResult }>();

/** Hapus entri cache yang lewat TTL (dipanggil ringan tiap permintaan). */
function sweep() {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > TTL_MS) cache.delete(k);
}

/**
 * Geokode satu alamat. Selalu aman dipanggil: SEMUA kegagalan (offline,
 * rate limit, alamat tak ketemu) mengembalikan null tanpa melempar.
 */
export async function geocodeAddress(
  address?: string | null,
  area?: string | null,
): Promise<GeocodeResult> {
  const q = [address, area].filter(Boolean).join(", ").trim();
  if (!q) return null;
  sweep();
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.res;

  let res: GeocodeResult = null;
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=id&q=" +
      encodeURIComponent(q);
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      // Jangan biarkan geokoding menahan pelacakan: 5 dtk cukup
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (r.ok) {
      const rows = (await r.json()) as Array<{ lat?: string; lon?: string }>;
      const row = rows[0];
      if (row?.lat && row?.lon) {
        const lat = Number(row.lat);
        const lng = Number(row.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) res = { lat, lng };
      }
    }
  } catch {
    // jaringan/batas waktu → null (UI pakai tombol Google Maps)
  }
  cache.set(q, { at: Date.now(), res });
  return res;
}

/** Jarak garis lurus antar dua titik (Haversine, km) — perkiraan ETA kasar. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
