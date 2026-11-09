"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Loader2,
  PlugZap,
  QrCode,
  RefreshCw,
  Search,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import { formatDateTime } from "@/lib/types";
import { cn } from "@/lib/utils";

export type QrisManagerSheetProps = {
  open: boolean;
  onClose: () => void;
};

// ============================================================
//  Tipe data (selaras GET /api/admin/qris)
// ============================================================
type QrisTx = {
  id: string;
  code: string;
  customerName: string;
  type: string;
  source: string;
  status: string;
  paymentStatus: string;
  total: number;
  provider: string | null;
  qrisTrxId: string | null;
  qrisMode: string | null;
  qrisFallbackReason: string | null;
  qrisExpiresAt: string | null;
  paidAt: string | null;
  paidVia: string | null;
  createdAt: string;
};

type DailyPoint = { date: string; label: string; amount: number; count: number };

type ManagerData = {
  config: {
    dana: { enabled: boolean; production: boolean };
    midtrans: { enabled: boolean; production: boolean };
    internal: { sandboxEnabled: boolean };
    activeProvider: string;
  };
  summary: {
    totalMasuk: number;
    masukHariIni: number;
    countLunas: number;
    countMenunggu: number;
    countGagal: number;
    countSemua: number;
    avgMasuk: number;
    successRate: number;
  };
  daily: DailyPoint[];
  transactions: QrisTx[];
};

type HealthVerdict = {
  ok: boolean;
  title: string;
  detail: string;
};

type TxState = "PAID" | "PENDING" | "FAILED";

// ============================================================
//  Helper tampilan
// ============================================================
function rp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** Bentuk ringkas utk kartu ringkasan: 150000 -> "Rp 150rb", 1250000 -> "Rp 1,3jt" */
function rpCompact(n: number): string {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}jt`;
  if (n >= 1_000) return `Rp ${Math.round(n / 1_000)}rb`;
  return rp(n);
}

/** Tanggal transaksi ramah: "Hari ini • 14:30" / "Kemarin • 09:12" / "05 Nov • 13:40" */
function trxDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  const time = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Hari ini • ${time}`;
  if (diffDays === 1) return `Kemarin • ${time}`;
  return `${d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" })} • ${time}`;
}

function txState(t: QrisTx): TxState {
  if (t.paymentStatus === "PAID") return "PAID";
  if (t.status === "PENDING") return "PENDING";
  return "FAILED";
}

const STATE_META: Record<TxState, { label: string; cls: string; dot: string }> = {
  PAID: {
    label: "Lunas",
    cls: "bg-green-100 text-green-700 ring-1 ring-green-200",
    dot: "bg-green-500",
  },
  PENDING: {
    label: "Menunggu",
    cls: "bg-amber-100 text-amber-700 ring-1 ring-amber-200",
    dot: "bg-amber-500",
  },
  FAILED: {
    label: "Batal",
    cls: "bg-red-100 text-red-600 ring-1 ring-red-200",
    dot: "bg-red-500",
  },
};

function providerLabel(p: string | null): string {
  if (p === "doku") return "DOKU";
  if (p?.startsWith("doku")) return "DOKU Sandbox";
  if (p === "dana") return "DANA";
  if (p === "casaku") return "Casaku";
  if (p === "internal") return "Bawaan";
  if (p === "external") return "Eksternal";
  return "Tanpa penyedia";
}

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Makan di tempat",
  TAKEAWAY: "Bawa pulang",
  DELIVERY: "Antar",
};

