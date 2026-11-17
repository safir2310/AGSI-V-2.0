"use client";

/**
 * Helper client untuk SIMPAN FILE & CETAK di dalam aplikasi Android AGSI.
 *
 * Latar belakang: WebView Android TIDAK mendukung dua hal yang dipakai
 * halaman admin untuk struk & laporan:
 *  1. Unduhan `blob:` (`<a download href="blob:…">`) — DownloadManager gagal,
 *     lalu fallback membuka tautan memunculkan toast "Tidak ada aplikasi yang
 *     bisa membuka tautan ini".
 *  2. `window.print()` — diabaikan begitu saja (tidak ada dialog cetak).
 *
 * Solusinya: jembatan native `window.AgsiNative` menyediakan
 *  - saveFile(cbId, base64, fileName, mimeType) → file ditulis ke folder
 *    Unduhan (MediaStore / dialog "Simpan ke") dan Android menampilkan toast.
 *  - printPage(cbId, title) → dialog cetak sistem (PrintManager) di atas
 *    halaman web yang sedang tampil (aturan @media print tetap berlaku,
 *    jadi hanya struk yang tercetak).
 *
 * Kontrak dengan app/src/main/java/com/agsi/app/AgsiNativeBridge.kt (v1.2.5+).
 * Di browser biasa semua fungsi ini tidak aktif — komponen jatuh ke jalur
 * unduhan/print browser seperti biasa.
 */

type NativeFileBridge = {
  saveFile?: (cbId: string, base64: string, fileName: string, mimeType: string) => boolean;
  shareFile?: (cbId: string, base64: string, fileName: string, mimeType: string) => boolean;
  printPage?: (cbId: string, title: string) => boolean;
  /** v1.3.28 — cetak FILE PDF via printer sistem (PdfPrintAdapter) */
  printPdf?: (cbId: string, base64: string, fileName: string) => boolean;
};

type NativeResult = { ok: boolean; message: string };

/** Ambil jembatan file native — hanya ada di aplikasi Android v1.2.5+ */
function appFileBridge(): NativeFileBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { AgsiNative?: unknown }).AgsiNative;
  if (!b || typeof b !== "object") return null;
  const bridge = b as NativeFileBridge;
  // Guard versi: aplikasi lama tidak punya metode saveFile → pakai jalur browser
  if (typeof bridge.saveFile !== "function") return null;
  return bridge;
}

/** Apakah "Simpan file" native tersedia (di dalam aplikasi Android v1.2.5+)? */
export function nativeSaveSupported(): boolean {
  return appFileBridge() != null;
}

/** Apakah dialog cetak native tersedia (di dalam aplikasi Android v1.2.5+)? */
export function nativePrintSupported(): boolean {
  return appFileBridge()?.printPage != null;
}

/** Apakah cetak FILE PDF via printer sistem tersedia (APK 1.3.28+)? */
export function nativePrintPdfSupported(): boolean {
  return appFileBridge()?.printPdf != null;
}

/** Apakah lembar bagikan native tersedia (APK 1.3.27+)? */
export function nativeShareSupported(): boolean {
  return appFileBridge()?.shareFile != null;
}

/** Encode string UTF-8 → base64 (aman untuk teks berisi emoji/aksara non-ASCII) */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  const CHUNK = 0x8000; // 32 KiB per potongan — batas aman String.fromCharCode
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Panggil satu metode bridge dan tunggu balasan window.__agsiNativeResult.
 *  Pola sama dengan enableAppBiometric di biometric-client.ts: handler
 *  satu-slot dengan rantai prev untuk callback milik pemanggil lain.
 *  failFastMessage = pesan bila PEMANGGILAN bridge langsung melempar
 *  (jembatan mati — WebView dibuat ulang); dibedakan dari pesan timeout
 *  agar pengguna tahu harus memulai ulang aplikasi, bukan sekadar mencoba. */
function callBridgeWithCallback(
  cbId: string,
  invoke: (cbId: string) => void,
  timeoutMs: number,
  timeoutMessage: string,
  failFastMessage: string = timeoutMessage,
): Promise<NativeResult> {
  return new Promise((resolve) => {
    const w = window as unknown as {
      __agsiNativeResult?: (payload: { id: string; ok: boolean; message: string }) => void;
    };
    const prev = w.__agsiNativeResult;
    const timeout = setTimeout(() => {
      w.__agsiNativeResult = prev;
      resolve({ ok: false, message: timeoutMessage });
    }, timeoutMs);
    w.__agsiNativeResult = (payload) => {
      if (!payload || payload.id !== cbId) {
        prev?.(payload);
        return;
      }
      clearTimeout(timeout);
      w.__agsiNativeResult = prev;
      resolve({ ok: !!payload.ok, message: payload.message ?? "" });
    };
    try {
      invoke(cbId);
    } catch {
      // v1.3.21 — bridge mati (interface tak terpasang ulang pasca WebView
      // dibuat ulang) → selesaikan sebagai gagal; exception jembatan tidak
      // boleh lolos keluar konstruktor Promise dan meruntuhkan React.
      // v1.3.24 — pesan berbeda dari timeout: panduan mulai ulang aplikasi.
      clearTimeout(timeout);
      w.__agsiNativeResult = prev;
      resolve({ ok: false, message: failFastMessage });
    }
  });
}

