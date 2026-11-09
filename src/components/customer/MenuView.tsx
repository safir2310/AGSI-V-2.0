"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Minus, Plus, Search, SearchX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SpicyDots } from "@/components/shared/StatusBadge";
import { ProductThumb } from "@/components/shared/ProductThumb";
import {
  refreshSettings,
  refreshVouchers,
  useProductsStore,
  useSettingsStore,
  useVouchersStore,
} from "@/lib/hooks";
import { useCartStore, useNoticeStore } from "@/lib/store";
import { copyText } from "@/lib/clipboard";
import { formatIDR, formatVoucherValue, type VoucherInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * STRIP PROMO SLIDE-OTOMATIS di atas daftar Menu.
 *  - Slide 1  : hero banner — konten diatur admin dari Profil →
 *               "Banner & Promo" → bagian Hero Banner Halaman Menu.
 *  - Slide 2+ : voucher aktif (jumlah diatur admin, maks 5) — ketuk untuk salin kode.
 * Slide berganti OTOMATIS tiap 4 detik (geser ke kiri; fade bila pengguna
 * memilih kurangi gerakan) dengan indikator titik yang bisa diketuk.
 * Tampilan cerah: gradien oranye→kuning menyala + dekorasi mengapung + kilau.
 */
type PromoSlide = { kind: "hero" } | { kind: "voucher"; voucher: VoucherInfo };

/** Jeda antar slide (ms) */
const PROMO_SLIDE_INTERVAL = 4000;

function MenuHeroBanner() {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const hero = useSettingsStore((s) => s.menuHero);
  const menuPromo = useSettingsStore((s) => s.menuPromo);
  const vouchers = useVouchersStore((s) => s.vouchers);

  // Pastikan konten hero & daftar voucher selalu segar saat Menu dibuka
  useEffect(() => {
    void refreshSettings();
    void refreshVouchers();
  }, []);

  // Susun daftar slide: hero dulu, lalu voucher aktif (jumlah diatur admin).
  // Voucher aktif = belum dipakai akun ini, kuota sisa, dan belum kedaluwarsa.
  // Admin dapat menyembunyikan slide voucher (Profil → Banner & Promo →
  // "Slide Voucher di Menu") atau membatasi jumlahnya 1–5.
  const slides = useMemo<PromoSlide[]>(() => {
    const hasHeroContent =
      !!hero.menuHeroBadge.trim() ||
      !!hero.menuHeroTitle.trim() ||
      !!hero.menuHeroText.trim() ||
      !!hero.menuHeroImageUrl;
    const list: PromoSlide[] = [];
    if (hero.menuHeroEnabled && hasHeroContent) list.push({ kind: "hero" });
    if (menuPromo.menuPromoVouchersEnabled) {
      const now = Date.now();
      vouchers
        .filter(
          (v) =>
            !v.usedByMe &&
            v.remaining > 0 &&
            (!v.expiresAt || new Date(v.expiresAt).getTime() > now)
        )
        .slice(0, menuPromo.menuPromoVouchersMax)
        .forEach((voucher) => list.push({ kind: "voucher", voucher }));
    }
    return list;
  }, [hero, vouchers, menuPromo]);

  const [index, setIndex] = useState(0);

  // GESER OTOMATIS: maju ke slide berikutnya tiap 4 detik (jika >1 slide).
  // Timer di-reset tiap kali index berubah → ketukan manual juga mendapat
  // jeda penuh 4 detik sebelum slide berganti lagi.
  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % slides.length), PROMO_SLIDE_INTERVAL);
    return () => clearInterval(t);
  }, [slides.length, index]);

  // Jaga index tetap valid bila daftar slide menyusut (voucher habis dsb.)
  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [slides.length, index]);

  if (slides.length === 0) return null;
  const slide = slides[Math.min(index, slides.length - 1)];
  const isHero = slide.kind === "hero";
  const heroSlide = !isHero ? null : hero;

  /** Ketuk slide voucher → salin kode (perilaku sama dengan kartu voucher di Beranda) */
  const copyVoucherCode = async (v: VoucherInfo) => {
    const ok = await copyText(v.code);
    showNotice({
      type: "success",
      title: ok ? `Kode ${v.code} Disalin! 🎟️` : `Voucher ${v.code} Disiapkan 🎟️`,
      message: "Buka keranjang, tempel kodenya, dan potongan dihitung otomatis.",
    });
  };

  return (
    <motion.section
      initial={prefersReduced ? false : { opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      aria-label="Banner promo"
      className="relative mb-4 h-40 w-full overflow-hidden rounded-3xl shadow-lg shadow-orange-500/30 ring-1 ring-orange-300/40"
    >
      {/* ===== SLIDE BERJALAN ===== */}
      <AnimatePresence initial={false}>
        <motion.div
          key={index}
          initial={prefersReduced ? { opacity: 0 } : { x: "100%" }}
          animate={{ opacity: 1, x: 0 }}
          exit={prefersReduced ? { opacity: 0 } : { x: "-100%" }}
          transition={{ type: "spring", stiffness: 220, damping: 30 }}
          className="absolute inset-0"
        >
          {isHero && heroSlide ? (
            /* ---- SLIDE HERO BANNER (konten admin) — cerah menyala ---- */
            <div className="absolute inset-0">
              {heroSlide.menuHeroImageUrl ? (
                <img
                  src={heroSlide.menuHeroImageUrl}
                  alt={heroSlide.menuHeroTitle.trim() ? heroSlide.menuHeroTitle : "Banner promo menu"}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-orange-500 via-amber-400 to-yellow-300">
                  {/* Blob cahaya mengapung — memberi kesan cerah & hidup */}
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute -right-6 -top-12 h-36 w-36 rounded-full bg-white/35 blur-2xl"
                    animate={prefersReduced ? undefined : { y: [0, 10, 0], x: [0, -8, 0] }}
                    transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute -bottom-12 left-1/3 h-32 w-32 rounded-full bg-yellow-200/45 blur-2xl"
                    animate={prefersReduced ? undefined : { y: [0, -8, 0], scale: [1, 1.08, 1] }}
                    transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute -right-3 -top-8 select-none text-[130px] leading-none opacity-30 drop-shadow-md"
                    animate={prefersReduced ? undefined : { y: [0, -9, 0], rotate: [0, 5, 0] }}
                    transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
                  >
                    🍗
                  </motion.div>
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute -bottom-10 right-16 select-none text-[90px] leading-none opacity-25"
                    animate={prefersReduced ? undefined : { y: [0, 7, 0], rotate: [0, -6, 0] }}
                    transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
                  >
                    🌶️
                  </motion.div>
                </div>
              )}
              {/* Kilau menyapu berkala (dilewati bila pengguna pilih kurangi gerakan) */}
              {!prefersReduced && (
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-12deg] bg-gradient-to-r from-transparent via-white/45 to-transparent"
                  animate={{ x: ["0%", "480%"] }}
                  transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 2.8, ease: "easeInOut" }}
                />
              )}
              {/* Overlay ringan hanya di sisi teks — sisi kanan tetap terang */}
              <div className="absolute inset-0 bg-gradient-to-r from-neutral-900/60 via-neutral-900/20 to-transparent" />
              {/* Konten teks (tanpa tombol — strip murni promosi) */}
              <div className="relative flex h-full flex-col justify-center gap-1.5 p-5">
                {!!heroSlide.menuHeroBadge.trim() && (
                  <span className="w-fit rounded-full bg-white/30 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white shadow-sm ring-1 ring-white/45 backdrop-blur-sm">
                    {heroSlide.menuHeroBadge}
                  </span>
                )}
                {!!heroSlide.menuHeroTitle.trim() && (
                  <h2 className="max-w-[75%] text-lg font-black leading-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)]">
                    {heroSlide.menuHeroTitle}
                  </h2>
                )}
                {!!heroSlide.menuHeroText.trim() && (
                  <p className="max-w-[70%] text-xs font-semibold leading-snug text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
                    {heroSlide.menuHeroText}
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* ---- SLIDE VOUCHER AKTIF (ketuk = salin kode) — cerah menyala ---- */
            slide.kind === "voucher" && (
              <button
                type="button"
                onClick={() => void copyVoucherCode(slide.voucher)}
                aria-label={`Salin kode voucher ${slide.voucher.code}`}
                className="absolute inset-0 w-full cursor-pointer text-left"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-rose-500 via-orange-400 to-amber-300">
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute -left-6 -top-12 h-32 w-32 rounded-full bg-white/30 blur-2xl"
                    animate={prefersReduced ? undefined : { y: [0, 9, 0], scale: [1, 1.06, 1] }}
                    transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute -right-2 -bottom-6 select-none text-[110px] leading-none opacity-30 drop-shadow-md"
                    animate={prefersReduced ? undefined : { y: [0, -8, 0], rotate: [0, 6, 0] }}
                    transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                  >
                    🎟️
                  </motion.div>
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute -top-6 left-10 select-none text-[70px] leading-none opacity-30"
                    animate={prefersReduced ? undefined : { y: [0, 8, 0], rotate: [0, -8, 0] }}
                    transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                  >
                    ✨
                  </motion.div>
                </div>
                {!prefersReduced && (
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-12deg] bg-gradient-to-r from-transparent via-white/45 to-transparent"
                    animate={{ x: ["0%", "480%"] }}
                    transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 3.2, ease: "easeInOut" }}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-neutral-900/55 via-neutral-900/15 to-transparent" />
                <div className="relative flex h-full flex-col justify-center gap-1.5 p-5">
                  <span className="w-fit rounded-full bg-white/30 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white shadow-sm ring-1 ring-white/45 backdrop-blur-sm">
                    Voucher Aktif
                  </span>
                  <h2 className="max-w-[75%] text-lg font-black leading-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)]">
                    Potongan {formatVoucherValue(slide.voucher)}
                    {slide.voucher.type === "PERCENT" ? " Off" : ""}
                  </h2>
                  <p className="max-w-[70%] text-xs font-semibold leading-snug text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
                    {slide.voucher.title}
                  </p>
                  <span className="mt-0.5 flex w-fit items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 font-mono text-[11px] font-black tracking-wider text-orange-700 shadow-md">
                    {slide.voucher.code}
                    <span className="font-sans text-[9px] font-bold uppercase text-orange-400">
                      ketuk salin
                    </span>
                  </span>
                </div>
              </button>
            )
          )}
        </motion.div>
      </AnimatePresence>

      {/* ===== INDIKATOR TITIK (bisa diketuk untuk lompat slide) ===== */}
      {slides.length > 1 && (
        <div className="absolute bottom-2.5 right-3 z-20 flex items-center gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.kind === "hero" ? "hero" : s.voucher.id}
              type="button"
              aria-label={`Ke slide ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index
                  ? "w-4 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
                  : "w-1.5 bg-white/60 hover:bg-white/90"
              )}
            />
          ))}
        </div>
      )}
    </motion.section>
  );
}

export function MenuView() {
  const [category, setCategory] = useState<string>("Semua");
  const [query, setQuery] = useState("");
  const prefersReduced = useReducedMotion();
  const products = useProductsStore((s) => s.products);
  const cart = useCartStore();

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map((p) => p.category)));
    return ["Semua", ...cats];
  }, [products]);

  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (category === "Semua" || p.category === category) &&
          p.name.toLowerCase().includes(query.toLowerCase().trim())
      ),
    [products, category, query]
  );

  return (
    <div className="px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
      <header className="mb-3">
        <h1 className="text-xl font-black text-neutral-900">Menu Geprek 🍗</h1>
        <p className="text-xs text-neutral-400">Pilih, geprek, dan nikmati!</p>
      </header>

      {/* Hero banner promo (dikelola admin dari Profil → Banner & Promo) */}
      <MenuHeroBanner />

      {/* Pencarian */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
        <Input
          placeholder="Cari menu… (cth: mozarella)"
          className="rounded-xl border-orange-200 pl-9 focus-visible:ring-orange-400"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Tab kategori */}
      <div className="scrollbar-slim -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {categories.map((c) => {
          const isActive = category === c;
          return (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "relative shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-colors",
                isActive ? "text-white" : "bg-orange-50 text-orange-700 hover:bg-orange-100"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId={prefersReduced ? undefined : "menu-cat-pill"}
                  className="absolute inset-0 rounded-full bg-orange-600 shadow-md"
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                />
              )}
              <span className="relative z-10">{c}</span>
            </button>
          );
        })}
      </div>

      {/* Grid menu */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-10 text-center">
          <SearchX className="h-8 w-8 text-orange-300" />
          <p className="text-sm font-semibold text-neutral-500">Menu tidak ditemukan</p>
          <p className="text-xs text-neutral-400">Coba kata kunci atau kategori lain</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((p) => {
              const inCart = cart.items.find((i) => i.productId === p.id)?.qty ?? 0;
              const soldOut = !p.available;
              return (
                <motion.article
                  layout={!prefersReduced}
                  key={p.id}
                  initial={prefersReduced ? false : { opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={prefersReduced ? undefined : { opacity: 0, scale: 0.94 }}
                  transition={{ duration: 0.25 }}
                  whileHover={prefersReduced || soldOut ? undefined : { y: -4 }}
                  className={cn(
                    "card-lift relative flex flex-col rounded-2xl border border-orange-100 bg-white p-3 shadow-sm",
                    soldOut && "opacity-60"
                  )}
                >
                  {p.popular && !soldOut && (
                    <span className="absolute -top-1.5 left-3 z-10 rounded-full bg-orange-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white shadow">
                      Populer
                    </span>
                  )}
                  <ProductThumb
                    product={p}
                    className="mb-2 aspect-square w-full text-5xl"
                    imgClassName="aspect-square"
                  />
                  <SpicyDots level={p.spicy} />
                  <h3 className="mt-0.5 line-clamp-1 text-sm font-bold text-neutral-800">{p.name}</h3>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-neutral-400">
                    {p.description}
                  </p>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="text-sm font-black text-orange-600">
                      {formatIDR(p.price)}
                    </span>
                    {soldOut ? (
                      <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-bold text-neutral-400">
                        Habis
                      </span>
                    ) : inCart > 0 ? (
                      <div className="flex items-center gap-1 rounded-full bg-orange-600 p-0.5 text-white shadow-md">
                        <button
                          aria-label="Kurangi"
                          className="press-effect flex h-6 w-6 items-center justify-center rounded-full hover:bg-orange-700"
                          onClick={() => cart.setQty(p.id, inCart - 1)}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-4 text-center text-xs font-black">{inCart}</span>
                        <button
                          aria-label="Tambah"
                          className="press-effect flex h-6 w-6 items-center justify-center rounded-full hover:bg-orange-700"
                          onClick={() =>
                            cart.add({
                              productId: p.id,
                              name: p.name,
                              emoji: p.emoji,
                              price: p.price,
                              imageColor: p.imageColor,
                            })
                          }
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <motion.button
                        whileTap={{ scale: 0.85 }}
                        aria-label={`Tambah ${p.name} ke keranjang`}
                        onClick={() =>
                          cart.add({
                            productId: p.id,
                            name: p.name,
                            emoji: p.emoji,
                            price: p.price,
                            imageColor: p.imageColor,
                          })
                        }
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-600 text-white shadow-md transition hover:bg-orange-700"
                      >
                        <Plus className="h-4 w-4" />
                      </motion.button>
                    )}
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
