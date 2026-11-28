"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  FlaskConical,
  Loader2,
  Printer,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Store,
  Timer,
  TriangleAlert,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { formatIDR } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/lib/hooks";
import {
  isChannelHidden,
  PAY_CHANNELS,
  PAY_GROUPS,
  type PayChannelSpec,
} from "@/lib/doku-pay";

/** Rincian biaya transparan di panel Total Pembayaran (opsional) */
export type QrisPayRincian = { label: string; value: number }[];

/** Pesanan yang akan dibayar lewat gateway (QRIS / E-Wallet) */
export type QrisPayOrder = {
  id: string;
  code: string;
  total: number;
  /** Metode digital: "QRIS" (semua kanal) | "EWALLET" (halaman DOKU
   *  difilter ke kanal e-wallet). Default "QRIS" bila tidak dikirim. */
  method?: "QRIS" | "EWALLET";
  /** Rincian biaya transparan (subtotal, diskon voucher, ongkir) */
  rincian?: QrisPayRincian;
};

type Phase = "scan" | "paid" | "cancelled";

type QrisInfo = {
  payload: string | null;
  imageUrl: string | null;
  /** Jalur DOKU Checkout: URL halaman pembayaran DOKU (status tetap dipantau) */
  paymentUrl: string | null;
  /** Checkout ganda DOKU: true = paymentUrl adalah halaman QRIS DOKU ASLI
   *  (kanal QRIS saja) — dirender sebagai kartu QR (iframe), bukan QR tautan */
  qrPage: boolean;
  /** URL halaman checkout "semua metode" (DOKU Wallet, VA, dll.) — tombol */
  webUrl: string | null;
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

/** Instruksi pembayaran kanal pilihan pelanggan (dari POST /pay-channel) */
type ChannelInstr = {
  channel: string;
  label: string;
  kind: "ewallet" | "retail" | "va" | "card";
  url: string | null;
  vaNumber: string | null;
  paymentCode: string | null;
  howToPayUrl: string | null;
  expiresAt: string | null;
  amount: number;
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

/** Tanggal+jam kedaluwarsa berbahasa Indonesia (respons DOKU) */
function tanggalID(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Layar pembayaran digital AGSI × DOKU — pelanggan maupun kasir memakai
 * layar yang sama.
 *
 * TIGA TAMPILAN (fase scan):
 *  1) METHODS — halaman "Metode Pembayaran" (accordion E-Wallet /
 *     Minimarket-QRIS / Virtual Account / Credit Card, kartu ber-radio,
 *     panel Total + tombol BAYAR menempel di bawah). Varian pelanggan saja.
 *  2) INSTRUCTION — instruksi per kanal setelah BAYAR: hero "Pesanan
 *     Berhasil Dibuat" + kartu navy batas waktu + nomor VA / kode bayar
 *     minimarket / tombol lanjutkan e-wallet / halaman kartu kredit.
 *  3) QR — layar kartu QR QRIS (kanal QRIS, POS, dan fallback non-DOKU).
 *
 * VERIFIKASI OTOMATIS di semua tampilan: status ke server dipolling tiap
 * beberapa detik; server bertanya ke DOKU "sudah masuk belum dananya?" dan
 * melunaskan pesanan begitu dana masuk. TIDAK ADA tombol "Saya Sudah Bayar"
 * — hanya sistem yang boleh melunaskan.
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
  const { qrisEnabled, ewalletEnabled, payVaEnabled, payCardEnabled } =
    useSettingsStore();

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
  /** ===== TAMPILAN AKTIF (fase scan) =====
   *  "methods" = halaman pilih metode (pelanggan, gateway DOKU siap);
   *  "qr"      = layar kartu QR QRIS (kanal QRIS / POS / fallback). */
  const [view, setView] = useState<"methods" | "qr">("qr");
  /** instruksi kanal aktif (null = belum BAYAR / kembali pilih metode) */
  const [instr, setInstr] = useState<ChannelInstr | null>(null);
  /** kanal terpilih di halaman metode (radio) */
  const [selected, setSelected] = useState<string | null>(null);
  /** BAYAR sedang diproses — cegah klik pembayaran berulang */
  const [creating, setCreating] = useState(false);
  /** grup accordion yang terbuka */
  const [openGroups, setOpenGroups] = useState<
    Record<string, boolean>
  >({ EWALLET: true, MINIMARKET: false, VA: false, CARD: false });
  /** umpan balik tombol salin */
  const [copied, setCopied] = useState<string | null>(null);
  /** ===== Halaman bayar DOKU DI DALAM APLIKASI (permintaan pemilik) =====
   *  URL yang dirender via iframe pada lapisan layar penuh DI DALAM
   *  aplikasi — TIDAK membuka tab/aplikasi lain. null = tertutup. */
  const [dokuUrl, setDokuUrl] = useState<string | null>(null);
  /** auto-buka cukup SEKALI per pesanan (pelanggan) — setelah pengguna
   *  kembali ke tampilan QR, jangan dipaksa buka halaman lagi. */
  const dokuAutoOpened = useRef(false);
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

  /** Gateway DOKU checkout siap → halaman pilih metode tersedia */
  const dokuMethods =
    !!info?.provider?.startsWith("doku") && info.mode === "GATEWAY";

  /** Hitung hitung-mundur dari batas TERKETAT: kedaluwarsa kode vs batas pesanan */
  const applyExpiry = useCallback(
    (expiresAtMs: number | null) => {
      const nowMs = Date.now();
      const gwSec = expiresAtMs
        ? Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000))
        : DURATION_SEC;
      const orderSec =
        orderDeadline !== null
          ? Math.max(0, Math.floor((orderDeadline - nowMs) / 1000))
          : DURATION_SEC;
      setSecondsLeft(Math.max(0, Math.min(DURATION_SEC, gwSec, orderSec)));
    },
    [orderDeadline]
  );

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
        qrPage: data.qrPage === true,
        webUrl: typeof data.webUrl === "string" ? data.webUrl : null,
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
      applyExpiry(expiresAt ? expiresAt.getTime() : null);
      // ===== Pulihkan instruksi kanal aktif (layar dibuka ulang dari Daftar
      // Pesanan — invoice kanal masih hidup di server) =====
      const meta = data.payMeta as Record<string, unknown> | null | undefined;
      if (
        typeof data.payChannel === "string" &&
        data.payChannel !== "QRIS" &&
        meta &&
        typeof meta.kind === "string" &&
        ["ewallet", "retail", "va", "card"].includes(meta.kind)
      ) {
        setInstr({
          channel: data.payChannel,
          label: typeof meta.label === "string" ? meta.label : data.payChannel,
          kind: meta.kind as ChannelInstr["kind"],
          url: typeof meta.url === "string" ? meta.url : null,
          vaNumber: typeof meta.vaNumber === "string" ? meta.vaNumber : null,
          paymentCode: typeof meta.paymentCode === "string" ? meta.paymentCode : null,
          howToPayUrl: typeof meta.howToPayUrl === "string" ? meta.howToPayUrl : null,
          expiresAt:
            typeof data.expiresAt === "string" ? (data.expiresAt as string) : null,
          amount: typeof data.amount === "number" ? data.amount : order.total,
        });
        if (variant === "customer") setView("methods");
      } else if (variant === "customer") {
        // Pelanggan mulai dari halaman PILIH METODE bila gateway DOKU siap;
        // POS & fallback non-DOKU tetap mulai dari layar kartu QR.
        if (
          typeof data.provider === "string" &&
          data.provider.startsWith("doku") &&
          data.mode === "GATEWAY"
        ) {
          setView("methods");
        }
      }
    } catch {
      if (seq !== fetchSeq.current) return; // respons kedaluwarsa — abaikan
      setLoadError("Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.");
    }
    // notifyPaid stabil ([]) — dependensi ini tidak berubah antar-render
    // parent, sehingga QR hanya diambil SEKALI per pesanan (bukan tiap detik).
  }, [order.id, order.total, notifyPaid, applyExpiry, variant]);

  useEffect(() => {
    void fetchPayload();
  }, [fetchPayload]);

  // Pelanggan (jalur QR lama): begitu tautan halaman bayar DOKU siap DAN
  // kartu QR berisi QR tautan (kanal QRIS akun tidak aktif), halaman itu
  // LANGSUNG terbuka di dalam aplikasi (iframe layar penuh). Checkout ganda
  // (kartu QR = halaman QRIS DOKU asli) TIDAK ditutupi halaman lain.
  useEffect(() => {
    if (variant !== "customer" || view !== "qr") return;
    if (info?.qrPage) return;
    if (!info?.paymentUrl || phase !== "scan") return;
    if (dokuAutoOpened.current) return;
    dokuAutoOpened.current = true;
    setDokuUrl(info.paymentUrl);
  }, [variant, view, info?.qrPage, info?.paymentUrl, phase]);

  // DOKU mengirim postMessage {func:"closeJokul"} ke jendela induk saat
  // pengguna menutup halaman bayarnya (tombol X di halaman DOKU). Tanggapi:
  // kembali ke tampilan sebelumnya — layar pembayaran TETAP terbuka dan
  // status tetap dipantau otomatis (pengguna tidak ke mana-mana).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { func?: unknown } | null | undefined;
      if (d && typeof d === "object" && d.func === "closeJokul") {
        setDokuUrl(null);
        setMonitorNote(
          "Halaman pembayaran DOKU ditutup — status pembayaran tetap dipantau otomatis."
        );
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

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
        description: "Silakan lanjutkan pembayaran sebelum waktu habis — pesanan belum terlunasi.",
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

  /** Salin nomor VA / kode bayar ke clipboard + umpan balik */
  const copyText = async (key: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
      toast({ title: `${label} disalin`, duration: 2500 });
    } catch {
      toast({
        variant: "destructive",
        title: "Gagal menyalin",
        description: "Salin manual: " + text,
        duration: 6000,
      });
    }
  };

  /** BAYAR — buat invoice DOKU untuk kanal terpilih (atau ke layar QR utk QRIS).
   *  Tombol mati sebelum metode dipilih; creating mencegah klik berulang. */
  const bayar = async () => {
    if (!selected || creating) return;
    const spec = PAY_CHANNELS.find((c) => c.key === selected);
    if (!spec) return;
    // Kanal QRIS = layar kartu QR ganda yang sudah ada (halaman QRIS DOKU
    // asli di iframe) — tidak perlu invoice satu-kanal baru.
    if (spec.kind === "qris") {
      setInstr(null);
      setView("qr");
      return;
    }
    setCreating(true);
    try {
      const res = await apiFetch(`/api/orders/${order.id}/pay-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: selected }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.paid === true) {
          setPhase("paid");
          notifyPaid();
          return;
        }
        if (data.cancelled === true) {
          setPhase("cancelled");
          return;
        }
        toast({
          variant: "destructive",
          title: "Pembayaran belum bisa dibuat",
          description:
            (typeof data.error === "string" && data.error) ||
            "Coba metode lain atau beberapa saat lagi.",
          duration: 7000,
        });
        return;
      }
      setInstr({
        channel: data.channel as string,
        label: (data.label as string) ?? selected,
        kind: data.kind as ChannelInstr["kind"],
        url: (data.url as string) ?? null,
        vaNumber: (data.vaNumber as string) ?? null,
        paymentCode: (data.paymentCode as string) ?? null,
        howToPayUrl: (data.howToPayUrl as string) ?? null,
        expiresAt: (data.expiresAt as string) ?? null,
        amount: (data.amount as number) ?? order.total,
      });
      applyExpiry(data.expiresAt ? new Date(data.expiresAt as string).getTime() : null);
      setMonitorNote(null);
    } catch {
      toast({
        variant: "destructive",
        title: "Tidak dapat menghubungi server",
        description: "Periksa koneksi internet lalu coba lagi.",
        duration: 6000,
      });
    } finally {
      setCreating(false);
    }
  };

  // ===== Pemantauan verifikasi otomatis (jalan di SEMUA tampilan scan) =====
  // hasInfo (boolean) sebagai dependensi — bukan objek info — agar interval
  // polling TIDAK dibongkar-pasang setiap data baru masuk.
  const hasInfo = info !== null;
  useEffect(() => {
    if (phase !== "scan" || (!hasInfo && !instr)) return;
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
  }, [phase, hasInfo, instr, order.id, notifyPaid]);

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

  // Kode bayar hangus saat halaman DOKU terbuka -> kembali ke tampilan di
  // bawahnya (di sana ada tombol "Buat Ulang Kode Bayar").
  useEffect(() => {
    if (dokuUrl && phase === "scan" && codeStale) setDokuUrl(null);
  }, [dokuUrl, phase, codeStale]);

  /** Saklar grup halaman metode — kanal disembunyikan sesuai pengaturan toko
   *  & dukungan DOKU ("hanya tampilkan metode yang tersedia pada merchant"). */
  const channelsOf = (group: string): PayChannelSpec[] =>
    PAY_CHANNELS.filter(
      (c) =>
        c.group === group &&
        !isChannelHidden(c, {
          qrisEnabled,
          ewalletEnabled,
          va: payVaEnabled,
          card: payCardEnabled,
        })
    );
  const showMethods = phase === "scan" && !instr && view === "methods";
  const showInstr = phase === "scan" && instr !== null;

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
        aria-label="Pembayaran Online (DOKU)"
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
                {showInstr ? (
                  <Wallet className="h-5 w-5" />
                ) : showMethods ? (
                  <CreditCard className="h-5 w-5" />
                ) : (
                  <ScanLine className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black tracking-wide">
                  {showInstr
                    ? "Instruksi Pembayaran"
                    : showMethods
                      ? "Metode Pembayaran"
                      : "Pembayaran Online (DOKU)"}
                </p>
                <p className="truncate text-[11px] font-semibold text-orange-100">
                  {showMethods && !instr
                    ? "Yuk pilih cara bayar yang kamu mau!"
                    : `${order.code} • ${isPos ? "Kasir" : "Aplikasi"}`}
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
          <div
            className={cn(
              "scrollbar-slim overflow-y-auto px-5 pt-4",
              showMethods ? "pb-4" : "pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            )}
          >
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
                  Pembayaran untuk pesanan <strong className="font-bold text-neutral-700">{order.code}</strong>{" "}
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
            ) : showInstr && instr ? (
              /* --------- INSTRUKSI PEMBAYARAN KANAL TERPILIH --------- */
              <div className="flex flex-col gap-3">
                {/* HERO — "Pesanan Berhasil Dibuat" (gradient orange + ikon jam) */}
                <div className="rounded-3xl bg-gradient-to-b from-orange-700 via-orange-600 to-orange-400 p-5 text-white shadow-lg shadow-orange-500/20">
                  <div className="flex items-center gap-4">
                    <motion.span
                      initial={prefersReduced ? false : { scale: 0.6, rotate: -12 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", stiffness: 260, damping: 16 }}
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-2 ring-white/30"
                    >
                      <Timer className="h-8 w-8" />
                    </motion.span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-orange-100">
                        Pesanan Berhasil Dibuat
                      </p>
                      <p className="truncate text-2xl font-black leading-tight">{formatIDR(instr.amount)}</p>
                      <p className="truncate text-[11px] font-semibold text-orange-100">
                        {order.code} • {instr.label}
                      </p>
                    </div>
                  </div>
                </div>

                {/* KARTU NAVY — "Selesaikan pembayaran sebelum" (kedaluwarsa DOKU) */}
                <div className="rounded-2xl bg-[#1E2A5A] p-4 text-white shadow-md">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 ring-1 ring-amber-300/40">
                      <Timer className="h-4.5 w-4.5 text-amber-300" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-blue-100">Selesaikan pembayaran sebelum</p>
                      <p className="text-sm font-black text-amber-300">
                        {tanggalID(instr.expiresAt) ?? "batas waktu pesanan (5 menit)"}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums",
                            codeStale
                              ? "bg-red-500/90 text-white"
                              : secondsLeft < 60
                                ? "bg-amber-400 text-amber-950"
                                : "bg-white/10 text-white"
                          )}
                        >
                          {codeStale ? "Waktu habis" : mmss(secondsLeft)}
                        </span>
                        <span className="text-[10px] font-semibold text-blue-100/80">
                          lewat batas → pesanan batal otomatis
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status dipantau otomatis — semua kanal lewat verifikasi sistem */}
                <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
                  <span className="relative mt-0.5 flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  <p className="text-[11px] font-bold leading-snug text-emerald-700">
                    Status dicek otomatis — pesanan lunas sendiri begitu dana masuk.
                  </p>
                </div>

                {monitorNote && (
                  <p className="rounded-xl bg-amber-50 p-2.5 text-[11px] font-semibold leading-snug text-amber-700 ring-1 ring-amber-200">
                    {monitorNote}
                  </p>
                )}

                {/* ===== KARTU INSTRUKSI PER JENIS KANAL ===== */}
                <div className="rounded-2xl border-2 border-neutral-200 bg-white p-4 shadow-sm">
                  {instr.kind === "va" ? (
                    <>
                      <p className="text-[11px] font-black uppercase tracking-wide text-neutral-400">
                        Virtual Account {instr.label}
                      </p>
                      {instr.vaNumber ? (
                        <>
                          <p className="mt-2 break-all text-xl font-black tabular-nums text-neutral-900">
                            {instr.vaNumber}
                          </p>
                          <button
                            onClick={() => void copyText("va", instr.vaNumber!, "Nomor VA")}
                            className="press-effect mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border-2 border-orange-200 bg-orange-50 text-xs font-extrabold text-orange-700 hover:bg-orange-100"
                          >
                            {copied === "va" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            {copied === "va" ? "Nomor VA Tersalin" : "Salin Nomor VA"}
                          </button>
                        </>
                      ) : instr.url ? (
                        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                          Nomor Virtual Account tampil di halaman pembayaran DOKU — buka lewat tombol di bawah.
                        </p>
                      ) : null}
                      <ol className="mt-3 space-y-1.5 text-[11px] font-semibold leading-snug text-neutral-500">
                        <li>1. Buka m-Banking / ATM / internet banking {instr.label}</li>
                        <li>2. Pilih menu Transfer → Virtual Account</li>
                        <li>3. Masukkan nomor VA di atas — nominal terisi otomatis</li>
                        <li>4. Konfirmasi &amp; selesaikan pembayaran</li>
                      </ol>
                      {instr.url && (
                        <button
                          onClick={() => setDokuUrl(instr.url)}
                          className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-xs font-extrabold text-white shadow-lg shadow-red-500/25 hover:bg-red-700"
                        >
                          <Wallet className="h-4 w-4" /> Buka Halaman Virtual Account (DOKU)
                        </button>
                      )}
                    </>
                  ) : instr.kind === "retail" ? (
                    <>
                      <p className="text-[11px] font-black uppercase tracking-wide text-neutral-400">
                        Kode Pembayaran {instr.label}
                      </p>
                      {instr.paymentCode ? (
                        <>
                          <p className="mt-2 text-2xl font-black tabular-nums tracking-[0.15em] text-neutral-900">
                            {instr.paymentCode}
                          </p>
                          <button
                            onClick={() => void copyText("code", instr.paymentCode!, "Kode pembayaran")}
                            className="press-effect mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border-2 border-orange-200 bg-orange-50 text-xs font-extrabold text-orange-700 hover:bg-orange-100"
                          >
                            {copied === "code" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            {copied === "code" ? "Kode Tersalin" : "Salin Kode"}
                          </button>
                        </>
                      ) : instr.url ? (
                        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                          Kode pembayaran tampil di halaman DOKU — buka lewat tombol di bawah.
                        </p>
                      ) : null}
                      <div className="mt-3 space-y-1 rounded-xl bg-neutral-50 p-2.5 text-[11px] font-semibold text-neutral-600">
                        <div className="flex justify-between">
                          <span>Total tagihan</span>
                          <span className="font-black tabular-nums">{formatIDR(instr.amount)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Batas waktu</span>
                          <span className="font-bold">{tanggalID(instr.expiresAt) ?? "5 menit"}</span>
                        </div>
                      </div>
                      <ol className="mt-3 space-y-1.5 text-[11px] font-semibold leading-snug text-neutral-500">
                        <li>1. Datang ke kasir {instr.label} terdekat</li>
                        <li>2. Tunjukkan / sebutkan kode pembayaran di atas</li>
                        <li>3. Bayar tunai sesuai nominal — terverifikasi otomatis</li>
                      </ol>
                      {instr.howToPayUrl ? (
                        <button
                          onClick={() => setDokuUrl(instr.howToPayUrl)}
                          className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-xs font-extrabold text-white shadow-lg shadow-red-500/25 hover:bg-red-700"
                        >
                          <Store className="h-4 w-4" /> Cara Bayar di {instr.label}
                        </button>
                      ) : instr.url ? (
                        <button
                          onClick={() => setDokuUrl(instr.url)}
                          className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-xs font-extrabold text-white shadow-lg shadow-red-500/25 hover:bg-red-700"
                        >
                          <Store className="h-4 w-4" /> Buka Halaman Kode Bayar (DOKU)
                        </button>
                      ) : null}
                    </>
                  ) : instr.kind === "card" ? (
                    <>
                      <p className="text-[11px] font-black uppercase tracking-wide text-neutral-400">
                        Kartu Kredit — {instr.label}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                        Pembayaran kartu diproses di <strong className="font-bold text-neutral-700">halaman aman DOKU</strong>{" "}
                        — data kartumu tidak pernah menyentuh server AGSI.
                      </p>
                      <div className="mt-3 space-y-1 rounded-xl bg-neutral-50 p-2.5 text-[11px] font-semibold text-neutral-600">
                        <div className="flex justify-between">
                          <span>Total dibayar</span>
                          <span className="font-black tabular-nums">{formatIDR(instr.amount)}</span>
                        </div>
                      </div>
                      {instr.url ? (
                        <button
                          onClick={() => setDokuUrl(instr.url)}
                          className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-xs font-extrabold text-white shadow-lg shadow-red-500/25 hover:bg-red-700"
                        >
                          <CreditCard className="h-4 w-4" /> Bayar dengan Kartu (aman di DOKU)
                        </button>
                      ) : null}
                    </>
                  ) : (
                    /* E-WALLET — tombol lanjutkan pembayaran */
                    <>
                      <p className="text-[11px] font-black uppercase tracking-wide text-neutral-400">{instr.label}</p>
                      <div className="mt-2 space-y-1 rounded-xl bg-neutral-50 p-2.5 text-[11px] font-semibold text-neutral-600">
                        <div className="flex justify-between">
                          <span>Total pembayaran</span>
                          <span className="font-black tabular-nums">{formatIDR(instr.amount)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Batas waktu</span>
                          <span className="font-bold">{tanggalID(instr.expiresAt) ?? "5 menit"}</span>
                        </div>
                      </div>
                      <ol className="mt-3 space-y-1.5 text-[11px] font-semibold leading-snug text-neutral-500">
                        <li>1. Tekan tombol “Lanjutkan Pembayaran” di bawah</li>
                        <li>2. Halaman DOKU membuka pembayaran {instr.label} di dalam aplikasi</li>
                        <li>3. Konfirmasi di aplikasi {instr.label} — status dicek otomatis</li>
                      </ol>
                      {instr.url ? (
                        <button
                          onClick={() => setDokuUrl(instr.url)}
                          className="press-effect mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-xs font-extrabold text-white shadow-lg shadow-red-500/25 hover:bg-red-700"
                        >
                          <Wallet className="h-4 w-4" /> Lanjutkan Pembayaran
                        </button>
                      ) : (
                        <p className="mt-3 rounded-xl bg-amber-50 p-2.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                          Tautan pembayaran tidak tersedia — tekan “Ganti Metode Pembayaran”.
                        </p>
                      )}
                    </>
                  )}
                </div>

                {/* Navigasi: ganti metode / kembali */}
                <div className="space-y-2">
                  <button
                    onClick={() => {
                      setInstr(null);
                      setSelected(null);
                    }}
                    className="press-effect w-full rounded-xl border-2 border-orange-200 bg-white py-3 text-sm font-extrabold text-orange-700 hover:bg-orange-50"
                  >
                    Ganti Metode Pembayaran
                  </button>
                  <button
                    onClick={requestClose}
                    className="press-effect w-full rounded-xl bg-neutral-100 py-3 text-sm font-extrabold text-neutral-600 hover:bg-neutral-200"
                  >
                    {isPos ? "Tutup Dulu" : "Kembali ke Beranda"}
                  </button>
                </div>
              </div>
            ) : showMethods ? (
              /* --------- HALAMAN METODE PEMBAYARAN (accordion + radio) --------- */
              <>
                {PAY_GROUPS.map((g) => {
                  const list = channelsOf(g.key);
                  if (list.length === 0) return null;
                  const open = !!openGroups[g.key];
                  return (
                    <div key={g.key} className="mb-3 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
                      <button
                        onClick={() => setOpenGroups((s) => ({ ...s, [g.key]: !open }))}
                        className="press-effect flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                        aria-expanded={open}
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-xl",
                            g.key === "EWALLET"
                              ? "bg-sky-50 text-sky-600"
                              : g.key === "MINIMARKET"
                                ? "bg-red-50 text-red-500"
                                : g.key === "VA"
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-orange-50 text-orange-600"
                          )}
                        >
                          {g.key === "EWALLET" ? (
                            <Smartphone className="h-4 w-4" />
                          ) : g.key === "MINIMARKET" ? (
                            <Store className="h-4 w-4" />
                          ) : g.key === "VA" ? (
                            <Wallet className="h-4 w-4" />
                          ) : (
                            <CreditCard className="h-4 w-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-black text-neutral-800">{g.title}</span>
                          <span className="block truncate text-[11px] font-semibold text-neutral-400">{g.hint}</span>
                        </span>
                        <ChevronDown
                          className={cn("h-4 w-4 shrink-0 text-neutral-400 transition-transform", open && "rotate-180")}
                        />
                      </button>
                      {open && (
                        <div className="space-y-2.5 border-t border-neutral-100 px-3 pb-3 pt-3">
                          {list.map((c) => {
                            const active = selected === c.key;
                            return (
                              <button
                                key={c.key}
                                onClick={() => setSelected(c.key)}
                                aria-pressed={active}
                                className={cn(
                                  "press-effect flex w-full items-center gap-3 rounded-[20px] border-2 bg-white px-3.5 py-3 text-left transition-all duration-200",
                                  active
                                    ? "border-orange-500 bg-orange-50 shadow-md shadow-orange-500/10"
                                    : "border-neutral-200 shadow-sm hover:border-orange-200"
                                )}
                              >
                                <span
                                  className={cn(
                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[9px] font-black uppercase leading-none",
                                    c.brand
                                  )}
                                >
                                  {c.brandText}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-extrabold text-neutral-800">{c.label}</span>
                                  <span className="block truncate text-[10px] font-semibold text-neutral-400">{c.sub}</span>
                                </span>
                                {/* Radio di kanan — terisi orange saat dipilih */}
                                <span
                                  className={cn(
                                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                                    active ? "border-orange-600 bg-orange-600" : "border-neutral-300 bg-white"
                                  )}
                                >
                                  {active && <Check className="h-3 w-3 text-white" />}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                <p className="mb-1 text-center text-[10px] leading-snug text-neutral-400">
                  Hanya metode yang tersedia di toko yang ditampilkan. Kanal yang
                  ditolak DOKU akan diberi tahu saat dipilih.
                </p>
              </>
            ) : (
              /* --------- PINDAI QR (kanal QRIS / POS / fallback) --------- */
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
                  ) : info?.paymentUrl && info.qrPage ? (
                    /* Checkout ganda DOKU: kartu QR = halaman QRIS DOKU ASLI
                       (kanal QRIS saja) — QR-nya QRIS EMVCo DOKU yang sebenarnya
                       (berisi NMID toko), dirender DOKU sendiri; pindai pakai
                       e-wallet/m-Banking. Tinggi 880px = QR penuh tanpa scroll
                       (ukuran halaman DOKU terukur: QR di y±625-855 @ lebar 390). */
                    <iframe
                      src={info.paymentUrl}
                      title={`QRIS DOKU ${order.code}`}
                      className="h-[880px] w-full rounded-xl border-0 bg-white"
                      allow="payment *; clipboard-write"
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
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
                    {info?.qrPage ? (
                      <>
                        <strong className="font-bold text-neutral-700">QR QRIS DOKU asli tampil di kartu di atas</strong>{" "}
                        — pindai pakai <strong className="font-bold text-neutral-700">GoPay, DANA, OVO, ShopeePay, LinkAja, atau m-Banking apa pun</strong>. Untuk DOKU Wallet, Virtual Account &amp; metode lain, tekan tombol di bawah.
                      </>
                    ) : (
                      <>
                        Tekan tombol di bawah — <strong className="font-bold text-neutral-700">halaman pembayaran DOKU terbuka langsung di dalam aplikasi ini</strong>{" "}
                        (tanpa pindah aplikasi/tab lain) — lalu pilih metode favoritmu:{" "}
                        <strong className="font-bold text-neutral-700">QRIS (GoPay, DANA, OVO, ShopeePay, LinkAja, m-Banking apa pun), DOKU Wallet, Virtual Account, &amp; kanal aktif lainnya</strong>. Kode QR di atas dipakai bila membayar dari HP lain.
                      </>
                    )}
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

                {/* Catatan kanal cadangan (jalur DOKU Checkout): kanal QRIS akun
                    belum aktif — halaman bayar memakai kanal aktif akun.
                    Jujur satu baris tanpa detail galat teknis. */}
                {info?.paymentUrl && info.fallbackReason && info.provider?.startsWith("doku") && (
                  <p className="mt-1.5 rounded-xl bg-amber-50 px-3 py-2 text-center text-[10px] font-semibold leading-snug text-amber-700 ring-1 ring-amber-200">
                    Beberapa kanal toko sedang tidak aktif — pilih salah satu
                    kanal pembayaran yang tersedia di halaman DOKU.
                  </p>
                )}

                {/* ===== KARTU STATUS VERIFIKASI OTOMATIS (khusus kasir/POS) ===== */}
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
                          pelanggan pilih metode di halaman DOKU: QRIS, DOKU Wallet,
                          DANA, OVO, ShopeePay, LinkAja, Virtual Account &amp; kanal
                          aktif lainnya; status dicek otomatis
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

                {/* ===== TRANSPARANSI FALLBACK ===== */}
                {isPos && info?.fallbackReason && info.mode === "GATEWAY" && (
                  info.provider?.startsWith("doku") ? (
                    <div className="mt-3.5 flex items-start gap-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-amber-700">
                          Kanal QRIS DOKU belum aktif — bayar via kanal aktif akun
                        </p>
                        <p className="mt-0.5 break-words text-[10px] leading-snug text-amber-700/85">
                          {info.fallbackReason} Pembayaran tetap terjadi di halaman DOKU dan
                          tetap terverifikasi otomatis — pesanan lunas sendiri begitu dana masuk.
                        </p>
                      </div>
                    </div>
                  ) : (
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
                  )
                )}

                {/* ===== TRANSPARANSI MODE LOKAL ===== */}
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

                {/* ===== SIMULATOR BAYAR (khusus Midtrans SANDBOX) ===== */}
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
                  <button
                    onClick={() => setDokuUrl(info.webUrl ?? info.paymentUrl)}
                    className="press-effect mt-4 flex h-12 w-full flex-col items-center justify-center rounded-xl bg-red-600 text-sm font-extrabold text-white shadow-lg shadow-red-500/30 hover:bg-red-700"
                  >
                    <span className="flex items-center gap-2">
                      <Wallet className="h-4 w-4" />
                      {info?.qrPage
                        ? "Semua Metode Lain (DOKU)"
                        : order.method === "EWALLET"
                          ? "Bayar dengan E-Wallet (DOKU)"
                          : "Bayar QRIS E-Wallet (DOKU)"}
                    </span>
                    <span className="text-[9px] font-bold tracking-wide text-red-100">
                      {info?.qrPage
                        ? "DOKU Wallet, Virtual Account, e-wallet & kanal aktif lain"
                        : "terbuka di dalam aplikasi — tanpa pindah halaman lain"}
                    </span>
                  </button>
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

          {/* ===== PANEL TOTAL PEMBAYARAN (menempel di bawah, tetap terlihat
              saat halaman digulir) — hanya di halaman pilih metode ===== */}
          {showMethods && (
            <div className="shrink-0 border-t border-neutral-100 bg-white/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
              {order.rincian && order.rincian.length > 0 ? (
                <details className="group mb-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] font-bold text-neutral-500">
                    <span>Rincian biaya</span>
                    <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-1.5 space-y-1 rounded-xl bg-neutral-50 p-2.5">
                    {order.rincian.map((r) => (
                      <div key={r.label} className="flex items-center justify-between text-[11px] font-semibold text-neutral-600">
                        <span>{r.label}</span>
                        <span className="tabular-nums">{formatIDR(r.value)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-neutral-200 pt-1.5 text-[11px] font-black text-neutral-800">
                      <span>Total</span>
                      <span className="tabular-nums">{formatIDR(order.total)}</span>
                    </div>
                  </div>
                </details>
              ) : null}
              <div className="flex items-center gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                    Total Pembayaran
                  </p>
                  <p className="text-xl font-black leading-tight text-orange-600">
                    {formatIDR(info?.payAmount ?? order.total)}
                  </p>
                </div>
                <button
                  onClick={() => void bayar()}
                  disabled={!selected || creating}
                  className={cn(
                    "press-effect ml-auto flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl text-sm font-black tracking-wide shadow-lg transition-all",
                    selected && !creating
                      ? "bg-orange-600 text-white shadow-orange-500/30 hover:bg-orange-700"
                      : "cursor-not-allowed bg-neutral-200 text-neutral-400 shadow-none"
                  )}
                >
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Memproses…
                    </>
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" /> BAYAR
                    </>
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-center text-[10px] leading-snug text-neutral-400">
                {!selected
                  ? "Pilih salah satu metode pembayaran dulu, ya."
                  : "Pembayaran diverifikasi otomatis — lunas sendiri begitu dana masuk."}
              </p>
            </div>
          )}
        </motion.div>

        {/* ===== HALAMAN PEMBAYARAN DOKU DI DALAM APLIKASI (permintaan pemilik:
            "buka halaman pembayaran DOKU tetap berada dalam satu aplikasi,
            jangan alihkan buka halaman lain") =====
            checkout.doku.com / halaman kanal dirender via iframe layar penuh
            DI ATAS sheet — pengguna membayar tanpa keluar dari aplikasi.
            Status tetap dipolling: begitu LUNAS, lapisan ini menutup sendiri
            dan layar sukses in-app mengambil alih. */}
        {dokuUrl && phase === "scan" && (
          <motion.div
            key="doku-inapp"
            initial={prefersReduced ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="fixed inset-0 z-[97] flex flex-col bg-white"
            role="dialog"
            aria-modal="true"
            aria-label="Halaman Pembayaran DOKU di dalam aplikasi"
          >
            {/* Kepala: kembali + kode pesanan + hitung mundur + status */}
            <header className="shrink-0 bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setDokuUrl(null)}
                  aria-label="Kembali"
                  className="press-effect flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
                >
                  <ArrowLeft className="h-4.5 w-4.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">
                    {instr ? `Pembayaran ${instr.label}` : order.method === "EWALLET" ? "Pembayaran E-Wallet" : "Pembayaran QRIS"}
                    {" • "}
                    <span className="text-orange-100">DOKU</span>
                  </p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    {order.code} • {formatIDR(info?.payAmount ?? order.total)} • di dalam aplikasi
                  </p>
                </div>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black tabular-nums ring-1",
                    codeStale
                      ? "bg-red-500/90 text-white ring-red-200"
                      : secondsLeft < 60
                        ? "bg-amber-400/90 text-amber-950 ring-amber-200"
                        : "bg-white/15 text-white ring-white/30"
                  )}
                >
                  <Timer className="h-3.5 w-3.5" />
                  {codeStale ? "Hangus" : mmss(secondsLeft)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 rounded-xl bg-white/10 px-2.5 py-1.5 ring-1 ring-white/20">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                </span>
                <p className="min-w-0 truncate text-[10px] font-bold text-white/90">
                  {monitorNote ?? "Status dicek otomatis — lunas sendiri begitu dana masuk"}
                </p>
              </div>
            </header>

            {/* Halaman bayar DOKU — dirender penuh di dalam aplikasi */}
            <div className="relative flex-1 bg-white">
              <iframe
                src={dokuUrl}
                title="Halaman Pembayaran DOKU"
                className="absolute inset-0 h-full w-full border-0"
                allow="payment *; clipboard-write"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>

            <p className="shrink-0 bg-neutral-50 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 text-center text-[10px] leading-snug text-neutral-400">
              Halaman pembayaran resmi DOKU (checkout.doku.com) ditampilkan di dalam aplikasi AGSI —
              tekan ← untuk kembali.
            </p>
          </motion.div>
        )}
      </motion.div>

      {/* penanda penutup agar struktur portal tetap utuh */}
    </AnimatePresence>,
    document.body
  );
}
