/* ============================================================
   AGSI MOTION STUDIO — PUSAT KENDALI ANIMASI (konfigurasi aman)
   ============================================================
   Satu sumber kebenaran untuk seluruh animasi yang dikendalikan
   admin (Profil Admin → "AGSI Motion Studio"). Disimpan sebagai
   SATU kolom JSON `motion` di tabel StoreSetting (pola sama dengan
   courierAnim/banner) — tanpa migrasi tabel baru, ternormalisasi
   & tervalidasi di SERVER (store-settings.ts) dan CLIENT (hooks).

   Prinsip keamanan (sesuai kontrak modul):
   - Tidak ada kode animasi mentah dari DB — hanya KUNCI efek dari
     katalog di bawah yang divalidasi ketat; komponen runtime
     (MotionRuntime.tsx) menerjemahkan kunci → variant framer-motion.
   - Semua angka dijepit rentang wajar (durasi, jarak, stagger).
   - Global gates: master, per-perangkat (HP/Tablet/Desktop),
     perf mode (perangkat lemah → efek 3D/berat dimatikan), dan
     preferensi reduce-motion pengguna SELALU dihormati.
   - Draft ≠ aktif: pengunjung hanya melihat konfigurasi PUBLISHED
     (versi naik + riwayat tiap publish). */

/* ================= KUNCI TARGET (elemen nyata AGSI) ================= */

export type MotionTargetKey =
  | "heroTitle" // judul hero Beranda (teks)
  | "sectionTitles" // judul section Beranda (teks, stagger per kata)
  | "productCards" // kartu produk favorit Beranda (masuk berurutan)
  | "promoStrip" // panggung promo kinetic Beranda (mode baru strip Promo Hari Ini)
  | "bannerPopup" // popup banner promo Beranda
  | "headerLogo" // logo maskot di header aplikasi
  | "splash" // splash pembuka (logo + slogan)
  | "pageTransition" // transisi ganti halaman (seluruh view)
  | "cartBadge"; // badge jumlah keranjang di navigasi bawah

export const MOTION_TARGET_KEYS: MotionTargetKey[] = [
  "heroTitle",
  "sectionTitles",
  "productCards",
  "promoStrip",
  "bannerPopup",
  "headerLogo",
  "splash",
  "pageTransition",
  "cartBadge",
];

/** Label & penjelasan target (UI admin, Bahasa Indonesia). */
export const MOTION_TARGET_META: Record<MotionTargetKey, { label: string; desc: string }> = {
  heroTitle: { label: "Judul Hero Beranda", desc: "Teks besar Ayam Geprek Sambal Ijo di bagian atas Beranda" },
  sectionTitles: { label: "Judul Section Beranda", desc: "Judul Voucher, Paling Dicari & Promo Hari Ini" },
  productCards: { label: "Kartu Produk", desc: "Kartu menu favorit masuk berurutan (stagger)" },
  promoStrip: { label: "Panggung Promo Hari Ini", desc: "Kartu promo animasi di Beranda (kilau & kemunculan)" },
  bannerPopup: { label: "Popup Banner Beranda", desc: "Cara popup banner promo muncul & menghilang" },
  headerLogo: { label: "Logo Header", desc: "Maskot ayam di header aplikasi (ambient)" },
  splash: { label: "Splash Screen", desc: "Layar pembuka logo + slogan saat aplikasi dibuka" },
  pageTransition: { label: "Transisi Halaman", desc: "Efek pergantian halaman (Beranda/Menu/Keranjang/Profil/dll)" },
  cartBadge: { label: "Badge Keranjang", desc: "Animasi badge jumlah item saat bertambah" },
};

/* ================= KATALOG EFEK (kunci tervalidasi) ================= */

/** Efek untuk target TEKS (MotionText). */
export const MOTION_TEXT_EFFECTS = [
  "none",
  "fade",
  "slideUp",
  "slideDown",
  "slideLeft",
  "slideRight",
  "zoomIn",
  "zoomOut",
  "pop",
  "bounce",
  "elastic",
  "float",
  "wave",
  "flip3d",
  "rotate3d",
  "neon",
  "blurReveal",
  "tracking",
  "typewriter",
  "staggerLetter",
  "glitch",
  "kinetic",
  // ===== Teknik animasi teks Beranda (2026-11-28) =====
  "staggerReveal", // Staggered Text Reveal — tiap kata muncul bergantian
  "slideInSmooth", // Smooth Slide-In — teks masuk lembut dari samping
  "fadeUp", // Fade-In Up — muncul halus dari bawah
  "pulseSoft", // Subtle Pulse — denyut lembut berulang
  "shimmerText", // Gradient Shimmer — kilauan bergerak pada huruf
  "showcase", // Gabungan 5 teknik sekaligus (khusus teks Beranda)
] as const;
export type MotionTextEffect = (typeof MOTION_TEXT_EFFECTS)[number];

