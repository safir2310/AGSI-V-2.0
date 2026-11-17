#!/bin/bash
# build-apk-157.sh — bangun AGSI-release-1.3.27.apk (code 28):
# NOTIFIKASI LANGSUNG DI STATUS BAR — saat aplikasi TERBUKA, push FCM kini
# membuat kartu sistem PENUH (heads-up + suara khas AGSI + getar + layar
# kunci), bukan kartu senyap; tampilan suite in-app web (popup/heads-up/
# banner/gelembung/toast) & suara web DIMATIKAN di dalam aplikasi native
# (NotifWatchers + PushBridge gate isNativeAndroidApp) — halaman hanya
# segarkan data. Browser tetap pakai suite web.
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-157.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.27 / code 41)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -40

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.27.apk"
ls -la "$PROJ/download/AGSI-release-1.3.27.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
