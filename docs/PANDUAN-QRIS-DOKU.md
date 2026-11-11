# PANDUAN QRIS DOKU — Integrasi & Aktivasi

> DOKU adalah penyedia QRIS **prioritas utama** aplikasi (di atas DANA / Casaku /
> Midtrans). Selama kanal QRIS akun DOKU belum aktif, aplikasi otomatis jatuh ke
> gateway bawaan (mode uji) sehingga QRIS **tetap jalan** tanpa gangguan.

## 0. Update terbaru — pembayaran QRIS memakai QRIS E-WALLET DOKU

Pesan dengan metode **QRIS** kini membuat checkout DOKU dengan filter SATU kanal:
`payment_method_types: ["QRIS"]`. Sesuai docs DOKU, bila hanya satu kanal dikirim,
pelanggan **langsung diarahkan** ke pembayaran itu — tanpa memilih-milih VA/retail/
paylater. Di halaman itu tersaji kode QRIS dinamis yang bisa dipindai aplikasi
**e-wallet / m-Banking apa pun** (GoPay, DANA, OVO, ShopeePay, LinkAja, dll).

### 0.1 TANGGA KANAL — perbaikan "PAYMENT CHANNEL IS INACTIVE" (HTTP 400)

Bila kanal QRIS akun DOKU **belum diaktifkan**, DOKU menolak 400
`PAYMENT CHANNEL IS INACTIVE`. Dulu pesan ini tidak tertangkap (pencocokan lama
hanya mencari kata "payment method") sehingga seluruh pembayaran gagal dan layar
menampilkan "Verifikasi otomatis belum berjalan" (mode LOCAL). Sekarang adapter
**turun tangga kanal** otomatis — pembayaran tetap berjalan:

1. `["QRIS"]` — langsung ke pembayaran QRIS e-wallet DOKU (bila kanal aktif).
2. Ditolak → filter kanal e-wallet (DOKU Wallet, DANA, OVO, ShopeePay, LinkAja
   + VA DOKU cadangan).
3. Masih ditolak → **tanpa filter** — halaman bayar menampilkan SEMUA kanal
   aktif akun; pelanggan tetap bisa membayar dan verifikasi otomatis
   (polling Check Status + webhook) tetap berjalan.

Setiap penurunan tingkat dicatat di `fallbackReason` dan ditampilkan di layar
pembayaran (kartu amber di POS + catatan satu baris untuk pelanggan). Invoice
duplikat tetap dicoba ulang dengan suffix unik pada tingkat filter yang sama.
Bila SEMUA tingkat ditolak (tidak ada kanal aktif sama sekali), pesan galat kini
memuat panduan aktivasi: *"Aktifkan QRIS/e-wallet di dashboard DOKU
(Configuration ▸ Payment Settings) atau hubungi DOKU."*

- Jalur aktif: DOKU Checkout legacy (`POST /checkout/v1/payment`) — verifikasi
  otomatis (polling Check Status + webhook) tidak berubah.
- Metode **E-Wallet** (aplikasi pelanggan & **POS kasir**) juga memakai tangga
  yang sama: filter e-wallet → tanpa filter bila ditolak. Tombol **👛 E-Wallet**
  dan **📱 QRIS** di kasir mengikuti saklar *QRIS* di Pengaturan Toko (default
  aktif) dan mengalir lewat jalur DOKU yang sama.

## 1. Status integrasi saat ini (hasil pengujian nyata)

API key DOKU yang disetel di `.env` / Vercel (`DOKU_API_KEY`, berawalan
`doku_key_…`) **sudah terverifikasi autentik** ke sandbox DOKU:

| Uji | Hasil |
| --- | --- |
| Handshake MCP DOKU (`initialize`, `tools/list`) | ✅ 200 OK — API key diterima |
| `create_qris_payment` (Rp10.000) | ⚠️ `QrisGenerationFailed — Service temporarily unavailable` |
| `create_virtual_account_payment` (diagnostik) | ⚠️ `Service temporarily unavailable` |
| `get_transaction_by_invoice_number` (invoice tak dikenal) | ✅ diperlakukan PENDING |
| Rantai QRIS aplikasi (DOKU dicoba pertama → fallback gateway bawaan) | ✅ QR tetap tampil + alasan fallback tercatat |

Kesimpulan: **kredensial valid, tetapi kanal pembayaran (QRIS/VA) akun test-mode
DOKU belum diaktifkan di back-office DOKU.** Pesan "Service temporarily
unavailable" adalah jawaban DOKU saat kanalnya belum provisioned.

## 2. Dua jalur kredensial DOKU

### Jalur 1 — API Key Agentic (MCP DOKU) — sudah terpasang

Cukup 1 variabel env. Adapter memanggil endpoint MCP DOKU (JSON-RPC
`https://api-sandbox.doku.com/doku-mcp-server/mcp`):

