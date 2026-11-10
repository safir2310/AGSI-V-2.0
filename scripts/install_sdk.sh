#!/bin/bash
# Instal Android SDK ke /home/z/android-sdk (sandbox bisa di-recycle, jadi idempoten)
set -e
SDK=/home/z/android-sdk
mkdir -p "$SDK"
cd /tmp

if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "Mengunduh cmdline-tools..." > /tmp/sdk-status.txt
  curl -sSL -o cmdtools.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  unzip -q -o cmdtools.zip -d /tmp/cmdtools_extract
  mkdir -p "$SDK/cmdline-tools"
  rm -rf "$SDK/cmdline-tools/latest"
  mv /tmp/cmdtools_extract/cmdline-tools "$SDK/cmdline-tools/latest"
fi

echo "Menginstal paket (platform-tools, android-36, build-tools 36.0.0)..." > /tmp/sdk-status.txt
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" > /tmp/sdkmanager.log 2>&1

echo "DONE" > /tmp/sdk-status.txt
