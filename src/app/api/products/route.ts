import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { serializeProduct } from "@/lib/types";

/** Batas ukuran gambar: ~2 MB dalam base64 (±1.5 MB file asli) */
const MAX_BASE64_LEN = 2_000_000;

/** Validasi & parse data URL gambar hasil upload (cth: "data:image/jpeg;base64,...") */
export function parseImageDataUrl(
  value: unknown
): { mime: string; base64: string } | { error: string } {
  if (typeof value !== "string") return { error: "Format gambar tidak valid." };
  const m = value.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: "Gambar harus berformat JPG, PNG, WEBP, atau GIF." };
  const [, mime, base64] = m;
  if (base64.length > MAX_BASE64_LEN) {
    return { error: "Gambar terlalu besar (maksimal ±1,5 MB setelah dikompres)." };
  }
  return { mime, base64 };
}

export async function GET() {
  const products = await db.product.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
  // Jangan kirim bytes gambar di daftar — klien memuatnya via /api/products/[id]/image
  return NextResponse.json({ products: products.map(serializeProduct) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!isAdminRole(user?.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  try {
    const body = await req.json();
    if (!body.name || !body.price || !body.category) {
      return NextResponse.json(
        { error: "Nama, harga, dan kategori wajib diisi." },
        { status: 400 }
      );
    }
    let image: { imageData: string; imageMime: string } | undefined;
    if (body.imageData != null) {
      const parsed = parseImageDataUrl(body.imageData);
      if ("error" in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      image = { imageData: parsed.base64, imageMime: parsed.mime };
    }
    const product = await db.product.create({
      data: {
        name: String(body.name).trim(),
        description: String(body.description ?? "").trim(),
        price: Math.max(0, Math.round(Number(body.price))),
        category: String(body.category),
        emoji: String(body.emoji ?? "🍗").slice(0, 8),
        imageColor: String(body.imageColor ?? "#F97316"),
        spicy: Math.min(5, Math.max(0, Math.round(Number(body.spicy ?? 0)))),
        available: body.available !== false,
        popular: body.popular === true,
        ...image,
      },
    });
    return NextResponse.json({ product: serializeProduct(product) });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
