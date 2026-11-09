# 📱 Panduan QRIS DANA — Dana Masuk Langsung ke Saldo DANA Toko

Aplikasi AGSI POS sekarang mendukung **QRIS resmi dari DANA Enterprise (QRIS Acquirer)** —
penyedia dengan prioritas tertinggi. QRIS dinamis dibuat lewat API resmi DANA, dan
**dana masuk LANGSUNG ke saldo akun DANA merchant toko** (DANA = acquirer, bukan perantara).

Kode QRIS-nya QRIS nasional standar EMVCo — bisa dibayar dari **DANA, GoPay, OVO,
ShopeePay, LinkAja, dan m-Banking mana pun**.

> ⚠️ **Yang jujur perlu kamu tahu**: API DANA butuh **akun merchant (DANA Bisnis /
> DANA Enterprise)** yang disetujui DANA — akun DANA pribadi tidak bisa "disambungkan
> langsung" lewat kode (DANA tidak menyediakan API untuk akun pribadi, dan memaksa
> API pribadi melanggar ketentuan mereka). Alur di bawah adalah jalur RESMI.

---

## 1. Daftar DANA Enterprise (sekali saja)

1. Unduh aplikasi **DANA**, masuk ke **Profil → Daftar sebagai Bisnis / DANA Bisnis**
   (atau buka https://dashboard.dana.id ▸ **Start Integration**).
2. Lengkapi **verifikasi usaha**: foto toko, lokasi usaha, dokumen (KTP, NPWP/NIB bila ada).
3. Setelah akun bisnis aktif, masuk ke **Developer Dashboard DANA**
   (https://dashboard.dana.id ▸ Sandbox untuk uji ▸ produksi setelah UAT lolos).
4. Portal memberikan:
   - **Client ID** (dipakai sebagai header `X-PARTNER-ID`)
   - **Merchant ID**
   - **URL API Sandbox** (`https://api.sandbox.dana.id`) dan **Produksi**
     (`https://api.saas.dana.id`)
   - **Public Key / Private Key** uji untuk sandbox (produksi: kamu buat sendiri, lihat §3)
5. Di dashboard ▸ **Webhook / Finish Notify URL**, isi:
   ```
   https://agsi-v-2-0.vercel.app/api/webhooks/qris
   ```
   (persis seperti itu, tanpa `/` di akhir dan tanpa parameter).

## 2. Isi kredensial di Vercel

Vercel Dashboard → Project **agsi-v-2-0** → Settings → **Environment Variables** → tambah:

| Variabel | Isi | Wajib? |
| --- | --- | --- |
| `DANA_CLIENT_ID` | Client ID dari portal DANA | ✅ |
| `DANA_MERCHANT_ID` | Merchant ID dari portal DANA | ✅ |
| `DANA_STORE_ID` | Store ID toko (portal / Create Shop) | disarankan |
| `DANA_PRIVATE_KEY` | Private key PEM (PKCS#8) milik toko — tanda tangan request | ✅ |
| `DANA_PUBLIC_KEY` | **Public key DANA** dari portal — verifikasi webhook | ✅ (webhook) |
| `DANA_API_BASE` | `https://api.sandbox.dana.id` (uji) atau `https://api.saas.dana.id` (nyata) | default sandbox |

**Format PEM satu baris** (untuk Vercel): gabungkan seluruh isi file kunci dengan
literal `\n`, contoh:
```
DANA_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n...==\n-----END PRIVATE KEY-----
```
Aplikasi otomatis mengubahnya kembali menjadi PEM utuh.

Setelah disimpan → **Redeploy** di Vercel (Deployments → Redeploy) agar env terbaca.

## 3. Buat keypair untuk produksi

```bash
openssl genrsa -out rsa_private_key.pem 2048
openssl pkcs8 -topk8 -in rsa_private_key.pem -out pkcs8_rsa_private_key.pem -nocrypt
openssl rsa -in rsa_private_key.pem -pubout -out rsa_public_key.pem
```
- Upload **rsa_public_key.pem** ke portal DANA (produksi).
- `DANA_PRIVATE_KEY` = isi `pkcs8_rsa_private_key.pem`.
- `DANA_PUBLIC_KEY` = **public key dari DANA** (bukan milikmu!) — dipakai memverifikasi
  webhook. Tanpa ini notifikasi pembayaran DITOLAK (fail-closed) — polling status tetap jalan.

## 4. Uji sebelum uang nyata

1. Mode **sandbox** dulu (`DANA_API_BASE=https://api.sandbox.dana.id`).
2. Masuk aplikasi sebagai Owner → **Profil → Kelola QRIS → Status Gateway QRIS** —
   chip **DANA Sandbox** harus hijau/amber, tombol **Uji Koneksi DANA** akan membuat
   transaksi uji Rp15.001 lalu langsung membatalkannya (tanpa dana berpindah).
3. Buat pesanan QRIS di POS — layar pembayaran menampilkan
   "Penyedia: DANA (Sandbox)". Kode QR sandbox hanya bisa dibayar lewat **Sandbox
   Tools** DANA (dashboard.dana.id/sandbox/tools), bukan dompet sungguhan.
4. Lolos UAT + tanda tangan laporan → DANA mengaktifkan produksi:
   ganti `DANA_API_BASE=https://api.saas.dana.id` + kredensial produksi → **Redeploy**.
5. Sejak itu layar menampilkan **"Penyedia: DANA (Produksi)"** — dan setiap dana masuk
   otomatis melunaskan pesanan (webhook + polling), masuk dapur tanpa konfirmasi kasir.

## 5. Keamanan yang sudah terpasang

- **Signature SNAP resmi**: setiap request ditandatangani `SHA256withRSA`
  (`POST:<path>:<sha256(body)>:<X-TIMESTAMP>`); webhook DANA diverifikasi dengan
  public key DANA sebelum dipercaya — notifikasi palsu ditolak 403.
- **Pelunasan hanya oleh sistem**: kasir/admin tidak punya jalur manual menandai lunas
  pesanan QRIS; tombol "simulasi" otomatis MATI saat penyedia nyata aktif.
- **Pesanan lewat 5 menit** dibatalkan otomatis; dana yang masuk terlambat dikembalikan
  pembayar oleh DANA.
- Batal transaksi pending dari **Kelola QRIS** juga mematikan QR di sisi DANA
  (Cancel Order API).

## 6. Jika DANA bermasalah

Sistem menurunkan penyedia secara otomatis **hanya di sandbox**: DANA → Casaku →
Midtrans → gateway bawaan; alasannya tampil di layar pembayaran. **Di mode produksi
tidak ada fallback senyap** — galat DANA diteruskan apa adanya supaya tidak ada uang
yang mengalir di jalur yang tidak kamu sadari.

Dokumentasi resmi: https://dashboard.dana.id/api-docs-v2 (bagian **QRIS (Acquirer) API**).
