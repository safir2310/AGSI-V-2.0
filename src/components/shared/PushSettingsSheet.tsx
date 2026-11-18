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
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import {
  batteryUnrestricted,
  disableWebPush,
  enableWebPush,
  fetchPushConfig,
  openAutostartSettings,
  readPushStatus,
  registerNativeTokenIfPresent,
  requestBatteryUnrestriction,
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
 *  - Notifikasi uji DIHAPUS dari UI (v1.3.8 — kontrol notifikasi senyap:
 *    endpoint /api/push/send juga 403 di production).
 *
 * Bila server belum dikonfigurasi (.env FIREBASE_* kosong) tampil kartu
 * kuning berisi petunjuk singkat — bukan error yang bikin bingung.
 */

type SheetState = {
  config: PushConfig | null;
  status: PushStatus | null;
  loading: boolean;
  busy: "enable" | "disable" | null;
  error: string | null;
};

export function PushSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void; user: AppUser }) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const [st, setSt] = useState<SheetState>({
    config: null,
    status: null,
    loading: false,
    busy: null,
    error: null,
  });

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

  /** v1.3.12 — izin berjalan di latar belakang (hanya aplikasi native):
   *  true = diizinkan, false = belum, null = tak terdeteksi / bukan native. */
  const [bgOk, setBgOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (open && st.status?.native) setBgOk(batteryUnrestricted());
    else setBgOk(null);
  }, [open, st.status?.native]);

  /** v1.3.21 — ikatan token perangkat NATIVE ke akun/role server (ditulis
   *  PushBridge; di sini bisa diperiksa & diikat ulang sendiri bila lepas —
   *  ikatan anonim = push pesanan staf tidak pernah sampai ke perangkat ini). */
  const [binding, setBinding] = useState<{ ok: boolean; role: string | null } | null>(null);
  const [rebinding, setRebinding] = useState(false);
  const readBinding = useCallback(() => {
    try {
      const raw = localStorage.getItem("agsi_push_binding");
      setBinding(raw ? (JSON.parse(raw) as { ok: boolean; role: string | null }) : null);
    } catch {
      setBinding(null);
    }
  }, []);
  useEffect(() => {
    if (open && st.status?.native) {
      readBinding();
      window.addEventListener("agsi-push-binding", readBinding);
      return () => window.removeEventListener("agsi-push-binding", readBinding);
    }
    setBinding(null);
  }, [open, st.status?.native, readBinding]);

  const rebind = useCallback(async () => {
    setRebinding(true);
    try {
      const r = await registerNativeTokenIfPresent();
      if (r.ok) {
        try {
          localStorage.setItem(
            "agsi_push_binding",
            JSON.stringify({ ok: r.ok, role: r.role, at: Date.now() }),
          );
        } catch {
          /* penyimpanan diblokir — abaikan */
        }
        showNotice({
          type: r.role ? "success" : "info",
          autoCloseMs: 5200,
          title: r.role ? `Perangkat terikat role ${r.role} ✓` : "Perangkat terdaftar (anonim)",
          message: r.role
            ? "Push pesanan & chat sesuai role kini diarahkan ke perangkat ini."
            : "Masuk sebagai staf (admin/owner/kasir) agar push pesanan diarahkan ke perangkat ini.",
        });
      } else {
        const pesan: Record<string, { title: string; message: string }> = {
          "no-bridge": {
            title: "Bukan di aplikasi Android",
            message: "Buka dari aplikasi AGSI Android (bukan browser), lalu coba lagi.",
          },
          "dead-bridge": {
            title: "Jembatan native tidak merespons",
            message: "Tutup dan buka ulang aplikasi AGSI, lalu coba lagi.",
          },
          "no-firebase": {
            title: "Aplikasi belum berisi Firebase",
            message:
              "APK ini dibangun tanpa kredensial Firebase — perbarui aplikasi ke versi 1.3.21+ dari menu Unduh, lalu coba lagi.",
          },
          "no-token": {
            title: "Token FCM belum siap",
            message:
              "Biasanya siap ±30 detik setelah aplikasi dibuka. Tunggu sebentar lalu coba lagi.",
          },
        };
        const p = pesan[r.reason] ?? { title: "Gagal mengikat", message: "Coba lagi beberapa saat." };
        showNotice({ type: "error", autoCloseMs: 6000, title: p.title, message: p.message });
      }
      readBinding();
    } finally {
      setRebinding(false);
    }
  }, [readBinding, showNotice]);

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

  /** v1.3.12 — tombol "Izinkan Baterai": buka dialog sistem "izinkan AGSI
   *  mengabaikan optimasi baterai" TANPA jeda (permintaan otomatis aplikasi
   *  berjeda 3 hari), lalu periksa ulang statusnya. */
  const allowBatteryExemption = useCallback(() => {
    requestBatteryUnrestriction();
    setTimeout(() => setBgOk(batteryUnrestricted()), 2_000);
    setTimeout(() => setBgOk(batteryUnrestricted()), 5_000);
  }, []);

  /** Tombol "Autostart": layar pabrikan (Xiaomi MIUI, OPPO/realme, vivo,
   *  Huawei/Honor) — tanpa izin autostart, sistem mematikan layanan
   *  notifikasi AGSI saat aplikasi ditutup. */
  const openAutostartScreen = useCallback(() => {
    openAutostartSettings();
  }, []);

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
                      {/* v1.3.12 — izin berjalan di latar belakang (native):
                          status + tombol izinkan baterai & autostart OEM */}
                      {status?.native && (
                        <>
                          <div className="h-px bg-neutral-200/70" />
                          {statusRow({
                            icon: <Zap className="h-4 w-4" />,
                            label: "Berjalan di Latar Belakang",
                            value:
                              bgOk === true
                                ? "Diizinkan — notifikasi muncul walau aplikasi ditutup"
                                : bgOk === false
                                  ? "Belum diizinkan — notifikasi bisa terlambat / mati"
                                  : "Tidak dapat membaca status",
                            ok: bgOk === true ? true : bgOk === false ? "warn" : false,
                          })}
                          {bgOk !== true && (
                            <div className="flex flex-wrap gap-2 pl-12">
                              <button
                                onClick={allowBatteryExemption}
                                className="press-effect rounded-xl bg-orange-600 px-3 py-1.5 text-[10.5px] font-black text-white hover:bg-orange-700"
                              >
                                Izinkan Baterai
                              </button>
                              <button
                                onClick={openAutostartScreen}
                                className="press-effect rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-[10.5px] font-black text-neutral-700 hover:bg-neutral-50"
                              >
                                Autostart (Xiaomi dll.)
                              </button>
                            </div>
                          )}
                          {/* v1.3.21 — ikatan akun & role (target push per peran);
                              anonim/lepas → tombol ikat ulang perangkat */}
                          <div className="h-px bg-neutral-200/70" />
                          {statusRow({
                            icon: <Send className="h-4 w-4" />,
                            label: "Ikatan Akun & Role",
                            value:
                              binding?.ok && binding.role
                                ? `Terikat ke role ${binding.role} — push sesuai role aktif`
                                : binding?.ok
                                  ? "Terdaftar anonim — push pesanan staf TIDAK sampai ke sini"
                                  : "Belum terikat ke sesi login",
                            ok: binding?.ok && binding.role ? true : binding?.ok ? "warn" : false,
                          })}
                          {(!binding?.ok || !binding?.role) && (
                            <div className="flex gap-2 pl-12">
                              <button
                                onClick={() => void rebind()}
                                disabled={rebinding}
                                className="press-effect flex items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-1.5 text-[10.5px] font-black text-white hover:bg-orange-700 disabled:opacity-60"
                              >
                                {rebinding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                Ikat Ulang Perangkat
                              </button>
                            </div>
                          )}
                        </>
                      )}
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
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
