"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { CourierAnimInfo } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/** Konfeti animasi "BOOM!" ulang tahun — arah & warna tetap (deterministik),
    warna mengikuti brand: oranye + hijau sambal + aksen pesta. */
const CONFETTI = [
  { cls: "bg-amber-400 rounded-full", dx: 28, dy: -18, dur: 1.0 },
  { cls: "bg-orange-500 rounded-[2px]", dx: -26, dy: -22, dur: 1.1 },
  { cls: "bg-green-500 rounded-full", dx: 34, dy: 4, dur: 1.15 },
  { cls: "bg-sky-400 rounded-[2px]", dx: -32, dy: 8, dur: 0.95 },
  { cls: "bg-pink-400 rounded-full", dx: 14, dy: -32, dur: 1.05 },
  { cls: "bg-yellow-300 rounded-[2px]", dx: -14, dy: -30, dur: 1.2 },
];

/** Garis waktu satu siklus adegan kurir (fraksi 0–1 dari durasi siklus detik).
    Motor, spanduk tipografi kinetik, dan ledakan BOOM memakai siklus yang
    sama agar selalu sinkron: masuk → berhenti → teks tampil → boom → pergi.
    boomAt = mulai ledakan (0,4375 × siklus); lama ledakan 0,175 × siklus
    sehingga selalu selesai sebelum motor berangkat (departAt = 0,625) di
    semua nilai kecepatan yang diizinkan admin (6–12 dtk). */
const RIDE = {
  stopAt: 0.15,
  departAt: 0.625,
  goneAt: 0.8375,
  textIn: 0.1625,
  textOut: 0.65,
  textGone: 0.775,
  boomAt: 0.4375,
};

/** Kata muncul berurutan kiri → kanan: jeda antar kata & lama pop-up (fraksi siklus) */
const WORD_STAGGER = 0.045;
const WORD_POP = 0.055;
/** Waktu mulai pop-up kata ke-i (fraksi siklus) */
const wordIn = (i: number) => RIDE.textIn + 0.02 + i * WORD_STAGGER;

