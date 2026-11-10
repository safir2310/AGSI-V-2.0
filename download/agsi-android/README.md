# AGSI — Aplikasi Android (AYAM GEPREK SAMBAL IJO)

Aplikasi Android **native WebView** yang membungkus website AGSI
(`https://agsi-v-2-0.vercel.app`) menjadi aplikasi siap APK & AAB untuk
Google Play Store — **tanpa mengubah sedikit pun website/backend** yang sudah
berjalan.

| Identitas | Nilai |
| --- | --- |
| Nama aplikasi | AYAM GEPREK SAMBAL IJO |
| Application ID | `com.agsi.app` |
| Version code / name | 2 / 1.1.0 |
| Min / Target / Compile SDK | 26 / 36 / 36 |
| Bahasa & build system | Kotlin + Gradle Kotlin DSL |
| URL yang dibungkus | `https://agsi-v-2-0.vercel.app` (ubah di `gradle.properties`) |

**Riwayat versi:**

| Versi | Perubahan |
| --- | --- |
| 1.1.0 (versionCode 2) | **Masuk biometrik** — Face ID / sidik jari native (layar buka kunci `AppLock` + `BiometricPrompt`, pengaturan di Profil → Login Biometrik via jembatan `AgsiNative`). **Ikon aplikasi baru** — maskot ayam koki persis logo halaman login (adaptive + monochrome + notifikasi + Play Store 512px). **Tab navigasi bawah diturunkan sedikit** di dalam aplikasi (CSS mode `.agsi-app`, aktif lewat penanda UA `AGSIAndroidApp`). |
| 1.0.0 (versionCode 1) | Rilis awal — WebView wrapper lengkap (offline page, upload kamera, popup pembayaran, deep link e-wallet, push FCM). |

---

## 1. Arsitektur

```
┌──────────────────────────── Android APK (com.agsi.app) ──────────────────────────┐
│  MainActivity (Kotlin)                                                           │
│   └─ WebView (fullscreen, edge-to-edge)                                          │
│        ├─ Cookie + localStorage + JavaScript  → sesi login bertahan              │
│        ├─ Allowlist domain                    → hanya AGSI + gateway pembayaran  │
│        ├─ iframe checkout.doku.com            → dibayar DI DALAM aplikasi        │
│        ├─ intent:// e-wallet / wa.me / tel:   → dibuka aplikasi eksternal        │
│        ├─ Upload galeri + kamera (runtime)    → input file admin & pelanggan     │
│        ├─ Halaman offline + auto retry                                           │
│        ├─ Layar buka kunci biometrik (AppLock)→ Face ID / sidik jari native      │
│        └─ Jembatan JS "AgsiNative"            → registrasi token FCM + biometrik │
│  PushService (FCM)  → channel "agsi_orders"  → heads-up notifikasi pesanan       │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ HTTPS (cookie agsi_session, SameSite=None)
                                       ▼
            Backend Next.js + Prisma di Vercel (TIDAK DIUBAH — sama persis
            dengan website: auth, produk, keranjang, QRIS/DOKU, webhook,
            dashboard admin & user, chat CS, poin, laporan)
```

**Prinsip penting (sudah diikuti):**

- Website **tidak dibangun ulang** — APK hanya "pembungkus" (WebView wrapper).
- Backend, database, API, autentikasi, pembayaran tetap 100% di server.
- `output: "standalone"` Next.js **tidak diubah** (tidak ada `output: export`).
- Prisma/database **tidak** dipindah ke APK.
- **Tidak ada** secret (`DATABASE_URL`, `DOKU_SECRET_KEY`, password) di APK.

---

## 2. Struktur Proyek

