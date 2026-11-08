"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, Clock, Loader2, ScrollText, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import { DocSections } from "@/components/shared/ConsentPopup";
import {
  DATA_POLICY_SECTIONS,
  DATA_POLICY_UPDATED,
  DATA_POLICY_VERSION,
  hasValidConsent,
} from "@/lib/data-policy";
import { APP_TERMS_SECTIONS, APP_TERMS_UPDATED, APP_TERMS_VERSION, hasValidTerms } from "@/lib/app-terms";
import type { AppUser } from "@/lib/types";
import { formatDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";

export type LegalSheetProps = {
  open: boolean;
  onClose: () => void;
  user: AppUser;
  /** sinkron user (status consent terbaru) ke AppShell setelah setuju */
  onAccepted: (u: AppUser) => void;
};

/**
 * Sheet "Syarat & Kebijakan Aplikasi" — dipasang di halaman Profil untuk
 * SEMUA role (pelanggan, kasir, admin/owner).
 *
 * Isi:
 *  1. Kartu status kedua dokumen (S&K Aplikasi + Kebijakan Data):
 *     Disetujui ✓ / Perlu persetujuan ulang / Belum disetujui
 *  2. Tab teks lengkap tiap dokumen (sumber tunggal: lib/app-terms.ts & lib/data-policy.ts)
 *  3. Satu tombol setuju — mencatat KEDUA dokumen sekaligus (POST /api/consent)
 */
export function LegalSheet({ open, onClose, user, onAccepted }: LegalSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);

  const [tab, setTab] = useState<"terms" | "data">("terms");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const termsOk = hasValidTerms(user);
  const dataOk = hasValidConsent(user);
  const allOk = termsOk && dataOk;

  // Tutup dengan tombol Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
        message: `S&K v${APP_TERMS_VERSION} & Kebijakan Data v${DATA_POLICY_VERSION} sudah kamu setujui.`,
      });
      onAccepted(data.user as AppUser);
    } catch {
      setError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setSaving(false);
    }
  }, [saving, onAccepted, showNotice]);

  /** Baris status satu dokumen */
  const statusRow = (opts: {
    label: string;
    ok: boolean;
    at?: string | null;
    version?: string | null;
  }) => {
    const outdated = !opts.ok && !!opts.at;
    return (
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            opts.ok ? "bg-green-600 text-white" : outdated ? "bg-amber-500 text-white" : "bg-neutral-300 text-white"
          )}
        >
          {opts.ok ? (
            <BadgeCheck className="h-4 w-4" />
          ) : outdated ? (
            <TriangleAlert className="h-4 w-4" />
          ) : (
            <Clock className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-black text-neutral-800">
            {opts.label}{" "}
            <span className={cn("font-bold", opts.ok ? "text-green-600" : "text-amber-600")}>
              {opts.ok ? "✓ Disetujui" : outdated ? "• Perlu persetujuan ulang" : "• Belum disetujui"}
            </span>
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-500">
            {opts.ok && opts.at
              ? `Disetujui ${formatDateTime(opts.at)} (versi ${opts.version})`
              : outdated
                ? `Terakhir disetujui: versi ${opts.version} — baca versi terbaru di tab di bawah`
                : "Baca dokumennya di tab di bawah, lalu ketuk Setuju"}
          </p>
        </div>
      </div>
    );
  };

  const tabDoc =
    tab === "terms"
      ? {
          title: "Syarat & Ketentuan Penggunaan Aplikasi",
          version: APP_TERMS_VERSION,
          updated: APP_TERMS_UPDATED,
          sections: APP_TERMS_SECTIONS,
        }
      : {
          title: "Kebijakan Penggunaan Data",
          version: DATA_POLICY_VERSION,
          updated: DATA_POLICY_UPDATED,
          sections: DATA_POLICY_SECTIONS,
        };

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="legal-sheet-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Syarat dan Kebijakan Aplikasi"
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
                  <p className="text-sm font-black tracking-wide">Syarat & Kebijakan Aplikasi</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    S&K v{APP_TERMS_VERSION} • Data v{DATA_POLICY_VERSION}
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
              {/* Kartu status kedua dokumen */}
              <div
                className={cn(
                  "mb-4 rounded-2xl border p-4",
                  allOk ? "border-green-200 bg-green-50/70" : "border-amber-200 bg-amber-50/70"
                )}
              >
                <div className="space-y-3">
                  {statusRow({
                    label: "Syarat & Ketentuan Aplikasi",
                    ok: termsOk,
                    at: user.appTermsAt,
                    version: user.appTermsVersion,
                  })}
                  <div className="h-px bg-neutral-200/70" />
                  {statusRow({
                    label: "Kebijakan Penggunaan Data",
                    ok: dataOk,
                    at: user.dataConsentAt,
                    version: user.dataConsentVersion,
                  })}
                </div>
              </div>

              {/* Tab dokumen */}
              <div className="mb-3 flex gap-2">
                {(
                  [
                    { key: "terms", label: "Syarat & Ketentuan" },
                    { key: "data", label: "Kebijakan Data" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    aria-pressed={tab === t.key}
                    className={cn(
                      "press-effect flex-1 rounded-xl px-2 py-2 text-[11px] font-black transition",
                      tab === t.key
                        ? "bg-orange-600 text-white shadow-md shadow-orange-600/25"
                        : "bg-orange-50 text-orange-700 ring-1 ring-orange-100 hover:bg-orange-100"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Teks dokumen aktif */}
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-orange-600">
                  <ScrollText className="h-3.5 w-3.5" /> {tabDoc.title}
                </div>
                <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-neutral-400">
                  v{tabDoc.version} • {tabDoc.updated}
                </span>
              </div>
              <div className="space-y-4 rounded-2xl border border-orange-100 bg-orange-50/40 p-4">
                <DocSections sections={tabDoc.sections} />
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
                  allOk
                    ? "bg-neutral-800 shadow-neutral-800/20 hover:bg-neutral-900"
                    : "bg-orange-600 shadow-orange-600/30 hover:bg-orange-700"
                )}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {saving
                  ? "Menyimpan…"
                  : allOk
                    ? "Setujui Ulang Kedua Dokumen"
                    : termsOk || dataOk
                      ? "Setujui Versi Terbaru"
                      : "Setuju Kedua Dokumen"}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
