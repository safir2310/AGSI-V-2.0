export type Role = "CUSTOMER" | "ADMIN" | "OWNER" | "CASHIER";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  points: number;
  /** ISO waktu menyetujui kebijakan penggunaan data (null = belum pernah) */
  dataConsentAt?: string | null;
  /** versi kebijakan yang disetujui (null = belum pernah) */
  dataConsentVersion?: string | null;
  /** ISO waktu menyetujui Syarat & Ketentuan aplikasi (null = belum pernah) */
  appTermsAt?: string | null;
  /** versi S&K yang disetujui (null = belum pernah) */
  appTermsVersion?: string | null;
};

/** Akun kasir (GET/POST /api/cashiers) */
export type CashierInfo = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  emoji: string;
  imageColor: string;
  /** true jika produk punya foto upload — gambar diambil dari /api/products/[id]/image */
  hasImage: boolean;
  spicy: number;
  available: boolean;
  popular: boolean;
  updatedAt: string;
};

/** Bentuk Product di database (internal server) */
export type ProductRow = Omit<Product, "hasImage" | "updatedAt"> & {
  updatedAt: Date;
  imageData: string | null;
  imageMime: string | null;
};

/**
 * Buang field gambar besar dari produk sebelum dikirim ke klien —
 * klien cukup tahu `hasImage`, lalu memuat gambar via route khusus.
 */
export function serializeProduct(p: ProductRow): Product {
  const { imageData, imageMime, updatedAt, ...rest } = p;
  return {
    ...rest,
    updatedAt: updatedAt.toISOString(),
    hasImage: !!(imageData && imageMime),
  };
}

/** URL gambar produk (dengan cache-buster dari updatedAt) */
export function productImageUrl(p: Pick<Product, "id" | "updatedAt">): string {
  return `/api/products/${p.id}/image?v=${encodeURIComponent(p.updatedAt)}`;
}

export type OrderItemData = {
  id: string;
  productId: string | null;
  name: string;
  emoji: string;
  price: number;
  qty: number;
  note: string | null;
};

export type OrderData = {
  id: string;
  code: string;
  userId: string | null;
  customerName: string;
  type: string;
  tableNo: string | null;
  address: string | null;
  phone: string | null;
  /** No. HP tampilan utk admin: nomor saat checkout, fallback ke nomor akun pelanggan (diisi server) */
  userPhone?: string | null;
  note: string | null;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  /** waktu lunas (ISO) — terisi bila pesanan sudah dibayar */
  paidAt?: string | null;
  source: string;
  subtotal: number;
  serviceFee: number;
  /** gampong tujuan pengantaran (null bila bukan DELIVERY) */
  deliveryArea: string | null;
  /** perkiraan jarak toko→alamat (km) */
  distanceKm: number | null;
  /** ongkir Rp1.000/km — kelipatan jarak (0 bila bukan DELIVERY) */
  deliveryFee: number;
  voucherCode: string | null;
  voucherDiscount: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  items: OrderItemData[];
};

/* ================= VOUCHER ================= */

export type VoucherType = "PERCENT" | "FIXED";

/** Voucher yang tampil di halaman pelanggan */
export type VoucherInfo = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  type: VoucherType;
  value: number;
  minPurchase: number;
  maxDiscount: number | null;
  expiresAt: string | null;
  /** sisa kuota pemakaian (total semua pelanggan) */
  remaining: number;
  /** true jika akun yang sedang login sudah pernah memakai kode ini */
  usedByMe: boolean;
  /** true = voucher PRIBADI hasil tukar poin (hanya milik akun ini) */
  ownerOnly?: boolean;
};

/** Voucher versi admin (lebih lengkap) */
export type VoucherAdminInfo = VoucherInfo & {
  quota: number;
  usedCount: number;
  isActive: boolean;
  createdAt: string;
};

