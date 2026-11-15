#!/usr/bin/env python3
"""make-agsi-chime.py — hasilkan suara notifikasi khas AGSI (res/raw/agsi_chime.wav).

Desain: "double chime" ramah makanan-restoran — dua dentingan lembut (lonceng
bedug log) naik-nada: 784 Hz (G5) lalu 1175 Hz (D6), tiap denting ~0,32 detik
dengan envelope attack cepat + decay halus dan sedikit harmonik ke-2. 44100 Hz,
16-bit PCM mono, total ±0,95 detik — jelas terdengar khas tapi tidak mengagetkan.
"""
import math
import struct
import wave

SR = 44100

def tone(freq: float, dur: float, gain: float) -> list[float]:
    """Satu dentingan: sine + harmonik ke-2 + envelope attack 8 ms decay eksponensial."""
    n = int(SR * dur)
    out = []
    for i in range(n):
        t = i / SR
        # envelope: attack 8 ms, decay eksponensial (tau ~0.09 s)
        attack = min(1.0, t / 0.008)
        decay = math.exp(-t / 0.09)
        env = attack * decay
        s = math.sin(2 * math.pi * freq * t)
        s += 0.35 * math.sin(2 * math.pi * freq * 2 * t)   # harmonik ke-2 (lonceng)
        s += 0.12 * math.sin(2 * math.pi * freq * 3.01 * t)  # inharmonis tipis
        out.append(gain * env * s / 1.47)
    return out

samples = []
samples += tone(784.0, 0.42, 0.80)                       # denting 1 — G5
gap = [0.0] * int(SR * 0.09)
samples += gap
samples += tone(1174.7, 0.44, 0.88)                      # denting 2 — D6 (lebih tinggi)

# fade-out akhir 60 ms agar tidak "pop"
fade = int(SR * 0.06)
for i in range(fade):
    samples[-1 - i] *= i / fade

pcm = b"".join(struct.pack("<h", max(-32767, min(32767, int(s * 32767)))) for s in samples)

out = "/home/z/my-project/download/agsi-android/app/src/main/res/raw/agsi_chime.wav"
import os
os.makedirs(os.path.dirname(out), exist_ok=True)
with wave.open(out, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm)

import os.path
print("OK", out, os.path.getsize(out), "bytes,", len(samples) / SR, "detik")
