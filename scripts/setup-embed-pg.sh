#!/usr/bin/env bash
# Setup PostgreSQL EMBEDDED (binari zonky via npm @embedded-postgres/linux-x64)
# untuk uji lokal. PG jalan di 127.0.0.1:5433, user postgres (-A trust).
# Idempoten: bila PG sudah jalan, langsung keluar sukses.
# Catatan: binari ini butuh ICU 60 — tersedia di lib/ paket; export
# LD_LIBRARY_PATH=/tmp/embedpg/lib saat memanggil binari pg.
set -u
PG_DIR=/tmp/embedpg
PORT=5433
export LD_LIBRARY_PATH="$PG_DIR/lib"

# Sudah jalan?
if [ -f "$PG_DIR/data/postmaster.pid" ] && kill -0 "$(head -1 "$PG_DIR/data/postmaster.pid" 2>/dev/null)" 2>/dev/null; then
  echo "PG sudah jalan (PID $(head -1 "$PG_DIR/data/postmaster.pid"))"
  exit 0
fi

mkdir -p "$PG_DIR"
cd "$PG_DIR" || exit 1

# 1) Unduh paket npm (registry npm stabil, tidak kena 429 Maven Central)
TGZ=pg.tgz
if [ ! -s "$TGZ" ] || [ "$(stat -c%s "$TGZ")" -lt 1000000 ]; then
  curl -sSL "https://registry.npmjs.org/@embedded-postgres/linux-x64/-/linux-x64-17.5.0-beta.15.tgz" \
    -o "$TGZ" --max-time 180
fi
[ -s "$TGZ" ] || { echo "GAGAL unduh tgz"; exit 1; }

# 2) Ekstrak
if [ ! -x "$PG_DIR/bin/postgres" ]; then
  echo "Ekstrak…"
  tar xzf "$TGZ"
  cp -r package/native/* "$PG_DIR"
  chmod +x bin/*
fi

# 3) Salin lib *.so versi -> symlink-equivalent (icu 60 dibundel di lib/)
if [ -d lib ] && ! [ -e lib/libicuuc.so.60 ]; then
  ( cd lib && python3 - <<'EOF'
import re, shutil, os
for f in sorted(os.listdir(".")):
    m = re.match(r"^(.*\.so)\.(\d+)\.(\d+)$", f)
    if m:
        base = m.group(1)
        for suffix in (f".{m.group(2)}", ""):
            dst = base + suffix
            if not os.path.exists(dst):
                shutil.copy2(f, dst)
EOF
  )
fi

# 4) initdb bila belum ada data dir
if [ ! -f "$PG_DIR/data/PG_VERSION" ]; then
  echo "initdb…"
  "$PG_DIR/bin/initdb" -D "$PG_DIR/data" -U postgres -A trust -E UTF8 >/dev/null
fi

# 5) start
echo "Start PG di port $PORT…"
"$PG_DIR/bin/pg_ctl" -D "$PG_DIR/data" -l "$PG_DIR/pg.log" \
  -o "-p $PORT -k /tmp" start || true
sleep 1
"$PG_DIR/bin/pg_ctl" -D "$PG_DIR/data" status
echo "SELESAI — koneksi: postgresql://postgres@127.0.0.1:$PORT/postgres"
