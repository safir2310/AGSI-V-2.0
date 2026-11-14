"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Banknote,
  Bike,
  CheckCheck,
  Clock,
  HandCoins,
  History,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Phone,
  RefreshCw,
  Wallet,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import { formatDateTime, formatIDR, type OrderData } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/lib/types";
import type { AppView } from "@/lib/store";

type CourierHomeViewProps = {
  user: AppUser;
  onLogout: () => void;
  go: (v: AppView) => void;
};

/** Uang COD di tangan kurir — dari GET /api/courier/setoran */
type SetoranData = {
  pending: {
    amount: number; // uang MENU yang disetor ke admin (total − ongkir)
    ongkir: number; // ongkir = PENDAPATAN KURIR (tidak ikut disetor)
    count: number;
    orders: Array<{
      id: string;
      code: string;
      total: number;
      deliveryFee: number;
      customerName: string;
      updatedAt: string;
    }>;
  };
  riwayat: Array<{
    id: string;
    amount: number;
    ongkir: number;
    orderCount: number;
    note: string | null;
    createdAt: string;
    confirmedAt: string | null;
  }>;
};

/** Pendapatan kurir (ongkir) + riwayat pengantaran — GET /api/courier/income */
type IncomeData = {
  today: { amount: number; count: number };
  yesterday: { amount: number; count: number };
  history: Array<{
    id: string;
    code: string;
    customerName: string;
    deliveryArea: string | null;
    address: string | null;
    deliveryFee: number;
    paymentMethod: string;
    updatedAt: string;
  }>;
};

type Tab = "antaran" | "selesai";

/** Nomor HP → format internasional utk tautan WhatsApp (62…) */
function waNumber(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("62")) return d;
  if (d.startsWith("0")) return `62${d}`;
  return `62${d}`;
}

/**
 * BERANDA KURIR AGSI (khusus role COURIER).
 *
 * Kurir melihat pesanan ANTAR yang ditugaskan kepadanya (staff menekan
 * "Serahkan ke Kurir" di Kelola Pesanan) lengkap dengan:
 *  - TAB: Antaran (masih dijalan) & Selesai — riwayat pengantaran
 *  - alamat akurat: detail rumah + gampong + pin GPS rumah pelanggan
 *  - tombol rute Google Maps (prioritas pin GPS presisi)
 *  - tombol telepon & WhatsApp pelanggan
 *  - tombol "Sampai Tujuan" → pesanan langsung COMPLETED (kurir kini
 *    diizinkan oleh API; pesanan COD tunai otomatis lunas paidVia "COD")
 *  - KANTONG UANG COD: uang tunai bayar di tempat yang dipegang kurir,
 *    tombol "Setor ke Admin" mengosongkannya (kembali ke 0) + riwayat
 *    setoran & status konfirmasi admin
 *
 * Daftar di-refresh otomatis tiap 15 detik — tugas baru langsung muncul.
 */
