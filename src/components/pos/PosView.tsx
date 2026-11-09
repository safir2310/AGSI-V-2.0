"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bike,
  BadgeCheck,
  ClipboardList,
  Clock,
  Coins,
  Loader2,
  LogOut,
  Minus,
  MonitorSmartphone,
  Plus,
  Receipt,
  RefreshCw,
  ScanLine,
  Search,
  ShoppingBag,
  Trash2,
  Utensils,
  Wifi,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ChickenBadge } from "@/components/logo/ChickenLogo";
import { ProductThumb } from "@/components/shared/ProductThumb";
import { QrisPaySheet, type QrisPayOrder } from "@/components/shared/QrisPaySheet";
import { ReceiptSheet } from "@/components/shared/ReceiptSheet";
import { refreshOrders, useProductsStore, useSettingsStore } from "@/lib/hooks";
import { useNoticeStore, type AppView } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { formatIDR, type AppUser, type OrderData, type Product } from "@/lib/types";
import { cn } from "@/lib/utils";

type PosItem = { product: Product; qty: number };

export function PosView({ user, go, onLogout }: { user: AppUser; go: (v: AppView) => void; onLogout: () => void }) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const { products, load } = useProductsStore();
  const [query, setQuery] = useState("");
  /** Popup hasil pencarian menu di bawah input cari (autocompletion) */
  const [searchOpen, setSearchOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const [category, setCategory] = useState("Semua");
  /** Mode bar pencarian di bawah header: scan barcode member ATAU cari nama produk */
  const [scanMode, setScanMode] = useState<"member" | "product">("product");
  const [items, setItems] = useState<PosItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [tableNo, setTableNo] = useState("");
  /** Kode member (hasil scan barcode kartu member / ketikan kasir) */
  const [memberCode, setMemberCode] = useState("");
  const [memberInfo, setMemberInfo] = useState<{ name: string; memberCode: string; points: number } | null>(null);
  const [memberChecking, setMemberChecking] = useState(false);
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY" | "DELIVERY">("DINE_IN");
  const [payment, setPayment] = useState<"CASH" | "QRIS" | "EWALLET">("CASH");
  // Saklar layanan toko (Profil Admin → Pengaturan Toko):
  // nonaktif → tombol "Antar" / "QRIS" disembunyikan & pilihan lama di-reset
  const deliveryEnabled = useSettingsStore((s) => s.deliveryEnabled);
  const qrisEnabled = useSettingsStore((s) => s.qrisEnabled);

  // Layanan dimatikan admin → pilihan lama otomatis dikembalikan
  useEffect(() => {
    if (!deliveryEnabled) {
      setOrderType((t) => (t === "DELIVERY" ? "DINE_IN" : t));
    }
    if (!qrisEnabled) {
      setPayment((p) => (p === "QRIS" || p === "EWALLET" ? "CASH" : p));
    }
  }, [deliveryEnabled, qrisEnabled]);
  const [submitting, setSubmitting] = useState(false);
  const [clock, setClock] = useState("");
  const [lastOrder, setLastOrder] = useState<{
    id: string;
    code: string;
    total: number;
    name: string;
    paymentMethod: string;
    paymentStatus: string;
  } | null>(null);
  /** Transaksi QRIS yang sedang dibayar (QR tampil di layar kasir) */
  const [payOrder, setPayOrder] = useState<QrisPayOrder | null>(null);
  /** Cermin payOrder untuk callback stabil (lihat closePaySheet dll.) —
   *  PosView me-render ulang tiap detik (jam live); bila callback yang
   *  diterima QrisPaySheet ikut berubah identitas, efek di dalamnya
   *  terpicu ulang dan layar QR berkedip. Ref menjaga callback tetap stabil. */
  const payOrderRef = useRef<QrisPayOrder | null>(null);
  useEffect(() => {
    payOrderRef.current = payOrder;
  }, [payOrder]);
  /** Pesanan yang struknya sedang dibuka (cetak / simpan bernama kode struk) */
  const [receiptOrder, setReceiptOrder] = useState<OrderData | null>(null);

  // Jam operasional live
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const categories = useMemo(
    () => ["Semua", ...Array.from(new Set(products.map((p) => p.category)))],
    [products]
  );

  const q = query.trim().toLowerCase();
  const filtered = products.filter((p) => {
    if (!p.available) return false;
    // Sedang mencari → hasil dari SEMUA kategori (saringan kategori dilewati),
    // cocokkan nama produk ATAU nama kategorinya
    if (q) {
      return (
        p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
      );
    }
    return category === "Semua" || p.category === category;
  });

  /** Menu yang tampil di popup pencarian (maks. 6 supaya ringkas) */
  const POPUP_MAX = 6;
  const popupMatches = q ? filtered.slice(0, POPUP_MAX) : [];

  /** Tutup popup saat klik di luar kotak pencarian atau tekan Escape */
  useEffect(() => {
    if (!searchOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [searchOpen]);

  const addItem = (p: Product) =>
    setItems((cur) => {
      const found = cur.find((i) => i.product.id === p.id);
      if (found) return cur.map((i) => (i.product.id === p.id ? { ...i, qty: i.qty + 1 } : i));
      return [...cur, { product: p, qty: 1 }];
    });

  /** Pilih menu dari popup: masuk keranjang, bersihkan pencarian, tutup popup */
  const pickFromPopup = (p: Product) => {
    addItem(p);
    setQuery("");
    setSearchOpen(false);
  };

  const changeQty = (id: string, delta: number) =>
    setItems((cur) =>
      cur
        .map((i) => (i.product.id === id ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0)
    );

  const subtotal = items.reduce((s, i) => s + i.product.price * i.qty, 0);
  const totalItems = items.reduce((s, i) => s + i.qty, 0);

  /** Banyak jenis menu di keranjang (≥7) → baris keranjang otomatis jadi
   *  RINGKAS & TRANSPARAN (kaca) supaya daftar tetap ringan digulir dan
   *  kasir tetap fokus ke total & tombol bayar saat transaksi ramai */
  const compactCart = items.length > 6;

  /** Mode scroll daftar keranjang: gradasi atas/bawah menandai daftar bisa
   *  digulir + item yang BARU ditambahkan langsung digulirkan ke layar */
  const listRef = useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const updateFades = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setFade({
      top: el.scrollTop > 4,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
    });
  }, []);
  const prevRows = useRef(0);
  useEffect(() => {
    const el = listRef.current;
    // Jenis menu BARU masuk keranjang → gulir ke bawah agar langsung terlihat
    if (items.length > prevRows.current && el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: prefersReduced ? "auto" : "smooth",
      });
    }
    prevRows.current = items.length;
    updateFades();
  }, [items, prefersReduced, updateFades]);

  /** Cari member dari kode (dipakai saat scan barcode / ketik lalu Enter) */
  const lookupMember = async (raw?: string) => {
    const code = (raw ?? memberCode).replace(/\D/g, "");
    if (!code) {
      setMemberInfo(null);
      return;
    }
    setMemberChecking(true);
    try {
      const res = await apiFetch(`/api/member/lookup?code=${encodeURIComponent(code)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setMemberInfo(null);
        showNotice({ type: "error", title: "Member Tidak Ditemukan", message: data.error ?? "Periksa kode member." });
        return;
      }
      setMemberInfo(data.member);
    } catch {
      setMemberInfo(null);
      showNotice({ type: "error", title: "Gagal Memeriksa", message: "Tidak dapat menghubungi server." });
    } finally {
      setMemberChecking(false);
    }
  };

  const clearMember = () => {
    setMemberCode("");
    setMemberInfo(null);
  };

  /** Ambil detail pesanan lengkap lalu tampilkan sheet struk (cetak/simpan
   *  dengan nama file = kode struk). Mengembalikan true bila berhasil dibuka. */
  const openReceipt = useCallback(async (orderId: string): Promise<boolean> => {
    try {
      const res = await apiFetch(`/api/orders/${orderId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.order) return false;
      setReceiptOrder(data.order as OrderData);
      return true;
    } catch {
      return false;
    }
  }, []);

  /** ===== Callback layar QRIS — STABIL (identitas tidak berubah tiap
   *  render) supaya efek di QrisPaySheet tidak terpicu ulang & QR tak berkedip ===== */
  const handlePayPaid = useCallback(() => {
    // Sinkronkan chip struk terakhir: QRIS sudah lunas lewat sistem
    const id = payOrderRef.current?.id;
    setLastOrder((o) => (o && id && o.id === id ? { ...o, paymentStatus: "PAID" } : o));
    void refreshOrders("all");
  }, []);

  const printPayReceipt = useCallback(() => {
    const id = payOrderRef.current?.id;
    if (id) void openReceipt(id);
  }, [openReceipt]);

  const closePaySheet = useCallback(() => {
    const closed = payOrderRef.current;
    setPayOrder(null);
    if (closed) {
      showNotice({
        type: "info",
        title: `Struk ${closed.code}`,
        message: `${formatIDR(closed.total)} • Pembayaran QRIS diverifikasi OTOMATIS oleh sistem saat dana masuk — kasir tidak perlu (dan tidak bisa) menandai lunas. Tekan kode pesanan di bar atas untuk membuka lagi layar QR dan memantau statusnya.`,
      });
    }
  }, [showNotice]);

  const submit = async () => {
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ productId: i.product.id, qty: i.qty })),
          customerName: customerName.trim() || `Walk-in${tableNo ? ` Meja ${tableNo}` : ""}`,
          memberCode: memberInfo ? memberInfo.memberCode : undefined,
          type: orderType,
          tableNo: orderType === "DINE_IN" ? tableNo : undefined,
          paymentMethod: payment,
          source: "POS",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showNotice({ type: "error", title: "Transaksi Gagal", message: data.error ?? "Coba lagi." });
        return;
      }
      setLastOrder({
        id: data.order.id,
        code: data.order.code,
        total: data.order.total,
        name: data.order.customerName,
        paymentMethod: data.order.paymentMethod,
        paymentStatus: data.order.paymentStatus,
      });
      setItems([]);
      setCustomerName("");
      setTableNo("");
      clearMember();
      refreshOrders("all");

      // Pembayaran digital: tampilkan layar bayar di kasir agar pelanggan
      // bisa menyelesaikannya. Sistem yang melunaskan otomatis saat dana
      // masuk (webhook/polling) — kasir TIDAK menandai lunas.
      if (
        (data.order.paymentMethod === "QRIS" || data.order.paymentMethod === "EWALLET") &&
        data.order.paymentStatus !== "PAID" &&
        data.order.total > 0
      ) {
        setPayOrder({
          id: data.order.id,
          code: data.order.code,
          total: data.order.total,
          method: data.order.paymentMethod === "EWALLET" ? "EWALLET" : "QRIS",
        });
        return;
      }

      // Tunai — uang sudah diterima langsung di kasir. Struk dibuka seketika
      // agar bisa dicetak / disimpan (sesuai label tombol "Bayar & Cetak");
      // bila gagal dimuat, cukup pemberitahuan sukses biasa.
      const receiptOpened = await openReceipt(data.order.id);
      if (!receiptOpened) {
        showNotice({
          type: "success",
          title: "Transaksi Berhasil ✓",
          message: `Pesanan ${data.order.code} (${formatIDR(data.order.total)}) telah dicatat dan masuk antrean dapur.`,
        });
      }
    } catch {
      showNotice({ type: "error", title: "Koneksi Bermasalah", message: "Periksa jaringan lalu ulangi." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-orange-50/40 pb-[env(safe-area-inset-bottom,0px)] pt-[env(safe-area-inset-top,0px)]">
      {/* ===== TOOLBAR OPERASIONAL POS ===== */}
      <header className="z-30 shrink-0 bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 text-white shadow-xl">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-6">
          <div className="flex items-center gap-2.5">
            <ChickenBadge size={38} />
            <div className="leading-tight">
              <p className="text-sm font-black uppercase tracking-wide">POS Kasir</p>
              <p className="text-[10px] font-semibold text-orange-100">Ayam Geprek Sambal Ijo</p>
            </div>
          </div>

          <div className="hidden items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold md:flex">
            <Clock className="h-3.5 w-3.5" /> <span className="tabular-nums">{clock}</span>
          </div>
          <div className="hidden items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold md:flex">
            <Wifi className="h-3.5 w-3.5" /> Online
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold">
            👤 {user.name}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {lastOrder && (
              <button
                onClick={() => {
                  // Pesanan digital belum lunas -> buka lagi layar bayar (pantau otomatis)
                  if (
                    (lastOrder.paymentMethod === "QRIS" || lastOrder.paymentMethod === "EWALLET") &&
                    lastOrder.paymentStatus !== "PAID" &&
                    lastOrder.total > 0
                  ) {
                    setPayOrder({
                      id: lastOrder.id,
                      code: lastOrder.code,
                      total: lastOrder.total,
                      method: lastOrder.paymentMethod === "EWALLET" ? "EWALLET" : "QRIS",
                    });
                    return;
                  }
                  // Sudah lunas (tunai/QRIS) -> buka struk untuk dicetak/diunduh
                  void openReceipt(lastOrder.id);
                }}
                className="press-effect flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold hover:bg-white/25"
                title={
                  (lastOrder.paymentMethod === "QRIS" || lastOrder.paymentMethod === "EWALLET") && lastOrder.paymentStatus !== "PAID"
                    ? "Buka lagi layar pembayaran (memantau otomatis)"
                    : "Buka struk terakhir — cetak / simpan"
                }
              >
                <Receipt className="h-4 w-4" /> {lastOrder.code}
              </button>
            )}
            {(user.role === "ADMIN" || user.role === "OWNER") && (
              <button
                onClick={() => go("dashboard")}
                className="press-effect flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold hover:bg-white/25"
              >
                <MonitorSmartphone className="h-4 w-4" /> Mode Admin
              </button>
            )}
            <button
              onClick={() => load(true)}
              aria-label="Muat ulang produk"
              className="press-effect flex h-8 w-8 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={onLogout}
              className="press-effect flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold hover:bg-white/25"
            >
              <LogOut className="h-4 w-4" /> Keluar
            </button>
          </div>
        </div>
      </header>

      {/* ===== BAR SCAN BARCODE & PENCARIAN (di bawah header) =====
          Mode 1: Scan Member — scan/ketik kode member (8 digit) → member terpasang
          Mode 2: Nama Produk — saring katalog menu berdasarkan nama produk */}
      <div className="z-20 shrink-0 border-b border-orange-100 bg-white px-4 py-2.5 shadow-sm lg:px-5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Pemilih mode */}
          <div
            role="tablist"
            aria-label="Mode pencarian"
            className="flex shrink-0 items-center gap-0.5 rounded-xl bg-orange-50 p-1 ring-1 ring-orange-200"
          >
            <button
              role="tab"
              aria-selected={scanMode === "member"}
              onClick={() => setScanMode("member")}
              className={cn(
                "press-effect flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-extrabold transition",
                scanMode === "member"
                  ? "bg-orange-600 text-white shadow-md"
                  : "text-orange-700 hover:bg-orange-100"
              )}
            >
              <ScanLine className="h-3.5 w-3.5" /> Scan Member
            </button>
            <button
              role="tab"
              aria-selected={scanMode === "product"}
              onClick={() => setScanMode("product")}
              className={cn(
                "press-effect flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-extrabold transition",
                scanMode === "product"
                  ? "bg-orange-600 text-white shadow-md"
                  : "text-orange-700 hover:bg-orange-100"
              )}
            >
              <Search className="h-3.5 w-3.5" /> Nama Produk
            </button>
          </div>

          {/* Input sesuai mode */}
          {scanMode === "member" ? (
            <form
              className="relative min-w-[220px] flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                void lookupMember();
              }}
            >
              <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
              <Input
                inputMode="numeric"
                autoFocus
                placeholder="Scan / ketik kode member (8 digit), Enter…"
                className="border-orange-200 pl-9 pr-24 focus-visible:ring-orange-400"
                value={memberCode}
                disabled={memberChecking}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 12);
                  setMemberCode(v);
                  // Kode member selalu 8 digit → cari otomatis begitu genap 8 angka
                  if (v.length === 8 && !memberInfo) void lookupMember(v);
                }}
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
                {memberChecking && <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" />}
                {memberCode && !memberInfo && (
                  <button
                    type="button"
                    onClick={() => setMemberCode("")}
                    aria-label="Bersihkan kode"
                    className="press-effect flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 hover:bg-orange-50 hover:text-neutral-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </form>
          ) : (
            <div ref={searchBoxRef} className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
              <Input
                autoFocus
                placeholder="Cari menu dengan nama produk… (cth: geprek, mozarella)"
                className="border-orange-200 pl-9 pr-9 focus-visible:ring-orange-400"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => {
                  if (query.trim()) setSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  // Enter = langsung masukkan hasil teratas ke keranjang
                  if (e.key === "Enter" && popupMatches.length > 0) {
                    e.preventDefault();
                    pickFromPopup(popupMatches[0]);
                  }
                }}
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery("");
                    setSearchOpen(false);
                  }}
                  aria-label="Bersihkan pencarian"
                  className="press-effect absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-orange-50 hover:text-neutral-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}

              {/* ===== POPUP HASIL PENCARIAN ===== */}
              <AnimatePresence>
                {searchOpen && q && (
                  <motion.div
                    initial={prefersReduced ? false : { opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={prefersReduced ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    role="listbox"
                    aria-label="Hasil pencarian menu"
                    className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-2xl shadow-orange-900/10"
                  >
                    {popupMatches.length === 0 ? (
                      <div className="px-4 py-5 text-center">
                        <p className="text-xl">🔍</p>
                        <p className="mt-1 text-xs font-bold text-neutral-500">
                          Tidak ada menu “{query.trim()}”
                        </p>
                        <p className="text-[10px] text-neutral-400">Coba kata kunci lain, cth: geprek, es teh</p>
                      </div>
                    ) : (
                      <>
                        <p className="border-b border-orange-100 bg-orange-50/70 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wide text-orange-700">
                          {filtered.length} menu ditemukan — ketuk untuk masukkan keranjang
                        </p>
                        {popupMatches.map((p) => {
                          const inCart = items.find((i) => i.product.id === p.id)?.qty ?? 0;
                          return (
                            <button
                              key={p.id}
                              role="option"
                              aria-selected={false}
                              onClick={() => pickFromPopup(p)}
                              className="flex w-full items-center gap-2.5 border-b border-orange-50 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-orange-50"
                            >
                              <ProductThumb
                                product={p}
                                className="h-10 w-10 shrink-0 text-xl"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-bold text-neutral-800">
                                  {p.name}
                                  {inCart > 0 && (
                                    <span className="ml-1.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-black text-orange-700">
                                      di keranjang ×{inCart}
                                    </span>
                                  )}
                                </span>
                                <span className="block truncate text-[10px] text-neutral-400">
                                  {p.category}
                                </span>
                              </span>
                              <span className="shrink-0 text-xs font-black text-orange-600">
                                {formatIDR(p.price)}
                              </span>
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-orange-600 text-white">
                                <Plus className="h-3.5 w-3.5" />
                              </span>
                            </button>
                          );
                        })}
                        {filtered.length > POPUP_MAX && (
                          <button
                            onClick={() => setSearchOpen(false)}
                            className="w-full bg-orange-50/70 px-3 py-2 text-[11px] font-extrabold text-orange-700 transition-colors hover:bg-orange-100"
                          >
                            Lihat semua {filtered.length} hasil di katalog ↓
                          </button>
                        )}
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Chip member yang sedang terpasang (hasil scan) */}
        {memberInfo && (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
            <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-black text-emerald-800">
                {memberInfo.name} <span className="font-mono">({memberInfo.memberCode})</span>
              </p>
              <p className="flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                <Coins className="h-3 w-3" /> Saldo {memberInfo.points.toLocaleString("id-ID")} poin — masuk
                saat pesanan selesai
              </p>
            </div>
            <button
              onClick={clearMember}
              aria-label="Lepas member"
              className="press-effect flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row lg:overflow-hidden lg:p-5">
        {/* ===== KATALOG PRODUK ===== */}
        <main className="flex min-h-[55dvh] flex-1 flex-col gap-3 overflow-hidden lg:min-h-0">
          <div className="scrollbar-slim flex gap-1.5 overflow-x-auto pb-0.5">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setCategory(c);
                    // memilih kategori = berhenti mencari → tampilkan isi kategori itu
                    if (query) setQuery("");
                  }}
                  className={cn(
                    "shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition",
                    !q && category === c
                      ? "bg-orange-600 text-white shadow-md"
                      : "bg-white text-orange-700 ring-1 ring-orange-200 hover:bg-orange-50"
                  )}
                >
                  {c}
                </button>
              ))}
          </div>

          {/* Status pencarian aktif: hasil diambil dari semua kategori */}
          {q && (
            <div className="flex shrink-0 items-center justify-between gap-2 rounded-xl border border-orange-200 bg-orange-50/70 px-3.5 py-2">
              <p className="min-w-0 truncate text-[11px] font-bold text-orange-800">
                🔍 {filtered.length} menu ditemukan untuk “{query.trim()}” — dari semua kategori
              </p>
              <button
                onClick={() => setQuery("")}
                className="press-effect shrink-0 rounded-full bg-orange-600 px-2.5 py-1 text-[10px] font-extrabold text-white hover:bg-orange-700"
              >
                Reset
              </button>
            </div>
          )}

          <div className="scrollbar-slim grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-3 overflow-y-auto pb-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <AnimatePresence mode="popLayout">
              {filtered.map((p) => {
                const inCart = items.find((i) => i.product.id === p.id)?.qty ?? 0;
                return (
                  <motion.button
                    layout={!prefersReduced}
                    key={p.id}
                    initial={prefersReduced ? false : { opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={prefersReduced ? undefined : { opacity: 0, scale: 0.94 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => addItem(p)}
                    className={cn(
                      "card-lift group relative flex flex-col rounded-2xl border bg-white p-3 text-left shadow-sm",
                      inCart > 0 ? "border-orange-400 ring-2 ring-orange-200" : "border-orange-100"
                    )}
                  >
                    {inCart > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-orange-600 px-1.5 text-xs font-black text-white shadow-lg">
                        {inCart}
                      </span>
                    )}
                    <ProductThumb
                      product={p}
                      className="mb-2 aspect-square w-full text-4xl"
                      imgClassName="aspect-square transition-transform group-hover:scale-110"
                      emojiClassName="transition-transform group-hover:scale-110"
                    />
                    <p className="line-clamp-1 text-sm font-bold text-neutral-800">{p.name}</p>
                    <p className="text-[10px] text-neutral-400">{p.category}</p>
                    <p className="mt-1 text-sm font-black text-orange-600">{formatIDR(p.price)}</p>
                  </motion.button>
                );
              })}
            </AnimatePresence>
            {filtered.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-orange-200 bg-white/60 p-10 text-center">
                <span className="text-3xl">🔍</span>
                <p className="text-sm font-semibold text-neutral-400">
                  {q
                    ? `Tidak ada menu yang cocok untuk “${query.trim()}”`
                    : category === "Semua"
                      ? "Belum ada menu"
                      : `Belum ada menu di kategori ${category}`}
                </p>
                {(q || category !== "Semua") && (
                  <button
                    onClick={() => {
                      setQuery("");
                      setCategory("Semua");
                    }}
                    className="press-effect mt-1 rounded-full bg-orange-600 px-4 py-2 text-[11px] font-extrabold text-white shadow-md hover:bg-orange-700"
                  >
                    Lihat Semua Menu
                  </button>
                )}
              </div>
            )}
          </div>
        </main>

        {/* ===== PANEL KERANJANG / PEMBAYARAN ===== */}
        <aside className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-xl lg:w-[360px]">
          <div className="flex items-center justify-between border-b border-orange-100 bg-gradient-to-r from-orange-600 to-orange-500 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              <div>
                <p className="text-sm font-black">Pesanan Saat Ini</p>
                <p className="text-[10px] text-orange-100">{totalItems} item di keranjang</p>
              </div>
            </div>
            {items.length > 0 && (
              <button
                onClick={() => setItems([])}
                className="press-effect flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold hover:bg-white/25"
              >
                <Trash2 className="h-3 w-3" /> Kosongkan
              </button>
            )}
          </div>

          {/* Chip mode ringkas — muncul otomatis saat keranjang ramai */}
          {compactCart && (
            <p className="shrink-0 border-b border-orange-100/70 bg-orange-50/60 px-3 py-1.5 text-center text-[10px] font-bold text-orange-700">
              🧺 Mode ringkas: {items.length} jenis menu — baris transparan, gulir untuk melihat
              semua
            </p>
          )}

          {/* Item list — MODE SCROLL: gradasi atas/bawah menandai daftar bisa
              digulir; tinggi dibatasi di layar kecil agar form transaksi
              selalu terjangkau tanpa menggulir jauh */}
          <div className="relative min-h-0 flex-1">
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-white to-transparent transition-opacity duration-200",
                fade.top ? "opacity-100" : "opacity-0"
              )}
            />
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 z-10 h-5 bg-gradient-to-t from-white to-transparent transition-opacity duration-200",
                fade.bottom ? "opacity-100" : "opacity-0"
              )}
            />
            <div
              ref={listRef}
              onScroll={updateFades}
              className="scrollbar-slim h-full max-h-[44dvh] min-h-[100px] space-y-2 overflow-y-auto p-3 lg:max-h-none"
            >
              {items.length === 0 ? (
                <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 p-6 text-center">
                  <span className="text-4xl">🧺</span>
                  <p className="text-xs font-semibold text-neutral-400">
                    Klik menu di sebelah kiri untuk menambah item
                  </p>
                </div>
              ) : (
                items.map((i) => (
                  <motion.div
                    layout={!prefersReduced}
                    key={i.product.id}
                    initial={prefersReduced ? false : { opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border",
                      compactCart
                        ? "border-orange-100/60 bg-white/50 p-2 backdrop-blur-sm"
                        : "border-orange-50 bg-orange-50/40 p-2.5"
                    )}
                  >
                    <ProductThumb
                      product={i.product}
                      className={compactCart ? "h-7 w-7 text-base" : "h-9 w-9 text-lg"}
                      rounded="rounded-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-xs font-bold text-neutral-800">{i.product.name}</p>
                      <p className="text-[11px] font-semibold text-orange-600">
                        {formatIDR(i.product.price * i.qty)}
                      </p>
                    </div>
                  <div className="flex items-center gap-1 rounded-full bg-white p-0.5 shadow-sm">
                    <button
                      aria-label="Kurangi"
                      onClick={() => changeQty(i.product.id, -1)}
                      className="press-effect flex h-6 w-6 items-center justify-center rounded-full text-orange-700 hover:bg-orange-100"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-5 text-center text-xs font-black text-orange-800">{i.qty}</span>
                    <button
                      aria-label="Tambah"
                      onClick={() => changeQty(i.product.id, 1)}
                      className="press-effect flex h-6 w-6 items-center justify-center rounded-full bg-orange-600 text-white hover:bg-orange-700"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                    </motion.div>
              ))
            )}
            </div>
          </div>

          {/* Form transaksi — bagian input/pilihan bisa digulir sendiri bila
              layar pendek, sehingga TOTAL & tombol bayar tidak terpotong */}
          <div className="scrollbar-slim max-h-[40dvh] shrink-0 space-y-2.5 overflow-y-auto border-t border-orange-100 p-3">
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Nama pelanggan (opsional)"
                className="border-orange-200 text-base md:text-xs focus-visible:ring-orange-400"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
              {orderType === "DINE_IN" ? (
                <Input
                  placeholder="No. meja"
                  className="border-orange-200 text-base md:text-xs focus-visible:ring-orange-400"
                  value={tableNo}
                  onChange={(e) => setTableNo(e.target.value)}
                />
              ) : (
                <div className="flex items-center rounded-lg bg-orange-50 px-2 text-[10px] font-bold text-orange-700">
                  {orderType === "TAKEAWAY" ? "Bungkus oleh pelanggan" : "Diantar kurir toko"}
                </div>
              )}
            </div>

            {/* Member dikelola lewat bar "Scan Member" di bawah header */}

            {/* Jenis pesanan — "Antar" hilang bila layanan dimatikan admin */}
            <div className={cn("grid gap-1.5", deliveryEnabled ? "grid-cols-3" : "grid-cols-2")}>
              {[
                { id: "DINE_IN" as const, label: "Di Tempat", icon: Utensils },
                { id: "TAKEAWAY" as const, label: "Bungkus", icon: ShoppingBag },
                ...(deliveryEnabled
                  ? [{ id: "DELIVERY" as const, label: "Antar", icon: Bike }]
                  : []),
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setOrderType(t.id)}
                  className={cn(
                    "press-effect flex flex-col items-center gap-0.5 rounded-xl border py-2 text-[10px] font-bold transition",
                    orderType === t.id
                      ? "border-orange-500 bg-orange-50 text-orange-700 ring-1 ring-orange-300"
                      : "border-neutral-200 text-neutral-500"
                  )}
                >
                  <t.icon className="h-4 w-4" /> {t.label}
                </button>
              ))}
            </div>

            {/* Metode bayar — QRIS/E-Wallet hilang bila dimatikan admin */}
            <div className={cn("grid gap-1.5", qrisEnabled ? "grid-cols-3" : "grid-cols-1")}>
              {[
                { id: "CASH" as const, label: "💵 Tunai" },
                ...(qrisEnabled
                  ? [
                      { id: "QRIS" as const, label: "📱 QRIS" },
                      { id: "EWALLET" as const, label: "👛 E-Wallet" },
                    ]
                  : []),
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPayment(p.id)}
                  className={cn(
                    "press-effect rounded-xl border py-2 text-xs font-bold transition",
                    payment === p.id
                      ? "border-orange-500 bg-orange-50 text-orange-700 ring-1 ring-orange-300"
                      : "border-neutral-200 text-neutral-500"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* TOTAL + tombol bayar — SELALU terlihat, tidak ikut menggulir */}
          </div>
          <div className="shrink-0 space-y-2.5 border-t border-orange-100 bg-white p-3">
            <div className="rounded-xl bg-gradient-to-r from-orange-50 to-white p-3 ring-1 ring-orange-100">
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span>Subtotal ({totalItems} item)</span>
                <span className="font-bold text-neutral-700">{formatIDR(subtotal)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-sm font-black text-neutral-800">TOTAL</span>
                <span className="text-xl font-black text-orange-600">{formatIDR(subtotal)}</span>
              </div>
            </div>

            <motion.button
              whileTap={prefersReduced ? undefined : { scale: 0.97 }}
              disabled={items.length === 0 || submitting}
              onClick={submit}
              className="press-effect flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 text-sm font-extrabold text-white shadow-lg shadow-orange-500/40 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                "Menyimpan transaksi…"
              ) : (
                <>
                  <Receipt className="h-4 w-4" />{" "}
                  {payment === "QRIS"
                    ? "Bayar QRIS"
                    : payment === "EWALLET"
                      ? "Bayar E-Wallet"
                      : "Bayar & Cetak"}{" "}
                  — {formatIDR(subtotal)}
                </>
              )}
            </motion.button>
          </div>
        </aside>
      </div>

      {/* ===== LAYAR QRIS UNTUK PELANGGAN DI KASIR ===== */}
      {payOrder && (
        <QrisPaySheet
          order={payOrder}
          variant="pos"
          onClose={closePaySheet}
          onPaid={handlePayPaid}
          onPrintReceipt={printPayReceipt}
        />
      )}

      {/* ===== STRUK CETAK/SIMPAN — tunai langsung & pasca-QRIS lunas ===== */}
      <ReceiptSheet
        open={!!receiptOrder}
        order={receiptOrder}
        onClose={() => setReceiptOrder(null)}
      />
    </div>
  );
}
