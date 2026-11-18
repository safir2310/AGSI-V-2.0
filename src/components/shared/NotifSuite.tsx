"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Bike, ChefHat, MessageCircle, PackageCheck, X } from "lucide-react";
import { useAppStore, useUiStore } from "@/lib/store";
import { navToSuiteUrl, useNotifSuiteStore, type SuiteItem, type SuiteKind } from "@/lib/notif-suite";
import type { AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 🔔 SUITE NOTIFIKASI IN-APP (v1.3.13) — dipasang di AppShell, SEMUA role.
 *
 * Empat gaya tampil halaman (gaya kelima = POPUP tengah tetap di
 * CenterNotice yang sudah ada):
 *
 *   1. HEADS-UP  — kartu melayang turun dari atas (z-99), auto-tutup ±6,5
 *      dtk, ketuk → buka halaman tujuan; tombol ✕ menyimpan ke toast.
 *   2. BANNER    — strip "N kabar baru" di atas (z-85), menempel sampai
 *      kabar dibuka / ditutup.
 *   3. FLOATING  — gelembung oranye melayang (z-90) bisa DISESER (drag,
 *      posisi tersimpan di localStorage) + angka kabar; ketuk → buka.
 *   5. TOAST     — pil kecil di bawah layar (z-100), auto-tutup 3,2 dtk.
 *
 * Semua mengambil data dari useNotifSuiteStore (lihat src/lib/notif-suite.ts);
 * event diisi oleh NotifWatchers (polling + tick push FCM) dan PushBridge
 * (web push browser). Banner & gelembung otomatis hilang saat pengguna
 * membuka halaman tujuan (view "orders"/"kurir" atau overlay chat terbuka).
 */

/* Ikon & warna aksen per jenis kabar */
function suiteIcon(kind: SuiteKind, cls: string) {
  switch (kind) {
    case "new_order":
      return <ChefHat className={cls} />;
    case "order_paid":
      return <PackageCheck className={cls} />;
    case "chat":
      return <MessageCircle className={cls} />;
    case "courier_task":
      return <Bike className={cls} />;
    default:
      return <Bell className={cls} />;
  }
}

function suiteAccent(kind: SuiteKind): string {
  switch (kind) {
    case "new_order":
      return "from-orange-600 to-amber-500";
    case "order_paid":
      return "from-green-600 to-emerald-500";
    case "chat":
      return "from-sky-600 to-blue-500";
    case "courier_task":
      return "from-violet-600 to-purple-500";
    default:
      return "from-neutral-700 to-neutral-500";
  }
}

/* ===== 5) TOAST — pil kecil bawah layar ===== */
function ToastPill({ toast, onDone }: { toast: SuiteItem; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <motion.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 24, opacity: 0 }}
      className="pointer-events-auto flex max-w-[92%] items-center gap-2 rounded-full bg-neutral-900/90 px-3.5 py-2 shadow-xl backdrop-blur"
    >
      {suiteIcon(toast.kind, "h-3.5 w-3.5 shrink-0 text-amber-400")}
      <p className="min-w-0 flex-1 truncate text-[11px] font-bold text-white">{toast.title}</p>
      <button onClick={onDone} aria-label="Tutup toast" className="press-effect shrink-0 p-0.5">
        <X className="h-3 w-3 text-white/60" />
      </button>
    </motion.div>
  );
}

/* ===== 3) FLOATING BUBBLE — gelembung melayang bisa diseret ===== */
const BUBBLE_SIZE = 48;

