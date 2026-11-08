# PUSH NOTIFIKASI AGSI — Native Android Heads-Up (FCM)

Panduan lengkap mengaktifkan push notification FCM untuk aplikasi AGSI:
banner **heads-up** (melayang di atas layar) di Android, baik lewat
**aplikasi Android native** (`android/` — WebView + FCM SDK) maupun
**Chrome Android** (web push lewat Profil ▸ Notifikasi Push).

---

## 1. Arsitektur Singkat

```
                     ┌──────────────────────────────┐
  Trigger di server  │  src/lib/push.ts + fcm.ts    │
  ─ pesanan baru     │  FCM HTTP v1 (JWT + OAuth2)  │
  ─ QRIS terbayar    └──────────────┬───────────────┘
  ─ status pesanan                  │  priority HIGH / Urgency high
  ─ chat CS masuk                   ▼
                   ┌───────────────────────────────┐
                   │   Perangkat terdaftar         │
                   │  • Android native (PushService)│ → channel agsi_orders
                   │  • Chrome (service worker)     │   IMPORTANCE_HIGH
                   │    firebase-messaging-sw.js    │   → HEADS-UP banner
                   └───────────────────────────────┘
```

- Token perangkat tersimpan di tabel **PushToken** (token unik, userId, role,
  platform). Token mati dihapus otomatis saat FCM menjawab UNREGISTERED.
- **Heads-up** di Android native: channel `agsi_orders` dengan
  `IMPORTANCE_HIGH` + `android.priority "HIGH"`.
- **Heads-up** di Chrome Android: `webpush.headers.Urgency: "high"`.
- Saat aplikasi sedang terbuka, push tampil sebagai popup + suara AGSI
  (bukan notifikasi ganda) — diteruskan service worker ke halaman.

---

## 2. Buat Project Firebase (sekali, ± 5 menit, gratis)

1. Buka <https://console.firebase.google.com> → **Add project** → beri nama
   (mis. `AGSI POS`) → nonaktifkan Analytics bila tak perlu → Create.
2. Di dalam project, daftarkan **dua aplikasi**:

   **A. Aplikasi Android** (ikon robot 🤖)
   - Android package name: **`com.agsi.pos`**
   - Nickname: `AGSI POS` → Register
   - Download **`google-services.json`** → simpan ke **`android/app/google-services.json`**
   - (Langkah "tambah SDK" boleh dilewati — proyek `android/` sudah berisi semua)

   **B. Aplikasi Web** (ikon `</>`)
   - Nickname: `AGSI Web` → Register
   - Salin nilai dari blok `firebaseConfig` untuk `.env` di langkah 3.

3. **Kredensial pengiriman (server)** — Project settings ⚙ ▸ tab
   **Service accounts** ▸ **Generate new private key** ▸ Download JSON.
   Ambil 3 nilai: `project_id`, `client_email`, `private_key`.

4. **(Opsional tapi disarankan) VAPID key** — Project settings ▸
   **Cloud Messaging** ▸ tab **Web Push certificates** ▸ Generate key pair.

---

## 3. Isi `.env` Aplikasi Web

> 🤖 **Cara otomatis (disarankan):** taruh kedua berkas kredensial di folder
> `upload/` — `firebase-adminsdk-*.json` (service account) dan
> `google-services.json` (aplikasi Android) — lalu jalankan
> `node scripts/apply-firebase-env.mjs`. Skrip mengisi `.env` (server + web
> config), mencari Web app di project lewat Firebase Management API, dan
> membuat backup `.env.bak`. Lanjut ke restart di bawah.

Buka `.env` di root proyek web, isi bagian FCM (hapus tanda `#`):

```env
# Pengiriman (service account — langkah 2.3)
FIREBASE_PROJECT_ID=agsi-pos
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@agsi-pos.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"

# Aplikasi web (firebaseConfig — langkah 2.B)
FIREBASE_WEB_API_KEY=AIzaSy...
FIREBASE_AUTH_DOMAIN=agsi-pos.firebaseapp.com
FIREBASE_SENDER_ID=123456789012
FIREBASE_APP_ID=1:123456789012:web:abcdef123456

# Opsional (langkah 2.4)
FIREBASE_VAPID_KEY=BB...
```

> ⚠️ `FIREBASE_PRIVATE_KEY` wajib diapit tanda kutip dan barisnya ditulis
> `\n` (persis seperti contoh). Kode server otomatis mengubah `\n` menjadi
> baris baru.

