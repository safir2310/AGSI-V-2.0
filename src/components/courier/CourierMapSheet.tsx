"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { MapPin, Navigation, Phone, X } from "lucide-react";
import { LiveMap, type MapPoint } from "@/components/shared/LiveMap";
import { apiFetch } from "@/lib/api";
import { formatIDR, type OrderData } from "@/lib/types";

/**
 * CourierMapSheet — PETA PELANGGAN utk kurir (permintaan pemilik: kurir
 * melihat lokasi pelanggan dengan TEPAT di peta, bukan cuma alamat teks).
 *
 *  - Pin pelanggan: GET /api/orders/[id]/track — utamakan pin GPS presisi
 *    dari checkout (deliveryLat/Lng); bila kosong server mengeokode alamat.
 *  - Marker kurir: posisi GPS perangkat kurir (livePos dari beranda yang
 *    dikirim ke server tiap ±8 dtk — marker bergerak mengikuti kurir).
 *  - Tombol Google Maps tetap ada (navigasi belokan) + telepon pelanggan.
 */

type TrackData = {
  customerPin: { lat: number; lng: number; source: "gps" | "geocode" | "none" } | null;
  distanceKm: number | null;
};

export function CourierMapSheet({
  order,
  livePos,
  onClose,
}: {
  order: OrderData | null;
  livePos: MapPoint | null;
  onClose: () => void;
}) {
  const open = !!order;
  const [track, setTrack] = useState<TrackData | null>(null);

  // Ambil pin pelanggan saat sheet dibuka (sekali — pin tidak berubah)
  useEffect(() => {
    if (!open || !order) return;
    let dead = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/orders/${order.id}/track`, { cache: "no-store" });
        const d = await res.json();
        if (!dead && res.ok) setTrack(d as TrackData);
      } catch {
        // gagal jaringan → pin dari OrderData tetap dipakai di bawah
      }
    })();
    return () => {
      dead = true;
      setTrack(null);
    };
  }, [open, order]);

  // Pin pelanggan: hasil /track (GPS/geokode) → fallback pin di OrderData
  const customerPin: MapPoint | null =
    track?.customerPin
      ? { lat: track.customerPin.lat, lng: track.customerPin.lng }
      : order?.deliveryLat != null && order?.deliveryLng != null
        ? { lat: order.deliveryLat, lng: order.deliveryLng }
        : null;

  if (!open || !order) return null;

  const mapsUrl = customerPin
    ? `https://www.google.com/maps/dir/?api=1&destination=${customerPin.lat},${customerPin.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        order.address || order.deliveryArea || "AGSI Pidie",
      )}`;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="courier-map-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
      >
        <motion.section
          initial={{ y: 80, opacity: 0.6 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
          aria-label={`Peta pelanggan ${order.code}`}
        >
          {/* Kepala */}
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-neutral-800">
                🛵 Arahkan ke Pelanggan
              </p>
              <p className="truncate text-[11px] text-neutral-400">
                {order.code} • {order.customerName}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Tutup peta"
              className="rounded-full bg-neutral-100 p-2 text-neutral-500 hover:bg-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* PETA hidup: pin pelanggan + posisi kurir bergerak */}
          <LiveMap
            customerPin={customerPin}
            courierPin={livePos}
            heightClass="h-64"
            ariaLabel={`Peta lokasi pelanggan untuk ${order.code}`}
          />

          {/* Status pin */}
          <p className="mt-2 text-[11px] leading-snug text-neutral-500">
            {track?.customerPin?.source === "gps" && "📍 Pin GPS presisi dari pelanggan saat checkout."}
            {track?.customerPin?.source === "geocode" && "⚠️ Pin dari geokode alamat — kurang presisi; konfirmasi bila meleset."}
            {!track?.customerPin && !customerPin && "Pin peta belum tersedia — pakai tombol Google Maps di bawah."}
            {track?.distanceKm != null && (
              <span className="font-bold text-orange-600">
                {" "}• ± {track.distanceKm.toLocaleString("id-ID", { maximumFractionDigits: 1 })} km dari kamu
              </span>
            )}
          </p>

          {/* Alamat tujuan */}
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-orange-50 px-2.5 py-2 text-[11px] leading-snug text-orange-700">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              {order.address || order.deliveryArea || "Alamat tidak tercatat"}
            </span>
          </p>
          {order.deliveryFee > 0 && (
            <p className="mt-1.5 text-[11px] font-bold text-emerald-600">
              Ongkir {formatIDR(order.deliveryFee)}
            </p>
          )}

          {/* Aksi */}
          <div className="mt-4 flex gap-2">
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2.5 text-[12px] font-black text-white transition hover:bg-orange-700"
            >
              <Navigation className="h-4 w-4" /> Navigasi Google Maps
            </a>
            {order.userPhone && (
              <a
                href={`tel:${order.userPhone}`}
                aria-label="Telepon pelanggan"
                className="flex items-center justify-center rounded-xl bg-emerald-50 px-3 py-2.5 text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
              >
                <Phone className="h-4 w-4" />
              </a>
            )}
          </div>
        </motion.section>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
