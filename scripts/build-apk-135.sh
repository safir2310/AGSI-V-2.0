#!/bin/bash
# build-apk-135.sh — bangun AGSI-release-1.3.5.apk (code 19):
# aplikasi AKTIF meminta izin notifikasi runtime (Android 13+) tiap
# dibuka selama belum disetujui; ditolak → penjelasan + pintasan
# langsung ke setelan notifikasi aplikasi (throttle 1×/24 jam);
# cek juga saklar notifikasi mati via setelan sistem (semua versi).
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-135.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.5 / code 19)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -12

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.5.apk"
ls -la "$PROJ/download/AGSI-release-1.3.5.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
