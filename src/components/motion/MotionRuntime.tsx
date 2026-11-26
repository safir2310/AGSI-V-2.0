"use client";

/* ============================================================
   AGSI MOTION STUDIO — RUNTIME (sisi tampilan)
   ============================================================
   Menerjemahkan konfigurasi tervalidasi (motion-config.ts) menjadi
   animasi nyata di seluruh aplikasi. Aturan keras:
   - Hanya transform / opacity / filter / clip-path (GPU-friendly).
   - Preferensi reduce-motion perangkat SELALU dihormati (null).
   - Gate global: master + per perangkat (HP/Tablet/Desktop) +
     perf mode (perangkat lemah → efek 3D/blur diganti fade).
   - Preview studio ≠ situs langsung: bila preview aktif, konfigurasi
     diambil dari store preview (tidak pernah menyentuh pengunjung).
   - Tanpa konfigurasi / efek "none" → komponen me-render polos
     (fallback aman bila animasi gagal dimuat). */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion, type TargetAndTransition, type Transition } from "framer-motion";
import { create } from "zustand";
import {
  MOTION_SPEED_SCALE,
  type MotionPublic,
  type MotionTarget,
  type MotionTargetKey,
} from "@/lib/motion-config";
import { useSettingsStore } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/* ================= STORE PREVIEW (isolasi editor) ================= */

type MotionPreviewState = {
  active: boolean;
  config: MotionPublic | null;
  /** uji per perangkat: override kelas perangkat saat preview aktif */
  device: DeviceClass | "auto";
  show: (config: MotionPublic) => void;
  setDevice: (d: DeviceClass | "auto") => void;
  clear: () => void;
};

/** Preview Motion Studio memakai konfigurasi DRAFT di sini — pengunjung
    situs tetap melihat konfigurasi PUBLISHED sampai admin menekan Publish. */
export const useMotionPreviewStore = create<MotionPreviewState>((set) => ({
  active: false,
  config: null,
  device: "auto",
  show: (config) => set({ active: true, config }),
  setDevice: (device) => set({ device }),
  clear: () => set({ active: false, config: null, device: "auto" }),
}));

/* ================= GATE & KONTEKS ================= */

type DeviceClass = "mobile" | "tablet" | "desktop";

