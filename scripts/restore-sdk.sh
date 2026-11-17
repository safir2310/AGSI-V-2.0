#!/bin/bash
# restore-sdk.sh — pulihkan Android SDK pasca recycle sandbox (v1.3.21)
set -euo pipefail
PROJ=/home/z/my-project
SDK=$PROJ/.android-sdk
JDK=$PROJ/.android-sdk-tmp/jdk
LOG=$PROJ/scripts/restore-sdk.log

{
echo "=== [$(date +%H:%M:%S)] unduh commandline-tools"
mkdir -p "$SDK"
cd /tmp
curl -sL -o cmdtools.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
unzip -q -o cmdtools.zip -d "$SDK/cmdline-tools-tmp"
mkdir -p "$SDK/cmdline-tools"
rm -rf "$SDK/cmdline-tools/latest"
mv "$SDK/cmdline-tools-tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
rm -rf "$SDK/cmdline-tools-tmp"

echo "=== [$(date +%H:%M:%S)] setujui lisensi + pasang paket"
export JAVA_HOME="$JDK"
export PATH="$JAVA_HOME/bin:$PATH"
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses > /dev/null 2>&1 || true
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" "platform-tools" "platforms;android-36" "build-tools;36.0.0"

echo "=== [$(date +%H:%M:%S)] SDK pulih:"
ls "$SDK/platforms" "$SDK/build-tools"
echo "RESTORE OK $(date +%H:%M:%S)"
} >> "$LOG" 2>&1
