"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Bike,
  CheckCheck,
  ChefHat,
  ClipboardList,
  MessageCircle,
  Phone,
  Printer,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Ticket,
  Utensils,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaymentBadge, SourceBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { ReceiptSheet } from "@/components/shared/ReceiptSheet";
import { useOrdersStore } from "@/lib/hooks";
import { useNoticeStore, useUiStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { formatDateTime, formatIDR, ORDER_STATUS_FLOW, ORDER_STATUS_LABEL, type OrderData } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { id: "ALL", label: "Semua" },
  { id: "PENDING", label: "Menunggu" },
  { id: "PREPARING", label: "Dimasak" },
  { id: "READY", label: "Siap" },
  { id: "COMPLETED", label: "Selesai" },
] as const;

export function AdminOrdersView() {
  const prefersReduced = useReducedMotion();
  const { orders, loading, load } = useOrdersStore();
  const showNotice = useNoticeStore((s) => s.show);
  const [filter, setFilter] = useState<string>("ALL");
  const [updating, setUpdating] = useState<string | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<OrderData | null>(null);
  /** Buka chat CS dengan pelanggan pemilik pesanan ini (utas langsung terbuka) */
  const openChat = useUiStore((s) => s.openChat);

  useEffect(() => {
    load("all", true);
  }, [load]);

  // Auto refresh ringan tiap 20 detik
  useEffect(() => {
    const t = setInterval(() => load("all", true), 20000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = filter === "ALL" ? orders : orders.filter((o) => o.status === filter);

  const advance = async (orderId: string, status: string) => {
    setUpdating(orderId);
    try {
      const res = await apiFetch(`/api/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Memperbarui", message: data.error ?? "Coba lagi." });
        return;
      }
      await load("all", true);
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server." });
    } finally {
      setUpdating(null);
    }
  };

  /** Tandai lunas — HANYA untuk pembayaran tunai (uang diterima fisik di kasir) */
  const markPaid = async (orderId: string, code: string) => {
    setUpdating(orderId);
    try {
      const res = await apiFetch(`/api/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: "PAID" }),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Menandai Lunas", message: data.error ?? "Coba lagi." });
        return;
      }
      showNotice({
        type: "success",
        title: "Pembayaran Tunai Lunas ✓",
        message: `Pesanan ${code} ditandai sudah dibayar (tunai diterima kasir).`,
      });
      await load("all", true);
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server." });
    } finally {
      setUpdating(null);
    }
  };

  /** QRIS: minta SISTEM memeriksa penyedia sekarang (bukan menandai lunas —
      pelunasan tetap hanya terjadi bila dana benar-benar masuk) */
  const checkPayment = async (orderId: string, code: string) => {
    setUpdating(orderId);
    try {
      const res = await apiFetch(`/api/orders/${orderId}/qris/status?force=1`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Gagal Memeriksa", message: data.error ?? "Coba lagi." });
        return;
      }
      if (data.paymentStatus === "PAID") {
        showNotice({
          type: "success",
          title: "Pembayaran Diterima ✓",
          message: `Dana pesanan ${code} sudah masuk — pesanan lunas & masuk dapur secara otomatis.`,
        });
      } else {
        showNotice({
          type: "info",
          title: "Belum Ada Dana Masuk",
          message: `Penyedia QRIS belum mengonfirmasi dana untuk ${code}. Sistem terus memantau otomatis — pesanan lunas sendiri begitu dana masuk.`,
        });
      }
      await load("all", true);
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server." });
    } finally {
      setUpdating(null);
    }
  };

  const typeIcon = (type: string) => {
    if (type === "DELIVERY") return <Bike className="h-3.5 w-3.5" />;
    if (type === "TAKEAWAY") return <ShoppingBag className="h-3.5 w-3.5" />;
    return <Utensils className="h-3.5 w-3.5" />;
  };

  return (
    <div className="px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black text-neutral-900">Pesanan Masuk 🧾</h1>
          <p className="text-xs text-neutral-400">
            {orders.filter((o) => ["PENDING", "PREPARING", "READY"].includes(o.status)).length} aktif •{" "}
            {orders.length} total
          </p>
        </div>
        <button
          onClick={() => load("all", true)}
          aria-label="Muat ulang pesanan"
          className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-white text-orange-600 shadow-sm hover:bg-orange-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </header>

      {/* Filter status */}
      <div className="scrollbar-slim -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "relative shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors",
              filter === f.id ? "text-white" : "bg-orange-50 text-orange-700 hover:bg-orange-100"
            )}
          >
            {filter === f.id && (
              <motion.span
                layoutId={prefersReduced ? undefined : "admin-order-filter"}
                className="absolute inset-0 rounded-full bg-orange-600 shadow-md"
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            <span className="relative z-10">{f.label}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-10 text-center">
          <ClipboardList className="h-8 w-8 text-orange-300" />
          <p className="text-sm font-semibold text-neutral-500">Tidak ada pesanan di kategori ini</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((o) => {
              const nexts = ORDER_STATUS_FLOW[o.status] ?? [];
              const needsPayment = o.paymentStatus !== "PAID" && o.status !== "CANCELLED";
              const isQris = o.paymentMethod === "QRIS" || o.paymentMethod === "EWALLET";
              return (
                <motion.article
                  layout={!prefersReduced}
                  key={o.id}
                  initial={prefersReduced ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={prefersReduced ? undefined : { opacity: 0, scale: 0.97 }}
                  className={cn(
                    "card-lift overflow-hidden rounded-2xl border bg-white shadow-sm",
                    needsPayment && isQris
                      ? "border-amber-200 ring-2 ring-amber-200"
                      : "border-orange-100"
                  )}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-orange-50 bg-orange-50/50 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-xs font-black tracking-wide text-neutral-700">{o.code}</p>
                        <SourceBadge source={o.source} />
                      </div>
                      <p className="truncate text-[10px] text-neutral-400">
                        {o.customerName}
                        {o.tableNo ? ` • Meja ${o.tableNo}` : ""} • {formatDateTime(o.createdAt)}
                      </p>
                      {(() => {
                        const hp = o.phone ?? o.userPhone ?? null;
                        if (!hp) return null;
                        return (
                          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] font-semibold text-neutral-500">
                            <Phone className="h-3 w-3 shrink-0 text-orange-500" />
                            <a
                              href={`tel:${hp.replace(/[^+\d]/g, "")}`}
                              className="truncate hover:text-orange-600"
                              aria-label={`Telepon pelanggan ${o.customerName}`}
                            >
                              {hp}
                            </a>
                          </p>
                        );
                      })()}
                    </div>
                    <StatusBadge status={o.status} />
                  </div>

                  <div className="space-y-1.5 px-4 py-3">
                    {o.items.map((it) => (
                      <div key={it.id} className="flex items-center gap-2.5 text-sm">
                        <span className="text-lg">{it.emoji}</span>
                        <span className="min-w-0 flex-1 truncate text-neutral-700">{it.name}</span>
                        <span className="text-xs font-bold text-neutral-400">×{it.qty}</span>
                      </div>
                    ))}
                    {o.note && (
                      <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700">
                        📝 {o.note}
                      </p>
                    )}
                    {o.address && (
                      <p className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-[11px] text-orange-700">
                        🏍️ {o.address}
                      </p>
                    )}
                    {o.type === "DELIVERY" && o.deliveryFee > 0 && (
                      <p className="rounded-lg bg-orange-50/70 px-2.5 py-1.5 text-[11px] font-bold text-orange-700">
                        🛵 Ongkir {formatIDR(o.deliveryFee)}
                        {o.distanceKm != null
                          ? ` — ± ${o.distanceKm.toLocaleString("id-ID", { maximumFractionDigits: 1 })} km (kelipatan jarak)`
                          : ""}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-orange-50 px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-neutral-500">
                      <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1">
                        {typeIcon(o.type)} {o.type === "DINE_IN" ? "Di tempat" : o.type === "TAKEAWAY" ? "Bungkus" : "Diantar"}
                      </span>
                      <span className="rounded-full bg-neutral-100 px-2 py-1">
                        {o.paymentMethod === "CASH" ? "💵 Tunai" : o.paymentMethod === "EWALLET" ? "👛 E-Wallet" : "📱 QRIS"}
                      </span>
                      <PaymentBadge paymentMethod={o.paymentMethod} paymentStatus={o.paymentStatus} />
                      {o.voucherCode && o.voucherDiscount > 0 && (
                        <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-green-700 ring-1 ring-green-200">
                          <Ticket className="h-3 w-3" /> {o.voucherCode} −{formatIDR(o.voucherDiscount)}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {/* Cetak struk — pratinjau lalu dialog cetak/Print PDF */}
                      <button
                        onClick={() => setReceiptOrder(o)}
                        aria-label={`Cetak struk ${o.code}`}
                        title="Cetak struk"
                        className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition hover:border-orange-300 hover:text-orange-600"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      {/* Chat pelanggan pemilik pesanan (disembunyikan utk pesanan POS tanpa akun member) */}
                      {o.userId && (
                        <button
                          onClick={() => openChat(o.userId!)}
                          aria-label={`Chat pelanggan ${o.customerName}`}
                          title="Chat pelanggan"
                          className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-orange-50 text-orange-600 shadow-sm transition hover:bg-orange-100"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </button>
                      )}
                      <span className="text-sm font-black text-orange-600">{formatIDR(o.total)}</span>
                    </div>
                  </div>

                  {/* Tombol aksi status & pembayaran */}
                  {(nexts.length > 0 || needsPayment) && (
                    <div className="flex flex-wrap gap-2 border-t border-orange-50 bg-orange-50/40 px-4 py-2.5">
                      {needsPayment && isQris ? (
                        <>
                          <span className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-50 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">
                            <ShieldCheck className="h-3.5 w-3.5" /> Menunggu Dana — Verifikasi Otomatis
                          </span>
                          <Button
                            size="sm"
                            disabled={updating === o.id}
                            onClick={() => void checkPayment(o.id, o.code)}
                            className="press-effect h-8 rounded-xl border border-orange-300 bg-white text-[11px] font-bold text-orange-700 hover:bg-orange-50"
                          >
                            {updating === o.id ? (
                              "Memeriksa…"
                            ) : (
                              <>
                                <RefreshCw className="h-3.5 w-3.5" /> Cek Pembayaran
                              </>
                            )}
                          </Button>
                        </>
                      ) : needsPayment ? (
                        <Button
                          size="sm"
                          disabled={updating === o.id}
                          onClick={() => void markPaid(o.id, o.code)}
                          className="press-effect h-8 flex-1 rounded-xl border border-emerald-300 bg-white text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
                        >
                          {updating === o.id ? (
                            "Memperbarui…"
                          ) : (
                            <>
                              <BadgeCheck className="h-3.5 w-3.5" /> Tunai Diterima — Tandai Lunas
                            </>
                          )}
                        </Button>
                      ) : null}
                      {nexts.map((next) => (
                        <Button
                          key={next}
                          size="sm"
                          disabled={updating === o.id}
                          onClick={() => advance(o.id, next)}
                          className={cn(
                            "press-effect h-8 flex-1 rounded-xl text-[11px] font-bold",
                            next === "CANCELLED"
                              ? "bg-neutral-200 text-neutral-600 hover:bg-neutral-300"
                              : next === "COMPLETED"
                                ? "bg-green-600 hover:bg-green-700"
                                : "bg-orange-600 hover:bg-orange-700"
                          )}
                        >
                          {updating === o.id ? (
                            "Memperbarui…"
                          ) : next === "PREPARING" ? (
                            <>
                              <ChefHat className="h-3.5 w-3.5" /> Masak
                            </>
                          ) : next === "READY" ? (
                            <>
                              <ArrowRight className="h-3.5 w-3.5" /> Siap
                            </>
                          ) : next === "COMPLETED" ? (
                            <>
                              <CheckCheck className="h-3.5 w-3.5" /> Selesai
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3.5 w-3.5" /> Batalkan
                            </>
                          )}
                        </Button>
                      ))}
                    </div>
                  )}
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}
      <p className="mt-3 pb-1 text-center text-[10px] text-neutral-300">
        Data diperbarui otomatis setiap 20 detik • {ORDER_STATUS_LABEL.PENDING} → {ORDER_STATUS_LABEL.PREPARING} → {ORDER_STATUS_LABEL.READY} → {ORDER_STATUS_LABEL.COMPLETED}
      </p>

      {/* ===== SHEET CETAK STRUK ===== */}
      <ReceiptSheet open={!!receiptOrder} order={receiptOrder} onClose={() => setReceiptOrder(null)} />
    </div>
  );
}
