/**
 * decodeStoredMedia — dekode media (gambar/video) yang tersimpan di
 * StoreSetting menjadi bytes + Content-Type siap disajikan.
 *
 * TAHAN BANTING: baris lama bisa berisi bytes TANPA mime (build lama menyimpan
 * data saja — kolom mime & versi belum ditulis bersamaan), atau berupa data
 * URL utuh ("data:image/jpeg;base64,...."). Keduanya tetap tersaji:
 *  - awalan "data:…;base64," dibuang; mime diambil dari awalan bila kolom kosong.
 *  - mime kosong → ditebak dari magic bytes (JPEG/PNG/WebP/GIF; MP4/WebM untuk
 *    video); tak dikenal → application/octet-stream (gambar) / video/mp4.
 *
 * Lapisan baca (getBannerSettings dkk.) kini menganggap ada gambar hanya dari
 * keberadaan DATA (mime tak wajib) sehingga gambar yang tersimpan build lama
 * langsung tampil tanpa perlu upload ulang.
 */
export function decodeStoredMedia(
  stored: string,
  mimeColumn: string | null | undefined,
  kind: "image" | "video",
): { buf: Buffer; contentType: string } | null {
  let raw = stored;
  let mime = (mimeColumn ?? "").trim();
  if (raw.startsWith("data:")) {
    const semi = raw.indexOf(";");
    const comma = raw.indexOf(",");
    if (comma >= 0) {
      if (!mime && semi > 5) mime = raw.slice(5, semi);
      raw = raw.slice(comma + 1);
    }
  }
  const buf = Buffer.from(raw, "base64");
  if (!buf.byteLength) return null;
  if (!mime) mime = sniffMime(buf, kind);
  return { buf, contentType: mime };
}

function sniffMime(buf: Buffer, kind: "image" | "video"): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (
    buf.length >= 4 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return "image/png";
  if (
    buf.length >= 12 &&
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (buf.length >= 3 && buf.toString("latin1", 0, 3) === "GIF") return "image/gif";
  if (buf.length >= 12 && buf.toString("latin1", 4, 8) === "ftyp") return "video/mp4";
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3)
    return "video/webm";
  return kind === "video" ? "video/mp4" : "application/octet-stream";
}
