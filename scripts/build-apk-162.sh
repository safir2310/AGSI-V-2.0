#!/bin/bash
# build-apk-162.sh — bangun AGSI-release-1.3.32.apk (code 46):
# PAKET PEMBARUAN NOTIFIKASI (permintaan pemilik):
#  1. KARTU "AGSI AKTIF" TETAP DI STATUS BAR — NotifPollerService kini
#     FOREGROUND SERVICE (specialUse) dengan kartu senyap IMPORTANCE_LOW
#     yang selalu tampil: app dibuka maupun ditutup; hidup sejak HP
#     dinyalakan via BootReceiver (BOOT_COMPLETED/QUICKBOOT); START_STICKY.
#     Layanan tidak lagi menghentikan diri saat FCM aktif (gate fcmActive
#     tetap mencegah notifikasi ganda).
#  2. PENGATURAN NOTIFIKASI DI HALAMAN PROFIL (web) — sheet "Notifikasi
#     Push" yang selama ini tak pernah dirender kini tersambung lewat menu
#     "Pengaturan Notifikasi" (semua role) + deskripsi status langsung.
# Log lengkap: /home/z/my-project/scripts/build-apk-162.log
set -uo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
TMP=$PROJ/.android-sdk-tmp
LOG=$PROJ/scripts/build-apk-162.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.32 / code 46)"
if [ ! -x "$TMP/jdk/bin/javac" ] || [ ! -d "$SDK/platforms/android-36" ]; then
  echo "SDK/JDK belum siap — pulihkan dulu (JDK Temurin 17 + restore-sdk.sh)"
  exit 1
fi
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$TMP/jdk"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain > /tmp/gradle-162.out 2>&1
GRADLE_EXIT=$?
tail -40 /tmp/gradle-162.out
if [ $GRADLE_EXIT -ne 0 ]; then
  echo "GRADLE GAGAL (exit $GRADLE_EXIT) — APK TIDAK disalin. 30 baris terakhir:"
  tail -30 /tmp/gradle-162.out
  echo "BUILD FAILED $(date +%H:%M:%S)"
  exit 1
fi
grep -q "BUILD SUCCESSFUL" /tmp/gradle-162.out || { echo "Tidak ada BUILD SUCCESSFUL — tidak menyalin"; exit 1; }

echo "=== [$(date +%H:%M:%S)] verifikasi versi APK"
AAPT=$SDK/build-tools/36.0.0/aapt
BADGING=$($AAPT dump badging app/build/outputs/apk/release/app-release.apk 2>/dev/null | head -1)
echo "$BADGING" | grep -o "versionCode='[0-9]*' versionName='[^']*'"
case "$BADGING" in
  *"versionName='1.3.32'"*) ;;
  *) echo "BUKAN 1.3.32 — tidak menyalin"; exit 1 ;;
esac

echo "=== [$(date +%H:%M:%S)] salin hasil"
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.32.apk"
ls -la "$PROJ/download/AGSI-release-1.3.32.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
