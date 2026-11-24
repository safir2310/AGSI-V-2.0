// Dijalankan lewat `agent-browser eval "$(cat scripts/kin_timeline.js)"` pada
// rute verifikasi lokal. eval punya batas waktu internal, jadi cuplikan berjalan
// di latar halaman (window.__kin) dan hasilnya di-poll perintah terpisah.
// Mencuplik gaya terkompute elemen adegan kurir tiap 100 ms selama ±17,5 dtk
// (2 siklus): posisi motor, opacity/x/scale/blur/tracking tiap kata, clip-path
// kapsul, opacity BOOM & garis kecepatan, kotak (bbox) chip BOOM/kapsul/kata
// terhadap strip, dan posisi spanduk terhadap strip.
(() => {
  const strip = document.querySelector("section[aria-hidden]");
  if (!strip) return JSON.stringify({ error: "strip tidak ditemukan" });
  const motor = strip.querySelector(":scope > .absolute.bottom-3.left-0");
  const bob = motor.querySelector(":scope > .relative");
  const flag = bob.querySelector(":scope > .absolute.right-full");
  // Kapsul spanduk = anak pertama flag wrapper; tali towbow = anak terakhir
  // (menempel di sisi motor)
  const pill = flag.querySelector(":scope > span:nth-child(1)");
  const words = [...pill.querySelectorAll(":scope > span.inline-block")];
  // Elemen yang dianimasikan adalah induk chip "BOOM!" (motion.div); chip
  // BISA ABSEN bila admin mematikan ledakan BOOM (cfg.boom=false) → sentinel
  const chip = [...strip.querySelectorAll("span")].find((s) => s.textContent.trim().startsWith("BOOM"));
  const boom = chip ? chip.parentElement : null;
  const lines = bob.querySelector(":scope > .absolute.inset-0");
  // Elemen yang dapat mencuat ke kiri kotak motor: tali towbow, asap knalpot,
  // garis kecepatan (untuk memastikan tak ada yang tertinggal di tepi kanan)
  const protrude = [
    flag.querySelector(":scope > span:last-child"),
    ...bob.querySelectorAll(":scope > span.rounded-full"),
    ...lines.querySelectorAll("span"),
  ];

  const tx = (el) => {
    const tf = getComputedStyle(el).transform;
    const m = new DOMMatrixReadOnly(tf === "none" ? undefined : tf);
    return [m.m41, m.m42, m.a];
  };
  // [opacity, x, y, scaleX, filter, letterSpacing, clipPath]
  const snap = (el) => {
    const cs = getComputedStyle(el);
    const [x, y, s] = tx(el);
    return [cs.opacity, x, y, s, cs.filter, cs.letterSpacing, cs.clipPath].map((v) =>
      typeof v === "number" ? +v.toFixed(2) : v
    );
  };
  // Kotak elemen terhadap strip: [kiri, atas, kanan, bawah] (ikut transform)
  const box = (el, sr) => {
    const r = el.getBoundingClientRect();
    return [
      +(r.left - sr.left).toFixed(1),
      +(r.top - sr.top).toFixed(1),
      +(r.right - sr.left).toFixed(1),
      +(r.bottom - sr.top).toFixed(1),
    ];
  };

  window.__kin = "pending";
  const out = [];
  const t0 = performance.now();
  const tick = () => {
    const t = (performance.now() - t0) / 1000;
    const sr = strip.getBoundingClientRect();
    const pr = pill.getBoundingClientRect();
    out.push({
      t: +t.toFixed(2),
      m: +tx(motor)[0].toFixed(1),
      p: snap(pill),
      w: words.map(snap),
      b: boom ? snap(boom) : [0, 0, 0, 0, "none", "normal", "none"],
      l: +getComputedStyle(lines).opacity,
      c: chip ? box(chip, sr) : [-1, -1, -1, -1],
      pb: box(pill, sr),
      wb: words.map((w) => box(w, sr)),
      // titik paling kiri elemen yang mencuat (px dari tepi kiri strip)
      k: +Math.min(...protrude.map((el) => el.getBoundingClientRect().left - sr.left)).toFixed(1),
      // jarak kapsul spanduk dari tepi kiri/kanan strip + lebarnya (px)
      fit: [+(pr.left - sr.left).toFixed(1), +(sr.right - pr.right).toFixed(1), +pr.width.toFixed(1)],
    });
    if (t < 17.5) setTimeout(tick, 100);
    else
      window.__kin = JSON.stringify({
        vw: innerWidth,
        stripW: +strip.getBoundingClientRect().width.toFixed(1),
        stripH: +strip.getBoundingClientRect().height.toFixed(1),
        clientW: strip.clientWidth,
        out,
      });
  };
  tick();
  return "started";
})()
