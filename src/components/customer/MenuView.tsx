"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Minus, Plus, Search, SearchX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SpicyDots } from "@/components/shared/StatusBadge";
import { ProductThumb } from "@/components/shared/ProductThumb";
import { refreshSettings, useProductsStore, useSettingsStore } from "@/lib/hooks";
import { useAppStore, useCartStore } from "@/lib/store";
import { formatIDR } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Hero banner promo di atas daftar Menu.
 * Konten (saklar, gambar latar, badge, judul, teks) diatur admin dari
 * Profil → "Banner & Promo" → bagian Hero Banner Halaman Menu.
 * Tanpa gambar latar → gradien orange khas AGSI + dekorasi maskot.
 */
function MenuHeroBanner() {
  const prefersReduced = useReducedMotion();
  const go = useAppStore((s) => s.go);
  const hero = useSettingsStore((s) => s.menuHero);

  // Pastikan konten hero selalu segar saat halaman Menu dibuka
  useEffect(() => {
    void refreshSettings();
  }, []);

  if (!hero.menuHeroEnabled) return null;
  const hasBadge = !!hero.menuHeroBadge.trim();
  const hasTitle = !!hero.menuHeroTitle.trim();
  const hasText = !!hero.menuHeroText.trim();
  // Tanpa konten apa pun sama sekali → jangan tampilkan kotak kosong
  if (!hasBadge && !hasTitle && !hasText && !hero.menuHeroImageUrl) return null;

  return (
    <motion.section
      initial={prefersReduced ? false : { opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      aria-label="Banner promo"
      className="relative mb-4 h-40 w-full overflow-hidden rounded-3xl shadow-lg shadow-orange-600/20"
    >
      {/* Latar: gambar upload admin, atau gradien orange bawaan */}
      {hero.menuHeroImageUrl ? (
        <img
          src={hero.menuHeroImageUrl}
          alt={hasTitle ? hero.menuHeroTitle : "Banner promo menu"}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-orange-700 via-orange-500 to-amber-400">
          <div className="pointer-events-none absolute -right-3 -top-8 select-none text-[130px] leading-none opacity-20">
            🍗
          </div>
          <div className="pointer-events-none absolute -bottom-10 right-16 select-none text-[90px] leading-none opacity-15">
            🌶️
          </div>
        </div>
      )}
      {/* Overlay agar teks selalu terbaca */}
      <div className="absolute inset-0 bg-gradient-to-r from-neutral-900/65 via-neutral-900/30 to-transparent" />

      {/* Konten teks */}
      <div className="relative flex h-full flex-col justify-center gap-1.5 p-5">
        {hasBadge && (
          <span className="w-fit rounded-full bg-white/25 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white ring-1 ring-white/30 backdrop-blur-sm">
            {hero.menuHeroBadge}
          </span>
        )}
        {hasTitle && (
          <h2 className="max-w-[75%] text-lg font-black leading-tight text-white drop-shadow-sm">
            {hero.menuHeroTitle}
          </h2>
        )}
        {hasText && (
          <p className="max-w-[70%] text-xs font-semibold leading-snug text-white/85">
            {hero.menuHeroText}
          </p>
        )}
        <button
          onClick={() => go("cart")}
          className="press-effect mt-1 flex w-fit items-center gap-1 rounded-full bg-white px-4 py-1.5 text-[11px] font-black text-orange-700 shadow-md transition hover:bg-orange-50"
        >
          Pesan Sekarang <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
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
