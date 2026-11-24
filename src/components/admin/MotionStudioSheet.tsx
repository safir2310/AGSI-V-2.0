"use client";

/* ============================================================
   AGSI MOTION STUDIO — ADVANCED ANIMATION CONTROL CENTER (UI)
   ============================================================
   Pusat kendali seluruh animasi yang dikelola admin, dalam SATU
   sheet: pratinjau langsung (HP/Tablet/Desktop), pengaturan global,
   9 target animasi dengan inspector parameter, preset library
   (13 bawaan + preset admin), jadwal otomatis, riwayat versi
   (restore/reset), dan alur DRAFT → PUBLISH.

   Publikasi = PUT {motion:{kind:"publish"}} di /api/settings:
   divalidasi server, versi naik, riwayat tercatat, lalu event SSE
   "settings" menyebarkan konfigurasi baru ke SEMUA perangkat tanpa
   polling tambahan. Pengunjung TIDAK melihat draf — hanya yang
   sudah dipublikasikan. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Clapperboard, Download, History, Loader2, PlayCircle, RotateCcw, Save, Upload, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  MotionBox,
  MotionText,
  badgeAnim,
  boxAnim,
  useChanged,
  useMotionPreviewStore,
} from "@/components/motion/MotionRuntime";
import {
  BUILTIN_MOTION_PRESETS,
  DEFAULT_MOTION_GLOBAL,
  DEFAULT_MOTION_TARGETS,
  MOTION_BADGE_EFFECTS,
  MOTION_BOX_EFFECTS,
  MOTION_EASINGS,
  MOTION_EASING_LABELS,
  MOTION_EFFECT_CATALOG,
  MOTION_EFFECT_LABELS,
  MOTION_SPEED_LABELS,
  MOTION_SPEED_PRESETS,
  MOTION_SPLASH_EFFECTS,
  MOTION_TARGET_KEYS,
  MOTION_TARGET_META,
  MOTION_TEXT_EFFECTS,
  MOTION_TRANSITION_EFFECTS,
  normalizeMotionDoc,
  type MotionGlobal,
  type MotionPreset,
  type MotionPublic,
  type MotionSchedule,
  type MotionTarget,
  type MotionTargetKey,
} from "@/lib/motion-config";
import { apiFetch } from "@/lib/api";
import { useSettingsStore } from "@/lib/hooks";
import { useNoticeStore } from "@/lib/store";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

export type MotionStudioSheetProps = {
  open: boolean;
  onClose: () => void;
};

type StudioDraft = {
  global: MotionGlobal;
  targets: Record<MotionTargetKey, MotionTarget>;
};

type StudioDoc = {
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  presets: MotionPreset[];
  history: {
    version: number;
    at: string;
    by: string;
    action: string;
    summary: string;
  }[];
  schedule: MotionSchedule;
  draft: { updatedAt: string | null; by: string | null } | null;
};

const DEVICE_LABELS: Record<"mobile" | "tablet" | "desktop", string> = {
  mobile: "HP 375px",
  tablet: "Tablet 700px",
  desktop: "Desktop Penuh",
};
const BG_CLASS = {
  terang: "bg-neutral-100",
  gelap: "bg-neutral-900",
  oranye: "bg-brand-gradient",
};

/** Katalog efek per target (kelompok teks/kartu/ lainnya) utk chip inspector. */
function catalogOf(key: MotionTargetKey): readonly string[] {
  return MOTION_EFFECT_CATALOG[key];
}

/** Chip pilihan kecil. */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press-effect rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors",
        active
          ? "bg-orange-600 text-white shadow-md shadow-orange-500/25"
          : "bg-neutral-100 text-neutral-600 hover:bg-orange-100"
      )}
    >
      {children}
    </button>
  );
}

