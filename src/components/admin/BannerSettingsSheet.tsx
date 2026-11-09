"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ImagePlus,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  Minus,
  PanelTop,
  Plus,
  Save,
  Tag,
  Ticket,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { refreshSettings, useSettingsStore } from "@/lib/hooks";
import { useNoticeStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export type BannerSettingsSheetProps = {
  open: boolean;
  onClose: () => void;
};

const MAX_TITLE = 60;
const MAX_TEXT = 160;
const MAX_STRIP_BADGE = 24;
const MAX_STRIP_TITLE = 80;
const MAX_STRIP_TEXT = 120;
const MAX_HERO_BADGE = 24;
const MAX_HERO_TITLE = 80;
const MAX_HERO_TEXT = 120;

/** Kompres & perkecil gambar banner di sisi klien (maks 1200px, JPEG) */
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
  const maxDim = 1200;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale >= 1 && dataUrl.length < 250_000) return dataUrl;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Validasi + kompres gambar di luar komponen; null = gagal (notice sudah ditampilkan). */
async function processImageFile(file: File | undefined): Promise<string | null> {
  if (!file) return null;
  const notice = useNoticeStore.getState().show;
  if (!file.type.startsWith("image/")) {
    notice({ type: "error", title: "File Bukan Gambar", message: "Pilih file gambar (JPG, PNG, WEBP, atau GIF)." });
    return null;
  }
  if (file.size > 8 * 1024 * 1024) {
    notice({ type: "error", title: "Gambar Terlalu Besar", message: "Maksimal 8 MB — akan otomatis diperkecil kok." });
    return null;
  }
  try {
    return await fileToResizedDataUrl(file);
  } catch {
    notice({ type: "error", title: "Gagal Memproses Gambar", message: "Coba file gambar yang lain ya." });
    return null;
  }
}

/**
 * Sheet "Banner & Promo" (khusus Admin/Owner, dibuka dari Profil).
 *
 * Isi:
 *  1. Popup banner Beranda — saklar AKTIF/NONAKTIF, upload gambar (otomatis
 *     dikompres), judul & pesan singkat.
 *  2. Strip "Promo Hari Ini" di Beranda — 3 baris teks.
 *  3. Hero banner halaman Menu — saklar, gambar latar, badge, judul, teks.
 *
 * Tersimpan via PUT /api/settings (divalidasi ulang server-side).
 * Popup tampil 1x per sesi pelanggan untuk tiap versi banner; menyimpan
 * konten baru menaikkan versi → popup tampil lagi untuk semua pelanggan.
 */
