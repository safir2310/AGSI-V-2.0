# AGSI POS — Aplikasi Android Native (WebView + FCM Heads-Up Push)

Aplikasi Android native yang membungkus aplikasi web AGSI dan menerima
**push notification FCM** dengan tampilan **heads-up** (banner melayang di
atas layar) berkat channel `IMPORTANCE_HIGH` + prioritas `HIGH`.

```
┌──────────────┐  FCM  ┌─────────────────────────────┐
│  Server AGSI │ ────► │ Aplikasi Android (PushService)│
│ (Next.js)    │       │  → banner heads-up di layar   │
└──────────────┘       └─────────────────────────────┘
```

## Struktur

```
android/
├── build.gradle / settings.gradle / gradle.properties   ← WEB_APP_URL di sini
└── app/
    ├── build.gradle                    ← Firebase BoM + plugin google-services
    ├── google-services.json.example    ← ganti dengan google-services.json ASLI
    └── src/main/
        ├── AndroidManifest.xml         ← izin POST_NOTIFICATIONS + service FCM
        ├── java/com/agsi/pos/
        │   ├── MainActivity.kt         ← WebView + jembatan JS AgsiNative
        │   ├── PushService.kt          ← penerima FCM → notifikasi heads-up
        │   ├── PushChannels.kt         ← channel "agsi_orders" IMPORTANCE_HIGH
        │   ├── PushApi.kt              ← daftarkan token ke /api/push/register
        │   └── FcmTokenHolder.kt
        └── res/                        ← ikon, tema oranye, string
```

## Langkah Build (± 10 menit)

### 1. Siapkan project Firebase
1. Buka <https://console.firebase.google.com> → **Add project** (atau pakai
   project yang sudah ada untuk web push).
2. **Add app → Android**: package name `com.agsi.pos` → Register.
3. Download **google-services.json** → simpan sebagai
   `android/app/google-services.json` (gantikan contoh).

### 2. Arahkan ke aplikasi web
Edit `android/gradle.properties`:
```properties
# Emulator lokal (web berjalan di PC yang sama):
WEB_APP_URL=http://10.0.2.2:3000
# Produksi:
WEB_APP_URL=https://domain-anda.com
```

### 3. Build
- Buka folder `android/` di **Android Studio** (Ladybug+) → tunggu Gradle sync
  → **Build ▸ Build Bundle(s) / APK(s) ▸ Build APK(s)**.
- APK ada di `app/build/outputs/apk/debug/app-debug.apk`.
- (Opsional) `gradle wrapper` untuk membuat `gradlew` bila ingin build via CLI.

## Cara kerja push (penting dipahami)

| Keadaan app | Jalur notifikasi |
| --- | --- |
| Background/closed | Sistem menampilkan notifikasi dari payload `notification` pada channel `agsi_orders` (IMPORTANCE_HIGH → **heads-up banner**) |
| Foreground (dibuka) | `PushService.onMessageReceived` membangun notifikasi prioritas MAX |
| Diketuk | `MainActivity` dibuka → WebView memuat `data.url` |

Token FCM dikelola dua arah:
1. **Native**: `PushService.onNewToken` / `MainActivity` mendaftarkan token ke
   `POST /api/push/register` (platform `android`, anonim).
2. **Web (dalam WebView)**: setelah pengguna login, halaman (PushBridge)
   membaca token lewat jembatan `AgsiNative.getFcmToken()` dan mendaftar ulang
   dengan sesi → token terikat **userId + role** (target push per peran akurat).

Notifikasi WEB PUSHS dimatikan di dalam WebView (userAgent berisi
`AGSIAndroidApp`) supaya tidak ada banner ganda.

## Catatan heads-up di perangkat nyata

- Izinkan notifikasi saat diminta (Android 13+).
- **Hemat baterai**: set "Tanpa pembatasan" untuk AGSI POS
  (Setelan ▸ Aplikasi ▸ AGSI POS ▸ Baterai) agar FCM segera sampai.
- Xiaomi/OPPO/vivo: aktifkan **Autostart** untuk aplikasi.
- Channel "Pesanan & Notifikasi AGSI" harus tetap "Urgent/Prioritas tinggi".

## Konfigurasi server

Lihat **PUSH_SETUP.md** di root proyek web (kredensial `.env`, kapan push
dikirim, dan cara uji end-to-end).
