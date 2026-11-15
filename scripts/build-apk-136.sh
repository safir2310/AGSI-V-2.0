#!/bin/bash
# build-apk-136.sh — bangun AGSI-release-1.3.6.apk (code 20):
# notifikasi layanan "AGSI aktif" TAK TERLIHAT TOTAL di semua HP —
# isi dikosongkan + ikon transparan (ic_notification_hidden.xml):
# walau sebagian ROM memaksakan menampilkan notifikasi FGS walau
# channel IMPORTANCE_NONE, bentuknya 0 piksel. Layanan pemantau tetap
# jalan sah sebagai foreground service.
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-136.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.6 / code 20)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -12

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.6.apk"
ls -la "$PROJ/download/AGSI-release-1.3.6.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