```
agsi-android/
├── settings.gradle.kts            # repositori & modul
├── build.gradle.kts               # deklarasi plugin (version catalog)
├── gradle.properties              # WEB_APP_URL + properti Gradle
├── gradle/libs.versions.toml      # versi semua dependency (satu tempat)
├── gradlew / gradlew.bat          # wrapper (build tanpa install Gradle)
├── keystore.properties.example    # contoh config signing release
├── agsi-release.keystore          # ⚠️ TEST KEY — WAJIB diganti sendiri (lihat §5)
├── keystore.properties            # ⚠️ TEST KEY config — gitignored, jangan commit
└── app/
    ├── build.gradle.kts           # config module + signing + BuildConfig
    ├── proguard-rules.pro
    ├── ic_launcher-playstore.png  # ikon 512px utk Play Console
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/agsi/app/
        │   ├── MainActivity.kt      # WebView + semua fitur inti
        │   ├── SiteConfig.kt        # allowlist domain (AGSI + pembayaran)
        │   ├── AgsiApp.kt           # channel notifikasi "agsi_orders"
        │   ├── AgsiNativeBridge.kt  # window.AgsiNative (kontrak push-client.ts)
        │   ├── PushService.kt       # FCM → heads-up notification
        │   └── PushRegistrar.kt     # POST /api/push/register
        └── res/
            ├── layout/activity_main.xml
            ├── values/ (strings, colors, themes) + mipmap-* (ikon) + drawable-*
            └── xml/ (network_security_config, file_paths)
```

---

## 3. Instalasi Android Studio

1. Unduh **Android Studio** (versi Ladybug / Narwhal atau lebih baru):
   <https://developer.android.com/studio>
2. Install dengan opsi default (sudah termasuk **JDK 17** bawaan dan SDK
   Manager — tidak perlu install JDK terpisah).
3. Buka Android Studio → **More Actions ▸ SDK Manager** → tab **SDK Platforms**
   → centang **Android 16 ("Baklava") — API 36** → **Apply**.
   (Tab SDK Tools: pastikan **Android SDK Build-Tools** terbaru & **Platform-Tools**
   tercentang — biasanya otomatis.)

## 4. Konfigurasi SDK & Gradle

**Cara paling mudah — Android Studio:**

1. **File ▸ Open** → pilih folder `agsi-android/` ini.
2. Tunggu **Gradle Sync** selesai (unduh dependency otomatis, ± menit pertama).
3. Jika diminta "Install missing SDK components" → klik **Install**.
4. Selesai — langsung bisa **Run ▸ app** dengan emulator/HP.

**Cara CLI (tanpa Android Studio):**

1. Install JDK 17 (`sudo apt install openjdk-17-jdk` / unduh Temurin).
2. Unduh Android SDK cmdline-tools → install:
   ```bash
   sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   yes | sdkmanager --sdk_root=$ANDROID_HOME --licenses
   ```
3. Tulis lokasi SDK ke `local.properties` di root proyek:
   ```
   sdk.dir=/path/ke/android-sdk
   ```
   (atau export `ANDROID_HOME=/path/ke/android-sdk`)
4. `JAVA_HOME` mengarah ke JDK 17.
5. Build via `./gradlew` (wrapper mengunduh Gradle 8.14 otomatis).

> **WEB_APP_URL** di `gradle.properties` menentukan URL yang dibuka.
> Default produksi: `https://agsi-v-2-0.vercel.app`. Untuk pengembangan lokal
> di emulator: `http://10.0.2.2:3000` (lihat catatan cleartext di
> `app/src/main/res/xml/network_security_config.xml`).

## 5. Pembuatan Keystore (WAJIB sebelum rilis sungguhan)

> ⚠️ **File `agsi-release.keystore` + `keystore.properties` di proyek ini
> hanyalah TEST KEY agar Anda bisa mencoba build signed segera.**
> Sebelum rilis ke Play Store, **buat keystore Anda sendiri** dan JANGAN
> pernah men-share/commit file keystore.

```bash
keytool -genkeypair -v \
  -keystore agsi-release.keystore \
  -alias agsi \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass PASSWORD_ANDA -keypass PASSWORD_ANDA \
  -dname "CN=AGSI, OU=Mobile, O=AGSI, L=Jakarta, C=ID"
```

Lalu salin `keystore.properties.example` → `keystore.properties` dan isi:

```properties
storeFile=agsi-release.keystore
storePassword=PASSWORD_ANDA
keyAlias=agsi
keyPassword=PASSWORD_ANDA
```

**Aturan keamanan keystore:**
- Simpan backup keystore di tempat aman (cloud pribadi/password manager).
- Jika keystore hilang & belum pakai **Play App Signing**, Anda tidak bisa
  update aplikasi — Google sangat menyarankan **Play App Signing** (§10, langkah
  otomatis saat upload AAB pertama: upload key Anda disimpan Google, key
  signing produksi dipegang Google).
