"use client";

/**
 * 🔔 SUARA NOTIFIKASI KHAS AGSI (Web Audio API — tanpa file audio)
 *
 * Tiga suara dengan identitas restoran:
 *   - playAgsiOrder()  : BEL DAPUR "ting-ting-ting-tiiing" — NYARING, untuk
 *                        pesanan baru masuk di halaman admin.
 *   - playAgsiStatus() : senar 3 nada gembira — update status pesanan pelanggan.
 *   - playAgsiChat()   : blip 2 nada cepat — chat/balasan baru masuk.
 *
 * Catatan autoplay: browser baru mengizinkan audio setelah ada interaksi
 * pengguna. initAudioUnlock() memasang listener global sekali saja yang
 * "membuka" AudioContext pada klik/tekan pertama (mis. tombol masuk).
 */

let ctx: AudioContext | null = null;
let unlockInstalled = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Pasang listener global sekali — resume AudioContext pada gesture pertama */
export function initAudioUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const kick = () => {
    const c = getCtx();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", kick, { capture: true });
  window.addEventListener("keydown", kick, { capture: true });
  window.addEventListener("touchstart", kick, { capture: true, passive: true });
}

/**
 * Nada bel nyaring: 3 parsial harmonik (fundamental + 2 overtones) dengan
 * attack cepat & decay eksponensial — terdengar seperti bel servis dapur.
 */
function bell(
  c: AudioContext,
  dest: AudioNode,
  freq: number,
  t0: number,
  dur: number,
  vol: number
) {
  const partials = [
    { f: freq, g: 1 },
    { f: freq * 2.01, g: 0.42 },
    { f: freq * 2.98, g: 0.2 },
  ];
  for (const p of partials) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(p.f, t0);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol * p.g, t0 + 0.007);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

/** Nada "tok" kayu — penambah pukulan agar terdengar tegas & nyaring */
function thump(c: AudioContext, dest: AudioNode, freq: number, t0: number, vol: number) {
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t0 + 0.09);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  osc.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + 0.18);
}

/** Jalankan pola nada dengan rantai gain master + kompresor agar KENCANG tanpa pecah */
function playPattern(
  notes: Array<{ t: number; f: number; d: number; v: number; thump?: number }>,
  totalDur: number
) {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  try {
    const now = c.currentTime + 0.02;
    const master = c.createGain();
    master.gain.value = 1;

    // Kompresor membuat suara terdengar keras/nyaring tanpa clipping
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 18;
    comp.ratio.value = 7;
    comp.attack.value = 0.003;
    comp.release.value = 0.24;

    master.connect(comp);
    comp.connect(c.destination);

    for (const n of notes) {
      bell(c, master, n.f, now + n.t, n.d, n.v);
      if (n.thump) thump(c, master, n.thump, now + n.t, n.v * 0.5);
    }

    // Hentikan rantai setelah selesai agar node tidak menumpuk
    window.setTimeout(() => {
      try {
        master.disconnect();
        comp.disconnect();
      } catch {
        // diam
      }
    }, (totalDur + 0.3) * 1000);
  } catch {
    // audio tidak tersedia — abaikan
  }
}

/**
 * 🔔 SUARA UTAMA — pesanan baru masuk (admin).
 * Motif khas AGSI: arpeggio naik cepat G5→C6→E6 lalu bel ganda G6
 * "ting-ting-ting TIIING-ting!" — nyaring menembus bising dapur.
 */
export function playAgsiOrder() {
  playPattern(
    [
      { t: 0.0, f: 783.99, d: 0.22, v: 0.5, thump: 190 },
      { t: 0.13, f: 1046.5, d: 0.22, v: 0.55 },
      { t: 0.26, f: 1318.51, d: 0.22, v: 0.6 },
      { t: 0.42, f: 1567.98, d: 0.5, v: 0.75, thump: 240 },
      { t: 0.68, f: 1567.98, d: 0.85, v: 0.8, thump: 240 },
    ],
    1.6
  );
}

/** 💬 Chat masuk — blip 2 nada cepat "du-ding!" */
export function playAgsiChat() {
  playPattern(
    [
      { t: 0.0, f: 1046.5, d: 0.16, v: 0.42 },
      { t: 0.13, f: 1567.98, d: 0.4, v: 0.5 },
    ],
    0.6
  );
}

/** 👨‍🍳 Update status pesanan (pelanggan) — senar gembira C6→E6→G6 */
export function playAgsiStatus() {
  playPattern(
    [
      { t: 0.0, f: 1046.5, d: 0.18, v: 0.4 },
      { t: 0.14, f: 1318.51, d: 0.18, v: 0.45 },
      { t: 0.28, f: 1567.98, d: 0.55, v: 0.55 },
    ],
    0.9
  );
}
