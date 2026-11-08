import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Matikan indikator dev tools — overlaynya menutupi navigasi bawah aplikasi
  devIndicators: false,
  // IZINKAN origin pratinjau: panel preview menjalankan aplikasi dari domain
  // *.space-z.ai (iframe lintas-origin). Tanpa ini Next 16 menolak koneksi
  // HMR/Fast Refresh lintas-origin → update modul terkirim setengah jalan
  // dan merusak fiber-tree React ("Should not already be working.").
  // Entri "agsi"/"*.agsi" = nama alias proyek AGSI (permintaan pemilik):
  // bila aplikasi diakses lewat domain agsi, koneksi dev juga diizinkan.
  // CATATAN: entri *.space-z.ai WAJIB tetap ada — itu domain infrastruktur
  // panel preview; menghapusnya membuat halaman preview gagal dimuat.
  allowedDevOrigins: ["agsi", "*.agsi", "space-z.ai", "*.space-z.ai"],
};

export default nextConfig;
