"use client";

/**
 * PANGGUNG PROMO KINETIC — MODE BARU strip "Promo Hari Ini" di Beranda.
 *
 * Permintaan pemilik: hapus strip lama (poster 3D oranye), ganti ke
 * motion animations — mode baru. Konten (badge/judul/teks) TETAP diatur
 * admin dari Profil → Banner & Promo (kolom settings sama, tanpa migrasi).
 *
 * Koreografi gerak (semua loop dimatikan bila pengguna memilih
 * "kurangi gerakan" / prefersReduced):
 *   - Bingkai cahaya conic berputar tanpa henti di tepi kartu
 *   - Latar gradient sinematik gelap + 2 bola cahaya mengambang
 *   - Judul masuk kata-per-kata (stagger) + denyut glow lembut
 *   - Badge chip dengan titik LIVE berdenyut + kilau menyapu
 *   - Baris penjelas berjalan seperti papan LED (marquee loop)
 *   - Partikel bintang kecil naik perlahan + emoji maskot mengambang
 *   - CTA "Lihat Menu" dengan panah menoleh berkala
 * Terbungkus MotionBox targetKey "promoStrip" — tetap tunduk pada
 * konfigurasi AGSI Motion Studio (master gate, perangkat, perf mode).
 * Klik → halaman Menu (perilaku sama dengan strip lama).
 */

import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { MotionBox } from "@/components/motion/MotionRuntime";
import type { AppView } from "@/lib/store";

/** Partikel bintang naik — konfigurasi TETAP (tanpa Math.random agar SSR
 *  dan render klien identik; variasi cukup dari delay/durasi/posisi). */
const SPARKS = [
  { left: "8%", size: 5, delay: 0.2, dur: 5.2, tone: "bg-amber-300/80" },
  { left: "22%", size: 3, delay: 1.6, dur: 6.1, tone: "bg-orange-200/70" },
  { left: "38%", size: 4, delay: 2.7, dur: 5.6, tone: "bg-yellow-200/80" },
  { left: "55%", size: 3, delay: 0.9, dur: 6.6, tone: "bg-amber-200/70" },
  { left: "68%", size: 5, delay: 3.4, dur: 5.9, tone: "bg-orange-300/75" },
  { left: "81%", size: 3, delay: 2.1, dur: 6.3, tone: "bg-yellow-300/70" },
  { left: "91%", size: 4, delay: 4.0, dur: 5.4, tone: "bg-amber-100/75" },
] as const;

/** Varian stagger untuk judul kata-per-kata. */
const titleWords = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.18 } },
};
const wordItem = {
  hidden: { opacity: 0, y: 16, scale: 0.88 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.38, ease: "easeOut" as const },
  },
};

