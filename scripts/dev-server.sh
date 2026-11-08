#!/bin/bash
# Restart dev server AGSI POS (preview panel) — tahan restart sandbox.
# Pakai: bash scripts/dev-server.sh
cd "$(dirname "$0")/.." || exit 1

if curl -s -o /dev/null -m 3 http://localhost:3000; then
  echo "✓ Server sudah jalan di http://localhost:3000"
  exit 0
fi

(setsid nohup bun run dev > /tmp/agsi-dev.log 2>&1 < /dev/null &)
for i in $(seq 1 12); do
  sleep 5
  if curl -s -o /dev/null -m 3 http://localhost:3000; then
    echo "✓ Server hidup di http://localhost:3000 (log: /tmp/agsi-dev.log)"
    exit 0
  fi
done
echo "✗ Gagal start — lihat /tmp/agsi-dev.log"
exit 1
