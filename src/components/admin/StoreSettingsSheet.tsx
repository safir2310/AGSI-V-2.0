"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bike,
  Loader2,
  QrCode,
  RefreshCw,
  Store,
  TriangleAlert,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import { refreshSettings, useSettingsStore } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export type StoreSettingsSheetProps = {
  open: boolean;
  onClose: () => void;
};

/** Hasil probe GET /api/qris-gateway/health (auth) & POST (charge uji) */
type HealthProbe = {
  ok: boolean;
  verdict: string;
  title: string;
  detail: string;
  httpStatus?: number;
};
type HealthInfo = {
  config: {
    midtrans: {
      enabled: boolean;
      production: boolean;
      serverKeyLength: number;
      serverKeyPrefixOk: boolean;
      clientKeyPresent: boolean;
    };
    internal: { sandboxEnabled: boolean };
    external: { url: string | null };
  };
  activeProvider: string;
  probe: HealthProbe | null;
};

/**
 * Sheet "Pengaturan Toko" (khusus Admin/Owner) — saklar AKTIF/NONAKTIF untuk:
 *  1. Antar pesanan (DELIVERY)   → hilang dari keranjang pelanggan & POS
 *  2. Pembayaran QRIS            → hilang dari pilihan bayar pelanggan & POS
 * Perubahan tersimpan langsung ke server (PUT /api/settings) dan juga ditolak
 * server-side saat checkout, bukan hanya disembunyikan di UI.
 */
