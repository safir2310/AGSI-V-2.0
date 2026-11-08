/**
 * SYARAT & KETENTUAN PENGGUNAAN APLIKASI — AGSI (Ayam Geprek Sambal Ijo).
 *
 * Sumber TUNGGAL isi S&K: dipakai popup persetujuan (pengguna baru / versi
 * baru) dan sheet "Syarat & Kebijakan Aplikasi" di halaman Profil.
 * Berpasangan dengan Kebijakan Penggunaan Data (src/lib/data-policy.ts) —
 * keduanya harus disetujui agar pengguna bisa memakai aplikasi.
 *
 * Naikkan APP_TERMS_VERSION bila isi berubah material — semua pengguna yang
 * tersimpan dengan versi lama otomatis diminta menyetujui ulang.
 * Aman dipakai di client (tidak mengimpor db/server).
 */

export const APP_TERMS_VERSION = "2026.11";
/** Tanggal berlaku S&K ini (tampil di popup & sheet) */
export const APP_TERMS_UPDATED = "7 November 2026";

import type { DataPolicySection } from "@/lib/data-policy";

export const APP_TERMS_SECTIONS: DataPolicySection[] = [
  {
    title: "1. Tentang Aplikasi",
    paragraphs: [
      "AGSI adalah aplikasi pemesanan Ayam Geprek Sambal Ijo: makan di tempat, bawa pulang (take away), dan antar ke alamat, lengkap dengan akun member, poin, voucher, dan chat CS.",
      "Dengan mendaftar dan memakai aplikasi, kamu dianggap telah membaca, memahami, dan menyetujui seluruh syarat ini.",
    ],
  },
  {
    title: "2. Akun & Keamanan",
    paragraphs: [
      "Isi data akun dengan benar (nama & nomor HP aktif) agar pesanan dan pengantaran bisa diproses. Kamu bertanggung jawab menjaga kerahasiaan password dan seluruh aktivitas yang terjadi di akunmu.",
      "Akun yang terbukti menyalahgunakan layanan (pesanan palsu, penipuan pembayaran, penyalahgunaan voucher/poin) dapat dibatasi atau dinonaktifkan.",
    ],
  },
  {
    title: "3. Pemesanan & Pembayaran",
    paragraphs: [
      "Pesanan dianggap sah setelah pembayaran diterima: tunai di kasir, atau QRIS yang terverifikasi otomatis oleh sistem. Kode QRIS memiliki batas waktu — kedaluwarsa berarti hangus dan pesanan dibatalkan otomatis.",
      "Harga, isi menu, dan ketersediaan dapat berubah sewaktu-waktu sesuai kondisi toko.",
    ],
  },
  {
    title: "4. Pembatalan & Keterlambatan",
    paragraphs: [
      "Pembatalan hanya bisa dilakukan selama pesanan belum diproses dapur (status \"Menunggu\"). Setelah dimasak, pesanan tidak dapat dibatalkan.",
      "Waktu penyajian/pengantaran adalah perkiraan. Bila terlambat atau ada masalah, hubungi tim CS lewat chat — kami bantu carikan solusi terbaik.",
    ],
  },
  {
    title: "5. Pengambilan & Pengantaran",
    paragraphs: [
      "Layanan ANTAR hanya melayani area tertentu (Kec. Pidie 24151) dengan ongkir Rp 1.000/km. Pastikan alamat lengkap dan nomor HP aktif — kurir akan menghubungimu saat tiba.",
      "Untuk pesanan TAKE AWAY, ambil pesanan di kasir dengan menunjukkan kode pesanan.",
    ],
  },
  {
    title: "6. Poin Member & Voucher",
    paragraphs: [
      "Poin diperoleh dari pesanan yang selesai dan bisa ditukar menjadi voucher sesuai ketentuan di kartu member. Poin bersifat pribadi, tidak dapat dipindahtangankan, dan tidak bisa diuangkan.",
      "Voucher memiliki syarat: kuota terbatas, masa berlaku, minimal belanja, dan berlaku satu kali per akun. Voucher hasil penyalahgunaan dapat dibatalkan.",
    ],
  },
  {
    title: "7. Perilaku yang Dilarang",
    paragraphs: [
      "Dilarang: membuat pesanan palsu, memanipulasi pembayaran, menyalahgunakan poin/voucher, mengirim spam atau kata kasar di chat CS, serta mencoba merusak/membobol sistem aplikasi.",
      "Pelanggaran dapat berakibat pembatalan pesanan, pembekuan poin & voucher, hingga penonaktifan akun permanen.",
    ],
  },
  {
    title: "8. Perubahan Syarat",
    paragraphs: [
      `Syarat ini berlaku sejak ${APP_TERMS_UPDATED} dan dapat kami sesekali perbarui. Bila perubahannya material, versi akan naik dan kamu diminta menyetujui ulang saat membuka aplikasi.`,
      "Pertanyaan tentang syarat ini? Hubungi kami lewat menu Chat CS di aplikasi.",
    ],
  },
];

/** Ringkasan satu kalimat — tampil di popup persetujuan sebelum daftar lengkap */
export const APP_TERMS_SUMMARY =
  "Gunakan aplikasi AGSI dengan baik: data akun benar, pesanan dibayar sebelum diproses, pembatalan hanya sebelum dimasak, serta poin & voucher dipakai sesuai ketentuan. Penyalahgunaan dapat berakibat pembekuan akun.";

/** true bila pengguna sudah menyetujui VERSI S&K YANG BERLAKU sekarang */
export function hasValidTerms(
  u?: { appTermsAt?: string | Date | null; appTermsVersion?: string | null } | null
): boolean {
  return !!u?.appTermsAt && u.appTermsVersion === APP_TERMS_VERSION;
}
