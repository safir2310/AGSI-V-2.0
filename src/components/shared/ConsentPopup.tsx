"use client";

import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, Check, Loader2, ScrollText, ShieldCheck, X } from "lucide-react";
import { ChickenBadge } from "@/components/logo/ChickenLogo";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import {
  DATA_POLICY_SECTIONS,
  DATA_POLICY_SUMMARY,
  DATA_POLICY_UPDATED,
  DATA_POLICY_VERSION,
  hasValidConsent,
  type DataPolicySection,
} from "@/lib/data-policy";
import { APP_TERMS_SECTIONS, APP_TERMS_SUMMARY, APP_TERMS_UPDATED, APP_TERMS_VERSION, hasValidTerms } from "@/lib/app-terms";
import type { AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";

type ConsentPopupProps = {
  user: AppUser;
  /** dipanggil setelah persetujuan tersimpan (sinkron user di AppShell) */
  onAccepted: (u: AppUser) => void;
  /** dipanggil bila pengguna menolak → keluar dari sesi */
  onDeclined: () => void;
};

/** Definisi dua dokumen legal yang harus disetujui pengguna */
const DOCS = {
  terms: {
    key: "terms" as const,
    title: "Syarat & Ketentuan",
    version: APP_TERMS_VERSION,
    updated: APP_TERMS_UPDATED,
    summary: APP_TERMS_SUMMARY,
    sections: APP_TERMS_SECTIONS,
  },
  data: {
    key: "data" as const,
    title: "Kebijakan Data",
    version: DATA_POLICY_VERSION,
    updated: DATA_POLICY_UPDATED,
    summary: DATA_POLICY_SUMMARY,
    sections: DATA_POLICY_SECTIONS,
  },
};

/**
 * POPUP PERSETUJUAN SYARAT & KEBIJAKAN APLIKASI.
 *
 * Tampil otomatis (BLOCKING — tidak bisa ditutup/di-skip) untuk pengguna
 * yang belum menyetujui SALAH SATU dari dua dokumen legal:
 *   1. Syarat & Ketentuan Penggunaan Aplikasi
 *   2. Kebijakan Penggunaan Data
 * Dipasang di AppShell; satu tombol setuju mencatat keduanya (POST /api/consent).
 *
 * - "Setuju & Lanjutkan"  → lanjut memakai aplikasi.
 * - "Tolak"               → konfirmasi di dalam popup → keluar dari sesi
 *   (penolakan tidak menyimpan apa pun ke server).
 */
export function ConsentPopup({ user, onAccepted, onDeclined }: ConsentPopupProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);

  const [tab, setTab] = useState<"terms" | "data">("terms");
  const [step, setStep] = useState<"policy" | "decline">("policy");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const termsOk = hasValidTerms(user);
  const dataOk = hasValidConsent(user);
  const isUpdate = !!user.appTermsAt || !!user.dataConsentAt; // pernah menyetujui (sebagian/versi lama)

  const doc = DOCS[tab];

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
        title: "Terima Kasih! ✓",
        message: "Syarat & Ketentuan serta Kebijakan Data sudah kamu setujui. Selamat menikmati layanan AGSI!",
      });
      onAccepted(data.user as AppUser);
    } catch {
      setError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setSaving(false);
    }
  }, [saving, onAccepted, showNotice]);

  const firstName = user.name.split(" ")[0];

  return (
    <motion.div
      key="consent-overlay"
      initial={prefersReduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-900/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Persetujuan Syarat dan Kebijakan aplikasi"
    >
      <motion.div
        initial={prefersReduced ? false : { scale: 0.9, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-orange-200"
      >
        {/* ===== KEPALA ===== */}
        <header className="relative shrink-0 overflow-hidden bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 px-5 py-4 text-white">
          <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
          <div className="relative z-10 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/95 shadow-md">
              <ChickenBadge size={34} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black leading-tight">
                {isUpdate ? "Dokumen Diperbarui" : "Selamat Datang!"}
              </p>
              <p className="truncate text-[11px] font-semibold text-orange-100">
                Hai {firstName} — setujui 2 dokumen untuk melanjutkan
              </p>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30">
              <ShieldCheck className="h-4.5 w-4.5" />
            </span>
          </div>
        </header>

        {step === "policy" ? (
          <>
            {/* ===== TAB DOKUMEN ===== */}
            <div className="flex shrink-0 gap-2 border-b border-orange-100 bg-orange-50/50 px-4 py-2.5">
              {(Object.values(DOCS) as (typeof DOCS)[keyof typeof DOCS][]).map((d) => {
                const active = tab === d.key;
                const done = d.key === "terms" ? termsOk : dataOk;
                return (
                  <button
                    key={d.key}
                    onClick={() => setTab(d.key)}
                    className={cn(
                      "press-effect flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-black transition",
                      active
                        ? "bg-orange-600 text-white shadow-md shadow-orange-600/25"
                        : "bg-white text-neutral-500 ring-1 ring-orange-100 hover:bg-orange-50"
                    )}
                    aria-pressed={active}
                  >
                    {done && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-green-500" aria-hidden />}
                    {d.title}
                  </button>
                );
              })}
            </div>

            {/* ===== RINGKASAN DOKUMEN AKTIF ===== */}
            <div className="shrink-0 border-b border-orange-100 bg-white px-5 py-3">
              <p className="text-[11px] font-semibold leading-relaxed text-neutral-700">{doc.summary}</p>
              <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-orange-600">
                v{doc.version} • berlaku {doc.updated}
              </p>
            </div>

            {/* ===== ISI DOKUMEN LENGKAP (scroll) ===== */}
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <DocSections sections={doc.sections} />
              <p className="mt-4 text-center text-[10px] text-neutral-300">
                Ayam Geprek Sambal Ijo • dokumen v{doc.version}
              </p>
            </div>

            {/* ===== KAKI: AKSI ===== */}
            <footer className="shrink-0 border-t border-orange-100 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              {error && (
                <p className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 ring-1 ring-red-100">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setStep("decline")}
                  disabled={saving}
                  className="press-effect shrink-0 rounded-2xl border border-neutral-200 px-4 py-3 text-xs font-bold text-neutral-500 transition hover:bg-neutral-50 disabled:opacity-50"
                >
                  Tolak
                </button>
                <button
                  onClick={() => void accept()}
                  disabled={saving}
                  className="press-effect flex flex-1 items-center justify-center gap-2 rounded-2xl bg-orange-600 py-3 text-sm font-black text-white shadow-lg shadow-orange-600/30 transition hover:bg-orange-700 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {saving ? "Menyimpan…" : "Setuju Kedua Dokumen"}
                </button>
              </div>
            </footer>
          </>
        ) : (
          /* ===== LANGKAH KONFIRMASI PENOLAKAN (di dalam popup) ===== */
          <div className="flex flex-col items-center px-6 py-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-100">
              <X className="h-6 w-6 text-red-500" />
            </span>
            <h2 className="mt-3 text-base font-black text-neutral-900">Tolak Persetujuan?</h2>
            <p className="mt-1.5 max-w-[280px] text-[11px] font-medium leading-relaxed text-neutral-500">
              Tanpa persetujuan Syarat & Ketentuan serta Kebijakan Data, kami tidak bisa memproses
              pesanan dan akunmu akan <strong className="text-neutral-700">keluar dari aplikasi</strong>.
              Kamu bisa masuk lagi kapan saja bila berubah pikiran.
            </p>
            <div className="mt-6 flex w-full gap-2">
              <button
                onClick={() => setStep("policy")}
                className="press-effect flex-1 rounded-2xl border border-orange-200 bg-orange-50 py-3 text-xs font-black text-orange-700 transition hover:bg-orange-100"
              >
                Kembali Baca
              </button>
              <button
                onClick={onDeclined}
                className="press-effect flex-1 rounded-2xl bg-red-600 py-3 text-xs font-black text-white shadow-lg shadow-red-600/25 transition hover:bg-red-700"
              >
                Ya, Tolak & Keluar
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Daftar bagian dokumen (dipakai popup & sheet agar tampilan konsisten) */
export function DocSections({ sections }: { sections: DataPolicySection[] }) {
  return (
    <div className="space-y-4">
      {sections.map((s) => (
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
  );
}
