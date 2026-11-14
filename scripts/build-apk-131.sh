#!/bin/bash
# build-apk-131.sh — bangun AGSI-release-1.3.1.apk di sandbox:
# 1) unduh Android cmdline-tools + platform-36 + build-tools
# 2) ./gradlew assembleRelease (bertanda tangan agsi-release.keystore
#    via keystore.properties yang di-commit khusus utk build reproduktif)
# 3) salin hasil ke download/AGSI-release-1.3.1.apk
# Log lengkap: /home/z/my-project/scripts/build-apk-131.log
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
GH=$PROJ/.gradle-home
TMP=$PROJ/.android-sdk-tmp
LOG=$PROJ/scripts/build-apk-131.log
mkdir -p "$SDK" "$GH" "$TMP"

{
echo "=== [$(date +%H:%M:%S)] 1/5 unduh Android cmdline-tools"
cd "$TMP"
[ -f cmdtools.zip ] || curl -fsSLo cmdtools.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
ls -la cmdtools.zip

echo "=== [$(date +%H:%M:%S)] 2/5 ekstrak cmdline-tools"
rm -rf "$TMP/ct" "$SDK/cmdline-tools"
mkdir -p "$SDK/cmdline-tools" "$TMP/ct"
unzip -q cmdtools.zip -d "$TMP/ct"
mv "$TMP/ct/cmdline-tools" "$SDK/cmdline-tools/latest"

echo "=== [$(date +%H:%M:%S)] 3/5 lisensi + pasang SDK packages"
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" \
  "platforms;android-36" "build-tools;35.0.0" "build-tools;36.0.0" "platform-tools" \
  >/dev/null 2>&1
ls "$SDK/platforms" "$SDK/build-tools" 2>/dev/null

echo "=== [$(date +%H:%M:%S)] 3.5/5 unduh JDK 21 (Temurin) — sandbox cuma punya JRE"
cd "$TMP"
if [ ! -x "$TMP/jdk/bin/javac" ]; then
  [ -f jdk.tar.gz ] || curl -fsSLo jdk.tar.gz \
    "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
  rm -rf "$TMP/jdkx" "$TMP/jdk"; mkdir -p "$TMP/jdkx"
  tar xzf jdk.tar.gz -C "$TMP/jdkx"
  mv "$TMP/jdkx"/jdk-* "$TMP/jdk"
fi
"$TMP/jdk/bin/javac" -version

echo "=== [$(date +%H:%M:%S)] 4/5 gradlew assembleRelease"
cd "$PROJ/download/agsi-android"
export ANDROID_HOME="$SDK"
export GRADLE_USER_HOME="$GH"
export JAVA_HOME="$TMP/jdk"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease --no-daemon --console=plain 2>&1 | tail -25

echo "=== [$(date +%H:%M:%S)] 5/5 salin hasil"
ls -la app/build/outputs/apk/release/
cp app/build/outputs/apk/release/app-release.apk "$PROJ/download/AGSI-release-1.3.1.apk"
ls -la "$PROJ/download/AGSI-release-1.3.1.apk"
echo "BUILD OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
