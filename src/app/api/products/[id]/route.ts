import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { serializeProduct } from "@/lib/types";
import { parseImageDataUrl } from "../route";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!isAdminRole(user?.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body = await req.json();
    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
    }

    // Gambar: undefined = biarkan apa adanya, null = hapus, string data-URL = ganti
    let image: { imageData?: string | null; imageMime?: string | null };
    if (body.imageData === undefined) {
      image = {};
    } else if (body.imageData === null) {
      image = { imageData: null, imageMime: null };
    } else {
      const parsed = parseImageDataUrl(body.imageData);
      if ("error" in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      image = { imageData: parsed.base64, imageMime: parsed.mime };
    }

    const product = await db.product.update({
      where: { id },
      data: {
        name: body.name !== undefined ? String(body.name).trim() : undefined,
        description: body.description !== undefined ? String(body.description).trim() : undefined,
        price: body.price !== undefined ? Math.max(0, Math.round(Number(body.price))) : undefined,
        category: body.category !== undefined ? String(body.category) : undefined,
        emoji: body.emoji !== undefined ? String(body.emoji).slice(0, 8) : undefined,
        imageColor: body.imageColor !== undefined ? String(body.imageColor) : undefined,
        spicy: body.spicy !== undefined ? Math.min(5, Math.max(0, Math.round(Number(body.spicy)))) : undefined,
        available: body.available !== undefined ? Boolean(body.available) : undefined,
        popular: body.popular !== undefined ? Boolean(body.popular) : undefined,
        ...image,
      },
    });
    return NextResponse.json({ product: serializeProduct(product) });
  } catch (err) {
    console.error("[PUT /api/products/[id]] error:", err);
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!isAdminRole(user?.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Produk tidak ditemukan." }, { status: 404 });
    }
    await db.product.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Produk tidak dapat dihapus karena sudah pernah masuk pesanan. Nonaktifkan saja." },
      { status: 409 }
    );
  }
}
