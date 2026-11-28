"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bike,
  ChevronDown,
  Clock,
  Loader2,
  MapPin,
  Minus,
  Plus,
  ShoppingBag,
  Ticket,
  Trash2,
  TriangleAlert,
  UserRound,
  Utensils,
  X,
} from "lucide-react";
// Pin GPS rumah — pakai ikon Locate inline SVG? Tidak: lucide punya Crosshair.
import { Crosshair } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProductThumb } from "@/components/shared/ProductThumb";
import { QrisPaySheet, type QrisPayOrder } from "@/components/shared/QrisPaySheet";
import { DeliveryAddressSheet } from "@/components/customer/DeliveryAddressSheet";
import { useCartStore, useNoticeStore, type AppView } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { refreshOrders, refreshVouchers, useProductsStore, useSettingsStore, useVouchersStore } from "@/lib/hooks";
import {
  computeVoucherDiscount,
  formatIDR,
  formatVoucherValue,
  type AppUser,
  type VoucherInfo,
} from "@/lib/types";
import {
  earnPointsForTotal,
  POINTS_EARN_PER_STEP,
  POINTS_EARN_STEP,
  voucherValueForPoints,
} from "@/lib/points-rules";
import { cn } from "@/lib/utils";
import {
  DELIVERY_AREA_LABEL,
  DELIVERY_FEE_PER_KM,
  billedKm,
  feeForArea,
  findDeliveryArea,
  formatDistance,
} from "@/lib/delivery";

const ORDER_TYPES = [
  { id: "DINE_IN", label: "Makan di Tempat", icon: Utensils, placeholderTable: true },
  { id: "TAKEAWAY", label: "Bungkus / Ambil", icon: ShoppingBag, placeholderTable: false },
  { id: "DELIVERY", label: "Antar ke Alamat", icon: Bike, placeholderTable: false },
] as const;

const PAYMENTS = [
  { id: "CASH", label: "Tunai", emoji: "💵" },
  // UPDATE (2026-11-26): QRIS & E-Wallet digabung SATU opsi — halaman bayar
  // DOKU menampilkan SEMUA metode aktif (QRIS, DOKU Wallet, DANA, OVO,
  // ShopeePay, LinkAja, Virtual Account, dll), pelanggan pilih sendiri.
  { id: "QRIS", label: "Online (DOKU)", emoji: "📱" },
] as const;

