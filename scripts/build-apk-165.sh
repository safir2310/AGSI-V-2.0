#!/bin/bash
# build-apk-165.sh — bangun AGSI-release-1.3.35.apk (code 49):
# PERBAIKAN BIOMETRIK + POPUP (permintaan pemilik):
#  1. "JEMBATAN NATIVE TIDAK TERSEDIA" SAAT AKTIFKAN FACE ID — akar: objek
#     interface window.AgsiNative usang pasca WebView dibuat ulang membuat
#     panggilan JS→Java melempar. Kini AgsiNativeBridge tidak pernah melempar
#     (semua metode biometrik try/catch → callback diagnostik), MainActivity
#     menahan BiometricPrompt ganda (ketukan ganda), dan sisi web mencoba
#     ulang sekali dengan jembatan yang dibaca ulang.
#  2. POPUP BERANDA GAMBAR SAJA 1:1 — judul/pesan/CTA dihapus dari popup;
#     panel admin ikut disederhanakan (web, bukan bagian APK).
# Log lengkap: /home/z/my-project/scripts/build-apk-165.log
set -uo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
TMP=$PROJ/.android-sdk-tmp
LOG=$PROJ/scripts/build-apk-165.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.35 / code 49)"
if [ ! -x "$TMP/jdk/bin/javac" ] || [ ! -d "$SDK/platforms/android-36" ]; then
  echo "SDK/JDK belum siap — pulihkan dulu (JDK Temurin 17 + restore-sdk.sh)"
  exit 1
fi
# FIREBASE AKTIF: google-services.json WAJIB ada — tanpa file ini build tetap
# sukses TAPI push FCM mati senyap (isPushAvailable=false).
if [ ! -f "$PROJ/download/agsi-android/app/google-services.json" ]; then
  echo "google-services.json HILANG di app/ — APK akan terbangun TANPA Firebase (push mati)."
  echo "Pulihkan file kredensial proyek agsi-pos-491c8 lalu jalankan ulang."
  exit 1
fi
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$TMP/jdk"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain > /tmp/gradle-165.out 2>&1
GRADLE_EXIT=$?
tail -40 /tmp/gradle-165.out
if [ $GRADLE_EXIT -ne 0 ]; then
  echo "GRADLE GAGAL (exit $GRADLE_EXIT) — APK TIDAK disalin. 30 baris terakhir:"
  tail -30 /tmp/gradle-165.out
  echo "BUILD FAILED $(date +%H:%M:%S)"
  exit 1
fi
grep -q "BUILD SUCCESSFUL" /tmp/gradle-165.out || { echo "Tidak ada BUILD SUCCESSFUL — tidak menyalin"; exit 1; }

echo "=== [$(date +%H:%M:%S)] verifikasi versi APK"
AAPT=$SDK/build-tools/36.0.0/aapt
BADGING=$($AAPT dump badging app/build/outputs/apk/release/app-release.apk 2>/dev/null | head -1)
echo "$BADGING" | grep -o "versionCode='[0-9]*' versionName='[^']*'"
case "$BADGING" in
  *"versionName='1.3.35'"*) ;;
  *) echo "BUKAN 1.3.35 — tidak menyalin"; exit 1 ;;
esac

echo "=== [$(date +%H:%M:%S)] salin hasil"
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.35.apk"
ls -la "$PROJ/download/AGSI-release-1.3.35.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
