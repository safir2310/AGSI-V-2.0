"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BadgeCheck,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  PenLine,
  Phone,
  UserRound,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import type { AppUser } from "@/lib/types";

export type EditProfileSheetProps = {
  open: boolean;
  onClose: () => void;
  user: AppUser;
  /** kabari shell setelah profil tersimpan agar seluruh UI ikut memakai data baru */
  onUpdated: (u: AppUser) => void;
};

type FormState = {
  name: string;
  phone: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const EMPTY: FormState = {
  name: "",
  phone: "",
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

/**
 * Sheet "Edit Profil" — ubah nama & no. HP, serta (opsional) ganti password
 * dengan verifikasi password sekarang. Email tidak bisa diubah karena
 * dipakai sebagai identitas masuk.
 */
export function EditProfileSheet({ open, onClose, user, onUpdated }: EditProfileSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  // Isi form setiap kali sheet dibuka (selalu data termutakhir)
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, name: user.name, phone: user.phone ?? "" });
    }
  }, [open, user]);

  // Tutup dengan tombol Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (saving) return;
    const name = form.name.trim();
    if (!name) {
      showNotice({ type: "error", title: "Nama Kosong", message: "Nama tidak boleh kosong ya." });
      return;
    }
    if (form.newPassword && form.newPassword !== form.confirmPassword) {
      showNotice({
        type: "error",
        title: "Password Tidak Sama",
        message: "Konfirmasi password baru belum cocok.",
      });
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch("/api/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone: form.phone.trim(),
          currentPassword: form.currentPassword || undefined,
          newPassword: form.newPassword || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        showNotice({
          type: "error",
          title: "Gagal Menyimpan",
          message: body.error ?? "Coba lagi sebentar ya.",
        });
        return;
      }
      onUpdated(body.user as AppUser);
      showNotice({
        type: "success",
        title: "Profil Tersimpan ✓",
        message: form.newPassword
          ? "Profil & password berhasil diperbarui."
          : "Profilmu berhasil diperbarui.",
      });
      onClose();
    } catch {
      showNotice({
        type: "error",
        title: "Gagal Menyimpan",
        message: "Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="edit-profile-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Profil"
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
                  <PenLine className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Edit Profil</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Perbarui data akunmu
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
            <div className="scrollbar-slim overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              {/* Kartu identitas ringkas */}
              <div className="flex items-center gap-3 rounded-2xl border border-orange-100 bg-orange-50/60 p-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-lg font-black text-orange-600 shadow-sm ring-1 ring-orange-100">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-black text-neutral-800">
                    {user.name} <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                  </p>
                  <p className="truncate text-[11px] text-neutral-400">{user.email}</p>
                </div>
              </div>

              {/* Data diri */}
              <section className="mt-4 space-y-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="ep-name">Nama Lengkap</Label>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                    <Input
                      id="ep-name"
                      className="border-orange-200 pl-9 focus-visible:ring-orange-400"
                      placeholder="cth: Bu Rina"
                      value={form.name}
                      onChange={set("name")}
                      maxLength={60}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ep-phone">No. HP</Label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                    <Input
                      id="ep-phone"
                      className="border-orange-200 pl-9 focus-visible:ring-orange-400"
                      placeholder="cth: 0812-3456-7890 (opsional)"
                      value={form.phone}
                      onChange={set("phone")}
                      inputMode="tel"
                      maxLength={20}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ep-email">Email (tidak bisa diubah)</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" />
                    <Input
                      id="ep-email"
                      className="cursor-not-allowed border-neutral-100 bg-neutral-50 pl-9 text-neutral-400"
                      value={user.email}
                      readOnly
                    />
                  </div>
                </div>
              </section>

              {/* Ganti password */}
              <section className="mt-5 rounded-2xl border border-orange-100 p-3.5">
                <p className="flex items-center gap-1.5 text-xs font-black text-neutral-700">
                  <KeyRound className="h-4 w-4 text-orange-600" /> Ganti Password
                  <span className="font-semibold text-neutral-400">(opsional)</span>
                </p>
                <div className="mt-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ep-pass-now" className="text-[11px]">
                      Password Sekarang
                    </Label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                      <Input
                        id="ep-pass-now"
                        type="password"
                        className="border-orange-200 pl-9 focus-visible:ring-orange-400"
                        placeholder="Wajib bila mengganti password"
                        value={form.currentPassword}
                        onChange={set("currentPassword")}
                        autoComplete="current-password"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="ep-pass-new" className="text-[11px]">
                        Password Baru
                      </Label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                        <Input
                          id="ep-pass-new"
                          type="password"
                          className="border-orange-200 pl-9 focus-visible:ring-orange-400"
                          placeholder="Min. 6 karakter"
                          value={form.newPassword}
                          onChange={set("newPassword")}
                          autoComplete="new-password"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ep-pass-confirm" className="text-[11px]">
                        Ulangi Password Baru
                      </Label>
                      <div className="relative">
                        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                        <Input
                          id="ep-pass-confirm"
                          type="password"
                          className="border-orange-200 pl-9 focus-visible:ring-orange-400"
                          placeholder="Ketik ulang"
                          value={form.confirmPassword}
                          onChange={set("confirmPassword")}
                          autoComplete="new-password"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Aksi */}
              <div className="mt-5 flex gap-2">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="press-effect h-11 flex-1 rounded-xl border border-orange-200 bg-white text-sm font-bold text-neutral-600 hover:bg-orange-50 disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={saving}
                  className="press-effect flex h-11 flex-[1.6] items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700 disabled:opacity-60"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…
                    </>
                  ) : (
                    <>
                      <PenLine className="h-4 w-4" /> Simpan Perubahan
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
