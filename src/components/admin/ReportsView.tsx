"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarRange, Coins, Loader2, RefreshCw, TrendingUp, UtensilsCrossed } from "lucide-react";
import { useNoticeStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { formatIDR } from "@/lib/types";
import { cn } from "@/lib/utils";
import { nativeSaveFile, nativeSaveSupported } from "@/lib/native-file";

type ReportData = {
  summary: {
    revenueTotal: number;
    ordersTotal: number;
    completedCount: number;
    cancelledCount: number;
    avgOrder: number;
    customerCount: number;
  };
  daily: Array<{ label: string; revenue: number; orders: number }>;
  topProducts: Array<{ name: string; emoji: string; qty: number; revenue: number }>;
  statusCount: Record<string, number>;
  categoryRevenue: Array<{ name: string; value: number }>;
};

const RANGES = [
  { days: 7, label: "7 Hari" },
  { days: 30, label: "30 Hari" },
  { days: 90, label: "90 Hari" },
];

const PIE_COLORS = ["#F97316", "#FB923C", "#22C55E", "#FDBA74", "#F59E0B", "#C2410C"];

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Menunggu",
  PREPARING: "Dimasak",
  READY: "Siap",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

export function ReportsView() {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const [days, setDays] = useState(7);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (d: number) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/reports?days=${d}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(days);
  }, [days]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ["Tanggal", "Pendapatan", "Jumlah Pesanan"],
      ...data.daily.map((d) => [d.label, String(d.revenue), String(d.orders)]),
    ];
    const csv = rows.map((r) => r.join(";")).join("\n");
    const name = `laporan-agsi-${days}-hari.csv`;
    // Di aplikasi Android: unduhan blob: tidak didukung WebView — simpan file
    // langsung ke folder Unduhan lewat jembatan native.
    if (nativeSaveSupported()) {
      void nativeSaveFile("\uFEFF" + csv, name, "text/csv").then((res) => {
        if (res.ok) {
          showNotice({
            type: "success",
            title: "Laporan Diekspor ✓",
            message: `File ${name} tersimpan di folder Unduhan. Bisa dibuka di Excel / Google Sheets.`,
          });
        } else if (res.message !== "dibatalkan" && res.message !== "timeout") {
          showNotice({
            type: "error",
            title: "Ekspor Gagal",
            message: res.message || "Gagal menyimpan file laporan.",
          });
        }
      });
      return;
    }
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    showNotice({
      type: "success",
      title: "Laporan Diekspor ✓",
      message: "File CSV laporan berhasil diunduh. Bisa dibuka di Excel / Google Sheets.",
    });
  };

  const s = data?.summary;

  return (
    <div className="px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black text-neutral-900">Laporan 📈</h1>
          <p className="text-xs text-neutral-400">Analisa penjualan & performa menu</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(days)}
            aria-label="Muat ulang laporan"
            className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-white text-orange-600 shadow-sm hover:bg-orange-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Pilih rentang */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        {RANGES.map((r) => (
          <button
            key={r.days}
            onClick={() => setDays(r.days)}
            className={cn(
              "press-effect flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition-all",
              days === r.days
                ? "border-orange-500 bg-orange-600 text-white shadow-md shadow-orange-500/30"
                : "border-orange-200 bg-white text-orange-700 hover:bg-orange-50"
            )}
          >
            <CalendarRange className="h-3.5 w-3.5" /> {r.label}
          </button>
        ))}
      </div>

      {/* Ringkasan */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Total Pendapatan", value: s ? formatIDR(s.revenueTotal) : "—", icon: Coins, sub: s ? `${s.completedCount} pesanan selesai` : "" },
          { label: "Rata-rata Pesanan", value: s ? formatIDR(s.avgOrder) : "—", icon: TrendingUp, sub: s ? `${s.ordersTotal} total pesanan` : "" },
          { label: "Pesanan Dibatalkan", value: s ? String(s.cancelledCount) : "—", icon: UtensilsCrossed, sub: "Perlu evaluasi" },
          { label: "Pelanggan Terdaftar", value: s ? String(s.customerCount) : "—", icon: CalendarRange, sub: "Akun aplikasi" },
        ].map((c, i) => (
          <motion.div
            key={c.label}
            initial={prefersReduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.32 }}
            className="card-lift rounded-2xl border border-orange-100 bg-white p-4 shadow-sm"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-100">
              <c.icon className="h-4 w-4 text-orange-600" />
            </span>
            <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-neutral-400">{c.label}</p>
            <p className="text-lg font-black text-neutral-800">{c.value}</p>
            <p className="text-[10px] text-neutral-400">{c.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Grafik pendapatan */}
      <motion.section
        initial={prefersReduced ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, duration: 0.32 }}
        className="mt-4 min-w-0 overflow-hidden rounded-2xl border border-orange-100 bg-white p-4 shadow-sm"
      >
        <h2 className="mb-3 text-sm font-black text-neutral-800">Pendapatan Harian</h2>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.daily ?? []} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#FFEDD5" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#A8A29E" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: "#A8A29E" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}rb` : String(v))}
              />
              <Tooltip
                formatter={(v) => [formatIDR(Number(v)), "Pendapatan"]}
                contentStyle={{ borderRadius: 12, border: "1px solid #FFEDD5", fontSize: 12 }}
                cursor={{ fill: "#FFF7ED" }}
              />
              <Bar dataKey="revenue" fill="#F97316" radius={[6, 6, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.section>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* Produk terlaris */}
        <motion.section
          initial={prefersReduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.32 }}
          className="min-w-0 overflow-hidden rounded-2xl border border-orange-100 bg-white p-4 shadow-sm"
        >
          <h2 className="mb-3 text-sm font-black text-neutral-800">Menu Terlaris 🏆</h2>
          {(data?.topProducts ?? []).length === 0 ? (
            <p className="py-6 text-center text-xs text-neutral-400">Belum ada penjualan selesai.</p>
          ) : (
            <ul className="space-y-2">
              {data?.topProducts.map((p, i) => (
                <li key={p.name} className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-black",
                      i === 0 ? "bg-orange-600 text-white" : "bg-orange-100 text-orange-700"
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="text-lg">{p.emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-xs font-bold text-neutral-700">{p.name}</span>
                  <span className="text-[10px] font-bold text-neutral-400">{p.qty}x</span>
                  <span className="text-xs font-black text-orange-600">{formatIDR(p.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </motion.section>

        {/* Komposisi kategori */}
        <motion.section
          initial={prefersReduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.32 }}
          className="min-w-0 overflow-hidden rounded-2xl border border-orange-100 bg-white p-4 shadow-sm"
        >
          <h2 className="mb-1 text-sm font-black text-neutral-800">Pendapatan per Kategori</h2>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.categoryRevenue ?? []}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="52%"
                  outerRadius="82%"
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {(data?.categoryRevenue ?? []).map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => [formatIDR(Number(v)), "Pendapatan"]}
                  contentStyle={{ borderRadius: 12, border: "1px solid #FFEDD5", fontSize: 12 }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={24}
                  formatter={(v) => <span style={{ fontSize: 10, color: "#78716C" }}>{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.section>
      </div>

      {/* Status pesanan */}
      <motion.section
        initial={prefersReduced ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.34, duration: 0.32 }}
        className="mt-4 rounded-2xl border border-orange-100 bg-white p-4 shadow-sm"
      >
        <h2 className="mb-3 text-sm font-black text-neutral-800">Status Pesanan</h2>
        <div className="grid grid-cols-5 gap-2">
          {Object.entries(data?.statusCount ?? {}).map(([status, count]) => (
            <div key={status} className="rounded-xl bg-orange-50/70 p-2 text-center">
              <p className="text-lg font-black text-orange-700">{count}</p>
              <p className="text-[9px] font-bold text-neutral-400">
                {STATUS_LABELS[status] ?? status}
              </p>
            </div>
          ))}
        </div>
      </motion.section>

      <button
        onClick={exportCsv}
        className="press-effect mt-4 mb-1 w-full rounded-2xl bg-gradient-to-r from-orange-600 to-orange-500 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:brightness-105"
      >
        ⬇️ Ekspor Laporan (CSV)
      </button>
    </div>
  );
}