// ============================================================
//  Komponen utama — Sheet "Pengelola QRIS"
// ============================================================
export function QrisManagerSheet({ open, onClose }: QrisManagerSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);

  const [data, setData] = useState<ManagerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter & pencarian
  const [statusFilter, setStatusFilter] = useState<"ALL" | TxState>("ALL");
  const [providerFilter, setProviderFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");

  // Detail transaksi terbuka
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Uji koneksi Midtrans
  const [probing, setProbing] = useState(false);
  const [verdict, setVerdict] = useState<HealthVerdict | null>(null);

  // Pembatalan transaksi tertunda
  const [voidingId, setVoidingId] = useState<string | null>(null);

  /** Muat data pengelola; silent=true -> tanpa spinner (untuk polling) */
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const res = await apiFetch("/api/admin/qris", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setLoadError(body.error ?? "Gagal memuat data QRIS.");
        return;
      }
      setData(body as ManagerData);
    } catch {
      setLoadError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchDataRef = useRef(fetchData);
  useEffect(() => {
    fetchDataRef.current = fetchData;
  });

  // Buka sheet -> muat data; tutup -> reset filter agar bersih dibuka lagi
  useEffect(() => {
    if (open) {
      setVerdict(null);
      setExpandedId(null);
      void fetchDataRef.current();
    } else {
      setQuery("");
      setStatusFilter("ALL");
      setProviderFilter("ALL");
    }
  }, [open]);

  // Polling tiap 20 detik selama sheet terbuka — dana masuk baru langsung terlihat
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => void fetchDataRef.current(true), 20_000);
    return () => clearInterval(iv);
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

  // ===== Uji koneksi Midtrans (probe charge Rp15rb -> langsung dibatalkan) =====
  const runProbe = async () => {
    if (probing) return;
    setProbing(true);
    setVerdict(null);
    try {
      const res = await apiFetch("/api/qris-gateway/health", { method: "POST" });
      const body = (await res.json()) as HealthVerdict;
      setVerdict(body);
    } catch {
      setVerdict({
        ok: false,
        title: "Tidak dapat menghubungi server",
        detail: "Periksa koneksi internet lalu coba lagi.",
      });
    } finally {
      setProbing(false);
    }
  };

  // ===== Ekspor CSV (Excel-ready: BOM + pemisah ;) =====
  const exportCsv = () => {
    if (!data) return;
    const rows = filteredTx(data);
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head = [
      "Kode Pesanan",
      "Tanggal Transaksi",
      "Tanggal Dana Masuk",
      "Jumlah Dana (Rp)",
      "Status",
      "Penyedia",
      "Pelanggan",
      "Tipe Pesanan",
      "Sumber",
      "ID Transaksi Gateway",
    ];
    const lines = rows.map((t) =>
      [
        t.code,
        new Date(t.createdAt).toISOString(),
        t.paidAt ? new Date(t.paidAt).toISOString() : "",
        String(t.total),
        STATE_META[txState(t)].label,
        providerLabel(t.provider),
        t.customerName,
        TYPE_LABEL[t.type] ?? t.type,
        t.source === "POS" ? "POS Kasir" : "Aplikasi",
        t.qrisTrxId ?? "",
      ]
        .map(esc)
        .join(";")
    );
    const csv = "\uFEFF" + head.map(esc).join(";") + "\n" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qris-transaksi-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showNotice({
      type: "success",
      title: "CSV Terunduh ✓",
      message: `${rows.length} transaksi QRIS diekspor ke berkas CSV.`,
    });
  };

  // ===== Batalkan transaksi yang masih menunggu bayar =====
  const voidTransaction = (t: QrisTx) => {
    showNotice({
      type: "confirm",
      title: `Batalkan Transaksi ${t.code}?`,
      message:
        "QR akan dimatikan di penyedia sehingga tidak bisa dibayar lagi. Voucher yang dipakai pelanggan dikembalikan. Dana yang ternyata sudah masuk tetap diverifikasi sistem.",
      actions: [
        { label: "Jangan" },
        {
          label: "Ya, Batalkan",
          variant: "destructive",
          onClick: () => {
            void (async () => {
              setVoidingId(t.id);
              try {
                const res = await apiFetch("/api/admin/qris", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ orderId: t.id }),
                });
                const body = await res.json();
                if (!res.ok) {
                  showNotice({
                    type: "error",
                    title: "Tidak Bisa Dibatalkan",
                    message: body.error ?? "Coba lagi sebentar.",
                  });
                  return;
                }
                showNotice({
                  type: "success",
                  title: "Transaksi Dibatalkan ✓",
                  message: body.message ?? `${t.code} dibatalkan.`,
                });
                setExpandedId(null);
                await fetchData(true);
              } catch {
                showNotice({
                  type: "error",
                  title: "Gagal Membatalkan",
                  message: "Tidak dapat menghubungi server.",
                });
              } finally {
                setVoidingId(null);
              }
            })();
          },
        },
      ],
    });
  };

  /** Terapkan filter status + penyedia + pencarian */
  const filteredTx = (d: ManagerData): QrisTx[] => {
    const q = query.trim().toLowerCase();
    return d.transactions.filter((t) => {
      if (statusFilter !== "ALL" && txState(t) !== statusFilter) return false;
      if (providerFilter !== "ALL" && (t.provider ?? "none") !== providerFilter) return false;
      if (
        q &&
        !t.code.toLowerCase().includes(q) &&
        !t.customerName.toLowerCase().includes(q) &&
        !(t.qrisTrxId ?? "").toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  };

  const summary = data?.summary ?? null;
  const config = data?.config ?? null;
  const dailyMax = data ? Math.max(...data.daily.map((d) => d.amount), 1) : 1;
  const visibleTx = data ? filteredTx(data) : [];
  const providersInData = useMemo(() => {
    const set = new Set<string>();
    data?.transactions.forEach((t) => set.add(t.provider ?? "none"));
    return Array.from(set);
  }, [data]);

  // Portal ke <body> agar modal di atas navigasi bawah & header (pola sheet lain)
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="qris-manager-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pengelola QRIS"
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
                  <QrCode className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Pengelola QRIS</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    {summary
                      ? `${summary.countSemua} transaksi • dana masuk ${rpCompact(summary.totalMasuk)}`
                      : "Dana masuk, status & transaksi QRIS"}
                  </p>
                </div>
                <button
                  onClick={() => void fetchData()}
                  aria-label="Muat ulang data"
                  title="Muat ulang"
                  className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                </button>
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
                <div className="flex min-h-[220px] items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-orange-400" />
                </div>
              ) : loadError && !data ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
                  <p className="text-xs font-semibold text-red-500">{loadError}</p>
                  <button
                    onClick={() => void fetchData()}
                    className="press-effect rounded-full bg-orange-600 px-4 py-2 text-[11px] font-extrabold text-white hover:bg-orange-700"
                  >
                    Coba Lagi
                  </button>
                </div>
              ) : data && summary && config ? (
                <div className="space-y-4">
                  {/* ===== STATUS PENYEDIA QRIS ===== */}
                  <section className="rounded-2xl border border-orange-100 bg-orange-50/50 p-3.5">
                    <p className="text-[10px] font-black uppercase tracking-wide text-orange-500">
                      Status Gateway QRIS
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {config.dana.enabled ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black",
                            config.dana.production
                              ? "bg-green-100 text-green-700 ring-1 ring-green-200"
                              : "bg-amber-100 text-amber-700 ring-1 ring-amber-200"
                          )}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          DANA {config.dana.production ? "Produksi ✓" : "Sandbox"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-black text-neutral-500 ring-1 ring-neutral-200">
                          <XCircle className="h-3 w-3" /> DANA nonaktif
                        </span>
                      )}
                      {config.midtrans.enabled ? (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black",
                            config.midtrans.production
                              ? "bg-green-100 text-green-700 ring-1 ring-green-200"
                              : "bg-amber-100 text-amber-700 ring-1 ring-amber-200"
                          )}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Midtrans {config.midtrans.production ? "Produksi ✓" : "Sandbox"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-black text-neutral-500 ring-1 ring-neutral-200">
                          <XCircle className="h-3 w-3" /> Midtrans nonaktif
                        </span>
                      )}
                      {config.internal.sandboxEnabled && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-black text-orange-700 ring-1 ring-orange-200">
                          <QrCode className="h-3 w-3" /> Gateway bawaan siaga
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => void runProbe()}
                      disabled={probing}
                      className="press-effect mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-white text-xs font-extrabold text-orange-700 shadow-sm ring-1 ring-orange-200 hover:bg-orange-50 disabled:opacity-60"
                    >
                      {probing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Menguji koneksi…
                        </>
                      ) : (
                        <>
                          <PlugZap className="h-3.5 w-3.5" /> Uji Koneksi{" "}
                          {config.dana.enabled ? "DANA" : "Midtrans"}
                        </>
                      )}
                    </button>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
                      Uji resmi go-live: membuat transaksi QRIS uji Rp15.000 lalu langsung
                      dibatalkan — tanpa dana berpindah.
                    </p>
                    {verdict && (
                      <div
                        className={cn(
                          "mt-2.5 rounded-xl p-3 text-[11px] leading-relaxed",
                          verdict.ok
                            ? "bg-green-50 text-green-800 ring-1 ring-green-200"
                            : "bg-red-50 text-red-700 ring-1 ring-red-200"
                        )}
                      >
                        <p className="font-black">{verdict.ok ? "✓ " : "✕ "}{verdict.title}</p>
                        <p className="mt-0.5 opacity-90">{verdict.detail}</p>
                      </div>
                    )}
                  </section>

                  {/* ===== RINGKASAN DANA MASUK ===== */}
                  <section className="grid grid-cols-2 gap-2">
                    <div className="rounded-2xl bg-gradient-to-br from-green-600 to-green-500 p-3.5 text-white shadow-lg shadow-green-500/20">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-green-50">
                        <Wallet className="h-3 w-3" /> Dana Masuk QRIS
                      </div>
                      <p className="mt-1 text-lg font-black leading-tight">{rp(summary.totalMasuk)}</p>
                      <p className="mt-0.5 text-[10px] font-semibold text-green-100">
                        {summary.countLunas} transaksi lunas
                      </p>
                    </div>
                    <div className="rounded-2xl bg-orange-50 p-3.5 ring-1 ring-orange-100">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-500">
                        <CalendarDays className="h-3 w-3" /> Masuk Hari Ini
                      </div>
                      <p className="mt-1 text-lg font-black leading-tight text-neutral-800">
                        {rp(summary.masukHariIni)}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold text-neutral-400">
                        Rata-rata {rpCompact(summary.avgMasuk)} / transaksi
                      </p>
                    </div>
                    <div className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-100">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-600">
                        <Clock className="h-3 w-3" /> Menunggu Bayar
                      </div>
                      <p className="mt-0.5 text-base font-black text-neutral-800">
                        {summary.countMenunggu} transaksi
                      </p>
                    </div>
                    <div className="rounded-2xl bg-red-50 p-3 ring-1 ring-red-100">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-red-500">
                        <XCircle className="h-3 w-3" /> Batal / Kedaluwarsa
                      </div>
                      <p className="mt-0.5 text-base font-black text-neutral-800">
                        {summary.countGagal} transaksi
                      </p>
                    </div>
                  </section>

                  {/* ===== GRAFIK DANA MASUK 7 HARI ===== */}
                  <section className="rounded-2xl border border-neutral-100 p-3.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-400">
                        Dana Masuk 7 Hari Terakhir
                      </p>
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-black text-green-600">
                        Sukses {summary.successRate}%
                      </span>
                    </div>
                    <div className="mt-3 flex h-20 items-end gap-1.5">
                      {data.daily.map((d) => {
                        const h = d.amount > 0 ? Math.max((d.amount / dailyMax) * 100, 10) : 4;
                        return (
                          <div
                            key={d.date}
                            title={`${d.label}: ${rp(d.amount)} (${d.count} transaksi)`}
                            className="flex h-full min-w-0 flex-1 items-end"
                          >
                            <div
                              className={cn(
                                "w-full rounded-t-md transition-all",
                                d.amount > 0
                                  ? "bg-gradient-to-t from-green-500 to-green-400"
                                  : "bg-neutral-200"
                              )}
                              style={{ height: `${h}%` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      {data.daily.map((d) => (
                        <span
                          key={d.date}
                          className="min-w-0 flex-1 truncate text-center text-[8px] font-semibold text-neutral-400"
                        >
                          {d.label}
                        </span>
                      ))}
                    </div>
                  </section>

                  {/* ===== PENCARIAN + FILTER + EKSPOR ===== */}
                  <section className="space-y-2.5">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                        <Input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          className="border-orange-200 pl-9 focus-visible:ring-orange-400"
                          placeholder="Cari kode, pelanggan, ID transaksi…"
                          aria-label="Cari transaksi QRIS"
                        />
                      </div>
                      <button
                        onClick={exportCsv}
                        disabled={visibleTx.length === 0}
                        title="Ekspor hasil filter ke CSV"
                        aria-label="Ekspor CSV"
                        className="press-effect flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-600 text-white shadow-md shadow-green-500/25 hover:bg-green-700 disabled:opacity-50"
                      >
                        <Download className="h-4.5 w-4.5" />
                      </button>
                    </div>

                    {/* Filter status */}
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ["ALL", `Semua (${summary.countSemua})`],
                          ["PAID", `Lunas (${summary.countLunas})`],
                          ["PENDING", `Menunggu (${summary.countMenunggu})`],
                          ["FAILED", `Batal (${summary.countGagal})`],
                        ] as Array<["ALL" | TxState, string]>
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => setStatusFilter(key)}
                          className={cn(
                            "rounded-full px-3 py-1.5 text-[10px] font-black transition",
                            statusFilter === key
                              ? "bg-orange-600 text-white shadow-md shadow-orange-500/25"
                              : "bg-orange-50 text-orange-600 ring-1 ring-orange-100 hover:bg-orange-100"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Filter penyedia (hanya yang ada datanya) */}
                    {providersInData.length > 1 && (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => setProviderFilter("ALL")}
                          className={cn(
                            "rounded-full px-3 py-1.5 text-[10px] font-black transition",
                            providerFilter === "ALL"
                              ? "bg-neutral-800 text-white"
                              : "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200 hover:bg-neutral-200"
                          )}
                        >
                          Semua penyedia
                        </button>
                        {providersInData.map((p) => (
                          <button
                            key={p}
                            onClick={() => setProviderFilter(p)}
                            className={cn(
                              "rounded-full px-3 py-1.5 text-[10px] font-black transition",
                              providerFilter === p
                                ? "bg-neutral-800 text-white"
                                : "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200 hover:bg-neutral-200"
                            )}
                          >
                            {providerLabel(p === "none" ? null : p)}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* ===== DAFTAR TRANSAKSI ===== */}
                  <section className="space-y-2">
                    {visibleTx.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 p-6 text-center">
                        <p className="text-3xl">📲</p>
                        <p className="mt-2 text-xs font-semibold text-neutral-400">
                          {data.transactions.length === 0
                            ? "Belum ada transaksi QRIS — pesanan pelanggan dengan pembayaran QRIS akan tampil di sini."
                            : "Tidak ada transaksi yang cocok dengan filter/pencarian."}
                        </p>
                      </div>
                    ) : (
                      visibleTx.map((t) => {
                        const st = txState(t);
                        const meta = STATE_META[st];
                        const expanded = expandedId === t.id;
                        return (
                          <div
                            key={t.id}
                            className="overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm"
                          >
                            <button
                              onClick={() => setExpandedId(expanded ? null : t.id)}
                              aria-expanded={expanded}
                              className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-orange-50/50"
                            >
                              <span
                                className={cn(
                                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                                  st === "PAID"
                                    ? "bg-green-100 text-green-600"
                                    : st === "PENDING"
                                      ? "bg-amber-100 text-amber-600"
                                      : "bg-red-100 text-red-500"
                                )}
                              >
                                <QrCode className="h-5 w-5" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="text-sm font-black text-neutral-800">
                                    {rp(t.total)}
                                  </span>
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-black",
                                      meta.cls
                                    )}
                                  >
                                    <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                                    {meta.label}
                                  </span>
                                </span>
                                <span className="block truncate text-[11px] text-neutral-500">
                                  {t.customerName} • {t.code}
                                </span>
                                <span className="block truncate text-[10px] text-neutral-400">
                                  {trxDate(t.createdAt)}
                                  {t.paidAt ? ` — masuk ${trxDate(t.paidAt)}` : ""}
                                </span>
                              </span>
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 shrink-0 text-orange-300 transition-transform",
                                  expanded && "rotate-180"
                                )}
                              />
                            </button>

                            {expanded && (
                              <div className="border-t border-orange-50 bg-orange-50/30 px-3.5 py-3">
                                <dl className="space-y-1.5 text-[11px]">
                                  <div className="flex justify-between gap-3">
                                    <dt className="shrink-0 text-neutral-400">Tanggal transaksi</dt>
                                    <dd className="text-right font-bold text-neutral-700">
                                      {formatDateTime(t.createdAt)}
                                    </dd>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <dt className="shrink-0 text-neutral-400">Jumlah dana</dt>
                                    <dd className="text-right font-black text-neutral-800">{rp(t.total)}</dd>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <dt className="shrink-0 text-neutral-400">Status</dt>
                                    <dd className="text-right">
                                      <span
                                        className={cn(
                                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black",
                                          meta.cls
                                        )}
                                      >
                                        {meta.label}
                                        {st === "FAILED" && t.status === "CANCELLED" ? " / kedaluwarsa" : ""}
                                      </span>
                                    </dd>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <dt className="shrink-0 text-neutral-400">Penyedia</dt>
                                    <dd className="text-right font-bold text-neutral-700">
                                      {providerLabel(t.provider)}
                                      {t.qrisMode ? ` • ${t.qrisMode === "GATEWAY" ? "verifikasi otomatis" : "QR tampilan"}` : ""}
                                    </dd>
                                  </div>
                                  {t.paidAt && (
                                    <div className="flex justify-between gap-3">
                                      <dt className="shrink-0 text-neutral-400">Dana masuk</dt>
                                      <dd className="text-right font-bold text-green-700">
                                        {formatDateTime(t.paidAt)}
                                        {t.paidVia === "AUTO" ? " (otomatis sistem)" : ""}
                                      </dd>
                                    </div>
                                  )}
                                  <div className="flex justify-between gap-3">
                                    <dt className="shrink-0 text-neutral-400">Tipe / sumber</dt>
                                    <dd className="text-right font-bold text-neutral-700">
                                      {TYPE_LABEL[t.type] ?? t.type} • {t.source === "POS" ? "POS Kasir" : "Aplikasi"}
                                    </dd>
                                  </div>
                                  {t.qrisTrxId && (
                                    <div className="flex justify-between gap-3">
                                      <dt className="shrink-0 text-neutral-400">ID transaksi</dt>
                                      <dd className="break-all text-right font-mono text-[10px] text-neutral-500">
                                        {t.qrisTrxId}
                                      </dd>
                                    </div>
                                  )}
                                  {t.qrisExpiresAt && st === "PENDING" && (
                                    <div className="flex justify-between gap-3">
                                      <dt className="shrink-0 text-neutral-400">Kedaluwarsa QR</dt>
                                      <dd className="text-right font-bold text-neutral-700">
                                        {formatDateTime(t.qrisExpiresAt)}
                                      </dd>
                                    </div>
                                  )}
                                </dl>

                                {t.qrisFallbackReason && (
                                  <div className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-50 p-2.5 text-[10px] leading-relaxed text-amber-700 ring-1 ring-amber-200">
                                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <span>
                                      Catatan fallback: {t.qrisFallbackReason}
                                    </span>
                                  </div>
                                )}

                                {st === "PENDING" && (
                                  <button
                                    onClick={() => voidTransaction(t)}
                                    disabled={voidingId === t.id}
                                    className="press-effect mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-red-50 text-xs font-extrabold text-red-600 ring-1 ring-red-200 hover:bg-red-100 disabled:opacity-60"
                                  >
                                    {voidingId === t.id ? (
                                      <>
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Membatalkan…
                                      </>
                                    ) : (
                                      <>
                                        <Ban className="h-3.5 w-3.5" /> Batalkan Transaksi
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </section>

                  <p className="text-center text-[10px] leading-relaxed text-neutral-400">
                    Pelunasan QRIS hanya dilakukan SISTEM saat dana benar-benar masuk di
                    penyedia (webhook + polling) — data di halaman ini mengikuti sumber
                    kebenaran yang sama, diperbarui otomatis tiap 20 detik.
                  </p>
                </div>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