/** Baris slider dgn label & nilai. */
function RangeRow({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-bold text-neutral-600">
        <span>{label}</span>
        <span className="rounded-md bg-orange-50 px-1.5 py-0.5 font-black text-orange-700">{fmt(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-neutral-200 accent-orange-600"
      />
    </div>
  );
}

export function MotionStudioSheet({ open, onClose }: MotionStudioSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const publicMotion = useSettingsStore((s) => s.motion);

  const [doc, setDoc] = useState<StudioDoc | null>(null);
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [schedule, setSchedule] = useState<MotionSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"draft" | "publish" | "restore" | "reset" | null>(null);
  const [openTarget, setOpenTarget] = useState<MotionTargetKey | null>("heroTitle");
  const [device, setDevice] = useState<"mobile" | "tablet" | "desktop">("mobile");
  const [bg, setBg] = useState<keyof typeof BG_CLASS>("terang");
  const [previewText, setPreviewText] = useState("Ayam Geprek Sambal Ijo");
  const [presetName, setPresetName] = useState("");
  const [importText, setImportText] = useState("");
  const [replayKey, setReplayKey] = useState(0);
  const [showHistory, setShowHistory] = useState(false);

  const preview = useMotionPreviewStore();

  /** Muat dokumen penuh (khusus admin) saat sheet dibuka. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch("/api/settings", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        const full = normalizeMotionDoc(data.motionStudio);
        const d: StudioDoc = {
          version: full.version,
          updatedAt: full.updatedAt,
          updatedBy: full.updatedBy,
          presets: full.presets,
          history: full.history.map((h) => ({ version: h.version, at: h.at, by: h.by, action: h.action, summary: h.summary })),
          schedule: full.schedule,
          draft: full.draft ? { updatedAt: full.draft.updatedAt, by: full.draft.by } : null,
        };
        setDoc(d);
        setSchedule(full.schedule);
        setDraft(
          full.draft
            ? { global: full.draft.global, targets: full.draft.targets }
            : { global: full.global, targets: full.targets }
        );
      } catch {
        if (!cancelled) {
          setDoc(null);
          setDraft({
            global: { ...DEFAULT_MOTION_GLOBAL },
            targets: { ...DEFAULT_MOTION_TARGETS },
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** Pratinjau langsung: draf dipasang ke store preview (semua komponen
      runtime di seluruh halaman ikut memakainya secara aman — pengunjung
      lain TIDAK terpengaruh, ini hanya state browser admin ini). */
  useEffect(() => {
    if (!open || !draft) return;
    preview.show({
      version: 0,
      updatedAt: null,
      global: draft.global,
      targets: draft.targets,
      scheduled: false,
    });
    preview.setDevice(device);
    return () => undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, device]);

  /** Tutup sheet → matikan preview. */
  const handleClose = useCallback(() => {
    preview.clear();
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const patchTarget = useCallback((key: MotionTargetKey, patch: Partial<MotionTarget>) => {
    setDraft((d) =>
      d ? { ...d, targets: { ...d.targets, [key]: { ...d.targets[key], ...patch } } } : d
    );
  }, []);

  const patchGlobal = useCallback((patch: Partial<MotionGlobal>) => {
    setDraft((d) => (d ? { ...d, global: { ...d.global, ...patch } } : d));
  }, []);

  /** Terapkan preset: target preset menimpa draf (yang tak ada di preset tetap). */
  const applyPreset = useCallback(
    (p: MotionPreset) => {
      setDraft((d) => {
        if (!d) return d;
        const targets = { ...d.targets };
        for (const k of MOTION_TARGET_KEYS) {
          if (p.targets[k]) targets[k] = { ...p.targets[k]! };
        }
        return { global: { ...d.global, ...(p.global ?? {}) }, targets };
      });
      setReplayKey((n) => n + 1);
      showNotice({
        type: "success",
        title: `Preset ${p.name} Diterapkan`,
        message: "Pratinjau langsung berubah — tekan Publikasikan untuk menerapkan ke semua pelanggan.",
      });
    },
    [showNotice]
  );

  /** Simpan draf / publikasikan / restore / reset — SATU jalur API. */
  const send = useCallback(
    async (kind: "draft" | "publish" | "restore" | "reset", extra: Record<string, unknown> = {}) => {
      if (!draft) return;
      setSaving(kind);
      try {
        if (kind === "draft") {
          const res = await apiFetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ motion: { kind: "draft", global: draft.global, targets: draft.targets } }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan draf.");
          showNotice({ type: "success", title: "Draf Disimpan", message: "Perubahan belum tayang — tekan Publikasikan saat sudah pas." });
        } else if (kind === "publish") {
          // 1) simpan draf (sumber kebenaran) → 2) publikasikan (versi naik + riwayat + SSE)
          const r1 = await apiFetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ motion: { kind: "draft", global: draft.global, targets: draft.targets } }),
          });
          if (!r1.ok) {
            const d1 = await r1.json().catch(() => ({}));
            throw new Error(d1.error ?? "Gagal menyimpan draf.");
          }
          const r2 = await apiFetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ motion: { kind: "publish" } }),
          });
          const d2 = await r2.json().catch(() => ({}));
          if (!r2.ok) throw new Error(d2.error ?? "Gagal mempublikasikan.");
          showNotice({
            type: "success",
            title: `Terspublikasikan (v${d2.motion?.version ?? "?"}) 🎬`,
            message: "Konfigurasi baru tersinkron ke semua perangkat dalam ±1–6 detik lewat koneksi real-time.",
          });
          await useSettingsStore.getState().load(true);
        } else if (kind === "restore") {
          const res = await apiFetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ motion: { kind: "restore", version: extra.version } }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Gagal memulihkan versi.");
          showNotice({ type: "success", title: `Versi v${extra.version} Dipulihkan`, message: "Konfigurasi lama kembali aktif sebagai versi terbaru." });
          await useSettingsStore.getState().load(true);
        } else {
          const res = await apiFetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ motion: { kind: "reset" } }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Gagal reset.");
          showNotice({ type: "success", title: "Reset ke Bawaan", message: "Seluruh target kembali ke gaya AGSI Signature." });
          await useSettingsStore.getState().load(true);
        }
        // Muat ulang dokumen studio (riwayat & status draf segar)
        const g = await apiFetch("/api/settings", { cache: "no-store" });
        const gd = await g.json();
        const full = normalizeMotionDoc(gd.motionStudio);
        setDoc({
          version: full.version,
          updatedAt: full.updatedAt,
          updatedBy: full.updatedBy,
          presets: full.presets,
          history: full.history.map((h) => ({ version: h.version, at: h.at, by: h.by, action: h.action, summary: h.summary })),
          schedule: full.schedule,
          draft: full.draft ? { updatedAt: full.draft.updatedAt, by: full.draft.by } : null,
        });
        if (kind !== "draft") {
          setDraft(full.draft ? { global: full.draft.global, targets: full.draft.targets } : { global: full.global, targets: full.targets });
        }
      } catch (e) {
        showNotice({
          type: "error",
          title: "Gagal",
          message: e instanceof Error ? e.message : "Terjadi kesalahan tak terduga.",
        });
      } finally {
        setSaving(null);
      }
    },
    [draft, showNotice]
  );

  /** Simpan jadwal lewat aksi "schedule" (server menaikkan versi + riwayat +
      SSE menyebar; jadwal dievaluasi di server pada snapshot publik). */
  const saveSchedule = useCallback(
    async (s: MotionSchedule) => {
      setSchedule(s);
      setSaving("draft");
      try {
        const res = await apiFetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ motion: { kind: "schedule", schedule: s } }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan jadwal.");
        showNotice({ type: "success", title: "Jadwal Disimpan", message: "Animasi otomatis berganti sesuai jendela jadwal & kembali sendiri setelahnya." });
        await useSettingsStore.getState().load(true);
        const g = await apiFetch("/api/settings", { cache: "no-store" });
        const gd = await g.json();
        const full = normalizeMotionDoc(gd.motionStudio);
        setDoc((d) =>
          d
            ? {
                ...d,
                version: full.version,
                updatedAt: full.updatedAt,
                updatedBy: full.updatedBy,
                history: full.history.map((h) => ({ version: h.version, at: h.at, by: h.by, action: h.action, summary: h.summary })),
                schedule: full.schedule,
                draft: full.draft ? { updatedAt: full.draft.updatedAt, by: full.draft.by } : null,
              }
            : d
        );
        setSchedule(full.schedule);
      } catch (e) {
        showNotice({ type: "error", title: "Gagal", message: e instanceof Error ? e.message : "Gagal menyimpan jadwal." });
      } finally {
        setSaving(null);
      }
    },
    [showNotice]
  );

  /** Simpan preset admin dari draf saat ini. */
  const savePreset = useCallback(() => {
    if (!draft || !presetName.trim()) return;
    const p: MotionPreset = {
      id: `admin-${Date.now()}`,
      name: presetName.trim().slice(0, 40),
      builtin: false,
      targets: { ...draft.targets },
      global: { ...draft.global },
    };
    setDoc((d) => (d ? { ...d, presets: [p, ...d.presets].slice(0, 24) } : d));
    setPresetName("");
    showNotice({
      type: "info",
      title: "Preset Disimpan (lokal)",
      message: "Preset kini bisa diterapkan kapan saja. Terapkan lalu Publikasikan untuk menjadikannya aktif.",
    });
  }, [draft, presetName, showNotice]);

  /** Ekspor / impor konfigurasi (JSON). */
  const exportCfg = useCallback(async () => {
    if (!draft) return;
    const ok = await copyText(JSON.stringify(draft, null, 2));
    showNotice({
      type: ok ? "success" : "error",
      title: ok ? "Konfigurasi Disalin 📋" : "Gagal Menyalin",
      message: ok ? "JSON konfigurasi draf ada di papan klip — simpan atau bagikan ke admin lain." : "Papan klip tidak tersedia di peramban ini.",
    });
  }, [draft, showNotice]);

  const importCfg = useCallback(() => {
    try {
      const parsed = JSON.parse(importText) as { global?: unknown; targets?: unknown };
      const norm = normalizeMotionDoc({ version: 1, global: parsed.global, targets: parsed.targets });
      setDraft({ global: norm.global, targets: norm.targets });
      setImportText("");
      showNotice({ type: "success", title: "Konfigurasi Diimpor", message: "Masuk sebagai DRAF — periksa pratinjau lalu Publikasikan." });
    } catch {
      showNotice({ type: "error", title: "JSON Tidak Valid", message: "Tempel JSON hasil Ekspor konfigurasi dengan benar." });
    }
  }, [importText, showNotice]);

  const demoBadge = useMemo(() => {
    const t = draft?.targets.cartBadge ?? DEFAULT_MOTION_TARGETS.cartBadge;
    return t;
  }, [draft]);
  const badgeTick = useChanged(3);

  const presetAll = useMemo(() => [...BUILTIN_MOTION_PRESETS, ...(doc?.presets ?? [])], [doc]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="motion-studio-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-end justify-center bg-neutral-900/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { y: "100%" }}
            animate={{ y: 0 }}
            exit={prefersReduced ? undefined : { y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="relative flex h-[94dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[1.75rem] bg-white shadow-2xl"
          >
            {/* ===== HEADER ===== */}
            <div className="flex items-center gap-3 border-b border-orange-100 bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] text-white">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20">
                <Clapperboard className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-black leading-tight">AGSI Motion Studio</h2>
                <p className="truncate text-[11px] text-orange-50/90">
                  Pusat kendali animasi • v{doc?.version ?? publicMotion.version} aktif
                  {doc?.draft ? " • DRAF menunggu" : ""}
                </p>
              </div>
              <button
                onClick={handleClose}
                aria-label="Tutup Motion Studio"
                className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/20 transition hover:bg-white/30"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* ===== PUBLISH BAR (draf ≠ aktif) ===== */}
            <div className="flex items-center gap-2 border-b border-orange-100 bg-orange-50/70 px-4 py-2.5">
              <div className="min-w-0 flex-1 text-[11px] leading-tight">
                {doc?.draft ? (
                  <>
                    <p className="font-black text-amber-700">Draf tersimpan — BELUM tayang</p>
                    <p className="truncate text-neutral-500">oleh {doc.draft.by ?? "—"} • publikasikan untuk menerapkan</p>
                  </>
                ) : (
                  <>
                    <p className="font-black text-green-700">Konfigurasi aktif = tersimpan</p>
                    <p className="truncate text-neutral-500">
                      {doc?.updatedAt ? `v${doc.version} • ${new Date(doc.updatedAt).toLocaleString("id-ID")}` : "belum pernah dipublikasikan"}
                    </p>
                  </>
                )}
              </div>
              <button
                onClick={() => void send("draft")}
                disabled={!draft || saving !== null}
                className="press-effect flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-[11px] font-black text-orange-700 ring-1 ring-orange-200 disabled:opacity-50"
              >
                {saving === "draft" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Draf
              </button>
              <button
                onClick={() => void send("publish")}
                disabled={!draft || saving !== null}
                className="press-effect flex items-center gap-1 rounded-xl bg-green-600 px-3 py-2 text-[11px] font-black text-white shadow-md shadow-green-600/25 disabled:opacity-50"
              >
                {saving === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                Publikasikan
              </button>
            </div>

            {/* ===== BODY ===== */}
            <div className="scrollbar-slim flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {loading || !draft ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm font-bold text-neutral-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Memuat konfigurasi animasi…
                </div>
              ) : (
                <>
                  {/* ===== 1. PRATINJAU LANGSUNG ===== */}
                  <div className="rounded-2xl border border-orange-100 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[13px] font-bold text-neutral-800">Pratinjau Langsung</p>
                      <button
                        onClick={() => setReplayKey((n) => n + 1)}
                        className="press-effect flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-black text-orange-700"
                      >
                        <RotateCcw className="h-3 w-3" /> Putar Ulang
                      </button>
                    </div>
                    {/* perangkat */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(["mobile", "tablet", "desktop"] as const).map((d) => (
                        <Chip key={d} active={device === d} onClick={() => setDevice(d)}>
                          {DEVICE_LABELS[d]}
                        </Chip>
                      ))}
                      {(["terang", "gelap", "oranye"] as const).map((b) => (
                        <Chip key={b} active={bg === b} onClick={() => setBg(b)}>
                          {b === "terang" ? "Latar Terang" : b === "gelap" ? "Latar Gelap" : "Latar Oranye"}
                        </Chip>
                      ))}
                    </div>
                    <input
                      value={previewText}
                      onChange={(e) => setPreviewText(e.target.value.slice(0, 60))}
                      placeholder="Teks pratinjau"
                      className="mt-2 w-full rounded-xl border border-orange-200 bg-orange-50/50 px-3 py-2 text-sm font-bold text-neutral-800 outline-none focus:border-orange-400"
                    />
                    {/* kanvas */}
                    <div
                      key={replayKey}
                      className={cn(
                        "mx-auto mt-3 overflow-hidden rounded-2xl p-4 transition-all",
                        BG_CLASS[bg],
                        device === "mobile" && "max-w-[375px]",
                        device === "tablet" && "max-w-[700px]"
                      )}
                    >
                      <MotionText targetKey="heroTitle" className="block text-xl font-black uppercase text-white drop-shadow-sm">
                        {previewText}
                      </MotionText>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {[0, 1, 2, 3].map((i) => (
                          <MotionBox
                            key={i}
                            targetKey="productCards"
                            index={i}
                            className="rounded-xl bg-white/90 p-2 text-center text-[10px] font-bold text-neutral-700 shadow-sm"
                          >
                            <div className="mb-1 text-2xl">{["🍗", "🌶️", "🍚", "🥤"][i]}</div>
                            Menu {i + 1}
                          </MotionBox>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-center">
                        <motion.span
                          className="flex h-6 min-w-6 items-center justify-center rounded-full bg-orange-600 px-1.5 text-[11px] font-black text-white shadow-md"
                          animate={demoBadge.enabled ? badgeAnim(demoBadge, badgeTick).animate : undefined}
                          transition={demoBadge.enabled ? badgeAnim(demoBadge, badgeTick).transition : undefined}
                        >
                          3
                        </motion.span>
                        <span className="ml-2 text-[10px] font-bold text-white/80">badge keranjang</span>
                      </div>
                    </div>
                    <p className="mt-2 rounded-xl bg-orange-50 px-3 py-2 text-[10px] leading-relaxed text-neutral-600 ring-1 ring-orange-100">
                      Pratinjau memakai DRAF di perangkat ini saja — halaman di belakang sheet ikut
                      berubah untuk kamu melihat hasil nyata. Pelanggan masih melihat versi
                      publikasi terakhir sampai kamu menekan <b>Publikasikan</b>.
                    </p>
                  </div>

                  {/* ===== 2. PENGATURAN GLOBAL ===== */}
                  <div className="rounded-2xl border border-orange-100 bg-white p-4">
                    <p className="text-[13px] font-bold text-neutral-800">Pengaturan Global</p>
                    <div className="mt-3 space-y-2.5">
                      <ToggleRow title="Aktifkan Semua Animasi" desc="Induk saklar — matikan untuk mematikan seluruh animasi studio" checked={draft.global.master} onChange={(v) => patchGlobal({ master: v })} />
                      <ToggleRow title="Animasi di HP" desc="Jalankan animasi di perangkat Android/HP" checked={draft.global.mobile} onChange={(v) => patchGlobal({ mobile: v })} />
                      <ToggleRow title="Animasi di Tablet" desc="Jalankan animasi di tablet (640–1023px)" checked={draft.global.tablet} onChange={(v) => patchGlobal({ tablet: v })} />
                      <ToggleRow title="Animasi di Desktop" desc="Jalankan animasi di layar lebar" checked={draft.global.desktop} onChange={(v) => patchGlobal({ desktop: v })} />
                      <ToggleRow title="Mode Performa" desc="Perangkat lemah → efek 3D/blur diganti fade otomatis (hemat CPU & baterai)" checked={draft.global.perfMode} onChange={(v) => patchGlobal({ perfMode: v })} />
                    </div>
                    <p className="mt-3 text-[11px] font-bold text-neutral-600">Kecepatan Global</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {MOTION_SPEED_PRESETS.map((s) => (
                        <Chip key={s} active={draft.global.speedPreset === s} onClick={() => patchGlobal({ speedPreset: s })}>
                          {MOTION_SPEED_LABELS[s]}
                        </Chip>
                      ))}
                    </div>
                    {draft.global.speedPreset === "custom" && (
                      <div className="mt-3">
                        <RangeRow label="Pengali Kustom" value={draft.global.speedScale} min={0.5} max={2} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => patchGlobal({ speedScale: v })} />
                      </div>
                    )}
                    <p className="mt-2 text-[10px] leading-relaxed text-neutral-400">
                      Preferensi “Reduce Motion” di perangkat pelanggan SELALU dihormati — animasi
                      otomatis statis untuk mereka, apa pun setting di sini.
                    </p>
                  </div>

                  {/* ===== 3. TARGET ANIMASI (9) ===== */}
                  <div className="rounded-2xl border border-orange-100 bg-white p-4">
                    <p className="text-[13px] font-bold text-neutral-800">Target Animasi</p>
                    <p className="mt-0.5 text-[11px] text-neutral-400">
                      Setiap elemen punya efek & parameter sendiri — ketuk untuk membuka inspector.
                    </p>
                    <div className="mt-3 space-y-2">
                      {MOTION_TARGET_KEYS.map((k) => {
                        const t = draft.targets[k];
                        const openRow = openTarget === k;
                        const meta = MOTION_TARGET_META[k];
                        return (
                          <div key={k} className={cn("rounded-2xl border transition-colors", openRow ? "border-orange-300 bg-orange-50/40" : "border-neutral-200 bg-white")}>
                            <button
                              type="button"
                              onClick={() => setOpenTarget(openRow ? null : k)}
                              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-[12px] font-black text-neutral-800">{meta.label}</p>
                                <p className="truncate text-[10px] text-neutral-400">
                                  {t.enabled ? `${MOTION_EFFECT_LABELS[t.effect] ?? t.effect} • ${t.duration.toFixed(1)} dtk` : "nonaktif"}
                                </p>
                              </div>
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  patchTarget(k, { enabled: !t.enabled });
                                }}
                                className="cursor-pointer"
                              >
                                <Switch checked={t.enabled} onCheckedChange={(v) => patchTarget(k, { enabled: v })} />
                              </span>
                            </button>
                            {openRow && (
                              <div className="space-y-3 border-t border-orange-100 px-3 py-3">
                                <p className="text-[10px] text-neutral-500">{meta.desc}</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {catalogOf(k).map((fx) => (
                                    <Chip key={fx} active={t.effect === fx} onClick={() => patchTarget(k, { effect: fx })}>
                                      {MOTION_EFFECT_LABELS[fx] ?? fx}
                                    </Chip>
                                  ))}
                                </div>
                                <RangeRow label="Durasi" value={t.duration} min={0.2} max={2} step={0.1} fmt={(v) => `${v.toFixed(1)} dtk`} onChange={(v) => patchTarget(k, { duration: v })} />
                                <RangeRow label="Jeda Awal" value={t.delay} min={0} max={1.5} step={0.05} fmt={(v) => `${v.toFixed(2)} dtk`} onChange={(v) => patchTarget(k, { delay: v })} />
                                <RangeRow label="Intensitas" value={t.intensity} min={10} max={150} step={5} fmt={(v) => `${v}%`} onChange={(v) => patchTarget(k, { intensity: v })} />
                                {(k === "heroTitle" || k === "sectionTitles" || k === "productCards") && (
                                  <RangeRow label="Stagger Antar Kata/Kartu" value={t.stagger} min={0} max={400} step={10} fmt={(v) => `${v} ms`} onChange={(v) => patchTarget(k, { stagger: v })} />
                                )}
                                <div>
                                  <p className="text-[11px] font-bold text-neutral-600">Percepatan</p>
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {MOTION_EASINGS.map((e) => (
                                      <Chip key={e} active={t.easing === e} onClick={() => patchTarget(k, { easing: e })}>
                                        {MOTION_EASING_LABELS[e]}
                                      </Chip>
                                    ))}
                                  </div>
                                </div>
                                <ToggleRow title="Berulang Terus" desc="Animasi ambient berjalan tanpa henti (floating, pulse, glow)" checked={t.loop} onChange={(v) => patchTarget(k, { loop: v })} />
                                {k === "splash" && (
                                  <p className="rounded-xl bg-orange-50 px-3 py-2 text-[10px] leading-relaxed text-neutral-600 ring-1 ring-orange-100">
                                    Efek “Logo Loading” menambah titik loader di bawah logo. Durasi
                                    splash mengikuti Durasi di atas (±1,8–3,4 dtk).
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ===== 4. PRESET LIBRARY ===== */}
                  <div className="rounded-2xl border border-orange-100 bg-white p-4">
                    <p className="text-[13px] font-bold text-neutral-800">Preset Library</p>
                    <p className="mt-0.5 text-[11px] text-neutral-400">
                      13 gaya siap pakai + preset buatanmu. Terapkan → pratinjau berubah → publikasikan.
                    </p>
                    <div className="mt-3 space-y-2">
                      {presetAll.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-black text-neutral-800">{p.name}</p>
                            <p className="text-[10px] text-neutral-400">
                              {p.builtin ? "bawaan AGSI" : `preset admin • ${Object.keys(p.targets).length} target`}
                            </p>
                          </div>
                          {!p.builtin && (
                            <>
                              <button
                                onClick={() => {
                                  const nama = window.prompt("Nama baru preset:", p.name);
                                  if (nama?.trim()) {
                                    setDoc((d) =>
                                      d
                                        ? {
                                            ...d,
                                            presets: d.presets.map((x) => (x.id === p.id ? { ...x, name: nama.trim().slice(0, 40) } : x)),
                                          }
                                        : d
                                    );
                                  }
                                }}
                                className="press-effect rounded-lg bg-neutral-100 px-2 py-1.5 text-[10px] font-black text-neutral-600"
                              >
                                Ganti Nama
                              </button>
                              <button
                                onClick={() => {
                                  const salinan: MotionPreset = { ...p, id: `admin-${Date.now()}`, name: `${p.name} (salinan)`, builtin: false };
                                  setDoc((d) => (d ? { ...d, presets: [salinan, ...d.presets].slice(0, 24) } : d));
                                }}
                                className="press-effect rounded-lg bg-neutral-100 px-2 py-1.5 text-[10px] font-black text-neutral-600"
                              >
                                Gandakan
                              </button>
                              <button
                                onClick={() => setDoc((d) => (d ? { ...d, presets: d.presets.filter((x) => x.id !== p.id) } : d))}
                                className="press-effect rounded-lg bg-red-50 px-2 py-1.5 text-[10px] font-black text-red-600"
                              >
                                Hapus
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => applyPreset(p)}
                            className="press-effect rounded-lg bg-orange-600 px-3 py-1.5 text-[10px] font-black text-white"
                          >
                            Terapkan
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-1.5">
                      <input
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value.slice(0, 40))}
                        placeholder="Nama preset baru dari konfigurasi saat ini"
                        className="min-w-0 flex-1 rounded-xl border border-orange-200 bg-orange-50/50 px-3 py-2 text-[12px] font-bold text-neutral-800 outline-none focus:border-orange-400"
                      />
                      <button
                        onClick={savePreset}
                        disabled={!presetName.trim()}
                        className="press-effect rounded-xl bg-orange-600 px-3 py-2 text-[11px] font-black text-white disabled:opacity-40"
                      >
                        Simpan
                      </button>
                    </div>
                  </div>

                  {/* ===== 5. JADWAL MOTION ===== */}
                  <div className="rounded-2xl border border-orange-100 bg-white p-4">
                    <p className="text-[13px] font-bold text-neutral-800">Jadwal Motion</p>
                    <p className="mt-0.5 text-[11px] text-neutral-400">
                      Ganti gaya animasi otomatis di periode tertentu (promosi pagi, flash sale, hari
                      besar). Setelah jadwal berakhir, konfigurasi aktif kembali sendiri.
                    </p>
                    {schedule && (
                      <div className="mt-3 space-y-2.5">
                        <ToggleRow title="Jadwal Aktif" desc="Terapkan preset terpilih selama jendela jadwal" checked={schedule.enabled} onChange={(v) => void saveSchedule({ ...schedule, enabled: v })} />
                        <div>
                          <p className="text-[11px] font-bold text-neutral-600">Preset Saat Jadwal Berjalan</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <Chip active={schedule.presetId === null} onClick={() => void saveSchedule({ ...schedule, presetId: null })}>
                              Tanpa Preset
                            </Chip>
                            {presetAll.slice(0, 8).map((p) => (
                              <Chip key={p.id} active={schedule.presetId === p.id} onClick={() => void saveSchedule({ ...schedule, presetId: p.id })}>
                                {p.name}
                              </Chip>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px] font-bold text-neutral-600">
                            Mulai
                            <input
                              type="date"
                              value={schedule.startDate ?? ""}
                              onChange={(e) => setSchedule({ ...schedule, startDate: e.target.value || null })}
                              className="mt-1 w-full rounded-xl border border-orange-200 bg-orange-50/50 px-2.5 py-2 text-[12px] font-bold text-neutral-800 outline-none"
                            />
                          </label>
                          <label className="text-[11px] font-bold text-neutral-600">
                            Berakhir
                            <input
                              type="date"
                              value={schedule.endDate ?? ""}
                              onChange={(e) => setSchedule({ ...schedule, endDate: e.target.value || null })}
                              className="mt-1 w-full rounded-xl border border-orange-200 bg-orange-50/50 px-2.5 py-2 text-[12px] font-bold text-neutral-800 outline-none"
                            />
                          </label>
                          <label className="text-[11px] font-bold text-neutral-600">
                            Jam Aktif Dari
                            <input
                              type="time"
                              value={schedule.timeFrom ?? ""}
                              onChange={(e) => setSchedule({ ...schedule, timeFrom: e.target.value || null })}
                              className="mt-1 w-full rounded-xl border border-orange-200 bg-orange-50/50 px-2.5 py-2 text-[12px] font-bold text-neutral-800 outline-none"
                            />
                          </label>
                          <label className="text-[11px] font-bold text-neutral-600">
                            Sampai
                            <input
                              type="time"
                              value={schedule.timeTo ?? ""}
                              onChange={(e) => setSchedule({ ...schedule, timeTo: e.target.value || null })}
                              className="mt-1 w-full rounded-xl border border-orange-200 bg-orange-50/50 px-2.5 py-2 text-[12px] font-bold text-neutral-800 outline-none"
                            />
                          </label>
                        </div>
                        <button
                          onClick={() => void saveSchedule(schedule)}
                          disabled={saving !== null}
                          className="press-effect w-full rounded-xl bg-orange-600 py-2 text-[12px] font-black text-white disabled:opacity-50"
                        >
                          {saving === "draft" ? "Menyimpan…" : "Simpan Jadwal"}
                        </button>
                        <p className="text-[10px] leading-relaxed text-neutral-400">
                          Jadwal dievaluasi di SERVER — pengunjung langsung menerima konfigurasi
                          jadwal lewat snapshot publik, tanpa logika jam di sisi klien.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* ===== 6. RIWAYAT, VERSI, IMPOR/EKSPOR ===== */}
                  <div className="rounded-2xl border border-orange-100 bg-white p-4">
                    <button
                      type="button"
                      onClick={() => setShowHistory((v) => !v)}
                      className="flex w-full items-center gap-2 text-left"
                    >
                      <History className="h-4 w-4 text-orange-600" />
                      <p className="flex-1 text-[13px] font-bold text-neutral-800">
                        Riwayat & Kontrol Versi ({doc?.history.length ?? 0})
                      </p>
                      <span className="text-[10px] font-black text-orange-600">{showHistory ? "tutup" : "buka"}</span>
                    </button>
                    {showHistory && (
                      <div className="mt-3 space-y-2">
                        {doc?.history.length === 0 && (
                          <p className="rounded-xl bg-neutral-50 px-3 py-2 text-[11px] text-neutral-400">
                            Belum ada riwayat — riwayat terisi setiap kali kamu menekan Publikasikan.
                          </p>
                        )}
                        {doc?.history.map((h) => (
                          <div key={h.version} className="rounded-xl border border-neutral-200 px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="rounded-md bg-orange-600 px-1.5 py-0.5 text-[10px] font-black text-white">v{h.version}</span>
                              <span className="text-[10px] font-black uppercase text-neutral-500">
                                {h.action === "publish" ? "publikasi" : h.action === "restore" ? "pulihkan" : "reset"}
                              </span>
                              <span className="ml-auto text-[10px] text-neutral-400">
                                {new Date(h.at).toLocaleString("id-ID")}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-neutral-600">{h.summary}</p>
                            <p className="text-[10px] text-neutral-400">oleh {h.by}</p>
                            <button
                              onClick={() => void send("restore", { version: h.version })}
                              disabled={saving !== null}
                              className="press-effect mt-1.5 rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[10px] font-black text-orange-700 disabled:opacity-50"
                            >
                              Pulihkan v{h.version}
                            </button>
                          </div>
                        ))}
                        <div className="mt-2 flex gap-1.5">
                          <button
                            onClick={() => void send("reset")}
                            disabled={saving !== null}
                            className="press-effect flex-1 rounded-xl bg-red-50 py-2 text-[11px] font-black text-red-600 ring-1 ring-red-200 disabled:opacity-50"
                          >
                            Reset ke Bawaan
                          </button>
                          <button
                            onClick={() => void exportCfg()}
                            className="press-effect flex items-center justify-center gap-1 rounded-xl bg-neutral-100 px-3 py-2 text-[11px] font-black text-neutral-700"
                          >
                            <Download className="h-3.5 w-3.5" /> Ekspor
                          </button>
                        </div>
                        <div className="mt-2 rounded-xl border border-dashed border-neutral-300 p-2.5">
                          <p className="flex items-center gap-1 text-[11px] font-black text-neutral-600">
                            <Upload className="h-3.5 w-3.5" /> Impor Konfigurasi (JSON)
                          </p>
                          <textarea
                            value={importText}
                            onChange={(e) => setImportText(e.target.value.slice(0, 8000))}
                            placeholder='Tempel JSON hasil "Ekspor" di sini…'
                            className="mt-1.5 h-16 w-full resize-none rounded-lg border border-neutral-200 p-2 font-mono text-[10px] text-neutral-700 outline-none focus:border-orange-400"
                          />
                          <button
                            onClick={importCfg}
                            disabled={!importText.trim()}
                            className="press-effect mt-1.5 w-full rounded-lg bg-orange-600 py-1.5 text-[11px] font-black text-white disabled:opacity-40"
                          >
                            Impor sebagai Draf
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <p className="pb-2 text-center text-[10px] leading-relaxed text-neutral-400">
                    AGSI Motion Studio v1 • konfigurasi tersimpan permanen di PostgreSQL • hanya
                    Admin/Owner dapat mengubah (divalidasi di server) • animasi hanya memakai
                    transform/opacity/filter agar situs tetap cepat
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

/** Baris saklar dgn judul & penjelasan (gaya sama dgn sheet admin lain). */
function ToggleRow({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-black text-neutral-800">{title}</p>
        <p className="text-[10px] leading-snug text-neutral-400">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
