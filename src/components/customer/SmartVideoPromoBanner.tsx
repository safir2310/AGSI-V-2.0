"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettingsStore, type VideoPromoSlideInfo } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type SmartVideoPromoBannerProps = {
  /** Ketuk slide ber-tautan produk → buka/tonjolkan produk di daftar menu */
  onOpenProduct: (productId: string) => void;
  /** Ketuk slide ber-tautan promo → gulir ke banner promo di atas halaman */
  onOpenPromo: () => void;
};

/**
 * AGSI SMART VIDEO PROMO BANNER (alias Interactive Video Carousel Banner).
 *
 * Carousel video promosi di DASAR halaman Menu — kontennya (video MP4,
 * caption, tautan produk/promo) diatur admin dari Profil → "Banner & Promo" →
 * "AGSI Smart Video Promo Banner". Kemampuan:
 *  - Video berjalan otomatis (autoplay, muted + playsInline agar diizinkan
 *    browser Android/desktop tanpa gesture) — hanya slide yang TERLIHAT
 *    yang diputar; video lain dipaus untuk hemat kuota.
 *  - Video berulang (loop) selama slide-nya terlihat.
 *  - Bisa digeser seperti carousel — scroll-snap native (halus di Android),
 *    plus titik indikator yang bisa diketuk untuk lompat slide.
 *  - Mendukung video MP4 (disajikan server dengan dukungan Range 206 agar
 *    Safari/iOS ikut bisa memutar).
 *  - Bisa diklik untuk membuka produk (gulir & tonjolkan kartu produk) atau
 *    promo (gulir ke carousel banner promo di atas halaman Menu).
 *  - Tampilan responsif Android & desktop — lebar penuh, rasio 16:9,
 *    objek video ter-crop rapi (object-cover).
 *
 * Carousel disembunyikan seluruhnya bila saklar admin nonaktif atau tidak
 * ada satu pun slide ber-video.
 */
export function SmartVideoPromoBanner({ onOpenProduct, onOpenPromo }: SmartVideoPromoBannerProps) {
  const videoPromo = useSettingsStore((s) => s.videoPromo);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const [active, setActive] = useState(0);

  const slides = useMemo(
    () => videoPromo.slides.filter((s) => s.enabled && s.hasVideo && !!s.videoUrl),
    [videoPromo]
  );

  // Jaga index tetap valid bila daftar slide menyusut
  useEffect(() => {
    if (active >= slides.length) setActive(0);
  }, [slides.length, active]);

  // Autoplay & pause: hanya video slide yang terlihat yang berjalan (loop)
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      if (i === active) {
        void v.play().catch(() => {
          // autoplay ditolak browser (mode hemat daya) — biarkan poster netral
        });
      } else {
        v.pause();
      }
    });
  }, [active, slides.length]);

  /** Geser manual (swipe/scroll) → hitung slide aktif dari posisi scroll */
  const handleTrackScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActive(Math.min(Math.max(idx, 0), Math.max(slides.length - 1, 0)));
  }, [slides.length]);

  /** Ketuk titik indikator → lompat ke slide (tetap autoplay di slide itu) */
  const jumpTo = useCallback((i: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }, []);

  const openSlide = useCallback(
    (s: VideoPromoSlideInfo) => {
      if (s.linkType === "product" && s.productId) onOpenProduct(s.productId);
      else if (s.linkType === "promo") onOpenPromo();
    },
    [onOpenProduct, onOpenPromo]
  );

  if (!videoPromo.enabled || slides.length === 0) return null;

  return (
    <section aria-label="AGSI Smart Video Promo Banner" className="mt-7">
      {/* ===== KEPALA BAGIAN ===== */}
      <div className="mb-2.5 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-black text-neutral-900">
            🎬 AGSI Smart Video Promo
          </h2>
          <p className="text-xs text-neutral-400">
            Video berjalan otomatis — geser untuk slide lainnya
          </p>
        </div>
        {/* Titik indikator (bisa diketuk untuk lompat slide) */}
        {slides.length > 1 && (
          <div className="flex items-center gap-1.5 pb-1.5">
            {slides.map((s, i) => (
              <button
                key={s.slot}
                type="button"
                aria-label={`Ke video promo ${i + 1}`}
                onClick={() => jumpTo(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === active
                    ? "w-4 bg-orange-600"
                    : "w-1.5 bg-orange-200 hover:bg-orange-400"
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* ===== CAROUSEL VIDEO (swipe native scroll-snap) ===== */}
      <div
        ref={trackRef}
        onScroll={handleTrackScroll}
        className="relative overflow-x-auto rounded-3xl shadow-lg shadow-orange-600/25 ring-1 ring-orange-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex">
          {slides.map((s, i) => (
            <div key={s.slot} className="w-full shrink-0 snap-center">
              <button
                type="button"
                onClick={() => openSlide(s)}
                aria-label={
                  s.title.trim()
                    ? `Video promo: ${s.title.trim()}`
                    : s.linkType === "product"
                      ? "Video promo — buka produk"
                      : s.linkType === "promo"
                        ? "Video promo — lihat promo"
                        : "Video promo"
                }
                className="group relative block w-full text-left"
              >
                <video
                  ref={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  src={s.videoUrl ?? undefined}
                  muted
                  loop
                  playsInline
                  autoPlay={i === 0}
                  preload={i === 0 ? "auto" : "metadata"}
                  className="aspect-video w-full object-cover"
                />
                {/* Caption admin (opsional) */}
                {s.title.trim() && (
                  <span className="absolute bottom-3 left-3 max-w-[70%] truncate rounded-full bg-neutral-900/55 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/25 backdrop-blur-sm">
                    {s.title.trim()}
                  </span>
                )}
                {/* Badge tautan — petunjuk bahwa slide bisa diketuk */}
                {s.linkType !== "none" && (
                  <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-orange-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-md transition group-hover:bg-orange-700">
                    {s.linkType === "product" ? "🛒 Buka Produk" : "🎁 Lihat Promo"}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