/** Hitung potongan voucher untuk sebuah subtotal (Rp) */
export function computeVoucherDiscount(
  v: Pick<VoucherInfo, "type" | "value" | "maxDiscount" | "minPurchase">,
  subtotal: number
): number {
  if (subtotal < v.minPurchase) return 0;
  let discount = v.type === "PERCENT" ? Math.floor((subtotal * v.value) / 100) : v.value;
  if (v.type === "PERCENT" && v.maxDiscount != null) discount = Math.min(discount, v.maxDiscount);
  return Math.min(discount, subtotal);
}

/** Label singkat nilai voucher, cth: "10%" / "Rp 5.000" */
export function formatVoucherValue(v: Pick<VoucherInfo, "type" | "value">): string {
  return v.type === "PERCENT" ? `${v.value}%` : formatIDR(v.value);
}

export const ORDER_STATUS_FLOW: Record<string, string[]> = {
  PENDING: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  PREPARING: "Dimasak",
  READY: "Siap",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

/* ================= MEMBER / POIN ================= */

/** Tier penukaran poin → voucher */
export type PointTierInfo = {
  id: string;
  points: number;
  /** nominal voucher (Rp) */
  value: number;
};

/** Mutasi poin (EARN pesanan selesai / REDEEM tukar voucher) */
export type PointTxnInfo = {
  id: string;
  type: "EARN" | "REDEEM";
  points: number;
  description: string;
  createdAt: string;
};

/** Voucher pribadi hasil tukar poin (untuk kartu member) */
export type MemberVoucherInfo = {
  id: string;
  code: string;
  value: number;
  /** poin yang dipakai untuk menukar */
  points: number;
  expiresAt: string | null;
  used: boolean;
  expired: boolean;
};

/** Data lengkap kartu member (GET /api/member/card) */
export type MemberCardData = {
  name: string;
  email: string;
  memberCode: string;
  points: number;
  /** tanggal bergabung (ISO) */
  memberSince: string;
  /** Belanja Rp earnStep menghasilkan earnStepPoints poin (mis. 15.000 → 100) */
  earnStep: number;
  earnStepPoints: number;
  /** Rate tukar: redeemUnitPoints poin = voucher Rp redeemUnitValue (100 → Rp 100) */
  redeemUnitPoints: number;
  redeemUnitValue: number;
  /** minimal poin agar boleh ditukar jadi voucher */
  minRedeem: number;
  tiers: PointTierInfo[];
  transactions: PointTxnInfo[];
  vouchers: MemberVoucherInfo[];
};

/* ================= CHAT CS (PELANGGAN ↔ ADMIN) ================= */

/** Satu pesan chat (GET/POST /api/chat) */
export type ChatMessageInfo = {
  id: string;
  senderId: string;
  senderName: string;
  /** CUSTOMER | CASHIER (klien) atau ADMIN | OWNER (petugas CS) */
  senderRole: string;
  body: string;
  createdAt: string;
};

/** Baris daftar utas chat untuk admin (GET /api/chat) */
export type ChatThreadInfo = {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  lastMessageAt: string;
  lastMessageBody: string | null;
  lastSenderRole: string | null;
  unreadAdmin: number;
};

/** Pesan dikirim oleh petugas CS (admin/owner)? */
export function isStaffSender(role?: string | null) {
  return role === "ADMIN" || role === "OWNER";
}

/* ================= STATUS PEMBAYARAN ================= */

/** UNPAID: belum bayar • PAID: lunas.
 *  QRIS hanya bisa berubah PAID lewat verifikasi OTOMATIS sistem (dana masuk). */
export type PaymentStatus = "UNPAID" | "PAID";

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  UNPAID: "Belum Bayar",
  PAID: "Lunas",
};

export function formatIDR(value: number): string {
  return "Rp " + value.toLocaleString("id-ID");
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const CATEGORIES = ["Paket Geprek", "Ayam & Laos", "Cemilan", "Minuman", "Topping"];
