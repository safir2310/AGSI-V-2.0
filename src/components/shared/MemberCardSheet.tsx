"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Coins,
  Copy,
  Gift,
  History,
  Loader2,
  ScanLine,
  Ticket,
  TrendingUp,
  X,
} from "lucide-react";
import { Barcode } from "@/components/shared/Barcode";
import { apiFetch } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { refreshVouchers } from "@/lib/hooks";
import { voucherValueForPoints } from "@/lib/points-rules";
import { useNoticeStore } from "@/lib/store";
import { formatDateTime, formatIDR, type MemberCardData, type PointTierInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export type MemberCardSheetProps = {
  open: boolean;
  onClose: () => void;
  /** kabari shell ketika saldo poin berubah (mis. setelah tukar poin) */
  onPointsChange?: (points: number) => void;
};

type RedeemResult = {
  voucher: { code: string; value: number; points: number; expiresAt: string };
  points: number;
};

/** Pilihan penukaran: paket tier cepat ATAU seluruh saldo poin */
type RedeemSelection =
  | { kind: "tier"; tier: PointTierInfo }
  | { kind: "all"; points: number };

const fmtPts = (n: number) => n.toLocaleString("id-ID");

/**
 * Kartu Member lengkap — dibuka dari teks "Member" di kanan atas aplikasi.
 * Berisi: kartu identitas member (nama + saldo poin), barcode kode member
 * untuk discan kasir, tukar poin → voucher otomatis, voucher milik akun,
 * dan riwayat mutasi poin.
 */
export function MemberCardSheet({ open, onClose, onPointsChange }: MemberCardSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);

  const [data, setData] = useState<MemberCardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selection, setSelection] = useState<RedeemSelection | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [result, setResult] = useState<RedeemResult | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchCard = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch("/api/member/card", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setLoadError(body.error ?? "Gagal memuat kartu member.");
        return;
      }
      setData(body as MemberCardData);
      onPointsChange?.((body as MemberCardData).points);
    } catch {
      setLoadError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, [onPointsChange]);

  /** Selalu menunjuk fetchCard terbaru tanpa memicu ulang efek "open" */
  const fetchCardRef = useRef(fetchCard);
  useEffect(() => {
    fetchCardRef.current = fetchCard;
  });

  // Muat data HANYA saat kartu berubah dari tutup → terbuka (memakai ref agar
  // identitas fetchCard yang berubah tidak me-reset panel hasil tukar)
  useEffect(() => {
    if (open) {
      setResult(null);
      setSelection(null);
      setCopied(false);
      void fetchCardRef.current();
    }
  }, [open]);

  // Tutup dengan tombol Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** Tukar poin → voucher otomatis (tier cepat / seluruh saldo) */
  const redeem = async (sel: RedeemSelection) => {
    const pts = sel.kind === "all" ? sel.points : sel.tier.points;
    if (redeeming || !data || data.points < pts) return;
    setRedeeming(true);
    try {
      const res = await apiFetch("/api/member/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sel.kind === "all" ? { points: sel.points } : { tierId: sel.tier.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Tukar Poin Gagal", message: body.error ?? "Coba lagi sebentar ya." });
        return;
      }
      setResult(body as RedeemResult);
      onPointsChange?.(body.points);
      // Segarkan data kartu (saldo, voucher, riwayat) + daftar voucher
      // global agar voucher baru langsung muncul di beranda/keranjang
      await Promise.all([fetchCard(), refreshVouchers()]);
    } catch {
      showNotice({ type: "error", title: "Tukar Poin Gagal", message: "Tidak dapat menghubungi server." });
    } finally {
      setRedeeming(false);
    }
  };

  const copyCode = async (code: string) => {
    const ok = await copyText(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const points = data?.points ?? 0;
  const selectedPoints = !selection ? 0 : selection.kind === "all" ? selection.points : selection.tier.points;
  const selectedValue = voucherValueForPoints(selectedPoints);
  const allActive = selection?.kind === "all";
  const memberSince = data ? new Date(data.memberSince).toLocaleDateString("id-ID", { month: "long", year: "numeric" }) : "";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="member-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Kartu Member"
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
                  <BadgeCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Kartu Member</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Ayam Geprek Sambal Ijo
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
              {loading && !data ? (
                <div className="flex min-h-[320px] items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                </div>
              ) : loadError && !data ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
                  <p className="text-xs font-semibold text-red-500">{loadError}</p>
                  <button
                    onClick={() => void fetchCard()}
                    className="press-effect rounded-full bg-orange-600 px-4 py-2 text-[11px] font-extrabold text-white hover:bg-orange-700"
                  >
                    Coba Lagi
                  </button>
                </div>
              ) : data ? (
                <>
                  {/* ============ KARTU MEMBER ============ */}
                  <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 via-orange-500 to-amber-400 p-5 text-white shadow-xl shadow-orange-500/30">
                    <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
                    <div className="relative z-10">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-orange-100">
                            Member AGSI
                          </p>
                          <p className="mt-1 truncate text-lg font-black">{data.name}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-orange-50/90">
                            <CalendarDays className="h-3 w-3" /> Member sejak {memberSince}
                          </p>
                        </div>
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                          <Coins className="h-5 w-5" />
                        </span>
                      </div>
                      <div className="mt-4 flex items-end justify-between gap-3 rounded-2xl bg-white/15 px-4 py-3 backdrop-blur-sm">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-orange-50">
                            Saldo Poin
                          </p>
                          <p className="text-3xl font-black tabular-nums leading-none">
                            {points.toLocaleString("id-ID")}
                          </p>
                        </div>
                        <p className="text-right text-[10px] font-semibold leading-snug text-orange-50/90">
                          Belanja {formatIDR(data.earnStep)} dapat {fmtPts(data.earnStepPoints)} poin
                          <br />
                          masuk saat pesanan <strong>selesai</strong>
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* ============ BARCODE MEMBER ============ */}
                  <section className="mt-4 rounded-2xl border-2 border-orange-200 bg-white p-4 shadow-inner">
                    <div className="flex items-center justify-center overflow-x-auto">
                      <Barcode
                        value={data.memberCode}
                        height={68}
                        moduleWidth={3}
                        className="max-w-full"
                      />
                    </div>
                    <p className="mt-2.5 flex items-center justify-center gap-1.5 text-center text-[11px] font-semibold text-neutral-500">
                      <ScanLine className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                      Tunjukkan barcode ini ke kasir saat memesan
                    </p>
                  </section>

                  {/* ============ TUKAR POIN → VOUCHER ============ */}
                  <section className="mt-5">
                    <h2 className="flex items-center gap-1.5 text-sm font-black text-neutral-900">
                      <Gift className="h-4 w-4 text-orange-600" /> Tukar Poin Jadi Voucher
                    </h2>
                    <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
                      {fmtPts(data.redeemUnitPoints)} poin = voucher {formatIDR(data.redeemUnitValue)} — nominal voucher
                      mengikuti jumlah poinmu.
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {data.tiers.map((t) => {
                        const enough = points >= t.points;
                        const active = selection?.kind === "tier" && selection.tier.id === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => setSelection(active ? null : { kind: "tier", tier: t })}
                            aria-pressed={active}
                            className={cn(
                              "press-effect relative rounded-2xl border-2 p-3 text-left transition",
                              active
                                ? "border-orange-500 bg-orange-50 shadow-md shadow-orange-500/10"
                                : enough
                                  ? "border-orange-100 bg-white hover:border-orange-300"
                                  : "border-neutral-100 bg-neutral-50 opacity-70"
                            )}
                          >
                            <p className="text-[10px] font-black uppercase tracking-wide text-neutral-400">
                              {fmtPts(t.points)} poin
                            </p>
                            <p className="mt-0.5 text-base font-black text-orange-600">
                              {formatIDR(t.value)}
                            </p>
                            {!enough && (
                              <p className="mt-1 text-[10px] font-bold text-neutral-400">
                                kurang {fmtPts(t.points - points)} poin
                              </p>
                            )}
                            {active && (
                              <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-white">
                                <Check className="h-3 w-3" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Tukar seluruh saldo — nominal voucher mengikuti poin */}
                    {points >= data.minRedeem && (
                      <button
                        onClick={() => setSelection(allActive ? null : { kind: "all", points })}
                        aria-pressed={allActive}
                        className={cn(
                          "press-effect relative mt-2 flex w-full items-center justify-between gap-3 rounded-2xl border-2 px-3.5 py-3 text-left transition",
                          allActive
                            ? "border-orange-500 bg-orange-50 shadow-md shadow-orange-500/10"
                            : "border-orange-100 bg-white hover:border-orange-300"
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-wide text-neutral-400">
                            Tukar Semua Poin
                          </p>
                          <p className="mt-0.5 text-base font-black text-orange-600">
                            {formatIDR(voucherValueForPoints(points))}
                          </p>
                        </div>
                        <p className="shrink-0 text-right text-[10px] font-bold text-neutral-400">
                          {fmtPts(points)} poin
                        </p>
                        {allActive && (
                          <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    )}
                    {points < data.minRedeem && (
                      <p className="mt-2 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-3 text-center text-[11px] font-semibold text-neutral-400">
                        Kumpulkan minimal {fmtPts(data.minRedeem)} poin (voucher{" "}
                        {formatIDR(voucherValueForPoints(data.minRedeem))}) untuk menukar jadi voucher.
                      </p>
                    )}

                    {selection && (
                      <motion.button
                        initial={prefersReduced ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => void redeem(selection)}
                        disabled={redeeming || points < selectedPoints}
                        className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700 disabled:opacity-60"
                      >
                        {redeeming ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" /> Menukar poin…
                          </>
                        ) : (
                          <>
                            <Gift className="h-4 w-4" /> Tukar {fmtPts(selectedPoints)} Poin →{" "}
                            {formatIDR(selectedValue)}
                          </>
                        )}
                      </motion.button>
                    )}
                  </section>

                  {/* ============ HASIL TUKAR (VOUCHER BARU) ============ */}
                  <AnimatePresence>
                    {result && (
                      <motion.section
                        initial={prefersReduced ? false : { opacity: 0, y: 10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        className="mt-4 overflow-hidden rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                            <BadgeCheck className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-black text-emerald-700">Poin Ditukar Jadi Voucher! 🎉</p>
                            <p className="text-[11px] font-semibold text-emerald-700/80">
                              Voucher {formatIDR(result.voucher.value)} siap dipakai • sisa saldo{" "}
                              {result.points.toLocaleString("id-ID")} poin
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white p-3 ring-1 ring-emerald-200">
                          <Ticket className="h-5 w-5 shrink-0 text-emerald-600" />
                          <code className="min-w-0 flex-1 truncate font-mono text-base font-black tracking-wider text-neutral-900">
                            {result.voucher.code}
                          </code>
                          <button
                            onClick={() => void copyCode(result.voucher.code)}
                            className="press-effect flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[11px] font-extrabold text-white hover:bg-emerald-700"
                          >
                            {copied ? (
                              <>
                                <Check className="h-3.5 w-3.5" /> Tersalin
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" /> Salin
                              </>
                            )}
                          </button>
                        </div>
                        <p className="mt-2 text-center text-[10px] font-semibold text-emerald-700/70">
                          Otomatis muncul di daftar voucher keranjangmu • berlaku hingga{" "}
                          {formatDateTime(result.voucher.expiresAt)}
                        </p>
                      </motion.section>
                    )}
                  </AnimatePresence>

                  {/* ============ VOUCHER SAYA ============ */}
                  <section className="mt-5">
                    <h2 className="flex items-center gap-1.5 text-sm font-black text-neutral-900">
                      <Ticket className="h-4 w-4 text-orange-600" /> Voucher Hasil Tukar
                    </h2>
                    {data.vouchers.length === 0 ? (
                      <p className="mt-2 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-4 text-center text-[11px] font-semibold text-neutral-400">
                        Belum ada voucher — tukar poinmu di atas untuk membuat voucher otomatis.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {data.vouchers.map((v) => {
                          const usedOrExpired = v.used || v.expired;
                          return (
                            <div
                              key={v.id}
                              className={cn(
                                "flex items-center gap-3 rounded-2xl border px-3.5 py-3",
                                usedOrExpired
                                  ? "border-neutral-100 bg-neutral-50 opacity-70"
                                  : "border-orange-100 bg-orange-50/60"
                              )}
                            >
                              <span
                                className={cn(
                                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                                  usedOrExpired ? "bg-neutral-200 text-neutral-400" : "bg-orange-600 text-white"
                                )}
                              >
                                <Ticket className="h-5 w-5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-black text-neutral-800">
                                  {formatIDR(v.value)}
                                  <span className="ml-1.5 text-[10px] font-bold text-neutral-400">
                                    {v.points.toLocaleString("id-ID")} poin
                                  </span>
                                </p>
                                <p className="truncate font-mono text-[11px] font-bold tracking-wider text-neutral-500">
                                  {v.code}
                                </p>
                                <p className="text-[10px] font-semibold text-neutral-400">
                                  {v.used
                                    ? "Sudah dipakai"
                                    : v.expired
                                      ? "Kedaluwarsa"
                                      : v.expiresAt
                                        ? `Berlaku s.d. ${formatDateTime(v.expiresAt)}`
                                        : "Aktif"}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* ============ RIWAYAT POIN ============ */}
                  <section className="mt-5 pb-2">
                    <h2 className="flex items-center gap-1.5 text-sm font-black text-neutral-900">
                      <History className="h-4 w-4 text-orange-600" /> Riwayat Poin
                    </h2>
                    {data.transactions.length === 0 ? (
                      <p className="mt-2 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-4 text-center text-[11px] font-semibold text-neutral-400">
                        Belum ada mutasi poin — selesaikan pesanan pertamamu untuk mengumpulkan poin!
                      </p>
                    ) : (
                      <div className="scrollbar-slim mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                        {data.transactions.map((t) => {
                          const earn = t.type === "EARN";
                          return (
                            <div
                              key={t.id}
                              className="flex items-center gap-3 rounded-xl border border-neutral-100 bg-white px-3 py-2"
                            >
                              <span
                                className={cn(
                                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                                  earn ? "bg-emerald-50 text-emerald-600" : "bg-orange-50 text-orange-600"
                                )}
                              >
                                {earn ? <TrendingUp className="h-4 w-4" /> : <Gift className="h-4 w-4" />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-bold text-neutral-700">{t.description}</p>
                                <p className="text-[10px] text-neutral-400">{formatDateTime(t.createdAt)}</p>
                              </div>
                              <span
                                className={cn(
                                  "shrink-0 text-sm font-black tabular-nums",
                                  earn ? "text-emerald-600" : "text-orange-600"
                                )}
                              >
                                {earn ? "+" : ""}
                                {t.points.toLocaleString("id-ID")}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
