"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { QRCodeCanvas } from "qrcode.react";
import {
  Copy,
  Download,
  Dice5,
  Image as ImageIcon,
  Loader2,
  Palette,
  QrCode,
  RefreshCw,
  RotateCcw,
  Share2,
  Trash2,
  Upload,
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
 * GENERATOR POSTER & BANNER CANGGIH (khusus Admin/Owner) — Profil ▸ "Generator Poster & Banner".
 *
 * Bikin poster promosi, banner, & spanduk restoran secara OTOMatis:
 *  - Sumber konten nyata: menu populer dari database + voucher aktif —
 *    tombol "Isi Otomatis" menyusun konten promosi siap pakai.
 *  - 4 jenis kanvas: Poster Feed IG (1:1), Story/Reels (9:16), Banner
 *    landscape (16:9), Spanduk digital (2:1).
 *  - FITUR CANGGIH:
 *      • Logo toko & foto latar produk (diunggah, diproses di perangkat)
 *      • 7 tema warna + warna kustom dua gradasi
 *      • 4 pola latar (bulatan, garis diagonal, bintik, polos)
 *      • 3 gaya font (modern, bulat, klasik) + QR "Pesan di App"
 *      • Item promo 1–6 (tambah/hapus), harga asli dicoret otomatis
 *      • Draf tersimpan otomatis (localStorage) + Acak Gaya 🎲 + Reset
 *      • Caption promosi siap-tempel WA/IG — satu tombol salin
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

type Theme = "api" | "merah" | "hijau" | "gelap" | "biru" | "ungu" | "krem";

type ThemeDef = {
  label: string;
  bgA: string;
  bgB: string;
  accent: string;
  accent2: string;
  text: string;
  sub: string;
  badgeText: string; // warna teks di atas badge accent
  stripBg: string; // latar strip voucher (gelap utk tema gelap, terang utk krem)
};

const THEMES: Record<Theme, ThemeDef> = {
  api: { label: "Sambal Ijo 🌶️", bgA: "#7C2D12", bgB: "#F97316", accent: "#FDE047", accent2: "#FFFFFF", text: "#FFFFFF", sub: "#FFEDD5", badgeText: "#1C1917", stripBg: "rgba(0,0,0,0.35)" },
  merah: { label: "Pedas Merah 🔥", bgA: "#7F1D1D", bgB: "#EF4444", accent: "#FDE047", accent2: "#FFFFFF", text: "#FFFFFF", sub: "#FEE2E2", badgeText: "#1C1917", stripBg: "rgba(0,0,0,0.35)" },
  hijau: { label: "Ijo Segar 🌿", bgA: "#14532D", bgB: "#22C55E", accent: "#FEF08A", accent2: "#FFFFFF", text: "#FFFFFF", sub: "#DCFCE7", badgeText: "#1C1917", stripBg: "rgba(0,0,0,0.35)" },
  gelap: { label: "Premium Gelap 🖤", bgA: "#111827", bgB: "#374151", accent: "#F59E0B", accent2: "#FCD34D", text: "#F9FAFB", sub: "#D1D5DB", badgeText: "#1C1917", stripBg: "rgba(0,0,0,0.35)" },
  biru: { label: "Biru Laut 🌊", bgA: "#0C4A6E", bgB: "#0EA5E9", accent: "#FDE047", accent2: "#FFFFFF", text: "#FFFFFF", sub: "#BAE6FD", badgeText: "#1C1917", stripBg: "rgba(0,0,0,0.35)" },
  ungu: { label: "Ungu Malam 🌌", bgA: "#3B0764", bgB: "#8B5CF6", accent: "#FDE047", accent2: "#F3E8FF", text: "#FFFFFF", sub: "#DDD6FE", badgeText: "#1C1917", stripBg: "rgba(0,0,0,0.35)" },
  krem: { label: "Krem Klasik 🏷️", bgA: "#FEF3C7", bgB: "#FDE68A", accent: "#B45309", accent2: "#7C2D12", text: "#78350F", sub: "#92400E", badgeText: "#FFFFFF", stripBg: "rgba(255,255,255,0.45)" },
};

type FontChoice = "modern" | "bulat" | "klasik";

const FONTS: Record<FontChoice, { label: string; stack: string }> = {
  modern: { label: "Modern", stack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  bulat: { label: "Bulat", stack: '"Trebuchet MS", "Comic Sans MS", system-ui, sans-serif' },
  klasik: { label: "Klasik", stack: 'Georgia, "Times New Roman", serif' },
};

type PatternChoice = "bulat" | "garis" | "bintik" | "polos";

const PATTERNS: Record<PatternChoice, { label: string }> = {
  bulat: { label: "Bulatan" },
  garis: { label: "Garis" },
  bintik: { label: "Bintik" },
  polos: { label: "Polos" },
};

type PromoItem = { emoji: string; name: string; price: number; strike?: number };

type PosterState = {
  kind: PosterKind;
  theme: Theme;
  pattern: PatternChoice;
  font: FontChoice;
  customColor: boolean;
  colA: string;
  colB: string;
  showLogo: boolean;
  logoDataUrl: string | null;
  bgDataUrl: string | null;
  showQr: boolean;
  watermark: boolean;
  badge: string;
  title: string;
  subtitle: string;
  items: PromoItem[];
  footer: string;
  showVoucher: boolean;
  voucherCode: string;
  voucherText: string;
};

/** Aset gambar yang sudah dimuat ke memori utk digambar ke canvas */
export type PosterAssets = {
  logo: HTMLImageElement | null;
  bg: HTMLImageElement | null;
  qr: HTMLCanvasElement | null;
};

const DRAFT_KEY = "agsi-poster-draft-v2";
const MAX_ITEMS = 6;

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

/** Kecilkan ukuran font sampai teks muat dalam lebar maksimum */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxW: number, stack: string, minSize = 18): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${stack}`;
  while (ctx.measureText(text).width > maxW && s > minSize) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${stack}`;
  }
  return s;
}

