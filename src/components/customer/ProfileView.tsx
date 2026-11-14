"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BadgeCheck,
  Bell,
  Bike,
  ChevronRight,
  ClipboardList,
  Coins,
  FileText,
  HandCoins,
  HelpCircle,
  Info,
  LogOut,
  Megaphone,
  MessageCircle,
  Monitor,
  Palette,
  PenLine,
  QrCode,
  ScanFace,
  Settings2,
  ShieldCheck,
  Store,
  UserPlus,
} from "lucide-react";
import { EditProfileSheet } from "@/components/shared/EditProfileSheet";
import { BiometricSheet } from "@/components/shared/BiometricSheet";
import { AdminsSheet } from "@/components/admin/AdminsSheet";
import { CashiersSheet } from "@/components/admin/CashiersSheet";
import { KurirsSheet } from "@/components/admin/KurirsSheet";
import { SetoranKurirSheet } from "@/components/admin/SetoranKurirSheet";
import { StoreSettingsSheet } from "@/components/admin/StoreSettingsSheet";
import { BannerSettingsSheet } from "@/components/admin/BannerSettingsSheet";
import { QrisManagerSheet } from "@/components/admin/QrisManagerSheet";
import { PosterGeneratorSheet } from "@/components/admin/PosterGeneratorSheet";
import { LegalSheet } from "@/components/shared/LegalSheet";
import { PushSettingsSheet } from "@/components/shared/PushSettingsSheet";
import { CourierTrackingSheet } from "@/components/customer/CourierTrackingSheet";
import { readPushStatus, type PushStatus } from "@/lib/push-client";
import { listBiometricCredentials } from "@/lib/biometric-client";
import { apiFetch } from "@/lib/api";
import { useNoticeStore, useUiStore, type AppView } from "@/lib/store";
import { refreshSettings, useOrdersStore, useSettingsStore } from "@/lib/hooks";
import { hasValidConsent, DATA_POLICY_VERSION } from "@/lib/data-policy";
import { hasValidTerms, APP_TERMS_VERSION } from "@/lib/app-terms";
import { STORE_ADDRESS, STORE_HOURS, STORE_PHONE } from "@/lib/store-info";
import type { AppUser } from "@/lib/types";
import { cn } from "@/lib/utils";

type ProfileViewProps = {
  user: AppUser;
  go: (v: AppView) => void;
  onLogout: () => void;
  /** sinkron data user ke shell setelah edit profil tersimpan */
  onUserUpdate: (u: AppUser) => void;
};

type MenuItem = {
  icon: typeof PenLine;
  label: string;
  desc: string;
  onClick: () => void;
  /** jumlah pesan chat yang belum dibaca (badge) */
  badge?: number;
};

