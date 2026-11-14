#!/usr/bin/env python3
"""
Validasi cepat artefak Android notifikasi-saat-ditutup:
1. XML manifest & strings ter-well-formed (xml.dom.minidom)
2. Semua string R.string.* yang dirujuk Kotlin benar-benar ada
3. Kelas/service/receiver di manifest ada filenya
Jalankan dari root: python3 scripts/check-android-notif.py
"""
import re
import sys
import glob
import os
from xml.dom import minidom

ROOT = "/home/z/my-project/android/app/src/main"
errors = []

# 1. XML well-formed
for xml in ["AndroidManifest.xml", "res/values/strings.xml"]:
    p = os.path.join(ROOT, xml)
    try:
        minidom.parse(p)
        print(f"OK XML valid: {xml}")
    except Exception as e:
        errors.append(f"XML rusak {xml}: {e}")

# 2. String yang dirujuk Kotlin ada di strings.xml
strings_xml = open(os.path.join(ROOT, "res/values/strings.xml")).read()
defined = set(re.findall(r'<string name="([^"]+)"', strings_xml))
used = set()
for kt in glob.glob(os.path.join(ROOT, "java/com/agsi/pos/*.kt")):
    used |= set(re.findall(r'R\.string\.(\w+)', open(kt).read()))
missing = used - defined
if missing:
    errors.append(f"String kurang di strings.xml: {sorted(missing)}")
else:
    print(f"OK semua {len(used)} rujukan R.string ada ({sorted(used)})")

# 3. Kelas di manifest punya file
manifest = open(os.path.join(ROOT, "AndroidManifest.xml")).read()
for cls in re.findall(r'android:name="\.(\w+)"', manifest):
    f = os.path.join(ROOT, f"java/com/agsi/pos/{cls}.kt")
    if os.path.exists(f):
        print(f"OK kelas manifest ada: {cls}.kt")
    else:
        errors.append(f"Kelas manifest hilang: {cls}.kt")

# 4. Cek fungsi kunci ada
ka = open(os.path.join(ROOT, "java/com/agsi/pos/KeepAliveService.kt")).read()
for needle, desc in [
    ("onTaskRemoved", "restart saat di-swipe"),
    ("AlarmManager", "penjadwal restart"),
    ("START_STICKY", "sticky restart sistem"),
]:
    if needle not in ka:
        errors.append(f"KeepAliveService kurang {needle} ({desc})")
    else:
        print(f"OK KeepAliveService: {needle} ({desc})")

br = open(os.path.join(ROOT, "java/com/agsi/pos/BootReceiver.kt")).read()
for action in ["BOOT_COMPLETED", "MY_PACKAGE_REPLACED"]:
    if action not in br:
        errors.append(f"BootReceiver kurang {action}")
    else:
        print(f"OK BootReceiver: {action}")

ma = open(os.path.join(ROOT, "java/com/agsi/pos/MainActivity.kt")).read()
for needle in ["maybeAskUnrestrictedBattery", "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", "isIgnoringBatteryOptimizations"]:
    if needle not in ma:
        errors.append(f"MainActivity kurang {needle}")
    else:
        print(f"OK MainActivity: {needle}")

if errors:
    print("\nGAGAL:")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("\nSemua pemeriksaan lulus ✓")
