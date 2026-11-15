#!/bin/bash
# build-apk-139.sh — bangun AGSI-release-1.3.9.apk (code 23):
#  - notifikasi layanan "AGSI aktif" DIHAPUS TOTAL: NotifPollerService
#    jalan sebagai service biasa tanpa startForeground; FOREGROUND_SERVICE
#    (_SPECIAL_USE) + RECEIVE_BOOT_COMPLETED dihapus dari manifest;
#    BootReceiver dihapus (FCM = mekanisme utama notifikasi)
#  - izin berjalan di latar belakang: dialog sistem "abaikan optimasi
#    baterai" diminta LANGSUNG dari MainActivity saat aplikasi dibuka
#    (dulu dicoba dari layanan — diblokir Android 10+, tak pernah tampil)
#  - perbaikan cetak struk (halaman Pesanan admin) & laporan: simpan
#    berurutan + keterangan tiap langkah (v1.3.8 fire-and-forget hening)
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-139.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.9 / code 23)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -12

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.9.apk"
ls -la "$PROJ/download/AGSI-release-1.3.9.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
