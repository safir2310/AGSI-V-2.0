"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Download,
  Image as ImageIcon,
  Loader2,
  Palette,
  RefreshCw,
  Share2,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import { nativeSaveFile, nativeSaveSupported } from "@/lib/native-file";
import { formatIDR, formatVoucherValue, type Product, type VoucherInfo } from "@/lib/types";
import { STORE_HOURS, STORE_PHONE } from "@/lib/store-info";
import { cn } from "@/lib/utils";

/**
 * GENERATOR POSTER & BANNER (khusus Admin/Owner) — Profil ▸ "Generator Poster & Banner".
 *
 * Bikin poster promosi, banner, & spanduk restoran secara OTOMATIS:
 *  - Sumber konten nyata: menu populer dari database + voucher aktif —
 *    tombol "Isi Otomatis" menyusun konten promosi siap pakai.
 *  - 4 jenis kanvas: Poster Feed IG (1:1), Story/Reels (9:16), Banner
 *    landscape (16:9), Spanduk digital (2:1).
 *  - Bisa disesuaikan: judul, subjudul, item promo (3), harga, badge,
 *    footer kontak, pilihan tema warna, dan latar pola sambal.
 *  - Hasil = PNG resolusi tinggi via <canvas> — diunduh (bridge native di
 *    aplikasi Android) atau dibagikan (Web Share API bila tersedia).
 */

/* ================= TIPE & KONSTAN ================= */

type PosterKind = "feed" | "story" | "banner" | "spanduk";

const KINDS: Array<{ id: PosterKind; label: string; desc: string; w: number; h: number }> = [
  { id: "feed", label: "Poster IG", desc: "Feed 1:1", w: 1080, h: 1080 },
  { id: "story", label: "Story/Reels", desc: "9:16", w: 1080, h: 1920 },
  { id: "banner", label: "Banner", desc: "Landscape 16:9", w: 1920, h: 1080 },
  { id: "spanduk", label: "Spanduk", desc: "Digital 2:1", w: 2000, h: 1000 },
];

type Theme = "api" | "merah" | "hijau" | "gelap";

const THEMES: Record<Theme, { label: string; bgA: string; bgB: string; accent: string; accent2: string; text: string; sub: string }> = {
  api: { label: "Sambal Ijo 🌶️", bgA: "#7C2D12", bgB: "#F97316", accent: "#FDE047", accent2: "#FFFFFF", text: "#FFFFFF", sub: "#FFEDD5" },
  merah: { label: "Pedas Merah 🔥", bgA: "#7F1D1D", bgB: "#EF4444", accent: "#FDE047", accent2: "#FFFFFF", text: "#FFFFFF", sub: "#FEE2E2" },
  hijau: { label: "Ijo Segar 🌿", bgA: "#14532D", bgB: "#22C55E", accent: "#FEF08A", accent2: "#FFFFFF", text: "#FFFFFF", sub: "#DCFCE7" },
  gelap: { label: "Premium Gelap 🖤", bgA: "#111827", bgB: "#374151", accent: "#F59E0B", accent2: "#FCD34D", text: "#F9FAFB", sub: "#D1D5DB" },
};

type PromoItem = { emoji: string; name: string; price: number; strike?: number };

type PosterState = {
  kind: PosterKind;
  theme: Theme;
  badge: string;
  title: string;
  subtitle: string;
  items: PromoItem[];
  footer: string;
  showVoucher: boolean;
  voucherCode: string;
  voucherText: string;
};

/* ================= HELPERS ================= */

