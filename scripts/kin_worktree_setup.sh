#!/usr/bin/env bash
# Siapkan worktree verifikasi sekali-pakai scripts/tmp/wt-kin dari origin/main:
# stub leaflet (tidak terpasang di lingkungan lokal), rute verifikasi temporer
# (/kin-test default, /kin-test2 konfigurasi kustom, /kin-admin sheet admin),
# dan salin semua file sumber yang sedang diubah. DIJALANKAN ULANG SETIAP KALI
# SEBELUM VERIFIKASI — selalu mulai dari origin/main segar.
set -eu
ROOT=/home/z/my-project
WT="$ROOT/scripts/tmp/wt-kin"

git -C "$ROOT" fetch origin 2>&1 | tail -1
echo "origin/main: $(git -C "$ROOT" log -1 --format='%h' origin/main)"
git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
rm -rf "$WT" 2>/dev/null || true
git -C "$ROOT" worktree prune >/dev/null 2>&1 || true
git -C "$ROOT" worktree add --detach "$WT" origin/main >/dev/null 2>&1
ln -sfn "$ROOT/node_modules" "$WT/node_modules"

# Folder komponen baru (worktree dari origin/main belum memilikinya)
mkdir -p "$WT/src/components/motion"

# Salin file sumber yang berubah (sebelum verifikasi, agar dev server memakai versi baru)
for f in \
  src/components/customer/HomeView.tsx \
  src/components/customer/CourierScene.tsx \
  src/components/customer/BannerPopup.tsx \
  src/components/customer/ProfileView.tsx \
  src/components/admin/CourierAnimSheet.tsx \
  src/components/admin/MotionStudioSheet.tsx \
  src/components/motion/MotionRuntime.tsx \
  src/components/nav/BottomNav.tsx \
  src/components/shared/SplashScreen.tsx \
  src/components/shared/SyncBridge.tsx \
  src/components/AppShell.tsx \
  src/lib/hooks.ts \
  src/lib/motion-config.ts \
  src/lib/store-settings.ts \
  src/lib/realtime.ts \
  src/app/api/settings/route.ts \
  src/app/api/realtime/route.ts \
  prisma/schema.prisma; do
  cp "$ROOT/$f" "$WT/$f"
done
# Prisma client dgn kolom motion (schema disalin di atas)
npx prisma generate --schema "$WT/prisma/schema.prisma" 2>&1 | grep -E "Generated|Error" | head -1

# Stub leaflet + alias webpack (LiveMap hanya dipakai di rute lain)
mkdir -p "$WT/stubs"
printf '// Stub verifikasi lokal — LiveMap tidak dirender di rute verifikasi.\nmodule.exports = {};\n' > "$WT/stubs/leaflet.js"
printf '/* stub css leaflet */\n' > "$WT/stubs/leaflet.css"
python3 - "$WT/next.config.ts" <<'PYEOF'
import sys
from pathlib import Path

p = Path(sys.argv[1])
src = p.read_text()
marker = "export default nextConfig;"
if "stubs" in src:
    sys.exit("next.config.ts sudah berisi stub")
patch = '''const path = require("node:path");

const nextConfig: NextConfig = {'''
assert marker in src and "const nextConfig: NextConfig = {" in src
# impor `path` untuk alias webpack — file TS: pakai import ESM standar
if "node:path" not in src:
    src = src.replace(
        'import type { NextConfig } from "next";',
        'import type { NextConfig } from "next";\nimport path from "node:path";',
    )
src = src.replace(
    "const nextConfig: NextConfig = {",
    '''const nextConfig: NextConfig = {
  // [LOKAL SAJA] Stub leaflet: paket tak terpasang di lingkungan verifikasi;
  // komponen LiveMap tidak pernah dirender pada rute verifikasi.
  webpack: (config) => {
    config.resolve.alias["leaflet$"] = path.join(process.cwd(), "stubs", "leaflet.js");
    config.resolve.alias["leaflet/dist/leaflet.css$"] = path.join(process.cwd(), "stubs", "leaflet.css");
    return config;
  },''',
)
p.write_text(src)
print("next.config.ts dipatch (stub leaflet)")
PYEOF

