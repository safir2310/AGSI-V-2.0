"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

/**
 * LiveMap — PETA HIDUP pelacakan kurir (Leaflet + tile OpenStreetMap).
 * Permintaan pemilik: kurir melihat pin pelanggan, pelanggan melihat posisi
 * kurir bergerak real-time (dipoll ±6 dtk dari /api/orders/[id]/track).
 *
 *  - customerPin : titik TUJUAN (pin GPS checkout; fallback geokode alamat).
 *  - courierPin  : posisi terakhir kurir (null = belum ada data GPS).
 *  - Garis putus-putus menghubungkan kurir → pelanggan; peta mengatur
 *    zoom otomatis agar kedua titik terlihat.
 *  - Marker diperbarui TANPA membangun ulang peta (hemat tile & mulus).
 *  - Semua kegagalan tile/jaringan tidak melempar — peta kosong tetap
 *    menampilkan pin; jika kedua pin kosong tampil pesan singkat.
 */

export type MapPoint = { lat: number; lng: number };

type LeafletModule = typeof import("leaflet");

type MarkerBundle = {
  courier: import("leaflet").Marker | null;
  customer: import("leaflet").Marker | null;
  line: import("leaflet").Polyline | null;
  fitted: boolean;
};

/** Ikon marker titik-titik (divIcon — tidak butuh gambar bawaan Leaflet). */
function pinIcon(L: LeafletModule, emoji: string, ring: string) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;font-size:19px;line-height:1;background:#fff;border:2px solid ${ring};border-radius:9999px;box-shadow:0 2px 8px rgba(0,0,0,.25)">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  });
}

export function LiveMap({
  customerPin,
  courierPin,
  className,
  heightClass = "h-56",
  ariaLabel = "Peta pelacakan kurir",
}: {
  customerPin?: MapPoint | null;
  courierPin?: MapPoint | null;
  className?: string;
  heightClass?: string;
  ariaLabel?: string;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const bundleRef = useRef<MarkerBundle>({ courier: null, customer: null, line: null, fitted: false });
  const LRef = useRef<LeafletModule | null>(null);
  const [failed, setFailed] = useState(false);

  // Init peta SEKALI
  useEffect(() => {
    let dead = false;
    let map: import("leaflet").Map | null = null;
    (async () => {
      try {
        const L = await import("leaflet");
        if (dead || !holderRef.current || mapRef.current) return;
        LRef.current = L.default ?? L;
        map = LRef.current.map(holderRef.current, {
          center: [-5.0742, 95.9166], // Sigli, Pidie — fallback awal
          zoom: 13,
          zoomControl: true,
          attributionControl: true,
        });
        LRef.current
          .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          })
          .addTo(map);
        mapRef.current = map;
        // Paksa ukuran setelah frame pertama (sheet/modal bisa belum layout)
        setTimeout(() => map?.invalidateSize(), 150);
      } catch {
        if (!dead) setFailed(true);
      }
    })();
    return () => {
      dead = true;
      try {
        mapRef.current?.remove();
      } catch {
        /* abaikan */
      }
      mapRef.current = null;
      bundleRef.current = { courier: null, customer: null, line: null, fitted: false };
    };
  }, []);

  // Sinkronkan marker setiap props berubah
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const b = bundleRef.current;

    const upsert = (
      existing: import("leaflet").Marker | null,
      p: MapPoint | null,
      icon: import("leaflet").DivIcon,
    ): import("leaflet").Marker | null => {
      if (!p) {
        existing?.remove();
        return null;
      }
      const pos: [number, number] = [p.lat, p.lng];
      if (existing) {
        existing.setLatLng(pos);
        return existing;
      }
      return L.marker(pos, { icon }).addTo(map);
    };

    b.courier = upsert(b.courier, courierPin ?? null, pinIcon(L, "🛵", "#ea580c"));
    b.customer = upsert(b.customer, customerPin ?? null, pinIcon(L, "🏠", "#16a34a"));

    // Garis kurir → pelanggan
    const pts = [b.courier?.getLatLng(), b.customer?.getLatLng()].filter(Boolean) as Array<{
      lat: number;
      lng: number;
    }>;
    if (pts.length === 2) {
      if (b.line) b.line.setLatLngs(pts);
      else b.line = L.polyline(pts, { color: "#ea580c", weight: 3, dashArray: "6 8", opacity: 0.8 }).addTo(map);
    } else if (b.line) {
      b.line.remove();
      b.line = null;
    }

    // Zoom otomatis sekali saat kedua titik ada; setelah itu ikuti kurir saja
    if (!b.fitted && pts.length === 2) {
      map.fitBounds(L.latLngBounds(pts).pad(0.35), { animate: false });
      b.fitted = true;
    } else if (b.fitted && b.courier && pts.length === 2) {
      const c = b.courier.getLatLng();
      const d = b.customer!.getLatLng();
      if (map.getBounds().contains(c) === false) map.panTo(c, { animate: true });
      void d;
    } else if (!b.fitted && pts.length === 1) {
      map.setView(pts[0], 15, { animate: false });
      b.fitted = true;
    }
  }, [customerPin, courierPin]);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-neutral-100 text-[11px] text-neutral-500 ${heightClass} ${className ?? ""}`}
      >
        Peta tidak dapat dimuat — gunakan tombol Google Maps di bawah.
      </div>
    );
  }

  return (
    <div
      ref={holderRef}
      role="img"
      aria-label={ariaLabel}
      className={`overflow-hidden rounded-xl ring-1 ring-orange-100 ${heightClass} ${className ?? ""}`}
    />
  );
}