/** Efek untuk target KARTU/GAMBAR (MotionBox — entrance + ambient). */
export const MOTION_BOX_EFFECTS = [
  "none",
  "fade",
  "slideUp",
  "slideLeft",
  "slideRight",
  "zoomIn",
  "zoomOut",
  "pop",
  "flip3d",
  "float",
  "pulse",
  "tilt",
  "kenBurns",
  "shimmer",
  "glow",
] as const;
export type MotionBoxEffect = (typeof MOTION_BOX_EFFECTS)[number];

/** Efek transisi ganti halaman. */
export const MOTION_TRANSITION_EFFECTS = [
  "none",
  "fade",
  "slideLeft",
  "slideRight",
  "slideUp",
  "slideDown",
  "zoomIn",
  "zoomOut",
  "flip3d",
  "cube",
  "blur",
  "curtain",
] as const;
export type MotionTransitionEffect = (typeof MOTION_TRANSITION_EFFECTS)[number];

/** Efek splash (varian di atas tampilan bawaan). */
export const MOTION_SPLASH_EFFECTS = ["none", "pop", "glow", "spin", "bounce", "cinematic", "loader"] as const;
export type MotionSplashEffect = (typeof MOTION_SPLASH_EFFECTS)[number];

/** Efek badge (angka kecil). */
export const MOTION_BADGE_EFFECTS = ["none", "pulse", "pop", "bounce", "wiggle"] as const;
export type MotionBadgeEffect = (typeof MOTION_BADGE_EFFECTS)[number];

/** Katalog efek yang BERLAKU untuk tiap target (validasi server & UI). */
export const MOTION_EFFECT_CATALOG: Record<MotionTargetKey, readonly string[]> = {
  heroTitle: MOTION_TEXT_EFFECTS,
  sectionTitles: MOTION_TEXT_EFFECTS,
  productCards: MOTION_BOX_EFFECTS,
  promoStrip: MOTION_BOX_EFFECTS,
  bannerPopup: MOTION_BOX_EFFECTS,
  headerLogo: MOTION_BOX_EFFECTS,
  splash: MOTION_SPLASH_EFFECTS,
  pageTransition: MOTION_TRANSITION_EFFECTS,
  cartBadge: MOTION_BADGE_EFFECTS,
};

/** Label efek (UI). */
export const MOTION_EFFECT_LABELS: Record<string, string> = {
  none: "Tanpa Animasi",
  fade: "Fade In",
  slideUp: "Slide Up",
  slideDown: "Slide Down",
  slideLeft: "Slide Left",
  slideRight: "Slide Right",
  zoomIn: "Zoom In",
  zoomOut: "Zoom Out",
  pop: "Pop-up",
  bounce: "Bounce",
  elastic: "Elastic",
  float: "Floating",
  wave: "Wave",
  flip3d: "3D Flip",
  rotate3d: "3D Rotate",
  neon: "Neon Glow",
  blurReveal: "Blur Reveal",
  tracking: "Tracking",
  typewriter: "Typewriter",
  staggerLetter: "Stagger Letter",
  glitch: "Glitch",
  kinetic: "Kinetic",
  staggerReveal: "Staggered Reveal (per kata)",
  slideInSmooth: "Slide-In Halus (dari samping)",
  fadeUp: "Fade-In Up",
  pulseSoft: "Pulse Lembut (denyut)",
  shimmerText: "Shimmer Teks (kilauan)",
  showcase: "Showcase Beranda (5-in-1)",
  tilt: "3D Tilt",
  kenBurns: "Ken Burns",
  shimmer: "Shimmer",
  glow: "Cahaya",
  pulse: "Pulse",
  wiggle: "Wiggle",
  cube: "3D Cube",
  curtain: "Curtain",
  spin: "Spin",
  cinematic: "Cinematic",
  loader: "Logo Loading",
};

