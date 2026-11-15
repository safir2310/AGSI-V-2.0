/**
 * PUSAT NOTIFIKASI AGSI (v1.3.10) — satu sumber data untuk halaman pusat
 * notifikasi & angka badge belum dibaca di lonceng.
 *
 * Dua lingkungan, satu antarmuka:
 *  - APLIKASI ANDROID (window.AgsiNative tersedia): riwayat disimpan NATIF
 *    (NotifHistory.kt) — mencakup notifikasi sistem saat aplikasi DITUTUP
 *    (FCM/poller) maupun kabar real-time saat terbuka; dibaca lewat jembatan
 *    AgsiNative.getNotifHistory() / clearNotifHistory().
 *  - BROWSER MURNI: riwayat disimpan di localStorage — diisi oleh
 *    NotifWatchers untuk setiap popup yang muncul selama halaman hidup.
 *
 * Status "belum dibaca" dihitung dari lastReadAt (localStorage) vs ts entri —
 * sama berlaku untuk kedua lingkungan.
 */
export type CenterEntry = {
  ts: number;
  kind: string;
  tag?: string;
  title: string;
  body: string;
  url?: string;
};

const LS_KEY = "agsi_notif_center";
const LS_READ = "agsi_notif_last_read";
export const CENTER_UPDATED_EVENT = "agsi-notif-center-updated";

const hasBridge = () =>
  typeof window !== "undefined" && !!(window as unknown as { AgsiNative?: unknown }).AgsiNative;

/** Seluruh entri riwayat (urut asli — terbaru di akhir). */
export function listEntries(): CenterEntry[] {
  if (typeof window === "undefined") return [];
  if (hasBridge()) {
    try {
      const raw = (window as unknown as { AgsiNative: { getNotifHistory: () => string } })
        .AgsiNative.getNotifHistory();
      const arr = JSON.parse(raw) as CenterEntry[];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as CenterEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Rekam ke riwayat — hanya untuk BROWSER (di aplikasi, native yang merekam). */
export function recordBrowserEntry(entry: CenterEntry) {
  if (typeof window === "undefined" || hasBridge()) return;
  if (!entry.title && !entry.body) return;
  try {
    const arr = listEntries();
    arr.push({ ...entry, ts: entry.ts || Date.now() });
    while (arr.length > 60) arr.shift();
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
    window.dispatchEvent(new CustomEvent(CENTER_UPDATED_EVENT));
  } catch {
    // penyimpanan penuh/di-blokir — pusat notifikasi bukan fitur kritikal
  }
}

/** Waktu terakhir pengguna membuka pusat notifikasi (ms). */
export function lastReadAt(): number {
  if (typeof window === "undefined") return 0;
  return Number(localStorage.getItem(LS_READ) ?? 0);
}

/** Tandai SEMUA entri sudah dibaca (dipanggil saat pusat dibuka). */
export function markAllRead() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_READ, String(Date.now() + 1000)); // +1s anti sisa milidetik
    window.dispatchEvent(new CustomEvent(CENTER_UPDATED_EVENT));
  } catch {
    // abaikan
  }
}

/** Angka badge: entri yang masuk setelah pembukaan terakhir. */
export function unreadCount(entries: CenterEntry[]): number {
  const read = lastReadAt();
  return entries.filter((e) => e.ts > read).length;
}

/** Kosongkan seluruh riwayat (jembatan native / localStorage). */
export function clearEntries() {
  if (typeof window === "undefined") return;
  try {
    if (hasBridge()) {
      (window as unknown as { AgsiNative: { clearNotifHistory: () => boolean } })
        .AgsiNative.clearNotifHistory();
    } else {
      localStorage.removeItem(LS_KEY);
    }
    markAllRead();
  } catch {
    // abaikan
  }
}
