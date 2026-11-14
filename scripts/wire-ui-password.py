#!/usr/bin/env python3
"""
UI sandi: sheet Kurir/Kasir/Admin — validasi kebijakan + tombol
"Usul sandi kuat" + teks bantuan tentang peringatan pelanggaran Chrome.
Exact-match, idempoten. Jalankan dari root: python3 scripts/wire-ui-password.py
"""
import os, sys

ROOT = "/home/z/my-project"

REACT_IMPORT = 'import { useCallback, useEffect, useRef, useState } from "react";\n'
POLICY_IMPORT = 'import { suggestPassword, validatePassword } from "@/lib/password-policy";\n'

OLD_CHECK = (
    '    if (isAdd && password.length < 6) {\n'
    '      showNotice({ type: "error", title: "Password Kurang", message: "Password minimal 6 karakter." });\n'
    '      return;\n'
    '    }\n'
)
NEW_CHECK = (
    '    if (password) {\n'
    '      const pwCheck = validatePassword(password, { email });\n'
    '      if (!pwCheck.ok) {\n'
    '        showNotice({ type: "error", title: "Password Ditolak", message: pwCheck.error });\n'
    '        return;\n'
    '      }\n'
    '    }\n'
)

# Template dengan token __PID__ dan __ACCENT__ (hindari kekacauan escaping)
LABEL_OLD_T = (
    '                    <Label htmlFor="__PID__-pass">\n'
    '                      {isAdd ? "Password" : "Password Baru (opsional)"}\n'
    '                    </Label>'
)
LABEL_NEW_T = (
    '                    <div className="flex items-center justify-between gap-2">\n'
    '                      <Label htmlFor="__PID__-pass">\n'
    '                        {isAdd ? "Password" : "Password Baru (opsional)"}\n'
    '                      </Label>\n'
    '                      <button\n'
    '                        type="button"\n'
    '                        onClick={() =>\n'
    '                          setForm((f) => {\n'
    '                            const s = suggestPassword();\n'
    '                            return { ...f, password: s, confirmPassword: s };\n'
    '                          })\n'
    '                        }\n'
    '                        className="shrink-0 rounded-full border border-__ACCENT__-200 bg-__ACCENT__-50 px-2.5 py-1 text-[10px] font-bold text-__ACCENT__-700 hover:bg-__ACCENT__-100"\n'
    '                      >\n'
    '                        Usul sandi kuat\n'
    '                      </button>\n'
    '                    </div>'
)

SHEETS = [
    ("src/components/admin/KurirsSheet.tsx", "kr", "emerald",
     '? "Kurir memakai email & password ini untuk masuk beranda kurir."',
     '? "Kurir memakai email & password ini untuk masuk beranda kurir. Hindari sandi umum (mis. kurir123) — sandi yang pernah bocor memunculkan peringatan Chrome saat login."'),
    ("src/components/admin/CashiersSheet.tsx", "cs", "orange",
     '? "Kasir memakai email & password ini untuk masuk mode POS."',
     '? "Kasir memakai email & password ini untuk masuk mode POS. Hindari sandi umum — sandi yang pernah bocor memunculkan peringatan Chrome saat login."'),
    ("src/components/admin/AdminsSheet.tsx", "ad", "orange",
     '? "Admin memakai email & password ini untuk masuk ke aplikasi."',
     '? "Admin memakai email & password ini untuk masuk ke aplikasi. Hindari sandi umum — sandi yang pernah bocor memunculkan peringatan Chrome saat login."'),
]

changed = 0
for path, pid, accent, old_helper, new_helper in SHEETS:
    full = os.path.join(ROOT, path)
    s = open(full).read()
    if "validatePassword" in s:
        print(f"SKIP (sudah): {path}")
        continue
    # 1. import
    if POLICY_IMPORT not in s:
        s = s.replace(REACT_IMPORT, REACT_IMPORT + POLICY_IMPORT, 1)
    # 2. submit check
    if OLD_CHECK not in s:
        print(f"GAGAL cocok check di: {path}"); sys.exit(1)
    s = s.replace(OLD_CHECK, NEW_CHECK, 1)
    # 3. label + tombol usul
    lo = LABEL_OLD_T.replace("__PID__", pid)
    ln = LABEL_NEW_T.replace("__PID__", pid).replace("__ACCENT__", accent)
    if lo not in s:
        print(f"GAGAL cocok label di: {path}"); sys.exit(1)
    s = s.replace(lo, ln, 1)
    # 4. placeholder
    s = s.replace('placeholder={isAdd ? "Min. 6 karakter" : "Kosongkan bila tidak diganti"}',
                  'placeholder={isAdd ? "Min. 8 karakter (huruf & angka)" : "Kosongkan bila tidak diganti"}', 1)
    # 5. helper text
    if old_helper not in s:
        print(f"GAGAL cocok helper di: {path}"); sys.exit(1)
    s = s.replace(old_helper, new_helper, 1)
    open(full, "w").write(s)
    changed += 1
    print(f"OK: {path}")

print(f"selesai — {changed} file diubah")
