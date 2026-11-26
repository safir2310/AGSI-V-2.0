/**
 * Kompresi foto bukti pengiriman di perangkat kurir (klien).
 * Pola sama dengan kompresi gambar banner (BannerSettingsSheet): canvas →
 * JPEG iteratif (turunkan kualitas lalu dimensi) sampai mencapai target.
 *
 * Foto bukti ±160 KB biner — cukup tajam utk membaca nomor rumah/nama penerima,
 * unggah cepat di jaringan desa, dan jauh di bawah batas server (±1 MB).
 */

/** Baca file gambar → data-URL terkompresi. Melempar Error berbahasa Indonesia. */
export async function compressProofPhoto(file: File, target = 220_000): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("File bukan gambar.");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Gagal membaca file."));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("File bukan gambar yang valid."));
    i.src = dataUrl;
  });

  // Sudah kecil → biarkan apa adanya (hindari degradasi dua kali)
  let scale = Math.min(1, 1280 / Math.max(img.width, img.height));
  if (scale >= 1 && dataUrl.length < target) return dataUrl;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // Canvas tak tersedia (memori perangkat penuh dsb.) — JANGAN kirim file
    // asli raksasa: badan request > ±4,5 MB diputus platform.
    if (dataUrl.length > 1_400_000) {
      throw new Error("Foto tidak dapat dipadatkan di perangkat ini — ambil ulang fotonya.");
    }
    return dataUrl;
  }

  let quality = 0.8;
  let out = dataUrl;
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      out = canvas.toDataURL("image/jpeg", quality);
      if (out.length <= target) break;
      if (quality > 0.5) quality = Math.max(0.5, quality - 0.08);
      else scale *= 0.85; // kualitas sudah di batas bawah → perkecil dimensi
    }
  } catch {
    throw new Error("Foto terlalu besar untuk diproses perangkat ini — ambil ulang fotonya.");
  }
  return out;
}
