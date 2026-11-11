"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bike,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  CookingPot,
  Home,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  RefreshCw,
  Wallet,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime, formatIDR, type OrderData } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * SHEET "LACAK KURIR AGSI" — halaman Profil, khusus pesanan ANTAR.
 *
 * Menampilkan semua pesanan type DELIVERY yang sedang berjalan
 * (Menunggu / Dimasak / Siap / Diantar) lengkap dengan:
 *  - garis waktu: Dibayar → Dimasak → Siap → Diantar → Sampai
 *  - data kurir (nama, tombol telepon & WhatsApp) setelah kasir menekan
 *    "Serahkan ke Kurir"
 *  - tombol rute Google Maps ke alamat tujuan
 *
 * Data diambil dari /api/orders (scope milik sendiri) saat sheet dibuka
 * dan disegar otomatis tiap 15 detik — jadi status kurir ikut segar
 * selama pelanggan menatap layar.
 */

/** Nomor HP → format internasional utk tautan WhatsApp (62…) */
function waNumber(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("62")) return d;
  if (d.startsWith("0")) return `62${d.slice(1)}`;
  return `62${d}`;
}

type TrackStep = {
  key: string;
  label: string;
  hint?: string;
  done: boolean;
  time?: string | null;
  icon: React.ReactNode;
  highlight?: boolean;
};

function buildSteps(o: OrderData): TrackStep[] {
  const paid = !!o.paidAt || o.paymentStatus === "PAID";
  const cooking = o.status !== "PENDING";
  const ready = o.status === "READY" || o.status === "COMPLETED";
  const otw = !!o.onTheWayAt;
  const done = o.status === "COMPLETED";
  return [
    {
      key: "paid",
      label: "Pesanan Dibayar",
      hint: paid ? undefined : "Menunggu pembayaran",
      done: paid,
      time: o.paidAt,
      icon: <Wallet className="h-3.5 w-3.5" />,
    },
    {
      key: "cooking",
      label: "Dapur Memasak",
      done: cooking,
      time: null,
      icon: <CookingPot className="h-3.5 w-3.5" />,
    },
    {
      key: "ready",
      label: "Siap — Menunggu Kurir",
      done: ready,
      time: null,
      icon: <Check className="h-3.5 w-3.5" />,
    },
    {
      key: "otw",
      label: otw ? `Diantar oleh ${o.courierName ?? "Kurir AGSI"}` : "Kurir Berangkat",
      hint: otw ? undefined : "Kasir akan menugaskan kurir",
      done: otw || done,
      time: o.onTheWayAt,
      icon: <Bike className="h-3.5 w-3.5" />,
      highlight: otw && !done,
    },
    {
      key: "done",
      label: "Sampai Tujuan",
      done: done,
      time: null,
      icon: <Home className="h-3.5 w-3.5" />,
    },
  ];
}