/* ================= PARAMETER ================= */

export const MOTION_EASINGS = ["linear", "easeOut", "easeIn", "easeInOut", "spring", "backOut"] as const;
export type MotionEasing = (typeof MOTION_EASINGS)[number];
export const MOTION_EASING_LABELS: Record<MotionEasing, string> = {
  linear: "Linear",
  easeOut: "Ease Out",
  easeIn: "Ease In",
  easeInOut: "Ease In-Out",
  spring: "Spring",
  backOut: "Back Out",
};

export const MOTION_SPEED_PRESETS = ["verySlow", "slow", "normal", "fast", "veryFast", "custom"] as const;
export type MotionSpeedPreset = (typeof MOTION_SPEED_PRESETS)[number];
export const MOTION_SPEED_LABELS: Record<MotionSpeedPreset, string> = {
  verySlow: "Sangat Lambat",
  slow: "Lambat",
  normal: "Normal",
  fast: "Cepat",
  veryFast: "Sangat Cepat",
  custom: "Kustom",
};
/** Pengali durasi global per preset kecepatan. */
export const MOTION_SPEED_SCALE: Record<Exclude<MotionSpeedPreset, "custom">, number> = {
  verySlow: 1.6,
  slow: 1.3,
  normal: 1,
  fast: 0.75,
  veryFast: 0.55,
};

/** Satu target animasi (parameter lengkap — dipakai runtime). */
export type MotionTarget = {
  /** animasi target ini aktif */
  enabled: boolean;
  /** kunci efek dari katalog target (divalidasi ketat) */
  effect: string;
  /** durasi animasi (detik, 0.2–2) */
  duration: number;
  /** jeda sebelum mulai (detik, 0–1.5) */
  delay: number;
  /** gaya percepatan */
  easing: MotionEasing;
  /** intensitas (10–150) — jarak geser/derajat putar/skala */
  intensity: number;
  /** jeda antar anak/kata (ms, 0–400) */
  stagger: number;
  /** animasi ambient berulang tanpa henti */
  loop: boolean;
};

export type MotionGlobal = {
  /** induk saklar semua animasi studio */
  master: boolean;
  /** animasi aktif di HP */
  mobile: boolean;
  /** animasi aktif di tablet */
  tablet: boolean;
  /** animasi aktif di desktop */
  desktop: boolean;
  /** preset kecepatan global */
  speedPreset: MotionSpeedPreset;
  /** pengali kustom (0.5–2) — dipakai saat preset = custom */
  speedScale: number;
  /** mode performa: perangkat lemah → efek berat (3D/blur) diganti fade */
  perfMode: boolean;
};

export type MotionPreset = {
  id: string;
  name: string;
  /** true = preset bawaan AGSI (tidak bisa dihapus, bisa ditimpa targetnya saat diterapkan) */
  builtin: boolean;
  targets: Partial<Record<MotionTargetKey, MotionTarget>>;
  global?: Partial<MotionGlobal>;
};

export type MotionHistoryEntry = {
  version: number;
  at: string; // ISO
  by: string; // nama/identitas admin
  action: "publish" | "restore" | "reset" | "schedule";
  /** ringkasan singkat perubahan (dibangun server) */
  summary: string;
  /** salinan konfigurasi aktif pada versi ini (untuk restore & banding) */
  config: { global: MotionGlobal; targets: Record<MotionTargetKey, MotionTarget> };
};

export type MotionSchedule = {
  enabled: boolean;
  /** preset yang diterapkan otomatis selama jadwal (id preset bawaan/admin) */
  presetId: string | null;
  /** tanggal mulai & berakhir (YYYY-MM-DD, opsional) */
  startDate: string | null;
  endDate: string | null;
  /** jam aktif per hari (HH:MM, opsional) */
  timeFrom: string | null;
  timeTo: string | null;
};

export type MotionDraft = {
  global: MotionGlobal;
  targets: Record<MotionTargetKey, MotionTarget>;
  updatedAt: string | null;
  by: string | null;
};

/** Dokumen lengkap di kolom `motion` (aktif + draft + preset + riwayat + jadwal). */
export type MotionDoc = {
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  global: MotionGlobal;
  targets: Record<MotionTargetKey, MotionTarget>;
  presets: MotionPreset[];
  history: MotionHistoryEntry[];
  schedule: MotionSchedule;
  draft: MotionDraft | null;
};

