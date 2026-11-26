"use client";

/**
 * Sheet KELOLA AUTHENTICATOR (TOTP) — dibuka dari Profil → "Authenticator".
 *
 * Alur pemasangan:
 *  1. "Aktifkan Authenticator" → server buat secret terenkripsi → QR otpauth://
 *     dipindai dengan Google Authenticator / Authy / Aegis (atau ketik manual).
 *  2. User mengetik kode 6 digit yang sedang tampil → POST verify → AKTIF.
 *  3. Sejak itu "lupa password" akun ini memakai kode authenticator — TIDAK
 *     ada OTP email lagi (lihat /api/auth/forgot-password).
 *
 * Nonaktif meminta kode yang sedang valid — pencuri sesi tak bisa mematikan
 * 2FA sendiri. Secret polos hanya dikirim SEKALI (saat setup) lalu tak pernah
 * lagi; server menyimpan versi terenkripsi AES-256-GCM.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRound, Loader2, ShieldCheck, Smartphone, TriangleAlert, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useNoticeStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/lib/types";

export type TotpSheetProps = {
  open: boolean;
  onClose: () => void;
  user: AppUser;
};

type Status = { enabled: boolean; pending: boolean };

export function TotpSheet({ open, onClose, user }: TotpSheetProps) {
  const showNotice = useNoticeStore((s) => s.show);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<"view" | "setup">("view");
  const [uri, setUri] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/totp");
      if (!r.ok) {
        setStatus({ enabled: false, pending: false });
        return;
      }
      const d = await r.json();
      setStatus({ enabled: !!d.enabled, pending: !!d.pending });
      setPhase("view");
    } catch {
      setStatus({ enabled: false, pending: false });
    }
  }, []);

  useEffect(() => {
    if (open) {
      setErr(null);
      setCode("");
      void load();
    }
  }, [open, load]);

  const startSetup = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/totp/setup", { method: "POST" });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error ?? "Gagal menyiapkan authenticator.");
        return;
      }
      setUri(d.otpauthUri);
      setSecret(d.secret);
      setShowSecret(false);
      setCode("");
      setPhase("setup");
    } catch {
      setErr("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setErr("Masukkan 6 digit kode yang sedang tampil di aplikasi authenticator.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/totp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error ?? "Verifikasi gagal.");
        return;
      }
      showNotice({
        type: "success",
        title: "Authenticator Aktif! 🔐",
        message: "Mulai sekarang 'lupa password' akunmu diverifikasi lewat kode aplikasi authenticator — bukan email.",
      });
      setCode("");
      await load();
    } catch {
      setErr("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setErr("Masukkan 6 digit kode dari aplikasi authenticator untuk konfirmasi.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/auth/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error ?? "Gagal menonaktifkan.");
        return;
      }
      showNotice({ type: "success", title: "Authenticator Dimatikan", message: "Lupa password kembali memakai kode OTP email." });
      setCode("");
      await load();
    } catch {
      setErr("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center"
          onClick={() => {
            if (!busy) onClose();
          }}
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Kepala sheet */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                  <KeyRound className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-black text-neutral-800">Authenticator (TOTP)</p>
                  <p className="text-[10px] text-neutral-400">Verifikasi lupa password tanpa email</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!busy) onClose();
                }}
                className="rounded-full p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                aria-label="Tutup"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {status === null ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
              </div>
            ) : phase === "setup" && uri ? (
              /* ===== SETUP: QR + kode konfirmasi ===== */
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-orange-200 bg-gradient-to-b from-orange-50 to-white p-4 text-center">
                  <p className="text-sm font-black text-neutral-800">1. Pindai QR di aplikasi authenticator</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                    Buka Google Authenticator / Authy / Aegis → tombol + → pindai kode di bawah.
                  </p>
                  <div className="mx-auto mt-3 w-fit rounded-2xl border border-orange-100 bg-white p-3 shadow-sm">
                    <QRCodeSVG value={uri} size={188} level="M" />
                  </div>
                  {/* Secret untuk input manual (satu-satunya tempat secret tampil) */}
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="mt-2 text-[11px] font-bold text-orange-600 underline-offset-2 hover:underline"
                  >
                    {showSecret ? "Sembunyikan kode manual" : "Tidak bisa memindai? ketik manual"}
                  </button>
                  {showSecret && (
                    <p className="mt-1 break-all rounded-lg bg-orange-50 p-2 font-mono text-[11px] font-bold text-orange-800 select-all">
                      {secret}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-orange-200 bg-white p-4">
                  <p className="text-sm font-black text-neutral-800">2. Ketik kode yang sedang tampil</p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    Kode 6 digit di aplikasi berganti tiap 30 detik — pakai yang terbaru.
                  </p>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••••"
                    className="mt-2 h-12 w-full rounded-xl border border-orange-200 text-center text-lg font-black tracking-[0.5em] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-200"
                  />
                  <button
                    type="button"
                    onClick={() => void confirmSetup()}
                    disabled={busy}
                    className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-black text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><ShieldCheck className="h-5 w-5" /> Konfirmasi & Aktifkan</>)}
                  </button>
                  <button
                    type="button"
                    onClick={() => void load()}
                    disabled={busy}
                    className="mt-2 w-full text-[11px] font-bold text-neutral-400 hover:text-neutral-600"
                  >
                    Batal — kembali
                  </button>
                </div>
              </div>
            ) : (
              /* ===== VIEW: status ===== */
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-orange-200 bg-gradient-to-b from-orange-50 to-white p-4 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 ring-2 ring-white">
                    <Smartphone className="h-6 w-6" />
                  </span>
                  <p className="mt-3 text-sm font-black text-neutral-800">Authenticator {user.email}</p>
                  <p
                    className={cn(
                      "mx-auto mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black",
                      status.enabled
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                        : "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200"
                    )}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {status.enabled ? "AKTIF — lupa password pakai authenticator" : "BELUM AKTIF"}
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                    {status.enabled
                      ? "Saat lupa password, kamu akan diminta kode 6 digit dari aplikasi authenticator — tidak ada OTP email yang dikirim."
                      : "Aktifkan agar lupa password diverifikasi lewat aplikasi authenticator (Google Authenticator, Authy, Aegis, dll) — lebih aman karena kodenya tidak pernah dikirim ke email."}
                  </p>
                  {!status.enabled && (
                    <button
                      type="button"
                      onClick={() => void startSetup()}
                      disabled={busy}
                      className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-black text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700 disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><KeyRound className="h-5 w-5" /> Aktifkan Authenticator</>)}
                    </button>
                  )}
                </div>

                {status.enabled && (
                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="text-sm font-black text-neutral-800">Matikan Authenticator</p>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      Konfirmasi dengan kode yang sedang tampil di aplikasimu.
                    </p>
                    <input
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="••••••"
                      className="mt-2 h-11 w-full rounded-xl border border-neutral-200 text-center text-base font-black tracking-[0.5em] outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-200"
                    />
                    <button
                      type="button"
                      onClick={() => void disable()}
                      disabled={busy}
                      className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-700 text-sm font-black text-white shadow-lg shadow-neutral-700/25 hover:bg-neutral-800 disabled:opacity-60"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Matikan Authenticator"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {err && (
              <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-[12px] font-semibold leading-relaxed text-amber-800">{err}</p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
