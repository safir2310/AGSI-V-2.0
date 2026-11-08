#!/bin/bash
# Pastikan dev server Next.js (port 3000) hidup — mulai bila belum berjalan.
if curl -s -o /dev/null --max-time 3 http://127.0.0.1:3000/; then
  echo "server: sudah hidup"
  exit 0
fi
cd /home/z/my-project || exit 1
setsid nohup bun run dev < /dev/null > dev.log 2>&1 &
for i in $(seq 1 45); do
  sleep 1
  if curl -s -o /dev/null --max-time 2 http://127.0.0.1:3000/; then
    echo "server: siap (${i}s)"
    exit 0
  fi
done
echo "server: GAGAL naik"
exit 1
