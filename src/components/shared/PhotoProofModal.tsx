"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/types";

/**
 * PhotoProofModal — BUKTI FOTO PENGIRIMAN (permintaan pemilik): foto yang
 * diunggah kurir dapat dilihat admin & pelanggan. Klik tombol buka → foto
 * diambil on-demand (GET /api/orders/[id]/delivery-photo, auth via cookie/
 * token apiFetch → blob → objectURL; kolom Order.deliveryPhotoAt = penanda
 * ringan "sudah ada" tanpa memuat bytes di daftar pesanan).
 */

export function PhotoProofModal({
  order,
  onClose,
}: {
  order: { id: string; code: string; deliveryPhotoAt?: string | null; courierName?: string | null } | null;
  onClose: () => void;
}) {
  const open = !!order;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !order) return;
    let dead = false;
    let objUrl: string | null = null;
    setUrl(null);
    setError(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/orders/${order.id}/delivery-photo`, { cache: "no-store" });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? "Gagal memuat foto.");
        }
        const blob = await res.blob();
        objUrl = URL.createObjectURL(blob);
        if (!dead) setUrl(objUrl);
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : "Gagal memuat foto.");
      }
    })();
    return () => {
      dead = true;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [open, order]);

  if (!open || !order) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="proof-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[97] flex items-center justify-center bg-neutral-900/85 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={`Bukti foto pengiriman ${order.code}`}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-3xl bg-white p-4 shadow-2xl"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-black text-neutral-800">📷 Bukti Pengiriman</p>
              <p className="truncate text-[11px] text-neutral-400">
                {order.code}
                {order.courierName ? ` • diantar ${order.courierName}` : ""}
                {order.deliveryPhotoAt ? ` • ${formatDateTime(order.deliveryPhotoAt)}` : ""}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Tutup bukti foto"
              className="rounded-full bg-neutral-100 p-2 text-neutral-500 hover:bg-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-4 text-center text-[12px] font-bold text-red-600">
              {error}
            </p>
          )}
          {!error && !url && (
            <div className="flex h-64 items-center justify-center rounded-xl bg-neutral-100">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            </div>
          )}
          {!error && url && (
            <img
              src={url}
              alt={`Bukti foto pengiriman ${order.code}`}
              className="max-h-[70vh] w-full rounded-xl object-contain ring-1 ring-neutral-200"
            />
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
