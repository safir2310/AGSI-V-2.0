"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

type ChickenLogoProps = {
  size?: number;
  className?: string;
  /** Animasi idle (mengambang, memiringkan kepala, berkedip). Otomatis mati jika prefers-reduced-motion. */
  animated?: boolean;
  /** Animasi masuk (pop) saat komponen pertama tampil */
  entrance?: boolean;
  /** Tanpa bayangan lantai (untuk tempat kecil seperti navbar) */
  compact?: boolean;
};

/**
 * ID gradien/filter maskot — statis & global (BUKAN useId).
 *
 * Alasan: React 19 menghitung useId dari posisi komponen di pohon render;
 * bila pohon server & klien sedikit berbeda (boundary streaming/Suspense di
 * SSR), nilai useId bergeser -> atribut id/fill/filter tidak cocok saat
 * hydration. Dengan ID statis + <defs> tunggal (ChickenLogoDefs), HTML server
 * dan klien identik persis — tidak mungkin mismatch.
 */
const G = {
  body: "agsi-chicken-body",
  head: "agsi-chicken-head",
  wing: "agsi-chicken-wing",
  belly: "agsi-chicken-belly",
  hat: "agsi-chicken-hat",
  beak: "agsi-chicken-beak",
  wattle: "agsi-chicken-wattle",
  green: "agsi-chicken-green",
  foot: "agsi-chicken-foot",
  shadow: "agsi-chicken-shadow",
  gloss: "agsi-chicken-gloss",
  ground: "agsi-chicken-ground",
} as const;

/**
 * Definisi gradien & filter maskot — dipasang SEKALI di akar aplikasi
 * (lihat AppShell). Semua <ChickenLogo>/<ChickenBadge> cukup me-referensi
 * ID statis ini, sehingga tidak ada ID ganda di dokumen.
 */
export function ChickenLogoDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      xmlns="http://www.w3.org/2000/svg"
      style={{ position: "absolute", pointerEvents: "none" }}
    >
      <defs>
        <radialGradient id={G.body} cx="36%" cy="28%" r="90%">
          <stop offset="0%" stopColor="#FFD591" />
          <stop offset="26%" stopColor="#FDBA74" />
          <stop offset="62%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#E0570A" />
        </radialGradient>
        <radialGradient id={G.head} cx="36%" cy="26%" r="92%">
          <stop offset="0%" stopColor="#FFE6BD" />
          <stop offset="30%" stopColor="#FDBA74" />
          <stop offset="68%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#EA580C" />
        </radialGradient>
        <linearGradient id={G.wing} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#C2410C" />
        </linearGradient>
        <linearGradient id={G.belly} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFBF5" />
          <stop offset="100%" stopColor="#FFEDD5" />
        </linearGradient>
        <linearGradient id={G.hat} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E7EDF3" />
        </linearGradient>
        <linearGradient id={G.beak} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FCD34D" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
        <linearGradient id={G.wattle} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FB7185" />
          <stop offset="100%" stopColor="#E11D48" />
        </linearGradient>
        <linearGradient id={G.green} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#4ADE80" />
          <stop offset="100%" stopColor="#16A34A" />
        </linearGradient>
        <linearGradient id={G.foot} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
        <filter id={G.shadow} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="5" stdDeviation="6" floodColor="#9A3412" floodOpacity="0.28" />
        </filter>
        <filter id={G.gloss} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={G.ground} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * Maskot ayam koki 3D — AYAM GEPREK SAMBAL IJO.
 * Dibangun murni dengan SVG (gradien radial + feDropShadow + highlight)
 * sehingga sangat ringan, tanpa aset gambar, dan tetap tajam di semua resolusi.
 * Warna: orange (tubuh), putih (topi koki), hijau (syal sambal ijo).
 */
