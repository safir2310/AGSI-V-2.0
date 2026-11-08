"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bike, ClipboardList, Coins, QrCode, RefreshCw, ShoppingBag, Ticket, Timer, Utensils } from "lucide-react";
import { PaymentBadge, SourceBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { QrisPaySheet, type QrisPayOrder } from "@/components/shared/QrisPaySheet";
import { useOrdersStore } from "@/lib/hooks";
import { formatDateTime, formatIDR } from "@/lib/types";
import { formatDistance } from "@/lib/delivery";
import { earnPointsForTotal } from "@/lib/points-rules";
import { cn } from "@/lib/utils";

/** Batas bayar QRIS — harus sama dengan QRIS_PAYMENT_TIMEOUT_MINUTES di server (5 menit) */
const QRIS_TIMEOUT_MS = 5 * 60 * 1000;

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Chip hitung mundur batal otomatis untuk pesanan QRIS yang belum dibayar */
function QrisDeadlineChip({ createdAt }: { createdAt: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.floor((new Date(createdAt).getTime() + QRIS_TIMEOUT_MS - Date.now()) / 1000);
  if (left <= 0) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-black text-red-600 ring-1 ring-red-200">
        <Timer className="h-3 w-3" /> Waktu habis — batal otomatis
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black tabular-nums ring-1",
        left < 300
          ? "bg-red-50 text-red-600 ring-red-200"
          : "bg-amber-50 text-amber-700 ring-amber-200"
      )}
    >
      <Timer className="h-3 w-3" /> Batal otomatis dalam {mmss(left)}
    </span>
  );
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  DINE_IN: <Utensils className="h-3.5 w-3.5" />,
  TAKEAWAY: <ShoppingBag className="h-3.5 w-3.5" />,
  DELIVERY: <Bike className="h-3.5 w-3.5" />,
};

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Makan di Tempat",
  TAKEAWAY: "Bungkus",
  DELIVERY: "Diantar",
};

