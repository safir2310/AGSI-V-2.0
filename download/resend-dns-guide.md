# Panduan DNS — Domain Resend AGSI

Sumber: API Resend, 2026-11-24T14:37:22.287Z. Akun memiliki 3 domain, semua status "failed" (record DNS belum hidup).

## agsi.co.id

id: 6b7f7b04-d453-47b5-a3d8-8de212d8b668 — status: failed — region: ap-northeast-1

| Tipe | Host (relatif ke domain) | Nilai |
|---|---|---|
| TXT | resend._domainkey | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLZKrDjzOZ4DWQvuaDkXGv5CSA3xwFk0DLm6a6lN3K3jGzNMrJH4tx4YnlSJR1ONVhh1KzdVpph02WTkOdY1FqmwiCJFjBI6LFuV6Ex+ZTIu/In3Jot892jS+dfhpdoC+U8w4hVDhq9+wC2OtFWkGtlF9C0qtGGUoK7F7rsXZGrQIDAQAB` |
| CNAME | rsend | `rsend-apne1.forge.rmta.net` |
| CNAME | send | `send.forge.rmta.net` |

## ayamagsi.co.id

id: fcf1268c-d304-4d7d-9347-13755065af40 — status: failed — region: us-east-1

| Tipe | Host (relatif ke domain) | Nilai |
|---|---|---|
| TXT | resend._domainkey | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDQj1Tuu6gDFkKGc+yk0xjRy1fZa/VB7e9pmfH35Ja28mEbXitDXNTuxTjIyLXlq4FcQ4wiVqLfZpl7xiUSvGSablkALCkCYFL1fE0XABWuU9MgErdiSJOUGgrDGoJBQ7AenZD70NavIytvXG+01DrafLMjaKhdxNrVpvW0yAOuswIDAQAB` |
| CNAME | rsend | `rsend.forge.rmta.net` |
| CNAME | send | `send.forge.rmta.net` |

## mail.agsi.id

id: b9c8978e-ad90-4398-b2dc-393c249f2923 — status: failed — region: ap-northeast-1

| Tipe | Host (relatif ke domain) | Nilai |
|---|---|---|
| TXT | resend._domainkey.mail | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCroi32iJffK0B/Vqf/fZUq19vXIE8Y4MZnJTRYM7WJhhZMeK1FaRuUYvepLd7pVFtp2E2dOLRqOhuVQH0IVbaxJQ0QqO15FNUf1tEEWcagFoxMXdRsE8Kq0DsBbP13Q618zSxDQCgYGkpVC5xPRXqCXudaK2kD+TZ+An50q6XriwIDAQAB` |
| CNAME | rsend.mail | `rsend-apne1.forge.rmta.net` |
| CNAME | send.mail | `send.forge.rmta.net` |

## Diagnosis

- `agsi.co.id` — nameserver di registrar MATI (SERVFAIL semua tipe query). Perbaiki NS dulu, lalu tambahkan record di atas.
- `ayamagsi.co.id` — domain TIDAK terdaftar di registry (NXDOMAIN). Beli/daftarkan dulu sebelum bisa diverifikasi.
- `mail.agsi.id` — zona `agsi.id` perlu dicek: bila agsi.id aktif, cukup tambahkan record mail.agsi.id di zona tersebut.

## Setelah record hidup

1. Jalankan `node scripts/resend_verify_pick.mjs` (picu POST /domains/{id}/verify).
2. Bila status menjadi `success`: ubah env Vercel `RESEND_FROM` menjadi `AGSI <no-reply@<domain-terverifikasi>>` lalu redeploy.
3. Uji OTP ke alamat pelanggan (bukan hanya inbox pemilik).