# Rute verifikasi temporer (TIDAK IKUT di-commit — hanya di worktree ini)
mkdir -p "$WT/src/app/kin-test" "$WT/src/app/kin-test2" "$WT/src/app/kin-admin" "$WT/src/app/kin-popup" "$WT/src/app/kin-motion"
cat > "$WT/src/app/kin-test/page.tsx" <<'EOF'
"use client";
import { useEffect, useState } from "react";
import { HomeView } from "@/components/customer/HomeView";
export default function KinTestPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <main className="min-h-screen bg-neutral-50 pb-10">{mounted && <HomeView go={() => {}} />}</main>;
}
EOF
cat > "$WT/src/app/kin-test2/page.tsx" <<'EOF'
"use client";
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/hooks";
import { HomeView } from "@/components/customer/HomeView";
export default function KinTest2Page() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    useSettingsStore.setState({
      loaded: true,
      courierAnim: {
        enabled: true,
        text: "Promo Spesial Hari Ini",
        font: "mono",
        weight: "bold",
        caps: false,
        italic: true,
        fontSize: 12,
        textColor: "violet",
        accentColor: "red",
        animStyle: "flip3d",
        cycleSec: 6,
        boom: false,
      },
    });
    setMounted(true);
  }, []);
  return <main className="min-h-screen bg-neutral-50 pb-10">{mounted && <HomeView go={() => {}} />}</main>;
}
EOF
cat > "$WT/src/app/kin-admin/page.tsx" <<'EOF'
"use client";
import { useEffect, useState } from "react";
import { ProfileView } from "@/components/customer/ProfileView";
export default function KinAdminPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <main className="min-h-screen bg-neutral-50 pb-10">
      {mounted && (
        <ProfileView
          user={{
            id: "demo",
            email: "owner@agsi.id",
            name: "Owner Demo",
            phone: null,
            role: "ADMIN",
            points: 0,
          }}
          go={() => {}}
          onLogout={() => {}}
          onUserUpdate={() => {}}
        />
      )}
    </main>
  );
}
EOF
cat > "$WT/src/app/kin-popup/page.tsx" <<'EOF'
"use client";
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/hooks";
import { BannerPopup } from "@/components/customer/BannerPopup";
const DEMO_BANNER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="100"><rect width="80" height="100" fill="#f97316"/><rect x="6" y="6" width="68" height="88" fill="none" stroke="#fff" stroke-width="2"/><circle cx="40" cy="50" r="18" fill="#84cc16"/></svg>'
  );
export default function KinPopupPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    useSettingsStore.setState({
      loaded: true,
      banner: {
        bannerEnabled: true,
        bannerTitle: null,
        bannerText: null,
        bannerHasImage: true,
        bannerVersion: "kin-test",
        bannerImageUrl: DEMO_BANNER,
      },
    });
    setMounted(true);
  }, []);
  return (
    <main className="min-h-screen bg-neutral-50">
      {mounted && (
        <>
          <h1 className="p-4 text-lg font-black">Halaman uji popup</h1>
          <BannerPopup go={() => {}} />
        </>
      )}
    </main>
  );
}
EOF
cat > "$WT/src/app/kin-motion/page.tsx" <<'EOF'
"use client";
import { useEffect, useState } from "react";
import { useSettingsStore } from "@/lib/hooks";
import { useProductsStore } from "@/lib/hooks";
import { HomeView } from "@/components/customer/HomeView";
import type { Product } from "@/lib/types";

const DEMO_PRODUCTS: Product[] = ["Geprek Original", "Sambal Ijo", "Teh Jumbo", "Geprek Sambal Bawang", "Nasi Uduk", "Es Jeruk"].map(
  (name, i) => ({
    id: `demo-${i}`,
    name,
    description: "menu demo verifikasi",
    price: 15000 + i * 1000,
    category: "demo",
    emoji: ["🍗", "🌶️", "🥤", "🍗", "🍚", "🍊"][i],
    imageColor: "#f97316",
    hasImage: false,
    spicy: (i % 5) as 0 | 1 | 2 | 3 | 4,
    available: true,
    popular: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  })
);

const MOTION_DEMO = {
  version: 3,
  updatedAt: "2026-01-01T00:00:00.000Z",
  scheduled: false,
  global: { master: true, mobile: true, tablet: true, desktop: true, speedPreset: "normal", speedScale: 1, perfMode: false },
  targets: {
    heroTitle: { enabled: true, effect: "pop", duration: 2, delay: 0.5, easing: "easeOut", intensity: 100, stagger: 80, loop: false },
    sectionTitles: { enabled: true, effect: "kinetic", duration: 0.6, delay: 0, easing: "easeOut", intensity: 100, stagger: 80, loop: false },
    productCards: { enabled: true, effect: "flip3d", duration: 0.6, delay: 0, easing: "easeOut", intensity: 100, stagger: 60, loop: false },
    promoStrip: { enabled: true, effect: "kenBurns", duration: 0.6, delay: 0, easing: "linear", intensity: 100, stagger: 0, loop: true },
    bannerPopup: { enabled: false, effect: "zoomIn", duration: 0.55, delay: 0, easing: "easeOut", intensity: 100, stagger: 0, loop: false },
    headerLogo: { enabled: true, effect: "float", duration: 3, delay: 0, easing: "easeInOut", intensity: 100, stagger: 0, loop: true },
    splash: { enabled: true, effect: "loader", duration: 0.6, delay: 0, easing: "easeOut", intensity: 100, stagger: 0, loop: false },
    pageTransition: { enabled: true, effect: "slideUp", duration: 0.3, delay: 0, easing: "easeOut", intensity: 100, stagger: 0, loop: false },
    cartBadge: { enabled: true, effect: "pulse", duration: 1.6, delay: 0, easing: "easeInOut", intensity: 100, stagger: 0, loop: false },
  },
};

export default function KinMotionPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    useSettingsStore.setState({ loaded: true, courierAnim: { enabled: false, text: "", font: "default", weight: "black", caps: true, italic: false, fontSize: 10, textColor: "orange", accentColor: "green", animStyle: "klasik", cycleSec: 8, boom: false }, motion: MOTION_DEMO as never });
    useProductsStore.setState({ products: DEMO_PRODUCTS, loaded: true, loading: false });
    setMounted(true);
  }, []);
  return <main className="min-h-screen bg-neutral-50 pb-10">{mounted && <HomeView go={() => {}} />}</main>;
}
EOF
echo "worktree verifikasi siap: $WT"