/** Bungkus teks canvas ke beberapa baris berdasarkan lebar maksimum */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !cur) {
      cur = test;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Gambar poster ke canvas sesuai state — dipanggil saat preview & unduh */
function drawPoster(canvas: HTMLCanvasElement, s: PosterState): void {
  const kind = KINDS.find((k) => k.id === s.kind) ?? KINDS[0];
  const t = THEMES[s.theme];
  const W = kind.w;
  const H = kind.h;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const isWide = W > H; // banner & spanduk — layout horizontal
  const u = W / 1080; // satuan skala relatif

  // ===== LATAR: gradien diagonal hangat + pola bulatan sambal =====
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, t.bgA);
  grad.addColorStop(1, t.bgB);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Pola bulatan transparan (tekstur sambal/serbuk) — deterministik, tanpa random
  ctx.save();
  ctx.globalAlpha = 0.07;
  const seeds = [0.618, 0.382, 0.236, 0.854, 0.146, 0.764, 0.528, 0.472, 0.294, 0.706];
  for (let i = 0; i < seeds.length; i++) {
    const cx = seeds[i] * W;
    const cy = seeds[(i + 3) % seeds.length] * H;
    const r = (60 + seeds[(i + 5) % seeds.length] * 120) * u;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? "#FFFFFF" : t.accent;
    ctx.fill();
  }
  ctx.restore();

  // ===== Susun blok konten =====
  if (isWide) {
    // --- Layout horizontal (banner/spanduk): teks kiri, panel item kanan ---
    const pad = 72 * u;
    const leftW = W * 0.52 - pad;

    // Badge
    ctx.font = `900 ${34 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const badgeW = ctx.measureText(s.badge).width + 48 * u;
    ctx.fillStyle = t.accent;
    roundRect(ctx, pad, pad, badgeW, 62 * u, 31 * u);
    ctx.fill();
    ctx.fillStyle = "#1C1917";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(s.badge, pad + badgeW / 2, pad + 32 * u);

    // Judul besar (3 baris maks)
    ctx.textAlign = "left";
    ctx.fillStyle = t.text;
    ctx.font = `900 ${86 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const titleLines = wrapText(ctx, s.title, leftW, 3);
    let ty = pad + 140 * u;
    for (const line of titleLines) {
      ctx.fillText(line, pad, ty);
      ty += 96 * u;
    }

    // Subjudul
    ctx.fillStyle = t.sub;
    ctx.font = `600 ${36 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const subLines = wrapText(ctx, s.subtitle, leftW, 2);
    ty += 8 * u;
    for (const line of subLines) {
      ctx.fillText(line, pad, ty);
      ty += 46 * u;
    }

    // Footer kiri bawah (kontak & jam)
    ctx.fillStyle = t.accent2;
    ctx.font = `800 ${30 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(s.footer, pad, H - pad - 16 * u);

    // Voucher strip bawah kiri
    if (s.showVoucher && s.voucherCode) {
      const vy = H - pad - 78 * u;
      ctx.font = `900 ${34 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const vText = `${s.voucherText}  •  KODE: ${s.voucherCode}`;
      const vw = ctx.measureText(vText).width + 56 * u;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      roundRect(ctx, pad, vy - 34 * u, vw, 68 * u, 34 * u);
      ctx.fill();
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 3 * u;
      ctx.stroke();
      ctx.fillStyle = t.accent;
      ctx.textBaseline = "middle";
      ctx.fillText(vText, pad + 28 * u, vy);
    }

    // Panel item di kanan
    const panelX = W * 0.55;
    const panelW = W - panelX - pad;
    const panelH = H - pad * 2;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, panelX, pad, panelW, panelH, 36 * u);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2.5 * u;
    ctx.stroke();

    const iy = pad + 70 * u;
    const rowH = (panelH - 100 * u) / 3;
    s.items.slice(0, 3).forEach((it, i) => {
      const cy = iy + i * rowH + rowH / 2;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = `400 ${58 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText(it.emoji, panelX + 70 * u, cy);
      ctx.textAlign = "left";
      ctx.fillStyle = t.text;
      ctx.font = `800 ${38 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const nameLines = wrapText(ctx, it.name, panelW - 260 * u, 1);
      ctx.fillText(nameLines[0] ?? it.name, panelX + 130 * u, cy - 14 * u);
      // harga (coret bila ada harga asli)
      const priceStr = formatIDR(it.price);
      ctx.font = `900 ${34 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const px = panelX + panelW - 32 * u - ctx.measureText(priceStr).width;
      if (it.strike) {
        const st = formatIDR(it.strike);
        ctx.fillStyle = t.sub;
        ctx.font = `600 ${26 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillText(st, panelX + 130 * u, cy + 24 * u);
        ctx.strokeStyle = t.sub;
        ctx.lineWidth = 2.5 * u;
        const stw = ctx.measureText(st).width;
        ctx.beginPath();
        ctx.moveTo(panelX + 130 * u, cy + 24 * u);
        ctx.lineTo(panelX + 130 * u + stw, cy + 24 * u);
        ctx.stroke();
        ctx.fillStyle = t.accent;
        ctx.font = `900 ${34 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillText(priceStr, px, cy + 22 * u);
      } else {
        ctx.fillStyle = t.accent;
        ctx.fillText(priceStr, px, cy);
      }
    });
  } else {
    // --- Layout vertikal (feed/story): judul atas, item tengah, footer bawah ---
    const pad = 64 * u;

    // Badge
    ctx.font = `900 ${34 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const badgeW = ctx.measureText(s.badge).width + 48 * u;
    ctx.fillStyle = t.accent;
    roundRect(ctx, pad, pad, badgeW, 62 * u, 31 * u);
    ctx.fill();
    ctx.fillStyle = "#1C1917";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(s.badge, pad + badgeW / 2, pad + 32 * u);

    // Judul besar
    ctx.textAlign = "left";
    ctx.fillStyle = t.text;
    ctx.font = `900 ${s.kind === "story" ? 96 : 84} * u}px system-ui, -apple-system, "Segoe UI", sans-serif`.replace(
      /(\d+) \* u/,
      (_, d) => String(Number(d) * u)
    );
    const titleLines = wrapText(ctx, s.title, W - pad * 2, 3);
    let ty = pad + 170 * u;
    for (const line of titleLines) {
      ctx.fillText(line, pad, ty);
      ty += (s.kind === "story" ? 104 : 92) * u;
    }

    // Subjudul
    ctx.fillStyle = t.sub;
    ctx.font = `600 ${38 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const subLines = wrapText(ctx, s.subtitle, W - pad * 2, 2);
    ty += 12 * u;
    for (const line of subLines) {
      ctx.fillText(line, pad, ty);
      ty += 48 * u;
    }

    // Kartu item (3 baris)
    const cardY = ty + 36 * u;
    const cardH = H - cardY - (s.showVoucher && s.voucherCode ? 250 : 170) * u;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, pad, cardY, W - pad * 2, cardH, 36 * u);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2.5 * u;
    ctx.stroke();

    const rowH = (cardH - 56 * u) / 3;
    s.items.slice(0, 3).forEach((it, i) => {
      const cy = cardY + 40 * u + i * rowH + rowH / 2 - 20 * u;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = `400 ${64 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.fillText(it.emoji, pad + 76 * u, cy);
      ctx.textAlign = "left";
      ctx.fillStyle = t.text;
      ctx.font = `800 ${40 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const nameLines = wrapText(ctx, it.name, W - pad * 2 - 380 * u, 1);
      ctx.fillText(nameLines[0] ?? it.name, pad + 140 * u, cy - (it.strike ? 12 : 0) * u);
      const priceStr = formatIDR(it.price);
      ctx.font = `900 ${38 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const px = W - pad - 40 * u - ctx.measureText(priceStr).width;
      if (it.strike) {
        const st = formatIDR(it.strike);
        ctx.fillStyle = t.sub;
        ctx.font = `600 ${28 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillText(st, pad + 140 * u, cy + 28 * u);
        ctx.strokeStyle = t.sub;
        ctx.lineWidth = 2.5 * u;
        const stw = ctx.measureText(st).width;
        ctx.beginPath();
        ctx.moveTo(pad + 140 * u, cy + 28 * u);
        ctx.lineTo(pad + 140 * u + stw, cy + 28 * u);
        ctx.stroke();
        ctx.fillStyle = t.accent;
        ctx.font = `900 ${38 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillText(priceStr, px, cy + 26 * u);
      } else {
        ctx.fillStyle = t.accent;
        ctx.fillText(priceStr, px, cy);
      }
    });

    // Voucher strip
    if (s.showVoucher && s.voucherCode) {
      const vy = cardY + cardH + 44 * u;
      ctx.font = `900 ${36 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      const vText = `${s.voucherText} — KODE: ${s.voucherCode}`;
      const vw = Math.min(ctx.measureText(vText).width + 56 * u, W - pad * 2);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      roundRect(ctx, (W - vw) / 2, vy, vw, 72 * u, 36 * u);
      ctx.fill();
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 3 * u;
      ctx.stroke();
      ctx.fillStyle = t.accent;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(vText, W / 2, vy + 36 * u);
    }

    // Footer bawah
    ctx.fillStyle = t.accent2;
    ctx.font = `800 ${32 * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.footer, W / 2, H - 76 * u);
  }

  // ===== Tanda air brand kecil =====
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = `800 ${isWide ? 26 : 28} * u * 1px system-ui, sans-serif`.replace(
    /(\d+) \* u/,
    (_, d) => String(Number(d) * u)
  );
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("AGSI • Ayam Geprek Sambal Ijo", W - 40 * u, isWide ? H - 40 * u : 40 * u + 6 * u);
  // catatan: u sudah diskalakan untuk W=1080; untuk kanvas lebih lebar, kalikan
}

/* ================= KOMPONEN UTAMA ================= */

export function PosterGeneratorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [vouchers, setVouchers] = useState<VoucherInfo[]>([]);
  const [dataReady, setDataReady] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState(false);

  const [state, setState] = useState<PosterState>({
    kind: "feed",
    theme: "api",
    badge: "PROMO SPESIAL HARI INI",
    title: "Paket Geprek Komplit",
    subtitle: "Geprek + nasi + es teh manis jumbo — kenyang maksimal!",
    items: [
      { emoji: "🍗", name: "Paket Geprek Komplit", price: 27000, strike: 35000 },
      { emoji: "🌶️", name: "Geprek Sambal Ijo", price: 15000 },
      { emoji: "🥤", name: "Es Teh Manis Jumbo", price: 6000 },
    ],
    footer: `ORDER: ${STORE_PHONE} • Buka ${STORE_HOURS}`,
    showVoucher: true,
    voucherCode: "GEPREK10",
    voucherText: "Diskon 10%",
  });

  /** Muat menu + voucher nyata sekali untuk tombol "Isi Otomatis" */
  useEffect(() => {
    if (!open || dataReady) return;
    let alive = true;
    void (async () => {
      try {
        const [pRes, vRes] = await Promise.all([
          apiFetch("/api/products", { cache: "no-store" }),
          apiFetch("/api/vouchers", { cache: "no-store" }),
        ]);
        const pBody = await pRes.json();
        const vBody = await vRes.json();
        if (alive) {
          setProducts((pBody.products ?? []) as Product[]);
          setVouchers((vBody.vouchers ?? []) as VoucherInfo[]);
          setDataReady(true);
        }
      } catch {
        // data nyata gagal dimuat — generator tetap jalan dengan default
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, dataReady]);

  const set = <K extends keyof PosterState>(k: K, v: PosterState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  /** ISI OTOMATIS: susun konten promosi dari menu populer + voucher aktif */
  const autoFill = useCallback(() => {
    const available = products.filter((p) => p.available);
    const popular = available.filter((p) => p.popular);
    const pool = (popular.length >= 3 ? popular : available).slice(0, 3);
    const voucher = vouchers.find((v) => v.code && !v.usedByMe) ?? vouchers[0];
    if (pool.length === 0) {
      showNotice({
        type: "info",
        title: "Belum Ada Data Menu",
        message: "Tambahkan produk dulu di menu Produk — generator butuh data menu untuk isi otomatis.",
      });
      return;
    }
    setState((s) => ({
      ...s,
      title: pool.length >= 2 ? `Paket Hemat ${pool[0].name.split(" ")[0]}` : s.title,
      subtitle: "Favoritenya pelanggan — pesan sekarang di aplikasi AGSI!",
      items: pool.map((p) => ({ emoji: p.emoji, name: p.name, price: p.price })),
      showVoucher: !!voucher,
      voucherCode: voucher?.code ?? "",
      voucherText: voucher ? `Voucher ${formatVoucherValue(voucher)}` : "",
    }));
    showNotice({
      type: "success",
      title: "Konten Terisi Otomatis ✓",
      message: "Diambil dari menu & voucher terbaru — silakan sesuaikan lagi sesuai selera.",
    });
  }, [products, vouchers, showNotice]);

  /** Render ulang canvas setiap state berubah */
  useEffect(() => {
    if (!open || !canvasRef.current) return;
    setRendering(true);
    // beri satu frame agar ukuran canvas menyesuaikan layout
    requestAnimationFrame(() => {
      if (canvasRef.current) drawPoster(canvasRef.current, state);
      setRendering(false);
    });
  }, [open, state]);

  /** Unduh PNG resolusi penuh — via bridge native di aplikasi Android */
  const download = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1] ?? "";
      const name = `AGSI-${state.kind}-${Date.now()}.png`;
      // Di aplikasi Android: simpan via jembatan native (folder Unduhan/AGSI).
      // Di browser: unduhan biasa. PNG base64 → nativeSaveFile menerima teks,
      // jadi kirim sebagai base64 mentah dengan nama file .png.
      if (nativeSaveSupported()) {
        const res = await nativeSaveFile(base64, name, "image/png");
        if (res.ok) {
          showNotice({
            type: "success",
            title: "Poster Tersimpan ✓",
            message: `${res.message || name} — cek folder Unduhan/AGSI.`,
          });
          return;
        }
        // gagal/dibatalkan → jatuh ke unduhan browser
      }
      const blob = await (await fetch(dataUrl)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15_000);
      showNotice({
        type: "success",
        title: "Poster Tersimpan ✓",
        message: `${name} (${canvas.width}×${canvas.height}px) — cek folder Unduhan.`,
      });
    } catch {
      showNotice({ type: "error", title: "Gagal Menyimpan", message: "Coba lagi sebentar ya." });
    } finally {
      setBusy(false);
    }
  };

  /** Bagikan PNG (Web Share API — Android/Chrome) */
  const share = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    try {
      const blob = await (await fetch(canvas.toDataURL("image/png"))).blob();
      const file = new File([blob], `AGSI-${state.kind}.png`, { type: "image/png" });
      if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: state.title,
          text: `${state.badge} — ${state.title}`,
        });
      } else {
        showNotice({
          type: "info",
          title: "Bagikan Tidak Tersedia",
          message: "Browser ini tidak mendukung berbagi langsung — gunakan tombol Unduh lalu kirim manual.",
        });
      }
    } catch {
      // pengguna membatalkan dialog share — diam saja
    } finally {
      setBusy(false);
    }
  };

  const kindInfo = KINDS.find((k) => k.id === state.kind) ?? KINDS[0];

  // Escape untuk tutup
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const itemEditor = useMemo(
    () => (
      <div className="space-y-2">
        {state.items.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={it.emoji}
              onChange={(e) => {
                const items = [...state.items];
                items[i] = { ...it, emoji: e.target.value.slice(0, 4) };
                setState((s) => ({ ...s, items }));
              }}
              aria-label={`Emoji item ${i + 1}`}
              className="h-10 w-12 rounded-xl border border-orange-200 bg-white text-center text-lg"
            />
            <input
              value={it.name}
              onChange={(e) => {
                const items = [...state.items];
                items[i] = { ...it, name: e.target.value.slice(0, 40) };
                setState((s) => ({ ...s, items }));
              }}
              aria-label={`Nama item ${i + 1}`}
              placeholder="Nama menu"
              className="h-10 min-w-0 flex-1 rounded-xl border border-orange-200 bg-white px-3 text-sm font-semibold"
            />
            <input
              value={it.strike ? String(it.strike) : ""}
              onChange={(e) => {
                const items = [...state.items];
                const v = Math.max(0, Math.round(Number(e.target.value.replace(/\D/g, "")) || 0));
                items[i] = { ...it, strike: v > 0 ? v : undefined };
                setState((s) => ({ ...s, items }));
              }}
              aria-label={`Harga asli item ${i + 1}`}
              placeholder="¬asli"
              inputMode="numeric"
              className="h-10 w-20 rounded-xl border border-neutral-200 bg-white px-2 text-center text-xs"
            />
            <input
              value={String(it.price)}
              onChange={(e) => {
                const items = [...state.items];
                items[i] = { ...it, price: Math.max(0, Math.round(Number(e.target.value.replace(/\D/g, "")) || 0)) };
                setState((s) => ({ ...s, items }));
              }}
              aria-label={`Harga promo item ${i + 1}`}
              inputMode="numeric"
              className="h-10 w-24 rounded-xl border border-orange-200 bg-white px-2 text-center text-xs font-bold"
            />
          </div>
        ))}
        <p className="text-[10px] text-neutral-400">
          Kolom: emoji • nama • harga asli (dicoret, opsional) • harga promo.
        </p>
      </div>
    ),
    [state.items]
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="poster-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Generator Poster dan Banner"
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
            <header className="relative shrink-0 bg-gradient-to-r from-orange-700 via-orange-600 to-rose-500 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                  <Palette className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Generator Poster &amp; Banner</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Poster promo, banner &amp; spanduk otomatis — bisa disesuaikan
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
            <div className="scrollbar-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              {/* Jenis kanvas */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Jenis Desain</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {KINDS.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => set("kind", k.id)}
                      className={cn(
                        "press-effect rounded-xl border px-1 py-2 text-center transition",
                        state.kind === k.id
                          ? "border-orange-500 bg-orange-50 ring-2 ring-orange-200"
                          : "border-orange-100 bg-white hover:border-orange-300"
                      )}
                    >
                      <span className="block text-[11px] font-black text-neutral-700">{k.label}</span>
                      <span className="block text-[9px] text-neutral-400">{k.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tombol isi otomatis */}
              <button
                type="button"
                onClick={autoFill}
                disabled={!dataReady}
                className="press-effect flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-rose-500 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:opacity-95 disabled:opacity-50"
              >
                {dataReady ? <Wand2 className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                {dataReady ? "Isi Otomatis dari Menu & Voucher ✨" : "Memuat data menu…"}
              </button>

              {/* Pratinjau */}
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-neutral-500">
                  <ImageIcon className="h-3.5 w-3.5" /> Pratinjau {rendering && <RefreshCw className="h-3 w-3 animate-spin" />}
                </p>
                <div className="overflow-hidden rounded-2xl border border-orange-100 bg-neutral-100 p-2">
                  <canvas
                    ref={canvasRef}
                    aria-label="Pratinjau poster"
                    className="mx-auto block h-auto max-h-[300px] w-auto max-w-full rounded-xl shadow-md"
                  />
                  <p className="mt-1.5 text-center text-[10px] text-neutral-400">
                    {kindInfo.w} × {kindInfo.h} px (PNG resolusi penuh saat diunduh)
                  </p>
                </div>
              </div>

              {/* Tema warna */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Tema Warna</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(THEMES) as Theme[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => set("theme", t)}
                      className={cn(
                        "press-effect rounded-xl border px-3 py-2 text-left text-[11px] font-black transition",
                        state.theme === t
                          ? "border-orange-500 bg-orange-50 ring-2 ring-orange-200"
                          : "border-orange-100 bg-white hover:border-orange-300"
                      )}
                    >
                      <span
                        className="mr-1.5 inline-block h-3 w-3 rounded-full align-middle ring-1 ring-black/10"
                        style={{ background: `linear-gradient(135deg, ${THEMES[t].bgA}, ${THEMES[t].bgB})` }}
                      />
                      {THEMES[t].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Teks konten */}
              <div className="space-y-2.5">
                <p className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Isi Konten</p>
                <input
                  value={state.badge}
                  onChange={(e) => set("badge", e.target.value.slice(0, 30).toUpperCase())}
                  aria-label="Badge"
                  placeholder="BADGE (cth: PROMO SPESIAL)"
                  className="h-10 w-full rounded-xl border border-orange-200 bg-white px-3 text-xs font-black uppercase tracking-wide"
                />
                <input
                  value={state.title}
                  onChange={(e) => set("title", e.target.value.slice(0, 50))}
                  aria-label="Judul"
                  placeholder="Judul besar (cth: Paket Geprek Komplit)"
                  className="h-11 w-full rounded-xl border border-orange-200 bg-white px-3 text-sm font-black"
                />
                <textarea
                  value={state.subtitle}
                  onChange={(e) => set("subtitle", e.target.value.slice(0, 90))}
                  aria-label="Subjudul"
                  placeholder="Subjudul / penjelas singkat"
                  rows={2}
                  className="w-full rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-semibold"
                />
                {itemEditor}
                <input
                  value={state.footer}
                  onChange={(e) => set("footer", e.target.value.slice(0, 60))}
                  aria-label="Footer kontak"
                  placeholder="Footer (cth: ORDER: 08xx • Buka 10.00-22.00)"
                  className="h-10 w-full rounded-xl border border-orange-200 bg-white px-3 text-xs font-bold"
                />
              </div>

              {/* Voucher */}
              <div className="space-y-2 rounded-2xl border border-orange-100 bg-orange-50/50 p-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={state.showVoucher}
                    onChange={(e) => set("showVoucher", e.target.checked)}
                    className="h-4 w-4 accent-orange-600"
                  />
                  <span className="text-[12px] font-black text-neutral-700">Tampilkan strip kode voucher</span>
                </label>
                {state.showVoucher && (
                  <div className="flex gap-1.5">
                    <input
                      value={state.voucherText}
                      onChange={(e) => set("voucherText", e.target.value.slice(0, 30))}
                      aria-label="Teks voucher"
                      placeholder="Teks (cth: Diskon 10%)"
                      className="h-10 min-w-0 flex-1 rounded-xl border border-orange-200 bg-white px-3 text-xs font-semibold"
                    />
                    <input
                      value={state.voucherCode}
                      onChange={(e) => set("voucherCode", e.target.value.toUpperCase().slice(0, 24))}
                      aria-label="Kode voucher"
                      placeholder="KODE"
                      className="h-10 w-28 rounded-xl border border-orange-200 bg-white px-3 text-center text-xs font-black uppercase"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* ===== AKSI ===== */}
            <div className="flex shrink-0 gap-2 border-t border-orange-100 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <button
                type="button"
                onClick={() => void share()}
                disabled={busy}
                className="press-effect flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-orange-200 bg-white text-sm font-bold text-orange-700 hover:bg-orange-50 disabled:opacity-60"
              >
                <Share2 className="h-4 w-4" /> Bagikan
              </button>
              <button
                type="button"
                onClick={() => void download()}
                disabled={busy}
                className="press-effect flex h-11 flex-[1.6] items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-black text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700 disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {busy ? "Menyiapkan…" : "Unduh PNG"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
