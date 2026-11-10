"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  ClipboardList,
  Home,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Ticket,
  User,
  UtensilsCrossed,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCartStore, type AppView } from "@/lib/store";

type NavItem = {
  id: AppView;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

const CUSTOMER_ITEMS: NavItem[] = [
  { id: "home", label: "Beranda", icon: Home },
  { id: "menu", label: "Menu", icon: UtensilsCrossed },
  { id: "cart", label: "Keranjang", icon: ShoppingCart },
  { id: "orders", label: "Pesanan", icon: ClipboardList },
  { id: "profile", label: "Profil", icon: User },
];

const ADMIN_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "products", label: "Produk", icon: Package },
  { id: "vouchers", label: "Voucher", icon: Ticket },
  { id: "orders", label: "Pesanan", icon: ClipboardList },
  { id: "reports", label: "Laporan", icon: BarChart3 },
  { id: "profile", label: "Profil", icon: User },
];

type BottomNavProps = {
  variant: "customer" | "admin";
  active: AppView;
  onSelect: (view: AppView) => void;
  pendingCount?: number;
};

/**
 * Navigasi bawah LIQUID GLASS mengambang (gaya iOS 26):
 * - Melayang di atas konten (bukan bar penuh menempel dasar layar) —
 *   pill kaca dengan sudut membulat, margin dari tepi & aman dari
 *   gesture bar / tombol navigasi sistem (safe-area-inset-bottom).
 * - Efek kaca: backdrop-blur kuat + saturasi, latar semi transparan,
 *   border putih, kilau specular di tepi atas, dan bayangan berwarna.
 * - Indikator aktif "cair": blob gradasi orange yang MELELEH berpindah
 *   antar tab (layout animation spring), ikon ikut membesar.
 * - position fixed, z-index tinggi; konten utama wajib memakai kelas
 *   .pb-nav-offset agar tidak tertutup.
 */
export function BottomNav({ variant, active, onSelect, pendingCount = 0 }: BottomNavProps) {
  const items = variant === "customer" ? CUSTOMER_ITEMS : ADMIN_ITEMS;
  const prefersReduced = useReducedMotion();
  const cartCount = useCartStore((s) => s.items.reduce((sum, i) => sum + i.qty, 0));

  // ===== SEMBUNYI-MUNCUL OTOMATIS MENGIKUTI ARAH SCROLL =====
  // Scroll ke bawah → pill meluncur turun (menutupi ke balik Navigation Bar
  // sistem di aplikasi, keluar layar di browser). Scroll ke atas → muncul
  // lagi. Spring + opacity supaya geraknya terasa LANCAR & hidup.
  const [hidden, setHidden] = useState(false);
  const lastY = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReduced) return;
    const onScroll = () => {
      const y = window.scrollY;
      // Acuan awal: event pertama hanya mencatat posisi (dy = 0)
      const prev = lastY.current ?? y;
      const dy = y - prev;
      lastY.current = y;
      if (dy > 5 && y > 90) setHidden(true);
      else if (dy < -5) setHidden(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [prefersReduced]);

  return (
    <nav
      aria-label={variant === "customer" ? "Navigasi utama pelanggan" : "Navigasi utama admin"}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50"
      data-app-nav=""
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <motion.div
        initial={false}
        animate={
          prefersReduced
            ? { y: 0, opacity: 1 }
            : hidden
              ? { y: 116, opacity: 0, scale: 0.96 }
              : { y: 0, opacity: 1, scale: 1 }
        }
        transition={{ type: "spring", stiffness: 340, damping: 32 }}
        className={cn(
          "mx-auto max-w-xl px-4 pb-3",
          hidden ? "pointer-events-none" : "pointer-events-auto"
        )
        }
      >
        {/* ===== PILL KACA MENGAMBANG ===== */}
        <div
          className={cn(
            "relative rounded-[1.9rem] border border-white/60 bg-white/50 backdrop-blur-2xl backdrop-saturate-150",
            "shadow-[0_16px_44px_-10px_rgba(234,88,12,0.38),0_4px_14px_-4px_rgba(0,0,0,0.10)]"
          )}
        >
          {/* Kilau specular di tepi atas — ciri khas liquid glass */}
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/95 to-transparent" />
          {/* Lapisan sheen lembut di paruh atas pill */}
          <div className="pointer-events-none absolute inset-0 rounded-[1.9rem] bg-gradient-to-b from-white/70 via-white/5 to-transparent" />

          <div
            className={cn(
              "relative grid h-[4.35rem] items-stretch px-1.5",
              variant === "customer" ? "grid-cols-5" : "grid-cols-6"
            )}
          >
            {items.map((item) => {
              const isActive = active === item.id;
              const Icon = item.icon;
              const badge =
                item.id === "cart" ? cartCount : item.id === "orders" ? pendingCount : 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    // Ganti tab → nav selalu muncul lagi & acuan scroll segar
                    lastY.current = null;
                    setHidden(false);
                    onSelect(item.id);
                  }}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={item.label}
                  className="group relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-[1.6rem] px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                >
                  {/* Blob aktif "cair" yang meleleh berpindah antar tab */}
                  {isActive && (
                    <motion.span
                      layoutId={prefersReduced ? undefined : "bottomnav-liquid-blob"}
                      transition={
                        prefersReduced
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 380, damping: 30 }
                      }
                      className={cn(
                        "absolute inset-x-1 inset-y-1.5 rounded-[1.5rem]",
                        "bg-gradient-to-b from-orange-100/95 via-orange-50/90 to-amber-50/80",
                        "ring-1 ring-orange-200/80",
                        "shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_16px_-6px_rgba(234,88,12,0.45)]"
                      )}
                    />
                  )}

                  <span className="relative z-10 flex max-w-full flex-col items-center">
                    <motion.span
                      animate={
                        prefersReduced
                          ? {}
                          : isActive
                            ? { scale: 1.14, y: -2 }
                            : { scale: 1, y: 0 }
                      }
                      whileTap={prefersReduced ? undefined : { scale: 0.8 }}
                      transition={{ type: "spring", stiffness: 500, damping: 20 }}
                      className="relative"
                    >
                      <Icon
                        className={cn(
                          "h-[22px] w-[22px] transition-colors",
                          isActive
                            ? "text-orange-600 drop-shadow-[0_2px_6px_rgba(234,88,12,0.35)]"
                            : "text-neutral-400 group-hover:text-orange-500"
                        )}
                        strokeWidth={isActive ? 2.4 : 2}
                      />
                      {badge > 0 && (
                        <span className="absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold leading-none text-white shadow-md ring-2 ring-white/70">
                          {badge > 99 ? "99+" : badge}
                        </span>
                      )}
                    </motion.span>
                    <span
                      className={cn(
                        "max-w-full truncate font-semibold leading-tight transition-colors",
                        variant === "customer" ? "text-[10px]" : "text-[9px]",
                        isActive ? "text-orange-700" : "text-neutral-400"
                      )}
                    >
                      {item.label}
                    </span>
                    {/* titik cair kecil di bawah label aktif */}
                    <span
                      className={cn(
                        "rounded-full transition-all duration-300",
                        isActive
                          ? "h-1 w-1.5 bg-gradient-to-r from-orange-500 to-amber-400 shadow-[0_0_8px_rgba(249,115,22,0.7)]"
                          : "h-0 w-0 bg-transparent"
                      )}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </motion.div>
    </nav>
  );
}
