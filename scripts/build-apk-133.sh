#!/bin/bash
# build-apk-133.sh — bangun AGSI-release-1.3.3.apk (notifikasi garda-besar):
# channel v2 bersuara ALARM nyaring + getar kuat + layar kunci publik,
# full-screen intent membangunkan layar HP yang tidur/terkunci,
# sinkron channel agsi_orders_v2/agsi_chat_v2 di manifest & push.ts.
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-133.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.3 / code 17)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -12

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.3.apk"
ls -la "$PROJ/download/AGSI-release-1.3.3.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
