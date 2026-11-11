"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChickenBadge, ChickenLogoDefs } from "@/components/logo/ChickenLogo";
import { BottomNav } from "@/components/nav/BottomNav";
import { SplashScreen } from "@/components/shared/SplashScreen";
import { AppUpdateBanner } from "@/components/shared/AppUpdateBanner";
import { CenterNotice } from "@/components/shared/CenterNotice";
import { ConsentPopup } from "@/components/shared/ConsentPopup";
import { MemberCardSheet } from "@/components/shared/MemberCardSheet";
import { ChatSheet } from "@/components/shared/ChatSheet";
import { AdminNewOrderWatcher, ChatNotifWatcher, CustomerNotifWatcher } from "@/components/shared/NotifWatchers";
import { PushBridge } from "@/components/shared/PushBridge";
import { initAudioUnlock } from "@/lib/sound";
import { AuthView } from "@/components/auth/AuthView";
import { HomeView } from "@/components/customer/HomeView";
import { MenuView } from "@/components/customer/MenuView";
import { CartView } from "@/components/customer/CartView";
import { OrdersView } from "@/components/customer/OrdersView";
import { ProfileView } from "@/components/customer/ProfileView";
import { DashboardView } from "@/components/admin/DashboardView";
import { ProductsView } from "@/components/admin/ProductsView";
import { VouchersView } from "@/components/admin/VouchersView";
import { AdminOrdersView } from "@/components/admin/AdminOrdersView";
import { ReportsView } from "@/components/admin/ReportsView";
import { PosView } from "@/components/pos/PosView";
import { countPending, loadVouchersFor, refreshSettings, useOrdersStore, useProductsStore } from "@/lib/hooks";
import { useAppStore, useCartStore, useNoticeStore, useUiStore, type AppView } from "@/lib/store";
import { apiFetch, clearAuthToken, SESSION_EXPIRED_EVENT } from "@/lib/api";
import { hasValidConsent } from "@/lib/data-policy";
import { hasValidTerms } from "@/lib/app-terms";
import type { AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Coins } from "lucide-react";

function isAdminRole(role?: string | null) {
  return role === "ADMIN" || role === "OWNER";
}

