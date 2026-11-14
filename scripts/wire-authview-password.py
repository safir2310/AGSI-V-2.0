#!/usr/bin/env python3
"""
AuthView: validasi kebijakan sandi di alur DAFTAR & RESET + placeholder
menyebut aturan baru + minLength 8. Exact-match, idempoten.
"""
import os, sys

ROOT = "/home/z/my-project"
F = "src/components/auth/AuthView.tsx"
full = os.path.join(ROOT, F)
s = open(full).read()

if "password-policy" in s:
    print("SKIP: AuthView sudah dipasang")
    sys.exit(0)

EDITS = [
    # 1. import
    ('import { setAuthToken, apiFetch } from "@/lib/api";\n',
     'import { setAuthToken, apiFetch } from "@/lib/api";\nimport { validatePassword } from "@/lib/password-policy";\n'),
    # 2. cek saat daftar (submit)
    ('  const submit = async (e?: React.FormEvent) => {\n    e?.preventDefault();\n    setLoading(true);\n',
     '  const submit = async (e?: React.FormEvent) => {\n    e?.preventDefault();\n'
     '    if (mode !== "login") {\n'
     '      const pwCheck = validatePassword(form.password, { email: form.email });\n'
     '      if (!pwCheck.ok) {\n'
     '        showNotice({ type: "error", title: "Password Ditolak", message: pwCheck.error });\n'
     '        return;\n'
     '      }\n'
     '    }\n'
     '    setLoading(true);\n'),
    # 3. cek saat reset password
    ('    if (reset.newPassword.length < 6) {\n'
     '      showNotice({ type: "error", title: "Password Terlalu Pendek", message: "Password baru minimal 6 karakter." });\n'
     '      return;\n'
     '    }\n',
     '    const pwCheck = validatePassword(reset.newPassword, { email: form.email });\n'
     '    if (!pwCheck.ok) {\n'
     '      showNotice({ type: "error", title: "Password Ditolak", message: pwCheck.error });\n'
     '      return;\n'
     '    }\n'),
    # 4. placeholder reset
    ('                      id="reset-password"\n                      type="password"\n                      placeholder="Minimal 6 karakter"\n',
     '                      id="reset-password"\n                      type="password"\n                      placeholder="Minimal 8 karakter (huruf & angka)"\n'),
    # 5. placeholder login/daftar + minLength
    ('                    id="password"\n                    type="password"\n                    placeholder="Minimal 6 karakter"\n',
     '                    id="password"\n                    type="password"\n                    placeholder="Minimal 8 karakter (huruf & angka)"\n'),
    ('                    minLength={6}',
     '                    minLength={8}'),
]

for old, new in EDITS:
    if old not in s:
        print(f"GAGAL cocok: {old[:60]!r}..."); sys.exit(1)
    s = s.replace(old, new, 1)

open(full, "w").write(s)
print("OK: AuthView.tsx dipasang")
