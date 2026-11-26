// Dijalankan lewat `agent-browser eval "$(cat scripts/kin_static.js)"` pada
// rute verifikasi lokal DENGAN reduced-motion aktif
// (agent-browser set media light reduced-motion). Mengembalikan satu cuplikan
// keadaan adegan kurir; dipanggil dua kali (jarak 1,5 dtk) lalu dibandingkan
// lewat scripts/kin_static_check.py → harus identik (semua elemen statis).
(() => {
  const strip = document.querySelector("section[aria-hidden]");
  if (!strip) return JSON.stringify({ error: "strip tidak ditemukan" });
  const motor = strip.querySelector(":scope > .absolute.bottom-3.left-0");
  const bob = motor.querySelector(":scope > .relative");
  const flag = bob.querySelector(":scope > .absolute.right-full");
  // Kapsul = anak pertama flag wrapper (tali towbow = anak terakhir)
  const pill = flag.querySelector(":scope > span:nth-child(1)");
  const words = [...pill.querySelectorAll(":scope > span.inline-block")];
  const chip = [...strip.querySelectorAll("span")].find((s) => s.textContent.trim().startsWith("BOOM"));
  const lines = bob.querySelector(":scope > .absolute.inset-0");
  const sr = strip.getBoundingClientRect();
  const pr = pill.getBoundingClientRect();
  const mr = motor.getBoundingClientRect();
  return JSON.stringify({
    vw: innerWidth,
    stripW: +sr.width.toFixed(1),
    stripH: +sr.height.toFixed(1),
    motor: +(mr.left - sr.left).toFixed(1),
    pill: [+(pr.left - sr.left).toFixed(1), +(sr.right - pr.right).toFixed(1), +pr.width.toFixed(1)],
    clip: getComputedStyle(pill).clipPath,
    words: words.map((w) => getComputedStyle(w).opacity),
    chip: getComputedStyle(chip.parentElement).opacity,
    lines: getComputedStyle(lines).opacity,
    running: document.getAnimations ? document.getAnimations().filter((a) => a.playState === "running").length : -1,
  });
})()
