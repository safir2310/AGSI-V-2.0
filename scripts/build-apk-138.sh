#!/bin/bash
# build-apk-138.sh — bangun AGSI-release-1.3.8.apk (code 22):
# kontrol notifikasi senyap:
#  - notifikasi judul & isi kosong tidak dibuat + sisa kosong dihapus
#    (NotifPollerService & PushService)
#  - hanya jenis penting (pesanan/pembayaran/status/chat/kurir) tampil;
#    jenis "test" tak pernah jadi notifikasi sistem
#  - izin notifikasi: penolakan ke-2 dst → langsung ke setelan aplikasi
# Web+backend (di luar APK): tombol & endpoint notifikasi uji dimatikan
# di production; cetak struk/laporan → auto-save Unduhan/AGSI dulu.
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-138.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.8 / code 22)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -12

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.8.apk"
ls -la "$PROJ/download/AGSI-release-1.3.8.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