export function OrdersView() {
  const prefersReduced = useReducedMotion();
  const { orders, loading, load } = useOrdersStore();
  const [payOrder, setPayOrder] = useState<QrisPayOrder | null>(null);

  useEffect(() => {
    load("mine", true);
  }, [load]);

  return (
    <div className="px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black text-neutral-900">Pesanan Saya 📋</h1>
          <p className="text-xs text-neutral-400">Pantau geprekmu sampai siap</p>
        </div>
        <button
          onClick={() => load("mine", true)}
          aria-label="Muat ulang pesanan"
          className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-white text-orange-600 shadow-sm hover:bg-orange-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </header>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-10 text-center">
          <ClipboardList className="h-8 w-8 text-orange-300" />
          <p className="text-sm font-semibold text-neutral-500">Belum ada pesanan</p>
          <p className="text-xs text-neutral-400">Pesanan pertamamu menunggu di halaman Menu!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o, i) => (
            <motion.article
              key={o.id}
              initial={prefersReduced ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.4), duration: 0.32 }}
              className="card-lift overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between gap-2 border-b border-orange-50 bg-orange-50/50 px-4 py-2.5">
                <div>
                  <p className="text-xs font-black tracking-wide text-neutral-700">{o.code}</p>
                  <p className="text-[10px] text-neutral-400">{formatDateTime(o.createdAt)}</p>
                </div>
                <StatusBadge status={o.status} />
              </div>

              <div className="space-y-1.5 px-4 py-3">
                {o.items.map((it) => (
                  <div key={it.id} className="flex items-center gap-2.5 text-sm">
                    <span className="text-lg">{it.emoji}</span>
                    <span className="min-w-0 flex-1 truncate text-neutral-700">{it.name}</span>
                    <span className="text-xs font-bold text-neutral-400">×{it.qty}</span>
                    <span className="text-xs font-semibold text-neutral-600">
                      {formatIDR(it.price * it.qty)}
                    </span>
                  </div>
                ))}
                {o.voucherCode && o.voucherDiscount > 0 && (
                  <div className="mt-1 flex items-center justify-between rounded-xl bg-green-50 px-3 py-2 text-[11px] font-bold ring-1 ring-green-100">
                    <span className="flex items-center gap-1 text-green-700">
                      <Ticket className="h-3.5 w-3.5" /> Voucher {o.voucherCode}
                    </span>
                    <span className="text-green-600">−{formatIDR(o.voucherDiscount)}</span>
                  </div>
                )}
                {o.type === "DELIVERY" && o.deliveryFee > 0 && (
                  <div className="mt-1 flex items-center justify-between rounded-xl bg-orange-50 px-3 py-2 text-[11px] font-bold ring-1 ring-orange-100">
                    <span className="flex items-center gap-1 text-orange-700">
                      <Bike className="h-3.5 w-3.5" /> Ongkir
                      {o.distanceKm != null && ` (± ${formatDistance(o.distanceKm)})`}
                    </span>
                    <span className="text-orange-600">{formatIDR(o.deliveryFee)}</span>
                  </div>
                )}
                {o.type === "DELIVERY" && o.address && (
                  <p className="rounded-lg bg-orange-50/70 px-2.5 py-1.5 text-[11px] leading-snug text-orange-700">
                    🏍️ {o.address}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-orange-50 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 rounded-full bg-orange-50 px-2 py-1 text-[10px] font-bold text-orange-700">
                    {TYPE_ICON[o.type]} {TYPE_LABEL[o.type] ?? o.type}
                  </span>
                  {o.tableNo && (
                    <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-bold text-neutral-500">
                      Meja {o.tableNo}
                    </span>
                  )}
                  <SourceBadge source={o.source} />
                </div>
                <span className="text-sm font-black text-orange-600">{formatIDR(o.total)}</span>
              </div>

              {/* Status pembayaran */}
              {o.status !== "CANCELLED" ? (
                <div className="flex items-center justify-between gap-2 border-t border-orange-50 bg-orange-50/30 px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <PaymentBadge paymentMethod={o.paymentMethod} paymentStatus={o.paymentStatus} />
                    {o.paymentMethod === "QRIS" && o.paymentStatus === "UNPAID" && (
                      <span className="text-[10px] font-semibold text-amber-700">
                        Lunas otomatis saat dana masuk
                      </span>
                    )}
                    {o.paymentMethod === "QRIS" && o.paymentStatus === "UNPAID" && (
                      <QrisDeadlineChip createdAt={o.createdAt} />
                    )}
                  </div>
                  {/* Poin member masuk saat pesanan selesai (tiap Rp 15.000 → 100 poin) */}
                  {o.status === "COMPLETED" && earnPointsForTotal(o.total) > 0 && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-200">
                      <Coins className="h-3 w-3" /> +{earnPointsForTotal(o.total).toLocaleString("id-ID")} Point
                    </span>
                  )}
                  {o.paymentMethod === "QRIS" && o.paymentStatus === "UNPAID" && (
                    <button
                      onClick={() => setPayOrder({ id: o.id, code: o.code, total: o.total })}
                      className="press-effect flex items-center gap-1.5 rounded-full bg-orange-600 px-3.5 py-1.5 text-[11px] font-extrabold text-white shadow-md shadow-orange-500/30 hover:bg-orange-700"
                    >
                      <QrCode className="h-3.5 w-3.5" /> Bayar QRIS
                    </button>
                  )}
                </div>
              ) : (
                o.paymentMethod === "QRIS" &&
                o.paymentStatus === "UNPAID" && (
                  <div className="border-t border-orange-50 bg-red-50/40 px-4 py-2">
                    <p className="text-[11px] font-semibold leading-snug text-red-600">
                      ⏰ Dibatalkan otomatis — pembayaran QRIS tidak diterima dalam 5 menit.
                      Voucher yang terpakai sudah dikembalikan.
                    </p>
                  </div>
                )
              )}
            </motion.article>
          ))}
        </div>
      )}

      {/* Layar bayar QRIS (dibuka ulang dari daftar pesanan) */}
      {payOrder && (
        <QrisPaySheet
          order={payOrder}
          variant="customer"
          onClose={() => setPayOrder(null)}
          onPaid={() => void load("mine", true)}
        />
      )}
    </div>
  );
}