export function CourierHomeView({ user, onLogout }: CourierHomeViewProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const [orders, setOrders] = useState<OrderData[] | null>(null);
  const [setoran, setSetoran] = useState<SetoranData | null>(null);
  const [income, setIncome] = useState<IncomeData | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("antaran");
  const [setorArmed, setSetorArmed] = useState(false);
  const [setorBusy, setSetorBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dRes, sRes, iRes] = await Promise.all([
        apiFetch("/api/courier/deliveries", { cache: "no-store" }),
        apiFetch("/api/courier/setoran", { cache: "no-store" }),
        apiFetch("/api/courier/income", { cache: "no-store" }),
      ]);
      if (!dRes.ok) throw new Error();
      const data = (await dRes.json()) as { orders?: OrderData[] };
      setOrders(data.orders ?? []);
      if (sRes.ok) setSetoran((await sRes.json()) as SetoranData);
      if (iRes.ok) setIncome((await iRes.json()) as IncomeData);
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

  /** Galat aksi hilang sendiri beberapa detik */
  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(t);
  }, [actionError]);

  /** Tandai pesanan sampai tujuan → API kini mengizinkan KURIR (COMPLETED) */
  const completeDelivery = async (o: OrderData) => {
    setUpdating(o.id);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/orders/${o.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyelesaikan pesanan.");
      await load();
      showNotice({
        type: "success",
        title: "Antaran Selesai ✓",
        message: `${o.code} tertandai sampai tujuan — ${o.customerName} sudah dilayani.`,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menyelesaikan pesanan.");
    } finally {
      setUpdating(null);
    }
  };

  /** Setor uang COD ke admin — dua langkah (tekan sekali = siap, lagi = kirim) */
  const depositToAdmin = async () => {
    if (!setorArmed) {
      setSetorArmed(true);
      setTimeout(() => setSetorArmed(false), 4000);
      return;
    }
    setSetorArmed(false);
    setSetorBusy(true);
    try {
      const res = await apiFetch("/api/courier/setoran", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal menyimpan setoran.");
      await load();
      showNotice({
        type: "success",
        title: "Setoran Tercatat ✓",
        message: `${formatIDR(data.setoran.amount)} uang menu diserahkan ke admin — ongkir ${formatIDR(
          data.setoran.ongkir ?? 0
        )} tetap pendapatanmu. Lapor langsung bila ada selisih.`,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menyimpan setoran.");
    } finally {
      setSetorBusy(false);
    }
  };

  const aktif = (orders ?? []).filter((o) => o.status === "READY");
  const selesai = (orders ?? []).filter((o) => o.status === "COMPLETED");
  const pending = setoran?.pending;
  const riwayat = (setoran?.riwayat ?? []).slice(0, 3);
  const riwayatAntaran = income?.history ?? [];
  const shown = tab === "antaran" ? aktif : selesai;

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

      {/* ===== PENDAPATAN KURIR (ongkir pesanan selesai, WIB) ===== */}
      <motion.section
        initial={prefersReduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-4"
      >
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-600 to-emerald-500 p-3.5 text-white shadow-md shadow-emerald-500/25">
            <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-emerald-100">
              <Banknote className="h-3.5 w-3.5" /> Pendapatan Hari Ini
            </p>
            <p className="mt-1 text-xl font-black leading-tight">
              {formatIDR(income?.today.amount ?? 0)}
            </p>
            <p className="text-[10px] font-semibold text-emerald-100">
              {income?.today.count ?? 0} pengantaran selesai
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-3.5 shadow-sm">
            <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-neutral-400">
              <Banknote className="h-3.5 w-3.5" /> Kemarin
            </p>
            <p className="mt-1 text-xl font-black leading-tight text-neutral-800">
              {formatIDR(income?.yesterday.amount ?? 0)}
            </p>
            <p className="text-[10px] font-semibold text-neutral-400">
              {income?.yesterday.count ?? 0} pengantaran
            </p>
          </div>
        </div>
        <button
          onClick={() => setHistoryOpen(true)}
          className="press-effect mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-white py-2.5 text-[12px] font-black text-emerald-700 shadow-sm hover:bg-emerald-50"
        >
          <History className="h-4 w-4" /> Riwayat Pengantaran
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">
            {riwayatAntaran.length}
          </span>
        </button>
      </motion.section>

      {/* ===== KANTONG UANG COD (setoran) ===== */}
      {(pending?.count ?? 0) > 0 || riwayat.length > 0 ? (
        <motion.section
          initial={prefersReduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-4 overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white shadow-sm"
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-amber-700">
                <HandCoins className="h-3.5 w-3.5" /> Setor ke Admin (Nominal Menu)
              </p>
              <p className="mt-0.5 text-2xl font-black text-neutral-900">
                {formatIDR(pending?.amount ?? 0)}
              </p>
              <p className="text-[10px] text-neutral-400">
                {pending?.count ?? 0} pesanan COD — uang menu saja, ongkir bukan uang admin
              </p>
              {(pending?.ongkir ?? 0) > 0 && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                  🛵 Ongkir {formatIDR(pending?.ongkir ?? 0)} = pendapatanmu (tidak disetor)
                </p>
              )}
            </div>
            {(pending?.count ?? 0) > 0 && (
              <button
                onClick={() => void depositToAdmin()}
                disabled={setorBusy}
                className={cn(
                  "press-effect flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-[12px] font-black text-white shadow-md disabled:opacity-60",
                  setorArmed ? "bg-red-600 shadow-red-500/30" : "bg-amber-600 shadow-amber-500/30"
                )}
              >
                {setorBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                {setorArmed ? "Yakin? Tekan Lagi" : "Setor ke Admin"}
              </button>
            )}
          </div>
          {/* Daftar pesanan COD tertunggak (maks 3): nominal menu + ongkir */}
          {(pending?.orders.length ?? 0) > 0 && (
            <ul className="mt-2.5 space-y-1 px-4">
              {pending!.orders.slice(0, 3).map((o) => {
                const menu = Math.max(0, o.total - (o.deliveryFee ?? 0));
                return (
                  <li key={o.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-neutral-600">
                      {o.code} • {o.customerName}
                    </span>
                    <span className="shrink-0 font-black text-amber-700">{formatIDR(menu)}</span>
                    {(o.deliveryFee ?? 0) > 0 && (
                      <span className="shrink-0 text-[10px] font-bold text-emerald-600">
                        +ongkir {formatIDR(o.deliveryFee ?? 0)}
                      </span>
                    )}
                  </li>
                );
              })}
              {pending!.orders.length > 3 && (
                <li className="text-[10px] font-semibold text-neutral-400">
                  +{pending!.orders.length - 3} pesanan lainnya
                </li>
              )}
            </ul>
          )}
          {/* Riwayat setoran terakhir + status konfirmasi admin */}
          {riwayat.length > 0 && (
            <div className="mt-3 border-t border-amber-100 bg-white/60 px-4 py-2.5">
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-neutral-400">
                <Clock className="h-3 w-3" /> Riwayat Setoran
              </p>
              <ul className="space-y-1">
                {riwayat.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-neutral-500">
                      {formatDateTime(r.createdAt)} • {r.orderCount} pesanan
                    </span>
                    <span className="shrink-0 font-black text-neutral-700">{formatIDR(r.amount)}</span>
                    {(r.ongkir ?? 0) > 0 && (
                      <span className="shrink-0 text-[10px] font-bold text-emerald-600">
                        +{formatIDR(r.ongkir)}
                      </span>
                    )}
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black",
                        r.confirmedAt
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      )}
                    >
                      {r.confirmedAt ? "Diterima Admin" : "Menunggu Konfirmasi"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.section>
      ) : null}

      {/* ===== TAB: ANTARAN / SELESAI ===== */}
      <div className="mb-3 flex rounded-2xl border border-emerald-100 bg-white p-1 shadow-sm">
        {(
          [
            { id: "antaran" as Tab, label: "Antaran", icon: Package, n: aktif.length },
            { id: "selesai" as Tab, label: "Selesai", icon: CheckCheck, n: selesai.length },
          ]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "press-effect flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[12px] font-black transition",
              tab === t.id
                ? "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-500/30"
                : "text-neutral-500 hover:bg-emerald-50"
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-black",
                tab === t.id ? "bg-white/25 text-white" : "bg-neutral-100 text-neutral-500"
              )}
            >
              {t.n}
            </span>
          </button>
        ))}
      </div>

      {/* Galat aksi (sampai tujuan / setor gagal) */}
      {actionError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">
          <RefreshCw className="h-3.5 w-3.5 shrink-0" /> {actionError}
        </div>
      )}

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
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 p-8 text-center">
          {tab === "antaran" ? (
            <>
              <Bike className="h-10 w-10 text-emerald-300" />
              <p className="text-sm font-black text-neutral-600">Tidak ada tugas antaran</p>
              <p className="max-w-[280px] text-[11px] leading-relaxed text-neutral-400">
                Staff menugaskan pesanan antar kepadamu lewat Kelola Pesanan ▸ "Serahkan ke Kurir".
                Tugas baru muncul otomatis di sini (halaman menyegarkan tiap 15 detik) + notifikasi push.
              </p>
            </>
          ) : (
            <>
              <CheckCheck className="h-10 w-10 text-emerald-300" />
              <p className="text-sm font-black text-neutral-600">Belum ada pengantaran selesai</p>
              <p className="max-w-[280px] text-[11px] leading-relaxed text-neutral-400">
                Pesanan yang sudah kamu antar sampai tujuan (tombol "Sampai Tujuan") tercatat di sini.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((o) => {
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
                    {/* COD: uang tunai dipegang kurir — masuk kantong setoran */}
                    {o.paymentMethod === "CASH" && !done && (
                      <p className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                        💵 COD — terima uang tunai persis {formatIDR(o.total)}; uang masuk kantong
                        setoranmu setelah ditekan "Sampai Tujuan".
                      </p>
                    )}
                    {o.paymentStatus === "UNPAID" && o.paymentMethod !== "CASH" && !done && (
                      <p className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                        ⚠️ Belum lunas — pembayaran digital diverifikasi otomatis sistem.
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

      {/* ===== SHEET RIWAYAT PENGANTARAN ===== */}
      {createPortal(
        <AnimatePresence>
          {historyOpen && (
            <motion.div
              key="riwayat-overlay"
              initial={prefersReduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={prefersReduced ? undefined : { opacity: 0 }}
              className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Riwayat Pengantaran"
              onClick={(e) => {
                if (e.target === e.currentTarget) setHistoryOpen(false);
              }}
            >
              <motion.div
                initial={prefersReduced ? false : { y: 48, scale: 0.97 }}
                animate={{ y: 0, scale: 1 }}
                exit={prefersReduced ? undefined : { y: 48, opacity: 0 }}
                transition={{ type: "spring", damping: 28, stiffness: 320 }}
                className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
              >
                <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3.5">
                  <div className="min-w-0">
                    <h2 className="text-sm font-black text-neutral-900">Riwayat Pengantaran 🛵</h2>
                    <p className="text-[10px] text-neutral-400">
                      30 pengantaran terakhir — ongkir = pendapatanmu (tidak ikut disetor)
                    </p>
                  </div>
                  <button
                    onClick={() => setHistoryOpen(false)}
                    aria-label="Tutup riwayat"
                    className="press-effect flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {riwayatAntaran.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <History className="h-9 w-9 text-emerald-200" />
                      <p className="text-[13px] font-black text-neutral-500">Belum ada pengantaran selesai</p>
                      <p className="max-w-[260px] text-[11px] leading-relaxed text-neutral-400">
                        Setiap pesanan yang kamu tandai "Sampai Tujuan" tercatat di sini beserta ongkirnya.
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {riwayatAntaran.map((h) => (
                        <li
                          key={h.id}
                          className="flex items-center gap-3 rounded-xl border border-neutral-100 bg-white px-3 py-2.5 shadow-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-black text-neutral-800">
                              {h.code} • {h.customerName}
                            </p>
                            <p className="truncate text-[10px] text-neutral-400">
                              {formatDateTime(h.updatedAt)}
                              {h.deliveryArea ? ` • ${h.deliveryArea}` : ""}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[13px] font-black text-emerald-600">
                              +{formatIDR(h.deliveryFee)}
                            </p>
                            <p className="text-[9px] font-bold uppercase text-neutral-400">
                              {h.paymentMethod === "CASH" ? "COD" : "Digital"}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
