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
 * POPUP BANNER BERANDA — GAMBAR SAJA (tanpa teks).
 *
 * Konten diatur admin dari Profil Admin → "Popup Banner Beranda"
 * (aktif/nonaktif + upload gambar persegi 1:1).
 *
 * Aturan tampil:
 *  - Hanya di Beranda, saat banner AKTIF dan punya GAMBAR (tanpa gambar
 *    popup tidak tampil — teks memang dihapus dari popup).
 *  - Ukuran kotak 1:1 (persegi penuh), selebar mungkin di layar.
 *  - Muncul 1x per sesi browser untuk tiap versi banner (kunci sessionStorage
 *    memakai bannerUpdatedAt) — admin menyimpan banner baru → versi naik →
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

  // Popup hanya berisi gambar 1:1 — tanpa gambar, popup tidak tampil
  const showImage = !!banner.bannerImageUrl && !imgBroken;
  const visible = open && showImage;

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
            className="relative w-full max-w-[min(94vw,30rem)]"
          >
            {/* Kartu poster 3D — papan miring dengan kedalaman berlapis */}
            <div className="tilt-3d overflow-hidden rounded-3xl bg-white shadow-[0_30px_60px_-12px_rgba(0,0,0,0.55)] ring-1 ring-orange-100">
            {/* Tombol tutup */}
            <button
              onClick={dismiss}
              aria-label="Tutup banner"
              className="press-effect absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900/45 text-white backdrop-blur-sm transition hover:bg-neutral-900/65"
            >
              <X className="h-4.5 w-4.5" />
            </button>

            {/* Gambar banner — kotak penuh 1:1, ketuk untuk buka menu */}
            {showImage && (
              <button
                onClick={handleCta}
                aria-label="Buka menu"
                className="block w-full cursor-pointer"
                tabIndex={-1}
              >
                <img
                  src={banner.bannerImageUrl ?? ""}
                  alt={banner.bannerTitle ?? "Banner promo AGSI"}
                  onError={() => setImgBroken(true)}
                  className="aspect-square w-full object-cover"
                />
              </button>
            )}
            </div>
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
  // popup kini gambar saja — tanpa gambar, tidak tampil
  if (!b.bannerImageUrl) return false;
  if (!b.bannerVersion) return true; // tanpa versi → tampil (mis. data lama)
  try {
    return sessionStorage.getItem(seenKey(b.bannerVersion)) !== "1";
  } catch {
    return true;
  }
}
