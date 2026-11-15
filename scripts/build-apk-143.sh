#!/bin/bash
# build-apk-143.sh — bangun AGSI-release-1.3.13.apk (code 27):
# SUITE 5 GAYA NOTIFIKASI IN-APP — heads-up (kartu atas melayang), banner
# (strip "N kabar baru"), floating (gelembung draggable + angka), popup
# (modal tengah, tetap CenterNotice), toast (pil bawah). Semua di sisi web
# (src/lib/notif-suite.ts + src/components/shared/NotifSuite.tsx) — APK di-
# bangun ulang hanya untuk menaikkan versi & menyajikannya lewat /agsi-app.apk.
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-143.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.13 / code 27)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -40

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.13.apk"
ls -la "$PROJ/download/AGSI-release-1.3.13.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
