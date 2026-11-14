import type { Metadata } from "next";
import { ChickenBadge } from "@/components/logo/ChickenLogo";
import { Download, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { LATEST_APP_VERSION } from "@/lib/app-version";

export const metadata: Metadata = {
  title: "Unduh Aplikasi AGSI — Android",
  description:
    "Unduh aplikasi Android AGSI (Ayam Geprek Sambal Ijo) versi terbaru — cetak struk, simpan & cetak laporan, Face ID.",
};

/**
 * HALAMAN UNDUH APK — pintu pembaruan aplikasi yang SELALU tersedia:
 *  - di dalam aplikasi (banner "Perbarui" mengarah ke /agsi-app.apk; bila
 *    unduhan in-app tak jalan, pengguna diarahkan ke halaman ini lewat Chrome)
 *  - di browser HP mana pun (Chrome: buka alamat situs + /unduh)
 *
 * Halaman statis — tidak butuh JS; tombol utama <a href="/agsi-app.apk">.
 */
export default function UnduhPage() {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-orange-50 via-white to-amber-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        {/* Kepala */}
        <div className="flex flex-col items-center text-center">
          <ChickenBadge size={64} />
          <h1 className="mt-3 text-xl font-black text-neutral-900">
            Unduh Aplikasi AGSI 🧾
          </h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-500">
            Ayam Geprek Sambal Ijo — aplikasi Android versi terbaru
          </p>
        </div>

        {/* Tombol unduh utama */}
        <a
          href="/agsi-app.apk"
          className="press-effect mt-6 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-500 text-base font-black text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-700 hover:to-amber-600"
        >
          <Download className="h-5 w-5" />
          Unduh AGSI v{LATEST_APP_VERSION} (± 6 MB)
        </a>
        <p className="mt-2 text-center text-[11px] text-neutral-400">
          Jika tombol tidak merespons, tekan-lama tombol di atas → <b>Salin alamat tautan</b> → tempel di Chrome.
        </p>

        {/* Langkah pemasangan */}
        <div className="mt-6 rounded-2xl border border-orange-100 bg-white p-4 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-black text-neutral-800">
            <Smartphone className="h-4 w-4 text-orange-600" /> Cara Memasang
          </p>
          <ol className="mt-2.5 list-decimal space-y-1.5 pl-5 text-[12px] leading-relaxed text-neutral-600">
            <li>Ketuk tombol <b>Unduh</b> di atas — file masuk folder <b>Unduhan</b>.</li>
            <li>Buka notifikasi unduhan selesai (atau aplikasi <b>File</b> → Unduhan).</li>
            <li>Ketuk file APK → bila diminta, izinkan <b>Instal dari sumber ini</b>.</li>
            <li>Selesai — aplikasi terpasang menimpa versi lama secara langsung.</li>
          </ol>
        </div>

        {/* Catatan aman */}
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <p className="text-[11.5px] leading-relaxed text-emerald-800">
            <b>Aman &amp; tanpa kehilangan data:</b> APK resmi ditandatangani kunci yang
            sama dengan versi lama — pasang langsung tanpa uninstall, akun, keranjang,
            dan sesi login tetap tersimpan.
          </p>
        </div>

        {/* Catatan versi lama */}
        <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-[11.5px] leading-relaxed text-amber-800">
            <b>Apa yang baru di v{LATEST_APP_VERSION}?</b> Notifikasi kini masuk
            REAL-TIME — pesanan baru, QRIS terbayar, status pesanan &amp; chat CS
            muncul seketika: popup + suara instan saat aplikasi terbuka (tanpa
            menunggu penyegaran), heads-up layar walau aplikasi ditutup, dan
            notifikasi layanan &quot;AGSI aktif&quot; tetap tersembunyi. Versi
            sebelumnya: notifikasi layanan disembunyikan total, notifikasi layar
            pesanan/chat walau aplikasi ditutup, lonceng &amp; badge, Lacak Kurir
            AGSI, simpan struk &amp; cetak laporan, Face ID / sidik jari.
          </p>
        </div>

        <p className="mt-6 text-center text-[10px] text-neutral-400">
          AGSI — Ayam Geprek Sambal Ijo
        </p>
      </div>
    </div>
  );
}