/** Satu baris item promo: emoji + nama + harga (harga asli dicoret bila ada) */
function drawItemRow(
  ctx: CanvasRenderingContext2D,
  it: PromoItem,
  cx: number, // x kiri area baris
  cy: number, // y tengah baris
  rowW: number,
  t: ThemeDef,
  stack: string,
  u: number,
  big: boolean
) {
  const emojiSize = big ? 64 * u : 56 * u;
  const nameSize = big ? 40 * u : 36 * u;
  const priceSize = big ? 38 * u : 34 * u;

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.font = `400 ${emojiSize}px ${stack}`;
  ctx.fillText(it.emoji, cx + emojiSize / 2 + 6 * u, cy);

  ctx.textAlign = "left";
  ctx.fillStyle = t.text;
  const nameX = cx + emojiSize + 24 * u;
  const nameW = rowW - (nameX - cx) - 190 * u;
  ctx.font = `800 ${nameSize}px ${stack}`;
  const nameLines = wrapText(ctx, it.name, Math.max(nameW, 120 * u), 1);
  ctx.fillText(nameLines[0] ?? it.name, nameX, cy - (it.strike ? 12 * u : 0));

  const priceStr = formatIDR(it.price);
  ctx.font = `900 ${priceSize}px ${stack}`;
  const px = cx + rowW - 28 * u - ctx.measureText(priceStr).width;
  if (it.strike) {
    const st = formatIDR(it.strike);
    ctx.fillStyle = t.sub;
    ctx.font = `600 ${priceSize * 0.72}px ${stack}`;
    ctx.fillText(st, nameX, cy + 26 * u);
    ctx.strokeStyle = t.sub;
    ctx.lineWidth = 2.5 * u;
    const stw = ctx.measureText(st).width;
    ctx.beginPath();
    ctx.moveTo(nameX, cy + 26 * u);
    ctx.lineTo(nameX + stw, cy + 26 * u);
    ctx.stroke();
    ctx.fillStyle = t.accent;
    ctx.font = `900 ${priceSize}px ${stack}`;
    ctx.fillText(priceStr, px, cy + 24 * u);
  } else {
    ctx.fillStyle = t.accent;
    ctx.fillText(priceStr, px, cy);
  }
}