/** Stack font per pilihan admin — undefined = font aplikasi (Geist Sans). */
const FONT_STACKS: Record<CourierAnimInfo["font"], string | undefined> = {
  default: undefined,
  serif: "Georgia, 'Times New Roman', serif",
  mono: "var(--font-geist-mono), ui-monospace, Menlo, monospace",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

/** Kelas Tailwind ketebalan huruf (statis agar terjangkau JIT). */
const WEIGHT_CLASS: Record<CourierAnimInfo["weight"], string> = {
  bold: "font-bold",
  extrabold: "font-extrabold",
  black: "font-black",
};

/** Kelas Tailwind warna teks di atas kapsul putih (statis agar terjangkau JIT). */
const TEXT_COLORS: Record<CourierAnimInfo["textColor"], string> = {
  orange: "text-orange-600",
  red: "text-red-600",
  rose: "text-rose-600",
  amber: "text-amber-600",
  green: "text-green-600",
  blue: "text-blue-600",
  violet: "text-violet-600",
  neutral: "text-neutral-800",
};

type SceneWord = { text: string; accent: boolean };

/** Kata spanduk dari teks admin — dipotong per kata (maks 5), kata TERAKHIR
    diberi aksen; teks kosong → kembali ke teks bawaan brand. */
function splitBannerWords(text: string): SceneWord[] {
  const ws = text.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const list = ws.length > 0 ? ws : ["Ayam", "Geprek", "Sambal", "Ijo"];
  return list.map((t, i) => ({ text: t, accent: i === list.length - 1 }));
}

export function CourierScene({ cfg }: { cfg: CourierAnimInfo }) {
  const prefersReduced = useReducedMotion();
  const words = useMemo(() => splitBannerWords(cfg.text), [cfg.text]);

  /** Lebar strip jalan (px) — diukur sekali (bukan tiap frame) agar posisi
      berhenti motor + spanduk pas terlihat penuh di semua ukuran layar */
  const roadRef = useRef<HTMLElement>(null);
  const [roadW, setRoadW] = useState(343);
  useEffect(() => {
    const el = roadRef.current;
    if (!el) return;
    const measure = () => setRoadW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Lintasan motor (px dari tepi kiri strip): masuk → berhenti → keluar kanan.
  // Titik akhir sengaja 20 px di luar strip agar tali towbow & asap knalpot
  // (yang mencuat ±12 px ke kiri motor) tidak tertinggal di tepi kanan selama
  // motor "pergi".
  // CATATAN: setiap keyframe di bawah wajib membentang times 0→1 (dengan
  // keyframe "tahan" eksplisit di kedua ujung). framer-motion memakai WAAPI
  // untuk opacity/filter/clip-path; bila times tidak berakhir di 1, nilainya
  // terinterpolasi kembali ke gaya dasar sebelum siklus selesai → teks muncul
  // lagi setelah motor pergi (terverifikasi lewat scripts/kin_timeline.js).
  const cycle = cfg.cycleSec;
  const parkX = roadW - 60;
  const rideX = [-90, parkX, parkX, roadW + 20];
  // Wipe kapsul (text reveal) berlangsung linear dan selesai saat kata
  // terakhir baru setengah pop-up, sehingga tepi terbukanya kapsul SELALU
  // berada di depan kata yang sudah tampak penuh → tidak ada kata terpotong
  const wipeEnd = wordIn(words.length - 1) + WORD_POP * 0.5;

  return (
    /* ===== JALANAN ANIMASI: KURIR + TIPOGRAFI KINETIK (dikelola admin dari
        Profil → "Animasi Beranda": teks, font, gaya, warna, ukuran, kecepatan,
        BOOM) — satu siklus cfg.cycleSec dtk: motor masuk dari kiri lalu
        BERHENTI → spanduk di belakangnya terbuka (wipe kiri → kanan) sambil
        kata-katanya muncul berurutan dengan tipografi kinetik (slide-in per
        kata, tracking mengetat, motion blur hilang, pop-up) → BOOM! konfeti →
        motor melesat ke kanan sambil teks memudar (fade out + tracking melebar
        + motion blur). Emoji 🛵 dibalik agar menghadap kanan. Murni
        dekorasi: aria-hidden + pointer-events-none, dimatikan saat
        reduced-motion (motor & teks tampil statis, BOOM disembunyikan). */
    <section
      ref={roadRef}
      aria-hidden
      className="relative mx-4 h-20 overflow-hidden rounded-2xl border border-orange-100 bg-gradient-to-b from-orange-50/80 to-amber-50/50 shadow-sm"
    >
      {/* Pemandangan pinggir jalan — kurir melaju menuju rumah pelanggan */}
      <span className="pointer-events-none absolute left-2 top-2 select-none text-xl leading-none opacity-70">
        🌳
      </span>
      <span className="pointer-events-none absolute left-14 top-2.5 select-none text-base leading-none opacity-60">
        🌴
      </span>
      <span className="pointer-events-none absolute right-2 top-1.5 select-none text-2xl leading-none opacity-90">
        🏠
      </span>
      {/* Permukaan jalan aspal + marka putus-putus kuning */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-2 h-3 bg-neutral-700/85"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0 16px, rgba(252,211,77,0.9) 16px 34px)",
          backgroundSize: "auto 2px",
          backgroundPosition: "0 55%",
          backgroundRepeat: "repeat-x",
        }}
      />
      {/* BOOM! ulang tahun — chip "BOOM! 🎉" meledak + konfeti beterbangan.
          Muncul saat motor sedang berhenti, di atas spanduk; dapat dimatikan
          admin (cfg.boom=false → blok tidak dirender sama sekali) */}
      {cfg.boom && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <motion.div
            className="relative"
            style={prefersReduced ? { opacity: 0 } : undefined}
            animate={
              prefersReduced
                ? undefined
                : { scale: [0, 1.15, 1, 1], opacity: [0, 1, 1, 0], rotate: [-10, 3, 0, 0] }
            }
            transition={{
              duration: cycle * 0.175,
              times: [0, 0.15, 0.6, 1],
              repeat: Infinity,
              repeatDelay: cycle * 0.825,
              delay: cycle * RIDE.boomAt,
              ease: "easeOut",
            }}
          >
            {/* display block: tanpa game baseline strut warisan line-height,
                sehingga chip benar-benar di puncak wrapper */}
            <span className="block rounded-full bg-amber-300 px-2.5 py-1 text-[10px] font-black uppercase leading-none tracking-wider text-orange-950 shadow-lg ring-2 ring-white/70">
              BOOM! 🎉
            </span>
            {CONFETTI.map((k, i) => (
              <motion.span
                key={i}
                className={cn("pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5", k.cls)}
                animate={
                  prefersReduced
                    ? undefined
                    : {
                        x: [0, k.dx * 0.7, k.dx],
                        y: [0, k.dy * 0.7, k.dy],
                        opacity: [1, 0.9, 0],
                        rotate: [0, 120, 200],
                        scale: [1, 0.85, 0.7],
                      }
                }
                transition={{
                  duration: k.dur,
                  times: [0, 0.4, 1],
                  repeat: Infinity,
                  repeatDelay: cycle - k.dur,
                  delay: cycle * RIDE.boomAt,
                  ease: "easeOut",
                }}
              />
            ))}
          </motion.div>
        </div>
      )}
      {/* Driver + sepeda motor: masuk dari kiri → berhenti → melesat ke kanan */}
      <motion.div
        className="absolute bottom-3 left-0"
        style={prefersReduced ? { transform: `translateX(${parkX}px)` } : undefined}
        animate={prefersReduced ? undefined : { x: [...rideX, rideX[3]] }}
        transition={{
          duration: cycle,
          times: [0, RIDE.stopAt, RIDE.departAt, RIDE.goneAt, 1],
          ease: ["easeOut", "linear", "easeIn", "linear"],
          repeat: Infinity,
        }}
      >
        <motion.div
          className="relative"
          animate={prefersReduced ? undefined : { y: [0, -2, 0] }}
          transition={{ duration: 0.5, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* Spanduk di belakang motor — goyangan sangat halus agar teks tetap
              enak dibaca (getaran mesin TIDAK ikut menggoyang spanduk) */}
          <motion.div
            className="absolute right-full top-4 flex items-center"
            animate={prefersReduced ? undefined : { rotate: [0, -1, 0], y: [0, 0.6, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            {/* Kapsul spanduk — TEXT REVEAL: terbuka dari kiri ke kanan (clip-path),
                lalu menutup ke arah kanan saat motor pergi. Font, ketebalan,
                gaya huruf & ukuran mengikuti konfigurasi admin */}
            <motion.span
              className={cn(
                "flex items-center gap-[3px] whitespace-nowrap rounded-full bg-white px-2.5 py-1 shadow-md ring-1 ring-orange-200",
                WEIGHT_CLASS[cfg.weight],
                cfg.caps && "uppercase",
                cfg.italic && "italic"
              )}
              style={{ fontSize: cfg.fontSize, fontFamily: FONT_STACKS[cfg.font] }}
              animate={
                prefersReduced
                  ? undefined
                  : {
                      clipPath: [
                        "inset(-40% 100% -40% 0%)",
                        "inset(-40% 100% -40% 0%)",
                        "inset(-40% -12% -40% 0%)",
                        "inset(-40% -12% -40% 0%)",
                        "inset(-40% -12% -40% 110%)",
                        "inset(-40% -12% -40% 110%)",
                      ],
                    }
              }
              transition={{
                duration: cycle,
                times: [0, RIDE.textIn, wipeEnd, RIDE.textOut, RIDE.textGone, 1],
                ease: ["linear", "linear", "linear", "easeIn", "linear"],
                repeat: Infinity,
              }}
            >
              {words.map((w, i) => {
                const tIn = wordIn(i);
                return (
                  <motion.span
                    key={`${w.text}-${i}`}
                    className={cn(
                      "inline-block",
                      w.accent ? TEXT_COLORS[cfg.accentColor] : TEXT_COLORS[cfg.textColor]
                    )}
                    animate={
                      prefersReduced
                        ? undefined
                        : {
                            // Slide-in: meluncur dari kiri-bawah, lalu ke kanan-atas saat pergi
                            x: [-26, -26, 0, 0, 0, 28, 28],
                            y: [8, 8, 0, 0, 0, -6, -6],
                            // Fade in → tahan → fade out → tetap hilang
                            opacity: [0, 0, 1, 1, 1, 0, 0],
                            // Pop-up: muncul lebih besar lalu mengecil pas (kata aksen paling besar)
                            scale: [
                              w.accent ? 0 : 0.6,
                              w.accent ? 0 : 0.6,
                              w.accent ? 1.45 : 1.18,
                              1,
                              1,
                              0.92,
                              0.92,
                            ],
                            // Motion blur: buram saat masuk, tajam saat diam, buram saat pergi
                            filter: [
                              "blur(8px)",
                              "blur(8px)",
                              "blur(0px)",
                              "blur(0px)",
                              "blur(0px)",
                              "blur(10px)",
                              "blur(10px)",
                            ],
                            // Tracking: huruf awalnya rapat → normal, lalu melebar saat memudar
                            letterSpacing: ["-0.12em", "-0.12em", "0em", "0em", "0em", "0.3em", "0.3em"],
                          }
                    }
                    transition={{
                      duration: cycle,
                      times: [0, tIn, tIn + WORD_POP, tIn + WORD_POP * 2, RIDE.textOut, RIDE.textGone, 1],
                      // easeOut (bukan backOut) pada pop-in: opacity tak "tiba" lebih
                      // awal lewat overshoot → tepi wipe kapsul selalu di depan kata;
                      // efek pop tetap ada lewat target scale > 1 lalu mengecil pas
                      ease: ["linear", "easeOut", "easeOut", "linear", "easeIn", "linear"],
                      repeat: Infinity,
                    }}
                  >
                    {w.text}
                  </motion.span>
                );
              })}
            </motion.span>
            {/* Tali towbow — menempel di sisi belakang motor (ujung kanan spanduk) */}
            <span className="h-[2px] w-3 bg-neutral-700/70" />
          </motion.div>
          {/* Pengendara di atas sepeda motor — emoji dibalik agar menghadap kanan */}
          <span
            className="block select-none text-[52px] leading-none drop-shadow-md"
            style={{ transform: "scaleX(-1)" }}
          >
            🛵
          </span>
          {/* Asap knalpot mengepul ke belakang (kiri) */}
          <motion.span
            className="pointer-events-none absolute left-1 top-5 h-2 w-2 rounded-full bg-neutral-400/60"
            animate={prefersReduced ? undefined : { x: [-2, -14], scale: [0.7, 1.6], opacity: [0.55, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.span
            className="pointer-events-none absolute left-2 top-7 h-1.5 w-1.5 rounded-full bg-neutral-400/50"
            animate={prefersReduced ? undefined : { x: [-2, -12], scale: [0.6, 1.5], opacity: [0.45, 0] }}
            transition={{ duration: 0.95, repeat: Infinity, ease: "easeOut", delay: 0.35 }}
          />
          {/* Garis kecepatan — hanya tampak saat motor sedang bergerak
              (masuk dan saat melesat pergi), tersembunyi saat berhenti */}
          <motion.div
            className="absolute inset-0"
            style={prefersReduced ? { opacity: 0 } : undefined}
            animate={
              prefersReduced
                ? undefined
                : {
                    opacity: [1, 0, 0, 1, 0, 0],
                  }
            }
            transition={{
              duration: cycle,
              times: [0, RIDE.stopAt - 0.02, RIDE.departAt + 0.01, RIDE.departAt + 0.04, RIDE.goneAt, 1],
              ease: "linear",
              repeat: Infinity,
            }}
          >
            <motion.span
              className="pointer-events-none absolute left-0 top-6 h-[3px] w-5 rounded-full bg-white/75"
              animate={prefersReduced ? undefined : { x: [4, -6, -16], opacity: [0, 0.95, 0] }}
              transition={{ duration: 0.45, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.span
              className="pointer-events-none absolute left-0 top-9 h-[3px] w-3.5 rounded-full bg-white/60"
              animate={prefersReduced ? undefined : { x: [4, -5, -14], opacity: [0, 0.8, 0] }}
              transition={{ duration: 0.4, repeat: Infinity, ease: "easeOut", delay: 0.2 }}
            />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}
