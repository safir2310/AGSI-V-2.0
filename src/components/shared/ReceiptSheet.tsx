"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Download, Printer, X } from "lucide-react";
import { formatPickup, type OrderData } from "@/lib/types";
import { STORE_ADDRESS, STORE_PHONE } from "@/lib/store-info";
import { isAgsiApp, pesanPerluPembaruan } from "@/lib/app-release";
import {
  nativeSaveFile,
  nativeSaveSupported,
  nativeShareFile,
  nativeShareSupported,
  nativePrintPdf,
  nativePrintPdfSupported,
} from "@/lib/native-file";
import { buildStrukPdf } from "@/lib/struk-pdf";
import { useNoticeStore } from "@/lib/store";

/**
 * Sheet "Cetak Struk" (admin) — pratinjau struk gaya kertas termal.
 * v1.3.23: di aplikasi Android, Cetak/Simpan menulis file PDF struk ke
 * Unduhan/AGSI (buildStrukPdf — tanpa dialog cetak sistem); di browser,
 * Cetak tetap lewat window.print() — HTML struk dipasang sebagai PORTAL
 * langsung di <body> (bukan iframe — aman dari SecurityError lintas-origin
 * di lingkungan preview yang berjalan dalam frame); aturan @media print di
 * globals.css menyembunyikan seluruh aplikasi sehingga hanya struk yang
 * tercetak. Ukuran struk standar 58–80 mm.
 */

const MONO_STACK = "'Courier New', ui-monospace, SFMono-Regular, Menlo, monospace";

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Nominal tanpa awalan Rp — gaya struk: "20.000" */
function fmtRp(n: number): string {
  return n.toLocaleString("id-ID");
}