/** Gambar poster ke canvas sesuai state + aset — dipanggil saat preview & unduh */
function drawPoster(canvas: HTMLCanvasElement, s: PosterState, assets: PosterAssets): void {
  const kind = KINDS.find((k) => k.id === s.kind) ?? KINDS[0];
  const base = THEMES[s.theme];
  const t: ThemeDef = s.customColor
    ? { ...base, bgA: s.colA, bgB: s.colB, text: "#FFFFFF", sub: "rgba(255,255,255,0.85)", accent: base.accent, accent2: "#FFFFFF", badgeText: "#1C1917", stripBg: "rgba(0,0,0,0.35)" }
    : base;
  const stack = FONTS[s.font].stack;
  const W = kind.w;
  const H = kind.h;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const isWide = W > H; // banner & spanduk — layout horizontal
  const u = W / 1080; // satuan skala relatif
  const pad = isWide ? 72 * u : 64 * u;
  const items = s.items.slice(0, MAX_ITEMS);

  // ===== LATAR: gradien diagonal =====
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, t.bgA);
  grad.addColorStop(1, t.bgB);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // ===== FOTO LATAR pelanggan (cover penuh) + tirai gelap agar teks terbaca =====
  if (assets.bg) {
    const img = assets.bg;
    const scale = Math.max(W / img.width, H / img.height);
    const iw = img.width * scale;
    const ih = img.height * scale;
    ctx.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);
    const shade = ctx.createLinearGradient(0, 0, W, H);
    shade.addColorStop(0, "rgba(12,8,6,0.60)");
    shade.addColorStop(0.5, "rgba(12,8,6,0.40)");
    shade.addColorStop(1, "rgba(12,8,6,0.70)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
  }

  // ===== POLA LATAR =====
  if (s.pattern === "bulat") {
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
  } else if (s.pattern === "garis") {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 26 * u;
    for (let x = -H; x < W + H; x += 150 * u) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + H, H);
      ctx.stroke();
    }
    ctx.restore();
  } else if (s.pattern === "bintik") {
    ctx.save();
    ctx.fillStyle = "#FFFFFF";
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 70; i++) {
      const sx = ((i * 137.508) % 100) / 100;
      const sy = ((i * 61.803) % 100) / 100;
      const r = (4 + (i % 3) * 3.5) * u;
      ctx.beginPath();
      ctx.arc(sx * W, sy * H, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  // polos: tanpa pola

  // ===== LOGO TOKO — chip putih sudut kanan-atas =====
  if (assets.logo) {
    const size = 118 * u;
    const lx = W - pad - size;
    const ly = pad - 6 * u;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = 16 * u;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    roundRect(ctx, lx, ly, size, size, 26 * u);
    ctx.fill();
    ctx.restore();
    const img = assets.logo;
    const inner = size - 22 * u;
    const iscale = Math.min(inner / img.width, inner / img.height);
    const iw = img.width * iscale;
    const ih = img.height * iscale;
    ctx.drawImage(img, lx + (size - iw) / 2, ly + (size - ih) / 2, iw, ih);
  }

  // ===== BADGE =====
  ctx.font = `900 ${34 * u}px ${stack}`;
  const badgeW = Math.min(ctx.measureText(s.badge).width + 48 * u, W - pad * 2 - (assets.logo ? 130 * u : 0));
  ctx.fillStyle = t.accent;
  roundRect(ctx, pad, pad, badgeW, 62 * u, 31 * u);
  ctx.fill();
  ctx.fillStyle = t.badgeText;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(s.badge, pad + badgeW / 2, pad + 32 * u);

  // Baris item yang benar-benar digambar (dibatasi kapasitas kanvas)
  let drawRows: number;
  let rowH: number;
  let noteH = 0;

  if (isWide) {
    // --- Layout horizontal (banner/spanduk): teks kiri, panel item kanan ---
    const leftW = W * 0.52 - pad;

    // Judul besar (3 baris maks)
    ctx.textAlign = "left";
    ctx.fillStyle = t.text;
    ctx.font = `900 ${86 * u}px ${stack}`;
    const titleLines = wrapText(ctx, s.title, leftW, 3);
    let ty = pad + 140 * u;
    for (const line of titleLines) {
      ctx.fillText(line, pad, ty);
      ty += 96 * u;
    }

    // Subjudul
    ctx.fillStyle = t.sub;
    ctx.font = `600 ${36 * u}px ${stack}`;
    const subLines = wrapText(ctx, s.subtitle, leftW, 2);
    ty += 8 * u;
    for (const line of subLines) {
      ctx.fillText(line, pad, ty);
      ty += 46 * u;
    }

    // Footer kiri bawah
    ctx.fillStyle = t.accent2;
    ctx.font = `800 ${30 * u}px ${stack}`;
    ctx.textBaseline = "middle";
    const footLines = wrapText(ctx, s.footer, leftW + 40 * u, 2);
    let fy = H - pad - 16 * u - (footLines.length - 1) * 38 * u;
    for (const line of footLines) {
      ctx.fillText(line, pad, fy);
      fy += 38 * u;
    }

    // Voucher strip bawah kiri
    if (s.showVoucher && s.voucherCode) {
      const vy = H - pad - 96 * u - (footLines.length - 1) * 38 * u;
      ctx.font = `900 ${34 * u}px ${stack}`;
      const vText = `${s.voucherText}  •  KODE: ${s.voucherCode}`;
      const vw = ctx.measureText(vText).width + 56 * u;
      ctx.fillStyle = t.stripBg;
      roundRect(ctx, pad, vy - 34 * u, vw, 68 * u, 34 * u);
      ctx.fill();
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 3 * u;
      ctx.stroke();
      ctx.fillStyle = t.accent;
      ctx.textBaseline = "middle";
      ctx.fillText(vText, pad + 28 * u, vy);
    }

    // ===== Panel item kanan =====
    const panelX = W * 0.55;
    const panelW = W - panelX - pad;
    const panelH = H - pad * 2;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, panelX, pad, panelW, panelH, 36 * u);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2.5 * u;
    ctx.stroke();

    const qrBarH = assets.qr ? 110 * u : 0;
    const rowsArea = panelH - 70 * u - qrBarH - 16 * u;
    drawRows = Math.min(items.length, Math.max(1, Math.floor(rowsArea / (110 * u))));
    noteH = drawRows < items.length ? 34 * u : 0;
    rowH = (rowsArea - noteH) / drawRows;

    const iy = pad + 70 * u;
    for (let i = 0; i < drawRows; i++) {
      drawItemRow(ctx, items[i], panelX + 8 * u, iy + i * rowH + rowH / 2, panelW - 16 * u, t, stack, u, false);
    }
    if (noteH) {
      ctx.fillStyle = t.sub;
      ctx.font = `700 ${24 * u}px ${stack}`;
      ctx.textAlign = "center";
      ctx.fillText(`+${items.length - drawRows} item lainnya`, panelX + panelW / 2, iy + drawRows * rowH + noteH / 2);
    }

    // QR bar di dalam panel (bawah)
    if (assets.qr) {
      const barY = pad + panelH - 14 * u - 96 * u;
      ctx.fillStyle = "#FFFFFF";
      roundRect(ctx, panelX + 16 * u, barY, panelW - 32 * u, 96 * u, 22 * u);
      ctx.fill();
      ctx.drawImage(assets.qr, panelX + 30 * u, barY + 14 * u, 68 * u, 68 * u);
      ctx.fillStyle = "#1C1917";
      ctx.font = `900 ${26 * u}px ${stack}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("PESAN DI APP AGSI", panelX + 112 * u, barY + 34 * u);
      ctx.font = `700 ${20 * u}px ${stack}`;
      ctx.fillStyle = "#57534E";
      ctx.fillText("Scan kodenya — unduh aplikasinya", panelX + 112 * u, barY + 62 * u);
    }
  } else {
    // --- Layout vertikal (feed/story): judul atas, item tengah, bawah bertumpuk ---
    // Judul besar
    ctx.textAlign = "left";
    ctx.fillStyle = t.text;
    ctx.font = `900 ${(s.kind === "story" ? 96 : 84) * u}px ${stack}`;
    const titleLines = wrapText(ctx, s.title, W - pad * 2, 3);
    let ty = pad + 170 * u;
    for (const line of titleLines) {
      ctx.fillText(line, pad, ty);
      ty += (s.kind === "story" ? 104 : 92) * u;
    }

    // Subjudul
    ctx.fillStyle = t.sub;
    ctx.font = `600 ${38 * u}px ${stack}`;
    const subLines = wrapText(ctx, s.subtitle, W - pad * 2, 2);
    ty += 12 * u;
    for (const line of subLines) {
      ctx.fillText(line, pad, ty);
      ty += 48 * u;
    }

    // Cadangan ruang bawah: footer + QR bar + voucher strip
    const showV = s.showVoucher && !!s.voucherCode;
    const footerY = H - 44 * u;
    const reserve = 76 * u + (assets.qr ? 120 * u : 0) + (showV ? 140 * u : 50 * u);
    const cardY = ty + 36 * u;
    const cardH = Math.max(
      140 * u,
      Math.min(H - reserve - cardY, items.length * 132 * u + 44 * u)
    );
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, pad, cardY, W - pad * 2, cardH, 36 * u);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2.5 * u;
    ctx.stroke();

    drawRows = Math.min(items.length, Math.max(1, Math.floor((cardH - 30 * u) / (92 * u))));
    noteH = drawRows < items.length ? 36 * u : 0;
    rowH = (cardH - 30 * u - noteH) / drawRows;

    for (let i = 0; i < drawRows; i++) {
      drawItemRow(ctx, items[i], pad + 8 * u, cardY + 26 * u + i * rowH + rowH / 2, W - pad * 2 - 16 * u, t, stack, u, true);
    }
    if (noteH) {
      ctx.fillStyle = t.sub;
      ctx.font = `700 ${24 * u}px ${stack}`;
      ctx.textAlign = "center";
      ctx.fillText(`+${items.length - drawRows} item lainnya`, W / 2, cardY + 26 * u + drawRows * rowH + noteH / 2);
    }

    // Voucher strip (kiri bila QR dipakai — QR bar di kanan bawah)
    let stripBottom = cardY + cardH;
    if (showV) {
      const vy = cardY + cardH + 46 * u;
      ctx.font = `900 ${36 * u}px ${stack}`;
      const vText = `${s.voucherText} — KODE: ${s.voucherCode}`;
      const maxVw = assets.qr ? W - pad * 2 - 240 * u : W - pad * 2;
      fitFont(ctx, vText, 900, 36, maxVw - 56 * u, stack, 20);
      const vw = Math.min(ctx.measureText(vText).width + 56 * u, maxVw);
      ctx.fillStyle = t.stripBg;
      roundRect(ctx, pad, vy, vw, 72 * u, 36 * u);
      ctx.fill();
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 3 * u;
      ctx.stroke();
      ctx.fillStyle = t.accent;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(vText, pad + vw / 2, vy + 36 * u);
      stripBottom = vy + 72 * u;
    }

    // QR bar putih lebar di atas footer
    if (assets.qr) {
      const barY = stripBottom + 26 * u;
      const barH = 96 * u;
      ctx.fillStyle = "#FFFFFF";
      roundRect(ctx, pad, barY, W - pad * 2, barH, 24 * u);
      ctx.fill();
      ctx.drawImage(assets.qr, pad + 14 * u, barY + 13 * u, 70 * u, 70 * u);
      ctx.fillStyle = "#1C1917";
      ctx.font = `900 ${30 * u}px ${stack}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("PESAN DI APP AGSI", pad + 104 * u, barY + 32 * u);
      ctx.fillStyle = "#57534E";
      ctx.font = `700 ${22 * u}px ${stack}`;
      ctx.fillText("Scan kodenya — pesan & unduh aplikasinya", pad + 104 * u, barY + 62 * u);
    }

    // Footer bawah
    ctx.fillStyle = t.accent2;
    ctx.font = `800 ${32 * u}px ${stack}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s.footer, W / 2, footerY);
  }

  // ===== Tanda air brand (bisa dimatikan) =====
  if (s.watermark) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = `800 ${26 * u}px ${stack}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("AGSI • Ayam Geprek Sambal Ijo", W - 40 * u, isWide ? H - 40 * u : 40 * u + 6 * u);
  }
}

