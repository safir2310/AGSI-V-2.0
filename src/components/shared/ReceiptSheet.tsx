"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Download, Printer, X } from "lucide-react";
import type { OrderData } from "@/lib/types";
import { STORE_ADDRESS, STORE_PHONE } from "@/lib/store-info";

/**
 * Sheet "Cetak Struk" (admin) — pratinjau struk gaya kertas termal lalu
 * mencetaknya lewat window.print(). HTML struk dipasang sebagai PORTAL
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
 *  Contoh: "AGSI-261106-A1B2" → "Struk-AGSI-261106-A1B2.html" */
function strukFileName(code: string): string {
  const safe = code
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `Struk-${safe || "Tanpa-Kode"}.html`;
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
  /** Nama file terakhir yang tersimpan — ditampilkan sbg umpan balik singkat */
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /** Cetak TANPA iframe — akses contentDocument iframe memicu SecurityError
      lintas-origin bila aplikasi dijalankan di dalam frame (lingkungan
      preview). Portal struk sudah menempel di <body>; aturan @media print
      di globals.css menyembunyikan seluruh aplikasi dan menampilkan struk
      saja di kertas.
      Judul dokumen diganti sementara menjadi kode struk agar opsi
      "Simpan sebagai PDF" di dialog print otomatis bernama kode struk. */
  const printReceipt = () => {
    if (!order) return;
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

  /** Simpan struk sebagai file HTML mandiri bernama KODE STRUK, contoh:
   *  "Struk-AGSI-261106-A1B2.html" (cek folder Unduhan). File berdiri
   *  sendiri: bisa dibuka & dicetak ulang kapan saja tanpa aplikasi. */
  const downloadReceipt = () => {
    if (!order || !d) return;
    const name = strukFileName(d.code);
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
                  title={`Simpan struk sebagai file bernama kode struk (${strukFileName(d.code)})`}
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
                  <span className="font-semibold">Simpan</span> mengunduh struk sebagai file
                  bernama kode struk (contoh: <span className="font-semibold">Struk-AGSI-261106-A1B2.html</span>).
                  <span className="font-semibold"> Cetak</span> membuka dialog print — pilih printer
                  thermal 58/80 mm; opsi "Simpan sebagai PDF" otomatis bernama kode struk.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

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
