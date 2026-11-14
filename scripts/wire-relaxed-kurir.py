#!/usr/bin/env python3
"""
Mode santai sandi KURIR: boleh nama & angka berurutan (min 6).
- couriers (buat+ubah): relaxed langsung
- reset-password: sadarkan role (COURIER = santai, lain tetap ketat)
- me (ganti sandi sendiri): sadarkan role
- KurirsSheet UI: validasi santai + teks bantuan baru
Exact-match, idempoten. Jalankan dari root: python3 scripts/wire-relaxed-kurir.py
"""
import os, sys

ROOT = "/home/z/my-project"

EDITS = [
    # 1. POST kurir — santai
    ("src/app/api/couriers/route.ts",
     "const pwCheck = validatePassword(password, { email });",
     "const pwCheck = validatePassword(password, { relaxed: true });"),
    # 2. PUT kurir [id] — santai
    ("src/app/api/couriers/[id]/route.ts",
     "const pwCheck = validatePassword(password);",
     "const pwCheck = validatePassword(password, { relaxed: true });"),
    # 3. reset-password — pindahkan cek ke sesudah lookup user, sadarkan role
    ("src/app/api/auth/reset-password/route.ts",
     "    const pwCheck = validatePassword(newPwd, { email });\n"
     "    if (!pwCheck.ok) {\n"
     "      return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n"
     "    }\n"
     "\n"
     "    const user = await db.user.findUnique({ where: { email: normalized } });\n"
     "    if (!user) {\n"
     "      return NextResponse.json(\n"
     "        { error: \"Email ini belum terdaftar.\" },\n"
     "        { status: 404 }\n"
     "      );\n"
     "    }\n",
     "    const user = await db.user.findUnique({ where: { email: normalized } });\n"
     "    if (!user) {\n"
     "      return NextResponse.json(\n"
     "        { error: \"Email ini belum terdaftar.\" },\n"
     "        { status: 404 }\n"
     "      );\n"
     "    }\n"
     "\n"
     "    // Sandi kurir santai (boleh nama/angka berurutan); role lain tetap ketat\n"
     "    const pwCheck = validatePassword(newPwd, {\n"
     "      email: normalized,\n"
     "      relaxed: user.role === \"COURIER\",\n"
     "    });\n"
     "    if (!pwCheck.ok) {\n"
     "      return NextResponse.json({ error: pwCheck.error }, { status: 400 });\n"
     "    }\n"),
    # 4. me (ganti sandi sendiri) — sadarkan role
    ("src/app/api/auth/me/route.ts",
     "const pwCheck = validatePassword(newPassword, { email: me.email });",
     "const pwCheck = validatePassword(newPassword, {\n"
     "        email: me.email,\n"
     "        relaxed: me.role === \"COURIER\",\n"
     "      });"),
    # 5. KurirsSheet — validasi klien santai
    ("src/components/admin/KurirsSheet.tsx",
     "const pwCheck = validatePassword(password, { email });",
     "const pwCheck = validatePassword(password, { relaxed: true });"),
    # 6. KurirsSheet — placeholder
    ("src/components/admin/KurirsSheet.tsx",
     'placeholder={isAdd ? "Min. 8 karakter (huruf & angka)" : "Kosongkan bila tidak diganti"}',
     'placeholder={isAdd ? "Min. 6 — boleh nama / angka berurutan" : "Kosongkan bila tidak diganti"}'),
    # 7. KurirsSheet — teks bantuan
    ("src/components/admin/KurirsSheet.tsx",
     '? "Kurir memakai email & password ini untuk masuk beranda kurir. Hindari sandi umum (mis. kurir123) — sandi yang pernah bocor memunculkan peringatan Chrome saat login."',
     '? "Sandi kurir santai: minimal 6 karakter, boleh nama (mis. budi) atau angka berurutan (mis. 123456). Sandi sangat umum bisa memunculkan peringatan Chrome saat kurir login."'),
]

for path, old, new in EDITS:
    full = os.path.join(ROOT, path)
    s = open(full).read()
    if old not in s:
        print(f"GAGAL cocok di: {path}\n  → {old[:70]!r}")
        sys.exit(1)
    s = s.replace(old, new, 1)
    open(full, "w").write(s)
    print(f"OK: {path}")

print("selesai")
