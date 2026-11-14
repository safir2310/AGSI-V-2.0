#!/usr/bin/env python3
"""
Notifikasi admin + latar belakang:
A) Android: channel keep-alive + mulai layanan di MainActivity
   + izin/layanan di manifest + strings
B) Web: tombol notifikasi di Dashboard admin (PushSettingsSheet)
   + prop user dari AppShell
Exact-match, idempoten. Jalankan dari root: python3 scripts/wire-admin-push.py
"""
import os, sys

ROOT = "/home/z/my-project"

EDITS = [
    # ===== A1. PushChannels: channel keep-alive (IMPORTANCE_MIN, senyap) =====
    ("android/app/src/main/java/com/agsi/pos/PushChannels.kt",
     '    const val ORDERS = "agsi_orders"\n',
     '    const val ORDERS = "agsi_orders"\n'
     '    const val KEEPALIVE = "agsi_keepalive"\n'),
    ("android/app/src/main/java/com/agsi/pos/PushChannels.kt",
     '        nm.createNotificationChannel(orders)\n'
     '    }\n',
     '        nm.createNotificationChannel(orders)\n'
     '\n'
     '        // Keep-alive: notifikasi tetap "app berjalan di latar belakang"\n'
     '        // IMPORTANCE_MIN = tanpa suara/vibrasi/layar — tidak mengganggu\n'
     '        val keepalive = NotificationChannel(\n'
     '            KEEPALIVE,\n'
     '            context.getString(R.string.channel_keepalive_name),\n'
     '            NotificationManager.IMPORTANCE_MIN\n'
     '        ).apply {\n'
     '            description = context.getString(R.string.channel_keepalive_desc)\n'
     '            setSound(null, null)\n'
     '            enableVibration(false)\n'
     '        }\n'
     '        nm.createNotificationChannel(keepalive)\n'
     '    }\n'),
    # ===== A2. MainActivity: mulai layanan saat app dibuka =====
    ("android/app/src/main/java/com/agsi/pos/MainActivity.kt",
     '        PushChannels.create(this)\n'
     '        requestNotificationPermissionIfNeeded()\n',
     '        PushChannels.create(this)\n'
     '        // Proses app tetap hidup walau di-swipe → FCM pesanan baru\n'
     '        // sampai seketika (tidak ditahan penghemat baterai OEM)\n'
     '        KeepAliveService.start(this)\n'
     '        requestNotificationPermissionIfNeeded()\n'),
    # ===== A3. Manifest: izin foreground service + deklarasi layanan =====
    ("android/app/src/main/AndroidManifest.xml",
     '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n',
     '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n\n'
     '    <!-- Layanan latar belakang (foreground service): proses app tetap\n'
     '         hidup agar push pesanan baru sampai seketika walau di-swipe.\n'
     '         targetSdk 35 wajib menyebut tipe: dataSync -->\n'
     '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />\n'
     '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />\n'),
    ("android/app/src/main/AndroidManifest.xml",
     '        <service\n'
     '            android:name=".PushService"\n'
     '            android:exported="false">\n'
     '            <intent-filter>\n'
     '                <action android:name="com.google.firebase.MESSAGING_SERVICE" />\n'
     '            </intent-filter>\n'
     '        </service>\n',
     '        <service\n'
     '            android:name=".PushService"\n'
     '            android:exported="false">\n'
     '            <intent-filter>\n'
     '                <action android:name="com.google.firebase.MESSAGING_SERVICE" />\n'
     '            </intent-filter>\n'
     '        </service>\n\n'
     '        <!-- Keep-alive: notifikasi tetap "AGSI aktif" — proses tidak\n'
     '             dibunuh penghemat baterai OEM, FCM pesanan sampai langsung -->\n'
     '        <service\n'
     '            android:name=".KeepAliveService"\n'
     '            android:exported="false"\n'
     '            android:foregroundServiceType="dataSync" />\n'),
    # ===== A4. strings.xml =====
    ("android/app/src/main/res/values/strings.xml",
     '    <string name="channel_orders_desc">Banner heads-up untuk pesanan baru, pembayaran QRIS, status pesanan, dan chat CS</string>\n',
     '    <string name="channel_orders_desc">Banner heads-up untuk pesanan baru, pembayaran QRIS, status pesanan, dan chat CS</string>\n'
     '    <string name="channel_keepalive_name">Latar Belakang AGSI</string>\n'
     '    <string name="channel_keepalive_desc">Menjaga aplikasi tetap berjalan di latar belakang agar pesanan baru langsung ternotifikasi</string>\n'
     '    <string name="keepalive_title">AGSI aktif di latar belakang</string>\n'
     '    <string name="keepalive_body">Siap menerima pesanan baru — notifikasi muncul seketika walau aplikasi ditutup</string>\n'),
    # ===== B1. DashboardView: import Bell & PushSettingsSheet & AppUser =====
    ("src/components/admin/DashboardView.tsx",
     'import {\n  ArrowUpRight,\n  ChefHat,\n',
     'import {\n  ArrowUpRight,\n  Bell,\n  ChefHat,\n'),
    ("src/components/admin/DashboardView.tsx",
     'import { SourceBadge, StatusBadge } from "@/components/shared/StatusBadge";\n',
     'import { SourceBadge, StatusBadge } from "@/components/shared/StatusBadge";\n'
     'import { PushSettingsSheet } from "@/components/shared/PushSettingsSheet";\n'),
    # ===== B2. DashboardView: prop user opsional =====
    ("src/components/admin/DashboardView.tsx",
     'export function DashboardView({ go }: { go: (v: AppView) => void }) {\n',
     'export function DashboardView({\n'
     '  go,\n'
     '  user,\n'
     '}: {\n'
     '  go: (v: AppView) => void;\n'
     '  user?: AppUser | null;\n'
     '}) {\n'),
    ("src/components/admin/DashboardView.tsx",
     '  const [data, setData] = useState<ReportData | null>(null);\n',
     '  const [data, setData] = useState<ReportData | null>(null);\n'
     '  const [pushOpen, setPushOpen] = useState(false);\n'),
    # ===== B3. DashboardView: tombol lonceng di header + sheet =====
    ("src/components/admin/DashboardView.tsx",
     '        <button\n'
     '          onClick={load}\n'
     '          aria-label="Muat ulang data"\n'
     '          className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-white text-orange-600 shadow-sm hover:bg-orange-50"\n'
     '        >\n'
     '          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />\n'
     '        </button>\n'
     '      </header>\n',
     '        <div className="flex shrink-0 gap-2">\n'
     '          {user && (\n'
     '            <button\n'
     '              onClick={() => setPushOpen(true)}\n'
     '              aria-label="Pengaturan notifikasi pesanan"\n'
     '              title="Pengaturan notifikasi pesanan"\n'
     '              className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-white text-orange-600 shadow-sm hover:bg-orange-50"\n'
     '            >\n'
     '              <Bell className="h-4 w-4" />\n'
     '            </button>\n'
     '          )}\n'
     '          <button\n'
     '            onClick={load}\n'
     '            aria-label="Muat ulang data"\n'
     '            className="press-effect flex h-9 w-9 items-center justify-center rounded-full border border-orange-200 bg-white text-orange-600 shadow-sm hover:bg-orange-50"\n'
     '          >\n'
     '            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />\n'
     '          </button>\n'
     '        </div>\n'
     '      </header>\n'),
    # ===== B4. DashboardView: pasang sheet (sebelum penutup div akhir) =====
    ("src/components/admin/DashboardView.tsx",
     'import { formatDateTime, formatIDR } from "@/lib/types";\n',
     'import { formatDateTime, formatIDR, type AppUser } from "@/lib/types";\n'),
    # ===== B5. AppShell: kirim user ke DashboardView =====
    ("src/components/AppShell.tsx",
     '        return <DashboardView go={go} />;',
     '        return <DashboardView go={go} user={user} />;'),
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
