"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Fingerprint,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  RotateCcw,
  ScanFace,
  UserPlus,
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
  prefersFaceFirst,
  setBiometricEmail,
  startBiometricAutofill,
} from "@/lib/biometric-client";
import { useNoticeStore } from "@/lib/store";
import type { AppUser } from "@/lib/types";

type AuthViewProps = {
  onSuccess: (user: AppUser) => void;
};

type Mode = "login" | "register" | "forgot";

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

  /* ===== Login biometrik (WebAuthn — Face ID & sidik jari) =====
     Dua tombol terpisah sesuai metode: PEMINDAIAN WAJAH (Face ID) dan
     SIDIK JARI. Keduanya menjalankan alur WebAuthn yang sama — sistem
     operasi otomatis memakai sensor yang tersedia di perangkat (kamera
     wajah pada iPhone X+, sensor sidik jari pada Android/macOS/Windows).
     Tombol paling relevan untuk perangkat ini tampil paling atas. */
  const [bioReady, setBioReady] = useState(false);
  const [bioEmail, setBioEmail] = useState<string | null>(null);
  const [bioLoadingFace, setBioLoadingFace] = useState(false);
  const [bioLoadingFinger, setBioLoadingFinger] = useState(false);

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

  /* Proteksi: hanya SATU alur login biometrik (modal/autofill) yang selesai dalam satu waktu */
  const bioInFlight = useRef(false);
  const autofillStarted = useRef(false);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  /** Login via satu metode biometrik. Keduanya satu alur WebAuthn —
   *  pemisahan hanya untuk label & loading tombol. */
  const handleBiometricLogin = async (method: "face" | "fingerprint") => {
    if (bioInFlight.current) return; // satu login biometrik saja dalam satu waktu
    bioInFlight.current = true;
    if (method === "face") setBioLoadingFace(true);
    else setBioLoadingFinger(true);
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
                : method === "face"
                  ? "Login Face ID Gagal"
                  : "Login Sidik Jari Gagal",
          message: result.message,
        });
        return;
      }
      setAuthToken(result.token);
      setBiometricEmail(result.user.email);
      onSuccess(result.user);
    } finally {
      bioInFlight.current = false;
      setBioLoadingFace(false);
      setBioLoadingFinger(false);
    }
  };

  /* ===== PASSKEY AUTOFILL (conditional mediation) — se-otomatis yang
     diizinkan browser. Tanpa tombol & tanpa dialog modal: begitu halaman login
     siap, passkey tersimpan ditawarkan browser sebagai saran autofill di kolom
     email; ketuk saran → pindai sidik jari → LANGSUNG masuk akun.
     Catatan: dialog biometrik sistem Chrome/Android ("Masuk ke <domain>…")
     tidak bisa dihilangkan aplikasi web — di dalam dialog itulah sidik jari
     dipindai; browser melarang situs membaca biometrik tanpa dialog. */
  useEffect(() => {
    if (!bioReady || mode !== "login" || autofillStarted.current) return;
    autofillStarted.current = true;
    void startBiometricAutofill((result) => {
      if (bioInFlight.current) return; // login lain sedang berjalan
      bioInFlight.current = true;
      setAuthToken(result.token);
      setBiometricEmail(result.user.email);
      onSuccessRef.current(result.user);
    });
  }, [bioReady, mode]);

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
                      autoComplete="username webauthn"
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

              {/* ===== LOGIN BIOMETRIK: FACE ID + SIDIK JARI =====
                  Dua metode terpisah. Tombol pertama = sensor paling mungkin
                  dimiliki perangkat ini (iPhone/Windows → Face ID dulu;
                  Android/macOS → sidik jari dulu). Alur keduanya identik:
                  dialog sistem memakai sensor milik perangkat. */}
              {mode === "login" && bioReady && (
                <div className="mt-4">
                  <div className="flex items-center gap-3">
                    <span className="h-px flex-1 bg-orange-100" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                      atau masuk cepat dengan
                    </span>
                    <span className="h-px flex-1 bg-orange-100" />
                  </div>
                  {(prefersFaceFirst() ? ["face", "fingerprint"] : ["fingerprint", "face"]).map(
                    (method) => {
                      const isFace = method === "face";
                      const isLoading = isFace ? bioLoadingFace : bioLoadingFinger;
                      return (
                        <button
                          key={method}
                          type="button"
                          onClick={() => void handleBiometricLogin(isFace ? "face" : "fingerprint")}
                          disabled={bioLoadingFace || bioLoadingFinger || loading}
                          className={
                            "press-effect flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 text-sm font-black transition disabled:opacity-60 " +
                            (isFace
                              ? "mt-3 border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 text-orange-700 hover:from-orange-100 hover:to-amber-100"
                              : "mt-2.5 border-orange-200 bg-orange-50/70 text-orange-700 hover:bg-orange-100")
                          }
                        >
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              {isFace ? (
                                <ScanFace className="h-5 w-5" />
                              ) : (
                                <Fingerprint className="h-5 w-5" />
                              )}
                              {isFace ? "Login dengan Face ID (Pindai Wajah)" : "Login dengan Sidik Jari"}
                            </>
                          )}
                        </button>
                      );
                    })}
                  <p className="mt-2 text-center text-[11px] leading-relaxed text-neutral-400">
                    Perangkat otomatis memakai sensor yang tersedia — tatap kamera
                    untuk pemindaian wajah atau sentuh sensor sidik jari saat diminta.
                  </p>
                  {bioEmail && (
                    <p className="mt-1.5 text-center text-[11px] text-neutral-400">
                      Akun tersimpan di perangkat ini: <b>{bioEmail}</b>
                    </p>
                  )}
                </div>
              )}

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