- `keystore.properties`, `*.jks`, `*.keystore` sudah masuk `.gitignore`.

## 6. Build APK

```bash
# Debug (untuk uji cepat)
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk

# Release SIGNED (perlu keystore.properties §5)
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

Di Android Studio: **Build ▸ Build App Bundle(s)/APK(s) ▸ Build APK(s)**.

## 7. Build AAB (untuk Google Play)

```bash
./gradlew bundleRelease
# → app/build/outputs/bundle/release/app-release.aab
```

Di Android Studio: **Build ▸ Generate Signed App Bundle / APK** jika ingin
wizard GUI (pilih *App Bundle*, pakai keystore Anda).

**Lokasi semua hasil build:**

| Artefak | Lokasi |
| --- | --- |
| APK debug | `app/build/outputs/apk/debug/app-debug.apk` |
| APK release signed | `app/build/outputs/apk/release/app-release.apk` |
| AAB release | `app/build/outputs/bundle/release/app-release.aab` |

## 8. Panduan Pengujian di HP Android

Install cepat:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
# atau kirim app-release.apk ke HP → buka file → izinkan "install unknown"
```

**Checklist fungsional (uji semua di HP nyata):**

- [ ] Splash screen oranye dengan logo **maskot ayam koki** (logo halaman login) muncul → halaman website terbuka.
- [ ] **Login & register** pelanggan; **login admin/kasir** (dashboard admin terbuka).
- [ ] Tutup & buka aplikasi → **masih login** (cookie sesi bertahan).
- [ ] **Masuk biometrik**: setelah login, muncul tawaran "Masuk cepat dengan sidik jari?" → **Aktifkan** → verifikasi → tutup & buka aplikasi → **layar buka kunci** muncul → pindai sidik jari/wajah → aplikasi terbuka sudah login.
- [ ] Di layar buka kunci: **Coba Verifikasi Lagi** & **Masuk dengan Kata Sandi** (keluar sesi → halaman login web) bekerja.
- [ ] Profil ▸ **Login Biometrik** (sheet) menampilkan status AKTIF/BELUM AKTIF — bisa **matikan/aktifkan** dari sini (khusus di dalam aplikasi).
- [ ] Di dalam aplikasi, tab navigasi bawah mengambang lebih dekat tepi layar (tidak ada celah berlebih).
- [ ] Putar layar (rotasi) → tidak reload/balik ke login.
- [ ] Menu, keranjang, checkout, struk, riwayat pesanan berjalan normal.
- [ ] **Upload foto** (foto produk di admin / foto profil) → dialog pilih
      **Galeri atau Kamera** muncul; izin diminta otomatis.
- [ ] **Bayar QRIS/DOKU**: kode QR tampil; tombol e-wallet → halaman DOKU
      tampil **di dalam aplikasi** (iframe); selesai → status otomatis lunas.
- [ ] Jika e-wallet membuka aplikasi wallet (DANA/OVO dst.) via `intent://`
      → aplikasi wallet terbuka, kembali ke AGSI status ter-update.
- [ ] Link **WhatsApp/telepon** di Profil toko → WhatsApp/dialer terbuka.
- [ ] Nyalakan **mode pesawat** → halaman offline + tombol **Coba Lagi**;
      nyalakan internet → aplikasi memuat ulang otomatis.
- [ ] Tombol **kembali** Android: keluar dari halaman dalam → riwayat mundur →
      minimize (bukan langsung keluar).
- [ ] Notifikasi: aktif di Profil ▸ Notifikasi Push → kirim pesanan dari HP lain
      → **heads-up banner** muncul saat aplikasi tertutup; ketuk banner → buka
      halaman terkait.

**Tips OEM (Xiaomi/OPPO/Vivo):** Baterai ▸ Tanpa pembatasan + aktifkan
Autostart agar push FCM diterima saat aplikasi ditutup.

## 9. Notifikasi Push (FCM) — Opsional

Backend AGSI **sudah siap** menerima aplikasi Android (lihat `PUSH_SETUP.md`
di repo website: tabel `PushToken` platform `android`, endpoint
`POST /api/push/register`, channel `agsi_orders`). Untuk mengaktifkan:

