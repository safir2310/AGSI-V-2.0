#!/bin/bash
# build-apk-134.sh — bangun AGSI-release-1.3.4.apk (code 18):
# channel v3 suara NOTIFIKASI biasa (v1+v2 dihapus saat migrasi),
# layar kunci publik + bangunkan layar (full-screen intent) TETAP,
# sinkron agsi_orders_v3/agsi_chat_v3 di manifest & push.ts.
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-134.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.4 / code 18)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -12

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.4.apk"
ls -la "$PROJ/download/AGSI-release-1.3.4.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
