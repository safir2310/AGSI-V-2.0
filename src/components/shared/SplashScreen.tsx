"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChickenLogo } from "@/components/logo/ChickenLogo";

/**
 * Animasi pembuka saat aplikasi pertama kali dibuka:
 * maskot ayam 3D pop-in + judul merek, lalu memudar otomatis.
 */
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-brand-gradient"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.45, ease: "easeOut" } }}
      onAnimationComplete={() => {
        // memudar keluar setelah selesai (ditangani induk via AnimatePresence)
      }}
      onClick={onDone}
      role="presentation"
    >
      {/* lingkaran cahaya lembut */}
      <motion.div
        aria-hidden
        className="absolute h-72 w-72 rounded-full bg-white/15 blur-3xl"
        initial={prefersReduced ? false : { scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.1, ease: "easeOut" }}
      />

      <motion.div
        className="relative z-10 flex flex-col items-center gap-3 px-6 text-center"
        initial={prefersReduced ? false : { y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.5, ease: "easeOut" }}
      >
        <ChickenLogo size={168} entrance animated />

        <div className="mt-1">
          <motion.h1
            className="text-2xl font-black uppercase leading-tight tracking-wide text-white drop-shadow-sm"
            initial={prefersReduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.45 }}
          >
            Ayam Geprek
          </motion.h1>
          <motion.p
            className="mt-0.5 inline-block rounded-full bg-white/95 px-4 py-1 text-sm font-extrabold uppercase tracking-widest text-orange-700 shadow-md"
            initial={prefersReduced ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.7, duration: 0.4, type: "spring", stiffness: 300, damping: 20 }}
          >
            Sambal Ijo
          </motion.p>
        </div>

        <motion.p
          className="mt-1 max-w-[240px] text-xs font-medium text-orange-50/90"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.95, duration: 0.4 }}
        >
          Geprek mantap, sambal nendang! 🌶️
        </motion.p>
      </motion.div>

      <motion.p
        className="absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] text-[11px] font-medium text-orange-50/80"
        initial={prefersReduced ? false : { opacity: 0 }}
        animate={{ opacity: [0, 1, 0.6, 1] }}
        transition={{ delay: 1.2, duration: 0.8 }}
      >
        Ketuk untuk masuk
      </motion.p>
    </motion.div>
  );
}
