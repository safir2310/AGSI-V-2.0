"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Clock, MapPin, MessageCircle, Phone, X } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { useUiStore } from "@/lib/store";
import { STORE_ADDRESS, STORE_HOURS, STORE_PHONE, STORE_PHONE_TEL } from "@/lib/store-info";
import { cn } from "@/lib/utils";

type StoreSheetProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Popup "Pilihan Toko" — muncul saat alamat toko di beranda diketuk.
 *
 * Isi pilihan:
 *   - Alamat lengkap  → ketuk untuk salin
 *   - No. HP/WhatsApp → bisa ditelepon (tel:) atau disalin
 *   - Jam operasional
 *   - Pintasan "Tanya via Chat CS" (membuka sheet chat global)
 *
 * Umpan balik salin bersifat inline ("✓ Tersalin") supaya tidak menumpuk
 * popup di atas popup.
 */
export function StoreSheet({ open, onClose }: StoreSheetProps) {
  const prefersReduced = useReducedMotion();
  const openChat = useUiStore((s) => s.openChat);
  /** "address"/"phone" = tersalin; "fail" = clipboard diblokir perangkat */
  const [copied, setCopied] = useState<"address" | "phone" | "fail" | null>(null);

  /** Tutup dengan Escape */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** Salin ke papan klip + umpan balik inline selama 2 detik (tanpa popup tambahan) */
  const handleCopy = async (what: "address" | "phone") => {
    const value = what === "address" ? STORE_ADDRESS : STORE_PHONE;
    const ok = await copyText(value);
    setCopied(ok ? what : "fail");
    const expected = ok ? what : "fail";
    window.setTimeout(() => setCopied((cur) => (cur === expected ? null : cur)), 2200);
  };

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="store-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pilihan Toko"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { y: 48, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={prefersReduced ? undefined : { y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex max-h-[86dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            {/* ===== KEPALA ===== */}
            <header className="relative shrink-0 bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                  <MapPin className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black tracking-wide">Pilihan Toko</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Ayam Geprek Sambal Ijo • Simpang Camat, Gampong Tijue
                  </p>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Tutup"
                  className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </header>

            {/* ===== ISI ===== */}
            <div className="scrollbar-slim flex-1 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              <div className="overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm">
                <div className="divide-y divide-orange-50">
                  {/* --- Alamat lengkap (ketuk = salin) --- */}
                  <button
                    onClick={() => void handleCopy("address")}
                    className="press-effect flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-orange-50/60"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100">
                      <MapPin className="h-4.5 w-4.5 text-orange-600" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                        Alamat Toko
                      </span>
                      <span className="mt-0.5 block text-[13px] font-semibold leading-snug text-neutral-800">
                        {STORE_ADDRESS}
                      </span>
                    </span>
                    {copied === "address" ? (
                      <span className="flex shrink-0 items-center gap-1 pt-1 text-[10px] font-black text-green-600">
                        <Check className="h-3 w-3" /> Tersalin
                      </span>
                    ) : copied === "fail" ? (
                      <span className="shrink-0 pt-1 text-[10px] font-black text-red-500">✗ Gagal</span>
                    ) : (
                      <span className="shrink-0 pt-1 text-[10px] font-bold text-orange-400">Salin</span>
                    )}
                  </button>

                  {/* --- No. HP: bisa ditelepon / disalin --- */}
                  <div className="flex items-start gap-3 px-4 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100">
                      <Phone className="h-4.5 w-4.5 text-orange-600" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                        No. HP / WhatsApp
                      </span>
                      <a
                        href={`tel:${STORE_PHONE_TEL}`}
                        className="mt-0.5 block text-[13px] font-semibold text-orange-700 underline decoration-orange-300 underline-offset-2"
                      >
                        {STORE_PHONE}
                      </a>
                    </span>
                    <button
                      onClick={() => void handleCopy("phone")}
                      aria-label="Salin no. HP toko"
                      className={cn(
                        "press-effect shrink-0 rounded-full px-3 py-1.5 text-[10px] font-black transition",
                        copied === "phone"
                          ? "bg-green-50 text-green-700 ring-1 ring-green-200"
                          : copied === "fail"
                            ? "bg-red-50 text-red-600 ring-1 ring-red-200"
                            : "bg-orange-50 text-orange-700 ring-1 ring-orange-200 hover:bg-orange-100"
                      )}
                    >
                      {copied === "phone" ? "✓ Tersalin" : copied === "fail" ? "✗ Gagal" : "Salin"}
                    </button>
                  </div>

                  {/* --- Jam operasional --- */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100">
                      <Clock className="h-4.5 w-4.5 text-orange-600" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                        Jam Operasional
                      </span>
                      <span className="mt-0.5 block text-[13px] font-semibold text-neutral-800">
                        Setiap hari • {STORE_HOURS} WIB
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* --- Pintasan Chat CS --- */}
              <button
                onClick={() => {
                  onClose();
                  openChat();
                }}
                className="press-effect mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-600 to-orange-500 py-3.5 text-sm font-black text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-700 hover:to-orange-600"
              >
                <MessageCircle className="h-4 w-4" /> Tanya via Chat CS
              </button>

              <p className="mt-3 text-center text-[10px] text-neutral-300">
                Ayam Geprek Sambal Ijo © 2026 — dibuat dengan 🧡
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
