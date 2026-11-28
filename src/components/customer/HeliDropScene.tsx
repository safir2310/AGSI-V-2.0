"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/** ===== LANGIT ANIMASI: HELI ANTAR PAKET — pasangan adegan jalan animasi
    (CourierScene, bagian atas beranda) dengan MODEL LAIN: helikopter
    kurir mengantar paket lewat langit. Murni dekorasi, tanpa konfigurasi
    admin, satu siklus 10 detik yang sinkron penuh:
    heli masuk dari kiri → MENGAMBAT di titik antar → tali-tali turun,
    paket 📦 diturunkan ke tanpa s/d mendarat (debunan debu) → chip
    "TIBA! 📦" meletup → heli terbang pergi ke kanan (tanpa paket) →
    paket memudar menjelang akhir siklus agar siklus berikutnya mulai bersih.
    Semua elemen utama (heli, tali, paket, chip, garis angin) memakai
    keyframe satu-siklus times 0→1 berdurasi sama → selalu selaras.
    Awan, burung, uap, rotor & goyangan heli = loop kecil independen.
    aria-hidden + pointer-events-none; reduced-motion → komposisi statis. */

const CYCLE = 10; // detik satu siklus adegan
const HELI_SIZE = "text-[52px]";

export function HeliDropScene() {
  const prefersReduced = useReducedMotion();

  /** Lebar strip langit (px) — diukur sekali + ResizeObserver, pola sama
      dengan CourierScene agar titik mendarat paket pas di semua layar */
  const skyRef = useRef<HTMLElement>(null);
  const [skyW, setSkyW] = useState(343);
  useEffect(() => {
    const el = skyRef.current;
    if (!el) return;
    const measure = () => setSkyW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Lintasan heli (px dari tepi kiri strip): masuk → mengambang di titik antar
  // → keluar kanan (20 px di luar strip agar garis angin tak tertinggal).
  const parkX = skyW - 110; // titik antar agak ke kiri agar paket + rumah muat
  const heliX = [-90, parkX, parkX, skyW + 20];

  // Titik pendaratan paket — di bawah lambung heli saat mengambang
  const dropX = parkX + 18;

  return (
    <section
      ref={skyRef}
      aria-hidden
      className="relative mx-4 h-20 overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-b from-sky-50/90 via-cyan-50/60 to-amber-50/40 shadow-sm"
    >
      {/* Matahari + pemandangan tepi langit — heli melaju menuju rumah pelanggan */}
      <span className="pointer-events-none absolute right-3 top-1.5 select-none text-lg leading-none opacity-70">
        ☀️
      </span>
      <span className="pointer-events-none absolute left-2 bottom-3 select-none text-base leading-none opacity-60">
        🌲
      </span>
      <span className="pointer-events-none absolute left-12 bottom-3 select-none text-sm leading-none opacity-50">
        🌳
      </span>
      <span className="pointer-events-none absolute right-2 bottom-2.5 select-none text-2xl leading-none opacity-90">
        🏠
      </span>

      {/* Rumput halaman — "landasan" pendaratan paket (padanan permukaan jalan) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-1.5 h-2 rounded-full bg-gradient-to-r from-green-200/90 via-green-300/70 to-green-200/90" />

      {/* Awan yang bergeser pelan — dua lapis dengan kecepatan berbeda */}
      <motion.span
        className="pointer-events-none absolute top-2 select-none text-base leading-none opacity-70"
        animate={prefersReduced ? undefined : { x: [-50, skyW + 40] }}
        transition={{ duration: 24, ease: "linear", repeat: Infinity }}
      >
        ☁️
      </motion.span>
      <motion.span
        className="pointer-events-none absolute top-8 select-none text-sm leading-none opacity-45"
        animate={prefersReduced ? undefined : { x: [skyW + 40, -60] }}
        transition={{ duration: 34, ease: "linear", repeat: Infinity }}
      >
        ☁️
      </motion.span>

      {/* Burung kecil menyusuri langit searah berlawanan — hidupkan adegan */}
      <motion.span
        className="pointer-events-none absolute top-4 select-none text-[11px] leading-none opacity-60"
        animate={prefersReduced ? undefined : { x: [skyW + 30, -40], y: [0, -4, 3, 0] }}
        transition={{ duration: 13, ease: "linear", repeat: Infinity }}
      >
        🐦
      </motion.span>

      {/* Heli + tali + paket digabung dalam satu wrapper horizontal;
          turun-naik paket dianimasikan pada sub-elemen agar independen */}
      <motion.div
        className="absolute bottom-5 left-0"
        style={prefersReduced ? { transform: `translateX(${parkX}px)` } : undefined}
        animate={prefersReduced ? undefined : { x: [...heliX, heliX[3]] }}
        transition={{
          duration: CYCLE,
          times: [0, 0.16, 0.62, 0.82, 1],
          ease: ["easeOut", "linear", "easeIn", "linear"],
          repeat: Infinity,
        }}
      >
        <motion.div
          className="relative"
          animate={prefersReduced ? undefined : { y: [0, -3, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* Tali angkut — memanjang saat paket diturunkan, menarik diri saat heli berangkat */}
          <motion.div
            className="absolute left-[24px] top-[34px] w-[2px] origin-top bg-neutral-500/70"
            style={{ height: 30 }}
            animate={prefersReduced ? undefined : { scaleY: [0, 0, 1, 1, 0, 0] }}
            transition={{
              duration: CYCLE,
              times: [0, 0.16, 0.19, 0.33, 0.37, 1],
              ease: "linear",
              repeat: Infinity,
            }}
          />
          {/* Badan heli — emoji dibalik agar menghadap kanan (arah terbang) */}
          <span
            className={`block select-none ${HELI_SIZE} leading-none drop-shadow-md`}
            style={{ transform: "scaleX(-1)" }}
          >
            🚁
          </span>
          {/* Bilah rotor — oval putih memudar-mengeras cepat: ilusi baling-baling */}
          <motion.span
            className="pointer-events-none absolute left-[10px] top-[2px] h-[3px] w-9 rounded-full bg-white/70"
            animate={prefersReduced ? undefined : { scaleX: [1, 0.25, 1], opacity: [0.75, 0.35, 0.75] }}
            transition={{ duration: 0.22, repeat: Infinity, ease: "linear" }}
          />
          {/* Garis angin — hanya saat heli bergerak (masuk & pergi) */}
          <motion.div
            className="absolute inset-0"
            style={prefersReduced ? { opacity: 0 } : undefined}
            animate={prefersReduced ? undefined : { opacity: [1, 0, 0, 1, 0, 0] }}
            transition={{
              duration: CYCLE,
              times: [0, 0.14, 0.64, 0.66, 0.82, 1],
              ease: "linear",
              repeat: Infinity,
            }}
          >
            <motion.span
              className="pointer-events-none absolute left-0 top-5 h-[3px] w-5 rounded-full bg-white/80"
              animate={prefersReduced ? undefined : { x: [4, -8, -20], opacity: [0, 0.95, 0] }}
              transition={{ duration: 0.5, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.span
              className="pointer-events-none absolute left-0 top-9 h-[3px] w-3.5 rounded-full bg-white/60"
              animate={prefersReduced ? undefined : { x: [4, -6, -16], opacity: [0, 0.8, 0] }}
              transition={{ duration: 0.42, repeat: Infinity, ease: "easeOut", delay: 0.22 }}
            />
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Paket 📦 — diturunkan tali ke titik pendarat, bertahan di rumput,
          memudar menjelang akhir siklus agar siklus berikut mulai bersih */}
      <motion.div
        className="absolute bottom-2.5"
        style={{ left: dropX }}
        animate={
          prefersReduced
            ? { opacity: 1 }
            : {
                y: [-30, -30, 0, 0, 0, 0],
                opacity: [0, 0, 1, 1, 1, 0, 0],
              }
        }
        transition={
          prefersReduced
            ? undefined
            : {
                duration: CYCLE,
                times: [0, 0.16, 0.34, 0.38, 0.9, 0.955, 1],
                ease: ["linear", "easeOut", "linear", "linear", "linear", "linear"],
                repeat: Infinity,
              }
        }
      >
        <span className="block select-none text-lg leading-none drop-shadow-sm">📦</span>
        {/* Uap panas — paket baru saja turun dari dapur */}
        <motion.span
          className="pointer-events-none absolute -top-2 left-2 select-none text-[10px] leading-none opacity-60"
          animate={prefersReduced ? undefined : { y: [0, -6], opacity: [0.6, 0] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
        >
          💨
        </motion.span>
        {/* Debunan debu saat paket mendarat — meletup sekali per siklus */}
        <motion.span
          className="pointer-events-none absolute -bottom-0.5 -left-2 h-1.5 w-1.5 rounded-full bg-amber-200/90"
          animate={prefersReduced ? undefined : { x: [-8, 2], scale: [0.5, 1.4], opacity: [0, 0.8, 0] }}
          transition={{
            duration: 0.7,
            times: [0, 0.3, 1],
            repeat: Infinity,
            repeatDelay: CYCLE - 0.7,
            delay: CYCLE * 0.34,
            ease: "easeOut",
          }}
        />
        <motion.span
          className="pointer-events-none absolute -bottom-0.5 -right-2 h-1.5 w-1.5 rounded-full bg-amber-200/90"
          animate={prefersReduced ? undefined : { x: [8, -2], scale: [0.5, 1.4], opacity: [0, 0.8, 0] }}
          transition={{
            duration: 0.7,
            times: [0, 0.3, 1],
            repeat: Infinity,
            repeatDelay: CYCLE - 0.7,
            delay: CYCLE * 0.36,
            ease: "easeOut",
          }}
        />
      </motion.div>

      {/* Chip "TIBA! 📦" — padanan BOOM! pada adegan kurir: meletup setelah
          paket mendarat, bertahan sebentar, lalu mengecil hilang */}
      <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
        <motion.span
          className="block rounded-full bg-green-600 px-2.5 py-1 text-[10px] font-black uppercase leading-none tracking-wider text-white shadow-lg ring-2 ring-white/70"
          style={prefersReduced ? { opacity: 1 } : undefined}
          animate={
            prefersReduced
              ? undefined
              : {
                  scale: [0.5, 0.5, 1.14, 1, 0.9, 0.9],
                  opacity: [0, 0, 1, 1, 0, 0],
                  rotate: [-8, -8, 2, 0, 0, 0],
                }
          }
          transition={{
            duration: CYCLE,
            times: [0, 0.42, 0.455, 0.7, 0.75, 1],
            ease: ["linear", "easeOut", "easeOut", "linear", "linear"],
            repeat: Infinity,
          }}
        >
          TIBA! 📦
        </motion.span>
      </div>
    </section>
  );
}
