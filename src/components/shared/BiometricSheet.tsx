"use client";

/**
 * Sheet KELOLA LOGIN BIOMETRIK (WebAuthn / passkey).
 * Dibuka dari Profil → "Login Biometrik". Pengguna bisa:
 *  - Mengaktifkan sidik jari / Face ID untuk perangkat ini
 *  - Melihat daftar perangkat yang terdaftar + mencabutnya per perangkat
 *
 * Catatan: kunci privat biometrik tidak pernah meninggalkan perangkat —
 * server hanya menyimpan kunci publik untuk verifikasi tanda tangan.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ExternalLink,
  Fingerprint,
  Laptop,
  Loader2,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  biometricEnvironment,
  deleteBiometricCredential,
  listBiometricCredentials,
  registerBiometric,
  setBiometricEmail,
  type BiometricCredentialInfo,
  type BiometricEnvStatus,
} from "@/lib/biometric-client";
import { useNoticeStore } from "@/lib/store";
import type { AppUser } from "@/lib/types";

export type BiometricSheetProps = {
  open: boolean;
  onClose: () => void;
  user: AppUser;
};

type Availability = "checking" | BiometricEnvStatus;

function formatTanggal(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function BiometricSheet({ open, onClose, user }: BiometricSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const [availability, setAvailability] = useState<Availability>("checking");
  const [credentials, setCredentials] = useState<BiometricCredentialInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /** Muat daftar perangkat + cek dukungan perangkat */
  const refresh = useCallback(async () => {
    setAvailability("checking");
    setAvailability(await biometricEnvironment());
    const list = await listBiometricCredentials();
    setCredentials(list);
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  /** Aktifkan biometrik di perangkat ini */
  const handleActivate = async () => {
    setLoading(true);
    try {
      const result = await registerBiometric();
      if (!result.ok) {
        showNotice({
          type: result.code === "cancelled" ? "info" : "error",
          title:
            result.code === "cancelled"
              ? "Pendaftaran Dibatalkan"
              : result.code === "environment"
                ? "Tidak Bisa di Jendela Ini"
                : "Gagal Aktifkan",
          message: result.message,
        });
        return;
      }
      setBiometricEmail(user.email);
      await refresh();
      showNotice({
        type: "success",
        mascot: true,
        title: "Biometrik Aktif! 🔒",
        message:
          "Selanjutnya kamu bisa masuk cukup dengan pemindaian wajah (Face ID) atau sidik jari di perangkat ini.",
      });
    } finally {
      setLoading(false);
    }
  };

  /** Buka aplikasi di tab browser penuh (dari jendela tersemat) */
  const openInNewTab = () => {
    try {
      const win = window.open(window.location.href, "_blank");
      if (!win) throw new Error("popup-diblokir");
      win.opener = null; // pengaman: tab baru tak perlu akses ke jendela ini
    } catch {
      showNotice({
        type: "info",
        title: "Buka Manual",
        message: "Popup diblokir di jendela ini. Salin alamat aplikasi, lalu buka di Chrome/Safari tab baru.",
      });
    }
  };

  /** Cabut satu perangkat */
  const handleDelete = (cred: BiometricCredentialInfo) => {
    showNotice({
      type: "confirm",
      title: "Cabut Perangkat Ini?",
      message: `${cred.label ?? "Perangkat ini"} tidak akan bisa dipakai untuk masuk lagi. Kamu bisa mengaktifkannya lagi kapan saja.`,
      actions: [
        { label: "Batal" },
        {
          label: "Ya, Cabut",
          variant: "destructive",
          onClick: () => {
            void (async () => {
              setDeletingId(cred.id);
              try {
                const ok = await deleteBiometricCredential(cred.id);
                if (ok) {
                  await refresh();
                  showNotice({
                    type: "success",
                    title: "Perangkat Dicabut",
                    message: "Akses biometrik perangkat itu sudah dihapus.",
                  });
                } else {
                  showNotice({
                    type: "error",
                    title: "Gagal Mencabut",
                    message: "Coba lagi sebentar ya.",
                  });
                }
              } finally {
                setDeletingId(null);
              }
            })();
          },
        },
      ],
    });
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="biometric-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Login Biometrik"
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
                  <ScanFace className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black tracking-wide">Login Biometrik 🔓</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Masuk cepat pakai pemindaian wajah / sidik jari
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup"
                className="press-effect absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </header>

            {/* ===== ISI ===== */}
            <div className="scrollbar-slim overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              {availability === "checking" ? (
                <div className="flex items-center justify-center gap-2 rounded-2xl border border-orange-100 bg-orange-50/60 px-4 py-8 text-sm font-semibold text-orange-700">
                  <Loader2 className="h-4 w-4 animate-spin" /> Memeriksa perangkat…
                </div>
              ) : availability === "embedded" ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-amber-700">
                    <TriangleAlert className="h-4 w-4 shrink-0" />
                    <p className="text-sm font-black">Dibuka di Jendela Tersemat</p>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-amber-800">
                    Browser hanya mengizinkan dialog sidik jari / Face ID di tab browser
                    penuh — bukan di panel pratinjau tersemat seperti sekarang. Ini bukan
                    kesalahan perangkatmu.
                  </p>
                  <button
                    type="button"
                    onClick={openInNewTab}
                    className="press-effect mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-sm font-black text-white shadow-md shadow-amber-500/30 transition hover:bg-amber-600"
                  >
                    <ExternalLink className="h-4 w-4" /> Buka di Tab Baru
                  </button>
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
                    Setelah terbuka di tab baru: login seperti biasa, buka Profil → Login
                    Biometrik, lalu aktifkan di sana.
                  </p>
                </div>
              ) : availability === "insecure" ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-amber-700">
                    <TriangleAlert className="h-4 w-4 shrink-0" />
                    <p className="text-sm font-black">Koneksi Belum Aman</p>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-amber-800">
                    Login biometrik hanya jalan di koneksi aman (HTTPS) atau localhost.
                    Buka ulang aplikasi lewat alamat HTTPS, lalu coba lagi.
                  </p>
                </div>
              ) : availability === "unsupported" ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-amber-700">
                    <TriangleAlert className="h-4 w-4 shrink-0" />
                    <p className="text-sm font-black">Perangkat Belum Mendukung</p>
                  </div>
                  <ul className="mt-2 space-y-1.5 pl-1 text-[12px] leading-relaxed text-amber-800">
                    <li>• Pastikan sidik jari / Face ID sudah aktif di layar kunci HP.</li>
                    <li>• Buka aplikasi lewat Chrome (Android) atau Safari (iPhone).</li>
                    <li>• Login biometrik butuh koneksi aman (HTTPS) atau localhost.</li>
                    <li>
                      • Di dalam aplikasi Android (WebView), fitur ini belum tersedia — buka
                      lewat Chrome di HP yang sama untuk mengaktifkannya.
                    </li>
                  </ul>
                </div>
              ) : (
                <>
                  {/* Kartu aktivasi — dua metode: Face ID & Sidik Jari */}
                  <div className="rounded-2xl border border-orange-200 bg-gradient-to-b from-orange-50 to-white p-4 text-center">
                    <span className="mx-auto flex items-center justify-center -space-x-2">
                      <span className="z-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 ring-2 ring-white">
                        <ScanFace className="h-6 w-6" />
                      </span>
                      <span className="z-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 ring-2 ring-white">
                        <Fingerprint className="h-6 w-6" />
                      </span>
                    </span>
                    <p className="mt-3 text-sm font-black text-neutral-800">
                      Face ID &amp; Sidik Jari
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                      Satu aktivasi untuk dua metode: tatap kamera (pemindaian wajah)
                      atau sentuh sensor sidik jari — perangkat otomatis memakai
                      sensor yang tersedia. Kunci rahasianya tersimpan aman di
                      perangkat ini, tidak pernah dikirim ke server.
                    </p>
                    <button
                      type="button"
                      onClick={handleActivate}
                      disabled={loading}
                      className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-black text-white shadow-lg shadow-orange-500/30 transition hover:bg-orange-700 disabled:opacity-60"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <ScanFace className="h-5 w-5" /> Aktifkan Face ID / Sidik Jari
                        </>
                      )}
                    </button>
                  </div>

                  {/* Daftar perangkat terdaftar */}
                  <div className="mt-4">
                    <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-neutral-400">
                      Perangkat Terdaftar ({credentials.length})
                    </p>
                    {credentials.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-orange-200 bg-orange-50/40 px-4 py-5 text-center text-[12px] text-neutral-500">
                        Belum ada perangkat yang terdaftar. Aktifkan dulu di atas ya 😊
                      </p>
                    ) : (
                      <div className="overflow-hidden rounded-2xl border border-orange-100 bg-white">
                        {credentials.map((cred, i) => (
                          <div
                            key={cred.id}
                            className={
                              "flex items-center gap-3 px-4 py-3 " +
                              (i > 0 ? "border-t border-orange-50" : "")
                            }
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                              {cred.deviceType === "singleDevice" ? (
                                <Smartphone className="h-4.5 w-4.5" />
                              ) : (
                                <Laptop className="h-4.5 w-4.5" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-bold text-neutral-800">
                                {cred.label ?? "Perangkat"}
                              </p>
                              <p className="truncate text-[11px] text-neutral-400">
                                Didaftarkan {formatTanggal(cred.createdAt)}
                                {cred.lastUsedAt
                                  ? ` · terakhir dipakai ${formatTanggal(cred.lastUsedAt)}`
                                  : " · belum pernah dipakai"}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDelete(cred)}
                              disabled={deletingId === cred.id}
                              aria-label={`Cabut ${cred.label ?? "perangkat"}`}
                              className="press-effect flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500 transition hover:bg-red-100 disabled:opacity-50"
                            >
                              {deletingId === cred.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Catatan keamanan */}
                  <div className="mt-4 flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <p className="text-[11px] leading-relaxed text-emerald-800">
                      Aman: sidik jari / wajahmu <b>tidak pernah dikirim</b> ke server AGSI —
                      hanya tanda tangan kriptografi yang diverifikasi. Perangkat bisa dicabut
                      kapan saja dari daftar di atas.
                    </p>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
