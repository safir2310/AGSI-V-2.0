import { NextRequest, NextResponse } from "next/server";
import { getVideoPromoSlotBytes } from "@/lib/store-settings";
import { decodeStoredMedia } from "@/lib/serve-image";

/**
 * GET /api/settings/video-promo/video?slot=1..3&v=<versi>
 * Menyajikan video MP4 slide AGSI Smart Video Promo Banner. Publik — dasar
 * halaman Menu adalah halaman publik pelanggan. Query ?v= (versi konten)
 * adalah cache-buster: admin mengganti video → URL baru → cache lama aman.
 *
 * Mendukung permintaan Range (bytes=start-end) karena Safari/iOS menolak
 * memutar <video> tanpa dukungan 206 Partial Content; Chrome/Android memutar
 * baik-baik saja baik 200 maupun 206.
 */
export async function GET(req: NextRequest) {
  const slot = Number(new URL(req.url).searchParams.get("slot") ?? "1");
  if (slot !== 1 && slot !== 2 && slot !== 3) {
    return new NextResponse("Slide video tidak ditemukan", { status: 404 });
  }
  let data: string | null;
  let mime: string | null;
  try {
    ({ data, mime } = await getVideoPromoSlotBytes(slot));
  } catch {
    // Kegagalan koneksi DB sesaat (serverless) → 503 tanpa cache agar
    // peramban mencoba lagi, bukan 500 yang membuat video tampak rusak.
    return new NextResponse("Sedang sibuk — coba lagi sebentar", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!data) {
    return new NextResponse("Video tidak ditemukan", { status: 404 });
  }
  const dec = decodeStoredMedia(data, mime, "video");
  if (!dec) {
    return new NextResponse("Video tidak ditemukan", { status: 404 });
  }

  const buf = dec.buf;
  const total = buf.byteLength;
  const contentType = dec.contentType;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  const range = req.headers.get("range");
  const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (match) {
    let start = match[1] === "" ? 0 : Number(match[1]);
    let end = match[2] === "" ? Number.NaN : Number(match[2]);
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (start > end || start >= total) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }
    return new NextResponse(new Uint8Array(buf.subarray(start, end + 1)), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: { ...headers, "Content-Length": String(total) },
  });
}
