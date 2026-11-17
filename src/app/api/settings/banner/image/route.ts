import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decodeStoredMedia } from "@/lib/serve-image";

/**
 * GET /api/settings/banner/image
 * Menyajikan gambar popup banner beranda yang diupload admin. Publik
 * (Beranda memang halaman publik pelanggan). URL memakai query
 * ?v=<bannerUpdatedAt> sebagai cache-buster — aman untuk cache lama.
 *
 * Mime TIDAK wajib di kolom: baris lama (build sebelum mime ditulis
 * bersamaan) tetap tersaji — Content-Type ditebak dari magic bytes.
 */
export async function GET(_req: NextRequest) {
  let s: { bannerImageData: string | null; bannerImageMime: string | null } | null;
  try {
    s = await db.storeSetting.findUnique({
      where: { id: "main" },
      select: { bannerImageData: true, bannerImageMime: true },
    });
  } catch {
    // Kegagalan koneksi DB sesaat (serverless) → 503 tanpa cache agar
    // peramban mencoba lagi, bukan 500 yang membuat gambar tampak rusak.
    return new NextResponse("Sedang sibuk — coba lagi sebentar", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!s?.bannerImageData) {
    return new NextResponse("Gambar banner tidak ditemukan", { status: 404 });
  }
  const dec = decodeStoredMedia(s.bannerImageData, s.bannerImageMime, "image");
  if (!dec) {
    return new NextResponse("Gambar banner tidak ditemukan", { status: 404 });
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
