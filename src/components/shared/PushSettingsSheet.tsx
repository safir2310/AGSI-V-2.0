"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BadgeCheck,
  Bell,
  BellOff,
  BellRing,
  Loader2,
  Monitor,
  Send,
  Smartphone,
  TriangleAlert,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import {
  disableWebPush,
  enableWebPush,
  fetchPushConfig,
  readPushStatus,
  type PushConfig,
  type PushStatus,
} from "@/lib/push-client";
import type { AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Sheet "Notifikasi Push" — halaman Profil, SEMUA role.
 *
 * Mengelola push FCM per perangkat:
 *  - WEB  : tombol Aktifkan (izin → token FCM → daftar server) / Nonaktifkan.
 *  - NATIVE (aplikasi Android android/…) : status otomatis dari jembatan
 *    AgsiNative — token didaftarkan aplikasi, tidak butuh aksi di sini.
 *  - ADMIN/OWNER : tombol "Kirim Notifikasi Uji" ke perangkat sendiri.
 *
 * Bila server belum dikonfigurasi (.env FIREBASE_* kosong) tampil kartu
 * kuning berisi petunjuk singkat — bukan error yang bikin bingung.
 */

type SheetState = {
  config: PushConfig | null;
  status: PushStatus | null;
  loading: boolean;
  busy: "enable" | "disable" | "test" | null;
  error: string | null;
};

export function PushSettingsSheet({ open, onClose, user }: { open: boolean; onClose: () => void; user: AppUser }) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const [st, setSt] = useState<SheetState>({
    config: null,
    status: null,
    loading: false,
    busy: null,
    error: null,
  });

  const isAdmin = user.role === "ADMIN" || user.role === "OWNER";

  const refresh = useCallback(async () => {
    setSt((s) => ({ ...s, loading: true, error: null }));
    try {
      const [config, status] = await Promise.all([
        fetchPushConfig().catch(() => null),
        readPushStatus(),
      ]);
      setSt((s) => ({ ...s, config, status, loading: false }));
    } catch {
      setSt((s) => ({ ...s, loading: false, error: "Tidak dapat menghubungi server." }));
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const enable = useCallback(async () => {
    if (!st.config) return;
    setSt((s) => ({ ...s, busy: "enable", error: null }));
    try {
      await enableWebPush(st.config);
      showNotice({
        type: "success",
        autoCloseMs: 4200,
        title: "Notifikasi Aktif ✓",
        message: "Perangkat ini sudah terdaftar. Update pesanan & chat akan muncul sebagai banner heads-up.",
      });
      await refresh();
    } catch (err) {
      setSt((s) => ({
        ...s,
        error: err instanceof Error ? err.message : "Gagal mengaktifkan notifikasi.",
      }));
    } finally {
      setSt((s) => ({ ...s, busy: null }));
    }
  }, [st.config, refresh, showNotice]);

  const disable = useCallback(async () => {
    if (!st.config) return;
    setSt((s) => ({ ...s, busy: "disable", error: null }));
    try {
      await disableWebPush(st.config);
      await refresh();
    } catch {
      setSt((s) => ({ ...s, error: "Gagal menonaktifkan notifikasi." }));
    } finally {
      setSt((s) => ({ ...s, busy: null }));
    }
  }, [st.config, refresh]);

  const sendTest = useCallback(async () => {
    setSt((s) => ({ ...s, busy: "test", error: null }));
    try {
      const res = await apiFetch("/api/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "self" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSt((s) => ({ ...s, error: data.error ?? "Gagal mengirim notifikasi uji." }));
        return;
      }
      if (!data.configured) {
        setSt((s) => ({
          ...s,
          error: "Server belum terhubung ke Firebase. Isi kredensial di .env (lihat PUSH_SETUP.md).",
        }));
        return;
      }
      showNotice({
        type: "success",
        autoCloseMs: 4200,
        title: "Notifikasi Uji Dikirim 🚀",
        message: `Terkirim ke ${data.sent} perangkat${data.sent === 0 ? " — aktifkan dulu di perangkatmu" : ""}.`,
      });
    } catch {
      setSt((s) => ({ ...s, error: "Tidak dapat menghubungi server." }));
    } finally {
      setSt((s) => ({ ...s, busy: null }));
    }
  }, [showNotice]);

  // ===== Turunan status tampilan =====
  const status = st.status;
  const webActive = !!status?.webToken && status.permission === "granted";
  const blocked = status?.permission === "denied" && !status?.webToken;
  const serverOk = st.config?.configured ?? false;
  const canEnableWeb = serverOk && !status?.native && status?.supported && !webActive;

  const stateBadge = (() => {
    if (status?.native) return { tone: "green" as const, label: "Aktif ✓ (Aplikasi Android)" };
    if (webActive) return { tone: "green" as const, label: "Aktif ✓" };
    if (blocked) return { tone: "amber" as const, label: "Diblokir Browser" };
    if (!status?.supported) return { tone: "neutral" as const, label: "Browser Tidak Mendukung" };
    return { tone: "neutral" as const, label: "Belum Aktif" };
  })();

  const statusRow = (opts: { icon: React.ReactNode; label: string; value: string; ok?: boolean | "warn" }) => (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
          opts.ok === true ? "bg-green-600 text-white" : opts.ok === "warn" ? "bg-amber-500 text-white" : "bg-neutral-200 text-neutral-500"
        )}
      >
        {opts.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-black text-neutral-800">{opts.label}</p>
        <p className="truncate text-[10px] text-neutral-500">{opts.value}</p>
      </div>
      {opts.ok === true && <BadgeCheck className="h-4 w-4 shrink-0 text-green-600" />}
      {opts.ok === "warn" && <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />}
    </div>
  );

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="push-sheet-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pengaturan Notifikasi Push"
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
                  <BellRing className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Notifikasi Push</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Heads-up FCM • pesanan & chat langsung ke HP
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
              {st.loading && !status ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-neutral-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Memuat status…
                </div>
              ) : (
                <>
                  {/* Kartu status perangkat */}
                  <div
                    className={cn(
                      "mb-4 rounded-2xl border p-4",
                      stateBadge.tone === "green"
                        ? "border-green-200 bg-green-50/70"
                        : stateBadge.tone === "amber"
                          ? "border-amber-200 bg-amber-50/70"
                          : "border-neutral-200 bg-neutral-50"
                    )}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-[11px] font-black uppercase tracking-widest text-neutral-500">
                        Status Perangkat
                      </p>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[10px] font-black",
                          stateBadge.tone === "green"
                            ? "bg-green-600 text-white"
                            : stateBadge.tone === "amber"
                              ? "bg-amber-500 text-white"
                              : "bg-neutral-300 text-neutral-700"
                        )}
                      >
                        {stateBadge.label}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {statusRow({
                        icon: status?.native ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />,
                        label: status?.native ? "Aplikasi Android Native" : "Browser Web",
                        value: status?.native
                          ? `Token ${status.nativeToken ? "terdaftar ✓" : "menunggu…"} — jembatan AgsiNative`
                          : "Chrome / Firefox / WebView di perangkat ini",
                        ok: status?.native ? true : status?.supported ? undefined : "warn",
                      })}
                      <div className="h-px bg-neutral-200/70" />
                      {statusRow({
                        icon: <Bell className="h-4 w-4" />,
                        label: "Izin Notifikasi Browser",
                        value:
                          status?.permission === "granted"
                            ? "Diizinkan"
                            : status?.permission === "denied"
                              ? "Diblokir — ubah dari ikon 🔒 di bilah alamat"
                              : "Belum diminta",
                        ok: status?.permission === "granted" ? true : status?.permission === "denied" ? "warn" : false,
                      })}
                      <div className="h-px bg-neutral-200/70" />
                      {statusRow({
                        icon: <Send className="h-4 w-4" />,
                        label: "Server Push (Firebase)",
                        value: serverOk
                          ? "Terhubung — siap mengirim heads-up"
                          : "Belum dikonfigurasi (isi .env FIREBASE_* — lihat PUSH_SETUP.md)",
                        ok: serverOk ? true : "warn",
                      })}
                    </div>
                  </div>

                  {/* Petunjuk aplikasi native */}
                  {status?.native && (
                    <div className="mb-4 rounded-2xl border border-green-200 bg-green-50/70 p-4 text-[11px] leading-relaxed text-green-800">
                      Kamu memakai <b>aplikasi Android native AGSI</b>. Notifikasi pesanan &amp; chat dikirim
                      langsung oleh Firebase Cloud Messaging — muncul di layar <b>walau aplikasi ditutup</b>.
                      Pastikan izin notifikasi Android diizinkan &amp; hemat baterai dimatikan agar banner
                      muncul segera.
                    </div>
                  )}

                  {/* Peringatan server belum siap */}
                  {!serverOk && !status?.native && (
                    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-[11px] leading-relaxed text-amber-800">
                      <b>Push belum aktif di server.</b> Minta admin mengisi kredensial Firebase di berkas{" "}
                      <code className="rounded bg-amber-100 px-1">.env</code> (panduan lengkap:{" "}
                      <code className="rounded bg-amber-100 px-1">PUSH_SETUP.md</code>), lalu restart server. Semua
                      perangkat otomatis berfungsi setelah itu.
                    </div>
                  )}

                  {st.error && (
                    <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-red-600 ring-1 ring-red-100">
                      {st.error}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* ===== KAKI: AKSI ===== */}
            <footer className="shrink-0 space-y-2 border-t border-orange-100 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              {!status?.native && (
                canEnableWeb ? (
                  <button
                    onClick={() => void enable()}
                    disabled={st.busy !== null}
                    className="press-effect flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 py-3.5 text-sm font-black text-white shadow-lg shadow-orange-600/30 transition hover:bg-orange-700 disabled:opacity-60"
                  >
                    {st.busy === "enable" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                    {st.busy === "enable" ? "Mengaktifkan…" : "Aktifkan Notifikasi"}
                  </button>
                ) : webActive ? (
                  <button
                    onClick={() => void disable()}
                    disabled={st.busy !== null}
                    className="press-effect flex w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-red-50 py-3.5 text-sm font-black text-red-600 transition hover:bg-red-100 disabled:opacity-60"
                  >
                    {st.busy === "disable" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellOff className="h-4 w-4" />}
                    Nonaktifkan Notifikasi di Perangkat Ini
                  </button>
                ) : (
                  <button
                    disabled
                    className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-neutral-200 py-3.5 text-sm font-black text-neutral-500"
                  >
                    <BellOff className="h-4 w-4" />
                    {blocked ? "Izin Diblokir — Ubah dari Pengaturan Browser" : "Aktifkan Tidak Tersedia"}
                  </button>
                )
              )}
              {isAdmin && (
                <button
                  onClick={() => void sendTest()}
                  disabled={st.busy !== null}
                  className="press-effect flex w-full items-center justify-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 py-3 text-sm font-black text-orange-700 transition hover:bg-orange-100 disabled:opacity-60"
                >
                  {st.busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Kirim Notifikasi Uji ke Perangkat Saya
                </button>
              )}
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
