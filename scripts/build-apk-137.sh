#!/bin/bash
# build-apk-137.sh — bangun AGSI-release-1.3.7.apk (code 21):
# izin PENYIMPANAN untuk struk & laporan:
#  - manifest WRITE/READ_EXTERNAL_STORAGE (maxSdk 32)
#  - Android 8–9: izin runtime diminta sekali → simpan LANGSUNG ke
#    Unduhan/AGSI (writeToPublicDownloads); ditolak → fallback SAF
#  - Android 10+: tetap MediaStore (tanpa izin/dialog)
#  - cetak struk/laporan tetap via PrintManager (printPage)
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-137.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.7 / code 21)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -12

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.7.apk"
ls -la "$PROJ/download/AGSI-release-1.3.7.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
