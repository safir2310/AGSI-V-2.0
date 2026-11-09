"use client";

import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, { label: string; className: string; dot: string }> = {
  PENDING: {
    label: "Menunggu",
    className: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  PREPARING: {
    label: "Dimasak",
    className: "bg-orange-50 text-orange-700 ring-orange-200",
    dot: "bg-orange-500 animate-pulse",
  },
  READY: {
    label: "Siap Diambil",
    className: "bg-green-50 text-green-700 ring-green-200",
    dot: "bg-green-500",
  },
  COMPLETED: {
    label: "Selesai",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  CANCELLED: {
    label: "Dibatalkan",
    className: "bg-neutral-100 text-neutral-500 ring-neutral-200",
    dot: "bg-neutral-400",
  },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS_STYLE[status] ?? {
    label: status,
    className: "bg-neutral-100 text-neutral-600 ring-neutral-200",
    dot: "bg-neutral-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1",
        s.className,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1",
        source === "POS"
          ? "bg-orange-100 text-orange-700 ring-orange-200"
          : "bg-white text-green-700 ring-green-200"
      )}
    >
      {source === "POS" ? "Kasir" : "Aplikasi"}
    </span>
  );
}

/**
 * Badge status pembayaran.
 * Tunai yang belum dibayar diberi label netral "Bayar di Kasir" (memang dibayar
 * saat ambil pesanan), sedangkan QRIS yang belum dibayar ditonjolkan merah —
 * dan hanya bisa lunas lewat verifikasi otomatis sistem.
 */
export function PaymentBadge({
  paymentMethod,
  paymentStatus,
  className,
}: {
  paymentMethod: string;
  paymentStatus: string;
  className?: string;
}) {
  if (paymentStatus === "PAID") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200",
          className
        )}
      >
        ✓ Lunas
      </span>
    );
  }
  // UNPAID
  if (paymentMethod !== "QRIS" && paymentMethod !== "EWALLET") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-500 ring-1 ring-neutral-200",
          className
        )}
      >
        Bayar di Kasir
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 ring-1 ring-red-200",
        className
      )}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
      Belum Bayar
    </span>
  );
}

export function SpicyDots({ level }: { level: number }) {
  if (level <= 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5" title={`Level pedas ${level}/5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "text-[9px] leading-none",
            i < level ? "opacity-100" : "opacity-25 grayscale"
          )}
        >
          🌶️
        </span>
      ))}
    </span>
  );
}
