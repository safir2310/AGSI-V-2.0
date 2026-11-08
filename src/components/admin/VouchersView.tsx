"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarClock,
  Check,
  Copy,
  Loader2,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  Ticket,
  TicketPercent,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { refreshAdminVouchers, useAdminVouchersStore } from "@/lib/hooks";
import { useNoticeStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { formatIDR, formatVoucherValue, type VoucherAdminInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

type FormState = {
  code: string;
  title: string;
  description: string;
  type: "PERCENT" | "FIXED";
  value: string;
  maxDiscount: string;
  minPurchase: string;
  quota: string;
  expiresAt: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  code: "",
  title: "",
  description: "",
  type: "PERCENT",
  value: "10",
  maxDiscount: "",
  minPurchase: "0",
  quota: "1",
  expiresAt: "",
  isActive: true,
};

/** Generator kode acak, cth: AGSI-7K2Q9X */
function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const arr = new Uint32Array(6);
  crypto.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) out += chars[arr[i] % chars.length];
  return `AGSI-${out}`;
}

/** ISO string → nilai input datetime-local */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isExpired(v: VoucherAdminInfo): boolean {
  return !!v.expiresAt && new Date(v.expiresAt).getTime() < Date.now();
}

function voucherStatus(v: VoucherAdminInfo): { label: string; cls: string } {
  if (!v.isActive) return { label: "Nonaktif", cls: "bg-neutral-100 text-neutral-500" };
  if (isExpired(v)) return { label: "Kedaluwarsa", cls: "bg-red-50 text-red-600" };
  if (v.usedCount >= v.quota) return { label: "Kuota habis", cls: "bg-amber-50 text-amber-700" };
  return { label: "Aktif", cls: "bg-green-50 text-green-600" };
}

