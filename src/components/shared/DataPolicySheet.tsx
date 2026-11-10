"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, Clock, Loader2, ScrollText, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import {
  DATA_POLICY_SECTIONS,
  DATA_POLICY_UPDATED,
  DATA_POLICY_VERSION,
  hasValidConsent,
} from "@/lib/data-policy";
import type { AppUser } from "@/lib/types";
import { formatDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DataPolicySheetProps = {
  open: boolean;
  onClose: () => void;
  user: AppUser;
  /** sinkron user (status consent terbaru) ke AppShell setelah setuju */
  onAccepted: (u: AppUser) => void;
};

/**
 * Sheet "Kebijakan & Persetujuan Data" — dipasang di halaman Profil untuk
 * SEMUA role (pelanggan, kasir, admin/owner).
 *
 * Isi:
 *  1. Kartu status persetujuan (Disetujui ✓ / Perlu diperbarui / Belum disetujui)
 *  2. Teks kebijakan lengkap (sumber tunggal: src/lib/data-policy.ts)
 *  3. Tombol setuju — juga dipakai untuk menyetujui ulang bila versi kebijakan naik
 */
export function DataPolicySheet({ open, onClose, user, onAccepted }: DataPolicySheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tutup dengan tombol Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const consented = hasValidConsent(user);
  const outdated = !!user.dataConsentAt && user.dataConsentVersion !== DATA_POLICY_VERSION;

  const accept = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.user) {
        setError(data.error ?? "Gagal menyimpan persetujuan. Coba lagi.");
        return;
      }
      showNotice({
        type: "success",
        autoCloseMs: 3600,
        title: "Persetujuan Tersimpan ✓",
        message: `Kebijakan penggunaan data v${DATA_POLICY_VERSION} sudah kamu setujui.`,
      });
      onAccepted(data.user as AppUser);
    } catch {
      setError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setSaving(false);
    }
  }, [saving, onAccepted, showNotice]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="data-policy-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Kebijakan dan Persetujuan Penggunaan Data"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { y: 48, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={prefersReduced ? undefined : { y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            {/* ===== KEPALA ===== */}
            <header className="relative shrink-0 bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Kebijakan & Persetujuan Data</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Versi {DATA_POLICY_VERSION} • berlaku {DATA_POLICY_UPDATED}
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
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
              {/* Kartu status persetujuan */}
              <div
                className={cn(
                  "mb-4 flex items-start gap-3 rounded-2xl border p-4",
                  consented
                    ? "border-green-200 bg-green-50/70"
                    : outdated
                      ? "border-amber-200 bg-amber-50/70"
                      : "border-neutral-200 bg-neutral-50"
                )}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    consented ? "bg-green-600 text-white" : outdated ? "bg-amber-500 text-white" : "bg-neutral-300 text-white"
                  )}
                >
                  {consented ? (
                    <BadgeCheck className="h-5 w-5" />
                  ) : outdated ? (
                    <TriangleAlert className="h-5 w-5" />
                  ) : (
                    <Clock className="h-5 w-5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-neutral-800">
                    {consented
                      ? "Kamu Sudah Menyetujui ✓"
                      : outdated
                        ? "Kebijakan Diperbarui — Perlu Persetujuan Ulang"
                        : "Belum Menyetujui"}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">
                    {consented && user.dataConsentAt
                      ? `Disetujui pada ${formatDateTime(user.dataConsentAt)} (versi ${user.dataConsentVersion}). Terima kasih telah mempercayai AGSI.`
                      : outdated
                        ? `Kamu terakhir menyetujui versi ${user.dataConsentVersion}. Baca kebijakan terbaru lalu setujui untuk melanjutkan.`
                        : "Baca kebijakan di bawah, lalu ketuk \"Setuju\" untuk mencatat persetujuanmu."}
                  </p>
                </div>
              </div>

              {/* Teks kebijakan lengkap */}
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-orange-600">
                <ScrollText className="h-3.5 w-3.5" /> Kebijakan Penggunaan Data
              </div>
              <div className="space-y-4 rounded-2xl border border-orange-100 bg-orange-50/40 p-4">
                {DATA_POLICY_SECTIONS.map((s) => (
                  <section key={s.title}>
                    <h3 className="text-[12px] font-black text-neutral-800">{s.title}</h3>
                    {s.paragraphs.map((p, i) => (
                      <p key={i} className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                        {p}
                      </p>
                    ))}
                  </section>
                ))}
              </div>
            </div>

            {/* ===== KAKI: AKSI ===== */}
            <footer className="shrink-0 border-t border-orange-100 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              {error && (
                <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 ring-1 ring-red-100">
                  {error}
                </p>
              )}
              <button
                onClick={() => void accept()}
                disabled={saving}
                className={cn(
                  "press-effect flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white shadow-lg transition disabled:opacity-60",
                  consented
                    ? "bg-neutral-800 shadow-neutral-800/20 hover:bg-neutral-900"
                    : "bg-orange-600 shadow-orange-600/30 hover:bg-orange-700"
                )}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {saving
                  ? "Menyimpan…"
                  : consented
                    ? "Setujui Ulang Kebijakan Ini"
                    : outdated
                      ? "Setujui Kebijakan Terbaru"
                      : "Setuju & Simpan Persetujuan"}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
