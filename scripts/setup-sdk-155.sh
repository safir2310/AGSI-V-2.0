#!/bin/bash
# setup-sdk-155.sh — siapkan Android SDK + JDK 21 untuk build APK v1.3.28
# (sandbox baru: SDK/JDK lama hilang saat daur ulang). Pola sama dengan
# build-apk-131.sh langkah 1–3.5, tanpa build.
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
TMP=$PROJ/.android-sdk-tmp
LOG=$PROJ/scripts/setup-sdk-155.log
mkdir -p "$SDK" "$GH" "$TMP"

{
echo "=== [$(date +%H:%M:%S)] 1/4 unduh Android cmdline-tools"
cd "$TMP"
[ -f cmdtools.zip ] || curl -fsSLo cmdtools.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip

echo "=== [$(date +%H:%M:%S)] 2/4 ekstrak cmdline-tools"
rm -rf "$TMP/ct" "$SDK/cmdline-tools"
mkdir -p "$SDK/cmdline-tools" "$TMP/ct"
unzip -q cmdtools.zip -d "$TMP/ct"
mv "$TMP/ct/cmdline-tools" "$SDK/cmdline-tools/latest"

echo "=== [$(date +%H:%M:%S)] 3/4 lisensi + pasang SDK packages"
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" \
  "platforms;android-36" "build-tools;35.0.0" "build-tools;36.0.0" "platform-tools" \
  >/dev/null 2>&1
ls "$SDK/platforms" "$SDK/build-tools" 2>/dev/null

echo "=== [$(date +%H:%M:%S)] 3.5/4 unduh JDK 21 (Temurin)"
cd "$TMP"
if [ ! -x "$TMP/jdk/bin/javac" ]; then
  [ -f jdk.tar.gz ] || curl -fsSLo jdk.tar.gz \
    "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
  rm -rf "$TMP/jdkx" "$TMP/jdk"; mkdir -p "$TMP/jdkx"
  tar xzf jdk.tar.gz -C "$TMP/jdkx"
  mv "$TMP/jdkx"/jdk-* "$TMP/jdk"
fi
"$TMP/jdk/bin/javac" -version
echo "SETUP OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
