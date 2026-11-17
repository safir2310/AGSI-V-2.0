#!/bin/bash
# build-apk-158.sh — bangun AGSI-release-1.3.29.apk (code 43):
# PAKET PEMBARUAN UNTUK BANNER & PROMO — versi naik agar seluruh instalasi
# lama (≤1.3.28) menerima banner "Perbarui" di dalam aplikasi dan memuat
# web terbaru (perbaikan simpan Banner & Promo: auto-retry jaringan, anti
# badan request raksasa, pesan error jujur, simpan hanya-yang-berubah).
# APK = pembungkus WebView yang sama; konten berasal dari situs live.
# Log lengkap: /home/z/my-project/scripts/build-apk-158.log
set -uo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
TMP=$PROJ/.android-sdk-tmp
LOG=$PROJ/scripts/build-apk-158.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.29 / code 43)"
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
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.29.apk"
ls -la "$PROJ/download/AGSI-release-1.3.29.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