export function VouchersView() {
  const prefersReduced = useReducedMotion();
  const { vouchers, loading, load } = useAdminVouchersStore();
  const showNotice = useNoticeStore((s) => s.show);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VoucherAdminInfo | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    load(true);
  }, [load]);

  const stats = useMemo(() => {
    const active = vouchers.filter((v) => v.isActive && !isExpired(v) && v.usedCount < v.quota).length;
    const used = vouchers.reduce((sum, v) => sum + v.usedCount, 0);
    return { total: vouchers.length, active, used };
  }, [vouchers]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, code: randomCode() });
    setDialogOpen(true);
  };

  const openEdit = (v: VoucherAdminInfo) => {
    setEditing(v);
    setForm({
      code: v.code,
      title: v.title,
      description: v.description ?? "",
      type: v.type,
      value: String(v.value),
      maxDiscount: v.maxDiscount != null ? String(v.maxDiscount) : "",
      minPurchase: String(v.minPurchase),
      quota: String(v.quota),
      expiresAt: isoToLocalInput(v.expiresAt),
      isActive: v.isActive,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    const code = form.code.trim().toUpperCase();
    if (!code) {
      showNotice({ type: "error", title: "Kode Kosong", message: "Isi kode voucher dulu ya." });
      return;
    }
    if (form.title.trim().length < 3) {
      showNotice({ type: "error", title: "Judul Belum Lengkap", message: "Judul voucher minimal 3 karakter." });
      return;
    }
    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) {
      showNotice({ type: "error", title: "Nilai Tidak Valid", message: "Isi nilai diskon yang benar." });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code,
        title: form.title.trim(),
        description: form.description.trim() || null,
        type: form.type,
        value,
        maxDiscount: form.type === "PERCENT" && form.maxDiscount ? Number(form.maxDiscount) : null,
        minPurchase: Number(form.minPurchase) || 0,
        quota: Math.max(1, Number(form.quota) || 1),
        expiresAt: form.expiresAt || null,
        isActive: form.isActive,
      };
      const res = await apiFetch(editing ? `/api/vouchers/${editing.id}` : "/api/vouchers", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Menyimpan", message: data.error ?? "Coba lagi." });
        return;
      }
      await refreshAdminVouchers();
      setDialogOpen(false);
      showNotice({
        type: "success",
        mascot: true,
        title: editing ? "Voucher Diperbarui ✓" : "Voucher Baru Aktif ✓",
        message: `Kode ${code} siap dipakai pelanggan di keranjang.`,
      });
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server." });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (v: VoucherAdminInfo) => {
    await apiFetch(`/api/vouchers/${v.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !v.isActive }),
    });
    await refreshAdminVouchers();
  };

  const remove = (v: VoucherAdminInfo) => {
    showNotice({
      type: "confirm",
      title: `Hapus voucher ${v.code}?`,
      message: "Voucher akan dihapus permanen. Pesanan lama tetap menyimpan catatan potongannya.",
      actions: [
        { label: "Batal" },
        {
          label: "Ya, Hapus",
          variant: "destructive",
          onClick: async () => {
            const res = await apiFetch(`/api/vouchers/${v.id}`, { method: "DELETE" });
            const data = await res.json().catch(() => ({}));
            await refreshAdminVouchers();
            if (!res.ok) {
              showNotice({ type: "error", title: "Tidak Bisa Dihapus", message: data.error ?? "Terjadi kesalahan." });
            } else {
              showNotice({ type: "success", title: "Voucher Dihapus", message: `Kode ${v.code} sudah dihapus.` });
            }
          },
        },
      ],
    });
  };

  const copyCode = async (code: string) => {
    const ok = await copyText(code);
    if (ok) {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    }
  };

  return (
    <div className="px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black text-neutral-900">Voucher & Promo 🎟️</h1>
          <p className="text-xs text-neutral-400">
            {stats.active} aktif dari {stats.total} voucher • terpakai {stats.used}x
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load(true)}
            aria-label="Muat ulang voucher"
            className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-white text-orange-600 shadow-sm hover:bg-orange-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <Button
            onClick={openCreate}
            className="press-effect h-9 rounded-full bg-orange-600 px-4 text-xs font-bold hover:bg-orange-700"
          >
            <Plus className="h-4 w-4" /> Voucher Baru
          </Button>
        </div>
      </header>

      {/* Penjelasan aturan singkat */}
      <div className="mb-3 flex items-start gap-2 rounded-2xl border border-orange-100 bg-orange-50/60 p-3 text-[11px] leading-relaxed text-orange-900">
        <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
        <span>
          Voucher tampil di halaman pelanggan dan ditukar lewat <strong>keranjang</strong>. Aturan{" "}
          <strong>sekali pakai</strong>: satu akun hanya bisa menukar kode yang sama sekali, dan kuota
          total membatasi jumlah pemakaian keseluruhan.
        </span>
      </div>

      <div className="space-y-2.5">
        <AnimatePresence mode="popLayout">
          {vouchers.map((v) => {
            const status = voucherStatus(v);
            const usable = status.label === "Aktif";
            const progress = v.quota > 0 ? Math.min(100, Math.round((v.usedCount / v.quota) * 100)) : 0;
            return (
              <motion.div
                layout={!prefersReduced}
                key={v.id}
                initial={prefersReduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReduced ? undefined : { opacity: 0, scale: 0.97 }}
                className={cn(
                  "card-lift rounded-2xl border border-orange-100 bg-white p-3.5 shadow-sm",
                  !usable && "opacity-80"
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Kiri: kupon */}
                  <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 text-orange-700">
                    {v.type === "PERCENT" ? (
                      <TicketPercent className="h-5 w-5" />
                    ) : (
                      <Wallet className="h-5 w-5" />
                    )}
                    <span className="mt-0.5 text-[11px] font-black">{formatVoucherValue(v)}</span>
                  </div>

                  {/* Tengah: info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => void copyCode(v.code)}
                        title="Klik untuk menyalin kode"
                        className="press-effect group flex items-center gap-1 rounded-lg bg-neutral-900 px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider text-white"
                      >
                        {v.code}
                        {copiedCode === v.code ? (
                          <Check className="h-3 w-3 text-green-400" />
                        ) : (
                          <Copy className="h-3 w-3 text-neutral-400 transition group-hover:text-white" />
                        )}
                      </button>
                      <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-black uppercase", status.cls)}>
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-sm font-bold text-neutral-800">{v.title}</p>
                    <p className="line-clamp-1 text-[11px] text-neutral-400">{v.description ?? "—"}</p>

                    {v.ownerOnly && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
                        Pribadi — hasil tukar poin member
                      </span>
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] font-semibold text-neutral-500">
                      <span>Min. {formatIDR(v.minPurchase)}</span>
                      {v.type === "PERCENT" && v.maxDiscount != null && (
                        <span>Maks. potong {formatIDR(v.maxDiscount)}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        {v.expiresAt
                          ? new Date(v.expiresAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
                          : "Tanpa batas waktu"}
                      </span>
                    </div>

                    {/* Kuota */}
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[10px] font-bold">
                        <span className="text-neutral-500">
                          Terpakai {v.usedCount} dari {v.quota}x
                          {v.quota === 1 && <span className="ml-1 text-orange-600">(sekali pakai)</span>}
                        </span>
                        <span className="text-neutral-400">sisa {Math.max(0, v.quota - v.usedCount)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-orange-100">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            progress >= 100 ? "bg-neutral-400" : progress >= 60 ? "bg-amber-500" : "bg-orange-500"
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Kanan: aksi */}
                  <div className="flex shrink-0 flex-col items-center gap-1.5">
                    <label className="flex cursor-pointer items-center" title={v.isActive ? "Nonaktifkan" : "Aktifkan"}>
                      <Switch checked={v.isActive} onCheckedChange={() => toggleActive(v)} />
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        aria-label={`Edit ${v.code}`}
                        onClick={() => openEdit(v)}
                        className="press-effect flex h-8 w-8 items-center justify-center rounded-full bg-orange-50 text-orange-600 hover:bg-orange-100"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label={`Hapus ${v.code}`}
                        onClick={() => remove(v)}
                        className="press-effect flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-500 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {vouchers.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-10 text-center">
            <Ticket className="h-8 w-8 text-orange-200" />
            <p className="text-sm font-semibold text-neutral-400">
              Belum ada voucher — buat voucher pertamamu!
            </p>
          </div>
        )}
        {loading && vouchers.length === 0 && (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-orange-100 bg-white p-10 text-sm text-neutral-400 shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Memuat voucher…
          </div>
        )}
      </div>

      {/* Dialog tambah/edit voucher */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl border-orange-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-orange-700">
              {editing ? `Edit Voucher ${editing.code}` : "Tambah Voucher Baru"}
            </DialogTitle>
            <DialogDescription>
              Voucher aktif langsung tampil di halaman pelanggan dan bisa ditukar di keranjang.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            {/* Kode */}
            <div className="grid gap-1.5">
              <Label htmlFor="v-code">Kode Voucher *</Label>
              <div className="flex gap-2">
                <Input
                  id="v-code"
                  placeholder="cth: GEPREK10"
                  className="flex-1 border-orange-200 font-mono font-bold uppercase tracking-wider focus-visible:ring-orange-400"
                  value={form.code}
                  maxLength={24}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setForm({ ...form, code: randomCode() })}
                  className="press-effect rounded-xl border-orange-200 px-3 text-orange-700 hover:bg-orange-50"
                  title="Buat kode acak"
                >
                  🎲
                </Button>
              </div>
              <p className="text-[10px] text-neutral-400">Huruf besar, angka, tanda hubung. 3-24 karakter.</p>
            </div>

            {/* Judul & deskripsi */}
            <div className="grid gap-1.5">
              <Label htmlFor="v-title">Judul *</Label>
              <Input
                id="v-title"
                placeholder="cth: Diskon 10% Semua Menu"
                className="border-orange-200 focus-visible:ring-orange-400"
                value={form.title}
                maxLength={60}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="v-desc">Deskripsi</Label>
              <Textarea
                id="v-desc"
                placeholder="Syarat singkat yang tampil di kartu voucher pelanggan…"
                className="min-h-[56px] border-orange-200 focus-visible:ring-orange-400"
                value={form.description}
                maxLength={200}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            {/* Jenis diskon */}
            <div className="grid gap-1.5">
              <Label>Jenis Diskon</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: "PERCENT" })}
                  className={cn(
                    "press-effect flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition-all",
                    form.type === "PERCENT"
                      ? "border-orange-500 bg-orange-50 text-orange-700 ring-2 ring-orange-200"
                      : "border-neutral-200 text-neutral-500 hover:border-orange-200"
                  )}
                >
                  <Percent className="h-4 w-4" /> Persen
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: "FIXED" })}
                  className={cn(
                    "press-effect flex items-center justify-center gap-1.5 rounded-xl border p-2.5 text-xs font-bold transition-all",
                    form.type === "FIXED"
                      ? "border-orange-500 bg-orange-50 text-orange-700 ring-2 ring-orange-200"
                      : "border-neutral-200 text-neutral-500 hover:border-orange-200"
                  )}
                >
                  <Wallet className="h-4 w-4" /> Nominal Rp
                </button>
              </div>
            </div>

            {/* Nilai + batas */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="v-value">
                  {form.type === "PERCENT" ? "Besar Diskon (%) *" : "Nominal Potongan (Rp) *"}
                </Label>
                <Input
                  id="v-value"
                  type="number"
                  min={form.type === "PERCENT" ? 1 : 100}
                  max={form.type === "PERCENT" ? 100 : undefined}
                  placeholder={form.type === "PERCENT" ? "10" : "5000"}
                  className="border-orange-200 focus-visible:ring-orange-400"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="v-min">Min. Belanja (Rp)</Label>
                <Input
                  id="v-min"
                  type="number"
                  min={0}
                  placeholder="0"
                  className="border-orange-200 focus-visible:ring-orange-400"
                  value={form.minPurchase}
                  onChange={(e) => setForm({ ...form, minPurchase: e.target.value })}
                />
              </div>
            </div>

            {form.type === "PERCENT" && (
              <div className="grid gap-1.5">
                <Label htmlFor="v-max">Batas Potongan Maksimal (Rp) — opsional</Label>
                <Input
                  id="v-max"
                  type="number"
                  min={100}
                  placeholder="cth: 10000 (kosongkan = tanpa batas)"
                  className="border-orange-200 focus-visible:ring-orange-400"
                  value={form.maxDiscount}
                  onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
                />
                <p className="text-[10px] text-neutral-400">
                  Contoh: diskon 10% dari belanja Rp 200.000 dibatasi jadi Rp 10.000.
                </p>
              </div>
            )}

            {/* Kuota & masa aktif */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="v-quota">Kuota Pemakaian *</Label>
                <Input
                  id="v-quota"
                  type="number"
                  min={1}
                  className="border-orange-200 focus-visible:ring-orange-400"
                  value={form.quota}
                  onChange={(e) => setForm({ ...form, quota: e.target.value })}
                />
                <p className="text-[10px] text-neutral-400">
                  {Number(form.quota) <= 1
                    ? "1 = benar-benar sekali pakai"
                    : "Setiap akun tetap hanya 1x per kode"}
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="v-exp">Berlaku Sampai</Label>
                <Input
                  id="v-exp"
                  type="datetime-local"
                  className="border-orange-200 focus-visible:ring-orange-400"
                  value={form.expiresAt}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                />
                <p className="text-[10px] text-neutral-400">Kosongkan = tanpa batas waktu</p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-orange-100 bg-orange-50/50 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-neutral-700">Voucher Aktif</p>
                <p className="text-[11px] text-neutral-400">Tampil di halaman pelanggan</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
            </div>

            {editing && editing.usedCount > 0 && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-2.5 text-[11px] font-semibold leading-relaxed text-amber-800 ring-1 ring-amber-200">
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Voucher ini sudah dipakai {editing.usedCount}x. Perubahan nilai hanya berlaku untuk
                  penukaran berikutnya — pesanan lama tidak berubah.
                </span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">
              Batal
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="press-effect rounded-xl bg-orange-600 font-bold hover:bg-orange-700"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Simpan Perubahan" : "Buat Voucher"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
