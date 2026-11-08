# 💳 Setup QRIS Midtrans — AGSI POS

Pembayaran QRIS aplikasi AGSI kini menggunakan **Midtrans (Core API v2)** sebagai
penyedia utama. QR yang tampil adalah **QRIS nasional standar** — bisa dibayar
dari GoPay, OVO, DANA, ShopeePay, dan semua m-banking.

Kebijakan toko tetap berlaku: **pesanan QRIS hanya bisa lunas OLEH SISTEM** saat
dana benar-benar masuk (polling status + webhook Midtrans). Kasir tidak punya
jalur menandai lunas secara manual.

---

## 1. Kredensial (terpasang di `.env`)

| Variabel | Isi | Fungsi |
| --- | --- | --- |
| `MIDTRANS_SERVER_KEY` | kunci **PRODUKSI aktif** (`Mid-server-9ZR2…`) | kunci yang benar-benar dipakai charge/status/webhook |
| `MIDTRANS_CLIENT_KEY` | client key produksi (`Mid-client-VCKu…`) | pasangan kunci aktif (untuk Snap popup, belum dipakai) |
| `MIDTRANS_SIGNATURE_SECRET` | "Signature Secret Key" dashboard (`Mid-server-9G0L…`) | kandidat rahasia verifikasi webhook (lihat bawah) |
| `MIDTRANS_SERVER_KEY_PRODUCTION` / `…_PRODUCTION` | identik kunci aktif | cadangan go-live |
| `MIDTRANS_IS_PRODUCTION` | `true` | mode produksi — **uang nyata** |

**Deteksi lingkungan otomatis:** format kunci Midtrans self-describing —
`SB-Mid-server-…` = sandbox, `Mid-server-…` = produksi; API keduanya menolak
kunci salah lingkungan (401 pasti). Lingkungan efektif mengikuti FORMAT kunci
aktif, jadi salah tempel kunci tidak akan merusak alur diam-diam.

**Verifikasi webhook dua kandidat (perilaku baru):** dokumentasi resmi
Midtrans merumuskan `signature_key = SHA512(order_id + status_code +
gross_amount + ServerKey)`. Karena dashboard juga menampilkan "Signature
Secret Key" terpisah, webhook aplikasi menerima notifikasi yang tanda
tangannya cocok dengan **salah satu** dari `MIDTRANS_SIGNATURE_SECRET` atau
`MIDTRANS_SERVER_KEY` (keduanya rahasia sisi server — mencoba keduanya aman).
Hasil uji di server ini: keduanya diterima (200/404-order-tidak-ada), tanda
tangan palsu ditolak (403).

## 2. Cara kerja

1. Pelanggan checkout dengan QRIS → aplikasi membuat transaksi dinamis
   `POST https://api…midtrans.com/v2/charge` (`payment_type: qris`,
   acquirer GoPay, masa berlaku 5 menit) → `qr_string` dirender jadi QR.
2. Layar pembayaran **polling** `GET /v2/{transaction_id}/status` tiap 4 detik;
   status `settlement`/`capture` → pesanan otomatis LUNAS (`paidVia AUTO`,
   langsung masuk dapur).
3. **Webhook** (jalur kedua): Midtrans mengirim HTTP notification ke
   `https://<domain-anda>/api/webhooks/qris` — diverifikasi signature
   `sha512(order_id + status_code + gross_amount + server_key)`; notifikasi
   palsu ditolak (403). Isi URL ini di dashboard Midtrans ▸ Settings ▸
   Configuration ▸ **Payment Notification URL** saat aplikasi sudah punya domain publik.

## 3. Mode Sandbox vs Produksi

- **Sandbox (sekarang — kunci aktif `SB-…` membuat lingkungan efektif sandbox
  meski `MIDTRANS_IS_PRODUCTION=true`)**: QR uji belum terhubung dompet
  sungguhan. Selama kanal GoPay/QRIS akun Midtrans belum diaktifkan (lihat
  diagnosa di bawah), aplikasi otomatis **fallback ke gateway bawaan**
  (transaksi `SBX-…`) sehingga QRIS tetap bisa diuji penuh lewat tombol
  *Simulasi Dana Masuk* di layar pembayaran pelanggan — jalur pelunasan
  otomatisnya identik dengan produksi.
