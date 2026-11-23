"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";

import { useSettingsStore, type BannerInfo } from "@/lib/hooks";
import type { AppView } from "@/lib/store";

type BannerPopupProps = {
  go: (v: AppView) => void;
};

/**
 * POPUP BANNER BERANDA — poster promo besar (mengikuti desain referensi
 * pemilik: popup promo Alfagift/Frestea Vaganza).
 *
 * Konten diatur admin dari Profil Admin → "Popup Banner Beranda"
 * (aktif/nonaktif + upload gambar + judul & pesan).
 *
 * Struktur mengikuti referensi:
 *  - Kartu poster PORTRAIT, latar gradien orange AGSI + ornamen pola titik
 *    halftone & lengkung putih tipis.
 *  - Zona gambar di atas: bingkai putih membulat, rasio 4:5 (portrait).
 *    (Chip teks "PROMO" dihapus — permintaan pemilik: poster bersih tanpa
 *    label tambahan; kartu diperkecil sedikit 88vw→80vw / 21rem→19rem.)
 *  - Judul pada PILL putih miring (gaya pill "FRESTEA/VAGANZA") + blok teks
 *    syarat putih tebal rata tengah.
 *  - Tombol CTA besar "BELANJA YUK!" amber dengan bevel 3D, posisinya DI
 *    BAWAH kartu (di atas overlay), ketuk → buka Menu.
 *  - Tombol tutup: lingkaran PUTIH ✕ hitam di tepi kanan-atas kartu.
 *  - Overlay gelap ±70% + blur — Beranda tetap terlihat redup di belakang.
 *
 * Aturan tampil (dipertahankan dari versi lama):
 *  - Hanya di Beranda, saat banner AKTIF dan punya gambar ATAU judul.
 *  - Muncul 1x per sesi browser untuk tiap versi banner (kunci sessionStorage
 *    memakai bannerVersion) — admin menyimpan banner baru → versi naik →
 *    popup tampil lagi.
 *  - Delay ±700ms agar hero sempat tampil dulu (terasa natural, bukan flash).
 */
