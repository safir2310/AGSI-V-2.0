"use client";

/**
 * /pay/[id] — Halaman Pembayaran IN-APP (permintaan pemilik: "buka halaman
 * pembayaran DOKU tetap berada dalam satu aplikasi, jangan alihkan buka
 * halaman lain").
 *
 * Halaman ini adalah SATU-SATUNYA tujuan redirect browser setelah pelanggan
 * menyelesaikan (atau membatalkan) pembayaran di halaman DOKU:
 *   - callback_url DOKU Checkout -> {APP_URL}/pay/<orderId> (qris-doku.ts)
 *   - Halaman bayar DOKU sendiri ditampilkan lewat iframe di dalam aplikasi
 *     (QrisPaySheet) — tanpa pindah tab/aplikasi.
 *
 * Fungsi: menampilkan status pembayaran pesanan (menunggu / lunas / batal)
 * dan tombol "Kembali ke Aplikasi". Verifikasi dana TETAP dikerjakan sistem
 * (polling status penyedia) — halaman ini hanya pelaporan, bukan pelunasan.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BadgeCheck,
  ChefHat,
  Loader2,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatIDR } from "@/lib/types";

type PayState =
  | { kind: "loading" }
  | { kind: "waiting"; orderCode: string | null; amount: number | null }
  | { kind: "paid"; orderCode: string | null; amount: number | null }
  | { kind: "cancelled"; notice: string | null }
  | { kind: "error"; message: string };

const POLL_MS = 4000;

export default function PayPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  const [state, setState] = useState<PayState>({ kind: "loading" });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!id) {
      setState({ kind: "error", message: "Pesanan tidak dikenal." });
      return;
    }
    try {
      // Info pesanan (kode + nominal) — aman untuk pesanan lunas & menunggu
      const infoRes = await apiFetch(`/api/orders/${id}/qris`, { cache: "no-store" });
      const info = await infoRes.json().catch(() => ({}));
      const orderCode = typeof info.orderCode === "string" ? info.orderCode : null;
      const amount = typeof info.amount === "number" ? info.amount : null;

      const res = await apiFetch(`/api/orders/${id}/qris/status`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!alive.current) return;

      if (res.status === 401 || res.status === 403) {
        setState({
          kind: "error",
          message:
            "Sesi sudah berakhir atau Anda tidak berhak melihat pesanan ini. Buka aplikasi lalu masuk kembali.",
        });
        return;
      }
      if (res.status === 404) {
        setState({ kind: "error", message: "Pesanan tidak ditemukan." });
        return;
      }
      if (data.cancelled === true || data.status === "CANCELLED") {
        setState({ kind: "cancelled", notice: (data.notice as string) ?? null });
        return;
      }
      if (data.paymentStatus === "PAID" || info.paid === true) {
        setState({ kind: "paid", orderCode, amount });
        return;
      }
      setState({ kind: "waiting", orderCode, amount });
    } catch {
      if (!alive.current) return;
      setState({
        kind: "error",
        message: "Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.",
      });
    }
  }, [id]);

  useEffect(() => {
    // Pemeriksaan pertama lewat microtask (bukan sinkron di badan efek) +
    // pemantauan berkala — status memperbarui otomatis selama menunggu.
    void Promise.resolve().then(() => refresh());
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Berhenti memantau begitu ada keputusan final
  useEffect(() => {
    if (state.kind === "paid" || state.kind === "cancelled" || state.kind === "error") {
      alive.current = false;
    }
  }, [state.kind]);

  return (
    <main className="flex min-h-dvh flex-col bg-gradient-to-b from-orange-600 via-orange-500 to-orange-400">
      <div className="flex items-center gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-4 text-white">
        <button
          onClick={() => router.replace("/")}
          aria-label="Kembali ke aplikasi"
          className="press-effect flex h-10 w-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30 hover:bg-white/30"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <p className="text-sm font-black tracking-wide">Pembayaran AGSI</p>
          <p className="text-[11px] font-semibold text-orange-100">
            Halaman pembayaran di dalam aplikasi
          </p>
        </div>
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-black tracking-widest ring-1 ring-white/25">
          <ChefHat className="h-3.5 w-3.5" /> DOKU
        </span>
      </div>

      <div className="flex flex-1 items-start justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl">
          {state.kind === "loading" || state.kind === "waiting" ? (
            <>
              <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-orange-50 ring-4 ring-orange-100">
                {state.kind === "loading" ? (
                  <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                ) : (
                  <ChefHat className="h-10 w-10 text-orange-500" />
                )}
              </span>
              <h1 className="mt-4 text-lg font-black text-neutral-900">
                {state.kind === "loading" ? "Memeriksa Pembayaran…" : "Menunggu Pembayaran"}
              </h1>
              <p className="mx-auto mt-2 max-w-[300px] text-xs leading-relaxed text-neutral-500">
                {state.kind === "waiting" ? (
                  <>
                    Pesanan{" "}
                    <strong className="font-bold text-neutral-700">{state.orderCode ?? "-"}</strong>
                    {state.amount != null ? (
                      <>
                        {" "}sebesar{" "}
                        <strong className="font-bold text-orange-600">{formatIDR(state.amount)}</strong>
                      </>
                    ) : null}{" "}
                    belum terkonfirmasi. Halaman ini memperbarui otomatis — begitu dana masuk,
                    statusnya langsung lunas.
                  </>
                ) : (
                  "Mengambil status pembayaran pesanan…"
                )}
              </p>
              {state.kind === "waiting" && (
                <div className="mt-4 flex items-center justify-center gap-2 text-[11px] font-bold text-emerald-600">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  Sistem memantau pembayaran otomatis
                </div>
              )}
            </>
          ) : state.kind === "paid" ? (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 280, damping: 20 }}
            >
              <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 ring-4 ring-emerald-100">
                <BadgeCheck className="h-11 w-11 text-emerald-600" />
              </span>
              <h1 className="mt-4 text-lg font-black text-neutral-900">Pembayaran Diterima! 🎉</h1>
              <p className="mx-auto mt-2 max-w-[300px] text-xs leading-relaxed text-neutral-500">
                Pesanan{" "}
                <strong className="font-bold text-neutral-700">{state.orderCode ?? "-"}</strong>
                {state.amount != null ? (
                  <>
                    {" "}sebesar{" "}
                    <strong className="font-bold text-emerald-600">{formatIDR(state.amount)}</strong>
                  </>
                ) : null}{" "}
                sudah <strong className="font-bold text-emerald-600">LUNAS</strong> — terverifikasi
                otomatis oleh sistem. Geprekmu segera dimasak ya!
              </p>
            </motion.div>
          ) : state.kind === "cancelled" ? (
            <>
              <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-50 ring-4 ring-red-100">
                <XCircle className="h-11 w-11 text-red-500" />
              </span>
              <h1 className="mt-4 text-lg font-black text-neutral-900">Pesanan Dibatalkan</h1>
              <p className="mx-auto mt-2 max-w-[320px] text-xs leading-relaxed text-neutral-500">
                {state.notice ??
                  "Pembayaran tidak diterima dalam batas waktu, jadi pesanan dibatalkan otomatis."}
              </p>
            </>
          ) : (
            <>
              <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-50 ring-4 ring-amber-100">
                <XCircle className="h-11 w-11 text-amber-500" />
              </span>
              <h1 className="mt-4 text-lg font-black text-neutral-900">Status Belum Dapat Diperiksa</h1>
              <p className="mx-auto mt-2 max-w-[320px] text-xs leading-relaxed text-neutral-500">
                {state.message}
              </p>
            </>
          )}

          <button
            onClick={() => router.replace("/")}
            className="press-effect mt-6 w-full rounded-xl bg-orange-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700"
          >
            Kembali ke Aplikasi
          </button>
          <p className="mt-3 text-[10px] leading-snug text-neutral-400">
            Pembayaran diverifikasi otomatis oleh sistem — tidak perlu konfirmasi siapa pun.
          </p>
        </div>
      </div>
    </main>
  );
}