/* ================= CAPTION PROMOSI ================= */

/** Bangun teks caption WA/IG dari isi poster — siap tempel */
function buildCaption(s: PosterState, appUrl: string): string {
  const lines: string[] = [];
  if (s.badge) lines.push(`🔥 ${s.badge} 🔥`);
  lines.push(s.title);
  if (s.subtitle) lines.push(s.subtitle);
  lines.push("");
  for (const it of s.items.slice(0, MAX_ITEMS)) {
    const price = it.strike ? `~~${formatIDR(it.strike)}~~ *${formatIDR(it.price)}*` : `*${formatIDR(it.price)}*`;
    lines.push(`${it.emoji} ${it.name} — ${price}`);
  }
  if (s.showVoucher && s.voucherCode) {
    lines.push("");
    lines.push(`🎟️ ${s.voucherText} — kode *${s.voucherCode}*`);
  }
  lines.push("");
  lines.push(`📲 Pesan langsung di aplikasi AGSI: ${appUrl}`);
  if (s.footer) lines.push(`☎️ ${s.footer}`);
  return lines.join("\n");
}

/* ================= KOMPONEN UTAMA ================= */

const DEFAULT_STATE: PosterState = {
  kind: "feed",
  theme: "api",
  pattern: "bulat",
  font: "modern",
  customColor: false,
  colA: "#7C2D12",
  colB: "#F97316",
  showLogo: false,
  logoDataUrl: null,
  bgDataUrl: null,
  showQr: true,
  watermark: true,
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
};

