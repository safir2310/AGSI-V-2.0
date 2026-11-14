"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bike,
  CheckCheck,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Phone,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDateTime, formatIDR, type OrderData } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/lib/types";
import type { AppView } from "@/lib/store";

type CourierHomeViewProps = {
  user: AppUser;
  onLogout: () => void;
  go: (v: AppView) => void;
};

/** Nomor HP → format internasional utk tautan WhatsApp (62…) */
function waNumber(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("62")) return d;
  if (d.startsWith("0")) return `62${d.slice(1)}`;
  return `62${d}`;
}

/**
 * BERANDA KURIR AGSI (khusus role COURIER).
 *
 * Kurir melihat pesanan ANTAR yang ditugaskan kepadanya (staff menekan
 * "Serahkan ke Kurir" di Kelola Pesanan) lengkap dengan:
 *  - alamat akurat: detail rumah + gampong + pin GPS rumah pelanggan
 *  - tombol rute Google Maps (prioritas pin GPS presisi)
 *  - tombol telepon & WhatsApp pelanggan
 *  - tombol "Sampai Tujuan" (menandai pesanan COMPLETED)
 *
 * Daftar di-refresh otomatis tiap 15 detik — tugas baru langsung muncul.
 */
export function CourierHomeView({ user, onLogout }: CourierHomeViewProps) {
  const prefersReduced = useReducedMotion();
  const [orders, setOrders] = useState<OrderData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/courier/deliveries", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { orders?: OrderData[] };
      setOrders(data.orders ?? []);
      setError(null);
    } catch {
      setError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const iv = setInterval(() => void load(), 15000);
    return () => clearInterval(iv);
  }, [load]);

  /** Tandai pesanan sampai tujuan (COMPLETED) */
  const completeDelivery = async (o: OrderData) => {
    setUpdating(o.id);
    try {
      const res = await apiFetch(`/api/orders/${o.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal.");
      await load();
    } catch (err) {
      // ditampilkan lewat badge status yang tidak berubah — sederhana & jelas
      console.error("[kurir] gagal menandai sampai tujuan:", err);
    } finally {
      setUpdating(null);
    }
  };

  const aktif = (orders ?? []).filter((o) => o.status === "READY");
  const selesai = (orders ?? []).filter((o) => o.status === "COMPLETED");

  return (
    <div className="min-h-dvh bg-gradient-to-b from-emerald-50/60 via-white to-orange-50/50 px-4 pb-10 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
      {/* ===== KEPALA KURIR ===== */}
      <header className="mb-4 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-500/30">
          <Bike className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-black text-neutral-900">Beranda Kurir 🛵</h1>
          <p className="truncate text-xs text-neutral-400">
            Halo {user.name} — {aktif.length} tugas antaran aktif
          </p>
        </div>
        <button
          onClick={onLogout}
          aria-label="Keluar akun"
          className="press-effect flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-red-500 shadow-sm ring-1 ring-red-100 hover:bg-red-50"
        >
          <LogOut className="h-4.5 w-4.5" />
        </button>
      </header>

      {/* ===== RINGKASAN ===== */}
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-4 grid grid-cols-2 gap-2"
      >
        <div className="rounded-2xl border border-emerald-100 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600">
            <Package className="h-3 w-3" /> Tugas Aktif
          </div>
          <p className="mt-0.5 text-2xl font-black text-neutral-900">{aktif.length}</p>
        </div>
        <div className="rounded-2xl border border-orange-100 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-600">
            <CheckCheck className="h-3 w-3" /> Selesai Hari Ini
          </div>
          <p className="mt-0.5 text-2xl font-black text-neutral-900">
            {
              selesai.filter((o) => {
                const d = new Date(o.updatedAt);
                const now = new Date();
                return d.toDateString() === now.toDateString();
              }).length
            }
          </p>
        </div>
      </motion.div>

      {/* ===== ISI ===== */}
      {loading && orders === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm font-bold text-neutral-400">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-500" /> Memuat tugas antaran…
        </div>
      ) : error && orders === null ? (
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
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 p-8 text-center">
          <Bike className="h-10 w-10 text-emerald-300" />
          <p className="text-sm font-black text-neutral-600">Belum ada tugas antaran</p>
          <p className="max-w-[280px] text-[11px] leading-relaxed text-neutral-400">
            Staff menugaskan pesanan antar kepadamu lewat Kelola Pesanan ▸ "Serahkan ke Kurir".
            Tugas baru muncul otomatis di sini (halaman menyegarkan tiap 15 detik) + notifikasi push.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...aktif, ...selesai].map((o) => {
            const hasGps = o.deliveryLat != null && o.deliveryLng != null;
            const mapsUrl = hasGps
              ? `https://www.google.com/maps/dir/?api=1&destination=${o.deliveryLat},${o.deliveryLng}`
              : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                  o.address || o.deliveryArea || "AGSI Pidie"
                )}`;
            const phone = o.phone ?? o.userPhone ?? null;
            const done = o.status === "COMPLETED";
            return (
              <motion.article
                key={o.id}
                initial={prefersReduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "overflow-hidden rounded-2xl border bg-white shadow-sm",
                  done ? "border-neutral-200 opacity-75" : "border-emerald-200"
                )}
              >
                {/* Kepala: kode + status + waktu berangkat */}
                <div className="flex items-center justify-between gap-2 border-b border-emerald-50 bg-emerald-50/50 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black tracking-wide text-neutral-700">{o.code}</p>
                    <p className="truncate text-[10px] text-neutral-400">
                      {o.onTheWayAt ? `Berangkat ${formatDateTime(o.onTheWayAt)}` : formatDateTime(o.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>

                {/* Pelanggan + alamat akurat */}
                <div className="space-y-2 px-4 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-[12px] font-black text-orange-700">
                      {o.customerName.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-black text-neutral-800">{o.customerName}</p>
                      {phone && <p className="truncate text-[10px] text-neutral-400">{phone}</p>}
                    </div>
                    {phone && (
                      <div className="flex shrink-0 gap-1.5">
                        <a
                          href={`tel:${phone.replace(/[^+\d]/g, "")}`}
                          aria-label={`Telepon ${o.customerName}`}
                          title="Telepon pelanggan"
                          className="press-effect flex h-8 w-8 items-center justify-center rounded-full bg-orange-600 text-white shadow-md"
                        >
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                        <a
                          href={`https://wa.me/${waNumber(phone)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`WhatsApp ${o.customerName}`}
                          title="WhatsApp pelanggan"
                          className="press-effect flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366] text-white shadow-md"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Alamat akurat rumah pelanggan */}
                  <div className="rounded-xl bg-orange-50 px-3 py-2.5">
                    <p className="flex items-start gap-1.5 text-[11px] font-bold leading-snug text-orange-800">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1">{o.address || `Gampong ${o.deliveryArea ?? "-"}`}</span>
                    </p>
                    {hasGps ? (
                      <p className="mt-1 flex items-center gap-1 pl-5 text-[10px] font-bold text-emerald-700">
                        📍 Pin GPS rumah pelanggan tersedia — rute presisi
                      </p>
                    ) : (
                      <p className="mt-1 pl-5 text-[10px] text-neutral-400">
                        Tanpa pin GPS — ikuti detail alamat di atas / hubungi pelanggan.
                      </p>
                    )}
                  </div>

                  {/* Ringkasan pesanan + ongkir */}
                  <div className="space-y-1 rounded-xl bg-neutral-50 px-3 py-2">
                    {o.items.slice(0, 4).map((it) => (
                      <p key={it.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="min-w-0 flex-1 truncate text-neutral-600">
                          {it.emoji} {it.name} ×{it.qty}
                        </span>
                        <span className="shrink-0 font-semibold text-neutral-700">{formatIDR(it.price * it.qty)}</span>
                      </p>
                    ))}
                    {o.items.length > 4 && (
                      <p className="text-[10px] font-semibold text-neutral-400">+{o.items.length - 4} item lainnya</p>
                    )}
                    <p className="flex items-center justify-between border-t border-neutral-200 pt-1 text-[11px] font-black">
                      <span className="flex items-center gap-1 text-neutral-600">
                        <Wallet className="h-3 w-3" /> Total (termasuk ongkir)
                      </span>
                      <span className="text-orange-700">{formatIDR(o.total)}</span>
                    </p>
                    {o.paymentStatus === "UNPAID" && (
                      <p className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                        ⚠️ Belum lunas — konfirmasi pembayaran ke kasir (COD / bayar di tempat).
                      </p>
                    )}
                  </div>
                </div>

                {/* Aksi: rute + sampai tujuan */}
                {!done && (
                  <div className="flex gap-2 border-t border-emerald-50 px-4 py-3">
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="press-effect flex h-10 flex-[1.4] items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 text-[12px] font-black text-emerald-700 hover:bg-emerald-100"
                    >
                      <Navigation className="h-4 w-4" /> Buka Rute GPS
                    </a>
                    <button
                      onClick={() => void completeDelivery(o)}
                      disabled={updating === o.id}
                      className="press-effect flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-[12px] font-black text-white shadow-md shadow-emerald-500/30 hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {updating === o.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCheck className="h-4 w-4" />
                      )}
                      Sampai Tujuan
                    </button>
                  </div>
                )}
              </motion.article>
            );
          })}
          <p className="pb-1 text-center text-[10px] text-neutral-300">
            Data diperbarui otomatis tiap 15 detik •{" "}
            <button onClick={() => void load()} className="font-bold text-emerald-500 underline">
              segarkan
            </button>
          </p>
        </div>
      )}

      {/* Segarkan manual saat error tapi ada data lama */}
      {error && orders !== null && (
        <button
          onClick={() => void load()}
          className="press-effect mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-red-100 bg-red-50 py-2.5 text-[11px] font-bold text-red-600"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {error} — Ketuk untuk coba lagi
        </button>
      )}
    </div>
  );
}