function FloatingBubble({
  count,
  url,
  onOpen,
}: {
  count: number;
  url: string;
  onOpen: (url: string) => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef({ on: false, moved: false, px: 0, py: 0, x: 0, y: 0 });

  // Posisi tersimpan (hasil seretan sebelumnya) — default: kanan, 62% tinggi
  useEffect(() => {
    try {
      const saved = localStorage.getItem("agsi-bubble-pos");
      if (saved) {
        const p = JSON.parse(saved) as { x: number; y: number };
        if (typeof p.x === "number" && typeof p.y === "number") setPos(p);
      }
    } catch {
      // localStorage tidak tersedia — pakai posisi default
    }
  }, []);

  const clamp = useCallback((x: number, y: number) => {
    const w = typeof window === "undefined" ? 360 : window.innerWidth;
    const h = typeof window === "undefined" ? 720 : window.innerHeight;
    return {
      x: Math.min(Math.max(10, x), w - BUBBLE_SIZE - 18),
      // hindari header atas & navigasi bawah
      y: Math.min(Math.max(64, y), h - BUBBLE_SIZE - 96),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pos) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // capture gagal — seretan tetap jalan tanpa capture
    }
    drag.current = { on: true, moved: false, px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.on) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) d.moved = true;
    if (d.moved) setPos(clamp(d.x + dx, d.y + dy));
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (!d.on) return;
    d.on = false;
    if (d.moved && pos) {
      // Dock ke tepi terdekat + simpan posisi
      const w = typeof window === "undefined" ? 360 : window.innerWidth;
      const docked = clamp(pos.x < w / 2 ? 10 : w - BUBBLE_SIZE - 18, pos.y);
      setPos(docked);
      try {
        localStorage.setItem("agsi-bubble-pos", JSON.stringify(docked));
      } catch {
        // abaikan
      }
    } else if (!d.moved) {
      onOpen(url); // ketukan biasa (bukan seretan) → buka halaman
    }
  };

  if (count <= 0) return null;
  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { right: 14, top: "62%" };

  return (
    <motion.div
      role="button"
      aria-label={`Floating notification: ${count} kabar baru`}
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      exit={{ scale: 0 }}
      className="fixed z-[90] flex cursor-grab touch-none select-none items-center justify-center rounded-full bg-gradient-to-br from-orange-600 to-amber-500 shadow-xl ring-2 ring-white/60 active:cursor-grabbing"
      style={{ width: BUBBLE_SIZE, height: BUBBLE_SIZE, ...style }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <Bell className="h-5 w-5 text-white" />
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white ring-2 ring-white">
        {count > 99 ? "99+" : count}
      </span>
    </motion.div>
  );
}

/* ================= KOMPONEN UTAMA ================= */

export function NotifSuite({ user }: { user?: AppUser | null }) {
  const role = user?.role;
  // v1.3.37 — halaman admin TANPA lonceng (permintaan pemilik): gelembung
  // melayang disembunyikan untuk ADMIN/OWNER; kartu heads-up, banner &
  // toast tetap jadi kabar berjalan.
  const hideBubble = role === "ADMIN" || role === "OWNER";
  const headsUp = useNotifSuiteStore((s) => s.headsUp);
  const bannerCount = useNotifSuiteStore((s) => s.bannerCount);
  const bannerLatest = useNotifSuiteStore((s) => s.bannerLatest);
  const bubbleCount = useNotifSuiteStore((s) => s.bubbleCount);
  const bubbleUrl = useNotifSuiteStore((s) => s.bubbleUrl);
  const toasts = useNotifSuiteStore((s) => s.toasts);

  /** Buka halaman tujuan + tandai semua kabar suite sudah dibuka */
  const openAndClear = useCallback(
    (url: string) => {
      navToSuiteUrl(url, role);
      const st = useNotifSuiteStore.getState();
      st.clearBubble();
      st.clearBanner();
    },
    [role]
  );

  // 1) HEADS-UP: auto-tutup kartu teratas setelah 6,5 dtk
  const topId = headsUp[0]?.id;
  useEffect(() => {
    if (topId === undefined) return;
    const t = setTimeout(() => useNotifSuiteStore.getState().dismissHeadsUp(topId), 6500);
    return () => clearTimeout(t);
  }, [topId]);

  // Kabar dianggap terbaca saat pengguna memang berada di halaman tujuan
  const view = useAppStore((s) => s.view);
  useEffect(() => {
    const st = useNotifSuiteStore.getState();
    if (view === "orders" && st.bubbleUrl.startsWith("/orders")) {
      st.clearBubble();
      st.clearBanner();
    }
    if (view === "kurir" && st.bubbleUrl.startsWith("/kurir")) {
      st.clearBubble();
      st.clearBanner();
    }
  }, [view]);

  const chatOpen = useUiStore((s) => s.chatOpen);
  useEffect(() => {
    if (!chatOpen) return;
    const st = useNotifSuiteStore.getState();
    if (st.bubbleUrl.startsWith("/chat")) {
      st.clearBubble();
      st.clearBanner();
    }
  }, [chatOpen]);

  return (
    <>
      {/* ===== 2) BANNER — strip "N kabar baru" di atas ===== */}
      <AnimatePresence>
        {bannerCount > 0 && bannerLatest && (
          <motion.div
            key="suite-banner"
            initial={{ y: -48, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -48, opacity: 0 }}
            className="fixed inset-x-3 top-2 z-[85]"
          >
            <div className="flex items-center gap-1.5 rounded-full border border-orange-200 bg-white/95 py-1.5 pl-2 pr-1.5 shadow-lg backdrop-blur">
              <button
                onClick={() => openAndClear(bannerLatest.url)}
                className="press-effect flex min-w-0 flex-1 items-center gap-2 rounded-full text-left"
                aria-label="Buka kabar baru"
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white",
                    suiteAccent(bannerLatest.kind)
                  )}
                >
                  {suiteIcon(bannerLatest.kind, "h-3.5 w-3.5")}
                </span>
                <p className="min-w-0 flex-1 truncate text-[11px] font-black text-neutral-800">
                  {bannerCount > 1 ? `${bannerCount} kabar baru menunggumu` : bannerLatest.title}
                </p>
                <span className="shrink-0 rounded-full bg-orange-600 px-1.5 py-0.5 text-[9px] font-black text-white">
                  {bannerCount > 99 ? "99+" : bannerCount}
                </span>
              </button>
              <button
                onClick={() => useNotifSuiteStore.getState().clearBanner()}
                aria-label="Tutup banner"
                className="press-effect flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== 1) HEADS-UP — kartu melayang turun dari atas ===== */}
      <div
        className="pointer-events-none fixed inset-x-3 z-[99] transition-[top] duration-300"
        style={{ top: bannerCount > 0 && bannerLatest ? 54 : 10 }}
      >
        <AnimatePresence>
          {headsUp.map((h, i) => (
            <motion.div
              key={h.id}
              initial={{ y: -90, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -90, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="pointer-events-auto"
              style={{ marginTop: i > 0 ? 8 : 0 }}
            >
              <div
                onClick={() => {
                  openAndClear(h.url);
                  useNotifSuiteStore.getState().dismissHeadsUp(h.id);
                }}
                className="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-neutral-200 bg-white/97 p-3 shadow-2xl backdrop-blur"
                role="button"
                aria-label={h.title}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white",
                    suiteAccent(h.kind)
                  )}
                >
                  {suiteIcon(h.kind, "h-4.5 w-4.5")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-black text-neutral-900">{h.title}</p>
                  <p className="line-clamp-2 text-[11px] leading-snug text-neutral-600">{h.body}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    useNotifSuiteStore.getState().dismissHeadsUp(h.id);
                    // Konfirmasi ringan: kabar tetap tersimpan di banner & gelembung
                    useNotifSuiteStore.getState().pushToast({
                      kind: h.kind,
                      title: "Kabar disimpan — cek strip atas atau ikon melayang 🔔",
                      body: "",
                      url: h.url,
                    });
                  }}
                  aria-label="Tutup heads-up"
                  className="press-effect -m-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ===== 3) FLOATING — gelembung melayang bisa diseret ===== */}
      <AnimatePresence>
        {bubbleCount > 0 && !hideBubble && (
          <FloatingBubble
            key="suite-bubble"
            count={bubbleCount}
            url={bubbleUrl}
            onOpen={openAndClear}
          />
        )}
      </AnimatePresence>

      {/* ===== 5) TOAST — pil kecil di bawah layar ===== */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[100] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <ToastPill
              key={t.id}
              toast={t}
              onDone={() => useNotifSuiteStore.getState().dismissToast(t.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