- **Produksi (dompet digital nyata)**: ganti isi `MIDTRANS_SERVER_KEY` di
  `.env` dengan kunci `Mid-server-…` (sudah tersimpan di
  `MIDTRANS_SERVER_KEY_PRODUCTION`) lalu restart server. Dengan
  `MIDTRANS_IS_PRODUCTION=true` yang sudah terpasang, mode produksi — QR
  nyata, dana nyata — aktif otomatis; fallback senyap **dimatikan** (galat
  Midtrans diteruskan apa adanya).

> ⚠️ **Hasil diagnosa kredensial PRODUKSI (diverifikasi langsung dari server ini):**
> - Kunci **produksi baru** (`Mid-server-9ZR2…`) **VALID** — probe
>   `GET api.midtrans.com/v2/.../status` → HTTP 200. Ini kemajuan dari kunci
>   produksi lama (`Mid-server-Ng7…`, dulu ditolak 401) — akun produksi Anda
>   kini terautentikasi penuh ke API Midtrans.
> - `POST /v2/charge` ditolak **HTTP 402 "Payment channel is not
>   activated"** → **kanal QRIS/GoPay belum diaktifkan di akun produksi**.
>   Aktivasi HANYA bisa dari dashboard (tidak lewat API): login
>   dashboard.midtrans.com ▸ **Settings ▸ Payment Channels** ▸ aktifkan
>   **QRIS** dan **GoPay**. Untuk akun produksi, kanal QRIS umumnya baru
>   bisa dinyalakan setelah identitas usaha **terverifikasi Midtrans**
>   (go-live disetujui). Setelah aktif, uji ulang via tombol **Tes Koneksi
>   Midtrans** — target verdict `QRIS_NYATA_SIAP`.
> - Mode produksi TANPA fallback senyap (kebijakan): bila Midtrans menolak,
>   layar bayar menampilkan QR statis toko + banner jujur **"Verifikasi
>   otomatis belum berjalan"** beserta alasan persisnya; pesanan tidak
>   dianggap lunas sampai dana terverifikasi sistem. Begitu kanal aktif,
>   QRIS dinamis Midtrans (bisa dibayar GoPay/OVO/DANA/ShopeePay/m-Banking)
>   langsung mengalir tanpa perubahan kode.
> Cek kapan pun dengan: `bun scripts/diag-midtrans-production.ts` (produksi),
> `bun scripts/diag-midtrans-charge.ts` (sandbox), atau tombol **Tes Koneksi
> Midtrans** di Pengaturan Toko.

## 4. Panel kesehatan koneksi (khusus Admin)

**Pengaturan Toko ▸ Gateway QRIS & Midtrans** menampilkan status nyata koneksi:

- Chip mode aktif: `💰 Midtrans Produksi` / `🧪 Midtrans Sandbox` / nonaktif,
  plus `🔑 Kunci valid|ditolak` (hasil probe autentikasi) dan
  `🧪 Gateway bawaan siap` (fallback uji lokal).
- Tombol **Tes Koneksi Midtrans** — membuat lalu LANGSUNG MEMBATALKAN satu
  transaksi QRIS uji Rp15.000 (tanpa dana berpindah). Verdict yang mungkin:
  - `QRIS_NYATA_SIAP` (HTTP 201) → QRIS nyata siap; dompet digital bisa membayar.
  - `IP_DIBLOKIR` (403 Access denied) → kunci valid tapi IP server diblokir
    Midtrans; jalankan aplikasi dari IP Indonesia/non-datacenter.
  - `KUNCI_DITOLAK` (401) → kunci tidak valid / akun produksi belum go-live.
- API pendukung (admin-only): `GET /api/qris-gateway/health` (konfigurasi +
  probe auth) dan `POST /api/qris-gateway/health` (probe charge + cancel).

