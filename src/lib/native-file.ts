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
  printPage?: (cbId: string, title: string) => boolean;
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
 *  satu-slot dengan rantai prev untuk callback milik pemanggil lain. */
function callBridgeWithCallback(
  cbId: string,
  invoke: (cbId: string) => void,
  timeoutMs: number,
  timeoutMessage: string,
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
    invoke(cbId);
  });
}

/**
 * Simpan teks (HTML/CSV) sebagai file via aplikasi Android — masuk folder
 * Unduhan (subfolder "AGSI" di Android 10+). Toast konfirmasi ditampilkan
 * aplikasi. message "dibatalkan" = pengguna menutup dialog simpan (SAF).
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
    "Dialog cetak tidak muncul. Coba lagi atau gunakan tombol Simpan.",
  );
}
