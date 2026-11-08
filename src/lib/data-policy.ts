/**
 * KEBIJAKAN & PERSETUJUAN PENGGUNAAN DATA — AGSI (Ayam Geprek Sambal Ijo).
 *
 * Sumber TUNGGAL isi kebijakan: dipakai popup persetujuan (pengguna baru /
 * versi baru) dan sheet "Kebijakan & Persetujuan Data" di halaman Profil.
 *
 * Naikkan DATA_POLICY_VERSION bila isi kebijakan berubah material — semua
 * pengguna yang tersimpan dengan versi lama otomatis diminta menyetujui ulang
 * (popup muncul lagi di buka aplikasi berikutnya).
 * Aman dipakai di client (tidak mengimpor db/server).
 */

export const DATA_POLICY_VERSION = "2026.11";
/** Tanggal berlaku kebijakan ini (tampil di popup & sheet) */
export const DATA_POLICY_UPDATED = "7 November 2026";

export type DataPolicySection = {
  title: string;
  paragraphs: string[];
};

export const DATA_POLICY_SECTIONS: DataPolicySection[] = [
  {
    title: "1. Data yang Kami Kumpulkan",
    paragraphs: [
      "Saat kamu mendaftar dan memakai aplikasi AGSI, kami mengumpulkan: nama, alamat email, nomor HP, serta kode member dan saldo poin akunmu.",
      "Saat memesan, kami mencatat detail pesanan: menu yang dipilih, catatan, jenis pesanan (makan di tempat, bawa pulang, atau antar), nomor meja, alamat & titik lokasi pengantaran, metode dan status pembayaran, serta waktu transaksi.",
      "Bila kamu memakai fitur chat CS, isi percakapanmu dengan tim kami juga tersimpan untuk keperluan pelayanan.",
    ],
  },
  {
    title: "2. Cara Kami Menggunakan Data",
    paragraphs: [
      "Data kamu dipakai untuk: memproses & mengantar pesanan, memverifikasi pembayaran (termasuk QRIS), menghitung poin member dan voucher, menjawab pertanyaan lewat chat CS, serta menjaga keamanan transaksi.",
      "Kami TIDAK menjual atau menyewakan data pribadimu kepada pihak mana pun. Data hanya dipakai untuk menjalankan layanan AGSI.",
    ],
  },
  {
    title: "3. Penyimpanan & Keamanan",
    paragraphs: [
      "Password akunmu disimpan dalam bentuk hash (scrypt + salt) — bahkan kami pun tidak bisa membacanya. Sesi masuk dijaga token yang kedaluwarsa otomatis.",
      "Data tersimpan di basis data toko dan hanya bisa diakses petugas berwenang (pemilik/admin) sebatas kebutuhan pelayanan, misalnya memproses pesanan dan menjawab chat.",
    ],
  },
  {
    title: "4. Berbagi Data",
    paragraphs: [
      "Untuk pesanan ANTAR, sebagian data (nama, nomor HP, dan alamat tujuan) dibagikan kepada kurir yang mengantarkan pesananmu — sebatas yang diperlukan pengantaran.",
      "Data juga dapat diungkap bila diwajibkan oleh hukum yang berlaku atau perintah lembaga berwenang.",
    ],
  },
  {
    title: "5. Hak Kamu",
    paragraphs: [
      "Kamu bisa memperbaiki nama dan nomor HP kapan saja lewat menu \"Edit Profil\" di halaman Profil.",
      "Untuk meminta salinan, koreksi, atau penghapusan akun beserta data pribadimu, hubungi tim CS AGSI lewat chat atau WhatsApp di halaman Profil. Kami akan memproses permintaan dalam waktu wajar.",
      "Kamu juga bisa menolak/menarik persetujuan ini dengan berhenti memakai aplikasi dan meminta penghapusan akun.",
    ],
  },
  {
    title: "6. Penyimpanan di Perangkatmu",
    paragraphs: [
      "Aplikasi menyimpan beberapa data kecil di perangkatmu (localStorage/sessionStorage): kunci sesi masuk agar kamu tidak perlu login berulang, dan penanda \"sudah melihat\" popup banner agar promo yang sama tidak muncul terus-menerus. Tidak ada pelacak iklan pihak ketiga.",
    ],
  },
  {
    title: "7. Pembaruan Kebijakan",
    paragraphs: [
      `Kebijakan ini berlaku sejak ${DATA_POLICY_UPDATED}. Bila kami mengubahnya secara material, versi kebijakan akan naik dan kamu akan diminta menyetujui ulang saat membuka aplikasi.`,
      "Pertanyaan tentang kebijakan ini? Hubungi kami lewat menu Chat CS di aplikasi.",
    ],
  },
];

/** Ringkasan satu kalimat — tampil di popup persetujuan sebelum daftar lengkap */
export const DATA_POLICY_SUMMARY =
  "AGSI mengumpulkan data akun & pesananmu hanya untuk memproses pesanan, pengantaran, poin member, dan pelayanan CS. Data tidak pernah dijual, disimpan aman, dan kamu bisa meminta penghapusannya kapan saja.";

/** Tipe minimum pengguna untuk menilai status persetujuan (client & server) */
export type ConsentUser = {
  dataConsentAt?: string | Date | null;
  dataConsentVersion?: string | null;
};

/** true bila pengguna sudah menyetujui VERSI KEBIJAKAN YANG BERLAKU sekarang */
export function hasValidConsent(u?: ConsentUser | null): boolean {
  return !!u?.dataConsentAt && u.dataConsentVersion === DATA_POLICY_VERSION;
}