Setiap pesanan juga menyimpan penyedia aktual (`Order.qrisProvider`) dan alasan
fallback (`Order.qrisFallbackReason`) sehingga layar pembayaran selalu jujur
menyebut QR berasal dari Midtrans nyata atau dari gateway uji lokal.

## 5. Pengelola QRIS di Profil Admin (baru)

**Profil ▸ Pengelola QRIS** — pusat kendali dana masuk QRIS untuk Admin/Owner:

- **Ringkasan dana masuk**: total, masuk hari ini, jumlah lunas / menunggu /
  batal-kedaluwarsa, rata-rata per transaksi, tingkat sukses.
- **Grafik batang 7 hari** — dana masuk per hari (berdasarkan `paidAt`).
- **Daftar transaksi** 90 hari terakhir: tanggal transaksi, jumlah dana,
  status (Lunas / Menunggu / Batal), penyedia (Midtrans / Bawaan), waktu
  dana masuk, ID transaksi gateway, catatan fallback. Diperbarui otomatis
  tiap 20 detik selama sheet terbuka.
- **Filter & pencarian**: chip status + penyedia, pencarian kode/pelanggan/ID.
- **Ekspor CSV** (Excel-ready, mengikuti filter aktif).
- **Uji Koneksi Midtrans** — probe charge Rp15.000 → langsung dibatalkan.
  Verdict kini mencakup `SALURAN_QRIS_NONAKTIF` (envelope 402 "Payment
  channel is not activated") dengan instruksi aktivasi di dashboard.
- **Batalkan Transaksi** — untuk transaksi yang masih menunggu bayar: QR
  dimatikan di penyedia (`POST /v2/{id}/cancel` Midtrans / tabel sandbox
  bawaan), pesanan dibatalkan, voucher dikembalikan. Bila dana ternyata
  sudah masuk, sistem menolak membatalkan dan melunaskan otomatis.
- API pendukung (admin-only): `GET /api/admin/qris` (data pengelola) dan
  `POST /api/admin/qris` (`{orderId}` — pembatalan aman).

## 6. Status produksi 2026-11-08 & langkah aktivasi

Kunci produksi (`Mid-server-…` + Signature Secret) terpasang dan **VALID**
(probe auth diterima Midtrans). Charge QRIS produksi masih ditolak dengan
**402 "Payment channel is not activated"** — saluran pembayaran QRIS/GoPay
belum diaktifkan untuk akun produksi. Yang perlu dilakukan pemilik akun:

1. Masuk **dashboard.midtrans.com** (akun produksi).
2. Buka **Settings ▸ Activation** / menu konfigurasi pembayaran, lalu
   aktifkan saluran **QRIS / GoPay** (bila diminta, lengkapi verifikasi
   identitas usaha).
3. Daftarkan **Payment Notification URL**: `https://<domain>/api/webhooks/qris`.
4. Kembali ke aplikasi → Profil ▸ Pengelola QRIS ▸ **Uji Koneksi Midtrans**
   → harus muncul verdict hijau `QRIS nyata Midtrans SIAP ✓`.

Selama saluran belum aktif, pesanan QRIS baru akan gagal membuat transaksi
dengan pesan jujur (mode produksi TIDAK memakai fallback uji lokal) —
gunakan metode bayar CASH sementara, atau nonaktifkan QRIS di Pengaturan
Toko.

## 7. Checklist go-live

1. `MIDTRANS_IS_PRODUCTION=true` di `.env`.
2. Jalankan `bun scripts/diag-midtrans-production.ts` → harus `HTTP=201` +
   `PROD_CHARGE_OK=true` (atau tombol **Tes Koneksi Midtrans** → verdict
   `QRIS_NYATA_SIAP`).
3. Daftarkan Payment Notification URL: `https://<domain>/api/webhooks/qris`.
4. Buat 1 pesanan QRIS nyata kecil, bayar, pastikan status otomatis LUNAS.
5. Selesai — tidak ada perubahan kode yang diperlukan.