- `tools/call create_qris_payment` → QRIS dinamis (nominal melekat, 5 menit)
- `tools/call get_transaction_by_invoice_number` → cek status pembayaran

Ambil/atur di **sandbox.doku.com** (Test Mode). Untuk Live Mode isi formulir
onboarding DOKU (forms.doku.com/agentic-payments).

### Jalur 2 — SNAP REST (disarankan untuk produksi, fitur paling lengkap)

3 kredensial dari dashboard DOKU (Client ID berformat `BRN-…`):

```env
DOKU_CLIENT_ID="BRN-0253-…"        # Client ID (X-PARTNER-ID)
DOKU_CLIENT_SECRET="…"             # Client Secret (signature HMAC-SHA512)
DOKU_MERCHANT_ID="…"               # Merchant ID / MID (mall ID)
DOKU_TERMINAL_ID="A01"             # opsional
DOKU_IS_PRODUCTION="true"          # hanya setelah go-live
```

Bila ketiganya terisi, adapter otomatis memakai SNAP REST: token B2B →
`qr-mpm-generate` → `qr-mpm-query` (+ `qr-expire` saat admin membatalkan).

## 3. Langkah aktivasi (pemilik toko)

1. **Masuk dashboard DOKU** (sandbox.doku.com untuk uji; dashboard produksi
   setelah go-live).
2. **Aktifkan kanal QRIS**: menu *Configuration / Payment Settings ▸ QR
   Payment* → aktifkan QRIS. Bila belum bisa diaktifkan, hubungi DOKU
   (registrasi QRIS butuh persetujuan merchant).
3. **Setel Notification URL (webhook)**:
   ```
   https://agsi-v-2-0.vercel.app/api/webhooks/qris
   ```
   (dashboard DOKU ▸ Payment Settings ▸ QR Payment ▸ Notification URL).
4. **Setel env di Vercel** (Project `agsi-v-2-0` ▸ Settings ▸ Environment
   Variables) lalu **Redeploy**:
   - Minimal: `DOKU_API_KEY` (nilai sama seperti di `.env` lokal).
   - Produksi: ganti/tambah `DOKU_CLIENT_ID`, `DOKU_CLIENT_SECRET`,
     `DOKU_MERCHANT_ID`, dan `DOKU_IS_PRODUCTION="true"`.

## 4. Cara verifikasi pembayaran bekerja (kebijakan aplikasi)

- Pesanan QRIS **hanya dilunaskan SISTEM** saat DOKU sendiri mengatakan dana
  masuk — kasir/admin tidak punya jalur manual (tidak berubah dari kebijakan
  lama).
- Layar pembayaran memantau setiap 4 detik (`/api/orders/[id]/qris/status` →
  query DOKU).
- Webhook DOKU (`/api/webhooks/qris`) diverifikasi signature HMAC-SHA512 bila
  `DOKU_CLIENT_SECRET` diset. **Tanpa signature pun notifikasi tidak bisa
  memalsukan pelunasan**: aplikasi SELALU konfirmasi ulang status ke DOKU
  (query) sebelum menandai lunas — sudah diuji dengan notifikasi palsu
  (status `00` tanpa signature) → pesanan tetap UNPAID.
- QRIS dinamis berlaku 5 menit (`DOKU_QRIS_EXPIRY_MINUTES`); lewat batas,
  pesanan batal otomatis dan voucher kembali.

## 5. Pemeriksaan cepat

- Status gateway: Profil Admin ▸ *Pengelola QRIS* — kolom "Penyedia" dan
  pengaturan gateway.
- API kesehatan (khusus Admin/Owner):
  `GET /api/qris-gateway/health` → blok `config.doku`
  (`enabled`, `apiKeyPresent`, `snapReady`, `apiBase`).
- Uji adapter langsung: `bun scripts/test-qris-doku.ts` (7 pemeriksaan).

## 6. Env lengkap (semua opsional kecuali salah satu jalur kredensial)

| Variabel | Default | Catatan |
| --- | --- | --- |
| `DOKU_API_KEY` | — | Jalur 1 (MCP); berawalan `doku_key_` / `api_key_` |
| `DOKU_CLIENT_ID` | — | Jalur 2 SNAP (`BRN-…`) |
| `DOKU_CLIENT_SECRET` | — | Jalur 2 SNAP (alias `DOKU_SECRET_KEY`) |
| `DOKU_MERCHANT_ID` | — | Jalur 2 SNAP (alias `DOKU_MID`) |
| `DOKU_TERMINAL_ID` | `A01` | Maks 16 karakter |
| `DOKU_POSTAL_CODE` | `13120` | Kode pos merchant (5 digit) |
| `DOKU_IS_PRODUCTION` | `false` | `true` = api.doku.com (uang nyata) |
| `DOKU_API_BASE` | ikut mode | Override URL API (uji lanjutan) |
| `DOKU_QRIS_EXPIRY_MINUTES` | `5` | 1–30 menit |
