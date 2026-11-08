import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/settings/menu-hero/image
 * Menyajikan gambar latar hero banner halaman Menu yang diupload admin.
 * Publik (halaman Menu memang halaman publik pelanggan). URL memakai query
 * ?v=<menuHeroUpdatedAt> sebagai cache-buster — aman untuk cache lama.
 */
export async function GET(_req: NextRequest) {
  const s = await db.storeSetting.findUnique({
    where: { id: "main" },
    select: { menuHeroImageData: true, menuHeroImageMime: true },
  });
  if (!s?.menuHeroImageData || !s.menuHeroImageMime) {
    return new NextResponse("Gambar hero menu tidak ditemukan", { status: 404 });
  }
  const buf = Buffer.from(s.menuHeroImageData, "base64");
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": s.menuHeroImageMime,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
