import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  ensureMemberCode,
  MIN_REDEEM_POINTS,
  POINTS_EARN_PER_STEP,
  POINTS_EARN_STEP,
  POINT_TIERS,
  REDEEM_UNIT_POINTS,
  REDEEM_UNIT_VALUE,
} from "@/lib/points";
import { isVoucherExpired } from "@/lib/voucher";
import type { MemberCardData } from "@/lib/types";

/**
 * GET /api/member/card — data lengkap kartu member.
 * Berisi identitas (nama, kode member untuk barcode), saldo poin, tier
 * penukaran, riwayat mutasi poin, dan voucher pribadi hasil tukar poin.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  }

  try {
    const memberCode = await ensureMemberCode(user.id);
    const fresh = await db.user.findUnique({
      where: { id: user.id },
      select: { name: true, email: true, points: true, createdAt: true },
    });

    const [transactions, vouchers, redeems] = await Promise.all([
      db.pointTransaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.voucher.findMany({
        where: { ownerId: user.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      db.pointTransaction.findMany({
        where: { userId: user.id, type: "REDEEM", voucherId: { not: null } },
        select: { voucherId: true, points: true },
      }),
    ]);

    const pointsByVoucher = new Map(
      redeems.map((r) => [r.voucherId as string, Math.abs(r.points)])
    );

    const data: MemberCardData = {
      name: fresh?.name ?? user.name,
      email: fresh?.email ?? user.email,
      memberCode,
      points: fresh?.points ?? user.points,
      memberSince: (fresh?.createdAt ?? new Date()).toISOString(),
      earnStep: POINTS_EARN_STEP,
      earnStepPoints: POINTS_EARN_PER_STEP,
      redeemUnitPoints: REDEEM_UNIT_POINTS,
      redeemUnitValue: REDEEM_UNIT_VALUE,
      minRedeem: MIN_REDEEM_POINTS,
      tiers: POINT_TIERS.map(({ id, points, value }) => ({ id, points, value })),
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type === "REDEEM" ? "REDEEM" : "EARN",
        points: t.points,
        description: t.description,
        createdAt: t.createdAt.toISOString(),
      })),
      vouchers: vouchers.map((v) => ({
        id: v.id,
        code: v.code,
        value: v.value,
        points: pointsByVoucher.get(v.id) ?? 0,
        expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
        used: v.usedCount >= v.quota,
        expired: isVoucherExpired(v),
      })),
    };

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
