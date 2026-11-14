#!/bin/bash
# build-apk-132.sh — bangun AGSI-release-1.3.2.apk (notifikasi real-time):
# PushService meneruskan push ke halaman (event JS "agsi-push") saat app
# terbuka + channel chat benar di foreground. Toolchain di .android-sdk /
# .jdk / .gradle-home sudah terpasang oleh build-apk-131.sh — cepat.
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-132.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.2 / code 16)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -12

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.2.apk"
ls -la "$PROJ/download/AGSI-release-1.3.2.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
