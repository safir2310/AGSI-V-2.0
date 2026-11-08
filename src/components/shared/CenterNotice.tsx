"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNoticeStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const ICONS = {
  success: { Icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50", ring: "ring-green-200" },
  error: { Icon: XCircle, color: "text-orange-700", bg: "bg-orange-50", ring: "ring-orange-200" },
  info: { Icon: Info, color: "text-orange-600", bg: "bg-orange-50", ring: "ring-orange-200" },
  confirm: { Icon: TriangleAlert, color: "text-amber-600", bg: "bg-amber-50", ring: "ring-amber-200" },
};

/**
 * Popup notifikasi di TENGAH layar dengan overlay transparan,
 * sesuai revisi desain. Mendukung aksi kustom (mis. konfirmasi).
 */
export function CenterNotice() {
  const { open, type, title, message, mascot, actions, autoCloseMs, close } = useNoticeStore();
  const prefersReduced = useReducedMotion();
  const { Icon, color, bg, ring } = ICONS[type] ?? ICONS.info;

  const handleAction = (action: (typeof actions)[number]) => {
    action.onClick?.();
    close();
  };

  // Notifikasi masuk (pesanan baru / update status / chat) menutup sendiri
  // supaya tidak menghalangi terus-menerus. Popup konfirmasi tanpa autoClose.
  useEffect(() => {
    if (!open || !autoCloseMs) return;
    const t = setTimeout(close, autoCloseMs);
    return () => clearTimeout(t);
  }, [open, autoCloseMs, close]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center p-5"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="alertdialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* overlay transparan */}
          <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" onClick={close} />

          <motion.div
            className="relative z-10 w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-orange-100"
            initial={
              prefersReduced
                ? false
                : { scale: 0.86, y: 26, opacity: 0 }
            }
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={prefersReduced ? undefined : { scale: 0.92, y: 12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-orange-600 via-orange-400 to-orange-300" />
            <div className="flex flex-col items-center gap-3 px-6 pb-6 pt-7 text-center">
              {mascot ? (
                <div className="h-24 scale-110">
                  {/* Maskot versi statis ringan untuk popup */}
                  <StaticChick />
                </div>
              ) : (
                <span className={cn("flex h-14 w-14 items-center justify-center rounded-full ring-4", bg, ring)}>
                  <Icon className={cn("h-7 w-7", color)} strokeWidth={2.2} />
                </span>
              )}
              <h3 className="text-lg font-bold text-neutral-900">{title}</h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-600">{message}</p>
              <div className="mt-1 flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-center">
                {actions.map((action, i) => (
                  <Button
                    key={i}
                    variant={action.variant === "destructive" ? "destructive" : i === 0 ? "default" : "outline"}
                    className={cn(
                      "press-effect w-full sm:w-auto",
                      action.variant !== "destructive" && i === 0 && "bg-orange-600 hover:bg-orange-700"
                    )}
                    onClick={() => handleAction(action)}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Maskot kecil statis (tanpa animasi) untuk popup — tetap khas 3D */
function StaticChick() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-auto drop-shadow-[0_10px_16px_rgba(154,52,18,0.35)]" role="img" aria-label="Maskot ayam koki">
      <defs>
        <radialGradient id="nb-head" cx="36%" cy="26%" r="92%">
          <stop offset="0%" stopColor="#FFE6BD" />
          <stop offset="30%" stopColor="#FDBA74" />
          <stop offset="68%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#EA580C" />
        </radialGradient>
        <linearGradient id="nb-hat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E7EDF3" />
        </linearGradient>
        <linearGradient id="nb-beak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FCD34D" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
        <linearGradient id="nb-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ADE80" />
          <stop offset="100%" stopColor="#16A34A" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="88" r="52" fill="url(#nb-head)" />
      <ellipse cx="78" cy="62" rx="15" ry="9" fill="#FFFFFF" opacity="0.4" transform="rotate(-24 78 62)" />
      <g fill="url(#nb-hat)" transform="rotate(-7 100 44)">
        <circle cx="80" cy="34" r="13" />
        <circle cx="101" cy="26" r="16" />
        <circle cx="121" cy="35" r="12" />
        <path d="M72 40 q30 -22 58 0 l0 12 q-29 -12 -58 0 z" />
        <rect x="76" y="44" width="49" height="12" rx="6" />
      </g>
      <ellipse cx="86" cy="86" rx="7" ry="7.5" fill="#451A03" />
      <ellipse cx="114" cy="86" rx="7" ry="7.5" fill="#451A03" />
      <circle cx="83.7" cy="83.5" r="2.4" fill="#FFFFFF" />
      <circle cx="111.7" cy="83.5" r="2.4" fill="#FFFFFF" />
      <ellipse cx="76" cy="98" rx="6.5" ry="4.5" fill="#F43F5E" opacity="0.3" />
      <ellipse cx="124" cy="98" rx="6.5" ry="4.5" fill="#F43F5E" opacity="0.3" />
      <path d="M91 94 L109 94 L100 103 Z" fill="url(#nb-beak)" />
      <path d="M95 102 L105 102 L100 108 Z" fill="#D97706" />
      <path d="M66 124 Q100 144 134 124 L134 134 Q100 156 66 134 Z" fill="url(#nb-green)" />
    </svg>
  );
}
