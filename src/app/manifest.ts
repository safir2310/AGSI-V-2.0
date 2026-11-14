import type { MetadataRoute } from "next";

/**
 * MANIFEST PWA AGSI — menyajikan /manifest.webmanifest.
 *
 * Fungsi:
 *  - Install PWA (Add to Home Screen / banner instalasi Chrome) di Android,
 *    dengan ikon 192 & 512 + varian MASKABLE (ikon ber-safe-zone: logo
 *    tidak terpotong lingkaran/bulat masker launcher Android).
 *  - Prasyarat publikasi ke Play Store: alat pembungkus (PWABuilder/
 *    Bubblewrap) membaca manifest ini untuk metadata nama & ikon toko.
 *  - Metadata tampilan: standalone (tanpa bilah URL), orientasi portrait,
 *    warna tema oranye AGSI.
 *
 * File ikon: public/push-icon-192.png, public/push-icon-512.png,
 * public/icon-192-maskable.png, public/icon-512-maskable.png
 * (dibuat scripts/make-store-assets.py).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ayam Geprek Sambal Ijo — AGSI",
    short_name: "AGSI",
    description:
      "Pesan ayam geprek sambal ijo favoritmu: menu, keranjang, pesanan, dan profil dalam satu aplikasi. Ada mode Admin & POS Kasir untuk kelola bisnis.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "id",
    dir: "ltr",
    background_color: "#FFF7ED",
    theme_color: "#F97316",
    categories: ["food", "shopping", "business"],
    icons: [
      { src: "/push-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/push-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
