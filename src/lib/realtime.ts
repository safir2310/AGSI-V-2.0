"use client";

/**
 * 🔁 REAL-TIME SYNC — klien Server-Sent Events ke /api/realtime.
 *
 * Satu koneksi EventSource untuk seluruh halaman. Server mengirim event
 * begitu data berubah di database (±1–2 detik latensi di SEMUA perangkat —
 * admin, kasir, pelanggan, kurir, browser & aplikasi Android), jadi tidak
 * perlu menunggu polling 8–20 detik:
 *
 *   event "orders" → CustomEvent "agsi-sync" {scope:"orders"}
 *                    → NotifWatchers: tick notifikasi instan
 *                    → SyncBridge: daftar pesanan segar paksa (sesuai peran)
 *   event "chat"   → CustomEvent "agsi-sync" {scope:"chat", unread:N}
 *                    → ChatNotifWatcher: badge & kabar chat instan
 *                    → ChatSheet: daftar/utas aktif ditarik instan
 *
 * Ketahanan:
 *  - Server menutup aliran tiap ±48 detik → EventSource menyambung ulang
 *    OTOMATIS dan menerima snapshot awal (tak ada perubahan yang terlewat).
 *  - Kegagalan beruntun (mis. sesi habis / jaringan mati) → koneksi
 *    dihentikan setelah 10 percobaan agar tidak membanjiri server; saat
 *    halaman terlihat lagi (visibilitychange) koneksi dihidupkan kembali.
 *  - Polling interval lama tetap berjalan sebagai jaring pengaman.
 */

let es: EventSource | null = null;
let errorStreak = 0;

function emit(scope: "orders" | "chat", unread?: number) {
  window.dispatchEvent(
    new CustomEvent("agsi-sync", { detail: { scope, unread } })
  );
}

function connect() {
  es = new EventSource("/api/realtime");
  es.addEventListener("orders", () => {
    errorStreak = 0;
    emit("orders");
  });
  es.addEventListener("chat", (e) => {
    errorStreak = 0;
    let unread: number | undefined;
    try {
      unread = JSON.parse((e as MessageEvent).data)?.unread;
    } catch {
      // detail tak terbaca — cukup teruskan tanpa angka
    }
    emit("chat", unread);
  });
  es.onopen = () => {
    errorStreak = 0;
  };
  es.onerror = () => {
    // EventSource mencoba ulang otomatis; kalau terus gagal, berhenti —
    // visibilitychange akan menghidupkan kembali saat halaman tampil lagi.
    errorStreak++;
    if (errorStreak >= 10 && es) {
      es.close();
      es = null;
    }
  };
}

/** Mulai sinkronisasi real-time (idempoten — aman dipanggil berulang). */
export function startRealtime() {
  if (typeof window === "undefined" || es) return;
  connect();
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      (!es || es.readyState === EventSource.CLOSED)
    ) {
      errorStreak = 0;
      connect();
    }
  });
}