/** Yang dikirim ke publik (snapshot /api/settings) — kecil, tanpa draft/riwayat. */
export type MotionPublic = {
  version: number;
  updatedAt: string | null;
  global: MotionGlobal;
  targets: Record<MotionTargetKey, MotionTarget>;
  /** jadwal sedang berjalan? (dievaluasi server) */
  scheduled: boolean;
};

/* ================= NILAI BAWAAN ================= */

function target(effect: string, over: Partial<MotionTarget> = {}): MotionTarget {
  return {
    enabled: true,
    effect,
    duration: 0.6,
    delay: 0,
    easing: "easeOut",
    intensity: 100,
    stagger: 70,
    loop: false,
    ...over,
  };
}

/** Target bawaan — halus, tidak mengganggu; transisi halaman = fade
    (persis perilaku lama) supaya pembaruan ini tidak mengubah rasa aplikasi. */
export const DEFAULT_MOTION_TARGETS: Record<MotionTargetKey, MotionTarget> = {
  heroTitle: target("fade", { duration: 0.7, delay: 0.05 }),
  sectionTitles: target("slideUp", { duration: 0.5, stagger: 80 }),
  productCards: target("slideUp", { duration: 0.45, stagger: 60 }),
  promoStrip: target("zoomIn", { duration: 0.6 }),
  bannerPopup: target("zoomIn", { duration: 0.55 }),
  headerLogo: target("float", { duration: 3, loop: true, easing: "easeInOut" }),
  splash: target("pop", { duration: 0.6 }),
  pageTransition: target("fade", { duration: 0.26 }),
  cartBadge: target("pop", { duration: 0.4 }),
};

export const DEFAULT_MOTION_GLOBAL: MotionGlobal = {
  master: true,
  mobile: true,
  tablet: true,
  desktop: true,
  speedPreset: "normal",
  speedScale: 1,
  perfMode: false,
};

export const DEFAULT_MOTION_SCHEDULE: MotionSchedule = {
  enabled: false,
  presetId: null,
  startDate: null,
  endDate: null,
  timeFrom: null,
  timeTo: null,
};

/* ============ PRESET BAWAAN (13 — sesuai katalog Motion Studio) ============ */

function presetTargets(entries: Partial<Record<MotionTargetKey, Partial<MotionTarget>>>): Partial<Record<MotionTargetKey, MotionTarget>> {
  const out: Partial<Record<MotionTargetKey, MotionTarget>> = {};
  for (const [k, v] of Object.entries(entries)) {
    const key = k as MotionTargetKey;
    out[key] = { ...DEFAULT_MOTION_TARGETS[key], ...v };
  }
  return out;
}

