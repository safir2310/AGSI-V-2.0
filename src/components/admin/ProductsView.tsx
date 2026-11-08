"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ImagePlus, Loader2, Pencil, Plus, RefreshCw, Search, Star, Trash2, X } from "lucide-react";
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
import { SpicyDots } from "@/components/shared/StatusBadge";
import { ProductThumb } from "@/components/shared/ProductThumb";
import { refreshProducts, useProductsStore } from "@/lib/hooks";
import { useNoticeStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { CATEGORIES, formatIDR, productImageUrl, type Product } from "@/lib/types";
import { cn } from "@/lib/utils";

type FormState = {
  name: string;
  description: string;
  price: string;
  category: string;
  emoji: string;
  spicy: number;
  available: boolean;
  popular: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  price: "",
  category: CATEGORIES[0],
  emoji: "🍗",
  spicy: 1,
  available: true,
  popular: false,
};

const EMOJI_CHOICES = ["🍗", "🧀", "🥚", "🍚", "🥩", "🍖", "🍟", "🧈", "🧊", "🍊", "🥤", "🌶️"];

/** Kompres & perkecil gambar di sisi klien sebelum dikirim (maks 1000px, JPEG) */
async function fileToResizedDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Gagal membaca file."));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("File bukan gambar yang valid."));
    i.src = dataUrl;
  });
  const maxDim = 1000;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  // Sudah kecil & proporsional? pakai apa adanya
  if (scale >= 1 && dataUrl.length < 250_000) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function ProductsView() {
  const prefersReduced = useReducedMotion();
  const { products, loading, load } = useProductsStore();
  const showNotice = useNoticeStore((s) => s.show);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // Foto menu: undefined = tidak diubah, string = data URL baru, null = hapus foto
  const [imageData, setImageData] = useState<string | null | undefined>(undefined);
  const [imageBusy, setImageBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          p.name.toLowerCase().includes(query.toLowerCase().trim()) ||
          p.category.toLowerCase().includes(query.toLowerCase().trim())
      ),
    [products, query]
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setImageData(undefined);
    setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description,
      price: String(p.price),
      category: p.category,
      emoji: p.emoji,
      spicy: p.spicy,
      available: p.available,
      popular: p.popular,
    });
    setImageData(undefined);
    setDialogOpen(true);
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showNotice({ type: "error", title: "File Bukan Gambar", message: "Pilih file gambar (JPG, PNG, WEBP, atau GIF)." });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showNotice({ type: "error", title: "Gambar Terlalu Besar", message: "Maksimal 8 MB — akan otomatis diperkecil kok." });
      return;
    }
    setImageBusy(true);
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setImageData(dataUrl);
    } catch {
      showNotice({ type: "error", title: "Gagal Memproses Gambar", message: "Coba file gambar yang lain ya." });
    } finally {
      setImageBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /** URL preview: foto baru > foto lama > tidak ada */
  const previewSrc =
    imageData !== undefined && imageData !== null
      ? imageData
      : imageData === null
        ? null
        : editing?.hasImage
          ? productImageUrl(editing)
          : null;

  const save = async () => {
    if (!form.name.trim() || !form.price) {
      showNotice({ type: "error", title: "Data Belum Lengkap", message: "Nama dan harga menu wajib diisi." });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        price: Number(form.price),
        category: form.category,
        emoji: form.emoji,
        spicy: form.spicy,
        available: form.available,
        popular: form.popular,
        // undefined = biarkan foto lama, null = hapus, string = ganti
        ...(imageData !== undefined ? { imageData } : {}),
      };
      const res = await apiFetch(editing ? `/api/products/${editing.id}` : "/api/products", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Menyimpan", message: data.error ?? "Coba lagi." });
        return;
      }
      await refreshProducts();
      setDialogOpen(false);
      showNotice({
        type: "success",
        title: editing ? "Menu Diperbarui ✓" : "Menu Baru Ditambahkan ✓",
        message: `${payload.name} berhasil disimpan.`,
      });
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server." });
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailable = async (p: Product) => {
    await apiFetch(`/api/products/${p.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: !p.available }),
    });
    await refreshProducts();
  };

  const remove = (p: Product) => {
    showNotice({
      type: "confirm",
      title: `Hapus "${p.name}"?`,
      message: "Menu akan dihapus permanen. Jika sudah pernah dipesan, sebaiknya nonaktifkan saja.",
      actions: [
        { label: "Batal" },
        {
          label: "Ya, Hapus",
          variant: "destructive",
          onClick: async () => {
            const res = await apiFetch(`/api/products/${p.id}`, { method: "DELETE" });
            const data = await res.json().catch(() => ({}));
            await refreshProducts();
            if (!res.ok) {
              showNotice({ type: "error", title: "Tidak Bisa Dihapus", message: data.error ?? "Terjadi kesalahan." });
            } else {
              showNotice({ type: "success", title: "Menu Dihapus", message: `${p.name} sudah dihapus dari daftar.` });
            }
          },
        },
      ],
    });
  };

  return (
    <div className="px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black text-neutral-900">Produk & Menu 📦</h1>
          <p className="text-xs text-neutral-400">
            {products.filter((p) => p.available).length} aktif dari {products.length} menu
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => load(true)}
            aria-label="Muat ulang produk"
            className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-white text-orange-600 shadow-sm hover:bg-orange-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <Button
            onClick={openCreate}
            className="press-effect h-9 rounded-full bg-orange-600 px-4 text-xs font-bold hover:bg-orange-700"
          >
            <Plus className="h-4 w-4" /> Menu Baru
          </Button>
        </div>
      </header>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
        <Input
          placeholder="Cari menu / kategori…"
          className="rounded-xl border-orange-200 pl-9 focus-visible:ring-orange-400"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="space-y-2.5">
        <AnimatePresence mode="popLayout">
          {filtered.map((p) => (
            <motion.div
              layout={!prefersReduced}
              key={p.id}
              initial={prefersReduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReduced ? undefined : { opacity: 0, scale: 0.97 }}
              className={cn(
                "card-lift flex items-center gap-3 rounded-2xl border border-orange-100 bg-white p-3 shadow-sm",
                !p.available && "opacity-70"
              )}
            >
              <ProductThumb
                product={p}
                className="h-14 w-14 text-2xl"
                rounded="rounded-xl"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="line-clamp-1 text-sm font-bold text-neutral-800">{p.name}</p>
                  {p.popular && (
                    <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-orange-700">
                      <Star className="h-2.5 w-2.5 fill-orange-500 text-orange-500" /> Populer
                    </span>
                  )}
                </div>
                <p className="line-clamp-1 text-[11px] text-neutral-400">{p.description}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-sm font-black text-orange-600">{formatIDR(p.price)}</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[9px] font-bold text-neutral-500">
                    {p.category}
                  </span>
                  <SpicyDots level={p.spicy} />
                </div>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="flex cursor-pointer items-center gap-1" title={p.available ? "Nonaktifkan (habis)" : "Aktifkan"}>
                    <Switch checked={p.available} onCheckedChange={() => toggleAvailable(p)} />
                  </label>
                  <button
                    aria-label={`Edit ${p.name}`}
                    onClick={() => openEdit(p)}
                    className="press-effect flex h-8 w-8 items-center justify-center rounded-full bg-orange-50 text-orange-600 hover:bg-orange-100"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    aria-label={`Hapus ${p.name}`}
                    onClick={() => remove(p)}
                    className="press-effect flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-500 hover:bg-red-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <span
                  className={cn(
                    "text-[9px] font-black uppercase tracking-wide",
                    p.available ? "text-green-600" : "text-neutral-400"
                  )}
                >
                  {p.available ? "Tersedia" : "Habis"}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-10 text-center text-sm text-neutral-400">
            Tidak ada menu yang cocok.
          </div>
        )}
      </div>

      {/* Dialog tambah/edit */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl border-orange-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-orange-700">
              {editing ? `Edit: ${editing.name}` : "Tambah Menu Baru"}
            </DialogTitle>
            <DialogDescription>
              Isi detail menu di bawah ini. Perubahan langsung tampil di aplikasi pelanggan.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="p-name">Nama Menu *</Label>
              <Input
                id="p-name"
                placeholder="cth: Geprek Mozarella Lava"
                className="border-orange-200 focus-visible:ring-orange-400"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-desc">Deskripsi</Label>
              <Textarea
                id="p-desc"
                placeholder="Deskripsi singkat menu…"
                className="min-h-[60px] border-orange-200 focus-visible:ring-orange-400"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="p-price">Harga (Rp) *</Label>
                <Input
                  id="p-price"
                  type="number"
                  min={0}
                  placeholder="18000"
                  className="border-orange-200 focus-visible:ring-orange-400"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Kategori</Label>
                <div className="scrollbar-slim flex gap-1.5 overflow-x-auto pb-1">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, category: c })}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition",
                        form.category === c
                          ? "bg-orange-600 text-white shadow"
                          : "bg-orange-50 text-orange-700"
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Foto Menu</Label>
              <div className="flex items-center gap-3">
                {/* Preview */}
                <div className="relative">
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-orange-100 bg-orange-50 text-4xl">
                    {previewSrc ? (
                       
                      <img src={previewSrc} alt="Pratinjau foto menu" className="h-full w-full object-cover" />
                    ) : (
                      <span>{form.emoji}</span>
                    )}
                  </div>
                  {previewSrc && (
                    <button
                      type="button"
                      aria-label="Hapus foto"
                      onClick={() => setImageData(null)}
                      className="press-effect absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow-md hover:bg-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => void pickImage(e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={imageBusy}
                    onClick={() => fileInputRef.current?.click()}
                    className="press-effect w-full rounded-xl border-orange-200 text-orange-700 hover:bg-orange-50"
                  >
                    {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    {previewSrc ? "Ganti Foto" : "Upload Foto"}
                  </Button>
                  <p className="mt-1 text-[10px] leading-snug text-neutral-400">
                    JPG/PNG/WEBP, otomatis diperkecil. Tanpa foto, memakai ikon emoji di bawah.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Ikon Menu (cadangan tanpa foto)</Label>
              <div className="flex flex-wrap gap-1.5">
                {EMOJI_CHOICES.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setForm({ ...form, emoji: e })}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl border text-xl transition",
                      form.emoji === e
                        ? "border-orange-500 bg-orange-50 ring-2 ring-orange-300"
                        : "border-neutral-200 hover:border-orange-300"
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Level Pedas: {form.spicy === 0 ? "Tidak pedas" : `${form.spicy}/5`}</Label>
              <div className="flex gap-1.5">
                {[0, 1, 2, 3, 4, 5].map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setForm({ ...form, spicy: lv })}
                    className={cn(
                      "press-effect h-9 flex-1 rounded-xl text-xs font-black transition",
                      form.spicy === lv
                        ? "bg-orange-600 text-white shadow"
                        : "bg-orange-50 text-orange-700"
                    )}
                  >
                    {lv}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-orange-100 bg-orange-50/50 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-neutral-700">Tersedia dijual</p>
                <p className="text-[11px] text-neutral-400">Matikan jika menu sedang habis</p>
              </div>
              <Switch checked={form.available} onCheckedChange={(v) => setForm({ ...form, available: v })} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-orange-100 bg-orange-50/50 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-neutral-700">Tandai Populer</p>
                <p className="text-[11px] text-neutral-400">Muncul di beranda pelanggan</p>
              </div>
              <Switch checked={form.popular} onCheckedChange={(v) => setForm({ ...form, popular: v })} />
            </div>
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
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Simpan Perubahan" : "Tambah Menu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
