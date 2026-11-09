"use client";

/**
 * 404 dalam aplikasi — jaring pengaman navigasi.
 * Kasus nyata: halaman bayar DOKU kadang menavigasi parent ke path relatif
 * miliknya (mis. "/checkout-link-v2/failed/page?...") — di aplikasi AGSI
 * path itu tidak ada. Daripada 404 mentah Next.js, tampilkan halaman ramah
 * yang tetap membawa pengguna kembali KE DALAM aplikasi.
 */

import { useRouter } from "next/navigation";
import { Compass } from "lucide-react";

export default function NotFound() {
  const router = useRouter();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-orange-600 via-orange-500 to-orange-400 px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl">
        <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-orange-50 ring-4 ring-orange-100">
          <Compass className="h-10 w-10 text-orange-500" />
        </span>
        <h1 className="mt-4 text-lg font-black text-neutral-900">Halaman Tidak Ditemukan</h1>
        <p className="mx-auto mt-2 max-w-[300px] text-xs leading-relaxed text-neutral-500">
          Alamat yang kamu buka bukan bagian dari aplikasi AGSI. Tenang — tombol di bawah
          mengembalikanmu ke aplikasi.
        </p>
        <button
          onClick={() => router.replace("/")}
          className="press-effect mt-6 w-full rounded-xl bg-orange-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-orange-500/30 hover:bg-orange-700"
        >
          Kembali ke Aplikasi
        </button>
      </div>
    </main>
  );
}
