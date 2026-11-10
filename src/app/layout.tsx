import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ayam Geprek Sambal Ijo — Geprek Mantap, Sambal Nendang!",
  description:
    "Pesan ayam geprek sambal ijo favoritmu: menu, keranjang, pesanan, dan profil dalam satu aplikasi. Ada mode Admin & POS Kasir untuk kelola bisnis.",
  keywords: [
    "ayam geprek",
    "sambal ijo",
    "pesan makanan",
    "POS kasir",
    "restoran",
  ],
  authors: [{ name: "Ayam Geprek Sambal Ijo" }],
  // ===== iPhone / iPad: tampil seperti aplikasi saat "Add to Home Screen" =====
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AGSI",
  },
  icons: {
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // viewport-fit=cover WAJIB agar env(safe-area-inset-bottom) bernilai di HP
  viewportFit: "cover",
  themeColor: "#F97316",
  // Keyboard Android mengecilkan viewport (bukan menutupi) -> input chat/composer
  // selalu terlihat, bottom nav ikut naik alih-alih tertimpa keyboard
  interactiveWidget: "resizes-content",
};

/** Tameng error lingkungan preview: aplikasi sah dijalankan di dalam frame
 *  lintas-origin (panel preview). SecurityError "Blocked a frame with origin"
 *  bukan bug aplikasi (kode kita tidak pernah menyentuh frame lain) melainkan
 *  noise alat/pembungkus di sekitar aplikasi — jangan biarkan ia memunculkan
 *  overlay layar penuh Next.js. Script inline di <head> agar terdaftar SEBELUM
 *  listener overlay Next.js (error event menarget window: urutan registrasi
 *  menentukan). Error tetap tercatat di console, hanya overlaynya yang redam. */
const ENV_GUARD_SCRIPT = `(function(){
  try {
    var isCrossOriginFrameSecErr = function (msg) {
      return typeof msg === "string" &&
        msg.indexOf("Blocked a frame with origin") !== -1 &&
        msg.indexOf("cross-origin frame") !== -1;
    };
    window.addEventListener("error", function (e) {
      try {
        var msg = e && e.message ? e.message : (e && e.error && e.error.message) || "";
        if (isCrossOriginFrameSecErr(msg)) {
          e.stopImmediatePropagation();
          if (e.preventDefault) e.preventDefault();
        }
      } catch (_) {}
    });
    window.addEventListener("unhandledrejection", function (e) {
      try {
        var r = e && e.reason;
        var msg = r && r.message ? r.message : String(r || "");
        if (isCrossOriginFrameSecErr(msg)) {
          e.stopImmediatePropagation();
          if (e.preventDefault) e.preventDefault();
        }
      } catch (_) {}
    });
  } catch (_) {}
})();`;

/** Penanda mode aplikasi Android AGSI: UA mengandung "AGSIAndroidApp" (dari
 *  app/src/main/java/com/agsi/app/MainActivity.kt). Kelas dipasang SEBELUM
 *  render supaya CSS mode aplikasi (.agsi-app di globals.css — antara lain
 *  menurunkan tab navigasi bawah) tidak berkedip saat halaman dimuat. */
const APP_MODE_SCRIPT = `(function(){
  try {
    if (/AGSIAndroidApp/i.test(navigator.userAgent)) {
      document.documentElement.classList.add("agsi-app");
    }
  } catch (_) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ENV_GUARD_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: APP_MODE_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
