"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, Save, Sparkles, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { CourierScene } from "@/components/customer/CourierScene";
import { apiFetch } from "@/lib/api";
import {
  COURIER_ANIM_COLORS,
  COURIER_ANIM_FONTS,
  COURIER_ANIM_WEIGHTS,
  refreshSettings,
  useSettingsStore,
  type CourierAnimInfo,
} from "@/lib/hooks";
import { useNoticeStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export type CourierAnimSheetProps = {
  open: boolean;
  onClose: () => void;
};

/** Label pilihan font & ketebalan (nilai = kunci COURIER_ANIM_* di hooks). */
const FONT_LABELS: Record<CourierAnimInfo["font"], string> = {
  default: "Bawaan",
  serif: "Serif",
  mono: "Mono",
  system: "Sistem",
};
const WEIGHT_LABELS: Record<CourierAnimInfo["weight"], string> = {
  bold: "Tebal",
  extrabold: "Sangat Tebal",
  black: "Hitam",
};
/** Warna pratinjau swatch (hex — hanya untuk UI; teks asli memakai kelas Tailwind). */
const COLOR_HEX: Record<CourierAnimInfo["textColor"], string> = {
  orange: "#ea580c",
  red: "#dc2626",
  rose: "#e11d48",
  amber: "#d97706",
  green: "#16a34a",
  blue: "#2563eb",
  violet: "#7c3aed",
  neutral: "#262626",
};
const COLOR_LABELS: Record<CourierAnimInfo["textColor"], string> = {
  orange: "Oranye",
  red: "Merah",
  rose: "Rose",
  amber: "Amber",
  green: "Hijau",
  blue: "Biru",
  violet: "Violet",
  neutral: "Netral",
};

/** Chip pilihan kecil (font / ketebalan / warna). */
function ChoiceChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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

/** Baris saklar sederhana (label + keterangan + Switch). */
function ToggleRow({
  title,
  desc,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border border-orange-100 bg-white p-3", disabled && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-neutral-800">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={title} />
    </div>
  );
}

/**
 * Sheet "Animasi Beranda" (Profil Admin): kelola adegan kurir + tipografi
 * kinetik — saklar aktif, teks spanduk, font, gaya/ketebalan huruf, warna
 * teks & aksen, ukuran huruf, kecepatan siklus, ledakan BOOM. Pratinjau
 * langsung di atas form memakai komponen adegan yang sama dengan Beranda.
 */
export function CourierAnimSheet({ open, onClose }: CourierAnimSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const storeCfg = useSettingsStore((s) => s.courierAnim);
  const [draft, setDraft] = useState<CourierAnimInfo>(storeCfg);
  const [saving, setSaving] = useState(false);

  // Muat ulang draft setiap sheet dibuka — selalu mulai dari nilai tersimpan
  useEffect(() => {
    if (open) setDraft(storeCfg);
  }, [open, storeCfg]);

  // ESC menutup sheet; kunci scroll latar selama sheet terbuka
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courierAnim: { ...draft, text: draft.text.trim() || "Ayam Geprek Sambal Ijo" },
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        showNotice({
          type: "error",
          title: res.status === 403 ? "Tidak Diizinkan" : "Gagal Menyimpan",
          message: d.error ?? `Server menolak (HTTP ${res.status}). Coba lagi sebentar.`,
        });
        return;
      }
      await refreshSettings();
      showNotice({
        type: "success",
        title: "Animasi Beranda Tersimpan",
        message: "Adegan kurir di Beranda sudah memakai pengaturan terbaru.",
      });
      onClose();
    } catch {
      showNotice({
        type: "error",
        title: "Koneksi Bermasalah",
        message: "Tidak bisa menghubungi server. Periksa internet lalu coba lagi.",
      });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="courier-anim-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Animasi Beranda"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { y: 48, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={prefersReduced ? undefined : { y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            {/* ===== KEPALA ===== */}
            <header className="relative shrink-0 bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Animasi Beranda</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Motor kurir &amp; teks berjalan — gaya, font, warna, kecepatan
                  </p>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Tutup"
                  className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </header>

            {/* ===== ISI ===== */}
            <div className="scrollbar-slim overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              {/* ===== PRATINJAU LANGSUNG ===== */}
              <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-neutral-400">
                Pratinjau langsung — berputar seperti di Beranda
              </p>
              <div className="overflow-hidden rounded-2xl border border-orange-100 bg-orange-50/40 py-2">
                <CourierScene cfg={draft} />
              </div>

              {/* ===== SAKLAR AKTIF ===== */}
              <div
                className={cn(
                  "mt-4 rounded-2xl border p-4 transition-colors",
                  draft.enabled ? "border-orange-200 bg-orange-50/60" : "border-neutral-200 bg-neutral-50"
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      draft.enabled ? "bg-orange-600 text-white" : "bg-neutral-200 text-neutral-400"
                    )}
                  >
                    <Sparkles className="h-5.5 w-5.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-neutral-800">Tampilkan Animasi</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">
                      Adegan motor kurir + spanduk teks di Beranda. Nonaktif → strip jalan
                      disembunyikan dari pelanggan.
                    </p>
                  </div>
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
                    aria-label="Tampilkan animasi beranda"
                  />
                </div>
              </div>

              <div className={cn("mt-4 space-y-4", !draft.enabled && "pointer-events-none opacity-50")}>
                {/* ===== TEKS SPANDUK ===== */}
                <div className="rounded-2xl border border-orange-100 bg-white p-4">
                  <label className="text-[13px] font-bold text-neutral-800" htmlFor="courier-anim-text">
                    Teks Spanduk
                  </label>
                  <input
                    id="courier-anim-text"
                    type="text"
                    value={draft.text}
                    maxLength={48}
                    onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                    placeholder="Ayam Geprek Sambal Ijo"
                    className="mt-2 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm font-bold text-neutral-800 outline-none transition focus:border-orange-400 focus:bg-white"
                  />
                  <p className="mt-1.5 text-[11px] leading-snug text-neutral-400">
                    Maksimal 48 karakter, dipotong per kata (maks 5 kata) — kata terakhir otomatis
                    memakai warna aksen.
                  </p>
                </div>

                {/* ===== FONT & KETEBALAN ===== */}
                <div className="rounded-2xl border border-orange-100 bg-white p-4">
                  <p className="text-[13px] font-bold text-neutral-800">Font Teks</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {COURIER_ANIM_FONTS.map((f) => (
                      <ChoiceChip key={f} active={draft.font === f} onClick={() => setDraft((d) => ({ ...d, font: f }))}>
                        {FONT_LABELS[f]}
                      </ChoiceChip>
                    ))}
                  </div>
                  <p className="mt-3 text-[13px] font-bold text-neutral-800">Ketebalan</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {COURIER_ANIM_WEIGHTS.map((w) => (
                      <ChoiceChip key={w} active={draft.weight === w} onClick={() => setDraft((d) => ({ ...d, weight: w }))}>
                        {WEIGHT_LABELS[w]}
                      </ChoiceChip>
                    ))}
                  </div>
                </div>

                {/* ===== GAYA HURUF ===== */}
                <div className="space-y-2">
                  <ToggleRow
                    title="Huruf KAPITAL"
                    desc="Semua teks spanduk ditulis huruf besar (seperti spanduk toko)"
                    checked={draft.caps}
                    onChange={(v) => setDraft((d) => ({ ...d, caps: v }))}
                  />
                  <ToggleRow
                    title="Huruf Miring"
                    desc="Gaya italic — terasa lebih dinamis mengikuti laju motor"
                    checked={draft.italic}
                    onChange={(v) => setDraft((d) => ({ ...d, italic: v }))}
                  />
                </div>

                {/* ===== UKURAN & KECEPATAN ===== */}
                <div className="rounded-2xl border border-orange-100 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-bold text-neutral-800">Ukuran Huruf</p>
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-black text-orange-700">
                      {draft.fontSize} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={8}
                    max={12}
                    step={1}
                    value={draft.fontSize}
                    onChange={(e) => setDraft((d) => ({ ...d, fontSize: Number(e.target.value) }))}
                    className="mt-2 w-full accent-orange-600"
                    aria-label="Ukuran huruf spanduk"
                  />
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-[13px] font-bold text-neutral-800">Kecepatan Adegan</p>
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-black text-orange-700">
                      {draft.cycleSec} dtk/putaran
                    </span>
                  </div>
                  <input
                    type="range"
                    min={6}
                    max={12}
                    step={1}
                    value={draft.cycleSec}
                    onChange={(e) => setDraft((d) => ({ ...d, cycleSec: Number(e.target.value) }))}
                    className="mt-2 w-full accent-orange-600"
                    aria-label="Kecepatan siklus adegan"
                  />
                  <p className="mt-1.5 text-[11px] leading-snug text-neutral-400">
                    {draft.cycleSec <= 7
                      ? "Cepat — cocok untuk energinya, tapi teks tampil lebih singkat."
                      : draft.cycleSec >= 10
                        ? "Santai — teks lebih lama terbaca."
                        : "Normal — seimbang antara dinamis dan mudah dibaca."}
                  </p>
                </div>

                {/* ===== WARNA ===== */}
                <div className="rounded-2xl border border-orange-100 bg-white p-4">
                  <p className="text-[13px] font-bold text-neutral-800">Warna Teks</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {COURIER_ANIM_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, textColor: c }))}
                        aria-label={`Warna teks ${COLOR_LABELS[c]}`}
                        className={cn(
                          "press-effect flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[11px] font-bold transition",
                          draft.textColor === c ? "bg-orange-600 text-white" : "bg-neutral-100 text-neutral-600"
                        )}
                      >
                        <span
                          className="h-4 w-4 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: COLOR_HEX[c] }}
                        />
                        {COLOR_LABELS[c]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[13px] font-bold text-neutral-800">Warna Aksen (kata terakhir)</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {COURIER_ANIM_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, accentColor: c }))}
                        aria-label={`Warna aksen ${COLOR_LABELS[c]}`}
                        className={cn(
                          "press-effect flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[11px] font-bold transition",
                          draft.accentColor === c ? "bg-green-600 text-white" : "bg-neutral-100 text-neutral-600"
                        )}
                      >
                        <span
                          className="h-4 w-4 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: COLOR_HEX[c] }}
                        />
                        {COLOR_LABELS[c]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ===== BOOM ===== */}
                <ToggleRow
                  title="Ledakan BOOM! 🎉"
                  desc="Chip BOOM + konfeti meledak di tengah putaran, di atas spanduk"
                  checked={draft.boom}
                  onChange={(v) => setDraft((d) => ({ ...d, boom: v }))}
                />
              </div>
            </div>

            {/* ===== TOMBOL SIMPAN ===== */}
            <div className="shrink-0 border-t border-orange-100 bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                onClick={save}
                disabled={saving}
                className="press-effect flex w-full items-center justify-center gap-2 rounded-2xl bg-orange-600 py-3 text-sm font-black text-white shadow-lg shadow-orange-500/30 transition hover:bg-orange-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "Menyimpan…" : "Simpan Animasi"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
