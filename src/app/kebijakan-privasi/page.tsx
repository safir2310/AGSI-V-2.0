import type { Metadata } from "next";

/**
 * KEBIJAKAN PRIVASI PUBLIK — halaman statis /kebijakan-privasi.
 *
 * Dipublikasikan agar bisa dilampirkan di:
 *  - Google Play Console (Alaman toko ▸ Kebijakan privasi) — WAJIB,
 *    diisi URL halaman ini saat membuat listing Play Store.
 *  - App Store Connect (App Privacy + Privacy Policy URL).
 *  - Banner/beranda aplikasi (footer & sheet legal mengarah ke sini).
 *
 * Isinya setia pada praktik data aplikasi (lihat prisma/schema.prisma):
 * akun (nama, email, HP, sandi ter-hash), pesanan (alamat, pin GPS rumah
 * opsional, telepon), chat CS, token notifikasi push, poin member, serta
 * pembayaran QRIS yang diproses penyedia gateway (Midtrans/Casaku).
 * Server & database berada di luar Indonesia (hosting Vercel + Neon).
 */
export const metadata: Metadata = {
  title: "Kebijakan Privasi — Ayam Geprek Sambal Ijo (AGSI)",
  description:
    "Bagaimana aplikasi AGSI mengumpulkan, memakai, dan melindungi data pribadimu: akun, pesanan, lokasi, chat, notifikasi, dan pembayaran QRIS.",
};

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-7 text-base font-black text-neutral-900">{children}</h2>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">{children}</p>
);

const LI = ({ children }: { children: React.ReactNode }) => (
  <li className="mt-1.5 text-[13px] leading-relaxed text-neutral-600">{children}</li>
);

