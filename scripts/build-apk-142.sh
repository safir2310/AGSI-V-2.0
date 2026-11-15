#!/bin/bash
# build-apk-142.sh — bangun AGSI-release-1.3.12.apk (code 26):
# IZIN BERJALAN DI LATAR BELAKANG DIPERKUAT — baris status "Berjalan di
# Latar Belakang" + tombol "Izinkan Baterai" (dialog sistem langsung,
# tanpa jeda 3 hari) + tombol "Autostart" pabrikan (Xiaomi MIUI, OPPO/
# realme, vivo, Huawei/Honor) di Pengaturan Notifikasi via jembatan web
# (isBatteryUnrestricted / requestBatteryUnrestriction / openAutostartSettings).
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-142.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.12 / code 26)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -40

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.12.apk"
ls -la "$PROJ/download/AGSI-release-1.3.12.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
