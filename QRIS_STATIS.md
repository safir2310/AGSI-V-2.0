# QRIS Statis Toko — Payment Gateway dari Poster QRIS Milik Pemilik

Poster QRIS **GoPay Merchant — Ayam Geprek Sambal Ijo** (NMID `ID1025429162544`,
PIDIE) yang menempel di kasir kini menjadi **gateway pembayaran utama** aplikasi.
Dana masuk **LANGSUNG ke rekening QRIS toko** — tanpa perantara, tanpa biaya
gateway pihak ketiga.

## Cara kerja

```
Poster QRIS statis (.env QRIS_STATIS_PAYLOAD)
        │  turunan per pesanan: + nominal (tag 54), + referensi (tag 62-05),
        │  POI "11"→"12", CRC16 dihitung ulang
        ▼
QR DINAMIS per pesanan (masih QRIS resmi toko — NMID & merchant asli utuh)
        │  dipindai GoPay / BCA / Mandiri / BNI / BRI / DANA / ShopeePay…
        ▼
Dana masuk langsung ke QRIS toko
        │
        ▼  VERIFIKASI
1. Pelanggan tekan "Saya Sudah Bayar" di layar pembayaran
   • Mode AUTO  (default) → sistem langsung melunaskan (PAID → PREPARING)
   • Mode MANUAL          → menunggu verifikasi admin (Pengelola QRIS)
2. (opsional) Webhook layanan mutasi dana → /api/webhooks/qris-statis
3. Admin memverifikasi manual di Profil ▸ Pengelola QRIS
```

- **Berlaku 5 menit** (`QRIS_STATIS_TTL_MINUTES`) — hitung mundur tampil di
  layar; lewat dari itu pesanan yang belum dibayar **dibatalkan otomatis** dan
  voucher yang terpakai kembali ke pelanggan.
- Jejak deklarasi pelanggan tersimpan di `Order.qrisDeclaredAt` untuk
  pencocokan dengan notifikasi GoPay Merchant.
- Salah deklarasi (dana tidak kunjung masuk)? Owner menekan
  **"Belum Diterima — Pulihkan Pelunasan"** di Pengelola QRIS selama pesanan
  masih dimasak → pesanan kembali menunggu pembayaran.

## Variabel .env

| Variabel | Default | Arti |
| --- | --- | --- |
| `QRIS_STATIS_PAYLOAD` | — (wajib) | String QRIS statis toko (dari poster). Kosong → gateway statis nonaktif, jatuh ke Midtrans/gateway bawaan. |
| `QRIS_STATIS_TTL_MINUTES` | `5` | Masa berlaku kode bayar per pesanan. |
| `QRIS_STATIS_AUTO_CONFIRM` | `true` | `true` = deklarasi pelanggan langsung melunaskan. `false` = petugas verifikasi dulu di Pengelola QRIS. |
| `QRIS_STATIS_WEBHOOK_SECRET` | — | Secret header `x-webhook-secret` untuk webhook mutasi. Kosong → webhook ditutup. |

Mengganti poster QRIS? Decode QR baru lalu tempel string payloadnya ke
`QRIS_STATIS_PAYLOAD` (script bantu: `python3 scripts/decode-qris-poster.py`,
verifikasi: `bun scripts/verify-statis-qris.ts`).

## Webhook layanan mutasi (auto-verify penuh, opsional)

QRIS statis tidak mengirim callback sendiri. Bila kelak toko memakai layanan
pemantau mutasi QRIS/dompet, arahkan ke endpoint ini — tanpa ubah kode:

```
POST {DOMAIN}/api/webhooks/qris-statis
Header: x-webhook-secret: <QRIS_STATIS_WEBHOOK_SECRET>
Body  : { "reference": "AGSI-…", "amount": 18000, "status": "PAID" }
```

- Nominal dicocokkan dengan tagihan pesanan (salah → 409).
- Pesanan sudah batal (lewat 5 menit) → 409, dana dikembalikan pembayar.
- Idempoten: pesanan lunas cukup dijawab `ok`.

## Urutan penyedia QRIS

1. **QRIS Statis Toko** (aktif bila `QRIS_STATIS_PAYLOAD` valid) ← utama
2. Midtrans (bila server key terpasang di .env — saat ini nonaktif)
3. Gateway bawaan (sandbox lokal, QR uji)
4. Penyedia eksternal (`QRIS_GATEWAY_URL`)

## Pengujian

```
bun scripts/test-qris-statis.ts    # 42 asersi end-to-end (API + DB)
bun scripts/verify-statis-qris.ts  # verifikasi payload QR turunan + CRC
```

Catatan kejujuran verifikasi: karena QRIS statis tidak punya callback
penyedia, mode AUTO memverifikasi dari **deklarasi pelanggan** (tercatat
waktunya, bisa dipulihkan owner). Verifikasi dana 100% otomatis tanpa
deklarasi hanya mungkin dengan Midtrans (webhook resmi) atau layanan mutasi
lewat webhook di atas.