export function AppShell() {
  const prefersReduced = useReducedMotion();
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [memberOpen, setMemberOpen] = useState(false);
  const view = useAppStore((s) => s.view);
  const go = useAppStore((s) => s.go);
  const clearCart = useCartStore((s) => s.clear);
  const loadProducts = useProductsStore((s) => s.load);
  const { orders, load: loadOrders } = useOrdersStore();
  const showNotice = useNoticeStore((s) => s.show);
  const chatOpen = useUiStore((s) => s.chatOpen);
  const chatTargetUserId = useUiStore((s) => s.chatTargetUserId);
  const closeChat = useUiStore((s) => s.closeChat);
  const splashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== Buka "kunci" audio browser pada interaksi pertama (suara notifikasi) =====
  useEffect(() => {
    initAudioUnlock();
  }, []);

  // ===== Cek sesi saat aplikasi dibuka =====
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (data.user) {
          const u = data.user as AppUser;
          setUser(u);
          go(u.role === "CASHIER" ? "pos" : isAdminRole(u.role) ? "dashboard" : "home");
          loadProducts();
          loadOrders(isAdminRole(u.role) || u.role === "CASHIER" ? "all" : "mine");
          loadVouchersFor(u);
          // Saklar layanan toko (antar & QRIS) — dipakai keranjang & POS
          void refreshSettings();
        }
      } catch {
        // offline: biarkan ke halaman auth
      } finally {
        setBooted(true);
      }
    })();
  }, [go, loadProducts, loadOrders]);

  // ===== Sesi kedaluwarsa di tengah pakai (401 dari API) → kembali ke login =====
  useEffect(() => {
    const onExpired = () => {
      clearAuthToken();
      setUser(null);
      go("auth");
      showNotice({
        type: "info",
        title: "Sesi Berakhir",
        message: "Sesi loginmu sudah tidak valid. Silakan masuk kembali ya 😊",
      });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [go, showNotice]);

  // ===== Splash pembuka (sekali per muat aplikasi) =====
  useEffect(() => {
    splashTimer.current = setTimeout(() => setShowSplash(false), 2400);
    return () => {
      if (splashTimer.current) clearTimeout(splashTimer.current);
    };
  }, []);

  const handleLoginSuccess = useCallback(
    (u: AppUser) => {
      setUser(u);
      clearCart();
      go(u.role === "CASHIER" ? "pos" : isAdminRole(u.role) ? "dashboard" : "home");
      loadProducts();
      loadOrders(isAdminRole(u.role) || u.role === "CASHIER" ? "all" : "mine", true);
      loadVouchersFor(u);
      // Saklar layanan toko (antar & QRIS) — dipakai keranjang & POS
      void refreshSettings();
    },
    [go, clearCart, loadProducts, loadOrders]
  );

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // abaikan
    }
    clearAuthToken();
    setUser(null);
    clearCart();
    go("auth");
  }, [go, clearCart]);

  /** Pengguna MENOLAK persetujuan legal di popup → keluar dari sesi dengan pesan */
  const handleConsentDeclined = useCallback(async () => {
    await handleLogout();
    showNotice({
      type: "info",
      title: "Persetujuan Diperlukan",
      message:
        "Untuk memakai aplikasi AGSI, kamu perlu menyetujui Syarat & Ketentuan serta Kebijakan Penggunaan Data. Kamu bisa masuk lagi kapan saja bila berubah pikiran ya 😊",
    });
  }, [handleLogout, showNotice]);

  /** Sinkron saldo poin di badge header tanpa me-reset kartu member */
  const handlePointsChange = useCallback((p: number) => {
    setUser((u) => (u && u.points !== p ? { ...u, points: p } : u));
  }, []);

  /** Ganti seluruh data user setelah edit profil tersimpan */
  const handleUserUpdate = useCallback((u: AppUser) => {
    setUser(u);
  }, []);

  // Peran kasir selalu di POS; role lain bisa membuka POS dari profil
  const effectiveView: AppView = !user ? "auth" : user.role === "CASHIER" ? "pos" : view;

  // Navigasi bawah hanya untuk pelanggan & admin (bukan POS, bukan halaman auth)
  const navVariant =
    !!user && booted && effectiveView !== "pos" && isAdminRole(user.role)
      ? "admin"
      : !!user && booted && effectiveView !== "pos" && user.role === "CUSTOMER"
        ? "customer"
        : null;

  const renderView = () => {
    if (!user) return <AuthView onSuccess={handleLoginSuccess} />;
    switch (effectiveView) {
      case "pos":
        return <PosView user={user} go={go} onLogout={handleLogout} />;
      // Pelanggan
      case "home":
        return <HomeView go={go} />;
      case "menu":
        return <MenuView />;
      case "cart":
        return <CartView user={user} go={go} />;
      case "orders":
        return isAdminRole(user.role) ? <AdminOrdersView /> : <OrdersView />;
      case "profile":
        return <ProfileView user={user} go={go} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />;
      // Admin
      case "dashboard":
        return <DashboardView go={go} />;
      case "products":
        return <ProductsView />;
      case "vouchers":
        return <VouchersView />;
      case "reports":
        return <ReportsView />;
      default:
        return <HomeView go={go} />;
    }
  };

  const isFullS = effectiveView === "pos" || !user;

  return (
    <div className="min-h-dvh bg-white">
      {/* ===== DEFINISI GRADIEN MASKOT (sekali, global, ID statis — aman SSR/hydration) ===== */}
      <ChickenLogoDefs />

      {/* ===== LATAR AMBIEN HANGAT (menghidupkan efek liquid glass nav & header) ===== */}
      {!isFullS && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-orange-50/80 via-white/40 to-amber-50/90" />
          <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-orange-200/35 blur-3xl" />
          <div className="absolute -right-28 top-1/2 h-80 w-80 rounded-full bg-amber-200/30 blur-3xl" />
          <div className="absolute bottom-8 left-1/4 h-64 w-64 rounded-full bg-rose-200/25 blur-3xl" />
        </div>
      )}

      {/* ===== SPLASH PEMBUKA ===== */}
      <AnimatePresence>
        {showSplash && <SplashScreen key="splash" onDone={() => setShowSplash(false)} />}
      </AnimatePresence>

      {/* ===== BANNER PEMBARUAN APLIKASI (hanya di aplikasi Android versi lama) =====
          Tombol Perbarui mengunduh /agsi-app.apk lewat DownloadManager — setelah
          selesai, ketuk notifikasinya untuk memasang (data & login tetap aman). */}
      <AppUpdateBanner />

      {!isFullS && (
        <header className="sticky top-0 z-40 border-b border-orange-100 bg-white/85 backdrop-blur-xl pt-safe">
          {/* Bar atas aplikasi dengan logo maskot ayam koki */}
          <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
            <div className="flex items-center gap-2.5">
              <ChickenBadge size={36} />
              <div className="leading-tight">
                <p className="text-sm font-black uppercase tracking-wide text-neutral-900">
                  Ayam Geprek
                </p>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-orange-600">
                  Sambal Ijo
                </p>
              </div>
            </div>
            {user &&
              (user.role === "CUSTOMER" ? (
                /* Klik teks "Member" di kanan atas → buka kartu member lengkap
                   (saldo poin sengaja TIDAK ditampilkan di header — lihat di kartu) */
                <button
                  onClick={() => setMemberOpen(true)}
                  aria-label="Buka kartu member"
                  className="press-effect flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-orange-700 ring-1 ring-orange-200 transition hover:bg-orange-100 hover:ring-orange-300"
                >
                  <Coins className="h-3 w-3" />
                  Member
                </button>
              ) : (
                <span className="rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-orange-700 ring-1 ring-orange-200">
                  {isAdminRole(user.role) ? "Admin" : "Kasir"}
                </span>
              ))}
          </div>
        </header>
      )}

      {/* ===== KONTEN DENGAN TRANSISI FADE + SLIDE ===== */}
      <main
        className={cn(
          isFullS ? "" : "relative z-10 pb-nav-offset mx-auto max-w-xl"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={effectiveView + (user ? user.id : "guest")}
            initial={prefersReduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReduced ? undefined : { opacity: 0, y: -12 }}
            transition={{ duration: 0.26, ease: "easeOut" }}
          >
            {renderView()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ===== NAVIGASI BAWAH (fixed, selalu terlihat, aman dari area sistem HP) ===== */}
      {navVariant && user && (
        <BottomNav
          variant={navVariant}
          active={effectiveView}
          onSelect={go}
          pendingCount={countPending(orders)}
        />
      )}

      {/* ===== POPUP NOTIFIKASI TENGAH LAYAR ===== */}
      <CenterNotice />

      {/* ===== WATCHER NOTIFIKASI MASUK (popup + suara khas AGSI) ===== */}
      {user && <AdminNewOrderWatcher user={user} />}
      {user && <CustomerNotifWatcher user={user} />}
      {/* Chat masuk: pelanggan (balasan CS) & admin (pesan pelanggan baru) */}
      {user && <ChatNotifWatcher user={user} />}

      {/* ===== PUSH FCM (jembatan token Android native + popup push saat app terbuka) ===== */}
      {user && <PushBridge user={user} />}

      {/* ===== CHAT CS GLOBAL (popup notifikasi / tombol 💬 kartu pesanan admin) ===== */}
      {user && (
        <ChatSheet open={chatOpen} onClose={closeChat} user={user} targetUserId={chatTargetUserId} />
      )}

      {/* ===== GATE PERSETUJUAN SYARAT & KEBIJAKAN =====
          BLOCKING untuk pengguna yang belum menyetujui SALAH SATU dokumen
          (S&K Aplikasi atau Kebijakan Data) maupun versinya sudah lama. Tidak
          bisa ditutup sebelum memilih Setuju (lanjut) atau Tolak (keluar). */}
      {user && (!hasValidConsent(user) || !hasValidTerms(user)) && (
        <ConsentPopup user={user} onAccepted={handleUserUpdate} onDeclined={handleConsentDeclined} />
      )}

      {/* ===== KARTU MEMBER LENGKAP (barcode, poin, tukar voucher) ===== */}
      <MemberCardSheet
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        onPointsChange={handlePointsChange}
      />
    </div>
  );
}