Lalu **restart server** (`Ctrl+C` → `npm run dev`).

Cek keberhasilan: buka `GET /api/push/config` — harus
`{"configured": true, ...}`.

---

## 4. Aktifkan di Perangkat

### A. Chrome Android / Desktop (tanpa install apa pun)
1. Buka aplikasi AGSI → **Profil** ▸ **Notifikasi Push**.
2. Ketuk **Aktifkan Notifikasi** → izinkan popup izin browser.
3. (Opsional, admin) **Kirim Notifikasi Uji ke Perangkat Saya** — banner
   heads-up muncul saat aplikasi ditutup/minimalkan.

### B. Aplikasi Android native
1. Buka folder `android/` di **Android Studio** → tunggu Gradle sync.
2. Set `WEB_APP_URL` di `android/gradle.properties`
   (`http://10.0.2.2:3000` untuk emulator, atau domain produksi).
3. **Build ▸ Build APK(s)** → install di HP → buka → izinkan notifikasi.
4. Login di WebView — token otomatis terikat akun (role pelanggan/kasir/admin).

---

## 5. Kapan Push Terkirim (otomatis)

| Peristiwa | Penerima | Judul |
| --- | --- | --- |
| Pesanan baru (POS / app tunai) | Admin, Owner, Kasir | 🔔 Pesanan Baru Masuk! |
| QRIS aplikasi terverifikasi lunas | Staff **dan** pelanggan | 💰 QRIS Terbayar — Masuk Dapur! / 💳 Pembayaran Diterima! |
| Status pesanan berubah (Dimasak/Siap/Selesai/Batal) | Pelanggan pemilik pesanan | 👨‍🍳 / 🔔 / 🎉 |
| Chat CS masuk (dua arah) | Petugas CS atau pelanggan | 💬 |
| Manual: Profil ▸ Kirim Notifikasi Uji | Perangkat sendiri | 🍗 Notifikasi Uji AGSI |

Broadcast manual (admin, via API): `POST /api/push/send`
`{"scope": "staff" | "customers" | "all" | "self", "title": "...", "body": "..."}`.

---

## 6. Uji End-to-End (perangkat nyata)

1. HP A (kasir/admin): aktifkan push (Aplikasi native atau Chrome).
2. HP B / browser lain: login pelanggan → pesan (tunai/QRIS).
3. HP A **dalam keadaan aplikasi tertutup** → banner heads-up muncul +
   suara + vibrasi. Ketuk banner → aplikasi terbuka di halaman Pesanan.

Tips memastikan heads-up tampil:
- Channel notifikasi "Pesanan & Notifikasi AGSI" = **Urgent/Prioritas tinggi**.
- Aplikasi Android: **Baterai ▸ Tanpa pembatasan**; Xiaomi/OPPO: aktifkan
  **Autostart**.
- Chrome: izin notifikasi situs harus "Allow" (bukan "Mute").

---

## 7. Troubleshooting

| Gejala | Sebab & solusi |
| --- | --- |
| `GET /api/push/config` → `configured: false` | `.env` belum lengkap / server belum di-restart. |
| Sheet Profil: "Server belum dikonfigurasi" | Sama seperti di atas. |
| Push tidak muncul sama sekali di Android native | Cek izin notifikasi OS, battery optimization, Autostart (Xiaomi). |
| Push masuk tapi tidak heads-up | Channel berubah ke "Silent" — hapus data aplikasi / uninstall-reinstall agar channel dibuat ulang dengan IMPORTANCE_HIGH. |
| HTTP 401 saat kirim | `FIREBASE_PRIVATE_KEY` salah format (tanda kutip / `\n`). |
| HTTP 404 saat kirim | `FIREBASE_PROJECT_ID` tidak cocok dengan service account. |
| Token tidak terdaftar | Pastikan HP bisa menjangkau `WEB_APP_URL` (emulator: 10.0.2.2, bukan localhost). |

## 8. Berkas Terkait

- `src/lib/fcm.ts` — klien FCM HTTP v1 (tanpa dependensi)
- `src/lib/push.ts` — komposisi pesan + helper bisnis
- `src/app/api/push/*` — register / config / send
- `public/firebase-messaging-sw.js` — service worker web push
- `src/lib/push-client.ts`, `src/components/shared/PushSettingsSheet.tsx`,
  `src/components/shared/PushBridge.tsx`
- `android/` (zip: `download/agsi-android.zip`) — aplikasi Android native