export default function KebijakanPrivasiPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 pb-20 pt-[calc(2rem+env(safe-area-inset-top,0px))]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 text-xl shadow-md">
          🛡️
        </span>
        <div>
          <h1 className="text-lg font-black text-neutral-900">Kebijakan Privasi</h1>
          <p className="text-[11px] text-neutral-400">
            Ayam Geprek Sambal Ijo (AGSI) • berlaku sejak 1 Januari 2026 • versi 1.0
          </p>
        </div>
      </div>

      <P>
        Kami menghargai kepercayaanmu. Kebijakan ini menjelaskan data apa yang dikumpulkan aplikasi
        AGSI (aplikasi pemesanan Ayam Geprek Sambal Ijo — situs web dan aplikasi Android/iOS), alasan
        pengumpulannya, bagaimana data disimpan dan dilindungi, serta hak-hakmu. Dengan membuat akun
        dan memakai AGSI, kamu menyetujui praktik yang dijelaskan di halaman ini.
      </P>

      <H>1. Data yang kami kumpulkan</H>
      <ul className="mt-1 list-disc space-y-0 pl-5">
        <LI>
          <b>Data akun</b> — nama, alamat email, nomor WhatsApp/telepon, dan kata sandi. Kata sandi
          TIDAK pernah disimpan dalam bentuk teks: hanya di-hash secara satu arah di server.
        </LI>
        <LI>
          <b>Data pesanan</b> — item yang dipesan, catatan, nomor meja (makan di tempat), nama
          penerima, nomor telepon penerima, dan alamat lengkap + <b>pin lokasi rumah (GPS)</b> yang
          sengaja kamu pilih saat checkout pesanan antar, agar kurir tiba tepat di titik rumahmu.
        </LI>
        <LI>
          <b>Chat dengan CS</b> — isi pesan dan riwayat percakapan di fitur chat layanan pelanggan,
          untuk menangani pertanyaan dan keluhanmu.
        </LI>
        <LI>
          <b>Token notifikasi push</b> — penanda perangkat (melalui layanan Firebase Cloud
          Messaging) supaya kami bisa mengirim kabar status pesanan dan promo. Tidak berisi isi
          pesan pribadi.
        </LI>
        <LI>
          <b>Data pembayaran QRIS</b> — saat kamu membayar lewat QRIS, data transaksi (nominal,
          ID transaksi, status lunas) dicatat oleh kami dan diproses oleh <b>penyedia pembayaran
          resmi (gateway QRIS, antara lain Midtrans/Casaku)</b> sesuai kebijakan privasi mereka.
          Data kartu/PIN/e-wallet kamu TIDAK pernah kami simpan.
        </LI>
        <LI>
          <b>Data teknis</b> — log keamanan standar (waktu akses, alamat IP, perangkat) untuk
          menjaga layanan tetap aman dan tersedia.
        </LI>
      </ul>

      <H>2. Untuk apa data dipakai</H>
      <ul className="mt-1 list-disc space-y-0 pl-5">
        <LI>Memproses pesanan, antar ke alamatmu, dan menghubungkanmu dengan kurir.</LI>
        <LI>Mengelola poin member dan memberikan promo yang relevan.</LI>
        <LI>Mengirim notifikasi status pesanan (diproses, diantar, selesai) dan balasan chat.</LI>
        <LI>Mencatat dan merekonsiliasi pembayaran tunai (setoran kurir) serta QRIS.</LI>
        <LI>Menangani keluhan, menjaga keamanan akun, dan memenuhi kewajiban pembukuan toko.</LI>
      </ul>

      <H>3. Dengan siapa data dibagikan</H>
      <P>
        Kami TIDAK menjual data pribadimu. Data hanya dibagikan seperlunya kepada: <b>kurir</b>
        &nbsp;(nama, telepon, alamat &amp; pin lokasi penerima — hanya untuk pesanan yang
        diantarannya ditugaskan kepadanya), <b>penyedia gateway pembayaran QRIS</b> (data transaksi),
        <b> penyedia layanan infrastruktur</b> (hosting aplikasi dan basis data — Vercel Inc. dan
        penyedia basis data Postgres, server berlokasi di luar Indonesia), serta <b>layanan notifikasi
        Firebase</b> (Google). Kepada pihak berwenang data hanya diberikan bila diwajibkan hukum.
      </P>

      <H>4. Penyimpanan, keamanan, dan retensi</H>
      <P>
        Data tersimpan di basis data dengan akses terbatas (kata sandi ter-hash, sesi bertanggal
        kedaluwarsa, kode reset sandi ber-hash dan kedaluwarsa). Riwayat pesanan kami simpan selama
        diperlukan untuk pembukuan dan layanan pelanggan. Data chat dan token push perangkat dapat
        dihapus kapan pun atas permintaanmu.
      </P>

      <H>5. Hak-hakmu</H>
      <ul className="mt-1 list-disc space-y-0 pl-5">
        <LI>Meminta salinan, koreksi, atau penghapusan data pribadimu.</LI>
        <LI>Mencabut izin notifikasi push kapan saja di pengaturan perangkat/aplikasi.</LI>
        <LI>Menolak pin GPS — pesanan antar tetap bisa dibuat dengan alamat teks.</LI>
        <LI>Menghapus akun: hubungi CS di dalam aplikasi atau WhatsApp toko, kami proses maksimal
          7 hari kerja.</LI>
      </ul>

      <H>6. Anak-anak</H>
      <P>
        AGSI tidak ditujukan bagi anak di bawah 13 tahun dan kami tidak sengaja mengumpulkan data
        mereka. Bila kamu orang tua/wali dan yakin anakmu membuat akun, hubungi kami agar data
        dihapus.
      </P>

      <H>7. Perubahan kebijakan</H>
      <P>
        Bila kebijakan ini berubah, versi dan tanggal berlakunya diperbarui di halaman ini, dan
        perubahan penting diumumkan lewat aplikasi. Persetujuan terakhirmu tercatat di akunmu
        (bisa dilihat di Profil ▸ Syarat &amp; Kebijakan).
      </P>

      <H>8. Hubungi kami</H>
      <P>
        Pertanyaan atau permintaan terkait privasi: lewat fitur <b>Chat CS</b> di dalam aplikasi
        AGSI, atau WhatsApp/telepon ke nomor toko yang tertera di menu Pusat Bantuan aplikasi.
      </P>

      <p className="mt-8 rounded-2xl border border-orange-100 bg-orange-50/60 px-4 py-3 text-[11px] leading-relaxed text-orange-700">
        Halaman ini dapat diakses publik tanpa login di{" "}
        <b>agsi-v-2-0.vercel.app/kebijakan-privasi</b> — URL resmi yang kami lampirkan pada
        pendaftaran aplikasi di Google Play Store dan Apple App Store.
      </p>
    </main>
  );
}
