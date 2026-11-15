#!/bin/bash
# setup-jdk.sh — unduh JDK 21 lengkap (dengan javac) ke .android-sdk-tmp/jdk
# JRE sistem tidak punya javac — gradle butuh JAVA_COMPILER.
set -euo pipefail
JDK_DIR=/home/z/my-project/.android-sdk-tmp/jdk
DL=/tmp/jdkdl
mkdir -p "$DL" /home/z/my-project/.android-sdk-tmp
cd "$DL"
[ -f jdk.tar.gz ] || curl -fsSL -o jdk.tar.gz \
  "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
rm -rf "$JDK_DIR" "$DL/x"
mkdir -p "$DL/x"
tar -xzf jdk.tar.gz -C "$DL/x" --strip-components=1
mv "$DL/x" "$JDK_DIR"
"$JDK_DIR/bin/javac" --version
"$JDK_DIR/bin/java" -version 2>&1 | head -1
echo "JDK SETUP OK"
