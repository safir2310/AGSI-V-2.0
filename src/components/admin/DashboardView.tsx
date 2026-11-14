"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  CheckCircle2,
  ChefHat,
  ClipboardList,
  Coins,
  HandCoins,
  Package,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { SourceBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDateTime, formatIDR } from "@/lib/types";
import type { AppView } from "@/lib/store";
import { cn } from "@/lib/utils";

type ReportData = {
  summary: {
    revenueTotal: number;
    revenueToday: number;
    ordersTotal: number;
    ordersToday: number;
    activeCount: number;
    avgOrder: number;
    productCount: number;
    availableCount: number;
    customerCount: number;
  };
  daily: Array<{ label: string; revenue: number; orders: number }>;
  recent: Array<{
    id: string;
    code: string;
    customerName: string;
    status: string;
    type: string;
    total: number;
    source: string;
    createdAt: string;
    itemCount: number;
  }>;
};

/** Rekap setoran COD kurir — dari GET /api/courier/setoran (admin) */
type SetoranAdminData = {
  perKurir: Array<{ courierId: string | null; courierName: string; amount: number; count: number }>;
  riwayat: Array<{
    id: string;
    amount: number;
    orderCount: number;
    note: string | null;
    createdAt: string;
    confirmedAt: string | null;
    courier: { name: string };
  }>;
};

