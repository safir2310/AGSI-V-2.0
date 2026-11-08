"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Fingerprint,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  RotateCcw,
  ShieldCheck,
  UserPlus,
  UserRound,
  Utensils,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChickenLogo } from "@/components/logo/ChickenLogo";
import { setAuthToken, apiFetch } from "@/lib/api";
import {
  biometricAvailable,
  getBiometricEmail,
  loginBiometric,
  setBiometricEmail,
} from "@/lib/biometric-client";
import { useNoticeStore } from "@/lib/store";
import type { AppUser } from "@/lib/types";

type AuthViewProps = {
  onSuccess: (user: AppUser) => void;
};

type Mode = "login" | "register" | "forgot";

const DEMO_ACCOUNTS = [
  { label: "Pelanggan", email: "budi@example.com", password: "user123", icon: UserRound },
  { label: "Owner/Admin", email: "admin@agsi.test", password: "admin123", icon: ShieldCheck },
  { label: "Kasir POS", email: "kasir@agsi.test", password: "kasir123", icon: Utensils },
];

export function AuthView({ onSuccess }: AuthViewProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [reset, setReset] = useState({
    step: 1 as 1 | 2,
    code: "",
    newPassword: "",
    confirmPassword: "",
    sentTo: "",
    minutes: 10,
  });
  /* Hitungan mundur cooldown tombol "Kirim ulang OTP" (detik) */
  const [otpCooldown, setOtpCooldown] = useState(0);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setTimeout(() => setOtpCooldown((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [otpCooldown]);
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);

  /* ===== Login biometrik (WebAuthn — sidik jari / Face ID) =====
     Tombol hanya muncul bila perangkat mendukung (HTTPS + platform
     authenticator) dan perangkat ini pernah mengaktifkan biometrik. */
  const [bioReady, setBioReady] = useState(false);
  const [bioEmail, setBioEmail] = useState<string | null>(null);
  const [bioLoading, setBioLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const ok = await biometricAvailable();
      if (!alive || !ok) return;
      setBioEmail(getBiometricEmail());
      setBioReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleBiometricLogin = async () => {
    setBioLoading(true);
    try {
      const result = await loginBiometric(bioEmail);
      if (!result.ok) {
        showNotice({
          type: result.code === "cancelled" ? "info" : "error",
          title:
            result.code === "cancelled"
              ? "Pindai Dibatalkan"
              : result.code === "environment"
                ? "Tidak Bisa di Jendela Ini"
                : "Login Biometrik Gagal",
          message: result.message,
        });
        return;
      }
      setAuthToken(result.token);
      setBiometricEmail(result.user.email);
      onSuccess(result.user);
    } finally {
      setBioLoading(false);
    }
  };

  /** Setelah login password: kalau akun punya kredensial biometrik,
   *  ingat emailnya agar tombol sidik jari langsung siap berikutnya. */
  const rememberBiometricIfAny = async (email: string) => {
    try {
      const res = await apiFetch("/api/auth/biometric/credentials", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.credentials) && data.credentials.length > 0) {
        setBiometricEmail(email);
      }
    } catch {
      // diam — hanya kenyamanan, bukan jalur kritis
    }
  };

  /* ===== Masuk / Daftar ===== */
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    try {
      const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email: form.email, password: form.password }
          : { name: form.name, email: form.email, password: form.password, phone: form.phone };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Masuk", message: data.error ?? "Terjadi kesalahan." });
        return;
      }
      // Simpan token sesi (fallback kalau cookie diblokir browser di iframe preview)
      if (data.token) setAuthToken(data.token);
      void rememberBiometricIfAny(String(form.email));
      onSuccess(data.user as AppUser);
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server. Coba lagi." });
    } finally {
      setLoading(false);
    }
  };

  /* ===== Lupa Password — Langkah 1: kirim OTP ke email (Resend) ===== */
  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.email.trim()) {
      showNotice({ type: "error", title: "Email Kosong", message: "Isi email akunmu dulu ya." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Mengirim OTP", message: data.error ?? "Coba lagi ya." });
        return;
      }
      const sentTo = String(form.email).trim().toLowerCase();
      setReset({
        step: 2,
        code: "",
        newPassword: "",
        confirmPassword: "",
        sentTo,
        minutes: data.minutes ?? 10,
      });
      setOtpCooldown(60);
      showNotice({
        type: "success",
        title: "Kode OTP Terkirim 📧",
        message: `Kami mengirim kode OTP 6 digit ke ${sentTo}. Berlaku ${data.minutes ?? 10} menit — cek juga folder spam ya.${data.devNote ? ` (${data.devNote})` : ""}`,
      });
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server." });
    } finally {
      setLoading(false);
    }
  };

  /* ===== Lupa Password — Langkah 2: simpan password baru ===== */
  const doReset = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(reset.code.trim())) {
      showNotice({ type: "error", title: "Kode Belum Lengkap", message: "Masukkan 6 digit kode OTP dari emailmu." });
      return;
    }
    if (reset.newPassword.length < 6) {
      showNotice({ type: "error", title: "Password Terlalu Pendek", message: "Password baru minimal 6 karakter." });
      return;
    }
    if (reset.newPassword !== reset.confirmPassword) {
      showNotice({ type: "error", title: "Password Tidak Sama", message: "Konfirmasi password belum cocok." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          code: reset.code.trim(),
          newPassword: reset.newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Reset Password", message: data.error ?? "Coba lagi ya." });
        return;
      }
      setMode("login");
      setForm((f) => ({ ...f, password: "" }));
      setReset({ step: 1, code: "", newPassword: "", confirmPassword: "", sentTo: "", minutes: 10 });
      setOtpCooldown(0);
      showNotice({
        type: "success",
        mascot: true,
        title: "Password Berhasil Diubah! 🎉",
        message: "Sekarang masuk lagi pakai email + password barumu ya 😊",
      });
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server." });
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (email: string, password: string) => {
    setForm((f) => ({ ...f, email, password }));
    setMode("login");
  };

  const backToLogin = () => {
    setMode("login");
    setReset({ step: 1, code: "", newPassword: "", confirmPassword: "", sentTo: "", minutes: 10 });
    setOtpCooldown(0);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      {/* Hero gradasi orange tua -> cerah -> putih */}
      <div className="bg-brand-gradient relative overflow-hidden rounded-b-[2.5rem] px-6 pb-24 pt-[calc(1.5rem+env(safe-area-inset-top,0px))] text-center">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-6 -left-8 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
        <motion.div
          initial={prefersReduced ? false : { scale: 0.5, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 18 }}
          className="relative z-10 flex flex-col items-center"
        >
          <ChickenLogo size={150} animated entrance />
          <h1 className="mt-2 text-3xl font-black uppercase tracking-wide text-white drop-shadow">
            Ayam Geprek
          </h1>
          <span className="mt-1 rounded-full bg-white/95 px-4 py-1 text-xs font-extrabold uppercase tracking-[0.2em] text-orange-700 shadow">
            Sambal Ijo
          </span>
        </motion.div>
      </div>

      {/* Kartu form menimpa hero */}
      <motion.div
        initial={prefersReduced ? false : { y: 34, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.12, duration: 0.45, ease: "easeOut" }}
        className="relative z-10 mx-auto -mt-16 w-full max-w-md px-5 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]"
      >
        <div className="rounded-3xl border border-orange-100 bg-white p-6 shadow-[0_24px_50px_-24px_rgba(234,88,12,0.4)]">
          {/* ============ MODE LUPA PASSWORD ============ */}
          {mode === "forgot" ? (
            <div>
              <button
                type="button"
                onClick={backToLogin}
                className="press-effect mb-4 flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700 transition-colors hover:bg-orange-100"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Kembali ke Masuk
              </button>

              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
                  <KeyRound className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-black text-neutral-900">Lupa Password?</h2>
                  <p className="text-xs text-neutral-400">
                    {reset.step === 1
                      ? "Tenang, masukkan email akunmu dulu ya."
                      : "Masukkan kode OTP dari email + password baru."}
                  </p>
                </div>
              </div>

              {/* Indikator langkah 1 / 2 */}
              <div className="mb-5 flex items-center gap-2">
                {[1, 2].map((s) => (
                  <div
                    key={s}
                    className={
                      "h-1.5 flex-1 rounded-full transition-colors " +
                      (reset.step >= s ? "bg-orange-500" : "bg-orange-100")
                    }
                  />
                ))}
              </div>

              {reset.step === 1 ? (
                <form onSubmit={sendCode} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="forgot-email">Email Terdaftar</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                      <Input
                        id="forgot-email"
                        type="email"
                        placeholder="nama@email.com"
                        className="border-orange-200 pl-9 focus-visible:ring-orange-400"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        required
                      />
                    </div>
                    <p className="text-[11px] text-neutral-400">
                      Kami akan mengirim kode OTP 6 digit ke email ini.
                    </p>
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="press-effect h-11 w-full rounded-xl bg-orange-600 text-sm font-bold hover:bg-orange-700"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Mail className="h-4 w-4" /> Kirim Kode OTP
                      </>
                    )}
                  </Button>
                </form>
              ) : (
                <form onSubmit={doReset} className="space-y-4">
                  {/* Kotak info email tujuan OTP */}
                  <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3.5 text-center">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">
                      📧 Kode OTP Terkirim
                    </p>
                    <p className="mt-1 truncate text-sm font-black text-orange-700">{reset.sentTo}</p>
                    <p className="mt-1 text-[10px] text-neutral-500">
                      Berlaku {reset.minutes} menit — cek juga folder spam.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="reset-code">Kode OTP (6 Digit)</Label>
                    <Input
                      id="reset-code"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="••••••"
                      className="border-orange-200 text-center text-lg font-black tracking-[0.5em] focus-visible:ring-orange-400"
                      value={reset.code}
                      onChange={(e) => setReset({ ...reset, code: e.target.value.replace(/\D/g, "") })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-password">Password Baru</Label>
                    <Input
                      id="reset-password"
                      type="password"
                      placeholder="Minimal 6 karakter"
                      className="border-orange-200 focus-visible:ring-orange-400"
                      value={reset.newPassword}
                      onChange={(e) => setReset({ ...reset, newPassword: e.target.value })}
                      required
                      minLength={6}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-confirm">Ulangi Password Baru</Label>
                    <Input
                      id="reset-confirm"
                      type="password"
                      placeholder="Ketik ulang password baru"
                      className="border-orange-200 focus-visible:ring-orange-400"
                      value={reset.confirmPassword}
                      onChange={(e) => setReset({ ...reset, confirmPassword: e.target.value })}
                      required
                      minLength={6}
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="press-effect h-11 w-full rounded-xl bg-orange-600 text-sm font-bold hover:bg-orange-700"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <KeyRound className="h-4 w-4" /> Simpan Password Baru
                      </>
                    )}
                  </Button>
                  <button
                    type="button"
                    disabled={loading || otpCooldown > 0}
                    onClick={() => void sendCode()}
                    className="press-effect flex w-full items-center justify-center gap-1.5 text-xs font-bold text-orange-600 hover:text-orange-700 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {otpCooldown > 0 ? `Kirim ulang OTP (${otpCooldown}s)` : "Kirim ulang OTP"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReset({ ...reset, step: 1 })}
                    className="press-effect flex w-full items-center justify-center gap-1.5 text-xs font-bold text-neutral-400 hover:text-neutral-600"
                  >
                    Ganti email
                  </button>
                </form>
              )}
            </div>
          ) : (
            <>
              {/* ============ MODE MASUK / DAFTAR ============ */}
              {/* Tab login/register */}
              <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-orange-50 p-1">
                {(["login", "register"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={
                      "relative rounded-xl px-3 py-2 text-sm font-bold transition-colors " +
                      (mode === m ? "text-white" : "text-orange-700 hover:text-orange-800")
                    }
                  >
                    {mode === m && (
                      <motion.span
                        layoutId={prefersReduced ? undefined : "auth-tab"}
                        className="absolute inset-0 rounded-xl bg-orange-600 shadow"
                        transition={{ type: "spring", stiffness: 420, damping: 32 }}
                      />
                    )}
                    <span className="relative z-10">{m === "login" ? "Masuk" : "Daftar"}</span>
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-4">
                {mode === "register" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Nama Lengkap</Label>
                    <Input
                      id="name"
                      placeholder="cth: Budi Santoso"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="border-orange-200 focus-visible:ring-orange-400"
                      required
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="nama@email.com"
                      className="pl-9"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    {mode === "login" && (
                      <button
                        type="button"
                        onClick={() => setMode("forgot")}
                        className="text-xs font-bold text-orange-600 underline-offset-2 hover:text-orange-700 hover:underline"
                      >
                        Lupa password?
                      </button>
                    )}
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Minimal 6 karakter"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                    minLength={6}
                  />
                </div>
                {mode === "register" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">No. HP</Label>
                    <Input
                      id="phone"
                      type="tel"
                      inputMode="tel"
                      placeholder="08xx-xxxx-xxxx"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      required
                    />
                    <p className="text-[11px] text-neutral-400">
                      Dipakai untuk layanan antar & keamanan akun. Lupa password diverifikasi lewat email.
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="press-effect h-11 w-full rounded-xl bg-orange-600 text-sm font-bold hover:bg-orange-700"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : mode === "login" ? (
                    <>
                      <LogIn className="h-4 w-4" /> Masuk Sekarang
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" /> Buat Akun
                    </>
                  )}
                </Button>
              </form>

              {/* ===== LOGIN BIOMETRIK (hanya mode masuk + perangkat mendukung) ===== */}
              {mode === "login" && bioReady && (
                <div className="mt-4">
                  <div className="flex items-center gap-3">
                    <span className="h-px flex-1 bg-orange-100" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      atau
                    </span>
                    <span className="h-px flex-1 bg-orange-100" />
                  </div>
                  <button
                    type="button"
                    onClick={handleBiometricLogin}
                    disabled={bioLoading || loading}
                    className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-orange-200 bg-orange-50/70 text-sm font-black text-orange-700 transition hover:bg-orange-100 disabled:opacity-60"
                  >
                    {bioLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Fingerprint className="h-5 w-5" /> Masuk dengan Sidik Jari / Face ID
                      </>
                    )}
                  </button>
                  {bioEmail && (
                    <p className="mt-1.5 text-center text-[11px] text-neutral-400">
                      Akun tersimpan di perangkat ini: <b>{bioEmail}</b>
                    </p>
                  )}
                </div>
              )}

              {/* Akun demo */}
              <div className="mt-6">
                <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  Coba cepat — akun demo
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {DEMO_ACCOUNTS.map((d) => (
                    <button
                      key={d.email}
                      type="button"
                      onClick={() => fillDemo(d.email, d.password)}
                      className="press-effect flex flex-col items-center gap-1 rounded-xl border border-orange-100 bg-orange-50/60 px-2 py-2.5 text-[10px] font-bold text-orange-800 transition-colors hover:bg-orange-100"
                    >
                      <d.icon className="h-4 w-4 text-orange-500" />
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-neutral-400">
          Dengan masuk, kamu setuju menikmati geprek terpedas se-kampung 😋
        </p>
      </motion.div>
    </div>
  );
}
