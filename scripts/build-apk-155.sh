#!/bin/bash
# build-apk-155.sh — bangun AGSI-release-1.3.28.apk (code 42):
# CETAK VIA PRINTER SISTEM + POPUP NAMA FILE + NOTIFIKASI UNDUHAN —
#  1) tombol Cetak struk membuka dialog cetak SISTEM Android atas FILE PDF
#     sungguhan (PrintManager + PdfPrintAdapter) — thermal 58/80 mm,
#     Bluetooth, atau "Simpan sebagai PDF"; laporan tetap dialog sistem.
#  2) Simpan/Cetak tampil POPUP NAMA FILE dulu (web, FileNameConfirm).
#  3) Simpan file → NOTIFIKASI UNDUHAN di status bar (DownloadNotifier:
#     progres → "Unduhan selesai ✓", ketuk kartu membuka file).
# Log lengkap: /home/z/my-project/scripts/build-apk-155.log
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
TMP=$PROJ/.android-sdk-tmp
LOG=$PROJ/scripts/build-apk-155.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.28 / code 42)"
if [ ! -x "$TMP/jdk/bin/javac" ] || [ ! -d "$SDK/platforms/android-36" ]; then
  echo "SDK/JDK belum siap — jalankan setup-sdk-155.sh dulu"
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
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.28.apk"
ls -la "$PROJ/download/AGSI-release-1.3.28.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