/** "06 Nov 2026 14.05" */
function fullDateTime(iso: string): string {
  const d = new Date(iso);
  const tgl = d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  const jam = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${tgl} ${jam}`;
}

/** Nama file simpanan struk dari KODE STRUK — karakter tidak aman dibersihkan.
 *  Contoh: "AGSI-261106-A1B2" → "Struk-AGSI-261106-A1B2.pdf" */
function strukFileName(code: string, ext: "html" | "pdf"): string {
  const safe = code
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `Struk-${safe || "Tanpa-Kode"}.${ext}`;
}

/** v1.3.27 — tangga ANTI-GAGAL untuk PDF struk (perbaikan "gagal cetak
 *  struk"): 1) simpan ke Unduhan/AGSI; 2) galat singkat → coba 1× lagi
 *  (galat jembatan bisa sementara); 3) tetap gagal → lembar BAGIKAN lewat
 *  cache aplikasi (bebas galat izin/MediaStore/SAF) — pemilik meneruskan ke
 *  WhatsApp / aplikasi printer / PDF. Timeout 3 menit tidak diulang —
 *  langsung ke lembar bagikan. "dibatalkan" diteruskan apa adanya (diam). */
async function saveStrukPdfWithFallback(
  pdf: string,
  name: string,
): Promise<{ ok: boolean; viaShare: boolean; message: string }> {
  let lastMsg = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2500));
    const saved = await nativeSaveFile(pdf, name, "application/pdf");
    if (saved.ok) return { ok: true, viaShare: false, message: saved.message };
    lastMsg = saved.message;
    if (saved.message === "dibatalkan") return { ok: false, viaShare: false, message: "dibatalkan" };
    if (saved.message.includes("Waktu tunggu")) break;
  }
  if (nativeShareSupported()) {
    const shared = await nativeShareFile(pdf, name, "application/pdf");
    if (shared.ok) return { ok: true, viaShare: true, message: shared.message };
    if (shared.message === "dibatalkan") return { ok: false, viaShare: false, message: "dibatalkan" };
    lastMsg = shared.message;
  }
  return { ok: false, viaShare: false, message: lastMsg };
}

type ReceiptData = ReturnType<typeof receiptData>;

/** Kumpulkan semua nilai struk dari pesanan (satu sumber utk pratinjau & cetak) */
function receiptData(o: OrderData) {
  const layanan =
    o.type === "DELIVERY" ? "Antar Pesanan" : o.type === "TAKEAWAY" ? "Bungkus" : "Di Tempat";
  const dest =
    o.type === "DELIVERY" ? o.address ?? null : o.tableNo ? `Meja ${o.tableNo}` : null;
  return {
    code: o.code,
    waktu: fullDateTime(o.createdAt),
    dibayar: o.paidAt ? fullDateTime(o.paidAt) : null,
    pelanggan: o.customerName,
    phone: o.phone ?? o.userPhone ?? null,
    layanan,
    dest,
    // JADWAL JAM PENGAMBILAN (Bungkus — permintaan pemilik): null = ambil sekarang
    pickup: formatPickup(o.pickupAt),
    note: o.note,
    items: o.items.map((it) => ({
      name: it.name,
      qty: it.qty,
      price: it.price,
      note: it.note,
      lineTotal: it.price * it.qty,
    })),
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    voucherCode: o.voucherCode,
    voucherDiscount: o.voucherDiscount,
    total: o.total,
    bayar: o.paymentMethod === "QRIS" ? "QRIS" : o.paymentMethod === "EWALLET" ? "E-Wallet" : "Tunai",
    lunas: o.paymentStatus === "PAID",
  };
}

/* ================== HTML STRUK (portal cetak, TANPA iframe) ================== */

/** Isi struk (tanpa <style>) — dipakai portal cetak & file simpanan */
function buildStrukBody(d: ReceiptData): string {
  const itemRows = d.items
    .map(
      (it) => `
        <tr>
          <td class="q">${it.qty}x</td>
          <td>${esc(it.name)}${it.note ? `<div class="note">&rsaquo; ${esc(it.note)}</div>` : ""}</td>
          <td class="pr">${fmtRp(it.lineTotal)}</td>
        </tr>`
    )
    .join("");

  const infoRow = (label: string, value: string) =>
    `<tr><td class="lbl">${label}</td><td class="val">${value}</td></tr>`;

  return `<div class="struk-print">
  <div class="c">
    <div class="title">AYAM GEPREK SAMBAL IJO</div>
    <div class="sub">${esc(STORE_ADDRESS)}</div>
    <div class="sub">HP ${esc(STORE_PHONE)}</div>
  </div>
  <hr />
  <table>
    ${infoRow("No. Pesanan", esc(d.code))}
    ${infoRow("Waktu", esc(d.waktu))}
    ${infoRow("Pelanggan", esc(d.pelanggan))}
    ${d.phone ? infoRow("No. HP", esc(d.phone)) : ""}
    ${infoRow("Layanan", esc(d.layanan))}
    ${d.dest ? infoRow(d.layanan === "Antar Pesanan" ? "Alamat" : "Detail", esc(d.dest)) : ""}
    ${d.pickup ? infoRow("Jadwal Ambil", esc(d.pickup)) : ""}
    ${d.dibayar ? infoRow("Dibayar", esc(d.dibayar)) : ""}
  </table>
  ${d.note ? `<div class="note">Catatan: ${esc(d.note)}</div>` : ""}
  <hr />
  <table>${itemRows}</table>
  <hr />
  <table>
    <tr><td>Subtotal</td><td class="pr">${fmtRp(d.subtotal)}</td></tr>
    ${d.deliveryFee > 0 ? `<tr><td>Ongkir</td><td class="pr">${fmtRp(d.deliveryFee)}</td></tr>` : ""}
    ${
      d.voucherDiscount > 0
        ? `<tr><td>Voucher ${esc(d.voucherCode ?? "")}</td><td class="pr">-${fmtRp(d.voucherDiscount)}</td></tr>`
        : ""
    }
    <tr class="tot"><td>TOTAL</td><td class="pr">Rp ${fmtRp(d.total)}</td></tr>
  </table>
  <hr />
  <table>
    ${infoRow("Bayar", esc(d.bayar))}
    ${infoRow("Status", d.lunas ? '<span class="paid">LUNAS</span>' : "BELUM BAYAR")}
  </table>
  <hr />
  <div class="c sub">
    Terima kasih atas pesanan Anda!<br />
    Selamat menikmati 🍗<br />
    Simpan struk ini sebagai bukti pembayaran.
  </div>
</div>`;
}

/** Gaya struk — selalu diawali ".struk-print" agar tidak bocor ke aplikasi */
const STRUK_CSS = `
  .struk-print { font-family: ${MONO_STACK}; font-size: 11px; line-height: 1.5; color: #000; background: #fff; width: 66mm; margin: 0 auto; }
  .struk-print .c { text-align: center; }
  .struk-print .title { font-size: 14px; font-weight: bold; letter-spacing: 0.5px; }
  .struk-print .sub { font-size: 10px; }
  .struk-print hr { border: none; border-top: 1px dashed #000; margin: 5px 0; }
  .struk-print table { width: 100%; border-collapse: collapse; }
  .struk-print td { vertical-align: top; padding: 1px 0; }
  .struk-print td.q { width: 24px; white-space: nowrap; }
  .struk-print td.pr { text-align: right; white-space: nowrap; }
  .struk-print td.lbl { width: 21mm; white-space: nowrap; color: #000; }
  .struk-print td.val { text-align: right; word-break: break-word; }
  .struk-print .tot { font-size: 14px; font-weight: bold; }
  .struk-print .note { font-style: italic; font-size: 10px; }
  .struk-print .paid { font-weight: bold; }
`;

/** HTML portal cetak (gaya + isi) */
function buildStrukHtml(d: ReceiptData): string {
  return `<style>${STRUK_CSS}</style>\n${buildStrukBody(d)}`;
}

/** File struk mandiri untuk disimpan — nama file & <title> memakai KODE STRUK
 *  sehingga file bisa dibuka & dicetak ulang kapan saja, dan bila dicetak
 *  lalu disimpan sebagai PDF, nama PDF-nya pun kode struk. */
function buildStrukFileHtml(d: ReceiptData): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Struk ${esc(d.code)}</title>
<style>${STRUK_CSS}
  body { background: #f5f5f4; margin: 0; padding: 20px 8px; }
  @media print {
    body { background: #fff; padding: 0; }
    @page { margin: 5mm; }
  }
</style>
</head>
<body>
${buildStrukBody(d)}
</body>
</html>`;
}

/* ================== KOMPONEN SHEET ================== */

/** Satu baris "label .... nilai" gaya struk */
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-neutral-500">{label}</span>
      <span
        className={
          bold
            ? "break-all text-right font-bold text-neutral-900"
            : "break-all text-right text-neutral-800"
        }
      >
        {value}
      </span>
    </div>
  );
}

/** Garis putus-putus pemisah gaya struk termal */
function Dash() {
  return <div className="my-2 border-t border-dashed border-neutral-400" />;
}

type ReceiptSheetProps = {
  open: boolean;
  onClose: () => void;
  order: OrderData | null;
};

export function ReceiptSheet({ open, onClose, order }: ReceiptSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  /** Nama file terakhir yang tersimpan — ditampilkan sbg umpan balik singkat */
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // v1.3.38 — popup konfirmasi nama file (v1.3.28) DIHAPUS (permintaan
  // pemilik): klik Simpan/Cetak kini LANGSUNG terunduh seperti di Chrome —
  // file ditulis ke Unduhan/AGSI + notifikasi unduhan di status bar.

  // Bersihkan timer umpan balik saat komponen dilepas
  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  /** Tutup dengan Escape */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** Cetak struk. v1.3.38 — di APLIKASI ANDROID: LANGSUNG dialog cetak
      SISTEM atas FILE PDF sungguhan (PrintManager + PdfPrintAdapter —
      thermal 58/80 mm, Bluetooth, atau "Simpan sebagai PDF") tanpa popup
      nama file; bila printer sistem gagal → tangga simpan anti-gagal
      v1.3.27 (simpan → coba lagi → lembar bagikan) dan penyimpanan diberi
      notifikasi unduhan di status bar (sisi native).
      Di browser: window.print() — portal struk menempel di <body>; aturan
      @media print menyembunyikan seluruh aplikasi dan menampilkan struk
      saja; judul dokumen diganti sementara menjadi kode struk agar opsi
      "Simpan sebagai PDF" otomatis bernama kode struk. */
  const printReceipt = () => {
    if (!order || !d) return;
    const name = strukFileName(d.code, "pdf");
    // v1.3.38 — CETAK via PRINTER SISTEM: LANGSUNG (tanpa popup), dialog
    // cetak sistem Android atas FILE PDF sungguhan (thermal 58/80 mm,
    // Bluetooth, atau "Simpan sebagai PDF"). APK lama tanpa printPdf
    // otomatis jatuh ke tangga simpan anti-gagal v1.3.27.
    if (nativeSaveSupported()) {
      void (async () => {
        if (nativePrintPdfSupported()) {
          const printed = await nativePrintPdf(buildStrukPdf(d), name);
          if (printed.ok) {
            showNotice({
              type: "success",
              autoCloseMs: 6500,
              title: "Dialog Cetak Terbuka ✓",
              message: `Struk ${name} dikirim ke printer sistem Android — pilih printer thermal 58/80 mm atau "Simpan sebagai PDF".`,
            });
            return;
          }
          // v1.3.37 — layanan cetak dinonaktifkan ROM (OPPO/realme/MIUI):
          // aplikasi SUDAH membuka halaman "Aktifkan" Print Spooler —
          // bimbing pengguna, JANGAN senyap dan jangan simpan (pengguna
          // akan kembali & menekan Cetak lagi setelah layanan aktif).
          if (printed.message.startsWith("LAYANAN_CETAK_NONAKTIF")) {
            showNotice({
              type: "info",
              autoCloseMs: 12000,
              title: "Aktifkan Layanan Cetak HP",
              message:
                "Dialog cetak tidak muncul karena layanan 'Print Spooler' Android dimatikan di HP ini. Halaman pengaturannya sudah dibuka: tekan 'Aktifkan', kembali ke AGSI, lalu tekan Cetak Struk lagi.",
            });
            return;
          }
          // v1.3.38 — kartu "Printer Sistem Gagal" DIHAPUS (laporan pemilik:
          // kartu itu selalu muncul di perangkat yang layanan cetaknya
          // dimatikan ROM, mis. OPPO/realme). Cetak gagal → jatuh SENYAP ke
          // simpan PDF: notifikasi unduhan tetap tampil di status bar.
        }
        await runStrukSaveFlow(name);
      })();
      return;
    }
    // Di aplikasi Android TANPA jembatan simpan (APK < 1.2.5): jangan diam.
    if (isAgsiApp()) {
      showNotice({
        type: "info",
        title: "Butuh Pembaruan Aplikasi",
        message: pesanPerluPembaruan("Cetak struk", "1.2.5"),
      });
      return;
    }
    try {
      const prevTitle = document.title;
      document.title = `Struk ${order.code}`;
      const restoreTitle = () => {
        document.title = prevTitle;
      };
      // afterprint = dialog print ditutup (untuk browser yang print() non-modal)
      window.addEventListener("afterprint", restoreTitle, { once: true });
      window.print();
      // print() bersifat modal di mayoritas browser — pulihkan judul setelah
      // kembali. Aman dipanggil dua kali (idempoten).
      restoreTitle();
    } catch {
      // sebagian webview memblokir print() — pengguna bisa pakai menu cetak browser
    }
  };

  /** Simpan struk sebagai file PDF bernama KODE STRUK, contoh:
   *  "Struk-AGSI-261106-A1B2.pdf" (cek folder Unduhan/AGSI). PDF bisa
   *  dibagikan (WhatsApp/email) atau dicetak ulang kapan saja. */
  const downloadReceipt = () => {
    if (!order || !d) return;
    // v1.3.38 — SIMPAN PDF LANGSUNG (permintaan pemilik): klik → langsung
    // ditulis ke folder Unduhan/AGSI lewat jembatan native + notifikasi
    // unduhan di status bar — tanpa popup nama file, seperti unduhan Chrome.
    if (nativeSaveSupported()) {
      void runStrukSaveFlow(strukFileName(d.code, "pdf"));
      return;
    }
    // Di aplikasi Android TANPA jembatan simpan (APK < 1.2.5): unduhan blob:
    // tidak pernah jalan di WebView — beri tahu pembaruan, jangan diam.
    if (isAgsiApp()) {
      showNotice({
        type: "info",
        title: "Butuh Pembaruan Aplikasi",
        message: pesanPerluPembaruan("Simpan struk", "1.2.5"),
      });
      return;
    }
    const name = strukFileName(d.code, "html");
    try {
      const blob = new Blob([buildStrukFileHtml(d)], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15_000);
    } catch {
      // Webview ketat bisa memblokir unduhan blob — pengguna tetap bisa
      // menyimpan lewat dialog print ("Simpan sebagai PDF", nama = kode struk).
    }
    // Umpan balik nama file yang tersimpan (muncul ±4 detik)
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSavedAs(name);
    savedTimer.current = setTimeout(() => setSavedAs(null), 4000);
  };

  /** Tangga anti-gagal v1.3.27 (simpan → coba lagi → lembar bagikan) —
   *  dipakai tombol Simpan maupun fallback Cetak saat printer sistem gagal. */
  const runStrukSaveFlow = async (name: string) => {
    if (!d) return;
    const res = await saveStrukPdfWithFallback(buildStrukPdf(d), name);
    if (!res.ok) return; // dibatalkan/gagal → tanpa umpan balik palsu
    if (res.viaShare) {
      showNotice({
        type: "success",
        autoCloseMs: 6000,
        title: "Struk Siap Dikirim ✓",
        message:
          "Lembar bagikan terbuka — pilih WhatsApp, PDF, atau aplikasi printer untuk mencetak struk.",
      });
    } else {
      showNotice({
        type: "success",
        autoCloseMs: 4200,
        title: "Struk PDF Tersimpan ✓",
        message: `File ${name} tersimpan di folder Unduhan/AGSI — notifikasi unduhan tampil di status bar.`,
      });
    }
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSavedAs(name);
    savedTimer.current = setTimeout(() => setSavedAs(null), 4000);
  };

  const d = order ? receiptData(order) : null;

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <>
    <AnimatePresence>
      {open && order && d && (
        <motion.div
          key="receipt-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[96] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Cetak struk"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { y: 48, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={prefersReduced ? undefined : { y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-orange-50 shadow-2xl sm:rounded-3xl"
          >
            {/* ===== KEPALA ===== */}
            <header className="flex shrink-0 items-center justify-between gap-2 bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 px-5 py-4 text-white">
              <div className="min-w-0">
                <p className="truncate text-sm font-black tracking-wide">Cetak Struk 🧾</p>
                <p className="truncate text-[11px] font-semibold text-orange-100">
                  {order.code} • {order.customerName}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Tutup"
                className="press-effect flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </header>

            {/* ===== PRATINJAU STRUK ===== */}
            <div className="scrollbar-slim flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div
                aria-label="Pratinjau struk"
                className="mx-auto w-full max-w-[290px] rounded-md bg-white px-4 py-4 font-mono text-[11px] leading-relaxed text-neutral-900 shadow-lg ring-1 ring-neutral-300"
              >
                <div className="text-center">
                  <p className="text-[13px] font-bold tracking-wide">AYAM GEPREK SAMBAL IJO</p>
                  <p className="mt-0.5 text-[10px] text-neutral-600">{STORE_ADDRESS}</p>
                  <p className="text-[10px] text-neutral-600">HP {STORE_PHONE}</p>
                </div>
                <Dash />
                <div className="space-y-0.5">
                  <Row label="No. Pesanan" value={d.code} bold />
                  <Row label="Waktu" value={d.waktu} />
                  <Row label="Pelanggan" value={d.pelanggan} />
                  {d.phone && <Row label="No. HP" value={d.phone} />}
                  <Row label="Layanan" value={d.layanan} />
                  {d.dest && (
                    <Row label={d.layanan === "Antar Pesanan" ? "Alamat" : "Detail"} value={d.dest} />
                  )}
                  {d.dibayar && <Row label="Dibayar" value={d.dibayar} />}
                </div>
                {d.note && (
                  <p className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-[10px] italic text-amber-700">
                    Catatan: {d.note}
                  </p>
                )}
                <Dash />
                <div className="space-y-0.5">
                  {d.items.map((it, i) => (
                    <div key={`${it.name}-${i}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          {it.qty}x {it.name}
                        </span>
                        <span className="shrink-0">{fmtRp(it.lineTotal)}</span>
                      </div>
                      {it.note && (
                        <p className="pl-4 text-[10px] italic text-neutral-500">
                          &rsaquo; {it.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <Dash />
                <div className="space-y-0.5">
                  <div className="flex justify-between gap-2">
                    <span>Subtotal</span>
                    <span>{fmtRp(d.subtotal)}</span>
                  </div>
                  {d.deliveryFee > 0 && (
                    <div className="flex justify-between gap-2">
                      <span>Ongkir</span>
                      <span>{fmtRp(d.deliveryFee)}</span>
                    </div>
                  )}
                  {d.voucherDiscount > 0 && (
                    <div className="flex justify-between gap-2">
                      <span>Voucher {d.voucherCode}</span>
                      <span>-{fmtRp(d.voucherDiscount)}</span>
                    </div>
                  )}
                  <div className="mt-1 flex justify-between gap-2 border-t border-neutral-300 pt-1 text-sm font-black">
                    <span>TOTAL</span>
                    <span>Rp {fmtRp(d.total)}</span>
                  </div>
                </div>
                <Dash />
                <div className="space-y-0.5">
                  <Row label="Bayar" value={d.bayar} />
                  <Row
                    label="Status"
                    value={d.lunas ? "LUNAS ✓" : "BELUM BAYAR"}
                    bold={d.lunas}
                  />
                </div>
                <Dash />
                <div className="text-center text-[10px] text-neutral-600">
                  <p>Terima kasih atas pesanan Anda!</p>
                  <p>Selamat menikmati 🍗</p>
                  <p className="mt-0.5">Simpan struk ini sebagai bukti pembayaran.</p>
                </div>
              </div>
            </div>

            {/* ===== TOMBOL ===== */}
            <div className="shrink-0 border-t border-orange-100 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="press-effect h-10 flex-1 rounded-xl border border-neutral-200 bg-white text-xs font-bold text-neutral-600 hover:bg-neutral-50"
                >
                  Tutup
                </button>
                <button
                  onClick={downloadReceipt}
                  title={`Simpan struk sebagai PDF bernama kode struk (${strukFileName(d.code, "pdf")})`}
                  className="press-effect flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-orange-300 bg-orange-50 text-xs font-bold text-orange-700 hover:bg-orange-100"
                >
                  <Download className="h-4 w-4" /> Simpan
                </button>
                <button
                  onClick={printReceipt}
                  className="press-effect flex h-10 flex-[1.6] items-center justify-center gap-1.5 rounded-xl bg-orange-600 text-xs font-black text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700"
                >
                  <Printer className="h-4 w-4" /> Cetak Struk
                </button>
              </div>
              {savedAs ? (
                <p className="mt-1.5 text-center text-[10px] font-semibold leading-relaxed text-emerald-600">
                  ✓ Struk tersimpan: {savedAs} — cek folder Unduhan Anda.
                </p>
              ) : (
                <p className="mt-1.5 text-center text-[10px] leading-relaxed text-neutral-400">
                  <span className="font-semibold">Simpan</span> menulis PDF struk (contoh:{" "}
                  <span className="font-semibold">Struk-AGSI-261106-A1B2.pdf</span>) ke folder{" "}
                  <span className="font-semibold">Unduhan/AGSI</span> dengan{" "}
                  <span className="font-semibold">notifikasi unduhan di status bar</span> — ketuk
                  kartunya untuk membuka file. <span className="font-semibold">Cetak</span> membuka
                  dialog printer sistem atas PDF: printer thermal 58/80 mm, Bluetooth, atau &quot;Simpan
                  sebagai PDF&quot;.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* v1.3.38 — popup konfirmasi nama file DIHAPUS: klik Simpan/Cetak
          langsung terunduh/cetak seperti unduhan di Chrome (file masuk
          Unduhan/AGSI + notifikasi unduhan di status bar, sisi native). */}

      {/* ===== PORTAL STRUK: menempel langsung di <body> — satu-satunya
          bagian yang tampil di kertas saat window.print() dipanggil.
          display:none di layar; stylesheet cetak yang memunculkannya. ===== */}
      {open && order && d
        ? createPortal(
            <div
              className="struk-print-portal"
              style={{ display: "none" }}
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: buildStrukHtml(d) }}
            />,
            document.body
          )
        : null}
    </>,
    document.body
  );
}
