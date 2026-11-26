#!/bin/bash
# build-apk-145.sh — bangun AGSI-release-1.3.37.apk (code 51):
# DIALOG CETAK SISTEM KINI MUNCUL DI SEMUA HP (permintaan pemilik:
# "dialog printer tidak muncul di android, munculkan dialog printer di
# aplikasi"). Akar masalah: ROM OPPO/realme/MIUI mematikan layanan
# "Print Spooler" bawaan → print() sukses tapi dialog tak pernah tampil
# (dan lama dijawab "sukses" palsu). Perbaikan (MainActivity.kt):
#  1. Deteksi dini spooler nonaktif (getApplicationEnabledSetting + <queries>)
#  2. Halaman "Aktifkan" Print Spooler DIBUKA OTOMATIS + panduan di web
#     (tanda LAYANAN_CETAK_NONAKTIF → kartu bimbingan, bukan senyap)
#  3. Penjaga jawaban tunggal: pengawas 12 dtk tidak lagi menjawab
#     "gagal" setelah jawaban sukses terkirim
#  4. print() null/exception → halaman pengaturan cetak dibuka
# Sisi web: ReceiptSheet menampilkan kartu panduan (Aktifkan → kembali →
# Cetak lagi). Catatan lingkungan: SDK dipulihkan via setup-android-sdk.sh,
# JDK memakai sistem /usr/lib/jvm/java-21-openjdk-amd64.
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/build-apk-145.log

{
echo "=== [$(date +%H:%M:%S)] gradlew assembleRelease (v1.3.37 / code 51)"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -40

echo "=== [$(date +%H:%M:%S)] salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.37.apk"
ls -la "$PROJ/download/AGSI-release-1.3.37.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