function CourierCard({ o }: { o: OrderData }) {
  const steps = buildSteps(o);
  const otw = !!o.onTheWayAt && o.status !== "COMPLETED";
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    o.address || o.deliveryArea || "AGSI Pidie"
  )}`;

  return (
    <article className="overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm">
      {/* Kepala: kode + status */}
      <div className="flex items-center justify-between gap-2 border-b border-orange-50 bg-orange-50/50 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-black tracking-wide text-neutral-700">{o.code}</p>
          <p className="truncate text-[10px] text-neutral-400">
            {formatDateTime(o.createdAt)} • {o.customerName}
          </p>
        </div>
        <StatusBadge status={o.status} />
      </div>

      {/* Alamat & ongkir */}
      <div className="space-y-1.5 px-4 pt-3">
        {o.address && (
          <p className="flex items-start gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1.5 text-[11px] leading-snug text-orange-700">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{o.address}</span>
          </p>
        )}
        {o.deliveryFee > 0 && (
          <p className="rounded-lg bg-orange-50/70 px-2.5 py-1.5 text-[11px] font-bold text-orange-700">
            🛵 Ongkir {formatIDR(o.deliveryFee)}
            {o.distanceKm != null
              ? ` — ± ${o.distanceKm.toLocaleString("id-ID", { maximumFractionDigits: 1 })} km`
              : ""}
          </p>
        )}
      </div>

      {/* Garis waktu pelacakan */}
      <ol className="space-y-0 px-4 py-3">
        {steps.map((s, i) => (
          <li key={s.key} className="relative flex gap-3 pb-3 last:pb-0">
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 rounded",
                  s.done ? "bg-green-400" : "bg-neutral-200"
                )}
                aria-hidden
              />
            )}
            <span
              className={cn(
                "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 ring-white",
                s.done
                  ? s.highlight
                    ? "bg-orange-600 text-white"
                    : "bg-green-500 text-white"
                  : "bg-neutral-200 text-neutral-400"
              )}
            >
              {s.done && !s.highlight ? <CheckCircle2 className="h-4 w-4" /> : s.icon}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                className={cn(
                  "text-[12px] font-black leading-tight",
                  s.highlight ? "text-orange-700" : s.done ? "text-neutral-700" : "text-neutral-400"
                )}
              >
                {s.label}
                {s.highlight && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-px text-[9px] font-black uppercase text-orange-700">
                    <Clock className="h-2.5 w-2.5" /> sekarang
                  </span>
                )}
              </p>
              {s.hint && <p className="text-[10px] leading-snug text-neutral-400">{s.hint}</p>}
              {s.time && (
                <p className="text-[10px] font-semibold text-neutral-400">{formatDateTime(s.time)}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* Kurir + aksi kontak & rute */}
      {otw && (
        <div className="space-y-2 border-t border-orange-50 bg-green-50/60 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-green-600 text-white">
              <Bike className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-black text-neutral-800">
                {o.courierName ?? "Kurir AGSI"}
              </p>
              <p className="truncate text-[10px] text-neutral-500">
                {o.courierPhone ? `Kurir AGSI • ${o.courierPhone}` : "Kurir AGSI sedang menuju alamatmu"}
              </p>
            </div>
            {o.courierPhone && (
              <div className="flex shrink-0 gap-1.5">
                <a
                  href={`tel:${o.courierPhone.replace(/[^+\d]/g, "")}`}
                  aria-label={`Telepon kurir ${o.courierName ?? ""}`}
                  title="Telepon kurir"
                  className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-white shadow-md"
                >
                  <Phone className="h-4 w-4" />
                </a>
                <a
                  href={`https://wa.me/${waNumber(o.courierPhone)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`WhatsApp kurir ${o.courierName ?? ""}`}
                  title="WhatsApp kurir"
                  className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white shadow-md"
                >
                  <MessageCircle className="h-4 w-4" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rute ke alamat */}
      {o.status !== "COMPLETED" && (
        <div className="border-t border-orange-50 px-4 py-2.5">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="press-effect flex w-full items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 py-2.5 text-[12px] font-black text-orange-700 transition hover:bg-orange-100"
          >
            <Navigation className="h-4 w-4" />
            Lihat Rute Pengantaran di Google Maps
            <ChevronRight className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </article>
  );
}

export function CourierTrackingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefersReduced = useReducedMotion();
  const [orders, setOrders] = useState<OrderData[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/orders", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { orders?: OrderData[] };
      // Hanya pesanan ANTAR yang sedang berjalan — riwayat selesai/batal
      // tetap bisa dilihat di menu Riwayat Pesanan.
      const list = (data.orders ?? []).filter(
        (o) => o.type === "DELIVERY" && ["PENDING", "PREPARING", "READY"].includes(o.status)
      );
      setOrders(list);
      setError(null);
    } catch {
      setError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const iv = setInterval(() => void load(), 15000);
    return () => clearInterval(iv);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="courier-sheet-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Lacak Kurir AGSI"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { y: 48, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={prefersReduced ? undefined : { y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            {/* ===== KEPALA ===== */}
            <header className="relative shrink-0 bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                  <Bike className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Lacak Kurir AGSI</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Pantau pesanan antarmu — kurir, kontak &amp; rute
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
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4">
              {orders === null && !error ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-neutral-400">
                  <RefreshCw className="h-4 w-4 animate-spin" /> Memuat pelacakan…
                </div>
              ) : error ? (
                <div className="rounded-2xl border border-red-100 bg-red-50 p-5 text-center">
                  <p className="text-[12px] font-semibold text-red-600">{error}</p>
                  <button
                    onClick={() => void load()}
                    className="press-effect mt-3 rounded-xl bg-red-600 px-4 py-2 text-[12px] font-black text-white"
                  >
                    Coba Lagi
                  </button>
                </div>
              ) : (orders ?? []).length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-8 text-center">
                  <Bike className="h-8 w-8 text-orange-300" />
                  <p className="text-sm font-black text-neutral-600">Tidak ada pesanan antar berjalan</p>
                  <p className="max-w-[260px] text-[11px] leading-relaxed text-neutral-400">
                    Pesanan ANTAR yang sedang diproses akan tampil di sini — lengkap dengan kurir,
                    kontak &amp; rute. Riwayat pesanan tetap ada di menu Riwayat Pesanan.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(orders ?? []).map((o) => (
                    <CourierCard key={o.id} o={o} />
                  ))}
                  <p className="pb-1 text-center text-[10px] text-neutral-300">
                    Status diperbarui otomatis tiap 15 detik
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