/** 13 preset bawaan — tiap preset = kumpulan target siap pakai. */
export const BUILTIN_MOTION_PRESETS: MotionPreset[] = [
  {
    id: "agsi-signature",
    name: "AGSI Signature Motion",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "fade", duration: 0.7 },
      sectionTitles: { effect: "slideUp", stagger: 80 },
      productCards: { effect: "slideUp", stagger: 60 },
      promoStrip: { effect: "zoomIn" },
      bannerPopup: { effect: "zoomIn" },
      headerLogo: { effect: "float", duration: 3, loop: true },
      splash: { effect: "pop" },
      pageTransition: { effect: "fade", duration: 0.26 },
      cartBadge: { effect: "pop" },
    }),
  },
  {
    id: "cinematic",
    name: "Cinematic Motion",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "blurReveal", duration: 1.1, easing: "easeInOut" },
      sectionTitles: { effect: "tracking", duration: 0.9 },
      productCards: { effect: "zoomIn", duration: 0.7, stagger: 110 },
      promoStrip: { effect: "kenBurns", duration: 1.2 },
      bannerPopup: { effect: "blurReveal", duration: 0.9 },
      splash: { effect: "cinematic", duration: 0.9 },
      pageTransition: { effect: "blur", duration: 0.4 },
    }),
  },
  {
    id: "premium-3d",
    name: "Premium 3D",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "rotate3d", duration: 0.9 },
      sectionTitles: { effect: "flip3d", duration: 0.7, stagger: 90 },
      productCards: { effect: "flip3d", duration: 0.7, stagger: 90 },
      promoStrip: { effect: "tilt" },
      bannerPopup: { effect: "flip3d", duration: 0.7 },
      headerLogo: { effect: "tilt", duration: 4, loop: true },
      splash: { effect: "spin", duration: 0.8 },
      pageTransition: { effect: "cube", duration: 0.5 },
      cartBadge: { effect: "wiggle" },
    }),
  },
  {
    id: "smooth-elegant",
    name: "Smooth Elegant",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "slideUp", duration: 0.8, easing: "easeInOut" },
      sectionTitles: { effect: "fade", duration: 0.7 },
      productCards: { effect: "fade", duration: 0.6, stagger: 90 },
      promoStrip: { effect: "fade" },
      bannerPopup: { effect: "zoomIn", duration: 0.7, easing: "easeInOut" },
      headerLogo: { effect: "float", duration: 4, loop: true },
      pageTransition: { effect: "fade", duration: 0.35, easing: "easeInOut" },
    }),
  },
  {
    id: "minimal",
    name: "Minimal Motion",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "fade", duration: 0.4 },
      sectionTitles: { effect: "fade", duration: 0.35, stagger: 50 },
      productCards: { effect: "fade", duration: 0.35, stagger: 40 },
      promoStrip: { effect: "none" },
      bannerPopup: { effect: "fade", duration: 0.4 },
      headerLogo: { effect: "none" },
      pageTransition: { effect: "fade", duration: 0.2 },
      cartBadge: { effect: "none" },
    }),
  },
  {
    id: "dynamic",
    name: "Dynamic Motion",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "kinetic", duration: 0.7, stagger: 60 },
      sectionTitles: { effect: "pop", duration: 0.5, stagger: 70 },
      productCards: { effect: "pop", duration: 0.5, stagger: 70 },
      promoStrip: { effect: "pulse", loop: true, duration: 2.4 },
      bannerPopup: { effect: "pop", duration: 0.5 },
      splash: { effect: "bounce", duration: 0.6 },
      pageTransition: { effect: "slideUp", duration: 0.3 },
      cartBadge: { effect: "bounce" },
    }),
  },
  {
    id: "neon",
    name: "Neon Motion",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "neon", duration: 1.2, loop: true },
      sectionTitles: { effect: "neon", duration: 1.2, stagger: 100, loop: true },
      productCards: { effect: "glow", duration: 0.5, stagger: 80 },
      promoStrip: { effect: "glow", loop: true, duration: 2 },
      pageTransition: { effect: "fade", duration: 0.25 },
    }),
  },
  {
    id: "food-commercial",
    name: "Food Commercial",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "pop", duration: 0.55 },
      sectionTitles: { effect: "wave", duration: 0.8, stagger: 90 },
      productCards: { effect: "zoomIn", duration: 0.45, stagger: 70 },
      promoStrip: { effect: "kenBurns", duration: 1.4 },
      bannerPopup: { effect: "pop", duration: 0.5 },
      splash: { effect: "pop", duration: 0.55 },
      cartBadge: { effect: "wiggle" },
    }),
  },
  {
    id: "modern-ecommerce",
    name: "Modern E-Commerce",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "slideRight", duration: 0.55 },
      sectionTitles: { effect: "slideLeft", duration: 0.5, stagger: 70 },
      productCards: { effect: "slideUp", duration: 0.4, stagger: 55 },
      promoStrip: { effect: "shimmer" },
      bannerPopup: { effect: "slideUp", duration: 0.5 },
      pageTransition: { effect: "slideLeft", duration: 0.28 },
    }),
  },
  {
    id: "gaming",
    name: "Gaming Motion",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "glitch", duration: 0.9, stagger: 60 },
      sectionTitles: { effect: "glitch", duration: 0.8, stagger: 70 },
      productCards: { effect: "flip3d", duration: 0.55, stagger: 65 },
      promoStrip: { effect: "pulse", loop: true, duration: 1.8 },
      bannerPopup: { effect: "flip3d", duration: 0.55 },
      splash: { effect: "glow", duration: 0.8 },
      pageTransition: { effect: "zoomIn", duration: 0.3 },
      cartBadge: { effect: "pulse" },
    }),
  },
  {
    id: "social-promo",
    name: "Social Media Promo",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "wave", duration: 0.8, stagger: 80 },
      sectionTitles: { effect: "elastic", duration: 0.6, stagger: 75 },
      productCards: { effect: "pop", duration: 0.45, stagger: 65 },
      promoStrip: { effect: "shimmer" },
      bannerPopup: { effect: "pop", duration: 0.5 },
      splash: { effect: "bounce", duration: 0.6 },
    }),
  },
  {
    id: "luxury",
    name: "Luxury Motion",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "tracking", duration: 1, easing: "easeInOut" },
      sectionTitles: { effect: "blurReveal", duration: 0.9, stagger: 100 },
      productCards: { effect: "fade", duration: 0.8, stagger: 120 },
      promoStrip: { effect: "glow" },
      bannerPopup: { effect: "zoomOut", duration: 0.8, easing: "easeInOut" },
      headerLogo: { effect: "glow", duration: 3.5, loop: true },
      splash: { effect: "cinematic", duration: 1 },
      pageTransition: { effect: "curtain", duration: 0.5 },
    }),
  },
  {
    id: "professional",
    name: "Professional Business",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "slideUp", duration: 0.5 },
      sectionTitles: { effect: "fade", duration: 0.45, stagger: 60 },
      productCards: { effect: "slideUp", duration: 0.4, stagger: 55 },
      promoStrip: { effect: "zoomIn", duration: 0.5 },
      bannerPopup: { effect: "fade", duration: 0.45 },
      headerLogo: { effect: "none" },
      splash: { effect: "none" },
      pageTransition: { effect: "fade", duration: 0.22 },
      cartBadge: { effect: "pop", duration: 0.3 },
    }),
  },
  {
    // Preset "animasi teks beranda" — 5 teknik sekaligus: staggered reveal,
    // slide-in halus, fade-in up, pulse lembut & gradient shimmer.
    id: "beranda-showcase",
    name: "Teks Beranda Showcase",
    builtin: true,
    targets: presetTargets({
      heroTitle: { effect: "showcase", duration: 0.7, stagger: 110, intensity: 110, loop: true },
      sectionTitles: { effect: "staggerReveal", duration: 0.55, stagger: 80 },
      productCards: { effect: "fadeUp", duration: 0.5, stagger: 65 },
      promoStrip: { effect: "shimmer", duration: 2.6, loop: true },
      bannerPopup: { effect: "fadeUp", duration: 0.5 },
      headerLogo: { effect: "float", duration: 3.5, loop: true },
      pageTransition: { effect: "fade", duration: 0.26 },
    }),
  },
];