/** Baca file gambar jadi dataURL (diproses murni di perangkat — tidak diunggah) */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("gagal baca file"));
    r.readAsDataURL(file);
  });
}

export function PosterGeneratorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoFileRef = useRef<HTMLInputElement | null>(null);
  const bgFileRef = useRef<HTMLInputElement | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<PosterState>(DEFAULT_STATE);
  const [products, setProducts] = useState<Product[]>([]);
  const [vouchers, setVouchers] = useState<VoucherInfo[]>([]);
  const [dataReady, setDataReady] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [assetsReady, setAssetsReady] = useState(0);

  const qrValue = typeof window !== "undefined" ? `${window.location.origin}/unduh` : "";

  /** Muat draf tersimpan sekali (draf = seluruh isi poster, dipulihkan saat dibuka) */
  useEffect(() => {
    if (!open || hydrated) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<PosterState>;
        setState((s) => ({
          ...s,
          ...d,
          items:
            Array.isArray(d.items) && d.items.length > 0 ? d.items.slice(0, MAX_ITEMS) : s.items,
        }));
      }
    } catch {
      // draf rusak — lanjut dengan konten default
    }
    setHydrated(true);
  }, [open, hydrated]);

  /** Draf tersimpan otomatis (gambar besar dilepas bila kuota tidak cukup) */
  useEffect(() => {
    if (!hydrated) return;
    try {
      const json = JSON.stringify(state);
      if (json.length > 2_500_000) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...state, logoDataUrl: null, bgDataUrl: null }));
      } else {
        localStorage.setItem(DRAFT_KEY, json);
      }
    } catch {
      // kuota localStorage penuh — draf dilewati, editor tetap jalan
    }
  }, [state, hydrated]);

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

  /** Pra-muat gambar logo & latar ke memori untuk digambar ke canvas */
  useEffect(() => {
    if (!state.showLogo || !state.logoDataUrl) {
      logoImgRef.current = null;
      setAssetsReady((v) => v + 1);
      return;
    }
    const img = new Image();
    img.onload = () => {
      logoImgRef.current = img;
      setAssetsReady((v) => v + 1);
    };
    img.onerror = () => {
      logoImgRef.current = null;
      setAssetsReady((v) => v + 1);
    };
    img.src = state.logoDataUrl;
  }, [state.showLogo, state.logoDataUrl]);

  useEffect(() => {
    if (!state.bgDataUrl) {
      bgImgRef.current = null;
      setAssetsReady((v) => v + 1);
      return;
    }
    const img = new Image();
    img.onload = () => {
      bgImgRef.current = img;
      setAssetsReady((v) => v + 1);
    };
    img.onerror = () => {
      bgImgRef.current = null;
      setAssetsReady((v) => v + 1);
    };
    img.src = state.bgDataUrl;
  }, [state.bgDataUrl]);

  const set = <K extends keyof PosterState>(k: K, v: PosterState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  /** ISI OTOMATIS: susun konten promosi dari menu populer + voucher aktif */
  const autoFill = useCallback(() => {
    const available = products.filter((p) => p.available);
    const popular = available.filter((p) => p.popular);
    const pool = (popular.length >= 3 ? popular : available).slice(0, MAX_ITEMS);
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

  /** ACAK GAYA: tema + pola + font diganti acak — inspirasi cepat */
  const randomize = useCallback(() => {
    const themes = (Object.keys(THEMES) as Theme[]).filter((t) => t !== state.theme);
    const patterns = Object.keys(PATTERNS) as PatternChoice[];
    const fonts = Object.keys(FONTS) as FontChoice[];
    setState((s) => ({
      ...s,
      theme: themes[Math.floor(Math.random() * themes.length)] ?? s.theme,
      pattern: patterns[Math.floor(Math.random() * patterns.length)] ?? s.pattern,
      font: fonts[Math.floor(Math.random() * fonts.length)] ?? s.font,
    }));
    showNotice({
      type: "info",
      title: "Gaya Diacak 🎲",
      message: "Tema, pola latar, & font baru — tekan lagi bila kurang cocok.",
    });
  }, [state.theme, showNotice]);

  /** RESET: kembalikan semua ke contoh awal & hapus draf */
  const resetAll = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // abaikan
    }
    setState({ ...DEFAULT_STATE, items: DEFAULT_STATE.items.map((it) => ({ ...it })) });
    showNotice({
      type: "info",
      title: "Draf Direset",
      message: "Isi poster kembali ke contoh awal — logo & foto latar dilepas.",
    });
  }, [showNotice]);

  /** Render ulang canvas setiap state / aset berubah */
  useEffect(() => {
    if (!open || !canvasRef.current) return;
    setRendering(true);
    requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      const qrCanvas = state.showQr
        ? ((document.getElementById("poster-qr-src")?.querySelector("canvas") as HTMLCanvasElement | null) ??
          null)
        : null;
      drawPoster(canvasRef.current, state, {
        logo: logoImgRef.current,
        bg: bgImgRef.current,
        qr: qrCanvas,
      });
      setRendering(false);
    });
  }, [open, state, assetsReady]);

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

  /** Salin caption promosi siap-tempel ke papan klip */
  const caption = useMemo(
    () => buildCaption(state, qrValue || "https://agsi-v-2-0.vercel.app/unduh"),
    [state, qrValue]
  );
  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      showNotice({
        type: "success",
        title: "Caption Tersalin ✓",
        message: "Tempel langsung ke WhatsApp, Instagram, atau TikTok.",
      });
    } catch {
      showNotice({
        type: "error",
        title: "Gagal Menyalin",
        message: "Browser menolak akses papan klip — salin manual dari kotak caption.",
      });
    }
  };

  /** Pilih & muat gambar logo / latar dari perangkat */
  const pickImage = async (
    e: React.ChangeEvent<HTMLInputElement>,
    apply: (dataUrl: string) => void
  ) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) {
      showNotice({
        type: "error",
        title: "Gambar Terlalu Besar",
        message: "Maksimal 4 MB — kompres dulu atau pilih gambar lebih kecil.",
      });
      return;
    }
    try {
      apply(await readFileAsDataUrl(f));
    } catch {
      showNotice({ type: "error", title: "Gagal Memuat Gambar", message: "Coba file lain ya." });
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

  /** Editor daftar item promo (tambah/hapus, maks 6) */
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
            <button
              type="button"
              onClick={() =>
                setState((s) => ({
                  ...s,
                  items: s.items.length > 1 ? s.items.filter((_, idx) => idx !== i) : s.items,
                }))
              }
              disabled={state.items.length <= 1}
              aria-label={`Hapus item ${i + 1}`}
              title="Hapus item"
              className="press-effect flex h-10 w-9 shrink-0 items-center justify-center rounded-xl border border-red-100 bg-red-50 text-red-500 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() =>
              setState((s) =>
                s.items.length < MAX_ITEMS
                  ? { ...s, items: [...s.items, { emoji: "🍗", name: "Menu Baru", price: 10000 }] }
                  : s
              )
            }
            disabled={state.items.length >= MAX_ITEMS}
            className="press-effect rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-[11px] font-black text-orange-600 hover:bg-orange-50 disabled:opacity-40"
          >
            + Tambah Item ({state.items.length}/{MAX_ITEMS})
          </button>
          <p className="text-[10px] text-neutral-400">Kolom: emoji • nama • harga asli (dicoret) • promo.</p>
        </div>
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
          {/* Sumber QR "Pesan di App" — kanvas tersembunyi digambar ke poster */}
          {state.showQr && qrValue && (
            <div
              id="poster-qr-src"
              aria-hidden="true"
              className="pointer-events-none fixed -left-[9999px] top-0 opacity-0"
            >
              <QRCodeCanvas value={qrValue} size={240} marginSize={0} level="M" />
            </div>
          )}

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
                    Canggih: logo, foto latar, QR, 7 tema, caption otomatis
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

              {/* Aksi pintar: isi otomatis + acak gaya + reset */}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={autoFill}
                  disabled={!dataReady}
                  className="press-effect flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-600 to-rose-500 text-[12px] font-extrabold text-white shadow-lg shadow-orange-500/30 hover:opacity-95 disabled:opacity-50"
                >
                  {dataReady ? <Wand2 className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                  {dataReady ? "Isi Otomatis ✨" : "Memuat Data…"}
                </button>
                <button
                  type="button"
                  onClick={randomize}
                  className="press-effect flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-orange-200 bg-white text-[12px] font-black text-orange-600 hover:bg-orange-50"
                >
                  <Dice5 className="h-4 w-4" /> Acak Gaya
                </button>
                <button
                  type="button"
                  onClick={resetAll}
                  aria-label="Reset ke contoh awal"
                  title="Reset ke contoh awal"
                  className="press-effect flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>

              {/* Pratinjau */}
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-neutral-500">
                  <ImageIcon className="h-3.5 w-3.5" /> Pratinjau {rendering && <RefreshCw className="h-3 w-3 animate-spin" />}
                  <span className="ml-auto font-bold normal-case text-emerald-500">draf tersimpan otomatis</span>
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
                        state.theme === t && !state.customColor
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
                {/* Warna kustom dua gradasi */}
                <label className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={state.customColor}
                    onChange={(e) => set("customColor", e.target.checked)}
                    className="h-4 w-4 accent-orange-600"
                  />
                  <span className="text-[12px] font-black text-neutral-700">Warna Sendiri (dua gradasi)</span>
                </label>
                {state.customColor && (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={state.colA}
                      onChange={(e) => set("colA", e.target.value)}
                      aria-label="Warna gradasi awal"
                      className="h-9 w-full rounded-xl border border-orange-200 bg-white"
                    />
                    <input
                      type="color"
                      value={state.colB}
                      onChange={(e) => set("colB", e.target.value)}
                      aria-label="Warna gradasi akhir"
                      className="h-9 w-full rounded-xl border border-orange-200 bg-white"
                    />
                  </div>
                )}
              </div>

              {/* Pola latar + gaya font */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Pola Latar</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(PATTERNS) as PatternChoice[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => set("pattern", p)}
                        className={cn(
                          "press-effect rounded-xl border px-2 py-1.5 text-[11px] font-black transition",
                          state.pattern === p
                            ? "border-orange-500 bg-orange-50 text-orange-700 ring-2 ring-orange-200"
                            : "border-orange-100 bg-white text-neutral-600 hover:border-orange-300"
                        )}
                      >
                        {PATTERNS[p].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Gaya Font</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(Object.keys(FONTS) as FontChoice[]).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => set("font", f)}
                        className={cn(
                          "press-effect rounded-xl border px-2 py-1.5 text-[11px] font-black transition",
                          state.font === f
                            ? "border-orange-500 bg-orange-50 text-orange-700 ring-2 ring-orange-200"
                            : "border-orange-100 bg-white text-neutral-600 hover:border-orange-300"
                        )}
                      >
                        {FONTS[f].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Logo toko & foto latar */}
              <div className="space-y-2">
                <p className="text-[11px] font-black uppercase tracking-wide text-neutral-500">Logo &amp; Foto Latar</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-orange-100 bg-orange-50/50 p-2.5">
                    <p className="mb-1.5 flex items-center gap-1 text-[10px] font-black text-neutral-600">
                      <Upload className="h-3 w-3" /> Logo Toko
                    </p>
                    <div className="flex items-center gap-2">
                      {state.showLogo && state.logoDataUrl ? (
                        <>
                          <img
                            src={state.logoDataUrl}
                            alt="Pratinjau logo toko"
                            className="h-10 w-10 rounded-lg bg-white object-contain shadow-sm ring-1 ring-black/5"
                          />
                          <button
                            type="button"
                            onClick={() => set("logoDataUrl", null)}
                            aria-label="Lepas logo"
                            className="press-effect flex h-8 w-8 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => logoFileRef.current?.click()}
                          className="press-effect flex h-9 flex-1 items-center justify-center gap-1 rounded-xl border border-dashed border-orange-300 bg-white text-[11px] font-black text-orange-600"
                        >
                          <Upload className="h-3.5 w-3.5" /> Unggah
                        </button>
                      )}
                    </div>
                    <input
                      ref={logoFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => void pickImage(e, (d) => { set("showLogo", true); set("logoDataUrl", d); })}
                    />
                  </div>
                  <div className="rounded-2xl border border-orange-100 bg-orange-50/50 p-2.5">
                    <p className="mb-1.5 flex items-center gap-1 text-[10px] font-black text-neutral-600">
                      <ImageIcon className="h-3 w-3" /> Foto Latar
                    </p>
                    <div className="flex items-center gap-2">
                      {state.bgDataUrl ? (
                        <>
                          <img
                            src={state.bgDataUrl}
                            alt="Pratinjau foto latar"
                            className="h-10 w-14 rounded-lg bg-white object-cover shadow-sm ring-1 ring-black/5"
                          />
                          <button
                            type="button"
                            onClick={() => set("bgDataUrl", null)}
                            aria-label="Lepas foto latar"
                            className="press-effect flex h-8 w-8 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => bgFileRef.current?.click()}
                          className="press-effect flex h-9 flex-1 items-center justify-center gap-1 rounded-xl border border-dashed border-orange-300 bg-white text-[11px] font-black text-orange-600"
                        >
                          <Upload className="h-3.5 w-3.5" /> Unggah
                        </button>
                      )}
                    </div>
                    <input
                      ref={bgFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => void pickImage(e, (d) => set("bgDataUrl", d))}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-neutral-400">
                  Gambar diproses di perangkatmu (tidak diunggah ke mana pun) — maks 4 MB.
                </p>
              </div>

              {/* QR & tanda air */}
              <div className="space-y-2 rounded-2xl border border-orange-100 bg-orange-50/50 p-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={state.showQr}
                    onChange={(e) => set("showQr", e.target.checked)}
                    className="h-4 w-4 accent-orange-600"
                  />
                  <span className="flex items-center gap-1 text-[12px] font-black text-neutral-700">
                    <QrCode className="h-3.5 w-3.5 text-orange-600" /> QR "Pesan di App" (arahkan ke halaman
                    unduh aplikasi)
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={state.watermark}
                    onChange={(e) => set("watermark", e.target.checked)}
                    className="h-4 w-4 accent-orange-600"
                  />
                  <span className="text-[12px] font-black text-neutral-700">Tanda air brand AGSI</span>
                </label>
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

              {/* Caption promosi siap-tempel */}
              <div className="space-y-2 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-neutral-500">
                  <Copy className="h-3.5 w-3.5" /> Caption WA/IG Otomatis
                </p>
                <pre className="scrollbar-slim max-h-36 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white px-3 py-2 text-[11px] leading-relaxed text-neutral-600 ring-1 ring-emerald-100">
                  {caption}
                </pre>
                <button
                  type="button"
                  onClick={() => void copyCaption()}
                  className="press-effect flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-[12px] font-black text-white shadow-md shadow-emerald-500/30 hover:bg-emerald-700"
                >
                  <Copy className="h-4 w-4" /> Salin Caption
                </button>
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