export function StoreSettingsSheet({ open, onClose }: StoreSettingsSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const deliveryEnabled = useSettingsStore((s) => s.deliveryEnabled);
  const qrisEnabled = useSettingsStore((s) => s.qrisEnabled);

  const [loading, setLoading] = useState(false);
  /** id saklar yang sedang dikirim ke server (tampilkan spinner di barisnya) */
  const [savingKey, setSavingKey] = useState<"delivery" | "qris" | null>(null);

  // ===== Status Gateway QRIS & Midtrans (admin) =====
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [chargeResult, setChargeResult] = useState<HealthProbe | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await apiFetch("/api/qris-gateway/health");
      if (res.ok) setHealth((await res.json()) as HealthInfo);
    } catch {
      // panel status biarkan kosong bila gagal — bukan galat kritis
    }
  }, []);

  /** POST health — buat + batalkan satu transaksi QRIS uji Rp15.000 di Midtrans */
  const runChargeTest = async () => {
    if (testing) return;
    setTesting(true);
    setChargeResult(null);
    try {
      const res = await apiFetch("/api/qris-gateway/health", { method: "POST" });
      const body = (await res.json()) as HealthProbe & { error?: string };
      setChargeResult(
        res.ok || body.verdict
          ? body
          : { ok: false, verdict: "GALAT", title: "Gagal mengetes", detail: body.error ?? "Coba lagi sebentar." }
      );
      void fetchHealth(); // segarkan juga chip status auth
    } catch {
      setChargeResult({
        ok: false,
        verdict: "GALAT",
        title: "Koneksi bermasalah",
        detail: "Tidak dapat menghubungi server.",
      });
    } finally {
      setTesting(false);
    }
  };

  // Buka sheet → segarkan nilai terbaru dari server
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      await refreshSettings();
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRef = useRef(fetchSettings);
  useEffect(() => {
    fetchRef.current = fetchSettings;
  });
  useEffect(() => {
    if (open) {
      void fetchRef.current();
      void fetchHealth();
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

  /** Simpan satu saklar — optimis, dibalikkan bila server menolak */
  const save = async (key: "delivery" | "qris", next: boolean) => {
    if (savingKey) return;
    const field = key === "delivery" ? "deliveryEnabled" : "qrisEnabled";
    const prev = key === "delivery" ? deliveryEnabled : qrisEnabled;
    if (prev === next) return;

    setSavingKey(key);
    // Update optimis — UI langsung berubah
    useSettingsStore.setState(field === "deliveryEnabled" ? { deliveryEnabled: next } : { qrisEnabled: next });
    try {
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        // Kembalikan saklar bila gagal
        useSettingsStore.setState(field === "deliveryEnabled" ? { deliveryEnabled: prev } : { qrisEnabled: prev });
        showNotice({ type: "error", title: "Gagal Menyimpan", message: body.error ?? "Coba lagi sebentar ya." });
        return;
      }
      showNotice({
        type: "success",
        autoCloseMs: 3200,
        title: next ? "Layanan Diaktifkan ✓" : "Layanan Dinonaktifkan",
        message:
          key === "delivery"
            ? next
              ? "Pelanggan kembali bisa memilih \"Antar ke Alamat\" saat checkout."
              : "Opsi antar pesanan disembunyikan dari pelanggan & POS. Pesanan antar baru otomatis ditolak."
            : next
              ? "Pelanggan kembali bisa membayar dengan QRIS."
              : "Opsi pembayaran QRIS disembunyikan dari pelanggan & POS. Pembayaran QRIS baru otomatis ditolak.",
      });
    } catch {
      useSettingsStore.setState(field === "deliveryEnabled" ? { deliveryEnabled: prev } : { qrisEnabled: prev });
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server." });
    } finally {
      setSavingKey(null);
    }
  };

  /** Nonaktifkan selalu dikonfirmasi dulu (menghentikan layanan itu tadi) */
  const requestToggle = (key: "delivery" | "qris", next: boolean) => {
    const label = key === "delivery" ? "Antar Pesanan" : "Pembayaran QRIS";
    if (next) {
      void save(key, true);
      return;
    }
    showNotice({
      type: "confirm",
      title: `Nonaktifkan ${label}?`,
      message:
        key === "delivery"
          ? "Pelanggan tidak akan bisa memilih \"Antar ke Alamat\" sampai layanan diaktifkan lagi. Pesanan antar baru otomatis ditolak."
          : "Pelanggan tidak akan bisa membayar dengan QRIS sampai diaktifkan lagi. Pembayaran QRIS baru otomatis ditolak.",
      actions: [
        { label: "Batal" },
        { label: "Ya, Nonaktifkan", variant: "destructive", onClick: () => void save(key, false) },
      ],
    });
  };

  const rows = [
    {
      key: "delivery" as const,
      icon: Bike,
      title: "Antar Pesanan",
      desc: "Pelanggan bisa memilih \"Antar ke Alamat\" dengan ongkir Rp 1.000/km (area Kec. Pidie 24151).",
      active: deliveryEnabled,
      onBadge: "🛵 Antar aktif",
      offBadge: "Antar nonaktif",
    },
    {
      key: "qris" as const,
      icon: QrCode,
      title: "Pembayaran QRIS",
      desc: "Pelanggan & kasir bisa membayar lewat QRIS (terverifikasi otomatis saat dana masuk).",
      active: qrisEnabled,
      onBadge: "📱 QRIS aktif",
      offBadge: "QRIS nonaktif",
    },
  ];

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="store-settings-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pengaturan Toko"
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
                  <Store className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Pengaturan Toko</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Aktifkan / nonaktifkan layanan
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
              {loading ? (
                <div className="flex min-h-[180px] items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-orange-400" />
                </div>
              ) : (
                <>
                  {rows.map((row) => (
                    <div
                      key={row.key}
                      className={cn(
                        "mb-3 rounded-2xl border p-4 transition-colors",
                        row.active
                          ? "border-orange-200 bg-orange-50/60"
                          : "border-neutral-200 bg-neutral-50"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                            row.active ? "bg-orange-600 text-white" : "bg-neutral-200 text-neutral-400"
                          )}
                        >
                          <row.icon className="h-5.5 w-5.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-neutral-800">{row.title}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">
                            {row.desc}
                          </p>
                          <span
                            className={cn(
                              "mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide",
                              row.active
                                ? "bg-green-100 text-green-700"
                                : "bg-neutral-200 text-neutral-500"
                            )}
                          >
                            {row.active ? row.onBadge : row.offBadge}
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
                          {savingKey === row.key ? (
                            <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                          ) : (
                            <Switch
                              checked={row.active}
                              onCheckedChange={(v) => requestToggle(row.key, v)}
                              disabled={!!savingKey}
                              aria-label={`${row.active ? "Nonaktifkan" : "Aktifkan"} ${row.title}`}
                              className="h-6 w-11 data-[state=checked]:bg-orange-600 data-[state=unchecked]:bg-neutral-300"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* ===== GATEWAY QRIS & MIDTRANS — status koneksi nyata ===== */}
                  <div className="mb-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-white">
                        <QrCode className="h-5.5 w-5.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-neutral-800">Gateway QRIS & Midtrans</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500">
                          QRIS nyata via Midtrans (GoPay/OVO/DANA/ShopeePay) — bila Midtrans
                          menolak, QR uji gateway bawaan dipakai otomatis.
                        </p>
                        {health && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide",
                                health.config.midtrans.enabled
                                  ? health.config.midtrans.production
                                    ? "bg-green-100 text-green-700"
                                    : "bg-sky-100 text-sky-700"
                                  : "bg-neutral-200 text-neutral-500"
                              )}
                            >
                              {health.config.midtrans.enabled
                                ? health.config.midtrans.production
                                  ? "💰 Midtrans Produksi"
                                  : "🧪 Midtrans Sandbox"
                                : "Midtrans nonaktif"}
                            </span>
                            {health.config.midtrans.enabled && health.probe && (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide",
                                  health.probe.ok
                                    ? "bg-green-100 text-green-700"
                                    : "bg-red-100 text-red-600"
                                )}
                              >
                                {health.probe.ok ? "🔑 Kunci valid" : "🔑 Kunci ditolak"}
                              </span>
                            )}
                            {health.config.internal.sandboxEnabled && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-700">
                                🧪 Gateway bawaan siap
                              </span>
                            )}
                          </div>
                        )}
                        {health?.probe && !health.probe.ok && (
                          <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[10px] font-semibold leading-snug text-red-600 ring-1 ring-red-100">
                            {health.probe.title} — {health.probe.detail}
                          </p>
                        )}
                        {health?.config.midtrans.enabled && (
                          <>
                            <button
                              onClick={() => void runChargeTest()}
                              disabled={testing}
                              className="press-effect mt-2.5 flex h-9 items-center justify-center gap-2 rounded-xl bg-neutral-800 px-4 text-[11px] font-extrabold text-white shadow-sm hover:bg-neutral-700 disabled:opacity-60"
                            >
                              {testing ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Menguji ke Midtrans…
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="h-3.5 w-3.5" /> Tes Koneksi Midtrans
                                </>
                              )}
                            </button>
                            <p className="mt-1 text-[10px] leading-snug text-neutral-400">
                              Membuat lalu langsung membatalkan 1 transaksi uji Rp15.000 — tanpa dana berpindah.
                            </p>
                            {chargeResult && (
                              <div
                                className={cn(
                                  "mt-2 rounded-xl p-3 ring-1",
                                  chargeResult.ok
                                    ? "bg-green-50 ring-green-200"
                                    : "bg-amber-50 ring-amber-200"
                                )}
                              >
                                <p
                                  className={cn(
                                    "text-[11px] font-black",
                                    chargeResult.ok ? "text-green-700" : "text-amber-700"
                                  )}
                                >
                                  {chargeResult.title}
                                </p>
                                <p className="mt-0.5 text-[10px] leading-snug text-neutral-600">
                                  {chargeResult.detail}
                                </p>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-[11px] font-semibold leading-relaxed text-amber-800 ring-1 ring-amber-200">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Selain disembunyikan dari aplikasi, pesanan yang melanggar saklar ini juga
                      <strong> ditolak langsung oleh server</strong> — jadi tidak bisa dilewati
                      lewat cara apa pun. Pesanan yang sudah dibuat sebelumnya tetap berjalan
                      normal.
                    </span>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
