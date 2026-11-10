"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
import { CalendarRange, Coins, Download, Loader2, Printer, RefreshCw, TrendingUp, UtensilsCrossed } from "lucide-react";
import { useNoticeStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { formatIDR } from "@/lib/types";
import { cn } from "@/lib/utils";
import { nativePrintPage, nativePrintSupported, nativeSaveFile, nativeSaveSupported } from "@/lib/native-file";

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

/** ===== PORTAL CETAK LAPORAN =====
 *  Layout khusus KERTAS — tidak pernah tampil di layar (class "hidden";
 *  hanya muncul saat mencetak lewat aturan @media print di globals.css).
 *  Lebih andal daripada mencetak layar langsung: grafik Recharts diganti
 *  tabel, warna hitam-putih agar aman di semua printer/PDF.
 *
 *  Di aplikasi Android dicetak via dialog cetak sistem (AgsiNative.printPage,
 *  jalur sama dengan tombol cetak struk), di browser biasa via window.print().
 *  Keduanya menawarkan "Simpan sebagai PDF" — jadi laporan bisa langsung
 *  terunduh ke penyimpanan. */
type LaporanPrintProps = { data: ReportData; days: number };

function LaporanPrintPortal({ data, days }: LaporanPrintProps) {
  const s = data.summary;
  const sekarang = new Date();
  const dicetak = sekarang.toLocaleString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const mulai = new Date(sekarang.getTime() - days * 86_400_000).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const sampai = sekarang.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const kategoriTotal = data.categoryRevenue.reduce((a, k) => a + k.value, 0) || 1;
  const totalHarian = data.daily.reduce((a, d) => a + d.revenue, 0);
  const totalPesananHarian = data.daily.reduce((a, d) => a + d.orders, 0);
  const statusAktif = Object.entries(data.statusCount).filter(([, n]) => n > 0);

  const th = "border border-neutral-300 bg-neutral-100 px-2 py-1 text-left text-[10px] font-black uppercase tracking-wide";
  const td = "border border-neutral-300 px-2 py-1 align-top";

  return createPortal(
    <div aria-hidden="true" className="laporan-print-portal hidden font-sans text-black">
      <div className="p-[2mm] text-[11px] leading-snug">
        {/* Kepala */}
        <div className="mb-3 border-b-2 border-black pb-2">
          <p className="text-[16px] font-black">AGSI — Ayam Geprek Sambal Ijo</p>
          <p className="text-[12px] font-bold">
            Laporan Penjualan · {mulai} – {sampai} ({days} hari)
          </p>
          <p className="text-[9px] text-neutral-600">Dicetak: {dicetak}</p>
        </div>

        {/* Ringkasan */}
        <table className="mb-4 w-full border-collapse">
          <tbody>
            <tr>
              <td className={td}>
                <b>Total Pendapatan</b>
                <br />
                {formatIDR(s.revenueTotal)}
              </td>
              <td className={td}>
                <b>Rata-rata / Pesanan</b>
                <br />
                {formatIDR(s.avgOrder)}
              </td>
            </tr>
            <tr>
              <td className={td}>
                <b>Total Pesanan</b>
                <br />
                {s.ordersTotal} pesanan · {s.completedCount} selesai
              </td>
              <td className={td}>
                <b>Lainnya</b>
                <br />
                {s.cancelledCount} dibatalkan · {s.customerCount} pelanggan
              </td>
            </tr>
          </tbody>
        </table>

        {/* Pendapatan harian */}
        <p className="mb-1 text-[12px] font-black">Pendapatan Harian</p>
        <table className="mb-4 w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Tanggal</th>
              <th className={th}>Pendapatan</th>
              <th className={th}>Pesanan</th>
            </tr>
          </thead>
          <tbody>
            {data.daily.map((d) => (
              <tr key={d.label}>
                <td className={td}>{d.label}</td>
                <td className={td}>{formatIDR(d.revenue)}</td>
                <td className={td}>{d.orders}</td>
              </tr>
            ))}
            <tr>
              <td className={td + " font-black"}>Total</td>
              <td className={td + " font-black"}>{formatIDR(totalHarian)}</td>
              <td className={td + " font-black"}>{totalPesananHarian}</td>
            </tr>
          </tbody>
        </table>

        {/* Menu terlaris */}
        {(data.topProducts ?? []).length > 0 && (
          <>
            <p className="mb-1 text-[12px] font-black">Menu Terlaris</p>
            <table className="mb-4 w-full border-collapse">
              <thead>
                <tr>
                  <th className={th + " w-8"}>#</th>
                  <th className={th}>Menu</th>
                  <th className={th}>Qty</th>
                  <th className={th}>Pendapatan</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p, i) => (
                  <tr key={p.name}>
                    <td className={td}>{i + 1}</td>
                    <td className={td}>{p.name}</td>
                    <td className={td}>{p.qty}x</td>
                    <td className={td}>{formatIDR(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Pendapatan per kategori */}
        {(data.categoryRevenue ?? []).length > 0 && (
          <>
            <p className="mb-1 text-[12px] font-black">Pendapatan per Kategori</p>
            <table className="mb-4 w-full border-collapse">
              <tbody>
                {data.categoryRevenue.map((k) => (
                  <tr key={k.name}>
                    <td className={td}>{k.name}</td>
                    <td className={td}>{formatIDR(k.value)}</td>
                    <td className={td}>{Math.round((k.value / kategoriTotal) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Status pesanan */}
        {statusAktif.length > 0 && (
          <>
            <p className="mb-1 text-[12px] font-black">Status Pesanan</p>
            <table className="mb-4 w-full border-collapse">
              <tbody>
                <tr>
                  {statusAktif.map(([status, n]) => (
                    <td key={status} className={td}>
                      <b>{n}</b> · {STATUS_LABELS[status] ?? status}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </>
        )}

        <p className="mt-2 text-[9px] text-neutral-500">
          Dibuat otomatis oleh aplikasi AGSI — dokumen laporan internal.
        </p>
      </div>
    </div>,
    document.body,
  );
}

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

  /** Cetak laporan — aplikasi: dialog cetak sistem Android (PrintManager,
   *  bisa "Simpan sebagai PDF" → langsung terunduh ke penyimpanan);
   *  browser: window.print(). Kertas memakai portal .laporan-print-portal
   *  yang sudah terpasang di body sejak data laporan tersedia. */
  const printReport = () => {
    if (!data) return;
    if (nativePrintSupported()) {
      void nativePrintPage(`Laporan AGSI ${days} Hari`);
    } else {
      window.print();
    }
  };

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

      {/* Simpan & cetak */}
      <div className="mt-4 mb-1 grid grid-cols-2 gap-2">
        <button
          onClick={exportCsv}
          disabled={!data}
          className="press-effect flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-orange-600 to-orange-500 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:brightness-105 disabled:opacity-60"
        >
          <Download className="h-4 w-4" /> Simpan (CSV)
        </button>
        <button
          onClick={printReport}
          disabled={!data}
          className="press-effect flex items-center justify-center gap-2 rounded-2xl bg-neutral-800 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-neutral-800/25 hover:bg-neutral-900 disabled:opacity-60"
        >
          <Printer className="h-4 w-4" /> Cetak (PDF)
        </button>
      </div>

      {/* Layout kertas — tersembunyi di layar, tampil saat mencetak */}
      {data && <LaporanPrintPortal data={data} days={days} />}
    </div>
  );
}
