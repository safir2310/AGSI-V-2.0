import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/settings/menu-promo/image?slot=1|2
 * Menyajikan gambar latar banner promo custom (slot 1 & 2) di carousel
 * halaman Menu yang diupload admin. Publik (halaman Menu memang halaman
 * publik pelanggan). URL memakai query ?v=<versi konten banner promo> sebagai
 * cache-buster — aman untuk cache lama.
 */
export async function GET(req: NextRequest) {
  const slotParam = new URL(req.url).searchParams.get("slot");
  const slot = slotParam === "2" ? 2 : 1;
  const s = await db.storeSetting.findUnique({
    where: { id: "main" },
    select: {
      menuPromoBanner1ImageData: true,
      menuPromoBanner1ImageMime: true,
      menuPromoBanner2ImageData: true,
      menuPromoBanner2ImageMime: true,
    },
  });
  const data = slot === 1 ? s?.menuPromoBanner1ImageData : s?.menuPromoBanner2ImageData;
  const mime = slot === 1 ? s?.menuPromoBanner1ImageMime : s?.menuPromoBanner2ImageMime;
  if (!data || !mime) {
    return new NextResponse(`Gambar banner promo slot ${slot} tidak ditemukan`, { status: 404 });
  }
  const buf = Buffer.from(data, "base64");
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
