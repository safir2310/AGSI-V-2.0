import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decodeStoredMedia } from "@/lib/serve-image";

/**
 * GET /api/settings/menu-hero/image
 * Menyajikan gambar latar hero banner halaman Menu yang diupload admin.
 * Publik (halaman Menu memang halaman publik pelanggan). URL memakai query
 * ?v=<menuHeroUpdatedAt> sebagai cache-buster — aman untuk cache lama.
 *
 * Mime TIDAK wajib di kolom: baris lama tetap tersaji — Content-Type
 * ditebak dari magic bytes.
 */
export async function GET(_req: NextRequest) {
  let s: { menuHeroImageData: string | null; menuHeroImageMime: string | null } | null;
  try {
    s = await db.storeSetting.findUnique({
      where: { id: "main" },
      select: { menuHeroImageData: true, menuHeroImageMime: true },
    });
  } catch {
    // Kegagalan koneksi DB sesaat (serverless) → 503 tanpa cache agar
    // peramban mencoba lagi, bukan 500 yang membuat gambar tampak rusak.
    return new NextResponse("Sedang sibuk — coba lagi sebentar", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!s?.menuHeroImageData) {
    return new NextResponse("Gambar hero menu tidak ditemukan", { status: 404 });
  }
  const dec = decodeStoredMedia(s.menuHeroImageData, s.menuHeroImageMime, "image");
  if (!dec) {
    return new NextResponse("Gambar hero menu tidak ditemukan", { status: 404 });
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