1. Buat project gratis di <https://console.firebase.google.com> → **Add
   Android app** dengan package name **`com.agsi.app`** (bukan com.agsi.pos!).
2. Download **`google-services.json`** → simpan sebagai
   `app/google-services.json`.
3. Selesai — build ulang. Plugin Google Services otomatis aktif
   (`app/build.gradle.kts` mendeteksi file tsb), token FCM diregistrasi
   anonim saat app dibuka dan **terikat akun setelah login** lewat jembatan
   `AgsiNative.getFcmToken()` (kontrak `src/lib/push-client.ts` website).
4. Pastikan `.env` backend sudah berisi kredensial FCM
   (FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY — langkah 3 PUSH_SETUP.md).

Tanpa `google-services.json`, build tetap sukses; hanya push yang belum aktif.

## 10. Publikasi ke Google Play Console

1. Daftar akun **Google Play Console** (biaya sekali $25):
   <https://play.google.com/console>.
2. **Create app**: nama *AYAM GEPREK SAMBAL IJO*, bahasa default Indonesia,
   aplikasi + gratis.
3. Siapkan **Kebijakan Privasi** — Play **mewajibkan URL kebijakan privasi**
   aktif. Buat halaman kebijakan privasi di website AGSI (mis. route
   `/kebijakan-privasi` berisi teks kebijakan pengumpulan data) lalu isi URL
   itu di App content.
4. **Store listing**: ikon 512px (sudah disediakan
   `app/ic_launcher-playstore.png`), screenshot HP (min. 2, disarankan 4-8:
   menu, keranjang, pembayaran QRIS, status pesanan), deskripsi singkat+lengkap.
5. **App content** (form keamanan konten):
   - Data safety: jawab sesuai kenyataan — aplikasi mengumpulkan email/nama/
     telepon (akun), data pesanan; data tidak dijual; transmisi terenkripsi
     (HTTPS); bisa dihapus lewat layanan CS. Tidak ada collection saat
     background.
   - Ads: tidak ada iklan. Target audience: 13+ (bukan child-directed).
   - Financial features: boleh centang pembayaran produk sendiri (bukan
     gambling/lending).
6. **Testing**: buat track **Internal testing** → upload AAB dari §7 →
   tambahkan tester via email list → install dari link opt-in → jalankan
   checklist §8 di HP nyata.
7. **Production**: lengkapi semua pra-syarat (content rating questionnaire,
   target audience, App content) → buat **Release production** → upload
   **AAB** (bukan APK) → review → **Rollout**.
8. **Signing**: saat upload AAB pertama, aktifkan **Play App Signing**
   (default) — Google memakai upload key Anda (keystore §5) dan memegang
   key signing produksi. Simpan upload key aman.
9. Update berikutnya: naikkan `versionCode` + `versionName` di
   `app/build.gradle.kts` → build ulang → upload AAB baru.

> **Target API requirement**: Play mewajibkan target API level terbaru untuk
> rilis baru (saat ini API 36 / Android 16). Proyek ini sudah `targetSdk 36`
> — aman untuk publikasi sekarang; cukup naikkan di masa depan saat Google
> menaikkan syaratnya.

## 11. Checklist Keamanan & Kompatibilitas

**Keamanan (sudah diterapkan di kode):**

- ✅ HTTPS only — `cleartextTrafficPermitted="false"` di
  `network_security_config.xml` + `usesCleartextTraffic="false"`.
- ✅ Safe Browsing WebView aktif (`safeBrowsingEnabled = true`).
- ✅ **Error SSL tidak pernah diabaikan** — `onReceivedSslError` selalu
  `cancel()` + dialog peringatan (tidak ada `proceed()`).
- ✅ Mixed content dilarang (`MIXED_CONTENT_NEVER_ALLOW`).
- ✅ Allowlist domain: hanya host AGSI + domain pembayaran yang dimuat di
  WebView; lainnya dibuka di browser/aplikasi eksternal.
- ✅ `allowFileAccess=false`, `allowContentAccess=false` — WebView tidak
  membaca file lokal secara bebas.
