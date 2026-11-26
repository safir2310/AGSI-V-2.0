// Cuplikan gaya STATIS kapsul spanduk + kata-katanya (untuk rute dengan
// konfigurasi kustom kin-test2). Dipakai bersama kin_custom_report.py.
(() => {
  const strip = document.querySelector("section[aria-hidden]");
  if (!strip) return JSON.stringify({ error: "strip tidak ditemukan" });
  const pill = [...strip.querySelectorAll("span")].find(
    (s) => typeof s.className === "string" && s.className.includes("ring-orange-200")
  );
  if (!pill) return JSON.stringify({ error: "kapsul tidak ditemukan" });
  const cs = getComputedStyle(pill);
  const words = [...pill.querySelectorAll(":scope > span.inline-block")].map((w) => ({
    t: w.textContent,
    c: getComputedStyle(w).color,
  }));
  const boom = [...strip.querySelectorAll("span")].find((s) => s.textContent.trim().startsWith("BOOM"));
  return JSON.stringify({
    stripH: +strip.getBoundingClientRect().height.toFixed(1),
    fontSize: cs.fontSize,
    fontFamily: cs.fontFamily,
    transform: cs.textTransform,
    style: cs.fontStyle,
    weight: cs.fontWeight,
    // gaya animasi 3D: transform kapsul (harus matrix3d bila perspektif aktif)
    // + clip-path (klasik = inset wipe; varian 3D = none)
    pillTransform: cs.transform,
    pillClip: cs.clipPath,
    boomAda: !!boom,
    words,
  });
})()
