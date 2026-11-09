"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Crown,
  Loader2,
  Mail,
  PenLine,
  Phone,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import { formatDateTime, type AdminInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AdminsSheetProps = {
  open: boolean;
  onClose: () => void;
  /** akun yang sedang masuk — dipakai untuk proteksi (tak bisa hapus/ubah akses diri sendiri) */
  currentUserId: string;
  /** OWNER dapat mengelola akun Owner & mengubah akses; ADMIN hanya akun admin biasa */
  currentUserRole: string;
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  role: "ADMIN" | "OWNER";
};

const EMPTY: FormState = {
  name: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  role: "ADMIN",
};

function roleLabel(role: string) {
  return role === "OWNER" ? "Owner" : "Admin";
}

/**
 * Sheet "Kelola Admin" (khusus Admin/Owner) — daftar akun admin & owner,
 * tambah admin baru (pilih akses Admin/Owner), edit data / reset password /
 * ubah akses, dan hapus admin. Akun sendiri tak bisa dihapus atau diubah
 * aksesnya; hanya Owner yang dapat mengelola akun Owner & akses.
 */
export function AdminsSheet({ open, onClose, currentUserId, currentUserRole }: AdminsSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const isOwner = currentUserRole === "OWNER";

  const [loading, setLoading] = useState(false);
  const [admins, setAdmins] = useState<AdminInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** null = tampilan daftar; selain itu = form tambah (tanpa id) / edit (dengan id) */
  const [editing, setEditing] = useState<{ admin: AdminInfo | null } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/admins", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setLoadError(body.error ?? "Gagal memuat daftar admin.");
        return;
      }
      setAdmins(body.admins as AdminInfo[]);
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

  const set = (k: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const setRole = (role: "ADMIN" | "OWNER") => setForm((f) => ({ ...f, role }));

  const openAdd = () => {
    setForm(EMPTY);
    setEditing({ admin: null });
  };

  const openEdit = (a: AdminInfo) => {
    setForm({ ...EMPTY, name: a.name, email: a.email, phone: a.phone ?? "", role: a.role === "OWNER" ? "OWNER" : "ADMIN" });
    setEditing({ admin: a });
  };

  /** Akun lain milik Owner hanya bisa dikelola Owner; akses hanya bisa diubah Owner & bukan diri sendiri */
  const canEditTarget = (a: AdminInfo) => a.role !== "OWNER" || isOwner;
  const canChangeRole = (a: AdminInfo | null) =>
    isOwner && (!a || a.id !== currentUserId);

  const submit = async () => {
    if (saving || !editing) return;
    const isAdd = !editing.admin;
    const target = editing.admin;
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
      const res = await apiFetch(isAdd ? "/api/admins" : `/api/admins/${target!.id}`, {
        method: isAdd ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isAdd
            ? { name, email, phone: form.phone.trim(), password, role: form.role }
            : {
                name,
                phone: form.phone.trim(),
                ...(password ? { password } : {}),
                // Akses hanya dikirim bila benar-benar boleh & berubah
                ...(canChangeRole(target) && form.role !== (target!.role === "OWNER" ? "OWNER" : "ADMIN")
                  ? { role: form.role }
                  : {}),
              },
        ),
      });
      const body = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Menyimpan", message: body.error ?? "Coba lagi sebentar ya." });
        return;
      }
      showNotice({
        type: "success",
        title: isAdd ? "Admin Ditambahkan ✓" : "Admin Diperbarui ✓",
        message: isAdd
          ? `${name} kini punya akses ${roleLabel(form.role)} — masuk pakai email & password yang dibuat.`
          : password
            ? `Data ${name} diperbarui — akun diminta masuk ulang dengan password baru.`
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

  const removeAdmin = (a: AdminInfo) => {
    showNotice({
      type: "confirm",
      title: `Hapus Admin "${a.name}"?`,
      message: `Akses ${roleLabel(a.role)} akun ${a.email} akan dicabut permanen dan tidak bisa dipakai masuk lagi. Riwayat pesanan yang pernah dicatat tetap tersimpan.`,
      actions: [
        { label: "Batal" },
        {
          label: "Ya, Hapus",
          variant: "destructive",
          onClick: () => {
            void (async () => {
              try {
                const res = await apiFetch(`/api/admins/${a.id}`, { method: "DELETE" });
                const body = await res.json();
                if (!res.ok) {
                  showNotice({ type: "error", title: "Gagal Menghapus", message: body.error ?? "Coba lagi." });
                  return;
                }
                showNotice({ type: "success", title: "Admin Dihapus ✓", message: `Akses akun ${a.name} telah dicabut.` });
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

  const isAdd = !!editing && !editing.admin;

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="admins-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Kelola Admin"
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
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">
                    {editing ? (isAdd ? "Tambah Admin" : "Edit Admin") : "Kelola Admin"}
                  </p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    {editing
                      ? isAdd
                        ? "Buat akun admin/owner baru"
                        : form.name || "Perbarui data admin"
                      : `${admins.length} akun admin & owner terdaftar`}
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
                    <Label htmlFor="ad-name">Nama Admin</Label>
                    <div className="relative">
                      <UserPlus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                      <Input
                        id="ad-name"
                        className="border-orange-200 pl-9 focus-visible:ring-orange-400"
                        placeholder="cth: Rina Kartika"
                        value={form.name}
                        onChange={set("name")}
                        maxLength={60}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ad-email">Email (dipakai untuk masuk)</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                      <Input
                        id="ad-email"
                        type="email"
                        className={cn(
                          "border-orange-200 pl-9 focus-visible:ring-orange-400",
                          !isAdd && "cursor-not-allowed bg-neutral-50 text-neutral-400"
                        )}
                        placeholder="cth: admin2@agsi.co.id"
                        value={form.email}
                        onChange={isAdd ? set("email") : undefined}
                        readOnly={!isAdd}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ad-phone">No. HP (opsional)</Label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                      <Input
                        id="ad-phone"
                        className="border-orange-200 pl-9 focus-visible:ring-orange-400"
                        placeholder="cth: 0813-2222-3333"
                        value={form.phone}
                        onChange={set("phone")}
                        inputMode="tel"
                        maxLength={20}
                      />
                    </div>
                  </div>

                  {/* ===== PILIH AKSES (role) ===== */}
                  <div className="space-y-1.5">
                    <Label>Akses</Label>
                    {(() => {
                      const selfEdit = !isAdd && editing.admin!.id === currentUserId;
                      const locked = isAdd ? !isOwner : !canChangeRole(editing.admin);
                      return (
                        <>
                          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pilih akses">
                            {(
                              [
                                { value: "ADMIN", desc: "Kelola menu, pesanan & laporan" },
                                { value: "OWNER", desc: "Penuh — atur semua akun & toko" },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                role="radio"
                                aria-checked={form.role === opt.value}
                                disabled={locked}
                                onClick={() => setRole(opt.value)}
                                className={cn(
                                  "press-effect rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                                  form.role === opt.value
                                    ? "border-orange-600 bg-orange-50 ring-1 ring-orange-600"
                                    : "border-orange-200 bg-white hover:bg-orange-50/60"
                                )}
                              >
                                <span className="flex items-center gap-1.5 text-sm font-black text-neutral-800">
                                  {opt.value === "OWNER" && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                                  {roleLabel(opt.value)}
                                </span>
                                <span className="mt-0.5 block text-[10px] leading-snug text-neutral-400">
                                  {opt.desc}
                                </span>
                              </button>
                            ))}
                          </div>
                          {locked && (
                            <p className="text-[10px] text-neutral-400">
                              {isAdd
                                ? "Hanya Owner yang dapat menambah akun Owner."
                                : selfEdit
                                  ? "Akses akun sendiri tidak bisa diubah."
                                  : "Hanya Owner yang dapat mengubah akses akun ini."}
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="ad-pass">
                      {isAdd ? "Password" : "Password Baru (opsional)"}
                    </Label>
                    <Input
                      id="ad-pass"
                      type="password"
                      className="border-orange-200 focus-visible:ring-orange-400"
                      placeholder={isAdd ? "Min. 6 karakter" : "Kosongkan bila tidak diganti"}
                      value={form.password}
                      onChange={set("password")}
                      autoComplete="new-password"
                    />
                    <p className="text-[10px] text-neutral-400">
                      {isAdd
                        ? "Admin memakai email & password ini untuk masuk ke aplikasi."
                        : "Mengisi password akan memaksa akun ini masuk ulang di semua perangkat."}
                    </p>
                  </div>

                  {form.password ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="ad-pass2">Ulangi Password</Label>
                      <Input
                        id="ad-pass2"
                        type="password"
                        className="border-orange-200 focus-visible:ring-orange-400"
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
                          {isAdd ? (
                            <>
                              <UserPlus className="h-4 w-4" /> Tambah Admin
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
                /* ============ DAFTAR ADMIN ============ */
                <>
                  <button
                    onClick={openAdd}
                    className="press-effect flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700"
                  >
                    <UserPlus className="h-4 w-4" /> Tambah Admin
                  </button>

                  <div className="mt-3 space-y-2">
                    {loading && admins.length === 0 ? (
                      <div className="flex min-h-[160px] items-center justify-center">
                        <Loader2 className="h-7 w-7 animate-spin text-orange-400" />
                      </div>
                    ) : loadError && admins.length === 0 ? (
                      <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 text-center">
                        <p className="text-xs font-semibold text-red-500">{loadError}</p>
                        <button
                          onClick={() => void fetchList()}
                          className="press-effect rounded-full bg-orange-600 px-4 py-2 text-[11px] font-extrabold text-white hover:bg-orange-700"
                        >
                          Coba Lagi
                        </button>
                      </div>
                    ) : admins.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-6 text-center">
                        <p className="text-3xl">🛡️</p>
                        <p className="mt-2 text-xs font-semibold text-neutral-400">
                          Belum ada akun admin — tambahkan admin untuk membantu
                          mengelola menu, pesanan, & laporan toko.
                        </p>
                      </div>
                    ) : (
                      admins.map((a) => {
                        const self = a.id === currentUserId;
                        return (
                          <div
                            key={a.id}
                            className="flex items-center gap-3 rounded-2xl border border-orange-100 bg-orange-50/40 px-3.5 py-3"
                          >
                            <span
                              className={cn(
                                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-black text-white",
                                a.role === "OWNER" ? "bg-amber-600" : "bg-orange-600"
                              )}
                            >
                              {a.name.charAt(0).toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 truncate text-sm font-black text-neutral-800">
                                <span className="truncate">{a.name}</span>
                                {self && (
                                  <span className="shrink-0 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-orange-700">
                                    Anda
                                  </span>
                                )}
                              </p>
                              <p className="truncate text-[11px] text-neutral-400">{a.email}</p>
                              <p className="flex items-center gap-1 truncate text-[10px] text-neutral-400">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-bold",
                                    a.role === "OWNER"
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-orange-100 text-orange-700"
                                  )}
                                >
                                  {a.role === "OWNER" && <Crown className="h-2.5 w-2.5" />}
                                  {roleLabel(a.role)}
                                </span>
                                {a.phone ? <span>• {a.phone}</span> : null}
                                <span>• Ditambahkan {formatDateTime(a.createdAt)}</span>
                              </p>
                            </div>
                            {canEditTarget(a) ? (
                              <button
                                onClick={() => openEdit(a)}
                                aria-label={`Edit admin ${a.name}`}
                                title="Edit data / akses / reset password"
                                className="press-effect flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-orange-600 shadow-sm ring-1 ring-orange-100 hover:bg-orange-100"
                              >
                                <PenLine className="h-4 w-4" />
                              </button>
                            ) : (
                              <span
                                title="Hanya Owner yang dapat mengelola akun Owner"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-300 shadow-sm ring-1 ring-neutral-100"
                              >
                                <ShieldCheck className="h-4 w-4" />
                              </span>
                            )}
                            {!self && (
                              <button
                                onClick={() => removeAdmin(a)}
                                aria-label={`Hapus admin ${a.name}`}
                                title="Cabut akses & hapus akun admin"
                                className="press-effect flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-red-500 shadow-sm ring-1 ring-red-100 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  <p className="mt-3 text-center text-[10px] leading-relaxed text-neutral-400">
                    Admin & Owner masuk di halaman login dengan email & password-nya.
                    Owner dapat mengelola seluruh akun admin; Admin mengelola akun admin
                    biasa. Akses akun sendiri tidak bisa diubah atau dihapus.
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
