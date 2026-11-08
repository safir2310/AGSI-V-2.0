import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/products/[id]/image
 * Menyajikan foto menu yang diupload admin. Publik (menu memang publik).
 * URL memakai query ?v=<updatedAt> sebagai cache-buster — aman untuk cache lama.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const p = await db.product.findUnique({
    where: { id },
    select: { imageData: true, imageMime: true },
  });
  if (!p?.imageData || !p.imageMime) {
    return new NextResponse("Gambar tidak ditemukan", { status: 404 });
  }
  const buf = Buffer.from(p.imageData, "base64");
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": p.imageMime,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
