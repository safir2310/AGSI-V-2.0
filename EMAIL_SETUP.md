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

Kondisi akun Resend AGSI (dicek via API `GET /domains`, 21 Nov 2026):

| Domain | Status | Diagnosa |
| --- | --- | --- |
| `agsi.co.id` | **failed** | nameserver `89.116.171.90` menjawab **SERVFAIL** ("No Reachable Authority") — server DNS mati/salah zona |
| `ayamgepreksambalijo.com` | **failed** | **NXDOMAIN** — domain tidak ada di DNS publik (belum terdaftar / masa registrasi habis) |

Selama belum ada domain **verified**, pengirim fallback `onboarding@resend.dev`
**hanya boleh mengirim ke email pemilik akun Resend** (`musafir2310@gmail.com`).
Kalau OTP dikirim ke email lain, Resend menolak dengan pesan:

> `You can only send testing emails to your own email address (musafir2310@gmail.com)...`

Yang harus dilakukan (fokus `agsi.co.id`):
1. Di pengelola domain `.co.id`: **perbaiki nameserver** (arahkan ke DNS yang
   aktif — Cloudflare / default registrar / Vercel DNS), lalu pasang **4 record
   Resend** berikut:

   | Tipe | Nama | Nilai | Prioritas |
   | --- | --- | --- | --- |
   | TXT | `resend._domainkey.agsi.co.id` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLZKrDjzOZ4DWQvuaDkXGv5CSA3xwFk0DLm6a6lN3K3jGzNMrJH4tx4YnlSJR1ONVhh1KzdVpph02WTkOdY1FqmwiCJFjBI6LFuV6Ex+ZTIu/In3Jot892jS+dfhpdoC+U8w4hVDhq9+wC2OtFWkGtlF9C0qtGGUoK7F7rsXZGrQIDAQAB` | — |
   | CNAME | `rsend.agsi.co.id` | `rsend-apne1.forge.rmta.net` | — |
   | CNAME | `send.agsi.co.id` | `send.forge.rmta.net` | — |
   | MX | `agsi.co.id` (@) | `receive-apne1.forge.rmta.net` | 10 |

2. Setelah status **Verified**: isi env Vercel
   `RESEND_FROM="AGSI POS <no-reply@agsi.co.id>"` → deploy ulang → OTP email
   aktif untuk semua user (bukan hanya via push).
3. (Opsional) Hapus `ayamgepreksambalijo.com` yang gagal agar daftar rapi.

### Fallback OTP yang sudah aktif di production (deploy 91b6f33+)

Sementara domain belum verified, reset password akun **ADMIN/OWNER** tetap
berfungsi dengan urutan kanal:

1. Email ke email akun (jika Resend mengizinkan);
2. **Notifikasi push** ke perangkat terdaftar milik user itu sendiri
   (respons API: `viaPush: true`);
3. Email ke `RESEND_FALLBACK_TO` = inbox pemilik akun Resend
   (respons API: `viaOwnerEmail: true`).

Akun pelanggan (CUSTOMER) belum punya fallback — butuh domain verified.

### Catatan `OTP_SECRET`

Env `OTP_SECRET` (diisi secret acak di Vercel, production/preview/development)
**belum dipakai kode aplikasi** — OTP disimpan sebagai hash scrypt+salt di
tabel `PasswordReset`, tanpa perlu secret signing. Env ini disiapkan untuk
kebutuhan masa depan (mis. HMAC pada tautan reset satu-kali).

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
