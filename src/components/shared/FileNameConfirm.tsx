"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, X } from "lucide-react";

/**
 * POPUP KONFIRMASI NAMA FILE (v1.3.28 — permintaan pemilik: "saat klik
 * simpan atau cetak tampilkan popup nama file yg akan di simpan").
 *
 * Modal kecil yang muncul SEBELUM file struk/laporan ditulis ke Unduhan atau
 * sebelum dialog cetak sistem dibuka: menampilkan nama file yang akan
 * disimpan (bisa disunting langsung), penjelasan tujuan, dan tombol lanjut.
 * Portal ke <body> agar selalu di atas sheet & navigasi bawah.
 */
export type FileNameConfirmProps = {
  open: boolean;
  /** judul popup — mis. "Simpan Struk" / "Cetak Struk" / "Ekspor Laporan" */
  title: string;
  /** ikon emoji kecil di samping judul (mis. 🧾 / 🖨️ / 📊) */
  emoji?: string;
  /** nama file yang akan disimpan — DIEDIT oleh pengguna di input */
  fileName: string;
  onFileNameChange: (value: string) => void;
  /** penjelasan tujuan file (folder Unduhan + notifikasi status bar, dll.) */
  hint: string;
  /** label tombol lanjut — mis. "Simpan ke Unduhan" / "Cetak via Printer Sistem" */
  primaryLabel: string;
  /** aksi opsional sekunder berupa teks tautan (mis. "Simpan file saja") */
  secondaryLabel?: string;
  onSecondary?: () => void;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function FileNameConfirm({
  open,
  title,
  emoji,
  fileName,
  onFileNameChange,
  hint,
  primaryLabel,
  secondaryLabel,
  onSecondary,
  busy = false,
  onCancel,
  onConfirm,
}: FileNameConfirmProps) {
  const prefersReduced = useReducedMotion();

  // Tutup dengan Escape (tidak saat sedang menyimpan)
  useEffect(() => {
    if (!open || busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="file-name-confirm-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[97] flex items-center justify-center bg-neutral-900/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) onCancel();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { y: 36, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            exit={prefersReduced ? undefined : { y: 36, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            {/* ===== KEPALA ===== */}
            <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 px-4 py-3 text-white">
              <p className="truncate text-sm font-black tracking-wide">
                {emoji ? `${emoji} ` : ""}
                {title}
              </p>
              <button
                onClick={onCancel}
                aria-label="Batal"
                disabled={busy}
                className="press-effect flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 hover:bg-white/30 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ===== ISI ===== */}
            <div className="px-4 pb-4 pt-3">
              <label
                htmlFor="file-name-confirm-input"
                className="text-[11px] font-bold uppercase tracking-wide text-neutral-400"
              >
                Nama file
              </label>
              <input
                id="file-name-confirm-input"
                value={fileName}
                onChange={(e) => onFileNameChange(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full rounded-xl border border-orange-200 bg-orange-50/50 px-3 py-2.5 font-mono text-[13px] font-bold text-neutral-800 outline-none focus:border-orange-500 focus:bg-white"
              />
              <p className="mt-2 text-[11px] font-semibold leading-relaxed text-neutral-500">
                {hint}
              </p>
            </div>

            {/* ===== TOMBOL ===== */}
            <div className="border-t border-neutral-100 bg-neutral-50/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={onCancel}
                  disabled={busy}
                  className="press-effect h-10 flex-1 rounded-xl border border-neutral-200 bg-white text-xs font-bold text-neutral-600 hover:bg-neutral-50 disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  onClick={onConfirm}
                  disabled={busy || !fileName.trim()}
                  className="press-effect flex h-10 flex-[1.6] items-center justify-center gap-1.5 rounded-xl bg-orange-600 text-xs font-black text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700 disabled:opacity-60"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Memproses…
                    </>
                  ) : (
                    primaryLabel
                  )}
                </button>
              </div>
              {secondaryLabel && onSecondary && !busy && (
                <button
                  onClick={onSecondary}
                  className="mt-2 w-full text-center text-[11px] font-bold text-orange-600 underline-offset-2 hover:underline"
                >
                  {secondaryLabel}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
