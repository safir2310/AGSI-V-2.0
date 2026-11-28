# EMAIL OTP (RESEND) — Verifikasi Lupa Password

Panduan lengkap mengaktifkan OTP email untuk alur **Lupa Password**:
user memasukkan email terdaftar → server mengirim **kode OTP 6 digit** via
[Resend](https://resend.com) → user memasukkan OTP + password baru.

---

## 1. Cara Kerja

```
  Halaman Masuk ▸ "Lupa password?"
  ── Langkah 1: isi email ──────────────►  POST /api/auth/forgot-password
       server: OTP acak 6 digit (crypto)        │
       simpan HASH-nya di tabel PasswordReset   ▼
       berlaku 10 menit, sekali pakai      Resend API → inbox email
  ── Langkah 2: OTP + password baru ────►  POST /api/auth/reset-password
       maks 5x salah, password diganti, SEMUA sesi lama dihapus
```

- OTP disimpan sebagai **hash** (bukan teks polos) — bocornya database tidak
  langsung membocorkan kode.
- **Cooldown 60 detik** antar permintaan kode (anti spam/brute force).
- Salah maks 5× → sesi verifikasi hangus, harus minta kode baru.
- Setelah sukses ganti password, semua sesi lama otomatis logout.

## 2. Konfigurasi `.env`

```env
RESEND_API_KEY=re_............      # API key dari resend.com ▸ API Keys
RESEND_FROM="AGSI POS <onboarding@resend.dev>"
```

Restart server setelah mengubah `.env`. Cek keberhasilan:
`GET` tidak ada — cukup coba alur lupa password di aplikasi; bila kredensial
kosong muncul pesan "Layanan email belum aktif di server".

## 3. ⚠️ Batas Akun Resend Saat Ini (PENTING)

Kondisi akun Resend AGSI (dicek via API, `GET /domains`):

| Domain | Status | Arti |
| --- | --- | --- |
| `agsi.co.id` | **pending** | DNS record belum terverifikasi — selesaikan |
| `ayamgepreksambalijo.com` | **failed** | Gagal verifikasi — periksa DNS / hapus |

Selama belum ada domain **verified**, pengirim fallback
`onboarding@resend.dev` **hanya boleh mengirim ke email pemilik akun
Resend**. Kalau OTP dikirim ke email lain, Resend menolak dengan pesan:

> `You can only send testing emails to your own email address (...)
> until you verify your domain.`

Yang harus dilakukan:
1. Buka console Resend ▸ **Domains** ▸ `agsi.co.id` → pasang semua **DNS
   record** yang diminta (SPF/DKIM/DMARC) di pengelola domain `agsi.co.id`
   → tunggu status berubah **Verified** (biasanya menit–jam).
2. Lalu isi di `.env`:
   `RESEND_FROM="AGSI POS <no-reply@agsi.co.id>"`
   → restart server → OTP bisa terkirim ke email pelanggan mana pun.
3. (Opsional) Hapus `ayamgepreksambalijo.com` yang gagal agar daftar rapi.

## 4. Mode Development & Pengujian Tanpa Inbox

Saat `NODE_ENV` ≠ `production`:

- Setiap OTP juga dicatat ke berkas **`.otp-dev.log`** di root proyek
  (`waktu ⏵ email ⏵ kode`) — jadi alur bisa diuji walau email gagal terkirim
  atau penerima ditolak Resend.
- Bila Resend menolak, server TETAP melanjutkan alur (respons memuat
  `emailed: false` + `devNote`); UI tetap menampilkan pesan sukses biasa.
- Di production berkas ini tidak pernah ditulis dan kegagalan email
  langsung ditampilkan ke user (HTTP 502 + alasan dari Resend).

Uji end-to-end: `bash scripts/test-forgot-otp.sh`
(daftar user uji → minta OTP → salahkan sekali → reset benar → login ulang
dengan password baru → bersih-bersih data uji).

## 5. Berkas Terkait

- `src/lib/email.ts` — klien Resend (tanpa dependensi) + template email OTP
- `src/app/api/auth/forgot-password/route.ts` — langkah 1 (kirim OTP)
- `src/app/api/auth/reset-password/route.ts` — langkah 2 (verifikasi OTP)
- `src/components/auth/AuthView.tsx` — UI 2 langkah + kirim ulang OTP (60s)