/** Preset bawaan pertama = dokumen default yang baru direset. */
export function defaultMotionDoc(): MotionDoc {
  return {
    version: 1,
    updatedAt: null,
    updatedBy: null,
    global: { ...DEFAULT_MOTION_GLOBAL },
    targets: Object.fromEntries(
      MOTION_TARGET_KEYS.map((k) => [k, { ...DEFAULT_MOTION_TARGETS[k] }])
    ) as Record<MotionTargetKey, MotionTarget>,
    presets: [],
    history: [],
    schedule: { ...DEFAULT_MOTION_SCHEDULE },
    draft: null,
  };
}

/* ================= NORMALISASI (server & client — tameng payload) ================= */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function clampN(v: unknown, min: number, max: number, def: number, round = false): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const c = Math.min(max, Math.max(min, n));
  return round ? Math.round(c) : Math.round(c * 1000) / 1000;
}

function pickEffect(raw: unknown, catalog: readonly string[], def: string): string {
  return typeof raw === "string" && catalog.includes(raw) ? raw : def;
}

function pickEasing(raw: unknown, def: MotionEasing): MotionEasing {
  return typeof raw === "string" && (MOTION_EASINGS as readonly string[]).includes(raw)
    ? (raw as MotionEasing)
    : def;
}

function normalizeTarget(key: MotionTargetKey, raw: unknown): MotionTarget {
  const def = DEFAULT_MOTION_TARGETS[key];
  const r = (raw ?? {}) as Partial<MotionTarget>;
  return {
    enabled: r.enabled !== false,
    effect: pickEffect(r.effect, MOTION_EFFECT_CATALOG[key], def.effect),
    duration: clampN(r.duration, 0.2, 2, def.duration),
    delay: clampN(r.delay, 0, 1.5, def.delay),
    easing: pickEasing(r.easing, def.easing),
    intensity: clampN(r.intensity, 10, 150, def.intensity),
    stagger: clampN(r.stagger, 0, 400, def.stagger, true),
    loop: r.loop === true,
  };
}