export function DashboardView({ go }: { go: (v: AppView) => void }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [setoran, setSetoran] = useState<SetoranAdminData | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const prefersReduced = useReducedMotion();

  const load = async () => {
    setLoading(true);
    try {
      const [res, sRes] = await Promise.all([
        apiFetch("/api/reports?days=7"),
        apiFetch("/api/courier/setoran", { cache: "no-store" }),
      ]);
      if (res.ok) setData(await res.json());
      if (sRes.ok) setSetoran(await sRes.json());
    } finally {
      setLoading(false);
    }
  };

  /** Admin menandai setoran COD kurir sebagai DITERIMA (uang di tangan) */
  const confirmSetoran = async (id: string) => {
    setConfirming(id);
    try {
      const res = await apiFetch(`/api/courier/setoran/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (res.ok) await load();
    } finally {
      setConfirming(null);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const s = data?.summary;

  const cards = [
    {
      label: "Pendapatan Hari Ini",
      value: s ? formatIDR(s.revenueToday) : "—",
      sub: s ? `${s.ordersToday} pesanan hari ini` : "",
      icon: Coins,
      accent: "from-orange-500 to-orange-600",
    },
    {
      label: "Pesanan Aktif",
      value: s ? String(s.activeCount) : "—",
      sub: "Perlu diproses sekarang",
      icon: ChefHat,
      accent: "from-amber-400 to-orange-500",
    },
    {
      label: "Rata-rata / Pesanan",
      value: s ? formatIDR(s.avgOrder) : "—",
      sub: s ? `${s.ordersTotal} pesanan 7 hari` : "",
      icon: TrendingUp,
      accent: "from-orange-400 to-orange-500",
    },
    {
      label: "Pelanggan Terdaftar",
      value: s ? String(s.customerCount) : "—",
      sub: s ? `${s.availableCount}/${s.productCount} menu tersedia` : "",
      icon: Users,
      accent: "from-green-500 to-emerald-500",
    },
  ];

  return (
    <div className="px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black text-neutral-900">Dashboard 📊</h1>
          <p className="text-xs text-neutral-400">Ringkasan bisnis 7 hari terakhir</p>
        </div>
        <button
          onClick={load}
          aria-label="Muat ulang data"
          className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-white text-orange-600 shadow-sm hover:bg-orange-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </header>

      {/* Kartu statistik */}
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c, i) => (
          <motion.div
            key={c.label}
            initial={prefersReduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.35 }}
            className={cn(
              "card-lift relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-lg",
              c.accent
            )}
          >
            <div className="pointer-events-none absolute -right-4 -top-5 h-20 w-20 rounded-full bg-white/15 blur-xl" />
            <c.icon className="h-5 w-5 opacity-90" />
            <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-white/85">
              {c.label}
            </p>
            <p className="mt-0.5 text-lg font-black leading-tight">{c.value}</p>
            <p className="mt-0.5 text-[10px] text-white/75">{c.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Grafik pendapatan */}
      <motion.section
        initial={prefersReduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.35 }}
        className="mt-4 rounded-2xl border border-orange-100 bg-white p-4 shadow-sm"
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-black text-neutral-800">Tren Pendapatan</h2>
            <p className="text-[11px] text-neutral-400">7 hari terakhir (pesanan selesai)</p>
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100">
            <TrendingUp className="h-4 w-4 text-orange-600" />
          </span>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data?.daily ?? []} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="dashRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F97316" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#F97316" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#FFEDD5" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#A8A29E" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#A8A29E" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}rb` : String(v))}
              />
              <Tooltip
                formatter={(v) => [formatIDR(Number(v)), "Pendapatan"]}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #FFEDD5",
                  fontSize: 12,
                  boxShadow: "0 8px 24px -12px rgba(234,88,12,.35)",
                }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#EA580C"
                strokeWidth={2.5}
                fill="url(#dashRev)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.section>

      {/* Pesanan aktif terbaru */}
      <motion.section
        initial={prefersReduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28, duration: 0.35 }}
        className="mt-4 overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-orange-50 px-4 py-3">
          <h2 className="text-sm font-black text-neutral-800">Pesanan Perlu Aksi 🔥</h2>
          <button
            onClick={() => go("orders")}
            className="inline-flex items-center gap-0.5 text-xs font-bold text-orange-600 hover:text-orange-700"
          >
            Kelola <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {(data?.recent ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 p-8 text-center">
            <ClipboardList className="h-7 w-7 text-orange-200" />
            <p className="text-xs font-semibold text-neutral-400">
              Tidak ada pesanan aktif — waktu santai ☕
            </p>
          </div>
        ) : (
          <ul>
            {data?.recent.map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-3 border-b border-orange-50 px-4 py-2.5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-xs font-black text-neutral-700">{o.code}</p>
                    <SourceBadge source={o.source} />
                  </div>
                  <p className="truncate text-[11px] text-neutral-400">
                    {o.customerName} • {o.itemCount} item • {formatDateTime(o.createdAt)}
                  </p>
                </div>
                <StatusBadge status={o.status} />
                <span className="text-xs font-black text-orange-600">{formatIDR(o.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </motion.section>

      {/* Setoran COD kurir (uang tunai yang dipegang kurir) */}
      <motion.section
        initial={prefersReduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24, duration: 0.35 }}
        className="mt-4 overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-amber-50 bg-gradient-to-r from-amber-50 to-white px-4 py-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-black text-neutral-800">
              <HandCoins className="h-4 w-4 text-amber-600" /> Setoran COD Kurir
            </h2>
            <p className="text-[11px] text-neutral-400">
              Uang tunai (bayar di tempat) yang dipegang kurir & bukti setoran
            </p>
          </div>
        </div>

        {/* Kurir yang masih memegang uang COD */}
        {(setoran?.perKurir ?? []).length > 0 ? (
          <ul className="divide-y divide-amber-50">
            {setoran!.perKurir.map((k) => (
              <li key={k.courierId ?? "x"} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-[13px] font-black text-amber-700">
                  {k.courierName.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black text-neutral-700">{k.courierName}</p>
                  <p className="text-[11px] text-neutral-400">
                    {k.count} pesanan COD belum disetor
                  </p>
                </div>
                <span className="shrink-0 text-sm font-black text-amber-700">{formatIDR(k.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-[11px] font-semibold text-neutral-400">
            ✓ Semua kurir sudah menyetor — tidak ada uang COD yang tertunggak.
          </p>
        )}

        {/* Riwayat setoran + konfirmasi penerimaan */}
        {(setoran?.riwayat ?? []).length > 0 && (
          <div className="border-t border-amber-50 bg-amber-50/40 px-4 py-3">
            <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-neutral-400">
              Riwayat Setoran
            </p>
            <ul className="space-y-2">
              {setoran!.riwayat.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-black text-neutral-700">
                      {r.courier.name} • {formatIDR(r.amount)}{" "}
                      <span className="font-semibold text-neutral-400">({r.orderCount} pesanan)</span>
                    </p>
                    <p className="truncate text-[10px] text-neutral-400">
                      {formatDateTime(r.createdAt)}
                      {r.note ? ` • ${r.note}` : ""}
                    </p>
                  </div>
                  {r.confirmedAt ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[9px] font-black text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> Diterima
                    </span>
                  ) : (
                    <button
                      onClick={() => void confirmSetoran(r.id)}
                      disabled={confirming === r.id}
                      className="press-effect shrink-0 rounded-full bg-amber-600 px-3 py-1.5 text-[10px] font-black text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
                    >
                      {confirming === r.id ? "…" : "Tandai Diterima"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </motion.section>

      {/* Shortcut produk */}
      <motion.button
        initial={prefersReduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.34, duration: 0.35 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => go("products")}
        className="press-effect mt-4 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-orange-600 to-orange-500 p-4 text-left text-white shadow-lg shadow-orange-500/30"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
          <Package className="h-5 w-5" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-extrabold">Kelola Menu & Produk</span>
          <span className="block text-[11px] text-orange-50/90">
            {s ? `${s.availableCount} menu aktif dari ${s.productCount} menu` : "Tambah, edit, nonaktifkan menu"}
          </span>
        </span>
        <ArrowUpRight className="h-5 w-5" />
      </motion.button>
    </div>
  );
}
