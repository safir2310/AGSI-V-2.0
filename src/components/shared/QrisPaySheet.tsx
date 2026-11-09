"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  BadgeCheck,
  ExternalLink,
  FlaskConical,
  Loader2,
  Printer,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Timer,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { formatIDR } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Pesanan yang akan dibayar via QRIS */
export type QrisPayOrder = { id: string; code: string; total: number };

type Phase = "scan" | "paid" | "cancelled";

type QrisInfo = {
  payload: string | null;
  imageUrl: string | null;
  /** Jalur DOKU Checkout: URL halaman pembayaran DOKU (status tetap dipantau) */
  paymentUrl: string | null;
  mode: "GATEWAY" | "LOCAL";
  autoVerify: boolean;
  /** gateway QRIS bawaan (sandbox) aktif — tombol simulasi dana ditampilkan */
  sandbox: boolean;
  /** penyedia verifikasi: "casaku" | "midtrans" | "midtrans-sandbox" | "internal" | null */
  provider: string | null;
  /** Alasan penyedia utama (mis. Casaku/Midtrans) ditolak sehingga QR berasal dari fallback uji lokal */
  fallbackReason: string | null;
  /** Galat gateway saat mode LOCAL — ditampilkan jujur (kanal belum aktif, dll.) */
  gatewayError: string | null;
  /** Sandbox Midtrans: tautan simulator uji pembayaran (QR berisi URL uji) */
  sandboxSimulatorUrl: string | null;
  /** Nominal FINAL yang harus dibayar (total + kode unik Casaku bila aktif) */
  payAmount: number | null;
  /** Kode unik yang disematkan Casaku ke nominal (bila aktif) */
  uniqueCode: number | null;
};

/** Interval polling verifikasi otomatis */
const POLL_MS = 4000;
/** Batas waktu pembayaran QRIS — 5 MENIT sejak pesanan dibuat (permintaan
 *  pemilik). Lewat dari itu pesanan batal otomatis (server membatalkan
 *  saat sweep/poll) dan kode bayar hangus. */
const DURATION_SEC = 5 * 60; // 5 menit

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Layar pembayaran QRIS — pelanggan maupun kasir memakai layar yang sama.
 *
 * VERIFIKASI OTOMATIS: setelah QR tampil, layar ini memantau status ke server
 * tiap beberapa detik; server bertanya ke penyedia QRIS "sudah masuk belum
 * dananya?" dan melunaskan pesanan begitu dana masuk. TIDAK ADA tombol
 * "Saya Sudah Bayar" / "Uang Sudah Masuk" — kasir memang tidak boleh
 * (dan tidak bisa) melunaskan pesanan QRIS secara manual.
 */
