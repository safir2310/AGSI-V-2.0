import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/settings/banner/image
 * Menyajikan gambar popup banner beranda yang diupload admin. Publik
 * (Beranda memang halaman publik pelanggan). URL memakai query
 * ?v=<bannerUpdatedAt> sebagai cache-buster — aman untuk cache lama.
 */
export async function GET(_req: NextRequest) {
  const s = await db.storeSetting.findUnique({
    where: { id: "main" },
    select: { bannerImageData: true, bannerImageMime: true },
  });
  if (!s?.bannerImageData || !s.bannerImageMime) {
    return new NextResponse("Gambar banner tidak ditemukan", { status: 404 });
  }
  const buf = Buffer.from(s.bannerImageData, "base64");
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": s.bannerImageMime,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
