import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  findPointTier,
  generatePointVoucherCode,
  MIN_REDEEM_POINTS,
  REDEEM_VOUCHER_DAYS,
  voucherValueForPoints,
} from "@/lib/points";
import { formatIDR } from "@/lib/types";

/**
 * POST /api/member/redeem — tukar poin jadi voucher OTOMATIS.
 * Body (pilih salah satu):
 *   { tierId: "P100" | "P500" | "P1000" | "P5000" }  → paket penukaran cepat
 *   { points: <angka> }                              → jumlah poin bebas
 *     (dipakai tombol "Tukar Semua Poin" — kirim seluruh saldo)
 *
 * Rate resmi: 1 poin = Rp 1 → 100 poin = voucher Rp 100. Nominal voucher
 * SELALU mengikuti jumlah poin yang ditukar.
 *
 * Sistem membuat voucher pribadi (FIXED, sekali pakai, berlaku 90 hari),
 * mencatat mutasi REDEEM, dan memotong saldo. Semua dalam SATU transaksi
 * database — saldo tidak mungkin minus walau permintaan dikirim bersamaan.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  }

  try {
    const body = await req.json();

    // ===== Tentukan jumlah poin yang ditukar (tier cepat ATAU nominal bebas) =====
    let points: number;
    if (body?.points != null) {
      const raw = Number(body.points);
      if (!Number.isFinite(raw) || Math.floor(raw) !== raw || raw < MIN_REDEEM_POINTS) {
        return NextResponse.json(
          {
            error: `Tukar minimal ${MIN_REDEEM_POINTS.toLocaleString("id-ID")} poin (voucher ${formatIDR(
              voucherValueForPoints(MIN_REDEEM_POINTS)
            )}).`,
          },
          { status: 400 }
        );
      }
      points = raw;
    } else {
      const tier = findPointTier(body?.tierId);
      if (!tier) {
        return NextResponse.json({ error: "Pilihan tukar poin tidak valid." }, { status: 400 });
      }
      points = tier.points;
    }
    const value = voucherValueForPoints(points);

    const result = await db.$transaction(async (tx) => {
      // Baca ulang saldo DI DALAM transaksi (anti balapan dua klik bersamaan)
      const fresh = await tx.user.findUnique({
        where: { id: user.id },
        select: { points: true, name: true },
      });
      const balance = fresh?.points ?? 0;
      if (balance < points) {
        throw new Error(
          `Poinmu belum cukup — butuh ${points.toLocaleString("id-ID")} poin, saldo kamu ${balance.toLocaleString("id-ID")} poin.`
        );
      }

      // Buat voucher pribadi dengan kode unik (coba ulang bila bertabrakan)
      let voucher: { id: string; code: string } | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = generatePointVoucherCode();
        try {
          voucher = await tx.voucher.create({
            data: {
              code,
              title: `Voucher ${formatIDR(value)}`,
              description: `Hasil tukar ${points.toLocaleString("id-ID")} poin member — berlaku ${REDEEM_VOUCHER_DAYS} hari.`,
              type: "FIXED",
              value,
              minPurchase: 0,
              quota: 1,
              isActive: true,
              ownerId: user.id,
              expiresAt: new Date(Date.now() + REDEEM_VOUCHER_DAYS * 24 * 60 * 60 * 1000),
            },
            select: { id: true, code: true },
          });
          break;
        } catch {
          // kode kembar (nyaris mustahil) — coba lagi
        }
      }
      if (!voucher) {
        throw new Error("Gagal membuat kode voucher. Coba lagi sebentar ya.");
      }

      // Catat mutasi REDEEM + potong saldo secara atomik
      await tx.pointTransaction.create({
        data: {
          userId: user.id,
          type: "REDEEM",
          points: -points,
          voucherId: voucher.id,
          description: `Tukar ${points.toLocaleString("id-ID")} poin → voucher ${formatIDR(value)}`,
        },
      });
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { points: { decrement: points } },
        select: { points: true },
      });

      return {
        voucher: {
          code: voucher.code,
          value,
          points,
          expiresAt: new Date(Date.now() + REDEEM_VOUCHER_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        },
        points: updated.points,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