export function ProfileView({ user, go, onLogout, onUserUpdate }: ProfileViewProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const orders = useOrdersStore((s) => s.orders);
  const openChat = useUiStore((s) => s.openChat);
  const chatUnreadTick = useUiStore((s) => s.chatUnreadTick);
  const [editOpen, setEditOpen] = useState(false);
  const [cashiersOpen, setCashiersOpen] = useState(false);
  const [kurirsOpen, setKurirsOpen] = useState(false);
  const [adminsOpen, setAdminsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [qrisOpen, setQrisOpen] = useState(false);
  const [posterOpen, setPosterOpen] = useState(false);
  const [setoranOpen, setSetoranOpen] = useState(false);
  const [setoranBadge, setSetoranBadge] = useState(0);
  const [qrisDesc, setQrisDesc] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [courierOpen, setCourierOpen] = useState(false);
  const [bioCount, setBioCount] = useState(0);
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [chatUnread, setChatUnread] = useState(0);
  const isAdmin = user.role === "ADMIN" || user.role === "OWNER";

  // Badge menu "Setoran Kurir" (admin): jumlah kurir yang masih memegang
  // uang COD + setoran yang menunggu konfirmasi — segar saat profil dibuka
  // & setiap kali sheet setoran ditutup.
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await apiFetch("/api/courier/setoran", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as {
          perKurir?: unknown[];
          riwayat?: Array<{ confirmedAt: string | null }>;
        };
        if (!alive) return;
        const pendingConfirm = (d.riwayat ?? []).filter((r) => !r.confirmedAt).length;
        setSetoranBadge((d.perKurir ?? []).length + pendingConfirm);
      } catch {
        // diam — badge disembunyikan saja
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [isAdmin, setoranOpen]);

  // Saklar layanan toko (untuk deskripsi menu + sheet pengaturan)
  const deliveryEnabled = useSettingsStore((s) => s.deliveryEnabled);
  const qrisEnabled = useSettingsStore((s) => s.qrisEnabled);
  const banner = useSettingsStore((s) => s.banner);
  const menuHero = useSettingsStore((s) => s.menuHero);
  const spent = orders
    .filter((o) => o.status === "COMPLETED")
    .reduce((s, o) => s + o.total, 0);
  // Pesanan ANTAR milik akun ini yang sedang berjalan (badge Lacak Kurir).
  // Hanya untuk pelanggan — daftar pesanan staff berisi SEMUA pesanan toko.
  const activeDeliveries = isAdmin
    ? 0
    : orders.filter((o) => o.type === "DELIVERY" && ["PENDING", "PREPARING", "READY"].includes(o.status))
        .length;

  /** Ambil jumlah pesan chat yang belum dibaca (untuk badge menu).
   *  Selain saat buka & saat chat ditutup (chatUnreadTick), badge juga
   *  di-POLLING tiap 6 detik — jadi kalau ada chat masuk saat pengguna
   *  sedang diam di halaman profil, notifikasi/badge langsung muncul. */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await apiFetch("/api/chat/unread", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && typeof data.unread === "number") setChatUnread(data.unread);
      } catch {
        // diam — badge disembunyikan saja
      }
    };
    void load();
    const iv = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
    // chatUnreadTick naik tiap sheet chat ditutup → badge langsung segar
  }, [chatUnreadTick]);

  const confirmLogout = () => {
    showNotice({
      type: "confirm",
      title: "Keluar Aplikasi?",
      message: "Kamu harus masuk lagi untuk memesan geprek berikutnya.",
      actions: [
        { label: "Batal" },
        { label: "Ya, Keluar", variant: "destructive", onClick: onLogout },
      ],
    });
  };

  const helpMenu = {
    icon: HelpCircle,
    label: "Pusat Bantuan",
    desc: "Cara pakai aplikasi",
    onClick: () =>
      showNotice({
        type: "info",
        title: "Pusat Bantuan",
        message: `Hubungi tim AGSI di WhatsApp ${STORE_PHONE} (jam operasional ${STORE_HOURS}). Kunjungi toko kami di ${STORE_ADDRESS}.`,
      }),
  };
  const aboutMenu = {
    icon: Info,
    label: "Tentang Aplikasi",
    desc: "Aplikasi digital terintegrasi restoran AGSI",
    onClick: () =>
      showNotice({
        type: "info",
        title: "Tentang AGSI",
        message:
          "AGSI merupakan aplikasi digital terintegrasi yang dikembangkan untuk mendukung pengelolaan restoran Ayam Geprek Sambal Ijo. Aplikasi ini dirancang untuk mempermudah pemesanan makanan, transaksi, pengelolaan operasional, serta pemantauan bisnis secara real-time.\n\nVisi AGSI: Menghadirkan layanan restoran berbasis teknologi yang modern, efisien, aman, dan mudah digunakan untuk meningkatkan kualitas pelayanan serta pengelolaan bisnis.",
      }),
  };

  // ===== Status persetujuan legal — S&K aplikasi + kebijakan data (semua role) =====
  const termsOk = hasValidTerms(user);
  const dataOk = hasValidConsent(user);
  const legalAllOk = termsOk && dataOk;
  const legalOutdated = !legalAllOk && (!!user.appTermsAt || !!user.dataConsentAt);

  // Status push perangkat utk deskripsi menu — segar saat sheet dibuka/ditutup
  useEffect(() => {
    void readPushStatus()
      .then(setPushStatus)
      .catch(() => undefined);
  }, [pushOpen]);

  // Jumlah perangkat biometrik terdaftar — segar saat sheet dibuka/ditutup
  useEffect(() => {
    if (!bioOpen) return;
    void listBiometricCredentials()
      .then((list) => setBioCount(list.length))
      .catch(() => undefined);
  }, [bioOpen]);

  // Ringkasan dana masuk QRIS utk deskripsi menu "Pengelola QRIS" (admin) —
  // dimuat saat profil dibuka & disegar lagi setelah sheet pengelola ditutup
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      try {
        const res = await apiFetch("/api/admin/qris", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as {
          summary?: { totalMasuk?: number; countLunas?: number; countMenunggu?: number };
        };
        const s = body.summary;
        if (!alive || !s) return;
        const total = s.totalMasuk ?? 0;
        const totalStr =
          total >= 1_000_000
            ? `Rp ${(total / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}jt`
            : total >= 1_000
              ? `Rp ${Math.round(total / 1_000)}rb`
              : `Rp ${total}`;
        setQrisDesc(
          `Dana masuk ${totalStr} • ${s.countLunas ?? 0} lunas • ${s.countMenunggu ?? 0} menunggu`
        );
      } catch {
        // diam — deskripsi default tetap tampil
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin, qrisOpen]);

  const bioMenu: MenuItem = {
    icon: ScanFace,
    label: "Login Biometrik",
    desc:
      bioCount > 0
        ? `Aktif ✓ — ${bioCount} perangkat terdaftar — kelola di sini`
        : "Masuk pakai pemindaian wajah / sidik jari — aktifkan",
    onClick: () => setBioOpen(true),
  };

  const pushMenu: MenuItem = {
    icon: Bell,
    label: "Notifikasi Push",
    desc: pushStatus?.native
      ? "Aplikasi Android — heads-up aktif ✓"
      : pushStatus?.webToken && pushStatus.permission === "granted"
        ? "Aktif ✓ — kelola perangkat ini"
        : pushStatus?.permission === "denied"
          ? "Izin diblokir — ketuk untuk panduan"
          : "Update pesanan & chat ke layar HP — aktifkan",
    onClick: () => setPushOpen(true),
  };

  const courierMenu: MenuItem = {
    icon: Bike,
    label: "Lacak Kurir AGSI",
    desc:
      activeDeliveries > 0
        ? `${activeDeliveries} pesanan antar sedang berjalan — pantau kurirnya`
        : "Pantau kurir pesanan antarmu — status, kontak & rute",
    onClick: () => setCourierOpen(true),
    badge: activeDeliveries,
  };

  const policyMenu: MenuItem = {
    icon: FileText,
    label: "Syarat & Kebijakan Aplikasi",
    desc: legalAllOk
      ? `Disetujui ✓ (S&K v${APP_TERMS_VERSION} • Data v${DATA_POLICY_VERSION}) — lihat detail`
      : legalOutdated
        ? "Ada dokumen terbaru — perlu persetujuan ulang"
        : "Belum disetujui — baca & setujui sekarang",
    onClick: () => setPolicyOpen(true),
  };

  const menuItems: MenuItem[] = isAdmin
    ? [
        { icon: PenLine, label: "Edit Profil", desc: "Ubah nama, no. HP, & password", onClick: () => setEditOpen(true) },
        { icon: MessageCircle, label: "Chat Pelanggan (CS)", desc: chatUnread > 0 ? `${chatUnread} pesan pelanggan belum dibalas` : "Layani pertanyaan pelanggan lewat chat", onClick: openChat, badge: chatUnread },
        { icon: UserPlus, label: "Kelola Kasir", desc: "Tambah & atur akun kasir POS", onClick: () => setCashiersOpen(true) },
        { icon: Bike, label: "Kelola Kurir", desc: "Akun kurir antaran — tugas & lokasi rumah pelanggan", onClick: () => setKurirsOpen(true) },
        {
          icon: HandCoins,
          label: "Setoran Kurir",
          desc:
            setoranBadge > 0
              ? `${setoranBadge} hal perlu dicek — uang COD kurir & konfirmasi setoran`
              : "Uang COD kurir (bayar di tempat) — konfirmasi setoran di sini",
          onClick: () => setSetoranOpen(true),
          badge: setoranBadge,
        },
        {
          icon: Palette,
          label: "Generator Poster & Banner",
          desc: "Bikin poster, banner promosi & spanduk otomatis — tinggal unduh",
          onClick: () => setPosterOpen(true),
        },
        { icon: ShieldCheck, label: "Kelola Admin", desc: "Tambah admin baru & atur akses owner/admin", onClick: () => setAdminsOpen(true) },
        {
          icon: Settings2,
          label: "Pengaturan Toko",
          desc: `Antar ${deliveryEnabled ? "aktif ✓" : "nonaktif ✕"} • QRIS ${qrisEnabled ? "aktif ✓" : "nonaktif ✕"} — ketuk untuk ubah`,
          onClick: () => setSettingsOpen(true),
        },
        {
          icon: Megaphone,
          label: "Banner & Promo",
          desc: `Popup Beranda ${banner.bannerEnabled ? "aktif ✓" : "nonaktif"} • Hero Menu ${
            menuHero.menuHeroEnabled ? "aktif ✓" : "nonaktif"
          } — ketuk untuk ubah`,
          onClick: () => setBannerOpen(true),
        },
        {
          icon: QrCode,
          label: "Pengelola QRIS",
          desc: qrisDesc ?? "Dana masuk, status & tanggal transaksi QRIS — kelola di sini",
          onClick: () => setQrisOpen(true),
        },
        pushMenu,
        bioMenu,
        policyMenu,
        { icon: Monitor, label: "Buka Mode POS Kasir", desc: "Tampilan desktop/tablet untuk transaksi", onClick: () => go("pos") },
        { icon: ClipboardList, label: "Kelola Pesanan", desc: "Pantau & proses pesanan masuk", onClick: () => go("orders") },
        courierMenu,
        helpMenu,
        aboutMenu,
      ]
    : [
        { icon: PenLine, label: "Edit Profil", desc: "Ubah nama, no. HP, & password", onClick: () => setEditOpen(true) },
        { icon: MessageCircle, label: "Chat CS AGSI", desc: chatUnread > 0 ? `${chatUnread} balasan baru dari CS` : "Tanya stok, pesanan, & poin member", onClick: openChat, badge: chatUnread },
        { icon: ClipboardList, label: "Riwayat Pesanan", desc: `${orders.length} pesanan telah dibuat`, onClick: () => go("orders") },
        courierMenu,
        pushMenu,
        bioMenu,
        policyMenu,
        helpMenu,
        aboutMenu,
      ];

  return (
    <div className="px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
      <header className="mb-3">
        <h1 className="text-xl font-black text-neutral-900">Profil 👤</h1>
        <p className="text-xs text-neutral-400">Akun & pengaturanmu</p>
      </header>

      {/* Kartu profil */}
      <motion.section
        initial={prefersReduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 via-orange-500 to-orange-400 p-5 text-white shadow-xl shadow-orange-500/30"
      >
        <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/95 text-2xl font-black text-orange-600 shadow-lg">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-lg font-black">{user.name}</p>
              <BadgeCheck className="h-4 w-4 shrink-0 text-white" />
            </div>
            <p className="truncate text-xs text-orange-50/90">{user.email}</p>
            <span
              className={cn(
                "mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide",
                isAdmin
                  ? "bg-white text-orange-700"
                  : user.role === "CASHIER"
                    ? "bg-amber-400 text-amber-900"
                    : user.role === "COURIER"
                      ? "bg-emerald-400 text-emerald-900"
                      : "bg-green-500/95 text-white"
              )}
            >
              {isAdmin ? <ShieldCheck className="h-3 w-3" /> : user.role === "CASHIER" ? <Store className="h-3 w-3" /> : user.role === "COURIER" ? <Bike className="h-3 w-3" /> : null}
              {isAdmin ? "Owner / Admin" : user.role === "CASHIER" ? "Kasir POS" : user.role === "COURIER" ? "Kurir Antaran" : "Pelanggan"}
            </span>
          </div>
        </div>

        {/* Statistik */}
        <div className="relative z-10 mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white/15 px-3 py-2.5 backdrop-blur-sm">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-50">
              <Coins className="h-3 w-3" /> Poin Member
            </div>
            <p className="mt-0.5 text-xl font-black">{user.points.toLocaleString("id-ID")}</p>
          </div>
          <div className="rounded-2xl bg-white/15 px-3 py-2.5 backdrop-blur-sm">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-50">
              <ClipboardList className="h-3 w-3" /> Total Belanja
            </div>
            <p className="mt-0.5 text-xl font-black">Rp {(spent / 1000).toFixed(0)}rb</p>
          </div>
        </div>
      </motion.section>

      {/* Menu pengaturan */}
      <section className="mt-4 overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm">
        {menuItems.map((item, i) => (
          <button
            key={item.label}
            onClick={item.onClick}
            className={cn(
              "press-effect flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-orange-50/60",
              i > 0 && "border-t border-orange-50"
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100">
              <item.icon className="h-5 w-5 text-orange-600" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-neutral-800">{item.label}</span>
              <span className="block truncate text-[11px] text-neutral-400">{item.desc}</span>
            </span>
            {!!item.badge && item.badge > 0 && (
              <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-orange-600 px-1.5 text-[11px] font-black text-white shadow-md">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
            <ChevronRight className="h-4 w-4 shrink-0 text-orange-300" />
          </button>
        ))}
      </section>

      <button
        onClick={confirmLogout}
        className="press-effect mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-red-100 bg-red-50 py-3.5 text-sm font-bold text-red-600 transition hover:bg-red-100"
      >
        <LogOut className="h-4 w-4" /> Keluar Akun
      </button>

      <p className="mt-4 pb-2 text-center text-[10px] text-neutral-300">
        Ayam Geprek Sambal Ijo © 2026 — dibuat dengan 🧡
      </p>

      {/* ===== SHEET: EDIT PROFIL & KELOLA KASIR (chat CS kini global di AppShell) ===== */}
      <EditProfileSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        user={user}
        onUpdated={onUserUpdate}
      />
      {isAdmin && <CashiersSheet open={cashiersOpen} onClose={() => setCashiersOpen(false)} />}
      {/* Sheet kelola kurir — akun kurir antaran pesanan (admin/owner) */}
      {isAdmin && <KurirsSheet open={kurirsOpen} onClose={() => setKurirsOpen(false)} />}
      {/* Sheet setoran COD kurir — rekap uang di tangan kurir + konfirmasi
          penerimaan setoran (admin/owner) */}
      {isAdmin && <SetoranKurirSheet open={setoranOpen} onClose={() => setSetoranOpen(false)} />}
      {/* Sheet kelola admin — daftar/tambah/edit/hapus akun admin & owner */}
      {isAdmin && (
        <AdminsSheet
          open={adminsOpen}
          onClose={() => setAdminsOpen(false)}
          currentUserId={user.id}
          currentUserRole={user.role}
        />
      )}
      {isAdmin && (
        <StoreSettingsSheet
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false);
            // Deskripsi menu ikut segar setelah saklar diubah
            void refreshSettings();
          }}
        />
      )}
      {isAdmin && (
        <BannerSettingsSheet
          open={bannerOpen}
          onClose={() => {
            setBannerOpen(false);
            // Deskripsi menu ikut segar setelah banner disimpan
            void refreshSettings();
          }}
        />
      )}
      {/* Sheet pengelola QRIS — dana masuk, status & tanggal transaksi (admin/owner) */}
      {isAdmin && <QrisManagerSheet open={qrisOpen} onClose={() => setQrisOpen(false)} />}
      {/* Sheet generator poster/banner promosi/spanduk (admin/owner) */}
      {isAdmin && <PosterGeneratorSheet open={posterOpen} onClose={() => setPosterOpen(false)} />}
      {/* Sheet syarat & kebijakan aplikasi — semua role; setuju di sini
          langsung menyinkronkan status ke AppShell (popup gate hilang) */}
      <LegalSheet open={policyOpen} onClose={() => setPolicyOpen(false)} user={user} onAccepted={onUserUpdate} />

      {/* Sheet notifikasi push FCM — semua role (web + status aplikasi Android) */}
      <PushSettingsSheet open={pushOpen} onClose={() => setPushOpen(false)} user={user} />

      {/* Sheet Lacak Kurir AGSI — pantau pesanan antar berjalan (kurir, kontak, rute) */}
      <CourierTrackingSheet open={courierOpen} onClose={() => setCourierOpen(false)} />

      {/* Sheet login biometrik WebAuthn — semua role */}
      <BiometricSheet open={bioOpen} onClose={() => setBioOpen(false)} user={user} />
    </div>
  );
}