function normalizeGlobal(raw: unknown): MotionGlobal {
  const g = (raw ?? {}) as Partial<MotionGlobal>;
  return {
    master: g.master !== false,
    mobile: g.mobile !== false,
    tablet: g.tablet !== false,
    desktop: g.desktop !== false,
    speedPreset: (MOTION_SPEED_PRESETS as readonly string[]).includes(g.speedPreset ?? "")
      ? (g.speedPreset as MotionSpeedPreset)
      : "normal",
    speedScale: clampN(g.speedScale, 0.5, 2, 1),
    perfMode: g.perfMode === true,
  };
}

export function normalizeSchedule(raw: unknown): MotionSchedule {
  const s = (raw ?? {}) as Partial<MotionSchedule>;
  return {
    enabled: s.enabled === true,
    presetId: typeof s.presetId === "string" && s.presetId ? s.presetId : null,
    startDate: typeof s.startDate === "string" && DATE_RE.test(s.startDate) ? s.startDate : null,
    endDate: typeof s.endDate === "string" && DATE_RE.test(s.endDate) ? s.endDate : null,
    timeFrom: typeof s.timeFrom === "string" && TIME_RE.test(s.timeFrom) ? s.timeFrom : null,
    timeTo: typeof s.timeTo === "string" && TIME_RE.test(s.timeTo) ? s.timeTo : null,
  };
}

function normalizePresets(raw: unknown): MotionPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 24).map((p, i) => {
    const r = (p ?? {}) as Partial<MotionPreset>;
    const targets: Partial<Record<MotionTargetKey, MotionTarget>> = {};
    const rt = (r.targets ?? {}) as Record<string, unknown>;
    for (const k of MOTION_TARGET_KEYS) {
      if (rt[k] && typeof rt[k] === "object") targets[k] = normalizeTarget(k, rt[k]);
    }
    return {
      id: typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 40) : `preset-${Date.now()}-${i}`,
      name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 40) : `Preset ${i + 1}`,
      builtin: r.builtin === true,
      targets,
      global: r.global ? normalizeGlobal(r.global) : undefined,
    };
  });
}

function normalizeHistory(raw: unknown): MotionHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 15).map((h, i) => {
    const r = (h ?? {}) as Partial<MotionHistoryEntry>;
    const cfg = (r.config ?? {}) as { global?: unknown; targets?: unknown };
    const targets: Record<string, unknown> = (cfg.targets ?? {}) as Record<string, unknown>;
    return {
      version: Number.isFinite(Number(r.version)) ? Math.max(1, Math.round(Number(r.version))) : i + 1,
      at: typeof r.at === "string" ? r.at : new Date().toISOString(),
      by: typeof r.by === "string" ? r.by.slice(0, 80) : "—",
      action: r.action === "restore" || r.action === "reset" || r.action === "schedule" ? r.action : "publish",
      summary: typeof r.summary === "string" ? r.summary.slice(0, 200) : "",
      config: {
        global: normalizeGlobal(cfg.global),
        targets: Object.fromEntries(
          MOTION_TARGET_KEYS.map((k) => [k, normalizeTarget(k, targets[k])])
        ) as Record<MotionTargetKey, MotionTarget>,
      },
    };
  });
}

/** Normalisasi dokumen penuh — aman dipakai ulang di server & client. */
export function normalizeMotionDoc(raw: unknown): MotionDoc {
  const def = defaultMotionDoc();
  const r = (raw ?? {}) as Partial<MotionDoc>;
  const dRaw = (r.draft ?? null) as Partial<MotionDraft> | null;
  return {
    version: Number.isFinite(Number(r.version)) ? Math.max(1, Math.round(Number(r.version))) : 1,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : null,
    global: normalizeGlobal(r.global),
    targets: Object.fromEntries(
      MOTION_TARGET_KEYS.map((k) => [k, normalizeTarget(k, (r.targets ?? {})[k])])
    ) as Record<MotionTargetKey, MotionTarget>,
    presets: normalizePresets(r.presets),
    history: normalizeHistory(r.history),
    schedule: normalizeSchedule(r.schedule),
    draft:
      dRaw && typeof dRaw === "object"
        ? {
            global: normalizeGlobal(dRaw.global),
            targets: Object.fromEntries(
              MOTION_TARGET_KEYS.map((k) => [k, normalizeTarget(k, (dRaw.targets ?? {})[k])])
            ) as Record<MotionTargetKey, MotionTarget>,
            updatedAt: typeof dRaw.updatedAt === "string" ? dRaw.updatedAt : null,
            by: typeof dRaw.by === "string" ? dRaw.by : null,
          }
        : null,
  };
}