function useDeviceClass(): DeviceClass {
  const [d, setD] = useState<DeviceClass>("mobile");
  useEffect(() => {
    const f = () =>
      setD(window.innerWidth < 640 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop");
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return d;
}

/** Efek "berat" (3D/blur/glitch) yang diganti fade saat perf mode aktif. */
const HEAVY_EFFECTS = new Set(["flip3d", "rotate3d", "cube", "blurReveal", "glitch", "kenBurns", "neon", "cinematic", "tilt", "curtain"]);

function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** Ambil target animasi yang BOLEH berjalan di perangkat ini (atau null).
    Ini SATU-SATUNYA pintu konfigurasi untuk semua komponen runtime. */
export function useMotionTarget(key: MotionTargetKey): MotionTarget | null {
  const mounted = useMounted();
  const motion = useSettingsStore((s) => s.motion);
  const preview = useMotionPreviewStore((s) => (s.active ? s.config : null));
  const previewDevice = useMotionPreviewStore((s) => (s.active ? s.device : "auto"));
  const prefersReduced = useReducedMotion();
  const realDevice = useDeviceClass();

  return useMemo(() => {
    if (!mounted) return null;
    const cfg = preview ?? motion;
    if (!cfg) return null;
    const g = cfg.global;
    if (!g.master) return null;
    const device = previewDevice === "auto" ? realDevice : previewDevice;
    if (device === "mobile" && !g.mobile) return null;
    if (device === "tablet" && !g.tablet) return null;
    if (device === "desktop" && !g.desktop) return null;
    // Hormati preferensi reduce-motion pengguna (kontrak modul — tanpa pengecualian)
    if (prefersReduced) return null;
    const t = cfg.targets[key];
    if (!t || !t.enabled || t.effect === "none") return null;
    // Perf mode: perangkat lemah → efek berat diturunkan jadi fade
    const weakCpu =
      typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4;
    if (g.perfMode && weakCpu && HEAVY_EFFECTS.has(t.effect)) {
      return { ...t, effect: "fade", loop: false };
    }
    return t;
  }, [mounted, motion, preview, previewDevice, prefersReduced, realDevice, key]);
}

/** Pengali durasi global (preset kecepatan / kustom). */
export function useMotionSpeedScale(): number {
  const motion = useSettingsStore((s) => s.motion);
  const preview = useMotionPreviewStore((s) => (s.active ? s.config : null));
  const cfg = preview ?? motion;
  if (!cfg) return 1;
  const g = cfg.global;
  return g.speedPreset === "custom" ? g.speedScale : MOTION_SPEED_SCALE[g.speedPreset];
}

/* ================= BUILDER VARIANT ================= */

function easeOf(t: MotionTarget): Transition["ease"] {
  switch (t.easing) {
    case "spring":
      return undefined; // spring ditangani terpisah
    case "backOut":
      return [0.34, 1.56, 0.64, 1];
    case "easeIn":
      return "easeIn";
    case "easeInOut":
      return "easeInOut";
    case "linear":
      return "linear";
    default:
      return "easeOut";
  }
}

function springOf(t: MotionTarget, staggerS = 0): Transition {
  return {
    type: "spring",
    stiffness: 320,
    damping: t.easing === "backOut" ? 18 : 24,
    delay: t.delay + staggerS,
  };
}

function transitionOf(t: MotionTarget, staggerS = 0, extra: Transition = {}): Transition {
  const e = easeOf(t);
  const base: Transition = {
    duration: Math.max(0.2, t.duration * useSpeedRef.current),
    delay: t.delay + staggerS,
    ...(e ? { ease: e } : { type: "spring", stiffness: 320, damping: 24 } as Transition),
    ...extra,
  };
  return base;
}

/** Pengali kecepatan dibaca lewat ref agar builder bisa dipakai di luar hook
    (dipasang sekali per render dari komponen pemanggil). */
const useSpeedRef: { current: number } = { current: 1 };

/** Pasang pengali kecepatan untuk render berikut (dipanggil komponen runtime). */
export function useBindSpeed(): void {
  const s = useMotionSpeedScale();
  useSpeedRef.current = s;
}

const P = 24; // jarak geser dasar (px) pada intensitas 100

/** Entrance TEKS per kata (indeks i dari n) — kunci efek tervalidasi. */
export function textWordAnim(t: MotionTarget, i: number): { initial: TargetAndTransition; animate: TargetAndTransition; transition: Transition } {
  const k = t.effect;
  const d = (P * t.intensity) / 100;
  const deg = (90 * t.intensity) / 100;
  const staggerS = (t.stagger * i) / 1000;
  const persp: TargetAndTransition = { transformPerspective: 800 };

  const mk = (initial: TargetAndTransition, animate: TargetAndTransition): {
    initial: TargetAndTransition;
    animate: TargetAndTransition;
    transition: Transition;
  } => ({
    initial,
    animate,
    transition: t.easing === "spring" ? springOf(t, staggerS) : transitionOf(t, staggerS),
  });

  switch (k) {
    case "fade":
      return mk({ opacity: 0 }, { opacity: 1 });
    case "slideUp":
      return mk({ opacity: 0, y: d }, { opacity: 1, y: 0 });
    case "slideDown":
      return mk({ opacity: 0, y: -d }, { opacity: 1, y: 0 });
    case "slideLeft":
      return mk({ opacity: 0, x: d }, { opacity: 1, x: 0 });
    case "slideRight":
      return mk({ opacity: 0, x: -d }, { opacity: 1, x: 0 });
    case "zoomIn":
      return mk({ opacity: 0, scale: 0.72 + 0.2 * (t.intensity / 100) }, { opacity: 1, scale: 1 });
    case "zoomOut":
      return mk({ opacity: 0, scale: 1.3 - 0.2 * (t.intensity / 100) }, { opacity: 1, scale: 1 });
    case "pop":
      return mk({ opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1 });
    case "bounce":
      return mk(
        { opacity: 0, y: d * 1.4 },
        { opacity: 1, y: [d * 1.4, -d * 0.3, 0, -d * 0.12, 0] }
      );
    case "elastic":
      return mk({ opacity: 0, scale: 0.5 }, { opacity: 1, scale: [0.5, 1.18, 0.9, 1.06, 0.98, 1] });
    case "flip3d":
      return mk({ ...persp, opacity: 0, rotateX: -deg }, { ...persp, opacity: 1, rotateX: 0 });
    case "rotate3d":
      return mk({ ...persp, opacity: 0, rotateY: deg, y: 8 }, { ...persp, opacity: 1, rotateY: 0, y: 0 });
    case "kinetic":
      return mk(
        { opacity: 0, scale: 0.6, rotate: -6 },
        { opacity: 1, scale: [0.6, 1.14, 1], rotate: [-6, 3, 0] }
      );
    case "staggerLetter":
    case "wave":
    case "glitch":
      return mk({ opacity: 0, y: 6 }, { opacity: 1, y: 0 });
    default:
      // blurReveal / neon / tracking / typewriter ditangani di level kapsul
      return mk({ opacity: 0 }, { opacity: 1 });
  }
}

/** Animasi kapsul SELURUH teks (efek yang tidak per kata). */
export function textCapsuleAnim(t: MotionTarget): { initial: TargetAndTransition; animate: TargetAndTransition; transition: Transition } | null {
  const k = t.effect;
  const linear = transitionOf(t, 0, { ease: t.easing === "linear" ? "linear" : undefined });
  if (k === "typewriter") {
    return {
      initial: { clipPath: "inset(-20% 100% -20% -2%)" },
      animate: { clipPath: "inset(-20% -2% -20% -2%)" },
      transition: { duration: Math.max(0.4, t.duration), delay: t.delay, ease: "linear" },
    };
  }
  if (k === "tracking") {
    return {
      initial: { opacity: 0, letterSpacing: "0.4em" },
      animate: { opacity: 1, letterSpacing: "0em" },
      transition: linear,
    };
  }
  if (k === "blurReveal") {
    return {
      initial: { opacity: 0, filter: "blur(10px)", y: 8 },
      animate: { opacity: 1, filter: "blur(0px)", y: 0 },
      transition: linear,
    };
  }
  return null;
}

/** Ambient loop kapsul teks (float/wave/neon/glitch saat loop aktif). */
export function textLoopAnim(t: MotionTarget): { animate: TargetAndTransition; transition: Transition } | null {
  if (!t.loop) return null;
  const d = (8 * t.intensity) / 100;
  switch (t.effect) {
    case "float":
      return { animate: { y: [0, -d, 0] }, transition: { duration: Math.max(1.2, t.duration), repeat: Infinity, ease: "easeInOut" } };
    case "wave":
      return { animate: { y: [0, -d, 0, d * 0.6, 0] }, transition: { duration: Math.max(1.5, t.duration), repeat: Infinity, ease: "easeInOut" } };
    case "neon":
      return {
        animate: { filter: ["drop-shadow(0 0 2px currentColor)", "drop-shadow(0 0 14px currentColor)", "drop-shadow(0 0 2px currentColor)"] },
        transition: { duration: Math.max(1, t.duration), repeat: Infinity, ease: "easeInOut" },
      };
    case "glitch":
      return {
        animate: { x: [0, -3, 3, -1, 0], opacity: [1, 0.85, 1, 0.92, 1] },
        transition: { duration: Math.max(0.6, t.duration), repeat: Infinity, ease: "linear" },
      };
    case "pulse":
      return { animate: { scale: [1, 1.04, 1] }, transition: { duration: Math.max(1, t.duration), repeat: Infinity, ease: "easeInOut" } };
    default:
      return null;
  }
}

/** Entrance KARTU/GAMBAR (indeks i utk stagger). */
export function boxAnim(t: MotionTarget, i = 0): { initial: TargetAndTransition; animate: TargetAndTransition; transition: Transition } {
  const d = (P * t.intensity) / 100;
  const deg = (60 * t.intensity) / 100;
  const staggerS = (t.stagger * i) / 1000;
  const persp: TargetAndTransition = { transformPerspective: 900 };
  const mk = (initial: TargetAndTransition, animate: TargetAndTransition) => ({
    initial,
    animate,
    transition: t.easing === "spring" ? springOf(t, staggerS) : transitionOf(t, staggerS),
  });
  switch (t.effect) {
    case "fade":
      return mk({ opacity: 0 }, { opacity: 1 });
    case "slideUp":
      return mk({ opacity: 0, y: d }, { opacity: 1, y: 0 });
    case "slideLeft":
      return mk({ opacity: 0, x: d }, { opacity: 1, x: 0 });
    case "slideRight":
      return mk({ opacity: 0, x: -d }, { opacity: 1, x: 0 });
    case "zoomIn":
      return mk({ opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1 });
    case "zoomOut":
      return mk({ opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1 });
    case "pop":
      return mk({ opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1 });
    case "flip3d":
      return mk({ ...persp, opacity: 0, rotateX: -deg }, { ...persp, opacity: 1, rotateX: 0 });
    default:
      return mk({ opacity: 0 }, { opacity: 1 });
  }
}

/** Ambient loop KARTU/GAMBAR (float/pulse/tilt/kenBurns/glow). */
export function boxLoopAnim(t: MotionTarget): { animate: TargetAndTransition; transition: Transition } | null {
  const d = (6 * t.intensity) / 100;
  switch (t.effect) {
    case "float":
      return { animate: { y: [0, -d, 0] }, transition: { duration: Math.max(1.5, t.duration), repeat: Infinity, ease: "easeInOut" } };
    case "pulse":
      return { animate: { scale: [1, 1 + 0.04 * (t.intensity / 100), 1] }, transition: { duration: Math.max(1, t.duration), repeat: Infinity, ease: "easeInOut" } };
    case "tilt":
      return {
        animate: { transformPerspective: 900, rotateY: [0, 4, -4, 0], rotateX: [0, 2, -2, 0] },
        transition: { duration: Math.max(2.5, t.duration), repeat: Infinity, ease: "easeInOut" },
      };
    case "kenBurns":
      return {
        animate: { scale: [1, 1 + 0.1 * (t.intensity / 100)], x: [0, 8 * (t.intensity / 100)] },
        transition: { duration: Math.max(6, t.duration * 8), repeat: Infinity, repeatType: "reverse", ease: "linear" },
      };
    case "glow":
      return {
        animate: { filter: ["drop-shadow(0 0 0px rgba(249,115,22,0))", "drop-shadow(0 0 16px rgba(249,115,22,0.55))", "drop-shadow(0 0 0px rgba(249,115,22,0))"] },
        transition: { duration: Math.max(1.5, t.duration), repeat: Infinity, ease: "easeInOut" },
      };
    default:
      return null;
  }
}

/** Variant transisi ganti halaman (initial/animate/exit). */
export function pageTransitionAnim(t: MotionTarget) {
  const d = (36 * t.intensity) / 100;
  const deg = (14 * t.intensity) / 100;
  const dur = Math.max(0.18, t.duration);
  const persp: TargetAndTransition = { transformPerspective: 1200 };
  const mk = (initial: TargetAndTransition, animate: TargetAndTransition, exit: TargetAndTransition) => ({
    initial,
    animate,
    exit,
    transition: { duration: dur, ease: "easeOut" } as Transition,
    exitTransition: { duration: dur * 0.8, ease: "easeIn" } as Transition,
  });
  switch (t.effect) {
    case "fade":
      return mk({ opacity: 0 }, { opacity: 1 }, { opacity: 0 });
    case "slideLeft":
      return mk({ opacity: 0.6, x: d }, { opacity: 1, x: 0 }, { opacity: 0, x: -d });
    case "slideRight":
      return mk({ opacity: 0.6, x: -d }, { opacity: 1, x: 0 }, { opacity: 0, x: d });
    case "slideUp":
      return mk({ opacity: 0.6, y: d }, { opacity: 1, y: 0 }, { opacity: 0, y: -d * 0.6 });
    case "slideDown":
      return mk({ opacity: 0.6, y: -d }, { opacity: 1, y: 0 }, { opacity: 0, y: d * 0.6 });
    case "zoomIn":
      return mk({ opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1 }, { opacity: 0, scale: 1.04 });
    case "zoomOut":
      return mk({ opacity: 0, scale: 1.06 }, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.94 });
    case "flip3d":
      return mk({ ...persp, opacity: 0, rotateX: deg }, { ...persp, opacity: 1, rotateX: 0 }, { ...persp, opacity: 0, rotateX: -deg });
    case "cube":
      return mk(
        { ...persp, transformPerspective: 1400, opacity: 0.4, rotateY: deg * 1.6, x: d * 1.4, scale: 0.96 },
        { opacity: 1, rotateY: 0, x: 0, scale: 1 },
        { opacity: 0, rotateY: -deg * 1.6, x: -d * 1.4, scale: 0.96 }
      );
    case "blur":
      return mk({ opacity: 0, filter: "blur(8px)" }, { opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(8px)" });
    case "curtain":
      return mk(
        { clipPath: "inset(0% 100% 0% 0%)" },
        { clipPath: "inset(0% 0% 0% 0%)" },
        { clipPath: "inset(0% 0% 0% 100%)" }
      );
    default:
      return mk({ opacity: 0 }, { opacity: 1 }, { opacity: 0 });
  }
}

/** Animasi badge (angka keranjang) — re-render saat `pulseKey` berubah. */
export function badgeAnim(t: MotionTarget, pulseKey: number): { animate: TargetAndTransition; transition: Transition; key: number | null } {
  switch (t.effect) {
    case "pop":
      return {
        key: pulseKey,
        animate: { scale: [1.45, 1], opacity: [0.6, 1] },
        transition: { type: "spring", stiffness: 500, damping: 18 },
      };
    case "bounce":
      return { key: pulseKey, animate: { y: [0, -6, 0] }, transition: { duration: 0.45, times: [0, 0.4, 1], ease: "easeOut" } };
    case "wiggle":
      return { key: pulseKey, animate: { rotate: [0, -12, 10, -6, 0] }, transition: { duration: 0.5, ease: "easeInOut" } };
    case "pulse":
      return { key: null, animate: { scale: [1, 1.18, 1] }, transition: { duration: 1.6, repeat: Infinity, ease: "easeInOut" } };
    default:
      return { key: null, animate: {}, transition: {} };
  }
}

/* ================= KOMPONEN RUNTIME ================= */

type SplitMode = "whole" | "word" | "char";

function splitModeOf(effect: string): SplitMode {
  if (effect === "staggerLetter" || effect === "wave" || effect === "glitch") return "char";
  if (
    ["slideUp", "slideDown", "slideLeft", "slideRight", "pop", "bounce", "elastic", "flip3d", "rotate3d", "kinetic", "zoomIn", "zoomOut"].includes(effect)
  )
    return "word";
  return "whole";
}

/** TEKS beranimasi — fallback polos bila target null (aman & selalu terbaca). */
export function MotionText({
  targetKey,
  children,
  className,
  style,
}: {
  targetKey: MotionTargetKey;
  children: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const t = useMotionTarget(targetKey);
  useBindSpeed();
  const text = children;

  // Efek level kapsul (typewriter/tracking/blurReveal) + loop ambient
  const caps = t ? textCapsuleAnim(t) : null;
  const loop = t ? textLoopAnim(t) : null;

  if (!t || t.effect === "none") return <span className={className} style={style}>{text}</span>;

  const mode = splitModeOf(t.effect);
  const words = text.split(/\s+/).filter(Boolean);
  const chars = Array.from(text);

  const inner =
    mode === "word" ? (
      words.map((w, i) => {
        const a = textWordAnim(t, i);
        return (
          <motion.span
            key={`${w}-${i}`}
            className="inline-block will-change-transform"
            initial={a.initial}
            animate={a.animate}
            transition={a.transition}
          >
            {w}
            {i < words.length - 1 ? "\u00A0" : ""}
          </motion.span>
        );
      })
    ) : mode === "char" ? (
      chars.map((c, i) => {
        const a = textWordAnim(t, i);
        return (
          <motion.span
            key={`${c}-${i}`}
            className="inline-block will-change-transform"
            initial={a.initial}
            animate={a.animate}
            transition={a.transition}
          >
            {c === " " ? "\u00A0" : c}
          </motion.span>
        );
      })
    ) : (
      text
    );

  return (
    <motion.span className={className} style={style} {...(caps ?? {})}>
      {loop ? (
        <motion.span className="block will-change-transform" animate={loop.animate} transition={loop.transition}>
          {inner}
        </motion.span>
      ) : (
        inner
      )}
    </motion.span>
  );
}

/** KARTU/GAMBAR beranimasi — entrance + ambient + shimmer/glow overlay. */
export function MotionBox({
  targetKey,
  index = 0,
  children,
  className,
  shimmerClassName,
}: {
  targetKey: MotionTargetKey;
  index?: number;
  children: React.ReactNode;
  className?: string;
  /** kelas elemen shimmer (nilai bawaan mengikuti gaya AGSI) */
  shimmerClassName?: string;
}) {
  const t = useMotionTarget(targetKey);
  useBindSpeed();
  const a = t ? boxAnim(t, index) : null;
  const loop = t ? boxLoopAnim(t) : null;
  const overlay = t?.effect === "shimmer" || t?.effect === "glow";

  if (!t || t.effect === "none") return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={cn("relative", className)}
      initial={a?.initial}
      animate={a?.animate}
      transition={a?.transition}
    >
      {loop ? (
        <motion.div className="will-change-transform" animate={loop.animate} transition={loop.transition}>
          {children}
        </motion.div>
      ) : (
        children
      )}
      {overlay && (
        <motion.div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-12deg]",
            t.effect === "shimmer"
              ? shimmerClassName ?? "bg-gradient-to-r from-transparent via-white/35 to-transparent"
              : "bg-gradient-to-r from-transparent via-orange-300/25 to-transparent"
          )}
          animate={{ x: ["0%", "460%"] }}
          transition={{
            duration: Math.max(1.6, t.duration * 2),
            repeat: Infinity,
            repeatDelay: Math.max(1, t.delay + 1.5),
            ease: "easeInOut",
          }}
        />
      )}
    </motion.div>
  );
}

/** Hook kecil: kunci ulang animasi badge saat nilai berubah (dipakai BottomNav). */
export function useChanged(value: number): number {
  const prev = useRef(value);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (value > prev.current) setTick((n) => n + 1);
    prev.current = value;
  }, [value]);
  return tick;
}