/** v1.3.25 — pesan jembatan mati (pemanggilan bridge melempar sinkron).
 *  Aplikasi kini otomatis memeriksa & menyembuhkan jembatan begitu kembali
 *  ke depan (probe getAppVersion → muat ulang halaman bila mati), jadi
 *  panduannya: pindah aplikasi lalu kembali — tanpa restart penuh. */
const BRIDGE_DEAD_MESSAGE =
  "Koneksi aplikasi terputus. Pindah ke aplikasi lain lalu kembali ke AGSI — halaman pulih otomatis. Bila masih gagal: tutup penuh aplikasi AGSI (swipe keluar), buka lagi, coba sekali lagi.";

/**
 * CETAK FILE PDF via printer sistem Android (v1.3.28 — permintaan pemilik:
 * "gunakan printer sistem android untuk cetak struk dan laporan"). Dialog
 * cetak sistem terbuka atas FILE PDF sungguhan — semua printer terpasang
 * (thermal 58/80 mm, Bluetooth, jaringan) plus "Simpan sebagai PDF".
 */
export function nativePrintPdf(pdf: string, fileName: string): Promise<NativeResult> {
  const bridge = appFileBridge();
  const printPdf = bridge?.printPdf;
  if (!printPdf) {
    return Promise.resolve({
      ok: false,
      message: "Perbarui aplikasi AGSI ke versi terbaru (1.3.28+) untuk cetak printer sistem.",
    });
  }
  const cbId = `printpdf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return callBridgeWithCallback(
    cbId,
    (id) => printPdf(id, utf8ToBase64(pdf), fileName),
    15_000,
    // Pengawas native (12 dtk) menjelaskan sebabnya lebih dulu; pesan ini
    // hanya muncul bila jembatan mati sebelum pengawas sempat menjawab.
    "Jembatan cetak tidak merespons. Tutup dan buka ulang aplikasi AGSI, lalu coba lagi.",
    BRIDGE_DEAD_MESSAGE,
  );
}

/**
 * Simpan file (teks HTML/CSV, atau string PDF mentah dari buildStrukPdf —
 * murni ASCII) via aplikasi Android — masuk folder Unduhan (subfolder "AGSI"
 * di Android 10+). Toast konfirmasi ditampilkan aplikasi. message
 * "dibatalkan" = pengguna menutup dialog simpan (SAF).
 */
export function nativeSaveFile(
  text: string,
  fileName: string,
  mimeType: string,
): Promise<NativeResult> {
  const bridge = appFileBridge();
  const saveFile = bridge?.saveFile;
  if (!saveFile) {
    return Promise.resolve({
      ok: false,
      message: "Perbarui aplikasi AGSI ke versi terbaru (1.2.5+) untuk menyimpan file.",
    });
  }
  // Dialog "Simpan ke" bisa dipakai pengguna cukup lama → timeout besar.
  const cbId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return callBridgeWithCallback(
    cbId,
    (id) => saveFile(id, utf8ToBase64(text), fileName, mimeType),
    180_000,
    "Waktu tunggu penyimpanan habis. Coba lagi.",
    BRIDGE_DEAD_MESSAGE,
  );
}

/**
 * BAGIKAN file (teks, atau string PDF mentah dari buildStrukPdf) lewat lembar
 * bagikan Android (ACTION_SEND via FileProvider, cache aplikasi) — jalur
 * fallback ANTI-GAGAL untuk nativeSaveFile (v1.3.27): bebas galat izin/
 * MediaStore/SAF karena tak menyentuh penyimpanan Unduhan.
 */
export function nativeShareFile(
  text: string,
  fileName: string,
  mimeType: string,
): Promise<NativeResult> {
  const bridge = appFileBridge();
  const shareFile = bridge?.shareFile;
  if (!shareFile) {
    return Promise.resolve({
      ok: false,
      message: "Perbarui aplikasi AGSI ke versi terbaru (1.3.27+) untuk berbagi file.",
    });
  }
  const cbId = `share_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return callBridgeWithCallback(
    cbId,
    (id) => shareFile(id, utf8ToBase64(text), fileName, mimeType),
    60_000,
    "Lembar bagikan tidak merespons. Coba lagi.",
    BRIDGE_DEAD_MESSAGE,
  );
}

/** Buka dialog cetak Android (PrintManager) untuk halaman ini — gunakan saat
 *  sheet struk terbuka; @media print memastikan hanya struk yang tercetak. */
export function nativePrintPage(title: string): Promise<NativeResult> {
  const bridge = appFileBridge();
  const printPage = bridge?.printPage;
  if (!printPage) {
    return Promise.resolve({
      ok: false,
      message: "Perbarui aplikasi AGSI ke versi terbaru (1.2.5+) untuk mencetak.",
    });
  }
  const cbId = `print_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return callBridgeWithCallback(
    cbId,
    (id) => printPage(id, title),
    15_000,
    // v1.3.22 — pengawas native (12 dtk) kini menjelaskan sebabnya sebelum
    // batas waktu ini tercapai; teks ini hanya muncul bila jembatan mati.
    "Jembatan cetak tidak merespons. Tutup dan buka ulang aplikasi AGSI, lalu coba lagi.",
    BRIDGE_DEAD_MESSAGE,
  );
}
