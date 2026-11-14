"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Bike,
  Loader2,
  Mail,
  PenLine,
  Phone,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import { formatDateTime, type CourierInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export type KurirsSheetProps = {
  open: boolean;
  onClose: () => void;
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

const EMPTY: FormState = { name: "", email: "", phone: "", password: "", confirmPassword: "" };

/**
 * Sheet "Kelola Kurir" (khusus Admin/Owner) — daftar akun kurir antar pesanan,
 * tambah kurir baru, edit data / reset password, dan hapus kurir.
 *
 * Akun kurir (role COURIER) masuk dengan email & password lalu diarahkan ke
 * BERANDA KURIR: daftar pesanan antar yang ditugaskan kepadanya, lengkap
 * alamat akurat + pin GPS rumah pelanggan + tombol rute Google Maps.
 */
export function KurirsSheet({ open, onClose }: KurirsSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);

  const [loading, setLoading] = useState(false);
  const [couriers, setCouriers] = useState<CourierInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** null = tampilan daftar; selain itu = form tambah (tanpa id) / edit (dengan id) */
  const [editing, setEditing] = useState<{ courier: CourierInfo | null } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/couriers", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setLoadError(body.error ?? "Gagal memuat daftar kurir.");
        return;
      }
      setCouriers(body.couriers as CourierInfo[]);
    } catch {
      setLoadError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  /** Selalu menunjuk fetchList terbaru tanpa memicu ulang efek "open" */
  const fetchListRef = useRef(fetchList);
  useEffect(() => {
    fetchListRef.current = fetchList;
  });

  useEffect(() => {
    if (open) {
      setEditing(null);
      setForm(EMPTY);
      void fetchListRef.current();
    }
  }, [open]);

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

  const openAdd = () => {
    setForm(EMPTY);
    setEditing({ courier: null });
  };

  const openEdit = (c: CourierInfo) => {
    setForm({ ...EMPTY, name: c.name, email: c.email, phone: c.phone ?? "" });
    setEditing({ courier: c });
  };

  const submit = async () => {
    if (saving || !editing) return;
    const isAdd = !editing.courier;
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const password = form.password;

    if (!name || !email) {
      showNotice({ type: "error", title: "Data Belum Lengkap", message: "Nama & email wajib diisi." });
      return;
    }
    if (isAdd && password.length < 6) {
      showNotice({ type: "error", title: "Password Kurang", message: "Password minimal 6 karakter." });
      return;
    }
    if (password && password !== form.confirmPassword) {
      showNotice({ type: "error", title: "Password Tidak Sama", message: "Konfirmasi password belum cocok." });
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch(isAdd ? "/api/couriers" : `/api/couriers/${editing.courier!.id}`, {
        method: isAdd ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: isAdd ? email : undefined,
          phone: form.phone.trim(),
          ...(password ? { password } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Menyimpan", message: body.error ?? "Coba lagi sebentar ya." });
        return;
      }
      showNotice({
        type: "success",
        title: isAdd ? "Kurir Ditambahkan ✓" : "Kurir Diperbarui ✓",
        message: isAdd
          ? `${name} sudah bisa masuk dengan email & password yang dibuat — tugas antar otomatis muncul di berandanya.`
          : password
            ? `Data ${name} diperbarui — kurir diminta masuk ulang dengan password baru.`
            : `Data ${name} diperbarui.`,
      });
      setEditing(null);
      await fetchList();
    } catch {
      showNotice({ type: "error", title: "Gagal Menyimpan", message: "Tidak dapat menghubungi server." });
    } finally {
      setSaving(false);
    }
  };

  const removeCourier = (c: CourierInfo) => {
    showNotice({
      type: "confirm",
      title: `Hapus Kurir "${c.name}"?`,
      message: `Akun ${c.email} akan dihapus dan tidak bisa dipakai masuk lagi. Pesanan yang pernah diantar tetap tersimpan (nama kurir tercatat).`,
      actions: [
        { label: "Batal" },
        {
          label: "Ya, Hapus",
          variant: "destructive",
          onClick: () => {
            void (async () => {
              try {
                const res = await apiFetch(`/api/couriers/${c.id}`, { method: "DELETE" });
                const body = await res.json();
                if (!res.ok) {
                  showNotice({ type: "error", title: "Gagal Menghapus", message: body.error ?? "Coba lagi." });
                  return;
                }
                showNotice({ type: "success", title: "Kurir Dihapus ✓", message: `Akun ${c.name} telah dihapus.` });
                await fetchList();
              } catch {
                showNotice({ type: "error", title: "Gagal Menghapus", message: "Tidak dapat menghubungi server." });
              }
            })();
          },
        },
      ],
    });
  };

  const isAdd = !!editing && !editing.courier;

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="kurirs-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Kelola Kurir"
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
            <header className="relative shrink-0 bg-gradient-to-r from-emerald-700 via-emerald-600 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                {editing ? (
                  <button
                    onClick={() => setEditing(null)}
                    aria-label="Kembali ke daftar"
                    className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
                  >
                    <ArrowLeft className="h-4.5 w-4.5" />
                  </button>
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                    <Bike className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">
                    {editing ? (isAdd ? "Tambah Kurir" : "Edit Kurir") : "Kelola Kurir Antaran"}
                  </p>
                  <p className="truncate text-[11px] font-semibold text-emerald-100">
                    {editing
                      ? isAdd
                        ? "Buat akun kurir pengantar pesanan antar"
                        : form.name || "Perbarui data kurir"
                      : `${couriers.length} akun kurir terdaftar`}
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
              {editing ? (
                /* ============ FORM TAMBAH / EDIT ============ */
                <section className="space-y-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="kr-name">Nama Kurir</Label>
                    <div className="relative">
                      <UserPlus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" />
                      <Input
                        id="kr-name"
                        className="border-emerald-200 pl-9 focus-visible:ring-emerald-400"
                        placeholder="cth: Budiman"
                        value={form.name}
                        onChange={set("name")}
                        maxLength={60}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="kr-email">Email (dipakai untuk masuk)</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" />
                      <Input
                        id="kr-email"
                        type="email"
                        className={cn(
                          "border-emerald-200 pl-9 focus-visible:ring-emerald-400",
                          !isAdd && "cursor-not-allowed bg-neutral-50 text-neutral-400"
                        )}
                        placeholder="cth: kurir1@agsi.test"
                        value={form.email}
                        onChange={isAdd ? set("email") : undefined}
                        readOnly={!isAdd}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="kr-phone">No. HP (dipakai pelanggan menghubungi)</Label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" />
                      <Input
                        id="kr-phone"
                        className="border-emerald-200 pl-9 focus-visible:ring-emerald-400"
                        placeholder="cth: 0813-2222-3333"
                        value={form.phone}
                        onChange={set("phone")}
                        inputMode="tel"
                        maxLength={20}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="kr-pass">
                      {isAdd ? "Password" : "Password Baru (opsional)"}
                    </Label>
                    <Input
                      id="kr-pass"
                      type="password"
                      className="border-emerald-200 focus-visible:ring-emerald-400"
                      placeholder={isAdd ? "Min. 6 karakter" : "Kosongkan bila tidak diganti"}
                      value={form.password}
                      onChange={set("password")}
                      autoComplete="new-password"
                    />
                    <p className="text-[10px] text-neutral-400">
                      {isAdd
                        ? "Kurir memakai email & password ini untuk masuk beranda kurir."
                        : "Mengisi password akan memaksa kurir masuk ulang di semua perangkat."}
                    </p>
                  </div>

                  {form.password ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="kr-pass2">Ulangi Password</Label>
                      <Input
                        id="kr-pass2"
                        type="password"
                        className="border-emerald-200 focus-visible:ring-emerald-400"
                        placeholder="Ketik ulang password"
                        value={form.confirmPassword}
                        onChange={set("confirmPassword")}
                        autoComplete="new-password"
                      />
                    </div>
                  ) : null}

                  <div className="mt-5 flex gap-2">
                    <button
                      onClick={() => setEditing(null)}
                      disabled={saving}
                      className="press-effect h-11 flex-1 rounded-xl border border-emerald-200 bg-white text-sm font-bold text-neutral-600 hover:bg-emerald-50 disabled:opacity-60"
                    >
                      Batal
                    </button>
                    <button
                      onClick={() => void submit()}
                      disabled={saving}
                      className="press-effect flex h-11 flex-[1.6] items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-extrabold text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…
                        </>
                      ) : (
                        <>
                          {isAdd ? (
                            <>
                              <UserPlus className="h-4 w-4" /> Tambah Kurir
                            </>
                          ) : (
                            <>
                              <PenLine className="h-4 w-4" /> Simpan Perubahan
                            </>
                          )}
                        </>
                      )}
                    </button>
                  </div>
                </section>
              ) : (
                /* ============ DAFTAR KURIR ============ */
                <>
                  <button
                    onClick={openAdd}
                    className="press-effect flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-extrabold text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-700"
                  >
                    <UserPlus className="h-4 w-4" /> Tambah Kurir
                  </button>

                  <div className="mt-3 space-y-2">
                    {loading && couriers.length === 0 ? (
                      <div className="flex min-h-[160px] items-center justify-center">
                        <Loader2 className="h-7 w-7 animate-spin text-emerald-400" />
                      </div>
                    ) : loadError && couriers.length === 0 ? (
                      <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 text-center">
                        <p className="text-xs font-semibold text-red-500">{loadError}</p>
                        <button
                          onClick={() => void fetchList()}
                          className="press-effect rounded-full bg-emerald-600 px-4 py-2 text-[11px] font-extrabold text-white hover:bg-emerald-700"
                        >
                          Coba Lagi
                        </button>
                      </div>
                    ) : couriers.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 p-6 text-center">
                        <p className="text-3xl">🛵</p>
                        <p className="mt-2 text-xs font-semibold text-neutral-400">
                          Belum ada akun kurir — tambahkan kurir supaya pesanan antar bisa
                          ditugaskan &amp; lokasi rumah pelanggan terlihat akurat di berandanya.
                        </p>
                      </div>
                    ) : (
                      couriers.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/40 px-3.5 py-3"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-sm font-black text-white">
                            {c.name.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-black text-neutral-800">{c.name}</p>
                            <p className="truncate text-[11px] text-neutral-400">{c.email}</p>
                            <p className="truncate text-[10px] text-neutral-400">
                              {c.phone ? `${c.phone} • ` : ""}Ditambahkan {formatDateTime(c.createdAt)}
                            </p>
                          </div>
                          <button
                            onClick={() => openEdit(c)}
                            aria-label={`Edit kurir ${c.name}`}
                            title="Edit data / reset password"
                            className="press-effect flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-100 hover:bg-emerald-100"
                          >
                            <PenLine className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => removeCourier(c)}
                            aria-label={`Hapus kurir ${c.name}`}
                            title="Hapus akun kurir"
                            className="press-effect flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-red-500 shadow-sm ring-1 ring-red-100 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <p className="mt-3 text-center text-[10px] leading-relaxed text-neutral-400">
                    Kurir masuk di halaman login dengan email &amp; password-nya, lalu otomatis
                    diarahkan ke beranda kurir (tugas antaran + lokasi rumah pelanggan).
                  </p>
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
