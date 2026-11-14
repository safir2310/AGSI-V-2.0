#!/usr/bin/env python3
"""
Sambungkan src/lib/password-policy.ts ke 9 endpoint API yang menyetel sandi.
Penggantian persis (exact-match) supaya aman diulang (idempoten).
Jalankan dari root proyek: python3 scripts/wire-password-policy.py
"""
import os, sys

ROOT = "/home/z/my-project"

# (file, old, new) — exact strings
EDITS = [
    # ===== couriers (POST) =====
    ("src/app/api/couriers/route.ts",
     '    if (password.length < 6) {\n      return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });\n    }\n',
     '    const pwCheck = validatePassword(password, { email });\n    if (!pwCheck.ok) {\n      return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n    }\n'),
    # ===== couriers/[id] (PUT/PATCH, opsional) =====
    ("src/app/api/couriers/[id]/route.ts",
     '    if (password && password.length < 6) {\n      return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });\n    }\n',
     '    if (password) {\n      const pwCheck = validatePassword(password, { email });\n      if (!pwCheck.ok) {\n        return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n      }\n    }\n'),
    # ===== cashiers (POST) =====
    ("src/app/api/cashiers/route.ts",
     '    if (password.length < 6) {\n      return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });\n    }\n',
     '    const pwCheck = validatePassword(password, { email });\n    if (!pwCheck.ok) {\n      return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n    }\n'),
    # ===== cashiers/[id] =====
    ("src/app/api/cashiers/[id]/route.ts",
     '    if (password && password.length < 6) {\n      return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });\n    }\n',
     '    if (password) {\n      const pwCheck = validatePassword(password, { email });\n      if (!pwCheck.ok) {\n        return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n      }\n    }\n'),
    # ===== admins (POST) =====
    ("src/app/api/admins/route.ts",
     '    if (password.length < 6) {\n      return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });\n    }\n',
     '    const pwCheck = validatePassword(password, { email });\n    if (!pwCheck.ok) {\n      return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n    }\n'),
    # ===== admins/[id] =====
    ("src/app/api/admins/[id]/route.ts",
     '    if (password && password.length < 6) {\n      return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });\n    }\n',
     '    if (password) {\n      const pwCheck = validatePassword(password, { email });\n      if (!pwCheck.ok) {\n        return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n      }\n    }\n'),
    # ===== register (pelanggan) =====
    ("src/app/api/auth/register/route.ts",
     '    if (String(password).length < 6) {\n      return NextResponse.json(\n        { error: "Password minimal 6 karakter." },\n        { status: 400 }\n      );\n    }\n',
     '    const pwCheck = validatePassword(String(password), { email });\n    if (!pwCheck.ok) {\n      return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n    }\n'),
    # ===== reset-password (lupa sandi) =====
    ("src/app/api/auth/reset-password/route.ts",
     '    if (newPwd.length < 6) {\n      return NextResponse.json(\n        { error: "Password baru minimal 6 karakter." },\n        { status: 400 }\n      );\n    }\n',
     '    const pwCheck = validatePassword(newPwd, { email });\n    if (!pwCheck.ok) {\n      return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n    }\n'),
    # ===== me (ganti sandi sendiri) =====
    ("src/app/api/auth/me/route.ts",
     '      if (newPassword.length < 6) {\n        return NextResponse.json({ error: "Password baru minimal 6 karakter." }, { status: 400 });\n      }\n',
     '      const pwCheck = validatePassword(newPassword, { email: me.email });\n      if (!pwCheck.ok) {\n        return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n      }\n'),
]

# Tambahkan import validatePassword setelah baris import dari @/lib/auth
IMPORT_ANCHOR = {
    "src/app/api/couriers/route.ts": 'import { getCurrentUser, hashPassword, isAdminRole } from "@/lib/auth";\n',
    "src/app/api/couriers/[id]/route.ts": None,
    "src/app/api/cashiers/route.ts": None,
    "src/app/api/cashiers/[id]/route.ts": None,
    "src/app/api/admins/route.ts": None,
    "src/app/api/admins/[id]/route.ts": None,
    "src/app/api/auth/register/route.ts": 'import { createSession, hashPassword } from "@/lib/auth";\n',
    "src/app/api/auth/reset-password/route.ts": None,
    "src/app/api/auth/me/route.ts": 'import { getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";\n',
}

changed = 0
for path, old, new in EDITS:
    full = os.path.join(ROOT, path)
    s = open(full).read()
    if "validatePassword" in s:
        print(f"SKIP (sudah): {path}")
        continue
    if old not in s:
        print(f"GAGAL cocok di: {path}"); sys.exit(1)
    s = s.replace(old, new, 1)
    # import: sisip setelah import @/lib/auth terakhir, atau setelah import pertama
    anchor = IMPORT_ANCHOR.get(path)
    if anchor and anchor in s:
        s = s.replace(anchor, anchor + 'import { validatePassword } from "@/lib/password-policy";\n', 1)
    elif 'import { validatePassword } from "@/lib/password-policy"' not in s:
        # fallback: sisip setelah baris import NextResponse pertama
        idx = s.find("from \"next/server\";")
        line_end = s.find("\n", idx)
        s = s[:line_end + 1] + 'import { validatePassword } from "@/lib/password-policy";\n' + s[line_end + 1:]
    open(full, "w").write(s)
    changed += 1
    print(f"OK: {path}")

print(f"selesai — {changed} file diubah")
