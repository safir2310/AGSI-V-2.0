"use client";

import { motion, useReducedMotion, type TargetAndTransition, type Transition } from "framer-motion";
import { ChickenLogo } from "@/components/logo/ChickenLogo";
import { MOTION_SPLASH_EFFECTS } from "@/lib/motion-config";

/**
 * Animasi pembuka saat aplikasi pertama kali dibuka:
 * maskot/logo + judul merek, lalu memudar otomatis.
 *
 * AGSI MOTION STUDIO: varian animasi logo dikendalikan konfigurasi target
 * "splash" (Profil Admin → AGSI Motion Studio) — pop/glow/spin/bounce/
 * cinematic/loader; "none" = tampil statis; efek tak dikenal → pop (bawaan).
 */
export function SplashScreen({
  onDone,
  effect = "pop",
}: {
  onDone: () => void;
  /** kunci efek dari MOTION_SPLASH_EFFECTS */
  effect?: string;
}) {
  const prefersReduced = useReducedMotion();
  const fx = (MOTION_SPLASH_EFFECTS as readonly string[]).includes(effect) ? effect : "pop";
  const on = !prefersReduced && fx !== "none";

  // Varian pembungkus logo
  const logoInitial = !on
    ? undefined
    : fx === "cinematic"
      ? { opacity: 0, filter: "blur(10px)", scale: 1.08 }
      : fx === "spin"
        ? { opacity: 0, rotate: -180, scale: 0.6 }
        : { opacity: 0, scale: 0.55 };
  const logoAnimate = !on
    ? undefined
    : fx === "cinematic"
      ? { opacity: 1, filter: "blur(0px)", scale: 1 }
      : fx === "spin"
        ? { opacity: 1, rotate: 0, scale: 1 }
        : { opacity: 1, scale: 1 };
  const logoTransition: Transition | undefined = !on
    ? undefined
    : fx === "spin"
      ? { duration: 0.9, ease: "easeOut" }
      : fx === "cinematic"
        ? { duration: 1.1, ease: "easeInOut" }
        : { type: "spring", stiffness: 260, damping: 18, delay: 0.1 };

  // Loop ambient per varian
  const logoLoop: { animate: TargetAndTransition; transition: Transition } | undefined =
    !on || fx === "none" || fx === "loader"
      ? undefined
      : fx === "glow"
        ? {
            animate: { filter: ["drop-shadow(0 0 0px rgba(255,255,255,0.9))", "drop-shadow(0 0 22px rgba(255,237,213,0.95))", "drop-shadow(0 0 0px rgba(255,255,255,0.9))"] },
            transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" },
          }
        : fx === "bounce"
          ? { animate: { y: [0, -12, 0] }, transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" } }
          : fx === "spin"
            ? { animate: { rotate: [0, 8, -8, 0] }, transition: { duration: 3.2, repeat: Infinity, ease: "easeInOut" } }
            : undefined;

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-brand-gradient"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.45, ease: "easeOut" } }}
      onClick={onDone}
      role="presentation"
    >
      {/* lingkaran cahaya lembut */}
      <motion.div
        aria-hidden
        className="absolute h-72 w-72 rounded-full bg-white/15 blur-3xl"
        initial={!on ? undefined : { scale: 0.5, opacity: 0 }}
        animate={!on ? undefined : { scale: 1, opacity: 1 }}
        transition={!on ? undefined : { duration: 1.1, ease: "easeOut" }}
      />

      <motion.div
        className="relative z-10 flex flex-col items-center gap-3 px-6 text-center"
        initial={!on ? undefined : { y: 20, opacity: 0 }}
        animate={!on ? undefined : { y: 0, opacity: 1 }}
        transition={!on ? undefined : { delay: 0.15, duration: 0.5, ease: "easeOut" }}
      >
        <motion.div
          animate={logoLoop?.animate}
          transition={logoLoop?.transition}
          className="will-change-transform"
        >
          <motion.div
            initial={logoInitial}
            animate={logoAnimate}
            transition={logoTransition}
          >
            <ChickenLogo size={168} entrance={!on ? false : undefined} animated={false} />
          </motion.div>
        </motion.div>

        <div className="mt-1">
          <motion.h1
            className="text-2xl font-black uppercase leading-tight tracking-wide text-white drop-shadow-sm"
            initial={!on ? undefined : { opacity: 0, y: 10 }}
            animate={!on ? undefined : { opacity: 1, y: 0 }}
            transition={!on ? undefined : { delay: 0.45, duration: 0.45 }}
          >
            Ayam Geprek
          </motion.h1>
          <motion.p
            className="mt-0.5 inline-block rounded-full bg-white/95 px-4 py-1 text-sm font-extrabold uppercase tracking-widest text-orange-700 shadow-md"
            initial={!on ? undefined : { opacity: 0, scale: 0.8 }}
            animate={!on ? undefined : { opacity: 1, scale: 1 }}
            transition={!on ? undefined : { delay: 0.7, duration: 0.4, type: "spring", stiffness: 300, damping: 20 }}
          >
            Sambal Ijo
          </motion.p>
        </div>

        {/* Varian "loader": titik-titik berdenyut di bawah logo (loading pakai logo AGSI) */}
        {fx === "loader" && on && (
          <div className="mt-2 flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-2 w-2 rounded-full bg-white/90"
                animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
              />
            ))}
          </div>
        )}

        <motion.p
          className="mt-1 max-w-[240px] text-xs font-medium text-orange-50/90"
          initial={!on ? undefined : { opacity: 0 }}
          animate={!on ? undefined : { opacity: 1 }}
          transition={!on ? undefined : { delay: 0.95, duration: 0.4 }}
        >
          Geprek mantap, sambal nendang! 🌶️
        </motion.p>
      </motion.div>

      <motion.p
        className="absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] text-[11px] font-medium text-orange-50/80"
        initial={!on ? undefined : { opacity: 0 }}
        animate={!on ? { opacity: 1 } : { opacity: [0, 1, 0.6, 1] }}
        transition={!on ? undefined : { delay: 1.2, duration: 0.8 }}
      >
        Ketuk untuk masuk
      </motion.p>
    </motion.div>
  );
}