export function ChickenLogo({
  size = 120,
  className,
  animated = true,
  entrance = false,
  compact = false,
}: ChickenLogoProps) {
  const prefersReduced = useReducedMotion();
  const idle = animated && !prefersReduced;

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      role="img"
      aria-label="Maskot ayam koki Ayam Geprek Sambal Ijo"
      className={cn("select-none", className)}
      xmlns="http://www.w3.org/2000/svg"
      initial={entrance ? { scale: 0.4, opacity: 0, y: 24 } : false}
      animate={entrance ? { scale: 1, opacity: 1, y: 0 } : undefined}
      transition={{ type: "spring", stiffness: 260, damping: 17, mass: 0.9 }}
    >
      {/* Gradien & filter: global via <ChickenLogoDefs /> di AppShell (ID statis, aman SSR/hydration) */}

      {/* Grup utama: animasi mengambang lembut */}
      <motion.g
        animate={idle ? { y: [0, -7, 0] } : undefined}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        filter={`url(#${G.shadow})`}
      >
        {/* ===== TUBUH ===== */}
        <ellipse cx="100" cy="136" rx="50" ry="41" fill={`url(#${G.body})`} />
        {/* perut putih krem */}
        <ellipse cx="100" cy="146" rx="30" ry="25" fill={`url(#${G.belly})`} />

        {/* kaki */}
        <g fill={`url(#${G.foot})`}>
          <path d="M84 166 q-8 0 -8 6 q0 5 8 5 q8 0 8 -6 q0 -5 -8 -5 z" transform="translate(0 4)" />
          <path d="M116 166 q-8 0 -8 6 q0 5 8 5 q8 0 8 -6 q0 -5 -8 -5 z" transform="translate(0 4)" />
        </g>

        {/* sayap kiri & kanan */}
        <g>
          <ellipse cx="57" cy="134" rx="15" ry="27" fill={`url(#${G.wing})`} transform="rotate(14 57 134)" />
          <ellipse cx="143" cy="134" rx="15" ry="27" fill={`url(#${G.wing})`} transform="rotate(-14 143 134)" />
          <ellipse cx="58" cy="128" rx="6" ry="12" fill="#FB923C" opacity="0.55" transform="rotate(14 58 128)" />
          <ellipse cx="142" cy="128" rx="6" ry="12" fill="#FB923C" opacity="0.55" transform="rotate(-14 142 128)" />
        </g>

        {/* ===== KEPALA (animasi memiringkan) ===== */}
        <motion.g
          animate={idle ? { rotate: [0, 4.5, 0, -4.5, 0] } : undefined}
          transition={{ duration: 5.6, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformBox: "fill-box", transformOrigin: "50% 85%" }}
        >
          {/* kepala */}
          <circle cx="100" cy="80" r="42" fill={`url(#${G.head})`} />

          {/* highlight glossy 3D di kiri atas kepala */}
          <ellipse cx="80" cy="56" rx="15" ry="9" fill="#FFFFFF" opacity="0.4" transform="rotate(-24 80 56)" filter={`url(#${G.gloss})`} />

          {/* topi koki (agak miring, playful) */}
          <g transform="rotate(-7 100 44)">
            {/* bayangan topi di kepala */}
            <ellipse cx="100" cy="52" rx="27" ry="6" fill="#C2410C" opacity="0.28" filter={`url(#${G.gloss})`} />
            {/* puffy toque */}
            <g fill={`url(#${G.hat})`}>
              <circle cx="80" cy="34" r="13" />
              <circle cx="101" cy="26" r="16" />
              <circle cx="121" cy="35" r="12" />
              <path d="M72 40 q30 -22 58 0 l0 12 q-29 -12 -58 0 z" />
            </g>
            {/* band topi */}
            <rect x="76" y="44" width="49" height="12" rx="6" fill="#FFFFFF" />
            <rect x="76" y="49" width="49" height="7" rx="3.5" fill="#EDF1F5" />
          </g>

          {/* mata */}
          <g>
            {[86, 114].map((cx) => (
              <motion.g
                key={cx}
                animate={
                  idle
                    ? { scaleY: [1, 1, 0.06, 1, 1] }
                    : undefined
                }
                transition={{
                  duration: 4.4,
                  repeat: Infinity,
                  times: [0, 0.9, 0.94, 0.98, 1],
                  ease: "linear",
                }}
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
              >
                <ellipse cx={cx} cy="78" rx="7" ry="7.5" fill="#451A03" />
                <circle cx={cx - 2.3} cy="75.5" r="2.4" fill="#FFFFFF" />
                <circle cx={cx + 2} cy="80.5" r="1" fill="#FFFFFF" opacity="0.7" />
              </motion.g>
            ))}
          </g>

          {/* pipi */}
          <ellipse cx="76" cy="90" rx="6.5" ry="4.5" fill="#F43F5E" opacity="0.3" />
          <ellipse cx="124" cy="90" rx="6.5" ry="4.5" fill="#F43F5E" opacity="0.3" />

          {/* paruh */}
          <g>
            <path d="M91 86 L109 86 L100 95 Z" fill={`url(#${G.beak})`} />
            <path d="M95 94 L105 94 L100 100 Z" fill="#D97706" />
            <path d="M91 86 L109 86 L100 95 Z" fill="none" stroke="#B45309" strokeWidth="0.7" opacity="0.5" />
          </g>

          {/* pial (wattle) */}
          <path d="M100 100 q5 3 4 8 q-1 5 -4 5 q-3 0 -4 -5 q-1 -5 4 -8 z" fill={`url(#${G.wattle})`} />
        </motion.g>

        {/* ===== SYAL HIJAU SAMBAL IJO ===== */}
        <g>
          <path
            d="M66 116 Q100 136 134 116 L134 126 Q100 148 66 126 Z"
            fill={`url(#${G.green})`}
          />
          <path
            d="M66 116 Q100 136 134 116 L134 120 Q100 141 66 120 Z"
            fill="#22C55E"
            opacity="0.85"
          />
          {/* ujung syal berkibar */}
          <path d="M126 128 l14 10 l-10 1 l-2 9 z" fill="#16A34A" />
        </g>

        {/* kilau kecil di tubuh untuk kesan 3D */}
        <ellipse cx="70" cy="118" rx="8" ry="5" fill="#FFD591" opacity="0.6" transform="rotate(-28 70 118)" />
      </motion.g>

      {/* bayangan lantai (berlawanan dengan gerakan mengambang) */}
      {!compact && (
        <motion.ellipse
          cx="100"
          cy="184"
          rx={42}
          ry={8}
          fill="#EA580C"
          opacity={0.22}
          filter={`url(#${G.ground})`}
          animate={idle ? { scaleX: [1, 0.88, 1], opacity: [0.22, 0.15, 0.22] } : undefined}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        />
      )}
    </motion.svg>
  );
}

/** Tanda logo ringkas: maskot dalam lencana bulat gradasi orange — untuk navbar & tombol kecil */
export function ChickenBadge({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 shadow-[0_4px_14px_rgba(249,115,22,0.45)] ring-2 ring-white",
        className
      )}
      style={{ width: size, height: size }}
    >
      <ChickenLogo size={size * 0.92} compact animated={false} />
    </span>
  );
}