- ✅ FileProvider hanya mengekspos folder `cache/images/` (foto kamera).
- ✅ Izin runtime: CAMERA & POST_NOTIFICATIONS diminta saat dibutuhkan;
  izin mikrofon/lokasi ditolak default (website tidak memakainya).
- ✅ `allowBackup=false` — cookie sesi tidak ikut backup cloud/device-transfer.
- ✅ Tidak ada secret di APK — BuildConfig hanya berisi URL publik.
- ✅ Bridge JS `AgsiNative` hanya mengekspos token FCM & versi aplikasi.
- ✅ Cookie pihak ketiga diaktifkan **hanya** untuk iframe checkout DOKU
  (kebutuhan fungsional pembayaran).

**Kompatibilitas fitur web → native (catatan jujur):**

| Fitur web | Di aplikasi native |
| --- | --- |
| Login password (scrypt + cookie) | ✅ Penuh, sesi bertahan 30 hari |
| Login **passkey/biometrik** (WebAuthn) | ⚠️ Bergantung dukungan WebAuthn di WebView perangkat; bila gagal, lanjutkan login email+password |
| QRIS dinamis (gambar QR) | ✅ Penuh |
| **DOKU Checkout** (iframe) | ✅ Dirender in-app; third-party cookie aktif |
| Deep link e-wallet (`intent://`) | ✅ Diluncurkan ke aplikasi wallet + fallback browser |
| Web push Chrome (service worker) | ℹ️ Tidak aktif di WebView — digantikan **FCM native** (§9) |
| Payment Request API (`allow="payment *"`) | ⚠️ WebView tidak mendukung Payment Request API; halaman DOKU punya fallback form — kanal e-wallet/QRIS tetap bisa dipakai |
| Unduh struk/berkas | ✅ via DownloadManager (folder Downloads) |

## 12. Sinkronisasi dengan Backend (aturan)

- Jangan mengubah `next.config.ts` (tetap `output: "standalone"`) demi
  kebutuhan WebView — tidak ada perubahan produksi yang diperlukan.
- Semua transaksi & status pembayaran tetap divalidasi **server**
  (webhook + polling — sudah ada di website); aplikasi tidak pernah menandai
  lunas sendiri.
- Cookie `agsi_session` (HttpOnly, SameSite=None+Secure) bekerja normal di
  WebView; `CookieManager.flush()` dipanggil di `onPause` agar sesi tidak
  hilang saat aplikasi dimatikan sistem.
- Jika nanti domain website berubah (custom domain), cukup ubah
  `WEB_APP_URL` di `gradle.properties` **dan** `PRIMARY_HOST` +
  `isAllowedHost` di `SiteConfig.kt`, lalu rebuild.

## 13. Troubleshooting

| Gejala | Solusi |
| --- | --- |
| Gradle sync gagal "Could not resolve ..." | Periksa internet; mirror Aliyun di `settings.gradle.kts` bisa dihapus bila tidak dibutuhkan |
| `SDK location not found` | Buat `local.properties` berisi `sdk.dir=...` atau export `ANDROID_HOME` |
| `does not provide the required capabilities: JAVA_COMPILER` | JAVA_HOME menunjuk JRE — arahkan ke JDK 17 (bukan JRE) |
| Layar putih saat pertama buka | Pastikan URL di `WEB_APP_URL` benar & HTTPS; cek `chrome://inspect` (debug build) untuk error konsol |
| Notifikasi tidak muncul | Isi izin notifikasi; set baterai "Tanpa pembatasan"; cek channel "Pesanan & Notifikasi AGSI" = Urgent; pastikan `google-services.json` ada & backend FCM terisi |
| Push terkirim tapi heads-up tidak tampil | OEM Xiaomi/OPPO: aktifkan Autostart & izin notifikasi lock-screen |
| Upload foto tidak membuka dialog | Callback file chooser dibatalkan otomatis bila pilihan kosong — coba lagi; pastikan galeri/kamera ada di HP |
| DOKU halaman blank | Perlu internet stabil + third-party cookie aktif (sudah diatur); jangan blokir pop-up sistem |

---

Dibangun & diuji compile dengan: Gradle 8.14, AGP 8.11.1, Kotlin 2.2.0,
compileSdk 36, build-tools 36.0.0, JDK 17.