export function PromoKineticStrip({
  badge,
  title,
  text,
  go,
}: {
  badge: string;
  title: string;
  text: string;
  go: (v: AppView) => void;
}) {
  const prefersReduced = useReducedMotion();
  const words = title ? title.split(/\s+/).filter(Boolean) : [];

  return (
    <button
      onClick={() => go("menu")}
      className="scene-3d press-effect relative block w-full text-left"
      aria-label={`Promo: ${title || badge || "Promo Hari Ini"} — buka menu`}
    >
      <MotionBox
        targetKey="promoStrip"
        shimmerClassName="bg-gradient-to-r from-transparent via-white/25 to-transparent"
        className="w-full"
      >
        {/* Bingkai cahaya berputar: kartu gelap di atas glow conic yang
            berotasi — identitas visual "mode baru" yang jelas beda. */}
        <div className="relative rounded-3xl p-[2px] shadow-[0_26px_48px_-14px_rgba(120,20,5,0.7)]">
          {!prefersReduced && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl"
            >
              <motion.div
                className="absolute left-1/2 top-1/2 h-[160%] w-[160%] -translate-x-1/2 -translate-y-1/2"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent 0deg 210deg, rgba(245,158,11,0.9) 290deg, rgba(255,255,255,0.95) 330deg, transparent 360deg)",
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
              />
            </div>
          )}

          {/* Isi panggung */}
          <div className="relative overflow-hidden rounded-[calc(1.5rem-2px)] bg-gradient-to-br from-orange-950 via-red-950 to-neutral-950 px-5 pb-6 pt-6">
            {/* Latar hidup: dua bola cahaya mengambang */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -left-12 -top-12 h-44 w-44 rounded-full bg-orange-500/25 blur-2xl"
              animate={prefersReduced ? undefined : { x: [0, 16, 0], y: [0, 10, 0], scale: [1, 1.14, 1] }}
              transition={{ duration: 8.5, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -bottom-14 right-0 h-40 w-40 rounded-full bg-amber-400/20 blur-2xl"
              animate={prefersReduced ? undefined : { x: [0, -14, 0], y: [0, -12, 0], scale: [1, 1.18, 1] }}
              transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1.1 }}
            />
            {/* Partikel bintang naik perlahan */}
            {!prefersReduced &&
              SPARKS.map((s, i) => (
                <motion.span
                  key={i}
                  aria-hidden
                  className={`pointer-events-none absolute bottom-0 rounded-full ${s.tone}`}
                  style={{ left: s.left, width: s.size, height: s.size }}
                  animate={{ y: [0, -150], opacity: [0, 1, 1, 0] }}
                  transition={{
                    duration: s.dur,
                    repeat: Infinity,
                    delay: s.delay,
                    ease: "easeOut",
                  }}
                />
              ))}
            {/* Emoji maskot mengambang */}
            <motion.div
              aria-hidden
              className="float-3d pointer-events-none absolute -right-3 -top-7 select-none text-[80px] leading-none opacity-90"
              animate={prefersReduced ? undefined : { y: [0, -10, 0], rotate: [0, 7, 0] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
            >
              🌶️
            </motion.div>
            <motion.div
              aria-hidden
              className="float-3d pointer-events-none absolute bottom-14 right-20 select-none text-[46px] leading-none opacity-85"
              animate={prefersReduced ? undefined : { y: [0, 9, 0], rotate: [0, -9, 0] }}
              transition={{ duration: 6.8, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
            >
              🍗
            </motion.div>
            {/* Kilau menyapu berkala */}
            {!prefersReduced && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-12deg] bg-gradient-to-r from-transparent via-white/30 to-transparent"
                animate={{ x: ["0%", "480%"] }}
                transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 3.2, ease: "easeInOut" }}
              />
            )}

            {/* Konten */}
            <div className="relative max-w-[78%]">
              {badge.trim() && (
                <motion.span
                  initial={prefersReduced ? false : { opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-300 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-orange-950 ring-1 ring-amber-200/80"
                >
                  {/* titik LIVE berdenyut */}
                  <span className="relative flex h-2 w-2">
                    {!prefersReduced && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-600 opacity-75" />
                    )}
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-700" />
                  </span>
                  {badge.trim()}
                </motion.span>
              )}
              {words.length > 0 && (
                <motion.p
                  variants={prefersReduced ? undefined : titleWords}
                  initial={prefersReduced ? false : "hidden"}
                  animate="show"
                  className="mt-2 text-[26px] font-black leading-[1.08] text-white"
                  style={
                    prefersReduced
                      ? undefined
                      : { textShadow: "0 0 18px rgba(251,146,60,0.35)" }
                  }
                >
                  {words.map((w, i) => (
                    <motion.span
                      key={`${w}-${i}`}
                      variants={prefersReduced ? undefined : wordItem}
                      className={`mr-[0.28em] inline-block ${
                        i % 3 === 1 ? "text-amber-300" : i % 3 === 2 ? "text-orange-200" : ""
                      }`}
                    >
                      {w}
                    </motion.span>
                  ))}
                </motion.p>
              )}
              {/* CTA kecil dengan panah menoleh */}
              <motion.span
                initial={prefersReduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.68, duration: 0.4, ease: "easeOut" }}
                className="mt-3.5 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white ring-1 ring-white/25"
              >
                Lihat Menu
                <motion.span
                  aria-hidden
                  animate={prefersReduced ? undefined : { x: [0, 5, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </motion.span>
              </motion.span>
            </div>
            {/* Papan LED: baris penjelas berjalan mulus selebar panggung —
                konten digandakan persis 2x (tiap salinan diberi padding kanan
                sama) agar geser -50% loop tanpa terlihat putus. */}
            {text.trim() && (
              <motion.div
                initial={prefersReduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.4, ease: "easeOut" }}
                className="relative mt-4 overflow-hidden rounded-full bg-black/45 ring-1 ring-white/15 backdrop-blur-sm"
              >
                <motion.div
                  className="flex w-max items-center whitespace-nowrap"
                  animate={prefersReduced ? undefined : { x: ["0%", "-50%"] }}
                  transition={{ duration: 11, repeat: Infinity, ease: "linear" }}
                >
                  <span className="py-1.5 pl-4 pr-8 text-[11px] font-bold text-amber-200/90">
                    {text.trim()}
                  </span>
                  <span
                    aria-hidden
                    className="py-1.5 pl-4 pr-8 text-[11px] font-bold text-amber-200/90"
                  >
                    {text.trim()}
                  </span>
                </motion.div>
              </motion.div>
            )}
            {/* Alas bayangan — panggung berdiri di atas permukaan */}
            <div className="pointer-events-none absolute inset-x-8 -bottom-3 h-7 rounded-full bg-orange-950/60 blur-lg" />
          </div>
        </div>
      </MotionBox>
    </button>
  );
}