/** Apakah jadwal sedang berjalan pada `now` (dievaluasi server & client sama). */
export function isScheduleActive(s: MotionSchedule, now: Date = new Date()): boolean {
  if (!s.enabled) return false;
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (s.startDate && ymd < s.startDate) return false;
  if (s.endDate && ymd > s.endDate) return false;
  if (s.timeFrom && s.timeTo) {
    const mins = now.getHours() * 60 + now.getMinutes();
    const from = Number(s.timeFrom.slice(0, 2)) * 60 + Number(s.timeFrom.slice(3, 5));
    const to = Number(s.timeTo.slice(0, 2)) * 60 + Number(s.timeTo.slice(3, 5));
    // rentang melewati tengah malam → aktif bila di luar [to, from]
    if (from <= to) {
      if (mins < from || mins > to) return false;
    } else if (mins < from && mins > to) return false;
  }
  return true;
}

/** Terapkan jadwal ke target aktif: bila jadwal berjalan & preset ada →
    target preset menimpa target aktif (fallback tetap aman). */
export function applySchedule(doc: MotionDoc, now: Date = new Date()): { targets: Record<MotionTargetKey, MotionTarget>; scheduled: boolean } {
  if (!isScheduleActive(doc.schedule, now)) {
    return { targets: doc.targets, scheduled: false };
  }
  const preset = [...BUILTIN_MOTION_PRESETS, ...doc.presets].find((p) => p.id === doc.schedule.presetId);
  if (!preset) return { targets: doc.targets, scheduled: true };
  return {
    targets: Object.fromEntries(
      MOTION_TARGET_KEYS.map((k) => [k, preset.targets[k] ?? doc.targets[k]])
    ) as Record<MotionTargetKey, MotionTarget>,
    scheduled: true,
  };
}

/** Ringkasan PUBLIK dari dokumen (dipakai snapshot /api/settings di server &
    normalisasi payload di client — murni, tanpa import DB). */
export function motionPublicOf(doc: MotionDoc): MotionPublic {
  const { targets, scheduled } = applySchedule(doc);
  return {
    version: doc.version,
    updatedAt: doc.updatedAt,
    global: doc.global,
    targets,
    scheduled,
  };
}

/** Normalisasi ringkasan publik (tameng payload di client). */
export function normalizeMotionPublic(raw: unknown): MotionPublic {
  const def = motionPublicOf(defaultMotionDoc());
  const r = (raw ?? {}) as Partial<MotionPublic>;
  const targets: Record<string, unknown> = (r.targets ?? {}) as Record<string, unknown>;
  return {
    version: Number.isFinite(Number(r.version)) ? Math.max(1, Math.round(Number(r.version))) : def.version,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
    global: normalizeGlobal(r.global),
    targets: Object.fromEntries(
      MOTION_TARGET_KEYS.map((k) => [k, normalizeTarget(k, targets[k])])
    ) as Record<MotionTargetKey, MotionTarget>,
    scheduled: r.scheduled === true,
  };
}

/** Ringkasan perubahan antara dua konfigurasi target (utk riwayat). */
export function summarizeTargetChanges(
  before: Record<MotionTargetKey, MotionTarget>,
  after: Record<MotionTargetKey, MotionTarget>
): string {
  const parts: string[] = [];
  for (const k of MOTION_TARGET_KEYS) {
    const b = before[k];
    const a = after[k];
    if (b.effect !== a.effect || b.enabled !== a.enabled) {
      parts.push(`${MOTION_TARGET_META[k].label}: ${a.enabled ? b.effect + "→" + a.effect : "mati"}`);
    } else if (Math.abs(b.duration - a.duration) >= 0.05 || b.stagger !== a.stagger || b.delay !== a.delay) {
      parts.push(`${MOTION_TARGET_META[k].label}: parameter`);
    }
  }
  if (parts.length === 0) return "tanpa perubahan target";
  return `${parts.length} target diubah — ${parts.slice(0, 3).join("; ")}${parts.length > 3 ? "; …" : ""}`;
}
