"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  ChevronDown,
  Copy,
  Flame,
  MapPin,
  Star,
  Ticket,
  Timer,
} from "lucide-react";
import { ChickenMascot3D } from "@/components/logo/ChickenMascot3D";
import { SpicyDots } from "@/components/shared/StatusBadge";
import { ProductThumb } from "@/components/shared/ProductThumb";
import { StoreSheet } from "@/components/shared/StoreSheet";
import { BannerPopup } from "@/components/customer/BannerPopup";
import { refreshVouchers, useProductsStore, useSettingsStore, useVouchersStore } from "@/lib/hooks";
import { useCartStore, useNoticeStore, type AppView } from "@/lib/store";
import { copyText } from "@/lib/clipboard";
import { STORE_ADDRESS, STORE_HOURS } from "@/lib/store-info";
import { formatIDR, formatVoucherValue, type VoucherInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

const HIGHLIGHTS = [
  { icon: Flame, title: "Sambal Ijo Asli", desc: "Digeprek dadakan" },
  { icon: Timer, title: "Siap 10 Menit", desc: "Dimasak fresh" },
  { icon: Star, title: "Rating 4.9", desc: "Pelanggan puas" },
];

export function HomeView({ go }: { go: (v: AppView) => void }) {
  const prefersReduced = useReducedMotion();
  const products = useProductsStore((s) => s.products);
  const cart = useCartStore();
  const { vouchers } = useVouchersStore();
  const setPendingCode = useVouchersStore((s) => s.setPendingCode);
  const showNotice = useNoticeStore((s) => s.show);

  /** Popup "Pilihan Toko" terbuka saat baris alamat di hero diketuk */
  const [storeOpen, setStoreOpen] = useState(false);
  const addrRef = useRef<HTMLSpanElement>(null);
  /** true bila teks alamat terpotong → ujungnya diberi efek pudar transparan */
  const [addrTruncated, setAddrTruncated] = useState(false);

  useEffect(() => {
    const measure = () => {
      const el = addrRef.current;
      if (el) setAddrTruncated(el.scrollWidth > el.clientWidth + 1);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const popular = products.filter((p) => p.popular && p.available).slice(0, 6);

  // Konten strip "Promo Hari Ini" + popup banner (diatur admin dari Profil).
  // load() aman dipanggil berulang — skip bila sudah termuat.
  const promo = useSettingsStore((s) => s.promo);
  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  // Segarkan daftar voucher (status "sudah dipakai" per akun bisa berubah)
  useEffect(() => {
    void refreshVouchers();
  }, []);

  /** Tap kartu voucher → salin kode & bawa ke keranjang */
  const pickVoucher = async (v: VoucherInfo) => {
    setPendingCode(v.code);
    const ok = await copyText(v.code);
    showNotice({
      type: "success",
      title: ok ? `Kode ${v.code} Disalin! 🎟️` : `Voucher ${v.code} Disiapkan 🎟️`,
      message: ok
        ? "Kode sudah tersalin — buka keranjang, tempel kodenya, dan potongan dihitung otomatis."
        : "Kode akan otomatis terisi saat kamu membuka keranjang.",
      actions: [
        { label: "Ke Keranjang", onClick: () => go("cart") },
        { label: "Lanjut Belanja" },
      ],
    });
  };

  const reveal = (delay: number) => ({
    initial: prefersReduced ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.4, ease: "easeOut" as const },
  });

  return (
    <div className="space-y-5">
      {/* ===== HERO ===== */}
      <section className="bg-brand-gradient relative overflow-hidden rounded-b-[2rem] px-5 pb-6 pt-[calc(1rem+env(safe-area-inset-top,0px))]">
        <div className="pointer-events-none absolute -right-14 top-6 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-100">
              Selamat datang di
            </p>
            <h1 className="mt-0.5 text-2xl font-black uppercase leading-tight text-white drop-shadow-sm">
              Ayam Geprek
              <span className="mt-1 block text-xl tracking-normal text-orange-50">
                Sambal <span className="rounded-lg bg-white/95 px-2 py-0.5 text-orange-700">Ijo</span>
              </span>
            </h1>
            {/* Alamat: satu baris; bila terlalu panjang ujungnya memudar
                transparan, dan saat diketuk terbuka popup Pilihan Toko */}
            <button
              type="button"
              onClick={() => setStoreOpen(true)}
              aria-label="Lihat pilihan toko"
              className="press-effect mt-2.5 flex w-full items-center gap-1.5 text-left text-[11px] font-semibold text-orange-50/95"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span
                ref={addrRef}
                className="min-w-0 flex-1 overflow-hidden whitespace-nowrap leading-snug"
                style={
                  addrTruncated
                    ? {
                        WebkitMaskImage: "linear-gradient(to right, #000 82%, transparent 99%)",
                        maskImage: "linear-gradient(to right, #000 82%, transparent 99%)",
                      }
                    : undefined
                }
              >
                {STORE_ADDRESS} — Buka {STORE_HOURS}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-80" />
            </button>
            <button
              onClick={() => go("menu")}
              className="press-effect mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-extrabold text-orange-700 shadow-lg transition hover:bg-orange-50"
            >
              Pesan Sekarang <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="shrink-0 pr-1">
            {/* Maskot ayam 3D: mengambang, berkedip, sayap mengepak,
                dan miring mengikuti gerakan kursor (parallax) */}
            <ChickenMascot3D size={128} entrance interactive />
          </div>
        </div>
      </section>

      {/* ===== KEUNGGULAN ===== */}
      <motion.section {...reveal(0.05)} className="grid grid-cols-3 gap-2.5 px-4">
        {HIGHLIGHTS.map((h) => (
          <div
            key={h.title}
            className="flex flex-col items-center gap-1 rounded-2xl border border-orange-100 bg-white p-3 text-center shadow-sm"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100">
              <h.icon className="h-4 w-4 text-orange-600" />
            </span>
            <p className="text-[11px] font-extrabold leading-tight text-neutral-800">{h.title}</p>
            <p className="text-[10px] leading-tight text-neutral-400">{h.desc}</p>
          </div>
        ))}
      </motion.section>

      {/* ===== VOUCHER & PROMO ===== */}
      {vouchers.length > 0 && (
        <motion.section {...reveal(0.08)} className="px-4">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="text-lg font-black text-neutral-900">Voucher Buat Kamu 🎟️</h2>
              <p className="text-xs text-neutral-400">Tukar kodenya di keranjang — sekali pakai</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {vouchers.map((v, i) => {
              const used = v.usedByMe;
              return (
                <motion.button
                  key={v.id}
                  type="button"
                  disabled={used}
                  aria-label={used ? `Voucher ${v.code} sudah dipakai` : `Pakai voucher ${v.code}`}
                  initial={prefersReduced ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.05, duration: 0.35 }}
                  whileTap={used || prefersReduced ? undefined : { scale: 0.98 }}
                  onClick={() => void pickVoucher(v)}
                  className={cn(
                    "card-lift flex w-full items-stretch overflow-hidden rounded-2xl border bg-white text-left shadow-sm",
                    used ? "border-neutral-200 opacity-60" : "border-orange-100 active:border-orange-300"
                  )}
                >
                  {/* Stub nilai diskon */}
                  <div
                    className={cn(
                      "flex w-[88px] shrink-0 flex-col items-center justify-center gap-0.5 p-3 text-white",
                      used
                        ? "bg-neutral-300"
                        : "bg-gradient-to-br from-orange-500 to-orange-600"
                    )}
                  >
                    <Ticket className="h-4 w-4 opacity-80" />
                    <span className="text-base font-black leading-tight">{formatVoucherValue(v)}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wide opacity-80">
                      {v.type === "PERCENT" ? "diskon" : "potongan"}
                    </span>
                  </div>
                  {/* Garis sobekan tiket */}
                  <div className="my-2.5 w-0 shrink-0 border-l-2 border-dashed border-orange-200" />
                  {/* Isi */}
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 p-3">
                    <p className="line-clamp-1 text-sm font-bold text-neutral-800">{v.title}</p>
                    {v.description && (
                      <p className="line-clamp-1 text-[11px] text-neutral-400">{v.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-neutral-900 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">
                        {v.code}
                      </span>
                      {used ? (
                        <span className="flex items-center gap-0.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[9px] font-black uppercase text-neutral-400">
                          <BadgeCheck className="h-2.5 w-2.5" /> Sudah dipakai
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-[9px] font-black uppercase text-green-600 ring-1 ring-green-200">
                          Tersedia
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-semibold text-neutral-400">
                      <span>Min. belanja {formatIDR(v.minPurchase)}</span>
                      {v.expiresAt && (
                        <span className="flex items-center gap-0.5">
                          <CalendarClock className="h-3 w-3" />
                          s.d.{" "}
                          {new Date(v.expiresAt).toLocaleDateString("id-ID", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      )}
                      {v.remaining === 1 && !used && (
                        <span className="font-bold text-orange-600">Sisa 1x — cepat!</span>
                      )}
                    </div>
                  </div>
                  {/* Aksi salin */}
                  <div className="flex items-center pr-3.5">
                    {used ? (
                      <BadgeCheck className="h-5 w-5 text-neutral-300" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-600 text-white shadow-md">
                        <Copy className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* ===== MENU FAVORIT ===== */}
      <motion.section {...reveal(0.12)} className="px-4">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-black text-neutral-900">Paling Dicari 🔥</h2>
            <p className="text-xs text-neutral-400">Favorit para pecinta pedas</p>
          </div>
          <button
            onClick={() => go("menu")}
            className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 hover:text-orange-700"
          >
            Semua <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {popular.map((p, i) => (
            <motion.button
              key={p.id}
              type="button"
              onClick={() => go("menu")}
              initial={prefersReduced ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 + i * 0.05, duration: 0.35 }}
              whileHover={prefersReduced ? undefined : { y: -4 }}
              whileTap={{ scale: 0.96 }}
              className="card-lift group relative overflow-hidden rounded-2xl border border-orange-100 bg-white p-3 text-left shadow-sm"
            >
              <ProductThumb
                product={p}
                className="mb-2 aspect-square w-full text-5xl"
                imgClassName="aspect-square transition-transform duration-300 group-hover:scale-110"
                emojiClassName="transition-transform duration-300 group-hover:scale-110"
              />
              <SpicyDots level={p.spicy} />
              <p className="mt-0.5 line-clamp-1 text-sm font-bold text-neutral-800">{p.name}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm font-black text-orange-600">{formatIDR(p.price)}</span>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-600 text-white shadow-md transition group-hover:scale-110">
                  +
                </span>
              </div>
            </motion.button>
          ))}
          {popular.length === 0 && (
            <div className="col-span-2 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-6 text-center text-sm text-neutral-400">
              Memuat menu favorit…
            </div>
          )}
        </div>
      </motion.section>

      {/* ===== STRIP PROMO HARI INI (konten diatur admin dari Profil) ===== */}
      {promo.promoStripEnabled && (promo.promoStripBadge.trim() || promo.promoStripTitle.trim() || promo.promoStripText.trim()) && (
        <motion.section {...reveal(0.2)} className="px-4">
          <button
            onClick={() => go("menu")}
            className="press-effect relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-orange-600 via-orange-500 to-orange-400 p-4 text-left shadow-lg"
          >
            <div className="pointer-events-none absolute -right-4 -top-6 text-[80px] opacity-25">🌶️</div>
            {promo.promoStripBadge.trim() && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-orange-100">
                {promo.promoStripBadge.trim()}
              </p>
            )}
            {promo.promoStripTitle.trim() && (
              <p className="mt-0.5 text-base font-extrabold text-white">
                {promo.promoStripTitle.trim()}
              </p>
            )}
            {promo.promoStripText.trim() && (
              <p className="mt-0.5 text-[11px] font-medium text-orange-50">
                {promo.promoStripText.trim()}
              </p>
            )}
          </button>
        </motion.section>
      )}

      {/* ===== POPUP PILIHAN TOKO (dibuka dari alamat di hero) ===== */}
      <StoreSheet open={storeOpen} onClose={() => setStoreOpen(false)} />

      {/* ===== POPUP BANNER PROMO (konten diatur admin dari Profil) ===== */}
      <BannerPopup go={go} />
    </div>
  );
}
