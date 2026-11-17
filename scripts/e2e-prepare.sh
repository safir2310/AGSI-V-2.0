#!/bin/bash
# e2e-prepare.sh — siapkan lingkungan E2E: schema SQLite sementara (TANPA
# mengubah schema proyek) + database file segar + generate client SQLite.
set -euo pipefail
# DB di folder proyek — /tmp terbukti bisa terkunci read-only utk proses server
E2E_DB=/home/z/my-project/db/e2e-test.db
rm -f "$E2E_DB"
# Schema sementara harus DI DALAM folder proyek agar prisma generate menemukan
# node_modules (schema di /tmp membuat Prisma salah mengira root proyek = /).
mkdir -p /home/z/my-project/scripts/tmp
sed 's/provider = "postgresql"/provider = "sqlite"/' /home/z/my-project/prisma/schema.prisma > /home/z/my-project/scripts/tmp/e2e-schema-sqlite.prisma
E2E_SCHEMA=/home/z/my-project/scripts/tmp/e2e-schema-sqlite.prisma
echo "== provider schema E2E:"; grep -m2 'provider' "$E2E_SCHEMA"
cd /home/z/my-project
export DATABASE_URL="file:$E2E_DB"
npx prisma db push --schema="$E2E_SCHEMA" --accept-data-loss --skip-generate 2>&1 | tail -2
npx prisma generate --schema="$E2E_SCHEMA" 2>&1 | tail -2
echo "== client tergenerasi memakai provider:"; grep -m1 'provider' node_modules/.prisma/client/schema.prisma
echo "PREPARE OK"