export function QrisPaySheet({
  order,
  variant,
  onClose,
  onPaid,
  onPrintReceipt,
}: {
  order: QrisPayOrder;
  variant: "customer" | "pos";
  /** Dipanggil saat layar ditutup. result.paid memberi tahu apakah pembayaran
   *  SUDAH lunas saat ditutup (false = belum dibayar / sudah batal) —
   *  pemanggil TIDAK boleh menampilkan pesan sukses bila paid=false. */
  onClose: (result: { paid: boolean }) => void;
  /** dipanggil saat status pembayaran berubah menjadi lunas (mis. refresh daftar) */
  onPaid?: () => void | Promise<void>;
  /** POS: cetak struk setelah lunas (bila disediakan halaman pemanggil) */
  onPrintReceipt?: () => void | Promise<void>;
}) {
  const prefersReduced = useReducedMotion();
  const isPos = variant === "pos";

  const [info, setInfo] = useState<QrisInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("scan");
  const [secondsLeft, setSecondsLeft] = useState(DURATION_SEC);
  const [checkingNow, setCheckingNow] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  /** status terakhir dari penyedia (mis. "EXPIRED") */
  const [gatewayStatus, setGatewayStatus] = useState<string | null>(null);
  /** gangguan sementara saat memantau (diciutkan agar tidak bikin cemas) */
  const [monitorNote, setMonitorNote] = useState<string | null>(null);
  /** batas waktu pesanan (createdAt + 5 menit) dalam ms epoch */
  const [orderDeadline, setOrderDeadline] = useState<number | null>(null);
  const paidNotified = useRef(false);
  /** onPaid disimpan di ref: identitas prop baru dari re-render parent
   *  (mis. jam kasir yang berdetik tiap detik) TIDAK boleh memicu ulang
   *  efek fetch/polling di bawah — itulah penyebab layar QR berkedip. */
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  /** Stabil antar-render — aman dipakai sebagai dependensi efek */
  const notifyPaid = useCallback(() => {
    if (paidNotified.current) return;
    paidNotified.current = true;
    void onPaidRef.current?.();
  }, []);

  /** Penomoran permintaan: respons yang datang terlambat dari fetch lama
   *  tidak boleh menimpa data fetch terbaru (cegah QR "maju-mundur"). */
  const fetchSeq = useRef(0);
  /** Ambil kode QRIS dari server (gateway bila aktif, fallback lokal).
   *  soft=true → QR lama TETAP tampil selagi data baru diambil (kode
   *  langsung tertukar saat respons tiba) sehingga layar tak berkedip. */
  const fetchPayload = useCallback(async (soft = false) => {
    const seq = ++fetchSeq.current;
    setLoadError(null);
    setGatewayStatus(null);
    if (!soft) setInfo(null);
    try {
      const res = await apiFetch(`/api/orders/${order.id}/qris`, { cache: "no-store" });
      const data = await res.json();
      if (seq !== fetchSeq.current) return; // respons kedaluwarsa — abaikan
      if (!res.ok) {
        // Pesanan ternyata sudah lunas → langsung tampilkan sukses
        if (typeof data.error === "string" && data.error.toLowerCase().includes("lunas")) {
          setPhase("paid");
          notifyPaid();
          return;
        }
        // Pesanan dibatalkan otomatis (lewat batas 5 menit) → tampilan batal
        if (data.cancelled === true) {
          setPhase("cancelled");
          return;
        }
        setLoadError(data.error ?? "Gagal memuat kode QRIS.");
        return;
      }
      if (data.paid === true) {
        setPhase("paid");
        notifyPaid();
        return;
      }
      const expiresAt = data.expiresAt ? new Date(data.expiresAt as string) : null;
      const cancelMs = data.cancelAt ? new Date(data.cancelAt as string).getTime() : null;
      if (cancelMs) setOrderDeadline(cancelMs);
      setInfo({
        payload: (data.payload as string) ?? null,
        imageUrl: (data.imageUrl as string) ?? null,
        paymentUrl:
          typeof data.paymentUrl === "string" ? data.paymentUrl : null,
        mode: data.mode === "GATEWAY" ? "GATEWAY" : "LOCAL",
        autoVerify: !!data.autoVerify,
        sandbox: data.sandbox === true,
        provider: typeof data.provider === "string" ? data.provider : null,
        fallbackReason:
          typeof data.fallbackReason === "string" ? data.fallbackReason : null,
        gatewayError:
          typeof data.gatewayError === "string" ? data.gatewayError : null,
        sandboxSimulatorUrl:
          typeof data.sandboxSimulatorUrl === "string" ? data.sandboxSimulatorUrl : null,
        payAmount: typeof data.amount === "number" ? data.amount : null,
        uniqueCode: typeof data.uniqueCode === "number" ? data.uniqueCode : null,
      });
      // Hitung mundur pakai batas TERKETAT: umur kode gateway vs batas pesanan
      const nowMs = Date.now();
      const gatewaySec = expiresAt
        ? Math.max(0, Math.floor((expiresAt.getTime() - nowMs) / 1000))
        : DURATION_SEC;
      const orderSec = cancelMs
        ? Math.max(0, Math.floor((cancelMs - nowMs) / 1000))
        : DURATION_SEC;
      setSecondsLeft(Math.max(0, Math.min(DURATION_SEC, gatewaySec, orderSec)));
    } catch {
      if (seq !== fetchSeq.current) return; // respons kedaluwarsa — abaikan
      setLoadError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    }
    // notifyPaid stabil ([]) — dependensi ini tidak berubah antar-render
    // parent, sehingga QR hanya diambil SEKALI per pesanan (bukan tiap detik).
  }, [order.id, notifyPaid]);

  useEffect(() => {
    void fetchPayload();
  }, [fetchPayload]);

  // Hitung waktu mundur (hanya saat fase scan)
  useEffect(() => {
    if (phase !== "scan") return;
    const t = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  /** Tutup layar pembayaran + notifikasi sesuai hasil pembayaran terakhir
   *  (permintaan pemilik):
   *  - belum lunas  -> "Pembayaran belum berhasil — silakan lanjutkan
   *                    pembayaran" (merah, agar kasir/pelanggan tak bingung)
   *  - sudah lunas  -> "Pembayaran berhasil — pesanan Anda sedang diproses"
   *  - sudah batal  -> cukup tutup (layar batal sudah menjelaskan) */
  const requestClose = useCallback(() => {
    if (phase === "paid") {
      toast({
        title: "Pembayaran berhasil",
        description: `Pesanan ${order.code} ${formatIDR(order.total)} sudah terkonfirmasi — pesanan Anda sedang diproses.`,
        duration: 7000,
      });
    } else if (phase === "scan") {
      toast({
        variant: "destructive",
        title: "Pembayaran belum berhasil",
        description: "Silakan lanjutkan pembayaran QRIS sebelum waktu habis — pesanan belum terlunasi.",
        duration: 7000,
      });
    }
    onClose({ paid: phase === "paid" });
  }, [phase, order.code, order.total, onClose]);

  // Tutup dengan tombol Escape (lewat requestClose: notifikasi status ikut tampil)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // ===== Pemantauan verifikasi otomatis =====
  // hasInfo (boolean) sebagai dependensi — bukan objek info — agar interval
  // polling TIDAK dibongkar-pasang setiap data baru masuk.
  const hasInfo = info !== null;
  useEffect(() => {
    if (phase !== "scan" || !hasInfo) return;
    let alive = true;
    const poll = async (force = false) => {
      try {
        const res = await apiFetch(
          `/api/orders/${order.id}/qris/status${force ? "?force=1" : ""}`,
          { cache: "no-store" }
        );
        if (!res.ok || !alive) return;
        const data = await res.json();
        if (data.paymentStatus === "PAID") {
          setPhase("paid");
          notifyPaid();
          return;
        }
        // Pesanan batal otomatis (lewat batas 5 menit / dana telat)
        if (data.cancelled === true || data.status === "CANCELLED") {
          setMonitorNote((data.notice as string) ?? null);
          setPhase("cancelled");
          return;
        }
        if (data.cancelAt) setOrderDeadline(new Date(data.cancelAt as string).getTime());
        setGatewayStatus((data.gatewayStatus as string) ?? null);
        setMonitorNote((data.gatewayError as string) ?? null);
      } catch {
        // koneksi tersendat — coba lagi pada tick berikutnya
      }
    };
    void poll();
    const t = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [phase, hasInfo, order.id, notifyPaid]);

  /** POS: paksa sistem memeriksa penyedia sekarang (tetap otomatis, bukan menandai lunas) */
  const checkNow = async () => {
    if (checkingNow) return;
    setCheckingNow(true);
    try {
      const res = await apiFetch(`/api/orders/${order.id}/qris/status?force=1`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data.paymentStatus === "PAID") {
        setPhase("paid");
        notifyPaid();
      }
    } catch {
      /* abaikan — polling reguler akan menyusul */
    } finally {
      setCheckingNow(false);
    }
  };

  /** Buat ulang kode bayar (transaksi lama kedaluwarsa) — soft: QR lama
   *  tetap tampil sampai kode baru siap, tanpa kedipan spinner. */
  const regenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    await fetchPayload(true);
    setRegenerating(false);
  };

  const expired = secondsLeft <= 0;
  const codeStale = expired || gatewayStatus === "EXPIRED";
  const autoVerify = info?.autoVerify ?? false;
  /** Batas pesanan (5 menit) sudah terlewat — pesanan mati, jangan tawarkan buat ulang kode */
  const pastDeadline = orderDeadline !== null && Date.now() >= orderDeadline;

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="qris-overlay"
        initial={prefersReduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={prefersReduced ? undefined : { opacity: 0 }}
        className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Pembayaran QRIS"
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
                <ScanLine className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black tracking-wide">Pembayaran QRIS</p>
                <p className="truncate text-[11px] font-semibold text-orange-100">
                  {order.code} • {isPos ? "Kasir" : "Aplikasi"}
                </p>
              </div>
              <button
                onClick={requestClose}
                aria-label="Tutup"
                className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
          </header>

          {/* ===== ISI ===== */}
          <div className="scrollbar-slim overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
            {phase === "paid" ? (
              /* --------- BERHASIL (verifikasi otomatis) --------- */
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <motion.span
                  initial={prefersReduced ? false : { scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 ring-4 ring-emerald-100"
                >
                  <BadgeCheck className="h-11 w-11 text-emerald-600" />
                </motion.span>
                <h2 className="text-lg font-black text-neutral-900">Pembayaran Diterima! 🎉</h2>
                <p className="max-w-[300px] text-xs leading-relaxed text-neutral-500">
                  {formatIDR(order.total)} untuk pesanan {order.code} sudah lunas —
                  terverifikasi <strong className="font-bold text-emerald-600">otomatis oleh sistem</strong>{" "}
                  saat dana masuk. Geprekmu segera dimasak ya!
                </p>
                {isPos && onPrintReceipt ? (
                  <div className="mt-2 flex w-full items-center gap-2">
                    <button
                      onClick={requestClose}
                      className="press-effect h-11 flex-1 rounded-xl border border-neutral-200 bg-white text-sm font-extrabold text-neutral-600 hover:bg-neutral-50"
                    >
                      Selesai
                    </button>
                    <button
                      onClick={() => void onPrintReceipt()}
                      className="press-effect flex h-11 flex-[1.6] items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700"
                    >
                      <Printer className="h-4 w-4" /> Cetak Struk
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={requestClose}
                    className="press-effect mt-2 w-full rounded-xl bg-orange-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700"
                  >
                    Selesai
                  </button>
                )}
              </div>
            ) : phase === "cancelled" ? (
              /* --------- DIBATALKAN OTOMATIS (belum bayar 5 menit) --------- */
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <motion.span
                  initial={prefersReduced ? false : { scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  className="flex h-20 w-20 items-center justify-center rounded-full bg-red-50 ring-4 ring-red-100"
                >
                  <XCircle className="h-11 w-11 text-red-500" />
                </motion.span>
                <h2 className="text-lg font-black text-neutral-900">Pesanan Dibatalkan Otomatis</h2>
                <p className="max-w-[320px] text-xs leading-relaxed text-neutral-500">
                  Pembayaran QRIS untuk pesanan <strong className="font-bold text-neutral-700">{order.code}</strong>{" "}
                  tidak diterima dalam <strong className="font-bold text-red-500">5 menit</strong>, jadi
                  pesanan dibatalkan. Voucher yang terpakai sudah dikembalikan ke akunmu.
                </p>
                {monitorNote && (
                  <p className="max-w-[320px] rounded-xl bg-amber-50 p-2.5 text-[11px] font-semibold leading-snug text-amber-700 ring-1 ring-amber-200">
                    {monitorNote}
                  </p>
                )}
                <p className="text-[11px] text-neutral-400">
                  Masih pengin? Buat pesanan baru — dapur selalu siap menggeprek 😊
                </p>
                <button
                  onClick={() => onClose({ paid: false })}
                  className="press-effect mt-2 w-full rounded-xl bg-orange-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700"
                >
                  Tutup
                </button>
              </div>
            ) : (
              /* --------- PINDAI QR --------- */
              <>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                      Total Bayar
                    </p>
                    {/* Nominal FINAL (total + kode unik Casaku bila aktif) —
                        pelanggan wajib membayar nominal ini PERSIS agar
                        verifikasi otomatis mencocokkan dananya. */}
                    <p className="text-2xl font-black text-orange-600">
                      {formatIDR(info?.payAmount ?? order.total)}
                    </p>
                    {info?.uniqueCode != null && info.uniqueCode > 0 ? (
                      <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-bold leading-snug text-amber-700 ring-1 ring-amber-200">
                        Termasuk kode unik {formatIDR(info.uniqueCode)} — bayar PERSIS
                        nominal di atas ({formatIDR(order.total)} + {formatIDR(info.uniqueCode)})
                        agar pembayaran terdeteksi otomatis.
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black tabular-nums ring-1",
                      codeStale
                        ? "bg-red-50 text-red-600 ring-red-200"
                        : secondsLeft < 60
                          ? "bg-amber-50 text-amber-700 ring-amber-200"
                          : "bg-orange-50 text-orange-700 ring-orange-200"
                    )}
                  >
                    <Timer className="h-3.5 w-3.5" />
                    {codeStale && autoVerify ? "Kode Hangus" : expired ? "Lewat waktu" : mmss(secondsLeft)}
                  </span>
                </div>

                {/* Kartu QR */}
                <div className="mt-3.5 flex flex-col items-center rounded-2xl border-2 border-orange-200 bg-white p-4 shadow-inner">
                  {loadError ? (
                    <div className="flex min-h-[216px] w-[216px] flex-col items-center justify-center gap-2 text-center">
                      <p className="text-xs font-semibold leading-relaxed text-red-500">{loadError}</p>
                      <button
                        onClick={() => void fetchPayload()}
                        className="press-effect rounded-full bg-orange-600 px-4 py-2 text-[11px] font-extrabold text-white hover:bg-orange-700"
                      >
                        Coba Lagi
                      </button>
                    </div>
                  ) : info?.paymentUrl ? (
                    /* Jalur DOKU Checkout — QR berisi TAUTAN halaman bayar DOKU:
                       dipindai kamera HP untuk membuka halaman pembayaran. */
                    <motion.div
                      initial={prefersReduced ? false : { opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center"
                    >
                      <QRCodeSVG
                        value={info.paymentUrl}
                        size={208}
                        level="M"
                        marginSize={1}
                        bgColor="#FFFFFF"
                        fgColor="#1C1917"
                        title={`Pembayaran DOKU ${order.code}`}
                      />
                      <span className="mt-2.5 flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-[10px] font-black tracking-[0.2em] text-white">
                        DOKU
                      </span>
                    </motion.div>
                  ) : info?.imageUrl ? (
                    <img
                      src={info.imageUrl}
                      alt={`Kode QRIS pesanan ${order.code}`}
                      className="h-[208px] w-[208px] object-contain"
                    />
                  ) : info?.payload ? (
                    <motion.div
                      initial={prefersReduced ? false : { opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center"
                    >
                      <QRCodeSVG
                        value={info.payload}
                        size={208}
                        level="M"
                        marginSize={1}
                        bgColor="#FFFFFF"
                        fgColor="#1C1917"
                        title={`QRIS ${order.code}`}
                      />
                      <span className="mt-2.5 flex items-center gap-1.5 rounded-full bg-neutral-900 px-3 py-1 text-[10px] font-black tracking-[0.2em] text-white">
                        QRIS
                      </span>
                    </motion.div>
                  ) : (
                    <div className="flex min-h-[216px] w-[216px] items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                    </div>
                  )}
                </div>

                <p className="mt-3 text-center text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                  AYAM GEPREK SAMBAL IJO
                </p>
                {info?.paymentUrl ? (
                  <p className="mt-1 text-center text-[11px] leading-relaxed text-neutral-500">
                    Pindai kode di atas dengan kamera HP untuk membuka{" "}
                    <strong className="font-bold text-neutral-700">halaman pembayaran DOKU</strong>, lalu
                    pilih QRIS / e-wallet / Virtual Account yang tersedia dan selesaikan pembayaran.
                  </p>
                ) : (
                  <p className="mt-1 text-center text-[11px] leading-relaxed text-neutral-500">
                    Buka aplikasi{" "}
                    <strong className="font-bold text-neutral-700">
                      GoPay, OVO, DANA, ShopeePay, atau m-Banking
                    </strong>{" "}
                    apa pun, lalu pindai kode di atas. Nominal sudah terisi otomatis.
                  </p>
                )}

                {/* ===== KARTU STATUS VERIFIKASI OTOMATIS (khusus kasir/POS) =====
                    Detail teknis pemantauan TIDAK ditampilkan ke pelanggan —
                    pelanggan cukup melihat QR + penjelasan singkat satu baris
                    di bawah tombol Tutup Dulu. */}
                {isPos && autoVerify && (
                  <div className="mt-3.5 flex items-start gap-2.5 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
                    <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-black text-emerald-700">
                        Verifikasi Otomatis Aktif
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-emerald-700/80">
                        Sistem memeriksa penyedia QRIS setiap beberapa detik. Pesanan lunas
                        sendiri begitu dana masuk — tanpa konfirmasi kasir. Layar ini
                        memperbarui otomatis.
                      </p>
                      {monitorNote && (
                        <p className="mt-1 text-[10px] leading-snug text-amber-600">
                          Catatan: {monitorNote}
                        </p>
                      )}
                      {info?.provider === "casaku" ? (
                        <p className="mt-1 text-[10px] font-bold text-emerald-600">
                          Penyedia: Casaku — dana masuk langsung ke rekening toko
                        </p>
                      ) : info?.provider?.startsWith("doku") ? (
                        <p className="mt-1 text-[10px] font-bold text-emerald-600">
                          Penyedia: DOKU ({info.provider === "doku" ? "Produksi" : "Sandbox"}) —{" "}
                          {info.paymentUrl
                            ? "selesaikan pembayaran di halaman DOKU (kanal aktif akun DOKU); status dicek otomatis"
                            : "scan pakai DANA / GoPay / OVO / ShopeePay / m-Banking mana pun"}
                        </p>
                      ) : info?.provider?.startsWith("dana") ? (
                        <p className="mt-1 text-[10px] font-bold text-emerald-600">
                          Penyedia: DANA ({info.provider === "dana" ? "Produksi" : "Sandbox"}) —
                          dana masuk langsung ke saldo DANA toko
                        </p>
                      ) : info?.provider?.startsWith("midtrans") ? (
                        <p className="mt-1 text-[10px] font-bold text-emerald-600">
                          Penyedia: Midtrans ({info.provider === "midtrans" ? "Produksi" : "Sandbox"})
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}

                {/* ===== TRANSPARANSI FALLBACK — QR uji lokal karena penyedia ditolak =====
                    Bila penyedia nyata (Casaku/Midtrans) menolak/mati, QR yang
                    tampil berasal dari gateway bawaan (uji lokal). Alasan
                    teknis HANYA untuk kasir/POS — pelanggan tidak perlu tahu
                    detail galat penyedia pembayaran. */}
                {isPos && info?.fallbackReason && info.mode === "GATEWAY" && (
                  <div className="mt-3.5 flex items-start gap-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-black text-amber-700">
                        QR uji lokal — penyedia QRIS belum terhubung dari server ini
                      </p>
                      <p className="mt-0.5 break-words text-[10px] leading-snug text-amber-700/85">
                        Alasan: {info.fallbackReason} — Admin dapat mengetes koneksi penyedia
                        lewat <strong className="font-bold">Pengaturan Toko ▸ Gateway QRIS</strong>.
                      </p>
                    </div>
                  </div>
                )}

                {/* ===== TRANSPARANSI MODE LOKAL — verifikasi otomatis BELUM berjalan =====
                    Tanpa gateway aktif (Midtrans ditolak & fallback nonaktif —
                    mis. mode produksi), QR statis toko ditampilkan TANPA
                    pelunasan otomatis. Harus dijelaskan jujur: pesanan tidak
                    akan lunas sendiri sampai penyedia terhubung. */}
                {info && info.mode === "LOCAL" && !autoVerify && (
                  <div className="mt-3.5 flex items-start gap-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-black text-amber-700">
                        Verifikasi otomatis belum berjalan
                      </p>
                      <p className="mt-0.5 break-words text-[10px] leading-snug text-amber-700/85">
                        Gateway QRIS belum terhubung{info.gatewayError ? ` — ${info.gatewayError}` : ""}.
                        Pesanan belum bisa lunas sendiri — hubungi kasir/staff untuk bantuan,
                        atau coba lagi nanti setelah penyedia pembayaran aktif.
                      </p>
                    </div>
                  </div>
                )}

                {/* ===== SIMULATOR BAYAR (khusus Midtrans SANDBOX) =====
                    QR uji Midtrans sandbox berisi tautan ke simulator resmi
                    Midtrans — dompet digital sungguhan belum bisa membayar.
                    Tautan ini meniru pelanggan membayar; setelah simulator
                    menyatakan sukses, polling status otomatis melunaskan
                    pesanan lewat jalur verifikasi yang sama dengan produksi.
                    Hilang sendiri saat MIDTRANS_IS_PRODUCTION=true. */}
                {!isPos && info?.sandboxSimulatorUrl && info.mode === "GATEWAY" && !codeStale && (
                  <div className="mt-3.5 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/70 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100 ring-1 ring-amber-300">
                        <FlaskConical className="h-3.5 w-3.5 text-amber-600" />
                      </span>
                      <p className="text-[11px] font-black uppercase tracking-wide text-amber-700">
                        Mode Uji — Midtrans Sandbox
                      </p>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-amber-700/90">
                      QR uji belum terhubung ke dompet digital sungguhan. Buka
                      simulator pembayaran Midtrans untuk meniru pelanggan
                      membayar — pesanan tetap dilunasi otomatis oleh sistem.
                    </p>
                    <a
                      href={info.sandboxSimulatorUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="press-effect mt-2.5 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-xs font-extrabold text-white shadow-md shadow-amber-500/30 hover:bg-amber-600"
                    >
                      <FlaskConical className="h-4 w-4" /> Buka Simulator Bayar
                    </a>
                  </div>
                )}

                {/* Kode kedaluwarsa di gateway (pesanan masih hidup) -> buat ulang */}
                {codeStale && autoVerify && !pastDeadline && (
                  <button
                    onClick={() => void regenerate()}
                    disabled={regenerating}
                    className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700 disabled:opacity-60"
                  >
                    {regenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Membuat ulang…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4" /> Buat Ulang Kode Bayar
                      </>
                    )}
                  </button>
                )}
                {expired && !autoVerify && !pastDeadline && (
                  <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-center text-[11px] font-semibold leading-snug text-amber-700 ring-1 ring-amber-200">
                    Waktu pembayaran ideal sudah lewat. Kamu masih bisa membayar —
                    kode tetap berlaku.
                  </p>
                )}

                {/* Tombol sesuai varian */}
                {info?.paymentUrl && (
                  <a
                    href={info.paymentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="press-effect mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-extrabold text-white shadow-lg shadow-red-500/30 hover:bg-red-700"
                  >
                    <ExternalLink className="h-4 w-4" /> Buka Halaman Pembayaran DOKU
                  </a>
                )}
                {isPos ? (
                  <div className="mt-4 space-y-2">
                    <button
                      onClick={() => void checkNow()}
                      disabled={checkingNow || !info}
                      className="press-effect flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-orange-200 bg-white text-sm font-extrabold text-orange-700 hover:bg-orange-50 disabled:opacity-60"
                    >
                      {checkingNow ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Memeriksa…
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-4 w-4" /> Periksa Pembayaran Sekarang
                        </>
                      )}
                    </button>
                    <p className="text-center text-[10px] leading-snug text-neutral-400">
                      Minta pelanggan memindai QR di layar ini. Kasir{" "}
                      <strong className="font-bold text-neutral-500">tidak dapat menandai lunas</strong>{" "}
                      — pesanan lunas otomatis saat dana masuk.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    <button
                      onClick={requestClose}
                      className="press-effect w-full rounded-xl bg-neutral-100 py-3 text-sm font-extrabold text-neutral-600 hover:bg-neutral-200"
                    >
                      Tutup Dulu
                    </button>
                    <p className="text-center text-[10px] leading-snug text-neutral-400">
                      {autoVerify
                        ? "Pembayaran diverifikasi otomatis — begitu dana masuk, status"
                        : "Gateway QRIS belum terhubung — verifikasi otomatis belum"}
                      {autoVerify
                        ? " pesananmu ikut lunas tanpa perlu konfirmasi siapa pun."
                        : " bisa berjalan. Pesanan menunggu aktivasi penyedia pembayaran."}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