export function BannerSettingsSheet({ open, onClose }: BannerSettingsSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  // ===== Strip "Promo Hari Ini" (baris oranye di Beranda) =====
  const [promoEnabled, setPromoEnabled] = useState(true);
  const [promoBadge, setPromoBadge] = useState("");
  const [promoTitle, setPromoTitle] = useState("");
  const [promoText, setPromoText] = useState("");
  // ===== Hero banner halaman Menu =====
  const [heroEnabled, setHeroEnabled] = useState(true);
  const [heroBadge, setHeroBadge] = useState("");
  const [heroTitle, setHeroTitle] = useState("");
  const [heroText, setHeroText] = useState("");
  const [heroImageData, setHeroImageData] = useState<string | null | undefined>(undefined);
  const [heroImageBusy, setHeroImageBusy] = useState(false);
  const heroFileInputRef = useRef<HTMLInputElement>(null);
  const [heroServerHasImage, setHeroServerHasImage] = useState(false);
  const [heroServerVersion, setHeroServerVersion] = useState<string | null>(null);
  // ===== Slide voucher di carousel Menu =====
  const [vpEnabled, setVpEnabled] = useState(true);
  const [vpMax, setVpMax] = useState(3);
  // undefined = tidak diubah, string = data URL baru, null = hapus gambar
  const [imageData, setImageData] = useState<string | null | undefined>(undefined);
  const [imageBusy, setImageBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** apakah server saat ini punya gambar banner (sebelum perubahan lokal) */
  const [serverHasImage, setServerHasImage] = useState(false);
  /** versi banner saat sheet dibuka — dipakai sbg cache-buster URL pratinjau (stabil) */
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  // Buka sheet → tarik nilai terbaru dari server → isi form
  const fetchCurrent = useCallback(async () => {
    setLoading(true);
    try {
      await refreshSettings();
      const b = useSettingsStore.getState().banner;
      setEnabled(b.bannerEnabled);
      setTitle(b.bannerTitle ?? "");
      setText(b.bannerText ?? "");
      setServerHasImage(b.bannerHasImage);
      setServerVersion(b.bannerVersion);
      setImageData(undefined);
      // Strip promo — nilai tersimpan atau default bawaan
      const p = useSettingsStore.getState().promo;
      setPromoEnabled(p.promoStripEnabled);
      setPromoBadge(p.promoStripBadge);
      setPromoTitle(p.promoStripTitle);
      setPromoText(p.promoStripText);
      // Hero banner menu — nilai tersimpan atau default bawaan
      const h = useSettingsStore.getState().menuHero;
      setHeroEnabled(h.menuHeroEnabled);
      setHeroBadge(h.menuHeroBadge);
      setHeroTitle(h.menuHeroTitle);
      setHeroText(h.menuHeroText);
      setHeroServerHasImage(h.menuHeroHasImage);
      setHeroServerVersion(h.menuHeroVersion);
      setHeroImageData(undefined);
      // Slide voucher carousel menu
      const mp = useSettingsStore.getState().menuPromo;
      setVpEnabled(mp.menuPromoVouchersEnabled);
      setVpMax(mp.menuPromoVouchersMax);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRef = useRef(fetchCurrent);
  useEffect(() => {
    fetchRef.current = fetchCurrent;
  });
  useEffect(() => {
    if (open) void fetchRef.current();
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

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setImageBusy(true);
    const dataUrl = await processImageFile(file);
    setImageBusy(false);
    if (dataUrl) setImageData(dataUrl);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const pickHeroImage = async (file: File | undefined) => {
    if (!file) return;
    setHeroImageBusy(true);
    const dataUrl = await processImageFile(file);
    setHeroImageBusy(false);
    if (dataUrl) setHeroImageData(dataUrl);
    if (heroFileInputRef.current) heroFileInputRef.current.value = "";
  };

  /** URL pratinjau: gambar baru > gambar server > kosong */
  const previewSrc =
    imageData !== undefined && imageData !== null
      ? imageData
      : imageData === null
        ? null
        : serverHasImage
          ? `/api/settings/banner/image?v=${encodeURIComponent(serverVersion ?? "1")}`
          : null;

  /** URL pratinjau gambar hero: gambar baru > gambar server > kosong */
  const heroPreviewSrc =
    heroImageData !== undefined && heroImageData !== null
      ? heroImageData
      : heroImageData === null
        ? null
        : heroServerHasImage
          ? `/api/settings/menu-hero/image?v=${encodeURIComponent(heroServerVersion ?? "1")}`
          : null;

  const save = async () => {
    if (saving) return;
    if (enabled && previewSrc === null && !title.trim()) {
      showNotice({
        type: "error",
        title: "Banner Belum Siap",
        message: "Unggah gambar banner atau isi judul dulu — popup butuh minimal satu konten.",
      });
      return;
    }
    if (promoEnabled && !promoBadge.trim() && !promoTitle.trim() && !promoText.trim()) {
      showNotice({
        type: "error",
        title: "Strip Promo Belum Siap",
        message: "Isi minimal satu baris strip promo, atau matikan saklar Strip Promonya.",
      });
      return;
    }
    if (
      heroEnabled &&
      heroPreviewSrc === null &&
      !heroBadge.trim() &&
      !heroTitle.trim() &&
      !heroText.trim()
    ) {
      showNotice({
        type: "error",
        title: "Hero Menu Belum Siap",
        message: "Isi minimal satu baris hero, unggah gambar latar, atau matikan saklarnya.",
      });
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        bannerEnabled: enabled,
        bannerTitle: title.trim() || null,
        bannerText: text.trim() || null,
        bannerTouch: true, // konten berubah → naikkan versi agar popup tampil lagi
        promoStripEnabled: promoEnabled,
        promoStripBadge: promoBadge.trim(),
        promoStripTitle: promoTitle.trim(),
        promoStripText: promoText.trim(),
        menuHeroEnabled: heroEnabled,
        menuHeroBadge: heroBadge.trim(),
        menuHeroTitle: heroTitle.trim(),
        menuHeroText: heroText.trim(),
        menuHeroTouch: true,
        menuPromoVouchersEnabled: vpEnabled,
        menuPromoVouchersMax: vpMax,
      };
      if (imageData !== undefined) {
        if (imageData === null) body.bannerImageRemove = true;
        else body.bannerImageData = imageData;
      }
      if (heroImageData !== undefined) {
        if (heroImageData === null) body.menuHeroImageRemove = true;
        else body.menuHeroImageData = heroImageData;
      }

      const res = await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Menyimpan", message: data.error ?? "Coba lagi sebentar ya." });
        return;
      }

      // Segarkan store global (saklar lain ikut aman)
      await refreshSettings();
      setServerHasImage(useSettingsStore.getState().banner.bannerHasImage);
      setHeroServerHasImage(useSettingsStore.getState().menuHero.menuHeroHasImage);
      setHeroServerVersion(useSettingsStore.getState().menuHero.menuHeroVersion);
      setImageData(undefined);
      setHeroImageData(undefined);
      showNotice({
        type: "success",
        autoCloseMs: 3600,
        title: "Banner & Promo Disimpan ✓",
        message:
          "Perubahan popup banner, strip promo, hero Menu, dan slide voucher langsung tampil di aplikasi pelanggan.",
      });
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server." });
    } finally {
      setSaving(false);
    }
  };

  const hasAnyContent = previewSrc !== null || !!title.trim();
  const active = enabled && hasAnyContent;

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="banner-settings-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Banner & Promo Beranda"
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
                  <Megaphone className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Banner &amp; Promo</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Popup Beranda, strip promo, hero Menu &amp; slide voucher pelanggan
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
              {loading ? (
                <div className="flex min-h-[220px] items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-orange-400" />
                </div>
              ) : (
                <>
                  {/* ===== SAKLAR AKTIF/NONAKTIF ===== */}
                  <div
                    className={cn(
                      "rounded-2xl border p-4 transition-colors",
                      enabled ? "border-orange-200 bg-orange-50/60" : "border-neutral-200 bg-neutral-50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                          enabled ? "bg-orange-600 text-white" : "bg-neutral-200 text-neutral-400"
                        )}
                      >
                        <Megaphone className="h-5.5 w-5.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-neutral-800">Popup Banner</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">
                          Tampilkan popup promo saat pelanggan membuka halaman Beranda.
                        </p>
                        <span
                          className={cn(
                            "mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide",
                            active
                              ? "bg-green-100 text-green-700"
                              : "bg-neutral-200 text-neutral-500"
                          )}
                        >
                          {active ? "📣 Banner aktif" : enabled ? "Belum ada konten" : "Banner nonaktif"}
                        </span>
                      </div>
                      <Switch
                        checked={enabled}
                        onCheckedChange={setEnabled}
                        aria-label={`${enabled ? "Nonaktifkan" : "Aktifkan"} popup banner`}
                        className="mt-0.5 h-6 w-11 data-[state=checked]:bg-orange-600 data-[state=unchecked]:bg-neutral-300"
                      />
                    </div>
                  </div>

                  {/* ===== PRATINJAU POPUP ===== */}
                  <p className="mb-2 mt-4 text-[11px] font-black uppercase tracking-widest text-neutral-400">
                    Pratinjau popup
                  </p>
                  <div className="overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm">
                    {previewSrc ? (
                      <img src={previewSrc} alt="Pratinjau banner" className="aspect-video w-full object-cover" />
                    ) : (
                      <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-orange-50 to-orange-100/60 text-neutral-400">
                        <ImageIcon className="h-7 w-7" />
                        <span className="text-[11px] font-semibold">Belum ada gambar banner</span>
                      </div>
                    )}
                    {(title.trim() || text.trim()) && (
                      <div className="border-t border-orange-50 px-4 py-3 text-center">
                        {title.trim() && (
                          <p className="text-sm font-black text-neutral-900">{title.trim()}</p>
                        )}
                        {text.trim() && (
                          <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">{text.trim()}</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ===== UPLOAD GAMBAR ===== */}
                  <p className="mb-2 mt-4 text-[11px] font-black uppercase tracking-widest text-neutral-400">
                    Gambar banner
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void pickImage(e.target.files?.[0])}
                  />
                  {imageBusy ? (
                    <div className="flex h-28 items-center justify-center rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/50">
                      <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
                    </div>
                  ) : previewSrc ? (
                    <div className="relative overflow-hidden rounded-2xl border border-orange-200">
                      <img src={previewSrc} alt="Gambar banner terpilih" className="aspect-video w-full object-cover" />
                      <div className="absolute bottom-2 right-2 flex gap-2">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="press-effect rounded-full bg-white/95 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-orange-700 shadow-md ring-1 ring-orange-200 transition hover:bg-orange-50"
                        >
                          Ganti
                        </button>
                        <button
                          onClick={() =>
                            // undefined → null (tandai hapus gambar server),
                            // null → undefined (urungkan), string → null (buang gambar yg baru dipilih)
                            setImageData(imageData === null ? undefined : null)
                          }
                          className="press-effect flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow-md transition hover:bg-red-700"
                        >
                          <Trash2 className="h-3 w-3" /> Hapus
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/50 text-orange-500 transition hover:border-orange-400 hover:bg-orange-50"
                    >
                      <ImagePlus className="h-7 w-7" />
                      <span className="text-xs font-extrabold">Ketuk untuk unggah gambar</span>
                      <span className="text-[10px] font-semibold text-neutral-400">
                        JPG / PNG / WEBP — disarankan rasio lebar ±16:9
                      </span>
                    </button>
                  )}

                  {/* ===== JUDUL & PESAN ===== */}
                  <p className="mb-2 mt-4 text-[11px] font-black uppercase tracking-widest text-neutral-400">
                    Judul &amp; pesan (opsional)
                  </p>
                  <div className="space-y-2.5">
                    <div>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
                        placeholder="cth: Promo Geprek Hemat Jumat!"
                        className="w-full rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-800 outline-none transition placeholder:font-normal placeholder:text-neutral-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                      />
                      <p className="mt-1 text-right text-[10px] font-semibold text-neutral-300">
                        {title.length}/{MAX_TITLE}
                      </p>
                    </div>
                    <div>
                      <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
                        placeholder="cth: Beli 2 gratis 1 es teh — hanya hari ini di AGSI!"
                        rows={2}
                        className="w-full resize-none rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm font-medium text-neutral-800 outline-none transition placeholder:font-normal placeholder:text-neutral-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                      />
                      <p className="mt-1 text-right text-[10px] font-semibold text-neutral-300">
                        {text.length}/{MAX_TEXT}
                      </p>
                    </div>
                  </div>

                  {/* ===== STRIP PROMO HARI INI (Beranda) ===== */}
                  <div className="mt-6 flex items-center gap-2">
                    <div className="h-px flex-1 bg-neutral-200" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">
                      Strip Promo Hari Ini
                    </span>
                    <div className="h-px flex-1 bg-neutral-200" />
                  </div>
                  <div
                    className={cn(
                      "mt-3 rounded-2xl border p-4 transition-colors",
                      promoEnabled ? "border-orange-200 bg-orange-50/60" : "border-neutral-200 bg-neutral-50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                          promoEnabled ? "bg-orange-600 text-white" : "bg-neutral-200 text-neutral-400"
                        )}
                      >
                        <Tag className="h-5.5 w-5.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-neutral-800">Strip “Promo Hari Ini”</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">
                          Kotak oranye di Beranda (di bawah Paling Dicari). Kosongkan baris mana pun untuk
                          menyembunyikannya.
                        </p>
                      </div>
                      <Switch
                        checked={promoEnabled}
                        onCheckedChange={setPromoEnabled}
                        aria-label={`${promoEnabled ? "Nonaktifkan" : "Aktifkan"} strip promo hari ini`}
                        className="mt-0.5 h-6 w-11 data-[state=checked]:bg-orange-600 data-[state=unchecked]:bg-neutral-300"
                      />
                    </div>

                    {/* Pratinjau strip */}
                    <div className="relative mt-3 overflow-hidden rounded-xl bg-gradient-to-r from-orange-600 via-orange-500 to-orange-400 p-3.5 text-left shadow">
                      <div className="pointer-events-none absolute -right-3 -top-5 text-[54px] opacity-25">🌶️</div>
                      {promoBadge.trim() && (
                        <p className="text-[9px] font-bold uppercase tracking-widest text-orange-100">
                          {promoBadge.trim()}
                        </p>
                      )}
                      {promoTitle.trim() && (
                        <p className="mt-0.5 text-sm font-extrabold text-white">{promoTitle.trim()}</p>
                      )}
                      {promoText.trim() && (
                        <p className="mt-0.5 text-[10px] font-medium text-orange-50">{promoText.trim()}</p>
                      )}
                      {!promoBadge.trim() && !promoTitle.trim() && !promoText.trim() && (
                        <p className="text-[10px] font-semibold text-orange-100">
                          Semua baris kosong — strip tidak akan tampil.
                        </p>
                      )}
                    </div>

                    {/* Input 3 baris */}
                    <div className="mt-3 space-y-2.5">
                      <div>
                        <input
                          value={promoBadge}
                          onChange={(e) => setPromoBadge(e.target.value.slice(0, MAX_STRIP_BADGE))}
                          placeholder="cth: Promo Hari Ini"
                          disabled={!promoEnabled}
                          className="w-full rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-800 outline-none transition placeholder:font-normal placeholder:text-neutral-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
                        />
                        <p className="mt-1 text-right text-[10px] font-semibold text-neutral-300">
                          Label kecil · {promoBadge.length}/{MAX_STRIP_BADGE}
                        </p>
                      </div>
                      <div>
                        <input
                          value={promoTitle}
                          onChange={(e) => setPromoTitle(e.target.value.slice(0, MAX_STRIP_TITLE))}
                          placeholder="cth: Paket Komplit mulai Rp 27.000"
                          disabled={!promoEnabled}
                          className="w-full rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-800 outline-none transition placeholder:font-normal placeholder:text-neutral-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
                        />
                        <p className="mt-1 text-right text-[10px] font-semibold text-neutral-300">
                          Judul utama · {promoTitle.length}/{MAX_STRIP_TITLE}
                        </p>
                      </div>
                      <div>
                        <input
                          value={promoText}
                          onChange={(e) => setPromoText(e.target.value.slice(0, MAX_STRIP_TEXT))}
                          placeholder="cth: Geprek + nasi + es teh manis jumbo"
                          disabled={!promoEnabled}
                          className="w-full rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-800 outline-none transition placeholder:font-normal placeholder:text-neutral-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
                        />
                        <p className="mt-1 text-right text-[10px] font-semibold text-neutral-300">
                          Baris penjelas · {promoText.length}/{MAX_STRIP_TEXT}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* ===== HERO BANNER HALAMAN MENU ===== */}
                  <div className="mt-6 flex items-center gap-2">
                    <div className="h-px flex-1 bg-neutral-200" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">
                      Hero Banner Halaman Menu
                    </span>
                    <div className="h-px flex-1 bg-neutral-200" />
                  </div>
                  <div
                    className={cn(
                      "mt-3 rounded-2xl border p-4 transition-colors",
                      heroEnabled ? "border-orange-200 bg-orange-50/60" : "border-neutral-200 bg-neutral-50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                          heroEnabled ? "bg-orange-600 text-white" : "bg-neutral-200 text-neutral-400"
                        )}
                      >
                        <PanelTop className="h-5.5 w-5.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-neutral-800">Hero Banner Menu</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">
                          Banner promo besar di atas daftar menu pelanggan. Kosongkan baris mana pun
                          untuk menyembunyikannya.
                        </p>
                      </div>
                      <Switch
                        checked={heroEnabled}
                        onCheckedChange={setHeroEnabled}
                        aria-label={`${heroEnabled ? "Nonaktifkan" : "Aktifkan"} hero banner halaman menu`}
                        className="mt-0.5 h-6 w-11 data-[state=checked]:bg-orange-600 data-[state=unchecked]:bg-neutral-300"
                      />
                    </div>

                    {/* Pratinjau hero — meniru tampilan cerah asli di halaman Menu */}
                    <div className="relative mt-3 h-28 overflow-hidden rounded-xl shadow">
                      {heroPreviewSrc ? (
                        <img
                          src={heroPreviewSrc}
                          alt="Pratinjau hero banner menu"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-orange-500 via-amber-400 to-yellow-300">
                          <div className="pointer-events-none absolute -right-2 -top-6 text-[80px] opacity-30">🍗</div>
                          <div className="pointer-events-none absolute -bottom-8 left-1/3 h-20 w-20 rounded-full bg-white/35 blur-xl" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/15 to-transparent" />
                      <div className="relative flex h-full flex-col justify-center gap-1 p-4">
                        {heroBadge.trim() && (
                          <span className="w-fit rounded-full bg-white/30 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white ring-1 ring-white/45">
                            {heroBadge.trim()}
                          </span>
                        )}
                        {heroTitle.trim() ? (
                          <p className="text-base font-black leading-tight text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)]">{heroTitle.trim()}</p>
                        ) : (
                          <p className="text-[10px] font-semibold text-white/75">Judul kosong — baris disembunyikan</p>
                        )}
                        {heroText.trim() && (
                          <p className="text-[11px] font-medium text-white/90">{heroText.trim()}</p>
                        )}
                      </div>
                    </div>

                    {/* Upload gambar latar hero */}
                    <p className="mb-2 mt-4 text-[11px] font-black uppercase tracking-widest text-neutral-400">
                      Gambar latar (opsional)
                    </p>
                    <input
                      ref={heroFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => void pickHeroImage(e.target.files?.[0])}
                    />
                    {heroImageBusy ? (
                      <div className="flex h-24 items-center justify-center rounded-2xl border-2 border-dashed border-orange-200 bg-orange-50/50">
                        <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
                      </div>
                    ) : heroPreviewSrc ? (
                      <div className="relative overflow-hidden rounded-2xl border border-orange-200">
                        <img src={heroPreviewSrc} alt="Gambar latar hero terpilih" className="aspect-video w-full object-cover" />
                        <div className="absolute bottom-2 right-2 flex gap-2">
                          <button
                            onClick={() => heroFileInputRef.current?.click()}
                            className="press-effect rounded-full bg-white/95 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-orange-700 shadow-md ring-1 ring-orange-200 transition hover:bg-orange-50"
                          >
                            Ganti
                          </button>
                          <button
                            onClick={() =>
                              setHeroImageData(heroImageData === null ? undefined : null)
                            }
                            className="press-effect flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow-md transition hover:bg-red-700"
                          >
                            <Trash2 className="h-3 w-3" /> Hapus
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => heroFileInputRef.current?.click()}
                        className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-orange-300 bg-orange-50/50 text-orange-500 transition hover:border-orange-400 hover:bg-orange-50"
                      >
                        <ImagePlus className="h-6 w-6" />
                        <span className="text-xs font-extrabold">Ketuk untuk unggah gambar latar</span>
                        <span className="text-[10px] font-semibold text-neutral-400">
                          Tanpa gambar → gradien orange otomatis
                        </span>
                      </button>
                    )}

                    {/* Input 3 baris hero */}
                    <div className="mt-3 space-y-2.5">
                      <div>
                        <input
                          value={heroBadge}
                          onChange={(e) => setHeroBadge(e.target.value.slice(0, MAX_HERO_BADGE))}
                          placeholder="cth: Promo Spesial"
                          disabled={!heroEnabled}
                          className="w-full rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-800 outline-none transition placeholder:font-normal placeholder:text-neutral-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
                        />
                        <p className="mt-1 text-right text-[10px] font-semibold text-neutral-300">
                          Label kecil · {heroBadge.length}/{MAX_HERO_BADGE}
                        </p>
                      </div>
                      <div>
                        <input
                          value={heroTitle}
                          onChange={(e) => setHeroTitle(e.target.value.slice(0, MAX_HERO_TITLE))}
                          placeholder="cth: Paket Komplit mulai Rp 27.000"
                          disabled={!heroEnabled}
                          className="w-full rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-800 outline-none transition placeholder:font-normal placeholder:text-neutral-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
                        />
                        <p className="mt-1 text-right text-[10px] font-semibold text-neutral-300">
                          Judul utama · {heroTitle.length}/{MAX_HERO_TITLE}
                        </p>
                      </div>
                      <div>
                        <input
                          value={heroText}
                          onChange={(e) => setHeroText(e.target.value.slice(0, MAX_HERO_TEXT))}
                          placeholder="cth: Geprek + nasi + es teh manis jumbo"
                          disabled={!heroEnabled}
                          className="w-full rounded-xl border border-orange-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-800 outline-none transition placeholder:font-normal placeholder:text-neutral-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
                        />
                        <p className="mt-1 text-right text-[10px] font-semibold text-neutral-300">
                          Baris penjelas · {heroText.length}/{MAX_HERO_TEXT}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* ===== SLIDE VOUCHER DI CAROUSEL MENU ===== */}
                  <div className="mt-6 flex items-center gap-2">
                    <div className="h-px flex-1 bg-neutral-200" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-neutral-400">
                      Slide Voucher di Menu
                    </span>
                    <div className="h-px flex-1 bg-neutral-200" />
                  </div>
                  <div
                    className={cn(
                      "mt-3 rounded-2xl border p-4 transition-colors",
                      vpEnabled ? "border-orange-200 bg-orange-50/60" : "border-neutral-200 bg-neutral-50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                          vpEnabled ? "bg-rose-500 text-white" : "bg-neutral-200 text-neutral-400"
                        )}
                      >
                        <Ticket className="h-5.5 w-5.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-neutral-800">Slide Voucher Aktif</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">
                          Slide voucher bergantian dengan hero di carousel Menu (ketuk pelanggan = salin kode).
                          Isi slide diambil otomatis dari daftar voucher aktif — Kelola Voucher di Profil.
                        </p>
                      </div>
                      <Switch
                        checked={vpEnabled}
                        onCheckedChange={setVpEnabled}
                        aria-label={`${vpEnabled ? "Nonaktifkan" : "Aktifkan"} slide voucher di menu`}
                        className="mt-0.5 h-6 w-11 data-[state=checked]:bg-rose-500 data-[state=unchecked]:bg-neutral-300"
                      />
                    </div>

                    {/* Pengatur jumlah maksimal slide voucher */}
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-orange-100 bg-white px-3.5 py-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-neutral-700">Jumlah slide voucher</p>
                        <p className="text-[10px] text-neutral-400">Maksimal voucher yang tampil bergantian (1–5)</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setVpMax((v) => Math.max(1, v - 1))}
                          disabled={!vpEnabled || vpMax <= 1}
                          aria-label="Kurangi jumlah slide voucher"
                          className="press-effect flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-orange-100 hover:text-orange-700 disabled:opacity-40"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span
                          className={cn(
                            "flex h-8 w-9 items-center justify-center rounded-lg text-sm font-black",
                            vpEnabled ? "bg-orange-50 text-orange-700" : "bg-neutral-100 text-neutral-400"
                          )}
                        >
                          {vpMax}
                        </span>
                        <button
                          type="button"
                          onClick={() => setVpMax((v) => Math.min(5, v + 1))}
                          disabled={!vpEnabled || vpMax >= 5}
                          aria-label="Tambah jumlah slide voucher"
                          className="press-effect flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-orange-100 hover:text-orange-700 disabled:opacity-40"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Pratinjau slide voucher — meniru tampilan cerah asli */}
                    <div className="relative mt-3 h-24 overflow-hidden rounded-xl shadow">
                      <div
                        className={cn(
                          "absolute inset-0 bg-gradient-to-br transition-opacity",
                          vpEnabled ? "from-rose-500 via-orange-400 to-amber-300" : "from-neutral-300 via-neutral-300 to-neutral-300"
                        )}
                      >
                        <div className="pointer-events-none absolute -right-2 -bottom-5 text-[70px] opacity-30">🎟️</div>
                        <div className="pointer-events-none absolute -left-4 -top-6 h-16 w-16 rounded-full bg-white/30 blur-lg" />
                      </div>
                      <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/15 to-transparent" />
                      <div className="relative flex h-full flex-col justify-center gap-1 p-4">
                        {vpEnabled ? (
                          <>
                            <span className="w-fit rounded-full bg-white/30 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white ring-1 ring-white/45">
                              Voucher Aktif
                            </span>
                            <p className="text-sm font-black leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
                              Konten otomatis dari voucher aktif
                            </p>
                            <span className="w-fit rounded-lg bg-white px-2 py-0.5 font-mono text-[10px] font-black tracking-wider text-orange-700 shadow">
                              AGSI-XXXX
                            </span>
                          </>
                        ) : (
                          <p className="text-[11px] font-semibold text-neutral-600">
                            Slide voucher disembunyikan — carousel Menu hanya menampilkan hero banner.
                          </p>
                        )}
                      </div>
                    </div>

                    {vpEnabled && (
                      <p className="mt-2 text-[10px] font-semibold leading-relaxed text-neutral-400">
                        Carousel hanya tampil bila ada slide: hero kosong &amp; tidak ada voucher aktif → strip tersembunyi.
                        Hero dinonaktifkan? Voucher tetap tampil selama saklar ini aktif.
                      </p>
                    )}
                  </div>

                  {/* ===== CATATAN ===== */}
                  <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11px] font-semibold leading-relaxed text-amber-800 ring-1 ring-amber-200">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Popup tampil <strong>1x per sesi</strong> di Beranda tiap pelanggan. Menyimpan
                      banner (gambar/judul/pesan baru) menaikkan versinya — popup otomatis tampil
                      lagi untuk semua pelanggan. Butuh gambar <em>atau</em> judul agar muncul.
                    </span>
                  </div>

                  {/* ===== TOMBOL SIMPAN ===== */}
                  <button
                    onClick={() => void save()}
                    disabled={saving}
                    className="press-effect mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 py-3.5 text-sm font-black text-white shadow-lg shadow-orange-600/30 transition hover:bg-orange-700 disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="h-4.5 w-4.5 animate-spin" />
                    ) : (
                      <Save className="h-4.5 w-4.5" />
                    )}
                    {saving ? "Menyimpan…" : "Simpan Banner & Promo"}
                  </button>
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
