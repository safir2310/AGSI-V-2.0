"use client";

import type { Product } from "@/lib/types";
import { productImageUrl } from "@/lib/types";
import { cn } from "@/lib/utils";

type ThumbProduct = Pick<Product, "id" | "updatedAt" | "emoji" | "imageColor" | "hasImage"> & {
  name?: string;
};

type ProductThumbProps = {
  product: ThumbProduct;
  /** kelas untuk pembungkus (menentukan ukuran & sudut) */
  className?: string;
  /** kelas tambahan untuk <img> */
  imgClassName?: string;
  /** kelas tambahan untuk emoji fallback */
  emojiClassName?: string;
  rounded?: string;
};

/**
 * Thumbnail menu: tampilkan foto upload bila ada,
 * kalau tidak jatuh kembali ke emoji di atas gradasi warna produk.
 */
export function ProductThumb({
  product,
  className,
  imgClassName,
  emojiClassName,
  rounded = "rounded-xl",
}: ProductThumbProps) {
  if (product.hasImage) {
    return (
      <div className={cn("relative shrink-0 overflow-hidden bg-orange-50", rounded, className)}>
        { }
        <img
          src={productImageUrl(product)}
          alt={product.name ?? "Foto menu"}
          loading="lazy"
          className={cn("h-full w-full object-cover", imgClassName)}
        />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center",
        rounded,
        className
      )}
      style={{ background: `linear-gradient(140deg, ${product.imageColor}22, ${product.imageColor}44)` }}
    >
      <span className={cn(emojiClassName)}>{product.emoji}</span>
    </div>
  );
}