export function BannerPopup({ go }: BannerPopupProps) {
  const prefersReduced = useReducedMotion();
  const banner = useSettingsStore((s) => s.banner);
  const settingsLoaded = useSettingsStore((s) => s.loaded);

  const [open, setOpen] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);

  // Pastikan pengaturan termuat (load() aman dipanggil berulang — skip bila sudah)
  useEffect(() => {
    void useSettingsStore.getState().load();
  }, []);

  // Buka popup: banner aktif + ada yang ditampilkan + belum pernah tampil di sesi ini
  useEffect(() => {
    if (!settingsLoaded) return;
    if (!shouldShow(banner)) return;
    // beri jeda agar hero terlihat dulu
    const t = setTimeout(() => setOpen(true), 700);
    return () => clearTimeout(t);
  }, [settingsLoaded, banner]);

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      if (banner.bannerVersion) {
        sessionStorage.setItem(seenKey(banner.bannerVersion), "1");
      }
    } catch {
      // sessionStorage tidak tersedia (mode privat) — popup tetap bisa ditutup
    }
  }, [banner.bannerVersion]);

  const handleCta = useCallback(() => {
    dismiss();
    go("menu");
  }, [dismiss, go]);

  // Kartu tampil bila ada gambar ATAU teks — dua-duanya rusak/kosong → jangan tampil
  const showImage = !!banner.bannerImageUrl && !imgBroken;
  const showText = !!banner.bannerTitle || !!banner.bannerText;
  const visible = open && (showImage || showText);

  // Portal ke <body> agar popup tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          key="banner-popup-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="scene-3d fixed inset-0 z-[90] flex items-center justify-center bg-neutral-900/70 p-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Banner promo"
          onClick={(e) => {
            if (e.target === e.currentTarget) dismiss();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { scale: 0.82, y: 34, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={prefersReduced ? undefined : { scale: 0.9, y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 24 }}
            className="relative flex w-full max-w-[min(80vw,19rem)] flex-col items-center"
          >
            {/* Tombol tutup — lingkaran putih ✕ di tepi kanan-atas kartu (di luar kartu, seperti referensi) */}
            <button
              onClick={dismiss}
              aria-label="Tutup banner"
              className="press-effect absolute -right-2 -top-3.5 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-900 shadow-[0_8px_20px_rgba(0,0,0,0.45)] ring-1 ring-neutral-900/10 transition hover:bg-neutral-100"
            >
              <X className="h-4.5 w-4.5" strokeWidth={2.75} />
            </button>

            {/* Kartu poster portrait — ketuk kartu = buka menu */}
            <button
              onClick={handleCta}
              aria-label="Buka menu"
              className="tilt-3d relative w-full overflow-hidden rounded-[26px] bg-gradient-to-b from-orange-400 via-orange-500 to-orange-600 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.55)] ring-1 ring-orange-200/60"
            >
              {/* Ornamen latar: pola titik halftone + lengkung putih tipis (seperti referensi) */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.16)_1.5px,transparent_1.5px)] [background-size:17px_17px]"
              />
              <svg
                aria-hidden
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 w-full text-white/20"
              >
                <path d="M0,60 C25,40 75,80 100,55 L100,100 L0,100 Z" fill="currentColor" opacity="0.45" />
                <path d="M0,70 C30,50 70,85 100,62" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>

              {/* Zona gambar atas — bingkai putih membulat (tanpa chip teks agar
                  poster dari admin tampil bersih penuh) */}
              {showImage && (
                <div className="relative m-3 mb-0 overflow-hidden rounded-2xl ring-[3px] ring-white/70">
                  <img
                    src={banner.bannerImageUrl ?? ""}
                    alt={banner.bannerTitle ?? "Banner promo AGSI"}
                    onError={() => setImgBroken(true)}
                    className="aspect-[4/5] max-h-[46dvh] w-full object-cover"
                  />
                </div>
              )}

              {/* Judul pill miring + blok teks syarat — putih tebal rata tengah */}
              {showText && (
                <div
                  className={
                    "relative flex flex-col items-center px-5 pb-5 text-center " +
                    (showImage ? "pt-4" : "justify-center py-10")
                  }
                >
                  {banner.bannerTitle && (
                    <h2 className="-rotate-2 rounded-2xl bg-white px-5 py-1.5 text-lg font-black uppercase italic leading-tight text-orange-600 shadow-[0_10px_20px_rgba(0,0,0,0.28)]">
                      {banner.bannerTitle}
                    </h2>
                  )}
                  {banner.bannerText && (
                    <p className="mt-3 line-clamp-8 whitespace-pre-line text-[11px] font-bold leading-relaxed text-white">
                      {banner.bannerText}
                    </p>
                  )}
                </div>
              )}

              {/* Tanpa teks: beri ruang aman bawah agar kartu tetap proporsional */}
              {!showText && showImage && <div className="h-3" />}
            </button>

            {/* CTA besar DI BAWAH kartu — amber dengan bevel 3D (seperti referensi "BELANJA YUK!") */}
            <button
              onClick={handleCta}
              className="press-effect relative mt-4 flex h-12 w-[62%] items-center justify-center rounded-2xl bg-amber-400 text-sm font-black uppercase tracking-[0.08em] text-neutral-900 shadow-[0_7px_0_0_rgb(180_83_9/95),0_18px_30px_rgba(0,0,0,0.35)] transition hover:bg-amber-300 active:translate-y-[4px] active:shadow-[0_3px_0_0_rgb(180_83_9/95),0_10px_20px_rgba(0,0,0,0.3)]"
            >
              Belanja Yuk!
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/** Kunci "sudah tampil" per versi banner — banner baru otomatis tampil lagi. */
function seenKey(version: string) {
  return `agsi-banner-seen-${version}`;
}

function shouldShow(b: BannerInfo): boolean {
  if (!b.bannerEnabled) return false;
  // butuh minimal satu konten: gambar ATAU judul
  if (!b.bannerImageUrl && !b.bannerTitle) return false;
  if (!b.bannerVersion) return true; // tanpa versi → tampil (mis. data lama)
  try {
    return sessionStorage.getItem(seenKey(b.bannerVersion)) !== "1";
  } catch {
    return true;
  }
}
