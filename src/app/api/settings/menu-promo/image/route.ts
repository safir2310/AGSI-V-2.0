import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decodeStoredMedia } from "@/lib/serve-image";

/**
 * GET /api/settings/menu-promo/image?slot=1|2
 * Menyajikan gambar latar banner promo custom (slot 1 & 2) di carousel
 * halaman Menu yang diupload admin. Publik (halaman Menu memang halaman
 * publik pelanggan). URL memakai query ?v=<versi konten banner promo> sebagai
 * cache-buster — aman untuk cache lama.
 *
 * Mime TIDAK wajib di kolom: baris lama tetap tersaji — Content-Type
 * ditebak dari magic bytes.
 */
export async function GET(req: NextRequest) {
  const slotParam = new URL(req.url).searchParams.get("slot");
  const slot = slotParam === "2" ? 2 : 1;
  let s: {
    menuPromoBanner1ImageData: string | null;
    menuPromoBanner1ImageMime: string | null;
    menuPromoBanner2ImageData: string | null;
    menuPromoBanner2ImageMime: string | null;
  } | null;
  try {
    s = await db.storeSetting.findUnique({
      where: { id: "main" },
      select: {
        menuPromoBanner1ImageData: true,
        menuPromoBanner1ImageMime: true,
        menuPromoBanner2ImageData: true,
        menuPromoBanner2ImageMime: true,
      },
    });
  } catch {
    // Kegagalan koneksi DB sesaat (serverless) → 503 tanpa cache agar
    // peramban mencoba lagi, bukan 500 yang membuat gambar tampak rusak.
    return new NextResponse("Sedang sibuk — coba lagi sebentar", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const data = slot === 1 ? s?.menuPromoBanner1ImageData : s?.menuPromoBanner2ImageData;
  const mime = slot === 1 ? s?.menuPromoBanner1ImageMime : s?.menuPromoBanner2ImageMime;
  if (!data) {
    return new NextResponse(`Gambar banner promo slot ${slot} tidak ditemukan`, { status: 404 });
  }
  const dec = decodeStoredMedia(data, mime, "image");
  if (!dec) {
    return new NextResponse(`Gambar banner promo slot ${slot} tidak ditemukan`, { status: 404 });
  }
  return new NextResponse(new Uint8Array(dec.buf), {
    status: 200,
    headers: {
      "Content-Type": dec.contentType,
      "Content-Length": String(dec.buf.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