export function CartView({ user, go }: { user: AppUser; go: (v: AppView) => void }) {
  const cart = useCartStore();
  const showNotice = useNoticeStore((s) => s.show);
  const prefersReduced = useReducedMotion();
  const products = useProductsStore((s) => s.products);
  const vouchers = useVouchersStore((s) => s.vouchers);
  const loadVouchers = useVouchersStore((s) => s.load);
  const pendingCode = useVouchersStore((s) => s.pendingCode);
  const setPendingCode = useVouchersStore((s) => s.setPendingCode);
  // Saklar layanan toko (Profil Admin → Pengaturan Toko):
  // nonaktif → opsi antar / QRIS disembunyikan & pilihan lama di-reset
  const deliveryEnabled = useSettingsStore((s) => s.deliveryEnabled);
  const qrisEnabled = useSettingsStore((s) => s.qrisEnabled);
  const ewalletEnabled = useSettingsStore((s) => s.ewalletEnabled);
  const [submitting, setSubmitting] = useState(false);
  /** Pesanan QRIS yang sedang dibayar (layar QR terbuka) */
  const [payOrder, setPayOrder] = useState<QrisPayOrder | null>(null);
  /** Popup pilih alamat pengantaran (area Kec. Pidie 24151) */
  const [areaOpen, setAreaOpen] = useState(false);
  /** Pin GPS lokasi rumah (opsional) — kurir diarahkan presisi ke titik ini */
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [mapsLinkInput, setMapsLinkInput] = useState("");
  const [form, setForm] = useState({
    name: user.name ?? "",
    type: "DINE_IN" as (typeof ORDER_TYPES)[number]["id"],
    tableNo: "",
    address: "",
    areaId: "",
    phone: user.phone ?? "",
    note: "",
    payment: "CASH" as (typeof PAYMENTS)[number]["id"],
  });

  // ===== Voucher =====
  const [voucherInput, setVoucherInput] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState<VoucherInfo | null>(null);
  const [voucherChecking, setVoucherChecking] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);

  const subtotal = cart.totalPrice();

  // Layanan dimatikan admin → pilihan lama otomatis dikembalikan
  useEffect(() => {
    if (!deliveryEnabled) {
      setForm((f) => (f.type === "DELIVERY" ? { ...f, type: "DINE_IN", areaId: "", address: "" } : f));
      setGps(null);
      setMapsLinkInput("");
    }
    if (!qrisEnabled && !ewalletEnabled) {
      // Pembayaran online dimatikan penuh (kedua saklar) → kembali ke tunai
      setForm((f) => (f.payment !== "CASH" ? { ...f, payment: "CASH" } : f));
    }
  }, [deliveryEnabled, qrisEnabled, ewalletEnabled]);

  /** Opsi jenis pesanan & pembayaran yang tampil — mengikuti saklar admin.
   *  UPDATE (2026-11-26): opsi "Online (DOKU)" aktif bila SALAH SATU saklar
   *  pembayaran digital dinyalakan (QRIS atau E-Wallet). */
  const availableTypes = ORDER_TYPES.filter((t) => t.id !== "DELIVERY" || deliveryEnabled);
  const availablePayments = PAYMENTS.filter(
    (p) => p.id === "CASH" || (p.id === "QRIS" && (qrisEnabled || ewalletEnabled))
  );

  /** Area pengantaran terpilih + ongkir — Rp1.000/km, kelipatan jarak
   *  (jarak dibulatkan KE ATAS per 1 km, dihitung ulang juga oleh server) */
  const deliveryArea =
    form.type === "DELIVERY" && form.areaId ? findDeliveryArea(form.areaId) : undefined;
  const deliveryFee =
    form.type === "DELIVERY" && deliveryArea ? (feeForArea(deliveryArea.id) ?? 0) : 0;

  /** ===== JADWAL JAM PENGAMBILAN (Bungkus / Ambil — permintaan pemilik) =====
   *  null = ambil sekarang (perilaku lama); { day, time } = slot dipilih
   *  (hari ini / besok, grid 30 menit pukul 08:00–21:00). Berbasis waktu
   *  perangkat — seluruh pengguna AGSI berada di WIB (Aceh). */
  const [pickup, setPickup] = useState<{ day: "today" | "tomorrow"; time: string } | null>(null);

  const pickupSlots = useMemo(() => {
    const slots: string[] = [];
    for (let h = 8; h <= 21; h++) {
      for (const m of [0, 30]) {
        slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    return slots;
  }, []);

  /** Slot sudah lewat? (hanya relevan utk hari ini — jam perangkat; besok
   *  selalu terbuka). ≤ waktu sekarang dianggap lewat. */
  const slotPassed = (day: "today" | "tomorrow", time: string) => {
    if (day === "tomorrow") return false;
    const [h, m] = time.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime() <= Date.now();
  };

  const pickupDayOpen = (day: "today" | "tomorrow") =>
    pickupSlots.some((s) => !slotPassed(day, s));

  /** Masuk mode jadwal: mulai dari hari ini, bila semua slotnya lewat → besok */
  const startScheduling = () => {
    const day = pickupDayOpen("today") ? "today" : "tomorrow";
    setPickup({ day, time: pickupSlots.find((s) => !slotPassed(day, s)) ?? pickupSlots[0] });
  };

  /** ISO jadwal utk dikirim ke API (WIB perangkat → UTC otomatis) */
  const pickupIso = useMemo(() => {
    if (!pickup) return null;
    const [h, m] = pickup.time.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (pickup.day === "tomorrow") d.setDate(d.getDate() + 1);
    return d.toISOString();
  }, [pickup]);

  /** Ambil pin GPS lokasi rumah sekarang (presisi — dipakai kurir via Google Maps).
   *  Di aplikasi Android WebView geolokasi bisa ditolak → pelanggan tetap bisa
   *  menempel link Google Maps di bawah. */
  const pinMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      showNotice({
        type: "info",
        title: "Perangkat Tidak Mendukung",
        message: "Browser ini tidak bisa mengambil lokasi — tempel link Google Maps rumahmu di kolom yang tersedia.",
      });
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
          lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
        });
        setGpsLoading(false);
      },
      () => {
        setGpsLoading(false);
        showNotice({
          type: "info",
          title: "Lokasi Tidak Bisa Diambil",
          message:
            "Izin lokasi ditolak / tidak tersedia. Buka Google Maps → titik lokasi rumahmu → Bagikan → salin link, lalu tempel di kolom link di bawah ya.",
        });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  /** Terima link Google Maps (@lat,lng / ?q=lat,lng / place) → simpan pin GPS */
  const applyMapsLink = (raw: string) => {
    setMapsLinkInput(raw);
    const m = raw.match(/@?(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) ?? raw.match(/[?&]q=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        setGps({ lat, lng });
      }
    }
  };

  /** Potongan dihitung ulang otomatis mengikuti isi keranjang */
  const voucherDiscount = useMemo(() => {
    if (!appliedVoucher) return 0;
    return computeVoucherDiscount(appliedVoucher, subtotal);
  }, [appliedVoucher, subtotal]);

  const total = Math.max(0, subtotal - voucherDiscount + deliveryFee);

  // Muat daftar voucher untuk saran cepat di bawah input kode
  useEffect(() => {
    void loadVouchers();
  }, [loadVouchers]);

  // Lepas voucher bila belanja turun di bawah minimum
  useEffect(() => {
    if (appliedVoucher && subtotal < appliedVoucher.minPurchase) {
      setVoucherError(
        `Voucher ${appliedVoucher.code} dilepas — belanja minimum ${formatIDR(appliedVoucher.minPurchase)}.`
      );
      setAppliedVoucher(null);
      setVoucherInput("");
    }
  }, [subtotal, appliedVoucher]);

  // Keranjang kosong → bersihkan voucher juga
  useEffect(() => {
    if (cart.items.length === 0) {
      setAppliedVoucher(null);
      setVoucherError(null);
    }
  }, [cart.items.length]);

  /** Tukar kode voucher → validasi server → potongan otomatis */
  const applyVoucher = async (rawCode?: string) => {
    const code = (rawCode ?? voucherInput).trim().toUpperCase();
    if (!code) {
      setVoucherError("Masukkan dulu kode vouchernya ya.");
      return;
    }
    setVoucherChecking(true);
    setVoucherError(null);
    try {
      const res = await apiFetch("/api/vouchers/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, subtotal }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAppliedVoucher(null);
        setVoucherError(data.error ?? "Kode voucher tidak valid.");
        return;
      }
      const voucher = data.voucher as VoucherInfo;
      setAppliedVoucher(voucher);
      setVoucherInput(voucher.code);
      showNotice({
        type: "success",
        mascot: true,
        title: "Voucher Terpasang! 🎟️",
        message: `${voucher.code} (${voucher.title}) berhasil ditukar — potongan ${formatIDR(
          data.discount
        )} otomatis diterapkan ke total.`,
      });
    } catch {
      setVoucherError("Tidak dapat menghubungi server. Coba lagi ya.");
    } finally {
      setVoucherChecking(false);
    }
  };

  // Kode voucher yang "dibawa" dari beranda → isi & tukar otomatis
  useEffect(() => {
    if (pendingCode && cart.items.length > 0) {
      const code = pendingCode;
      setPendingCode(null);
      setVoucherInput(code);
      void applyVoucher(code);
    }
  }, [pendingCode, cart.items.length]);

  const removeVoucher = () => {
    setAppliedVoucher(null);
    setVoucherInput("");
    setVoucherError(null);
  };

  /** Voucher yang masih bisa dipakai akun ini untuk subtotal sekarang */
  const quickPicks = useMemo(
    () =>
      vouchers
        .filter((v) => !v.usedByMe && v.remaining > 0 && subtotal >= v.minPurchase)
        .filter((v) => v.code !== appliedVoucher?.code)
        .slice(0, 3),
    [vouchers, subtotal, appliedVoucher]
  );

  /** Validasi → konfirmasi final (pesanan tidak dapat dibatalkan) → kirim */
  const startOrder = () => {
    if (!form.name.trim()) {
      showNotice({
        type: "error",
        title: "Nama Pemesan Kosong",
        message: "Isi dulu nama pemesan ya, biar pesananmu mudah dikenali dapur 😊",
      });
      return;
    }
    if (form.type === "DINE_IN" && !form.tableNo.trim()) {
      showNotice({
        type: "error",
        title: "Nomor Meja Kosong",
        message: "Isi dulu nomor meja tempat kamu duduk ya 😊",
      });
      return;
    }
    if (form.type === "TAKEAWAY" && pickup && slotPassed(pickup.day, pickup.time)) {
      showNotice({
        type: "error",
        title: "Jam Pengambilan Sudah Lewat",
        message: `Slot ${pickup.time} sudah terlewat — pilih jam pengambilan yang lain ya.`,
      });
      return;
    }
    if (form.type === "DELIVERY" && !form.areaId) {
      showNotice({
        type: "error",
        title: "Alamat Pengantaran Kosong",
        message: "Pilih dulu gampong tujuan di area layanan (Kec. Pidie, Kab. Pidie, Aceh 24151).",
      });
      return;
    }

    const paymentLabel = PAYMENTS.find((p) => p.id === form.payment)?.label ?? "Tunai";
    const voucherText =
      appliedVoucher && voucherDiscount > 0
        ? `, voucher ${appliedVoucher.code} (potongan ${formatIDR(voucherDiscount)})`
        : "";
    const deliveryText =
      form.type === "DELIVERY" && deliveryArea
        ? `, antar ke Gampong ${deliveryArea.gampong} (ongkir ${formatIDR(deliveryFee)})`
        : "";
    const pickupText =
      form.type === "TAKEAWAY" && pickup
        ? `, jadwal ambil ${pickup.day === "tomorrow" ? "besok" : "hari ini"} ${pickup.time}`
        : "";
    showNotice({
      type: "confirm",
      title: "Konfirmasi Pesanan",
      message: `Atas nama ${form.name.trim()} — ${cart.totalItems()} item, pembayaran ${paymentLabel}${voucherText}${deliveryText}${pickupText}, total bayar ${formatIDR(
        total
      )}. Pesanan langsung masuk dapur dan TIDAK DAPAT dibatalkan. Lanjutkan pesanan?`,
      actions: [
        { label: "Ya, Pesan Sekarang", onClick: () => void submitOrder() },
        { label: "Periksa Lagi" },
      ],
    });
  };

  const submitOrder = async () => {
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: form.name.trim(),
          items: cart.items.map((i) => ({ productId: i.productId, qty: i.qty })),
          type: form.type,
          tableNo: form.type === "DINE_IN" ? form.tableNo : undefined,
          address: form.type === "DELIVERY" ? form.address.trim() || undefined : undefined,
          deliveryAreaId: form.type === "DELIVERY" ? form.areaId : undefined,
          deliveryLat: form.type === "DELIVERY" && gps ? gps.lat : undefined,
          deliveryLng: form.type === "DELIVERY" && gps ? gps.lng : undefined,
          pickupAt: form.type === "TAKEAWAY" && pickupIso ? pickupIso : undefined,
          phone: form.phone,
          note: form.note || undefined,
          paymentMethod: form.payment,
          source: "APP",
          voucherCode: appliedVoucher?.code || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 401 sudah ditangani global (kembali ke halaman login)
        if (res.status !== 401) {
          // Voucher bisa jadi tidak lolos validasi ulang server (mis. kuota habis duluan)
          if (appliedVoucher && typeof data.error === "string" && data.error.toLowerCase().includes("voucher")) {
            setAppliedVoucher(null);
            setVoucherInput("");
          }
          showNotice({ type: "error", title: "Gagal Membuat Pesanan", message: data.error ?? "Coba lagi ya." });
        }
        return;
      }
      cart.clear();
      setAppliedVoucher(null);
      setVoucherInput("");
      setVoucherError(null);
      setPickup(null);
      refreshOrders("mine");
      refreshVouchers();
      const created = data.order;
      const finalTotal = created?.total ?? total;

      // Pembayaran digital (QRIS / E-Wallet) dan masih ada tagihan
      // → tampilkan layar pembayaran gateway
      if (
        created &&
        (created.paymentMethod === "QRIS" || created.paymentMethod === "EWALLET") &&
        created.paymentStatus !== "PAID" &&
        finalTotal > 0
      ) {
        setPayOrder({
          id: created.id,
          code: created.code,
          total: finalTotal,
          method: created.paymentMethod === "EWALLET" ? "EWALLET" : "QRIS",
          // Rincian biaya transparan untuk panel Total Pembayaran
          rincian: [
            { label: "Subtotal menu", value: subtotal },
            ...(voucherDiscount > 0
              ? [{ label: "Diskon voucher", value: -voucherDiscount }]
              : []),
            ...(deliveryFee > 0 ? [{ label: "Ongkir antar", value: deliveryFee }] : []),
          ],
        });
        return;
      }

      const hadVoucher = !!created?.voucherCode;
      showNotice({
        type: "success",
        mascot: true,
        title: "Pesanan Berhasil! 🎉",
        message: `Pesanan ${created.code} sudah masuk dapur${
          hadVoucher ? ` — voucher ${created.voucherCode} terpakai` : ""
        }${
          pickup && form.type === "TAKEAWAY"
            ? ` — jadwal ambil ${pickup.day === "tomorrow" ? "besok" : "hari ini"} ${pickup.time}`
            : ""
        }. Total bayar ${formatIDR(finalTotal)}. Ayam geprekmu segera dimasak!`,
        actions: [
          {
            label: "Lihat Pesanan",
            onClick: () => go("orders"),
          },
        ],
      });
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Tidak dapat menghubungi server." });
    } finally {
      setSubmitting(false);
    }
  };

  /** Layar pembayaran QRIS — dirender di kedua keadaan (keranjang isi/kosong)
      agar tetap tampil setelah pesanan sukses mengosongkan keranjang */
  const qrisSheet = payOrder ? (
    <QrisPaySheet
      order={payOrder}
      variant="customer"
      onClose={({ paid }) => {
        setPayOrder(null);
        // Pembayaran QRIS belum berhasil → TIDAK ada popup "Pesanan Berhasil"
        // (permintaan pemilik). Toast peringatan sudah tampil dari QrisPaySheet;
        // pesanan tetap bisa dilunasi lewat tombol "Bayar QRIS" di daftar pesanan.
        if (!paid) return;
        showNotice({
          type: "success",
          mascot: true,
          title: "Pesanan Berhasil! 🎉",
          message: `Pesanan ${payOrder.code} sudah dibayar & masuk dapur. Total bayar ${formatIDR(
            payOrder.total
          )}. Ayam geprekmu segera dimasak!`,
          actions: [
            {
              label: "Lihat Pesanan",
              onClick: () => go("orders"),
            },
          ],
        });
      }}
      onPaid={() => void refreshOrders("mine")}
    />
  ) : null;

  if (cart.items.length === 0) {
    return (
      <>
        {qrisSheet}
        <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-3 px-8 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-50 text-4xl ring-4 ring-orange-100">
            🛒
          </span>
          <h2 className="text-lg font-black text-neutral-800">Keranjang Masih Kosong</h2>
          <p className="text-sm text-neutral-400">
            Ayamnya kesepian nih… yuk pilih menu geprek favoritmu dulu!
          </p>
          <button
            onClick={() => go("menu")}
            className="press-effect mt-2 rounded-full bg-orange-600 px-6 py-2.5 text-sm font-extrabold text-white shadow-lg hover:bg-orange-700"
          >
            Lihat Menu
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4 px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
      <header>
        <h1 className="text-xl font-black text-neutral-900">Keranjang 🛒</h1>
        <p className="text-xs text-neutral-400">{cart.totalItems()} item siap digeprek</p>
      </header>

      {/* Daftar item */}
      <section className="space-y-2.5">
        {cart.items.map((item, i) => (
          <motion.div
            key={item.productId}
            layout={!prefersReduced}
            initial={prefersReduced ? false : { opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex items-center gap-3 rounded-2xl border border-orange-100 bg-white p-3 shadow-sm"
          >
            <ProductThumb
              product={
                products.find((p) => p.id === item.productId) ?? {
                  id: item.productId,
                  updatedAt: "",
                  emoji: item.emoji,
                  imageColor: item.imageColor,
                  hasImage: false,
                }
              }
              className="h-14 w-14 text-2xl"
            />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-bold text-neutral-800">{item.name}</p>
              <p className="text-xs font-semibold text-orange-600">{formatIDR(item.price)}</p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-orange-50 p-0.5">
              <button
                aria-label="Kurangi"
                className="press-effect flex h-7 w-7 items-center justify-center rounded-full bg-white text-orange-700 shadow-sm hover:bg-orange-100"
                onClick={() => cart.setQty(item.productId, item.qty - 1)}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-6 text-center text-sm font-black text-orange-800">{item.qty}</span>
              <button
                aria-label="Tambah"
                className="press-effect flex h-7 w-7 items-center justify-center rounded-full bg-orange-600 text-white shadow-sm hover:bg-orange-700"
                onClick={() => cart.setQty(item.productId, item.qty + 1)}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              aria-label={`Hapus ${item.name}`}
              className="press-effect ml-1 flex h-8 w-8 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-red-50 hover:text-red-500"
              onClick={() => cart.remove(item.productId)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </section>

      {/* Form checkout */}
      <section className="space-y-4 rounded-2xl border border-orange-100 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black uppercase tracking-wide text-neutral-700">
          Detail Pesanan
        </h2>

        {/* Nama pemesan */}
        <div className="space-y-1.5">
          <Label htmlFor="custName">Nama Pemesan</Label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
            <Input
              id="custName"
              placeholder="cth: Budi Santoso"
              className="border-orange-200 pl-9 focus-visible:ring-orange-400"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={60}
            />
          </div>
          <p className="text-[11px] text-neutral-400">
            Nama ini akan tertera pada struk pesananmu.
          </p>
        </div>

        {/* Tipe pesanan — "Antar" hilang bila layanan dimatikan admin */}
        <div className={cn("grid gap-2", availableTypes.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
          {availableTypes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setForm({ ...form, type: t.id });
                // Pindah dari Bungkus → bersihkan jadwal pengambilan
                if (t.id !== "TAKEAWAY") setPickup(null);
              }}
              className={cn(
                "press-effect flex flex-col items-center gap-1 rounded-xl border p-2.5 text-[10px] font-bold transition-all",
                form.type === t.id
                  ? "border-orange-500 bg-orange-50 text-orange-700 ring-2 ring-orange-200"
                  : "border-neutral-200 bg-white text-neutral-500 hover:border-orange-200"
              )}
            >
              <t.icon className="h-5 w-5" strokeWidth={2.2} />
              {t.label}
            </button>
          ))}
        </div>
        {!deliveryEnabled && (
          <p className="text-[11px] font-semibold leading-snug text-amber-600">
            🛵 Layanan antar sedang tidak tersedia — silakan pilih makan di tempat / bungkus.
          </p>
        )}

        {form.type === "DINE_IN" && (
          <div className="space-y-1.5">
            <Label htmlFor="tableNo">Nomor Meja</Label>
            <Input
              id="tableNo"
              placeholder="cth: 07"
              className="border-orange-200 focus-visible:ring-orange-400"
              value={form.tableNo}
              onChange={(e) => setForm({ ...form, tableNo: e.target.value })}
            />
          </div>
        )}
        {form.type === "TAKEAWAY" && (
          /* ===== JADWAL JAM PENGAMBILAN (permintaan pemilik) — bungkus bisa
             diambil langsung atau dijadwalkan: hari ini / besok, slot 30
             menit pukul 08:00–21:30; slot yang sudah lewat dinonaktifkan. */
          <div className="space-y-2 rounded-xl border border-orange-100 bg-orange-50/60 p-3">
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-orange-600" />
              <span className="text-xs font-black text-neutral-800">Jadwal Pengambilan</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPickup(null)}
                className={cn(
                  "press-effect rounded-lg border p-2 text-[11px] font-bold transition-all",
                  pickup === null
                    ? "border-orange-500 bg-white text-orange-700 ring-2 ring-orange-200"
                    : "border-orange-200 bg-white/70 text-neutral-500"
                )}
              >
                🔥 Ambil Sekarang
              </button>
              <button
                type="button"
                onClick={startScheduling}
                className={cn(
                  "press-effect rounded-lg border p-2 text-[11px] font-bold transition-all",
                  pickup !== null
                    ? "border-orange-500 bg-white text-orange-700 ring-2 ring-orange-200"
                    : "border-orange-200 bg-white/70 text-neutral-500"
                )}
              >
                🕒 Jadwalkan Jam
              </button>
            </div>
            {pickup && (
              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-2">
                  {(["today", "tomorrow"] as const).map((day) => (
                    <button
                      key={day}
                      type="button"
                      disabled={!pickupDayOpen(day)}
                      onClick={() =>
                        setPickup({
                          day,
                          time: pickupSlots.find((s) => !slotPassed(day, s)) ?? pickupSlots[0],
                        })
                      }
                      className={cn(
                        "press-effect rounded-lg border p-1.5 text-[11px] font-bold transition-all disabled:opacity-40",
                        pickup.day === day
                          ? "border-orange-500 bg-white text-orange-700 ring-2 ring-orange-200"
                          : "border-orange-200 bg-white/70 text-neutral-500"
                      )}
                    >
                      {day === "today" ? "Hari Ini" : "Besok"}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {pickupSlots.map((s) => {
                    const passed = slotPassed(pickup.day, s);
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={passed}
                        onClick={() => setPickup({ ...pickup, time: s })}
                        className={cn(
                          "press-effect rounded-lg border py-1.5 text-center text-[10px] font-black transition-all",
                          pickup.time === s
                            ? "border-orange-500 bg-orange-600 text-white"
                            : passed
                              ? "border-neutral-100 bg-neutral-50 text-neutral-300"
                              : "border-orange-200 bg-white text-neutral-600 hover:border-orange-300"
                        )}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] font-semibold leading-snug text-orange-700">
                  Datang ke toko pada jam yang dipilih — pesananmu disiapkan menjelang jadwalnya.
                </p>
              </div>
            )}
          </div>
        )}
        {form.type === "DELIVERY" && (
          <div className="space-y-1.5">
            <Label htmlFor="address">Alamat Pengantaran</Label>
            {/* Pilih gampong (area Kec. Pidie 24151) → popup daftar area + ongkir */}
            <button
              type="button"
              onClick={() => setAreaOpen(true)}
              aria-label="Pilih alamat pengantaran"
              className={cn(
                "press-effect flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all",
                deliveryArea
                  ? "border-orange-500 bg-orange-50 ring-2 ring-orange-200"
                  : "border-orange-200 bg-white hover:border-orange-300"
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  deliveryArea ? "bg-orange-600 text-white" : "bg-orange-100 text-orange-600"
                )}
              >
                <MapPin className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                {deliveryArea ? (
                  <>
                    <span className="block truncate text-sm font-bold text-neutral-800">
                      Gampong {deliveryArea.gampong}
                    </span>
                    <span className="block truncate text-[11px] font-semibold text-neutral-500">
                      ± {formatDistance(deliveryArea.distanceKm)} dari toko • ongkir {formatIDR(deliveryFee)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="block text-sm font-bold text-neutral-700">Ketuk untuk pilih gampong…</span>
                    <span className="block truncate text-[11px] font-semibold text-neutral-400">
                      Area layanan: {DELIVERY_AREA_LABEL}
                    </span>
                  </>
                )}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-orange-400" />
            </button>
            <Textarea
              id="address"
              placeholder="Detail alamat (opsional): nomor rumah, patokan…"
              className="min-h-[56px] border-orange-200 focus-visible:ring-orange-400"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            {/* ===== Pin GPS lokasi rumah — kurir diarahkan presisi ===== */}
            <div className="space-y-1.5 rounded-xl border border-emerald-100 bg-emerald-50/60 p-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={pinMyLocation}
                  disabled={gpsLoading}
                  className={cn(
                    "press-effect flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[11px] font-black transition",
                    gps
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100"
                  )}
                >
                  {gpsLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Crosshair className={cn("h-3.5 w-3.5", gps && "animate-none")} />
                  )}
                  {gps ? "Pin Terpasang ✓ — Ganti Titik" : "Pin Lokasi Rumah (GPS)"}
                </button>
                {gps && (
                  <button
                    type="button"
                    onClick={() => {
                      setGps(null);
                      setMapsLinkInput("");
                    }}
                    aria-label="Hapus pin lokasi"
                    className="press-effect flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <input
                value={mapsLinkInput}
                onChange={(e) => applyMapsLink(e.target.value)}
                placeholder="atau tempel link Google Maps rumahmu…"
                aria-label="Link Google Maps lokasi rumah"
                className="h-9 w-full rounded-lg border border-emerald-200 bg-white px-3 text-[11px] font-semibold text-neutral-700"
              />
              <p className="text-[10px] leading-snug text-emerald-700">
                {gps
                  ? `📍 Pin siap — kurir diarahkan presisi ke ${gps.lat}, ${gps.lng}`
                  : "Opsional tapi sangat membantu kurir menemukan rumahmu 🛵"}
              </p>
            </div>
            <p className="text-[11px] font-semibold leading-snug text-orange-600">
              🛵 Ongkir {formatIDR(DELIVERY_FEE_PER_KM)}/km — berlaku kelipatan jarak
              (dibulatkan ke atas per 1 km).
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="phone">No. HP (untuk kabari pesanan)</Label>
          <Input
            id="phone"
            placeholder="08xx-xxxx-xxxx"
            className="border-orange-200 focus-visible:ring-orange-400"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="note">Catatan (opsional)</Label>
          <Textarea
            id="note"
            placeholder="cth: sambal jangan terlalu pedas, ayam dipisah…"
            className="min-h-[64px] border-orange-200 focus-visible:ring-orange-400"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>

        {/* Metode bayar — opsi online hilang bila kedua saklar dimatikan admin */}
        <div className="space-y-1.5">
          <Label>Metode Pembayaran</Label>
          <div className={cn("grid gap-2", availablePayments.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
            {availablePayments.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setForm({ ...form, payment: p.id })}
                className={cn(
                  "press-effect flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs font-bold transition-all",
                  form.payment === p.id
                    ? "border-orange-500 bg-orange-50 text-orange-700 ring-2 ring-orange-200"
                    : "border-neutral-200 text-neutral-500 hover:border-orange-200"
                )}
              >
                <span className="text-base">{p.emoji}</span> {p.label}
              </button>
            ))}
          </div>
          {form.payment === "QRIS" && (
            <p className="text-[11px] font-semibold leading-snug text-neutral-500">
              Halaman DOKU menampilkan semua metode: QRIS (GoPay, DANA, OVO,
              ShopeePay, LinkAja, m-Banking), DOKU Wallet, Virtual Account &amp;
              kanal aktif lainnya — lunas otomatis terverifikasi.
            </p>
          )}
          {!qrisEnabled && !ewalletEnabled && (
            <p className="text-[11px] font-semibold leading-snug text-amber-600">
              📱 Pembayaran online (QRIS &amp; E-Wallet via DOKU) sedang tidak
              tersedia — silakan bayar tunai.
            </p>
          )}
        </div>
      </section>

      {/* Ringkasan */}
      <section className="rounded-2xl border border-orange-100 bg-gradient-to-b from-orange-50/70 to-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 text-sm text-neutral-500">
          <span className="shrink-0">Atas nama</span>
          <span className="max-w-[65%] truncate text-right font-semibold text-neutral-700">
            {form.name.trim() || "—"}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-sm text-neutral-500">
          <span>Subtotal</span>
          <span className="font-semibold text-neutral-700">{formatIDR(subtotal)}</span>
        </div>

        {/* Ongkir pengantaran — tampil hanya bila jenis pesanan DELIVERY */}
        {form.type === "DELIVERY" && deliveryArea && (
          <div className="mt-1 flex items-center justify-between text-sm text-neutral-500">
            <span className="flex items-center gap-1">
              <Bike className="h-3.5 w-3.5 text-orange-500" /> Ongkir (± {formatDistance(deliveryArea.distanceKm)} →{" "}
              {billedKm(deliveryArea.distanceKm)} km)
            </span>
            <span className="font-semibold text-orange-600">{formatIDR(deliveryFee)}</span>
          </div>
        )}

        {/* ===== Tukar kode voucher ===== */}
        <div className="mt-2.5 space-y-1.5">
          <Label htmlFor="voucherCode" className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
            <span className="flex items-center gap-1">
              <Ticket className="h-3.5 w-3.5 text-orange-500" /> Kode Voucher
            </span>
          </Label>

          {appliedVoucher ? (
            <motion.div
              initial={prefersReduced ? false : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2.5 rounded-xl border border-green-300 bg-green-50 p-2.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-600 text-white">
                <Ticket className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-black text-green-900">
                  {appliedVoucher.code} — {formatVoucherValue(appliedVoucher)}{" "}
                  {appliedVoucher.type === "PERCENT" ? "diskon" : "potongan"}
                </p>
                <p className="truncate text-[10px] font-semibold text-green-700">
                  {appliedVoucher.title}
                  {voucherDiscount > 0 ? ` • hemat ${formatIDR(voucherDiscount)}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="Lepas voucher"
                onClick={removeVoucher}
                className="press-effect flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-neutral-400 shadow-sm hover:bg-red-50 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ) : (
            <>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Ticket className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                  <Input
                    id="voucherCode"
                    placeholder="cth: GEPREK10"
                    className="border-orange-200 pl-9 font-mono text-base font-bold uppercase tracking-wider md:text-sm focus-visible:ring-orange-400"
                    value={voucherInput}
                    maxLength={24}
                    autoComplete="off"
                    onChange={(e) =>
                      setVoucherInput(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void applyVoucher();
                      }
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void applyVoucher()}
                  disabled={voucherChecking}
                  className="press-effect flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-extrabold text-white shadow-md hover:bg-orange-700 disabled:opacity-60"
                >
                  {voucherChecking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Tukar"
                  )}
                </button>
              </div>
              {voucherError && (
                <p className="text-[11px] font-semibold leading-snug text-red-500">⚠️ {voucherError}</p>
              )}
              {quickPicks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {quickPicks.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setVoucherInput(v.code);
                        void applyVoucher(v.code);
                      }}
                      className="press-effect rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-bold text-orange-700 transition hover:bg-orange-100"
                    >
                      🎟️ {v.code} · {formatVoucherValue(v)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {appliedVoucher && voucherDiscount > 0 && (
          <div className="mt-1.5 flex items-center justify-between text-sm">
            <span className="flex items-center gap-1 font-semibold text-green-700">
              <Ticket className="h-3.5 w-3.5" /> Potongan voucher
            </span>
            <span className="font-black text-green-600">−{formatIDR(voucherDiscount)}</span>
          </div>
        )}
        {appliedVoucher && voucherDiscount === 0 && (
          <p className="mt-1 text-[11px] font-semibold text-amber-600">
            Potongan voucher baru berlaku saat belanja minimal {formatIDR(appliedVoucher.minPurchase)}.
          </p>
        )}

        <div className="mt-1 flex items-center justify-between text-sm text-neutral-500">
          <span>Biaya layanan</span>
          <span className="font-semibold text-green-600">Gratis</span>
        </div>
        <div className="my-2.5 border-t border-dashed border-orange-200" />
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-neutral-700">Total Bayar</span>
          <motion.span
            key={total}
            initial={prefersReduced ? false : { scale: 1.06 }}
            animate={{ scale: 1 }}
            className="text-xl font-black text-orange-600"
          >
            {formatIDR(total)}
          </motion.span>
        </div>
        <p className="mt-1 text-[11px] text-neutral-400">
          {earnPointsForTotal(total) > 0 ? (
            <>
              🔖 Dapat {earnPointsForTotal(total).toLocaleString("id-ID")} poin member (setara{" "}
              {formatIDR(voucherValueForPoints(earnPointsForTotal(total)))}) saat pesanan selesai
            </>
          ) : (
            <>
              🔖 Tiap belanja {formatIDR(POINTS_EARN_STEP)} dapat {POINTS_EARN_PER_STEP.toLocaleString("id-ID")} poin
              member saat pesanan selesai
            </>
          )}
        </p>

        {/* Peringatan: pesanan tidak dapat dibatalkan */}
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-2.5 text-[11px] font-semibold leading-relaxed text-amber-800 ring-1 ring-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Pesanan yang sudah dikirim langsung masuk dapur dan{" "}
            <strong>TIDAK DAPAT dibatalkan</strong>. Pastikan nama, jenis pesanan,
            dan totalnya sudah benar ya!
          </span>
        </div>

        <motion.button
          whileTap={prefersReduced ? undefined : { scale: 0.97 }}
          disabled={submitting}
          onClick={startOrder}
          className="press-effect mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 text-sm font-extrabold text-white shadow-lg shadow-orange-500/35 transition hover:brightness-105 disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Memproses…
            </>
          ) : (
            <>
              {appliedVoucher && voucherDiscount > 0 && <Ticket className="h-4 w-4" />}
              {form.payment === "QRIS"
                ? "Pesan & Bayar Online (DOKU)"
                : "Pesan Sekarang"}{" "}
              — {formatIDR(total)}
            </>
          )}
        </motion.button>
      </section>

      {/* ===== LAYAR PEMBAYARAN QRIS & PILIH ALAMAT PENGANTARAN ===== */}
      {qrisSheet}
      <DeliveryAddressSheet
        open={areaOpen}
        onClose={() => setAreaOpen(false)}
        selectedId={form.areaId}
        onSelect={(id) => setForm((f) => ({ ...f, areaId: id }))}
      />
    </div>
  );
}
