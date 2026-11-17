import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import {
  getVideoPromoSettings,
  getVideoPromoSlotBytes,
  VIDEO_PROMO_MAX_BYTES,
  writeVideoPromoSlotBytes,
} from "@/lib/store-settings";

/**
 * PUT /api/settings/video-promo — kelola bytes video AGSI Smart Video Promo
 * Banner (KHUSUS Admin/Owner). Metadata slide (judul, tautan, saklar) lewat
 * PUT /api/settings (body videoPromoEnabled/videoPromoSlides).
 *
 * Video MP4 diunggah BERTAHAP (chunked) karena serverless Vercel membatasi
 * ukuran body request (±4.5 MB) — file dipecah client menjadi potongan
 * base64 ±2.5 MB lalu di-append berurutan:
 *
 * Body:
 *  { action: "upload", slot: 1..3, chunk: "<base64>", final?: boolean, mime?: "video/mp4" }
 *    → potongan di-append ke kolom data slot; saat `final`, mime disimpan dan
 *      versi konten naik (URL video ?v= berubah → cache pelanggan segar).
 *  { action: "remove", slot: 1..3 }
 *    → hapus bytes video slot + naikkan versi.
 *
 * Respons: setelan videoPromo terbaru (tanpa bytes video).
 */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  try {
    const body = (await req.json()) as {
      action?: string;
      slot?: number;
      chunk?: string;
      final?: boolean;
      mime?: string;
    };

    if (body.action === "upload") {
      const slot = Number(body.slot);
      if (slot !== 1 && slot !== 2 && slot !== 3) {
        return NextResponse.json({ error: "Slot harus 1, 2, atau 3." }, { status: 400 });
      }
      const chunk = typeof body.chunk === "string" ? body.chunk : "";
      if (!chunk || !/^[A-Za-z0-9+/=\s]+$/.test(chunk)) {
        return NextResponse.json({ error: "Potongan video tidak valid." }, { status: 400 });
      }
      // Batas ukuran total per slide (base64 ≈ 4/3 × bytes)
      const existing = await getVideoPromoSlotBytes(slot);
      const maxBase64 = Math.ceil((VIDEO_PROMO_MAX_BYTES * 4) / 3) + 8192;
      if ((existing.data?.length ?? 0) + chunk.length > maxBase64) {
        return NextResponse.json(
          { error: "Video terlalu besar — maksimal 30 MB per slide." },
          { status: 413 }
        );
      }
      const final = body.final === true;
      let mime = existing.mime;
      if (final) {
        const declared = typeof body.mime === "string" ? body.mime : "video/mp4";
        mime = declared.startsWith("video/") ? declared : "video/mp4";
      }
      await writeVideoPromoSlotBytes(slot, (existing.data ?? "") + chunk, mime);
      return NextResponse.json(await getVideoPromoSettings());
    }

    if (body.action === "remove") {
      const slot = Number(body.slot);
      if (slot !== 1 && slot !== 2 && slot !== 3) {
        return NextResponse.json({ error: "Slot harus 1, 2, atau 3." }, { status: 400 });
      }
      await writeVideoPromoSlotBytes(slot, null, null);
      return NextResponse.json(await getVideoPromoSettings());
    }

    return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch {
    return NextResponse.json(
      { error: "Gagal memproses video promo." },
      { status: 500 }
    );
  }
}
