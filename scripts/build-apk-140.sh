#!/bin/bash
# build-apk-140.sh — bangun AGSI-release-1.3.10.apk (code 24):
# 10 FITUR NOTIFIKASI — Notification Center (NotifHistory + jembatan web),
# Notification Badge (angka belum dibaca), Lock Screen Push, Heads-Up Banner,
# Notification Sound (chime khas AGSI, channel v4), Vibration Alert,
# Notification Grouping (+ ringkasan GroupSummary), Quick Reply (RemoteInput →
# ChatReplyReceiver → POST /api/chat), Deep Link (event agsi-nav — /orders &
# /chat sebelumnya 404), Background Push Service (FCM + poller, tanpa FGS).
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-140.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.10 / code 24)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -12

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.10.apk"
ls -la "$PROJ/download/AGSI-release-1.3.10.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
