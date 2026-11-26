#!/bin/bash
# build-apk-160.sh — bangun AGSI-release-1.3.30.apk (code 44):
# PAKET PEMBARUAN NOTIFIKASI (permintaan pemilik):
#  1. SUARA NOTIFIKASI DAPAT DISESUAIKAN di Profil ▸ Notifikasi Push —
#     7 pilihan (Chime klasik, Ding, Bel, Marimba, Pop, Suara Sistem,
#     Senyap) + tombol pratinjau; tersimpan per perangkat (SharedPreferences);
#     berlaku untuk FCM & poller walau aplikasi ditutup / layar terkunci
#     (channel varian agsi_*_v5_<key> dibuat on-demand, NotifSound.kt).
#  2. Unduhan struk/laporan di status bar kini berPROGRES NYATA:
#     "67% · 1,2 MB" (dulu baris tak tentu) — tulis per bagian 256 KB.
#  3. Jalur notifikasi pesanan tetap: FCM data-only HIGH + full-screen intent
#     (membangunkan layar terkunci) + NotifPollerService cadangan.
# Log lengkap: /home/z/my-project/scripts/build-apk-160.log
set -uo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
TMP=$PROJ/.android-sdk-tmp
LOG=$PROJ/scripts/build-apk-160.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.30 / code 44)"
if [ ! -x "$TMP/jdk/bin/javac" ] || [ ! -d "$SDK/platforms/android-36" ]; then
  echo "SDK/JDK belum siap — pulihkan dulu (JDK Temurin 17 + restore-sdk.sh)"
  exit 1
fi
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$TMP/jdk"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -40

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.30.apk"
ls -la "$PROJ/download/AGSI-release-1.3.30.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
