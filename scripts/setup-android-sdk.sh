#!/bin/bash
# setup-android-sdk.sh — pasang ulang Android SDK (terhapus saat daur ulang
# sandbox) di path yang sama /home/z/my-project/.android-sdk:
# platform-tools, platforms;android-36, build-tools;36.0.0.
set -euo pipefail
SDK=/home/z/my-project/.android-sdk
JDK=/usr/lib/jvm/java-21-openjdk-amd64
DL=/tmp/sdkdl

mkdir -p "$SDK/cmdline-tools" "$DL"
cd "$DL"
[ -f cmdtools.zip ] || curl -fsSL -o cmdtools.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip

rm -rf "$DL/x" "$SDK/cmdline-tools/latest"
mkdir -p "$DL/x"
unzip -q cmdtools.zip -d "$DL/x"
mv "$DL/x/cmdline-tools" "$SDK/cmdline-tools/latest"

export JAVA_HOME="$JDK"
export PATH="$JDK/bin:$PATH"
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
"$SDK/cmdline-tools/latest/bin/sdkmanager" --install \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
  > "$DL/install.log" 2>&1

ls "$SDK"
echo "SDK SETUP OK"
